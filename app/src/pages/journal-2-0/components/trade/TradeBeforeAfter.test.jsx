// Wave 13 lane 13I-2 — before and after: the entry-day chart beside the exit-day chart, each
// FROZEN with replayCutoff (the note chart's own freeze), with the plan's levels and the fills.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

const panes = []
vi.mock('../../../../components/chart/pane/ChartPane', () => ({
  default: (props) => { panes.push(props); return <div data-testid="pane" /> },
}))

const { default: TradeBeforeAfter, planPriceLines } = await import('./TradeBeforeAfter')

const respond = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
const DATA = {
  trade: { tradeId: 't1', tradeRef: 'id:t1', symbol: 'NVDA', side: 'Long', result: 'Win', shares: 100,
    entryPrice: 100, exitPrice: 110, entryDate: '2026-09-30T14:00:00Z', exitDate: '2026-10-02T15:00:00Z',
    entryDay: '2026-09-30', exitDay: '2026-10-02' },
  planStatus: 'linked',
  plan: { entry: 100, stop: 96, target: 112, noteId: 'n1', noteTitle: 'NVDA plan' },
  planChart: { asOf: '2026-09-29', setupTag: 'VCP', image: { url: '/img/a.png' } },
}

function renderIt() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <TradeBeforeAfter tradeId="t1" />
    </SWRConfig>,
  )
}

describe('TradeBeforeAfter', () => {
  afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks(); panes.length = 0 })

  it('plan levels become labelled dashed lines; a missing level is left out', () => {
    expect(planPriceLines({ entry: 100, stop: 96, target: null }).map((l) => [l.title, l.price, l.lineStyle]))
      .toEqual([['Plan entry', 100, 2], ['Plan stop', 96, 2]])
    expect(planPriceLines(null)).toEqual([])
  })

  it('renders nothing and fetches nothing with the gate off', () => {
    latchNotebookFlags({ notebook_visual_playbook_enabled: false })
    global.fetch = vi.fn()
    const { container } = renderIt()
    expect(container.innerHTML).toBe('')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('the entry chart is frozen at the entry day and the exit chart at the exit day, both with the plan', async () => {
    latchNotebookFlags({ notebook_visual_playbook_enabled: true })
    global.fetch = vi.fn(() => respond(200, DATA))
    renderIt()
    expect((await screen.findAllByTestId('pane')).length).toBe(2)
    const [before, after] = panes.slice(-2)
    expect(before.stockChartProps.replayCutoff).toBe('2026-09-30')
    expect(after.stockChartProps.replayCutoff).toBe('2026-10-02')
    for (const p of [before, after]) {
      expect(p.sym).toBe('NVDA')
      expect(p.stockChartProps.backgroundWarm).toBe(false)
      expect(p.stockChartProps.priceLines.map((l) => l.title)).toEqual(['Plan entry', 'Plan stop', 'Plan target'])
      // W5 (390px walk) FAIL, fixed: the shared scale-toggle (9px font) and the legend's
      // indicator-overflow chip both sit under --tap-min with two of these side by side at
      // phone width. Both are HOST chrome vetoes here, like hideJournalOverlay above.
      expect(p.stockChartProps.hideLegend).toBe(true)
      expect(p.stockChartProps.hideScaleToggle).toBe(true)
    }
    expect(before.stockChartProps.markers.map((m) => m.text)).toEqual(['BUY 100'])
    expect(after.stockChartProps.markers.map((m) => m.text)).toEqual(['BUY 100', 'SELL Win'])
    expect(screen.getByText(/Plan levels from “NVDA plan”: entry 100/)).toBeTruthy()
    expect(screen.getByAltText(/The chart in the plan note/).getAttribute('src')).toBe('/img/a.png')
  })

  it('with no frozen plan, only the fills are drawn and it says so', async () => {
    latchNotebookFlags({ notebook_visual_playbook_enabled: true })
    global.fetch = vi.fn(() => respond(200, { ...DATA, planStatus: 'none', plan: null, planChart: null }))
    renderIt()
    expect(await screen.findByText('No frozen plan for this trade, so only the fills are drawn.')).toBeTruthy()
    expect(panes.at(-1).stockChartProps.priceLines).toEqual([])
  })
})
