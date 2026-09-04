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

// ── الرحلة: أين هذا التغيير من طريقه إلى الإنتاج ──
//
// الرحلة تخصّ **القالب**، لا التشغيلة: رسمُ «بيئة اختبار» لمشروعٍ لا بيئة له
// كذبٌ بصري. و`full` وحده فيه بيئةٌ وتجربةٌ بشرية.
const JOURNEYS = {
  simple: ["البوابة", "الإنتاج"],
  standard: ["البوابة", "الإنتاج"],
  full: ["البوابة", "بيئة الاختبار", "تجربتك", "الإنتاج"],
};

export function journeyFor(preset) {
  const j = JOURNEYS[preset];
  if (!j) throw new Error(`قالب «${preset}» غير معروف — لا رحلة تُرسم له`);
  return j;
}

// الدليل لا الافتراض: مرور الاختبار يُثبت بوسم `staging-<sha>` تضعه نشرةُ
// اختبارٍ ناجحة. بلا الوسم تبقى المرحلة بيضاء — لا تُرسم ناجحةً لم تقع.
export function journeyState({ preset, environment, stagingProven = false }) {
  const stages = journeyFor(preset);
  if (environment === "staging") {
    return { stages, current: "بيئة الاختبار", done: ["البوابة"], warning: false };
  }
  const hasStaging = stages.includes("بيئة الاختبار");
  const done = hasStaging && stagingProven
    ? ["البوابة", "بيئة الاختبار", "تجربتك"]
    : ["البوابة"];
  return { stages, current: "الإنتاج", done, warning: hasStaging && !stagingProven };
}

export function renderJourney({ preset, environment, stagingProven = false, stages, current, state = "running", skipped = [], context = {} }) {
  const j = journeyState({ preset, environment, stagingProven });
  const line = j.stages
    .map((name) => {
      if (j.done.includes(name)) return `${MARK.done} ${name}`;
      if (name === j.current) return state === "failed" ? `${MARK.failed} **${name}**` : `${MARK.running} **${name}**`;
      return `${MARK.pending} ${name}`;
    })
    .join(" ← ");

  const run = render({ stages, current, state, skipped, context });
  const out = [run.split("\n")[0], "", line, ""];
  if (j.warning) {
    out.push("> لم يمرّ هذا الـSHA ببيئة الاختبار (لا وسم `staging-<sha>`) — الإنتاج ينشر تغييرًا لم يُجرَّب بشريًّا.", "");
  }
  out.push(run.split("\n").slice(2).join("\n"));
  return out.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , stagesCsv, current, state = "running", skippedCsv = ""] = process.argv;
  if (!stagesCsv || !current) {
    console.error('usage: stage.mjs "<stages,csv>" <current> [running|done|failed] [skipped,csv]');
    process.exit(2);
  }
  const args = {
    stages: stagesCsv.split(",").map((s) => s.trim()).filter(Boolean),
    current,
    state,
    skipped: skippedCsv.split(",").map((s) => s.trim()).filter(Boolean),
    context: {
      environment: process.env.PIPELINE_ENV,
      sha: process.env.PIPELINE_SHA,
      ref: process.env.PIPELINE_REF,
    },
  };
  // القالب هو ما يقرّر الرحلة المرسومة؛ بلا قالبٍ يُرسم شريط التشغيلة وحده.
  const md = process.env.PIPELINE_PRESET
    ? renderJourney({
        ...args,
        preset: process.env.PIPELINE_PRESET,
        environment: process.env.PIPELINE_ENV,
        stagingProven: process.env.PIPELINE_STAGING_PROVEN === "true",
      })
    : render(args);
  const out = process.env.GITHUB_STEP_SUMMARY;
  if (out) writeFileSync(out, md);   // يُكتب لا يُلحق: الشريط يتقدّم ولا يتراكم
  console.log(md);
}
