import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "gate-"));
const SCRIPT = new URL("./assert-no-skips.mjs", import.meta.url).pathname;

const report = (results) => ({
  stats: { expected: results.filter((r) => r === "passed").length, skipped: results.filter((r) => r === "skipped").length },
  suites: [{ title: "s", specs: results.map((status, i) => ({ title: `t${i}`, tests: [{ results: [{ status }] }] })), suites: [] }],
});

function run(obj, max = "0") {
  const p = join(dir, `r${Math.random()}.json`);
  writeFileSync(p, JSON.stringify(obj));
  try {
    return { code: 0, out: execFileSync("node", [SCRIPT, p, max], { encoding: "utf8" }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
}

test("حزمةٌ نظيفة تمرّ", () => {
  const r = run(report(["passed", "passed"]));
  assert.equal(r.code, 0);
});

test("اختبارٌ واحد متخطٍّ يُفشل البوابة", () => {
  const r = run(report(["passed", "skipped"]));
  assert.equal(r.code, 1);
  assert.match(r.out, /تُخطّي وقت التشغيل/);
  assert.match(r.out, /t1/, "يسمّي الاختبار المتخطّى");
});

test("صفر اختبارات = فشل ولو لم يُتخطَّ شيء", () => {
  const r = run(report([]));
  assert.equal(r.code, 1);
  assert.match(r.out, /صفر اختبارات/);
});

test("كل الحزمة متخطّاة (غياب سرّ) لا تمرّ خضراء", () => {
  const r = run(report(["skipped", "skipped", "skipped"]));
  assert.equal(r.code, 1);
});

test("السقف يُحترم متى رُفع صراحةً", () => {
  assert.equal(run(report(["passed", "skipped"]), "1").code, 0);
  assert.equal(run(report(["passed", "skipped", "skipped"]), "1").code, 1);
});

test("الحزم المتداخلة تُعدّ أيضًا", () => {
  const nested = { stats: {}, suites: [{ title: "a", specs: [], suites: [{ title: "b", specs: [{ title: "deep", tests: [{ results: [{ status: "skipped" }] }] }], suites: [] }] }] };
  const r = run(nested);
  assert.equal(r.code, 1);
  assert.match(r.out, /a › b › deep/);
});

test("تقريرٌ غائب أو تالف يفشل مغلقًا — لا يُعدّ نجاحًا", () => {
  let out = "";
  try { execFileSync("node", [SCRIPT, join(dir, "nope.json"), "0"], { encoding: "utf8" }); assert.fail("مرّ"); }
  catch (e) { out = (e.stdout || "") + (e.stderr || ""); assert.equal(e.status, 1); }
  assert.match(out, /يفشل مغلقة|تعذّر قراءة/);
});
