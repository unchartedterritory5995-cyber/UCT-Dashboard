// NL-1 ACTION SELECTION on the DEV and EXPOSED evaluation sets — free, local, no model call.
//
// Every turn is captured exactly as the eval capture (testing/capture.js → buildNl1Request) builds it, and
//   • the selection's invariants are held on EVERY request: at most 60 actions, the core whole and first
//     (`routing.stable`), whole groups only, nothing outside this member's available actions, and every
//     reroute either carries the groups it was asked for or is refused (never a partial one);
//   • FIRST-CALL COVERAGE is measured: the expected plan's actions are all in the request's actions
//     (any accepted alternative plan counts), and how many of the rest a reroute could still supply.
// This file is the SHIPPED budget (55): every invariant and floor. The same capture at the per-request limit (60), reported
// for comparison only, is agentNl1SelectionCoverageLimit.test.js (split 2026-11-23 so CI shards can place the two apart; the
// capture, reroute table and measurement are shared: testing/nl1SelectionCoverage.js).
// ⛔ The SEALED sets are never opened here (filtered by split before any file is read).
import { it, expect, vi, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { NL1_CORE_GROUPS, NL1_CORE_MAX, NL1_LIMIT, NL1_BUDGET } from './nl1/selection'
import { isProtected } from './protectedLayouts'
import { OPEN, loadScreenerFixture, capture, measure, fmt } from './testing/nl1SelectionCoverage'

registerBuiltins()

beforeAll(() => loadScreenerFixture(vi))

it('holds the selection invariants on every dev / exposed request, and reports first-call coverage', () => {
  const cap = capture(undefined, (e) => isProtected(e))
  const { rows, catalogs } = cap
  expect(rows.length).toBeGreaterThan(300)
  for (const r of rows) {
    const full = catalogs.get(r.catalog)
    expect(full, r.key).toBeTruthy()
    const names = r.body.capabilities.map(c => c.name)
    const avail = new Set(full.manifest.map(c => c.name))
    expect(names.length, r.key).toBeLessThanOrEqual(NL1_LIMIT)
    expect(names.every(n => avail.has(n)), r.key).toBe(true)                          // nothing unavailable
    expect(new Set(names).size, r.key).toBe(names.length)
    const group = (n) => full.groupOf[n]
    const core = full.manifest.filter(c => r.selection.core.includes(group(c.name))).map(c => c.name)
    expect(core.length, r.key).toBeLessThanOrEqual(NL1_CORE_MAX)
    expect(r.selection.core.every(g => NL1_CORE_GROUPS.includes(g)), r.key).toBe(true)
    if (r.body.routing) {
      expect(names.slice(0, r.body.routing.stable), r.key).toEqual(core)               // the core, whole, first
      for (const g of r.body.routing.selected) {                                        // whole groups only
        expect(full.manifest.filter(c => group(c.name) === g).every(c => names.includes(c.name)), `${r.key} ${g}`).toBe(true)
      }
      expect(names.every(n => r.body.routing.selected.includes(group(n))), r.key).toBe(true)
    } else {
      expect(names, r.key).toEqual(full.manifest.map(c => c.name))                     // unrouted = the whole catalog
    }
    for (const [key, rr] of Object.entries(r.reroutes)) {                               // a reroute: all it asked, or refused
      if (rr) expect(key.split('+').every(g => rr.selected.includes(g)), `${r.key} ${key}`).toBe(true)
    }
  }
  // every dev / exposed set is measured (the split never drops one)
  expect([...new Set(rows.map(r => r.set))].sort()).toEqual(OPEN.map(s => s.file).sort())
  const at55 = measure(cap)
  console.log(`\nNL-1 selection coverage (dev / exposed only; budget ${NL1_BUDGET} shipped; ${NL1_LIMIT}: agentNl1SelectionCoverageLimit)\n` +
    `budget ${NL1_BUDGET}:\n${fmt(at55)}\n`)
  // regression floors (measured 2026-10-20: 97.5–100% first call, 100% with one reroute, on these sets)
  // ⭐ heldout-v2 was SEALED (never measured here) until it was marked exposed 2026-11-22 (Gate C). Its first
  // measurement is 140/150 (93.3%) at budget 55, the same with or without the two expectations amended that day; the
  // floor is that measurement, a ratchet (may only rise), and the gap below 95% is an open routing finding.
  // ⭐ RATCHETED 2026-11-23 (first-call routing, agentFirstCallRouting.test.js): the ten misses were seven routing classes
  // (member names as vocabulary, navigation verbs, "what %", one stock's yearly high, keep-and-add, board things vs lists,
  // follow-ups that name nothing) — fixed by class, measured 150/150 at budget 55. The floor is that measurement.
  const FIRST_CALL_FLOOR = { 'heldout-v2.json': 150 / 150 }
  for (const [f, b] of Object.entries(at55)) {
    expect(b.lost, `${f}: a request whose actions no reroute can supply`).toBe(0)
    expect(b.first / b.n, `${f}: first-call coverage`).toBeGreaterThanOrEqual(FIRST_CALL_FLOOR[f] ?? 0.95)
  }
}, 300000)
