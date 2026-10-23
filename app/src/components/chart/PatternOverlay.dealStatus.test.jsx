// Deal status (DEAL_STATUS_ENABLED): a stock pending acquisition gets NO drawings from the server and
// the overlay shows one line saying why. Asserted by RENDERED TEXT. And the hook surfaces the marker
// only when the server sent one. Synthetic prices.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import PatternOverlay, {
  DEAL_STATUS_LABEL, DEAL_NOTICE_BOTTOM, LOOKBACK_BAR_PX, DEAL_NOTICE_GAP_PX,
} from './PatternOverlay'
import { chromePlan, PANE_SEPARATOR_PX } from './chromeGeometry'
import { usePatternDetections } from '../../hooks/usePatternDetections'

const chart = {
  timeScale: () => ({
    timeToCoordinate: () => 10,
    subscribeVisibleTimeRangeChange: vi.fn(),
    subscribeVisibleLogicalRangeChange: vi.fn(),
    unsubscribeVisibleTimeRangeChange: vi.fn(),
    unsubscribeVisibleLogicalRangeChange: vi.fn(),
    options: () => ({ barSpacing: 8 }),
  }),
}
const series = { priceToCoordinate: (p) => 1000 - p * 10 }
const containerRef = { current: { clientWidth: 800, clientHeight: 400 } }
const SERVER_LABEL = 'Pending acquisition — pattern drawings hidden'
const MARKER = { pending: true, label: SERVER_LABEL, source: ['news'], since: '2026-06-25', price: 72.5, confidence: 0.9 }

const draw = (props) => render(
  <PatternOverlay chart={chart} series={series} containerRef={containerRef} tf="D"
    detections={[]} enabled={true} {...props} />,
)

describe('PatternOverlay: pending acquisition', () => {
  it('shows the server label and draws nothing', () => {
    const { getByRole, container } = draw({ dealStatus: MARKER })
    expect(getByRole('status').textContent).toBe(SERVER_LABEL)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('falls back to its own label when the payload carries none', () => {
    const { getByRole } = draw({ dealStatus: { pending: true } })
    expect(getByRole('status').textContent).toBe(DEAL_STATUS_LABEL)
  })

  it('shows nothing while the overlay is disabled', () => {
    const { queryByTestId } = draw({ dealStatus: MARKER, enabled: false })
    expect(queryByTestId('pattern-deal-status')).toBeNull()
  })

  it('without a marker renders exactly as before (nothing for no detections)', () => {
    const { container } = draw({})
    expect(container.innerHTML).toBe('')
  })
})

// ─── PLACEMENT: THE NOTICE MUST NEVER COVER THE OHLC READOUT OR THE MA LEGEND ───
// It was born at `top: 34, left: 8` — the readout row ("OCT 23 O 72.53 H … C …") and the
// EMA/SMA rows under it. It now stacks on the lookback bar, bottom-left of the price pane.
const here = dirname(fileURLToPath(import.meta.url))
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
// `name` is a bare class name (no dot); the rule body is everything up to the first `}`.
const cssRule = (css, name) => {
  const m = stripComments(css).match(new RegExp('\\.' + name + '\\s*\\{([^}]*)\\}'))
  return m ? m[1] : ''
}
const px = (rule, prop) => {
  const m = rule.match(new RegExp('(?:^|[;\\s])' + prop + '\\s*:\\s*([^;]+);'))
  return m ? m[1].trim().split(/\s+/).map((v) => parseFloat(v)) : null
}
const intersects = (a, b) => a.top < b.bottom && b.top < a.bottom && a.left < b.right && b.left < a.right

describe('PatternOverlay: deal notice placement', () => {
  it('is anchored bottom-left on the lookback band, never to the top', () => {
    const { getByTestId } = draw({ dealStatus: MARKER })
    const el = getByTestId('pattern-deal-status')
    expect(el.getAttribute('role')).toBe('status')
    expect(el.style.top, 'a top anchor puts it back on the legend').toBe('')
    expect(el.style.left).toBe('8px')
    expect(DEAL_NOTICE_BOTTOM).toContain('var(--lookback-bottom')
    expect(el.getAttribute('style')).toContain('--lookback-bottom')
  })

  it('LOOKBACK_BAR_PX is at least the lookback bar the stylesheet draws', () => {
    // .rangeBar: padding + 1px border; .rangeBtn: padding + 11px type at a generous 1.4 line.
    const css = readFileSync(resolve(here, '../StockChart.module.css'), 'utf8')
    const bar = cssRule(css, 'rangeBar'), btn = cssRule(css, 'rangeBtn')
    const barPad = px(bar, 'padding'), btnPad = px(btn, 'padding'), font = px(btn, 'font-size')
    expect(barPad && btnPad && font, 'could not read the range bar CSS').toBeTruthy()
    const barH = 2 * barPad[0] + 2 * 1 + 2 * btnPad[0] + Math.ceil(font[0] * 1.4)
    expect(LOOKBACK_BAR_PX).toBeGreaterThanOrEqual(barH)
  })

  // A modeled 930x560 chart (the owner's screenshot): price 420 / volume 80 panes. The
  // legend's region is the readout row plus five MA rows from `top: 28px`; the lookback
  // bar's top edge is `lookbackBottom + LOOKBACK_BAR_PX` from the bottom.
  const H = 560, W = 930, NOTICE_H = 20, NOTICE_W = 300
  const plan = chromePlan({ paneHeights: [420, 80], priceIndex: 0, volumeIndex: 1, timeAxisHeight: 28, separatorPx: PANE_SEPARATOR_PX })
  const legend = { top: 28, bottom: 28 + 6 * 18 + 6, left: 8, right: 8 + 360 }
  const rangeBar = { bottom: H - plan.lookbackBottom, top: H - plan.lookbackBottom - LOOKBACK_BAR_PX, left: 8, right: 8 + 190 }
  const noticeAt = (bottomPx) => ({ bottom: H - bottomPx, top: H - bottomPx - NOTICE_H, left: 8, right: 8 + Math.min(NOTICE_W, W - 16) })
  const offset = Number(DEAL_NOTICE_BOTTOM.match(/\+\s*(\d+)px\)$/)[1])

  it('does not intersect the readout/legend region, nor the lookback bar', () => {
    expect(offset).toBe(LOOKBACK_BAR_PX + DEAL_NOTICE_GAP_PX)
    const n = noticeAt(plan.lookbackBottom + offset)
    expect(intersects(n, legend), JSON.stringify({ n, legend })).toBe(false)
    expect(intersects(n, rangeBar), JSON.stringify({ n, rangeBar })).toBe(false)
    expect(n.top).toBeGreaterThan(legend.bottom)
  })

  it('control: the old top:34 seat DOES intersect the readout (the fixture can tell)', () => {
    const old = { top: 34, bottom: 34 + NOTICE_H, left: 8, right: 8 + NOTICE_W }
    expect(intersects(old, legend)).toBe(true)
  })

  it('StockChart publishes --lookback-bottom on the wrapper from the same plan number', () => {
    const src = readFileSync(resolve(here, '../StockChart.jsx'), 'utf8')
    expect(src).toMatch(/const want = `\$\{plan\.lookbackBottom\}px`/)
    expect(src).toMatch(/host\.style\.setProperty\('--lookback-bottom', want\)/)
    expect(src).toMatch(/const host = wrapperRef\.current/)
  })
})

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)
afterEach(() => { vi.unstubAllGlobals() })

describe('usePatternDetections: dealStatus', () => {
  it('returns the marker when the server sent one', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ detections: [], count: 0, deal_status: MARKER }),
    })))
    const { result } = renderHook(
      () => usePatternDetections('ZZZ', 'D', true, 50, { includeStructures: true }), { wrapper },
    )
    await waitFor(() => expect(result.current.dealStatus).not.toBeNull())
    expect(result.current.dealStatus.label).toBe(SERVER_LABEL)
  })

  it('is null when the response carries none', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ detections: [], count: 0 }),
    })))
    const { result } = renderHook(() => usePatternDetections('ZZZ', 'D', true, 50), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.dealStatus).toBeNull()
  })
})
