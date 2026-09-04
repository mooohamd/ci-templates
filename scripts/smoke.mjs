#!/usr/bin/env node
// المرحلة 5 — التحقّق بعد النشر.
//
// «التطبيق يجيب» لا يثبت **أي نسخةٍ** تجيب: قد يردّ إصدارٌ سابق أو ردٌّ مخزَّن.
// فالفحص يطالب المسار بأن يعيد الـSHA المبنيّ فيه، ويطابقه بالمرشّح.
//   node smoke.mjs <baseUrl> <path> <expectedSha> [attempts]
import { setTimeout as sleep } from "node:timers/promises";

const [, , baseUrl, path = "/api/version", expected, attemptsArg = "10"] = process.argv;
if (!baseUrl || !expected) {
  console.error("usage: smoke.mjs <baseUrl> <path> <expectedSha> [attempts]");
  process.exit(2);
}
const attempts = Number(attemptsArg) || 10;
const short = (s) => String(s).slice(0, 7);

for (let i = 1; i <= attempts; i++) {
  const url = `${baseUrl.replace(/\/$/, "")}${path}?_=${Date.now()}`;
  try {
    const res = await fetch(url, { cache: "no-store", headers: { "cache-control": "no-cache" } });
    const text = await res.text();
    let sha = null;
    try {
      const j = JSON.parse(text);
      sha = j.sha || j.commit || j.version || null;
    } catch {
      sha = text.trim();
    }
    if (res.ok && sha && (sha === expected || short(sha) === short(expected))) {
      console.log(`✓ الحيّ يخدم المرشّح ${short(expected)} (محاولة ${i})`);
      process.exit(0);
    }
    console.log(`محاولة ${i}/${attempts}: HTTP ${res.status}، الـSHA المخدوم=${sha ? short(sha) : "غائب"}، المنتظر=${short(expected)}`);
  } catch (e) {
    console.log(`محاولة ${i}/${attempts}: ${e.message}`);
  }
  if (i < attempts) await sleep(3000);
}
console.error(`::error::فحص الدخان فشل — الحيّ لا يخدم ${short(expected)} بعد ${attempts} محاولات.`);
process.exit(1);
