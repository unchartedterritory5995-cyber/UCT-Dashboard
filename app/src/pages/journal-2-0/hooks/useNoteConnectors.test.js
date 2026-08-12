import { describe, it, expect } from 'vitest'
import { normalizeStatus, normalizeFolders, NOTE_CONNECTOR_PROVIDERS } from './useNoteConnectors'

describe('normalizeStatus — the field-name contract (fix-round 1 finding #2, corrected by Task 12b)', () => {
  it('always returns all four wave-1 provider keys, even from an empty/undefined payload', () => {
    for (const raw of [undefined, null, {}, { providers: {} }]) {
      const out = normalizeStatus(raw)
      expect(Object.keys(out.providers).sort()).toEqual(['craft', 'dropbox', 'notion', 'roam'])
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
            counts: { notesCreated: 5, notesUpdated: 2, notesSkipped: 1, mediaUploaded: 4, conflicts: 0 },
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
        lastSyncStatus: 'ok', lastSyncError: null, warmingUntil: null,
        counts: { notesCreated: 5, notesUpdated: 2, notesSkipped: 1, mediaUploaded: 4, conflicts: 0 },
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
            counts: { notes_created: 9, notes_updated: 0, notes_skipped: 2, media_uploaded: 1, conflicts: 4 },
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
        lastSyncStatus: 'error', lastSyncError: 'token expired', warmingUntil: null,
        counts: { notesCreated: 9, notesUpdated: 0, notesSkipped: 2, mediaUploaded: 1, conflicts: 4 },
      }],
    })
  })

  // Task 12b: read the shipped router (`api/routers/note_sync.py`, commit
  // 20f0e828c) instead of guessing further — `"connected": connector is not
  // None` is CONNECTOR-level and computed independently of `sources`. The
  // Dropbox OAuth callback deliberately creates the connector WITHOUT a
  // source ("Dropbox needs a FOLDER before a source can exist"), so
  // connected:true + zero sources is a real, intended state — the exact
  // state the original `sources.length > 0` guess made unreachable.
  it('`connected` is read directly off the raw payload — NEVER re-derived from sources.length', () => {
    const connectedNoSources = normalizeStatus({
      providers: { dropbox: { configured: true, connected: true, sources: [] } },
    })
    expect(connectedNoSources.providers.dropbox.connected).toBe(true)
    expect(connectedNoSources.providers.dropbox.sources).toHaveLength(0)

    const notConnectedWithGarbageSources = normalizeStatus({
      providers: { dropbox: { configured: true, connected: false, sources: [{ id: 'x', provider: 'dropbox' }] } },
    })
    // Pathological/inconsistent raw payload — normalizeStatus must still
    // trust the `connected` flag the router sent, not infer from sources.
    expect(notConnectedWithGarbageSources.providers.dropbox.connected).toBe(false)
  })

  it('a missing provider key in the raw payload still yields a safe not-configured, not-connected entry (no crash)', () => {
    const out = normalizeStatus({ providers: { roam: { configured: true, connected: true, sources: [] } } })
    expect(out.providers.dropbox).toEqual({
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

describe('normalizeFolders — the Dropbox folder-picker contract (Task 12b)', () => {
  it('translates GET /{provider}/folders\' {folders:[{path_lower,name}]} into camelCase', () => {
    const out = normalizeFolders({
      folders: [
        { path_lower: '/team notes', name: 'Team Notes' },
        { path_lower: '/journal', name: 'Journal' },
      ],
    })
    expect(out).toEqual([
      { pathLower: '/team notes', name: 'Team Notes' },
      { pathLower: '/journal', name: 'Journal' },
    ])
  })

  it('returns an empty array for a missing/empty payload rather than crashing', () => {
    expect(normalizeFolders(undefined)).toEqual([])
    expect(normalizeFolders({})).toEqual([])
    expect(normalizeFolders({ folders: [] })).toEqual([])
  })

  it('drops null/garbage entries', () => {
    const out = normalizeFolders({ folders: [null, { path_lower: '/x', name: 'X' }] })
    expect(out).toEqual([{ pathLower: '/x', name: 'X' }])
  })
})
