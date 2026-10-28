// The TickerPopup chart takes the height the modal has LEFT, so the whole chart -- date axis
// and A/L/% chips included -- fits inside the modal's max height without scrolling.
// Measured in WebKit before the fix: 1194x834 touch, 781px of content in a 732px modal, chips
// 755-799 against a 784 bottom edge; 1200x800 mouse, 742 in 702.
//
// jsdom lays nothing out, so the geometry is GIVEN here (the numbers WebKit measured) and the
// rail proves the arithmetic and the wire; the WebKit walk proves the pixels.
import { renderWithProviders, screen, act } from '../test-utils'
import { vi, test, expect, describe, beforeEach, afterEach } from 'vitest'
import { fitChartHeightPx, chartHeightCss, shouldUpdateFit, CHART_FIT_FLOOR_PX, CHART_FIT_TARGET } from './tickerPopupChartFit'

const seen = vi.hoisted(() => ({ heights: [], renders: 0 }))
vi.mock('../utils/prefetchBars', () => ({
  prefetchAllTimeframes: vi.fn(), prefetchBars: vi.fn(), prefetchBar: vi.fn(), default: vi.fn(),
}))
vi.mock('./chart/SymbolSearch', () => ({ default: () => null }))
vi.mock('./chart/pane/ChartPane', () => ({
  default: ({ stockChartProps }) => {
    seen.renders += 1
    seen.heights.push(stockChartProps.height)
    return (
      <div data-testid="pane">
        <div data-testid="wrapper" className={stockChartProps.className} data-height={stockChartProps.height} />
      </div>
    )
  },
}))

import TickerPopup from './TickerPopup'

describe('fitChartHeightPx', () => {
  // 1194x834 touch, measured: modal max 733.92, 1px borders, scroll 781; the chart area box 640
  // (12px padding each side), pane 616 with a 567px wrapper (68vh) -> chrome = 141+24+49 = 214
  const G = {
    maxHeight: '733.92px', borderTop: '1px', borderBottom: '1px',
    modalScrollHeight: 781, areaHeight: 640, areaPaddingTop: '12px', areaPaddingBottom: '12px',
    paneHeight: 616, wrapperHeight: 567,
  }

  test('the chart gets what the modal has left after everything else', () => {
    // maxClient 731.92 - chrome 214 = 517.92 -> 517
    expect(fitChartHeightPx(G)).toBe(517)
    // and with that height the content is exactly the modal's room
    const chrome = (G.modalScrollHeight - G.areaHeight) + 24 + (G.paneHeight - G.wrapperHeight)
    expect(chrome + 517).toBeLessThanOrEqual(733.92 - 2)
  })

  test('the answer does not depend on the chart height it was measured at (no feedback loop)', () => {
    // same chrome, chart already shrunk by 50px: every box that holds the chart shrinks by 50
    const shrunk = { ...G, modalScrollHeight: 731, areaHeight: 590, paneHeight: 566, wrapperHeight: 517 }
    expect(fitChartHeightPx(shrunk)).toBe(fitChartHeightPx(G))
  })

  test('a binding min-height on the area is not counted as chrome', () => {
    // area held at 700 by its min-height while the pane inside is only 616 tall
    const held = { ...G, modalScrollHeight: 841, areaHeight: 700 }
    expect(fitChartHeightPx(held)).toBe(fitChartHeightPx(G))
  })

  test('phone (max-height: none) is left alone; unusable input is null', () => {
    expect(fitChartHeightPx({ ...G, maxHeight: 'none' })).toBeNull()
    expect(fitChartHeightPx({ ...G, wrapperHeight: undefined })).toBeNull()
  })

  test('a very short screen floors the chart and lets the modal scroll as before', () => {
    expect(fitChartHeightPx({ ...G, maxHeight: '300px' })).toBe(CHART_FIT_FLOOR_PX)
  })

  test('the old caps still bind first on a tall screen (desktop unchanged)', () => {
    expect(chartHeightCss(null)).toBe('min(820px, 68vh)')
    expect(chartHeightCss(900)).toBe('min(820px, 68vh, 900px)')
  })

  test('rounding never flips the value back and forth', () => {
    expect(shouldUpdateFit(null, 500)).toBe(true)
    expect(shouldUpdateFit(500, 501)).toBe(false)
    expect(shouldUpdateFit(500, 502)).toBe(false)
    expect(shouldUpdateFit(500, 503)).toBe(true)
    expect(shouldUpdateFit(500, null)).toBe(true)
  })
})

describe('TickerPopup wires the fit into the chart', () => {
  const realGCS = window.getComputedStyle
  let raf
  beforeEach(() => {
    seen.heights = []; seen.renders = 0
    raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => setTimeout(() => cb(0), 0))
  })
  afterEach(() => {
    raf.mockRestore()
    window.getComputedStyle = realGCS
  })

  /** Geometry where the chrome is 214px whatever height the chart currently has. */
  function giveGeometry(maxHeight) {
    const dialog = screen.getByRole('dialog')
    const area = dialog.querySelector('[data-ticker-popup-chart]')
    const pane = screen.getByTestId('pane')
    const wrapper = screen.getByTestId('wrapper')
    const chartPx = () => {
      const m = /,\s*(\d+)px\)$/.exec(wrapper.dataset.height)
      return m ? Number(m[1]) : 567
    }
    const def = (el, prop, fn) => Object.defineProperty(el, prop, { configurable: true, get: fn })
    def(wrapper, 'offsetHeight', chartPx)
    def(pane, 'offsetHeight', () => chartPx() + 49)
    def(area, 'offsetHeight', () => chartPx() + 49 + 24)
    def(dialog, 'scrollHeight', () => chartPx() + 214)
    window.getComputedStyle = (el, ...rest) => {
      const cs = realGCS(el, ...rest)
      if (el === dialog) return { ...cs, maxHeight, borderTopWidth: '1px', borderBottomWidth: '1px' }
      if (el === area) return { ...cs, paddingTop: '12px', paddingBottom: '12px' }
      return cs
    }
    return { area, wrapper }
  }

  async function settle() {
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await new Promise((r) => setTimeout(r, 5)) })
    }
  }

  test('a short landscape modal fits the chart to the room it has left, and stays put', async () => {
    renderWithProviders(<TickerPopup sym="QQQ" open onClose={vi.fn()} />)
    await screen.findByTestId('pane')
    const { area, wrapper } = giveGeometry('733.92px')
    expect(wrapper).toHaveClass(CHART_FIT_TARGET)
    await act(async () => { window.dispatchEvent(new Event('resize')) })
    await settle()
    expect(wrapper.dataset.height).toBe('min(820px, 68vh, 517px)')
    expect(area.style.minHeight).toBe('0px')
    // H14: once fitted, further measurements change nothing -- no render loop
    const renders = seen.renders
    await act(async () => { window.dispatchEvent(new Event('resize')) })
    await settle()
    expect(seen.renders).toBe(renders)
    expect(wrapper.dataset.height).toBe('min(820px, 68vh, 517px)')
  })

  test('phone (max-height: none) keeps the old height', async () => {
    renderWithProviders(<TickerPopup sym="QQQ" open onClose={vi.fn()} />)
    await screen.findByTestId('pane')
    const { wrapper } = giveGeometry('none')
    await act(async () => { window.dispatchEvent(new Event('resize')) })
    await settle()
    expect(wrapper.dataset.height).toBe('min(820px, 68vh)')
  })
})
