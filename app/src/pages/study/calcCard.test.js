// The picture card's logic (calcCard.js): what a card may draw, how its numbers read, where the ladder puts each
// price, and the working line after the answer.
import { describe, expect, it } from 'vitest'
import { answerText, cardOf, ladderLayout, priceFormat, resultOf, resultText, valueText, workingOf } from './calcCard'

const ladder = {
  kind: 'ladder', side: 'long', find: { label: '3R', as: 'price' }, r: { entry: 50, stop: 47.5 },
  levels: [{ key: 'stop', label: 'Stop', price: 47.5 }, { key: 'entry', label: 'Entry', price: 50 }],
}
const withVisual = (visual) => ({ id: 'x', prompt_json: { q: 'q', visual } })
const calc = (fn, args, result) => ({ facts: { calc: { fn, args, result } } })

describe('cardOf', () => {
  it('draws a known kind whose numbers are finite, and nothing else', () => {
    expect(cardOf(withVisual(ladder))).toBe(ladder)
    expect(cardOf(withVisual({ ...ladder, kind: 'hologram' }))).toBeNull()
    expect(cardOf(withVisual({ ...ladder, levels: [{ key: 'stop', price: 'x' }] }))).toBeNull()
    expect(cardOf(withVisual({ kind: 'range', high: 10, low: 12, close: 11, find: {} }))).toBeNull()   // low over high
    expect(cardOf(withVisual({ kind: 'move', from: { value: 0 }, to: { value: 5 }, find: {} }))).toBeNull() // no base
    expect(cardOf({ id: 'x', prompt_json: { q: 'q' } })).toBeNull()
  })
})

describe('numbers', () => {
  it('writes every price on a card to the same places', () => {
    const f = priceFormat([50, 47.5])
    expect([f(50), f(47.5)]).toEqual(['50.00', '47.50'])
    expect(priceFormat([4800, 4080])(4800)).toBe('4,800')
  })

  it('writes the answer the way the card asks for it', () => {
    expect(resultText(ladder, 57.5, priceFormat([47.5, 57.5]))).toBe('57.50')
    expect(resultText({ find: { as: 'r' } }, 2.5)).toBe('+2.5R')
    expect(resultText({ find: { as: 'r_loss' } }, 1.7)).toBe('1.7R')       // the slot says "R lost"; the key says "1.7R"
    expect(resultText({ find: { as: 'pct' } }, -25.4)).toBe('−25.4%')
    expect(resultText({ find: { as: 'shares' } }, 20000)).toBe('20,000 shares')
    expect(resultText({ find: { as: 'dollars' } }, -300)).toBe('−$300')
    expect(resultText({ find: { as: 'per_share' } }, 2.5)).toBe('2.50 a share')
    expect(valueText({ value: 40000, fmt: '$' })).toBe('$40,000')
    expect(valueText({ value: 0.5, fmt: '%' })).toBe('0.5%')
  })

  it('reads the scored result from the reveal, or nothing', () => {
    expect(resultOf(calc('arith', {}, 57.5))).toBe(57.5)
    expect(resultOf({ facts: {} })).toBeNull()
    expect(resultOf(null)).toBeNull()
  })
})

describe('the ladder', () => {
  it('before the answer draws only the given prices, high at the top', () => {
    const { rows, ticks } = ladderLayout(ladder, null)
    expect(rows.map((r) => r.key)).toEqual(['entry', 'stop'])
    expect(rows[0].top).toBeLessThan(rows[1].top)
    expect(ticks).toEqual([])
  })

  it('after the answer adds the level asked for and the R steps up to it', () => {
    const { rows, ticks } = ladderLayout(ladder, 57.5)
    expect(rows.map((r) => r.key)).toEqual(['find', 'entry', 'stop'])
    expect(rows[0]).toMatchObject({ tone: 'hit', price: 57.5, label: '3R' })
    expect(ticks.map((t) => [t.r, t.price])).toEqual([[1, 52.5], [2, 55], [3, 57.5]])
  })

  it('counts a short\'s R steps down from the entry', () => {
    const short = { ...ladder, side: 'short', r: { entry: 50, stop: 52 }, levels: [{ key: 'stop', price: 52 }, { key: 'entry', price: 50 }, { key: 'exit', price: 45 }], find: { label: 'R', as: 'r' } }
    expect(ladderLayout(short, 2.5).ticks.map((t) => t.price)).toEqual([48, 46, 44])
  })

  it('keeps two close prices apart on the page', () => {
    const fills = { kind: 'ladder', side: 'long', find: { label: 'Average price', as: 'price' },
      levels: [{ key: 'fill1', label: '400 shares', price: 30.1 }, { key: 'fill2', label: '600 shares', price: 30.15 }] }
    const { rows } = ladderLayout(fills, 30.13)
    for (let i = 1; i < rows.length; i += 1) expect(rows[i].labelTop - rows[i - 1].labelTop).toBeGreaterThanOrEqual(15 - 1e-9)
    expect(rows.every((r) => r.labelTop >= 0 && r.labelTop <= 100)).toBe(true)
  })
})

describe('the answer slot (2026-11-15 screen check: "57.50" beside a "$57.50" choice, "0.7" beside "0.70")', () => {
  const calc57 = { facts: { calc: { fn: 'arith', args: {}, result: 57.5 } } }
  it('prints the key the member chose when it states the scored number', () => {
    expect(answerText(ladder, { prompt_json: {} }, { ...calc57, answer: { answer: '$57.50' } }, 57.5)).toBe('$57.50')
    expect(answerText({ find: { as: 'frac' } }, { prompt_json: {} }, { answer: { answer: '0.70' } }, 0.7)).toBe('0.70')
    expect(answerText({ find: { as: 'dollars' } }, { prompt_json: {} }, { answer: { answer: 'Made $120' } }, 120)).toBe('Made $120')
    expect(answerText({ find: { as: 'r_loss' } }, { prompt_json: {} }, { answer: { answer: '3R' } }, 3)).toBe('3R')
    // a typed number's key is bare: the question's own prefix and suffix dress it
    expect(answerText(ladder, { prompt_json: { prefix: '$' } }, { answer: { answer: 57.5 } }, 57.5)).toBe('$57.5')
  })
  it('falls back to the card\'s own format when the key is words or another number', () => {
    expect(answerText(ladder, { prompt_json: {} }, { answer: { answer: 'Sell into strength' } }, 57.5)).toBe('57.50')
    expect(answerText(ladder, { prompt_json: {} }, { answer: { answer: '$55.00' } }, 57.5)).toBe('57.50')
    expect(answerText(null, { prompt_json: {} }, { answer: { answer: 'Hold it' } }, 53)).toBe('')
  })
})

describe('the working', () => {
  it('works an option and a spread held to expiry', () => {
    expect(workingOf(calc('option_payoff', { kind: 'put', strike: 75, premium: 1.5, underlying: 72, contracts: 1, multiplier: 100 }, 150)).text)
      .toBe('(3 − 1.5) × 100 = $150')
    expect(workingOf(calc('vertical_payoff', { kind: 'call', long_strike: 100, short_strike: 105, net_debit: 1.8, underlying: 103, contracts: 1, multiplier: 100 }, 120)).text)
      .toBe('(3 − 1.8) × 100 = $120')
  })

  it('fills the calculation with the question\'s numbers', () => {
    const w = workingOf(calc('arith', { expr: 'entry + 3 * (entry - stop)', entry: 50, stop: 47.5 }, 57.5), ladder)
    expect(w.text).toBe('50 + 3 × (50 − 47.5) = 57.50')
    expect(workingOf(calc('pct_change', { start: 40, end: 44 }, 10)).text).toBe('(44 − 40) ÷ 40 × 100 = 10%')
    expect(workingOf(calc('shares_from_risk', { account: 40000, risk_pct: 0.5, entry: 30, stop: 31.5 }, 133)).text)
      .toBe('$40,000 × 0.5% ÷ 1.5 a share, rounded down = 133 shares')
    expect(workingOf(calc('gain_to_recover', { loss_pct: 78 }, 354.5)).text).toBe('100 ÷ (100 − 78) × 100 − 100 = 354.5%')
  })

  it('shows nothing rather than a line that disagrees with the scored result', () => {
    expect(workingOf(calc('pct_change', { start: 40, end: 44 }, 11))).toBeNull()
    expect(workingOf(calc('nonsense', { a: 1 }, 1))).toBeNull()
    expect(workingOf(calc('arith', { expr: 'a ** 2', a: 3 }, 9))).toBeNull()      // a form the reader does not take
    expect(workingOf(calc('arith', { expr: 'a + b', a: 1 }, 3))).toBeNull()        // a value it was not given
  })
})
