import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { COLUMN_DEFS } from '../columnDefs'
import ShellToolbar from './ShellToolbar'

const META = { views: [{ key: 'overview', label: 'Overview' }, { key: 'momentum', label: 'Momentum' }] }
const SNAP = { rows: 3742, snapshot_date: '2026-08-21', rows_on_snapshot_date: 3540,
  oldest_snapshot_date: '2026-08-19', newest_snapshot_date: '2026-08-21',
  rows_missing_snapshot_date: 0, mixed: true }

const LIVE_COLS = ['price', 'chg_pct_1d', 'pct_vs_sma50', 'dist_52w_high_pct']
// verbatim `api/services/screener/query.py::LIVE_ANCHOR_NOTE` — the server owns
// this sentence; the fixture copies it rather than paraphrasing so a wording
// change on the server shows up here as a diff, not as a silent divergence.
const ANCHOR = "Levels — moving averages, 52-week and 20-day extremes, pattern entry "
  + "and stop — are from each row's last completed session and do not move during "
  + "the day. Only the price-derived columns below are live."
const LIVE_ON = {
  state: 'live', as_of: 1755954127.4, as_of_et: '10:42:07 ET',
  columns: LIVE_COLS, column_count: LIVE_COLS.length,
  rows_on_page: 200, live_rows_on_page: 193,
  anchor_note: ANCHOR, off_reason: null, tier: { state: 'on' },
}
const LIVE_OFF = {
  state: 'nightly', as_of: null, as_of_et: null, columns: [], column_count: 0,
  rows_on_page: 200, live_rows_on_page: 0, anchor_note: ANCHOR,
  off_reason: 'The live overlay is switched off.',
  tier: { state: 'off' },
}
const base = {
  meta: META, view: 'overview', onView: vi.fn(), visibleColumns: ['ticker'], allColumns: [],
  onColumns: vi.fn(), onResetColumns: vi.fn(), density: 'compact', onDensity: vi.fn(),
  snapshot: SNAP, snapshotDate: '2026-08-21', total: 120, shown: 100, isLoading: false,
  onExport: vi.fn(), exportState: {}, saveBar: <span>savebar</span>,
}

describe('ShellToolbar', () => {
  it('views come from meta and select through onView', () => {
    render(<ShellToolbar {...base} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Momentum' }))
    expect(base.onView).toHaveBeenCalledWith('momentum')
  })

  it('the seal opens the provenance popover and says when the snapshot is mixed', () => {
    render(<ShellToolbar {...base} />)
    fireEvent.click(screen.getByRole('button', { name: /snapshot 2026-08-21/i }))
    expect(screen.getByRole('dialog', { name: /provenance/i })).toHaveTextContent(/3,540/)
    expect(screen.getByText(/mixed snapshot/i)).toBeInTheDocument()
  })

  it('density toggles with aria-pressed; export error is a status', () => {
    render(<ShellToolbar {...base} exportState={{ error: 'Export failed — nothing downloaded.' }} />)
    expect(screen.getByRole('button', { name: /density/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(/nothing downloaded/i)
  })

  it('unmounting with the seal popover open removes the outside-click listener', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { unmount } = render(<ShellToolbar {...base} />)
    fireEvent.click(screen.getByRole('button', { name: /snapshot 2026-08-21/i }))
    const added = addSpy.mock.calls.filter(([t]) => t === 'mousedown').length
    unmount()
    const removed = removeSpy.mock.calls.filter(([t]) => t === 'mousedown').length
    expect(added).toBeGreaterThan(0)
    expect(removed).toBe(added)
    addSpy.mockRestore(); removeSpy.mockRestore()
  })
})

// ── LIVE vs NIGHTLY, in the seal that already owns provenance ────────────────
//
// ⛔ BOTH DIRECTIONS OR NEITHER. A toolbar hard-wired to "LIVE" passes any
// live-only suite, and a toolbar hard-wired to "nightly" passes any
// nightly-only suite. Every case below has its opposite in the same file, and
// the third case (no `live` block at all) pins that a payload predating the
// tier still renders exactly today's seal — silence is only correct when the
// server said nothing about a live tier.
describe('ShellToolbar — live-tier disclosure', () => {
  const withLive = live => ({ ...base, snapshot: { ...SNAP, live } })

  it('says LIVE with the as-of on the chip when the overlay reached this screen', () => {
    render(<ShellToolbar {...withLive(LIVE_ON)} />)
    expect(screen.getByText(/LIVE 10:42:07 ET/)).toBeInTheDocument()
    expect(screen.queryByText('nightly')).not.toBeInTheDocument()
    // the accessible name must carry the qualification the chip cannot fit —
    // "some columns", never "this row is live"
    expect(screen.getByRole('button', { name: /snapshot 2026-08-21/i }))
      .toHaveAccessibleName(/price-derived columns are live.*every other column on the row is from the 03:00 build/i)
  })

  it('the popover names every live column, counts them from the list, and says what is NOT live', () => {
    render(<ShellToolbar {...withLive(LIVE_ON)} />)
    fireEvent.click(screen.getByRole('button', { name: /snapshot 2026-08-21/i }))
    const pop = screen.getByRole('dialog', { name: /provenance/i })
    expect(pop).toHaveTextContent(/193 of 200 rows loaded here carry live values/)
    expect(pop).toHaveTextContent(/recomputed at 10:42:07 ET/)
    // the count is `.length` of the rendered list, so it can never disagree
    expect(pop).toHaveTextContent(`Live columns (${LIVE_COLS.length}):`)
    // labels, not raw keys — and read out of COLUMN_DEFS rather than typed here
    for (const c of LIVE_COLS) expect(pop).toHaveTextContent(COLUMN_DEFS[c].label)
    expect(pop).toHaveTextContent(/Every other column is from the 03:00 build/)
    // the anchor sentence is the SERVER's string, rendered verbatim
    expect(pop).toHaveTextContent(/do not move during the day/)
  })

  it('says nightly on the chip and states the reason in the popover when it is not live', () => {
    render(<ShellToolbar {...withLive(LIVE_OFF)} />)
    expect(screen.getByText('nightly')).toBeInTheDocument()
    expect(screen.queryByText(/LIVE/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /snapshot 2026-08-21/i }))
    const pop = screen.getByRole('dialog', { name: /provenance/i })
    expect(pop).toHaveTextContent(/Live overlay off/)
    expect(pop).toHaveTextContent(/every column on this screen is from the 03:00 build/)
    expect(pop).toHaveTextContent(/switched off/)
    // and it must NOT claim a live column set it does not have
    expect(pop).not.toHaveTextContent(/Live columns/)
    // ⛔ the reason is a CAUSE clause appended to the lead, never a second copy
    // of it — the popover must not say "from the 03:00 build" twice
    expect(pop.textContent.match(/from the 03:00 build/g)).toHaveLength(1)
  })

  it('a tier that is ON but has not reached this screen still reads nightly, with the reason', () => {
    render(<ShellToolbar {...withLive({
      ...LIVE_OFF, tier: { state: 'on' },
      off_reason: 'No row in this result carries a live value — the overlay has not reached these symbols.',
    })} />)
    expect(screen.getByText('nightly')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /snapshot 2026-08-21/i }))
    expect(screen.getByRole('dialog', { name: /provenance/i }))
      .toHaveTextContent(/has not reached these symbols/)
  })

  it('a payload with no live block renders the seal exactly as before — no invented claim', () => {
    render(<ShellToolbar {...base} />)
    expect(screen.queryByText('nightly')).not.toBeInTheDocument()
    expect(screen.queryByText(/LIVE/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /snapshot 2026-08-21/i }))
    const pop = screen.getByRole('dialog', { name: /provenance/i })
    expect(pop).not.toHaveTextContent(/Live overlay/)
    expect(pop).toHaveTextContent(/3,540/)
  })
})
