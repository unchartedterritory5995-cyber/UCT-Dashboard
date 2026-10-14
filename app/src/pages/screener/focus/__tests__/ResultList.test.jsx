import { render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { vi, describe, beforeEach, afterEach } from 'vitest'
import ResultList from '../ResultList'

const rows = [
  { ticker: 'MU', price: 956.12, chg_pct_1d: -3.7, base_render: 'Flat Base', vol_ratio: 0.8 },
  { ticker: 'APLS', price: 41.03, chg_pct_1d: 0, base_render: '3 Weeks Tight', vol_ratio: 0 },
  { ticker: 'DAWN', price: null, chg_pct_1d: null, base_render: null, vol_ratio: 1 },
]
const base = { rows, index: 0, onSelect: vi.fn(), onKeyDown: vi.fn(), livePrices: {}, radar: new Set(['MU']), sortLabel: 'RS rank', total: 214, hasMore: true, onLoadMore: vi.fn(), isLoading: false }

test('renders a listbox with the selected option', () => {
  render(<ResultList {...base} />)
  expect(screen.getByRole('listbox', { name: 'Screen results' })).toBeInTheDocument()
  expect(screen.getByTestId('focus-row-MU')).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByText('1 of 214')).toBeInTheDocument()
})
test('zero-volume row says no trades and shows a dash for change', () => {
  render(<ResultList {...base} />)
  const r = screen.getByTestId('focus-row-APLS')
  expect(r).toHaveTextContent('No trades today')
  expect(r).toHaveTextContent('—')
  expect(r).not.toHaveTextContent('+0.0%')
})
test('null price shows a dash, never NaN', () => {
  render(<ResultList {...base} />)
  const r = screen.getByTestId('focus-row-DAWN')
  expect(r).toHaveTextContent('Not enough history for a base')
  expect(r.textContent).not.toMatch(/NaN/)
})
test('live price overrides the snapshot price', () => {
  render(<ResultList {...base} livePrices={{ MU: { price: 960.5, change_pct: -3.3 } }} />)
  expect(screen.getByTestId('focus-row-MU')).toHaveTextContent('960.50')
  expect(screen.getByTestId('focus-row-MU')).toHaveTextContent('−3.3%')
})
test('radar dot is labelled for screen readers', () => {
  render(<ResultList {...base} />)
  expect(screen.getByTestId('focus-row-MU').querySelector('[aria-label="On your radar"]')).not.toBeNull()
})
test('click selects', () => {
  render(<ResultList {...base} />)
  fireEvent.click(screen.getByTestId('focus-row-DAWN'))
  expect(base.onSelect).toHaveBeenCalledWith(2)
})
test('keys go to onKeyDown', () => {
  render(<ResultList {...base} />)
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
  expect(base.onKeyDown).toHaveBeenCalled()
})
test('exposes scrollToIndex', () => {
  const ref = createRef()
  render(<ResultList {...base} ref={ref} />)
  expect(typeof ref.current.scrollToIndex).toBe('function')
  ref.current.scrollToIndex(2)
})

test('rounded-zero change carries no sign', () => {
  render(<ResultList {...base} livePrices={{ MU: { price: 960.5, change_pct: 0.04 }, DAWN: { price: 5, change_pct: -0.04 } }} />)
  expect(screen.getByTestId('focus-row-MU')).toHaveTextContent('0.0%')
  expect(screen.getByTestId('focus-row-MU')).not.toHaveTextContent('+0.0%')
  expect(screen.getByTestId('focus-row-DAWN')).toHaveTextContent('0.0%')
  expect(screen.getByTestId('focus-row-DAWN').textContent).not.toMatch(/[−+]0\.0%/)
})
test('live price without live change shows a dash, not the snapshot change', () => {
  render(<ResultList {...base} livePrices={{ MU: { price: 960.5 } }} />)
  const r = screen.getByTestId('focus-row-MU')
  expect(r).toHaveTextContent('960.50')
  expect(r).toHaveTextContent('—')
  expect(r.textContent).not.toMatch(/3\.7/)
})
test('key hints are exposed to screen readers', () => {
  render(<ResultList {...base} />)
  expect(screen.getByText('move').closest('[aria-hidden]')).toBeNull()
})
test('scrollToIndex moves only the list container and never calls scrollIntoView', () => {
  const ref = createRef()
  render(<ResultList {...base} ref={ref} />)
  const list = screen.getByRole('listbox')
  const row = screen.getByTestId('focus-row-DAWN')
  const spy = vi.fn()
  row.scrollIntoView = spy
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: 100 })
  list.getBoundingClientRect = () => ({ top: 1000, bottom: 1100 })
  row.getBoundingClientRect = () => ({ top: 1300, bottom: 1350 })
  ref.current.scrollToIndex(2)
  expect(list.scrollTop).toBe(250)
  expect(spy).not.toHaveBeenCalled()
  row.getBoundingClientRect = () => ({ top: 980, bottom: 1030 })
  ref.current.scrollToIndex(2)
  expect(list.scrollTop).toBe(230)
})

describe('load-more latch', () => {
  let original
  beforeEach(() => {
    original = globalThis.IntersectionObserver
    globalThis.IntersectionObserver = class {
      constructor(cb, opts) { this.cb = cb; globalThis.__ioOpts = opts }
      observe() { this.cb([{ isIntersecting: globalThis.__ioIntersect !== false }]) }
      disconnect() {}
    }
  })
  afterEach(() => { globalThis.IntersectionObserver = original; delete globalThis.__ioIntersect })

  test('fires once per rows.length, ignoring callback identity', () => {
    const a = vi.fn(); const b = vi.fn(); const c = vi.fn()
    const { rerender } = render(<ResultList {...base} onLoadMore={a} />)
    expect(a).toHaveBeenCalledTimes(1)
    expect(globalThis.__ioOpts).toEqual({ rootMargin: '200px' })
    rerender(<ResultList {...base} onLoadMore={b} />)
    rerender(<ResultList {...base} onLoadMore={c} />)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
    expect(c).not.toHaveBeenCalled()
    rerender(<ResultList {...base} rows={[...rows, { ticker: 'NEW', price: 1, chg_pct_1d: 1, base_render: null, vol_ratio: 1 }]} onLoadMore={c} />)
    expect(c).toHaveBeenCalledTimes(1)
  })

  test('a load that returns the same length re-arms while the sentinel is still in view', () => {
    const fn = vi.fn()
    const { rerender } = render(<ResultList {...base} onLoadMore={fn} />)
    expect(fn).toHaveBeenCalledTimes(1)
    rerender(<ResultList {...base} onLoadMore={fn} isLoading />)
    expect(fn).toHaveBeenCalledTimes(1)
    rerender(<ResultList {...base} onLoadMore={fn} isLoading={false} />)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  test('isLoading toggling without the sentinel in view adds no call', () => {
    globalThis.__ioIntersect = false
    const fn = vi.fn()
    const { rerender } = render(<ResultList {...base} onLoadMore={fn} />)
    rerender(<ResultList {...base} onLoadMore={fn} isLoading />)
    rerender(<ResultList {...base} onLoadMore={fn} isLoading={false} />)
    expect(fn).not.toHaveBeenCalled()
  })
})
