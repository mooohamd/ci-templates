#!/usr/bin/env node
// الناشر عبر SSM: يرسل سكربتًا إلى جهازٍ مثبَّت (AWS-RunShellScript) وينتظر نتيجته وينقل رمز
// خروجه **كما هو** — فمخارج متحكم التفعيل (3–10) تصل تشغيلة الإصدار بلا تسطيح.
//   node ssm-run.mjs <region> <instanceId> <executionTimeoutSec> <scriptPath> [KEY=VALUE ...]
// المتغيرات تُصدَّر مقتبسةً بأمان قبل أسطر السكربت. مخارج هذا المنفذ نفسه: 124 مهلة · 125 إلغاء ·
// 126 تعذّر قراءة النتيجة (صلاحية/اعتماد) — فلا يُخلط بمخارج المتحكم. الخرج المضمَّن مبتور (~24 ألف
// حرف) فيُطبع ما وصل.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as nodeSleep } from "node:timers/promises";

const quote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;

// AWS-RunShellScript يشغّل الأوامر بـsh (dash على أوبونتو) فيرفض bash-isms (`set -o pipefail` ·
// `[[ ]]` · `${@: -1}`) — الصيد الحي 42515401. السكربت يُكتب ملفًّا بمحدِّد مقتبس (لا استبدال داخله)
// ويُشغَّل بـbash، ورمز خروجه يُنقل كما هو بعد حذف الملف. الصادرات قبله صالحة في sh وbash معًا.
export function buildCommands(scriptText, env = {}) {
  const lines = [];
  for (const [k, v] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`اسم متغير غير صالح: ${k}`);
    lines.push(`export ${k}=${quote(v)}`);
  }
  const body = String(scriptText).split("\n").filter((l) => l.length);
  if (body.some((l) => l.trim() === "__NOOQ_SSM__")) throw new Error("السكربت يحوي محدِّد الملف __NOOQ_SSM__");
  lines.push('__nooq_script=$(mktemp /tmp/nooq-ssm.XXXXXX)');
  lines.push(`cat > "$__nooq_script" <<'__NOOQ_SSM__'`);
  lines.push(...body);
  lines.push("__NOOQ_SSM__");
  lines.push('bash "$__nooq_script"; __rc=$?; rm -f "$__nooq_script"; exit $__rc');
  return lines;
}

// حالات SSM النهائية: Success · Failed · TimedOut · Cancelled · DeliveryTimedOut · ExecutionTimedOut
export function outcomeOf(inv) {
  const status = String(inv?.Status ?? "");
  const code = Number(inv?.ResponseCode ?? -1);
  switch (status) {
    case "Success":
      return { done: true, exitCode: 0 };
    case "Failed":
      return { done: true, exitCode: code >= 0 ? code : 1 };
    case "TimedOut":
    case "DeliveryTimedOut":
    case "ExecutionTimedOut":
      return { done: true, exitCode: 124 };
    case "Cancelled":
    case "Cancelling":
      return { done: true, exitCode: 125 };
    default:
      return { done: false, exitCode: null };
  }
}

// بعد الإرسال الأمرُ جارٍ على الجهاز، فلا يُغادَر إلا لخطأٍ لا تنفع معه الإعادة: صلاحية أو اعتماد
// أو توقيع. وما سواه عابر (الاستدعاء لم يظهر بعد · مهلة · خنق · شبكة · خطأ داخلي) يُعاد ضمن المهلة.
const FATAL = /AccessDenied|UnauthorizedOperation|ExpiredToken|InvalidClientTokenId|InvalidSignature|SignatureDoesNotMatch|Unable to locate credentials|InvalidInstanceId|ValidationException/i;
export function classifyInvocationError(stderr) {
  return FATAL.test(String(stderr ?? "")) ? "fatal" : "retry";
}

function realAws(args) {
  try {
    return execFileSync("aws", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const err = new Error(String(e.stderr || e.message));
    err.stderr = String(e.stderr || e.message);
    throw err;
  }
}

export async function runCommand({ region, instanceId, timeoutSec, scriptText, env }, deps = {}) {
  const aws = deps.aws ?? realAws;
  const sleep = deps.sleep ?? ((ms) => nodeSleep(ms));
  const log = deps.log ?? console.log;
  const err = deps.err ?? console.error;
  const now = deps.now ?? Date.now;
  const commands = buildCommands(scriptText, env);
  const params = JSON.stringify({ commands, executionTimeout: [String(Number(timeoutSec))] });
  const sent = JSON.parse(aws([
    "ssm", "send-command", "--region", region, "--instance-ids", instanceId,
    "--document-name", "AWS-RunShellScript", "--comment", `release ${env?.NOOQ_BUNDLE_ID ?? ""}`.slice(0, 100),
    "--timeout-seconds", "120", "--parameters", params, "--output", "json",
  ]));
  const commandId = sent.Command.CommandId;
  log(`SSM command ${commandId} → ${instanceId}`);
  const deadline = now() + (Number(timeoutSec) + 180) * 1000;
  while (now() < deadline) {
    await sleep(5000);
    let inv;
    try {
      inv = JSON.parse(aws(["ssm", "get-command-invocation", "--region", region, "--command-id", commandId, "--instance-id", instanceId, "--output", "json"]));
    } catch (e) {
      if (classifyInvocationError(e.stderr ?? e.message) === "retry") continue;
      err(`::error::تعذّرت قراءة نتيجة الأمر ${commandId} على ${instanceId}: ${String(e.stderr ?? e.message).trim()}`);
      err(`::error::الأمر ${commandId} قد يكون جاريًا أو مكتملًا على الجهاز بلا تحقق — افحصه: aws ssm get-command-invocation --command-id ${commandId} --instance-id ${instanceId}`);
      return { exitCode: 126, commandId };
    }
    const o = outcomeOf(inv);
    if (o.done) {
      if (inv.StandardOutputContent) log(inv.StandardOutputContent);
      if (inv.StandardErrorContent) err(inv.StandardErrorContent);
      log(`SSM status: ${inv.Status} · exit ${o.exitCode}`);
      return { exitCode: o.exitCode, commandId };
    }
  }
  err(`::error::انتهت مهلة انتظار الأمر ${commandId} على ${instanceId} — قد يكون جاريًا بعدُ: افحصه بـget-command-invocation قبل أي إعادة`);
  return { exitCode: 124, commandId };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , region, instanceId, timeoutArg, scriptPath, ...kv] = process.argv;
  if (!region || !instanceId || !timeoutArg || !scriptPath) {
    console.error("usage: ssm-run.mjs <region> <instanceId> <executionTimeoutSec> <scriptPath> [KEY=VALUE ...]");
    process.exit(2);
  }
  const env = {};
  for (const pair of kv) {
    const i = pair.indexOf("=");
    if (i <= 0) { console.error(`وسيط غير صالح: ${pair}`); process.exit(2); }
    env[pair.slice(0, i)] = pair.slice(i + 1);
  }
  const r = await runCommand({ region, instanceId, timeoutSec: Number(timeoutArg), scriptText: readFileSync(scriptPath, "utf8"), env });
  process.exit(r.exitCode);
}
