// ONE SETTING CHANGED ON A FORM'S FORMULAS (the New formula window's Inputs tab).
import { describe, it, expect } from 'vitest'
import HOUSE from '../../house/houseIndicators.json'
import { parseFormula } from '../../engine/ast/parse'
import { outputTrees } from './slots'
import { settingsOfTrees } from './derivedSettings'
import { formulasWithSetting } from './settingsOnFormulas'

const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(`${src}: ${r.error}`); return r.ast }
const list = (pairs) => pairs.map(([key, src]) => ({ key, tree: P(src) }))
const reparsed = (trees, sources) => trees.map((o) => (sources[o.key] ? { key: o.key, tree: P(sources[o.key]) } : o))

describe('a setting changed on formulas', () => {
  it('rewrites the formula text of every output the number sits in, and nothing else', () => {
    const trees = list([
      ['count', 'sum(((close <= close[1] * 0.997) && (volume > volume[1])) ? 1 : 0, 20)'],
      ['day', '(close <= close[1] * 0.997) && (volume > volume[1])'],
      ['avg', 'sma(volume, 50)'],
    ])
    const level = settingsOfTrees(trees).find((s) => s.value === 0.997)
    const out = formulasWithSetting(trees, level, 0.995)
    expect(out.ok, JSON.stringify(out)).toBe(true)
    expect(Object.keys(out.sources).sort()).toEqual(['count', 'day'])          // `avg` is untouched
    expect(out.sources.count).toContain('0.995')
    expect(out.sources.day).toContain('0.995')
    expect(JSON.stringify(out.sources)).not.toContain('0.997')
    const after = settingsOfTrees(reparsed(trees, out.sources))
    expect(after.find((s) => s.role === 'multiple')).toMatchObject({ value: 0.995 })
    expect(after.find((s) => s.role === 'multiple').slots).toHaveLength(2)
    expect(after.find((s) => s.caption.startsWith('SMA 50'))).toMatchObject({ value: 50 })
  })

  it('a length, a look-back and a number written negative', () => {
    const a = list([['value', 'close - close[5]']])
    expect(formulasWithSetting(a, settingsOfTrees(a)[0], 8).sources.value).toBe('close - close[8]')
    const b = list([['value', '((open - close[1]) / close[1]) * 100 <= -3']])
    const [neg] = settingsOfTrees(b)
    const out = formulasWithSetting(b, neg, -4.5)
    expect(out.ok).toBe(true)
    expect(settingsOfTrees(reparsed(b, out.sources))[0].value).toBe(-4.5)
    const c = list([['value', 'close > bbUpper(close, 20, 2)']])
    const len = settingsOfTrees(c).find((s) => s.role === 'length')
    const outC = formulasWithSetting(c, len, 30)
    expect(outC.sources.value).toContain('bbUpper(close, 30, 2)')              // the call form, as a member types it
  })

  it('refuses in words what the number cannot be, and writes nothing', () => {
    const trees = list([['value', 'sma(close, 20) > 70']])
    const len = settingsOfTrees(trees).find((s) => s.role === 'length')
    for (const bad of [0, 2.5, NaN]) {
      const out = formulasWithSetting(trees, len, bad)
      expect(out.ok).toBe(false)
      expect(out.message).toMatch(/whole number of at least 1|Enter a number/)
      expect(out.sources).toBeUndefined()
    }
  })

  it('⛔ COMPARE-AND-SET: a setting read from other formulas, or the same value, writes nothing', () => {
    const before = list([['value', 'sma(close, 20) > 70']])
    const len = settingsOfTrees(before).find((s) => s.role === 'length')
    const moved = list([['value', 'sma(close, 25) > 70']])
    expect(formulasWithSetting(moved, len, 30)).toEqual({ ok: false, stale: true })
    expect(formulasWithSetting(before, len, 20)).toEqual({ ok: false, stale: true })
    expect(formulasWithSetting([], len, 30)).toEqual({ ok: false, stale: true })
  })

  it.each(HOUSE.indicators.map((it) => [it.slug, it]))('%s: every setting can be written into its formulas and reads back', (_slug, item) => {
    const trees = outputTrees(item.definition)
    for (const s of settingsOfTrees(trees)) {
      const next = s.whole ? s.value + 1 : (s.negated ? s.value - 0.5 : Number((s.value * 1.1 + 0.01).toFixed(4)))
      const out = formulasWithSetting(trees, s, next)
      expect(out.ok, `${s.captionFull} -> ${next}: ${out.message || 'stale'}`).toBe(true)
      const after = settingsOfTrees(reparsed(trees, out.sources))
      expect(after.some((a) => a.value === next && a.role === s.role && a.slots.length >= s.slots.length), s.captionFull).toBe(true)
    }
  })
})
