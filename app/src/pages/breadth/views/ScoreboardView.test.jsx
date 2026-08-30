import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ScoreboardView from './ScoreboardView'

const mk = (key, val) => ({ key, label: key, polarity: 'bull', drillKey: null,
  getFmt: () => String(val), getTier: () => 'g1' })
const metrics = [mk('a', 1), mk('b', 2), mk('c', 3)]
const currentRow = { a: 20, b: 90, c: 40, date: 'd' }
const recentRows = [currentRow, { a: 10, b: 80, c: 30, date: 'd0' }]
const normalize = (m) => ({ a: 20, b: 90, c: 40 }[m.key])

describe('ScoreboardView options', () => {
  it('value sort orders cards by normalized value desc', () => {
    render(<ScoreboardView currentRow={currentRow} recentRows={recentRows} metrics={metrics}
      onDrill={() => {}} signalKey={null} notableKey={null} normalize={normalize}
      options={{ sort: 'value', density: 'comfortable', sparkWindow: 20 }} />)
    const labels = screen.getAllByText(/^[abc]$/).map(n => n.textContent)
    expect(labels).toEqual(['b', 'c', 'a'])
  })

  it('renders without crashing in compact density', () => {
    const { container } = render(<ScoreboardView currentRow={currentRow} recentRows={recentRows} metrics={metrics}
      onDrill={() => {}} signalKey={null} notableKey={null} normalize={normalize}
      options={{ sort: 'group', density: 'compact', sparkWindow: 10 }} />)
    expect(container.querySelectorAll('svg').length).toBe(3)
  })
})

/**
 * 🔴 EIGHT CARDS ON THIS BOARD WERE PERMANENTLY BLANK — Advancing, Declining,
 * Up/Down From Open, Up/Down On Volume, the CBOE put/call, and a quiet FTD —
 * drawn at exactly the weight of a card carrying a number.
 *
 * ⛔ AND THEY ARE NOT DELETED. Advancing and Declining are being backfilled by
 * separate work, so the question has to be asked of the DATA on every render
 * rather than answered by a list of names. The second case below is the one that
 * matters: a metric with a reading anywhere in the window it draws stays in the
 * grid, sparkline and all.
 */
const silent = { key: 'quiet', label: 'quiet', polarity: 'bull', drillKey: null,
                 getFmt: () => '\u2014', getTier: () => '' }
const loud = { key: 'loud', label: 'loud', polarity: 'bull', drillKey: null,
               getFmt: (r) => String(r.loud ?? 7), getTier: () => 'g1' }
const winRows = [{ date: 'd1', loud: 7 }, { date: 'd0', loud: 5 }]

describe('ScoreboardView blank cards', () => {
  const draw = (metrics, rows = winRows) => render(
    <ScoreboardView currentRow={rows[0]} recentRows={rows} metrics={metrics}
      onDrill={() => {}} signalKey={null} notableKey={null} normalize={() => 50}
      options={{ sort: 'group', density: 'comfortable', sparkWindow: 20 }} />)

  it('moves a card that can print nothing out of the reading grid and says how many', () => {
    const { container, getByTestId } = draw([loud, silent])
    const grid = getByTestId('scoreboard-grid')
    expect(grid.querySelectorAll('svg').length, 'a blank card still drew a card').toBe(1)
    expect(container.querySelector('[data-testid="scoreboard-silent-quiet"]')).toBeTruthy()
    expect(getByTestId('scoreboard-basis').textContent).toContain('1 not reported')
  })

  // ⛔ THE CONTROL. Without it the test above passes on a view that silences
  // every card, or on one that has a hardcoded roster of "the dead fields".
  it('keeps a metric that has a reading anywhere in the window it draws', () => {
    // Blank today, a number three sessions back — an FTD that fired inside the
    // window is exactly this shape, and it is worth a card.
    const revived = { ...silent, key: 'ftd', label: 'ftd',
                      getFmt: (r) => (r.ftd ? 'FTD' : '\u2014') }
    const rows = [{ date: 'd2' }, { date: 'd1', ftd: 1 }, { date: 'd0' }]
    const { container, getByTestId } = draw([revived], rows)
    expect(getByTestId('scoreboard-grid').querySelectorAll('svg').length).toBe(1)
    expect(container.querySelector('[data-testid="scoreboard-silent"]')).toBeNull()
  })
})
