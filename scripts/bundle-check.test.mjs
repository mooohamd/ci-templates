import { test } from "node:test";
import assert from "node:assert/strict";
import { checkManifest } from "./bundle-check.mjs";

const full = "84f6d9e5215f8b862904f0d4cebeb67c6f3c8a42";
const manifest = (sha, state = "clean") => `bundle_backend_sha=${sha}\nbundle_backend_state=${state}\nbundle_backend_tree=abc\nbundle_created_at=2026-09-06T00:00:00Z\n`;

test("الحزمة للمرشّح نفسه ونظيفة: تمرّ", () => {
  assert.deepEqual(checkManifest(manifest(full), full), { ok: true, reason: "" });
});

test("SHA آخر أو مختصر أو متسخ: تُرفض بسببها", () => {
  assert.equal(checkManifest(manifest("0".repeat(40)), full).ok, false);
  assert.match(checkManifest(manifest(full.slice(0, 7)), full).reason, /كامل/);
  assert.match(checkManifest(manifest(full, "dirty"), full).reason, /dirty/);
});

test("بيان ناقص: يُرفض لا يُفترض", () => {
  assert.equal(checkManifest("bundle_created_at=x\n", full).ok, false);
  assert.equal(checkManifest("", full).ok, false);
});
