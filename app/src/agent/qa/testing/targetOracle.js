// ⛔ TARGET ORACLE (AUDIT safety, 2026-11-17) — an INDEPENDENT reading of which existing object a member's words pick out, for
// agentStateRail.targetCoverage.test.js. It must NEVER import or call stateRail / chartRail (or any Agent reader): its whole
// model is the small, explicit rule below, so a rail bug cannot hide behind the same bug in its referee.
//
//   1. Each candidate is a set of nameable FACETS: { dim: value | [values] } — type, name / label, symbol, indicator, length,
//      list name, tab kind … (whatever the kind's fixture gives it).
//   2. A LEXICON says which phrases name which facet values: { dim, phrase, values }. A phrase may name several values ("line" →
//      horizontal + trendline); longer phrases are read first and consume their words ("horizontal line" is not also "line").
//      Decoys (a MACD on a chart that has none, a "Value" layout that does not exist) are lexicon entries no candidate holds.
//   3. A dimension the words leave unsaid may take a DEFAULT (the active chart's symbol) — reported, so a finding that rests on
//      the default is told apart.
//   4. A candidate is CONSISTENT when, for every dimension the words name, it holds one of the values named.
//   5. Nothing said → none. Exactly one consistent → that one. None → none. Several → ambiguous.
const norm = (s) => ` ${String(s || '').toLowerCase().replace(/[“”"’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `
const valuesOf = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]).map(x => String(x).toLowerCase())

/** → { result: 'pick' | 'none' | 'ambiguous', id?, said, defaulted } */
export function oracle(words, candidates, lexicon, defaults = {}) {
  let text = norm(words)
  const said = {}
  for (const entry of [...lexicon].sort((a, b) => norm(b.phrase).length - norm(a.phrase).length)) {
    const p = norm(entry.phrase)
    if (p.trim() === '') continue
    if (!text.includes(p)) continue
    while (text.includes(p)) text = text.replace(p, ' | ')
    said[entry.dim] = [...new Set([...(said[entry.dim] || []), ...valuesOf(entry.values)])]
  }
  const defaulted = []
  for (const [dim, v] of Object.entries(defaults)) if (!said[dim]) { said[dim] = valuesOf(v); defaulted.push(dim) }
  const named = Object.keys(said).filter(d => !defaulted.includes(d))
  if (!named.length) return { result: 'none', said, defaulted }
  const ok = candidates.filter(c => Object.entries(said).every(([dim, vals]) => valuesOf(c.facets[dim]).some(v => vals.includes(v))))
  if (ok.length === 1) return { result: 'pick', id: ok[0].id, said, defaulted }
  return { result: ok.length ? 'ambiguous' : 'none', said, defaulted, ids: ok.map(c => c.id) }
}
