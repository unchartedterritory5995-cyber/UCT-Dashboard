/**
 * Journal 2.0 — Note Connectors (Task 12 + 12b).
 *
 * SWR status fetch + action helpers over the note-connectors router. Task 12b
 * (2026-08-12) read the SHIPPED router (`api/routers/note_sync.py`, commit
 * `20f0e828c`) + its tests (`tests/test_note_sync_router.py`) instead of
 * guessing further — the real endpoints/shapes:
 *
 *   GET    /api/j2/notes/connectors/status                — {enabled, providers: {name: {configured, connectKind, connected, status, accountLabel, sources[]}}}
 *   POST   /api/j2/notes/connectors/{provider}/connect     — token payload (roam/craft) OR {consent:true} to start OAuth (notion/dropbox) -> {redirectUrl}
 *   GET    /api/j2/notes/connectors/{provider}/callback    — OAuth return (backend-owned; the browser never calls this directly)
 *   GET    /api/j2/notes/connectors/{provider}/folders?path= — folder picker for the two folder-scoped providers (dropbox, onedrive); {folders: [{path_lower, name}]}; 404 for any other provider
 *   POST   /api/j2/notes/connectors/{provider}/sources     — {remoteId, displayName?, destFolderId?} -> {source}; 409 if not connected yet
 *   POST   /api/j2/notes/connectors/sources/{id}/sync      — manual sync, background=1 supported
 *   PUT    /api/j2/notes/connectors/sources/{id}           — sync_enabled / dest folder
 *   DELETE /api/j2/notes/connectors/{provider}             — disconnect (keeps notes, severs the source links)
 *
 * **Field-name contract lives HERE, and only here** (fix-round 1, finding
 * #2). `normalizeStatus(raw)` is the single translation layer between
 * whatever `GET /status` returns and the stable shape every consumer
 * component reads: `providers[key] = { configured, connected, connectKind,
 * accountLabel, status, sources: [...] }` — always present for all six
 * registered providers (roam, craft, notion, dropbox, onenote, onedrive;
 * see `registry.py::_REGISTRY`).
 *
 * ⚠️ **`connected` is CONNECTOR-level, read directly off the router — it is
 * NOT `sources.length > 0`** (Task 12b correction; the router literally
 * computes `"connected": connector is not None`, independent of source
 * count). This is load-bearing: Dropbox's OAuth callback deliberately creates
 * the connector WITHOUT a source (`remote_id = None` — "Dropbox needs a
 * FOLDER before a source can exist"), so `connected:true, sources:[]` is a
 * real, intended state — the "choose a folder" state the UI must surface. A
 * re-derivation from `sources.length` (Task 12's original guess, before the
 * router existed to read) makes that state UNREACHABLE. Roam/Craft/Notion
 * create connector+source atomically, so for them `connected` and
 * `sources.length>0` happen to coincide — that coincidence is exactly what
 * hid the bug until Dropbox's router landed.
 */
import { useCallback } from 'react'
import useSWR from 'swr'

// Provider roster (spec §1/§7, widened to the Microsoft Graph wave in
// Task 7). `tokenKind` decides which connect UI a tile opens: 'token' ->
// ConnectTokenModal (paste fields), 'oauth' -> redirect to `redirectUrl`
// from the connect endpoint. Order matches `registry.py`'s `_REGISTRY`
// insertion order (the backend's own "stable order" contract) — not load-
// bearing for correctness, just keeps the two sides from silently drifting.
export const NOTE_CONNECTOR_PROVIDERS = [
  { key: 'roam', label: 'Roam Research', tokenKind: 'token' },
  { key: 'craft', label: 'Craft', tokenKind: 'token' },
  { key: 'notion', label: 'Notion', tokenKind: 'oauth' },
  { key: 'dropbox', label: 'Dropbox', tokenKind: 'oauth' },
  { key: 'onenote', label: 'OneNote', tokenKind: 'oauth' },
  { key: 'onedrive', label: 'OneDrive', tokenKind: 'oauth' },
]

// Providers whose sync unit is a PICKED FOLDER, not a whole account —
// mirrors the backend's `_FOLDER_PICKER_PROVIDERS` frozenset
// (`api/routers/note_sync.py`) exactly. A provider in this set can land
// `connected: true, sources: []` (needs a folder before it's usable) and
// gets the "Choose folder" CTA + `DropboxFolderPicker`. OneNote is
// deliberately NOT in this set — it's whole-account (Notion's shape, one
// implicit source auto-created on connect), so a sourceless-connected
// OneNote tile means something actually failed, never "needs a folder."
export const FOLDER_PICKER_PROVIDERS = new Set(['dropbox', 'onedrive'])

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
    // Read directly off the connector-existence flag the router computes —
    // NEVER re-derived from sources.length (see the module docstring; this
    // is the Task 12b correction that makes the Dropbox sourceless-connected
    // state representable at all).
    connected: !!pick(raw, 'connected', 'connected', false),
    connectKind: pick(raw, 'connectKind', 'connect_kind', null),
    accountLabel: pick(raw, 'accountLabel', 'account_label', null),
    status: raw && raw.status !== undefined ? raw.status : null,
    sources,
  }
}

/**
 * Translate whatever `GET /status` returns into the stable shape every
 * component reads. Always returns all four wave-1 provider keys (a raw
 * payload missing a key, in ANY casing, still renders a "not configured"
 * tile rather than the component needing its own `|| {}` fallback).
 *
 * `enabled` (final-review Item B) — the router's `_sync_enabled()` gate
 * (`NOTE_SYNC_ENABLED` env var, default true) for whether the BACKGROUND
 * scheduler runs sync passes at all, independent of any one connector's
 * own `connected`/`sources` state. Had no consumer before this fix: a paid
 * user could connect + manually sync once, see a healthy tile, and never
 * get another background pass, silently. `pick()` keeps this
 * casing-tolerant like every other field here; the fallback is `true` (not
 * `false`) so a payload that's still loading/absent, or simply omits the
 * key, never falsely shows the "sync is paused" notice — only an EXPLICIT
 * `false` from the server does.
 */
export function normalizeStatus(raw) {
  const rawProviders = (raw && raw.providers) || {}
  const providers = {}
  for (const p of NOTE_CONNECTOR_PROVIDERS) {
    providers[p.key] = normalizeProvider(rawProviders[p.key])
  }
  const enabled = !!pick(raw, 'enabled', 'enabled', true)
  return { providers, enabled }
}

// ── Dropbox folder picker (Task 12b) ─────────────────────────────────────

function normalizeFolder(raw) {
  if (!raw) return null
  return {
    pathLower: pick(raw, 'pathLower', 'path_lower', ''),
    name: raw.name || '',
  }
}

/** Translate `GET /{provider}/folders` -> `{folders}` into a stable camelCase list. */
export function normalizeFolders(raw) {
  const list = (raw && raw.folders) || []
  return list.map(normalizeFolder).filter(Boolean)
}

export default function useNoteConnectors() {
  const { data, error, isLoading, mutate } = useSWR(
    '/api/j2/notes/connectors/status',
    fetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  )

  const { providers, enabled } = normalizeStatus(data)

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

  // GET /{provider}/folders?path= — Dropbox-only (the router 404s any other
  // provider); `path` omitted/'' lists the account root. Returns the
  // normalized `{pathLower, name}[]` list, never raw keys.
  const listFolders = useCallback(async (provider, path = '') => {
    const qs = path ? `?path=${encodeURIComponent(path)}` : ''
    const r = await fetch(`/api/j2/notes/connectors/${provider}/folders${qs}`, {
      credentials: 'include',
    })
    if (!r.ok) throw await readError(r, 'Could not load folders.')
    const body = await r.json().catch(() => ({}))
    return normalizeFolders(body)
  }, [])

  // POST /{provider}/sources — creates an additional/first source under an
  // already-connected provider (409 if the connector doesn't exist yet).
  // Used by DropboxFolderPicker to turn a picked folder into a real source.
  const addSource = useCallback(
    async (provider, payload) => {
      const r = await fetch(`/api/j2/notes/connectors/${provider}/sources`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
      })
      if (!r.ok) throw await readError(r, 'Could not connect that folder.')
      const body = await r.json().catch(() => ({}))
      await mutate()
      return body
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
    enabled,
    isLoading,
    error,
    refresh,
    mutate,
    connectToken,
    startOAuth,
    syncSource,
    updateSource,
    disconnect,
    listFolders,
    addSource,
  }
}
