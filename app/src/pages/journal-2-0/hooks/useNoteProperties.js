/** Wave E — one note's fully-resolved property list (every def, that note's
 * value or its live-derived financial value). Powers the note editor's
 * Properties section. Saving a value goes through the note's own
 * useJ2Note().update({properties: {...}}) -- this hook just reads the
 * resolved result back after that save invalidates it. */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useNoteProperties(noteId) {
  const url = noteId ? `/api/j2/notes/${noteId}/properties` : null
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    properties: data?.properties ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
