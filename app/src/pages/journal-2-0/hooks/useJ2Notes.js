/** Notebook notes SWR hook. */
import { useCallback, useState } from 'react'
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

// Mirrors the backend default (`list_notes`/`list_notes_endpoint` both
// default `limit=100`) — the size of one page, and of a "Load more" click.
const DEFAULT_PAGE_SIZE = 100

function buildNotesUrl({ folderId, tag, ticker, q, sort, limit, offset }) {
  const params = new URLSearchParams()
  if (folderId) params.set('folder_id', folderId)
  if (tag) params.set('tag', tag)
  if (ticker) params.set('ticker', ticker)
  if (q) params.set('q', q)
  if (sort) params.set('sort', sort)
  if (limit) params.set('limit', String(limit))
  if (offset) params.set('offset', String(offset))
  const qs = params.toString()
  return `/api/j2/notes${qs ? `?${qs}` : ''}`
}

export default function useJ2Notes({
  folderId, tag, ticker, q, sort = 'updated', limit, enabled = true,
} = {}) {
  const url = enabled ? buildNotesUrl({ folderId, tag, ticker, q, sort, limit }) : null
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
        folderId, tag, ticker, q, sort,
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
  }, [url, hasMore, isLoadingMore, folderId, tag, ticker, q, sort, limit, notes])

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
      return body.note
    },
  }
}
