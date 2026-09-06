import { useEffect, useMemo, useRef, useState } from 'react'
import useJ2NoteFolders from '../../hooks/useJ2NoteFolders'
import useJ2Notes, { useJ2NoteFolderCounts, useJ2NotesByFolders } from '../../hooks/useJ2Notes'
import useJ2NoteTags from '../../hooks/useJ2NoteTags'
import UIcon from '../../../../components/ui/UIcon'
import styles from './FolderSidebar.module.css'

// Debounce before the search query reaches the server (below) — short enough
// to feel instant, long enough that fast typing doesn't fire a request per
// keystroke.
const SEARCH_DEBOUNCE_MS = 250
// Matches the panel's pre-existing display cap.
const SEARCH_RESULT_LIMIT = 100

// A migrated library (a decade of Evernote tags, say) can hand the tag cloud
// hundreds of distinct tags. The cloud already sorts by count descending
// (below) — that sort is the existing decision, kept as-is. This just caps
// how many render by default, with a "Show all tags" affordance + a filter
// input so a specific low-frequency tag stays reachable.
const TAG_CAP = 40

/**
 * Nest a flat folder list into a tree. A folder whose `parentId` doesn't
 * resolve to another folder in the set (null, or pointing at something
 * missing/deleted) becomes a root — defensive against drift between the
 * folder list and a stale parentId. Children (and roots) are sorted by
 * (sortOrder, name) so ties are still deterministic.
 */
export function buildFolderTree(folders) {
  const byId = new Map(folders.map((f) => [f.id, { ...f, children: [] }]))
  const roots = []
  for (const f of folders) {
    const node = byId.get(f.id)
    const parent = f.parentId != null ? byId.get(f.parentId) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const byOrderThenName = (a, b) =>
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name))
  const sortTree = (nodes) => {
    nodes.sort(byOrderThenName)
    for (const n of nodes) sortTree(n.children)
    return nodes
  }
  return sortTree(roots)
}

// Wave 4 Slice 2: turns a snippet()/highlight() string (real text with
// literal `<mark>`/`</mark>` delimiters SQLite inserted) into safe React
// children — split-and-render, NEVER dangerouslySetInnerHTML. The member's
// own note content is untrusted plain text that could itself contain `<`/
// `>` characters; every non-delimiter chunk below is rendered as a plain
// string child, which React escapes automatically. The one accepted edge
// case (a member's own text literally containing the substring "<mark>")
// would mis-render as a highlight boundary, never as executable markup —
// a display quirk, not a security issue.
export function renderSnippetMarks(snippet) {
  if (!snippet) return null
  const parts = snippet.split(/(<mark>|<\/mark>)/)
  const nodes = []
  let marking = false
  parts.forEach((part, i) => {
    if (part === '<mark>') { marking = true; return }
    if (part === '</mark>') { marking = false; return }
    if (!part) return
    nodes.push(marking ? <mark key={i}>{part}</mark> : part)
  })
  return nodes
}

// Wave 4 Slice 2: for a result with NO snippet (a tag/ticker-only match —
// the non-FTS5 OR-branch in _notes_filter_sql), explain what DID match
// instead of rendering a blank or misleading body excerpt. Mirrors the
// same leading-separator strip as the backend's own $NVDA fix so "$NVDA"
// and "NVDA" explain identically.
export function matchReasonFor(note, query) {
  const q = (query || '').trim()
  if (!q) return null
  const exactTicker = q.replace(/^[^\w]+/, '').toUpperCase()
  if (note.ticker && note.ticker === exactTicker) return `Matched ticker: ${note.ticker}`
  const qLower = q.toLowerCase()
  const tagHit = (note.tags || []).find((t) => String(t).toLowerCase() === qLower)
  if (tagHit) return `Matched tag: ${tagHit}`
  return null
}

function Chevron({ expanded }) {
  return (
    <svg
      className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}
      width="10"
      height="10"
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      <path
        d="M3 4.5 6 7.5 9 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function NoteIcon() {
  return (
    <svg
      className={styles.noteIcon}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M6 2.5h8L18.5 7v14.5H6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M13.5 2.5V7h4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8.5 12h7M8.5 15.5h7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

// Collapse-panel glyph (rounded frame, left column filled) — the header's
// "hide the panel" control.
function PanelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4.75" width="18" height="14.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <line x1="9.5" y1="4.75" x2="9.5" y2="19.25" stroke="currentColor" strokeWidth="1.7" />
      <rect x="4.9" y="6.4" width="3.1" height="11.2" rx="1" fill="currentColor" opacity="0.5" />
    </svg>
  )
}

function FolderModeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 6.5a2 2 0 0 1 2-2h3.3l1.8 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SearchModeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <line x1="14.8" y1="14.8" x2="20" y2="20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function FolderNode({
  node,
  depth,
  activeFolderId,
  onSelectFolder,
  onSelectTag,
  expandedIds,
  toggleExpanded,
  editingId,
  editName,
  setEditingId,
  setEditName,
  submitRename,
  onDelete,
  onStartAddChild,
  addForm,
  notesByFolder,
  folderCounts,
  expandedFolderNotes,
  onOpenNote,
  activeNoteId,
}) {
  const pageNotes = notesByFolder.get(node.id) || []
  // P0-2 fix: `folderCounts` is the TRUE whole-library per-folder count
  // (`undefined` while still loading — see useJ2NoteFolderCounts's own
  // comment). Once it has genuinely loaded, a folder ABSENT from it really
  // has 0 active notes, so this is authoritative and must win over the
  // page-derived guess below (which only ever reflects the ONE capped,
  // alphabetically-sorted page handed down as `notes` — the root cause of a
  // folder whose notes all sorted past that page's cutoff rendering with no
  // arrow at all, independent of the folder's own real size).
  const honestCount = folderCounts ? (folderCounts[node.id] ?? 0) : null
  // Once a folder is expanded, prefer its real per-folder fetch
  // (`expandedFolderNotes`, honestly complete up to the server's own cap);
  // fall back to the page-derived guess only for the brief window between
  // expanding and that fetch resolving.
  const folderNotes = expandedFolderNotes[node.id] ?? pageNotes
  // A folder is expandable when it holds subfolders OR notes — so a subfolder
  // that contains only notes still gets a disclosure arrow (matches the folder
  // tree the user asked for).
  const hasChildren = node.children.length > 0 ||
    (honestCount !== null ? honestCount > 0 : pageNotes.length > 0)
  const isExpanded = expandedIds.has(node.id)
  const isEditing = editingId === node.id
  const isAddingHere = addForm.parentId === node.id && addForm.active

  return (
    <div className={styles.folderItem}>
      <div className={styles.rowWrap} style={{ paddingLeft: depth * 14 }}>
        {hasChildren ? (
          <button
            type="button"
            className={styles.disclosureBtn}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.name}`}
            aria-expanded={isExpanded}
            onClick={(e) => { e.stopPropagation(); toggleExpanded(node.id) }}
          >
            <Chevron expanded={isExpanded} />
          </button>
        ) : (
          <span className={styles.disclosureSpacer} aria-hidden="true" />
        )}
        {isEditing ? (
          <input
            className={styles.editInput}
            autoFocus
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={() => submitRename(node.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename(node.id)
              if (e.key === 'Escape') setEditingId(null)
            }}
          />
        ) : (
          <button
            type="button"
            className={`${styles.row} ${activeFolderId === node.id ? styles.rowActive : ''}`}
            onClick={() => { onSelectFolder(node.id); onSelectTag(null) }}
            onDoubleClick={() => { setEditingId(node.id); setEditName(node.name) }}
          >
            <span>{node.name}</span>
            <span className={styles.actions}>
              <span
                className={`${styles.iconBtn} ${styles.iconBtnAdd}`}
                onClick={(e) => { e.stopPropagation(); onStartAddChild(node.id) }}
                title="Add subfolder"
                aria-label={`Add subfolder to ${node.name}`}
              >+</span>
              <span
                className={styles.iconBtn}
                onClick={(e) => { e.stopPropagation(); onDelete(node.id, node.name) }}
                title="Delete folder"
              >×</span>
            </span>
          </button>
        )}
      </div>
      {isExpanded && (
        <div className={styles.childrenList} style={{ '--guide-x': `${depth * 14 + 7}px` }}>
          {node.children.map((child) => (
            <FolderNode
              key={child.id}
              node={child}
              depth={depth + 1}
              activeFolderId={activeFolderId}
              onSelectFolder={onSelectFolder}
              onSelectTag={onSelectTag}
              expandedIds={expandedIds}
              toggleExpanded={toggleExpanded}
              editingId={editingId}
              editName={editName}
              setEditingId={setEditingId}
              setEditName={setEditName}
              submitRename={submitRename}
              onDelete={onDelete}
              onStartAddChild={onStartAddChild}
              addForm={addForm}
              notesByFolder={notesByFolder}
              folderCounts={folderCounts}
              expandedFolderNotes={expandedFolderNotes}
              onOpenNote={onOpenNote}
              activeNoteId={activeNoteId}
            />
          ))}
          {folderNotes.map((note) => (
            <div
              key={note.id}
              className={styles.rowWrap}
              style={{ paddingLeft: (depth + 1) * 14 }}
            >
              <span className={styles.disclosureSpacer} aria-hidden="true" />
              <button
                type="button"
                className={`${styles.noteRow} ${activeNoteId === note.id ? styles.rowActive : ''}`}
                onClick={() => onOpenNote(note)}
                title={note.title?.trim() || 'Untitled'}
              >
                <NoteIcon />
                <span className={styles.noteTitle}>{note.title?.trim() || 'Untitled'}</span>
              </button>
            </div>
          ))}
          {isAddingHere && (
            <form onSubmit={addForm.onSubmit} className={styles.addForm} style={{ paddingLeft: (depth + 1) * 14 }}>
              <input
                autoFocus
                className={styles.editInput}
                value={addForm.value}
                onChange={(e) => addForm.onChange(e.target.value)}
                onBlur={addForm.onBlur}
                onKeyDown={addForm.onKeyDown}
                placeholder="Folder name"
              />
            </form>
          )}
        </div>
      )}
    </div>
  )
}

export default function FolderSidebar({
  notes,
  // The TRUE "All notes" total (from SQL, via the parent's unfiltered
  // useJ2Notes call) — a migrated library's honest size, not the length of
  // the `notes` page above. Optional so existing callers/tests that only
  // pass `notes` still render (falls back to `notes.length`, the old,
  // page-capped behavior) — see the badge below.
  notesTotal,
  activeFolderId,
  onSelectFolder,
  activeTag,
  onSelectTag,
  onOpenNote = () => {},
  activeNoteId = null,
  onToggleSidebar = () => {},
}) {
  const { folders, create, rename, remove } = useJ2NoteFolders()
  const [adding, setAdding] = useState(false)
  const [parentForNew, setParentForNew] = useState(null)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  // Panel mode: the folder tree, or a full-panel note search (Obsidian-style).
  const [mode, setMode] = useState('folders')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const searchInputRef = useRef(null)
  const [tagFilter, setTagFilter] = useState('')
  const [showAllTags, setShowAllTags] = useState(false)
  // Wave 4 (Search Evolution I): date/sector/theme filters, collapsed
  // behind a toggle by default -- the design doc's own "don't overcomplicate
  // Stage 1" instruction. `showFilters` starts false so a member who just
  // wants to type-and-search never sees them.
  const [showFilters, setShowFilters] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sectorFilter, setSectorFilter] = useState('')
  const [themeFilter, setThemeFilter] = useState('')
  const hasActiveFilters = Boolean(dateFrom || dateTo || sectorFilter || themeFilter)

  useEffect(() => {
    if (mode === 'search') searchInputRef.current?.focus()
  }, [mode])

  const trimmedQuery = query.trim()

  // Debounce the query before it reaches the server. Clearing the box clears
  // the debounced value immediately (no reason to wait 250ms to blank it).
  useEffect(() => {
    if (!trimmedQuery) { setDebouncedQuery(''); return undefined }
    const t = setTimeout(() => setDebouncedQuery(trimmedQuery), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [trimmedQuery])

  const tree = useMemo(() => buildFolderTree(folders), [folders])

  // P0-2 fix: the TRUE whole-library per-folder count, never derived from
  // the one capped page of `notes` below — see useJ2NoteFolderCounts's own
  // comment and FolderNode's `honestCount`.
  const { counts: folderCountsFromServer } = useJ2NoteFolderCounts()
  // The actual note rows for the tree's leaf rows, scoped to only the
  // CURRENTLY-EXPANDED folders (never the whole library in one page) —
  // sorted so re-render order never changes the SWR cache key.
  const expandedIdsArray = useMemo(() => [...expandedIds].sort(), [expandedIds])
  const { byFolder: expandedFolderNotes } = useJ2NotesByFolders(expandedIdsArray)

  // Group notes under their folder so the tree can render them as leaf rows.
  // Sorted by title for a stable, scannable order.
  const notesByFolder = useMemo(() => {
    const m = new Map()
    for (const n of notes) {
      if (!n.folderId) continue
      if (!m.has(n.folderId)) m.set(n.folderId, [])
      m.get(n.folderId).push(n)
    }
    for (const list of m.values()) {
      list.sort((a, b) =>
        String(a.title || '').localeCompare(String(b.title || '')))
    }
    return m
  }, [notes])

  // Honest "Unfiled" badge. `notes` (the prop) is one loaded page, so a
  // client-side `.filter(n => !n.folderId).length` over it is capped the
  // exact same way the old "All notes" badge was — a migrated library with
  // more unfiled notes than fit on one page would undercount here too. Ask
  // the server for the TRUE count instead (cheap: `limit: 1` means only
  // `total` is read, the single row is discarded).
  const { total: unfiledTotalFromServer } = useJ2Notes({ folderId: '__unfiled__', limit: 1 })

  // Wave 0 trash: same honest-count idiom as Unfiled above, over the
  // deleted=true view.
  const { total: trashTotalFromServer } = useJ2Notes({ deleted: true, limit: 1 })

  // Server-backed search. `notes` (the prop) is only ONE loaded page, and its
  // `bodyPlain` is truncated to 400 chars in SQL for the list view — filtering
  // it client-side silently misses anything past that on a migrated library,
  // and fails as "no results" rather than an error. GET /api/j2/notes?q=
  // already runs the real FTS5 index (over the FULL body) for this, so route
  // the query there instead of re-deriving a second, worse search here.
  //
  // Gated on `mode === 'search'` + a non-empty debounced query so the fetch
  // fires only while the panel is actually searching — otherwise useJ2Notes's
  // SWR key would be non-null on every render (folder mode included) and
  // fire a redundant `/api/j2/notes` default-list request nobody asked for.
  // Wave 4: a filters-only search (empty query, just a date/sector/theme
  // bound) is an explicitly supported combination per the design doc's
  // combined-search contract ("date-range and entity filters both work
  // standalone") — gating solely on `debouncedQuery` would silently do
  // nothing the moment a member set a filter without also typing a word.
  const searchEnabled = mode === 'search' && Boolean(debouncedQuery || hasActiveFilters)
  const {
    notes: serverSearchResults,
    isLoading: searchLoading,
    isValidating: searchValidating,
    error: searchError,
    // The TRUE match count (final-review C2 made this real on the payload;
    // this panel just never read it — B2). `hasMore`/`loadMore` back the
    // "Load more" control below, the SAME shape (and the SAME affordance)
    // NotebookTab already uses for its own honest "Showing N of M" — one
    // idiom for "there's more than fits on a page", not a second one invented
    // here.
    total: searchTotal,
    hasMore: searchHasMore,
    loadMore: searchLoadMore,
    isLoadingMore: searchIsLoadingMore,
  } = useJ2Notes({
    q: debouncedQuery || undefined,
    // Relevance ranking is opt-in server-side (sort="relevance") and only
    // takes effect when a real `q` is present — requesting it unconditionally
    // here is safe: a filters-only search (no q) falls back to updated_at
    // DESC exactly as before.
    sort: 'relevance',
    limit: SEARCH_RESULT_LIMIT,
    enabled: searchEnabled,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    sector: sectorFilter || undefined,
    theme: themeFilter || undefined,
  })

  // A query "in flight" — either still waiting out the debounce, or the fetch
  // itself hasn't resolved — must never render as "no results". That is the
  // same silent-emptiness failure this whole fix exists to close, just moved
  // one layer down: an empty moment mistaken for an empty result.
  const searching = Boolean(trimmedQuery) &&
    (trimmedQuery !== debouncedQuery || (searchEnabled && (searchLoading || searchValidating)))

  // Tag cloud counts, sorted by count descending — that sort is the
  // pre-existing decision; TAG_CAP + the filter below are additive.
  //
  // Final-review C5: this used to derive counts from `notes` (one loaded
  // page) — harmless while "All notes" was ALSO page-capped (both numbers
  // were consistently wrong together), but Task 11 gave the sidebar an
  // honest whole-library total, which turned this into a VISIBLE
  // self-contradiction (a true "All notes 5000" beside tag counts that sum
  // to at most 100) and meant `TAG_CAP` picked the top 40 of a biased
  // 100-note sample rather than the real distribution. Fixed the same way
  // as the honest Unfiled total: ask the server (`useJ2NoteTags` ->
  // `GET /api/j2/notes/tags` -> `notes.py::tag_counts`, a whole-library
  // COUNT, not a page). `tagCountsFromPage` is now ONLY the fallback while
  // the server hasn't answered yet (or for a caller/test that stubs the
  // hook away) — never blended with the server numbers, since a partial
  // merge would recreate the same "biased sample" defect this fix closes.
  const { tagCounts: serverTagCounts } = useJ2NoteTags()
  const tagCountsFromPage = useMemo(() => {
    const c = new Map()
    for (const n of notes) for (const t of (n.tags || [])) {
      c.set(t, (c.get(t) || 0) + 1)
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1])
  }, [notes])
  const tagCounts = serverTagCounts.length
    ? serverTagCounts.map((t) => [t.tag, t.count])
    : tagCountsFromPage

  const tagsOverCap = tagCounts.length > TAG_CAP

  // A filter match searches the FULL tag list (not just the capped slice) so
  // a low-frequency tag pushed off the visible cap is still reachable by name.
  const visibleTagCounts = useMemo(() => {
    const q = tagFilter.trim().toLowerCase()
    if (q) return tagCounts.filter(([t]) => t.toLowerCase().includes(q))
    if (showAllTags || !tagsOverCap) return tagCounts
    return tagCounts.slice(0, TAG_CAP)
  }, [tagCounts, tagFilter, showAllTags, tagsOverCap])

  // Fallback while the server total is unknown (still in flight, or the
  // request failed) OR for a test/caller that only supplies `notes` — the
  // honest `unfiledTotalFromServer` above wins whenever it's actually known.
  // ⛔ Final-review C2: this branch used to be UNREACHABLE in production —
  // `useJ2Notes` returned `total: 0` (never `undefined`) while loading, and
  // `0 ?? x` is `0`, so "Unfiled" showed a hard 0 on every notebook open
  // until the request resolved, and forever on a failed one. Fixed at the
  // hook (`total` is now genuinely `undefined` until the server answers),
  // so this fallback now actually executes during that window.
  const unfiledCountFromPage = useMemo(
    () => notes.filter((n) => !n.folderId).length,
    [notes],
  )
  const unfiledCount = unfiledTotalFromServer ?? unfiledCountFromPage

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const cancelAdd = () => {
    setAdding(false)
    setParentForNew(null)
    setNewName('')
  }

  const startAddChild = (parentId) => {
    // The add form renders inside the expanded children list — force it open
    // so a new subfolder is never typed into a spot the user can't see.
    setExpandedIds((prev) => {
      if (prev.has(parentId)) return prev
      const next = new Set(prev)
      next.add(parentId)
      return next
    })
    setParentForNew(parentId)
    setAdding(true)
    setNewName('')
  }

  const submitNew = async (e) => {
    e.preventDefault()
    if (!newName.trim()) return
    try {
      await create(newName.trim(), parentForNew || undefined)
      cancelAdd()
    } catch (err) {
      alert(String(err.message || err))
    }
  }

  const submitRename = async (id) => {
    if (!editName.trim()) { setEditingId(null); return }
    try {
      await rename(id, editName.trim())
    } catch (err) {
      alert(String(err.message || err))
    }
    setEditingId(null)
  }

  const onDelete = async (id, name) => {
    if (!confirm(`Delete folder "${name}"? Subfolders and notes move up one level.`)) return
    try {
      await remove(id)
      if (activeFolderId === id) onSelectFolder(null)
    } catch (err) {
      alert(String(err.message || err))
    }
  }

  const addForm = {
    active: adding,
    parentId: parentForNew,
    value: newName,
    onChange: setNewName,
    onSubmit: submitNew,
    onBlur: () => { if (!newName.trim()) cancelAdd() },
    onKeyDown: (e) => { if (e.key === 'Escape') cancelAdd() },
  }

  return (
    <aside className={styles.sidebar}>
      {/* Header toolbar: collapse + mode switch (Folders / Search). */}
      <div className={styles.sbHeader}>
        <button
          type="button"
          className={styles.sbHeaderBtn}
          onClick={onToggleSidebar}
          aria-label="Hide folders panel"
          title="Hide panel"
        >
          <PanelIcon />
        </button>
        <div className={styles.sbHeaderModes} role="tablist" aria-label="Panel view">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'folders'}
            className={`${styles.sbHeaderBtn} ${mode === 'folders' ? styles.sbHeaderBtnActive : ''}`}
            onClick={() => setMode('folders')}
            title="Folders"
            aria-label="Show folders"
          >
            <FolderModeIcon />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'search'}
            className={`${styles.sbHeaderBtn} ${mode === 'search' ? styles.sbHeaderBtnActive : ''}`}
            onClick={() => setMode('search')}
            title="Search notes"
            aria-label="Search notes"
          >
            <SearchModeIcon />
          </button>
        </div>
      </div>

      {mode === 'search' ? (
        <div className={styles.searchView}>
          <div className={styles.searchInputWrap}>
            <span className={styles.searchInputIcon} aria-hidden="true"><SearchModeIcon /></span>
            <input
              ref={searchInputRef}
              type="text"
              className={styles.searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes…"
              onKeyDown={(e) => {
                if (e.key === 'Escape') { if (query) setQuery(''); else setMode('folders') }
                if (e.key === 'Enter' && serverSearchResults[0]) onOpenNote(serverSearchResults[0])
              }}
            />
            {query && (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => { setQuery(''); searchInputRef.current?.focus() }}
                aria-label="Clear search"
              >×</button>
            )}
            {/* Wave 4 Slice 1/3: collapsed by default -- a member who just
                wants to type-and-search never sees this. */}
            <button
              type="button"
              className={`${styles.searchFilterToggle} ${hasActiveFilters ? styles.searchFilterToggleActive : ''}`}
              onClick={() => setShowFilters((s) => !s)}
              aria-expanded={showFilters}
              aria-label="Search filters"
              title="Filter by date, sector, or theme"
            >
              <UIcon name="sliders" size={13} gold={false} />
            </button>
          </div>

          {showFilters && (
            <div className={styles.searchFilters}>
              <label className={styles.searchFilterField}>
                <span>Note created from</span>
                <input type="date" value={dateFrom} max={dateTo || undefined}
                  onChange={(e) => setDateFrom(e.target.value)} />
              </label>
              <label className={styles.searchFilterField}>
                <span>to</span>
                <input type="date" value={dateTo} min={dateFrom || undefined}
                  onChange={(e) => setDateTo(e.target.value)} />
              </label>
              <label className={styles.searchFilterField}>
                <span>Sector</span>
                <input type="text" value={sectorFilter} placeholder="e.g. Technology"
                  onChange={(e) => setSectorFilter(e.target.value)} />
              </label>
              <label className={styles.searchFilterField}>
                <span>Theme</span>
                <input type="text" value={themeFilter} placeholder="e.g. AI Infrastructure"
                  onChange={(e) => setThemeFilter(e.target.value)} />
              </label>
              {hasActiveFilters && (
                <button
                  type="button"
                  className={styles.searchFilterClear}
                  onClick={() => { setDateFrom(''); setDateTo(''); setSectorFilter(''); setThemeFilter('') }}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

          {!trimmedQuery && !hasActiveFilters ? (
            <div className={styles.searchHint}>Search titles and content by word, or match an exact tag or ticker.</div>
          ) : searching ? (
            <div className={styles.searchHint} role="status">Searching…</div>
          ) : searchError ? (
            <div className={styles.searchEmpty}>Search failed — try again.</div>
          ) : serverSearchResults.length ? (
            <div className={styles.searchResults}>
              {/* Honest "Showing N of M" — never the loaded page's length
                  standing in for the answer (B2). `?? serverSearchResults.length`
                  is defensive only: this branch can't actually reach `total ===
                  undefined` (a non-empty `serverSearchResults` implies the
                  response that produced it also carried `total`), mirroring
                  NotebookTab's own comment on the identical fallback. */}
              <div className={styles.searchCount}>
                Showing {serverSearchResults.length} of {searchTotal ?? serverSearchResults.length} note{(searchTotal ?? serverSearchResults.length) === 1 ? '' : 's'}
              </div>
              {serverSearchResults.map((n) => {
                const title = n.title?.trim() || 'Untitled'
                // Wave 4 Slice 2: a query-aware snippet (highlighted around
                // the actual match) when the server provided one; a
                // tag/ticker-only match (no FTS hit) falls back to the
                // "why matched" label instead of a blank/misleading body
                // excerpt; a filters-only search (no query at all) shows
                // neither — the naive first-120-chars slice this replaces
                // never explained a match either, so this is strictly more
                // honest, never less.
                const hasSnippet = Boolean(n.bodySnippet || n.titleSnippet)
                const reason = !hasSnippet ? matchReasonFor(n, trimmedQuery) : null
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={`${styles.searchResultRow} ${activeNoteId === n.id ? styles.rowActive : ''}`}
                    onClick={() => onOpenNote(n)}
                  >
                    <NoteIcon />
                    <span className={styles.searchResultBody}>
                      <span className={styles.searchResultTitle}>
                        {n.titleSnippet ? renderSnippetMarks(n.titleSnippet) : title}
                      </span>
                      {n.bodySnippet ? (
                        <span className={styles.searchResultSnippet}>{renderSnippetMarks(n.bodySnippet)}</span>
                      ) : reason ? (
                        <span className={styles.searchResultReason}>{reason}</span>
                      ) : null}
                    </span>
                  </button>
                )
              })}
              {searchHasMore && (
                <button
                  type="button"
                  className={styles.searchLoadMoreBtn}
                  onClick={searchLoadMore}
                  disabled={searchIsLoadingMore}
                >
                  <UIcon name="chevronDown" size={14} gold={false} />
                  {searchIsLoadingMore ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          ) : (
            <div className={styles.searchEmpty}>
              {trimmedQuery ? <>No notes match “{trimmedQuery}”.</> : 'No notes match these filters.'}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className={styles.section}>
            <div className={styles.rowWrap}>
              <span className={styles.disclosureSpacer} aria-hidden="true" />
              <button
                type="button"
                className={`${styles.row} ${activeFolderId == null && !activeTag ? styles.rowActive : ''}`}
                onClick={() => { onSelectFolder(null); onSelectTag(null) }}
              >
                <span>All notes</span>
                {/* The TRUE total (from SQL), never `notes.length` — that page
                    length is what capped this badge at 100 on a migrated
                    library. `notesTotal` is optional so a caller/test that
                    only supplies `notes` still renders (falls back to the old,
                    page-capped number). */}
                <span className={styles.count}>{notesTotal ?? notes.length}</span>
              </button>
            </div>
            <div className={styles.rowWrap}>
              <span className={styles.disclosureSpacer} aria-hidden="true" />
              <button
                type="button"
                className={`${styles.row} ${activeFolderId === '__unfiled__' ? styles.rowActive : ''}`}
                onClick={() => { onSelectFolder('__unfiled__'); onSelectTag(null) }}
              >
                <span>Unfiled</span>
                <span className={styles.count}>{unfiledCount}</span>
              </button>
            </div>
            <div className={styles.rowWrap}>
              <span className={styles.disclosureSpacer} aria-hidden="true" />
              <button
                type="button"
                className={`${styles.row} ${activeFolderId === '__trash__' ? styles.rowActive : ''}`}
                onClick={() => { onSelectFolder('__trash__'); onSelectTag(null) }}
              >
                <span>Trash</span>
                {/* No page-derived fallback here (unlike Unfiled) — the
                    `notes` prop never contains trashed notes at all, so a
                    client-side count would always read a false 0 while
                    loading. Show nothing rather than a wrong number. */}
                {trashTotalFromServer !== undefined && (
                  <span className={styles.count}>{trashTotalFromServer}</span>
                )}
              </button>
            </div>
            {tree.map((node) => (
              <FolderNode
                key={node.id}
                node={node}
                depth={0}
                activeFolderId={activeFolderId}
                onSelectFolder={onSelectFolder}
                onSelectTag={onSelectTag}
                expandedIds={expandedIds}
                toggleExpanded={toggleExpanded}
                editingId={editingId}
                editName={editName}
                setEditingId={setEditingId}
                setEditName={setEditName}
                submitRename={submitRename}
                onDelete={onDelete}
                onStartAddChild={startAddChild}
                addForm={addForm}
                notesByFolder={notesByFolder}
                folderCounts={folderCountsFromServer}
                expandedFolderNotes={expandedFolderNotes}
                onOpenNote={onOpenNote}
                activeNoteId={activeNoteId}
              />
            ))}
            {adding && parentForNew == null ? (
              <form onSubmit={submitNew} className={styles.addForm}>
                <input
                  autoFocus
                  className={styles.editInput}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onBlur={() => { if (!newName.trim()) cancelAdd() }}
                  onKeyDown={(e) => { if (e.key === 'Escape') cancelAdd() }}
                  placeholder="Folder name"
                />
              </form>
            ) : (
              <button
                type="button"
                className={styles.addBtn}
                onClick={() => { setParentForNew(null); setAdding(true); setNewName('') }}
              >
                + New folder
              </button>
            )}
          </div>

          {tagCounts.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Tags</div>
              {tagsOverCap && (
                <input
                  type="text"
                  className={styles.tagFilterInput}
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  placeholder="Filter tags…"
                  aria-label="Filter tags"
                />
              )}
              {visibleTagCounts.map(([t, c]) => (
                <button
                  key={t}
                  type="button"
                  className={`${styles.row} ${activeTag === t ? styles.rowActive : ''}`}
                  onClick={() => { onSelectTag(t); onSelectFolder(null) }}
                >
                  <span>#{t}</span>
                  <span className={styles.count}>{c}</span>
                </button>
              ))}
              {tagFilter.trim() && visibleTagCounts.length === 0 && (
                <div className={styles.searchEmpty}>No tags match “{tagFilter.trim()}”.</div>
              )}
              {tagsOverCap && !showAllTags && !tagFilter.trim() && (
                <button
                  type="button"
                  className={styles.addBtn}
                  onClick={() => setShowAllTags(true)}
                >
                  Show all tags ({tagCounts.length})
                </button>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  )
}
