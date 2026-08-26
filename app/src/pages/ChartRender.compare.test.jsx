import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// `?compare=SPY,QQQ` (Discord /chart compare:) overlays up to three symbols the
// way the Charts widget does: StockChart `comparisonSymbols`, each enabled,
// %-rebased (scaleMode 'new'), its own colour. Pinned: the list reaches
// settingsOverride, junk and extras are dropped, the header names them, and a
// chart without the param is untouched.

vi.mock('../components/StockChart', () => ({
  default: (props) => <canvas data-testid="stock-chart" data-override={JSON.stringify(props.settingsOverride ?? null)} width={8} height={8} />,
}))

const { default: ChartRender } = await import('./ChartRender')

function mount(query) {
  return render(
    <MemoryRouter initialEntries={[`/r/chart?${query}`]}>
      <ChartRender />
    </MemoryRouter>,
  )
}
const override = () => JSON.parse(screen.getByTestId('stock-chart').getAttribute('data-override'))

afterEach(() => cleanup())

describe('ChartRender ?compare=', () => {
  it('turns the list into enabled, %-rebased comparison overlays with distinct colours', () => {
    mount('sym=NVDA&tf=D&compare=spy,QQQ,bad!,iwm,dia,SPY')
    const c = override().comparisonSymbols
    expect(c.map(x => x.sym)).toEqual(['SPY', 'QQQ', 'IWM'])            // upper, junk dropped, capped at 3, deduped
    expect(c.every(x => x.enabled === true && x.scaleMode === 'new')).toBe(true)
    expect(new Set(c.map(x => x.color)).size).toBe(3)
    expect(screen.getByTestId('compare-tag').textContent).toBe('vs SPY · QQQ · IWM')
  })

  it('composes with a preset and leaves a chart without the param untouched', () => {
    mount('sym=NVDA&tf=D&preset=oled&compare=SPY')
    const o = override()
    expect(o.preset).toBe('oled')
    expect(o.comparisonSymbols.map(x => x.sym)).toEqual(['SPY'])
    cleanup()
    mount('sym=NVDA&tf=D')
    expect(override()).toBeNull()
    expect(screen.queryByTestId('compare-tag')).toBeNull()
  })
})
