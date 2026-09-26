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

// ── One tag read per refresh, however many lists see it (review N-2, wave 7 fix round 2) ──
// Every notes list asks the tag key when its OWN refresh moves a tag (useJ2Notes). NotebookTab
// mounts two lists (up to six useJ2Notes in all) and SWR never dedupes a mutate, so a decision
// made per hook instance asked once PER LIST: one local tag op cost 3 tag reads, one focus after
// a tag moved elsewhere cost 2. So:
//   * a WAVE is every read started in one synchronous turn -- a key-predicate revalidation
//     (NotebookTab.refreshSidebarCounts) or a focus event starts all of its reads in one;
//   * a list whose refresh moved a tag asks only when NO tag read has started in its own wave
//     or since. The tag read the refresh itself started (refreshSidebarCounts includes the tag
//     key), or the first list's ask, then answers every other list of that wave.
// A tag read from an EARLIER wave never excuses one: it may predate the change the list saw.
// The waves are module state and the fetchers stamp them, so this hook needs nothing from SWR
// but `useSWR` (surfaces that mock 'swr' down to its default export keep rendering). One app
// cache is assumed: two SWR caches alive at once would share the stamps.
// Rail: useJ2Notes.tagFollow.test.jsx ("two notes lists, one tag cloud").
let wave = 0
let waveOpen = false
function currentWave() {
  if (!waveOpen) {
    wave += 1
    waveOpen = true
    queueMicrotask(() => { waveOpen = false })
  }
  return wave
}

// Bounded like a small LRU: a search box makes one list key per query.
const KEEP = 64
export function rememberBounded(map, key, value) {
  map.delete(key)
  map.set(key, value)
  if (map.size > KEEP) map.delete(map.keys().next().value)
}

let tagWave = 0
const listWave = new Map()

/** The notes-list fetcher calls this as a read of `url` starts. */
export function stampListRead(url) {
  rememberBounded(listWave, url, currentWave())
}

/** True when a tag read started in the wave of `url`'s latest read, or after it. A key with no
 *  recorded read (seeded or optimistically written, or aged out) is never served: the failure
 *  direction is one extra tag read, never a tag cloud left contradicting the list. */
export function tagReadServes(url) {
  return tagWave >= (listWave.get(url) ?? Infinity)
}

const tagFetcher = (url) => {
  tagWave = currentWave()
  return fetcher(url)
}

/** The SWR key — exported so a caller revalidating "every notes list" can
 *  leave this one out when its change cannot move a tag count (R1-N4). */
export const NOTE_TAGS_KEY = '/api/j2/notes/tags'

/** A page of notes reduced to what can move a tag count: each TAGGED note's id and its
 *  sorted tags, order-independent. Two pages with the same signature cannot disagree about
 *  a tag count; a note merely changing place, title or body -- or an untagged note coming or
 *  going -- leaves it unchanged. Used by useJ2Notes to decide whether its own refresh
 *  warrants re-asking this key (wave 7 fix round 1, review M-4). */
export function tagSignature(notes) {
  return (notes || [])
    .filter((n) => Array.isArray(n?.tags) && n.tags.length)
    .map((n) => `${n.id}\u0001${[...n.tags].sort().join('\u0002')}`)
    .sort()
    .join('\n')
}

export default function useJ2NoteTags() {
  const { data, error, isLoading, mutate } = useSWR(NOTE_TAGS_KEY, tagFetcher, {
    // ⛔ NOT on focus. This key is the most expensive read in the Notebook: it runs the
    // whole-library tag count AND the tag tree, and it was measured at ~1.4 s at 50k
    // notes (review R1-N4) before wave 7's rework. It used to set `true` here, overriding
    // the app-wide `revalidateOnFocus: false` (App.jsx), so every tab switch back to the
    // app paid for it even when nothing could have changed a tag.
    // It revalidates when a tag COULD have changed, through the paths that already know:
    // NotebookTab's `refreshSidebarCounts` (tags on unless the op cannot move a count,
    // `TAG_COUNT_OPS`), the editor's `refresh()` after a tag delta, a remount -- and
    // (review M-4) the notes LIST's own refresh, when the page it brings back carries
    // different tags than the page it replaced (useJ2Notes, `tagSignature`). A tag changed
    // in another tab or device, by an import, a connector or an email append therefore
    // reaches the tag cloud with the list that shows it, and a focus that changed nothing
    // still costs no tag query.
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
