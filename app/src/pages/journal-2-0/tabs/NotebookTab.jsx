import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { mutate as globalMutate } from 'swr'
import useJ2Notes from '../hooks/useJ2Notes'
import { applyTargetToParams } from '../lib/searchNavigation'
import useJ2SavedViews from '../hooks/useJ2SavedViews'
import useJ2PropertyDefs from '../hooks/useJ2PropertyDefs'
import NoteCard from '../components/notebook/NoteCard'
import NotesTableView from '../components/notebook/NotesTableView'
import NoteGraphView from '../components/notebook/NoteGraphView'
import NoteBoardView from '../components/notebook/NoteBoardView'
import NoteCalendarView from '../components/notebook/NoteCalendarView'
import SavedViewEditor from '../components/notebook/SavedViewEditor'
import FolderSidebar from '../components/notebook/FolderSidebar'
import NoteEditorPage from '../components/notebook/NoteEditorPage'
import ResearchHome from '../components/notebook/ResearchHome'
import TemplatePicker from '../components/notebook/TemplatePicker'
import ImportWizard from '../components/notebook/import/ImportWizard'
import ExportDialog from '../components/notebook/export/ExportDialog'
import NoteConnectorsTrustStrip from '../components/connectors/NoteConnectorsTrustStrip'
import Sheet from '../../../components/mobile/Sheet'
import UIcon from '../../../components/ui/UIcon'
import { getTemplate } from '../lib/notebookTemplates'
import { assembleTemplateContext } from '../lib/templateContext'
import { createNoteViaApi } from '../lib/noteCreation'
import useAppFocus from '../../../hooks/useAppFocus'
import { invalidateNoteLinkTarget } from '../lib/noteLinkTargetsBatch'
import { AuthContext } from '../../../context/AuthContext'
import { useOutboxDrain } from '../lib/offline/useOutboxDrain'
import { useBlockedNotes } from '../lib/offline/useBlockedNotes'
import { reportOptIn } from '../lib/offline/offlineOptInEvent'
import { SAVEABLE_VIEW_MODES, VIEW_MODES } from '../lib/savedViewModes'
import ConfirmModal from '../components/ConfirmModal'
import { SkeletonLine } from '../../../components/Skeleton'
import styles from './NotebookTab.module.css'
import { settleNoteWrite } from '../lib/offline/settleNoteWrite'
import BulkActionBar from '../components/notebook/BulkActionBar'
import NoteMenuActions from '../components/notebook/NoteMenuActions'
import { ARCHIVED_FOLDER, setNoteArchived } from '../lib/noteArchive'
import { getMemberTemplate } from '../lib/memberTemplates'
import { DAILY_TEMPLATE_PREF, isDailyShortcut, openDailyNote } from '../lib/dailyNote'
import usePreferences from '../../../hooks/usePreferences'
import { useNoteSelection } from '../lib/noteSelection'
import {
  checkUnsentWork, describeBatch, describeExport, describeUnchecked, exportSelectedNotes, joinUndo, runNoteBatch,
  undoFor,
} from '../lib/noteBatch'
import { useHubEligible } from '../../../hub/useHubActive'
import { BOTTOM_OFFSET_PX, PAD_PX } from '../../../hub/constants'
import useJ2NoteTags, { NOTE_TAGS_KEY } from '../hooks/useJ2NoteTags'
import { fallbackNodes } from '../lib/tagTree'

// Folders panel resize bounds (px).
const SB_MIN = 190
const SB_MAX = 520
const SB_DEFAULT = 260

// Obsidian-style "toggle left panel" glyph — a rounded frame with the left
// column filled, matching the button the user referenced.
function SidebarToggleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4.75" width="18" height="14.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <line x1="9.5" y1="4.75" x2="9.5" y2="19.25" stroke="currentColor" strokeWidth="1.7" />
      <rect x="4.9" y="6.4" width="3.1" height="11.2" rx="1" fill="currentColor" opacity="0.5" />
    </svg>
  )
}

// Stage A member-validation instrumentation (decision-log "Stage A→B gate"
// entry, 2026-09-06) — fired once per mount, best-effort, never blocks or
// throws into the render path. The validation report derives "first" vs.
// "repeat" visit from this event's own timestamps; no separate event type.
function _logNotebookVisit() {
  fetch('/api/j2/telemetry', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'notebook_tab_visit' }),
  }).catch(() => {})
}

/** Bulk ops that can change what GET /api/j2/notes/tags counts (R1-N4). */
// Archive moves a note out of the tag tree's counts too (it counts the notes
// the tag filter lists, and that filter leaves archived notes out).
const TAG_COUNT_OPS = new Set(['addTag', 'removeTag', 'trash', 'restore', 'archive', 'unarchive'])

export default function NotebookTab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const noteId = searchParams.get('note')

  // Wave Q1 — the reconnect. Mounted HERE, not in the editor: the queue is
  // account-wide, and a note edited offline then closed must still reach the
  // server. ⛔ `excludeNoteId` is the open note, which the editor owns and saves
  // with its own backoff — two writers on one note is the last-write-wins this
  // wave forbids. ⛔ And only the Web Locks LEADER drains; every other tab is a
  // follower that waits rather than a racer that corrupts.
  // ⛔ Read OPTIONALLY, the same way `useIsPaid` does: `useAuth()` throws
  // outside a provider, and the drain is an enhancement — no account means no
  // per-account database and nothing to drain, which is a degradation, not a
  // reason to take the Notebook down.
  const auth = useContext(AuthContext)
  const drain = useOutboxDrain({ accountId: auth?.user?.id, excludeNoteId: noteId })

  // Wave Q1 — and the member has to be able to SEE it. A blocked entry is
  // honest on the open note and was completely silent everywhere else: the
  // words were held safely and told nobody, recoverable only by a member who
  // happened to edit that note again for a reason nothing on screen gave them.
  // ⛔ `drain.lastSummary` is the refresh signal, not `drain.pending`: a blocked
  // entry is KEPT, so the queue length does not move when one becomes blocked.
  const { blocked: blockedNoteIds } = useBlockedNotes({
    accountId: auth?.user?.id,
    refreshToken: drain.lastSummary,
  })

  useEffect(() => { _logNotebookVisit() }, [])

  // Wave Q1 — THE DENOMINATOR. "Zero blocked-baseline events" is worthless
  // without knowing how many browsers ran the offline layer at all, and with
  // the flag off in production that population may be nobody. This reports the
  // transition into an opted-in state, once per browser, and is structurally
  // silent for everyone else: the condition is `key === '1'`, which production
  // never reaches on its own.
  // ⛔ Best-effort and never awaited into the render path — an instrument that
  // can break the Notebook is worse than no instrument.
  useEffect(() => { reportOptIn().catch(() => {}) }, [])

  // Wave B: reads ?folder= (e.g. __trash__) -- the command palette's "Open
  // Trash" destination. NOT a lazy one-time initializer: NotebookTab does
  // NOT remount for a same-route client-side navigation (command palette ->
  // "Open Trash" while already inside Notebook is exactly this case), so a
  // `useState(() => ...)` initializer or a `useEffect(..., [])` would only
  // ever fire on the component's FIRST mount and silently no-op on every
  // later "Open Trash" click -- caught live (not by any unit test, which
  // always mounts fresh) because the E2E pass drove the real palette-click
  // -> same-mounted-tab path. Deliberately NOT a two-way sync afterward
  // (folder selection stays local component state once read) -- only a
  // freshly-arriving `folder` param drives it.
  const [folderId, setFolderId] = useState(null)
  // Restore/create used to fail into a native alert() carrying the raw
  // exception (railed: rawErrorSurface.test.js).
  const [actionError, setActionError] = useState('')
  useEffect(() => {
    const f = searchParams.get('folder')
    if (!f) return
    setFolderId(f)
    // Strip it immediately -- a stale ?folder= must never re-force the view
    // back to Trash on an unrelated future navigation (e.g. browser back).
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('folder')
      return next
    }, { replace: true })
  }, [searchParams, setSearchParams])
  const [tag, setTag] = useState(null)
  // Wave H checkpoint decision 23: the Ticker Research Workspace's "View
  // all Notes" action lands here via `?ticker=`, reusing this exact
  // one-time-per-arrival-strip pattern (never a second filtering mechanism
  // -- this composes with `?view=all` and, per decision 24, with `?q=`).
  const [tickerFilter, setTickerFilter] = useState(null)
  useEffect(() => {
    const t = searchParams.get('ticker')
    if (!t || searchParams.get('new')) return  // '?new=...&ticker=' is the UNRELATED note-seed deep link, not a filter
    setTickerFilter(t.toUpperCase())
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('ticker')
      return next
    }, { replace: true })
  }, [searchParams, setSearchParams])
  const [sort, setSort] = useState('updated')
  // Wave E: an active saved view is mutually exclusive with folder/tag
  // browsing (same "one selection channel" discipline as folder vs. Trash
  // above) -- holds the WHOLE view object (not just its id) so viewType/
  // spec are available without a second lookup. `propertyFilter`/
  // `propertySort` are the AD-HOC equivalents, used only while no saved
  // view is active (a table-column-header click or a quick-filter chip).
  const [activeView, setActiveView] = useState(null)
  const [viewMode, setViewMode] = useState('list')
  // What the board is grouping by / the calendar is laying out, reported up by
  // those views so a saved view can capture it. The views keep their own
  // "open on a property the notes actually use" default-picking; this only
  // observes the answer.
  const [boardGroupBy, setBoardGroupBy] = useState(null)
  const [calendarDateProp, setCalendarDateProp] = useState(null)
  const [propertyFilter, setPropertyFilter] = useState(null)
  const [propertySort, setPropertySort] = useState(null)
  const [saveViewOpen, setSaveViewOpen] = useState(false)
  const { savedViews, create: createSavedView, rename: renameSavedView, remove: removeSavedView } = useJ2SavedViews()
  // ⛔⛔ UX #1, 2026-09-22: the hook has always fully implemented rename/
  // remove -- the UI just never imported them. Mirrors the folder
  // rename/delete handlers in FolderSidebar.jsx exactly (same "clear the
  // active selection if it was THIS one" rule delete already needs for
  // folders, `onSelectFolder(null)` there / `setActiveView(null)` here),
  // since NotebookTab is the only place `activeView` state lives.
  const [savedViewError, setSavedViewError] = useState(null)
  const onRenameView = async (id, name) => {
    try {
      await renameSavedView(id, name)
    } catch (err) {
      console.error('[notebook] rename saved view failed', err)
      setSavedViewError("Couldn't rename that view. It kept its old name.")
    }
  }
  const [deleteViewTarget, setDeleteViewTarget] = useState(null) // { id, name } | null
  const onDeleteViewRequest = (id, name) => setDeleteViewTarget({ id, name })
  const onDeleteViewConfirm = async () => {
    if (!deleteViewTarget) return
    const { id } = deleteViewTarget
    try {
      await removeSavedView(id)
      if (activeView?.id === id) setActiveView(null)
    } catch (err) {
      console.error('[notebook] delete saved view failed', err)
      setSavedViewError("Couldn't delete that view. Nothing was removed.")
    }
  }
  const { propertyDefs } = useJ2PropertyDefs()
  const [creating, setCreating] = useState(false)
  // App focus (= charts Group A) seeds a new entry's ticker.
  const { symbol: focusSymbol } = useAppFocus()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  // Bumped on a successful import to force-remount FolderSidebar, which owns
  // its own useJ2NoteFolders() SWR hook — an import can create new folders
  // and there's no other handle on that hook's mutate() from up here.
  const [folderRefreshKey, setFolderRefreshKey] = useState(0)
  const deepLinkRan = useRef(false)

  // Folders panel: open/closed + width, persisted locally so it survives reloads.
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { return localStorage.getItem('uct.j2.nb.sidebarOpen') !== '0' } catch { return true }
  })
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem('uct.j2.nb.sidebarWidth'), 10)
      return Number.isFinite(v) ? Math.min(SB_MAX, Math.max(SB_MIN, v)) : SB_DEFAULT
    } catch { return SB_DEFAULT }
  })
  const [dragging, setDragging] = useState(false)
  const wrapRef = useRef(null)
  const dragWidthRef = useRef(sidebarWidth)

  const toggleSidebar = () => setSidebarOpen((open) => {
    const next = !open
    try { localStorage.setItem('uct.j2.nb.sidebarOpen', next ? '1' : '0') } catch { /* private mode */ }
    return next
  })

  // Divider drag. The live width is written straight to a CSS variable on the
  // wrap element (no React state per move) so the panel tracks the pointer 1:1
  // with zero render lag; state + localStorage are committed once, on release.
  const startResize = (e) => {
    e.preventDefault()
    const wrap = wrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    setDragging(true)
    const onMove = (ev) => {
      const w = Math.min(SB_MAX, Math.max(SB_MIN, ev.clientX - rect.left))
      dragWidthRef.current = w
      wrap.style.setProperty('--nb-sb-w', `${w}px`)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
      setDragging(false)
      const w = dragWidthRef.current
      setSidebarWidth(w)
      try { localStorage.setItem('uct.j2.nb.sidebarWidth', String(w)) } catch { /* private mode */ }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Lock the panel to the viewport height (desktop) so the folder sidebar and the
  // notes/editor scroll on their own instead of scrolling the whole page. Measured
  // from the wrap's live top offset so it's exact under whatever chrome is above.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    let raf = 0
    const fit = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const node = wrapRef.current
        if (!node) return
        if (window.innerWidth <= 640) { node.style.height = ''; return } // phones: page scroll
        const top = node.getBoundingClientRect().top
        // Leave room for the journal layout's bottom padding so the page itself
        // never gains a scrollbar (44 ≈ .root padding-bottom).
        node.style.height = `${Math.max(360, window.innerHeight - top - 44)}px`
      })
    }
    fit()
    window.addEventListener('resize', fit)
    return () => { window.removeEventListener('resize', fit); cancelAnimationFrame(raf) }
  }, [])

  // Wave 0 trash: the sidebar's "Trash" row selects this sentinel exactly
  // like '__unfiled__' already does for Unfiled — no new selection channel.
  const isTrashView = folderId === '__trash__'
  // Wave 6: the Archived entry. Like the Trash it is a SHELF — notes set aside
  // from every folder — so folder/tag/saved-view scoping does not apply and it
  // lists as cards. Unlike the Trash its notes still open (archive is not trash).
  const isArchiveView = folderId === ARCHIVED_FOLDER
  const isShelfView = isTrashView || isArchiveView

  // `total` is the TRUE count from SQL for this filter set (folder/tag), never
  // the length of `notes` — a migrated library of thousands of notes must see
  // its real count. `hasMore`/`loadMore` back the "Load more" control below:
  // page size stays 100, and a click fetches+appends the next page rather
  // than re-fetching everything already on screen.
  //
  // In the trash view, folder/tag filters don't apply (a trashed note keeps
  // no meaningful folder/tag scoping for this list) and sort forces the
  // trash-view default (`deleted_at DESC`, i.e. "most recently deleted
  // first") — `list_notes` only defaults to that when `sort` is unset/
  // unrecognized, and the toolbar's own sort state ('updated' by default)
  // IS a recognized key, so it would otherwise silently win over the trash
  // default.
  const {
    notes, isLoading, error, refresh, total, hasMore, loadMore, isLoadingMore,
  } = useJ2Notes({
    folderId: isTrashView ? undefined : folderId,
    tag: isShelfView ? undefined : tag,
    ticker: isShelfView ? undefined : tickerFilter,
    sort: isTrashView ? 'deleted' : sort,
    deleted: isTrashView,
    // Wave E: savedViewId wins exclusively (server resolves ITS OWN stored
    // spec -- directive §87); the ad-hoc propertyFilter/propertySort below
    // are only ever sent when no saved view is active.
    savedViewId: !isShelfView ? activeView?.id : undefined,
    propertyFilter: !isShelfView && !activeView ? propertyFilter : undefined,
    propertySort: !isShelfView && !activeView ? propertySort : undefined,
  })
  // The folder sidebar renders every folder's notes as leaf rows AND runs its
  // own search, so it needs a note set covering every folder — not the
  // filtered view above (which only holds the selected folder's notes).
  // ⚠️ This is still only ONE PAGE (the same 100-row cap as the main list
  // above), NOT the "complete note set" this comment used to claim — on a
  // migrated library it undercounts exactly like the main list did. It stays
  // capped on purpose (rendering thousands of leaf rows in a tree is its own,
  // separately-tracked problem — see the tag-cloud cap note below for the
  // sibling gap). What IS honest here is `allNotesTotal`: the true total for
  // this same unfiltered fetch, handed to FolderSidebar for its "All notes"
  // badge instead of `allNotes.length`.
  const {
    notes: allNotes, refresh: refreshAll, mutate: mutateAllNotes, total: allNotesTotal,
  } = useJ2Notes({ sort: 'title' })

  // Live folder-tree updates without waiting on a refetch: drop a just-created
  // note in immediately, and reflect the title as it's typed.
  const addNoteToTree = useCallback((note) => {
    if (!note) return
    mutateAllNotes?.(
      (d) => (d?.notes ? { ...d, notes: [note, ...d.notes.filter((n) => n.id !== note.id)] } : d),
      { revalidate: false },
    )
  }, [mutateAllNotes])
  const updateTreeNoteTitle = useCallback((id, title) => {
    mutateAllNotes?.(
      (d) => (d?.notes ? { ...d, notes: d.notes.map((n) => (n.id === id ? { ...n, title } : n)) } : d),
      { revalidate: false },
    )
  }, [mutateAllNotes])
  const hasActiveFilters = Boolean(folderId || tag || activeView || propertyFilter || tickerFilter)
  // Wave H checkpoint decision 32/57: bare-root (no note, no filter, no
  // explicit ?view=all) renders Research Home instead of the flat All Notes
  // grid. "All notes" itself stays one click away (the sidebar row), now
  // via the explicit `view=all` flag rather than being indistinguishable
  // from Home.
  const viewAll = searchParams.get('view') === 'all'
  const isHome = !noteId && !hasActiveFilters && !viewAll && !isTrashView
  // ⛔ UX #4 (competitive audit, 2026-09-22): bare-root Home and an explicit
  // `?view=all` on a genuinely empty notebook render two different "you have
  // no notes" screens for the identical fact. Attempted a route-into-
  // ResearchHome fix here and reverted it: NotebookTab.test.jsx's OWN header
  // comment deliberately keeps `?view=all` on the grid ("these tests are
  // about the tab's OWN template-picker/grid/toolbar wiring, NOT Home...
  // `?view=all` is the explicit flag that keeps them landing on the grid
  // unchanged") specifically so this file has a stable surface to test
  // template-picking against -- the promised split-out
  // `NotebookTab.researchHome.test.jsx` referenced by that same comment does
  // not exist. Unifying the two screens is real and correct, but it broke
  // 20 of this file's 37 tests, all of which need a deliberate decision
  // about which surface re-exercises template-picking once `?view=all` no
  // longer does -- not a drive-by two-line change. Left as a named, still-open
  // quick win rather than a rushed test-suite rewrite.

  // FolderSidebar owns several of its OWN SWR hooks (the honest Trash count,
  // per-folder counts, per-expanded-folder note lists) with no handle exposed
  // up here — `refresh()`/`refreshAll()` above only cover the two lists THIS
  // component fetches directly. A delete/restore (or any edit that could
  // change a note's folder) must still invalidate those, or the sidebar's
  // Trash badge and folder counts go stale until an unrelated revalidation
  // (e.g. a window focus change) happens to catch them — found via real
  // browser E2E (Wave 0 verification): the Trash badge stayed "0" after a
  // delete even though the Trash view itself correctly showed the note.
  // A key-predicate SWR revalidation (not a FolderSidebar remount, which
  // would also blow away its expanded-folder/search UI state) targets
  // exactly those hooks without disturbing anything else.
  // `tags: false` leaves GET /api/j2/notes/tags out — for a change that cannot
  // move a tag count (review R1-N4: that endpoint costs ~1.4 s at 50k notes).
  const refreshSidebarCounts = ({ tags = true } = {}) => {
    globalMutate((key) => typeof key === 'string' && key.startsWith('/api/j2/notes')
      && (tags || !key.startsWith(NOTE_TAGS_KEY)))
  }

  // ⭐ WAVE M: an optional `target` carries the OBJECT the caller actually
  // named — a document page or a saved excerpt — through the same `?note=`
  // routing every other opener already uses. Callers that just want the note
  // pass nothing and behave exactly as before.
  const openNote = (note, target = null) => {
    setSearchParams((prev) => {
      const next = applyTargetToParams(prev, target)
      next.set('note', note.id)
      // Deep-link params ride along in `prev` when a template create opened
      // this note (setSearchParams' functional prev can be a render stale) —
      // drop them here so the final URL is always clean.
      next.delete('new')
      next.delete('ticker')
      // Wave H: opening a note leaves the explicit "All notes" grid state —
      // same "leaving X clears Y" discipline as every other selection below.
      next.delete('view')
      return next
    }, { replace: false })
  }
  const closeNote = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('note')
      return next
    }, { replace: false })
    refresh()
    refreshAll()
    refreshSidebarCounts()
  }

  // Selecting a folder / tag from the (now always-present) sidebar while a note
  // is open should leave the note and show that filtered grid.
  const clearNoteParam = () => setSearchParams((prev) => {
    const next = new URLSearchParams(prev)
    next.delete('note')
    return next
  }, { replace: false })
  // Wave H: `?view=all` is the explicit flag distinguishing "the All Notes
  // grid, no filter" from bare-root Research Home -- both otherwise look
  // identical (folderId=null, tag=null, no activeView). Selecting any real
  // folder/tag/saved-view leaves that explicit-all-notes state.
  const clearViewAllParam = () => setSearchParams((prev) => {
    const next = new URLSearchParams(prev)
    next.delete('view')
    return next
  }, { replace: false })
  const selectAllNotes = () => {
    setFolderId(null)
    setTag(null)
    setActiveView(null)
    setTickerFilter(null)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('view', 'all')
      next.delete('note')
      return next
    }, { replace: false })
  }
  const handleSelectFolder = (id) => { setFolderId(id); setActiveView(null); setTickerFilter(null); clearViewAllParam(); if (noteId) clearNoteParam() }
  const handleSelectTag = (t) => { setTag(t); setActiveView(null); setTickerFilter(null); clearViewAllParam(); if (noteId) clearNoteParam() }
  const handleSelectView = (view) => {
    // Wave E: mutually exclusive with folder/tag browsing -- same "one
    // selection channel" discipline as folder vs. Trash above.
    setFolderId(null)
    setTag(null)
    setTickerFilter(null)
    setPropertyFilter(null)
    setPropertySort(null)
    setActiveView(view)
    // ⛔ EVERY SAVEABLE TYPE NEEDS A BRANCH HERE. This read
    // `view.viewType === 'table' ? 'table' : 'list'`, which silently opened a
    // board as a list the moment boards became saveable -- the failure is
    // quiet, which is why the server's SAVEABLE_VIEW_TYPES and this set are
    // pinned against each other by a test.
    setViewMode(SAVEABLE_VIEW_MODES.has(view.viewType) ? view.viewType : 'list')
    clearViewAllParam()
    if (noteId) clearNoteParam()
  }
  const handleQuickFilter = (propertyId, value) => {
    if (activeView) return // a saved view's spec is server-resolved; ad-hoc filters don't apply on top of it
    setPropertyFilter([{ propertyId, op: 'eq', value }])
  }
  const handlePropertySort = (propertyId) => {
    if (activeView) return
    setPropertySort((prev) => ({
      propertyId,
      direction: prev?.propertyId === propertyId && prev.direction === 'asc' ? 'desc' : 'asc',
    }))
  }
  const handleSaveCurrentView = async (name) => {
    // Deliberately property-filter/sort ONLY -- not folder/tag. A saved
    // view is mutually exclusive with folder/tag browsing (activating one
    // clears the other, same as Trash vs. folder above), and the server's
    // savedViewId resolution only ever reads propertyFilter/propertySort
    // out of a view's spec (directive §87 -- the server resolves its OWN
    // stored spec, never a client-reconstructed one), so a folder/tag
    // captured here would silently do nothing on activation. Keep the
    // spec's actual capability matched to what it actually restores.
    // ⛔ A BOARD IS NOTHING WITHOUT WHAT IT GROUPS BY, and a calendar is
    // nothing without which date it lays out. Saving the mode alone would
    // restore a board grouped by whatever the default picker chose that day.
    // Stored as property IDS so a rename cannot break the view.
    const spec = { propertyFilter, propertySort }
    if (viewMode === 'board' && boardGroupBy) spec.groupBy = boardGroupBy
    if (viewMode === 'calendar' && calendarDateProp) spec.dateProperty = calendarDateProp
    const view = await createSavedView(name, viewMode, spec)
    setActiveView(view)
    setSaveViewOpen(false)
  }

  // Wave G checkpoint §48 — four canonical thesis-relevant starter views,
  // built entirely from Wave E's existing property-filter mechanism (AND-
  // only, eq/lte/is_not_empty over USER_SET builtin properties). Two of the
  // directive's five originally-suggested views turned out infeasible
  // against that mechanism as designed (builtin:trade_ref is
  // financial_derived and not filterable at all; "research_type is Long OR
  // Short" needs an OR the filter deliberately doesn't support) -- rather
  // than build a second query mechanism just for this, the starter set uses
  // the four that ARE naturally expressible: Active, High Confidence, Needs
  // Review, Invalidated. Ordinary saved-view rows once created -- fully
  // renameable/deletable like any other.
  const addStarterThesisViews = async () => {
    const todayIso = new Date().toISOString().slice(0, 10)
    const starters = [
      { name: 'Active Theses', filter: [{ propertyId: 'builtin:thesis_status', op: 'eq', value: 'active' }] },
      {
        name: 'High Confidence',
        filter: [
          { propertyId: 'builtin:confidence', op: 'eq', value: 'high' },
          { propertyId: 'builtin:thesis_status', op: 'eq', value: 'active' },
        ],
      },
      { name: 'Needs Review', filter: [{ propertyId: 'builtin:review_date', op: 'lte', value: todayIso }] },
      { name: 'Invalidated Theses', filter: [{ propertyId: 'builtin:thesis_status', op: 'eq', value: 'invalidated' }] },
    ]
    let last = null
    for (const s of starters) {
      try {
        last = await createSavedView(s.name, 'list', { propertyFilter: s.filter, propertySort: null })
      } catch { /* one starter failing (e.g. a name collision) shouldn't block the rest */ }
    }
    if (last) setActiveView(last)
  }

  // Wave 0 trash: undo a soft delete. Refreshes both the trash list (the
  // note leaves it) and the sidebar's unfiltered tree (the note rejoins it).
  const restoreNote = async (note) => {
    try {
      const res = await fetch(`/api/j2/notes/${note.id}/restore`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const body = await res.json()
      // ⛔⛔ `restore_note` ADVANCED THIS NOTE'S REVISION. A note coming back
      // out of the trash can still have unsent offline work queued against it
      // — that is exactly the note a member restores — so an unlanded revision
      // here forks the member's own recovery.
      await settleNoteWrite(note.id, body.note)
      addNoteToTree(body.note)
      refresh()
      refreshAll()
      refreshSidebarCounts()
      // Trashed -> active is the same target-status flip as trashing itself
      // (NoteEditorPage's onDeleteConfirm) -- a noteLink chip elsewhere in
      // this tab may still show the pre-restore "Trashed" state.
      invalidateNoteLinkTarget(note.id)
    } catch (e) {
      console.error('[notebook] restore note failed', e)
      setActionError("Couldn't restore that note. It's still in the trash.")
    }
  }

  // Wave 6: bring one archived note back (the card's own Unarchive). It returns
  // to its folder exactly where it was; nothing about the note moved.
  const unarchiveNote = async (note) => {
    try {
      await setNoteArchived(note.id, false)
      refresh()
      refreshAll()
      refreshSidebarCounts()
    } catch (e) {
      console.error('[notebook] unarchive note failed', e)
      setActionError("Couldn't unarchive that note. It is still archived.")
    }
  }

  // ── Wave 5 bulk operations ────────────────────────────────────────────────
  // Multi-select over the notes IN VIEW, in the two views that list notes one
  // per row/card (list, table) and in the Trash. The board, calendar and graph
  // keep their own gestures — a checkbox there would be a second way to write
  // the same property the card's own control already writes.
  const selectionOn = !noteId && !isHome && (isShelfView || viewMode === 'list' || viewMode === 'table')
  const visibleIds = useMemo(() => (selectionOn ? notes.map((n) => n.id) : []), [selectionOn, notes])
  const selection = useNoteSelection(visibleIds)
  const [bulkBusy, setBulkBusy] = useState(false)
  // The state flag re-renders the bar; this ref is the guard — it is set in the
  // same tick as the click, so a second click or a queued Undo can never start
  // a second batch while one is in flight.
  const bulkBusyRef = useRef(false)
  // ⛔ OWNED HERE, NOT BY THE BAR. The bar unmounts the moment the selection
  // empties (a trash, a restore), so a message it owned would be destroyed in
  // the very commit that set it. This outlives it.
  // R1-S1: a notice may carry `anyway` (describeUnchecked) — a device that
  // could not be checked is offered a confirmed way through; `armed` is the
  // confirmation step.
  const [bulkNotice, setBulkNotice] = useState(null) // { message, tone, anyway?, armed? }
  const anywayRef = useRef(null)
  const anywayConfirmRef = useRef(null)
  // ⛔ THE WAY BACK HAS ITS OWN NOTICE (review S4). With one shared notice, any
  // later action's sentence replaced the only Undo, and pressing Undo while
  // another batch ran cleared it and did nothing. Now a later sentence goes to
  // `bulkNotice`, and an Undo pressed mid-batch is QUEUED and runs when that
  // batch finishes.
  const [undoNotice, setUndoNotice] = useState(null) // { message, tone, undo: {op, ids, args}, queued? }
  const undoQueuedRef = useRef(false)
  const undoRef = useRef(null)
  const { tagCounts, tagTree } = useJ2NoteTags()
  // Suggestions for the bulk "add a tag" field: the whole tag tree (implied
  // parents included); an older answer with no tree falls back to flat tags.
  const tagTreeNodes = useMemo(
    () => tagTree || fallbackNodes(tagCounts),
    [tagTree, tagCounts],
  )

  // A different folder / tag / view / mode is a different set of notes: the
  // old selection must not ride along into it.
  const selectionContext = [
    folderId, tag, activeView?.id, tickerFilter, viewMode, isTrashView, noteId,
    JSON.stringify(propertyFilter || null),
  ].join('|')
  const clearSelection = selection.clear
  useEffect(() => { clearSelection() }, [selectionContext, clearSelection])

  // Esc clears the selection — unless something else owns Esc right now: an
  // open dialog, the command palette (it marks its Esc handled), or a text
  // field (Esc there means "stop typing", not "forget my selection").
  useEffect(() => {
    if (!selection.count) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const t = e.target
      const typing = t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
        || (t.tagName === 'INPUT' && t.type !== 'checkbox'))
      if (typing) return
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      clearSelection()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selection.count, clearSelection])

  // Keep a notice on screen long enough to read and act on, then let it go.
  // An error stays until dismissed: it describes something the member has to do.
  useEffect(() => {
    if (!bulkNotice || bulkNotice.tone === 'error') return undefined
    const t = setTimeout(() => setBulkNotice(null), 8000)
    return () => clearTimeout(t)
  }, [bulkNotice])
  // The Undo stays for 12 seconds — and indefinitely once queued: a queued Undo
  // is a promise to the member that it WILL run. R23-N5: nor does it run out
  // while an "anyway" offer is still on screen — confirming that offer FINISHES
  // the same action and joins this Undo (joinUndo), so the member reading the
  // warning must not lose the first half's way back meanwhile.
  const anywayOffer = bulkNotice?.anyway || null
  const anywayArmed = Boolean(bulkNotice?.armed)
  useEffect(() => {
    if (!undoNotice || undoNotice.queued || anywayOffer) return undefined
    const t = setTimeout(() => setUndoNotice(null), 12000)
    return () => clearTimeout(t)
  }, [undoNotice, anywayOffer])
  // R23-N5: the "anyway" offer holds focus through its two steps. When it
  // appears (the bar that had focus is gone), focus goes to "Trash anyway";
  // pressing it arms the confirmation and focus follows; Cancel disarms it and
  // focus comes back to "Trash anyway" — never dropped on the page.
  useEffect(() => {
    if (!anywayOffer) return
    const target = anywayArmed ? anywayConfirmRef : anywayRef
    target.current?.focus()
  }, [anywayOffer, anywayArmed])
  // After a trash or a move, the bar is gone (or the notes moved out of view)
  // and focus with it — hand focus to Undo so a keyboard member can take it back
  // without hunting for it. Keyed on the undo itself, so queueing does not steal
  // focus a second time. ⛔ Not while an "anyway" offer is up: a partial trash
  // brings both at once, and the offer is the decision still waiting on the
  // member (this effect runs after the one above, so without the check the
  // Undo would take the focus the offer was just given).
  const undoKey = undoNotice?.undo
  useEffect(() => {
    if (undoKey && !anywayOffer) undoRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoKey])
  // R23-N6: where the joystick can be, the notice column starts ABOVE the pad's
  // resting box, as the hub's own toasts do — so the Undo and its close button
  // are never under the pad. Derived from the hub's own geometry
  // (hub/constants.js) and its own eligibility answer, never restated here;
  // the gap is the existing spacing token.
  const hubCorner = useHubEligible()
  const noticeStackStyle = hubCorner
    ? { bottom: `calc(env(safe-area-inset-bottom) + ${BOTTOM_OFFSET_PX + PAD_PX}px + var(--space-sm))` }
    : undefined

  const titleById = useMemo(() => new Map(notes.map((n) => [n.id, n.title?.trim() || 'Untitled'])), [notes])
  const selectedTags = useMemo(() => {
    const seen = new Map()
    for (const n of notes) {
      if (!selection.isSelected(n.id)) continue
      for (const t of n.tags || []) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [notes, selection])

  const afterBulkWrite = (op, changedIds) => {
    if (op === 'trash' || op === 'restore') {
      // The same target-status flip a single trash/restore makes — a noteLink
      // chip elsewhere may still show the old Trashed/active state.
      for (const id of changedIds) invalidateNoteLinkTarget(id)
    }
    refresh()
    refreshAll()
    // The tag tree counts tags on LIVE notes: only a tag edit, or a note
    // entering or leaving the Trash, can move it. A move or a favourite
    // cannot, so it does not re-ask the (costly) tag endpoint.
    refreshSidebarCounts({ tags: TAG_COUNT_OPS.has(op) })
  }

  const titleOf = (id) => titleById.get(id) || null
  const startBulk = () => {
    if (bulkBusyRef.current) return false
    bulkBusyRef.current = true
    setBulkBusy(true)
    return true
  }
  const endBulk = () => {
    bulkBusyRef.current = false
    setBulkBusy(false)
  }

  const runBulk = async (
    op, args = {}, ctx = {}, ids = selection.selectedIds,
    { isUndo = false, acceptUnchecked = false, continues = false } = {},
  ) => {
    if (!ids.length || !startBulk()) return
    try {
      const outcome = await runNoteBatch({ ids, op, args, blockedNoteIds, acceptUnchecked })
      const { message, tone } = describeBatch(outcome, { ...ctx, titleOf })
      // R1-S1: notes this device could not be ASKED about are not "still
      // syncing" — they get their own sentence and a confirmed "anyway".
      const offer = describeUnchecked(
        op, outcome.results.filter((r) => r.status === 'unchecked').map((r) => r.id), { titleOf })
      const changedIds = outcome.results.filter((r) => r.status === 'changed').map((r) => r.id)
      // A trash and a move can be taken back (B1: a move said where each note
      // came from). An Undo itself cannot — and never replaces a newer one.
      const undo = isUndo ? null : undoFor(op, outcome, args)
      // ⛔ A queued Undo is never replaced by a newer one: it is a promise.
      if (undo && !undoQueuedRef.current) {
        setBulkNotice(offer)
        // R23-N5: a confirmed "anyway" FINISHES the action whose Undo is on
        // screen — its notes join that Undo, and the sentence counts both parts.
        setUndoNotice((prev) => {
          const joined = continues ? joinUndo(prev, undo) : { undo, earlier: 0 }
          return joined.earlier
            ? { ...describeBatch(outcome, { ...ctx, titleOf, earlier: joined.earlier }), undo: joined.undo }
            : { message, tone, undo }
        })
      } else {
        setBulkNotice(offer
          ? { ...offer, message: [message, offer.message].filter(Boolean).join(' ') }
          : { message, tone })
      }
      // Each of these takes the selected notes OUT of the view they were chosen in.
      if (['trash', 'restore', 'archive', 'unarchive'].includes(op)) clearSelection()
      afterBulkWrite(op, changedIds)
    } catch (e) {
      console.error('[notebook] bulk action failed', e)
      setBulkNotice({ message: e?.message || 'That did not go through. Nothing was changed.', tone: 'error' })
    } finally {
      endBulk()
    }
  }

  const runUndo = (undo) => {
    if (bulkBusyRef.current) return   // still queued: the effect below retries
    undoQueuedRef.current = false
    setUndoNotice(null)
    runBulk(undo.op, undo.args, undo.op === 'move' ? { backToOrigin: true } : {}, undo.ids, { isUndo: true })
  }
  const pressUndo = () => {
    if (!undoNotice || undoNotice.queued) return
    if (bulkBusyRef.current) {
      undoQueuedRef.current = true
      setUndoNotice((n) => (n ? { ...n, queued: true } : n))
      return
    }
    runUndo(undoNotice.undo)
  }
  // A queued Undo runs the moment the batch it waited for is done.
  useEffect(() => {
    if (!bulkBusy && undoNotice?.queued) runUndo(undoNotice.undo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkBusy, undoNotice])

  const exportSelection = async (ids = selection.selectedIds, { acceptUnchecked = false } = {}) => {
    if (!ids.length || !startBulk()) return
    try {
      // ⛔ A note whose words the server does not have yet would export WITHOUT
      // them, and the member would believe the file complete. It is left out and
      // named instead — a drain-retired note (blocked) AND one still sending
      // (noteHasUnsentWork's raw signal; review S1). A note the device could
      // not be asked about is offered a confirmed "Export anyway" (R1-S1).
      const blocked = ids.filter((id) => blockedNoteIds.has(id))
      const rest = ids.filter((id) => !blockedNoteIds.has(id))
      const checked = await checkUnsentWork(rest)
      const unsent = rest.filter((id) => checked.unsent.has(id))
      const unchecked = acceptUnchecked ? [] : rest.filter((id) => checked.unchecked.has(id))
      const send = rest.filter((id) => !checked.unsent.has(id) && !unchecked.includes(id))
      let count = 0
      let skipped = 0
      if (send.length) ({ count, skipped } = await exportSelectedNotes(send))
      const said = describeExport({ count, skipped, blocked, unsent }, { titleOf })
      const offer = describeUnchecked('export', unchecked, { titleOf })
      const saidAnything = count || skipped || blocked.length || unsent.length
      setBulkNotice(offer
        ? { ...offer, message: [saidAnything ? said.message : '', offer.message].filter(Boolean).join(' ') }
        : said)
    } catch (e) {
      console.error('[notebook] bulk export failed', e)
      setBulkNotice({ message: e?.message || 'The export could not be prepared.', tone: 'error' })
    } finally {
      endBulk()
    }
  }

  // R1-S1: the member CONFIRMED going ahead without the device check. Only the
  // check that could not run is waived — the re-check still refuses a note it
  // DOES find unsent.
  const runAnyway = (anyway) => {
    if (!anyway || bulkBusyRef.current) return
    setBulkNotice(null)
    if (anyway.op === 'export') exportSelection(anyway.ids, { acceptUnchecked: true })
    else runBulk(anyway.op, {}, {}, anyway.ids, { acceptUnchecked: true, continues: true })
  }

  // Create a note. Blank note passes no title/body; a template seeds both
  // (plus its preset tags and, when known, the ticker). The actual network
  // calls live in lib/noteCreation.js (Wave H) so the Ticker Research
  // Workspace's own New Note/New Thesis actions call the SAME path rather
  // than a second creation flow -- this wrapper only adds NotebookTab's OWN
  // UI concerns (app-focus ticker fallback, current-folder scoping, tree/
  // refresh bookkeeping) on top of it.
  const createNote = async ({ title = '', bodyJson, tags, ticker, properties } = {}) => {
    setCreating(true)
    setPickerOpen(false)
    try {
      // App focus (= charts Group A): charting AMD and then starting an entry
      // should not make you retype AMD. An explicit ticker always wins; focus
      // only fills the blank.
      const seededTicker = ticker || focusSymbol || null
      // The sentinels are views, not folders: a note made while one is open is
      // made unfiled (a new note is never born archived or trashed).
      const safeFolderId = folderId && !['__unfiled__', '__trash__', ARCHIVED_FOLDER].includes(folderId)
        ? folderId : undefined
      const created = await createNoteViaApi({ title, bodyJson, tags, ticker: seededTicker, folderId: safeFolderId, properties })
      // Instant: put it in the tree now, then reconcile from the server.
      addNoteToTree(created)
      refreshAll()
      openNote(created)
    } catch (e) {
      console.error('[notebook] create note failed', e)
      setActionError("Couldn't create that note. Nothing was saved.")
    } finally {
      setCreating(false)
    }
  }

  // Data-aware create: assemble the context a template declares it needs
  // (regime / positions / today's game plan), then seed title + body from it.
  // Every context source is best-effort — no data still yields the scaffold.
  const createFromTemplate = async (tpl, { ticker } = {}) => {
    setCreating(true)
    setPickerOpen(false)
    let ctx
    try {
      ctx = await assembleTemplateContext({ ticker, needs: tpl.needs })
    } catch {
      ctx = { ticker: ticker || null }
    }
    await createNote({
      title: tpl.defaultTitle(ctx),
      bodyJson: tpl.build(ctx),
      tags: tpl.tags,
      ticker: ctx.ticker,
      properties: tpl.properties,
    })
  }

  // Wave 6: a member's OWN template (saved from one of their notes). The full
  // template is read when picked, then made through the SAME createNote ->
  // createNoteViaApi path as a built-in: title, body and property values.
  const createFromMemberTemplate = async (summary) => {
    setCreating(true)
    setPickerOpen(false)
    let full
    try {
      full = await getMemberTemplate(summary.id)
    } catch (e) {
      console.error('[notebook] read member template failed', e)
      setActionError(`Couldn't open the template “${summary.name}”. Nothing was created.`)
      setCreating(false)
      return
    }
    await createNote({ title: full.title, bodyJson: full.bodyJson, properties: full.properties })
  }

  const handlePick = (tplOrNull) =>
    tplOrNull ? createFromTemplate(tplOrNull) : createNote()

  // Wave 6 (item 4): Today — open the member's note for today's ET date,
  // making it the first time (the server keeps it to one per day). The daily
  // template is the member's own preference.
  const { prefs } = usePreferences()
  const dailyTemplateId = prefs?.[DAILY_TEMPLATE_PREF] || ''
  const openingTodayRef = useRef(false)
  const openToday = async () => {
    if (openingTodayRef.current) return
    openingTodayRef.current = true
    setActionError('')
    try {
      const { note, created, templateMissing } = await openDailyNote({ templateId: dailyTemplateId })
      if (created) {
        addNoteToTree(note)
        refreshAll()
        refreshSidebarCounts()
      }
      if (templateMissing) {
        setActionError("Your daily template no longer exists, so today's note started blank.")
      }
      openNote(note)
    } catch (e) {
      console.error('[notebook] open daily note failed', e)
      setActionError("Couldn't open today's note. Nothing was created.")
    } finally {
      openingTodayRef.current = false
    }
  }
  const openTodayRef = useRef(openToday)
  openTodayRef.current = openToday
  useEffect(() => {
    const onKey = (e) => {
      if (!isDailyShortcut(e)) return
      e.preventDefault()
      openTodayRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A successful import can create notes AND folders — refresh both. Notes
  // come back through useJ2Notes' own refresh(); folders live behind
  // FolderSidebar's own useJ2NoteFolders() hook with no exposed handle up
  // here, so a key bump remounts it and its SWR hook re-fetches fresh.
  const handleImported = () => {
    refresh()
    refreshAll()
    setFolderRefreshKey((k) => k + 1)
  }

  // Deep link: /journal/notebook?new=<templateKey>[&ticker=SYM] — Today page, the
  // EOD recap, and TradeDrawer open a pre-seeded template directly (plan §4).
  // Runs once; params are stripped either way so a stale key can't loop.
  // Wave B: `new=blank` is the one reserved key that isn't a template — it's
  // the command palette's "New Note" destination, mirroring the sidebar's
  // own "+ New note" button (a bare createNote() call, no template).
  const newKey = searchParams.get('new')
  useEffect(() => {
    if (!newKey || noteId || creating || deepLinkRan.current) return
    deepLinkRan.current = true
    const tpl = newKey === 'blank' ? null : getTemplate(newKey)
    const ticker = searchParams.get('ticker')
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('new')
      next.delete('ticker')
      return next
    }, { replace: true })
    if (tpl) createFromTemplate(tpl, { ticker })
    else if (newKey === 'blank') {
      // Same uppercase-and-trim normalization assembleTemplateContext applies
      // for the template path (templateContext.js) — kept consistent so a
      // deep-linked ticker behaves identically regardless of which "new
      // note" door it came through.
      const normalizedTicker = (ticker || '').trim().toUpperCase() || undefined
      createNote({ ticker: normalizedTicker })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newKey])

  return (
    <div
      ref={wrapRef}
      className={`${styles.wrap} ${sidebarOpen ? '' : styles.collapsed} ${dragging ? styles.dragging : ''}`}
      style={{ '--nb-sb-w': `${sidebarWidth}px` }}
    >
      {actionError && (
        <div className={styles.actionError} role="alert">{actionError}</div>
      )}
      {/* Wave 5: what a bulk action did, in words — and the way back from a
          trash or a move. Rendered here, above everything the action can
          unmount; the Undo has its own notice so no later sentence replaces it.
          R1-S2: the two share ONE fixed stack, each in its own slot — two
          fixed boxes at the same spot let a later sentence paint over Undo.
          The Undo is the LAST child: the stack grows upward from the bottom,
          so a sentence arriving later never moves the button under a finger. */}
      {(undoNotice || bulkNotice) && (
        <div className={styles.bulkNoticeStack} style={noticeStackStyle} data-testid="bulk-notice-stack">
          {bulkNotice && (
            <div
              className={`${styles.bulkNotice} ${bulkNotice.tone === 'error' ? styles.bulkNoticeError : ''}`}
              role={bulkNotice.tone === 'error' ? 'alert' : 'status'}
              data-testid="bulk-notice"
            >
              <span className={styles.bulkNoticeText}>
                {bulkNotice.armed ? bulkNotice.anyway.confirm : bulkNotice.message}
              </span>
              {bulkNotice.anyway && !bulkNotice.armed && (
                <button
                  type="button"
                  ref={anywayRef}
                  className={styles.bulkNoticeBtn}
                  onClick={() => setBulkNotice((n) => (n ? { ...n, armed: true } : n))}
                >
                  {bulkNotice.anyway.label}
                </button>
              )}
              {bulkNotice.anyway && bulkNotice.armed && (
                <>
                  <button
                    type="button"
                    ref={anywayConfirmRef}
                    className={styles.bulkNoticeBtn}
                    onClick={() => runAnyway(bulkNotice.anyway)}
                    disabled={bulkBusy}
                  >
                    {bulkNotice.anyway.confirmLabel}
                  </button>
                  <button
                    type="button"
                    className={styles.bulkNoticeBtn}
                    onClick={() => setBulkNotice((n) => (n ? { ...n, armed: false } : n))}
                  >
                    Cancel
                  </button>
                </>
              )}
              <button
                type="button"
                className={styles.bulkNoticeClose}
                onClick={() => setBulkNotice(null)}
                aria-label="Dismiss this message"
              >
                <UIcon name="x" size={12} gold={false} />
              </button>
            </div>
          )}
          {undoNotice && (
            <div
              className={`${styles.bulkNotice} ${undoNotice.tone === 'error' ? styles.bulkNoticeError : ''}`}
              role="status"
              data-testid="bulk-undo-notice"
            >
              <span className={styles.bulkNoticeText}>
                {undoNotice.message}
                {undoNotice.queued ? ' Undo will run as soon as the current action finishes.' : ''}
              </span>
              <button
                type="button"
                ref={undoRef}
                className={styles.bulkNoticeBtn}
                onClick={pressUndo}
                disabled={Boolean(undoNotice.queued)}
              >
                {undoNotice.queued ? 'Undo queued' : 'Undo'}
              </button>
              <button
                type="button"
                className={styles.bulkNoticeClose}
                onClick={() => { undoQueuedRef.current = false; setUndoNotice(null) }}
                aria-label="Dismiss this message"
              >
                <UIcon name="x" size={12} gold={false} />
              </button>
            </div>
          )}
        </div>
      )}
      {/* When the panel is hidden, a single floating button brings it back. When
          open, the collapse control lives in the panel's own header toolbar. */}
      {!sidebarOpen && (
        <button
          type="button"
          className={styles.sidebarToggle}
          onClick={toggleSidebar}
          aria-label="Show folders panel"
          title="Show folders"
        >
          <SidebarToggleIcon />
        </button>
      )}

      <div className={styles.sidebarSlot}>
        <div className={styles.sidebarInner}>
          <FolderSidebar
            key={folderRefreshKey}
            notes={allNotes}
            notesTotal={allNotesTotal}
            activeFolderId={folderId}
            onSelectFolder={handleSelectFolder}
            activeTag={tag}
            onSelectTag={handleSelectTag}
            onOpenNote={openNote}
            activeNoteId={noteId}
            onToggleSidebar={toggleSidebar}
            savedViews={savedViews}
            activeViewId={activeView?.id ?? null}
            onSelectView={handleSelectView}
            onRenameView={onRenameView}
            onDeleteView={onDeleteViewRequest}
            onAddStarterViews={addStarterThesisViews}
            isHome={isHome}
            onSelectAllNotes={selectAllNotes}
          />
        </div>
      </div>

      <div
        className={styles.divider}
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize folders panel"
      />

      <div className={`${styles.main} ${noteId ? styles.mainNote : ''}`}>
        {noteId ? (
          // Key by noteId so switching notes from the persistent sidebar remounts
          // the editor fresh (TipTap state + autosave), same as opening from the grid.
          <NoteEditorPage
            key={noteId}
            noteId={noteId}
            onBack={closeNote}
            showBack={false}
            onTitleChange={updateTreeNoteTitle}
            // ⛔ Wave 6 (lane E): the note menu's organisation actions. The
            // editor is lane D's file; it renders `noteMenu?.(note, { refresh })`
            // in its header row (requested in wave6-E-report.md). Ignored until
            // then — this prop alone changes nothing an editor does.
            noteMenu={(note, api) => (
              <NoteMenuActions
                note={note}
                onChanged={() => {
                  api?.refresh?.()
                  refresh()
                  refreshAll()
                  refreshSidebarCounts()
                }}
              />
            )}
          />
        ) : isHome ? (
          // Wave H: bare-root Research Home (checkpoint decision 33/57) --
          // "All notes" itself is unchanged, one click away via the sidebar.
          <ResearchHome
            onOpenNote={openNote}
            onCreateNote={() => createNote()}
            onCreateThesis={() => handlePick(getTemplate('thesis'))}
            onImport={() => setImportOpen(true)}
            hasAnyNotes={allNotesTotal > 0}
          />
        ) : (
          <>
        <div className={styles.toolbar}>
          {isArchiveView && <span className={styles.trashLabel}>Archived</span>}
          {isTrashView ? (
            // Trash view sort is fixed (most recently deleted first) — the
            // toolbar's Recently-updated/Recently-created/Title options are
            // for the active library, not a meaningful choice here.
            <span className={styles.trashLabel}>Trash</span>
          ) : (
            <select
              className={styles.sortSelect}
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="updated">Recently updated</option>
              <option value="created">Recently created</option>
              <option value="title">Title</option>
            </select>
          )}
          {tickerFilter && (
            <span className={styles.tickerFilterChip}>${tickerFilter}</span>
          )}
          {(folderId || tag || activeView || propertyFilter || tickerFilter) && (
            <button
              type="button"
              className={styles.clear}
              onClick={() => {
                setFolderId(null); setTag(null)
                setActiveView(null); setPropertyFilter(null); setPropertySort(null)
                setTickerFilter(null)
              }}
            >
              Clear filter
            </button>
          )}
          {!isShelfView && (
            <div className={styles.viewModeWrap}>
              {/*
                ⛔ ONE BUTTON, RENDERED FIVE TIMES — not five buttons. These were
                five hand-written blocks and every one of them was missing
                aria-pressed, so a screen reader heard five identical icon
                buttons and could not say which view was on. The active state
                lived only in a CSS class, which is invisible to it by
                definition. Written once, the attribute cannot be on four of
                them and off the fifth.
              */}
              {VIEW_MODES.map(({ id, icon, label }) => (
                <button
                  key={id}
                  type="button"
                  className={`${styles.viewModeBtn} ${viewMode === id ? styles.viewModeActive : ''}`}
                  onClick={() => setViewMode(id)}
                  disabled={Boolean(activeView)}
                  aria-pressed={viewMode === id}
                  aria-label={label}
                  title={label}
                >
                  <UIcon name={icon} size={14} gold={false} />
                </button>
              ))}
              {/*
                ⛔ NO "Save this view" IN GRAPH MODE -- still true, for a
                DIFFERENT reason than this comment used to give. The server's
                SAVEABLE_VIEW_TYPES (note_properties.py) now accepts "graph",
                and the client's SAVEABLE_VIEW_MODES mirrors it -- so a save no
                longer 400s, it silently SUCCEEDS and produces a named view
                that captures nothing: handleSaveCurrentView only
                special-cases board/calendar state, graph has no
                filter/sort/groupBy of its own to store, and NoteGraphView
                takes no filter/sort props at all (always fetches the whole
                notebook). Reopening that "saved" view is indistinguishable
                from clicking Graph fresh -- a silent trap, not a loud
                refusal. Excluding it here is still the honest choice until a
                real design decision gives a saved graph view something to
                actually mean (e.g. a local-graph scope) -- competitive audit
                finding UX #18, 2026-09-22.
              */}
              {!activeView && viewMode !== 'graph' && (
                <button
                  type="button"
                  className={styles.saveViewBtn}
                  onClick={() => setSaveViewOpen(true)}
                  title="Save this view"
                >
                  <UIcon name="plus" size={12} gold={false} />
                  Save view
                </button>
              )}
            </div>
          )}
          <div className={styles.newWrap}>
            <button
              type="button"
              className={styles.importBtn}
              onClick={() => setImportOpen(true)}
              aria-haspopup="dialog"
            >
              <UIcon name="upload" size={16} gold={false} />
              Import
            </button>
            <button
              type="button"
              className={styles.exportBtn}
              onClick={() => setExportOpen(true)}
              aria-haspopup="dialog"
            >
              <UIcon name="download" size={16} gold={false} />
              Export
            </button>
            <button
              type="button"
              className={styles.templatesBtn}
              onClick={openToday}
              title="Open today's daily note (Ctrl+Alt+D)"
              aria-keyshortcuts="Control+Alt+D Meta+Alt+D"
            >
              <UIcon name="sun" size={16} gold={false} />
              Today
            </button>
            <button
              type="button"
              className={styles.templatesBtn}
              onClick={() => setPickerOpen(true)}
              disabled={creating}
              aria-haspopup="dialog"
            >
              Templates
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => createNote()}
              disabled={creating}
            >
              + New note
            </button>
          </div>
        </div>

        <NoteConnectorsTrustStrip />

        <Sheet
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          title="New note"
          variant="auto"
          maxWidth={720}
        >
          <TemplatePicker onPick={handlePick} onPickMember={createFromMemberTemplate} busy={creating} />
        </Sheet>

        <ImportWizard
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImported={handleImported}
        />

        <ExportDialog
          open={exportOpen}
          onClose={() => setExportOpen(false)}
        />

        <SavedViewEditor
          open={saveViewOpen}
          onClose={() => setSaveViewOpen(false)}
          onSave={handleSaveCurrentView}
        />

        {/* UX #1, 2026-09-22: mirrors the folder-delete ConfirmModal in
            FolderSidebar.jsx exactly -- same reason it lives here rather
            than there (folders own rename/remove via their OWN hook call;
            saved views' rename/remove had to live wherever `activeView`
            state lives, which is here, not FolderSidebar). */}
        {deleteViewTarget && (
          <ConfirmModal
            title={`Delete view "${deleteViewTarget.name}"?`}
            body="This removes the saved view. It does not delete any notes."
            confirmLabel="Delete"
            tone="danger"
            onConfirm={onDeleteViewConfirm}
            onClose={() => setDeleteViewTarget(null)}
          />
        )}
        {savedViewError && (
          <div className={styles.error} role="alert">{savedViewError}</div>
        )}

        {error && (
          <div className={styles.error} role="alert">
            Couldn't load your notes — this looks like a connection problem, not lost work.{' '}
            <button type="button" className="btn btn-ghost" onClick={refresh}>Try again</button>
          </div>
        )}

        {selectionOn && selection.count > 0 && (
          <BulkActionBar
            count={selection.count}
            totalInView={visibleIds.length}
            allSelected={selection.allSelected}
            onSelectAll={selection.selectAll}
            onClear={selection.clear}
            trashView={isTrashView}
            archiveView={isArchiveView}
            busy={bulkBusy}
            selectedTags={selectedTags}
            tagNodes={tagTreeNodes}
            onMove={(folderId, folderName) => runBulk('move', { folderId }, { folderName })}
            onAddTag={(t) => runBulk('addTag', { tag: t }, { tag: t })}
            onRemoveTag={(t) => runBulk('removeTag', { tag: t }, { tag: t })}
            onFavorite={() => runBulk('favorite')}
            onUnfavorite={() => runBulk('unfavorite')}
            onExport={() => exportSelection()}
            onTrash={() => runBulk('trash')}
            onRestore={() => runBulk('restore')}
            onArchive={() => runBulk('archive')}
            onUnarchive={() => runBulk('unarchive')}
          />
        )}

        {isLoading && notes.length === 0 ? (
          // G-106 (Wave B lower-frequency sweep): a small grid of card-shaped
          // skeleton placeholders -- reusing the same `.grid` layout the real
          // NoteCard grid renders into -- instead of bare text. Not
          // view-mode-aware (this branch runs before viewMode is even
          // consulted below), so it approximates the DEFAULT list/grid view.
          <div className={styles.grid} role="status" aria-label="Loading…">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className={styles.noteCardSkeleton} aria-hidden="true">
                <SkeletonLine width="70%" height={15} />
                <SkeletonLine width="40%" height={11} />
              </div>
            ))}
          </div>
        ) : notes.length === 0 && isTrashView ? (
          <div className={styles.empty}>
            <p>Trash is empty.</p>
            <p className={styles.emptyHint}>
              Deleted notes stay here for 30 days before they're gone for good.
            </p>
          </div>
        ) : notes.length === 0 ? (
          <div className={styles.empty}>
            <p>Your notebook is empty.</p>
            <p className={styles.emptyHint}>
              Start from a template — or a blank page.
            </p>
            {!hasActiveFilters && (
              <div className={styles.emptyImportPitch}>
                <p className={styles.emptyHint}>
                  Bring your notes from Notion, Obsidian, Evernote, or anywhere else.
                </p>
                <button
                  type="button"
                  className={`${styles.importBtn} ${styles.importBtnEmphasized}`}
                  onClick={() => setImportOpen(true)}
                  aria-haspopup="dialog"
                >
                  <UIcon name="upload" size={16} gold={false} />
                  Import notes
                </button>
              </div>
            )}
            <div className={styles.emptyPicker}>
              <TemplatePicker onPick={handlePick} onPickMember={createFromMemberTemplate} busy={creating} />
            </div>
          </div>
        ) : (
          <>
            {/*
              ⛔ GRAPH IS TESTED BEFORE TABLE AND EXCLUDED FROM TRASH, for the
              same reason the table is: the trash view lists deleted notes, and
              the graph endpoint filters `deleted_at IS NULL` on BOTH ends of
              every edge -- so a member who opened Trash in graph mode would get
              a drawing of their LIVE notebook above a header that says Trash.
              Falling back to the card grid keeps the surface honest.
              ⛔ It also does NOT receive `notes`. The graph reads the whole
              notebook from /api/j2/notes/graph; handing it this page's
              folder/tag/property-filtered slice would draw edges to notes that
              are not on screen and silently drop the rest.
            */}
            {/*
              ⛔ BOARD IS EXCLUDED FROM TRASH for the same reason graph is, plus
              a sharper one: every card carries a control that WRITES a property
              to the note. Offering that on a deleted note would edit something
              the member has already thrown away.
              ⛔ And unlike the graph, the board IS handed `notes` — this page's
              filtered slice. That is the opposite call, deliberately: a board is
              a view OF THE CURRENT SELECTION (the folder/tag/property filter the
              member already chose), whereas a graph is only honest when it draws
              the whole notebook.
            */}
            {/*
              ⛔ Calendar WRITES now (drag a note to another day), so it is
              excluded from Trash for the same reason the board is: its chips
              carry a control that edits a note the member has thrown away.
              ⚰️ This comment used to justify the exclusion by saying the
              calendar was read-only. It was, for one commit.
            */}
            {viewMode === 'calendar' && !isShelfView ? (
              <NoteCalendarView
                notes={notes}
                propertyDefs={propertyDefs}
                onOpenNote={openNote}
                blockedNoteIds={blockedNoteIds}
                onChanged={refresh}
                initialDatePropertyId={activeView?.spec?.dateProperty || null}
                onDatePropertyChange={setCalendarDateProp}
              />
            ) : viewMode === 'board' && !isShelfView ? (
              <NoteBoardView
                notes={notes}
                propertyDefs={propertyDefs}
                onOpenNote={openNote}
                blockedNoteIds={blockedNoteIds}
                onChanged={refresh}
                initialGroupById={activeView?.spec?.groupBy || null}
                onGroupByChange={setBoardGroupBy}
              />
            ) : viewMode === 'graph' && !isShelfView ? (
              /*
                ⛔ THE GRAPH EMITS AN ID; `openNote` READS `.id` OFF A NOTE
                OBJECT. Passing `openNote` straight through type-checks fine,
                renders fine, and opens the editor on `undefined` -- caught by
                NotebookTab.graphView.test.jsx, never by anything structural.
                The adapter lives HERE rather than in the graph because the
                graph genuinely only knows ids: its nodes are {id, title,
                degree}, not notes, and giving it a fake note object to satisfy
                a caller would be the more dishonest of the two shapes.
              */
              <NoteGraphView onOpenNote={(id) => openNote({ id })} />
            ) : viewMode === 'table' && !isShelfView ? (
              <NotesTableView
                notes={notes}
                propertyDefs={propertyDefs}
                sort={sort}
                onSortChange={setSort}
                propertySort={activeView ? activeView.spec?.propertySort : propertySort}
                onPropertySortChange={handlePropertySort}
                onQuickFilter={handleQuickFilter}
                onOpenNote={openNote}
                blockedNoteIds={blockedNoteIds}
                selection={selectionOn ? {
                  isSelected: selection.isSelected,
                  onToggle: (n, opts) => selection.toggle(n.id, opts),
                  allSelected: selection.allSelected,
                  someSelected: selection.count > 0,
                  onToggleAll: () => (selection.allSelected ? selection.clear() : selection.selectAll()),
                } : null}
              />
            ) : (
              <div className={styles.grid}>
                {notes.map((n) => (
                  <NoteCard
                    key={n.id}
                    note={n}
                    onOpen={openNote}
                    onRestore={isTrashView ? restoreNote : undefined}
                    onUnarchive={isArchiveView ? unarchiveNote : undefined}
                    blocked={blockedNoteIds.has(n.id)}
                    selectable={selectionOn}
                    selected={selection.isSelected(n.id)}
                    onToggleSelect={(note, opts) => selection.toggle(note.id, opts)}
                  />
                ))}
              </div>
            )}
            {/* Incremental loading over infinite scroll: simpler, testable,
                and it never fights the page's own scroll container (`.main`
                above scrolls internally — a scroll-triggered fetch bound to
                the wrong element is a standing trap in this codebase). Page
                size stays 100; this always shows how many of how many are
                loaded so the honest total (above, in the sidebar badge) is
                never contradicted by a grid that quietly stops at 100. */}
            <div className={styles.loadMoreRow}>
              <span className={styles.loadMoreCount}>
                {/* `total` is only undefined mid-flight/on error, which this
                    branch can't actually reach (`notes.length > 0` implies
                    the response that produced `notes` also carried `total`)
                    — `?? notes.length` is defensive, not load-bearing
                    (final-review C2: `total` is no longer coerced to 0). */}
                Showing {notes.length} of {total ?? notes.length} note{(total ?? notes.length) === 1 ? '' : 's'}
              </span>
              {hasMore && (
                <button
                  type="button"
                  className={styles.loadMoreBtn}
                  onClick={loadMore}
                  disabled={isLoadingMore}
                >
                  <UIcon name="chevronDown" size={14} gold={false} />
                  {isLoadingMore ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          </>
        )}
          </>
        )}
      </div>
    </div>
  )
}
