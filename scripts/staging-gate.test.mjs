import { test } from "node:test";
import assert from "node:assert/strict";
import { decideStagingGate } from "./staging-gate.mjs";

const d = (o) => decideStagingGate({ environment: "production", preset: "full", tagFound: false, skipStaging: false, ...o });

test("الإنتاج بلا وسم اختبارٍ يُرفض", () => {
  const r = d({});
  assert.equal(r.allow, false);
  assert.equal(r.proven, false);
  assert.match(r.message, /لم يُنشر على بيئة الاختبار/);
});

test("الإنتاج بوسمٍ يمضي ومُثبَتًا", () => {
  const r = d({ tagFound: true });
  assert.equal(r.allow, true);
  assert.equal(r.proven, true);
});

// المنفذ فعلٌ مسجَّل لا سهو: يمرّ، لكنه لا يُعلَن مُثبَتًا ولا يُرسم أخضر.
test("التجاوز الصريح يمرّ ولا يُعدّ إثباتًا", () => {
  const r = d({ skipStaging: true });
  assert.equal(r.allow, true);
  assert.equal(r.proven, false);
  assert.equal(r.bypassed, true);
  assert.match(r.message, /تجاوز/);
});

test("وسمٌ موجود يُلغي أثر التجاوز — لا حاجة إليه", () => {
  const r = d({ tagFound: true, skipStaging: true });
  assert.equal(r.proven, true);
  assert.equal(r.bypassed, false);
});

test("نشرةُ الاختبار نفسها لا تُسأل عن وسم", () => {
  const r = d({ environment: "staging" });
  assert.equal(r.allow, true);
  assert.equal(r.checked, false);
});

test("قالبٌ بلا بيئة اختبار لا يُسأل أصلًا", () => {
  for (const preset of ["simple", "standard"]) {
    const r = d({ preset });
    assert.equal(r.allow, true, preset);
    assert.equal(r.checked, false, preset);
  }
});

test("قالبٌ مجهول يفشل مغلقًا لا يمرّ صامتًا", () => {
  assert.throws(() => d({ preset: "whatever" }), /قالب/);
});
