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

export function buildCommands(scriptText, env = {}) {
  const lines = [];
  for (const [k, v] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`اسم متغير غير صالح: ${k}`);
    lines.push(`export ${k}=${quote(v)}`);
  }
  for (const l of String(scriptText).split("\n")) {
    if (l.length) lines.push(l);
  }
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

// الاستدعاء لا يظهر فورًا بعد الإرسال (InvocationDoesNotExist) فيُعاد؛ وما سواه (صلاحية · اعتماد ·
// شبكة) يُعلَن ويفشل فورًا لا بعد المهلة كلها
export function classifyInvocationError(stderr) {
  return /InvocationDoesNotExist/.test(String(stderr ?? "")) ? "retry" : "fatal";
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
      err(`::error::تعذّرت قراءة نتيجة الأمر ${commandId}: ${String(e.stderr ?? e.message).trim()}`);
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
  err(`::error::انتهت مهلة انتظار الأمر ${commandId} على ${instanceId}`);
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
