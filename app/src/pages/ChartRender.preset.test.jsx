import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// `?preset=` applies one of the app's OWN theme presets (chartDefaults.PRESETS)
// as its delta from CHART_DEFAULTS. Pinned: the preset's colours reach
// StockChart's settingsOverride, an explicit ?indicators= still wins on top,
// and an unknown preset changes nothing.

vi.mock('../components/StockChart', () => ({
  default: (props) => <canvas data-testid="stock-chart" data-override={JSON.stringify(props.settingsOverride ?? null)} width={8} height={8} />,
}))

const { default: ChartRender } = await import('./ChartRender')
const { PRESETS } = await import('../components/chart/chartDefaults')

function mount(query) {
  return render(
    <MemoryRouter initialEntries={[`/r/chart?${query}`]}>
      <ChartRender />
    </MemoryRouter>,
  )
}
const override = () => JSON.parse(screen.getByTestId('stock-chart').getAttribute('data-override'))
function b64url(obj) {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

afterEach(() => cleanup())

describe('ChartRender ?preset=', () => {
  it('applies the OLED preset delta', () => {
    mount('sym=NVDA&tf=D&preset=oled')
    const o = override()
    expect(o.preset).toBe('oled')
    expect(o.background).toBe(PRESETS.oled.settings.background)
    expect(o.candles.upColor).toBe(PRESETS.oled.settings.candles.upColor)
  })

  it('lets an explicit ?indicators= override win over the preset', () => {
    mount(`sym=NVDA&tf=D&preset=oled&indicators=${b64url({ background: '#123456' })}`)
    expect(override().background).toBe('#123456')
    expect(override().preset).toBe('oled')
  })

  it('ignores an unknown preset', () => {
    mount('sym=NVDA&tf=D&preset=neon')
    expect(override()).toBeNull()
  })
})
