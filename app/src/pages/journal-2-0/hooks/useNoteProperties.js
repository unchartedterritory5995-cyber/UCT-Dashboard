/** Wave E — per-note property VALUES. Distinct from useJ2PropertyDefs.js,
 * which owns the shared definitions every note draws from. */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useNoteProperties(noteId) {
  const key = noteId ? `/api/j2/notes/${noteId}/properties` : null
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    properties: data?.properties ?? [],
    isLoading: !!key && isLoading,
    error,
    refresh: () => mutate(),
    setValue: async (defId, value) => {
      const res = await fetch(`/api/j2/notes/${noteId}/properties/${defId}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = new Error(body.detail || `${res.status}`)
        err.status = res.status
        throw err
      }
      const body = await res.json()
      await mutate({ properties: body.properties }, { revalidate: false })
      return body.properties
    },
  }
}
