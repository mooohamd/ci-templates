// المرحلة 5 تحتاج مسارًا يقول **أي نسخةٍ تخدم الآن** — «التطبيق يجيب» لا تكفي.
// ضعه في المشروع: src/app/api/version/route.ts (Next.js App Router).
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { sha: process.env.BUILD_SHA || process.env.NEXT_PUBLIC_BUILD_SHA || null },
    { headers: { "cache-control": "no-store, max-age=0" } }
  );
}
