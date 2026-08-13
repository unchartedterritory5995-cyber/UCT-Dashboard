// Linked crosshair + "what happened next" rails (post-v1 round, 8/13).
//
// ChartPane is mocked to a props recorder — these rails pin the CONTRACT the
// embed hands StockChart (which owns both crosshair halves and the anchorDate
// framing, each contract-tested on its own side):
// 1. one shared bus links two embeds, and an embed never echoes itself;
// 2. peekToNow swaps replayCutoff (frozen evidence) for anchorDate framing
//    (the aftermath view) — and NEVER both.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { makeCrosshairBus, buildWidgetEmbedAttrs } from '../../lib/widgetEmbedCore'
import ChartEmbed from './ChartEmbed'

const panes = []
vi.mock('../../../../components/chart/pane/ChartPane', () => ({
  default: (props) => { panes.push(props); return null },
}))

const anchoredAttrs = () =>
  buildWidgetEmbedAttrs('chart', { symbol: 'AMD', tf: '15', to: '2026-03-13' })

describe('linked crosshair (per-note bus)', () => {
  beforeEach(() => { panes.length = 0 })

  it('two embeds on one bus mirror each other and never echo themselves', () => {
    const bus = makeCrosshairBus()
    render(<ChartEmbed attrs={anchoredAttrs()} crosshairBus={bus} />)
    render(<ChartEmbed attrs={anchoredAttrs()} crosshairBus={bus} />)
    const [a, b] = panes.map((p) => p.stockChartProps)
    const gotA = []
    const gotB = []
    a.subscribeCrosshair((p) => gotA.push(p))
    b.subscribeCrosshair((p) => gotB.push(p))
    a.onCrosshairMove({ day: '2026-03-13', price: 193.45 })
    expect(gotB).toEqual([{ day: '2026-03-13', price: 193.45 }])
    expect(gotA).toEqual([])                       // echo suppressed
    b.onCrosshairMove({ day: '2026-03-12' })
    expect(gotA).toEqual([{ day: '2026-03-12' }])
    expect(gotB).toHaveLength(1)
  })

  it('unsubscribe detaches; no bus = no crosshair props at all', () => {
    const bus = makeCrosshairBus()
    render(<ChartEmbed attrs={anchoredAttrs()} crosshairBus={bus} />)
    render(<ChartEmbed attrs={anchoredAttrs()} crosshairBus={bus} />)
    const [a, b] = panes.map((p) => p.stockChartProps)
    const got = []
    const off = b.subscribeCrosshair((p) => got.push(p))
    off()
    a.onCrosshairMove({ day: 'x' })
    expect(got).toEqual([])

    panes.length = 0
    render(<ChartEmbed attrs={anchoredAttrs()} />)
    expect(panes[0].stockChartProps.onCrosshairMove).toBeUndefined()
    expect(panes[0].stockChartProps.subscribeCrosshair).toBeUndefined()
  })
})

describe('"what happened next" peek', () => {
  beforeEach(() => { panes.length = 0 })

  it('anchored snapshot: frozen = replayCutoff; peek = anchorDate; never both', () => {
    render(<ChartEmbed attrs={anchoredAttrs()} peekToNow={false} />)
    render(<ChartEmbed attrs={anchoredAttrs()} peekToNow />)
    const [frozen, peeked] = panes.map((p) => p.stockChartProps)
    expect(frozen.replayCutoff).toBe('2026-03-13')
    expect(frozen.anchorDate).toBeUndefined()
    expect(peeked.anchorDate).toBe('2026-03-13')
    expect(peeked.replayCutoff).toBeUndefined()
  })

  it('live mode and unanchored snapshots take neither prop', () => {
    render(<ChartEmbed attrs={{ ...anchoredAttrs(), mode: 'live' }} peekToNow />)
    const live = panes[0].stockChartProps
    expect(live.replayCutoff).toBeUndefined()
    expect(live.anchorDate).toBeUndefined()
  })
})
