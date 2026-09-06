import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCommands, outcomeOf, classifyInvocationError, runCommand } from "./ssm-run.mjs";

test("buildCommands: المتغيرات تُصدَّر مقتبسةً بأمان، ثم السكربت يُكتب ملفًّا ويُشغَّل بـbash لا بـsh", () => {
  // AWS-RunShellScript يشغّل الأوامر بـsh (dash على أوبونتو) فيرفض `set -o pipefail` و`[[ ]]` —
  // الصيد الحي 42515401: «set: Illegal option -o pipefail» خروج 2 قبل أي تنزيل
  const cmds = buildCommands("set -euo pipefail\necho hi\n", { NOOQ_BUNDLE_ID: "abc", NOOQ_BUNDLE_URL: "https://x/y?a=1&b='q'" });
  assert.equal(cmds[0], "export NOOQ_BUNDLE_ID='abc'");
  assert.equal(cmds[1], "export NOOQ_BUNDLE_URL='https://x/y?a=1&b='\\''q'\\'''");
  const open = cmds.findIndex((l) => /^cat > "\$__nooq_script" <<'__NOOQ_SSM__'$/.test(l));
  assert.ok(open > 1, "heredoc opener");
  assert.match(cmds[open - 1], /^__nooq_script=\$\(mktemp /);
  assert.deepEqual(cmds.slice(open + 1, open + 3), ["set -euo pipefail", "echo hi"]);
  assert.equal(cmds[open + 3], "__NOOQ_SSM__");
  assert.match(cmds[open + 4], /^bash "\$__nooq_script"; __rc=\$\?; rm -f "\$__nooq_script"; exit \$__rc$/);
  assert.equal(cmds.length, open + 5);
});

test("buildCommands: لا سطر من السكربت يُنفَّذ خارج ملف bash — ولا يُبدَّل $ داخله", () => {
  const cmds = buildCommands('[[ -n "$X" ]] && echo "$X"\n', {});
  const open = cmds.findIndex((l) => l.startsWith("cat > "));
  assert.equal(cmds[open + 1], '[[ -n "$X" ]] && echo "$X"');
  assert.ok(!cmds.slice(0, open).some((l) => l.includes("[[")), "no bash-ism runs under sh");
});

test("buildCommands: اسم متغير غير صالح يُرفض — لا حقن في سطر export", () => {
  assert.throws(() => buildCommands("true", { "X;rm -rf /": "1" }));
});

test("outcomeOf: الحالات غير النهائية تنتظر، والنهائية تنقل رمز الخروج كما هو", () => {
  assert.deepEqual(outcomeOf({ Status: "InProgress", ResponseCode: -1 }), { done: false, exitCode: null });
  assert.deepEqual(outcomeOf({ Status: "Pending", ResponseCode: -1 }), { done: false, exitCode: null });
  assert.deepEqual(outcomeOf({ Status: "Success", ResponseCode: 0 }), { done: true, exitCode: 0 });
  assert.deepEqual(outcomeOf({ Status: "Failed", ResponseCode: 6 }), { done: true, exitCode: 6 });
  assert.deepEqual(outcomeOf({ Status: "Failed", ResponseCode: 10 }), { done: true, exitCode: 10 });
});

test("outcomeOf: انتهاء المهلة والإلغاء رموز مميَّزة لا صفر ولا واحد عام", () => {
  assert.deepEqual(outcomeOf({ Status: "TimedOut", ResponseCode: -1 }), { done: true, exitCode: 124 });
  assert.deepEqual(outcomeOf({ Status: "Cancelled", ResponseCode: -1 }), { done: true, exitCode: 125 });
  assert.deepEqual(outcomeOf({ Status: "Failed", ResponseCode: -1 }), { done: true, exitCode: 1 });
  assert.deepEqual(outcomeOf({ Status: "DeliveryTimedOut", ResponseCode: -1 }), { done: true, exitCode: 124 });
});

test("classifyInvocationError: العابر يُعاد (لم يظهر بعد · مهلة · خنق · شبكة)؛ الصلاحية والاعتماد يفشلان فورًا", () => {
  assert.equal(classifyInvocationError("An error occurred (InvocationDoesNotExist) when calling the GetCommandInvocation operation"), "retry");
  assert.equal(classifyInvocationError("An error occurred (RequestTimeout) when calling the GetCommandInvocation operation"), "retry");
  assert.equal(classifyInvocationError("An error occurred (ThrottlingException) when calling ..."), "retry");
  assert.equal(classifyInvocationError("Could not connect to the endpoint URL: \"https://ssm.eu-north-1.amazonaws.com/\""), "retry");
  assert.equal(classifyInvocationError("An error occurred (InternalServerError) when calling ..."), "retry");
  assert.equal(classifyInvocationError("An error occurred (AccessDeniedException) when calling ..."), "fatal");
  assert.equal(classifyInvocationError("An error occurred (ExpiredTokenException) when calling ..."), "fatal");
  assert.equal(classifyInvocationError("Unable to locate credentials"), "fatal");
});

test("runCommand: خطأ عابر بعد الإرسال لا يُغادر الأمر الجاري — يُعاد حتى الحالة النهائية", async () => {
  const f = fakeAws([
    { body: { Command: { CommandId: "cmd-t" } } },
    { error: "An error occurred (RequestTimeout) when calling the GetCommandInvocation operation" },
    { error: "Could not connect to the endpoint URL" },
    { body: { Status: "Success", ResponseCode: 0 } },
  ]);
  const r = await runCommand({ region: "r", instanceId: "i-1", timeoutSec: 600, scriptText: script, env: {} }, { aws: f.aws, sleep: noSleep, log: () => {}, err: () => {}, now: (() => { let t = 0; return () => (t += 1000); })() });
  assert.equal(r.exitCode, 0);
  assert.equal(f.calls.length, 4);
});

test("runCommand: الخطأ الدائم والمهلة يقولان صراحةً إن الأمر قد يكون جاريًا على الجهاز ويسمّيان معرّفه", async () => {
  const msgs = [];
  const f = fakeAws([
    { body: { Command: { CommandId: "cmd-x" } } },
    { error: "An error occurred (AccessDeniedException) when calling the GetCommandInvocation operation" },
  ]);
  const r = await runCommand({ region: "r", instanceId: "i-1", timeoutSec: 600, scriptText: script, env: {} }, { aws: f.aws, sleep: noSleep, log: () => {}, err: (l) => msgs.push(l), now: (() => { let t = 0; return () => (t += 1000); })() });
  assert.equal(r.exitCode, 126);
  assert.ok(msgs.some((m) => m.includes("cmd-x") && /جار/.test(m)));
});

// منفذ aws وهمي: تسلسل ردود لكل استدعاء؛ ونومٌ لا ينتظر
function fakeAws(sequence) {
  const calls = [];
  return {
    calls,
    aws: (args) => {
      calls.push(args);
      const next = sequence.shift();
      if (!next) throw new Error("no more canned responses");
      if (next.error) { const e = new Error(next.error); e.stderr = next.error; throw e; }
      return JSON.stringify(next.body);
    },
  };
}
const noSleep = async () => {};
const script = "set -e\necho activated\n";

test("runCommand: يرسل RunShellScript بمهلة التنفيذ ثم ينتظر حتى الحالة النهائية وينقل رمز الخروج", async () => {
  const f = fakeAws([
    { body: { Command: { CommandId: "cmd-1" } } },
    { error: "An error occurred (InvocationDoesNotExist) when calling the GetCommandInvocation operation" },
    { body: { Status: "InProgress", ResponseCode: -1 } },
    { body: { Status: "Failed", ResponseCode: 6, StandardOutputContent: "restored", StandardErrorContent: "health failed" } },
  ]);
  const out = [];
  const r = await runCommand({ region: "eu-north-1", instanceId: "i-1", timeoutSec: 600, scriptText: script, env: { NOOQ_BUNDLE_ID: "abc" } }, { aws: f.aws, sleep: noSleep, log: (l) => out.push(l), err: (l) => out.push(l), now: (() => { let t = 0; return () => (t += 1000); })() });
  assert.equal(r.exitCode, 6);
  const send = f.calls[0];
  assert.equal(send[1], "send-command");
  assert.ok(send.includes("--document-name") && send.includes("AWS-RunShellScript"));
  assert.ok(send.includes("--instance-ids") && send.includes("i-1"));
  const params = JSON.parse(send[send.indexOf("--parameters") + 1]);
  assert.deepEqual(params.executionTimeout, ["600"]);
  assert.equal(params.commands[0], "export NOOQ_BUNDLE_ID='abc'");
  assert.equal(f.calls.length, 4);
  assert.ok(out.some((l) => l.includes("restored")) && out.some((l) => l.includes("health failed")));
});

test("runCommand: خطأ دائم عند قراءة النتيجة يفشل فورًا برمزٍ مميَّز لا بانتظار المهلة", async () => {
  const f = fakeAws([
    { body: { Command: { CommandId: "cmd-2" } } },
    { error: "An error occurred (AccessDeniedException) when calling the GetCommandInvocation operation" },
  ]);
  const r = await runCommand({ region: "r", instanceId: "i-1", timeoutSec: 600, scriptText: script, env: {} }, { aws: f.aws, sleep: noSleep, log: () => {}, err: () => {}, now: (() => { let t = 0; return () => (t += 1000); })() });
  assert.equal(r.exitCode, 126);
  assert.equal(f.calls.length, 2);
});

test("runCommand: تجاوز المهلة الكلية بلا حالة نهائية ⇒ 124", async () => {
  const f = fakeAws(Array.from({ length: 50 }, () => ({ body: { Status: "InProgress", ResponseCode: -1 } })));
  f.calls.push;
  const seq = [{ body: { Command: { CommandId: "cmd-3" } } }];
  const g = fakeAws(seq.concat(Array.from({ length: 50 }, () => ({ body: { Status: "InProgress", ResponseCode: -1 } }))));
  let t = 0;
  const r = await runCommand({ region: "r", instanceId: "i-1", timeoutSec: 10, scriptText: script, env: {} }, { aws: g.aws, sleep: noSleep, log: () => {}, err: () => {}, now: () => (t += 60_000) });
  assert.equal(r.exitCode, 124);
  void f;
});
