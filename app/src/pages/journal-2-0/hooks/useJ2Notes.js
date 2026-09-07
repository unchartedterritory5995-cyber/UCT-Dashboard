/** Notebook notes SWR hook. */
import { useCallback, useState } from 'react'
import useSWR, { mutate as globalMutate } from 'swr'
import { invalidateNoteLinkTarget } from '../lib/noteLinkTargetsBatch'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

// Mirrors the backend default (`list_notes`/`list_notes_endpoint` both
// default `limit=100`) — the size of one page, and of a "Load more" click.
const DEFAULT_PAGE_SIZE = 100

function buildNotesUrl({
  folderId, tag, ticker, q, sort, limit, offset, deleted, dateFrom, dateTo, sector, theme,
  savedViewId, propertyFilter, propertySort,
}) {
  const params = new URLSearchParams()
  if (folderId) params.set('folder_id', folderId)
  if (tag) params.set('tag', tag)
  if (ticker) params.set('ticker', ticker)
  if (q) params.set('q', q)
  if (sort) params.set('sort', sort)
  if (limit) params.set('limit', String(limit))
  if (offset) params.set('offset', String(offset))
  if (deleted) params.set('deleted', 'true')
  // Wave 4 (Search Evolution I): dateFrom/dateTo bound created_at ("Note
  // created"); sector/theme resolve to the member's own mentioned-symbol
  // vocabulary server-side — see journal_two.py's list_notes_endpoint.
  if (dateFrom) params.set('dateFrom', dateFrom)
  if (dateTo) params.set('dateTo', dateTo)
  if (sector) params.set('sector', sector)
  if (theme) params.set('theme', theme)
  // Wave E: a saved view ALWAYS wins server-side over any propertyFilter/
  // propertySort sent alongside it (directive §87) -- sending both here is
  // harmless (the server ignores the latter), but callers should still
  // prefer omitting them once a view is active, matching NotebookTab's own
  // "one selection channel" discipline.
  if (savedViewId) params.set('savedViewId', savedViewId)
  if (propertyFilter) params.set('propertyFilter', JSON.stringify(propertyFilter))
  if (propertySort) params.set('propertySort', JSON.stringify(propertySort))
  const qs = params.toString()
  return `/api/j2/notes${qs ? `?${qs}` : ''}`
}

export default function useJ2Notes({
  folderId, tag, ticker, q, sort = 'updated', limit, enabled = true, deleted = false,
  dateFrom, dateTo, sector, theme, savedViewId, propertyFilter, propertySort,
} = {}) {
  const url = enabled ? buildNotesUrl({
    folderId, tag, ticker, q, sort, limit, deleted, dateFrom, dateTo, sector, theme,
    savedViewId, propertyFilter, propertySort,
  }) : null
  // `enabled=false` passes SWR a null key, which skips the fetch entirely —
  // callers that only sometimes need this data (e.g. a search panel that
  // shouldn't hit the default list on every render) pass this instead of
  // calling the hook conditionally (not allowed — same hook, every render).
  const { data, error, isLoading, isValidating, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  })

  const firstPage = data?.notes ?? []
  // `total` is the TRUE count from SQL (`count_notes` in
  // api/services/journal_two/notes.py, built off the SAME WHERE clause as
  // the list) — never `notes.length`.
  //
  // ⛔ Final-review C2: this used to read `data?.total ?? firstPage.length`.
  // While `data` is undefined — in flight, or after a failed fetch —
  // `firstPage` is `[]`, so that fallback silently produced `0`, NEVER
  // `undefined`. `0 ?? x` is `0`, not `x` — so every downstream "fall back
  // when the server total is unknown" check (FolderSidebar's
  // `unfiledTotalFromServer ?? unfiledCountFromPage`, for one) was DEAD CODE:
  // the left side was always a defined number, just sometimes a wrong one
  // (a real zero-length page masquerading as "no server total yet"). Left
  // undefined here on purpose so a consumer can tell "unknown" apart from
  // "zero" and choose its own fallback (or gate on `isLoading`/`error`).
  const total = data?.total

  // "Load more" — extra pages fetched past the first, appended locally and
  // tracked against the URL they were fetched FOR. A folder/tag/sort/q
  // change (which changes `url`) can then never leave a stale tail glued
  // onto a different filter's results.
  const [extra, setExtra] = useState({ forUrl: null, notes: [] })
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState(null)

  const extraNotes = extra.forUrl === url ? extra.notes : []
  const notes = extraNotes.length ? [...firstPage, ...extraNotes] : firstPage
  // `total !== undefined` guards the in-flight/unknown state explicitly —
  // `notes.length < undefined` already evaluates false in JS, but spelling
  // it out means a future refactor can't quietly reintroduce the C2 shape
  // (an unknown total masquerading as a known one).
  const hasMore = Boolean(url) && total !== undefined && notes.length < total

  const loadMore = useCallback(async () => {
    if (!url || !hasMore || isLoadingMore) return
    setIsLoadingMore(true)
    setLoadMoreError(null)
    try {
      const nextUrl = buildNotesUrl({
        folderId, tag, ticker, q, sort, deleted, dateFrom, dateTo, sector, theme,
        savedViewId, propertyFilter, propertySort,
        limit: limit || DEFAULT_PAGE_SIZE,
        offset: notes.length,
      })
      const body = await fetcher(nextUrl)
      // Defensive de-dupe: a row that shifted across the page boundary
      // (e.g. its updated_at changed between fetches) must never render
      // twice rather than trusting offset math alone.
      const seen = new Set(notes.map((n) => n.id))
      const appended = (body.notes || []).filter((n) => !seen.has(n.id))
      setExtra((prev) => ({
        forUrl: url,
        notes: prev.forUrl === url ? [...prev.notes, ...appended] : appended,
      }))
    } catch (e) {
      setLoadMoreError(e)
    } finally {
      setIsLoadingMore(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, hasMore, isLoadingMore, folderId, tag, ticker, q, sort, limit, deleted, notes, dateFrom, dateTo, sector, theme])

  return {
    notes,
    // The true total behind this filter set — see the comment above.
    total,
    hasMore,
    loadMore,
    isLoadingMore,
    loadMoreError,
    isLoading,
    isValidating,
    error,
    // A refresh always snaps back to page one — a stale "loaded more" tail
    // surviving a create/delete/import is a worse bug than losing scroll
    // position on a page that's about to reconcile from the server anyway.
    refresh: () => { setExtra({ forUrl: null, notes: [] }); return mutate() },
    // Raw SWR mutate for optimistic cache writes (instant new-note + live title
    // in the folder tree, without waiting on a refetch).
    mutate,
  }
}

export function useJ2Note(noteId) {
  const url = noteId ? `/api/j2/notes/${noteId}` : null
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    note: data?.note ?? null,
    isLoading,
    error,
    refresh: () => mutate(),
    update: async (patch) => {
      const res = await fetch(`/api/j2/notes/${noteId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = new Error(body.detail || `${res.status}`)
        err.status = res.status
        throw err
      }
      const body = await res.json()
      await mutate({ note: body.note }, { revalidate: false })
      // This note's own title/status may have just changed -- evict it from
      // the noteLink batch-resolution cache so any noteLink chip elsewhere
      // in this tab pointing at THIS id (another open note, a backlinks
      // row) re-resolves fresh instead of showing the pre-save title until
      // a full reload (Wave D closure pass finding).
      invalidateNoteLinkTarget(noteId)
      return body.note
    },
  }
}

/** The TRUE whole-library note count per folder (+ Unfiled + total) — see
 * notes_service.folder_note_counts's own docstring for the capped-page bug
 * this replaces. FolderSidebar's disclosure arrows / leaf-row rendering
 * should key off THIS, never off grouping a loaded page of notes.
 *
 * `counts` is `undefined` (never `{}`) until the server actually answers —
 * the same "unknown vs. known-empty" distinction `total` already makes
 * elsewhere in this file (final-review C2). A folder legitimately absent
 * from a REAL `counts` object means its true count is 0; an absent key in
 * an `{}` stand-in for "still loading" would mean the opposite. Collapsing
 * the two would silently drop every folder's disclosure arrow on first
 * paint, every time — the exact bug this hook exists to fix, one layer up. */
export function useJ2NoteFolderCounts() {
  const { data, error, isLoading, mutate } = useSWR(
    '/api/j2/notes/folder-counts', fetcher, {
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    },
  )
  return {
    counts: data?.counts,
    unfiled: data?.unfiled,
    total: data?.total,
    isLoading,
    error,
    refresh: () => mutate(),
  }
}

// ── Wave B (High-Frequency Notebook UX): Favorites + Recents ────────────────
// Both use the STABLE, no-limit URL as their SWR key (server-side default
// caps apply — FAVORITES_DEFAULT_LIMIT=50 / RECENTS_DEFAULT_LIMIT=8) so every
// caller (sidebar section, command palette) shares one cache entry and a
// single favorite/opened write invalidates every consumer at once via the
// global `mutate` calls below — no manual refresh wiring needed at each
// call site.
const FAVORITES_URL = '/api/j2/notes/favorites'
const RECENTS_URL = '/api/j2/notes/recents'

/** Populated-conditional by design at the CALLER (sidebar hides the whole
 * section when `notes` is empty) — this hook itself always returns an array,
 * never undefined, so "no favorites yet" and "still loading" are told apart
 * via `isLoading`, matching every other hook in this file.
 *
 * `enabled` (default true) skips the fetch entirely via SWR's null-key
 * convention — the command palette is mounted app-wide and passes
 * `enabled: open` so this never fires on every page load, only while the
 * palette is actually open. */
export function useJ2Favorites({ enabled = true } = {}) {
  const { data, error, isLoading, mutate } = useSWR(enabled ? FAVORITES_URL : null, fetcher, {
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  })
  return {
    notes: data?.notes ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
  }
}

export function useJ2Recents({ enabled = true } = {}) {
  const { data, error, isLoading, mutate } = useSWR(enabled ? RECENTS_URL : null, fetcher, {
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  })
  return {
    notes: data?.notes ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
  }
}

/** Toggle a note's favorite state. Throws on failure (a star click is a
 * deliberate user action, unlike the opened-beacon below, so the caller
 * shows/reverts the optimistic state rather than swallowing the error). */
export async function setNoteFavorite(noteId, isFavorite) {
  const res = await fetch(`/api/j2/notes/${noteId}/favorite`, {
    method: isFavorite ? 'POST' : 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(body.detail || `${res.status}`)
    err.status = res.status
    throw err
  }
  const body = await res.json()
  globalMutate(FAVORITES_URL)
  globalMutate(`/api/j2/notes/${noteId}`)
  return body.isFavorite
}

/** Fire-and-forget recency beacon — never awaited, never throws into the
 * caller. Mirrors the backend endpoint's own "must never break note
 * viewing" contract. */
export function recordNoteOpened(noteId) {
  fetch(`/api/j2/notes/${noteId}/opened`, { method: 'POST', credentials: 'include' })
    .then(() => globalMutate(RECENTS_URL))
    .catch(() => {})
}

/** The actual note rows for a set of (in practice: currently-expanded)
 * folder ids, honestly complete per folder up to the server's cap — see
 * notes_service.notes_for_folders's own docstring. Pass a stable array;
 * an empty array skips the fetch (SWR null key) and returns `{}`. */
export function useJ2NotesByFolders(folderIds) {
  const ids = (folderIds || []).filter(Boolean)
  // Sorted + joined so re-renders that reorder the same set (e.g. a
  // different expand/collapse click order) reuse the same SWR cache entry.
  const key = ids.length ? [...ids].sort().join(',') : null
  const url = key ? `/api/j2/notes/by-folders?ids=${encodeURIComponent(key)}&limit=200` : null
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    byFolder: data?.byFolder ?? {},
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
