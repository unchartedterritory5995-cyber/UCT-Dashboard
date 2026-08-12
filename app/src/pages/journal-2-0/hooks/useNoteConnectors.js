/**
 * Journal 2.0 — Note Connectors (Task 12).
 *
 * SWR status fetch + action helpers over the note-connectors router
 * (spec docs/superpowers/specs/2026-08-11-note-connectors-design.md §8):
 *
 *   GET    /api/j2/notes/connectors/status                — providers configured/connected + per-source freshness
 *   POST   /api/j2/notes/connectors/{provider}/connect     — token payload (roam/craft) OR {} to start OAuth (notion/dropbox) -> {redirectUrl}
 *   GET    /api/j2/notes/connectors/{provider}/callback    — OAuth return (backend-owned; the browser never calls this directly)
 *   POST   /api/j2/notes/connectors/sources/{id}/sync      — manual sync, background=1 supported
 *   PUT    /api/j2/notes/connectors/sources/{id}           — sync_enabled / dest folder
 *   DELETE /api/j2/notes/connectors/{provider}             — disconnect (keeps notes, severs the source links)
 *
 * The backend router is being built in a parallel task — this hook binds to
 * the endpoint PATHS the spec commits to; the exact JSON field names below
 * are this task's own reasonable contract (documented in the task report)
 * since §8 only describes the shape in prose.
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

export default function useNoteConnectors() {
  const { data, error, isLoading, mutate } = useSWR(
    '/api/j2/notes/connectors/status',
    fetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  )

  const providers = data?.providers || {}

  // Token providers (roam/craft): payload carries the pasted credentials.
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

  // OAuth providers (notion/dropbox): POST {} -> {redirectUrl}, hand off.
  const startOAuth = useCallback(async (provider) => {
    const r = await fetch(`/api/j2/notes/connectors/${provider}/connect`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!r.ok) throw await readError(r, 'Could not start the connection.')
    const body = await r.json().catch(() => ({}))
    if (body.redirectUrl) window.location.href = body.redirectUrl
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

  return {
    providers,
    isLoading,
    error,
    refresh: () => mutate(),
    mutate,
    connectToken,
    startOAuth,
    syncSource,
    updateSource,
    disconnect,
  }
}
