// app/src/components/chart/engine/__tests__/vendorHarness/cap3Signature.js
//
// CAP3 (2026-10-03, step 81) — one function that names WHAT a graded capture says,
// so a rail can pin a divergence by name (item, first bar, kind, count) rather than by
// a bare verdict. The expectations file `cap3-spy-gap-verdicts.json` is written by
// `cap3SpyGaps.measure.test.js` through THIS function and read back by
// `vendorHarness.coverageAudit.test.js` through THIS function, so the writer and the
// reader cannot drift. Nothing here adjusts a capture or a grade.

/** The grade of one capture, reduced to the facts a rail pins. */
export function cap3Signature(v) {
  const plots = (v.plots || []).map((p) => {
    if (p.verdict === 'MATCH') return [p.title, 'MATCH', p.stats && p.stats.compared]
    if (p.verdict === 'DIVERGE') {
      const s = (p.stats && p.stats.steady) || {}
      const f = s.first || {}
      return [p.title, 'DIVERGE', f.bar ?? null, f.kind ?? null, s.divergent ?? null, (s.pattern && s.pattern.kind) || null]
    }
    return [p.title, p.verdict, String(p.reason || '').slice(0, 80)]
  })
  const o = v.objects || null
  const objects = o
    ? [o.verdict, (o.counts || []).filter((c) => !c.agree).map((c) => [c.family, c.vendor, c.ours])]
    : null
  const paints = v.paints ? v.paints.verdict : null
  return { verdict: v.verdict, reason: v.verdict === 'INCONCLUSIVE' && !(v.plots || []).length ? String(v.reason || '').slice(0, 80) : null, plots, objects, paints }
}
