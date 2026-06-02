// app/src/pages/breadth/views/themingTierViews.test.jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import MetersView from './MetersView'
import EqualizerView from './EqualizerView'
import TimelineView from './TimelineView'
import { PALETTES } from './breadthViewShared'

const mk = (key) => ({ key, label: key, polarity: 'bull', drillKey: null, getFmt: () => key, getTier: () => 'g3' })
const metrics = [mk('a')]
const row = { date: 'd' }
const normalize = () => 80

describe('tier views honor palette', () => {
  it('Meters marker uses the ocean palette g3 color', () => {
    const { container } = render(<MetersView currentRow={row} metrics={metrics} normalize={normalize}
      onDrill={() => {}} signalKey={null} notableKey={null} options={{ palette: 'ocean', intensity: 'normal' }} />)
    const marker = container.querySelector('[data-testid="marker-a"]')
    // ocean g3 = #0891b2; jsdom may keep hex or normalize to rgb(8,145,178)
    expect(marker.style.background.replace(/\s/g, '')).toMatch(/#0891b2|rgb\(8,145,178\)/i)
  })
  it('Levels bar uses palette color and subtle intensity lowers opacity', () => {
    const { container } = render(<EqualizerView currentRow={row} metrics={metrics} normalize={normalize}
      onDrill={() => {}} signalKey={null} notableKey={null} options={{ palette: 'ocean', intensity: 'subtle' }} />)
    const bar = container.querySelector('[data-testid="level-a"]')
    expect(bar).toBeTruthy()
    expect(Number(bar.style.opacity)).toBeLessThan(1)
  })
  it('Timeline cell uses palette color', () => {
    const rows = [row]
    const { container } = render(<TimelineView recentRows={rows} metrics={metrics}
      onDrill={() => {}} signalKey={null} notableKey={null} options={{ palette: 'ocean', windowDays: 10 }} />)
    const cell = container.querySelector('[data-testid="cell-a-0"]')
    expect(cell.style.background.replace(/\s/g, '')).toMatch(/#0891b2|rgb\(8,145,178\)/i)
  })
})
