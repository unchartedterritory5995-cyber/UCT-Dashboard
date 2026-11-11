// CAPABILITY REGRESSION · ROUTE REACHABILITY — every registered action stays reachable through the REAL routing.
//
// Routing sends the model whole capability GROUPS under the per-request budget (manifest.contract.json routingThreshold).
// When a group grows, the packing can silently push ANOTHER group out of the request: the action is still registered,
// still in the catalog, and simply never shown to the model for the phrasings that need it. Nothing else catches that —
// the held-out sets only sample. This rail measures EVERY registered action (production kinds):
//
//   phrasings  each action's own phrasings: the corpus intents (needs, model ops, `before` steps), the golden workflows'
//              steps, the open NL eval sets (dev / exposed; the sealed sets are never read), and baseline/reachPhrasings.json
//              for the actions none of those phrase. An action with NO phrasing fails rail 1.
//   reached    at least one phrasing's routed request (testing/route.js, the call useAgent makes) carries the action after
//              the budget cut — under routing v2 (production's router) and under v1 (the kill-switch fallback).
//
// UNREACHABLE is FROZEN at master's known cases (below, by name, with the cause): SHRINK-ONLY like the other ratchets. An
// action leaving the list is allowed (remove it); a NEW unreachable action fails, named, with its group and whether the
// budget cut it. Deterministic (no model call).
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { registerCatalog, PROD_KINDS, isDark } from './testing/registry'
import { corpus, golden, phrasingsOf } from './testing/corpus'
import { routedNames } from './testing/route'
import { panelHost } from './testing/harness'
import { pinClock } from './testing/clock'
import { groupOfAction, warnBudgetCut, _resetBudgetCutLog } from '../../routing'
import { SETS } from '../../testing/sets'
import extra from './baseline/reachPhrasings.json'

pinClock()

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const NL_DIR = path.resolve(HERE, '..', '..', '__fixtures__', 'nlIntent')

// ── master's known unreachable actions (2026-11-11, budget 55). SHRINK-ONLY: never add a name here to make this pass —
//    fix the routing (or record an owner decision in the PR that adds it).
export const UNREACHABLE = {
  v2: {
    'guide.explain': 'FAST PATH: "what is rsi" is answered locally by the fast path (guide.explain runs without the model); the routed request never carries the guide group',
  },
  v1: {
    'widget.readOptions': 'NOT SELECTED: v1 has no words for boardEdit in "how is that one set right now" (workspace + agent only)',
    'guide.explain': 'FAST PATH: as v2',
    'drawing.add': 'NOT SELECTED (v1 only): "draw an arrow from … to …" routes drawings, not drawingTools; v2 reaches it',
    // first measured by this rail (their phrasings are in baseline/reachPhrasings.json); v2 reaches every one
    'calendar.nextReport': 'NOT SELECTED (v1 only): "when does nvda report earnings" on the Calendar page routes data, not calendar',
    'definition.duplicate': 'NOT SELECTED (v1 only): "create a custom copy of the rsi indicator" routes the indicator groups, not definitions',
    'journal.createNote': 'NOT SELECTED (v1 only): v1 has no words for the coach/journal group, so on the Journal page only the agent group is sent',
    'journal.listNotes': 'NOT SELECTED (v1 only): as journal.createNote',
    'stock.themes': 'NOT SELECTED (v1 only): "which themes are leading this week" routes charts (chart themes), not data',
    'widget.setOption': 'NOT SELECTED (v1 only): a widget the board does not hold is not named, and v1 has no words for boardEdit',
  },
}

const opsOf = (m) => (m?.ops || []).map(o => o.action)
/** Every (action, phrasing) the data gives: [{ action, text, board, surface, recent, src }]. */
export function reachPhrasings() {
  const rows = []
  const add = (action, text, o) => { if (action && text) rows.push({ action, text, board: 'ONE', surface: 'charts', recent: [], ...o }) }
  for (const i of corpus.intents.filter(x => !isDark(x))) {
    const acts = new Set([...(i.needs || []), ...opsOf(i.model)])
    for (const ph of phrasingsOf(i)) for (const a of acts) add(a, ph.text, { board: i.board || 'ONE', recent: i.recentActions || [], src: `corpus ${i.id}` })
    for (const s of i.before || []) for (const a of opsOf(s.model)) add(a, s.say, { board: i.board || 'ONE', src: `corpus ${i.id} (before)` })
  }
  for (const w of golden.workflows.filter(x => !isDark(x))) {
    let prev = []
    for (const s of w.steps) {
      const acts = [...opsOf(s.model), ...(s.routes || [])]
      for (const a of acts) add(a, s.say, { board: w.board || 'ONE', recent: prev, src: `golden ${w.id}` })
      if (acts.length) prev = acts
    }
  }
  for (const s of SETS.filter(x => x.split !== 'sealed')) {          // ⛔ the sealed sets are never opened
    const data = JSON.parse(fs.readFileSync(path.join(NL_DIR, s.file), 'utf8'))
    for (const c of data.cases) {
      const turns = Array.isArray(c.turns) ? c.turns.map(t => ({ text: t.say, expect: t.expect })) : [{ text: c.text, expect: c.expect }]
      for (const t of turns) {
        const acts = new Set([t.expect?.ops, ...(t.expect?.alt || [])].filter(Array.isArray).flat().map(o => o.a))
        for (const a of acts) add(a, t.text, { board: null, src: `nl ${s.file} ${c.id}` })
      }
    }
  }
  for (const [a, list] of Object.entries(extra.phrasings)) for (const p of list) add(a, p.text, { board: p.board || 'ONE', surface: p.surface || 'charts', src: 'reachPhrasings.json' })
  return rows
}

/** Per action: { phrasings, reached: {v1, v2}, cut: {v1:Set, v2:Set} (groups the budget cut on its phrasings) }. */
export function measureReach(names) {
  const hosts = new Map()
  const hostOf = (b) => { if (!b) return null; if (!hosts.has(b)) hosts.set(b, panelHost(b)); return hosts.get(b) }
  const out = Object.fromEntries(names.map(n => [n, { phrasings: 0, reached: { v1: false, v2: false }, cut: { v1: new Set(), v2: new Set() } }]))
  for (const r of reachPhrasings()) {
    const e = out[r.action]
    if (!e) continue
    e.phrasings++
    for (const v of ['v1', 'v2']) {
      if (e.reached[v]) continue
      const res = routedNames(r.text, { host: hostOf(r.board), recentActions: r.recent, v2: v === 'v2', surface: r.surface })
      if (res.names.includes(r.action)) e.reached[v] = true
      else res.overBudget.forEach(g => e.cut[v].add(g))
    }
  }
  return out
}

/** The failure line for an unreachable action. */
export const why = (n, e, v) => `${n} [${groupOfAction(n)}] ${e.cut[v].has(groupOfAction(n)) ? 'CUT BY THE BUDGET' : 'group not selected'}`

const catalog = await registerCatalog(PROD_KINDS)
const reach = measureReach(catalog.all)

describe('route reachability (every registered action, production kinds)', () => {
  it('measures the whole catalog', () => {
    expect(catalog.all.length).toBeGreaterThan(150)
  })
  it('every registered action has at least one phrasing (corpus, golden, open NL sets or baseline/reachPhrasings.json)', () => {
    const none = catalog.all.filter(n => !reach[n].phrasings)
    expect(none, `actions with NO phrasing (add one to baseline/reachPhrasings.json): ${none.join(', ')}`).toEqual([])
  })
  it('every reachPhrasings.json entry names a registered action', () => {
    const stale = Object.keys(extra.phrasings).filter(n => !catalog.all.includes(n))
    expect(stale, `reachPhrasings.json names unregistered actions: ${stale.join(', ')}`).toEqual([])
  })
  for (const v of ['v2', 'v1']) {
    it(`routing ${v}: every action is reachable after the budget cut, except master's frozen known cases (shrink-only)`, () => {
      const unreachable = catalog.all.filter(n => reach[n].phrasings && !reach[n].reached[v])
      const fresh = unreachable.filter(n => !UNREACHABLE[v][n])
      expect(fresh.map(n => why(n, reach[n], v)), `routing ${v}: NEW unreachable actions (no phrasing of theirs is routed with them)`).toEqual([])
      const fixed = Object.keys(UNREACHABLE[v]).filter(n => !unreachable.includes(n))
      // shrink-only: a known case that is reachable now is allowed — say so, so its line is removed
      if (fixed.length) console.info(`[route reachability] ${v}: reachable now, remove from UNREACHABLE.${v}: ${fixed.join(', ')}`)
    })
  }
})

/** The v2 budget-cut rate over every DISTINCT phrasing (text, board, surface, recent): how much pressure the budget is under. */
export function cutRate() {
  const seen = new Set()
  const hosts = new Map()
  const hostOf = (b) => { if (!b) return null; if (!hosts.has(b)) hosts.set(b, panelHost(b)); return hosts.get(b) }
  const groups = {}
  let n = 0, cut = 0
  for (const r of reachPhrasings()) {
    const key = JSON.stringify([r.text, r.board, r.surface, r.recent])
    if (seen.has(key)) continue
    seen.add(key)
    n++
    const res = routedNames(r.text, { host: hostOf(r.board), recentActions: r.recent, v2: true, surface: r.surface })
    if (res.overBudget.length) cut++
    for (const g of res.overBudget) groups[g] = (groups[g] || 0) + 1
  }
  return { n, cut, groups: Object.entries(groups).sort((a, b) => b[1] - a[1]) }
}

describe('the budget-cut log (routing.js warnBudgetCut)', () => {
  const M = [{ name: 'a.one' }, { name: 'a.two' }, { name: 'b.one' }]
  const gOf = (n) => n.split('.')[0]
  it('warns once per distinct set of cut groups (order-free), names the actions, and never for a group with no actions here', () => {
    _resetBudgetCutLog()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnBudgetCut(M, gOf, ['b', 'a'])
    warnBudgetCut(M, gOf, ['a', 'b'])                 // the same set: no second line
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('a.one, a.two, b.one')
    warnBudgetCut(M, gOf, ['a'])                      // a different set: a second line
    expect(warn).toHaveBeenCalledTimes(2)
    warnBudgetCut(M, gOf, ['zzz'])                    // nothing of it in this manifest: silent
    warnBudgetCut(M, gOf, [])
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
  it('through the real v2 routing: two identical cut routings → one warn, a different cut set → a second; the selection is unchanged', () => {
    _resetBudgetCutLog()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = panelHost('ONE')
    const first = routedNames('how is that one set right now', { host, v2: true })
    const again = routedNames('how is that one set right now', { host, v2: true })
    expect(first.overBudget.length).toBeGreaterThan(0)
    expect(again.names).toEqual(first.names)
    expect(again.overBudget).toEqual(first.overBudget)
    expect(warn).toHaveBeenCalledTimes(1)
    const other = routedNames('set the theme tracker widget to the 1 week period', { host, v2: true })
    expect([...other.overBudget].sort()).not.toEqual([...first.overBudget].sort())
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
  it('reports the v2 budget-cut rate over the corpus phrasings', () => {
    const r = cutRate()
    expect(r.n).toBeGreaterThan(500)
    console.info(`[route reachability] v2 budget cut on ${r.cut}/${r.n} distinct phrasings (${((100 * r.cut) / r.n).toFixed(1)}%); groups cut: ${r.groups.map(([g, k]) => `${g} ${k}`).join(', ')}`)
  })
})
