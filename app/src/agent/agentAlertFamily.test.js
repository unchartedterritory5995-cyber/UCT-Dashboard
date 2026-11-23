// ALERTS family (Charts C1 / C2 / C3): the instant path's GENERAL reader (capabilities/alertPhrases.js), tested as phrase
// CLASSES — every lead × when × subject × motion × level is generated and must read as ONE existing capability with the args
// the class says (alert.create, indicatorAlert.create, alert.list, indicatorAlert.list). Then the near-misses each class must
// NOT claim: no side said, a percent move, alert sounds, an indicator word as a ticker, a chart that is not certain.
// The deterministic readers only (multiChart → fast path → compound, useAgent's order) on the capability-regression boards;
// what the reading DOES to the state is agentAlertFamily.outcome.test.jsx.
import { describe, it, expect } from 'vitest'
import { registerCatalog } from './qa/capabilityRegression/testing/registry'
import { deterministicReading } from './qa/capabilityRegression/testing/corpus'
import { panelHost } from './qa/capabilityRegression/testing/harness'
import { pinClock } from './qa/capabilityRegression/testing/clock'

pinClock()
await registerCatalog()

const host = (board, selected = null) => {
  const h = panelHost(board)
  return selected ? { ...h, charts: { ...h.charts, selected: () => selected } } : h
}
/** The ONE op a phrase is read as instantly, or null. */
const read = (text, h) => {
  const r = deterministicReading(text, h)
  return r?.plan?.length === 1 ? r.plan[0] : r?.say ? { say: true } : r ? { other: r } : null
}
const cross = (...lists) => lists.reduce((acc, xs) => acc.flatMap(a => xs.map(x => [...a, x])), [[]])
// every class is generated whole; a spread sample of each runs here (12,000 per class ran clean once, 2026-11-23)
const SAMPLE = 1500
const pick = (all, n) => (all.length <= n ? all : all.filter((_, i) => i % Math.ceil(all.length / n) === 0))

// ── the grammar's parts ──
const LEADS = ['alert me', 'ping me', 'notify me', 'let me know', 'tell me', 'text me', 'warn me', 'give me a heads up', 'set an alert', 'set up an alert', 'create an alert', 'add an alert', 'please alert me']
const WHENS = ['when', 'if', 'once', 'as soon as']
const UP = ['goes above', 'gets above', 'moves above', 'trades above', 'rises above', 'climbs above', 'breaks above', 'breaks out above', 'crosses above', 'crosses over', 'pops above', 'is above', 'closes above', 'gets back above', 'rises to', 'rallies to', 'runs up to', 'reclaims', 'clears', 'tops']
const DOWN = ['goes below', 'drops below', 'falls below', 'dips below', 'breaks below', 'breaks down below', 'crosses below', 'crosses under', 'trades below', 'slips below', 'sinks below', 'is below', 'closes below', 'gets under', 'falls to', 'drops to', 'pulls back to', 'loses', 'undercuts', 'tanks below']
const LEVELS = [['150', 150], ['$150', 150], ['212.50', 212.5], ['$1,250', 1250], ['95 bucks', 95]]

describe('C1-114 / C3-128 price alerts: lead × when × ticker × motion × level → alert.create', () => {
  const H = host('ONE')        // one NVDA chart: a lower-case "nvda" is the chart's own ticker; AAPL is typed in capitals
  const TICKERS = [['AAPL', 'AAPL'], ['$TSLA', 'TSLA'], ['nvda', 'NVDA'], ['NVDA', 'NVDA'], ['the AMD chart', 'AMD'], ['AAPL stock', 'AAPL']]
  const all = cross(LEADS, WHENS, TICKERS, [...UP.map(m => [m, 'above']), ...DOWN.map(m => [m, 'below'])], LEVELS)
    .map(([l, w, [t, sym], [m, dir], [lv, n]]) => [`${l} ${w} ${t} ${m} ${lv}`, { symbol: sym, price: n, direction: dir }])
  it(`${all.length} generated phrasings, each read as exactly that alert`, () => {
    const miss = pick(all, SAMPLE).filter(([p, want]) => {
      const o = read(p, H)
      return !(o?.action === 'alert.create' && o.args.symbol === want.symbol && o.args.price === want.price && o.args.direction === want.direction)
    })
    expect(miss.slice(0, 10).map(x => x[0])).toEqual([])
  }, 600000)
  // the subject-first and "on / for" shapes, and the sides said in a tail
  const SHAPES = [
    ['set an alert on NVDA above 150', 'NVDA', 150, 'above'], ['create a price alert for AAPL below $180', 'AAPL', 180, 'below'],
    ['set an alert on NVDA at 150 to the upside', 'NVDA', 150, 'above'], ['add an alert for TSLA at 240 to the downside', 'TSLA', 240, 'below'],
    ['set a TSLA alert above 300', 'TSLA', 300, 'above'], ['create an AAPL price alert below 170', 'AAPL', 170, 'below'],
    ['alert me when AAPL crosses 200 to the upside', 'AAPL', 200, 'above'], ['ping me if MSFT crosses 400 to the downside', 'MSFT', 400, 'below'],
    ['set an alert for the price of AAPL above 210', 'AAPL', 210, 'above'], ['alert me when AAPL shares drop below 150', 'AAPL', 150, 'below'],
  ]
  it.each(SHAPES)('"%s" → %s %s %s', (p, sym, n, dir) => expect(read(p, H)).toEqual({ action: 'alert.create', args: { symbol: sym, price: n, direction: dir } }))
})

describe('the chart as the subject: one chart, or the CLICKED chart said as such', () => {
  const POINTERS = ['it', 'this', 'this one', 'this stock', 'price', 'the price', 'the stock', 'this chart']
  const all = cross(['alert me', 'ping me', 'notify me'], ['when', 'if'], POINTERS, [['goes above', 'above'], ['drops below', 'below']])
    .map(([l, w, p, [m, dir]]) => [`${l} ${w} ${p} ${m} 210`, dir])
  it(`${all.length} phrasings on a ONE-chart board → that chart's symbol`, () => {
    const H = host('ONE')
    expect(all.filter(([p, dir]) => { const o = read(p, H); return !(o?.action === 'alert.create' && o.args.symbol === 'NVDA' && o.args.direction === dir) }).slice(0, 5)).toEqual([])
  })
  it('no subject at all ("set an alert above 210") is the one chart\'s', () => expect(read('set an alert above 210', host('ONE'))).toEqual({ action: 'alert.create', args: { symbol: 'NVDA', price: 210, direction: 'above' } }))
  it('four charts, the bottom-left clicked: "this chart" / "this one" / "this stock" → NVDA (the clicked chart), never another', () => {
    const H = host('FOUR', 'c3')
    for (const p of ['alert me when this chart goes above 210', 'ping me if this one drops below 150', 'notify me when this stock rises to 220', 'alert me if the selected chart breaks below 140']) {
      expect(read(p, H)?.args?.symbol, p).toBe('NVDA')
    }
  })
  it.each([
    ['"it" / "this" / "price" on four charts (it may be the conversation\'s chart)', 'alert me when it goes above 210', 'c3'],
    ['', 'alert me when this goes above 210', 'c3'], ['', 'ping me if price drops below 150', 'c3'],
    ['nothing clicked', 'alert me when this chart goes above 210', null],
    ['a position word', 'alert me when this chart on the top left goes above 210', 'c3'],
    ['a position word', 'alert me when the top-right chart goes above 250', 'c3'],
    ['an ordinal', 'alert me when the second chart drops below 150', 'c3'],
    ['no subject on four charts', 'set an alert above 210', 'c3'],
  ])('left to the model (and its spatial / deixis net): %s — "%s"', (_, p, sel) => expect(read(p, host('FOUR', sel))).toBeNull())
  it('a typed ticker is that ticker on any board ("alert me when TSLA goes above 300" on four charts)', () => {
    expect(read('alert me when TSLA goes above 300', host('FOUR'))).toEqual({ action: 'alert.create', args: { symbol: 'TSLA', price: 300, direction: 'above' } })
  })
})

describe('price alerts: what is NOT read instantly (the model asks or answers)', () => {
  const H = host('ONE')
  it.each([
    'alert me when AAPL hits 200', 'alert me when AAPL reaches 200', 'alert me when AAPL crosses 200', 'set an alert on AAPL at 200', 'alert me if nvda touches 150',   // no side: asked with choices
    'alert me when NVDA moves 5%', 'alert me if NVDA drops 5 percent', 'alert me when NVDA is up 10%',                                                     // a percent move: not this product
    'alert me when NVDA volume goes above 50000000', 'alert me when gold goes above 2000',                                                                   // volume; a lower-case word no chart shows
    'alert me when AAPL goes above 200 and TSLA drops below 150',                                                                                          // two alerts: one clause each, the model plans them
    'alert me when NVDA closes above 150 on the weekly',                                                                                                   // a price alert has no timeframe
    'alert me when NVDA crosses above its 50 day', 'alert me when NVDA breaks above the 200 sma',                                                          // an average, not a level
    'tell me about TSLA', 'let me know what you think about NVDA', 'turn off alert sounds', 'mute the alert sound', 'show my watchlists',
    'alert me when AAPL crosses above 200 on the NVDA chart',                                                                                              // a ticker and a different chart
  ])('"%s"', (p) => { const o = read(p, H); expect(o?.action === 'alert.create' ? o : null).toBeNull() })
  it('an indicator word is never a ticker: "alert me when RSI goes above 70" on a chart WITHOUT RSI is not a price alert on RSI', () => {
    const o = read('alert me when RSI goes above 70', H)
    expect(o?.action).not.toBe('alert.create')
  })
})

// ── C2-089 / C2-093 indicator alerts ──
describe('C2-089 / C2-093 indicator alerts: lead × when × the RSI × motion × level (× timeframe) → indicatorAlert.create', () => {
  const H = host('IALERTS')     // one NVDA chart carrying RSI (inst:rsi:1)
  const SUBJ = ['rsi', 'RSI', 'the rsi', 'the RSI line', 'NVDA\'s rsi', 'the NVDA rsi']
  const MOT = [['goes above', 'above'], ['gets over', 'above'], ['rises above', 'above'], ['is above', 'above'], ['crosses above', 'cross_above'], ['crosses over', 'cross_above'],
    ['drops below', 'below'], ['falls under', 'below'], ['is below', 'below'], ['crosses below', 'cross_below'], ['crosses under', 'cross_below']]
  const TFS = [['', null], [' on the daily', 'D'], [' on the weekly', 'W'], [' on the weekly chart', 'W'], [' on the hourly', '60'], [' on the 15 minute', '15'], [' on the monthly bars', 'M']]
  const all = cross(['alert me', 'ping me', 'notify me', 'let me know', 'set an alert', 'mark'], ['when', 'if'], SUBJ, MOT, [['30', 30], ['70', 70], ['55.5', 55.5]], TFS)
    .map(([l, w, s, [m, cond], [lv, n], [t, tf]]) => [`${l} ${w} ${s} ${m} ${lv}${t}`, { condition: cond, threshold: n, timeframe: tf }])
  it(`${all.length} generated phrasings, each read as exactly that alert on inst:rsi:1`, () => {
    const miss = pick(all, SAMPLE).filter(([p, want]) => {
      const o = read(p, H)
      return !(o?.action === 'indicatorAlert.create' && o.args.instance === 'inst:rsi:1' && o.args.chart === 'c1' && o.args.condition === want.condition
        && o.args.threshold === want.threshold && o.args.timeframe === want.timeframe && o.args.plot === null && o.args.crossWith === null)
    })
    expect(miss.slice(0, 10).map(x => x[0])).toEqual([])
  }, 600000)
  it.each([
    ['set an RSI alert above 70', 'above', 70, null], ['create an rsi alert below 30', 'below', 30, null], ['set a weekly rsi alert above 70', 'above', 70, 'W'],
    ['alert me when the weekly rsi crosses above 70', 'cross_above', 70, 'W'], ['ping me if RSI drops below 30 on the daily', 'below', 30, 'D'],
  ])('"%s"', (p, cond, n, tf) => expect(read(p, H)).toMatchObject({ action: 'indicatorAlert.create', args: { instance: 'inst:rsi:1', condition: cond, threshold: n, timeframe: tf } }))
  it.each([
    'alert me when the macd crosses above 0',        // not on this chart: the model says to add it first
    'alert me when rsi is overbought',               // no level said
    'alert me when rsi hits 70',                     // no side said
    'alert me when rsi goes above 70 on the 45 minute',  // not a native timeframe: never read as something close
    'alert me when the weekly rsi goes above 70 on the daily',   // two timeframes
  ])('not read instantly: "%s"', (p) => { const o = read(p, H); expect(o?.action === 'indicatorAlert.create' ? o : null).toBeNull() })
})

describe('C2-090 / C2-096 moving-average crosses: the two averages on ONE chart', () => {
  const ONE = host('ONE_DEFAULT_IA')      // EMA 9 (ovl:0) / EMA 20 (ovl:1) / SMA 50 / SMA 200
  const FAST = ['the 9 ema', 'the 9', 'the 9-day ema', 'ema 9', 'the 9 ema line']
  const SLOW = ['the 20', 'the 20 ema', 'its 20', 'the 20-day']
  const MOT = [['crosses above', 'cross_above'], ['crosses over', 'cross_above'], ['crosses below', 'cross_below'], ['crosses under', 'cross_below'], ['breaks above', 'cross_above'], ['drops below', 'cross_below']]
  const all = cross(['alert me', 'tell me', 'mark', 'notify me'], ['when', 'if'], FAST, MOT, SLOW).map(([l, w, f, [m, c], s]) => [`${l} ${w} ${f} ${m} ${s}`, c])
  it(`${all.length} phrasings → instance ovl:0 crossing ovl:1 on c1`, () => {
    expect(all.filter(([p, c]) => { const o = read(p, ONE); return !(o?.action === 'indicatorAlert.create' && o.args.instance === 'ovl:0' && o.args.crossWith === 'ovl:1' && o.args.condition === c && o.args.threshold === null && o.args.chart === 'c1') }).slice(0, 5)).toEqual([])
  })
  it('"the 20 crosses below the 9": the slower average first is still one cross (the capability swaps and inverts it)', () => {
    expect(read('alert me when the 20 crosses below the 9', ONE)).toMatchObject({ action: 'indicatorAlert.create', args: { instance: 'ovl:1', crossWith: 'ovl:0', condition: 'cross_below' } })
  })
  it('four default charts: a NAMED chart picks it (c3 = NVDA); an unnamed one is the model\'s question', () => {
    const FOUR = host('FOUR_DEFAULT')
    expect(read('mark when the 9 ema crosses above the 20 on the NVDA chart', FOUR)).toMatchObject({ args: { chart: 'c3', instance: 'ovl:0', crossWith: 'ovl:1' } })
    expect(read('alert me when NVDA\'s 9 ema crosses above its 20', FOUR)).toMatchObject({ args: { chart: 'c3' } })
    expect(read('alert me when the TSLA 9 ema crosses below the 20', FOUR)).toMatchObject({ args: { chart: 'c4', condition: 'cross_below' } })
    expect(read('alert me when the 9 ema crosses above the 20', FOUR)).toBeNull()
    expect(read('alert me when the 9 ema crosses above the 20 on the top-left chart', FOUR)).toBeNull()
    // the clicked chart, said as "this chart"
    expect(read('alert me when the 9 ema crosses above the 20 on this chart', host('FOUR_DEFAULT', 'c2'))).toMatchObject({ args: { chart: 'c2' } })
    expect(read('alert me when the 9 ema crosses above the 20 on this chart', FOUR)).toBeNull()
  })
})

// ── C3-127 / C2-097 / C2-100 the book ──
describe('C3-127 / C2-097 / C2-100 reading the book: alert.list and indicatorAlert.list', () => {
  const H = host('ONE')
  const SYM = [['', null], [' on TSLA', 'TSLA'], [' for nvda', 'NVDA'], [' on $AMD', 'AMD']]
  const LISTS = [
    ...cross(['what alerts do i have', 'which alerts do i have', 'what alerts are set', 'which price alerts do i have', 'what alerts have i set'], SYM).map(([p, [s, sym]]) => [`${p}${s}`, 'alert.list', { symbol: sym, status: null, triggered_today: null }]),
    ...cross(['show my', 'show me my', 'list my', 'show me all my', 'pull up my', 'what are my'], [['alerts', 'alert.list'], ['price alerts', 'alert.list'], ['active alerts', 'alert.list'], ['indicator alerts', 'indicatorAlert.list'], ['paused indicator alerts', 'indicatorAlert.list']], SYM)
      // ("what are my price / indicator alerts" with no symbol is also a question ABOUT the product: another reader claims it, so the fast
      // path's one-reading rule leaves it to the model — never a wrong instant answer)
      .filter(([v, [n], [s]]) => !(v === 'what are my' && !s && /^(?:price|indicator) alerts$/.test(n)))
      .map(([v, [n, a], [s, sym]]) => [`${v} ${n}${s}`, a, a === 'alert.list' ? { symbol: sym, status: /active/.test(n) ? 'active' : null, triggered_today: null } : { symbol: sym, status: /paused/.test(n) ? 'paused' : null }]),
    ['show my TSLA alerts', 'alert.list', { symbol: 'TSLA', status: null, triggered_today: null }], ['do i have any alerts on TSLA', 'alert.list', { symbol: 'TSLA', status: null, triggered_today: null }],
    ['any alerts on nvda', 'alert.list', { symbol: 'NVDA', status: null, triggered_today: null }], ['is there an alert on AAPL', 'alert.list', { symbol: 'AAPL', status: null, triggered_today: null }],
    ['which alerts went off today', 'alert.list', { symbol: null, status: null, triggered_today: true }], ['what alerts triggered today', 'alert.list', { symbol: null, status: null, triggered_today: true }],
    ['which alerts went off', 'alert.list', { symbol: null, status: 'triggered', triggered_today: null }], ['did any alerts go off today on TSLA', 'alert.list', { symbol: 'TSLA', status: null, triggered_today: true }],
    ['why hasn\'t my RSI alert fired', 'indicatorAlert.list', { symbol: null, status: 'attention' }], ['why didn\'t my NVDA rsi alert go off', 'indicatorAlert.list', { symbol: 'NVDA', status: 'attention' }],
    ['why isn\'t my macd alert working', 'indicatorAlert.list', { symbol: null, status: 'attention' }], ['which of my alerts can\'t fire', 'indicatorAlert.list', { symbol: null, status: 'attention' }],
    ['are any of my alerts broken', 'indicatorAlert.list', { symbol: null, status: 'attention' }], ['show my indicator alerts that need attention', 'indicatorAlert.list', { symbol: null, status: 'attention' }],
  ]
  it(`${LISTS.length} phrasings → that list with those filters`, () => {
    expect(LISTS.filter(([p, a, args]) => { const o = read(p, H); return !(o?.action === a && JSON.stringify(o.args) === JSON.stringify(args)) }).map(([p]) => [p, read(p, H)])).toEqual([])
  })
  it.each(['why hasn\'t my NVDA alert fired', 'turn off alert sounds', 'show my alert sound settings', 'show my watchlists', 'what alerts do i have on gold', 'show my email alerts'])('not a list: "%s"', (p) => {
    const o = read(p, H)
    expect(/^(?:alert|indicatorAlert)\.list$/.test(o?.action || '') ? o : null).toBeNull()
  })
})
