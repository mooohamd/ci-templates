#!/usr/bin/env node
// المرحلة 5 — التحقّق بعد النشر.
//
// «التطبيق يجيب» لا يثبت **أي نسخةٍ** تجيب: قد يردّ إصدارٌ سابق أو ردٌّ مخزَّن.
// فالفحص يطالب المسار بأن يعيد الـSHA المبنيّ فيه، ويطابقه بالمرشّح.
//   node smoke.mjs <baseUrl> <path> <expectedSha> [attempts]
import { setTimeout as sleep } from "node:timers/promises";

const [, , baseUrl, path = "/api/version", expected, attemptsArg = "10"] = process.argv;
if ((!baseUrl || !expected) && import.meta.url === `file://${process.argv[1]}`) {
  console.error("usage: smoke.mjs <baseUrl> <path> <expectedSha> [attempts]");
  process.exit(2);
}
const attempts = Number(attemptsArg) || 10;
const short = (s) => String(s).slice(0, 7);

// المطابقة مساواةً تامة حين يعيد الحيّ الـSHA كاملًا؛ والبادئةُ تُقبل فقط حين يعيد
// اختصارًا (7 فأكثر) — لا تُقصّ 40 محرفًا إلى 7 فتتساوى نسختان تشتركان في البادئة.
export function matchesCandidate(served, expected) {
  const s = String(served ?? "").trim();
  const e = String(expected ?? "").trim();
  if (!s || !e) return false;
  if (s === e) return true;
  const isFull = (x) => /^[0-9a-f]{40}$/i.test(x);
  if (isFull(s)) return false;
  if (!/^[0-9a-f]{7,39}$/i.test(s)) return false;
  return e.toLowerCase().startsWith(s.toLowerCase());
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) for (let i = 1; i <= attempts; i++) {
  const url = `${baseUrl.replace(/\/$/, "")}${path}?_=${Date.now()}`;
  try {
    const res = await fetch(url, { cache: "no-store", headers: { "cache-control": "no-cache" } });
    const text = await res.text();
    let sha = null;
    try {
      const j = JSON.parse(text);
      sha = j.sha || j.commit || j.version || null;
    } catch {
      // ردٌّ غير JSON: غالبًا صفحة حماية النشر (Vercel Deployment Protection)
      // على رابط النشرة المخصوص — تُجيب 200 وتُعيد HTML.
      if (/^\s*<(!doctype|html)/i.test(text)) {
        console.log(`محاولة ${i}/${attempts}: HTTP ${res.status} وردٌّ HTML لا JSON — غالبًا صفحة حماية النشر. افحص الألياس لا رابط النشرة.`);
        if (i < attempts) await sleep(3000);
        continue;
      }
      sha = text.trim();
    }
    if (res.ok && sha && matchesCandidate(sha, expected)) {
      console.log(`✓ الحيّ يخدم المرشّح ${short(expected)} (محاولة ${i})`);
      process.exit(0);
    }
    console.log(`محاولة ${i}/${attempts}: HTTP ${res.status}، الـSHA المخدوم=${sha ? short(sha) : "غائب"}، المنتظر=${short(expected)}`);
  } catch (e) {
    console.log(`محاولة ${i}/${attempts}: ${e.message}`);
  }
  if (i < attempts) await sleep(3000);
}
if (isMain) {
  console.error(`::error::فحص الدخان فشل — الحيّ لا يخدم ${short(expected)} بعد ${attempts} محاولات.`);
  process.exit(1);
}
