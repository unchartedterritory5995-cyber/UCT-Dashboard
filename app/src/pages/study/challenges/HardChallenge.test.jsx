/**
 * Hard mode rails: the chart is candles only (every average off, volume hidden, the symbol the item id), the four
 * cards carry the item's setup and "Nothing fired", naming the setup posts the bank's Yes and anything else its No,
 * a member is credited only when the server agrees and the pick was the setup or "Nothing fired", and a perfect run
 * lights the fourth crown on the end card beside the XP the attempts earned.
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
      data-instances-live={inst.filter((i) => i.deleted !== true).length} data-tombstoned={inst.filter((i) => i.deleted === true).map((i) => i.instanceId).join('|')} />
  },
}))
vi.mock('../../../components/study/StudyMark', () => ({ default: () => <span data-testid="mark" /> }))
vi.mock('../../../components/chart/pane/ChartPane', async () => {
  const StockChart = (await import('../../../components/StockChart')).default
  return { default: (props) => <div data-testid="chart-pane" data-tfbar={props.showTfBar === false ? 'off' : 'on'}>{props.identityLabel}<StockChart sym={props.sym} showBrandMark {...(props.stockChartProps || {})} /></div> }
})
// the member's own chart settings, as the chart merges them underneath: one average of their own, added by hand
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: { chart_settings: { indicatorInstances: [{ instanceId: 'ma:custom', defId: 'movingAverage', inputs: { source: 'close', period: 10, maType: 'sma' } }] } } }) }))

import HardChallenge from './HardChallenge'
import { HARD_TOTAL, NOTHING, hardAnswer, hardChoices, hardRight, setupFired } from './hardMode'

const bar = (t, c) => ({ t, o: c - 0.2, h: c + 0.3, l: c - 0.4, c, v: 100 })
const BARS = Array.from({ length: 30 }, (_, i) => bar(20250101 + i, 10 + i * 0.1))
const kicker = { id: 'k1', type: 'spot', skill_id: 'setup.family3.kicker', prompt_json: { q: "Does the firm's Kicker Candle setup fire on the last bar of this chart?", choices: ['Yes', 'No'] }, bars: { symbol: 'k1', tf: 'D', bars: BARS } }

/** The sandbox-shaped fetcher: one chart (a positive Kicker, key Yes) in the Kicker skill, nothing in the others,
 *  and a house look with one average and volume on, which Hard mode must switch off. */
function fetcherWith(posts) {
  return vi.fn(async (url, opts = {}) => {
    if (url === '/api/study/sessions') return { session_id: 'sess-h', items: opts.body.skill_id === 'setup.family3.kicker' ? [kicker] : [] }
    if (url === '/api/study/attempts') {
      posts.push(opts.body)
      const ok = opts.body.answer.choice === 'Yes'
      return { correct: ok, reveal: { lesson: 'Gap over the close, close above the high.', forward_bars: [bar(20250201, 13.5)], sym: 'JBI' }, progress: { xp_gained: ok ? 10 : 0 } }
    }
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
  it("names the setup as the bank's Yes and anything else as its No", () => {
    expect(hardAnswer('Kicker', item, 'Yes', 'No')).toEqual({ choice: 'Yes', picked_setup: 'Kicker' })
    expect(hardAnswer(NOTHING, item, 'Yes', 'No')).toEqual({ choice: 'No', picked_setup: NOTHING })
    expect(hardAnswer('Slingshot', item, 'Yes', 'No').choice).toBe('No')
  })
  it('credits a pick only when the server agrees and it was the setup or "Nothing fired"', () => {
    expect(hardRight('Kicker', item, true)).toBe(true)        // a positive, named
    expect(hardRight(NOTHING, item, true)).toBe(true)         // a near-miss, called
    expect(hardRight('Slingshot', item, true)).toBe(false)    // a near-miss and the wrong name: No was the key, the member was not right
    expect(hardRight('Kicker', item, false)).toBe(false)      // a near-miss named as if it fired
    expect(hardRight(NOTHING, item, false)).toBe(false)       // a positive, missed
  })
  it("reads whether the setup fired from the server's verdict, never from a key", () => {
    expect(setupFired('Kicker', item, true)).toBe(true)
    expect(setupFired(NOTHING, item, true)).toBe(false)
    expect(setupFired('Kicker', item, false)).toBe(false)
    expect(setupFired(NOTHING, item, false)).toBe(true)
    expect(setupFired('Slingshot', item, false)).toBe(true)
  })
  it('runs eight charts', () => { expect(HARD_TOTAL).toBe(8) })
})

describe('HardChallenge', () => {
  it('mounts the real widget with the ticker masked, deals the cards, posts Yes for the named setup and earns Legendary on a perfect run', async () => {
    const posts = []
    render(<HardChallenge fetcher={fetcherWith(posts)} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Start hard mode/ }))
    const cards = await screen.findByTestId('hard-cards')
    const buttons = [...cards.querySelectorAll('button')]
    expect(buttons).toHaveLength(4)
    expect(cards.textContent).toContain('Kicker')
    expect(cards.textContent).toContain(NOTHING)
    const chart = screen.getByTestId('stock-chart')
    // round 19: the REAL pane, no timeframe bar, the member's own averages and volume kept (batch 19: blank indicators Cut)
    expect(screen.getByTestId('chart-pane').getAttribute('data-tfbar')).toBe('off')
    expect(chart.getAttribute('data-volume')).toBe('shown')
    expect(chart.getAttribute('data-tombstoned')).toBe('')
    expect(chart.getAttribute('data-sym')).toBe('k1')                 // the item id, never the ticker
    expect(chart.getAttribute('data-brand')).toBe('1')
    expect(chart.getAttribute('data-legend')).toBe('shown')
    expect(chart.getAttribute('data-watermark')).toBe('')
    expect(screen.getByTestId('study-chart').getAttribute('data-masked')).toBe('1')
    expect(screen.getByTestId('sym-label').textContent).not.toContain('JBI')
    fireEvent.click(buttons.find((b) => b.textContent.includes('Kicker')))
    fireEvent.click(screen.getByTestId('hard-check'))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toMatchObject({ item_id: 'k1', session_id: 'sess-h', answer: { choice: 'Yes', picked_setup: 'Kicker' } })
    expect(await screen.findByText('Gap over the close, close above the high.')).toBeInTheDocument()
    expect(screen.getByText('Named it.')).toBeInTheDocument()
    // the reveal: the ticker in the widget's badge and as its watermark; the lesson card leads with the lesson
    expect(screen.getByTestId('study-chart').getAttribute('data-masked')).toBe('0')
    expect(screen.getByTestId('sym-label')).toHaveTextContent('JBI')
    expect(screen.getByTestId('stock-chart').getAttribute('data-watermark')).toBe('JBI')
    expect(screen.getByTestId('hard-lesson')).toHaveTextContent('Gap over the close, close above the high.')
    expect(screen.getByTestId('hard-next')).toHaveTextContent('See the run')
    fireEvent.click(screen.getByTestId('hard-next'))
    expect(await screen.findByText('Legendary')).toBeInTheDocument()
    expect(screen.getByTestId('legend-medal').getAttribute('data-lit')).toBe('1')
    expect(screen.getByTestId('run-log')).toHaveTextContent('Kicker')
    expect(screen.getByTestId('hard-right')).toHaveTextContent('1/1')
  })

  it('"Nothing fired" on a chart where the setup did fire posts No, is a miss, and the end card keeps the medal dark', async () => {
    const posts = []
    render(<HardChallenge fetcher={fetcherWith(posts)} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Start hard mode/ }))
    const cards = await screen.findByTestId('hard-cards')
    fireEvent.click([...cards.querySelectorAll('button')].find((b) => b.textContent.includes(NOTHING)))
    fireEvent.click(screen.getByTestId('hard-check'))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].answer).toMatchObject({ choice: 'No', picked_setup: NOTHING })
    expect(await screen.findByText('It was the Kicker.')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('hard-next'))
    expect(await screen.findByText('0 of 1')).toBeInTheDocument()
    expect(screen.getByTestId('legend-medal').getAttribute('data-lit')).toBe('0')
    expect(screen.getByTestId('hard-right')).toHaveTextContent('0/1')
  })
})
