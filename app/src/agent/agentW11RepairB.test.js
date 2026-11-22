// W1.1 repair-b (overnight 2026-11-03, BOARD R-04..R-06) — the browser's pure halves.
//
// R-04 (live LT-4): "mark when the 9 ema crosses above the 20 on this chart" never routed the `indicatorAlerts` group
// (fillLast, alert-word + RSI/MACD membership only), so the planner was never shown indicatorAlert.create and invented
// a limitation. The group now has trigger words for alert-like verbs beside WHEN and any indicator token, and for an
// indicator / length crossing; price-level phrasings still route the price `alerts` group only.
// R-05 (live LT-8 / LT-11): the hidden-field PHRASE detector (scanHidden.js, generated from hidden.py) and the F-16
// sentence + public alternative for a phrase (scanRefine.refineRefusalForText).
// R-06 (live LT-12): the earnings card's LEAD line carries the next report date when the kind serves one.
import { describe, it, expect } from 'vitest'
import { selectGroups, routeManifest, GROUPS } from './routing'
import { hiddenPhraseIn, HIDDEN_PHRASES, RATING_FIELDS, FLOW_FIELDS, RATINGS_REFUSAL, FLOW_REFUSAL } from './capabilities/scanHidden'
import { refineRefusalForText, publicAlternative } from './capabilities/scanRefine'
import { answerFromEarnings } from './capabilities/marketDataFacts'
import { hiddenScreenRequest } from './capabilities/screener'

// ── R-04: routing ─────────────────────────────────────────────────────────────────────────────────────────────────

const INDICATOR_ALERT_PHRASINGS = [
  'mark when the 9 ema crosses above the 20 on this chart',          // the live LT-4 request, verbatim
  'alert me when rsi goes above 70',
  'let me know when the 50 sma crosses below the 200',
  'notify me when macd crosses its signal line',
  'flag when the 9/20 cross happens on nvda',
  'tell me when the 10 ema crosses under the 21',
  'ping me if the 20 day crosses above the 50 day',
  'watch for a golden cross on spy',
  'set an alert when the 9ema crosses the 20ema',
  'warn me when stochastics go oversold',
  'heads up when the 9 crosses above the 20',
  'alert when ema 9 crossover ema 20',
  'mark when the 9 ema crosses above the 20',
  'let me know once the 21 ema crosses over the 50 on amd',
]
const PRICE_ALERT_PHRASINGS = [
  'alert me when nvda hits 150', 'notify me when aapl breaks 200', 'let me know when tsla crosses 300',
  'set an alert at 150 on nvda', 'ping me if spy drops under 500', 'alert me when nvda crosses above 150',
]
// a manifest with one action per group (the names decide the group; sizes are irrelevant here)
const MANIFEST = [
  { name: 'chart.setSymbol' }, { name: 'indicator.add' }, { name: 'alert.create' }, { name: 'indicatorAlert.create' },
  { name: 'indicatorAlert.toggle' }, { name: 'screener.run' }, { name: 'watchlist.add' }, { name: 'agent.capabilities' },
  { name: 'drawing.addTrendline' }, { name: 'layout.rename' }, { name: 'widget.setOption' }, { name: 'chart.replay' },
]

describe('R-04 routing: the indicatorAlerts group is offered for cross / alert-like phrasings', () => {
  for (const text of INDICATOR_ALERT_PHRASINGS) {
    it(`routes indicatorAlerts: "${text}"`, () => {
      const { selected, matched } = selectGroups(text)
      expect(matched).toBe(true)
      expect(selected).toContain('indicatorAlerts')
      const r = routeManifest(MANIFEST, text, { limit: 60, budget: 8 })
      expect(r.manifest.some(c => c.name === 'indicatorAlert.create'), 'indicatorAlert.create reaches the model').toBe(true)
    })
  }
  for (const text of PRICE_ALERT_PHRASINGS) {
    it(`a price level still routes price alerts only: "${text}"`, () => {
      const { selected } = selectGroups(text)
      expect(selected).toContain('alerts')
      expect(selected).not.toContain('indicatorAlerts')
    })
  }
  it('is still a fillLast group: a message nothing named carries the screener before it', () => {
    expect(GROUPS.find(g => g.id === 'indicatorAlerts').fillLast).toBe(true)
    const none = routeManifest(MANIFEST, "what's ripping this month", { limit: 60, budget: 8 })
    expect(none.routing === null || none.routing.selected.includes('screener')).toBe(true)
  })
  it('mutation guard: the LT-4 request needs the new trigger words (the old alert-word + RSI/MACD rule alone misses it)', () => {
    const old = [/\b(alerts?|notify|ping me|tell me when|let me know when)\b.*\b(rsi|macd|stochastics?|bollinger|bands?|adx|cci|mfi|ichimoku|donchian|williams|indicators?|overbought|oversold)\b/,
      /\b(rsi|macd|stochastics?|bollinger|bands?|adx|cci|mfi|ichimoku|donchian|williams|indicators?)\b.*\b(alerts?|notify|ping me)\b/, /\b(pause|resume|re-?arm)\b.*\balerts?\b/]
    expect(old.some(re => re.test('mark when the 9 ema crosses above the 20 on this chart'))).toBe(false)
  })
})

// ── R-05: the phrase detector and the sentence + alternative ──────────────────────────────────────────────────────

const PHRASES = [
  ['now only the ones with rs rank over 90', 'rs_rank'],            // the live LT-8 request, verbatim
  ['stocks with an rs rating above 95', 'rs_rank'],
  ['show me stocks with rs over 90', 'rs_rank'],
  ['only names with relative strength rank 90 or better', 'rs_rank'],
  ['show me the rs leaders', 'rs_rank'],
  ['sort them by uct composite', 'uct_composite'],
  ['just the ones with a uct score above 80', 'uct_composite'],
  ['filter to composite over 85', 'uct_composite'],
  ['stocks with an eps rating of 90+', 'rating_eps'],
  ['only an smr rating of a', 'rating_smr'],
  ['names with sponsorship grade b or better', 'sponsorship'],
  ['the ones with acc/dis a', 'accdis'],
  ['which stocks have an accumulation distribution grade of a', 'accdis'],
  ['keep only setup score over 70', 'candle_score'],
  ['stocks with an earnings setup grade of a', 'earnings_setup_grade'],
  ['find stocks in the uct 20', 'in_uct20'],
  ['only the ones in the uct theme ai', 'theme'],
  ['rank them by pattern engine confidence', 'pattern_engine_id'],
  ['find stocks with dark pool prints over 10m', 'dp_notional_1d'],
  ['only names with bullish options flow', 'opt_net_premium_1d'],
  ['stocks with net premium over 5m', 'opt_net_premium_1d'],
]
const NOT_PHRASES = ['stocks with rsi over 70', 'rs line above spy', 'above the 20 ema with volume 2x', 'now only tech',
  'sort them by 3 month performance', 'price over 10 bucks', 'which stocks gained over 5% today', 'show me my strongest stocks',
  // W1.1 review BLOCKING-2: the public RS line and the Nasdaq Composite index are not hidden fields
  'sort by highest rs line', 'sort by lowest rs line', 'highest relative strength line', 'stocks above the nasdaq composite',
  'outperforming the nasdaq composite']

describe('W1.1 review BLOCKING-2: the hidden forms are still refused next to the public ones', () => {
  for (const [text, key] of [['sort by highest rs', 'rs_rank'], ['sort them by uct composite', 'uct_composite'],
    ['composite rating above 90', 'uct_composite'], ['filter to composite over 85', 'uct_composite'],
    // owner HOLD 2026-11-03: the only A/D field is the proprietary accdis grade
    ['accumulation distribution line rising', 'accdis']]) {
    it(`"${text}" → ${key}`, () => expect(hiddenPhraseIn(text)?.key).toBe(key))
  }
})

describe('R-05: a hidden-field phrase is named by the member\'s words, with the sentence and a public alternative', () => {
  for (const [text, key] of PHRASES) {
    it(`"${text}" → ${key}`, () => {
      const hit = hiddenPhraseIn(text)
      expect(hit?.key).toBe(key)
      expect(RATING_FIELDS.has(key) || FLOW_FIELDS.has(key)).toBe(true)
      const why = refineRefusalForText(text)
      expect(why.startsWith(FLOW_FIELDS.has(key) ? FLOW_REFUSAL : RATINGS_REFUSAL)).toBe(true)
      expect(why).toContain(`A public alternative: ${publicAlternative(key).label} (${publicAlternative(key).key}).`)
      // the screen-shaped gate admits every phrasing the fast path must claim
      expect(hiddenScreenRequest(text), 'screen-shaped').toBe(true)
    })
  }
  for (const text of NOT_PHRASES) {
    it(`public field or look-alike, not a hidden phrase: "${text}"`, () => expect(hiddenPhraseIn(text)).toBeNull())
  }
  it('a question, a guide request, a chart control or one stock\'s figure is never screen-shaped', () => {
    for (const t of ['what is rs rank', 'where do i see the uct composite', 'show dark pool levels on this chart', 'turn on dark pool', 'explain sponsorship grade',
      'show me the composite rating for nvda please']) {
      expect(hiddenScreenRequest(t), t).toBe(false)
    }
  })
  it('the list is the generated mirror of hidden.py: every key is hidden, every pattern compiles', () => {
    expect(HIDDEN_PHRASES.length).toBeGreaterThanOrEqual(25)
    for (const [p, key] of HIDDEN_PHRASES) {
      expect(() => new RegExp(p)).not.toThrow()
      expect(RATING_FIELDS.has(key) || FLOW_FIELDS.has(key), key).toBe(true)
    }
  })
})

// ── R-06: the earnings lead line ──────────────────────────────────────────────────────────────────────────────────

const EARN = {
  kind: 'earnings', status: 'ok', freshness: 'periodic', stale: false, as_of: null, notes: [],
  data: { symbol: 'NVDA', reported_through: '2026 Q2', quarters_behind: 0,
    reported: [{ quarter: '2026 Q2', eps_actual: 1.08, eps_estimate: 1.01, eps_surprise_pct: 6.9, rev_actual: 46.74e9, rev_estimate: 46e9, rev_surprise_pct: 1.6 }],
    next_report: { report_date: '2026-11-19', quarter: '2026 Q3', eps_estimate: 1.25, rev_estimate: 54e9, kind: 'scheduled' } },
}
describe('R-06: "when does X report" — the next report date leads the earnings card', () => {
  it('the first line (the card\'s summary) carries the next date and its status word; the detail line is unchanged', () => {
    const a = answerFromEarnings(EARN, 'NVDA')
    const lines = a.text.split('\n')
    expect(lines[0]).toBe('NVDA earnings — next report: Nov 19, 2026 (2026 Q3, scheduled)')
    expect(a.text).toMatch(/Next report: scheduled for Nov 19, 2026 \(2026 Q3\) · EPS est\. \$1\.25, revenue est\. \$54\.00B — a scheduled event, not a result\./)
  })
  it('a status the gateway states (confirmed / estimated) is used as given; no next date → the old lead and the "not available" line', () => {
    const conf = answerFromEarnings({ ...EARN, data: { ...EARN.data, next_report: { ...EARN.data.next_report, kind: 'confirmed' } } }, 'NVDA')
    expect(conf.text.split('\n')[0]).toBe('NVDA earnings — next report: Nov 19, 2026 (2026 Q3, confirmed)')
    const none = answerFromEarnings({ ...EARN, data: { ...EARN.data, next_report: null } }, 'NVDA')
    expect(none.text.split('\n')[0]).toBe('NVDA earnings (reported figures)')
    expect(none.text).toMatch(/Next report date: not available in UCT's earnings data\./)
  })
})
