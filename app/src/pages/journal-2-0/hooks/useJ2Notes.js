/** Notebook notes SWR hook. */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2Notes({
  folderId, tag, ticker, q, sort = 'updated',
} = {}) {
  const params = new URLSearchParams()
  if (folderId) params.set('folder_id', folderId)
  if (tag) params.set('tag', tag)
  if (ticker) params.set('ticker', ticker)
  if (q) params.set('q', q)
  if (sort) params.set('sort', sort)
  const qs = params.toString()
  const url = `/api/j2/notes${qs ? `?${qs}` : ''}`
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
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
        throw new Error(body.detail || `${res.status}`)
      }
      const body = await res.json()
      await mutate({ note: body.note }, { revalidate: false })
      return body.note
    },
  }
}
