// app/src/components/chart/engine/__tests__/knobArms.test.js
//
// ─── ⭐⭐ e95 unit 2b — A `switch` ON A MEMBER'S `input.string` IS A LIVE SETTING, PRUNED AT BIND ───────────────────
//
// TradingView's anchored VWAP picks its anchor with `switch anchor` on an `input.string` (Session / Week / … /
// Dividends). The host lane folded that subject to its DEFAULT at translate time, so the anchor was no member setting
// at all ("not a setting of our document"). Now (coordinator ruling 2026-11-22, prune at BIND time):
//   · the member door builds EVERY arm (`pine.js::Resolver.enumSwitch`), each test the knob against an option's index;
//   · an arm the translator refuses stands as a refusing leaf (`refusedArm(k)`, quoting its refusal from
//     `meta.knobArmRefusals`);
//   · the bind keeps only the arm the knob picks (`bind.js::pruneKnobArms`, `knobBind.js::boundDocument`) BEFORE
//     anything per binding reads the tree, so an unpicked arm never withholds or refuses the chart, and a picked
//     refused arm refuses THAT plot by name;
//   · the install budget is measured at the knobs' DEFAULTS, the compute budget on each binding's own bound tree.
// The scripts here are written for this rail (the same shape as the built-in's anchor, never its text).
import { describe, it, expect, afterEach } from 'vitest'
import { translatePine } from '../ast/pine.js'
import { checkBudget } from '../ast/budget.js'
import { REFUSED_ARM_CALL } from '../ast/bind.js'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { computeFor, columnErrors, validateUserDefinitions } from '../nativeRegistry'
import { EVENTS_KEY } from '../pineEvents'
import { setRequestWitnessRows, OTHER_SYMBOL_REFUSAL as R } from '../otherSymbols'
import { boundDocument } from '../knobBind.js'
import { bindConstsFor } from '../ast/bind.js'

afterEach(() => { setRequestWitnessRows(null) })

const H = ['//@version=6', 'indicator("knob arms", overlay = true)']
const OPTIONS = '["Session", "Week", "Month", "Quarter", "Dividends"]'
const anchorScript = (def = 'Session') => [...H,
  `anchor = input.string("${def}", "Anchor Period", options = ${OPTIONS})`,
  'isNew = switch anchor',
  '    "Dividends" =>',
  '        d = request.dividends(syminfo.tickerid, dividends.gross, barmerge.gaps_on, barmerge.lookahead_on)',
  '        not na(d)',
  '    "Session" => timeframe.change("D")',
  '    "Week" => timeframe.change("W")',
  '    "Month" => timeframe.change("M")',
  '    "Quarter" => timeframe.change("3M")',
  '    => false',
  'plot(ta.vwap(hlc3, isNew), "VWAP")'].join('\n')
const plainScript = (anchorExpr) => [...H, `plot(ta.vwap(hlc3, ${anchorExpr}), "VWAP")`].join('\n')

// 60 sessions, Mon 2026-01-05 on (weekends skipped), every bar its own hlc3 and volume
const DAYS = []
for (let d = new Date(Date.UTC(2026, 0, 5)); DAYS.length < 60; d = new Date(d.getTime() + 86400000)) {
  if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) DAYS.push(d.toISOString().slice(0, 10))
}
const BARS = DAYS.map((t, i) => ({ t, o: 100 + (i % 7), h: 103 + (i % 5), l: 97 + (i % 3), c: 100 + (i % 11) / 2, v: 1000 + 37 * i }))
const DIVIDENDS = {
  schema: 'uct.pine-events/v1', symbol: 'AAPL', state: 'ready',
  families: {
    earnings: { state: 'empty', knownFrom: null, rows: [] },
    dividends: { state: 'ok', knownFrom: '2026-01-02', rows: [
      { exDate: '2026-01-20', gross: 0.25, currency: 'USD' },
      { exDate: '2026-02-17', gross: 0.25, currency: 'USD' },
    ] },
    splits: { state: 'empty', knownFrom: null, rows: [] },
  },
}
const ctxOf = (status = 'available', tf = 'D') => ({
  tf, symbol: { ticker: 'AAPL', exchange: 'NASDAQ' }, newestBarIsForming: false, historyFromListing: false,
  exchangeOf: () => null,
  secondary: new Map([[EVENTS_KEY, status === 'available'
    ? { status, events: DIVIDENDS, symbol: 'AAPL', rev: 1 } : { status, symbol: 'AAPL' }]]),
})
const door = (src, extra = {}) => {
  const d = memberPaneDefinition({ source: src, id: 'u_knob_arms', name: 'k', ...extra })
  expect(d.ok, d.reason).toBe(true)
  return d.definition
}
const run = (def, anchor, ctx = ctxOf()) => computeFor(def, BARS, anchor === undefined ? undefined : { anchor }, ctx)
const values = (cols) => Array.from(Object.values(cols)[0] || [])
const errorsOf = (cols) => columnErrors(cols)
const hasRefusedArm = (tree) => JSON.stringify(tree).includes(`"${REFUSED_ARM_CALL}"`)

describe('the member door: the anchor is a member setting, and the saved trees keep EVERY arm', () => {
  it('`anchor` is an enum setting with the script\'s options and default; every arm is in the saved tree', () => {
    const def = door(anchorScript())
    const input = (def.inputs || []).find((i) => i.key === 'anchor')
    expect(input).toMatchObject({ type: 'enum', default: 'Session', label: 'Anchor Period' })
    expect(input.options).toEqual(['Session', 'Week', 'Month', 'Quarter', 'Dividends'])
    const saved = JSON.stringify(def.compute)
    for (const read of ['sessionfirst', 'weekfirst', 'monthfirst', 'EV-DG-11']) expect(saved).toContain(read)
    expect(hasRefusedArm(def.compute)).toBe(true)
    expect(validateUserDefinitions([def]).errors).toEqual([])
  })

  it('the arm the translator refused is stamped with ITS refusal, naming the setting and the option', () => {
    const def = door(anchorScript())
    expect(def.meta.knobArmRefusals).toHaveLength(1)
    const [r] = def.meta.knobArmRefusals
    expect(r.guard).toBe('pine:builtin')
    expect(r.message).toContain('the setting "Anchor Period" set to "Quarter" picks a branch of this script')
    expect(r.message).toContain('`timeframe.change`')
  })

  it('⛔ CONTROL: the door without live enum knobs folds the switch to its default, as before (no arm, no setting)', () => {
    const def = door(anchorScript(), { enumInputs: false })
    expect((def.inputs || []).some((i) => i.key === 'anchor')).toBe(false)
    expect(JSON.stringify(def.compute)).not.toContain('weekfirst')
    expect(def.meta.knobArmRefusals).toBeUndefined()
  })

  it('⛔ a Pine script cannot spell the refusing leaf: `refusedArm(1)` written by a script is refused, never a leaf', () => {
    const t = translatePine([...H, 'plot(refusedArm(1), "x")'].join('\n'), { strict: true })
    expect(t.ok).toBe(false)
    expect(t.outputs[0].refusal).toMatchObject({ guard: 'pine:builtin' })
    expect(t.outputs[0].refusal.message).toContain('a script cannot call it')
    expect(JSON.stringify((t.outputs || []).map((o) => o.ast || null))).not.toContain(REFUSED_ARM_CALL)
  })
})

describe('the bind: the knob picks one arm, and only that arm is bound', () => {
  it('the default draws exactly what the door drew before the setting existed (the switch folded to its default)', () => {
    const live = values(run(door(anchorScript()), undefined))
    const before = values(run(door(anchorScript(), { enumInputs: false }), undefined))
    expect(live.some(Number.isFinite)).toBe(true)
    expect(live).toEqual(before)
  })

  it('the knob moves the drawn values: each option draws what the script written with that anchor alone draws', () => {
    const def = door(anchorScript())
    const session = values(run(def, 'Session'))
    for (const [opt, expr] of [['Session', 'timeframe.change("D")'], ['Week', 'timeframe.change("W")'], ['Month', 'timeframe.change("M")']]) {
      const got = values(run(def, opt))
      expect(got, opt).toEqual(values(run(door(plainScript(expr)), undefined)))
      if (opt !== 'Session') expect(got, opt).not.toEqual(session)
    }
  })

  it('the bound document holds only the picked arm; a document with no knob binds to itself', () => {
    const def = door(anchorScript())
    const bound = boundDocument(def, bindConstsFor({ tf: 'D', inputs: { anchor: 1 } }))
    const text = JSON.stringify(bound.compute.ast || bound.compute.trees)
    // the saved FORMULA TEXT keeps every arm (only the bound program is pruned)
    expect(bound.compute.source).toBe(def.compute.source)
    expect(text).toContain('weekfirst')
    for (const gone of ['sessionfirst', 'monthfirst', 'EV-DG-11', REFUSED_ARM_CALL]) expect(text).not.toContain(gone)
    // its record of what it reads is narrowed with it: the dividend read only the unpicked arm made is gone
    expect(JSON.stringify(bound.meta.otherSymbols || [])).not.toContain('EV-DG')
    const plain = door(plainScript('timeframe.change("W")'))
    expect(boundDocument(plain, bindConstsFor({ tf: 'D', inputs: {} }))).toBe(plain)
  })
})

describe('an UNPICKED refused arm never refuses; a PICKED one refuses that plot by name', () => {
  it('unpicked: the translator-refused arm (Quarter) and a dark events door (Dividends) refuse nothing', () => {
    const def = door(anchorScript())
    for (const opt of ['Session', 'Week', 'Month']) {
      const cols = run(def, opt, ctxOf('dark'))
      expect(errorsOf(cols), opt).toEqual({})
      expect(values(cols).some(Number.isFinite), opt).toBe(true)
    }
  })

  it('unpicked: an event read on an intraday chart (E2 refuses it there) refuses nothing', () => {
    const intraday = BARS.map((b) => ({ ...b, t: `${b.t}T15:30:00Z` }))
    const def = door(anchorScript())
    const cols = computeFor(def, intraday, { anchor: 'Session' }, ctxOf('available', '60'))
    expect(errorsOf(cols)).toEqual({})
    const picked = computeFor(def, intraday, { anchor: 'Dividends' }, ctxOf('available', '60'))
    expect(Object.values(errorsOf(picked))[0]).toMatchObject({ guard: R.EVENT_TIMEFRAME })
  })

  it('picked: the translator-refused arm refuses the plot with the translator\'s own guard and sentence', () => {
    const cols = run(door(anchorScript()), 'Quarter')
    const err = errorsOf(cols).value || Object.values(errorsOf(cols))[0]
    expect(err.guard).toBe('pine:builtin')
    expect(err.message).toContain('the setting "Anchor Period" set to "Quarter" picks a branch')
    expect(values(cols)).toEqual([])
  })

  it('picked: the events door dark refuses by name; with UCT\'s dividends in hand it draws, anchored on them', () => {
    const def = door(anchorScript())
    const dark = run(def, 'Dividends', ctxOf('dark'))
    expect(Object.values(errorsOf(dark))[0]).toMatchObject({ guard: R.EVENT_NOT_AVAILABLE })
    const served = run(def, 'Dividends')
    expect(errorsOf(served)).toEqual({})
    const v = values(served)
    // na before the first ex-date (2026-01-20, bar 11), then a VWAP summed from each ex-date
    const first = DAYS.indexOf('2026-01-20')
    expect(v.slice(0, first).every((x) => !Number.isFinite(x))).toBe(true)
    expect(Number.isFinite(v[first])).toBe(true)
  })
})

describe('the budgets: the install measures the defaults, the compute each binding', () => {
  const CLOCK = [...H,
    'anchor = input.string("Session", "Anchor", options = ["Session", "Week", "Month", "Clock"])',
    'isNew = switch anchor',
    '    "Session" => timeframe.change("D")',
    '    "Week" => timeframe.change("W")',
    '    "Month" => timeframe.change("M")',
    '    "Clock" => hour == 9 and minute == 30 and dayofmonth == 1 and month == 1 and year == 2026',
    'plot(ta.vwap(hlc3, isNew), "VWAP")'].join('\n')

  it('a switch whose arms together read more series than the cap installs: the default program is within it', () => {
    const def = door(CLOCK)
    expect((def.inputs || []).find((i) => i.key === 'anchor')).toMatchObject({ type: 'enum' })
    const tree = def.compute.ast || Object.values(def.compute.trees)[0]
    // ⛔ the saved tree, every arm in it, is over the series cap: what admits it is the default-bound measurement
    expect(checkBudget(tree)).toMatchObject({ ok: false, guard: 'budget:series' })
    expect(validateUserDefinitions([def]).errors).toEqual([])
    expect(errorsOf(run(def, 'Session'))).toEqual({})
    expect(values(run(def, 'Session'))).toEqual(values(run(door(plainScript('timeframe.change("D")')), undefined)))
  })

  it('a setting that picks an over-budget arm refuses that plot by name (the compute budget, on the bound tree)', () => {
    // a one-plot document computes one tree, and its refusal reaches the caller as itself (`astColumnsUnstopped`)
    let err = null
    try { run(door(CLOCK), 'Clock') } catch (e) { err = e }
    expect(err && err.guard).toBe('budget:series')
    expect(String(err.message)).toContain('exceeds the series-reference budget')
  })
})
