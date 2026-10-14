import { render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { vi, afterEach, beforeEach, describe, expect, test } from 'vitest'
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
// Lays rows out 40px apart inside a list whose box starts at 1000, scrolled to `scrollTop`.
function layout(list, n, scrollTop = 0, height = 400) {
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: height })
  list.scrollTop = scrollTop
  list.getBoundingClientRect = () => ({ top: 1000, bottom: 1000 + height })
  for (let i = 0; i < n; i++) {
    const el = list.querySelector(`[data-index="${i}"]`)
    el.getBoundingClientRect = () => ({ top: 1000 + i * 40 - list.scrollTop, bottom: 1040 + i * 40 - list.scrollTop })
  }
}
const many = Array.from({ length: 20 }, (_, i) => ({ ticker: `T${i}`, price: 10, chg_pct_1d: 1, base_render: 'Flat Base', vol_ratio: 1 }))

test('scrollToIndex moves only the list container and never calls scrollIntoView', () => {
  const ref = createRef()
  render(<ResultList {...base} rows={many} ref={ref} />)
  const list = screen.getByRole('listbox')
  const spy = vi.fn()
  list.querySelectorAll('[data-index]').forEach(r => { r.scrollIntoView = spy })
  layout(list, 20, 0)
  ref.current.scrollToIndex(12)
  expect(list.scrollTop).toBeGreaterThan(0)
  expect(spy).not.toHaveBeenCalled()
})
test('P4: moving down keeps two rows of lookahead below the selection', () => {
  const ref = createRef()
  render(<ResultList {...base} rows={many} ref={ref} />)
  const list = screen.getByRole('listbox')
  layout(list, 20, 0) // rows 0-9 fill the 400px view
  ref.current.scrollToIndex(9) // row 9 touches the bottom edge: rows 10 and 11 must come in
  expect(list.scrollTop).toBe(12 * 40 - 400)
  ref.current.scrollToIndex(5) // well inside the view: nothing moves
  expect(list.scrollTop).toBe(80)
})
test('P4: moving up keeps two rows of lookahead above the selection', () => {
  const ref = createRef()
  render(<ResultList {...base} rows={many} ref={ref} />)
  const list = screen.getByRole('listbox')
  layout(list, 20, 400) // rows 10-19 in view
  ref.current.scrollToIndex(10)
  expect(list.scrollTop).toBe(8 * 40)
})
test('P4: at the ends of the list the lookahead is what exists', () => {
  const ref = createRef()
  render(<ResultList {...base} rows={many} ref={ref} />)
  const list = screen.getByRole('listbox')
  layout(list, 20, 0)
  ref.current.scrollToIndex(19)
  expect(list.scrollTop).toBe(20 * 40 - 400)
  ref.current.scrollToIndex(0)
  expect(list.scrollTop).toBe(0)
})
test('P4: a view too short for the lookahead still shows the selected row', () => {
  const ref = createRef()
  render(<ResultList {...base} rows={many} ref={ref} />)
  const list = screen.getByRole('listbox')
  layout(list, 20, 0, 60) // one and a half rows tall
  ref.current.scrollToIndex(10)
  expect(list.scrollTop).toBeLessThanOrEqual(10 * 40)
  expect(list.scrollTop).toBeGreaterThanOrEqual(11 * 40 - 60)
})
test('P5: a key press puts the list in keyboard mode; moving the pointer leaves it', () => {
  render(<ResultList {...base} />)
  const list = screen.getByRole('listbox')
  expect(list).not.toHaveAttribute('data-kbd')
  fireEvent.keyDown(list, { key: 'ArrowDown' })
  expect(list).toHaveAttribute('data-kbd')
  expect(base.onKeyDown).toHaveBeenCalled()
  fireEvent.pointerMove(list)
  expect(list).not.toHaveAttribute('data-kbd')
  fireEvent.keyDown(list, { key: 'ArrowDown' })
  fireEvent.blur(list)
  expect(list).not.toHaveAttribute('data-kbd')
})
test('P5: the selected fill outranks hover, and hover paints nothing in keyboard mode', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const css = readFileSync(join(globalThis.process.cwd(), 'src/pages/screener/focus/FocusScreener.module.css'), 'utf8').replace(/\r\n/g, '\n')
  // hover never applies to the selected row, so it cannot repaint it
  expect(css).toMatch(/\.row:not\(\.rowSel\):hover\s*\{/)
  expect(css).not.toMatch(/\.row:hover\s*\{/)
  expect(css).toMatch(/\.list\[data-kbd\] \.row:not\(\.rowSel\):hover\s*\{\s*background: transparent/)
  // the selection paints the gold tint OVER the hover tone: strictly stronger than hover
  expect(css).toMatch(/\.rowSel\s*\{[^}]*linear-gradient\(var\(--ut-gold-dim\), var\(--ut-gold-dim\)\), var\(--bg-hover\)/)
})
test('B2: a structure screen leads each row with the matched structure, with a tooltip', () => {
  const structures = { matched: [{ value: ',pocket-pivot,', label: 'Pocket Pivot', title: 'Pocket Pivot' }], labels: ['Pocket Pivot', 'Ugly Double Bottom'] }
  const r = [{ ticker: 'UDB', price: 97, chg_pct_1d: 1, base_render: 'Ugly Double Bottom (Pocket Pivot)', vol_ratio: 1.2, base_pivot_px: 100 }]
  render(<ResultList {...base} rows={r} structures={structures} />)
  const setup = screen.getByText('Pocket Pivot · also Ugly Double Bottom')
  expect(setup).toHaveAttribute('title', 'Pocket Pivot')
  // the head's pivot does not ride beside the lead in the row
  expect(screen.getByTestId('focus-row-UDB')).not.toHaveTextContent('pivot')
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
