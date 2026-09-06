import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesCandidate } from "./smoke.mjs";

const full = "84f6d9e5215f8b862904f0d4cebeb67c6f3c8a42";
const other = "84f6d9e0000000000000000000000000deadbeef"; // البادئة نفسها، نسخة أخرى

test("الحيّ يعيد SHA كاملًا: مساواة تامة لا بادئة", () => {
  assert.equal(matchesCandidate(full, full), true);
  assert.equal(matchesCandidate(other, full), false);
  assert.equal(matchesCandidate(full.toUpperCase(), full), false);
});

test("الحيّ يعيد اختصارًا (7 فأكثر): يُقبل بادئةً للمرشّح — وأقصر من 7 يُرفض", () => {
  assert.equal(matchesCandidate("84f6d9e", full), true);
  assert.equal(matchesCandidate("84f6d9e5215f", full), true);
  assert.equal(matchesCandidate("84f6d9e", other), true);
  assert.equal(matchesCandidate("84f6d9", full), false);
  assert.equal(matchesCandidate("84f6d9f", full), false);
});

test("الفارغ والغائب لا يطابقان شيئًا", () => {
  assert.equal(matchesCandidate(null, full), false);
  assert.equal(matchesCandidate("", full), false);
  assert.equal(matchesCandidate(full, ""), false);
});
