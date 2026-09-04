import { test } from "node:test";
import assert from "node:assert/strict";
import { journeyFor, journeyState, renderJourney } from "./stage.mjs";

// الرحلة تخصّ القالب: رسمُ «بيئة اختبار» لمشروعٍ لا بيئة له كذبٌ بصري.
test("القالب البسيط رحلته خطوتان", () => {
  assert.deepEqual(journeyFor("simple"), ["البوابة", "الإنتاج"]);
});

test("القياسي كذلك — لا بيئة اختبار له", () => {
  assert.deepEqual(journeyFor("standard"), ["البوابة", "الإنتاج"]);
});

test("الكامل وحده فيه بيئة اختبار وتجربةٌ بشرية", () => {
  assert.deepEqual(journeyFor("full"), ["البوابة", "بيئة الاختبار", "تجربتك", "الإنتاج"]);
});

test("قالبٌ مجهول خطأٌ صريح لا رسمٌ مخترَع", () => {
  assert.throws(() => journeyFor("whatever"), /قالب/);
});

test("نشرةُ الاختبار: البوابة تمّت والاختبار جارٍ وما بعده ينتظر", () => {
  const s = journeyState({ preset: "full", environment: "staging" });
  assert.equal(s.current, "بيئة الاختبار");
  assert.deepEqual(s.done, ["البوابة"]);
});

// الدليل لا الافتراض: بلا وسمِ staging لا يُرسم الاختبار ناجحًا.
test("نشرةُ الإنتاج بلا دليل زيارةٍ للاختبار: المرحلتان تبقيان بيضاوين", () => {
  const s = journeyState({ preset: "full", environment: "production", stagingProven: false });
  assert.equal(s.current, "الإنتاج");
  assert.deepEqual(s.done, ["البوابة"]);
  assert.equal(s.warning, true);
});

test("نشرةُ الإنتاج بدليلٍ: الاختبار والتجربة تمّا", () => {
  const s = journeyState({ preset: "full", environment: "production", stagingProven: true });
  assert.deepEqual(s.done, ["البوابة", "بيئة الاختبار", "تجربتك"]);
  assert.equal(s.warning, false);
});

test("القالب القياسي لا يسأل عن دليلٍ أصلًا", () => {
  const s = journeyState({ preset: "standard", environment: "production", stagingProven: false });
  assert.deepEqual(s.done, ["البوابة"]);
  assert.equal(s.current, "الإنتاج");
  assert.equal(s.warning, false, "لا تحذير من بيئةٍ ليست في رحلته");
});

test("الرسم سطران: الرحلة فوق وخطوات التشغيلة تحتها", () => {
  const md = renderJourney({
    preset: "full", environment: "staging",
    stages: ["المرشّح", "النشر"], current: "النشر", state: "running",
    context: { sha: "490143f4", ref: "release-pipeline" },
  });
  const [head] = md.split("\n").filter((l) => l.includes("←"));
  assert.match(head, /✅ البوابة ← 🔵 \*\*بيئة الاختبار\*\* ← ⬜ تجربتك ← ⬜ الإنتاج/);
  assert.match(md, /المرشّح/);
  assert.match(md, /490143f/);
});

test("التحذير يظهر نصًّا حين يُنشر الإنتاج بلا مرور بالاختبار", () => {
  const md = renderJourney({
    preset: "full", environment: "production", stagingProven: false,
    stages: ["المرشّح"], current: "المرشّح", state: "running",
  });
  assert.match(md, /لم يمرّ|لم تُنشر/);
});
