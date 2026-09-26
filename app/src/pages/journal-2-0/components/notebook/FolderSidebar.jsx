import { useEffect, useMemo, useRef, useState } from 'react'
import useJ2NoteFolders from '../../hooks/useJ2NoteFolders'
import useJ2Notes, {
  useJ2NoteFolderCounts, useJ2NotesByFolders, useJ2Favorites, useJ2Recents,
  useJ2SectorThemeFacets,
} from '../../hooks/useJ2Notes'
import useJ2NoteTags from '../../hooks/useJ2NoteTags'
import useDocumentSearch from '../../hooks/useDocumentSearch'
import useExcerptSearch from '../../hooks/useExcerptSearch'
import useReviewSearch from '../../hooks/useReviewSearch'
import { searchResultTitle, searchResultHint, reviewDateText }
  from '../../lib/searchResultLabel'
import { outcomeLabel } from '../../lib/reviewOutcomes'
import { searchResultTarget } from '../../lib/searchNavigation'
import { isScannedText, SCANNED_TEXT_LABEL, SCANNED_TEXT_HINT }
  from '../../lib/documentProvenance'
import UIcon from '../../../../components/ui/UIcon'
import ConfirmModal from '../ConfirmModal'
import { SkeletonLine } from '../../../../components/Skeleton'
import { VIEW_MODES } from '../../lib/savedViewModes'
import { useOpenFromList } from '../../lib/splitView'
import {
  ancestorKeys, buildTagTree, fallbackNodes, hasNestedTags, tagKey,
} from '../../lib/tagTree'
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
// ⛔ Wave 7 whole-branch fix, ruling D-H8: the armed meaning search APPENDS rows past the
// lexical list with `matchKind: "meaning"` (note_semantic.append_meaning_hits). Such a row matched
// no word of the query, so it says why it is there -- never a bare title that reads as a match.
export const RELATED_BY_MEANING = 'Related by meaning'
export const isMeaningRow = (note) => note?.matchKind === 'meaning'

export function matchReasonFor(note, query) {
  if (isMeaningRow(note)) return RELATED_BY_MEANING
  const q = (query || '').trim()
  if (!q) return null
  const exactTicker = q.replace(/^[^\w]+/, '').toUpperCase()
  if (note.ticker && note.ticker === exactTicker) return `Matched ticker: ${note.ticker}`
  const qLower = q.toLowerCase()
  const tagHit = (note.tags || []).find((t) => String(t).toLowerCase() === qLower)
  if (tagHit) return `Matched tag: ${tagHit}`
  return null
}

/**
 * The search list's count line. `total` is the LEXICAL count (count_notes); rows the meaning
 * search appended sit past it, so "Showing 7 of 2 notes" was the naive reading (D-H8). With
 * related rows present the line says what the list holds: "7 shown: 2 matches, 5 related".
 */
export function searchCountText(rows, total) {
  const shown = rows.length
  const related = rows.filter(isMeaningRow).length
  const matches = total ?? (shown - related)
  if (related) {
    return `${shown} shown: ${matches} match${matches === 1 ? '' : 'es'}, ${related} related`
  }
  const all = total ?? shown
  return `Showing ${shown} of ${all} note${all === 1 ? '' : 's'}`
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

// Wave B: Favorites + Recents sidebar sections. Both populated-conditional
// (the whole section is absent from the DOM until the member has >=1 note in
// it — Notion's pattern, the strongest single finding of the competitor
// research: Evernote's overflow-menu-only entry point and Obsidian's
// no-native-recents-panel are the two things this deliberately does NOT
// copy) and both collapsible (local, unpersisted expand state — Recents is
// system-derived and capped small enough that collapsing rarely matters;
// Favorites can grow, so the affordance is there for a member who wants it
// out of the way without leaving the section itself invisible).
// ⛔⛔ D-40, 2026-09-22: both note-row buttons in this file (here, and
// FolderNode's own inline folder-notes list below) now carry
// `data-note-card-id`, the SAME identity NoteCard.jsx already gives the
// joystick hub (R-18) -- never `data-note-id`, which TipTap's inline
// note-link node already owns. The hub's cursor (notebookSection.js)
// queries `[data-note-card-id]` against the WHOLE document, so a note row
// with no such attribute was simply invisible to it, silently. Competitive
// audit finding UX #11 / Accessibility QW-6.
function RecencySection({ label, icon, notes, activeNoteId, onOpenNote }) {
  const [expanded, setExpanded] = useState(true)
  // Wave 6 item 7: Ctrl/Cmd+click opens the note beside (desktop split view).
  const openRow = useOpenFromList(onOpenNote)
  if (!notes.length) return null
  return (
    <div className={styles.section}>
      <div className={styles.rowWrap}>
        <button
          type="button"
          className={styles.disclosureBtn}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          <Chevron expanded={expanded} />
        </button>
        <span className={styles.sectionHeaderLabel}>
          <UIcon name={icon} size={12} gold={false} />
          {label}
        </span>
      </div>
      {expanded && notes.map((note) => (
        <div key={note.id} className={styles.rowWrap}>
          <span className={styles.disclosureSpacer} aria-hidden="true" />
          <button
            type="button"
            className={`${styles.noteRow} ${activeNoteId === note.id ? styles.rowActive : ''}`}
            onClick={(e) => openRow(note, e)}
            title={note.title?.trim() || 'Untitled'}
            data-note-card-id={note.id}
          >
            <NoteIcon />
            <span className={styles.noteTitle}>{note.title?.trim() || 'Untitled'}</span>
          </button>
        </div>
      ))}
    </div>
  )
}

// Wave E — Saved Views section. Same populated-conditional/collapsible
// shape as RecencySection above (checkpoint §20: zero nav clutter at zero
// saved views), adapted for a view (name + id) instead of a note (title).
//
// Wave G checkpoint §48: `onAddStarterViews` (present only once the member
// has zero saved views of their own) offers the four canonical thesis
// starter views as ONE click -- ordinary saved-view rows afterward, fully
// renameable/deletable, never a permanent fixture. It disappears the
// moment the member has any saved view (their own or the starter set), so
// nothing here becomes nav clutter for someone who doesn't use thesis
// properties at all.
function SavedViewsSection({ views, activeViewId, onSelectView, onRenameView, onDeleteView, onAddStarterViews }) {
  const [expanded, setExpanded] = useState(true)
  const [addingStarters, setAddingStarters] = useState(false)
  // ⛔⛔ UX #1, 2026-09-22: this section's own comment two paragraphs above
  // has always claimed saved views are "fully renameable/deletable" -- the
  // hook (useJ2SavedViews.js) always was; nothing in this component ever
  // called it. Mirrors FolderNode's exact rename-affordance pattern
  // (double-click OR a visible pencil icon opens an inline input; Enter/
  // blur submits, Escape cancels) so a member learns one interaction, not
  // two, for renaming anything in this sidebar.
  const [editingViewId, setEditingViewId] = useState(null)
  const [editViewName, setEditViewName] = useState('')
  const submitViewRename = (id) => {
    const trimmed = editViewName.trim()
    setEditingViewId(null)
    if (!trimmed) return // empty submit = cancel, never an empty-named view
    onRenameView(id, trimmed)
  }
  if (!views.length) {
    if (!onAddStarterViews) return null
    return (
      <div className={styles.section}>
        <div className={styles.rowWrap}>
          <button
            type="button"
            className={styles.starterViewsBtn}
            disabled={addingStarters}
            onClick={async () => {
              setAddingStarters(true)
              try { await onAddStarterViews() } finally { setAddingStarters(false) }
            }}
          >
            <UIcon name="sliders" size={12} gold={false} />
            {addingStarters ? 'Adding…' : 'Add thesis starter views'}
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className={styles.section}>
      <div className={styles.rowWrap}>
        <button
          type="button"
          className={styles.disclosureBtn}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} Saved Views`}
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          <Chevron expanded={expanded} />
        </button>
        <span className={styles.sectionHeaderLabel}>
          <UIcon name="sliders" size={12} gold={false} />
          Saved Views
        </span>
      </div>
      {/*
        ⛔ THREE SIBLING BUTTONS, NEVER A BUTTON INSIDE A BUTTON (wave 7 lane J, J5). The
        row used to be the select <button> with Rename/Delete nested INSIDE it as spans:
        invalid HTML, two controls no keyboard could reach, and an accessible name that
        concatenated all three. `title={view.name}` stays on the select button ALONE --
        the wave-6 walk locates the row with `get_by_title(view_name)` -- and the two
        controls keep the literal titles "Rename view"/"Delete view". `.viewRow` reveals
        them on hover AND on keyboard focus (`:focus-within`), so a Tab stop is never an
        invisible control. Rail: FolderSidebar.test.jsx, "...three sibling buttons...".
      */}
      {expanded && views.map((view) => (
        <div key={view.id} className={`${styles.rowWrap} ${styles.viewRow}`}>
          <span className={styles.disclosureSpacer} aria-hidden="true" />
          {editingViewId === view.id ? (
            <input
              className={styles.editInput}
              autoFocus
              value={editViewName}
              onChange={(e) => setEditViewName(e.target.value)}
              onBlur={() => submitViewRename(view.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitViewRename(view.id)
                if (e.key === 'Escape') setEditingViewId(null)
              }}
            />
          ) : (<>
            <button
              type="button"
              className={`${styles.noteRow} ${activeViewId === view.id ? styles.rowActive : ''}`}
              onClick={() => onSelectView(view)}
              onDoubleClick={() => { setEditingViewId(view.id); setEditViewName(view.name) }}
              title={view.name}
            >
              {/*
                ⛔ DERIVED FROM VIEW_MODES, NEVER A LIST/TABLE BINARY -- a saved
                Board/Calendar/Graph view used to render the same generic "rows"
                icon as List, a hand-typed second authority over data
                `lib/savedViewModes` already has correct. An unrecognised
                viewType (an older view, or one saved by a newer client) falls
                back to `rows`, matching FALLBACK_VIEW_MODE ('list'). Competitive
                audit finding UX #6, 2026-09-22. `data-view-icon` is a test seam
                only, not a product attribute.
              */}
              <UIcon
                name={VIEW_MODES.find((m) => m.id === view.viewType)?.icon || 'rows'}
                size={13}
                gold={false}
                data-view-icon={VIEW_MODES.find((m) => m.id === view.viewType)?.icon || 'rows'}
              />
              <span className={styles.noteTitle}>{view.name}</span>
            </button>
            <span className={styles.actions}>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => { setEditingViewId(view.id); setEditViewName(view.name) }}
                title="Rename view"
                aria-label={`Rename ${view.name}`}
              ><UIcon name="edit" size={11} gold={false} /></button>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => onDeleteView(view.id, view.name)}
                title="Delete view"
                aria-label={`Delete ${view.name}`}
              ><UIcon name="x" size={11} gold={false} /></button>
            </span>
          </>)}
        </div>
      ))}
    </div>
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

/**
 * Wave 6 fix round 2, I4 (remainder) — the ONE tag-row rename control shared
 * by all three row kinds (nested `TagNode`, the flat-library rows and the
 * filtered-search rows): the select button (with an optional disclosure slot
 * for the nested tree), the "Rename" pencil, and the inline preview-and-input
 * panel when this row's own path is the one being renamed. Round 1 built this
 * only inside `TagNode`, so a library with no `/` in any tag — every library
 * that predates wave 5's nested tags — could not rename a tag at all. A fix
 * to the affordance (or its touch sizing, M7) now lands once, not three times.
 *
 * The select button and the panel are SIBLINGS (a Fragment), matching the
 * pre-existing layout: the panel must sit BELOW the row, never inside its
 * flex line, so callers render this as the sole children of a block-level
 * wrapper (`folderItem` for nested/flat/filtered alike).
 */
function TagRenameableRow({
  path, label, total, active, onSelect, ariaLabel, title, depth = 0, disclosure = null,
  // Wave 6 fix round 2, M6: `false` when the caller gave FolderSidebar no
  // `onRenameTag` at all — the same "hide, never a live control that
  // silently does nothing" rule NoteMenuActions already applies to its own
  // optional `onOpenBeside` (shown only when given).
  renameEnabled = true,
  renaming, preview, renameValue, renameBusy,
  onStartRename, onRenameChange, onSubmitRename, onCancelRename,
}) {
  const isRenaming = renameEnabled && renaming === path
  return (
    <>
      <div className={styles.rowWrap} style={{ paddingLeft: depth * 14 }}>
        {disclosure || <span className={styles.disclosureSpacer} aria-hidden="true" />}
        <button
          type="button"
          className={`${styles.row} ${active ? styles.rowActive : ''}`}
          onClick={onSelect}
          aria-current={active ? 'true' : undefined}
          aria-label={ariaLabel}
          title={title}
        >
          <span>{label}</span>
          <span className={styles.count}>{total}</span>
        </button>
        {renameEnabled && (
          <button
            type="button"
            className={styles.renameTagBtn}
            onClick={(e) => { e.stopPropagation(); onStartRename(path) }}
            title="Rename tag"
            aria-label={`Rename ${path}`}
          >
            <UIcon name="edit" size={12} gold={false} />
          </button>
        )}
      </div>
      {isRenaming && (
        <div className={styles.tagRenamePanel} style={{ paddingLeft: depth * 14 + 20 }}>
          <div className={styles.tagRenamePreview} role="status">
            {(!preview || preview.status === 'loading') && 'Checking which notes this touches…'}
            {preview?.status === 'error' && "Couldn't check which notes this touches. Nothing was renamed."}
            {preview?.status === 'ready' && (
              preview.total === 0
                ? `No live notes carry #${path} right now.`
                : `Renaming #${path} will affect ${preview.total} ${preview.total === 1 ? 'note' : 'notes'}: ${
                  preview.notes.slice(0, 3).map((n) => n.title || 'Untitled').join(', ')
                }${preview.total > 3 ? `, and ${preview.total - 3} more` : ''}.`
            )}
          </div>
          <input
            className={styles.tagRenameInput}
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            aria-label={`Rename tag ${path}`}
            disabled={renameBusy}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmitRename()
              if (e.key === 'Escape') onCancelRename()
            }}
          />
          <button
            type="button"
            className={styles.tagRenameActionBtn}
            onClick={onSubmitRename}
            disabled={renameBusy || preview?.status !== 'ready' || !preview.notes.length}
          >
            {renameBusy ? 'Renaming…' : 'Rename'}
          </button>
          <button type="button" className={styles.tagRenameActionBtn} onClick={onCancelRename} disabled={renameBusy}>
            Cancel
          </button>
        </div>
      )}
    </>
  )
}

/**
 * Wave 5 nested tags: one level of the tag tree. A parent's count is the
 * DISTINCT notes in its whole subtree (server-computed) — and choosing a
 * parent shows exactly those notes, children included, because the `tag=`
 * filter treats a tag as the parent of every `tag/…` below it.
 */
function TagNode({
  node, activeTagKey, expandedKeys, onToggle, onSelect,
  // Wave 6 fix round 1, I4 — item 8's rename, client side. `renaming` is the
  // full path currently open for rename (or null); `preview` is the
  // GET /notes/tag-members answer for it (`{status, notes, total}`).
  renaming = null, preview = null, renameValue = '', renameBusy = false,
  onStartRename = () => {}, onRenameChange = () => {}, onSubmitRename = () => {}, onCancelRename = () => {},
  // Wave 6 fix round 2, M6 — false when FolderSidebar's own `onRenameTag`
  // prop was not given.
  renameEnabled = true,
}) {
  const hasChildren = node.children.length > 0
  const expanded = expandedKeys.has(node.key)
  const active = activeTagKey === node.key
  const noteWord = node.total === 1 ? 'note' : 'notes'
  return (
    <div className={styles.folderItem}>
      <TagRenameableRow
        path={node.path}
        label={node.depth === 0 ? `#${node.label}` : node.label}
        total={node.total}
        active={active}
        depth={node.depth}
        title={`#${node.path}`}
        ariaLabel={`Tag ${node.path}, ${node.total} ${noteWord}${hasChildren ? ' including the tags below it' : ''}`}
        onSelect={() => onSelect(node.path)}
        disclosure={hasChildren ? (
          <button
            type="button"
            className={styles.disclosureBtn}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} tag ${node.path}`}
            aria-expanded={expanded}
            onClick={() => onToggle(node.key)}
          >
            <Chevron expanded={expanded} />
          </button>
        ) : null}
        renameEnabled={renameEnabled}
        renaming={renaming}
        preview={preview}
        renameValue={renameValue}
        renameBusy={renameBusy}
        onStartRename={onStartRename}
        onRenameChange={onRenameChange}
        onSubmitRename={onSubmitRename}
        onCancelRename={onCancelRename}
      />
      {hasChildren && expanded && (
        <div className={styles.childrenList} style={{ '--guide-x': `${node.depth * 14 + 7}px` }}>
          {node.children.map((child) => (
            <TagNode
              key={child.key}
              node={child}
              activeTagKey={activeTagKey}
              expandedKeys={expandedKeys}
              onToggle={onToggle}
              onSelect={onSelect}
              renameEnabled={renameEnabled}
              renaming={renaming}
              preview={preview}
              renameValue={renameValue}
              renameBusy={renameBusy}
              onStartRename={onStartRename}
              onRenameChange={onRenameChange}
              onSubmitRename={onSubmitRename}
              onCancelRename={onCancelRename}
            />
          ))}
        </div>
      )}
    </div>
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
  const openRow = useOpenFromList(onOpenNote)
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
              {/*
                ⛔ RENAME HAD ZERO VISUAL AFFORDANCE -- discoverable only by
                double-clicking, a desktop-file-manager convention this
                product never taught. Wired to the SAME setEditingId/
                setEditName path onDoubleClick already uses, just given a
                visible door. Competitive audit finding UX #10, 2026-09-22.
              */}
              <span
                className={styles.iconBtn}
                onClick={(e) => { e.stopPropagation(); setEditingId(node.id); setEditName(node.name) }}
                title="Rename folder"
                aria-label={`Rename ${node.name}`}
              ><UIcon name="edit" size={11} gold={false} /></span>
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
              ><UIcon name="x" size={11} gold={false} /></span>
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
                onClick={(e) => openRow(note, e)}
                title={note.title?.trim() || 'Untitled'}
                data-note-card-id={note.id}
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
  // Wave E: populated-conditional, same convention as Favorites/Recents
  // above -- renders nothing at zero saved views (checkpoint §20).
  savedViews = [],
  activeViewId = null,
  onSelectView = () => {},
  // UX #1, 2026-09-22: optional, default no-op so an existing caller/test
  // that only exercises selection still renders exactly as before.
  onRenameView = () => {},
  onDeleteView = () => {},
  onAddStarterViews = null,
  // Wave H: Research Home is now the bare-root state (checkpoint decision
  // 32/33) -- both null, same as "All notes" with no filter, so an explicit
  // flag is needed to keep the "All notes" row's active-highlight honest
  // rather than lighting up while Home (not the grid) is actually showing.
  // `onSelectAllNotes`, if supplied, replaces the row's default
  // onSelectFolder(null)+onSelectTag(null) click (adds the `?view=all` flag
  // that disambiguates the two states) -- falls back to the pre-Wave-H
  // behavior when omitted, so an existing caller/test is unaffected.
  isHome = false,
  onSelectAllNotes = null,
  // Wave 6 fix round 1, I4 — item 8's rename, client side: `(from, to,
  // noteIds) => Promise<void>`, the caller's own runBulk('renameTag', ...)
  // door. ⛔ M6 (wave 6 fix round 2): `null`, never a no-op default — a
  // no-op function let the whole preview-and-rename UI render and then
  // silently do nothing on submit. `null` makes `canRenameTags` below false,
  // which HIDES the Rename affordance entirely, the same rule
  // `NoteMenuActions` already applies to its own optional `onOpenBeside`.
  onRenameTag = null,
}) {
  const { folders, create, rename, remove } = useJ2NoteFolders()
  // Wave 6 item 7: a search hit opens beside on Ctrl/Cmd+click, like a row.
  const openSearchRow = useOpenFromList(onOpenNote)
  const [adding, setAdding] = useState(false)
  const [parentForNew, setParentForNew] = useState(null)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState(null)
  // Folder mutations used to fail into a native alert() carrying the raw
  // exception. One line, both defects the scorecard names; railed in
  // rawErrorSurface.test.js so it cannot come back.
  const [folderError, setFolderError] = useState('')
  const [editName, setEditName] = useState('')
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  // Panel mode: the folder tree, or a full-panel note search (Obsidian-style).
  const [mode, setMode] = useState('folders')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const searchInputRef = useRef(null)
  const [tagFilter, setTagFilter] = useState('')
  const [showAllTags, setShowAllTags] = useState(false)
  // Wave 6 fix round 1, I4 — item 8's rename, client side.
  // M6 (wave 6 fix round 2): the Rename affordance is HIDDEN, not a live
  // control that silently does nothing, when the caller gave no onRenameTag.
  const canRenameTags = typeof onRenameTag === 'function'
  const [renamingTag, setRenamingTag] = useState(null) // the full path being renamed, or null
  const [renamePreview, setRenamePreview] = useState(null) // {status, notes, total}
  const [renameValue, setRenameValue] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
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

  // Competitive-audit UX #9: the Sector/Theme fields used to be free-text
  // against an exact match with no way to discover a valid value (see
  // useJ2SectorThemeFacets's own comment) -- fetched only once the filter
  // panel is actually open, matching this whole section's "collapsed by
  // default, never fetch what nobody asked to see" discipline.
  const { sectors: sectorOptionsRaw, themes: themeOptionsRaw, isLoading: facetsLoading } =
    useJ2SectorThemeFacets({ enabled: showFilters })
  // Defensive: a currently-set value that isn't (yet, or any longer) in the
  // fetched option list must still render as the select's chosen option
  // rather than silently blanking out from under the member.
  const sectorOptions = sectorFilter && !(sectorOptionsRaw || []).includes(sectorFilter)
    ? [sectorFilter, ...(sectorOptionsRaw || [])] : (sectorOptionsRaw || [])
  const themeOptions = themeFilter && !(themeOptionsRaw || []).includes(themeFilter)
    ? [themeFilter, ...(themeOptionsRaw || [])] : (themeOptionsRaw || [])

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
  // Wave 6: the Archived badge is its OWN list's total — the list the entry
  // opens — never a second count that could disagree with it (same as Trash).
  const { total: archivedTotalFromServer } = useJ2Notes({ folderId: '__archived__', limit: 1 })

  // Wave B: Favorites + Recents. Both trash-aware server-side (see
  // notes_service.list_favorites/list_recents) — no client-side filtering
  // needed here.
  const { notes: favoriteNotes } = useJ2Favorites()
  const { notes: recentNotes } = useJ2Recents()

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
    // D-H9: this list renders "related by meaning" rows with their reason line (D-H8), so it is
    // the one that asks the server for them (`meaning=1`); no other notes list does.
    meaning: true,
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

  // Wave I: page-aware PDF search, sectioned SEPARATELY from note results
  // above (never blended into one list/score — checkpoint decision,
  // directive §39-42). Query-only (no date/sector/theme filter support —
  // those are note-property concepts a PDF page doesn't have).
  const { results: documentResults, isLoading: documentsSearching } =
    useDocumentSearch(debouncedQuery, { enabled: mode === 'search' })

  // Wave J: the member's own saved evidence — captured passages and the
  // annotations written on them. A THIRD section, for the same reason
  // Documents is a second one: a passage a member deliberately kept is not
  // the same kind of hit as a page the text happens to appear on, and
  // ranking them against each other would bury the curated one under the
  // raw. Query-only, matching Documents above.
  const { results: excerptResults, isLoading: excerptsSearching } =
    useExcerptSearch(debouncedQuery, { enabled: mode === 'search' })

  // Wave O6: the member's own completed reviews — what they DECIDED about a
  // thesis, in their words. A FOURTH section for the same reason Evidence is a
  // third: a conclusion reached after the fact is not the same kind of hit as
  // the material it was reached from, and ranking them together would bury the
  // one thing only this member could have written.
  const { results: reviewResults, isLoading: reviewsSearching } =
    useReviewSearch(debouncedQuery, { enabled: mode === 'search' })

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
  const { tagCounts: serverTagCounts, tagTree: serverTagTree } = useJ2NoteTags()
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

  // Wave 5 nested tags. The server's `tree` carries every node of the
  // `a/b/c` hierarchy with honest DISTINCT-note subtree totals; without it
  // (an older answer, the page fallback above) the nodes are derived from the
  // flat counts — exact for every flat tag, an upper bound for a parent.
  // ⛔ A LIBRARY WITH NO `/` IN ANY TAG DRAWS EXACTLY AS IT ALWAYS DID: same
  // rows, same counts, same order, same markup (`nestedTags` false below).
  const tagNodes = useMemo(
    () => (serverTagTree && serverTagTree.length && serverTagCounts.length
      ? serverTagTree
      : fallbackNodes(tagCounts.map(([tag, count]) => ({ tag, count })))),
    [serverTagTree, serverTagCounts.length, tagCounts],
  )
  const nestedTags = useMemo(() => hasNestedTags(tagNodes), [tagNodes])
  const tagRoots = useMemo(() => buildTagTree(tagNodes), [tagNodes])
  const activeTagKey = activeTag ? tagKey(activeTag) : null
  const [expandedTagKeys, setExpandedTagKeys] = useState(() => new Set())
  // The tag being browsed is always on screen: its parents open with it.
  useEffect(() => {
    if (!activeTagKey || !activeTagKey.includes('/')) return
    setExpandedTagKeys((prev) => {
      const want = ancestorKeys(activeTagKey).filter((k) => !prev.has(k))
      if (!want.length) return prev
      const next = new Set(prev)
      for (const k of want) next.add(k)
      return next
    })
  }, [activeTagKey])
  const toggleTagExpanded = (key) => setExpandedTagKeys((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const tagsOverCap = tagRoots.length > TAG_CAP

  // A filter match searches EVERY tag at every level (not just the capped
  // slice of top-level tags) so a low-frequency or deeply nested tag stays
  // reachable by name — listed by its full path, flat.
  const filteredTagNodes = useMemo(() => {
    const q = tagFilter.trim().toLowerCase().replace(/^#+/, '')
    if (!q) return null
    return tagNodes
      .map((n) => ({ key: n.key || tagKey(n.path), path: n.path, total: Number(n.total ?? 0) }))
      .filter((n) => n.path.toLowerCase().includes(q))
      .sort((a, b) => (b.total - a.total) || a.key.localeCompare(b.key))
  }, [tagNodes, tagFilter])
  const visibleTagRoots = useMemo(() => {
    if (showAllTags || !tagsOverCap) return tagRoots
    return tagRoots.slice(0, TAG_CAP)
  }, [tagRoots, showAllTags, tagsOverCap])

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
    setFolderError('')
    try {
      await create(newName.trim(), parentForNew || undefined)
      cancelAdd()
    } catch (err) {
      console.error('[notebook] create folder failed', err)
      setFolderError("Couldn't create that folder. Nothing was changed.")
    }
  }

  const submitRename = async (id) => {
    if (!editName.trim()) { setEditingId(null); return }
    try {
      await rename(id, editName.trim())
    } catch (err) {
      console.error('[notebook] rename folder failed', err)
      setFolderError("Couldn't rename that folder. It kept its old name.")
    }
    setEditingId(null)
  }

  // Wave 6 fix round 1, I4 — item 8's rename, client side: `GET
  // /notes/tag-members?tag=` for the "who it touches" preview, then the
  // caller's `onRenameTag` (its own batch `renameTag` op) once confirmed.
  const startTagRename = async (path) => {
    setRenamingTag(path)
    setRenameValue(path)
    setRenamePreview({ status: 'loading' })
    try {
      const res = await fetch(`/api/j2/notes/tag-members?tag=${encodeURIComponent(path)}`, { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      const body = await res.json()
      setRenamePreview({ status: 'ready', notes: body.notes || [], total: body.total || 0 })
    } catch {
      setRenamePreview({ status: 'error' })
    }
  }
  const cancelTagRename = () => {
    setRenamingTag(null)
    setRenamePreview(null)
    setRenameValue('')
  }
  const submitTagRename = async () => {
    const from = renamingTag
    const to = renameValue.trim()
    if (!from || !to || to === from || renamePreview?.status !== 'ready' || !renamePreview.notes.length) return
    setRenameBusy(true)
    try {
      await onRenameTag(from, to, renamePreview.notes.map((n) => n.id))
    } finally {
      setRenameBusy(false)
      cancelTagRename()
    }
  }

  // Wave B: native confirm() replaced with the shared ConfirmModal (G-103) —
  // request opens the modal (holding which folder), confirm performs the
  // actual mutation.
  const [deleteTarget, setDeleteTarget] = useState(null) // { id, name } | null
  const onDeleteRequest = (id, name) => setDeleteTarget({ id, name })
  const onDeleteConfirm = async () => {
    if (!deleteTarget) return
    const { id } = deleteTarget
    try {
      await remove(id)
      if (activeFolderId === id) onSelectFolder(null)
    } catch (err) {
      console.error('[notebook] delete folder failed', err)
      setFolderError("Couldn't delete that folder. Nothing was removed.")
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
    <aside className={styles.sidebar} data-tour="sidebar">
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
            data-tour="search"
          >
            <SearchModeIcon />
          </button>
        </div>
      </div>

      {folderError && (
        <div className={styles.folderError} role="alert">{folderError}</div>
      )}

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
              ><UIcon name="x" size={11} gold={false} /></button>
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
                <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)}>
                  <option value="">
                    {facetsLoading ? 'Loading…' : sectorOptions.length ? 'Any sector' : 'No sectors yet'}
                  </option>
                  {sectorOptions.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className={styles.searchFilterField}>
                <span>Theme</span>
                <select value={themeFilter} onChange={(e) => setThemeFilter(e.target.value)}>
                  <option value="">
                    {facetsLoading ? 'Loading…' : themeOptions.length ? 'Any theme' : 'No themes yet'}
                  </option>
                  {themeOptions.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
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
            <div className={styles.searchResultsSkeleton} role="status" aria-label="Searching…">
              {[0, 1, 2].map((i) => (
                <div key={i} className={styles.searchResultSkeletonRow}>
                  <SkeletonLine width="70%" height={12} />
                  <SkeletonLine width="90%" height={10} />
                </div>
              ))}
            </div>
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
                {searchCountText(serverSearchResults, searchTotal)}
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
                // D-H8: a meaning row always shows its reason, snippet or not.
                const meaningRow = isMeaningRow(n)
                const reason = (meaningRow || !hasSnippet) ? matchReasonFor(n, trimmedQuery) : null
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={`${styles.searchResultRow} ${activeNoteId === n.id ? styles.rowActive : ''}`}
                    onClick={(e) => openSearchRow(n, e)}
                  >
                    <NoteIcon />
                    <span className={styles.searchResultBody}>
                      <span className={styles.searchResultTitle}>
                        {n.titleSnippet ? renderSnippetMarks(n.titleSnippet) : title}
                      </span>
                      {n.bodySnippet && !meaningRow ? (
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

          {/* Wave I: Documents section — a SEPARATE result list from Notes
              above, never merged into one score. Only renders while there is
              something to say (a real query in flight, or real results) so
              an empty/filters-only search doesn't grow an extra empty block. */}
          {trimmedQuery && (documentsSearching || documentResults.length > 0) && (
            documentsSearching ? (
              // G-106 (Wave B lower-frequency sweep): same skeleton-row idiom
              // as the Notes search above, instead of a bare count string.
              <div className={styles.searchResultsSkeleton} role="status" aria-label="Searching documents…">
                {[0, 1].map((i) => (
                  <div key={i} className={styles.searchResultSkeletonRow}>
                    <SkeletonLine width="70%" height={12} />
                    <SkeletonLine width="90%" height={10} />
                  </div>
                ))}
              </div>
            ) : (
            <div className={styles.searchResults}>
              <div className={styles.searchCount}>
                {`${documentResults.length} document page${documentResults.length === 1 ? '' : 's'}`}
              </div>
              {documentResults.map((d) => (
                <button
                  key={`${d.documentId}-${d.pageNumber}`}
                  type="button"
                  className={styles.searchResultRow}
                  onClick={() => onOpenNote({ id: d.noteId },
                                             searchResultTarget(d, { kind: 'page' }))}
                  title={searchResultHint(d, { kind: 'page' })}
                >
                  {/* ⛔ The icon follows the KIND too: a captured web source is
                      not a filed document, and showing the document glyph for
                      it repeats the same false claim in another channel. */}
                  <UIcon name={d.sourceKind === 'web' ? 'link' : 'document'} size={12} gold={false} />
                  <span className={styles.searchResultBody}>
                    <span className={styles.searchResultTitle}>
                      {searchResultTitle(d, { kind: 'page' })}
                      {/* ⛔ WAVE P2 §21: ONLY WHEN THERE IS SOMETHING TO SAY.
                          A native page gets no chip — the label exists to warn
                          that exact figures were READ off an image, and putting
                          it on every row would make it invisible on the rows
                          that need it. It sits beside the page number because
                          that is where the member is already deciding whether
                          to open the page. */}
                      {isScannedText(d) && (
                        <span className={styles.scannedChip} title={SCANNED_TEXT_HINT}>
                          {SCANNED_TEXT_LABEL}
                        </span>
                      )}
                    </span>
                    <span className={styles.searchResultSnippet}>{renderSnippetMarks(d.snippet)}</span>
                  </span>
                </button>
              ))}
            </div>
            )
          )}

          {/* Wave J: Evidence section — the passages this member chose to
              keep, plus their annotations. Third and last, after Notes and
              Documents, each still its own list. Same render-only-when-it-
              has-something-to-say rule as Documents above. */}
          {trimmedQuery && (excerptsSearching || excerptResults.length > 0) && (
            excerptsSearching ? (
              // G-106 (Wave B lower-frequency sweep): same skeleton-row idiom
              // as the Notes search above, instead of a bare count string.
              <div className={styles.searchResultsSkeleton} role="status" aria-label="Searching evidence…">
                {[0, 1].map((i) => (
                  <div key={i} className={styles.searchResultSkeletonRow}>
                    <SkeletonLine width="70%" height={12} />
                    <SkeletonLine width="90%" height={10} />
                  </div>
                ))}
              </div>
            ) : (
            <div className={styles.searchResults}>
              <div className={styles.searchCount}>
                {`${excerptResults.length} saved excerpt${excerptResults.length === 1 ? '' : 's'}`}
              </div>
              {excerptResults.map((e) => (
                <button
                  key={e.excerptId}
                  type="button"
                  className={styles.searchResultRow}
                  onClick={() => onOpenNote({ id: e.noteId },
                                             searchResultTarget(e, { kind: 'excerpt' }))}
                  title={searchResultHint(e, { kind: 'excerpt' })}
                >
                  <UIcon name="quote" size={12} gold={false} />
                  <span className={styles.searchResultBody}>
                    <span className={styles.searchResultTitle}>
                      {searchResultTitle(e, { kind: 'excerpt' })}
                    </span>
                    <span className={styles.searchResultSnippet}>{renderSnippetMarks(e.snippet)}</span>
                  </span>
                </button>
              ))}
            </div>
            )
          )}

          {/* Wave O6: Thesis reviews — the member's own conclusions. Fourth and
              last, each section still its own list. ⛔ The row says "Thesis
              review" and carries the outcome the member chose: a result that
              rendered only their prose would make "I was wrong about this" and
              "no change" look like the same finding. */}
          {trimmedQuery && (reviewsSearching || reviewResults.length > 0) && (
            reviewsSearching ? (
              // G-106 (Wave B lower-frequency sweep): same skeleton-row idiom
              // as the Notes search above, instead of a bare count string.
              <div className={styles.searchResultsSkeleton} role="status" aria-label="Searching your reviews…">
                {[0, 1].map((i) => (
                  <div key={i} className={styles.searchResultSkeletonRow}>
                    <SkeletonLine width="70%" height={12} />
                    <SkeletonLine width="90%" height={10} />
                  </div>
                ))}
              </div>
            ) : (
            <div className={styles.searchResults}>
              <div className={styles.searchCount}>
                {`${reviewResults.length} thesis review${reviewResults.length === 1 ? '' : 's'}`}
              </div>
              {reviewResults.map((r) => (
                <button
                  key={r.reviewId}
                  type="button"
                  className={styles.searchResultRow}
                  onClick={() => onOpenNote({ id: r.noteId },
                                             searchResultTarget(r, { kind: 'review' }))}
                  title={searchResultHint(r, { kind: 'review' })}
                >
                  <UIcon name="clock" size={12} gold={false} />
                  <span className={styles.searchResultBody}>
                    <span className={styles.searchResultTitle}>
                      {searchResultTitle(r, { kind: 'review' })}
                    </span>
                    <span className={styles.searchResultSnippet}>{renderSnippetMarks(r.snippet)}</span>
                    {/* The decision itself, never inferred from the prose. */}
                    <span className={styles.searchResultMeta}>
                      {[outcomeLabel(r.outcome), reviewDateText(r.completedAt)]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            )
          )}
        </div>
      ) : (
        <>
          <RecencySection
            label="Favorites"
            icon="star-fill"
            notes={favoriteNotes}
            activeNoteId={activeNoteId}
            onOpenNote={onOpenNote}
          />
          <RecencySection
            label="Recents"
            icon="clock"
            notes={recentNotes}
            activeNoteId={activeNoteId}
            onOpenNote={onOpenNote}
          />
          <SavedViewsSection
            views={savedViews}
            activeViewId={activeViewId}
            onSelectView={onSelectView}
            onRenameView={onRenameView}
            onDeleteView={onDeleteView}
            onAddStarterViews={onAddStarterViews}
          />
          <div className={styles.section}>
            <div className={styles.rowWrap}>
              <span className={styles.disclosureSpacer} aria-hidden="true" />
              <button
                type="button"
                className={`${styles.row} ${activeFolderId == null && !activeTag && !isHome ? styles.rowActive : ''}`}
                onClick={onSelectAllNotes || (() => { onSelectFolder(null); onSelectTag(null) })}
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
              {/* Wave 6: archived notes leave every default list but are never
                  deleted — this is where they are, each still in its folder. */}
              <button
                type="button"
                className={`${styles.row} ${activeFolderId === '__archived__' ? styles.rowActive : ''}`}
                onClick={() => { onSelectFolder('__archived__'); onSelectTag(null) }}
              >
                <span>Archived</span>
                {archivedTotalFromServer !== undefined && (
                  <span className={styles.count}>{archivedTotalFromServer}</span>
                )}
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
                onDelete={onDeleteRequest}
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

          {tagNodes.length > 0 && (
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
              {filteredTagNodes ? (
                // Filtering: every matching tag at any level, by its full
                // path — sharing the ONE rename control with the flat and
                // nested rows (I4 remainder, wave 6 fix round 2): a filtered
                // match is reachable to rename exactly like any other row.
                filteredTagNodes.map((n) => (
                  <div key={n.key} className={styles.folderItem}>
                    <TagRenameableRow
                      path={n.path}
                      label={`#${n.path}`}
                      total={n.total}
                      active={activeTagKey === n.key}
                      onSelect={() => { onSelectTag(n.path); onSelectFolder(null) }}
                      renameEnabled={canRenameTags}
                      renaming={renamingTag}
                      preview={renamePreview}
                      renameValue={renameValue}
                      renameBusy={renameBusy}
                      onStartRename={startTagRename}
                      onRenameChange={setRenameValue}
                      onSubmitRename={submitTagRename}
                      onCancelRename={cancelTagRename}
                    />
                  </div>
                ))
              ) : !nestedTags ? (
                // ⛔ FLAT LIBRARY: the same rows this section always drew,
                // now sharing the rename control with the nested tree (I4
                // remainder, wave 6 fix round 2) — a library with no `/` in
                // any tag can rename a tag too. No `ariaLabel`/`title`: the
                // CONTROL in FolderSidebar.tags.test.jsx pins that the select
                // button itself carries no new accessible name.
                visibleTagRoots.map((n) => (
                  <div key={n.key} className={styles.folderItem}>
                    <TagRenameableRow
                      path={n.path}
                      label={`#${n.path}`}
                      total={n.total}
                      active={activeTagKey === n.key}
                      onSelect={() => { onSelectTag(n.path); onSelectFolder(null) }}
                      renameEnabled={canRenameTags}
                      renaming={renamingTag}
                      preview={renamePreview}
                      renameValue={renameValue}
                      renameBusy={renameBusy}
                      onStartRename={startTagRename}
                      onRenameChange={setRenameValue}
                      onSubmitRename={submitTagRename}
                      onCancelRename={cancelTagRename}
                    />
                  </div>
                ))
              ) : (
                // Nested: the same disclosure-button + row-button idiom as the
                // folder tree above, so a member learns one tree, not two.
                <div role="group" aria-label="Tags">
                  {visibleTagRoots.map((n) => (
                    <TagNode
                      key={n.key}
                      node={n}
                      activeTagKey={activeTagKey}
                      expandedKeys={expandedTagKeys}
                      onToggle={toggleTagExpanded}
                      onSelect={(path) => { onSelectTag(path); onSelectFolder(null) }}
                      renameEnabled={canRenameTags}
                      renaming={renamingTag}
                      preview={renamePreview}
                      renameValue={renameValue}
                      renameBusy={renameBusy}
                      onStartRename={startTagRename}
                      onRenameChange={setRenameValue}
                      onSubmitRename={submitTagRename}
                      onCancelRename={cancelTagRename}
                    />
                  ))}
                </div>
              )}
              {filteredTagNodes && filteredTagNodes.length === 0 && (
                <div className={styles.searchEmpty}>No tags match “{tagFilter.trim()}”.</div>
              )}
              {tagsOverCap && !showAllTags && !filteredTagNodes && (
                <button
                  type="button"
                  className={styles.addBtn}
                  onClick={() => setShowAllTags(true)}
                >
                  Show all tags ({tagRoots.length})
                </button>
              )}
            </div>
          )}
        </>
      )}
      {deleteTarget && (
        <ConfirmModal
          title={`Delete folder "${deleteTarget.name}"?`}
          body="Subfolders and notes move up one level. This does not delete any notes."
          confirmLabel="Delete"
          tone="danger"
          onConfirm={onDeleteConfirm}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </aside>
  )
}
