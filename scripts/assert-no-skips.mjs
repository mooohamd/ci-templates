#!/usr/bin/env node
// القاعدة 5 — «لا فحصَ متخطّى» داخل Playwright نفسه.
//
// Playwright يعدّ التخطّي نتيجةً متوقَّعة، فحزمةٌ تتخطّى كل اختباراتها لغياب سرّ
// تخرج بصفر — بوابةٌ خضراء لم تختبر شيئًا. هذا السكربت يقرأ تقرير JSON ويفشل عند:
//   (1) صفر اختبارات نُفِّذت،
//   (2) أي اختبارٍ تُخطّي وقت التشغيل فوق السقف المسموح (الصفر هو العقد).
//
// الاستثناء **الساكن** مشروع: يُعبَّر عنه بـ`testIgnore` أو مشروعٍ في الإعدادات،
// لا بـ`test.skip` وقت التشغيل — فذاك لا يُرى في العدّ ولا يُخفي حزمةً معطَّلة.
import { readFileSync } from "node:fs";

const [, , reportPath = "pw-report.json", maxSkippedArg = "0"] = process.argv;
const maxSkipped = Number(maxSkippedArg) || 0;

let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (e) {
  console.error(`::error::تعذّر قراءة تقرير Playwright (${reportPath}): ${e.message}`);
  console.error("::error::البوابة تفشل مغلقة — تقريرٌ غائب ليس نجاحًا.");
  process.exit(1);
}

const skipped = [];
let executed = 0;

const walk = (suite, trail = []) => {
  const here = [...trail, suite.title].filter(Boolean);
  for (const spec of suite.specs || []) {
    for (const test of spec.tests || []) {
      for (const result of test.results || []) {
        if (result.status === "skipped") skipped.push([...here, spec.title].join(" › "));
        else executed++;
      }
    }
  }
  for (const child of suite.suites || []) walk(child, here);
};
for (const suite of report.suites || []) walk(suite);

const stats = report.stats || {};
console.log(
  `نُفِّذ ${executed} · متخطّى ${skipped.length} · ` +
    `(تقرير: expected=${stats.expected ?? "?"} unexpected=${stats.unexpected ?? "?"} skipped=${stats.skipped ?? "?"})`
);

let failed = false;
if (executed === 0) {
  console.error("::error::صفر اختبارات نُفِّذت — حزمةٌ لم تختبر شيئًا لا تمرّ.");
  failed = true;
}
if (skipped.length > maxSkipped) {
  console.error(`::error::${skipped.length} اختبارًا تُخطّي وقت التشغيل (المسموح ${maxSkipped}):`);
  for (const name of skipped.slice(0, 20)) console.error(`::error::  تخطٍّ: ${name}`);
  if (skipped.length > 20) console.error(`::error::  … و${skipped.length - 20} غيرها`);
  console.error("::error::الاستثناء الساكن يُعبَّر عنه بـtestIgnore أو مشروعٍ في الإعدادات، لا بتخطٍّ وقت التشغيل.");
  failed = true;
}
process.exit(failed ? 1 : 0);
