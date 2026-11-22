import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { SWRConfig } from 'swr'
import React from 'react'
import useNoteConnectors, {
  normalizeSyncResult, normalizeLogRows, normalizeSource, BUSY_DETAIL,
  normalizeStatus, NOTE_CONNECTOR_PROVIDERS,
} from './useNoteConnectors'

describe('normalizeStatus — obsidianAttachments (final review I3)', () => {
  it('is true only for an explicit true from the server, either casing', () => {
    expect(normalizeStatus({ obsidianAttachments: true }).obsidianAttachments).toBe(true)
    expect(normalizeStatus({ obsidian_attachments: true }).obsidianAttachments).toBe(true)
    for (const raw of [undefined, null, {}, { obsidianAttachments: false }, { obsidianAttachments: 'true' }]) {
      expect(normalizeStatus(raw).obsidianAttachments).toBe(false)
    }
  })
})

describe('normalizeStatus — the field-name contract (fix-round 1 finding #2, corrected by Task 12b, widened to msgraph in Task 7)', () => {
  it('always returns every registered provider key, even from an empty/undefined payload', () => {
    for (const raw of [undefined, null, {}, { providers: {} }]) {
      const out = normalizeStatus(raw)
      // Derived from the registry list itself, never a retyped copy: the retyped list went
      // stale the day Evernote joined it (8 providers, 7 typed here).
      expect(Object.keys(out.providers).sort()).toEqual(
        NOTE_CONNECTOR_PROVIDERS.map((p) => p.key).sort()
      )
      expect(Object.keys(out.providers)).toContain('evernote')
      for (const p of NOTE_CONNECTOR_PROVIDERS) {
        expect(out.providers[p.key]).toEqual({
          configured: false, connected: false, connectKind: null, accountLabel: null, status: null, sources: [],
        })
      }
    }
  })

  it('normalizes camelCase raw fields (this task-authored contract) unchanged', () => {
    const raw = {
      providers: {
        roam: {
          configured: true,
          connected: true,
          connectKind: 'token',
          accountLabel: 'My Graph',
          status: 'active',
          sources: [{
            id: 's1', provider: 'roam', displayName: 'My Graph', remoteId: 'my-graph',
            syncEnabled: true, status: 'active', lastSyncAt: '2026-08-01T00:00:00Z',
            lastSyncStatus: 'ok', lastSyncError: null, warmingUntil: null,
            counts: {
              notesCreated: 5, notesUpdated: 2, notesSkipped: 1, mediaUploaded: 4,
              conflicts: 0, sourceDeleted: 6,
            },
          }],
        },
      },
    }
    const out = normalizeStatus(raw)
    expect(out.providers.roam).toEqual({
      configured: true,
      connected: true,
      connectKind: 'token',
      accountLabel: 'My Graph',
      status: 'active',
      sources: [{
        id: 's1', provider: 'roam', displayName: 'My Graph', remoteId: 'my-graph',
        syncEnabled: true, status: 'active', lastSyncAt: '2026-08-01T00:00:00Z',
        lastSyncStatus: 'ok', lastSyncError: null, warmingUntil: null, syncing: false, queued: false,
        pendingRemoval: 0, lastFailureCount: 0, lastFailuresUnreadable: false,
        pluginVersion: null, pluginSupportsAttachments: null,
        counts: {
          notesCreated: 5, notesUpdated: 2, notesSkipped: 1, mediaUploaded: 4,
          conflicts: 0, sourceDeleted: 6,
        },
      }],
    })
  })

  it('normalizes snake_case raw fields (spec §8 itself writes redirect_url snake_case) to the same shape', () => {
    const raw = {
      providers: {
        craft: {
          is_configured: true,
          connected: true,
          connect_kind: 'token',
          account_label: 'My Space',
          sources: [{
            id: 's2', provider: 'craft', display_name: 'My Space', remote_id: 'link-1',
            sync_enabled: false, status: 'broken', last_sync_at: '2026-08-02T00:00:00Z',
            last_sync_status: 'error', last_sync_error: 'token expired', warming_until: null,
            counts: {
              notes_created: 9, notes_updated: 0, notes_skipped: 2, media_uploaded: 1,
              conflicts: 4, source_deleted: 7,
            },
          }],
        },
      },
    }
    const out = normalizeStatus(raw)
    expect(out.providers.craft).toEqual({
      configured: true,
      connected: true,
      connectKind: 'token',
      accountLabel: 'My Space',
      status: null,
      sources: [{
        id: 's2', provider: 'craft', displayName: 'My Space', remoteId: 'link-1',
        syncEnabled: false, status: 'broken', lastSyncAt: '2026-08-02T00:00:00Z',
        lastSyncStatus: 'error', lastSyncError: 'token expired', warmingUntil: null, syncing: false, queued: false,
        pendingRemoval: 0, lastFailureCount: 0, lastFailuresUnreadable: false,
        pluginVersion: null, pluginSupportsAttachments: null,
        counts: {
          notesCreated: 9, notesUpdated: 0, notesSkipped: 2, mediaUploaded: 1,
          conflicts: 4, sourceDeleted: 7,
        },
      }],
    })
  })

  // Task 12b: read the shipped router (`api/routers/note_sync.py`, commit
  // 20f0e828c) instead of guessing further — `"connected": connector is not
  // None` is CONNECTOR-level and computed independently of `sources`, so
  // connected:true + zero sources stays a representable state (it was the
  // folder-picker providers' normal state until they were archived).
  it('`connected` is read directly off the raw payload — NEVER re-derived from sources.length', () => {
    const connectedNoSources = normalizeStatus({
      providers: { notion: { configured: true, connected: true, sources: [] } },
    })
    expect(connectedNoSources.providers.notion.connected).toBe(true)
    expect(connectedNoSources.providers.notion.sources).toHaveLength(0)

    const notConnectedWithGarbageSources = normalizeStatus({
      providers: { notion: { configured: true, connected: false, sources: [{ id: 'x', provider: 'notion' }] } },
    })
    // Pathological/inconsistent raw payload — normalizeStatus must still
    // trust the `connected` flag the router sent, not infer from sources.
    expect(notConnectedWithGarbageSources.providers.notion.connected).toBe(false)
  })

  it('drops a provider key the roster does not name (Dropbox, OneNote, OneDrive: archived 2026-11-04)', () => {
    const out = normalizeStatus({
      providers: Object.fromEntries(['dropbox', 'onenote', 'onedrive'].map((k) => [
        k, { configured: true, connected: true, sources: [] }])),
    })
    for (const gone of ['dropbox', 'onenote', 'onedrive']) {
      expect(out.providers[gone]).toBeUndefined()
      expect(NOTE_CONNECTOR_PROVIDERS.some((p) => p.key === gone)).toBe(false)
    }
  })

  it('a missing provider key in the raw payload still yields a safe not-configured, not-connected entry (no crash)', () => {
    const out = normalizeStatus({ providers: { roam: { configured: true, connected: true, sources: [] } } })
    expect(out.providers.notion).toEqual({
      configured: false, connected: false, connectKind: null, accountLabel: null, status: null, sources: [],
    })
  })

  it('a null/garbage source entry is dropped rather than crashing downstream renderers', () => {
    const out = normalizeStatus({
      providers: { roam: { configured: true, connected: true, sources: [null, undefined, { id: 'ok', provider: 'roam' }] } },
    })
    expect(out.providers.roam.sources).toHaveLength(1)
    expect(out.providers.roam.sources[0].id).toBe('ok')
  })
})

describe('normalizeStatus — enabled (final-review Item B: status.enabled had no consumer)', () => {
  it('defaults to true when the raw payload omits `enabled` or is itself absent — a missing/loading payload must never falsely trip the "sync is paused" notice', () => {
    for (const raw of [undefined, null, {}, { providers: {} }]) {
      expect(normalizeStatus(raw).enabled).toBe(true)
    }
  })

  it('reads an explicit `enabled: false` through unchanged', () => {
    expect(normalizeStatus({ enabled: false, providers: {} }).enabled).toBe(false)
  })

  it('reads an explicit `enabled: true` through unchanged', () => {
    expect(normalizeStatus({ enabled: true, providers: {} }).enabled).toBe(true)
  })
})

describe('Task 5: Sync now result, log rows, source counters', () => {
  it('normalizeSyncResult keeps a rate-limited check as a stated outcome', () => {
    expect(normalizeSyncResult({ status: 'ok', removalCheck: { ran: false, reason: 'rate_limited', nextAllowedAt: 'x', pending: 1, severed: 0 } }).removalCheck)
      .toEqual({ ran: false, reason: 'rate_limited', nextAllowedAt: 'x', pending: 1, severed: 0 })
    expect(normalizeSyncResult({ status: 'ok' }).removalCheck).toBeNull()
    expect(normalizeSyncResult({ status: 'ok', removalCheck: { ran: false, reason: 'refused', nextAllowedAt: null, pending: 0, severed: 0 } }).removalCheck.nextAllowedAt).toBeNull()
    expect(normalizeSyncResult(null)).toEqual({ status: 'unknown', removalCheck: null })
  })

  it('normalizeLogRows fills defaults and keeps failuresUnreadable', () => {
    expect(normalizeLogRows(undefined)).toEqual([])
    expect(normalizeLogRows({ rows: 'nope' })).toEqual([])
    const [a, b] = normalizeLogRows({ rows: [
      { id: 1, at: 't', status: 'ok', created: 2, failures: [{ noteTitle: 'N', reason: 'r', name: 'n' }] },
      { id: 2, failuresUnreadable: true },
    ] })
    expect(a).toEqual({ id: 1, at: 't', status: 'ok', created: 2, updated: 0, skipped: 0, conflicts: 0, sourceDeleted: 0,
      failures: [{ noteTitle: 'N', reason: 'r', name: 'n' }], failuresUnreadable: false })
    expect(b.failures).toEqual([])
    expect(b.failuresUnreadable).toBe(true)
    expect(b.created).toBe(0)
  })

  it('normalizeSource reads pendingRemoval and lastFailureCount, defaulting to 0', () => {
    expect(normalizeSource({ id: 'a', pendingRemoval: 3, lastFailureCount: 2 })).toMatchObject({ pendingRemoval: 3, lastFailureCount: 2 })
    expect(normalizeSource({ id: 'a', pending_removal: 4, last_failure_count: 1 })).toMatchObject({ pendingRemoval: 4, lastFailureCount: 1 })
    expect(normalizeSource({ id: 'a' })).toMatchObject({ pendingRemoval: 0, lastFailureCount: 0 })
  })

  it('normalizeSource keeps an unreadable failure count as unreadable, never as "none"', () => {
    expect(normalizeSource({ id: 'a', lastFailureCount: null, lastFailuresUnreadable: true }))
      .toMatchObject({ lastFailureCount: 0, lastFailuresUnreadable: true })
    expect(normalizeSource({ id: 'a', last_failure_count: null, last_failures_unreadable: true }))
      .toMatchObject({ lastFailuresUnreadable: true })
    expect(normalizeSource({ id: 'a' })).toMatchObject({ lastFailuresUnreadable: false })
  })

  it('normalizeSource reads the plugin fields, null when the server predates them', () => {
    expect(normalizeSource({ id: 'a', pluginVersion: '0.1.4', pluginSupportsAttachments: false }))
      .toMatchObject({ pluginVersion: '0.1.4', pluginSupportsAttachments: false })
    expect(normalizeSource({ id: 'a', plugin_version: '0.2.0', plugin_supports_attachments: true }))
      .toMatchObject({ pluginVersion: '0.2.0', pluginSupportsAttachments: true })
    expect(normalizeSource({ id: 'a' })).toMatchObject({ pluginVersion: null, pluginSupportsAttachments: null })
  })
})

describe('Task 5: hook fetches', () => {
  const wrapper = ({ children }) =>
    React.createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children)
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body })
  const unreadable = { ok: true, status: 200, json: async () => { throw new Error('bad') } }
  let calls
  beforeEach(() => { calls = [] })
  afterEach(() => { vi.unstubAllGlobals() })
  const stub = (handler) => vi.stubGlobal('fetch', vi.fn(async (url, init) => { calls.push([String(url), init]); return handler(String(url)) }))

  it('Sync now always asks for the removal check', async () => {
    stub((u) => (u.includes('/sync') ? json(200, { status: 'ok', removalCheck: { ran: true, reason: null, nextAllowedAt: null, pending: 0, severed: 1 } }) : json(200, {})))
    const { result } = renderHook(() => useNoteConnectors(), { wrapper })
    const out = await result.current.syncSource('s1')
    expect(calls.find((c) => c[0].includes('/sync'))[0]).toMatch(/\/sources\/s1\/sync\?full=1$/)
    expect(out.removalCheck.severed).toBe(1)
    await result.current.syncSource('s1', { background: true })
    expect(calls.filter((c) => c[0].includes('/sync')).pop()[0]).toMatch(/\?full=1&background=1$/)
  })

  it('a busy source rejects with status 409 and the exact detail', async () => {
    stub((u) => (u.includes('/sync') ? json(409, { detail: BUSY_DETAIL }) : json(200, {})))
    const { result } = renderHook(() => useNoteConnectors(), { wrapper })
    await expect(result.current.syncSource('s1')).rejects.toMatchObject({ status: 409, detail: BUSY_DETAIL })
  })

  it('an unreadable success body is unknown, not a crash', async () => {
    stub((u) => (u.includes('/sync') ? unreadable : json(200, {})))
    const { result } = renderHook(() => useNoteConnectors(), { wrapper })
    expect(await result.current.syncSource('s1')).toEqual({ status: 'unknown', removalCheck: null })
  })

  it('getSourceLog rejects on an unreadable body instead of resolving []', async () => {
    stub((u) => (u.includes('/log') ? unreadable : json(200, {})))
    const { result } = renderHook(() => useNoteConnectors(), { wrapper })
    await expect(result.current.getSourceLog('s1')).rejects.toThrow('Could not read recent syncs.')
  })

  it('getSourceLog throws on a non-ok response and returns normalized rows on ok', async () => {
    stub((u) => (u.includes('/log') ? json(500, {}) : json(200, {})))
    let h = renderHook(() => useNoteConnectors(), { wrapper })
    await expect(h.result.current.getSourceLog('s1')).rejects.toThrow('Could not load recent syncs.')
    stub((u) => (u.includes('/log') ? json(200, { rows: [{ id: 1, created: 3 }] }) : json(200, {})))
    h = renderHook(() => useNoteConnectors(), { wrapper })
    const rows = await h.result.current.getSourceLog('s1', { limit: 2 })
    expect(rows[0].created).toBe(3)
    expect(calls.pop()[0]).toMatch(/\/sources\/s1\/log\?limit=2$/)
  })
})

// ── Evernote rate-limit fix round 1 (I3) ────────────────────────────────────
import { connectorsRefreshInterval, STATUS_SWR_OPTIONS } from './useNoteConnectors'

describe('the /status poll is wired (fix round 1, I3)', () => {
  it('passes connectorsRefreshInterval to SWR', () => {
    expect(STATUS_SWR_OPTIONS.refreshInterval).toBe(connectorsRefreshInterval)
  })
})

describe('normalizeSource — syncing (fix round 1, I3)', () => {
  it('reads the server flag in either casing, defaulting to false', () => {
    expect(normalizeSource({ id: 's', syncing: true }).syncing).toBe(true)
    expect(normalizeSource({ id: 's', syncing: false }).syncing).toBe(false)
    expect(normalizeSource({ id: 's' }).syncing).toBe(false)
  })
})

describe('normalizeSource — queued (D4-2: a pass waiting for a shared pass slot)', () => {
  it('reads the server flag, defaulting to false', () => {
    expect(normalizeSource({ id: 's', queued: true }).queued).toBe(true)
    expect(normalizeSource({ id: 's' }).queued).toBe(false)
  })
  it('polls while a source is queued', () => {
    expect(connectorsRefreshInterval({ providers: { evernote: { sources: [{ id: 'a', queued: true }] } } })).toBe(10000)
  })
})

describe('connectorsRefreshInterval — poll only while something is in progress (fix round 1, I3)', () => {
  const status = (sources) => ({ providers: { evernote: { sources } } })
  it('polls while a source is syncing or still importing', () => {
    expect(connectorsRefreshInterval(status([{ id: 'a', syncing: true }]))).toBe(10000)
    expect(connectorsRefreshInterval(status([{ id: 'a', lastSyncStatus: 'importing' }]))).toBe(10000)
    expect(connectorsRefreshInterval(status([{ id: 'a', last_sync_status: 'importing' }]))).toBe(10000)
  })
  it('does not poll a settled page, or before data arrives', () => {
    expect(connectorsRefreshInterval(status([{ id: 'a', lastSyncStatus: 'ok' }]))).toBe(0)
    expect(connectorsRefreshInterval(undefined)).toBe(0)
    expect(connectorsRefreshInterval({ providers: { evernote: null } })).toBe(0)
  })
})
