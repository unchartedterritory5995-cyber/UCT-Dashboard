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
