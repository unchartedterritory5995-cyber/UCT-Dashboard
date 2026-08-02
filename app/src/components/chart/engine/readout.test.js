import { describe, it, expect } from 'vitest'
import { engineChips, chipsBySlot, LEGACY_SLOTS } from './readout'
import * as engineRegistry from './nativeRegistry'

/** A binding as `binder.bindings()` returns it, with a stand-in series object. */
const binding = (defId, plotKey, instanceId = `legacy:${defId}`) => ({
  key: `${instanceId}::${plotKey}`, instanceId, defId, plotKey, series: { __id: `${defId}/${plotKey}` },
})

const seriesData = (pairs) => new Map(pairs.map(([b, v]) => [b.series, { value: v }]))

describe('engineChips — the legend an engine-drawn indicator must still produce', () => {
  const RSI_INST = { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14, color: '#7b68ee' } }

  it('reproduces the LEGACY RSI chip byte for byte', () => {
    // StockChart.jsx:9590 — `RSI(${period}) ${value.toFixed(1)}` in the
    // indicator's colour. A migrated RSI that reads "RSI 54.32" is a regression
    // the pixel gate cannot see.
    const b = binding('rsi', 'rsi')
    const chips = engineChips([b], seriesData([[b, 54.321]]), engineRegistry, [RSI_INST])
    expect(chips).toHaveLength(1)
    expect(chips[0].text).toBe('RSI(14) 54.3')
    expect(chips[0].color).toBe('#7b68ee')
    expect(chips[0].slot).toBe('rsi')
  })

  it('takes the colour from the INSTANCE, not the definition default', () => {
    const b = binding('rsi', 'rsi')
    const chips = engineChips([b], seriesData([[b, 50]]), engineRegistry,
      [{ ...RSI_INST, inputs: { period: 7, color: '#ff0000' } }])
    expect(chips[0].text).toBe('RSI(7) 50.0')
    expect(chips[0].color).toBe('#ff0000')
  })

  it('falls back to the DEFINITION default when the instance sets nothing', () => {
    // "unset means current default" — the same rule the migrator preserves. An
    // instance whose inputs are `{}` must still read `RSI(14)` in `#7b68ee`,
    // because that is what the chart draws.
    const b = binding('rsi', 'rsi')
    const chips = engineChips([b], seriesData([[b, 61.25]]), engineRegistry,
      [{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: {} }])
    expect(chips[0].text).toBe('RSI(14) 61.3')
    expect(chips[0].color).toBe('#7b68ee')
  })

  it('reproduces MACD\'s two chips and DROPS the histogram, as legacy does', () => {
    const inst = { instanceId: 'legacy:macd', defId: 'macd', inputs: {} }
    const bm = binding('macd', 'macd'); const bs = binding('macd', 'signal'); const bh = binding('macd', 'histogram')
    const chips = engineChips([bm, bs, bh], seriesData([[bm, 0.12345], [bs, 0.09876], [bh, 0.02469]]),
      engineRegistry, [inst])
    expect(chips.map(c => c.text)).toEqual(['MACD 0.1235', 'SIG 0.0988'])
    expect(chips.map(c => c.slot)).toEqual(['macd', 'macdSig'])
  })

  it('emits NO chip for a price overlay the legacy legend never showed', () => {
    // BB and VWAP have no legend chip today. A migration that ADDS one is just
    // as much a regression as one that removes it.
    const bbInst = { instanceId: 'legacy:bb', defId: 'bb', inputs: {} }
    const bs = ['upper', 'middle', 'lower'].map(k => binding('bb', k))
    expect(engineChips(bs, seriesData(bs.map(b => [b, 100])), engineRegistry, [bbInst])).toEqual([])

    const vwapInst = { instanceId: 'legacy:vwap', defId: 'vwap', inputs: {} }
    const bv = binding('vwap', 'vwap')
    expect(engineChips([bv], seriesData([[bv, 100]]), engineRegistry, [vwapInst])).toEqual([])
  })

  it('emits NO chip for a definition that declares no legend at all', () => {
    // The four pilots declare `legend`; the other ten natives do not, and until
    // their own flip lands their chips are still the hand-written ones. A
    // definition with no declaration must contribute NOTHING rather than an
    // undeclared "ATR 2.70" appearing next to the legacy "ATR(14) 2.7000".
    const inst = { instanceId: 'legacy:atr', defId: 'atr', inputs: {} }
    const b = binding('atr', 'atr')
    expect(engineChips([b], seriesData([[b, 2.7]]), engineRegistry, [inst])).toEqual([])
  })

  it('a bar the series has no value on produces no chip, never NaN', () => {
    const b = binding('rsi', 'rsi')
    expect(engineChips([b], new Map(), engineRegistry, [RSI_INST])).toEqual([])
    expect(engineChips([b], seriesData([[b, undefined]]), engineRegistry, [RSI_INST])).toEqual([])
    expect(engineChips([b], seriesData([[b, NaN]]), engineRegistry, [RSI_INST])).toEqual([])
  })

  it('never throws on the shapes a caller can actually hand it', () => {
    // It runs inside `processCrosshair`, on the rAF flush. A throw there takes
    // the whole legend down mid-hover, so every argument is optional-shaped.
    expect(engineChips(null, null, null, null)).toEqual([])
    expect(engineChips([binding('rsi', 'rsi')], undefined, engineRegistry, undefined)).toEqual([])
    expect(engineChips([null, undefined, {}], new Map(), engineRegistry, [])).toEqual([])
  })

  it('chipsBySlot keys by the legacy crosshairData field', () => {
    const b = binding('rsi', 'rsi')
    const by = chipsBySlot(engineChips([b], seriesData([[b, 54.321]]), engineRegistry, [RSI_INST]))
    expect(by.rsi.value).toBeCloseTo(54.321, 6)
    expect(by.rsi.text).toBe('RSI(14) 54.3')
  })
})

describe('the slot bridge cannot silently lose a chip', () => {
  it('every definition that DECLARES a visible chip has a legacy slot', () => {
    // The rail. A B3 migration that declares `legend` on a plot but forgets the
    // slot would produce a chip nothing renders — invisible everywhere.
    const missing = []
    let considered = 0
    for (const def of engineRegistry.listDefinitions()) {
      for (const plot of def.plots) {
        if (plot.style === 'hlines') continue
        if (!plot.legend || plot.legend.hide === true) continue
        considered++
        if (!LEGACY_SLOTS[`${def.id}::${plot.key}`]) missing.push(`${def.id}::${plot.key}`)
      }
    }
    // A loop that saw nothing passes vacuously. Three visible chips are declared
    // today (rsi.rsi, macd.macd, macd.signal); the count only ever grows.
    expect(considered, 'no plot declares a visible legend — this rail is vacuous').toBeGreaterThanOrEqual(3)
    expect(missing).toEqual([])
  })

  it('every legacy slot names a plot that actually exists', () => {
    const orphans = Object.keys(LEGACY_SLOTS).filter((k) => {
      const [defId, plotKey] = k.split('::')
      const def = engineRegistry.getDefinition(defId)
      return !def || !def.plots.some(p => p.key === plotKey)
    })
    expect(orphans).toEqual([])
  })

  it('every slot is a field the shipped legend actually reads', () => {
    // `chipsBySlot` writes into `crosshairData.<slot>`, and `legChips`
    // (StockChart.jsx:9589-9599) enumerates the fields it renders. A slot the
    // legend never reads is a chip that lands nowhere — the same invisible
    // failure the rail above catches from the other direction.
    const RENDERED_FIELDS = new Set([
      'rsi', 'macd', 'macdSig', 'stochK', 'stochD', 'atr', 'sar',
      'ichimokuTenkan', 'ichimokuKijun',
    ])
    const unread = Object.values(LEGACY_SLOTS).filter(f => !RENDERED_FIELDS.has(f))
    expect(unread).toEqual([])
  })
})
