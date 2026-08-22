import { describe, it, expect } from 'vitest'
import {
  normalizeStatus, normalizeFolders, NOTE_CONNECTOR_PROVIDERS, FOLDER_PICKER_PROVIDERS,
  FOLDER_PICKER_ROOT_REMOTE_ID,
} from './useNoteConnectors'

describe('normalizeStatus — the field-name contract (fix-round 1 finding #2, corrected by Task 12b, widened to msgraph in Task 7)', () => {
  it('always returns all six provider keys, even from an empty/undefined payload', () => {
    for (const raw of [undefined, null, {}, { providers: {} }]) {
      const out = normalizeStatus(raw)
      expect(Object.keys(out.providers).sort()).toEqual(['craft', 'dropbox', 'notion', 'onedrive', 'onenote', 'roam'])
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

describe('FOLDER_PICKER_PROVIDERS (Task 7: widened from dropbox-only to {dropbox, onedrive})', () => {
  it('contains dropbox and onedrive, and nothing else', () => {
    expect(FOLDER_PICKER_PROVIDERS.has('dropbox')).toBe(true)
    expect(FOLDER_PICKER_PROVIDERS.has('onedrive')).toBe(true)
    expect(FOLDER_PICKER_PROVIDERS.size).toBe(2)
  })

  it('excludes onenote — whole-account, never a folder-picker provider', () => {
    expect(FOLDER_PICKER_PROVIDERS.has('onenote')).toBe(false)
  })

  it('excludes the token providers and notion', () => {
    expect(FOLDER_PICKER_PROVIDERS.has('roam')).toBe(false)
    expect(FOLDER_PICKER_PROVIDERS.has('craft')).toBe(false)
    expect(FOLDER_PICKER_PROVIDERS.has('notion')).toBe(false)
  })
})

describe('FOLDER_PICKER_ROOT_REMOTE_ID (fix-round item #2: the "sync whole account" root affordance)', () => {
  it('gives Dropbox its own "/" root sentinel — safe end-to-end (Dropbox\'s own API + provider already treat "/" as root)', () => {
    expect(FOLDER_PICKER_ROOT_REMOTE_ID.dropbox).toBe('/')
  })

  it('has NO onedrive entry — OneDrive\'s whole-drive delta is a different, unwired Graph endpoint, so the UI requires drilling to a real folder instead', () => {
    expect(FOLDER_PICKER_ROOT_REMOTE_ID.onedrive).toBeUndefined()
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

describe('normalizeFolders — the provider-neutral folder contract (Task 12b, fixed in the fix-round: dropbox+onedrive disagreed on the raw key)', () => {
  it('translates Dropbox\'s {folders:[{path_lower,name}]} into {name,remoteId,drillPath}, both keyed off path_lower', () => {
    const out = normalizeFolders({
      folders: [
        { path_lower: '/team notes', name: 'Team Notes' },
        { path_lower: '/journal', name: 'Journal' },
      ],
    })
    expect(out).toEqual([
      { name: 'Team Notes', remoteId: '/team notes', drillPath: '/team notes' },
      { name: 'Journal', remoteId: '/journal', drillPath: '/journal' },
    ])
  })

  it('translates OneDrive\'s {folders:[{id,name}]} into {name,remoteId,drillPath}, both keyed off id — NEVER an empty pathLower fallback', () => {
    // This is the exact shape the fix-round CRITICAL bug was found in: the
    // old normalizeFolder only ever read pathLower/path_lower, so every
    // OneDrive folder (which carries `id`, never `path_lower`) normalized
    // to `pathLower: ''` -- every row collapsed to the SAME empty key.
    const out = normalizeFolders({
      folders: [
        { id: 'item-1', name: 'Trading Notes' },
        { id: 'item-2', name: 'Journal' },
      ],
    })
    expect(out).toEqual([
      { name: 'Trading Notes', remoteId: 'item-1', drillPath: 'item-1' },
      { name: 'Journal', remoteId: 'item-2', drillPath: 'item-2' },
    ])
    // Never the old, broken fallback.
    expect(out.some((f) => f.remoteId === '')).toBe(false)
  })

  it('returns an empty array for a missing/empty payload rather than crashing', () => {
    expect(normalizeFolders(undefined)).toEqual([])
    expect(normalizeFolders({})).toEqual([])
    expect(normalizeFolders({ folders: [] })).toEqual([])
  })

  it('drops null/garbage entries', () => {
    const out = normalizeFolders({ folders: [null, { path_lower: '/x', name: 'X' }] })
    expect(out).toEqual([{ name: 'X', remoteId: '/x', drillPath: '/x' }])
  })
})
