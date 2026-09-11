import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createBinder } from '../binder'
import { resolvePlacement } from '../placement'
import { createFakeChart } from './fakeChart'
import { __setPaneModeForTest, computePaneLayout, SEPARATOR_PX } from '../paneLayout'
import * as registry from '../nativeRegistry'
import {
  resolveDisplayTarget, derivedTargetOf, paneFollowerKeys, paneOwnersNeeded,
} from '../displayTarget'
import { instanceSource, parseSource, isSeveredSource } from '../sourceRef'
import {
  normaliseInfoFields, validateInfoFormula, evaluateInfoField,
  isInfoFieldId, INFO_FORMATS,
} from '../infoFields'
import { formatInfoValue, INFO_EMPTY } from '../infoFormat'
import {
  infoFieldsOf, addInfoField, removeInfoField, setInfoField,
  setInfoFieldBinding, moveInfoRowField,
} from '../infoFieldControls'
import { mergeChartSettings, CHART_DEFAULTS } from '../../chartDefaults'
import { setIndicatorEnabled, removeInstance } from '../instanceControls'
import { headerFieldKeys } from '../../headerFields'

// ─── ONE FORMULA, A THIRD CONSUMER ──────────────────────────────────────────
//
// ⭐ The cases here are about what an info field DOES with a formula, never about
// arithmetic: the parser, the evaluator and the grammar are the shipped ones and
// have their own 2,000 cases. What is new is "the newest value", "must be
// numeric", and "formatting is not calculation".

/** Bars with real shape, so ADR and the averages have something to say. */
const bars = Array.from({ length: 120 }, (_, i) => {
  const base = 100 + Math.sin(i / 9) * 8 + i * 0.05
  return { t: 1700000000 + i * 86400, o: base, c: base + 0.4, h: base + 2, l: base - 1.5, v: 1e6 + (i % 13) * 4e4 }
})

const field = (over = {}) => ({
  id: 'info:test:1', label: 'V', formula: 'close', bindings: {},
  format: 'number', decimals: 2, color: null, suffix: '', ...over,
})

// ─── ADR — THE PLATFORM'S OWN DEFINITION ────────────────────────────────────

describe('ADR is the platform’s definition, not a new one', () => {
  // `api/services/screener/technicals.py`:
  //     window = bars[-21:] filtered on a truthy close
  //     adr    = sum((h - l) / c for b in window) / len(window)
  //     out["adr_pct"] = round(adr * 100, 2)
  // and `screener/identities.py` states the same sentence as the column's
  // non-negativity proof: "a mean of (high - low)/close over 21 sessions".
  const pythonADR = (bs) => {
    const w = bs.slice(-21).filter((b) => b.c)
    return (w.reduce((s, b) => s + (b.h - b.l) / b.c, 0) / w.length) * 100
  }

  it('⭐⭐ the starter formula reproduces `adr_pct` EXACTLY', () => {
    const f = field({ formula: 'sma((high - low) / close, 21) * 100' })
    const { value, error } = evaluateInfoField(f, bars, () => null)
    expect(error).toBe(null)
    expect(value).toBeCloseTo(pythonADR(bars), 12)
  })

  it('…and the 5-session window is `adr_pct_1w`', () => {
    const w = bars.slice(-5)
    const want = (w.reduce((s, b) => s + (b.h - b.l) / b.c, 0) / w.length) * 100
    const f = field({ formula: 'sma((high - low) / close, 5) * 100' })
    expect(evaluateInfoField(f, bars, () => null).value).toBeCloseTo(want, 12)
  })

  it('⛔ ADR IS NOT ATR, and the two really differ on these bars', () => {
    // The platform corrected `atr_pct = adr_pct` in production; a starter set
    // that quietly reproduced that confusion would reintroduce it.
    const adr = evaluateInfoField(field({ formula: 'sma((high - low) / close, 21) * 100' }), bars, () => null).value
    const atr = evaluateInfoField(field({ formula: 'atr(high, low, close, 14) / close * 100' }), bars, () => null).value
    expect(adr).not.toBeCloseTo(atr, 3)
  })
})

// ─── TYPE ───────────────────────────────────────────────────────────────────

describe('an info field must yield a NUMBER', () => {
  it('⭐ a numeric formula is accepted', () => {
    for (const f of ['close', 'sma((high - low) / close, 21) * 100', 'volume / sma(volume, 30)',
      '(close - ema(close, 20)) / ema(close, 20) * 100', 'rsi(close, 14)']) {
      expect(validateInfoFormula(f).ok, f).toBe(true)
    }
  })

  it('⛔⛔ a BOOLEAN formula is REFUSED — never rendered as 1 or 0', () => {
    // A member who typed a comparison and saw "1" would read it as a price, a
    // count or a ratio. The refusal points at the tab that wants it.
    for (const f of ['close > open', 'high < high[1] && low > low[1]', '!(close > open)']) {
      const r = validateInfoFormula(f)
      expect(r.ok, `${f} was admitted as a number`).toBe(false)
      expect(r.reason).toMatch(/Condition/)
    }
  })

  it('…and text that does not read back is refused by the parser’s own message', () => {
    expect(validateInfoFormula('close +').ok).toBe(false)
    expect(validateInfoFormula('').ok).toBe(false)
    expect(validateInfoFormula(null).ok).toBe(false)
  })

  it('⛔ a binding that cannot be read is refused by NAME', () => {
    const r = validateInfoFormula('a + 1', { a: 'nonsense' })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/`a`/)
  })
})

// ─── THE VALUE ──────────────────────────────────────────────────────────────

describe('the newest value', () => {
  it('⭐ it is the LAST bar’s, matching every built-in Info Row field', () => {
    const { value } = evaluateInfoField(field({ formula: 'close' }), bars, () => null)
    expect(value).toBe(bars[bars.length - 1].c)
  })

  it('⭐ …and it WALKS BACK over a trailing hole rather than printing nothing', () => {
    // The newest bar can be a whitespace pad or one an indicator has not reached.
    // Blanking a field whose answer is one bar back reads as "broken", not as
    // "this bar has no value yet".
    const padded = [...bars, { t: 1799999999, o: null, c: null, h: null, l: null, v: null }]
    const { value } = evaluateInfoField(field({ formula: 'close' }), padded, () => null)
    expect(value).toBe(bars[bars.length - 1].c)
  })

  it('⛔⛔ INSIDE THE WARM-UP IT IS `null` — never 0, NaN or Infinity', () => {
    const short = bars.slice(0, 10)
    const { value, error } = evaluateInfoField(
      field({ formula: 'sma((high - low) / close, 21) * 100' }), short, () => null,
    )
    expect(value).toBe(null)
    expect(error).toBe(null)          // not an error — simply not answerable yet
    expect(formatInfoValue(value, 'number', 2)).toBe(INFO_EMPTY)
  })

  it('⛔ an INFINITY is not a reading either', () => {
    const flat = bars.map((b) => ({ ...b, v: 0 }))
    const { value } = evaluateInfoField(field({ formula: 'close / volume' }), flat, () => null)
    expect(value).toBe(null)
  })

  it('⛔ a MISSING bound source says so and keeps the formula', () => {
    const f = field({ formula: 'a', bindings: { a: instanceSource('legacy:rsi', 'rsi') } })
    const r = evaluateInfoField(f, bars, () => null)
    expect(r.value).toBe(null)
    expect(r.error).toBe('Source unavailable')
    expect(r.missing).toEqual(['a'])
    expect(f.formula).toBe('a')
  })
})

// ─── FORMATTING ─────────────────────────────────────────────────────────────

describe('formatting is not calculation', () => {
  it('⭐ one value, five readings', () => {
    expect(formatInfoValue(0.0684, 'number', 2)).toBe('0.07')
    expect(formatInfoValue(0.0684, 'number', 4)).toBe('0.0684')
    expect(formatInfoValue(0.0684, 'percent', 2)).toBe('6.84%')
    expect(formatInfoValue(0.0684, 'currency', 2)).toBe('$0.07')
    expect(formatInfoValue(0.0684, 'integer', 2)).toBe('0')
    expect(formatInfoValue(1234567890, 'compact', 2)).toBe('1.2B')
  })

  it('⭐ a suffix rides alongside, for the units a format cannot express', () => {
    expect(formatInfoValue(1.42, 'number', 2, 'x')).toBe('1.42x')
    expect(formatInfoValue(6.84, 'number', 2, '%')).toBe('6.84%')
  })

  it('⛔ an absent value is the EM DASH, whatever the format', () => {
    for (const fmt of INFO_FORMATS) {
      expect(formatInfoValue(null, fmt, 2), fmt).toBe(INFO_EMPTY)
      expect(formatInfoValue(NaN, fmt, 2), fmt).toBe(INFO_EMPTY)
      expect(formatInfoValue(Infinity, fmt, 2), fmt).toBe(INFO_EMPTY)
      expect(formatInfoValue(undefined, fmt, 2), fmt).toBe(INFO_EMPTY)
    }
  })

  it('⚠️ COMPACT KEEPS ITS OWN PRECISION, matching the row it sits in', () => {
    // `headerFields.fmtVol` has printed `1.2M` beside these fields since before
    // this feature; a custom field obeying `decimals: 3` would print `1.234M`.
    expect(formatInfoValue(1234567, 'compact', 3)).toBe('1.2M')
    expect(formatInfoValue(340000, 'compact', 0)).toBe('340K')
  })

  it('decimals are clamped, not trusted', () => {
    expect(formatInfoValue(1.23456789, 'number', 99)).toBe('1.2346')
    expect(formatInfoValue(1.23456789, 'number', -5)).toBe('1')
  })
})

// ─── THE MODEL AND THE WRITE DOOR ───────────────────────────────────────────

const base = () => mergeChartSettings(JSON.stringify({}))
const reload = (cs) => mergeChartSettings(JSON.stringify(cs))

describe('the model', () => {
  it('⭐ a stable id is opaque and never the label', () => {
    const cs = addInfoField(base(), { label: 'ADR', formula: 'close' })
    const f = infoFieldsOf(cs)[0]
    expect(isInfoFieldId(f.id)).toBe(true)
    expect(f.id).not.toContain('ADR')
    const renamed = setInfoField(cs, f.id, { label: 'ADR 21' })
    expect(infoFieldsOf(renamed)[0].id).toBe(f.id)
    expect(infoFieldsOf(renamed)[0].format).toBe(f.format)
  })

  it('⭐⭐ creating a field ALSO puts it in the row — two writes, one action', () => {
    const cs = addInfoField(base(), { label: 'ADR', formula: 'close' })
    const id = infoFieldsOf(cs)[0].id
    expect(headerFieldKeys(cs.header)).toContain(id)
  })

  it('⭐ it is an ORDINARY key in `header.fields`, among the built-ins', () => {
    let cs = base()
    cs = { ...cs, header: { ...cs.header, fields: ['mcap', 'earn', 'rating'] } }
    cs = addInfoField(cs, { label: 'ADR', formula: 'close' })
    const id = infoFieldsOf(cs)[0].id
    expect(headerFieldKeys(cs.header)).toEqual(['mcap', 'earn', 'rating', id])
    cs = moveInfoRowField(cs, id, -1)
    expect(headerFieldKeys(cs.header)).toEqual(['mcap', 'earn', id, 'rating'])
    // …and it refuses to walk off the end rather than wrapping.
    cs = moveInfoRowField(cs, 'mcap', -1)
    expect(headerFieldKeys(cs.header)[0]).toBe('mcap')
  })

  it('⛔ DELETING removes the definition AND the slot, and touches nothing else', () => {
    let cs = { ...base(), header: { ...base().header, fields: ['mcap'] } }
    cs = addInfoField(cs, { label: 'A', formula: 'close' })
    cs = addInfoField(cs, { label: 'B', formula: 'volume' })
    const [a, b] = infoFieldsOf(cs)
    cs = removeInfoField(cs, a.id)
    expect(infoFieldsOf(cs).map((f) => f.label)).toEqual(['B'])
    expect(headerFieldKeys(cs.header)).toEqual(['mcap', b.id])
  })

  it('⛔ a refusal returns the SAME OBJECT', () => {
    const cs = addInfoField(base(), { label: 'A', formula: 'close' })
    const id = infoFieldsOf(cs)[0].id
    expect(addInfoField(cs, { label: 'X', formula: 'close > open' })).toBe(cs)   // boolean
    expect(setInfoField(cs, id, { formula: 'close > open' })).toBe(cs)
    expect(setInfoField(cs, 'nope', { label: 'x' })).toBe(cs)
    expect(removeInfoField(cs, 'nope')).toBe(cs)
    expect(setInfoFieldBinding(cs, id, 'NOT A KEY', 'close')).toBe(cs)
    expect(moveInfoRowField(cs, 'nope', 1)).toBe(cs)
  })

  it('⛔ a malformed row is dropped on load', () => {
    const cs = reload({
      ...base(),
      header: { ...base().header, infoFormulas: [null, 42, { id: 'x' }, { id: 'info:a', formula: 'close' }] },
    })
    expect(infoFieldsOf(cs).map((f) => f.id)).toEqual(['info:a'])
  })
})

describe('persistence', () => {
  it('⭐ a field survives a save → load cycle, whole', () => {
    let cs = addInfoField(base(), {
      label: 'ADR', formula: 'sma((high - low) / close, 21) * 100',
      format: 'number', decimals: 3, color: '#6ba3be', suffix: '%',
    })
    const id = infoFieldsOf(cs)[0].id
    cs = setInfoFieldBinding(cs, id, 'a', instanceSource('legacy:rsi', 'rsi'))
    const back = infoFieldsOf(reload(cs))[0]
    expect(back).toEqual({
      id,
      label: 'ADR',
      formula: 'sma((high - low) / close, 21) * 100',
      bindings: { a: '@legacy:rsi::rsi' },
      format: 'number',
      decimals: 3,
      color: '#6ba3be',
      suffix: '%',
    })
  })

  it('⛔ NO WRITE ON LOAD — an empty list, and a second merge is identical', () => {
    const once = reload(CHART_DEFAULTS)
    const twice = reload(once)
    expect(once.header.infoFormulas).toEqual([])
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
  })

  it('⛔⛔ NO COMPUTED STATE IS PERSISTED — no column, no value, no string', () => {
    const cs = addInfoField(base(), { label: 'ADR', formula: 'close', format: 'percent' })
    const stored = JSON.stringify(reload(cs).header.infoFormulas)
    expect(stored).toContain('close')          // the rule
    expect(stored).not.toMatch(/"value"/)      // never the answer
    expect(stored).not.toMatch(/"column"/)
    expect(stored).not.toMatch(/"text"/)
  })
})

// ─── THROUGH THE ENGINE ─────────────────────────────────────────────────────

const ctxFor = (instances, infoFields) => {
  const settings = { indicatorInstances: instances }
  const layout = computePaneLayout(instances, {
    chartHeight: 600, hasVolumeBand: false, separatorPx: SEPARATOR_PX,
    excludeKeys: paneFollowerKeys(instances, settings),
    keepKeys: paneOwnersNeeded(instances, settings),
  })
  return {
    enabled: true, instances, registry, bars, infoFields,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (s, d) => s.setData(d),
    paneLayout: layout,
    targetOf: (i) => resolveDisplayTarget(i, settings),
    resolvePlacement: (i, def) => resolvePlacement(i, def, {
      paneMargins: layout.bands, paneLayout: layout, volOverlaySet: new Set(),
      volSeparatePane: false, VOL_PANE_INDEX: 1,
      targetOf: (x) => resolveDisplayTarget(x, settings),
      derivedTargetOf: (x) => derivedTargetOf(x, settings),
    }),
  }
}

const rsiInst = (period = 14) => ({
  instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period }, hidden: false,
})
const maOfRsi = () => ({
  instanceId: 'inst:ma:1', defId: 'movingAverage', hidden: false,
  inputs: { source: instanceSource('legacy:rsi', 'rsi'), period: 5, maType: 'sma' },
})

describe('an info field inside the engine', () => {
  let fake
  let binder
  beforeEach(() => { __setPaneModeForTest('panes'); fake = createFakeChart(); binder = createBinder({ chart: fake.chart, LWC: fake.LWC }) })
  afterEach(() => { __setPaneModeForTest(null); vi.restoreAllMocks() })

  it('⭐ it reads price directly, with no indicator on the chart at all', () => {
    const f = field({ id: 'info:1', formula: 'sma((high - low) / close, 21) * 100' })
    binder.sync(ctxFor([], [f]))
    const { values, errors } = binder.infoValues()
    expect(errors.get('info:1')).toBeUndefined()
    expect(values.get('info:1')).toBeGreaterThan(0)
  })

  it('⭐⭐ …and it reads an INDICATOR OUTPUT through the same reference language', () => {
    const f = field({ id: 'info:1', formula: 'a', bindings: { a: instanceSource('legacy:rsi', 'rsi') } })
    binder.sync(ctxFor([rsiInst()], [f]))
    const v = binder.infoValues().values.get('info:1')
    // The value the RENDERER was handed for the newest bar — read off the
    // recorded `setData`, which is what the shipped double exposes.
    const b = binder.bindings().find((x) => x.key === 'legacy:rsi::rsi')
    const calls = fake.callsOf('setData').filter((c) => c.on === 'series' && c.id === b.series.__id)
    const drawn = calls[calls.length - 1].args[0]
    expect(v).toBeCloseTo(drawn[drawn.length - 1].value, 10)
  })

  it('⭐ …and through a DERIVED one — RSI → MA(RSI) → info, one sort', () => {
    const f = field({ id: 'info:1', formula: 'a', bindings: { a: instanceSource('inst:ma:1', 'ma') } })
    // The MA is listed FIRST, before the RSI it reads.
    binder.sync(ctxFor([maOfRsi(), rsiInst()], [f]))
    expect(binder.infoValues().values.get('info:1')).toBeGreaterThan(0)
    expect(binder.infoValues().errors.get('info:1')).toBeUndefined()
  })

  it('⭐ MULTIPLE bindings in one formula', () => {
    const f = field({
      id: 'info:1',
      formula: '(a - b) / b * 100',
      bindings: { a: instanceSource('legacy:rsi', 'rsi'), b: instanceSource('inst:ma:1', 'ma') },
    })
    binder.sync(ctxFor([rsiInst(), maOfRsi()], [f]))
    expect(binder.infoValues().errors.get('info:1')).toBeUndefined()
    expect(Number.isFinite(binder.infoValues().values.get('info:1'))).toBe(true)
  })

  it('⛔ IT TAKES NO PANE, NO SCALE, NO SERIES AND NO LEGEND PLOT', () => {
    const before = fake.callsOf('addSeries').length
    binder.sync(ctxFor([], [field({ id: 'info:1', formula: 'close' })]))
    expect(fake.callsOf('addSeries').length, 'an info field drew ink').toBe(before)
    expect(binder.bindings()).toHaveLength(0)
  })

  it('⭐ A HIDDEN SOURCE STILL CALCULATES — visibility is ink, not existence', () => {
    const f = field({ id: 'info:1', formula: 'a', bindings: { a: instanceSource('legacy:rsi', 'rsi') } })
    binder.sync(ctxFor([{ ...rsiInst(), hidden: true }], [f]))
    expect(binder.infoValues().errors.get('info:1')).toBeUndefined()
    expect(Number.isFinite(binder.infoValues().values.get('info:1'))).toBe(true)
  })

  it('⭐⭐ A SOURCE PARAMETER CHANGE RECOMPUTES IT; PRESENTATION DOES NOT', () => {
    const f = field({ id: 'info:1', formula: 'a', bindings: { a: instanceSource('legacy:rsi', 'rsi') } })
    binder.sync(ctxFor([rsiInst(14)], [f]))
    const first = binder.infoValues().values.get('info:1')
    const gen1 = binder.infoValues().generation

    // A new instances ARRAY, same inputs — what every settings write produces.
    binder.sync(ctxFor([{ ...rsiInst(14) }], [{ ...f }]))
    expect(binder.infoValues().generation, 'it recomputed for nothing').toBe(gen1)

    // Label, format, decimals, colour, suffix: none is in the memo key.
    binder.sync(ctxFor([{ ...rsiInst(14) }], [{
      ...f, label: 'Renamed', format: 'percent', decimals: 4, color: '#fff', suffix: 'x',
    }]))
    expect(binder.infoValues().generation, 'a presentation change ran the maths').toBe(gen1)
    expect(binder.infoValues().values.get('info:1')).toBe(first)

    // The RSI's PERIOD changes: a new column, a new answer.
    binder.sync(ctxFor([rsiInst(21)], [{ ...f }]))
    expect(binder.infoValues().generation).not.toBe(gen1)
    expect(binder.infoValues().values.get('info:1')).not.toBe(first)
  })

  it('⛔ a FORMULA change does recompute', () => {
    const f = field({ id: 'info:1', formula: 'close' })
    binder.sync(ctxFor([], [f]))
    const first = binder.infoValues().values.get('info:1')
    binder.sync(ctxFor([], [{ ...f, formula: 'high' }]))
    expect(binder.infoValues().values.get('info:1')).not.toBe(first)
    expect(binder.infoValues().values.get('info:1')).toBe(bars[bars.length - 1].h)
  })

  it('⛔ DELETING the field drops its value and leaves its sources alone', () => {
    const f = field({ id: 'info:1', formula: 'a', bindings: { a: instanceSource('legacy:rsi', 'rsi') } })
    binder.sync(ctxFor([rsiInst()], [f]))
    expect(binder.infoValues().values.size).toBe(1)
    binder.sync(ctxFor([rsiInst()], []))
    expect(binder.infoValues().values.size).toBe(0)
    expect(binder.bindings().some((b) => b.key === 'legacy:rsi::rsi')).toBe(true)
  })

  it('⛔ an info field is NOT a source for an indicator (the type rule)', () => {
    binder.sync(ctxFor([{
      instanceId: 'inst:ma:1', defId: 'movingAverage', hidden: false,
      inputs: { source: '@info:1::value', period: 5, maType: 'sma' },
    }], [field({ id: 'info:1', formula: 'close' })]))
    expect(binder.bindings().find((b) => b.key === 'inst:ma:1::ma')).toBeUndefined()
  })
})

// ─── DELETED SOURCE ─────────────────────────────────────────────────────────

describe('a deleted source severs an info field’s binding too', () => {
  it('⛔ the same one function, because there is one reference language', () => {
    let cs = setIndicatorEnabled(base(), 'rsi', true, registry)
    cs = addInfoField(cs, { label: 'RSI', formula: 'a' })
    const id = infoFieldsOf(cs)[0].id
    cs = setInfoFieldBinding(cs, id, 'a', instanceSource('legacy:rsi', 'rsi'))
    cs = removeInstance(cs, 'legacy:rsi', registry)

    const ref = infoFieldsOf(cs)[0].bindings.a
    expect(isSeveredSource(ref)).toBe(true)
    expect(parseSource(ref)).toBe(null)
    // The FORMULA and the presentation are untouched.
    expect(infoFieldsOf(cs)[0].formula).toBe('a')
    expect(infoFieldsOf(cs)[0].label).toBe('RSI')
    // …and re-adding RSI does NOT silently reconnect it.
    cs = setIndicatorEnabled(cs, 'rsi', true, registry)
    expect(parseSource(infoFieldsOf(cs)[0].bindings.a)).toBe(null)
  })
})

describe('normalisation is defensive', () => {
  it('an unknown format and a wild decimal fold to the defaults', () => {
    const cs = { header: { infoFormulas: [{ id: 'info:a', formula: 'close', format: 'runes', decimals: 99 }] } }
    const f = normaliseInfoFields(cs)[0]
    expect(f.format).toBe('number')
    expect(f.decimals).toBe(4)
  })
  it('a blob with no header at all yields an empty list', () => {
    expect(normaliseInfoFields(null)).toEqual([])
    expect(normaliseInfoFields({})).toEqual([])
  })
})
