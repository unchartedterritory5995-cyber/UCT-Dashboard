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
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

// ── Task 6: Unchanged stat, pending line, sync notices, recent syncs ────────
const BUSY = 'A sync is already running for this source. Its results will appear here when it finishes.'

function renderWith(source, props = {}) {
  return render(
    <SourceRow
      source={source}
      providerLabel="Notion"
      onSync={noop}
      onTogglePause={noop}
      onDisconnect={noop}
      {...props}
    />,
  )
}

describe('SourceRow — Unchanged and pending removals', () => {
  it('shows Unchanged from notesSkipped', () => {
    renderWith(makeSource({ counts: { notesCreated: 1, notesUpdated: 0, notesSkipped: 7, conflicts: 0 } }))
    const label = screen.getByText('Unchanged')
    expect(label.previousSibling).toHaveTextContent('7')
    expect(label.parentElement).toHaveAttribute('title', 'Already up to date in your Notebook')
  })

  it("says a removal is pending confirmation, in the spec's words", () => {
    renderWith(makeSource({ pendingRemoval: 3 }))
    expect(screen.getByText('3 notes look removed in Notion; confirming on the next check.')).toBeInTheDocument()
  })

  it('singular pending copy', () => {
    renderWith(makeSource({ pendingRemoval: 1 }))
    expect(screen.getByText('1 note looks removed in Notion; confirming on the next check.')).toBeInTheDocument()
  })

  it('defaults the provider label', () => {
    render(<SourceRow source={makeSource({ pendingRemoval: 2 })} onSync={noop} onTogglePause={noop} onDisconnect={noop} />)
    expect(screen.getByText(/look removed in the source app;/)).toBeInTheDocument()
  })

  it('shows no pending line when none are pending', () => {
    renderWith(makeSource({ pendingRemoval: 0 }))
    expect(screen.queryByText(/look removed in|looks removed in/)).not.toBeInTheDocument()
  })
})

describe('SourceRow — what a Sync now press says', () => {
  const press = async () => {
    fireEvent.click(screen.getByRole('button', { name: /sync now/i }))
  }

  it('a busy press says a sync is already running', async () => {
    const onSync = vi.fn().mockRejectedValue({ status: 409, detail: BUSY })
    renderWith(makeSource(), { onSync })
    await press()
    expect(await screen.findByRole('status')).toHaveTextContent(BUSY)
  })

  it('a busy press never renders a non-string detail raw', async () => {
    const onSync = vi.fn().mockRejectedValue({ status: 409, detail: [{ msg: 'x' }] })
    renderWith(makeSource(), { onSync })
    await press()
    expect(await screen.findByRole('status')).toHaveTextContent(BUSY)
  })

  it('a non-409 failure is shown, not swallowed', async () => {
    const onSync = vi.fn().mockRejectedValue({ status: 503, detail: 'x' })
    renderWith(makeSource(), { onSync })
    await press()
    expect(await screen.findByRole('status')).toHaveTextContent('x')
  })

  it('a non-409 failure with no usable detail gets the generic line', async () => {
    const onSync = vi.fn().mockRejectedValue({ status: 503, detail: [{ msg: 'y' }] })
    renderWith(makeSource(), { onSync })
    await press()
    expect(await screen.findByRole('status')).toHaveTextContent('Sync failed. Try again shortly.')
  })

  it('a rate-limited press explains why removals were not checked', async () => {
    const next = '2026-11-01T15:30:00Z'
    const onSync = vi.fn().mockResolvedValue({
      status: 'ok',
      removalCheck: { ran: false, reason: 'rate_limited', pending: 0, severed: 0, nextAllowedAt: next },
    })
    renderWith(makeSource(), { onSync })
    await press()
    const t = new Date(next).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    const note = await screen.findByRole('status')
    expect(note).toHaveTextContent(
      `Removals were checked less than 10 minutes ago, so this sync brought in new and edited notes only. Press Sync now again after ${t} to check for removals.`,
    )
  })

  it('a rate-limited press with no nextAllowedAt still renders a sentence', async () => {
    const onSync = vi.fn().mockResolvedValue({
      status: 'ok',
      removalCheck: { ran: false, reason: 'rate_limited', pending: 0, severed: 0, nextAllowedAt: null },
    })
    renderWith(makeSource(), { onSync })
    await press()
    const note = await screen.findByRole('status')
    expect(note.textContent).not.toMatch(/Invalid|undefined|null/)
    expect(note).toHaveTextContent(/Removals were checked less than 10 minutes ago/)
  })

  it('refused and enumeration_failed say what happened', async () => {
    const onSync = vi.fn()
      // The server sends `ran: true` for a refusal: enumeration ran, the <50% guard refused.
      .mockResolvedValueOnce({ status: 'ok', removalCheck: { ran: true, reason: 'refused', pending: 0, severed: 0, nextAllowedAt: null } })
      .mockResolvedValueOnce({ status: 'ok', removalCheck: { ran: false, reason: 'enumeration_failed', pending: 0, severed: 0, nextAllowedAt: null } })
    renderWith(makeSource(), { onSync })
    await press()
    expect(await screen.findByRole('status')).toHaveTextContent(
      "Couldn't confirm removals this time: Notion returned far fewer notes than expected, so nothing was changed.",
    )
    await waitFor(() => expect(screen.getByRole('button', { name: /sync now/i })).not.toBeDisabled())
    await press()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      "Couldn't check Notion for removals this time. New and edited notes were still synced.",
    ))
  })

  it('a clean result clears the previous notice and adds none', async () => {
    const onSync = vi.fn()
      .mockRejectedValueOnce({ status: 409, detail: BUSY })
      .mockResolvedValueOnce({ status: 'ok', removalCheck: { ran: true, reason: null, pending: 0, severed: 0, nextAllowedAt: null } })
    renderWith(makeSource(), { onSync })
    await press()
    await screen.findByRole('status')
    await waitFor(() => expect(screen.getByRole('button', { name: /sync now/i })).not.toBeDisabled())
    await press()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })
})

describe('SourceRow — Recent syncs', () => {
  const ROW = {
    id: 1, at: '2026-11-01T12:00:00Z', status: 'ok', created: 2, updated: 1, skipped: 4, conflicts: 0,
    sourceDeleted: 0, failures: [{ noteTitle: 'Big note', name: 'big.png', reason: 'Too large to store (212 KB limit)' }],
    failuresUnreadable: false,
  }

  it('is hidden without onLoadLog or a first sync', () => {
    renderWith(makeSource())
    expect(screen.queryByRole('button', { name: /recent syncs/i })).not.toBeInTheDocument()
    renderWith(makeSource({ lastSyncAt: null }), { onLoadLog: vi.fn() })
    expect(screen.queryByRole('button', { name: /recent syncs/i })).not.toBeInTheDocument()
  })

  it('names how many items did not come over', () => {
    renderWith(makeSource({ lastFailureCount: 2 }), { onLoadLog: vi.fn() })
    expect(screen.getByRole('button', { name: /Recent syncs · 2 items didn't come over/ })).toBeInTheDocument()
  })

  it('an unreadable last sync keeps the Recent syncs path and says so', async () => {
    const onLoadLog = vi.fn().mockResolvedValue([{ ...ROW, failures: [], failuresUnreadable: true }])
    renderWith(makeSource({ lastSyncAt: null, lastFailureCount: 0, lastFailuresUnreadable: true }), { onLoadLog })
    const btn = screen.getByRole('button', { name: /Recent syncs · details of the last sync couldn't be read/ })
    fireEvent.click(btn)
    expect(await screen.findByText("Details for this sync couldn't be read.")).toBeInTheDocument()
  })

  it('singular item label', () => {
    renderWith(makeSource({ lastFailureCount: 1 }), { onLoadLog: vi.fn() })
    expect(screen.getByRole('button', { name: /Recent syncs · 1 item didn't come over/ })).toBeInTheDocument()
  })

  it('recent syncs list what did not come over, verbatim', async () => {
    const onLoadLog = vi.fn().mockResolvedValue([{ ...ROW, conflicts: 2, sourceDeleted: 1 }])
    renderWith(makeSource(), { onLoadLog })
    const btn = screen.getByRole('button', { name: /^recent syncs/i })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText(/2 new, 1 updated, 4 unchanged, 2 conflicts, 1 removed/)).toBeInTheDocument()
    expect(screen.getByText('Big note: big.png, Too large to store (212 KB limit)')).toBeInTheDocument()
  })

  it('omits the name segment and zero conflicts/removed', async () => {
    const onLoadLog = vi.fn().mockResolvedValue([{ ...ROW, failures: [{ noteTitle: 'N', name: '', reason: 'bad' }] }])
    renderWith(makeSource(), { onLoadLog })
    fireEvent.click(screen.getByRole('button', { name: /^recent syncs/i }))
    expect(await screen.findByText('N: bad')).toBeInTheDocument()
    expect(screen.queryByText(/conflicts|removed/)).not.toBeInTheDocument()
  })

  it('recent syncs never reads as "nothing failed" when details were unreadable', async () => {
    const onLoadLog = vi.fn().mockResolvedValue([{ ...ROW, failures: [], failuresUnreadable: true }])
    renderWith(makeSource(), { onLoadLog })
    fireEvent.click(screen.getByRole('button', { name: /^recent syncs/i }))
    expect(await screen.findByText("Details for this sync couldn't be read.")).toBeInTheDocument()
  })

  it('loads the log once, on first expand', async () => {
    const onLoadLog = vi.fn().mockResolvedValue([ROW])
    renderWith(makeSource(), { onLoadLog })
    const btn = screen.getByRole('button', { name: /^recent syncs/i })
    expect(onLoadLog).not.toHaveBeenCalled()
    fireEvent.click(btn)
    await screen.findByText(/4 unchanged/)
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(onLoadLog).toHaveBeenCalledTimes(1)
    expect(onLoadLog).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }))
  })

  it('a rejected load shows its message and Try again reloads', async () => {
    const onLoadLog = vi.fn()
      .mockRejectedValueOnce(new Error('Could not load recent syncs.'))
      .mockResolvedValueOnce([ROW])
    renderWith(makeSource(), { onLoadLog })
    fireEvent.click(screen.getByRole('button', { name: /^recent syncs/i }))
    expect(await screen.findByText('Could not load recent syncs.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText(/4 unchanged/)).toBeInTheDocument()
    expect(onLoadLog).toHaveBeenCalledTimes(2)
  })
})

describe('SourceRow — Recent syncs after a run (fix round 1)', () => {
  const OLD = { id: 1, at: '2026-11-01T12:00:00Z', status: 'ok', created: 1, updated: 0, skipped: 0, conflicts: 0, sourceDeleted: 0, failures: [], failuresUnreadable: false }
  const NEW = { ...OLD, id: 2, created: 9, skipped: 3 }

  it('with the log open, a completed sync reloads it and shows the new row', async () => {
    const onLoadLog = vi.fn().mockResolvedValueOnce([OLD]).mockResolvedValueOnce([NEW, OLD])
    const onSync = vi.fn().mockResolvedValue({ status: 'ok', removalCheck: null })
    renderWith(makeSource(), { onLoadLog, onSync })
    fireEvent.click(screen.getByRole('button', { name: /^recent syncs/i }))
    await screen.findByText(/1 new, 0 updated, 0 unchanged/)
    fireEvent.click(screen.getByRole('button', { name: /sync now/i }))
    expect(await screen.findByText(/9 new, 0 updated, 3 unchanged/)).toBeInTheDocument()
    expect(onLoadLog).toHaveBeenCalledTimes(2)
  })

  it('a sync while closed makes the next expand load fresh rows', async () => {
    const onLoadLog = vi.fn().mockResolvedValueOnce([OLD]).mockResolvedValueOnce([NEW])
    const onSync = vi.fn().mockResolvedValue({ status: 'ok', removalCheck: null })
    renderWith(makeSource(), { onLoadLog, onSync })
    const btn = screen.getByRole('button', { name: /^recent syncs/i })
    fireEvent.click(btn)
    await screen.findByText(/1 new/)
    fireEvent.click(btn)
    fireEvent.click(screen.getByRole('button', { name: /sync now/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /sync now/i })).not.toBeDisabled())
    expect(onLoadLog).toHaveBeenCalledTimes(1)
    fireEvent.click(btn)
    expect(await screen.findByText(/9 new/)).toBeInTheDocument()
  })

  it('a changed lastSyncAt (background run) reloads an open log', async () => {
    const onLoadLog = vi.fn().mockResolvedValueOnce([OLD]).mockResolvedValueOnce([NEW])
    const { rerender } = renderWith(makeSource(), { onLoadLog })
    fireEvent.click(screen.getByRole('button', { name: /^recent syncs/i }))
    await screen.findByText(/1 new/)
    rerender(
      <SourceRow source={makeSource({ lastSyncAt: '2026-09-02T12:05:00Z' })} providerLabel="Notion" onLoadLog={onLoadLog} onSync={noop} onTogglePause={noop} onDisconnect={noop} />,
    )
    expect(await screen.findByText(/9 new/)).toBeInTheDocument()
  })

  it('a source whose every sync failed can still open its failure details', async () => {
    const onLoadLog = vi.fn().mockResolvedValue([{ ...OLD, failures: [{ noteTitle: 'T', name: '', reason: 'nope' }] }])
    renderWith(makeSource({ lastSyncAt: null, lastFailureCount: 1 }), { onLoadLog })
    fireEvent.click(screen.getByRole('button', { name: /Recent syncs · 1 item didn't come over/ }))
    expect(await screen.findByText('T: nope')).toBeInTheDocument()
  })
})

describe('SourceRow — Obsidian plugin update hint', () => {
  it('tells a member on an old Obsidian plugin that updating brings images', () => {
    renderRow(makeSource({ provider: 'obsidian', pluginVersion: null, pluginSupportsAttachments: false }))
    expect(screen.getByText(/Update UCT Notebook Sync in Obsidian to bring images and files over/)).toBeInTheDocument()
    expect(screen.getByText(/Settings, Community plugins, Check for updates/)).toBeInTheDocument()
  })

  it('shows no update hint for 0.2.0+, for other providers, or when the server sent no field', () => {
    const hint = /Update UCT Notebook Sync/
    const { unmount: u1 } = renderRow(makeSource({ provider: 'obsidian', pluginVersion: '0.2.0', pluginSupportsAttachments: true }))
    expect(screen.queryByText(hint)).toBeNull()
    u1()
    const { unmount: u2 } = renderRow(makeSource({ provider: 'notion', pluginSupportsAttachments: false }))
    expect(screen.queryByText(hint)).toBeNull()
    u2()
    renderRow(makeSource({ provider: 'obsidian', pluginSupportsAttachments: null }))
    expect(screen.queryByText(hint)).toBeNull()
  })
})
