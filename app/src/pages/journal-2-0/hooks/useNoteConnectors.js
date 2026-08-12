/**
 * Journal 2.0 — Note Connectors (Task 12).
 *
 * SWR status fetch + action helpers over the note-connectors router
 * (spec docs/superpowers/specs/2026-08-11-note-connectors-design.md §8):
 *
 *   GET    /api/j2/notes/connectors/status                — providers configured/connected + per-source freshness
 *   POST   /api/j2/notes/connectors/{provider}/connect     — token payload (roam/craft) OR {consent:true} to start OAuth (notion/dropbox) -> {redirectUrl}
 *   GET    /api/j2/notes/connectors/{provider}/callback    — OAuth return (backend-owned; the browser never calls this directly)
 *   POST   /api/j2/notes/connectors/sources/{id}/sync      — manual sync, background=1 supported
 *   PUT    /api/j2/notes/connectors/sources/{id}           — sync_enabled / dest folder
 *   DELETE /api/j2/notes/connectors/{provider}             — disconnect (keeps notes, severs the source links)
 *
 * The backend router is being built in a parallel task — this hook binds to
 * the endpoint PATHS the spec commits to; the exact JSON field names below
 * are this task's own reasonable contract (documented in the task report)
 * since §8 only describes the shape in prose.
 *
 * **Field-name contract lives HERE, and only here** (fix-round 1, finding
 * #2). `normalizeStatus(raw)` is the single translation layer between
 * whatever `GET /status` actually returns (camelCase today; the spec itself
 * writes `redirect_url` snake_case for the connect response, so the real
 * router may not match) and the stable shape every consumer component reads:
 * `providers[key] = { configured, connected, sources: [...] }` — always
 * present for all four wave-1 providers, `connected` computed ONCE here
 * (never re-derived as `sources.length > 0` downstream). If the real router
 * lands with different keys, this is the ONLY file that needs to change.
 */
import { useCallback } from 'react'
import useSWR from 'swr'

// Wave-1 provider roster (spec §1/§7). `tokenKind` decides which connect UI
// a tile opens: 'token' -> ConnectTokenModal (paste fields), 'oauth' ->
// redirect to `redirectUrl` from the connect endpoint.
export const NOTE_CONNECTOR_PROVIDERS = [
  { key: 'roam', label: 'Roam Research', tokenKind: 'token' },
  { key: 'craft', label: 'Craft', tokenKind: 'token' },
  { key: 'notion', label: 'Notion', tokenKind: 'oauth' },
  { key: 'dropbox', label: 'Dropbox', tokenKind: 'oauth' },
]

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

async function readError(res, fallback) {
  const body = await res.json().catch(() => ({}))
  const err = new Error(typeof body.detail === 'string' ? body.detail : fallback)
  err.detail = body.detail
  err.status = res.status
  return err
}

// Accept a value under either casing so a raw payload in EITHER convention
// normalizes cleanly — tolerant of the router landing with snake_case
// (spec §8's own prose writes `redirect_url`) without a second alignment pass.
function pick(raw, camelKey, snakeKey, fallback) {
  if (raw == null) return fallback
  if (raw[camelKey] !== undefined) return raw[camelKey]
  if (raw[snakeKey] !== undefined) return raw[snakeKey]
  return fallback
}

function normalizeCounts(raw) {
  const c = raw || {}
  return {
    notesCreated: pick(c, 'notesCreated', 'notes_created', 0),
    notesUpdated: pick(c, 'notesUpdated', 'notes_updated', 0),
    notesSkipped: pick(c, 'notesSkipped', 'notes_skipped', 0),
    mediaUploaded: pick(c, 'mediaUploaded', 'media_uploaded', 0),
    conflicts: pick(c, 'conflicts', 'conflicts', 0),
  }
}

function normalizeSource(raw) {
  if (!raw) return null
  return {
    id: raw.id,
    provider: raw.provider,
    displayName: pick(raw, 'displayName', 'display_name', pick(raw, 'remoteId', 'remote_id', '')),
    remoteId: pick(raw, 'remoteId', 'remote_id', ''),
    syncEnabled: pick(raw, 'syncEnabled', 'sync_enabled', true),
    status: raw.status || 'active',
    lastSyncAt: pick(raw, 'lastSyncAt', 'last_sync_at', null),
    lastSyncStatus: pick(raw, 'lastSyncStatus', 'last_sync_status', null),
    lastSyncError: pick(raw, 'lastSyncError', 'last_sync_error', null),
    warmingUntil: pick(raw, 'warmingUntil', 'warming_until', null),
    counts: normalizeCounts(raw.counts),
  }
}

function normalizeProvider(raw) {
  const sources = ((raw && raw.sources) || []).map(normalizeSource).filter(Boolean)
  return {
    configured: !!pick(raw, 'configured', 'is_configured', false),
    sources,
    // Computed ONCE, here — every consumer reads this, never `sources.length > 0` again.
    connected: sources.length > 0,
  }
}

/**
 * Translate whatever `GET /status` returns into the stable shape every
 * component reads. Always returns all four wave-1 provider keys (a raw
 * payload missing a key, in ANY casing, still renders a "not configured"
 * tile rather than the component needing its own `|| {}` fallback).
 */
export function normalizeStatus(raw) {
  const rawProviders = (raw && raw.providers) || {}
  const providers = {}
  for (const p of NOTE_CONNECTOR_PROVIDERS) {
    providers[p.key] = normalizeProvider(rawProviders[p.key])
  }
  return { providers }
}

export default function useNoteConnectors() {
  const { data, error, isLoading, mutate } = useSWR(
    '/api/j2/notes/connectors/status',
    fetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  )

  const providers = normalizeStatus(data).providers

  // Token providers (roam/craft): payload carries the pasted credentials.
  // Callers (ConnectTokenModal) only invoke this after their own consent
  // checkbox is checked, and include `consent: true` in `payload` themselves
  // — spec §8: "Paid-plan gate mirrors broker connect; consent checkbox
  // required."
  const connectToken = useCallback(
    async (provider, payload) => {
      const r = await fetch(`/api/j2/notes/connectors/${provider}/connect`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
      })
      if (!r.ok) throw await readError(r, 'Could not connect.')
      const body = await r.json().catch(() => ({}))
      await mutate()
      return body
    },
    [mutate]
  )

  // OAuth providers (notion/dropbox): POST {consent:true} -> {redirectUrl},
  // hand off. `consent: true` is unconditional here BY DESIGN — every caller
  // (ConnectedAppsCard, ConnectTilesCompact) only reaches this function from
  // inside ConnectConsentPanel's onConfirm, which is disabled until the
  // consent checkbox is checked, so the gate is structural, not a param.
  const startOAuth = useCallback(async (provider) => {
    const r = await fetch(`/api/j2/notes/connectors/${provider}/connect`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent: true }),
    })
    if (!r.ok) throw await readError(r, 'Could not start the connection.')
    const body = await r.json().catch(() => ({}))
    const redirectUrl = body.redirectUrl || body.redirect_url
    if (redirectUrl) window.location.href = redirectUrl
    return body
  }, [])

  const syncSource = useCallback(
    async (sourceId, { background = false } = {}) => {
      const qs = background ? '?background=1' : ''
      const r = await fetch(`/api/j2/notes/connectors/sources/${sourceId}/sync${qs}`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!r.ok) throw await readError(r, 'Sync failed — try again shortly.')
      const body = await r.json().catch(() => ({}))
      await mutate()
      return body
    },
    [mutate]
  )

  const updateSource = useCallback(
    async (sourceId, patch) => {
      const r = await fetch(`/api/j2/notes/connectors/sources/${sourceId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch || {}),
      })
      if (!r.ok) throw await readError(r, 'Could not update.')
      await mutate()
    },
    [mutate]
  )

  const disconnect = useCallback(
    async (provider) => {
      const r = await fetch(`/api/j2/notes/connectors/${provider}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!r.ok) throw await readError(r, 'Could not disconnect.')
      await mutate()
    },
    [mutate]
  )

  // useCallback so identity is stable across renders — ConnectedAppsCard's
  // OAuth-return self-heal effect depends on [refresh]; without this it was
  // a fresh function every render, re-running the effect every render and
  // only saved from looping by the healedRef guard (fix-round 1, finding #3).
  const refresh = useCallback(() => mutate(), [mutate])

  return {
    providers,
    isLoading,
    error,
    refresh,
    mutate,
    connectToken,
    startOAuth,
    syncSource,
    updateSource,
    disconnect,
  }
}
