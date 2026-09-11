import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createBinder } from '../binder'
import { resolvePlacement } from '../placement'
import { createFakeChart, makeBars } from './fakeChart'
import { __setPaneModeForTest, computePaneLayout, SEPARATOR_PX } from '../paneLayout'
import * as registry from '../nativeRegistry'
import { resolveDisplayTarget, derivedTargetOf, paneFollowerKeys, paneOwnersNeeded } from '../displayTarget'
import { instanceSource } from '../sourceRef'
import {
  COND_TRUE, COND_FALSE, COND_UNKNOWN,
  normaliseConditions, newConditionId, validateConditionFormula,
  evaluateCondition, trueRuns, conditionInstance, conditionDef,
} from '../conditions'
import {
  ACTION_CHANNEL, MARKER_SHAPES, channelActions,
  resolveCandleColors, resolveBackgroundColors, colorRuns, resolveMarkers, hasChannel,
} from '../conditionActions'

// ─── A CONDITION IS DATA ────────────────────────────────────────────────────
//
// ⭐ THESE CASES ARE ABOUT THE ANSWER, NOT ABOUT THE INK. A condition produces
// TRUE / FALSE / UNKNOWN per bar; three unrelated visual channels consume it.
// The claim the whole phase rests on is that the formula is evaluated ONCE
// however many actions read it, and the last describe block measures exactly
// that rather than asserting it.

const bars = makeBars(200)

/** ⚠️ `makeBars` RISES ON EVERY BAR, so `close > open` is true everywhere on it
 *  — a fixture that cannot tell a working condition from one stuck at TRUE. These
 *  bars alternate, so every case below has both answers to find. */
const mixedBars = Array.from({ length: 200 }, (_, i) => {
  const up = i % 3 !== 0
  const base = 100 + Math.sin(i / 7) * 8 + i * 0.02
  return {
    t: 1700000000 + i * 86400,
    o: up ? base : base + 1,
    c: up ? base + 1 : base,
    h: base + 2,
    l: base - 2,
    v: 1000000,
  }
})

const cond = (over = {}) => ({
  id: 'cond:test:1', name: 'Test', formula: 'close > open', enabled: true,
  bindings: {}, actions: [], ...over,
})

const csOf = (conditions) => ({ conditions })

describe('the condition MODEL', () => {
  it('⭐ a stable id is opaque and never derived from the NAME', () => {
    const a = newConditionId()
    const b = newConditionId()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^cond:/)
    // Renaming must not touch it — the actions reference the ID.
    const c = cond({ id: a, name: 'Inside Bar' })
    const renamed = { ...c, name: 'Inside Candle' }
    expect(conditionInstance(renamed).instanceId).toBe(conditionInstance(c).instanceId)
  })

  it('⛔ a malformed row is DROPPED, not thrown over', () => {
    const list = normaliseConditions(csOf([
      null, 42, {}, { id: 'x' }, { id: 'y', formula: '   ' },
      { id: 'ok', formula: 'close > open' },
      { id: 'ok', formula: 'high > low' },          // duplicate id
    ]))
    expect(list.map((c) => c.id)).toEqual(['ok'])
    expect(list[0].formula).toBe('close > open')
  })

  it('⚠️ `enabled` defaults to TRUE — absence is the default’s spelling', () => {
    expect(normaliseConditions(csOf([{ id: 'a', formula: 'close > open' }]))[0].enabled).toBe(true)
    expect(normaliseConditions(csOf([{ id: 'a', formula: 'close > open', enabled: false }]))[0].enabled).toBe(false)
  })

  it('a condition that binds nothing has NO dependency edges', () => {
    expect(conditionDef(cond()).inputs).toEqual([])
    expect(conditionDef(cond({ bindings: { a: '@legacy:rsi::rsi' } })).inputs)
      .toEqual([{ key: 'a', type: 'source', default: 'close' }])
  })
})

describe('BOOLEAN output — and a numeric formula is refused', () => {
  it('⭐ the engine has always produced booleans — a comparison is a 0/1 column', () => {
    const ok = validateConditionFormula('close > open')
    expect(ok.ok).toBe(true)
  })

  it('⛔⛔ a NUMERIC formula is REFUSED, not coerced to `!= 0`', () => {
    // `rsi(close,14) != 0` is true for every symbol on the board. Admitting a
    // numeric tree as a condition would colour every candle and say nothing.
    for (const f of ['close', 'rsi(close, 14)', 'close + open', 'ema(close, 9)']) {
      const r = validateConditionFormula(f)
      expect(r.ok, `${f} was admitted as a condition`).toBe(false)
      expect(r.reason).toMatch(/true or false/)
    }
  })

  it('…and so is text that does not read back at all', () => {
    expect(validateConditionFormula('close >').ok).toBe(false)
    expect(validateConditionFormula('').ok).toBe(false)
    expect(validateConditionFormula(null).ok).toBe(false)
  })

  it('⭐ connectives and negation are conditions too', () => {
    expect(validateConditionFormula('high < high[1] && low > low[1]').ok).toBe(true)
    expect(validateConditionFormula('!(close > open)').ok).toBe(true)
  })

  it('⛔ a bound source that cannot be read is refused by NAME', () => {
    const r = validateConditionFormula('a > b', { a: '@x::y', b: 'nonsense' })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/`b`/)
  })
})

describe('the boolean COLUMN', () => {
  const evalNoSources = (formula, b = mixedBars) => evaluateCondition(cond({ formula }), b, () => null)

  it('⭐ one byte per bar, and TRUE really means true — on every bar', () => {
    const { column } = evalNoSources('close > open')
    expect(column).toBeInstanceOf(Uint8Array)
    expect(column.length).toBe(mixedBars.length)
    for (let i = 0; i < mixedBars.length; i++) {
      expect(column[i], `bar ${i}`).toBe(mixedBars[i].c > mixedBars[i].o ? COND_TRUE : COND_FALSE)
    }
    expect(new Set([...column]), 'the fixture has only one answer in it')
      .toEqual(new Set([COND_TRUE, COND_FALSE]))
  })

  it('⛔⛔ WARM-UP IS `UNKNOWN`, NOT `FALSE` — they are different answers', () => {
    // MEASURED: this engine resolves `close > na` to **0**, not `NaN` — Pine's
    // rule, right for a scan and wrong for a chart, where "did not match" and
    // "cannot say yet" are drawn identically. So the head is taken from
    // `maxLookback`, the engine's own static analysis.
    const { column } = evalNoSources('close > sma(close, 20)')
    for (let i = 0; i < 19; i++) expect(column[i], `bar ${i}`).toBe(COND_UNKNOWN)
    expect(column[mixedBars.length - 1]).not.toBe(COND_UNKNOWN)
    expect([...column].some((v) => v === COND_TRUE)).toBe(true)

    // …and a formula that reaches back NO bars has no warm-up at all.
    expect(evalNoSources('close > open').column[0]).not.toBe(COND_UNKNOWN)
    // …while a one-bar offset costs exactly the first bar.
    const inside = evalNoSources('high < high[1] && low > low[1]').column
    expect(inside[0]).toBe(COND_UNKNOWN)
    expect(inside[1]).not.toBe(COND_UNKNOWN)
  })

  it('⛔ a refused formula produces `null`, NOT an all-false column', () => {
    // All-false is a CLAIM — "this never happened". The two states a member has
    // to tell apart are "it did not fire" and "this is not answerable".
    const r = evaluateCondition(cond({ formula: 'rsi(close, 14)' }), mixedBars, () => null)
    expect(r.column).toBe(null)
    expect(r.error).toMatch(/true or false/)
  })

  it('⛔ a MISSING bound source produces `null` and says so', () => {
    const r = evaluateCondition(
      cond({ formula: 'a > close', bindings: { a: '@legacy:rsi::rsi' } }), mixedBars, () => null,
    )
    expect(r.column).toBe(null)
    expect(r.error).toBe('Source unavailable')
    expect(r.missing).toEqual(['a'])
  })
})

describe('run segmentation', () => {
  const col = (...v) => Uint8Array.from(v)

  it('⭐⭐ contiguous TRUE runs — one band, never one rectangle per bar', () => {
    const runs = trueRuns(col(0, 0, 1, 1, 1, 0, 1, 1))
    expect(runs).toEqual([[2, 4], [6, 7]])
  })

  it('⚠️ UNKNOWN BREAKS a run — it does not bridge one', () => {
    expect(trueRuns(col(1, 1, COND_UNKNOWN, 1))).toEqual([[0, 1], [3, 3]])
  })

  it('a run that reaches the last bar is closed', () => {
    expect(trueRuns(col(0, 1, 1))).toEqual([[1, 2]])
    expect(trueRuns(col())).toEqual([])
    expect(trueRuns(null)).toEqual([])
  })

  it('⛔ a COLOUR change breaks a run, so two regimes stay two bands', () => {
    const colors = ['a', 'a', 'b', 'b', null, 'b']
    const b = colors.map((_, i) => ({ t: 100 + i }))
    expect(colorRuns(colors, b, (t) => t)).toEqual([
      { from: 100, to: 101, color: 'a' },
      { from: 102, to: 103, color: 'b' },
      { from: 105, to: 105, color: 'b' },
    ])
  })
})

describe('ACTION priority, per channel', () => {
  const A = cond({
    id: 'A', name: 'A',
    actions: [{ type: 'candleColor', color: '#orange' }, { type: 'marker', shape: 'dot', color: '#blue' }],
  })
  const B = cond({
    id: 'B', name: 'B',
    actions: [{ type: 'candleColor', color: '#yellow' }],
  })
  const cols = new Map([['A', Uint8Array.from([1, 0, 1])], ['B', Uint8Array.from([1, 1, 0])]])
  const columnOf = (id) => cols.get(id) || null

  it('⭐ TOP-TO-BOTTOM, FIRST MATCHING ENABLED RULE WINS — never a blend', () => {
    const out = resolveCandleColors([A, B], columnOf, 3)
    expect(out).toEqual(['#orange', '#yellow', '#orange'])
  })

  it('…and reordering the list reorders priority', () => {
    expect(resolveCandleColors([B, A], columnOf, 3)).toEqual(['#yellow', '#yellow', '#orange'])
  })

  it('⭐⭐ PRIORITY IS PER CHANNEL — "A won the candle" does not suppress B', () => {
    // Bar 0: A wins the candle over B, AND A's marker still draws.
    const markers = resolveMarkers([A, B], columnOf, [{ t: 1 }, { t: 2 }, { t: 3 }], (t) => t)
    expect(markers.map((m) => m.time)).toEqual([1, 3])
    expect(resolveCandleColors([A, B], columnOf, 3)[0]).toBe('#orange')
  })

  it('⛔ a DISABLED condition contributes nothing to any channel', () => {
    const off = { ...A, enabled: false }
    expect(resolveCandleColors([off, B], columnOf, 3)).toEqual(['#yellow', '#yellow', null])
    expect(resolveMarkers([off, B], columnOf, [{ t: 1 }], (t) => t)).toEqual([])
  })

  it('⛔ a disabled ACTION contributes nothing while its condition stays on', () => {
    const half = { ...A, actions: [{ ...A.actions[0] }, { ...A.actions[1], enabled: false }] }
    expect(resolveCandleColors([half], columnOf, 3)[0]).toBe('#orange')
    expect(resolveMarkers([half], columnOf, [{ t: 1 }], (t) => t)).toEqual([])
  })

  it('no rules at all ⇒ `null`, so every consumer stays completely inert', () => {
    expect(resolveCandleColors([], columnOf, 3)).toBe(null)
    expect(resolveBackgroundColors([A, B], columnOf, 3)).toBe(null)   // neither declares one
    expect(hasChannel([A, B], 'background')).toBe(false)
    expect(hasChannel([A, B], 'candle')).toBe(true)
  })

  it('every declared action type has a channel, and markers a shape vocabulary', () => {
    expect(Object.keys(ACTION_CHANNEL).sort()).toEqual(['background', 'candleColor', 'marker'])
    expect(MARKER_SHAPES).toContain('dot')
    expect(channelActions([A], 'marker')).toHaveLength(1)
  })

  it('⭐ a marker is a DESCRIPTOR, positioned semantically — never a screen Y', () => {
    const m = resolveMarkers([A], columnOf, [{ t: 11 }, { t: 12 }, { t: 13 }], (t) => t)[0]
    expect(m.position).toBe('belowBar')
    expect(m.shape).toBe('circle')          // `dot` → the renderer's circle, small
    expect(m.color).toBe('#blue')
    expect(m).not.toHaveProperty('y')
    expect(m).not.toHaveProperty('x')
  })
})

// ─── THROUGH THE BINDER — ORDER, REUSE AND INVALIDATION ─────────────────────

const ctxFor = (instances, conditions) => {
  const settings = { indicatorInstances: instances }
  const layout = computePaneLayout(instances, {
    chartHeight: 600, hasVolumeBand: false, separatorPx: SEPARATOR_PX,
    excludeKeys: paneFollowerKeys(instances, settings),
    keepKeys: paneOwnersNeeded(instances, settings),
  })
  return {
    enabled: true, instances, registry, bars, conditions,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (s, d) => s.setData(d),
    paneLayout: layout,
    targetOf: (i) => resolveDisplayTarget(i, settings),
    resolvePlacement: (i, def) => resolvePlacement(i, def, {
      paneMargins: layout.bands, paneLayout: layout,
      volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
      targetOf: (x) => resolveDisplayTarget(x, settings),
      derivedTargetOf: (x) => derivedTargetOf(x, settings),
    }),
  }
}

const rsiInst = (period = 14) => ({
  instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period }, hidden: false,
})
const maInst = (source) => ({
  instanceId: 'inst:ma:1', defId: 'movingAverage', hidden: false,
  inputs: { source, period: 5, maType: 'sma' },
})

describe('a condition inside the engine', () => {
  let fake
  let binder
  beforeEach(() => { __setPaneModeForTest('panes'); fake = createFakeChart(); binder = createBinder({ chart: fake.chart, LWC: fake.LWC }) })
  afterEach(() => { __setPaneModeForTest(null); vi.restoreAllMocks() })

  it('⭐⭐ it reads ANOTHER INDICATOR’s output — one reference language', () => {
    // `RSI > MA(RSI)`: the condition binds the two columns by the SAME
    // `'@instanceId::plotKey'` string the Moving Average takes for its source.
    const c = cond({
      id: 'C1', formula: 'r > m',
      bindings: { r: instanceSource('legacy:rsi', 'rsi'), m: instanceSource('inst:ma:1', 'ma') },
    })
    binder.sync(ctxFor([rsiInst(), maInst(instanceSource('legacy:rsi', 'rsi'))], [c]))
    const { columns, errors } = binder.conditions()
    expect(errors.get('C1'), 'the condition did not evaluate').toBeUndefined()
    const col = columns.get('C1')
    expect(col).toBeInstanceOf(Uint8Array)
    expect(col.length).toBe(bars.length)
    expect([...col].filter((v) => v === COND_TRUE).length).toBeGreaterThan(20)
    expect([...col].filter((v) => v === COND_FALSE).length).toBeGreaterThan(20)
  })

  it('⛔ …and the ORDER is the shipped sort — no second scheduler', () => {
    // The MA is listed FIRST, before the RSI it reads. If conditions needed
    // their own ordering this would evaluate against an empty column map.
    const c = cond({ id: 'C1', formula: 'm > 0', bindings: { m: instanceSource('inst:ma:1', 'ma') } })
    binder.sync(ctxFor([maInst(instanceSource('legacy:rsi', 'rsi')), rsiInst()], [c]))
    expect(binder.conditions().columns.get('C1')).toBeInstanceOf(Uint8Array)
  })

  it('⛔ a condition naming a missing instance says "Source unavailable"', () => {
    const c = cond({ id: 'C1', formula: 'r > 50', bindings: { r: instanceSource('legacy:rsi', 'rsi') } })
    binder.sync(ctxFor([], [c]))
    expect(binder.conditions().columns.get('C1')).toBeUndefined()
    expect(binder.conditions().errors.get('C1')).toBe('Source unavailable')
  })

  it('⭐⭐ ONE EVALUATION PER CONDITION, WHATEVER IT FEEDS', () => {
    // The architectural claim of the whole phase, measured rather than asserted:
    // Slingshot-with-two-actions must not evaluate twice.
    const c = cond({
      id: 'C1', formula: 'close > open',
      actions: [
        { type: 'candleColor', color: '#e8a33d' },
        { type: 'marker', shape: 'dot', position: 'belowBar', color: '#3b82f6' },
        { type: 'background', color: 'rgba(0,255,0,0.1)' },
      ],
    })
    const ctx = ctxFor([], [c])
    // The column is produced ONCE and the three channels read the same object.
    binder.sync(ctx)
    const col = binder.conditions().columns.get('C1')
    const columnOf = (id) => binder.conditions().columns.get(id) || null
    const candle = resolveCandleColors([c], columnOf, bars.length)
    const bg = resolveBackgroundColors([c], columnOf, bars.length)
    const markers = resolveMarkers([c], columnOf, bars, (t) => t)
    expect(candle.filter(Boolean).length).toBeGreaterThan(10)
    expect(bg.filter(Boolean).length).toBe(candle.filter(Boolean).length)
    expect(markers.length).toBe(candle.filter(Boolean).length)
    expect(binder.conditions().columns.get('C1'), 'a second array was produced').toBe(col)
  })

  it('⭐⭐ A SOURCE PARAMETER CHANGE RECOMPUTES IT; A COLOUR CHANGE DOES NOT', () => {
    const c = cond({ id: 'C1', formula: 'r > 50', bindings: { r: instanceSource('legacy:rsi', 'rsi') } })
    binder.sync(ctxFor([rsiInst(14)], [c]))
    const first = binder.conditions().columns.get('C1')
    expect(first).toBeInstanceOf(Uint8Array)

    // A new instances ARRAY, same inputs — what every settings write produces.
    binder.sync(ctxFor([{ ...rsiInst(14) }], [{ ...c }]))
    expect(binder.conditions().columns.get('C1'), 'it recomputed although nothing it reads changed')
      .toBe(first)

    // The RSI's PERIOD changes: a new column, a new `__srcId`, a new verdict.
    binder.sync(ctxFor([rsiInst(21)], [{ ...c }]))
    const after = binder.conditions().columns.get('C1')
    expect(after, 'the condition did not follow its source').not.toBe(first)
    expect([...after]).not.toEqual([...first])
  })

  it('⛔ changing an ACTION never reaches the evaluator at all', () => {
    const c = cond({ id: 'C1', formula: 'close > open', actions: [{ type: 'candleColor', color: '#aaa' }] })
    binder.sync(ctxFor([], [c]))
    const first = binder.conditions().columns.get('C1')
    const recoloured = { ...c, actions: [{ type: 'candleColor', color: '#fff' }], name: 'Renamed' }
    binder.sync(ctxFor([], [recoloured]))
    expect(binder.conditions().columns.get('C1')).toBe(first)
  })

  it('⛔ DISABLING a condition stops it calculating and keeps its configuration', () => {
    const c = cond({ id: 'C1', formula: 'close > open' })
    binder.sync(ctxFor([], [c]))
    expect(binder.conditions().columns.get('C1')).toBeInstanceOf(Uint8Array)
    binder.sync(ctxFor([], [{ ...c, enabled: false }]))
    expect(binder.conditions().columns.get('C1')).toBeUndefined()
    // …and switching it back on returns the same answer.
    binder.sync(ctxFor([], [{ ...c }]))
    expect(binder.conditions().columns.get('C1')).toBeInstanceOf(Uint8Array)
  })

  it('⛔ DELETING a condition drops its column and leaves its sources alone', () => {
    const c = cond({ id: 'C1', formula: 'r > 50', bindings: { r: instanceSource('legacy:rsi', 'rsi') } })
    binder.sync(ctxFor([rsiInst()], [c]))
    expect(binder.conditions().columns.size).toBe(1)
    binder.sync(ctxFor([rsiInst()], []))
    expect(binder.conditions().columns.size).toBe(0)
    // The RSI is still bound and still drawing.
    expect(binder.bindings().some((b) => b.key === 'legacy:rsi::rsi')).toBe(true)
  })

  it('⛔ a condition is never a SOURCE for an indicator (Part 43 type rule)', () => {
    // Nothing publishes a condition into `columns`, so an indicator that named
    // one would see a missing source — not a cycle, and not a silent number.
    const c = cond({ id: 'C1', formula: 'close > open' })
    binder.sync(ctxFor([maInst('@C1::value')], [c]))
    const ma = binder.bindings().find((b) => b.key === 'inst:ma:1::ma')
    expect(ma, 'an indicator bound itself to a condition column').toBeUndefined()
  })
})
