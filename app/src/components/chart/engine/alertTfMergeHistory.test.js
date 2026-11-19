// app/src/components/chart/engine/alertTfMergeHistory.test.js
//
// ─── ⭐⭐ ALERT TF_MERGE (coordinator ruling 2026-11-19, option A) — AN ALERT ON A MERGED WEEKLY / MONTHLY VALUE
//     READ THROUGH x[k], k >= 1 ───────────────────────────────────────────────────────────────────────────────────────
//
// Since #1996 the chart draws `request.security(sym, "W", close)[1]` on the newest bar (the bar before's merge is
// settled), while the alert lane refused every plot holding a `tf_merge` anywhere. The alert lane now admits a plot
// when EVERY merge it reads is reached only through a literal history offset k >= 1 that no setting moves, with no
// other request, no forward-reaching call and no moved offset on the way or inside the merge
// (`evaluability.js::mergeNewestUnproven`, twin `alert_user_series.merge_newest_unproven`). Everything else keeps
// `withheld` / `request:htf-newest-unconfirmed`, sentence unchanged.
//
// THE SHARED FIXTURE `tests/fixtures/ast/alert_tf_merge_history.json` is WRITTEN here (ALERT_TF_MERGE_HISTORY_WRITE=1)
// and READ by both lanes:
//   - the PARITY rail: every case's alert answer (status, gate, codes) — this file asks `evaluability(…, 'alert')`,
//     `tests/test_alert_tf_merge_history.py` asks the server (`_gate_lane` + `plot_admissions`); one lane narrowed
//     and not the other is red on that lane;
//   - the VALUE rail: for every ADMITTED shape, the chart's served column (`computeFor`, a finished daily newest bar
//     inside its week, and a Friday) is recorded bar for bar, and the Python file holds the alert lane's column
//     (`fn.column`, on the store's YYYYMMDD bars) equal to it, newest bar included and finite there: an alert never
//     fires on a value the chart withholds, and never misses one the chart draws.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from './nativeRegistry'
import { evaluability, LANES, mergeNewestUnproven, treeReadsTfMerge } from './evaluability'
import { TF_MERGE_NEWEST_CODE } from './ast/interpret'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'

const FIXTURE = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'ast', 'alert_tf_merge_history.json')

const CLOSE = { type: 'series', name: 'close' }
const OPEN = { type: 'series', name: 'open' }
const HIGH = { type: 'series', name: 'high' }
const num = (value) => ({ type: 'num', value })
const merge = (code = 'W', arg = CLOSE) => ({ type: 'tf_merge', value: code, args: [arg] })
const off = (k, a) => ({ type: 'offset', value: k, args: [a] })
const call = (name, ...args) => ({ type: 'call', name, args })
const op = (name, ...args) => ({ type: 'op', name, args })
const X = () => merge('W')

/** The Pine door's own tree for a one-plot script (the member pane, as a member's chart builds it). */
function pineTree(body) {
  const pane = memberPaneDefinition({ source: `//@version=5\nindicator("p")\n${body}`, id: 'u_0000tfm00000', name: 'p' })
  const def = pane && pane.definition
  if (!def || !def.compute || def.compute.kind !== 'ast') throw new Error(`not a host-lane document: ${body}`)
  return def.compute.trees ? def.compute.trees[def.plots[0].key] : def.compute.ast
}

// ⭐ THE SHAPES AND THE RULING'S ANSWER FOR EACH, written by hand: `admit` is what the coordinator ruled, never
// what a lane computed. `extra` is merged into the document's `compute` (the parameter manifest case).
const SHAPES = [
  // admitted
  { name: 'x[1] (k = 1)', admit: true, tree: () => off(1, X()) },
  { name: 'x[2] (k = 2)', admit: true, tree: () => off(2, X()) },
  { name: 'sma(x[1], 3) - close (a computed expression over x[1])', admit: true,
    tree: () => op('-', call('sma', off(1, X()), num(3)), CLOSE) },
  { name: "close > tf_merge(high, 'M')[1] (a condition over last month's high)", admit: true,
    tree: () => op('>', CLOSE, off(1, merge('M', HIGH))) },
  { name: 'na(x[1]) ? x[2] : x[1] (a conditional whose every arm reads through an offset)', admit: true,
    tree: () => op('?:', call('na', off(1, X())), off(2, X()), off(1, X())) },
  { name: 'the Pine door: request.security(syminfo.tickerid, "W", close)[1]', admit: true,
    tree: () => pineTree('plot(request.security(syminfo.tickerid, "W", close)[1])') },
  // refused, by the same code and sentence as before
  { name: 'x (a direct read)', admit: false, tree: () => X() },
  { name: 'x[0]', admit: false, tree: () => off(0, X()) },
  { name: "sym('SPY', x)[1] (a merge under another symbol)", admit: false,
    tree: () => off(1, { type: 'sym', value: 'SPY', args: [X()] }) },
  { name: "tf_merge(tf_merge(close, 'M'), 'W')[1] (a merge under another merge)", admit: false,
    tree: () => off(1, merge('W', merge('M'))) },
  { name: "tf(x, 'M')[1] (a merge under another request)", admit: false,
    tree: () => off(1, { type: 'tf', value: 'M', args: [X()] }) },
  { name: "tf_merge(sym('SPY', close), 'W')[1] (another request inside the merge)", admit: false,
    tree: () => off(1, merge('W', { type: 'sym', value: 'SPY', args: [CLOSE] })) },
  { name: 'na(x) ? x[1] : x (a mixed conditional)', admit: false,
    tree: () => op('?:', call('na', X()), off(1, X()), X()) },
  { name: 'x[1] + x (one path reads x)', admit: false, tree: () => op('+', off(1, X()), X()) },
  { name: 'barsAgo(x, 1, 5) (a dynamic offset, spelled with a literal)', admit: false,
    tree: () => call('barsAgo', X(), num(1), num(5)) },
  { name: 'barsAgo(x, mod(close, 2) + 1, 5) (an unprovable dynamic offset)', admit: false,
    tree: () => call('barsAgo', X(), op('+', call('mod', CLOSE, num(2)), num(1)), num(5)) },
  { name: 'x[len] (an offset a parameter setting moves)', admit: false, tree: () => off(1, X()),
    extra: { paramManifest: { __uct_param_1001: { sourceName: 'len', title: 'Back', type: 'int', default: 1,
      min: null, max: null, step: null, options: null, locators: [{ treeIndex: null, astPath: ['value'] }] } } } },
  { name: 'pivothigh(x, 2, 2)[2] (a forward-reaching call: it reads x on the newest bar)', admit: false,
    tree: () => off(2, call('pivothigh', X(), num(2), num(2))) },
  { name: 'the Pine door: request.security(syminfo.tickerid, "W", close[1]) (the offset is inside the merge)',
    admit: false, tree: () => pineTree('plot(request.security(syminfo.tickerid, "W", close[1]))') },
  // controls: a plot that reads no merge is not this rule's
  { name: 'CONTROL close > open (no merge)', admit: true, tree: () => op('>', CLOSE, OPEN) },
  { name: 'CONTROL pivothigh(close, 2, 2)[1] (no merge: the forward check never fires alone)', admit: true,
    tree: () => off(1, call('pivothigh', CLOSE, num(2), num(2))) },
]

const definitionOf = (shape, i) => {
  const id = `u_0000tfm${String(i + 1).padStart(5, '0')}`
  return { id, name: id, version: 1, plots: [{ key: 'value', style: 'line' }],
    compute: { kind: 'ast', fn: id, source: shape.name, ast: shape.tree(), ...(shape.extra || {}) },
    meta: { recurrenceOrigin: 'pine' } }
}

/** Weekdays from `start` to `end` (ISO), NYSE holidays in the span left out. */
function weekdays(start, end, holidays = []) {
  const out = []
  for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10)
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !holidays.includes(iso)) out.push(iso)
  }
  return out
}
// ⭐ Both start on a WEDNESDAY, so the first week is partial on the chart (a daily chart off the listing) and on
// the alert lane (no timeframe) alike: the two withhold the same early bars, and the rail compares every bar.
const DAYS = {
  tuesday: weekdays('2026-09-02', '2026-11-17', ['2026-09-07']),   // finished, inside its week: the hard case
  friday: weekdays('2026-09-02', '2026-11-13', ['2026-09-07']),    // closes its week
}
const barsOn = (days) => days.map((t, i) => ({ t, o: i + 0.5, h: i + 1.5, l: i, c: i + 1, v: 100 + i }))
const CHART = { tf: 'D', newestBarIsForming: false }
const served = (def, days) => Array.from(registry.computeFor(def, barsOn(days), {}, CHART).value || [])
  .map((v) => (Number.isFinite(v) ? v : null))

const expectOf = (shape) => (shape.admit
  ? { status: 'supported', gate: null, codes: [] }
  : { status: 'refused', gate: 'withheld', codes: [TF_MERGE_NEWEST_CODE] })

function build() {
  const cases = SHAPES.map((shape, i) => {
    const definition = definitionOf(shape, i)
    const out = { name: shape.name, definition, plotKey: 'value', expect: expectOf(shape) }
    if (shape.admit && treeReadsTfMerge(definition.compute.ast)) {
      out.served = Object.fromEntries(Object.entries(DAYS).map(([k, days]) => [k, served(definition, days)]))
    }
    return out
  })
  return {
    _about: 'ALERT TF_MERGE (coordinator ruling 2026-11-19, option A). WRITTEN by '
      + 'app/src/components/chart/engine/alertTfMergeHistory.test.js (ALERT_TF_MERGE_HISTORY_WRITE=1), READ by it and '
      + 'by tests/test_alert_tf_merge_history.py. `expect`: the alert lane\'s answer for the plot, the ruling\'s, held '
      + 'by evaluability.js (alert) and by alert_user_series (_gate_lane + plot_admissions). `served`: for an admitted '
      + 'shape that reads a merge, the chart\'s column (computeFor, tf D, newest bar finished) on `days` (ISO keys; '
      + 'bar i: o = i + 0.5, h = i + 1.5, l = i, c = i + 1, v = 100 + i); the alert lane\'s column on the same bars '
      + 'keyed YYYYMMDD must equal it bar for bar, newest included.',
    chart: CHART,
    days: DAYS,
    cases,
  }
}

const TEXT = `${JSON.stringify(build(), null, 1)}\n`
if (process.env.ALERT_TF_MERGE_HISTORY_WRITE === '1') fs.writeFileSync(FIXTURE, TEXT)
const COMMITTED = fs.existsSync(FIXTURE) ? fs.readFileSync(FIXTURE, 'utf8') : ''

describe('the fixture both lanes read', () => {
  it('⭐ regenerates byte for byte (ALERT_TF_MERGE_HISTORY_WRITE=1 rewrites it)', () => {
    expect(COMMITTED).toBe(TEXT)
  })
})

// ⛔ the committed file, never this run's regeneration: a drift is red above, and every rail below reads what the
// Python lane reads
const FIX = JSON.parse(COMMITTED || '{"cases": []}')

describe('the PARITY rail: the browser preflight answers every case as the ruling (the server half: the Python file)', () => {
  for (const c of FIX.cases) {
    it(`${c.name}: ${c.expect.status}`, () => {
      const g = evaluability(c.definition, c.plotKey, LANES.ALERT)
      expect({ status: g.status, gate: g.gate || null, codes: g.codes || [] }).toEqual(c.expect)
      expect(g.authority).toBe('server')
    })
  }
  it('is not vacuous: both answers, at least six of each, and every refusal is the one code', () => {
    const st = FIX.cases.map((c) => c.expect.status)
    expect(st.filter((s) => s === 'supported').length).toBeGreaterThanOrEqual(6)
    expect(st.filter((s) => s === 'refused').length).toBeGreaterThanOrEqual(6)
    for (const c of FIX.cases.filter((x) => x.expect.status === 'refused')) expect(c.expect.codes).toEqual([TF_MERGE_NEWEST_CODE])
  })
})

describe('the VALUE rail, chart half: what the chart serves for each admitted shape', () => {
  const admitted = FIX.cases.filter((c) => c.served)
  it('every admitted shape that reads a merge carries a served column on both bar sets', () => {
    expect(admitted.length).toBe(SHAPES.filter((s) => s.admit && !s.name.startsWith('CONTROL')).length)
    for (const c of admitted) for (const k of Object.keys(DAYS)) expect(c.served[k], `${c.name} ${k}`).toHaveLength(DAYS[k].length)
  })
  for (const c of admitted) {
    it(`${c.name}: drawn on the newest bar of both sets`, () => {
      for (const k of Object.keys(DAYS)) expect(c.served[k][DAYS[k].length - 1], k).not.toBe(null)
    })
  }
  it('CONTROL: the Tuesday set is the hard case: the chart withholds x, and pivothigh(x, 2, 2)[2], on its newest bar', () => {
    const n = DAYS.tuesday.length
    const x = FIX.cases.find((c) => c.name.startsWith('x (a direct read)'))
    const piv = FIX.cases.find((c) => c.name.startsWith('pivothigh(x, 2, 2)[2]'))
    expect(served(x.definition, DAYS.tuesday)[n - 1]).toBe(null)
    expect(served(x.definition, DAYS.tuesday)[n - 2]).not.toBe(null)
    // ⛔ the shape a bare "k >= 1" rule would admit: an offset of 2 over a window that reads 2 bars ahead
    expect(served(piv.definition, DAYS.tuesday)[n - 1]).toBe(null)
    // and on the Friday the week closed: the chart draws x itself (the alert lane, with no timeframe, still refuses it)
    expect(served(x.definition, DAYS.friday)[DAYS.friday.length - 1]).not.toBe(null)
  })
})

describe('the rule itself', () => {
  it('reads the tree, never bars: the same answer for every case whatever is asked twice', () => {
    for (const c of FIX.cases) {
      const a = mergeNewestUnproven(c.definition.compute.ast, c.definition.compute)
      expect(mergeNewestUnproven(c.definition.compute.ast, c.definition.compute)).toBe(a)
      expect(a, c.name).toBe(c.expect.status === 'refused')
    }
  })
  it('a shared node is walked in each state it is reached in (a DAG cannot hide an uncut path)', () => {
    const shared = X()
    expect(mergeNewestUnproven(op('+', off(1, shared), shared), {})).toBe(true)
    expect(mergeNewestUnproven(op('+', off(1, shared), off(2, shared)), {})).toBe(false)
  })
  it('the parameter manifest is read: the same tree without it is admitted', () => {
    const c = FIX.cases.find((x) => x.name.startsWith('x[len]'))
    expect(mergeNewestUnproven(c.definition.compute.ast, c.definition.compute)).toBe(true)
    expect(mergeNewestUnproven(c.definition.compute.ast, { kind: 'ast' })).toBe(false)
  })
})
