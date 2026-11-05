/**
 * ⛔⛔ Audit 2026-11-05, spec S6: THE ONE WAY THE NOTEBOOK'S LISTS AND COUNTS ARE TOLD A NOTE MOVED.
 *
 * `settleNoteWrite` (beside this file) lands a note's REVISION so the offline layer does not fork
 * it. This is its sibling for everything that SHOWS notes: after a create, a move, a trash, a
 * restore or a title save, every list, count and graph that could hold the note is revalidated
 * from the server, so the counts and the lists always agree without a reload.
 *
 * ⚰️ WHY IT EXISTS (B2, B5, and the post-#816 Recents title): each door refreshed what it happened
 * to own. A note made from the recap or the canvas door refreshed the sidebar's own page only, so
 * the list said "3 of 3" while the sidebar said 5; a move left "Unfiled 1"; a title typed into a
 * new note stayed "Untitled" in Recents because only the sidebar's tree was patched locally.
 *
 * ⛔ THE KEYS ARE THE NOTE VIEWS, NEVER A NOTE. `/api/j2/notes/{id}` (the open editor's own copy)
 * and its sub-resources are left alone: revalidating the note under an editor mid-save is how a
 * stale body would meet a live one. A view key is the notes list (`/api/j2/notes` and every
 * `/api/j2/notes?...` filter), the folder tree and its counts, the per-folder rows, Recents,
 * Favorites and the graph. The tag cloud is opt-in (`tags: true`): it is the most expensive read
 * in the Notebook (useJ2NoteTags), and only a create, trash or restore can move a tag count.
 *
 * `titleOnly` is for a title save: the views that SHOW a title (lists, per-folder rows, Recents,
 * Favorites, the graph), not the counts, which a title cannot change.
 *
 * Never throws: a failed revalidation is a stale list until the next one, never a failed write.
 */
import { mutate as globalMutate } from 'swr'

export const NOTE_TAGS_PREFIX = '/api/j2/notes/tags'

const TITLE_VIEW_PREFIXES = [
  '/api/j2/notes/by-folders',
  '/api/j2/notes/recents',
  '/api/j2/notes/favorites',
  '/api/j2/notes/graph',
]
const COUNT_VIEW_KEYS = [
  '/api/j2/notes/folder-counts',
  '/api/j2/note-folders',
  '/api/j2/notes/sector-theme-facets',
]

/** Is `key` one of the Notebook's note VIEWS (see the header)? */
export function isNoteViewKey(key, { tags = false, titleOnly = false } = {}) {
  if (typeof key !== 'string') return false
  if (key === '/api/j2/notes' || key.startsWith('/api/j2/notes?')) return true
  if (TITLE_VIEW_PREFIXES.some((p) => key === p || key.startsWith(`${p}?`))) return true
  if (titleOnly) return false
  if (COUNT_VIEW_KEYS.some((p) => key === p || key.startsWith(`${p}?`))) return true
  if (tags && (key === NOTE_TAGS_PREFIX || key.startsWith(`${NOTE_TAGS_PREFIX}?`) || key.startsWith(`${NOTE_TAGS_PREFIX}/`)
    || key.startsWith('/api/j2/notes/tag-members?'))) return true
  return false
}

/** Revalidate every note view. `mutate` defaults to SWR's global one (tests pass their own). */
export function invalidateNoteViews({ tags = false, titleOnly = false, mutate = globalMutate } = {}) {
  try {
    const p = mutate((key) => isNoteViewKey(key, { tags, titleOnly }))
    if (p && typeof p.catch === 'function') p.catch(() => {})
    return p
  } catch {
    return undefined
  }
}
