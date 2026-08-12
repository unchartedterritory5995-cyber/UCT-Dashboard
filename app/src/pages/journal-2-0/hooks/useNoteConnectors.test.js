import { describe, it, expect } from 'vitest'
import { normalizeStatus, NOTE_CONNECTOR_PROVIDERS } from './useNoteConnectors'

describe('normalizeStatus — the field-name contract (fix-round 1, finding #2)', () => {
  it('always returns all four wave-1 provider keys, even from an empty/undefined payload', () => {
    for (const raw of [undefined, null, {}, { providers: {} }]) {
      const out = normalizeStatus(raw)
      expect(Object.keys(out.providers).sort()).toEqual(['craft', 'dropbox', 'notion', 'roam'])
      for (const p of NOTE_CONNECTOR_PROVIDERS) {
        expect(out.providers[p.key]).toEqual({ configured: false, sources: [], connected: false })
      }
    }
  })

  it('normalizes camelCase raw fields (this task-authored contract) unchanged', () => {
    const raw = {
      providers: {
        roam: {
          configured: true,
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
      sources: [{
        id: 's2', provider: 'craft', displayName: 'My Space', remoteId: 'link-1',
        syncEnabled: false, status: 'broken', lastSyncAt: '2026-08-02T00:00:00Z',
        lastSyncStatus: 'error', lastSyncError: 'token expired', warmingUntil: null,
        counts: { notesCreated: 9, notesUpdated: 0, notesSkipped: 2, mediaUploaded: 1, conflicts: 4 },
      }],
    })
  })

  it('computes `connected` ONCE from sources.length here — never left for a consumer to re-derive', () => {
    const zeroSources = normalizeStatus({ providers: { notion: { configured: true, sources: [] } } })
    expect(zeroSources.providers.notion.connected).toBe(false)

    const oneSource = normalizeStatus({
      providers: { notion: { configured: true, sources: [{ id: 'x', provider: 'notion' }] } },
    })
    expect(oneSource.providers.notion.connected).toBe(true)
  })

  it('a missing provider key in the raw payload still yields a safe not-configured entry (no crash)', () => {
    const out = normalizeStatus({ providers: { roam: { configured: true, sources: [] } } })
    expect(out.providers.dropbox).toEqual({ configured: false, sources: [], connected: false })
  })

  it('a null/garbage source entry is dropped rather than crashing downstream renderers', () => {
    const out = normalizeStatus({
      providers: { roam: { configured: true, sources: [null, undefined, { id: 'ok', provider: 'roam' }] } },
    })
    expect(out.providers.roam.sources).toHaveLength(1)
    expect(out.providers.roam.sources[0].id).toBe('ok')
  })
})
