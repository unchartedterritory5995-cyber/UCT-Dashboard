/* Tick flash — the price takes the tick's direction color for a beat, then
 * eases back (a pure CSS animation; the class carries it, so the class IS the
 * observable). The rules under test: flash ONLY on an actual price change,
 * direction from the tick comparison (not the day's change sign), and a
 * symbol switch never flashes — the new symbol's first quote is not a tick.
 */
import { render } from '@testing-library/react'
import { vi } from 'vitest'
import MobileSymbolStrip from './MobileSymbolStrip'

let mockPrices = {}
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: mockPrices }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useBreadthSymbols', () => ({ default: () => new Map() }))
vi.mock('../../../components/CompanyLogo', () => ({ default: () => null }))

const flashEl = (container, dir) => container.querySelector(`[class*="priceFlash${dir}"]`)

const strip = (sym = 'NVDA') => <MobileSymbolStrip sym={sym} onOpenSearch={() => {}} />

beforeEach(() => {
  mockPrices = { NVDA: { price: 100, change: 1, change_pct: 1 } }
})

test('the first quote is not a tick — no flash on mount', () => {
  const { container } = render(strip())
  expect(flashEl(container, 'Up')).toBeNull()
  expect(flashEl(container, 'Down')).toBeNull()
})

test('an uptick flashes up', () => {
  const { container, rerender } = render(strip())
  mockPrices = { NVDA: { price: 100.4, change: 1.4, change_pct: 1.4 } }
  rerender(strip())
  expect(flashEl(container, 'Up')).not.toBeNull()
})

test('a downtick flashes down even while the day is still green', () => {
  const { container, rerender } = render(strip())
  // Day change stays positive; the TICK is down — direction follows the tick.
  mockPrices = { NVDA: { price: 99.7, change: 0.7, change_pct: 0.7 } }
  rerender(strip())
  expect(flashEl(container, 'Down')).not.toBeNull()
  expect(flashEl(container, 'Up')).toBeNull()
})

test('a re-render on the same price never flickers', () => {
  const { container, rerender } = render(strip())
  rerender(strip())
  expect(flashEl(container, 'Up')).toBeNull()
  expect(flashEl(container, 'Down')).toBeNull()
})

test("switching symbols does not flash on the new symbol's first quote", () => {
  const { container, rerender } = render(strip())
  // A prior NVDA tick leaves an up-flash standing…
  mockPrices = { NVDA: { price: 100.4, change: 1.4, change_pct: 1.4 } }
  rerender(strip())
  expect(flashEl(container, 'Up')).not.toBeNull()
  // …and the switch to AAPL clears it rather than comparing across symbols.
  mockPrices = { NVDA: { price: 100.4, change: 1.4, change_pct: 1.4 }, AAPL: { price: 230, change: -2, change_pct: -0.9 } }
  rerender(strip('AAPL'))
  expect(flashEl(container, 'Up')).toBeNull()
  expect(flashEl(container, 'Down')).toBeNull()
})
