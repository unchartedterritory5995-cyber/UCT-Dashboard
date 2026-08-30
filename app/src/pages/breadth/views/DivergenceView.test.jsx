import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import DivergenceView from './DivergenceView'
import { PALETTES } from './breadthViewShared'

// jsdom serialises an inline colour as rgb(), so compare against the palette
// rather than a typed literal — the palette moves, the assertion follows.
const rgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`
const BULL = rgb(PALETTES.classic.bull)
const BEAR = rgb(PALETTES.classic.bear)

// Newest-first. Price climbs while participation falls → price-leads divergence.
const rows = Array.from({ length: 40 }, (_, i) => ({
  date: `2026-08-${String(40 - i).padStart(2, '0')}`,
  sp500_close: 5000 + (40 - i) * 10,
  pct_above_50sma: 20 + i,
}))

describe('DivergenceView', () => {
  it('reports an active divergence and names its direction', () => {
    const { getByTestId } = render(<DivergenceView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ price: 'sp500_close', participation: 'pct_above_50sma', minGap: 5 }} />)
    expect(getByTestId('divergence-verdict').textContent).toMatch(/price leading/i)
  })

  it('says so plainly when the two series agree', () => {
    const agree = rows.map((r, i) => ({ ...r, pct_above_50sma: 20 + (40 - i) }))
    const { getByTestId } = render(<DivergenceView rows={agree} rowIdx={0} currentRow={agree[0]}
      onDrill={() => {}} options={{ price: 'sp500_close', participation: 'pct_above_50sma', minGap: 5 }} />)
    expect(getByTestId('divergence-verdict').textContent).toMatch(/in step/i)
  })

  // 🔴 THE COLOUR MUST NAME THE DIRECTION, NOT MERELY THE PRESENCE OF A RUN.
  // Every active divergence used to paint `colors.bear`, so "Breadth leading
  // price" — the bullish half of the lens — rendered as a warning.
  it('paints price-leads bearish and breadth-leads bullish', () => {
    const opts = { price: 'sp500_close', participation: 'pct_above_50sma', minGap: 5,
                   palette: 'classic' }
    const verdictIn = (c) => c.querySelector('[data-testid="divergence-verdict"]')

    const priceLeads = render(<DivergenceView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={opts} />).container
    expect(verdictIn(priceLeads).textContent).toMatch(/price leading/i)
    expect(verdictIn(priceLeads).style.color).toBe(BEAR)

    // Same fixture with the two series swapped: participation runs away from price.
    const flipped = rows.map((r, i) => ({ ...r, sp500_close: 5000 + i * 10,
                                          pct_above_50sma: 20 + (40 - i) }))
    const breadthLeads = render(<DivergenceView rows={flipped} rowIdx={0} currentRow={flipped[0]}
      onDrill={() => {}} options={opts} />).container
    expect(verdictIn(breadthLeads).textContent).toMatch(/breadth leading/i)
    expect(verdictIn(breadthLeads).style.color).toBe(BULL)
  })

  /**
   * 🔴 THE HEADLINE DENIED WHAT THE CHART WAS DRAWING. It reports the run
   * ending TODAY, and said "no sustained divergence" full stop — above a plot
   * carrying two large shaded blocks captioned "shaded where the gap held ≥5
   * sessions". Seen on screen (Chromium, 1500×686) it reads as a contradiction,
   * because the sentence never said which of the two spans it was about.
   */
  it('names the runs it is not talking about when none is active', () => {
    // Diverges hard for the first half of the window, then converges, so the
    // last session is in step while the window plainly holds a shaded run.
    const healed = rows.map((r, i) => ({
      ...r,
      pct_above_50sma: i < 20 ? 20 + (40 - i) : 20 + i,
      sp500_close: 5000 + (40 - i) * 10,
    }))
    const { getByTestId } = render(<DivergenceView rows={healed} rowIdx={0} currentRow={healed[0]}
      onDrill={() => {}} options={{ price: 'sp500_close', participation: 'pct_above_50sma', minGap: 5 }} />)
    const said = getByTestId('divergence-verdict').textContent
    expect(said).toMatch(/in step/i)
    expect(said, 'the headline is silent about the runs the plot shades')
      .toMatch(/\d+ earlier in this window/)
  })

  it('refuses a window too short to z-score', () => {
    const { getByTestId } = render(<DivergenceView rows={rows.slice(0, 4)} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ price: 'sp500_close', participation: 'pct_above_50sma', minGap: 5 }} />)
    expect(getByTestId('divergence-refusal').textContent).toMatch(/needs 20 sessions/i)
  })

  // 4 rows vs 40 passes for `>= 20`, `> 20`, `>= 15` and half a dozen other
  // thresholds. The pair that pins MIN_SESSIONS is 19 and 20.
  describe('the MIN_SESSIONS boundary itself', () => {
    const opts = { price: 'sp500_close', participation: 'pct_above_50sma', minGap: 5 }
    // Scoped to each render's OWN container: two renders share one document, so
    // a bare queryByTestId finds the first render's refusal still standing.
    const at = (n, rowIdx = 0) => render(<DivergenceView rows={rows.slice(0, n)} rowIdx={rowIdx}
      currentRow={rows[rowIdx]} onDrill={() => {}} options={opts} />).container
    const has = (c, id) => !!c.querySelector(`[data-testid="${id}"]`)

    it('refuses at 19 sessions and draws at 20', () => {
      expect(has(at(19), 'divergence-refusal')).toBe(true)
      const ok = at(20)
      expect(has(ok, 'divergence-refusal')).toBe(false)
      expect(has(ok, 'divergence-verdict')).toBe(true)
    })

    it('counts the window FROM THE CURSOR, so scrubbing can cross the boundary', () => {
      // 20 rows loaded, cursor one session back → 19 readable → refusal.
      expect(has(at(20, 1), 'divergence-refusal')).toBe(true)
    })
  })
})
