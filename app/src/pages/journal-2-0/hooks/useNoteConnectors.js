/**
 * Journal 2.0 — Note Connectors (Task 12 + 12b).
 *
 * SWR status fetch + action helpers over the note-connectors router. Task 12b
 * (2026-08-12) read the SHIPPED router (`api/routers/note_sync.py`, commit
 * `20f0e828c`) + its tests (`tests/test_note_sync_router.py`) instead of
 * guessing further — the real endpoints/shapes:
 *
 *   GET    /api/j2/notes/connectors/status                — {enabled, providers: {name: {configured, connectKind, connected, status, accountLabel, sources[]}}}
 *   POST   /api/j2/notes/connectors/{provider}/connect     — token payload (roam/craft) OR {consent:true} to start OAuth (notion/evernote) -> {redirectUrl}
 *   GET    /api/j2/notes/connectors/{provider}/callback    — OAuth return (backend-owned; the browser never calls this directly)
 *   POST   /api/j2/notes/connectors/{provider}/sources     — {remoteId, displayName?, destFolderId?} -> {source}; 409 if not connected yet
 *   POST   /api/j2/notes/connectors/sources/{id}/sync      — manual sync, background=1 supported
 *   PUT    /api/j2/notes/connectors/sources/{id}           — sync_enabled / dest folder
 *   DELETE /api/j2/notes/connectors/{provider}             — disconnect (keeps notes, severs the source links)
 *
 * **Field-name contract lives HERE, and only here** (fix-round 1, finding
 * #2). `normalizeStatus(raw)` is the single translation layer between
 * whatever `GET /status` returns and the stable shape every consumer
 * component reads: `providers[key] = { configured, connected, connectKind,
 * accountLabel, status, sources: [...] }` — always present for every
 * provider in `NOTE_CONNECTOR_PROVIDERS` below (mirrors
 * `registry.py::_REGISTRY`; Dropbox, OneNote and OneDrive were archived on
 * 2026-11-04).
 *
 * ⚠️ **`connected` is CONNECTOR-level, read directly off the router — it is
 * NOT `sources.length > 0`** (Task 12b correction; the router literally
 * computes `"connected": connector is not None`, independent of source
 * count). A connector with no source was a real state for the folder-picker
 * providers (Dropbox, OneDrive; archived 2026-11-04), so
 * `connected:true, sources:[]` stays representable here rather than being
 * re-derived away.
 */
import { useCallback } from 'react'
import useSWR from 'swr'
import { readSuccessBody } from '../../../lib/responseBody'

// Provider roster (spec §1/§7, widened to the Microsoft Graph wave in
// Task 7, then to Obsidian's push transport in the 2026-09-02 plan's Task 5).
// `tokenKind` decides which connect UI a tile opens: 'token' ->
// ConnectTokenModal (paste fields), 'oauth' -> redirect to `redirectUrl`
// from the connect endpoint, 'device' -> ObsidianConnectModal (mints a
// connect code to paste into a locally-installed plugin — neither a paste
// nor a redirect; mirrors the backend's `connect_kind` vocabulary in
// `registry.py`, extended the same way and for the same reason). Order
// matches `registry.py`'s `_REGISTRY` insertion order (the backend's own
// "stable order" contract) — not load-bearing for correctness, just keeps
// the two sides from silently drifting.
export const NOTE_CONNECTOR_PROVIDERS = [
  { key: 'roam', label: 'Roam Research', tokenKind: 'token' },
  { key: 'craft', label: 'Craft', tokenKind: 'token' },
  { key: 'notion', label: 'Notion', tokenKind: 'oauth' },
  // `authoritativeListing`: the provider's listing is its own complete walk, so a note missing
  // from it was REMOVED there (the backend's `NoteProvider.enumeration_is_authoritative`; pinned
  // against it by api/services/journal_two/test_note_connectors_authoritative_parity.py). The
  // note view's "removed from" notice reads it; every other provider "no longer lists" the note.
  { key: 'obsidian', label: 'Obsidian', tokenKind: 'device', authoritativeListing: true },
  // Plan E Task 10. `beta` shows a "Beta" pill on the Settings tile (Evernote's own connection is beta).
  { key: 'evernote', label: 'Evernote', tokenKind: 'oauth', beta: true },
]

// Providers the server gates PER MEMBER (`registry.provider_allowed_for`; only Evernote). `/status`
// lists them to every member, with `configured: false` while the flag is off or the member is not
// allowed -- deliberately the same answer as "not set up", so a member cannot tell the modes apart.
// So a gated provider shows NO tile at all (not "Coming soon") until the server says configured.
// EXCEPT while the member is already connected (coordinator ruling): a connection must never be
// invisible or unremovable, so the tile stays, in its sync-off state (Disconnect and the log are
// ungated on the server; Sync now and pause are not). Every surface asks `isProviderShown`.
export const MEMBER_GATED_PROVIDERS = new Set(['evernote'])

export function isProviderShown(key, info) {
  return !MEMBER_GATED_PROVIDERS.has(key) || !!(info && (info.configured || info.connected))
}

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
    // Notes SEVERED from their remote this pass (tagged `source-deleted`).
    // Normalized here like every other count so `SourceRow` can read it
    // without a `|| 0` fallback -- an older server that predates the field
    // yields 0, never `undefined`.
    sourceDeleted: pick(c, 'sourceDeleted', 'source_deleted', 0),
  }
}

export function normalizeSource(raw) {
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
    // Evernote rate-limit fix round 1 (I3): a pass for this source is running now on the server
    // (a background Sync now, a follow-up pass).
    syncing: !!pick(raw, 'syncing', 'syncing', false),
    // D4-2: a pass for this source waits for one of the server's shared pass slots (not running
    // yet). The server sends `syncing: false` while it does.
    queued: !!pick(raw, 'queued', 'queued', false),
    pendingRemoval: pick(raw, 'pendingRemoval', 'pending_removal', 0) || 0,
    lastFailureCount: pick(raw, 'lastFailureCount', 'last_failure_count', 0) || 0,
    // The newest sync's failure details could not be read (the server sends a
    // null count with this flag): unknown, never "nothing failed".
    lastFailuresUnreadable: !!pick(raw, 'lastFailuresUnreadable', 'last_failures_unreadable', false),
    // Obsidian only (the server sends these on `/status`). `null` means the
    // server predates the field, so the card shows no update hint.
    pluginVersion: pick(raw, 'pluginVersion', 'plugin_version', null),
    pluginSupportsAttachments: pick(raw, 'pluginSupportsAttachments', 'plugin_supports_attachments', null),
    counts: normalizeCounts(raw.counts),
  }
}

// The server's exact sentence for a second Sync now while one is running (HTTP 409).
export const BUSY_DETAIL =
  'A sync is already running for this source. Its results will appear here when it finishes.'

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

// Sync result -> { status, removalCheck }. `removalCheck` is null when the
// pass did not ask for one (older server / non-full pass); otherwise it is a
// STATED outcome (ran, or why not) -- never dropped when `ran` is false.
export function normalizeSyncResult(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const rc = r.removalCheck !== undefined ? r.removalCheck : r.removal_check
  let removalCheck = null
  if (rc && typeof rc === 'object') {
    removalCheck = {
      ran: !!rc.ran,
      reason: rc.reason == null ? null : rc.reason,
      nextAllowedAt: pick(rc, 'nextAllowedAt', 'next_allowed_at', null) ?? null,
      pending: num(rc.pending),
      severed: num(rc.severed),
    }
  }
  return { status: typeof r.status === 'string' ? r.status : 'unknown', removalCheck }
}

function normalizeFailure(f) {
  const x = f && typeof f === 'object' ? f : {}
  return {
    noteTitle: pick(x, 'noteTitle', 'note_title', ''),
    reason: pick(x, 'reason', 'reason', ''),
    name: pick(x, 'name', 'name', ''),
  }
}

// Recent-sync log rows. A malformed stored failures blob arrives as
// `failuresUnreadable: true` and is kept -- never read as "no failures".
export function normalizeLogRows(raw) {
  const rows = raw && Array.isArray(raw.rows) ? raw.rows : []
  return rows.filter((r) => r && typeof r === 'object').map((r) => ({
    id: r.id,
    at: pick(r, 'at', 'at', null),
    status: pick(r, 'status', 'status', null),
    created: num(pick(r, 'created', 'created', 0)),
    updated: num(pick(r, 'updated', 'updated', 0)),
    skipped: num(pick(r, 'skipped', 'skipped', 0)),
    conflicts: num(pick(r, 'conflicts', 'conflicts', 0)),
    sourceDeleted: num(pick(r, 'sourceDeleted', 'source_deleted', 0)),
    failures: Array.isArray(r.failures) ? r.failures.map(normalizeFailure) : [],
    failuresUnreadable: !!pick(r, 'failuresUnreadable', 'failures_unreadable', false),
  }))
}

function normalizeProvider(raw) {
  const sources = ((raw && raw.sources) || []).map(normalizeSource).filter(Boolean)
  return {
    configured: !!pick(raw, 'configured', 'is_configured', false),
    // Read directly off the connector-existence flag the router computes —
    // NEVER re-derived from sources.length (see the module docstring; this
    // is the Task 12b correction that keeps a sourceless-connected state
    // representable at all).
    connected: !!pick(raw, 'connected', 'connected', false),
    connectKind: pick(raw, 'connectKind', 'connect_kind', null),
    accountLabel: pick(raw, 'accountLabel', 'account_label', null),
    status: raw && raw.status !== undefined ? raw.status : null,
    sources,
  }
}

/**
 * Translate whatever `GET /status` returns into the stable shape every
 * component reads. Always returns every key in `NOTE_CONNECTOR_PROVIDERS`
 * above (a raw payload missing a key, in ANY casing, still renders a "not
 * configured" tile rather than the component needing its own `|| {}`
 * fallback) — read that array rather than a count typed here, which is
 * exactly the kind of number this codebase has watched go stale beside the
 * list it claims to describe.
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
  // Final review I3: whether the Obsidian attachment layer is on for THIS member (the
  // server's master switch). Only an explicit `true` turns it on: absent (an older server,
  // or still loading) keeps the text-only consent copy, never a promise of images.
  const obsidianAttachments = pick(raw, 'obsidianAttachments', 'obsidian_attachments', false) === true
  return { providers, enabled, obsidianAttachments }
}

// Evernote rate-limit fix round 1 (I3): while any source is syncing or still importing, the
// page re-reads /status every 10 s, so a background Sync now and the follow-up passes show their
// progress line without a reload. A settled page (or one still loading) never polls.
export function connectorsRefreshInterval(raw) {
  const providers = (raw && raw.providers) || {}
  for (const key of Object.keys(providers)) {
    const sources = (providers[key] && providers[key].sources) || []
    for (const s of sources) {
      if (!s) continue
      if (s.syncing === true || s.queued === true
        || pick(s, 'lastSyncStatus', 'last_sync_status', null) === 'importing') return 10000
    }
  }
  return 0
}

// The /status SWR options, exported so the poll's wiring has a rail of its own.
export const STATUS_SWR_OPTIONS = {
  revalidateOnFocus: false, shouldRetryOnError: false, refreshInterval: connectorsRefreshInterval,
}

export default function useNoteConnectors() {
  const { data, error, isLoading, mutate } = useSWR(
    '/api/j2/notes/connectors/status',
    fetcher,
    STATUS_SWR_OPTIONS
  )

  const { providers, enabled, obsidianAttachments } = normalizeStatus(data)

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

  // OAuth providers (notion/evernote): POST {consent:true} -> {redirectUrl},
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

  // Device providers (obsidian): POST {consent:true} -> {connectCode,
  // expiresInSeconds}. Unlike `startOAuth`, this never navigates the
  // browser away — minting creates no connector/source row on the backend
  // (see `registry.py`'s own `connect_kind` docstring), so the caller (the
  // Obsidian tile) is responsible for showing the code once and letting the
  // member copy it into the locally-installed plugin themselves. `pick()`
  // keeps this casing-tolerant like every other field in this hook.
  const mintConnectCode = useCallback(async (provider) => {
    const r = await fetch(`/api/j2/notes/connectors/${provider}/connect`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent: true }),
    })
    if (!r.ok) throw await readError(r, 'Could not generate a connect code.')
    const body = await r.json().catch(() => ({}))
    return {
      connectCode: pick(body, 'connectCode', 'connect_code', ''),
      expiresInSeconds: pick(body, 'expiresInSeconds', 'expires_in_seconds', 0),
    }
  }, [])

  // Always a FULL pass (`full=1`): that is what runs the rate-limited
  // removal check. A busy source answers 409 with BUSY_DETAIL (err.status /
  // err.detail via readError).
  const syncSource = useCallback(
    async (sourceId, { background = false } = {}) => {
      const qs = background ? '?full=1&background=1' : '?full=1'
      const r = await fetch(`/api/j2/notes/connectors/sources/${sourceId}/sync${qs}`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!r.ok) throw await readError(r, 'Sync failed — try again shortly.')
      const read = await readSuccessBody(r)
      await mutate()
      if (!read.ok) return { status: 'unknown', removalCheck: null }
      return normalizeSyncResult(read.body)
    },
    [mutate]
  )

  // GET .../sources/{id}/log?limit= -> LogRow[]. Never resolves [] for a
  // failure: a non-ok response or unreadable body throws.
  const getSourceLog = useCallback(async (sourceId, { limit = 5 } = {}) => {
    const r = await fetch(
      `/api/j2/notes/connectors/sources/${sourceId}/log?limit=${encodeURIComponent(limit)}`,
      { credentials: 'include' }
    )
    if (!r.ok) throw await readError(r, 'Could not load recent syncs.')
    const read = await readSuccessBody(r)
    if (!read.ok) throw new Error('Could not read recent syncs.')
    return normalizeLogRows(read.body)
  }, [])

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
    enabled,
    obsidianAttachments,
    isLoading,
    error,
    refresh,
    mutate,
    connectToken,
    startOAuth,
    mintConnectCode,
    syncSource,
    getSourceLog,
    updateSource,
    disconnect,
  }
}
