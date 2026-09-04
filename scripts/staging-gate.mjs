#!/usr/bin/env node
// «لا يُنشر على الإنتاج ما لم يُجرَّب على بيئة الاختبار» — شرطٌ يُفحص لا عادةٌ تُنسى.
//
// الدليل وسمُ `staging-<sha7>` تضعه نشرةُ اختبارٍ **ناجحة**. وهو يقيس **رقم
// الالتزام** لا محتواه عمدًا: فيبقى التاريخ خطيًّا ويصير الدليل مقروءًا بالعين
// («الوسم 36ad1e9 والإنتاج 36ad1e9»). وثمنُه أن الدمج يجب أن يكون بالتقديم
// السريع — وهو ما يدفع إليه شرطُ «رأس main» أصلًا.
//
// والمنفذ `skip_staging` **فعلٌ مسجَّل**: يظهر في مُدخَلات التشغيلة وسجلّها،
// ولا يُعدّ إثباتًا — فالرحلة تبقى مرسومةً بيضاء عند تلك المرحلة.
import { journeyFor } from "./stage.mjs";

export function decideStagingGate({ environment, preset, tagFound, skipStaging }) {
  const hasStaging = journeyFor(preset).includes("بيئة الاختبار");
  if (environment !== "production" || !hasStaging) {
    return { allow: true, checked: false, proven: false, bypassed: false, message: "" };
  }
  if (tagFound) {
    return { allow: true, checked: true, proven: true, bypassed: false, message: "مرّ ببيئة الاختبار" };
  }
  if (skipStaging) {
    return {
      allow: true, checked: true, proven: false, bypassed: true,
      message: "تجاوزٌ صريح: يُنشر على الإنتاج ما لم يُجرَّب على بيئة الاختبار (skip_staging=true)",
    };
  }
  return {
    allow: false, checked: true, proven: false, bypassed: false,
    message:
      "هذا المرشّح لم يُنشر على بيئة الاختبار (لا وسم staging-<sha7>). " +
      "انشره بـenvironment=staging وجرّبه، أو مرّر skip_staging=true إن كان لا بدّ.",
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = decideStagingGate({
    environment: process.argv[2],
    preset: process.argv[3],
    tagFound: process.argv[4] === "true",
    skipStaging: process.argv[5] === "true",
  });
  if (r.message) console.log(r.allow ? (r.bypassed ? `::warning::${r.message}` : r.message) : `::error::${r.message}`);
  console.log(`PIPELINE_STAGING_PROVEN=${r.proven}`);
  process.exit(r.allow ? 0 : 1);
}
