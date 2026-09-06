#!/usr/bin/env node
// الناشر عبر SSM: يرسل سكربتًا إلى جهازٍ مثبَّت (AWS-RunShellScript) وينتظر نتيجته وينقل رمز
// خروجه **كما هو** — فمخارج متحكم التفعيل (3–10) تصل تشغيلة الإصدار بلا تسطيح.
//   node ssm-run.mjs <region> <instanceId> <executionTimeoutSec> <scriptPath> [KEY=VALUE ...]
// المتغيرات تُصدَّر مقتبسةً بأمان قبل أسطر السكربت. الخرج المضمَّن في get-command-invocation
// مبتور (~24 ألف حرف) فيُطبع ما وصل ويُشار إلى الحاجة لـCloudWatch لو احتيج الكامل.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

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

function aws(args) {
  return execFileSync("aws", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function main() {
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
  const commands = buildCommands(readFileSync(scriptPath, "utf8"), env);
  const params = JSON.stringify({ commands, executionTimeout: [String(Number(timeoutArg))] });
  const sent = JSON.parse(aws([
    "ssm", "send-command", "--region", region, "--instance-ids", instanceId,
    "--document-name", "AWS-RunShellScript", "--comment", `nooq release ${env.NOOQ_BUNDLE_ID ?? ""}`.slice(0, 100),
    "--timeout-seconds", "120", "--parameters", params, "--output", "json",
  ]));
  const commandId = sent.Command.CommandId;
  console.log(`SSM command ${commandId} → ${instanceId}`);
  const deadline = Date.now() + (Number(timeoutArg) + 180) * 1000;
  let inv = null;
  while (Date.now() < deadline) {
    await sleep(5000);
    try {
      inv = JSON.parse(aws(["ssm", "get-command-invocation", "--region", region, "--command-id", commandId, "--instance-id", instanceId, "--output", "json"]));
    } catch {
      continue; // الاستدعاء لا يظهر فورًا بعد الإرسال
    }
    const o = outcomeOf(inv);
    if (o.done) {
      if (inv.StandardOutputContent) console.log(inv.StandardOutputContent);
      if (inv.StandardErrorContent) console.error(inv.StandardErrorContent);
      console.log(`SSM status: ${inv.Status} · exit ${o.exitCode}`);
      process.exit(o.exitCode);
    }
  }
  console.error(`::error::انتهت مهلة انتظار الأمر ${commandId} على ${instanceId}`);
  process.exit(124);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
