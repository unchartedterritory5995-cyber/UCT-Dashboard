import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// The widget's only data source + its color-group seam are mocked so the test
// drives render/interaction without a live poll or a WorkspaceProvider.
const swr = vi.fn()
vi.mock('../../../hooks/useMobileSWR', () => ({ default: (...a) => swr(...a) }))
const setGroupSym = vi.fn()
vi.mock('../WorkspaceContext', () => ({ useWorkspace: () => ({ setGroupSym }) }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: vi.fn() }), parsePref: (_v, d) => d }))
// Stub the logo (real one fetches + sets timers) so we can assert on/off cleanly.
vi.mock('../../../components/CompanyLogo', () => ({ default: ({ sym }) => <i data-logo={sym} /> }))

import VolumeScanWidget from './VolumeScanWidget'

const TS = '2026-08-25T13:26:04-04:00'
const LIVE = {
  window: 'rth',
  asof: TS,
  total: 2,           // 2 names MEET the criteria (lit)…
  shown: 3,           // …but all 3 top-N names are shown
  rows: [
    { sym: 'SMCI', price: 42.18, pct: 8.1, rvol: 11.4, move: 5.2, dir: 'up', score: 28.5, tier: 4, lit: true },
    { sym: 'PLUG', price: 3.05, pct: -6.2, rvol: 4.3, move: -3.1, dir: 'down', score: 11.1, tier: 2, lit: true },
    { sym: 'AAPL', price: 224.5, pct: 0.2, rvol: 1.2, move: 0.1, dir: 'up', score: 0.5, tier: 1, lit: false },
  ],
}

beforeEach(() => {
  swr.mockReset()
  setGroupSym.mockReset()
})

describe('VolumeScanWidget', () => {
  it('shows every top-N name (lit + unlit) in two columns, with the surging count', () => {
    swr.mockReturnValue({ data: LIVE })
    render(<VolumeScanWidget color="A" opts={{}} onOptsChange={() => {}} />)
    expect(screen.getByText('SYMBOL')).toBeInTheDocument()
    expect(screen.queryByText('VOL SURGE')).not.toBeInTheDocument()   // renamed → RVOL
    expect(screen.getAllByText(/RVOL/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/· 2/)).toBeInTheDocument()         // lit count in header
    expect(screen.getByText('SMCI')).toBeInTheDocument()
    expect(screen.getByText('11.4×')).toBeInTheDocument()       // RVOL block
    expect(screen.getByText('AAPL')).toBeInTheDocument()        // an unlit name is still listed…
    expect(screen.getByTitle(/AAPL.*below criteria/)).toBeInTheDocument()   // …flagged below-criteria
  })

  it('shows company logos by default, and hides them when showLogos is off', () => {
    swr.mockReturnValue({ data: LIVE })
    const { container, rerender } = render(<VolumeScanWidget color="A" opts={{}} onOptsChange={() => {}} />)
    expect(container.querySelector('[data-logo="SMCI"]')).toBeInTheDocument()   // default on
    rerender(<VolumeScanWidget color="A" opts={{ showLogos: false }} onOptsChange={() => {}} />)
    expect(container.querySelector('[data-logo="SMCI"]')).not.toBeInTheDocument()
  })

  it('clicking a row routes the symbol into the widget color group', () => {
    swr.mockReturnValue({ data: LIVE })
    render(<VolumeScanWidget color="A" opts={{}} onOptsChange={() => {}} />)
    fireEvent.click(screen.getByTitle(/^SMCI —/))
    expect(setGroupSym).toHaveBeenCalledWith('A', 'SMCI')
  })

  it('editing the RVOL filter persists through onOptsChange (committed on blur)', () => {
    swr.mockReturnValue({ data: LIVE })
    const onOptsChange = vi.fn()
    render(<VolumeScanWidget color="A" opts={{ minMove: 0.25 }} onOptsChange={onOptsChange} />)
    const input = screen.getByLabelText('Minimum relative volume')
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.blur(input)
    expect(onOptsChange).toHaveBeenCalledWith(expect.objectContaining({ minRvol: 5, minMove: 0.25 }))
  })

  it('the live poll URL requests the whole universe and carries the persisted filters', () => {
    swr.mockReturnValue({ data: LIVE })
    render(<VolumeScanWidget color="A" opts={{ minRvol: 3, minMove: 0.5 }} onOptsChange={() => {}} />)
    expect(swr.mock.calls[0][0]).toContain('show_all=1')
    expect(swr.mock.calls[0][0]).toContain('min_rvol=3')
    expect(swr.mock.calls[0][0]).toContain('min_move=0.5')
  })

  it('shows the panel during post-market (not just RTH)', () => {
    swr.mockReturnValue({ data: { ...LIVE, window: 'post' } })
    render(<VolumeScanWidget color="A" opts={{}} onOptsChange={() => {}} />)
    expect(screen.getByText('POST-MARKET')).toBeInTheDocument()
    expect(screen.getByText('SMCI')).toBeInTheDocument()
  })

  it('shows a market-closed notice only when the window is closed', () => {
    swr.mockReturnValue({ data: { window: 'closed', rows: [] } })
    render(<VolumeScanWidget color="A" opts={{}} onOptsChange={() => {}} />)
    expect(screen.getByText(/Market closed/i)).toBeInTheDocument()
    expect(screen.queryByText('SYMBOL')).not.toBeInTheDocument()
  })
})
