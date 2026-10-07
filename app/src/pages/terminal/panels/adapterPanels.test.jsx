// UCT Terminal — the three thin ADAPTER panels (GP, RSCH, DPTH), tested at the adapter.
//
// Each wraps an existing component the terminal may not fork (StockChart, the Notebook's
// TickerResearchWorkspace, Research › Depth's DepthTab). Their loading / error / empty states
// belong to — and are tested with — the wrapped component; what the ADAPTER owns, and what is
// pinned here, is the wiring: the security it follows, the props it hands down, and what it
// reports to its panel header. (completeness.rail.test.js requires every panel module to have a
// test file; before 2026-10-07 these three had none.)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { PanelFreshnessContext } from '../../../components/terminal'

const seen = vi.hoisted(() => ({ chart: [], workspace: [], depth: [], auth: {} }))

vi.mock('../../../components/StockChart', () => ({
  default: (props) => { seen.chart.push(props); return <div data-testid="stub-stockchart">{props.sym}</div> },
}))
vi.mock('../../journal-2-0/components/notebook/TickerResearchWorkspace', () => ({
  default: (props) => {
    seen.workspace.push(props)
    return <button type="button" onClick={() => props.onOpenNote({ id: 'n-42' })}>open note</button>
  },
}))
vi.mock('../../research/depth/DepthTab', () => ({
  default: (props) => { seen.depth.push(props); return <div data-testid="stub-depthtab">{props.sym}</div> },
}))
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => seen.auth }))

import ChartPanel from './ChartPanel'
import MyResearchPanel from './MyResearchPanel'
import DepthPanel from './DepthPanel'

afterEach(() => {
  cleanup()
  seen.chart.length = 0
  seen.workspace.length = 0
  seen.depth.length = 0
  seen.auth = {}
})

describe('GP — ChartPanel embeds StockChart as-is', () => {
  it('follows the security and the typed timeframe, daily by default, read-only chrome', () => {
    const { rerender } = render(<ChartPanel sym="NVDA" />)
    expect(screen.getByTestId('terminal-chart-panel')).toHaveAttribute('data-tf', 'D')
    expect(seen.chart.at(-1)).toMatchObject({ sym: 'NVDA', tf: 'D', showDrawingTools: false, hideReplay: true })
    // A linked group moving to AMD, `GP W` typed: the same chart follows both.
    rerender(<ChartPanel sym="AMD" tf="W" />)
    expect(seen.chart.at(-1)).toMatchObject({ sym: 'AMD', tf: 'W' })
    expect(screen.getByTestId('stub-stockchart')).toHaveTextContent('AMD')
  })
})

describe('RSCH — MyResearchPanel embeds the Notebook workspace', () => {
  it('passes the security as `symbol`, hides the back link, and opens a note through notePath', async () => {
    render(
      <MemoryRouter initialEntries={['/terminal']}>
        <Routes>
          <Route path="/terminal" element={<MyResearchPanel sym="TSLA" />} />
          <Route path="*" element={<div data-testid="landed" />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(seen.workspace.at(-1)).toMatchObject({ symbol: 'TSLA', showBackLink: false })
    fireEvent.click(screen.getByRole('button', { name: 'open note' }))
    expect(await screen.findByTestId('landed')).toBeInTheDocument()
  })
})

describe('DPTH — DepthPanel embeds DepthTab with the auth payload\'s Depth flags', () => {
  it('hands DepthTab the same `researchDepth` object ResearchPage passes', () => {
    seen.auth = { researchDepth: { ftd_dataset_enabled: true } }
    render(<DepthPanel sym="AAPL" />)
    expect(seen.depth.at(-1)).toMatchObject({ sym: 'AAPL', flags: { ftd_dataset_enabled: true } })
  })

  it('reports a stack source to its header only once it has a security, and clears it on unmount', () => {
    const reports = []
    const setter = (r) => reports.push(r)
    const { rerender, unmount } = render(
      <PanelFreshnessContext.Provider value={setter}><DepthPanel sym={null} /></PanelFreshnessContext.Provider>,
    )
    expect(reports.filter(Boolean)).toEqual([])
    rerender(<PanelFreshnessContext.Provider value={setter}><DepthPanel sym="AAPL" /></PanelFreshnessContext.Provider>)
    expect(reports.at(-1)).toEqual({ source: 'several sources; each section names its own' })
    unmount()
    expect(reports.at(-1)).toBeNull()
  })
})
