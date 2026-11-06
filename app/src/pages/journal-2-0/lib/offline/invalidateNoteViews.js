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
const NOTES = '/api/j2/notes'

/** ⛔ Fix round 1 (review finding 2): THE RULE IS INVERTED. The first cut was an allow-list of view
 *  keys, and it left out views the old `refreshSidebarCounts` reached (every `/api/j2/notes*` key):
 *  the Tasks view, the research page's summary, by-trade-ref, backlinks -- a trash left its tasks
 *  listed until a reload. Now EVERY `/api/j2/notes*` key is a view, except ONE NOTE's own key and
 *  its sub-resources (`/api/j2/notes/{id}`, `/api/j2/notes/{id}/...`). A path segment after
 *  `/api/j2/notes/` is a view word when it names a collection route; otherwise it is a note id.
 *  The words below are every `GET /notes/<word>` route the server mounts (railed against
 *  api/routers/journal_two.py, so a new one cannot be missed), plus the write-side collections the
 *  client keys (connectors, import, media, daily, batch, search, enrichment). */
export const NOTE_VIEW_WORDS = new Set([
  'attachments', 'backlinks', 'by-folders', 'by-trade-ref', 'documents', 'excerpts', 'export',
  'favorites', 'folder-counts', 'graph', 'import', 'link-targets', 'recents', 'research',
  'sector-theme-facets', 'switcher', 'tag-members', 'tags', 'tasks',
  // Audit 2026-11-05, S15: the Today home's one read. Not a title view: a title save does not re-ask it.
  'today',
  'connectors', 'media', 'daily', 'batch', 'search', 'enrichment',
])
/** Fix round 2 (re-review N2): the views that SHOW a note's title -- the only ones a title save asks
 *  again (with the list itself, every `/api/j2/notes?…` page, search results included). Documents,
 *  excerpts, connector status, the import notice and the counts cannot change with a title, and
 *  asking them on every landed autosave was load on the busiest edit in the product. */
// Fix round 3 (re-review 2, R2-1): tasks (each row names its note), the research page and the
// linked-notes panel (by-trade-ref) list notes by title too.
const TITLE_WORDS = new Set([
  'recents', 'favorites', 'by-folders', 'graph', 'switcher', 'link-targets', 'backlinks',
  'tasks', 'research', 'by-trade-ref',
])
/** The tag cloud (opt-in: the most expensive read). */
const TAG_WORDS = new Set(['tags', 'tag-members'])

/** Is `key` one of the Notebook's note VIEWS (see the header and the rule above)? */
export function isNoteViewKey(key, { tags = false, titleOnly = false } = {}) {
  if (typeof key !== 'string') return false
  if (key === '/api/j2/note-folders' || key.startsWith('/api/j2/note-folders?')) return !titleOnly
  if (key !== NOTES && !key.startsWith(`${NOTES}?`) && !key.startsWith(`${NOTES}/`)) return false
  if (key === NOTES || key.startsWith(`${NOTES}?`)) return true
  const word = key.slice(NOTES.length + 1).split(/[/?#]/, 1)[0]
  if (!NOTE_VIEW_WORDS.has(word)) return false           // one note's own key, or its sub-resource
  if (titleOnly) return TITLE_WORDS.has(word)
  if (TAG_WORDS.has(word)) return tags
  return true
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
