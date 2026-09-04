import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "./stage.mjs";

const S = ["البوابة", "المرشّح", "النشر", "الدخان"];

test("المرحلة الجارية تُبرَز، وما قبلها تمّ وما بعدها ينتظر", () => {
  const md = render({ stages: S, current: "النشر", state: "running" });
  assert.match(md, /✅ البوابة/);
  assert.match(md, /✅ المرشّح/);
  assert.match(md, /🔵 \*\*النشر\*\*/);
  assert.match(md, /⬜ الدخان/);
});

// قاعدة RTL: السهم يشير يسارًا في النص العربي، والترتيب يبقى كما كُتب.
test("الأسهم تشير يسارًا ولا يرد سهمٌ يمينيّ", () => {
  const md = render({ stages: S, current: "البوابة", state: "running" });
  assert.ok(md.includes("←"), "لا سهم يساريّ");
  assert.ok(!md.includes("→"), "ورد سهمٌ يمينيّ في نصٍّ عربي");
  assert.ok(md.indexOf("البوابة") < md.indexOf("الدخان"), "الترتيب يبقى كما كُتب");
});

test("الفشل يوسم مرحلته وحدها، وما بعدها يبقى منتظِرًا لا ناجحًا", () => {
  const md = render({ stages: S, current: "الدخان", state: "failed" });
  assert.match(md, /❌ \*\*الدخان\*\*/);
  assert.match(md, /✅ النشر/);
  assert.ok(!md.includes("✅ الدخان"));
});

test("آخر مرحلةٍ ناجحة تُنهي الشريط كله", () => {
  const md = render({ stages: S, current: "الدخان", state: "done" });
  assert.match(md, /✅ الدخان/);
  assert.ok(!md.includes("🔵"), "لا مرحلة جارية بعد الاكتمال");
});

test("سطر السياق يحمل البيئة والـSHA والفرع", () => {
  const md = render({ stages: S, current: "البوابة", state: "running",
    context: { environment: "staging", sha: "490143f4dbd1b57e", ref: "release-pipeline" } });
  assert.match(md, /staging/);
  assert.match(md, /490143f/, "الـSHA مختصرًا");
  assert.ok(!md.includes("490143f4dbd1b57e"), "لا يُطبع الـSHA كاملًا في الشريط");
  assert.match(md, /release-pipeline/);
});

test("مرحلةٌ خارج القائمة خطأٌ صريح لا شريطٌ صامت", () => {
  assert.throws(() => render({ stages: S, current: "لا شيء", state: "running" }), /غير معروفة/);
});

test("مرحلةٌ تُتخطّى (هجرة none) تُعلَن متخطّاة لا ناجحة", () => {
  const md = render({ stages: ["البوابة", "الهجرة", "النشر"], current: "النشر",
    state: "running", skipped: ["الهجرة"] });
  assert.match(md, /⏭️ ~~الهجرة~~/);
  assert.ok(!md.includes("✅ الهجرة"));
});
