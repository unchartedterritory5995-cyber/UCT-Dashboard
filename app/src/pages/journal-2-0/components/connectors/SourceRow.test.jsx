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
import { render, screen } from '@testing-library/react'
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

  it('still reports a hard failure as a failure, not a warning', () => {
    renderRow(makeSource({ lastSyncStatus: 'error', lastSyncError: 'token expired' }))
    expect(screen.getByText(/token expired/)).toBeInTheDocument()
    expect(screen.queryByText(/finished with problems/i)).not.toBeInTheDocument()
  })
})
