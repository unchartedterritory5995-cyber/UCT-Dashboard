import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// The widget's only data source + its color-group seam are mocked so the test
// drives render/interaction without a live poll or a WorkspaceProvider.
const swr = vi.fn()
vi.mock('../../../hooks/useMobileSWR', () => ({ default: (...a) => swr(...a) }))
const setGroupSym = vi.fn()
vi.mock('../WorkspaceContext', () => ({ useWorkspace: () => ({ setGroupSym }) }))
// Account preferences (where custom lists now live). `mockPrefs` is injectable per test;
// parsePref mirrors the real one so a stored list round-trips.
let mockPrefs = {}
const setPref = vi.fn()
vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, setPrefMerged: vi.fn() }),
  parsePref: (raw, fb) => {
    if (raw == null) return fb
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fb }
  },
}))
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
    { sym: 'SMCI', price: 42.18, pct: 8.1, rvol: 11.4, rvol_day: 4.2, burst: 9.2, move: 5.2, dir: 'up', score: 28.5, tier: 5, lit: true, igniting: true },
    { sym: 'PLUG', price: 3.05, pct: -6.2, rvol: 4.3, rvol_day: 3.1, burst: 3.1, move: -3.1, dir: 'down', score: 11.1, tier: 3, lit: true, igniting: false },
    { sym: 'AAPL', price: 224.5, pct: 0.2, rvol: 1.2, rvol_day: 1.1, burst: 0.6, move: 0.1, dir: 'up', score: 0.5, tier: 1, lit: false, igniting: false },
  ],
}

beforeEach(() => {
  swr.mockReset()
  setGroupSym.mockReset()
  setPref.mockReset()
  mockPrefs = {}
})

describe('VolumeScanWidget', () => {
  it('shows every top-N name (lit + unlit) in two columns, with the surging count', () => {
    swr.mockReturnValue({ data: LIVE })
    render(<VolumeScanWidget color="A" opts={{}} onOptsChange={() => {}} />)
    expect(screen.getByText('SYMBOL')).toBeInTheDocument()
    expect(screen.getByText('SIGNAL')).toBeInTheDocument()       // tier column, not raw RVOL
    expect(screen.getByText('SMCI')).toBeInTheDocument()
    expect(screen.getByText('Extreme')).toBeInTheDocument()      // SMCI (tier 5) → T5 · Extreme
    expect(screen.getByText('High')).toBeInTheDocument()         // PLUG (tier 3) → T3 · High
    expect(screen.queryByText('11.4×')).not.toBeInTheDocument()  // raw multiple no longer shown
    expect(screen.getByText('AAPL')).toBeInTheDocument()        // an unlit name is still listed…
    expect(screen.getByLabelText(/AAPL.*below criteria/)).toBeInTheDocument()   // …flagged below-criteria
  })

  it('flags an igniting name (burst + move) with the burst in its tooltip', () => {
    swr.mockReturnValue({ data: LIVE })
    render(<VolumeScanWidget color="A" opts={{}} onOptsChange={() => {}} />)
    expect(screen.getByLabelText(/SMCI.*9\.2× burst.*igniting now/)).toBeInTheDocument()
    // PLUG is lit but not igniting — no "igniting now" in its tooltip.
    expect(screen.getByLabelText(/^PLUG —/).getAttribute('aria-label')).not.toMatch(/igniting now/)
  })

  it('no longer renders the RVOL / Burst / Δ% / $K filter boxes', () => {
    swr.mockReturnValue({ data: LIVE })
    render(<VolumeScanWidget color="A" opts={{}} onOptsChange={() => {}} />)
    expect(screen.queryByLabelText('Minimum burst relative volume')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Minimum relative volume')).not.toBeInTheDocument()
  })

  it('shows a just-added custom-list ticker INSTANTLY as a pending row', () => {
    // The list holds NVDA but the poll has not returned it yet — it must still show at
    // once (a placeholder), so adding a ticker feels immediate.
    swr.mockReturnValue({ data: { window: 'rth', asof: TS, rows: [] } })
    mockPrefs = { volume_scan_lists: JSON.stringify([{ id: 'l1', name: 'Mine', syms: ['NVDA'] }]) }
    render(<VolumeScanWidget color="A" opts={{ volActive: 'l1' }} onOptsChange={() => {}} />)
    expect(screen.getByText('NVDA')).toBeInTheDocument()
    expect(screen.getByLabelText(/NVDA — added to your list/)).toBeInTheDocument()
  })

  it('right-clicking a custom-list row removes the ticker from the ACCOUNT list', () => {
    swr.mockReturnValue({ data: LIVE })
    mockPrefs = { volume_scan_lists: JSON.stringify([{ id: 'l1', name: 'Mine', syms: ['SMCI', 'PLUG', 'AAPL'] }]) }
    render(<VolumeScanWidget color="A" opts={{ volActive: 'l1' }} onOptsChange={() => {}} />)
    fireEvent.contextMenu(screen.getByLabelText(/^SMCI —/))
    const remove = screen.getByText(/Remove from Mine/)
    fireEvent.mouseDown(remove)   // the bug was: this never fired removeSym
    // Lists persist on the account (not per-widget opts) so they survive close/reopen.
    expect(setPref).toHaveBeenCalledWith('volume_scan_lists',
      [expect.objectContaining({ syms: ['PLUG', 'AAPL'] })])
  })

  it('a custom list persists on the account preference, not per-widget opts', () => {
    // Regression for "made a list, closed the widget, list was gone": creating/editing a
    // list must write the account pref (`volume_scan_lists`), which is layout-independent.
    swr.mockReturnValue({ data: { window: 'rth', asof: TS, rows: [] } })
    mockPrefs = { volume_scan_lists: JSON.stringify([{ id: 'l1', name: 'Watch', syms: ['NVDA'] }]) }
    render(<VolumeScanWidget color="A" opts={{ volActive: 'l1' }} onOptsChange={() => {}} />)
    // A brand-new widget with EMPTY opts still shows the saved list's contents.
    expect(screen.getByText('NVDA')).toBeInTheDocument()
  })

  it('hides company logos by default, and shows them when showLogos is on', () => {
    swr.mockReturnValue({ data: LIVE })
    const { container, rerender } = render(<VolumeScanWidget color="A" opts={{}} onOptsChange={() => {}} />)
    expect(container.querySelector('[data-logo="SMCI"]')).not.toBeInTheDocument()   // default off
    rerender(<VolumeScanWidget color="A" opts={{ showLogos: true }} onOptsChange={() => {}} />)
    expect(container.querySelector('[data-logo="SMCI"]')).toBeInTheDocument()
  })

  it('clicking a row routes the symbol into the widget color group', () => {
    swr.mockReturnValue({ data: LIVE })
    render(<VolumeScanWidget color="A" opts={{}} onOptsChange={() => {}} />)
    fireEvent.click(screen.getByLabelText(/^SMCI —/))
    expect(setGroupSym).toHaveBeenCalledWith('A', 'SMCI')
  })

  it('the live poll URL requests the whole universe and carries the persisted filters', () => {
    swr.mockReturnValue({ data: LIVE })
    render(<VolumeScanWidget color="A" opts={{ minRvol: 3, minMove: 0.5 }} onOptsChange={() => {}} />)
    expect(swr.mock.calls[0][0]).toContain('show_all=1')
    expect(swr.mock.calls[0][0]).toContain('min_rvol=3')
    expect(swr.mock.calls[0][0]).toContain('min_burst=3')   // default burst gate
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
