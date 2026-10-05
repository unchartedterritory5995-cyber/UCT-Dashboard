// app/src/components/chart/engine/runtime/runtimeRepaintEdge.test.js
//
// ─── ⭐⭐ RT2 — WHICH CLOCK LEAVES MOVE ON A CLOSED BAR, MEASURED BY MOVING THE FETCH ─
//
// `closedTable.json::clock` declares a `forward` on a handful of clock leaves
// (RT4, `_clock_right_edge`; RT2 first carried it in a runtime-only table,
// `clockEdge`, now removed). That is a claim about `indicators.js::computeClock`, the one
// producer of every clock column both lanes read, so it is proved against it:
// compute the clock over N bars, then over N+1 and N+2 (a later bar arrives), and
// over N with the newest bar forming against closed (the newest bar closes). A
// leaf whose value on a CLOSED bar (index < N-1) changes is a leaf whose value
// depends on a later bar.
//
//   · the set of leaves that move is EXACTLY the declaring leaves — no more (a
//     stable leaf branded repainting) and no fewer (a moving leaf called stable);
//   · a leaf declared `1` stops moving once one later bar exists; a leaf declared
//     `unbounded` moves again on the next bar.
//
// ⭐ RT4: the integrator ruled the finding into the SHARED table, so this rail now
// holds the host linter's own declaration to the measurement, and the control
// below proves the instrument can say "stable".

import { describe, it, expect } from 'vitest'
import { computeClock, CLOCK_COLUMNS } from '../../../indicators.js'
import { RUNTIME_REPAINT_RULES, clockLeafReach } from '../runtimeRepaint'
import { TABLE } from '../../ast/parse'
import { UNBOUNDED, astReach, lintRepaint } from '../../ast/lint'
import { evaluateFormula, canSaveFormula } from '../../../builder/FormulaField.jsx'
import { BUILDER_INPUT_SCOPE } from '../../../builder/builderInputs'

const DAY = 86400
const noonDow = (t) => new Date((t + 12 * 3600) * 1000).getUTCDay()
const noonYear = (t) => new Date((t + 12 * 3600) * 1000).getUTCFullYear()
const bar = (t, i) => ({ t, o: 10, h: 11, l: 9, c: 10 + i, v: 100 })

/** Weekday daily bars stamped at ET midnight (05:00 UTC in EST) from
 *  2025-12-01, with N at the first bar of 2026: the bar that arrives at N is a
 *  new YEAR, MONTH and DAY, so every calendar half of the right edge moves. */
function dailyAcrossYear() {
  const bars = []
  let t = Date.UTC(2025, 11, 1, 5) / 1000
  while (bars.length < 40) {
    if (noonDow(t) !== 0 && noonDow(t) !== 6) bars.push(bar(t, bars.length))
    t += DAY
  }
  return { bars, N: bars.findIndex((b) => noonYear(b.t) === 2026) }
}

/** 5-minute bars from 2026-09-08 22:00 ET, with N at 00:00 ET the next day:
 *  the bar that arrives at N is a new DAY, HOUR and MINUTE. */
function intradayAcrossMidnight() {
  const t0 = Date.UTC(2026, 8, 9, 2) / 1000
  const bars = Array.from({ length: 40 }, (_, i) => bar(t0 + i * 300, i))
  return { bars, N: 24 }
}

const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || a === b

/** Leaves whose value on a bar < `upto` differs between two clock maps. */
function moved(x, y, upto) {
  const out = new Set()
  for (const name of CLOCK_COLUMNS) {
    for (let i = 0; i < upto; i += 1) {
      if (!same(x[name][i], y[name][i])) { out.add(name); break }
    }
  }
  return out
}

/** Every clock leaf the SHARED table declares a `forward` on, with the host
 *  linter's reach for it. */
const EDGE = Object.fromEntries(Object.entries(TABLE.clock)
  .filter(([k, v]) => !k.startsWith('_') && v && Object.prototype.hasOwnProperty.call(v, 'forward'))
  .map(([k]) => [k, astReach({ type: 'series', name: k }).forward]))

const FIXTURES = [['daily, across a year end', dailyAcrossYear(), '1D'],
  ['5-minute, across midnight', intradayAcrossMidnight(), '5']]

/** Every leaf that moves on a CLOSED bar when the fetch grows or its newest bar
 *  closes. A closed fetch: all N of its bars are closed; a forming one: N-1. */
function movedOn({ bars, N }, tf) {
  const at = (n, forming) => computeClock(bars.slice(0, n), tf, forming)
  return new Set([
    ...moved(at(N, false), at(N + 1, false), N),
    ...moved(at(N, false), at(N + 1, true), N),
    ...moved(at(N, true), at(N, false), N - 1),
  ])
}

describe('RT2 — the right edge, measured by moving the fetch', () => {
  it.each(FIXTURES)('⛔ %s: every leaf that moves on a closed bar declares a `forward` in the shared table', (_, fx, tf) => {
    expect(fx.N).toBeGreaterThan(5)
    const undeclared = [...movedOn(fx, tf)].filter((leaf) => !Object.prototype.hasOwnProperty.call(EDGE, leaf))
    expect(undeclared).toEqual([])
  })

  it('and no declared leaf is stable: across the two fetches, the moving set IS the declaring set', () => {
    const all = new Set(FIXTURES.flatMap(([, fx, tf]) => [...movedOn(fx, tf)]))
    expect([...all].sort()).toEqual(Object.keys(EDGE).sort())
  })

  it.each(FIXTURES)('%s: a leaf declared `1` is final once one later bar exists', (_, { bars, N }, tf) => {
    const one = computeClock(bars.slice(0, N + 1), tf, false)
    const two = computeClock(bars.slice(0, N + 2), tf, false)
    const still = moved(one, two, N)
    for (const [leaf, reach] of Object.entries(EDGE)) {
      if (reach !== UNBOUNDED) {
        expect(reach, leaf).toBe(1)
        expect(still.has(leaf), leaf).toBe(false)
      }
    }
    // ...while the bar-position leaves keep moving with every bar
    expect(still.has('lastbarindex')).toBe(true)
    expect(still.has('lastbartime')).toBe(true)
  })

  it.each(FIXTURES)('⭐ CONTROL, %s: the instrument says "stable" — `isconfirmed` and `barindex` do not move', (_, fx, tf) => {
    const all = movedOn(fx, tf)
    expect(all.has('isconfirmed')).toBe(false)
    expect(all.has('barindex')).toBe(false)
    expect(all.size).toBeGreaterThan(0)
  })
})

describe('RT4 — the ruling, stated as a rail: one table, both lanes', () => {
  it('the shared table declares exactly the nine right-edge leaves, at the measured reach', () => {
    expect(EDGE).toEqual({
      islast: 1,
      islastconfirmedhistory: 1,
      lastbarindex: UNBOUNDED,
      lastbartime: UNBOUNDED,
      lastbaryear: UNBOUNDED,
      lastbarmonth: UNBOUNDED,
      lastbardayofmonth: UNBOUNDED,
      lastbarhour: UNBOUNDED,
      lastbarminute: UNBOUNDED,
    })
  })

  it('the HOST linter badges them by it, and the runtime document reads the same answer', () => {
    for (const [leaf, reach] of Object.entries(EDGE)) {
      const mode = lintRepaint({ type: 'series', name: leaf }).mode
      expect(mode, leaf).toBe(reach === UNBOUNDED ? 'repaints' : 'preview-repaints')
      expect(clockLeafReach(leaf), leaf).toBe(reach)
    }
    // the runtime table carries no clock reach of its own any more
    expect(Object.prototype.hasOwnProperty.call(RUNTIME_REPAINT_RULES, 'clockEdge')).toBe(false)
  })

  it('the builder save gate moves with it: an acknowledgement for `islast`, a refusal for `lastbarindex`', () => {
    const at = (f) => evaluateFormula(f, BUILDER_INPUT_SCOPE)
    const one = at('islast')
    expect(one.ok, JSON.stringify(one.error || one.guard || '')).toBe(true)
    expect(one.verdict.mode).toBe('preview-repaints')
    expect(canSaveFormula(one, false)).toBe(false)
    expect(canSaveFormula(one, true)).toBe(true)
    const never = at('lastbarindex - barindex < 10')
    expect(never.ok).toBe(true)
    expect(never.verdict.mode).toBe('repaints')
    expect(canSaveFormula(never, true)).toBe(false)
    // control: a stable leaf saves with no acknowledgement
    const stable = at('isconfirmed')
    expect(stable.ok).toBe(true)
    expect(canSaveFormula(stable, false)).toBe(true)
  })

  it('⭐ CONTROL: a stable leaf still lints non-repainting through the same call', () => {
    for (const leaf of ['isconfirmed', 'barindex', 'time', 'isfirst']) {
      expect(lintRepaint({ type: 'series', name: leaf }).mode, leaf).toBe('non-repainting')
    }
  })
})
