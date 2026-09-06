import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCommands, outcomeOf, classifyInvocationError, runCommand } from "./ssm-run.mjs";

test("buildCommands: المتغيرات تُصدَّر مقتبسةً بأمان ثم أسطر السكربت كما هي", () => {
  const cmds = buildCommands("set -e\necho hi\n", { NOOQ_BUNDLE_ID: "abc", NOOQ_BUNDLE_URL: "https://x/y?a=1&b='q'" });
  assert.equal(cmds[0], "export NOOQ_BUNDLE_ID='abc'");
  assert.equal(cmds[1], "export NOOQ_BUNDLE_URL='https://x/y?a=1&b='\\''q'\\'''");
  assert.deepEqual(cmds.slice(2), ["set -e", "echo hi"]);
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

test("classifyInvocationError: الاستدعاء لم يظهر بعد يُعاد؛ AccessDenied وأشباهه يفشل فورًا", () => {
  assert.equal(classifyInvocationError("An error occurred (InvocationDoesNotExist) when calling the GetCommandInvocation operation"), "retry");
  assert.equal(classifyInvocationError("An error occurred (AccessDeniedException) when calling ..."), "fatal");
  assert.equal(classifyInvocationError("Unable to locate credentials"), "fatal");
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
