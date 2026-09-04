#!/usr/bin/env node
// شريط تقدّمٍ مرئي لمراحل الأنبوب، يُكتب في ملخّص التشغيلة
// (`$GITHUB_STEP_SUMMARY`) فيظهر أعلى صفحة التشغيلة وفي تطبيق GitHub للجوال.
//
// يُعاد رسمه كاملًا عند كل حدّ مرحلة (الملف يُكتب لا يُلحق)، فيتقدّم الشريط أمام
// العين بدل أن يتراكم. واجهة الاستعمال:
//   node stage.mjs "البوابة,المرشّح,النشر,الدخان" "النشر" running
//
// قاعدة RTL: السهم في النص العربي يشير **يسارًا**، والترتيب يبقى كما كُتب —
// العربية تضع الأول يمينًا من نفسها.
import { appendFileSync, writeFileSync } from "node:fs";

const MARK = { done: "✅", running: "🔵", failed: "❌", pending: "⬜", skipped: "⏭️" };

export function render({ stages, current, state = "running", skipped = [], context = {} }) {
  const i = stages.indexOf(current);
  if (i === -1) throw new Error(`المرحلة «${current}» غير معروفة في هذا الأنبوب`);

  const cells = stages.map((name, j) => {
    if (skipped.includes(name)) return `${MARK.skipped} ~~${name}~~`;
    if (j < i) return `${MARK.done} ${name}`;
    if (j > i) return `${MARK.pending} ${name}`;
    if (state === "done") return `${MARK.done} ${name}`;
    if (state === "failed") return `${MARK.failed} **${name}**`;
    return `${MARK.running} **${name}**`;
  });

  const bits = [];
  if (context.environment) bits.push(`\`${context.environment}\``);
  if (context.sha) bits.push(`\`${String(context.sha).slice(0, 7)}\``);
  if (context.ref) bits.push(context.ref);

  const title = state === "failed" ? "توقّف الأنبوب" : state === "done" && i === stages.length - 1 ? "اكتمل الأنبوب" : "الأنبوب يعمل";
  return [
    `### ${title}${bits.length ? " — " + bits.join(" · ") : ""}`,
    "",
    cells.join(" ← "),
    "",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , stagesCsv, current, state = "running", skippedCsv = ""] = process.argv;
  if (!stagesCsv || !current) {
    console.error('usage: stage.mjs "<stages,csv>" <current> [running|done|failed] [skipped,csv]');
    process.exit(2);
  }
  const md = render({
    stages: stagesCsv.split(",").map((s) => s.trim()).filter(Boolean),
    current,
    state,
    skipped: skippedCsv.split(",").map((s) => s.trim()).filter(Boolean),
    context: {
      environment: process.env.PIPELINE_ENV,
      sha: process.env.PIPELINE_SHA,
      ref: process.env.PIPELINE_REF,
    },
  });
  const out = process.env.GITHUB_STEP_SUMMARY;
  if (out) writeFileSync(out, md);   // يُكتب لا يُلحق: الشريط يتقدّم ولا يتراكم
  console.log(md);
}
