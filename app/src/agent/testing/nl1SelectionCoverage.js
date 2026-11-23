// NL-1 ACTION SELECTION COVERAGE — the capture and measurement shared by agentNl1SelectionCoverage.test.js (the shipped
// budget: every invariant and floor) and agentNl1SelectionCoverageLimit.test.js (the per-request limit, for comparison).
// Split 2026-11-23 (CI: the one file timed out at 300 s on a browser shard once heldout-v2 was exposed — ~37% more
// reroute selections); each file captures ONE budget, so vitest's shards can place them apart. Nothing here asserts.
//
// Every turn is captured exactly as the eval capture (testing/capture.js → buildNl1Request) builds it.
// ⛔ The SEALED sets are never opened here (filtered by split before any file is read).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SETS } from './sets'
import { captureCase, subsetsUpTo } from './capture'
import { NL1_MAX_NEED, nl1GroupOf as groupOfAction } from '../nl1/selection'
import { loadMeta, loadOptions, loadSaved, _resetScreenerCache } from '../capabilities/screener'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.resolve(HERE, '../__fixtures__/nlIntent')
export const OPEN = SETS.filter(s => s.split !== 'sealed')

/** The Screener's catalog, served from the fixture (a beforeAll; `vi` is the test file's). */
export async function loadScreenerFixture(vi) {
  const scr = JSON.parse(fs.readFileSync(path.join(DIR, 'screener-catalog.json'), 'utf8'))
  globalThis.fetch = vi.fn(async (url) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/screener/fields') return json({ fields: scr.fields })
    if (url === '/api/screener/fields?options=1') return json({ options: scr.options })
    if (url === '/api/screener/saved-screens') return json({ saved: [], starters: scr.starters })
    return json({})
  })
  _resetScreenerCache()
  await loadMeta(); await loadOptions(); await loadSaved({ force: true })
}

export const plansOf = (e) => [e?.ops, ...(e?.alt || [])].filter(p => Array.isArray(p) && p.length)

// WHICH reroutes are tabled per request. Every set of up to 3 unselected groups is C(n,1)+C(n,2)+C(n,3) reselects per
// request — cubic in the group count, and ~97% of this file's time (#1074 at 971a1f6606: 99.6 s locally, 2.4 s without the
// table; 344.6 s on CI vs the 300 s limit, after ONE words-only group was added). Tabled here: EVERY set of up to 2 groups
// (the whole-or-refused invariant below still covers all of them) plus every 3-group need that one of this turn's accepted
// plans actually asks for (the only 3-group entries measure() reads). Floors and coverage are unchanged; the whole-or-refused
// check HERE now covers every ≤2-group reroute and the 3-group needs an accepted plan asks for. A PARTIAL 3-group reroute is
// caught by agentNl1Selection.test.js ('a reroute carries every group the model asked for — or says it cannot; never part of
// them'), which must stay (AUDIT mutant, #1134: partial 3-group reroute survives this file, fails that rail). The eval export
// (agentNl1EvalCapture, tools/agent_eval_run.py) keeps the full table (captureCase's default).
// ⭐ 2026-11-23: still ~97% of the time (~370k reselects per budget once heldout-v2 was exposed). Each reselect now reads the
// request's words once (nl1/selection.js nl1WordsReader) and its group counts once: 0.144 → 0.046 ms per reselect locally,
// byte-identical (agentNl1SelectionMemo.test.js).
export function rerouteNeeds(s, expect) {
  const out = subsetsUpTo(s.unselected, 2)
  const seen = new Set(out.map(n => n.join('+')))
  for (const p of plansOf(expect)) {
    const need = [...new Set(p.map(o => groupOfAction(o.a)))].filter(g => s.unselected.includes(g)).sort()
    if (need.length > 2 && need.length <= NL1_MAX_NEED && !seen.has(need.join('+'))) { seen.add(need.join('+')); out.push(need) }
  }
  return out
}

/** Every dev / exposed turn at this budget: { rows, catalogs }. `isProtectedLayout`: the test file's protectedLayouts guard
 *  (passed in: only useAgent and tests may import it, agentProtectedLayouts.test.js). */
export function capture(budget, isProtectedLayout) {
  const spec = JSON.parse(fs.readFileSync(path.join(DIR, 'corpus.json'), 'utf8'))
  const catalogs = new Map()
  const rows = []
  for (const s of OPEN) {
    const data = JSON.parse(fs.readFileSync(path.join(DIR, s.file), 'utf8'))
    const expects = new Map()
    for (const c of data.cases) {
      if (Array.isArray(c.turns)) c.turns.forEach((t, i) => expects.set(`${c.id}#${i}`, t.expect))
      else expects.set(`${c.id}#0`, c.expect)
    }
    for (const c of data.cases) {
      for (const t of captureCase(spec, c, 'nl1', { isProtectedLayout, catalogs, budget, rerouteNeeds })) {
        rows.push({ ...t, set: s.file, expect: expects.get(`${c.id}#${t.turn}`) })
      }
    }
  }
  return { rows, catalogs }
}

/** First-call coverage per set: { [file]: { n, first, reroute, lost, sent } }. */
export function measure({ rows, catalogs }) {
  const bySet = {}
  for (const r of rows) {
    if (r.exact) continue
    const plans = plansOf(r.expect)
    if (!plans.length) continue
    const sent = new Set(r.body.capabilities.map(c => c.name))
    const b = (bySet[r.set] ||= { n: 0, first: 0, reroute: 0, lost: 0, sent: [] })
    b.n++
    b.sent.push(sent.size)
    if (plans.some(p => p.every(o => sent.has(o.a)))) { b.first++; continue }
    // the groups the model would have to ask for, for the closest accepted plan
    const full = new Set(catalogs.get(r.catalog).manifest.map(c => c.name))
    const reachable = plans.filter(p => p.every(o => full.has(o.a))).some(p => {
      const need = [...new Set(p.map(o => groupOfAction(o.a)))].filter(g => !r.selection.selected.includes(g)).sort()
      return need.length && r.reroutes[need.join('+')] != null
    })
    if (reachable) b.reroute++
    else b.lost++
  }
  return bySet
}

export const fmt = (bySet) => Object.entries(bySet).map(([f, b]) => {
  const s = [...b.sent].sort((x, y) => x - y)
  const pct = (x) => `${((100 * x) / b.n).toFixed(1)}%`
  return `  ${f.padEnd(16)} n ${String(b.n).padStart(3)}  first call ${String(b.first).padStart(3)} (${pct(b.first)})  +reroute ${String(b.reroute).padStart(2)} (→ ${pct(b.first + b.reroute)})  not reachable ${b.lost}  actions median ${s[s.length >> 1]} max ${s[s.length - 1]}`
}).join('\n')
