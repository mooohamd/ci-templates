#!/usr/bin/env node
// دخان ناشر الحزم — استجابةٌ واحدة يجب أن تحمل الـSHA **كاملًا مساواةً تامة** وstate=clean معًا:
// لا بادئة (نسختان تشتركان فيها) ولا طلبٌ ثانٍ للحالة (قد يأتي من نسخةٍ أخرى أثناء التبديل).
//   node smoke-bundle.mjs <baseUrl> <path> <expectedSha> [attempts]
import { setTimeout as sleep } from "node:timers/promises";

export function judge(status, text, expected) {
  if (status !== 200) return { ok: false, reason: `HTTP ${status}` };
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return { ok: false, reason: /^\s*<(!doctype|html)/i.test(String(text)) ? "ردٌّ HTML لا JSON — افحص الألياس لا رابطًا محميًّا" : "ردٌّ غير JSON" };
  }
  const sha = String(j?.sha ?? "");
  const e = String(expected ?? "");
  if (!/^[0-9a-f]{40}$/.test(e)) return { ok: false, reason: "المرشّح ليس SHA كاملًا" };
  if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, reason: `الحيّ يعلن SHA مختصرًا أو غائبًا (${sha || "—"}) — يلزم كاملًا` };
  if (sha !== e) return { ok: false, reason: `الحيّ يخدم ${sha.slice(0, 7)} لا المرشّح ${e.slice(0, 7)}` };
  if (j.state !== "clean") return { ok: false, reason: `الحيّ يعلن state=${j.state ?? "غائب"} لا clean` };
  return { ok: true, reason: "" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , baseUrl, path = "/v1/version", expected, attemptsArg = "20"] = process.argv;
  if (!baseUrl || !expected) {
    console.error("usage: smoke-bundle.mjs <baseUrl> <path> <expectedSha> [attempts]");
    process.exit(2);
  }
  const attempts = Number(attemptsArg) || 20;
  let last = "";
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}?_=${Date.now()}`, { cache: "no-store", headers: { "cache-control": "no-cache" } });
      const r = judge(res.status, await res.text(), expected);
      if (r.ok) {
        console.log(`✓ الألياس يخدم المرشّح ${expected.slice(0, 7)} كاملًا ونظيفًا (محاولة ${i})`);
        process.exit(0);
      }
      last = r.reason;
    } catch (e) {
      last = e.message;
    }
    console.log(`محاولة ${i}/${attempts}: ${last}`);
    if (i < attempts) await sleep(3000);
  }
  console.error(`::error::فحص الدخان فشل — ${last}`);
  process.exit(1);
}
