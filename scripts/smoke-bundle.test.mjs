import { test } from "node:test";
import assert from "node:assert/strict";
import { judge } from "./smoke-bundle.mjs";

const full = "84f6d9e5215f8b862904f0d4cebeb67c6f3c8a42";

test("استجابة واحدة تحمل SHA الكامل مساواةً تامة وstate=clean: تمرّ", () => {
  assert.deepEqual(judge(200, JSON.stringify({ sha: full, state: "clean", env: "staging" }), full), { ok: true, reason: "" });
});

test("SHA مختصر أو مختلف أو dirty أو بلا حالة: تُرفض بسببها — لا بادئة هنا", () => {
  assert.match(judge(200, JSON.stringify({ sha: full.slice(0, 7), state: "clean" }), full).reason, /كامل|مختصر/);
  assert.match(judge(200, JSON.stringify({ sha: "0".repeat(40), state: "clean" }), full).reason, /المرشّح/);
  assert.match(judge(200, JSON.stringify({ sha: full, state: "dirty" }), full).reason, /dirty/);
  assert.match(judge(200, JSON.stringify({ sha: full }), full).reason, /state/);
});

test("ردٌّ غير JSON أو غير 200: يُرفض", () => {
  assert.equal(judge(200, "<!doctype html>", full).ok, false);
  assert.equal(judge(502, JSON.stringify({ sha: full, state: "clean" }), full).ok, false);
});
