// Wave 13 lane 13H-4: ChartEmbed's `mobileDrawBar` pass-through to StockChart.
// `annotationsEditable` is what ChartEmbed already sets from its own `annotate`
// prop (the Notebook's Draw mode); `mobileDrawBar` tells StockChart's
// annotationsEditable branch to present MobileDrawBar instead of the full
// desktop ChartToolbar (docs/notebook/wave13-13h3.md §2, §8). Same
// props-recorder pattern as ChartEmbed.link.test.jsx.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { buildWidgetEmbedAttrs } from '../../lib/widgetEmbedCore'
import ChartEmbed from './ChartEmbed'

const panes = []
vi.mock('../../../../components/chart/pane/ChartPane', () => ({
  default: (props) => { panes.push(props); return null },
}))

const attrs = () => buildWidgetEmbedAttrs('chart', { symbol: 'AMD', tf: 'D' })

describe('ChartEmbed mobileDrawBar pass-through (13H-4)', () => {
  beforeEach(() => { panes.length = 0 })

  it('Draw mode + coarse pointer: mobileDrawBar reaches StockChart', () => {
    render(<ChartEmbed attrs={attrs()} annotate mobileDrawBar />)
    expect(panes[0].stockChartProps.mobileDrawBar).toBe(true)
    expect(panes[0].stockChartProps.annotationsEditable).toBe(true)
  })

  it('Draw mode on a fine pointer (mobileDrawBar unset): default false, byte-identical to before this lane', () => {
    render(<ChartEmbed attrs={attrs()} annotate />)
    expect(panes[0].stockChartProps.mobileDrawBar).toBe(false)
  })

  it('NOT drawing: mobileDrawBar can never reach StockChart true, even if a stale caller still passes it', () => {
    // The second AND-gate in ChartEmbed (`!!annotate && !!mobileDrawBar`) — a
    // read-only chart must never light up the drawing toolbar swap.
    render(<ChartEmbed attrs={attrs()} annotate={false} mobileDrawBar />)
    expect(panes[0].stockChartProps.mobileDrawBar).toBe(false)
    expect(panes[0].stockChartProps.annotationsEditable).toBe(false)
  })
})
