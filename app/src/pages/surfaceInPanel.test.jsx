// Lane 3 (terminal visual pass): whole pages embedded in a UCT Terminal panel drop the title
// the panel header already shows, and their own page padding when the shell insets the body.
// Each case renders the SAME page outside a panel as the control, so a check that always
// answered "no title" could not pass.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { TerminalPanelContext } from '../components/terminal'

let heatState
vi.mock('../hooks/useMobileSWR', () => ({ default: () => ({ ...heatState, mutate: vi.fn() }) }))
vi.mock('../components/TickerPopup', () => ({ default: ({ sym }) => <span>{sym}</span> }))
import PortfolioHeat from './PortfolioHeat'
import CatalystsHistory from './CatalystsHistory'
import FlowScoreboard from './FlowScoreboard'
import SurfaceHeader from './SurfaceHeader'

const PANEL = { code: 'X', density: 'comfortable', inset: true }
const mount = (node, inPanel) => render(
  <MemoryRouter>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      {inPanel ? <TerminalPanelContext.Provider value={PANEL}>{node}</TerminalPanelContext.Provider> : node}
    </SWRConfig>
  </MemoryRouter>,
)

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('SurfaceHeader', () => {
  it('is the full PageHeader outside a panel and keeps only the controls inside one', () => {
    mount(<SurfaceHeader icon="star" title="UCT 20"><button type="button">Tab</button></SurfaceHeader>, false)
    expect(screen.getByRole('heading', { name: 'UCT 20' })).toBeInTheDocument()
    cleanup()
    mount(<SurfaceHeader icon="star" title="UCT 20"><button type="button">Tab</button></SurfaceHeader>, true)
    expect(screen.queryByRole('heading', { name: 'UCT 20' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Tab' })).toBeInTheDocument()
  })
})

describe('whole pages inside a terminal panel', () => {
  it('Portfolio Risk drops its h1 and uses the panel skeleton while loading', () => {
    heatState = { data: undefined, error: undefined }
    mount(<PortfolioHeat />, false)
    expect(screen.getByRole('heading', { name: 'Portfolio Risk' })).toBeInTheDocument()
    cleanup()
    mount(<PortfolioHeat />, true)
    expect(screen.queryByRole('heading', { name: 'Portfolio Risk' })).toBeNull()
    expect(screen.getByTestId('panel-skeleton')).toBeInTheDocument()
  })

  it('Portfolio Risk errors in a panel read through PanelState with Retry', () => {
    heatState = { data: undefined, error: Object.assign(new Error('x'), { status: 503 }) }
    mount(<PortfolioHeat />, true)
    expect(screen.getByRole('status').textContent).toMatch(/could not be read right now/)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('Catalyst History drops its title block', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ rows: [] }) })
    mount(<CatalystsHistory />, false)
    expect(screen.getByRole('heading', { name: /Catalyst History/ })).toBeInTheDocument()
    cleanup()
    mount(<CatalystsHistory />, true)
    expect(screen.queryByRole('heading', { name: /Catalyst History/ })).toBeNull()
  })

  it('Flow Scoreboard drops its public-page hero copy', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ picks_tracked: 0 }) })
    mount(<FlowScoreboard />, false)
    expect(screen.getByRole('heading', { name: /Every pick, tracked/ })).toBeInTheDocument()
    cleanup()
    mount(<FlowScoreboard />, true)
    expect(screen.queryByRole('heading', { name: /Every pick, tracked/ })).toBeNull()
  })
})
