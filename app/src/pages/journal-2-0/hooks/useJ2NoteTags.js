/** Notebook tag-counts SWR hook — tag -> note-count across the member's
 * WHOLE library (from `GET /api/j2/notes/tags`, backed by
 * `notes.py::tag_counts`), never derived from one loaded page of notes.
 *
 * Final-review C5: FolderSidebar's tag cloud used to count over the `notes`
 * prop (one 100-row page) — harmless while the sidebar's OWN totals were
 * page-capped too, but Task 11 gave the sidebar an honest "All notes" total,
 * which made a page-derived tag cloud visibly self-contradict it on a
 * migrated library. This hook is the fix: ask the server for the real
 * distribution, the same shape already used for the honest Unfiled total.
 */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2NoteTags() {
  const { data, error, isLoading, mutate } = useSWR('/api/j2/notes/tags', fetcher, {
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  })
  return {
    // [{tag, count}], already sorted count DESC then tag ASC by the server —
    // the REAL distribution, so a consumer's cap (e.g. FolderSidebar's
    // TAG_CAP) selects the true top N, not whichever page happened to load.
    tagCounts: data?.tags ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
