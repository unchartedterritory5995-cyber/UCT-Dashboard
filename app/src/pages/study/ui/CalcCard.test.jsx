// The picture card on screen: before the answer it shows only what the question gives and an empty answer slot; the
// answer fills in only once the verdict screen has closed; a chart question never gets one.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import CalcCard from './CalcCard'

const ladder = {
  kind: 'ladder', side: 'long', find: { label: '3R', as: 'price' }, r: { entry: 50, stop: 47.5 },
  levels: [{ key: 'stop', label: 'Stop', price: 47.5 }, { key: 'entry', label: 'Entry', price: 50 }],
}
const item = (visual, extra = {}) => ({ id: 'q1', prompt_json: { q: 'Entry $50, stop $47.50. Where is the 3R price?', visual, ...extra } })
const reveal = { facts: { calc: { fn: 'arith', args: { expr: 'entry + 3 * (entry - stop)', entry: 50, stop: 47.5 }, result: 57.5 } } }

describe('CalcCard', () => {
  it('before the answer: the given levels and an empty slot, never the answer', () => {
    render(<CalcCard item={item(ladder)} />)
    const card = screen.getByTestId('calc-card')
    expect(card).toHaveAttribute('data-kind', 'ladder')
    expect(card).toHaveTextContent('Stop')
    expect(card).toHaveTextContent('47.50')
    expect(card).toHaveTextContent('50.00')
    expect(screen.getByTestId('calc-ask')).toHaveTextContent('?')
    expect(card).not.toHaveTextContent('57.5')
    expect(screen.queryByTestId('calc-working')).toBeNull()
  })

  it('keeps the slot empty while the verdict screen is up, then fills it with the working', () => {
    const { rerender } = render(<CalcCard item={item(ladder)} reveal={reveal} settled={false} />)
    expect(screen.queryByTestId('calc-answer')).toBeNull()
    rerender(<CalcCard item={item(ladder)} reveal={reveal} settled />)
    expect(screen.getByTestId('calc-answer')).toHaveTextContent('57.50')
    expect(screen.getByTestId('calc-working')).toHaveTextContent('50 + 3 × (50 − 47.5) = 57.50')
    // the level asked for and the R steps join the ruler; the answer's row never wears the slot's own class (it turned
    // into a solid green pill that hid its label, 2026-11-15 screen check)
    const row = document.querySelector('[data-level="find"]')
    expect(row).toHaveTextContent('3R')
    const slotClass = screen.getByTestId('calc-answer').className
    expect(row.className.split(/\s+/)).not.toContain(slotClass)
    expect([...document.querySelectorAll('[data-tick]')].map((t) => t.textContent)).toEqual(['1R', '2R', '3R'])
  })

  it('draws each kind the bank sends', () => {
    const cards = [
      { kind: 'move', from: { label: '', value: 40 }, to: { label: '', value: 44 }, find: { label: 'The change', as: 'pct' } },
      { kind: 'recover', loss_pct: 50, find: { label: 'The gain back to even', as: 'pct' } },
      { kind: 'size', rows: [{ key: 'account', label: 'Account', value: 40000, fmt: '$' }, { key: 'risk_pct', label: 'Risk', value: 1, fmt: '%' }], find: { label: 'Dollars at risk', as: 'dollars' } },
      { kind: 'range', high: 32, low: 30, close: 31.4, value_label: 'Close', find: { label: 'Where it closed in its range', as: 'frac' } },
      { kind: 'quote', bid: 24.98, ask: 25.02, find: { label: 'The spread', as: 'dollars' } },
      { kind: 'share', whole: { label: "Average day's volume", value: 2000000, fmt: 'shares' }, pct: 1, find: { label: 'The most we own', as: 'shares' } },
      { kind: 'expectancy', win_pct: 30, avg_win_r: 3, avg_loss_r: 1, find: { label: 'R per trade', as: 'r' } },
      { kind: 'payoff', option: 'call', side: 'long', strike: 40, premium: 6, find: { label: 'Breakeven', as: 'price' } },
    ]
    for (const v of cards) {
      const { unmount } = render(<CalcCard item={item(v)} />)
      expect(screen.getByTestId('calc-card')).toHaveAttribute('data-kind', v.kind)
      expect(screen.getByTestId('calc-ask')).toBeInTheDocument()
      unmount()
    }
  })

  it('draws the payoff line only after the answer', () => {
    const v = { kind: 'payoff', option: 'call', side: 'long', strike: 40, premium: 6, find: { label: 'Breakeven', as: 'price' } }
    const r = { facts: { calc: { fn: 'option_breakeven', args: { kind: 'call', strike: 40, premium: 6 }, result: 46 } } }
    const { rerender } = render(<CalcCard item={item(v)} />)
    expect(screen.queryByTestId('calc-payoff-line')).toBeNull()
    rerender(<CalcCard item={item(v)} reveal={r} />)
    expect(screen.getByTestId('calc-payoff-line')).toBeInTheDocument()
    expect(screen.getByTestId('calc-answer')).toHaveTextContent('46')
    expect(screen.getByTestId('calc-working')).toHaveTextContent('40 + 6 = 46')
  })

  it('keeps the payoff line out of the label bands, and prints the premium in its own format', () => {
    // a spread with close strikes and a stock between them, and a put with a 1.50 premium beside whole-number strikes
    // (the 2026-11-15 screen check: the line ran through "Bought 100" and "Stock 72", and 1.50 printed as "2")
    const spread = { kind: 'payoff', option: 'call', side: 'long', legs: [{ strike: 100, side: 'long' }, { strike: 105, side: 'short' }],
      net_debit: 1.8, underlying: 103, contracts: 1, multiplier: 100, find: { label: 'Profit or loss at expiry', as: 'dollars' } }
    const put = { kind: 'payoff', option: 'put', side: 'long', strike: 75, premium: 1.5, underlying: 72, contracts: 1, multiplier: 100,
      find: { label: 'Profit or loss at expiry', as: 'dollars' } }
    for (const [v, result] of [[spread, 120], [put, 150]]) {
      const r = { facts: { calc: { fn: 'arith', args: {}, result } } }
      const { unmount } = render(<CalcCard item={item(v)} reveal={r} />)
      const ys = screen.getByTestId('calc-payoff-line').getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 1)
      const strikeYs = [...document.querySelectorAll('[data-label="strike"]')].map((t) => Number(t.getAttribute('y')))
      const stockY = Number(document.querySelector('[data-label="stock"]').getAttribute('y'))
      expect(Math.min(...ys)).toBeGreaterThan(Math.max(...strikeYs) + 3)      // under the strike labels' baseline
      expect(Math.max(...ys)).toBeLessThan(stockY - 12)                       // above the stock label's top (12px text)
      unmount()
    }
    render(<CalcCard item={item(put)} />)
    expect(screen.getByTestId('calc-card')).toHaveTextContent('Premium 1.50')
  })

  it('draws a spread by each leg\'s own side, whatever order the legs come in', () => {
    // a 105/100 put credit spread written sold-leg-first: max loss below 100, the credit kept above 105
    const v = { kind: 'payoff', option: 'put', side: 'short', legs: [{ strike: 105, side: 'short' }, { strike: 100, side: 'long' }],
      net_debit: -1.5, underlying: 103, find: { label: 'Profit or loss at expiry', as: 'dollars' } }
    const r = { facts: { calc: { fn: 'arith', args: {}, result: -50 } } }
    render(<CalcCard item={item(v)} reveal={r} />)
    const ys = screen.getByTestId('calc-payoff-line').getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 1)
    // svg y grows downward: the left end (stock far below 100) is the loss, lower on screen than the right end (the credit)
    expect(ys[0]).toBeGreaterThan(ys[ys.length - 1])
  })

  it('a computed question with no card shows the working alone, after the answer', () => {
    const plain = { id: 'q2', prompt_json: { q: 'Pivot?' } }
    const r = { facts: { calc: { fn: 'arith', args: { expr: '(high + low + close) / 3', high: 56, low: 48, close: 55 }, result: 53 } } }
    const { rerender } = render(<CalcCard item={plain} />)
    expect(screen.queryByTestId('calc-card')).toBeNull()
    rerender(<CalcCard item={plain} reveal={r} />)
    expect(screen.getByTestId('calc-card')).toHaveAttribute('data-kind', 'math')
    expect(screen.getByTestId('calc-working')).toHaveTextContent('(56 + 48 + 55) ÷ 3 = 53')
  })

  it('a part of a whole draws its slice only after the answer (before, the slice would show it)', () => {
    const v = { kind: 'share', whole: { label: 'Trades', value: 40, fmt: 'count' }, part: { label: 'Winners', value: 18, fmt: 'count' }, find: { label: 'The share', as: 'pct' } }
    const r = { facts: { calc: { fn: 'arith', args: { expr: 'wins / trades * 100', wins: 18, trades: 40 }, result: 45 } } }
    const { rerender } = render(<CalcCard item={item(v)} />)
    expect(screen.getByTestId('calc-card')).toHaveTextContent('Winners: 18')
    expect(screen.getByTestId('calc-card')).toHaveAttribute('aria-label', 'The share')
    expect(screen.queryByTestId('calc-share-slice')).toBeNull()
    rerender(<CalcCard item={item(v)} reveal={r} />)
    expect(screen.getByTestId('calc-share-slice')).toHaveAttribute('data-frac', '0.4500')
    expect(screen.getByTestId('calc-answer')).toHaveTextContent('45%')
  })

  it('a volume multiple reads as times, and a dollar card carries its share count', () => {
    const v = { kind: 'move', from: { label: 'Average', value: 4 }, to: { label: '', value: 13 }, find: { label: 'Times average', as: 'times' } }
    const r = { facts: { calc: { fn: 'arith', args: { expr: 'a / b', a: 13, b: 4 }, result: 3.25 } } }
    const { unmount } = render(<CalcCard item={item(v)} reveal={r} />)
    expect(screen.getByTestId('calc-answer')).toHaveTextContent('3.25×')
    expect(screen.getByTestId('calc-working')).toHaveTextContent('13 ÷ 4 = 3.25×')
    unmount()
    const cost = { kind: 'ladder', side: 'long', shares: 500, find: { label: 'Slippage', as: 'dollars' },
      levels: [{ key: 'stop', label: 'Stop', price: 38 }, { key: 'fill', label: 'Fill', price: 37.7 }] }
    render(<CalcCard item={item(cost)} />)
    expect(screen.getByTestId('calc-shares')).toHaveTextContent('500 shares')
  })

  it('a hand-written card names itself and its unit', () => {
    const v = { kind: 'ladder', side: 'long', title: 'The pullback', find: { label: 'Depth', as: 'num', unit: 'ATRs' },
      levels: [{ key: 'high', label: 'High', price: 120 }, { key: 'low', label: 'Low', price: 117.6 }] }
    const r = { facts: { calc: { fn: 'arith', args: { expr: '(a - b) / c', a: 120, b: 117.6, c: 3 }, result: 0.8 } } }
    render(<CalcCard item={item(v)} reveal={r} />)
    expect(screen.getByTestId('calc-card')).toHaveAttribute('aria-label', 'The pullback')
    expect(screen.getByTestId('calc-answer')).toHaveTextContent('0.8 ATRs')
    expect(screen.getByTestId('calc-working')).toHaveTextContent('(120 − 117.6) ÷ 3 = 0.8 ATRs')
  })

  it('a chart question gets none (the chart is its picture)', () => {
    render(<CalcCard item={{ ...item(ladder, { chart: { tf: 'D' } }), has_chart: true }} reveal={reveal} />)
    expect(screen.queryByTestId('calc-card')).toBeNull()
  })
})
