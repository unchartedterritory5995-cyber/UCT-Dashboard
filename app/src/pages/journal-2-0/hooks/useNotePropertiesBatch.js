/** Wave E — property values for MANY notes in one request (the Table
 * view's own page) -- mirrors Wave D's noteLinkTargetsBatch batching
 * discipline, but as a plain SWR-keyed fetch (the note id set changes
 * once per page load, not per-render, so a micro-batcher isn't needed here). */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : { properties: {} }))

export default function useNotePropertiesBatch(noteIds) {
  const ids = (noteIds || []).filter(Boolean)
  const key = ids.length ? `/api/j2/notes/properties/batch?ids=${ids.map(encodeURIComponent).join(',')}` : null
  const { data, isLoading, error } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    propertiesByNote: data?.properties ?? {},
    isLoading: !!key && isLoading,
    error,
  }
}
