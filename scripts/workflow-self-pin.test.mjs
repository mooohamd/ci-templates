import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// كل قالبٍ يسحب سكربتاته من نسخته هو لا من رأس main: `github.job_workflow_sha` ليست خاصيةً في سياق github فتصير فارغة،
// فيسحب actions/checkout الفرعَ الافتراضي — ثبت حيًّا في تشغيلة نوق 38934994311 («Determining the default branch ← main»)
// (مانع Codex على البند 6). الصحيح سياق job: `job.workflow_sha` و`job.workflow_repository` لسير العمل المُعاد استخدامه.
const dir = new URL("../.github/workflows/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".yml"));

test("لا قالب يستعمل github.job_workflow_sha (خاصيةٌ غير موجودة تصير ref فارغًا ← الفرع الافتراضي)", () => {
  for (const f of files) {
    assert.ok(!readFileSync(new URL(f, dir), "utf8").includes("github.job_workflow_sha"), f);
  }
});

test("سحب سكربتات القالب لنفسه: من مستودعه ونسخته بالسياق job — ولا سحبَ بلا ref", () => {
  let seen = 0;
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), "utf8");
    for (const step of src.split(/^\s*-\s/m)) {
      if (!/path:\s*\.ci-templates\b/.test(step)) continue;
      seen += 1;
      assert.match(step, /repository:\s*\$\{\{\s*job\.workflow_repository\s*\}\}/, `${f}: المستودع من job.workflow_repository`);
      assert.match(step, /ref:\s*\$\{\{\s*job\.workflow_sha\s*\}\}/, `${f}: النسخة من job.workflow_sha`);
    }
  }
  assert.equal(seen, 3, "القوالب الثلاثة تسحب سكربتاتها");
});
