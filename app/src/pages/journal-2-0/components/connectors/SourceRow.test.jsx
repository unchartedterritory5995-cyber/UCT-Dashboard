/**
 * SourceRow — the warning state, which had no rail because it had no way to
 * happen.
 *
 * `freshnessTone` has always dotted amber on `lastSyncStatus === 'warning'`
 * and the row has always rendered `lastSyncError`. Nothing ever wrote
 * "warning" to that column — `record_sync_result` could only persist "ok" or
 * "error" — so the branch was built, green, and unreachable. The backend now
 * emits it for a sync pass that fetched notes and stored none of them
 * (session-audit.md A1), so it needs a rail that watches it fail.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SourceRow from './SourceRow'

const noop = () => {}

function makeSource(over = {}) {
  return {
    id: 's1',
    displayName: 'My Vault',
    remoteId: 'vault-1',
    syncEnabled: true,
    status: 'active',
    lastSyncAt: '2026-09-02T12:00:00Z',
    lastSyncStatus: 'ok',
    lastSyncError: null,
    counts: { notesCreated: 12, notesUpdated: 0, conflicts: 0 },
    ...over,
  }
}

function renderRow(source) {
  return render(
    <SourceRow source={source} onSync={noop} onTogglePause={noop} onDisconnect={noop} />,
  )
}

describe('SourceRow — a sync that stored nothing', () => {
  it('tells the member WHY, not just that something is amber', () => {
    renderRow(makeSource({
      lastSyncStatus: 'warning',
      lastSyncError: 'note "Q3 planning" is too large to store (212 KB limit)',
    }))
    // The reason is the actionable half. An amber dot alone tells a member
    // something is wrong and gives them nothing to do about it.
    expect(screen.getByText(/Q3 planning/)).toBeInTheDocument()
    expect(screen.getByText(/too large to store/)).toBeInTheDocument()
  })

  it('does not call a pass that stored nothing "synced"', () => {
    renderRow(makeSource({ lastSyncStatus: 'warning', lastSyncError: 'stored 0 of 13 notes' }))
    // `lastSyncAt` IS set — a sync did run — so the old label read
    // "synced 2 minutes ago" beside a warning about nothing being stored.
    // Literally true, and it is the line a member scans first.
    expect(screen.queryByText(/^synced /)).not.toBeInTheDocument()
    expect(screen.getByText(/finished with problems/i)).toBeInTheDocument()
  })

  it('leaves an ordinary healthy sync alone', () => {
    renderRow(makeSource())
    expect(screen.getByText(/^synced /)).toBeInTheDocument()
    expect(screen.queryByText(/finished with problems/i)).not.toBeInTheDocument()
  })

  it('a conflict count comes with a path to actually find and resolve it', () => {
    renderRow(makeSource({ counts: { notesCreated: 5, notesUpdated: 1, conflicts: 2 } }))
    expect(screen.getByText('Conflicts')).toBeInTheDocument()
    expect(screen.getByText(/sync-conflict/)).toBeInTheDocument()
  })

  it('shows no conflict hint when there are none', () => {
    renderRow(makeSource({ counts: { notesCreated: 5, notesUpdated: 1, conflicts: 0 } }))
    expect(screen.queryByText(/sync-conflict/)).not.toBeInTheDocument()
  })

  it('still reports a hard failure as a failure, not a warning', () => {
    renderRow(makeSource({ lastSyncStatus: 'error', lastSyncError: 'token expired' }))
    expect(screen.getByText(/token expired/)).toBeInTheDocument()
    expect(screen.queryByText(/finished with problems/i)).not.toBeInTheDocument()
  })
})

describe('SourceRow — a broken connector (reconnect reachability)', () => {
  // Before this fix, `status: 'broken'` rendered a red dot and the label
  // "reconnect needed" with NO control anywhere on the row that could act on
  // it — Sync now just resubmits the same failing credentials, and
  // Disconnect throws the source away rather than healing it. A label that
  // promises a recovery path the member cannot reach is the same defect
  // shape as the "amber warning branch nothing could ever trigger" this file
  // already fixed once for `lastSyncStatus === 'warning'`.
  it('renders a Reconnect button and calls onReconnect(source) when clicked', () => {
    const onReconnect = vi.fn()
    const source = makeSource({ status: 'broken', lastSyncStatus: 'error', lastSyncError: 'token expired' })
    render(
      <SourceRow source={source} onSync={noop} onTogglePause={noop} onDisconnect={noop} onReconnect={onReconnect} />,
    )
    expect(screen.getByText(/reconnect needed/i)).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: /^reconnect$/i })
    fireEvent.click(btn)
    expect(onReconnect).toHaveBeenCalledTimes(1)
    expect(onReconnect).toHaveBeenCalledWith(source)
  })

  it('renders no Reconnect button for a healthy source, even when the prop is supplied', () => {
    render(
      <SourceRow source={makeSource()} onSync={noop} onTogglePause={noop} onDisconnect={noop} onReconnect={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: /^reconnect$/i })).not.toBeInTheDocument()
  })

  it('renders no Reconnect button on a broken source when the caller supplies no handler', () => {
    renderRow(makeSource({ status: 'broken' }))
    expect(screen.queryByRole('button', { name: /^reconnect$/i })).not.toBeInTheDocument()
  })
})

// ── The dot and the label must not contradict each other ────────────────────
// Found by the 2026-09-04 observability audit. `freshnessTone` dots RED for
// `lastSyncStatus === 'error'`, but `freshnessLabel` had no branch for it —
// only for 'broken' and 'warning' — so every transient / rate-limited /
// unhandled TOTAL failure fell through to "synced 5 minutes ago" sitting next
// to a red dot. And a PARTIAL failure (status stays "ok", per-note errors in
// `lastSyncError`) showed a fully green dot over notes that never landed.
describe('SourceRow — the dot and the label agree', () => {
  it('does not say "synced" when the last sync actually failed', () => {
    renderRow(makeSource({ lastSyncStatus: 'error', lastSyncError: 'rate limited' }))
    expect(screen.queryByText(/^synced /)).not.toBeInTheDocument()
    expect(screen.getByText(/sync failed/i)).toBeInTheDocument()
  })

  it('does not report a clean sync when some notes did not land', () => {
    // status "ok" + error text is the engine's honest PARTIAL-failure shape.
    renderRow(makeSource({
      lastSyncStatus: 'ok',
      lastSyncError: 'note "Q3 planning" was too large to store',
    }))
    expect(screen.queryByText(/^synced [0-9]/)).not.toBeInTheDocument()
    expect(screen.getByText(/synced with problems/i)).toBeInTheDocument()
    expect(screen.getByText(/Q3 planning/)).toBeInTheDocument()
  })

  it('still reports an ordinary clean sync as simply synced', () => {
    renderRow(makeSource())
    expect(screen.getByText(/^synced /)).toBeInTheDocument()
    expect(screen.queryByText(/problems|failed/i)).not.toBeInTheDocument()
  })
})
