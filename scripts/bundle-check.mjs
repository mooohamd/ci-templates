#!/usr/bin/env node
// الحزمة التي ستُنشر هي المرشّح نفسه — لا افتراض: بيان الحزمة يحمل SHA الخادم **كاملًا** ونظيفًا
// ويطابق candidate_sha، وهوية الحزمة بصمتها (sha256) تُطبع لتُمرَّر إلى الجهاز.
//   node bundle-check.mjs <bundle.tgz> <candidateSha>   ⇒ stdout: BUNDLE_ID=<sha256>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function checkManifest(text, candidate) {
  const get = (k) => {
    const m = new RegExp(`^${k}=(.*)$`, "m").exec(String(text ?? ""));
    return m ? m[1].trim() : "";
  };
  const sha = get("bundle_backend_sha");
  const state = get("bundle_backend_state");
  if (!sha) return { ok: false, reason: "البيان بلا bundle_backend_sha" };
  if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, reason: `SHA البيان ليس كاملًا (40 محرفًا): ${sha}` };
  if (sha !== String(candidate).toLowerCase()) return { ok: false, reason: `الحزمة لغير المرشّح: ${sha} ≠ ${candidate}` };
  if (state !== "clean") return { ok: false, reason: `حالة الحزمة ${state || "غائبة"} — لا يُنشر إلا clean (لا dirty)` };
  return { ok: true, reason: "" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , file, candidate] = process.argv;
  if (!file || !candidate) { console.error("usage: bundle-check.mjs <bundle.tgz> <candidateSha>"); process.exit(2); }
  const id = createHash("sha256").update(readFileSync(file)).digest("hex");
  const manifest = execFileSync("tar", ["-xzOf", file, "./manifest.txt"], { encoding: "utf8" });
  const r = checkManifest(manifest, candidate);
  if (!r.ok) { console.error(`::error::${r.reason}`); process.exit(1); }
  console.log(`BUNDLE_ID=${id}`);
}
