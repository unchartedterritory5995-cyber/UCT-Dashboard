// ⭐ TARGET DECLARATIONS — Phase 3 MEASUREMENT harness (shadow only; AUDIT condition 7).
//
// For every case { id, words, host, ops, path, expectRefusal, source } it plans the ops with the REAL planner, makes the
// declaration (strict, and with the one-chart `sole` reading apart: an open AUDIT question), validates, and aggregates per kind:
// matches, mismatches (listed with the case id and why), open — and the gate: a case whose plan PASSES today (the corpus expects
// no refusal) that the validator would refuse if its kind were enforced. Nothing here changes behaviour or calls a model.
import { getCapability, buildContext } from '../../capabilities'
import { resolveOps } from '../capabilityRegression/testing/harness'
import { planOps, collectTargets } from '../../executor'
import { declareTargets, validateDeclaration, refusesUnder, TD_KINDS } from '../../targetDecl'

const kindsOf = (ops) => [...new Set((ops || []).map(o => getCapability(o?.action)?.target).filter(Boolean))]

/** A corpus op's symbolic targets ("$charts[0]", "$board", "$ctx:…") → real refs, as the panel resolves them: the request context
 *  the panel would send (capabilities.buildContext), the capreg harness's own resolver, then the context's short-ref map. */
export function resolveCorpusOps(host, ops, words = '') {
  const { context, refMap } = buildContext(host, { surface: 'charts', message: words })
  const real = (v) => (typeof v === 'string' && refMap[v] ? refMap[v].ref : v)
  return resolveOps(ops || [], { context }).map(o => ({ ...o, target: real(o.target) }))
}
/** (fallback) a symbolic target → the i-th live target of that kind. */
export function resolveCorpusTarget(host, t) {
  const m = /^\$([A-Za-z]+)(?:\[(\d+)\]|\{[A-Za-z]+\})?$/.exec(String(t || ''))
  if (!m) return t
  const kind = m[1] === 'charts' ? 'chart' : m[1]
  let refs = []
  try { refs = [...collectTargets(host, [kind]).keys()] } catch { refs = [] }
  return refs[Number(m[2] || 0)] ?? `missing:${t}`
}

/** → { status: 'planned' | 'unplanned', result?, sole?, decl? } for one case. */
export function measureCase({ words, host, ops, subject = null, created = [] }) {
  let resolved
  try { resolved = resolveCorpusOps(host, ops, words) } catch { resolved = (ops || []).map(o => ({ ...o, target: resolveCorpusTarget(host, o.target) })) }
  let plan
  if (!resolved.some(o => getCapability(o?.action) && !getCapability(o.action).query)) return { status: 'unplanned', why: 'query or unknown action' }
  try { plan = planOps(collectTargets(host, kindsOf(resolved)), resolved, { mcGroups: [] }, { surface: 'charts' }) } catch { return { status: 'unplanned', why: 'planner threw' } }
  if (!plan?.ok) return { status: 'unplanned', why: `planner refused: ${String(plan?.refusals?.[0]?.reason || '').slice(0, 48)} [${(ops || []).map(o => String(o.target).replace(/\[\d+\]$/, '')).join(',')}]` }
  const decl = declareTargets({ words, host, subject, created })
  const solo = declareTargets({ words, host, subject, created, opts: { sole: true } })
  return { status: 'planned', decl, result: validateDeclaration(plan, decl, { host, words }), sole: validateDeclaration(plan, solo, { host, words }) }
}

const ENFORCE_EACH = TD_KINDS.map(k => [k, new Set([k])])

/** Aggregate many measured cases. `variant`: 'result' (strict) | 'sole'. */
export function aggregate(rows, variant = 'result') {
  const kinds = Object.fromEntries(TD_KINDS.map(k => [k, { match: 0, mismatch: 0, open: 0, newRefusals: 0 }]))
  const byPath = {}
  const mismatches = []
  const newRefusals = []
  let planned = 0
  const unplanned = {}
  for (const row of rows) {
    if (row.m.status !== 'planned') { const k = String(row.m.why || 'unknown').replace(/“[^”]*”/g, '“…”'); unplanned[k] = (unplanned[k] || 0) + 1; continue }
    planned++
    const r = row.m[variant]
    const p = (byPath[row.path] = byPath[row.path] || { cases: 0, open: 0, mismatch: 0 })
    p.cases++
    if (r.verdict === 'open') p.open++
    if (r.verdict === 'mismatch') p.mismatch++
    for (const k of TD_KINDS) for (const v of ['match', 'mismatch', 'open']) kinds[k][v] += r.kinds[k][v]
    for (const mm of r.mismatches) mismatches.push({ id: row.id, source: row.source, path: row.path, kind: mm.kind, why: mm.why })
    if (!row.expectRefusal) {
      for (const [k, set] of ENFORCE_EACH) {
        if (refusesUnder(r, set)) { kinds[k].newRefusals++; newRefusals.push({ id: row.id, source: row.source, path: row.path, kind: k }) }
      }
    }
  }
  return { cases: rows.length, planned, unplanned, kinds, byPath, mismatches, newRefusals }
}

/** A plain-text report (case ids, kinds and reasons only: the corpus phrasing ids, never live member data). */
export function report(agg, title) {
  const lines = [`${title}: ${agg.cases} cases, ${agg.planned} planned`, `  unplanned: ${JSON.stringify(agg.unplanned)}`]
  for (const [k, c] of Object.entries(agg.kinds)) lines.push(`  ${k.padEnd(10)} match ${String(c.match).padStart(4)} · mismatch ${String(c.mismatch).padStart(4)} · open ${String(c.open).padStart(4)} · would newly refuse if enforced ${c.newRefusals}`)
  for (const [p, c] of Object.entries(agg.byPath)) lines.push(`  path ${p.padEnd(8)} cases ${c.cases} · open ${c.open} (${c.cases ? Math.round(100 * c.open / c.cases) : 0}%) · mismatch ${c.mismatch}`)
  const why = {}
  for (const m of agg.mismatches) why[`${m.kind}/${m.why}`] = (why[`${m.kind}/${m.why}`] || 0) + 1
  lines.push(`  mismatch reasons: ${JSON.stringify(why)}`)
  for (const m of agg.mismatches.slice(0, 60)) lines.push(`    ✗ ${m.source}:${m.id} [${m.path}] ${m.kind} ${m.why}`)
  return lines.join('\n')
}
