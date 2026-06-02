// app/src/pages/breadth/views/themingAccentViews.test.jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RadarView from './RadarView'
import { PALETTES } from './breadthViewShared'

const mk = (key) => ({ key, label: key, polarity: 'bull', drillKey: null, getFmt: () => key, getTier: () => 'g3' })
const metrics = Array.from({ length: 4 }, (_, i) => mk(`m${i}`))
const row = { date: 'd' }
const normalize = () => 70

describe('accent views honor palette', () => {
  it('Radar polygon uses the ocean bull accent', () => {
    const { container } = render(<RadarView currentRow={row} metrics={metrics} normalize={normalize}
      onDrill={() => {}} signalKey={null} notableKey={null} options={{ palette: 'ocean', intensity: 'normal' }} />)
    const poly = container.querySelector('polygon[stroke]:not([stroke="#1e293b"])')
    // ocean bull = #22d3ee → rgb(34, 211, 238)
    expect(poly.getAttribute('stroke').replace(/\s/g, '')).toMatch(/#22d3ee|rgb\(34,211,238\)/)
  })
})
