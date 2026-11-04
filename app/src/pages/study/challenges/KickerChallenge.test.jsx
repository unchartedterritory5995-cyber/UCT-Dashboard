/**
 * Spot the Kicker rails: the round paints the candidates, a card pick (or a chart tap) selects one, Check posts the
 * bank's Yes when the real candle was picked (No otherwise, the picked bar beside it) into the item's session, and
 * the rule cards open on every candidate after the verdict.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('../../../components/StockChart', () => ({
  default: (props) => (
    <div data-testid="stock-chart" data-bars={(props.barsOverride || []).length} data-highlight={(props.highlightBarTime || []).join('|')}>
      <button type="button" data-testid="chart-lib-tap" onClick={() => props.onChartTap?.({ time: props.barsOverride?.[props.barsOverride.length - 1]?.t, price: 10.5, point: { x: 1, y: 1 } })}>lib-tap</button>
    </div>
  ),
}))
vi.mock('../../../components/study/StudyMark', () => ({ default: () => <span data-testid="mark" /> }))

import KickerChallenge, { yesNo } from './KickerChallenge'

const bar = (t, o, h, l, c) => ({ t, o, h, l, c, v: 100 })
// ends on a real Kicker with a baby-red look-alike and a weak-close look-alike before it (see kickerRules.test)
const BARS = [
  bar(20250301, 10, 10.2, 9.9, 10), bar(20250302, 10, 10.1, 9.9, 10),
  bar(20250303, 10, 10.05, 9.9, 9.95), bar(20250304, 9.97, 10.6, 9.9, 10.5),
  bar(20250305, 10.5, 10.6, 10.3, 10.4), bar(20250306, 10.4, 10.5, 10.0, 10.1),
  bar(20250307, 10.15, 10.3, 10.1, 10.2),
  bar(20250308, 10.2, 10.3, 10.1, 10.2), bar(20250309, 10.2, 10.25, 9.9, 9.95),
  bar(20250310, 10.0, 10.7, 9.95, 10.6),
]
const item = { id: 'k1', type: 'spot', skill_id: 'setup.family3.kicker', prompt_json: { q: 'Does a Kicker fire on the last candle?', choices: ['Yes', 'No'] }, bars: { symbol: 'k1', tf: 'D', bars: BARS } }

function fetcherWith(posts) {
  return vi.fn(async (url, opts = {}) => {
    if (url === '/api/study/sessions') return { session_id: 'sess-k', items: [item] }
    if (url === '/api/study/attempts') { posts.push(opts.body); return { correct: opts.body.answer.choice === 'Yes', reveal: { lesson: 'Gap over the close, close above the high.', forward_bars: [] }, progress: { xp_gained: 10 } } }
    if (url === '/api/study/house-chart') return { chart_settings: null }
    throw new Error(`unexpected ${url}`)
  })
}

afterEach(cleanup)

describe('yesNo', () => {
  it('finds the bank\'s Yes and No by meaning, whatever their order', () => {
    expect(yesNo(['No', 'Yes'])).toEqual({ yes: 'Yes', no: 'No' })
    expect(yesNo(['yes', 'no'])).toEqual({ yes: 'yes', no: 'no' })
    expect(yesNo(['Fires', 'Does not'])).toEqual({ yes: 'Fires', no: 'Does not' })
  })
})

describe('KickerChallenge', () => {
  it('starts, paints three gold candidates, posts Yes for the real candle picked by card, and opens the rule cards', async () => {
    const posts = []
    render(<KickerChallenge fetcher={fetcherWith(posts)} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Start/ }))
    const cards = await screen.findByTestId('kicker-cards')
    const buttons = cards.querySelectorAll('button')
    expect(buttons).toHaveLength(3)
    expect(screen.getByTestId('stock-chart').getAttribute('data-highlight').split('|')).toHaveLength(3)
    fireEvent.click(buttons[2])                                  // C = the last bar = the real Kicker
    fireEvent.click(screen.getByTestId('kicker-check'))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toMatchObject({ item_id: 'k1', session_id: 'sess-k', answer: { choice: 'Yes', picked_bar: '2025-03-10', picked_kind: 'real' } })
    expect(await screen.findByText('Gap over the close, close above the high.')).toBeInTheDocument()
    expect(cards.textContent).toContain('A real red day before it')
    expect(screen.getByTestId('kicker-next')).toHaveTextContent('Finish')
  })

  it('a chart tap (the library click, a touch too) near a candidate picks it; a look-alike posts No with its kind', async () => {
    const posts = []
    render(<KickerChallenge fetcher={fetcherWith(posts)} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Start/ }))
    await screen.findByTestId('kicker-cards')
    fireEvent.click(screen.getByTestId('chart-lib-tap'))          // the stub taps the LAST bar: the real one
    expect(screen.getByTestId('kicker-cards').textContent).toContain('your pick')
    // then switch to the baby red by card and check
    fireEvent.click(screen.getByTestId('kicker-cards').querySelectorAll('button')[0])
    fireEvent.click(screen.getByTestId('kicker-check'))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].answer).toMatchObject({ choice: 'No', picked_kind: 'baby' })
  })
})
