import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCommands, outcomeOf } from "./ssm-run.mjs";

test("buildCommands: المتغيرات تُصدَّر مقتبسةً بأمان ثم أسطر السكربت كما هي", () => {
  const cmds = buildCommands("set -e\necho hi\n", { NOOQ_BUNDLE_ID: "abc", NOOQ_BUNDLE_URL: "https://x/y?a=1&b='q'" });
  assert.equal(cmds[0], "export NOOQ_BUNDLE_ID='abc'");
  assert.equal(cmds[1], "export NOOQ_BUNDLE_URL='https://x/y?a=1&b='\\''q'\\'''");
  assert.deepEqual(cmds.slice(2), ["set -e", "echo hi"]);
});

test("buildCommands: اسم متغير غير صالح يُرفض — لا حقن في سطر export", () => {
  assert.throws(() => buildCommands("true", { "X;rm -rf /": "1" }));
});

test("outcomeOf: الحالات غير النهائية تنتظر، والنهائية تنقل رمز الخروج كما هو", () => {
  assert.deepEqual(outcomeOf({ Status: "InProgress", ResponseCode: -1 }), { done: false, exitCode: null });
  assert.deepEqual(outcomeOf({ Status: "Pending", ResponseCode: -1 }), { done: false, exitCode: null });
  assert.deepEqual(outcomeOf({ Status: "Success", ResponseCode: 0 }), { done: true, exitCode: 0 });
  assert.deepEqual(outcomeOf({ Status: "Failed", ResponseCode: 6 }), { done: true, exitCode: 6 });
  assert.deepEqual(outcomeOf({ Status: "Failed", ResponseCode: 10 }), { done: true, exitCode: 10 });
});

test("outcomeOf: انتهاء المهلة والإلغاء رموز مميَّزة لا صفر ولا واحد عام", () => {
  assert.deepEqual(outcomeOf({ Status: "TimedOut", ResponseCode: -1 }), { done: true, exitCode: 124 });
  assert.deepEqual(outcomeOf({ Status: "Cancelled", ResponseCode: -1 }), { done: true, exitCode: 125 });
  assert.deepEqual(outcomeOf({ Status: "Failed", ResponseCode: -1 }), { done: true, exitCode: 1 });
  assert.deepEqual(outcomeOf({ Status: "DeliveryTimedOut", ResponseCode: -1 }), { done: true, exitCode: 124 });
});
