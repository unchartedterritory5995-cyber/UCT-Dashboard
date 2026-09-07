/** Wave J — one note's PDF documents (Wave I's own `GET
 * /notes/{id}/documents`, not previously hook-wrapped -- NoteEditorPage
 * needs a document's id to save an excerpt against, and this is the only
 * place that id is reachable from an attachment URL). Mirrors
 * useNoteFacts.js's batching shape exactly. */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useNoteDocuments(noteId) {
  const url = noteId ? `/api/j2/notes/${noteId}/documents` : null
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    documents: data?.documents ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
