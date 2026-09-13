// app/src/components/chart/ChartSettingsModal.candles.test.jsx
//
// ─── PHASE B · CANDLES ARE A PRESENTATION STYLE, OFFERED WHERE THEY MEAN ────
//
// ⭐⭐ THE CLAIM. An eligible direct symbol series can be drawn as candles from
// the style control a member already uses, and switching keeps the instance:
// same id, same source, same placement, same display name. Only the renderer
// changes.
//
// ⛔ AND THE OFFER IS THE ENGINE'S ANSWER, NOT THE UI'S OPINION. This file drives
// the real settings tab, so a future edit that widened the dropdown without
// widening capability — or the reverse — goes red here rather than on a member's
// chart.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import * as registry from './engine/nativeRegistry'
import { createDirectSeries, lastCreatedInstance } from './discoveryCatalog'
import { symbolSource } from './engine/sourceRef'
import { clearSecondaryBars, primeSecondaryBars } from './engine/secondaryBars'
import { resolvePlotStyle, resolveCandleColors } from './engine/presentation'

// ⚠️ THE PROVIDER FAMILY IS THE SEMANTIC HALF OF CAPABILITY and it normally
// arrives over the network. Doubling the registry — never the capability
// function — is what lets these cases state a family without a fetch.
vi.mock('../../hooks/useBreadthSymbols', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, symbolFamily: (sym) => (sym === 'UCTA50' ? 'breadth' : 'security') }
})

/** A genuine auction bar. */
const secBar = (t, base) => ({ t, o: base, h: base + 2, l: base - 1.5, c: base + 0.5, v: 1000 })
/** A breadth bar as `breadth_symbols.py` builds one — structurally complete. */
const brBar = (t, prev, v) => ({ t, o: prev, h: Math.max(prev, v), l: Math.min(prev, v), c: v, v: 0 })

const TF = 'D'
const WINDOW = 400

/** Settings holding one direct series on `symbol`, with its bars primed. */
function withSeries(symbol, bars) {
  primeSecondaryBars(symbol, TF, WINDOW, { bars })
  let cs = mergeChartSettings({})
  const next = createDirectSeries(cs, symbolSource(symbol, 'close'), registry, { name: symbol })
  const minted = lastCreatedInstance(cs, next)
  return { cs: next, id: minted.instanceId }
}

const show = (cs, onChange = () => {}) => render(
  <ChartSettingsModal open settings={cs} onChange={onChange} onClose={() => {}} />,
)
const openIndicators = () => fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
const expand = (re) => {
  const btn = [...document.body.querySelectorAll('[data-row-id] [aria-expanded]')]
    .find((b) => re.test(b.textContent || ''))
  expect(btn, `no active row matching ${re}`).toBeTruthy()
  fireEvent.click(btn)
}
const styleSelect = (label) => screen.getByLabelText(new RegExp(`${label} plot style`, 'i'))
const styleOptions = (label) => [...styleSelect(label).options].map((o) => o.textContent)

beforeEach(() => { clearSecondaryBars() })
afterEach(cleanup)

// ─── who is offered candles ────────────────────────────────────────────────

describe('Candles is offered only where the source can mean it', () => {
  it('⭐ an ordinary security with real bars is offered Candles', () => {
    const { cs } = withSeries('QQQ', [secBar('2026-09-01', 700), secBar('2026-09-02', 702)])
    show(cs)
    openIndicators()
    expand(/^QQQ$/)
    expect(styleOptions('QQQ')).toContain('Candles')
  })

  it('⭐ …and so is a second one — the rule is the family, not the ticker', () => {
    const { cs } = withSeries('SPY', [secBar('2026-09-01', 760), secBar('2026-09-02', 762)])
    show(cs)
    openIndicators()
    expand(/^SPY$/)
    expect(styleOptions('SPY')).toContain('Candles')
  })

  it('⛔⛔ BREADTH IS NOT, THOUGH ITS BARS CARRY o/h/l/c — the UI cannot bypass the engine', () => {
    // ⚰️ The bars are structurally complete: `breadth_symbols.py` writes the open
    // as YESTERDAY'S value and derives the wick from the pair. A control that
    // offered candles here would draw an authoritative-looking, meaningless
    // picture — and the engine would clamp it away, which is worse than not
    // offering it because the member would have chosen something that did nothing.
    const { cs } = withSeries('UCTA50', [brBar('2026-09-01', 45, 47.9), brBar('2026-09-02', 47.9, 46.1)])
    show(cs)
    openIndicators()
    expand(/^UCTA50$/)
    expect(styleOptions('UCTA50'), 'a breadth measure was offered candles')
      .not.toContain('Candles')
    // …and the styles a scalar CAN wear are all still there.
    expect(styleOptions('UCTA50')).toEqual(
      expect.arrayContaining(['Line', 'Histogram', 'Dots', 'Area']),
    )
  })

  it('⛔ an ordinary indicator is not offered candles', () => {
    show(mergeChartSettings({ indicators: { rsi: { enabled: true } } }))
    openIndicators()
    expand(/^RSI \(/)
    expect(styleOptions('RSI \\(14\\)')).not.toContain('Candles')
  })

  it('⛔ …nor a moving average, whose source is a column and not an instrument', () => {
    const cs = mergeChartSettings({
      indicators: { rsi: { enabled: true } },
      indicatorInstances: [
        { instanceId: 'legacy:rsi', defId: 'rsi', hidden: false, inputs: {} },
        { instanceId: 'inst:movingAverage:1', defId: 'movingAverage', hidden: false,
          inputs: { source: '@legacy:rsi::rsi', period: 5 } },
      ],
    })
    show(cs)
    openIndicators()
    expand(/^MA \(/)
    expect(styleOptions('MA \\(5\\)')).not.toContain('Candles')
  })

  it('⛔⛔ AN UNCLASSIFIED SOURCE IS NOT OFFERED — no flash of a style that vanishes', () => {
    // Capability fails closed while the bars have not landed, so the option never
    // appears and then disappears; it simply is not there until the source is
    // known. Same settings, no primed bars.
    let cs = mergeChartSettings({})
    const next = createDirectSeries(cs, symbolSource('QQQ', 'close'), registry, { name: 'QQQ' })
    show(next)
    openIndicators()
    expand(/^QQQ$/)
    expect(styleOptions('QQQ')).not.toContain('Candles')
  })
})

// ─── switching keeps the instance ──────────────────────────────────────────

describe('switching style keeps the instance', () => {
  it('⭐⭐ Line → Candles → Line writes only the presentation', () => {
    const { cs, id } = withSeries('QQQ', [secBar('2026-09-01', 700), secBar('2026-09-02', 702)])
    const onChange = vi.fn()
    show(cs, onChange)
    openIndicators()
    expand(/^QQQ$/)

    const before = cs.indicatorInstances.find((i) => i.instanceId === id)
    expect(styleOptions('QQQ'), 'candles was not offered, so this case is vacuous')
      .toContain('Candles')
    fireEvent.change(styleSelect('QQQ'), { target: { value: 'candles' } })
    expect(onChange, 'the style write was refused').toHaveBeenCalled()
    const asCandles = onChange.mock.calls.at(-1)[0]
    const inst = asCandles.indicatorInstances.find((i) => i.instanceId === id)

    expect(inst, 'the instance was replaced rather than restyled').toBeTruthy()
    expect(inst.instanceId).toBe(before.instanceId)
    expect(inst.inputs.source, 'the style write touched the SOURCE').toBe('sym:QQQ:close')
    expect(inst.display).toEqual(before.display)
    expect(inst.placement).toEqual(before.placement)
    expect(asCandles.indicatorInstances).toHaveLength(cs.indicatorInstances.length)
    // ⚠️ THE RESOLVED ANSWER, NOT THE SLOT. A single-output row does not name its
    // output, so the existing writer stores this at the instance level — which is
    // its business, and not a fact this case should pin.
    expect(resolvePlotStyle(inst, { key: 'value', style: 'line' }, { ohlcCapable: true }))
      .toBe('candles')

    // …and back, through the same control. The writer DELETES a default rather
    // than storing `line`, which is the rule every presentation key here follows.
    cleanup()
    const onChange2 = vi.fn()
    show(asCandles, onChange2)
    openIndicators()
    expand(/^QQQ$/)
    expect(styleSelect('QQQ').value).toBe('candles')
    fireEvent.change(styleSelect('QQQ'), { target: { value: 'line' } })
    const back = onChange2.mock.calls.at(-1)[0].indicatorInstances
      .find((i) => i.instanceId === id)
    expect(resolvePlotStyle(back, { key: 'value', style: 'line' }, { ohlcCapable: true }))
      .toBe('line')
    expect(JSON.stringify(back), 'a default was stored rather than deleted')
      .not.toMatch(/candles/)
    expect(back.inputs.source).toBe('sym:QQQ:close')
    expect(back.instanceId).toBe(id)
  })

  it('⭐ a saved Candles instance RECONSTRUCTS as candles', () => {
    const { cs, id } = withSeries('QQQ', [secBar('2026-09-01', 700)])
    const stored = {
      ...cs,
      indicatorInstances: cs.indicatorInstances.map((i) => (i.instanceId === id
        ? { ...i, presentation: { plotStyle: 'candles' } } : i)),
    }
    const reloaded = mergeChartSettings(JSON.parse(JSON.stringify(stored)))
    const inst = reloaded.indicatorInstances.find((i) => i.instanceId === id)
    // The resolver is the authority, and it still needs the capability answer —
    // a reconstructed candle over a source that lost its bars reads as a line.
    expect(resolvePlotStyle(inst, { key: 'value', style: 'line' }, { ohlcCapable: true }))
      .toBe('candles')

    show(reloaded)
    openIndicators()
    expand(/^QQQ$/)
    expect(styleSelect('QQQ').value).toBe('candles')
  })
})

// ─── the appearance controls ───────────────────────────────────────────────

describe('candle colours', () => {
  const candleSettings = () => {
    const { cs, id } = withSeries('QQQ', [secBar('2026-09-01', 700)])
    return {
      id,
      cs: {
        ...cs,
        indicatorInstances: cs.indicatorInstances.map((i) => (i.instanceId === id
          ? { ...i, presentation: { plotStyle: 'candles' } } : i)),
      },
    }
  }

  it('⭐⭐ they default to the CHART’s own candle colours, and store nothing', () => {
    const { cs, id } = candleSettings()
    show(cs)
    openIndicators()
    expand(/^QQQ$/)
    expect(screen.getByLabelText(/QQQ up candle/i).value).toBe(cs.candles.upColor)
    expect(screen.getByLabelText(/QQQ down candle/i).value).toBe(cs.candles.downColor)
    // Nothing but the style is stored — a saved chart is not bloated with the
    // defaults it already carries.
    const inst = cs.indicatorInstances.find((i) => i.instanceId === id)
    expect(Object.keys(inst.presentation)).toEqual(['plotStyle'])
  })

  it('⭐ changing one stores that one, and only that one', () => {
    const { cs, id } = candleSettings()
    const onChange = vi.fn()
    show(cs, onChange)
    openIndicators()
    expand(/^QQQ$/)
    fireEvent.change(screen.getByLabelText(/QQQ up candle/i), { target: { value: '#00ff00' } })
    const inst = onChange.mock.calls.at(-1)[0].indicatorInstances.find((i) => i.instanceId === id)
    const colors = resolveCandleColors(inst, { key: 'value' }, cs.candles)
    expect(colors.upColor).toBe('#00ff00')
    expect(colors.downColor, 'the untouched colour was stored too')
      .toBe(cs.candles.downColor)
    expect(JSON.stringify(inst)).not.toMatch(cs.candles.downColor)
    expect(resolvePlotStyle(inst, { key: 'value', style: 'line' }, { ohlcCapable: true }))
      .toBe('candles')
  })

  it('⛔ returning a colour to the chart’s own DELETES the override', () => {
    const { cs, id } = candleSettings()
    const withOverride = {
      ...cs,
      indicatorInstances: cs.indicatorInstances.map((i) => (i.instanceId === id
        ? { ...i, presentation: { plotStyle: 'candles', upColor: '#00ff00' } } : i)),
    }
    const onChange = vi.fn()
    show(withOverride, onChange)
    openIndicators()
    expand(/^QQQ$/)
    fireEvent.change(screen.getByLabelText(/QQQ up candle/i),
      { target: { value: cs.candles.upColor } })
    const inst = onChange.mock.calls.at(-1)[0].indicatorInstances.find((i) => i.instanceId === id)
    expect(JSON.stringify(inst), 'the override survived a return to the default')
      .not.toMatch(/00ff00/)
    expect(resolvePlotStyle(inst, { key: 'value', style: 'line' }, { ohlcCapable: true }))
      .toBe('candles')
  })

  it('⛔⛔ THEY ARE NOT SHOWN FOR A LINE — no inert clutter, no candle-only options', () => {
    const { cs } = withSeries('QQQ', [secBar('2026-09-01', 700)])
    show(cs)
    openIndicators()
    expand(/^QQQ$/)
    expect(styleSelect('QQQ').value).toBe('line')
    expect(screen.queryByLabelText(/up candle/i)).toBeNull()
    expect(screen.queryByLabelText(/down candle/i)).toBeNull()
  })

  it('⭐ every candle control carries a readable name, not just a swatch', () => {
    const { cs } = candleSettings()
    show(cs)
    openIndicators()
    expand(/^QQQ$/)
    for (const re of [/up candle/i, /down candle/i]) {
      const el = screen.getByLabelText(re)
      expect(el.getAttribute('aria-label')).toMatch(/QQQ .*candle/i)
    }
    const row = screen.getByLabelText(/QQQ up candle/i).closest('[class*=indRow]')
    expect(within(row).getByText(/Up candle/i)).toBeTruthy()
  })
})
