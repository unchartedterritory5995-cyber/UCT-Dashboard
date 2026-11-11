// app/src/components/chart/engine/readout.va3.test.js
//
// ─── UCT RS Phase 2a visual round, unit VA3 · the readout surfaces' helpers ──
//
// The pure half of spec items A1 (glance rows vs detail rows), A8 (the pane
// label never goes blank) and A9 (one name grammar, `UCT RS · SPY`). Every
// helper answers `null` (or the rows unchanged) for a definition without a
// `readout[]`, and the control cases below pin that on RSI and MACD.
import { describe, it, expect } from 'vitest'
import * as engineRegistry from './nativeRegistry'
import {
  legendChips, chipValueText, declaresReadout, readoutChipName, readoutDateText,
  readoutFallbackValue, splitReadoutRows,
} from './readout'

const binding = (defId, plotKey, instanceId) => ({
  key: `${instanceId}::${plotKey}`, instanceId, defId, plotKey, series: { __id: `${defId}/${plotKey}` },
})
// The split reads a definition's own `detailOf` as a fallback; the registered
// rsLine carries its own since VA2. These cases test the RESOLVED rows' field, so
// the fixture is the definition with `detailOf` stripped from its entries (2026-11-07).
const RS_REGISTERED = engineRegistry.getDefinition('rsLine')
const RS = { ...RS_REGISTERED, readout: (RS_REGISTERED.readout || []).map((e) => { const { detailOf, ...rest } = e; return rest }) }
const RSI = engineRegistry.getDefinition('rsi')
const MACD = engineRegistry.getDefinition('macd')

describe('declaresReadout — the opt-in is the declaration', () => {
  it('UCT RS declares one; RSI and MACD do not', () => {
    expect(declaresReadout(RS)).toBe(true)
    expect(declaresReadout(RSI)).toBe(false)
    expect(declaresReadout(MACD)).toBe(false)
    expect(declaresReadout(null)).toBe(false)
    expect(declaresReadout({ readout: [] })).toBe(false)
  })
})

describe('A9 · readoutChipName — `UCT RS · SPY`, never `RS(SPY)`', () => {
  const rsInst = (inputs = {}, over = {}) => ({ instanceId: 'inst:rsLine:1', defId: 'rsLine', inputs, hidden: false, ...over })
  const rsChip = (inputs, opts) => legendChips([{ ...binding('rsLine', 'rsLine', 'inst:rsLine:1'), lastValue: 0.4187 }],
    null, engineRegistry, [rsInst(inputs)], opts)[0]

  it('default benchmark, no envelope yet: `UCT RS · SPY`; the member chose QQQ: `UCT RS · QQQ`', () => {
    expect(readoutChipName(rsChip({}), RS)).toBe('UCT RS · SPY')
    expect(readoutChipName(rsChip({ benchmark: 'QQQ' }), RS)).toBe('UCT RS · QQQ')
    expect(readoutChipName(rsChip({}), RS)).not.toMatch(/RS\(/)
  })

  it('the resolved benchmark and the rating follow the chip suffix grammar once the envelope lands', () => {
    const chip = rsChip({ benchmark: 'SECTOR' }, {
      scalarsOf: () => ({ benchmark: { resolved: 'XLK' }, rating: { ibd: 94 } }),
    })
    expect(readoutChipName(chip, RS)).toBe('UCT RS · XLK · 94')
  })

  it('works whether legendParams names the benchmark or is empty (the engineering map\'s design)', () => {
    const noParams = { ...RS, meta: { ...RS.meta, legendParams: [] } }
    // the chip suffix carries the benchmark row; the stem is the short name
    expect(readoutChipName({ label: 'UCT RS', suffix: ' · SPY' }, noParams)).toBe('UCT RS · SPY')
    // the calculation frame rides at the end, as the pane label prints it
    expect(readoutChipName({ label: 'UCT RS', suffix: ' · SPY', frameSuffix: ' · 1W' }, noParams)).toBe('UCT RS · SPY · 1W')
  })

  it('⛔ control: RSI and MACD get null, and their chip label/text are untouched', () => {
    const rsi = legendChips([{ ...binding('rsi', 'rsi', 'i:rsi'), lastValue: 54.3 }], null, engineRegistry,
      [{ instanceId: 'i:rsi', defId: 'rsi', inputs: { period: 14 } }])[0]
    expect(readoutChipName(rsi, RSI)).toBeNull()
    expect(rsi.text).toBe('RSI(14) 54.3')
    const macdPlot = MACD.plots.find((p) => p.legend && p.legend.hide !== true)
    const macd = legendChips([{ ...binding('macd', macdPlot.key, 'i:macd'), lastValue: 1.23 }], null, engineRegistry,
      [{ instanceId: 'i:macd', defId: 'macd', inputs: {} }])[0]
    expect(readoutChipName(macd, MACD)).toBeNull()
    expect(readoutFallbackValue(MACD, { legend: { lastValue: 1 } }, 2)).toBeNull()
    expect(readoutFallbackValue(RSI, null, 1)).toBeNull()
  })
})

describe('A8 · readoutFallbackValue — muted, dated, never blank', () => {
  it('`payload.legend.lastValue` at the plot decimals with `asOf`: `0.4700 · Nov 4`', () => {
    expect(readoutFallbackValue(RS, { legend: { lastValue: 0.47, asOf: 20261104 } }, 4))
      .toEqual({ text: '0.4700 · Nov 4', muted: true })
    expect(readoutFallbackValue(RS, { legend: { lastValue: 0.4187236, asOf: '20261105' } }, 4).text).toBe('0.4187 · Nov 5')
  })

  it('no finite value in the window, or no envelope at all → a muted dash', () => {
    expect(readoutFallbackValue(RS, { legend: { lastValue: null } }, 4)).toEqual({ text: '—', muted: true })
    expect(readoutFallbackValue(RS, null, 4)).toEqual({ text: '—', muted: true })
    expect(readoutFallbackValue(RS, { legend: { lastValue: Number.NaN } }, 4).text).toBe('—')
  })

  it('an unparsable date prints the value alone rather than a wrong date', () => {
    expect(readoutFallbackValue(RS, { legend: { lastValue: 0.5, asOf: 'yesterday' } }, 4).text).toBe('0.5000')
  })

  it('readoutDateText reads YYYYMMDD as a number, a string, or with dashes', () => {
    expect(readoutDateText(20261104)).toBe('Nov 4')
    expect(readoutDateText('2026-01-31')).toBe('Jan 31')
    expect(readoutDateText('20261399')).toBe('')
    expect(readoutDateText(null)).toBe('')
  })

  it('the hidden chip and the valued chip never reach it (the surface checks `chipValueText` first)', () => {
    expect(chipValueText({ value: null })).toBe('')
    expect(chipValueText({ value: 0.4187, decimals: 4 })).toBe('0.4187')
  })
})

describe('A1 · splitReadoutRows — glance rows in the menu, detail rows in their card', () => {
  const rows = [
    { key: 'benchmark', label: 'Benchmark', text: 'S&P 500 (SPY)' },
    { key: 'rating', label: 'Rating', text: '94 · fast 91' },
    { key: 'ibd', label: 'IBD-style', text: '94', detailOf: 'rating' },
    { key: 'fast', label: 'Fast', text: '91', detailOf: 'rating' },
    { key: 'rsHigh', label: 'Last RS high', text: '1 bar ago · before price' },
    { key: 'barsAgo', label: 'Bars ago', text: '1', detailOf: 'rsHigh' },
    { key: 'mansfieldValue', label: 'Value', text: '+18.7%', detailOf: 'mansfield' },
  ]

  it('the resolved row\'s `detailOf` (the contract VA2 stamps) groups it under its glance row, in order', () => {
    const { glance, details } = splitReadoutRows(rows, RS)
    expect(glance.map((r) => r.key)).toEqual(['benchmark', 'rating', 'rsHigh'])
    expect(details.get('rating').map((r) => r.key)).toEqual(['ibd', 'fast'])
    expect(details.get('rsHigh').map((r) => r.key)).toEqual(['barsAgo'])
  })

  it('a detail row whose glance row is absent (Mansfield view off) renders nowhere in the glance list', () => {
    const { glance, details } = splitReadoutRows(rows, RS)
    expect(glance.find((r) => r.key === 'mansfieldValue')).toBeUndefined()
    expect(details.get('mansfield').map((r) => r.key)).toEqual(['mansfieldValue'])
  })

  it('the definition\'s own entry can carry `detailOf` when the resolved row does not', () => {
    const def = { readout: [{ key: 'a' }, { key: 'b', detailOf: 'a' }] }
    const { glance, details } = splitReadoutRows([{ key: 'a', text: '1' }, { key: 'b', text: '2' }], def)
    expect(glance.map((r) => r.key)).toEqual(['a'])
    expect(details.get('a').map((r) => r.key)).toEqual(['b'])
  })

  it('⛔ backward compatible: with no `detailOf` anywhere every row is a glance row, in the order given', () => {
    const plain = rows.map((r) => { const o = { ...r }; delete o.detailOf; return o })
    const { glance, details } = splitReadoutRows(plain, RS)
    expect(glance).toEqual(plain)
    expect(details.size).toBe(0)
    expect(splitReadoutRows(undefined, null)).toEqual({ glance: [], details: new Map() })
  })
})
