/**
 * Hard mode rails (round 21). The chart is the member's own widget with only the ticker hidden; the pool is the server's
 * swept hard pool; the four cards carry the item's setup and "Nothing fired"; naming the setup posts the bank's Yes,
 * "Nothing fired" its No, and another setup's name is posted as itself (always a miss on a swept chart); what fired is
 * read from the reveal's key; the run-on reaches the move's culmination; the pointer is the chart's callout layer; a
 * perfect run lights the Legendary medal beside the XP the attempts earned.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('../../../components/StockChart', () => ({
  default: (props) => {
    const so = props.settingsOverride || {}
    const overlaysOn = Array.isArray(so.overlays) ? so.overlays.filter((o) => o.enabled !== false).length : -1
    const vol = so.volume && so.volume.visible === false ? 'hidden' : 'shown'
    const inst = Array.isArray(so.indicatorInstances) ? so.indicatorInstances : []
    return <div data-testid="stock-chart" data-bars={(props.barsOverride || []).length} data-overlays-on={overlaysOn} data-volume={vol} data-sym={props.sym}
      data-brand={props.showBrandMark ? '1' : '0'} data-legend={props.hideLegend ? 'hidden' : 'shown'} data-watermark={props.hideWatermark ? '' : (props.watermark || props.sym)}
      data-callouts={(props.callouts || []).map((c) => `${c.index}:${c.text}`).join('|')} data-look={props.calloutLook ? '1' : '0'}
      data-instances-live={inst.filter((i) => i.deleted !== true).length} data-tombstoned={inst.filter((i) => i.deleted === true).map((i) => i.instanceId).join('|')} />
  },
}))
vi.mock('../../../components/study/StudyMark', () => ({ default: () => <span data-testid="mark" /> }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: (sym) => ({ name: sym === 'JBI' ? 'Jeld-Wen Holding' : null }) }))
vi.mock('../../../components/chart/pane/ChartPane', async () => {
  const StockChart = (await import('../../../components/StockChart')).default
  return { default: (props) => <div data-testid="chart-pane" data-tfbar={props.showTfBar === false ? 'off' : 'on'}>{props.identityLabel}<StockChart sym={props.sym} showBrandMark {...(props.stockChartProps || {})} /></div> }
})
// the member's own chart settings, as the chart merges them underneath: one average of their own, added by hand
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: { chart_settings: { indicatorInstances: [{ instanceId: 'ma:custom', defId: 'movingAverage', inputs: { source: 'close', period: 10, maType: 'sma' } }] } } }) }))

import HardChallenge from './HardChallenge'
import {
  HARD_TOTAL, NOTHING, RUN_AFTER_PEAK, RUN_MIN, RUN_NOTHING, culmination, culminationLabel, hardAnswer, hardChoices, hardRight,
  keyFired, runLength, setupFired, withArticle,
} from './hardMode'

const bar = (t, c) => ({ t, o: c - 0.2, h: c + 0.3, l: c - 0.4, c, v: 100 })
const BARS = Array.from({ length: 30 }, (_, i) => bar(20250101 + i, 10 + i * 0.1))
// the plan api/services/study_trade.py sends with the reveal for this chart: a cent over the red day's high (13.10), the
// stop 3.5% under the entry (closer than the Kicker's low, 12.50), targets at 2R and 3R
const KICKER_PLAN = { skill: 'setup.family3.kicker', direction: 'bullish', entry: 13.11, stop: 12.65, t1: 14.03, t2: 14.49, enters_intraday: true,
  entry_note: "over the red day's high, on the Kicker day", stop_note: "under the Kicker's low, or 3.5% under the entry if that is closer", trail: 'under each higher low, or under the 10-day average' }
const kicker = { id: 'k1', type: 'spot', skill_id: 'setup.family3.kicker', prompt_json: { q: "Does the firm's Kicker Candle setup fire on the last bar of this chart?", choices: ['Yes', 'No'] }, bars: { symbol: 'k1', tf: 'D', bars: BARS } }

/** The sandbox-shaped fetcher: one chart (a positive Kicker, key Yes) in the Kicker skill, nothing in the others. The
 *  reveal carries one forward bar and says three exist, so the rest is fetched through /step. */
function fetcherWith(posts, sessions = []) {
  return vi.fn(async (url, opts = {}) => {
    if (url === '/api/study/sessions') { sessions.push(opts.body); return { session_id: 'sess-h', items: opts.body.skill_id === 'setup.family3.kicker' ? [kicker] : [] } }
    if (url === '/api/study/attempts') {
      posts.push(opts.body)
      const ok = opts.body.answer.choice === 'Yes'
      return { attempt_id: 7, correct: ok, reveal: { lesson: 'Gap over the close, close above the high.', forward_bars: [bar(20250201, 13.5)], forward_total: 3, sym: 'JBI', trade: KICKER_PLAN }, progress: { xp_gained: ok ? 10 : 0 } }
    }
    if (url === '/api/study/attempts/7/step') { posts.push({ step: opts.body }); return { bars: [bar(20250202, 14.5), bar(20250203, 13.9)] } }
    if (url === '/api/study/house-chart') return { chart_settings: { overlays: [{ id: 'ma20', enabled: true, period: 20 }], volume: { visible: true } } }
    throw new Error(`unexpected ${url}`)
  })
}

afterEach(cleanup)

describe('hardMode helpers', () => {
  const item = { id: 'k1', name: 'Kicker' }
  it('deals four cards: the setup, two others and "Nothing fired", in the same order for the same seed', () => {
    const a = hardChoices(item, 7)
    expect(a).toHaveLength(4)
    expect(a).toEqual(hardChoices(item, 7))
    expect(a).toContain('Kicker')
    expect(a).toContain(NOTHING)
    expect(new Set(a).size).toBe(4)
  })
  it("names the setup as the bank's Yes, \"Nothing fired\" as its No, and another setup as itself", () => {
    expect(hardAnswer('Kicker', item, 'Yes', 'No')).toEqual({ choice: 'Yes', picked_setup: 'Kicker' })
    expect(hardAnswer(NOTHING, item, 'Yes', 'No')).toEqual({ choice: 'No', picked_setup: NOTHING })
    expect(hardAnswer('Slingshot', item, 'Yes', 'No')).toEqual({ choice: 'Slingshot', picked_setup: 'Slingshot' })
  })
  it('credits a pick only when the server agrees and it was the setup or "Nothing fired"', () => {
    expect(hardRight('Kicker', item, true)).toBe(true)
    expect(hardRight(NOTHING, item, true)).toBe(true)
    expect(hardRight('Slingshot', item, true)).toBe(false)
    expect(hardRight('Kicker', item, false)).toBe(false)
    expect(hardRight(NOTHING, item, false)).toBe(false)
  })
  it("reads what fired from the reveal's key first, and from the verdict only when the key is missing", () => {
    expect(keyFired({ answer: 'yes' })).toBe(true)
    expect(keyFired({ answer: 'No' })).toBe(false)
    expect(keyFired({ answer: 'maybe' })).toBe(null)
    expect(setupFired('Slingshot', item, false, { answer: 'no' })).toBe(false)     // the owner's AAPL case: nothing fired
    expect(setupFired('Slingshot', item, false, { answer: 'yes' })).toBe(true)
    expect(setupFired('Kicker', item, true)).toBe(true)
    expect(setupFired(NOTHING, item, true)).toBe(false)
    expect(setupFired('Kicker', item, false)).toBe(false)
    expect(setupFired(NOTHING, item, false)).toBe(true)
    expect(setupFired('Slingshot', item, false)).toBe(null)
  })
  it('measures the culmination from the signal close while the trade is alive: the best high long, the best low short', () => {
    const sig = { c: 100, h: 101, l: 97 }
    const fwd = [{ h: 103, l: 99, c: 102 }, { h: 112, l: 101, c: 110 }, { h: 108, l: 95, c: 96 }, { h: 130, l: 94, c: 128 }]
    // the close under the signal low (96 < 97) ends the trade: the 130 high after it is never credited
    expect(culmination(sig, fwd)).toEqual({ offset: 1, sessions: 2, pct: expect.closeTo(12, 6), broke: 2 })
    // short: the first close over the signal high (102 > 101) ends it on the first session
    expect(culmination(sig, fwd, true)).toEqual({ offset: 0, sessions: 1, pct: expect.closeTo(-1, 6), broke: 0 })
    expect(culmination({ c: 100, h: 101, l: 90 }, fwd)).toEqual({ offset: 3, sessions: 4, pct: expect.closeTo(30, 6), broke: null })
    expect(culmination(sig, [])).toBe(null)
    expect(culminationLabel({ pct: 12.04, sessions: 2 })).toBe('+12.0% in 2 sessions')
    expect(culminationLabel({ pct: -5, sessions: 1 })).toBe('−5.0% in 1 session')
  })
  it('runs on to the culmination and past it, never less than a minimum, never past the strip', () => {
    expect(runLength(60, { offset: 20 }, true)).toBe(20 + 1 + RUN_AFTER_PEAK)
    expect(runLength(60, { offset: 0 }, true)).toBe(RUN_MIN)
    expect(runLength(8, { offset: 6 }, true)).toBe(8)
    expect(runLength(60, null, false)).toBe(RUN_NOTHING)
    expect(runLength(0, null, false)).toBe(0)
  })
  it('says a and an', () => {
    expect(withArticle('Oops Reversal')).toBe('an Oops Reversal')
    expect(withArticle('Kicker')).toBe('a Kicker')
  })
  it('runs eight charts', () => { expect(HARD_TOTAL).toBe(8) })
})

describe('HardChallenge', () => {
  it('asks for the swept pool, points at the last candle, posts Yes for the named setup, runs on and earns Legendary on a perfect run', async () => {
    const posts = []
    const sessions = []
    render(<HardChallenge fetcher={fetcherWith(posts, sessions)} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Start$/ }))
    expect(sessions.length).toBeGreaterThan(0)
    expect(sessions.every((b) => b.hard === true)).toBe(true)
    const cards = await screen.findByTestId('hard-cards')
    const buttons = [...cards.querySelectorAll('button')]
    expect(buttons).toHaveLength(4)
    expect(cards.textContent).toContain('Kicker')
    expect(cards.textContent).toContain(NOTHING)
    const chart = screen.getByTestId('stock-chart')
    // the REAL pane, no timeframe bar, the member's own averages and volume kept (batch 19: blank indicators Cut)
    expect(screen.getByTestId('chart-pane').getAttribute('data-tfbar')).toBe('off')
    expect(chart.getAttribute('data-volume')).toBe('shown')
    expect(chart.getAttribute('data-tombstoned')).toBe('')
    expect(chart.getAttribute('data-sym')).toBe('k1')                 // the item id, never the ticker
    expect(chart.getAttribute('data-brand')).toBe('1')
    expect(chart.getAttribute('data-legend')).toBe('shown')
    expect(chart.getAttribute('data-watermark')).toBe('')
    // round 21: the pointer is the callout layer on the last candle, no spotlight drawings
    expect(chart.getAttribute('data-callouts')).toBe('29:What fired here?')
    expect(chart.getAttribute('data-look')).toBe('1')
    expect(screen.getByTestId('study-chart').getAttribute('data-masked')).toBe('1')
    expect(screen.getByTestId('sym-label').textContent).not.toContain('JBI')
    fireEvent.click(buttons.find((b) => b.textContent.includes('Kicker')))
    fireEvent.click(screen.getByTestId('hard-check'))
    await waitFor(() => expect(posts.length).toBeGreaterThan(0))
    // the answer takes over the screen first (the owner's rule 15); its button opens the review
    fireEvent.click(await screen.findByTestId('hard-takeover-go'))
    expect(posts[0]).toMatchObject({ item_id: 'k1', session_id: 'sess-h', answer: { choice: 'Yes', picked_setup: 'Kicker' } })
    expect(await screen.findByText('Gap over the close, close above the high.')).toBeInTheDocument()
    expect(screen.getByText('Named it.')).toBeInTheDocument()
    // the rest of the forward strip is fetched for the run-on
    await waitFor(() => expect(posts.find((p) => p.step)).toEqual({ step: { offset: 1, n: 2 } }))
    // the reveal: the ticker and the company in the widget's badge, no watermark across the candles; the pointer names it
    expect(screen.getByTestId('study-chart').getAttribute('data-masked')).toBe('0')
    expect(screen.getByTestId('sym-label')).toHaveTextContent('JBI')
    expect(screen.getByTestId('sym-label')).toHaveTextContent('Jeld-Wen Holding')
    expect(screen.getByTestId('stock-chart').getAttribute('data-watermark')).toBe('')
    expect(screen.getByTestId('stock-chart').getAttribute('data-callouts')).toMatch(/^29:Kicker/)
    // the coach's card: a direct headline, the last candle measured, the rule
    const lesson = screen.getByTestId('hard-lesson')
    expect(lesson).toHaveTextContent('Why it’s a Kicker')
    // round 23: the trade is the server's plan (entry a cent over the red day's high, the stop, 2R and 3R), reviewed
    // against the bars after the signal; the table of numbers is gone
    expect(lesson).toHaveTextContent('The trade · your Kicker rules')
    expect(lesson).toHaveTextContent('$13.11')
    expect(lesson).toHaveTextContent('$12.65')
    expect(lesson).toHaveTextContent('$14.03 · $14.49')
    expect(lesson).toHaveTextContent('Trail under each higher low')
    expect(lesson).not.toHaveTextContent('The last candle, measured')
    expect(lesson).toHaveTextContent('Gap over the close, close above the high.')
    expect(screen.getByTestId('hard-next')).toHaveTextContent('See the run')
    fireEvent.click(screen.getByTestId('hard-next'))
    expect(await screen.findByText('Legendary')).toBeInTheDocument()
    expect(screen.getByTestId('legend-medal').getAttribute('data-lit')).toBe('1')
    expect(screen.getByTestId('run-log')).toHaveTextContent('Kicker')
    expect(screen.getByTestId('hard-right')).toHaveTextContent('1/1')
    expect(screen.getByTestId('hard-streak')).toHaveTextContent('1')
  })

  it('"Nothing fired" on a chart where the setup did fire posts No, is a miss, and the end stage keeps the medal dark', async () => {
    const posts = []
    render(<HardChallenge fetcher={fetcherWith(posts)} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Start$/ }))
    const cards = await screen.findByTestId('hard-cards')
    fireEvent.click([...cards.querySelectorAll('button')].find((b) => b.textContent.includes(NOTHING)))
    fireEvent.click(screen.getByTestId('hard-check'))
    await waitFor(() => expect(posts.length).toBeGreaterThan(0))
    // the answer takes over the screen first (the owner's rule 15); its button opens the review
    fireEvent.click(await screen.findByTestId('hard-takeover-go'))
    expect(posts[0].answer).toMatchObject({ choice: 'No', picked_setup: NOTHING })
    expect(await screen.findByText('It was a Kicker.')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('hard-next'))
    expect(await screen.findByText('Tough run')).toBeInTheDocument()
    expect(screen.getByTestId('hard-score')).toHaveAttribute('aria-label', '0 of 1 named')
    expect(screen.getByTestId('legend-medal').getAttribute('data-lit')).toBe('0')
    expect(screen.getByTestId('hard-right')).toHaveTextContent('0/1')
    expect(screen.getByTestId('run-log')).toHaveTextContent('you said Nothing fired')
  })

  it('another setup is posted as itself, and when the key says nothing fired the screen says so', async () => {
    const posts = []
    const base = fetcherWith(posts)
    const fetcher = vi.fn(async (url, opts = {}) => {
      if (url === '/api/study/attempts') {
        posts.push(opts.body)
        return { attempt_id: 8, correct: false, reveal: { lesson: "Kicker: the firm's detector does not fire on the last bar of this chart. weak prior close, gap up and break, but the gap is under a tenth of the prior range", answer: { answer: 'no' }, sym: 'AAPL', setup_rule: { name: 'Kicker', text: 'the stock is already set up; the day before closes red and WEAK; then the next day gaps up.' } }, progress: { xp_gained: 0 } }
      }
      return base(url, opts)
    })
    render(<HardChallenge fetcher={fetcher} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Start$/ }))
    const cards = await screen.findByTestId('hard-cards')
    const other = [...cards.querySelectorAll('button')].find((b) => !b.textContent.includes('Kicker') && !b.textContent.includes(NOTHING))
    fireEvent.click(other)
    fireEvent.click(screen.getByTestId('hard-check'))
    await waitFor(() => expect(posts.length).toBeGreaterThan(0))
    // the answer takes over the screen first (the owner's rule 15); its button opens the review
    fireEvent.click(await screen.findByTestId('hard-takeover-go'))
    const name = other.textContent.replace(/^\d/, '').trim()
    expect(posts[0].answer).toEqual({ choice: name, picked_setup: name })
    expect(await screen.findByText('Nothing fired here.')).toBeInTheDocument()
    expect(screen.getByTestId('stock-chart').getAttribute('data-callouts')).toMatch(/^29:Nothing fired/)
    const lesson = screen.getByTestId('hard-lesson')
    expect(lesson).toHaveTextContent('Why nothing fired')
    expect(lesson).toHaveTextContent('Not a Kicker: weak prior close')
    expect(lesson).toHaveTextContent('The day before closes red and WEAK.')
    expect(lesson.textContent).not.toMatch(/the firm/i)
  })
})
