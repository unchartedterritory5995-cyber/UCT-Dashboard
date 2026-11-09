/**
 * Draw it rails (2026-11-08): a tap places the entry, the next the stop; Check posts both to the server, which scores
 * them against the setup's own plan; the answer takes over the screen, then the review shows the plan's key and Next.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('../../../components/StockChart', () => ({
  default: (props) => (
    <div data-testid="stock-chart">
      <button type="button" data-testid="chart-lib-tap" onClick={() => props.onChartTap?.({ time: props.barsOverride?.[props.barsOverride.length - 1]?.t, price: 10.5, point: { x: 1, y: 1 } })}>lib-tap</button>
    </div>
  ),
}))
vi.mock('../../../components/study/StudyMark', () => ({ default: () => <span data-testid="mark" /> }))

import DrawItChallenge from './DrawItChallenge'

const BARS = Array.from({ length: 30 }, (_, i) => ({ t: 20250301 + i, o: 10, h: 10.6, l: 9.9, c: 10.4, v: 100 }))
const item = (id, skill) => ({ id, type: 'spot', skill_id: skill, prompt_json: { q: 'fires?' }, bars: { symbol: id, tf: 'D', bars: BARS }, look: { real: 29, lookalikes: [] } })

describe('DrawItChallenge', () => {
  afterEach(() => { cleanup(); localStorage.clear() })

  it('places the entry then the stop, posts both, and reviews against the plan; a Bear gap chart never plays', async () => {
    const posts = []
    const fetcher = vi.fn(async (url, opts = {}) => {
      if (url === '/api/study/spot-setup') return { session_id: 's', items: [item('d1', 'setup.family3.kicker'), item('d2', 'setup.family3.bear_gap')] }
      if (url === '/api/study/draw/score') {
        posts.push(opts.body)
        return { correct: true, sym: 'JBI', entry: { ok: true, off_pct: 0.3 }, stop: { ok: true, off_pct: 0.4 },
          plan: { entry: 10.61, stop: 10.24, t1: 11.35, t2: 11.72, long: true, entry_note: "over the red day's high", stop_note: "under the Kicker's low" }, forward_bars: [] }
      }
      if (url === '/api/study/house-chart') return { chart_settings: null }
      throw new Error(`unexpected ${url}`)
    })
    render(<DrawItChallenge fetcher={fetcher} />)
    fireEvent.click(await screen.findByTestId('draw-start'))
    expect(screen.getByTestId('draw-step')).toHaveTextContent('chart 1 of 1')          // the Bear gap chart is left out
    expect(screen.getByTestId('draw-check')).toBeDisabled()
    fireEvent.click(screen.getByTestId('chart-lib-tap'))                                  // the entry
    expect(screen.getByTestId('draw-entry')).toHaveTextContent('10.50')
    fireEvent.click(screen.getByTestId('chart-lib-tap'))                                  // then the stop
    expect(screen.getByTestId('draw-stop')).toHaveTextContent('10.50')
    fireEvent.click(screen.getByTestId('draw-check'))
    await waitFor(() => expect(posts).toEqual([{ item_id: 'd1', entry: 10.5, stop: 10.5 }]))
    expect(await screen.findByTestId('draw-takeover')).toHaveTextContent('Right on the plan.')
    fireEvent.click(screen.getByTestId('draw-takeover-go'))
    expect(screen.getByTestId('draw-key')).toHaveTextContent("over the red day's high")
    fireEvent.click(screen.getByTestId('draw-next'))
    expect(await screen.findByTestId('draw-done')).toBeInTheDocument()
  })
})
