/** Wave C (Version History) — Notebook version-history SWR hooks. */
import useSWR, { mutate as globalMutate } from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

/** History LIST for one note -- title/subtitle/timestamp only, never the
 * full body (matches the backend's own "list view never carries body"
 * convention). `enabled` lets the caller skip the fetch until the History
 * panel is actually opened -- this hook is only ever mounted from inside
 * that panel in practice, but the flag keeps the contract explicit and
 * testable the same way useJ2Favorites/useJ2Recents already do. */
export function useJ2NoteVersions(noteId, { enabled = true } = {}) {
  const url = noteId && enabled ? `/api/j2/notes/${noteId}/versions` : null
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    versions: data?.versions ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
  }
}

/** Full content of ONE version -- for the read-only preview and the diff
 * view. Only fetches when both ids are present (selecting a version in the
 * list is what supplies versionId). */
export function useJ2NoteVersion(noteId, versionId) {
  const url = noteId && versionId ? `/api/j2/notes/${noteId}/versions/${versionId}` : null
  const { data, error, isLoading } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    version: data?.version ?? null,
    isLoading,
    error,
  }
}

/** True for a Notebook LIST cache key (`/api/j2/notes` or
 * `/api/j2/notes?...`, any filter combination from buildNotesUrl in
 * useJ2Notes.js) -- false for a single-note or sub-resource key like
 * `/api/j2/notes/{id}` or `/api/j2/notes/{id}/versions`. Exported so
 * restoreNoteVersion's key-matcher mutate() call is directly testable
 * against the real predicate, not a duplicate copy of the regex. */
export function isNoteListKey(key) {
  return typeof key === 'string' && /^\/api\/j2\/notes(\?|$)/.test(key)
}

/** Restore -- same optimistic-lock contract as a normal note save (an
 * optional baseUpdatedAt makes it compare-and-set; omit it to skip the
 * check). Throws on failure with `.status` set so the caller can
 * distinguish a 409 (stale baseline -- note changed since History opened)
 * from any other error. On success, invalidates the note itself and this
 * note's version list (a restore always adds a new checkpoint). */
export async function restoreNoteVersion(noteId, versionId, baseUpdatedAt) {
  const res = await fetch(`/api/j2/notes/${noteId}/versions/${versionId}/restore`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(baseUpdatedAt ? { baseUpdatedAt } : {}),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(body.detail || `${res.status}`)
    err.status = res.status
    throw err
  }
  const body = await res.json()
  globalMutate(`/api/j2/notes/${noteId}`)
  globalMutate(`/api/j2/notes/${noteId}/versions`)
  // The Notebook sidebar list is a SEPARATE SWR key per active filter set
  // (buildNotesUrl in useJ2Notes.js) -- found live via browser E2E: without
  // this, a restored note's title/subtitle stays stale in the list (still
  // showing the pre-restore value) until something else happens to
  // revalidate it. Key-matcher form (not a fixed key) so it reaches every
  // filtered list variant currently cached, not just an unfiltered one.
  globalMutate(isNoteListKey)
  return body.note
}
