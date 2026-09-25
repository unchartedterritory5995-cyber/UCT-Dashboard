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

/** The SWR key — exported so a caller revalidating "every notes list" can
 *  leave this one out when its change cannot move a tag count (R1-N4). */
export const NOTE_TAGS_KEY = '/api/j2/notes/tags'

export default function useJ2NoteTags() {
  const { data, error, isLoading, mutate } = useSWR(NOTE_TAGS_KEY, fetcher, {
    // ⛔ NOT on focus. This key is the most expensive read in the Notebook: it runs the
    // whole-library tag count AND the tag tree, and it was measured at ~1.4 s at 50k
    // notes (review R1-N4) before wave 7's rework. It used to set `true` here, overriding
    // the app-wide `revalidateOnFocus: false` (App.jsx), so every tab switch back to the
    // app paid for it even when nothing could have changed a tag.
    // It revalidates when a tag COULD have changed, through the paths that already know:
    // NotebookTab's `refreshSidebarCounts` (tags on unless the op cannot move a count,
    // `TAG_COUNT_OPS`), the editor's `refresh()` after a tag delta, and a remount.
    // `false` is written out rather than inherited, so a surface mounted outside the
    // app's SWRConfig (a test harness, an embed) cannot bring the focus fetch back.
    // Rail: useJ2NoteTags.revalidate.test.jsx.
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    // [{tag, count}], already sorted count DESC then tag ASC by the server —
    // the REAL distribution, so a consumer's cap (e.g. FolderSidebar's
    // TAG_CAP) selects the true top N, not whichever page happened to load.
    tagCounts: data?.tags ?? [],
    // Wave 5 nested tags: every node of the `a/b/c` hierarchy, implied
    // parents included, as `{path, key, own, total}` — `total` is DISTINCT
    // notes in the subtree (what filtering by it returns). Null — not [] —
    // when the server sent no tree, so a caller can tell "no tags" from
    // "an older answer" and fall back (lib/tagTree.fallbackNodes).
    tagTree: Array.isArray(data?.tree) ? data.tree : null,
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
