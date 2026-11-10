/**
 * Order Ticket rails (docs/study/GAMES.md, kind `ticket`). Every number the game shows comes from orderTicket.js, so the
 * rules are pinned here with known values: the seeded generator, exact cents formatting, each template's right ticket at a
 * fixed seed, the order rules over thousands of seeds (a buy stop over the market, a sell stop under it, limits on the
 * right side, the cent over and under the level, a stop-limit's limit past its stop), the named mistakes the wrong prices
 * model, the run (every rule once), the scoring, the working, the ladder and the hearts.
 */
import { describe, it, expect } from 'vitest'
import {
  FAMILIES, HOUSE_ENTRY, LABEL_CHAR_W, LABEL_CHAR_W_WIDE, LABEL_PX, NO_PRICE, SIDES, SIDE_WHY, SOURCES, TEMPLATES, TICKET_HEARTS,
  TICKET_TOTAL, TYPES, anchorFor, anchorOf, between, buildRun, buildSituation, down10, fmt, heartsLeft, labelFit, labelSpan,
  ladderOf, levelAbove, levelBelow, makeQuote, missLine, orderMarks, randInt, rightTicket, rng, runOver, runPost, saidTicket,
  scoreTicket, shuffle, stackRows, ticketText, up10, verdictMiss, working,
} from './orderTicket'

const IDS = Object.keys(TEMPLATES)
const fixed = (...vals) => { let i = 0; return () => vals[i++ % vals.length] }
const level = (s, key = 'level') => s.levels.find((l) => l.key === key)?.cents
const rightOf = (s) => s.prices[s.price]
const pickRight = (s) => ({ side: s.side, type: s.type, price: s.price })
const sentences = (t) => t.split(/(?<=[.!?])\s+/).filter(Boolean)
const words = (t) => t.trim().split(/\s+/).length
const memberText = (s) => [...s.text, ...s.prices.map((p) => p.why), ...Object.values(s.typeWhy), ...Object.values(s.sideWhy), s.rule, s.house || '', s.source]

describe('the seeded generator', () => {
  it('gives the same numbers for the same seed, and known values for seed 1', () => {
    const a = rng(1), b = rng(1)
    expect([a(), a(), a()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522])
    expect([b(), b(), b()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522])
    expect(rng(2)()).not.toBe(rng(1)())
  })
  it('never sticks on seed 0 and takes a Date.now() sized seed', () => {
    expect(rng(0)()).toBe(0.3588899802416563)
    const big = rng(1762560000000)
    const v = [big(), big(), big()]
    v.forEach((x) => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1) })
    expect(new Set(v).size).toBe(3)
  })
  it('draws whole numbers inside the bounds, and shuffles without losing or adding anything', () => {
    expect(randInt(fixed(0), 5, 9)).toBe(5)
    expect(randInt(fixed(0.999999), 5, 9)).toBe(9)
    const r = rng(9)
    for (let i = 0; i < 500; i++) { const v = randInt(r, 1, 3); expect([1, 2, 3]).toContain(v) }
    const s = shuffle(rng(3), ['a', 'b', 'c', 'd'])
    expect([...s].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(shuffle(rng(3), ['a', 'b', 'c', 'd'])).toEqual(s)
  })
})

describe('prices in whole cents', () => {
  it('formats exactly, never through a float', () => {
    expect(fmt(5001)).toBe('50.01')
    expect(fmt(1005)).toBe('10.05')       // (10.05).toFixed(2) is the float trap this avoids
    expect(fmt(100)).toBe('1.00')
    expect(fmt(5)).toBe('0.05')
    expect(fmt(24000)).toBe('240.00')
    expect(fmt(-250)).toBe('-2.50')
  })
  it('rounds levels onto a 10-cent line, up or down', () => {
    expect(up10(5001)).toBe(5010)
    expect(up10(5010)).toBe(5010)
    expect(down10(5009)).toBe(5000)
    expect(down10(5000)).toBe(5000)
  })
  it('puts a level a few percent away, on a 10-cent line and at least 10 cents clear', () => {
    // 2.0% over 50.00 = 51.00; 0.5% of 15.00 is under 10 cents, so the 10-cent floor holds
    expect(levelAbove(fixed(0), 5000, 2, 3)).toBe(5100)
    expect(levelBelow(fixed(0), 5000, 2, 3)).toBe(4900)
    expect(levelAbove(fixed(0), 1500, 0.5, 1)).toBe(1510)
    expect(levelBelow(fixed(0), 1500, 0.5, 1)).toBe(1490)
    expect(between(fixed(0), 1000, 2000)).toBe(1300)
    expect(between(fixed(0.999999), 1000, 2000)).toBe(1700)
  })
  it('deals a quote with the ask over the bid by the spread and the last trade inside them', () => {
    expect(makeQuote(fixed(0, 0.2), 1)).toEqual({ bid: 1500, ask: 1501, last: 1500, spread: 1 })
    expect(makeQuote(fixed(0, 0.7), 1)).toEqual({ bid: 1500, ask: 1501, last: 1501, spread: 1 })
    const r = rng(11)
    for (let i = 0; i < 2000; i++) {
      const q = makeQuote(r, 3)
      expect(q.bid).toBeGreaterThanOrEqual(1500); expect(q.bid).toBeLessThanOrEqual(24000)
      expect(q.ask - q.bid).toBe(q.spread); expect(q.spread).toBeGreaterThanOrEqual(1); expect(q.spread).toBeLessThanOrEqual(3)
      expect(q.last).toBeGreaterThanOrEqual(q.bid); expect(q.last).toBeLessThanOrEqual(q.ask)
    }
  })
})

describe('every template at seed 1: the right ticket, the quote and the named mistakes', () => {
  it('buy the breakout: a buy stop a cent over the high (the order that automates our trigger), not on the high, not at the market', () => {
    const s = buildSituation('buy-stop', 1)
    expect(s.quote).toEqual({ bid: 15609, ask: 15610, last: 15610, spread: 1 })
    expect(level(s)).toBe(16080)
    expect(s.text[0]).toBe('It has tightened under the 160.80 high all week, and you have no position.')
    expect(s.prices.map((p) => p.label)).toEqual(['160.80', '160.81', NO_PRICE])
    expect(s.price).toBe(1)
    expect(rightTicket(s)).toBe('Buy · Stop · 160.81')
    expect(s.house).toBe(HOUSE_ENTRY)
    expect(s.prices[0].why).toMatch(/the high itself/)
    expect(s.prices[2].why).toMatch(/market order.*156\.10 ask, before the break/)
    expect(s.typeWhy.Limit).toBe('A buy limit at 160.81 buys now. A limit fills at your price or better, and the 156.10 ask is better.')
  })
  it('every other template deals its own known ticket', () => {
    const want = {
      'buy-market': 'Buy · Market',
      'sell-market': 'Sell · Market',
      'buy-limit': 'Buy · Limit · 146.70',
      'sell-stop': 'Sell · Stop · 148.19',
      'sell-limit': 'Sell · Limit · 171.60',
      'short-stop': 'Sell short · Stop · 151.39',
      'short-limit': 'Sell short · Limit · 165.50',
      'cover-stop': 'Buy to cover · Stop · 164.01',
      'cover-limit': 'Buy to cover · Limit · 140.60',
      'sell-stoplimit': 'Sell · Stop-limit · 148.19 stop · 146.70 limit',
      'cover-stoplimit': 'Buy to cover · Stop-limit · 164.01 stop · 165.70 limit',
      'buy-stop': 'Buy · Stop · 160.81',
    }
    expect(Object.keys(want).sort()).toEqual([...IDS].sort())
    for (const id of IDS) expect(rightTicket(buildSituation(id, 1))).toBe(want[id])
  })
  it('the stop with a floor names the low and the floor, and its wrong prices are a plain stop and the swap', () => {
    const s = buildSituation('sell-stoplimit', 1)
    expect(s.levels.map((l) => [l.label, l.cents])).toEqual([['The low', 14820], ['Your floor', 14670]])
    expect(s.text[1]).toBe("If it gaps through, you'll sell no lower than 146.70, never under it.")
    expect(s.prices.map((p) => p.label)).toEqual(['148.19 stop · 146.70 limit', '146.70 stop · 148.19 limit', '148.19'])
    expect(s.prices[1].why).toMatch(/^Swapped\./)
    expect(s.prices[2].why).toMatch(/plain stop.*market order.*far under 146\.70/)
    expect(s.typeWhy['Stop-limit']).toMatch(/may not fill at all/)
    expect(s.rule).toMatch(/may not fill at all and you still hold it/)
  })
  it('protecting a long: the floor you did not ask for is the named mistake, as is a stop on the low itself', () => {
    const s = buildSituation('sell-stop', 1)
    expect(s.entry).toBe(15364)
    expect(s.prices.map((p) => p.label)).toEqual(['148.19 stop · 146.70 limit', '148.20', '148.19'])
    expect(s.prices[0].why).toMatch(/floor on the sale.*you said whatever the fill/)
    expect(s.typeWhy.Limit).toBe('A sell limit at 148.19 sells now. A limit fills at your price or better, and the 156.09 bid is better.')
  })
  it('a market ticket carries no price; the bid and the ask are the mistakes', () => {
    const s = buildSituation('buy-market', 1)
    expect(s.levels).toEqual([{ key: 'spread', label: 'Spread', cents: 1, ladder: false }])
    expect(rightOf(s).label).toBe(NO_PRICE)
    expect(s.prices.map((p) => p.label).sort()).toEqual(['156.09', '156.10', NO_PRICE].sort())
    expect(rightOf(s).why).toBe('A market order carries no price. It buys now, at or near the 156.10 ask.')
  })
})

describe('the order rules hold for every template over thousands of seeds', () => {
  const SEEDS = Array.from({ length: 1500 }, (_, i) => i * 7919 + 13)
  it('the right price sits on the right side of the market, a cent past the level for a stop', () => {
    for (const seed of SEEDS) {
      for (const id of IDS) {
        const s = buildSituation(id, seed)
        const { bid, ask } = s.quote
        const r = rightOf(s)
        const v = level(s)
        expect(s.prices.filter((p) => p.ok)).toHaveLength(1)
        expect(new Set(s.prices.map((p) => p.label)).size).toBe(3)
        switch (id) {
          case 'buy-market': case 'sell-market':
            expect(r.cents).toBe(null); expect(ask - bid).toBe(1); break
          case 'buy-stop':                                   // a buy stop sits over the market, a cent over the high
            expect(r.cents).toBe(v + 1); expect(v).toBeGreaterThanOrEqual(ask + 10); break
          case 'cover-stop':
            expect(r.cents).toBe(v + 1); expect(v).toBeGreaterThanOrEqual(ask + 10); break
          case 'sell-stop': case 'short-stop':               // a sell stop sits under the market, a cent under the low
            expect(r.cents).toBe(v - 1); expect(v).toBeLessThanOrEqual(bid - 10); break
          case 'buy-limit': case 'cover-limit':              // a buy limit sits under the market, at the price
            expect(r.cents).toBe(v); expect(v).toBeLessThanOrEqual(bid - 10); break
          case 'sell-limit': case 'short-limit':             // a sell limit sits over the market, at the price
            expect(r.cents).toBe(v); expect(v).toBeGreaterThanOrEqual(ask + 10); break
          case 'sell-stoplimit':                             // the stop a cent under the low, the floor under the stop
            expect(r.cents).toBe(v - 1); expect(r.limit).toBe(level(s, 'limit')); expect(r.limit).toBeLessThan(r.cents); expect(v).toBeLessThanOrEqual(bid - 10); break
          case 'cover-stoplimit':                            // the stop a cent over the high, the cap over the stop
            expect(r.cents).toBe(v + 1); expect(r.limit).toBe(level(s, 'limit')); expect(r.limit).toBeGreaterThan(r.cents); expect(v).toBeGreaterThanOrEqual(ask + 10); break
          default: throw new Error(id)
        }
        // an entry the situation names is on the losing or winning side it says
        if (id === 'sell-market') expect(s.entry).toBeGreaterThan(ask)
        if (id === 'sell-stop' || id === 'sell-stoplimit') { expect(s.entry).toBeGreaterThan(v); expect(s.entry).toBeLessThan(bid) }
        if (id === 'cover-stop' || id === 'cover-stoplimit') { expect(s.entry).toBeLessThan(v); expect(s.entry).toBeGreaterThan(ask) }
        if (id === 'sell-limit') expect(s.entry).toBeLessThan(bid)
        if (id === 'cover-limit') expect(s.entry).toBeGreaterThan(ask)
      }
    }
  })
  it('the wrong prices are the named mistakes: the level itself, a cent the wrong way, the market now, a floor or cap not asked for', () => {
    for (const seed of SEEDS.slice(0, 300)) {
      for (const id of IDS) {
        const s = buildSituation(id, seed)
        const v = level(s)
        const wrong = s.prices.filter((p) => !p.ok)
        const { bid, ask } = s.quote
        if (['buy-stop', 'sell-stop', 'short-stop', 'cover-stop'].includes(id)) expect(wrong.some((p) => p.cents === v && p.limit == null)).toBe(true)
        if (id === 'buy-limit') { expect(wrong.map((p) => p.cents).sort()).toEqual([v + 1, ask].sort()) }
        if (id === 'cover-limit') { expect(wrong.map((p) => p.cents).sort()).toEqual([v + 1, ask].sort()) }
        if (id === 'sell-limit' || id === 'short-limit') { expect(wrong.map((p) => p.cents).sort()).toEqual([v - 1, bid].sort()) }
        if (id === 'buy-stop' || id === 'short-stop') expect(wrong.some((p) => p.label === NO_PRICE)).toBe(true)
        if (id === 'sell-stop') expect(wrong.some((p) => p.limit != null && p.limit < p.cents)).toBe(true)
        if (id === 'cover-stop') expect(wrong.some((p) => p.limit != null && p.limit > p.cents)).toBe(true)
        if (id.endsWith('stoplimit')) {
          expect(wrong.some((p) => p.limit == null && p.cents === rightOf(s).cents)).toBe(true)          // the plain stop
          expect(wrong.some((p) => p.cents === rightOf(s).limit && p.limit === rightOf(s).cents)).toBe(true)  // the swap
        }
        if (id.endsWith('market')) expect(wrong.map((p) => p.cents).sort()).toEqual([bid, ask].sort())
      }
    }
  })
  it('says why for every side and every type, and the stop rules are the SEC definitions in plain words', () => {
    for (const id of IDS) {
      const s = buildSituation(id, 5)
      expect(Object.keys(s.sideWhy).sort()).toEqual([...SIDES].sort())
      expect(Object.keys(s.typeWhy).sort()).toEqual([...TYPES].sort())
      expect(SIDES).toContain(s.side); expect(TYPES).toContain(s.type)
      expect(s.source).toBe(SOURCES[s.unit])
      if (s.type === 'Stop') expect(s.rule).toMatch(/reaches the stop price, it becomes a market order/)
      if (s.type === 'Stop-limit') expect(s.rule).toMatch(/becomes a limit order once the stop price trades.*may not fill at all/)
      if (s.type === 'Limit') expect(s.rule).toMatch(/fills at your price or (lower|higher), never (higher|lower)/)
      if (s.type === 'Market') expect(s.rule).toMatch(/fills now at the best price available, not a set price/)
    }
    expect(SIDE_WHY['close-short'].Buy).toMatch(/Buy to cover is the side that closes a short/)
    expect(SIDE_WHY['open-short'].Sell).toMatch(/Sell short/)
  })
  it('member copy keeps the voice: two sentences of at most 22 words, no em-dash, never "the firm", no broken numbers', () => {
    for (const seed of SEEDS.slice(0, 200)) {
      for (const id of IDS) {
        const s = buildSituation(id, seed)
        expect(s.text).toHaveLength(2)
        for (const line of s.text) { expect(sentences(line)).toHaveLength(1); expect(words(line)).toBeLessThanOrEqual(22) }
        for (const t of memberText(s)) {
          expect(t).not.toMatch(/[—–]/)
          expect(t).not.toMatch(/\bfirm\b/i)
          expect(t).not.toMatch(/NaN|undefined|null/)
          expect(t).not.toMatch(/!/)
        }
      }
    }
  })
})

describe('the run', () => {
  it('deals eight, one from each family, the same run for the same seed', () => {
    const run = buildRun(42)
    expect(run).toHaveLength(TICKET_TOTAL)
    expect(run.map((s) => s.id)).toEqual(['short-stop', 'cover-stoplimit', 'sell-market', 'short-limit', 'sell-limit', 'buy-stop', 'sell-stop', 'cover-stop'])
    expect(run.map((s) => s.seed)).toEqual([7961, 15880, 23799, 31718, 39637, 47556, 55475, 63394])
    expect(buildRun(42).map(rightTicket)).toEqual(run.map(rightTicket))
    expect(buildRun(7).map((s) => s.id)).toEqual(['short-limit', 'sell-stoplimit', 'cover-stop', 'sell-stop', 'buy-market', 'buy-stop', 'short-stop', 'cover-limit'])
  })
  it('covers every family, so every side and every order type comes up in every run', () => {
    for (let seed = 1; seed < 400; seed++) {
      const run = buildRun(seed * 104729)
      FAMILIES.forEach((fam) => expect(run.filter((s) => fam.includes(s.id))).toHaveLength(1))
      expect(new Set(run.map((s) => s.side))).toEqual(new Set(SIDES))
      expect(new Set(run.map((s) => s.type))).toEqual(new Set(TYPES))
    }
  })
})

describe('scoring and the working', () => {
  const s = buildSituation('buy-stop', 1)   // Buy · Stop · 160.81 (price index 1)
  it('scores a ticket only when all three fields are right', () => {
    expect(scoreTicket(s, pickRight(s))).toEqual({ side: true, type: true, price: true, ok: true })
    expect(scoreTicket(s, { ...pickRight(s), side: 'Sell' })).toEqual({ side: false, type: true, price: true, ok: false })
    expect(scoreTicket(s, { ...pickRight(s), type: 'Limit' })).toEqual({ side: true, type: false, price: true, ok: false })
    expect(scoreTicket(s, { ...pickRight(s), price: 0 })).toEqual({ side: true, type: true, price: false, ok: false })
    expect(scoreTicket(s, { side: null, type: null, price: null }).ok).toBe(false)
  })
  it('says a ticket out loud', () => {
    expect(ticketText('Buy', 'Stop', '160.81')).toBe('Buy · Stop · 160.81')
    expect(ticketText('Buy', 'Market', NO_PRICE)).toBe('Buy · Market')
    expect(ticketText('Buy', 'Stop', NO_PRICE)).toBe('Buy · Stop · No price')
    expect(ticketText('Sell', 'Market', '156.09')).toBe('Sell · Market · 156.09')
    expect(saidTicket(s, { side: 'Sell', type: 'Limit', price: 2 })).toBe('Sell · Limit · No price')
  })
  it('shows the right answer and why, and why each wrong pick is wrong', () => {
    const w = working(s, { side: 'Sell', type: 'Limit', price: 2 })
    expect(w.ok).toBe(false)
    expect(w.ticket).toBe('Buy · Stop · 160.81')
    expect(w.said).toBe('Sell · Limit · No price')
    expect(w.rows.map((r) => [r.field, r.right, r.said, r.ok])).toEqual([['side', 'Buy', 'Sell', false], ['type', 'Stop', 'Limit', false], ['price', '160.81', NO_PRICE, false]])
    expect(w.rows[0].saidWhy).toBe('Sell closes shares you own. You own none.')
    expect(w.rows[1].why).toBe('A buy stop sits over the market and waits. When it trades at 160.81, it becomes a market order and buys the break.')
    expect(w.rows[1].saidWhy).toBe('A buy limit at 160.81 buys now. A limit fills at your price or better, and the 156.10 ask is better.')
    expect(w.rows[2].saidWhy).toBe('No price is a market order, and that buys now near the 156.10 ask, before the break.')
    expect(w.rule).toBe('A buy stop sits over the market. Once the stock reaches the stop price, it becomes a market order.')
    expect(w.house).toBe('Our entries are market orders once it trades through the trigger (UCT rulebook E57). A buy stop a cent over does the same job when you cannot watch.')
    expect(missLine(w)).toBe('You said Sell. Sell closes shares you own. You own none.')
    const right = working(s, pickRight(s))
    expect(right.ok).toBe(true)
    expect(right.rows.every((r) => r.ok && r.saidWhy === null)).toBe(true)
    expect(missLine(right)).toBe(null)
    expect(missLine(working(s, { side: 'Buy', type: null, price: 1 }))).toMatch(/^No order type picked\./)
  })
  it('the verdict on a miss marks every field and teaches the first wrong one, in one line', () => {
    const v = verdictMiss(working(s, { side: 'Buy', type: 'Limit', price: 0 }))
    expect(v.marks).toEqual([{ field: 'side', label: 'Side', ok: true }, { field: 'type', label: 'Order type', ok: false }, { field: 'price', label: 'Price', ok: false }])
    expect(v.field).toBe('Order type')
    expect(v.line).toBe('You said Limit. A buy limit at 160.81 buys now. A limit fills at your price or better, and the 156.10 ask is better.')
    const all = verdictMiss(working(s, { side: 'Sell', type: 'Limit', price: 2 }))
    expect(all.marks.map((m) => m.ok)).toEqual([false, false, false])
    expect([all.field, all.line]).toEqual(['Side', 'You said Sell. Sell closes shares you own. You own none.'])
    expect(verdictMiss(working(s, pickRight(s)))).toMatchObject({ field: null, line: null })
  })
})

describe('the ladder on the quote card', () => {
  it('places the market and the level as fractions of the card, with room at both ends', () => {
    const s = buildSituation('buy-stop', 1)
    const lad = ladderOf(s)
    expect([lad.lo, lad.hi]).toEqual([15538, 16152])                    // 156.09..160.81 and 15% of the span each side
    expect(lad.market.from).toBeCloseTo((15609 - 15538) / 614, 12)
    expect(lad.market.to).toBeCloseTo((15610 - 15538) / 614, 12)
    expect(lad.below.map((b) => [b.key, b.text, b.row, b.anchor])).toEqual([['market', 'Market now', 0, 'start'], ['level', 'The high 160.80', 0, 'end']])
    expect(lad.rowsBelow).toBe(1)
    expect(lad.x(16080)).toBeCloseTo(542 / 614, 12)
  })
  it('keeps every point inside the card for every template', () => {
    for (let seed = 1; seed < 400; seed++) {
      for (const id of IDS) {
        const s = buildSituation(id, seed)
        const lad = ladderOf(s)
        const xs = [lad.market.from, lad.market.to, ...lad.below.map((b) => b.x), ...orderMarks(s, { price: 0 }).map((m) => m.x)]
        xs.forEach((x) => { expect(x).toBeGreaterThan(0.05); expect(x).toBeLessThan(0.95) })
        expect(lad.rowsBelow).toBeLessThanOrEqual(2)
      }
    }
  })
  it('stacks labels so no two on a row overlap, and hangs each from the side with room', () => {
    expect(anchorOf(0.1)).toBe('start'); expect(anchorOf(0.5)).toBe('middle'); expect(anchorOf(0.9)).toBe('end')
    expect(labelSpan({ x: 0.1, text: 'Stop 148.19' })).toEqual([0.08, expect.closeTo(0.08 + 11 * 0.022 + 0.04, 12)])
    const rows = stackRows([{ key: 'a', x: 0.12, text: 'Your floor 146.70' }, { key: 'b', x: 0.24, text: 'The low 148.20' }, { key: 'c', x: 0.88, text: 'Market now' }])
    expect(rows.map((r) => [r.key, r.row])).toEqual([['a', 0], ['b', 1], ['c', 0]])
    for (let seed = 1; seed < 300; seed++) {
      for (const id of IDS) {
        const s = buildSituation(id, seed)
        for (const set of [ladderOf(s).below, orderMarks(s, { price: (seed % 3) })]) {
          for (const p of set) for (const q of set) {
            if (p.key === q.key || p.row !== q.row) continue
            const [a, b] = labelSpan(p), [c, d] = labelSpan(q)
            expect(a < d && c < b).toBe(false)
          }
        }
      }
    }
  })
  it('stacks for the card it is drawn on: a phone needs a second row where a wide card does not', () => {
    const s = buildSituation('cover-stop', 1623424478)            // the market far left, the 124.90 high right of centre
    expect(ladderOf(s).below.map((b) => [b.key, b.row])).toEqual([['market', 0], ['level', 1]])
    expect(ladderOf(s, LABEL_CHAR_W_WIDE).below.map((b) => [b.key, b.row])).toEqual([['market', 0], ['level', 0]])
    expect(ladderOf(s, LABEL_CHAR_W_WIDE).rowsBelow).toBe(1)
    const on = s.prices.findIndex((p) => p.label === '124.90')    // a cent apart, the two flags stack at any width
    expect(orderMarks(s, { price: on }, LABEL_CHAR_W_WIDE).map((m) => [m.key, m.text, m.row])).toEqual([['right', 'Buy to cover stop 124.91', 1], ['said', 'Yours 124.90', 0]])
  })
  it('draws the right order in green and the member\'s different price in red', () => {
    const s = buildSituation('buy-stop', 1)
    expect(orderMarks(s, { price: 1 }).map((m) => [m.key, m.tone, m.text])).toEqual([['right', 'right', 'Buy stop 160.81']])
    expect(orderMarks(s, { price: 0 }).map((m) => [m.key, m.tone, m.text, m.row])).toEqual([['right', 'right', 'Buy stop 160.81', 1], ['said', 'said', 'Yours 160.80', 0]])
    expect(orderMarks(s, { price: 2 }).map((m) => m.key)).toEqual(['right'])          // No price marks nothing of its own
    const sl = buildSituation('sell-stoplimit', 1)
    expect(orderMarks(sl, { price: 0 }).map((m) => m.text)).toEqual(['Stop 148.19', 'Limit 146.70'])
    expect(orderMarks(sl, { price: 1 }).map((m) => m.key)).toEqual(['right-stop', 'right-limit'])   // the swap: same two prices
    const ss = buildSituation('sell-stop', 1)
    expect(orderMarks(ss, { price: 0 }).map((m) => [m.key, m.text])).toEqual([['right', 'Sell stop 148.19'], ['said-limit', 'Your limit 146.70']])
    const bm = buildSituation('buy-market', 1)
    expect(orderMarks(bm, { price: 0 }).map((m) => m.text)).toEqual(['Fills near 156.10'])
    expect(orderMarks(buildSituation('sell-market', 1), { price: 0 }).map((m) => m.text)).toEqual(['Fills near 156.09'])
  })
})

describe('the ladder measured for the card it is drawn on', () => {
  it('turns the card\'s pixels into fractions of it', () => {
    expect(LABEL_PX).toEqual({ char: 7.2, flag: 24, under: 4, hang: 8, gap: 6 })
    const f = labelFit(300)
    expect(f.charW).toBeCloseTo(0.024, 12)
    expect(f.pad).toBeCloseTo(0.08, 12)
    expect(f.nudge).toBeCloseTo(8 / 300, 12)
    expect(f.gap).toBeCloseTo(0.02, 12)
    expect(f.under).toMatchObject({ charW: f.charW, nudge: f.nudge, gap: f.gap })
    expect(f.under.pad).toBeCloseTo(4 / 300, 12)
    expect(labelFit(0).charW).toBeCloseTo(7.2 / 160, 12)            // never measured as nothing: a floor of 160px
    // a measured label spans its characters, its pill and its hang: "Stop 148.19" from 0.1 on a 300px card
    expect(labelSpan({ x: 0.1, text: 'Stop 148.19' }, f)).toEqual([expect.closeTo(0.1 - 8 / 300, 12), expect.closeTo(0.1 - 8 / 300 + (11 * 7.2 + 24) / 300, 12)])
  })
  it('a 260px phone card stacks the two flags the fixed guess let touch (a sell limit and the bid you picked)', () => {
    const s = buildSituation('sell-limit', 1)
    const bid = s.prices.findIndex((p) => p.cents === s.quote.bid)
    expect(orderMarks(s, { price: bid }, LABEL_CHAR_W).map((m) => [m.key, m.row])).toEqual([['right', 0], ['said', 0]])
    expect(orderMarks(s, { price: bid }, labelFit(260)).map((m) => [m.key, m.text, m.row, m.anchor])).toEqual([['right', 'Sell limit 171.60', 1, 'end'], ['said', 'Yours 156.09', 0, 'start']])
  })
  it('hangs a long label from the side that keeps it on the card, and slides one no side can hold, its pin left on its price', () => {
    const long = { key: 'r', x: 0.669, text: 'Buy to cover stop 209.11' }
    expect(anchorOf(long.x)).toBe('end')
    expect(anchorFor(long, labelFit(260))).toBe('middle')                   // hung from its end it would run off the left
    const [placed] = stackRows([long], labelFit(240))                      // too wide for any side at 240px: it slides left
    expect(placed.x).toBe(0.669)
    expect(placed.shift).toBeLessThan(0)
    const [a, b] = labelSpan(placed, labelFit(240))
    expect(a).toBeGreaterThanOrEqual(0); expect(b).toBeCloseTo(1, 9)
    expect(stackRows([long], labelFit(800))[0]).toMatchObject({ anchor: 'end', shift: 0 })   // a wide card needs neither
  })
  it('at every width from a small phone to a desktop, no two labels on a row touch and none leaves the card', () => {
    // 220px is the ladder on a 320px phone (the sheet's and the lesson's gutters, the card's padding); 200px is narrower
    // than any phone, where a label wider than the whole card starts at its left edge
    for (const W of [200, 220, 240, 260, 300, 360, 480, 600, 900]) {
      const fit = labelFit(W)
      for (let seed = 1; seed < 160; seed++) {
        for (const id of IDS) {
          const s = buildSituation(id, seed * 7919)
          const lad = ladderOf(s, fit)
          const sets = [[lad.below, fit.under], ...[0, 1, 2].map((p) => [orderMarks(s, { price: p }, fit), fit])]
          for (const [set, f] of sets) {
            for (const p of set) {
              const [a, b] = labelSpan(p, f)
              expect(a).toBeGreaterThanOrEqual(-1e-9)
              if (b - a <= 1) expect(b).toBeLessThanOrEqual(1 + 1e-9)
              else { expect(W).toBe(200); expect(a).toBeCloseTo(0, 9) }
              for (const q of set) {
                if (p.key === q.key || p.row !== q.row) continue
                const [c, d] = labelSpan(q, f)
                expect(a < d + f.gap - 1e-9 && c < b + f.gap - 1e-9).toBe(false)
              }
            }
          }
        }
      }
    }
  })
})

describe('hearts and the report', () => {
  it('a miss costs a heart; the run ends at eight tickets or no hearts', () => {
    expect(TICKET_HEARTS).toBe(3)
    expect(heartsLeft([])).toBe(3)
    expect(heartsLeft([true, false, true])).toBe(2)
    expect(heartsLeft([false, false, false, false])).toBe(0)
    expect(runOver([true, false])).toBe(false)
    expect(runOver([false, true, false, false])).toBe(true)
    expect(runOver(Array(8).fill(true))).toBe(true)
    expect(runOver(Array(7).fill(true))).toBe(false)
  })
  it('reports the tickets played and the tickets right', () => {
    expect(runPost('ticket-42', [true, false, true, false, false])).toEqual({ kind: 'ticket', run_id: 'ticket-42', right: 2, total: 5 })
    expect(runPost('ticket-1', [])).toEqual({ kind: 'ticket', run_id: 'ticket-1', right: 0, total: 0 })
  })
})
