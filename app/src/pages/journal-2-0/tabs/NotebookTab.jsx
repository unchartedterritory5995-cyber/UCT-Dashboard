import { Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom'
import useSWR, { mutate as globalMutate, useSWRConfig } from 'swr'
import useJ2Notes from '../hooks/useJ2Notes'
import { applyTargetToParams } from '../lib/searchNavigation'
import { passageNavigationState } from '../lib/openCitation'
import useJ2SavedViews from '../hooks/useJ2SavedViews'
import useJ2PropertyDefs from '../hooks/useJ2PropertyDefs'
import NoteCard from '../components/notebook/NoteCard'
import { TASK_PARAM } from '../lib/noteTasks'
import FolderSidebar from '../components/notebook/FolderSidebar'
import NoteEditorPage from '../components/notebook/NoteEditorPage'
import { MenuRows, useMenuButton } from '../components/notebook/NewNoteMenu'
import { NOTEBOOK_EVENTS, trackNotebookEvent } from '../lib/notebookTelemetry'
import { kindStart, linkOpened, templateFamily } from '../lib/notebookUsage'
import whenIdle from '../lib/whenIdle'
import TemplatePickerSkeleton from '../components/notebook/TemplatePickerSkeleton'
import Sheet from '../../../components/mobile/Sheet'
import UIcon from '../../../components/ui/UIcon'
import { TOOLBAR_ICON } from '../lib/notebookIcons'
import { SkipLinkPortal } from '../../../components/skipLinks'
import { getTemplateAsync, preloadTemplates } from '../lib/templatesLoader'
import { templateWantsTicker } from '../lib/templateWantsTicker'
import { assembleTemplateContext } from '../lib/templateContext'
import { createNoteViaApi } from '../lib/noteCreation'
import { ensureTemplatePropertyDefs, rememberTemplateReveal } from '../lib/templatePropertyDefs'
import { createVoiceNote, voiceNotesEnabled } from '../lib/voiceNote'
import { createTradeCanvasNote, tradeCanvasEnabled } from '../lib/tradeCanvasCreate'
import { invalidateNoteLinkTarget } from '../lib/noteLinkTargetsBatch'
import { AuthContext } from '../../../context/AuthContext'
import { useOutboxDrain } from '../lib/offline/useOutboxDrain'
import { useBlockedNotes } from '../lib/offline/useBlockedNotes'
import { notebookFlag } from '../lib/offline/notebookFlags'
import { reportOptIn } from '../lib/offline/offlineOptInEvent'
import { SAVEABLE_VIEW_MODES, VIEW_MODES } from '../lib/savedViewModes'
import ConfirmModal from '../components/ConfirmModal'
import LoadFailed from '../components/LoadFailed'
import { firstFocusable, treeRowOf } from '../lib/focusAfterRemoval'
import { SkeletonLine } from '../../../components/Skeleton'
import styles from './NotebookTab.module.css'
import { settleNoteWrite } from '../lib/offline/settleNoteWrite'
import NoteMenuActions from '../components/notebook/NoteMenuActions'
import { ARCHIVED_FOLDER, setNoteArchived } from '../lib/noteArchive'
import { getMemberTemplate } from '../lib/memberTemplates'
import { stepTrail, stepsBackToList } from '../lib/noteReturnTrail'
import {
  DAILY_FOLDER_NOTICE, DAILY_TEMPLATE_MISSING, DAILY_TEMPLATE_PREF, isDailyShortcut, openDailyNote, takeQueuedNotebookNotice,
} from '../lib/dailyNote'
import usePreferences from '../../../hooks/usePreferences'
import { useNoteSelection } from '../lib/noteSelection'
import { isBulkActionsShortcut } from '../lib/bulkActionsShortcut'
import { registerShortcuts } from '../../command/shortcutRegistry'
import useToolbarRoving from '../lib/useToolbarRoving'
import useGridRoving from '../lib/useGridRoving'
import { useIsDesktop, useIsPhone } from '../../../hooks/useBreakpoint'
import { NotePaneContext, SIDE_PARAM, SplitViewContext } from '../lib/splitView'
import { NOTEBOOK_SEARCH_HASH } from '../lib/notebookSearchDoor'
import { openJournalTools, registerJournalToolsDoor } from '../lib/journalToolsDoor'
import { TOUR_REVEAL_EVENT } from '../components/notebook/onboarding/tourAnchorVisibility'
import { NOTEBOOK_LIST_HASH, NOTEBOOK_TEMPLATES_HASH } from '../lib/notebookDoors'
import { useHubEligible } from '../../../hub/useHubActive'
import { BOTTOM_OFFSET_PX, PAD_PX } from '../../../hub/constants'
import useJ2NoteTags from '../hooks/useJ2NoteTags'
import { invalidateNoteViews } from '../lib/offline/invalidateNoteViews'
import { reviewDraftsEnabled } from '../lib/reviewDraftsFlag'
// Fix round 1 (first-open bytes): the Reviews rows' words are on first open; the drafting door is fetched on the first press.
import { REVIEW_PERIODS, reviewDraftFailedSentence, reviewDraftingSentence } from '../lib/reviewPeriods'
import useJ2SelectedAccount from '../hooks/useJ2SelectedAccount'
import { checklistEnabled, withDone } from '../components/notebook/onboarding/gettingStartedPref'
import { NOTEBOOK_TITLE } from '../../../surfaces/pageTitle.js'
import { fallbackNodes } from '../lib/tagTree'
import lazyChunk, { importWithOneRetry } from '../lib/lazyChunk'
import { ACTION_UNAVAILABLE, RELOAD_TO_RECOVER, heldModule, pageReload, useHeldModule } from '../lib/heldModule'
import NotebookAiPanelSlot, { warmAiPanel } from '../components/notebook/NotebookAiPanelSlot'
import { journalStylesEnabled } from '../lib/journalStylesFlag'
import { widgetsWaveOn, doorLostSentence } from '../lib/notebookWidgetsFlags'
// Tier 2 part B (R-T2B-7): the earnings follow-up card. The slot is small and static; the card itself is a lazy
// chunk it fetches the first time a follow-up link is open (V12: a failed fetch leaves the Notebook standing).
import { earningsFollowupEnabled } from '../lib/earningsFollowupFlag'
import FollowupOfferSlot from '../components/notebook/FollowupOfferSlot'
import { loadStyle } from '../components/notebook/styles/lazyStyles'
import NotebookTourGate from '../components/notebook/onboarding/NotebookTourGate'
import FirstRunGate from '../components/notebook/FirstRunGate'
import { TODAY_READ_URL, TODAY_VIEW, todayLandingOn } from '../lib/todayHome'
import { FIRST_RUN_DUE, FIRST_RUN_MARKS, FIRST_RUN_UNDECIDED, firstRunIsDue, setFirstRunPending } from '../lib/firstRun'
import { starterPacksEnabled } from '../lib/starterPacksFlag'
import { TIPS_PREF, seenTips } from '../lib/notebookTips'
// Wave 14: every OTHER registered tour, beyond the base one above, runs through the generic
// engine, whose gate (RegistryToursGate) is mounted ONCE in the app shell (components/Layout.jsx,
// lane W14-C1) so a tour can start on any page and survive the navigation to its start.
// Wave 14 (lane W14-C2): "newly switched on, offer once" -- a gate that fetches its small
// card only when a registered tour is due to be offered. It is reached through a DOOR that
// reads the wave-14 switch first, so with the switch off none of the offer's rules ride in
// the first open. `OTHER_TOURS` is one frozen module-level array (tourRegistry.js), so the
// gate's own effects see a stable list.
import TourOfferDoor from '../components/notebook/onboarding/TourOfferDoor'
import NotebookPlusFab from '../components/notebook/NotebookPlusFab'
import { holdImageForNote } from '../lib/pendingImageInsert'
import { GettingStartedSkipLink } from '../components/notebook/onboarding/keyboardDoors'
import GettingStartedChecklist, { useGettingStartedCardUp } from '../components/notebook/GettingStartedChecklist'
// Fix round 1 (first-open bytes): what the list needs before a press about the sample notebook is its keys module and
// the two hooks; the sample's client (sampleNotebook.js: add, the removal's sentences, remove) is fetched on a press,
// and the zero-notes door is a lazy chunk (below).
import { loadSampleNotebook, useAddSampleNotebook } from '../components/notebook/onboarding/useSampleNotebook'
import {
  SAMPLE_PREF, SAMPLE_ROW_COPY, SAMPLE_URL, readSamplePref,
} from '../components/notebook/onboarding/sampleNotebookKeys'
import { OTHER_TOURS } from '../components/notebook/onboarding/tourRegistry'

// ── Wave 7 (lane I3): the views and dialogs a member opens ON PURPOSE load on demand ──
// Graph, board, calendar, timeline and tasks are view modes; Import and Export are
// dialogs. None of them is what the Notebook paints first (the note list and the
// editor are, and they stay static), so each is its own chunk, fetched the first time
// it is shown. The wrappers keep each view's NAME, so nothing below this block
// changed: every render site reads exactly as it did.
// ⛔ One <Suspense> per view, never one around the page: a boundary around the page
// would blank the list and the editor while a view's chunk downloads.
// Each chunk loads through `lazyChunk`: a failed fetch is retried once in place, and a
// second failure (a deploy since this tab loaded) reloads the page the way every lazy
// route in App.jsx already does (review M-5).
// `fallback` (Task 7.3): a view that is not a page region -- the bulk bar -- passes `null` so nothing
// flashes while its chunk loads; every other view keeps the skeleton.
// Go-live wave 1 (A7): the sample's status read (asked for once ⋯ has been opened) and the "anyway" op of its removal.
// A failed read THROWS (Wave 10 F7), so it shows no row rather than a row for a sample that may be gone.
const SAMPLE_STATUS_SWR = Object.freeze({ revalidateOnFocus: false, shouldRetryOnError: false })
const fetchSampleStatus = (url) => fetch(url, { credentials: 'include' }).then((r) => {
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
})
const REMOVE_SAMPLE_OP = 'remove-sample'

// Follow-up A (first-open bytes): the bulk actions' library (lib/noteBatch.js) is fetched on idle, when a selection
// starts and when the More menu opens, and a press awaits it while the bulk bar is already busy (startBulk). A fetch
// that fails twice says so in the notice line with a Reload the member presses: never an automatic reload, never a
// throw out of the list. A later press asks again.
export const noteBatchLoader = { load: () => import('../lib/noteBatch') }
export const BULK_UNAVAILABLE = ACTION_UNAVAILABLE
export const isNoteBatch = (m) => typeof m?.runNoteBatch === 'function'
let noteBatchLib = null
let noteBatchInflight = null
export function loadNoteBatch() {
  if (noteBatchLib) return Promise.resolve(noteBatchLib)
  if (!noteBatchInflight) {
    // Fix round 1 (I1): noteBatch has no default export, so the retry's accept test is the module's own door; the
    // default ("has a default export") threw a successful retry away and left every bulk action dead in the tab.
    noteBatchInflight = importWithOneRetry(() => noteBatchLoader.load(), undefined, isNoteBatch).then(
      (m) => { noteBatchLib = m; noteBatchInflight = null; return m },
      () => {
        noteBatchInflight = null
        const err = new Error(BULK_UNAVAILABLE)
        err.chunkLost = true
        throw err
      },
    )
  }
  return noteBatchInflight
}
const warmNoteBatch = () => { loadNoteBatch().catch(() => {}) }
/** Tests only: forget the library, as on a fresh page. */
export const __resetNoteBatchForTests = () => { noteBatchLib = null; noteBatchInflight = null }
const chunkLostNotice = () => ({ message: `${BULK_UNAVAILABLE} ${RELOAD_TO_RECOVER}`, tone: 'error', reload: true })
// Fix round 1 (first-open bytes): the View menu's "Saved views" group is a chunk of its own. It is asked for when the
// browser is idle after the list's first paint, and again when a pointer or focus reaches "View", into a module-level
// slot, so it is in hand by the time the menu opens; until then the group is simply not drawn yet. Fix round 2: drawn
// straight from the slot, never React.lazy (a lazy view suspends on its first render even with its chunk in hand, and
// the rows would arrive about 300 ms after the menu, under a member's arrow keys; lib/heldModule.js). A fetch that
// fails leaves the group undrawn (never a page reload) and is asked for again on the next pointer or focus.
const savedViewsGroupModule = heldModule(() => import('../components/notebook/SavedViewsMenuGroup'))
const preloadSavedViewsGroup = () => { savedViewsGroupModule.warm() }
function SavedViewsMenuGroup(props) {
  const { Component } = useHeldModule(savedViewsGroupModule)
  return Component ? <Component {...props} /> : null
}
// Fix round 1: the zero-notes "Add a sample notebook" door, fetched when the empty state draws (it renders nothing until
// it lands, and nothing at all for a member it is not for).

// `fallback`: undefined draws the loading line; an element (or null) is drawn as is; a component gets the view's props
// (the Daily brief's, so its focus landing exists while its chunk is on the way).
function lazyView(load, label, fallback) {
  const Chunk = lazyChunk(load)
  const loading = <div role="status" aria-label={`Loading ${label}`}><SkeletonLine width="40%" height={13} /></div>
  function LazyNotebookView(props) {
    const Fallback = typeof fallback === 'function' ? fallback : null
    return (
      <Suspense fallback={Fallback ? <Fallback {...props} loading={loading} /> : fallback === undefined ? loading : fallback}>
        <Chunk {...props} />
      </Suspense>
    )
  }
  LazyNotebookView.displayName = `Lazy(${label})`
  return LazyNotebookView
}

// A dialog that is always rendered with `open` is fetched on its FIRST open and then
// stays mounted, so its own close handling (both reset on `open` turning false, and
// guard their in-flight work with a generation counter) runs exactly as before.
// Before the first open it renders nothing, which is what a closed Sheet renders.
function lazyDialog(load, label) {
  const Chunk = lazyChunk(load)
  function LazyNotebookDialog(props) {
    const [opened, setOpened] = useState(Boolean(props.open))
    if (props.open && !opened) setOpened(true)
    if (!opened) return null
    return (
      <Suspense fallback={null}>
        <Chunk {...props} />
      </Suspense>
    )
  }
  LazyNotebookDialog.displayName = `Lazy(${label})`
  return LazyNotebookDialog
}

// Task 7.3: the bulk bar is fetched on the FIRST selection (it is only rendered while
// `selectionOn && selection.count > 0`), so a member who never ticks a note never pays for it.
const BulkActionBar = lazyView(() => import('../components/notebook/BulkActionBar'), 'bulk actions', null)
// Task 7.4: the template picker (inline on the empty notebook, and in the New-note sheet) is its own chunk, and it
// brings the catalog with it (lib/templatesLoader.js). While either loads, the skeleton holds the picker's box and
// the tour's gallery-door anchor, so a tour waiting on that anchor still finds it.
const TemplatePicker = lazyView(() => import('../components/notebook/TemplatePicker'), 'templates', <TemplatePickerSkeleton />)
// Task 7.6: the connected-apps sync line under the list header (and its status hook). It renders nothing until
// its status read lands, so it loads after first paint with nothing in its place (`null` fallback).
const NoteConnectorsTrustStrip = lazyView(() => import('../components/connectors/NoteConnectorsTrustStrip'), 'connected apps status', null)
const NoteGraphView = lazyView(() => import('../components/notebook/NoteGraphView'), 'graph')
// Tier 1a bytes (perf-budgets.md): the table view mode, fetched on its first use like every other view mode.
const NotesTableView = lazyView(() => import('../components/notebook/NotesTableView'), 'table')
// Notebook P1 (spec P1.4): the kind picker at the top of the New-note sheet. Lazy; gate off = never rendered.
const KindSection = lazyView(() => loadStyle('KindSection'), 'kinds')
const NoteBoardView = lazyView(() => import('../components/notebook/NoteBoardView'), 'board')
const NoteCalendarView = lazyView(() => import('../components/notebook/NoteCalendarView'), 'calendar')
const NoteTimelineView = lazyView(() => import('../components/notebook/NoteTimelineView'), 'timeline')
const NoteTasksView = lazyView(() => import('../components/notebook/NoteTasksView'), 'tasks')
// Audit 2026-11-05, S15: the Today home (the Daily brief since Notebook simplify, Task 5), fetched the first time it is
// shown (lib/todayHome.js is the eager half). Tier 3b fix round 1 (I1): on its own address (`?view=today`) its chunk is
// asked for in the Notebook's FIRST render, beside the preferences read -- never after, which made three round trips
// in a row (preferences, then this chunk, then /notes/today).
// ONE import in flight for both callers (the preload and the view): a failed one is forgotten, so the view's own
// retry (lazyChunk) asks again.
let todayHomeImport = null
const loadTodayHome = () => {
  if (!todayHomeImport) {
    todayHomeImport = import('../components/notebook/TodayHome')
    todayHomeImport.catch(() => { todayHomeImport = null })
  }
  return todayHomeImport
}
// Simplify pass 2: the brief draws the page's one "Daily brief" heading and takes the pane's focus ref for it. Until its
// chunk lands, the pane's own hidden heading of the same words holds that ref, so a focus call in that window still
// lands on a heading (deleteFocusFallback.test.jsx); if it holds focus as the brief replaces it, focus moves on to the
// brief's heading rather than falling to <body>.
function TodayHomeLoading({ headingRef, loading }) {
  // An unmount cleanup runs before React detaches the heading's ref, so the ref still names this heading here.
  useLayoutEffect(() => () => {
    const el = headingRef?.current
    if (el && el === document.activeElement) queueMicrotask(() => headingRef.current?.focus())
  }, [headingRef])
  return (
    <>
      <h2 ref={headingRef} tabIndex={-1} className={styles.paneHeading} data-focus-fallback="">Daily brief</h2>
      {loading}
    </>
  )
}
const TodayHome = lazyView(loadTodayHome, 'today', TodayHomeLoading)
// Go-live wave 1, fix round 1 (first-open bytes): the zero-notes sample door, through `lazyView` with a null fallback
// (nothing flashes while the chunk lands).
const SampleNotebookDoor = lazyView(() => import('../components/notebook/onboarding/SampleNotebookDoor'), 'sample notebook', null)
// Notebook simplify, Task 5: Research home is no longer routed (`?view=home` opens the list). Its notebook-wide Ask
// is the list toolbar's "AI" section, a chunk of its own: fix round 2 draws it from a warmed slot, so the question
// field has focus without React.lazy's first-render hold (components/notebook/NotebookAiPanelSlot.jsx).
const ImportWizard = lazyDialog(() => import('../components/notebook/import/ImportWizard'), 'import')
// Plan F Task 10: the one-time notice for imports that lost pictures. Fetched only when the server
// says there is one to show, so the first-open bytes are unchanged for everyone else.
const ImportRepairNotice = lazyView(() => import('../components/notebook/ImportRepairNotice'), 'import repair notice', null)

// Plan F Task 10: ONE read of the notice per page load AND MEMBER, shared by every mount of this
// tab (no polling, and switching tabs and back does not ask again). Final review M-1: signing out
// does not reload the page, so the read is keyed on the member's id: a different member on the
// same tab reads their own notice, never the last member's count. No member, no read. Resolves to
// the count of notes that lost something, or 0 for "nothing to show" -- a failed read included,
// so it never blocks the list.
const REPAIR_NOTICE_URL = '/api/j2/notes/import/repair-notice'
let repairNoticeRead = null // { userId, promise }
function readRepairNotice(userId) {
  if (!userId) return Promise.resolve(0)
  if (!repairNoticeRead || repairNoticeRead.userId !== userId) {
    const promise = fetch(REPAIR_NOTICE_URL, { credentials: 'include' })
      .then((r) => (r && r.ok ? r.json() : null))
      .then((b) => {
        const n = Number(b?.lossNotes)
        return b?.show === true && Number.isInteger(n) && n > 0 ? n : 0
      })
      .catch(() => 0)
    repairNoticeRead = { userId, promise }
  }
  return repairNoticeRead.promise
}
// Either button retires it for this page load at once; the POST retires it for good. A failed POST
// leaves the server row, so the notice can come back on a later load: never lost, never repeated here.
function dismissRepairNotice(userId) {
  repairNoticeRead = { userId, promise: Promise.resolve(0) }
  return fetch(`${REPAIR_NOTICE_URL}/dismiss`, { method: 'POST', credentials: 'include' }).catch(() => null)
}
export function __resetRepairNoticeForTests() { repairNoticeRead = null }
const ExportDialog = lazyDialog(() => import('../components/notebook/export/ExportDialog'), 'export')
// Wave 9 (lane 9D, D2): the sidebar's Publish-folder confirmation, fetched on its first open.
const PublishFolderSheet = lazyDialog(() => import('../components/notebook/PublishFolderSheet'), 'publish folder')
// Wave 11 lane 11A: the voice-note dialog, fetched the first time a member starts one. It is
// rendered only while a voice note is in progress, so each start mounts it afresh.
const VoiceNoteDialog = lazyDialog(() => import('../components/notebook/VoiceNoteDialog'), 'voice note')
// Notebook P1: the Journal styles manager, fetched the first time it is opened (a creating door, gated below).
const NOOP = () => {}
// S12 (B13), fix round 1: the folders sheet inside a note on a phone, on its first open through `lazyDialog`.
const FolderSheet = lazyDialog(() => import('../components/notebook/FolderSheet'), 'folders')
// S12 (M9): the phone "+" sheet, on its first open through `lazyDialog` (fix round 1: first-open bytes).
const NotebookPlusSheet = lazyDialog(() => import('../components/notebook/NotebookPlusSheet'), 'add')
const StylesManager = lazyDialog(() => import('../components/notebook/styles/StylesManager'), 'journal styles')
// Task 7.6: the "Save view" name prompt, fetched the first time a member opens it (before that, a closed
// Sheet renders nothing, which is what lazyDialog renders).
const SavedViewEditor = lazyDialog(() => import('../components/notebook/SavedViewEditor'), 'save view')

// ── Wave 9 (lane 9D, D2): the folder Publish door ────────────────────────────
// FolderSidebar renders `extraFolderActions` as `{id, label, onSelect(folder)}` buttons named
// `${label} ${folder.name}` (its wave-8 extension point); it is NOT edited (ruling D-9D3).
/** The action's label, and the first word of its accessible name. */
const PUBLISH_FOLDER_ACTION = 'Publish'
/** No actions: one frozen array, so a render with the gate off hands FolderSidebar the same value. */
const NO_FOLDER_ACTIONS = Object.freeze([])
/**
 * The button FolderSidebar rendered for this action on `folder`, to hand focus back to when the
 * sheet closes. `onSelect` gets the folder, not the event: after a keyboard press or a Chromium
 * click the button IS the focused element; Safari does not focus a clicked button, so it is found
 * by the name FolderSidebar gives it.
 */
function folderActionButton(label, folder) {
  const name = `${label} ${folder.name}`
  const active = typeof document !== 'undefined' ? document.activeElement : null
  if (active?.getAttribute?.('aria-label') === name) return active
  return [...document.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label') === name) || null
}

// Wave 8 seam S8-3: the first-run tour (lane 8C builds it in onboarding/NotebookTour.jsx).
// Its own chunk, outside the Notebook's first-open closure (dispatch-plan R9). ⛔ Final-review
// fix I-2: NotebookTourGate (static, small) decides whether the chunk is fetched AT ALL -- only
// when the tour is about to show -- and loads it through `lazyLeaf` inside a boundary that
// renders nothing, so a failed chunk can neither reload the page nor take the Notebook down.

// Folders panel resize bounds (px).
const SB_MIN = 190
const SB_MAX = 520
const SB_DEFAULT = 260
// Notebook simplify, Task 3: List view's layout, 'rows' (default) or 'cards'. Per browser, like the folders panel.
const LIST_LAYOUT_KEY = 'uct.notebook.list.layout'

// Wave 10 lane DR-F (design finding D-7): on a phone the folder/tag tree is
// long (Recents, All notes/Unfiled/Archived/Trash, a folder tree, tags) and
// stacks ahead of whatever comes next in document order. D-7 folded it for the
// icon-row view modes only, on the reasoning that List is reached at scroll 0
// and the member scrolls past the tree. ⚰️ Measured 2026-10-10 at 390x844 that
// reasoning did not hold: the tree filled the ENTIRE first screen on Research
// Home and All notes, so no note was visible without scrolling. The phone drawer
// rule (the effect beside `isShelfView` below) now folds it for every view.

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
const TAG_COUNT_OPS = new Set(['addTag', 'removeTag', 'renameTag', 'trash', 'restore', 'archive', 'unarchive'])
// M5 (wave 6 fix round 2): matches NOTE_BATCH_MAX in api/routers/journal_two.py
// (`POST /api/j2/notes/batch` refuses more ids than this in one request) — the
// tag-rename door's own client-side chunk size, since its ids come from an
// UNCAPPED preview (GET /notes/tag-members), unlike every other bulk op's ids
// (the member's own, page-bounded, selection).
const RENAME_TAG_CHUNK_SIZE = 500

/** The phone fold rule (one authority for the seed and the effect): at <=640 px, on a list or Home (not a note, not
 *  the `#search` door, which opens the panel on purpose), the folders panel is folded. Exported for its rail. */
/** The sort select's choices: the full words, and the compact ones a phone shows (Tier 2). */
export const SORT_OPTIONS = Object.freeze([
  { value: 'updated', label: 'Recently updated', short: 'Updated' },
  { value: 'created', label: 'Recently created', short: 'Created' },
  { value: 'title', label: 'Title', short: 'Title' },
])

export function phoneArrivalFolds(noteId, hash) {
  if (typeof window === 'undefined' || window.innerWidth > 640) return false
  return !noteId && hash !== NOTEBOOK_SEARCH_HASH
}

export default function NotebookTab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const navigationType = useNavigationType()
  const noteId = searchParams.get('note')
  // Audit 2026-11-05, S5 (B11): the Notebook's home names the tab "Notebook · UCT Intelligence"
  // (it read "Journal"); an open note's editor names it after the note. Closing the note (a query
  // change, which the shell's pathname-keyed title never sees) puts the home's title back.
  useEffect(() => { if (!noteId) document.title = NOTEBOOK_TITLE }, [noteId])
  // Wave 6 (lane E, item 7) — split view: `?side=` is a second note beside the
  // first, desktop only. Each pane is an ordinary editor (lib/splitView.js).
  // ⛔⛔ `sideId` is NEVER the open note: a URL naming one note twice (a pasted
  // link, Back into an old state, an editor that routed `?note=` to the note on
  // the right) opens it ONCE. Two editors on one note are two writers, and the
  // offline layer forks the note. The doors below refuse it with words; this is
  // the line that holds whatever door the URL came through.
  const isDesktop = useIsDesktop()
  const sideParam = searchParams.get(SIDE_PARAM)
  const sideId = isDesktop && noteId && sideParam && sideParam !== noteId ? sideParam : null

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

  // Wave 9 (lane 9D, D2): "Publish" on every folder row — only while the publish gate is
  // LATCHED on (`notebookFlag`, as SharingCard and the editor's Share door read it; a tab that
  // has not heard from the server reads as off) and for a paid member, the same pair the Share
  // door requires: the server answers a free member 402, and a door whose only result is a
  // refusal is not offered. Selecting it opens a confirmation (ruling D-9D1), never a publish.
  const publishOn = notebookFlag('notebook_publish_enabled') === true && auth?.isPaid === true
  // Wave 11 lane 11A: "Start from audio" in the New note sheet — only while the
  // voice-notes gate is LATCHED on and for a paid member (the routes answer 404 / 402
  // otherwise, and a door whose only result is a refusal is not offered).
  const voiceOn = voiceNotesEnabled(auth?.isPaid)
  const [voiceNote, setVoiceNote] = useState(null) // { source }
  const [publishFolder, setPublishFolder] = useState(null) // { id, name, opener, open }
  const listToolbar = useToolbarRoving()
  const notesGrid = useGridRoving({ rowSelector: '[data-note-row]' })
  const extraFolderActions = useMemo(() => (publishOn ? [{
    id: 'publish',
    label: PUBLISH_FOLDER_ACTION,
    icon: 'globe',
    // Where focus goes back to when the sheet closes: the row's Publish button for a member
    // who pressed it, the folder's own row for one who chose Publish from the row's keyboard
    // menu (lane KEYS round 4: the menu is gone by then, and the row is where they were).
    onSelect: (folder) => setPublishFolder({
      id: folder.id, name: folder.name, open: true,
      opener: (document.activeElement?.closest?.('[role="menu"]')
        && [...document.querySelectorAll('[data-tree-folder]')]
          .find((el) => el.getAttribute('data-tree-folder') === String(folder.id)))
        || folderActionButton(PUBLISH_FOLDER_ACTION, folder),
    }),
  }] : NO_FOLDER_ACTIONS), [publishOn])
  // Closing keeps the folder (and its button) until the sheet has handed focus back.
  const closePublishFolder = useCallback(() => setPublishFolder((f) => (f ? { ...f, open: false } : f)), [])

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
  // Task 7.2: warm the template catalog once idle, so a template pick or deep link is usually instant.
  useEffect(() => preloadTemplates(), [])

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
  // `?view=<mode>` opens that VIEW_MODES mode on first paint — `tasks` was the
  // only id this ever recognised (the reminder's link — TASKS_VIEW_URL in
  // api/services/journal_two/note_tasks.py), which is also the deep-link door
  // A2R-03 found broken: a graph/board/calendar/table URL seeded `viewMode`
  // with 'list' here, same as a bare root, and nothing downstream ever
  // corrected it until a click. The effect below handles the same set
  // arriving on an already-mounted tab.
  const [viewMode, setViewMode] = useState(() => {
    const vp = searchParams.get('view')
    return VIEW_MODES.some((m) => m.id === vp) ? vp : 'list'
  })
  // What the board is grouping by / the calendar is laying out, reported up by
  // those views so a saved view can capture it. The views keep their own
  // "open on a property the notes actually use" default-picking; this only
  // observes the answer.
  const [boardGroupBy, setBoardGroupBy] = useState(null)
  const [calendarDateProp, setCalendarDateProp] = useState(null)
  // Wave 6: what the timeline places by, its zoom and grouping, as it REPORTS
  // them — so a saved timeline stores what was drawn, not a default.
  const [timelineSettings, setTimelineSettings] = useState(null)
  const [propertyFilter, setPropertyFilter] = useState(null)
  const [propertySort, setPropertySort] = useState(null)
  const [saveViewOpen, setSaveViewOpen] = useState(false)
  const {
    savedViews, error: savedViewsError, isLoading: savedViewsLoading, refresh: refreshSavedViews,
    create: createSavedView, rename: renameSavedView, remove: removeSavedView,
  } = useJ2SavedViews()
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
  // ⛔ F7 Part C (F4 review, Important 1): focus must never fall to <body> after a delete.
  // Notebook simplify, Task 2: the view's Delete is a row of the View menu now, and the menu hands
  // focus to its "View" button before the confirm opens, so the confirm gives focus back THERE.
  // When that button is gone too (deleting the view in use can take the list, and its toolbar,
  // away), the dialog's `fallbackFocus` is the pane's heading, else "All notes".
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
  const { propertyDefs, error: propertyDefsError, refresh: refreshPropertyDefs } = useJ2PropertyDefs()
  const [creating, setCreating] = useState(false)
  // App focus (= charts Group A) seeds a new entry's ticker.
  // false | true | 'kinds' (Notebook P1: "From a template" opens the sheet with focus on the first kind, not the search box)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  // Plan F Task 10: the wizard opened from the repair notice starts with "Re-import to recover" ticked,
  // and hands focus back to the pane heading on close (the notice and its button are gone by then).
  // Both are set at OPEN and left alone on close, so the Sheet still reads them as it closes;
  // every ordinary Import door goes through `openImport`, which clears them.
  const [importRecover, setImportRecover] = useState(false)
  const [importReturnFocus, setImportReturnFocus] = useState(null)
  const openImport = useCallback(() => {
    setImportRecover(false)
    setImportReturnFocus(null)
    setImportOpen(true)
  }, [])
  const [repairLossNotes, setRepairLossNotes] = useState(0)
  const repairUserId = auth?.user?.id || null
  useEffect(() => {
    let live = true
    setRepairLossNotes(0) // a member change never shows the previous member's count meanwhile
    readRepairNotice(repairUserId).then((n) => { if (live) setRepairLossNotes(n) })
    return () => { live = false }
  }, [repairUserId])
  // Review M-1: either button unmounts the notice, and the button with it, so focus must not be left
  // to fall to <body>. It goes to the pane heading, the Notebook's landing place for focus with
  // nowhere better to go: at once after Dismiss, and through the wizard's `returnFocusTo` when the
  // wizard closes after Recover. `paneHeadingRef` is declared further down; these run on a click.
  const retireRepairNotice = useCallback(() => {
    setRepairLossNotes(0)
    dismissRepairNotice(repairUserId)
  }, [repairUserId])
  const dismissRepair = useCallback(() => {
    retireRepairNotice()
    paneHeadingRef.current?.focus()
  }, [retireRepairNotice])
  // Review M-5: the dismiss is a best-effort write and is NOT awaited. It is sent first (so it
  // still goes out before anything the wizard asks for), and the wizard opens at once.
  const recoverFromRepairNotice = useCallback(() => {
    retireRepairNotice()
    setImportRecover(true)
    setImportReturnFocus(paneHeadingRef)
    setImportOpen(true)
  }, [retireRepairNotice])
  // ONE element, rendered by whichever pane branch is on screen (Research Home or a list).
  const repairNotice = repairLossNotes > 0 ? (
    <ImportRepairNotice
      lossNotes={repairLossNotes}
      onRecover={recoverFromRepairNotice}
      onDismiss={dismissRepair}
    />
  ) : null
  // Notebook P1: the Styles manager. `?styles=1` (the Settings card's link) asks to open it, once, and leaves the URL
  // clean. The request is kept even if the switch has not latched yet; ONLY the render gate below decides whether
  // anything shows (one guard, not two).
  const stylesOn = journalStylesEnabled()
  const [stylesOpen, setStylesOpen] = useState(() => searchParams.get('styles') === '1')
  // Follow-up C: where the manager opens (`show`, read by StylesManager once per opening: 'archived', 'deleted',
  // 'plain', 'daily'; anything else is Active). `n` makes a second ask with the same place a new one.
  const [stylesAsk, setStylesAsk] = useState(() => ({ show: searchParams.get('styles') === '1' ? searchParams.get('show') : null, n: 0 }))
  const openStyles = useCallback((show = null) => {
    setStylesAsk((a) => ({ show, n: a.n + 1 }))
    setStylesOpen(true)
  }, [])
  useEffect(() => {
    if (searchParams.get('styles') !== '1') return
    // `?styles=1&show=archived|deleted|plain` (My tools' "Open Manage templates", a link that wants a place): read
    // once, then both leave the URL. 'daily' is an in-app ask only, so the URL cannot name it.
    const show = searchParams.get('show')
    openStyles(show === 'daily' ? null : show)
    setSearchParams((prev) => { const p = new URLSearchParams(prev); p.delete('styles'); p.delete('show'); return p }, { replace: true })
  }, [searchParams, setSearchParams, openStyles])
  // Plan E Task 10: `?import=evernote` (the Evernote tile's `.enex` offer, `ENEX_IMPORT_HREF` in
  // connectors/evernoteCopy.js; NotebookTab.importParam.test.jsx routes to that constant) opens the
  // import wizard once, through the ordinary door, and leaves the URL clean. The same pattern as `?styles=1`.
  useEffect(() => {
    if (searchParams.get('import') !== 'evernote') return
    openImport()
    setSearchParams((prev) => { const p = new URLSearchParams(prev); p.delete('import'); return p }, { replace: true })
  }, [searchParams, setSearchParams, openImport])
  // Notebook widgets phase 2 (wave 8, Task 8.18): the My tools door, beside Styles, while wave 8 is on. My tools is
  // lazy (its own root, the openMyTools door), so a static import here would put it on the Notebook's first open.
  // Links out of it go through this tab's router (R-45).
  const toolsOn = widgetsWaveOn(8)
  const openTools = () => {
    import('../components/notebook/myTools/openMyTools.js')
      .then((m) => { m.openMyTools({ tab: 'widgets', uid: auth?.user?.id, navigate: (to) => navigate(to) }) },
        () => setActionError(doorLostSentence()))   // fix round 1 m-1: the / doors' own sentence, never silent
  }
  const [exportOpen, setExportOpen] = useState(false)
  // Bumped on a successful import to force-remount FolderSidebar, which owns
  // its own useJ2NoteFolders() SWR hook — an import can create new folders
  // and there's no other handle on that hook's mutate() from up here.
  const [folderRefreshKey, setFolderRefreshKey] = useState(0)
  const deepLinkRan = useRef(false)
  // Task 7.4 (ruling R-6): the deep link awaits the catalog. When it lands, the tab must still be mounted and the
  // member must not have opened a note or started a create meanwhile. Refs, because the effect's closure is stale.
  const deepLinkAlive = useRef(true)
  const openOrCreating = useRef(false)
  useEffect(() => {
    deepLinkAlive.current = true
    return () => { deepLinkAlive.current = false }
  }, [])
  useEffect(() => { openOrCreating.current = Boolean(noteId) || creating }, [noteId, creating])

  // Folders panel: open/closed + width, persisted locally so it survives reloads.
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    // Tier 2 (production check of Tier 1b, phone CLS 0.30): on a phone the panel is a drawer that folds on arrival
    // (the effect below). Seeded OPEN from the stored choice, it painted the whole folder tree above the notes for
    // one frame and the fold then moved the notes pane up by the tree's height -- one layout shift of 0.3035, the
    // whole phone CLS. It now STARTS folded wherever that effect would fold it, so no frame ever paints it open.
    if (phoneArrivalFolds(noteId, location.hash)) return false
    try { return localStorage.getItem('uct.j2.nb.sidebarOpen') !== '0' } catch { return true }
  })
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem('uct.j2.nb.sidebarWidth'), 10)
      return Number.isFinite(v) ? Math.min(SB_MAX, Math.max(SB_MIN, v)) : SB_DEFAULT
    } catch { return SB_DEFAULT }
  })
  // Notebook simplify, Task 3: how List view draws its notes -- 'rows' (one note per row, the default) or 'cards'
  // (the grid). A display choice inside List view, kept in this browser; NOT a view mode (saved views and the server's
  // modes are untouched). Anything else stored reads as rows.
  const [listLayout, setListLayoutState] = useState(() => {
    try { return localStorage.getItem(LIST_LAYOUT_KEY) === 'cards' ? 'cards' : 'rows' } catch { return 'rows' }
  })
  const setListLayout = (next) => {
    setListLayoutState(next)
    try { localStorage.setItem(LIST_LAYOUT_KEY, next) } catch { /* private mode */ }
  }
  const [dragging, setDragging] = useState(false)
  const wrapRef = useRef(null)
  const dragWidthRef = useRef(sidebarWidth)

  const toggleSidebar = () => setSidebarOpen((open) => {
    const next = !open
    try { localStorage.setItem('uct.j2.nb.sidebarOpen', next ? '1' : '0') } catch { /* private mode */ }
    return next
  })
  // S12 (audit 2026-11-05, B13): on a phone, inside a note, Folders opens the folders panel as a bottom SHEET. ⚰️ It
  // flipped `sidebarOpen` while the note-open rule kept the panel hidden, so the button vanished and nothing showed.
  // Fix round 1 (review Important 6): the sheet is the repo's Sheet (FolderSheet, on demand) around the same
  // FolderSidebar, opened from a Folders button that stays on screen; it never touches the stored sidebar choice.
  const [folderSheet, setFolderSheet] = useState(false)
  const folderSheetBtnRef = useRef(null)
  // Fix round 2 (re-review N1): the sheet is a PHONE thing. On a tablet or desktop the panel itself is on screen beside
  // a note, so Folders expands it. Read at the press (the width the member is looking at; this file's other phone
  // checks read `innerWidth` the same way, and a media hook can be stale at first paint).
  const openFolders = () => {
    if (noteId && typeof window !== 'undefined' && window.innerWidth <= 640) { setFolderSheet(true); return }
    if (!sidebarOpen) toggleSidebar()
  }
  useEffect(() => { setFolderSheet(false) }, [noteId])
  const closeSheetThen = (fn) => (...args) => { setFolderSheet(false); fn?.(...args) }
  // S12: the phone "+" and its sheet (NotebookPlusSheet, on demand).
  const [plusOpen, setPlusOpen] = useState(false)
  const plusRef = useRef(null)

  // Lane KEYS: the command palette's "Search Notebook" arrives with `#search`
  // (lib/notebookSearchDoor.js). The folders panel is shown if it was hidden (for this visit
  // only: the member's stored choice is not rewritten) and asked to open its search with the
  // cursor in the box. Keyed on `location.key`, so choosing the command twice works twice.
  //
  // P0.13 (search in place): Home's search box arrives through the SAME door carrying the text it
  // was typed into (`state.q`); the palette's command carries none (`state` is null). The seed is
  // stored WITH the request, in the same batch, so the panel reads the pair that belongs together
  // and a later render can never pair a request with another navigation's text.
  const [searchRequest, setSearchRequest] = useState(0)
  const [searchSeed, setSearchSeed] = useState('')
  useEffect(() => {
    if (location.hash !== NOTEBOOK_SEARCH_HASH) return
    setSidebarOpen(true)
    const q = location.state?.q
    setSearchSeed(typeof q === 'string' ? q : '')
    setSearchRequest((n) => n + 1)
  }, [location.hash, location.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Phone pass follow-up (2026-10-10): a walkthrough that points into the folders panel asks
  // for it (tourAnchorVisibility.requestReveal) when the drawer hides its anchor -- Search by
  // meaning starts there, and the image import tour ends there. For this visit only, like the
  // `#search` door: the member's stored choice is not rewritten.
  useEffect(() => {
    const onReveal = (e) => { if (e.detail?.region === 'notebook-sidebar') setSidebarOpen(true) }
    window.addEventListener(TOUR_REVEAL_EVENT, onReveal)
    return () => window.removeEventListener(TOUR_REVEAL_EVENT, onReveal)
  }, [])

  // Lane KEYS3 (Q2): the command palette's "New note from a template" arrives on the notes
  // list with `#templates` (lib/notebookDoors.js). The New note sheet opens, exactly as the
  // Templates button opens it. Keyed on `location.key`, so choosing the command twice works twice.
  // Simplify pass 2 (D3): a sheet the hash opened (`'hash'`, read as open everywhere else) closes when the hash goes
  // away (the browser's Back); a sheet a button opened is left alone.
  useEffect(() => {
    if (location.hash === NOTEBOOK_TEMPLATES_HASH) setPickerOpen('hash')
    else setPickerOpen((open) => (open === 'hash' ? false : open))
  }, [location.hash, location.key])

  // Lane KEYS3 (Q11): the command palette's "All notes" arrives with `#notes`. Keyboard focus
  // goes to the list's own heading (what "Skip to notes list" does), so the header toolbar and
  // the list are the next two Tab stops. A frame later: the palette hands focus back to
  // wherever it was opened from as it closes, and the member asked to be HERE.
  useEffect(() => {
    if (location.hash !== NOTEBOOK_LIST_HASH) return undefined
    const raf = requestAnimationFrame(() => paneHeadingRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [location.hash, location.key])

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
  // The sentinels are views, not folders: a note made while one is open is made unfiled (a new note is never born archived
  // or trashed). Derived ONCE, here, for every create door below.
  const newNoteFolderId = folderId && !['__unfiled__', '__trash__', ARCHIVED_FOLDER].includes(folderId) ? folderId : undefined

  // D-7 fix: on a phone, give a content-first view mode the first screen by
  // collapsing the SAME sidebar the desktop toggle already controls — never a
  // second, parallel piece of state. `sidebarOpen` still defaults to true
  // (List's own landing, and the very first paint of any mode, are
  // unaffected until this fires), and nothing here writes the member's
  // persisted preference (`toggleSidebar`, an explicit tap, still does that
  // via localStorage) — this is a transient, per-view-mode default. Reading
  // `window.innerWidth` directly here (rather than `useIsTouch()`) is
  // deliberate and matches this file's own click-triggered-state convention:
  // it runs in response to the view-mode CHANGE, not on every render, so the
  // useMediaQuery staleness gotcha (CLAUDE.md, "Responsive / Mobile System")
  // does not apply. The panel stays reachable either way: collapsed, the
  // floating `.sidebarToggle` un-hides at phone width (NotebookTab.module.css)
  // to reopen it; open, FolderSidebar's own header button closes it again
  // (`.sbHeader > .sbHeaderBtn`, likewise un-hidden at phone for this).
  //
  // ⭐ Phone pass (2026-10-10): on a phone the panel is a DRAWER for EVERY view, List and
  // Research Home included. Measured at 390x844: the folder tree filled the whole first screen
  // on Home and All notes, so a member's notes started below the fold. It folds on arrival and
  // again after a folder, tag or view is chosen (the member came to see that view, not the tree);
  // the labelled "Folders" button (`.sidebarToggle`, un-hidden at phone) reopens it. Never on the
  // `#search` door, which opens the panel on purpose for its search box.
  // Follow-up B, item 1d: the Daily brief (`isToday`) is a view too. Choosing it from the drawer changes none of the
  // other four (All notes has no folder either), so the drawer stayed open over the brief. (`isToday` itself is
  // computed further down; the address's own word is enough here.)
  // ⛔ A2R-03 (a11y second review, 2026-10-01): every VIEW_MODES id is a list address -- `?view=graph` once rendered
  // Research Home, so a keyboard walk never found the graph canvas. With no home behind the list that cannot recur.
  const viewParam = searchParams.get('view')
  useEffect(() => {
    if (!phoneArrivalFolds(noteId, location.hash)) return
    setSidebarOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, folderId, tag, noteId, viewParam === TODAY_VIEW])

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
    notes: allNotes, refresh: refreshAll, mutate: mutateAllNotes, total: allNotesTotal, error: allNotesError,
  } = useJ2Notes({ sort: 'title' })
  // Wave 8 seam S8-3: "is this member new?" is derived ONCE, here, and handed to both the
  // first-run gates, the list's empty state and the tour, so they can never disagree about it.
  // `notesKnown` is false while the count is loading -- when `hasAnyNotes` also reads false.
  const hasAnyNotes = allNotesTotal > 0
  const notesKnown = allNotesTotal !== undefined
  // Notebook simplify, Task 2: the empty list's message needs this answer. A failed count is an answer too (the list
  // then says what it said before), so only a count still on its way holds the message back.
  const accountEmpty = notesKnown && !hasAnyNotes
  const allNotesCountPending = !notesKnown && !allNotesError

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
  // Notebook simplify, Task 5 ("open on your notes"): the Notebook opens on the notes list. A bare Notebook (no note,
  // no filter, no `?view=`) IS the list, and so is every `?view=` that is not the Daily brief's: `all`, a view mode
  // (`?view=board`, `?view=tasks`, ...), `home` (Research home's old address; Research home itself was deleted in go-live
  // wave 1) or one this build does not know. ⚰️ It used to open the member's LANDING ("Open the Notebook on": Today, Research home or All notes,
  // default Today), and opening Today MADE the day's note as a side effect of opening the Notebook. Now nothing is made
  // until the member presses "Today's note" (or the Daily brief's "Start today's note": simplify pass 2, B1 -- the
  // brief itself only reads). (`viewParam` is read above, by the phone drawer's fold, follow-up B 1d.)
  // The preferences: the first run's tips (below). The stored `notebook_landing` is no longer read.
  const { prefs: notebookPrefs, loading: prefsLoading, readFailed: prefsReadFailed } = usePreferences()
  // I1: on its own address the Daily brief's chunk is asked for in this first render, in parallel with the preferences
  // read above. N6: never on a folder or ticker address (that is the list).
  useState(() => {
    const filtered = ['folder', 'ticker'].some((k) => searchParams.get(k))   // the filters this tab reads from the address
    if (!noteId && !filtered && viewParam === TODAY_VIEW) loadTodayHome().catch(() => {})
    return null
  })
  // The Daily brief (the Today home): `?view=today`, nothing else.
  const isToday = !noteId && !hasActiveFilters && !isTrashView && viewParam === TODAY_VIEW
  // The 60-second first run's state, for the shell's walkthrough gate below: due, or not decided yet (the preferences
  // have not answered, or the notes count has not and the tips do not record the first run).
  // Simplify pass 2 (B1): ⚰️ this also decided what the Daily brief read (`make` / `hold` / `wait`); the brief reads
  // with make=0 in every state now (TodayHome.jsx), so nothing here decides whether a page load makes the note.
  const tipsRaw = notebookPrefs?.[TIPS_PREF]
  const firstRunSeen = seenTips(tipsRaw).has(FIRST_RUN_MARKS.shown)
  const firstRunOn = starterPacksEnabled()
  const firstRunUndecided = firstRunOn && (Boolean(prefsLoading) || (!notesKnown && !firstRunSeen))
  const firstRunDue = firstRunOn && firstRunIsDue({ enabled: true, prefsReady: !prefsReadFailed, tipsRaw, notesKnown, hasAnyNotes })
  // Final fix (C5): the shell's walkthrough gate holds a walkthrough while the first run is due here or undecided.
  // Follow-up B, item 2c: it is told which (a bounded hold for 'due', no limit while 'undecided').
  const firstRunPending = firstRunDue ? FIRST_RUN_DUE : (firstRunUndecided ? FIRST_RUN_UNDECIDED : null)
  useLayoutEffect(() => { setFirstRunPending(firstRunPending) }, [firstRunPending])
  useLayoutEffect(() => () => setFirstRunPending(false), [])
  // Tier 2 fix round 1 (review Important 1): the list's ⋯ carries "Journal tools" (a phone row) while the list
  // toolbar is on screen, so the phone Journal header may fold to no row (lib/journalToolsDoor.js).
  // S15: the Daily brief has no list toolbar either.
  const listToolbarShown = !noteId && !isToday
  // On a phone: the compact sort words (review minor 12) and the sample row's short label (final fix M10: one honest
  // name for both readers).
  const onPhone = useIsPhone()
  // Simplify pass 2 (C5): the empty list's template grid waits while the Get started card is up (its "Start a note from
  // a template" row opens the picker, as "+ New" does). With the card's switch on, its answer waits on the preferences
  // read, so until that lands neither is drawn: the grid never flashes in and out.
  const gridWaits = useGettingStartedCardUp() || (checklistEnabled(notebookFlag) && Boolean(prefsLoading))
  // VIS-6 fix round 1 (review 9): the FIELD the sort dropdown shows, whatever the direction (FX4: the table's headers
  // set `updated_asc` / `title_desc`). ONE authority for the select's value and its touch-tier face.
  const sortField = sort === 'updated_asc' ? 'updated' : sort === 'title_desc' ? 'title' : sort
  // a LAYOUT effect: registered in the list's first commit, before the browser paints it (no fold after a paint)
  useLayoutEffect(() => (listToolbarShown ? registerJournalToolsDoor() : undefined), [listToolbarShown])
  // Wave 8 (8A): the pane heading's words -- what the member is looking at.
  const paneHeading = isTrashView ? 'Trash'
    : isArchiveView ? 'Archived notes'
      : isToday ? 'Daily brief'
        : activeView?.name ? `Saved view: ${activeView.name}`
          : tag ? `Notes tagged ${tag}`
            : folderId ? 'Notes in this folder'
              : 'All notes'
  // S11 (audit 2026-11-05): the view LIVES in the address. `?view=board` opens the board, the View
  // menu writes the mode it picks back here (`chooseViewMode`), and a reload or Back opens the same view
  // again. ⚰️ This used to be a one-shot instruction, applied then rewritten to `?view=all`, so a reload
  // always came back as the list. A saved view pins its own mode, so a NEW `?view=` clears it.
  // ⛔ A2R-03: every VIEW_MODES id is recognised here, never only `tasks` (the reminder's link), or a
  // graph/board/calendar URL would land on Research Home.
  // Follow-up A: the mode the View menu last wrote to the address. A `?view=` this tab did not write is a link (or
  // a reload of one), counted once per change of the address as `view_used` via 'link'.
  // Fix round 1 (I2): only a link the MEMBER followed counts: an in-app PUSH the walkthrough engine did not make, or
  // the page's first load when the browser says it was a followed or typed link (`linkOpened`, lib/notebookUsage.js).
  // Back, Forward, a reload, a remount on the address and the menu's own replace never count.
  const viewWrittenRef = useRef(null)
  useEffect(() => {
    if (!VIEW_MODES.some((m) => m.id === viewParam)) return
    if (viewWrittenRef.current === viewParam) viewWrittenRef.current = null
    // Follow-up B, item 6a: with the entry's key, so a remount on the same PUSH entry is not counted again.
    else if (linkOpened(navigationType, location.state, location.key)) {
      trackNotebookEvent(NOTEBOOK_EVENTS.VIEW_USED, { mode: viewParam, via: 'link' })
    }
    setViewMode(viewParam)
    setActiveView(null)
  }, [viewParam])
  // ⛔ UX #4 (competitive audit, 2026-09-22): bare-root Home and an explicit `?view=all` on an empty notebook rendered
  // two different "you have no notes" screens. Closed by Notebook simplify, Task 5: there is one, the list's own empty
  // state (the template picker, Import notes, the sample notebook and the get-started list).

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
  // ⛔ Audit 2026-11-05, spec S6: ONE authority over "which keys are the note views" --
  // lib/offline/invalidateNoteViews.js. This is that helper with the tab's default (tags on).
  const refreshSidebarCounts = ({ tags = true } = {}) => invalidateNoteViews({ tags, mutate: globalMutate })

  // ── Wave 6 (lane E, item 7): split view ─────────────────────────────────────
  // A side note with no main note, or the main note named again, is dropped
  // from the URL (replace — not a step Back has to walk through). ⛔ At ≤1024px
  // the param is only ignored, never dropped: widening the window brings the
  // pane back.
  useEffect(() => {
    if (!sideParam || (noteId && sideParam !== noteId)) return
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete(SIDE_PARAM)
      return next
    }, { replace: true })
  }, [sideParam, noteId, setSearchParams])
  const mainPaneRef = useRef(null)
  const sidePaneRef = useRef(null)
  // ── Wave 8 (8A, A4): focus always has somewhere to go ──────────────────────
  // ⛔ When the note pane empties, the element that held focus is gone with it,
  // and a keyboard member is dropped at the top of the page. Three places to
  // land, in order: the row a delete leaves NEXT, the row the note was opened
  // from, and -- when there is no such row -- the heading of what the pane now
  // shows (`paneHeadingRef`, visually hidden until it takes focus).
  const mainRef = useRef(null)
  const paneHeadingRef = useRef(null)
  // { id, order } -- the note last opened and the row order it was opened from
  const openedFromRef = useRef(null)
  // D2 (D-1; fix round 1, I-1): the history entries since the member left a list
  // for a note (lib/noteReturnTrail.js). The phone's "Back to notes" goes back
  // through them to that exact list, because `openNote` drops `view` (a
  // closeNote cannot know it: measured at 390 px on 97cffa4b9, it landed on
  // Research Home). Keyed to ENTRIES, never to the note id: the editor pushes
  // same-note entries (citations), which a note-id key walked back into.
  const returnTrailRef = useRef(null)
  const leavingListRef = useRef(false)
  // what the NEXT emptying of the pane should focus: { rowId } | { heading: true }
  const paneFocusPlanRef = useRef(null)
  // where an explicit open puts focus once the note loads: { id, to: 'title' | 'landmark' }
  // (final-review fix I-1: an existing note lands on its heading, a new one in its title)
  const [openFocus, setOpenFocus] = useState(null)
  // A refusal is said IN the pane it points at, and focus goes there.
  const [paneNotice, setPaneNotice] = useState(null) // { pane: 'main'|'side', text }
  useEffect(() => {
    if (!paneNotice) return
    ;(paneNotice.pane === 'side' ? sidePaneRef : mainPaneRef).current?.focus?.()
  }, [paneNotice])
  const refuseSecondPane = (pane) => setPaneNotice({
    pane,
    text: sideId
      ? `That note is already open in the ${pane} pane. A note opens in one pane at a time.`
      : 'That note is already open.',
  })

  // ⭐ WAVE M: an optional `target` carries the OBJECT the caller actually
  // named — a document page or a saved excerpt — through the same `?note=`
  // routing every other opener already uses. Callers that just want the note
  // pass nothing and behave exactly as before.
  // Wave 6: `task` opens the note AT one of its checklist items (`?task=`, read
  // by the editor — lib/noteTasks.js); any other open drops a stale one.
  // Final-review fix I-1: `fresh` marks a note the member just MADE (createNote
  // below) -- the one open whose next act is typing its title.
  // Wave 13Q-2 (13Q click-budget fix): `blank` narrows that further -- a note
  // made with NO title and NO template body has nothing in the title worth
  // reviewing first, so the member's next act is writing in the BODY, not the
  // title. A template or a typed title still lands in the title (I-1 unchanged
  // there); only the bare "+ New note" / palette "New Note" / Ctrl+K path is
  // `blank`. See `createNote`'s own `blank` computation.
  // Lane KEYS3 (Q2): `to` names another first field for a fresh note ('ticker': a template
  // that asks for a ticker, made with none known). Blank still wins; absent means the title.
  // Lane KEYS3 (Q18): for a note that already exists, `to: 'collapsed'` asks for its first
  // collapsed block (a review the Notebook just drafted). Anything else is the landmark.
  // Fin walk 8.3: `passage` is the passage an Ask citation from a scope that spans notes
  // named (lib/openCitation.js `citedPassage`). It rides the history entry's STATE beside
  // the `?note=` param -- the needle is prose, not an id, and a URL carrying a paragraph is
  // one nobody can read or share -- and the editor lands on it once it holds the note
  // (NoteEditorPage, `passageFromNavigationState`). Like `task`, it is an open that aims
  // INSIDE the note, so focus goes to the passage, never to the landmark first.
  const openNote = (note, target = null, {
    task = null, fresh = false, blank = false, to = null, passage = null, replace = false,
  } = {}) => {
    // ⛔⛔ Wave 6 item 7: the note on the right is not opened a second time on
    // the left — refused, and the side pane (which has it) takes focus.
    if (sideId && note?.id === sideId) { refuseSecondPane('side'); return }
    setPaneNotice(null)
    // Wave 8 (8A): remember where this note was opened FROM (the rows on
    // screen, in order) so the way back -- or a delete -- can put focus on a
    // row. Focus goes to the note -- its heading for a note that exists, its
    // title for one just made -- unless the open aims somewhere inside the
    // note (a task, a page, an excerpt), which is where it goes.
    // ⛔ Final-review fix I-1: never the title of an EXISTING note -- a live
    // caret there took a reader's Space as a title edit, and raised a phone's
    // keyboard on every open.
    const rows = mainRef.current
      ? [...mainRef.current.querySelectorAll('[data-note-card-id]')].map((el) => el.getAttribute('data-note-card-id'))
      : []
    openedFromRef.current = { id: note.id, order: [...new Set(rows)] }
    // Leaving a list (no note open) starts a trail; an open from inside a note
    // extends the one it is on.
    leavingListRef.current = !noteId
    // M-5: a plan left by an earlier delete (split view keeps the side note
    // open, so the pane never emptied and the plan was never spent) belongs to
    // THAT open, not this one.
    paneFocusPlanRef.current = null
    const inside = Boolean(target) || (Number.isInteger(task) && task >= 0) || Boolean(passage)
    setOpenFocus(inside ? null : {
      id: note.id,
      to: fresh ? (blank ? 'body' : (to || 'title')) : (to === 'collapsed' ? 'collapsed' : 'landmark'),
    })
    // ⛔ `state` only WITH a passage: an open that names none must push an entry exactly as
    // it always has (no state), so nothing downstream can mistake "no passage" for "a passage
    // for nobody".
    // `replace` is for an open that must not be returned to: the earnings follow-up card's create replaces its own
    // `?followup=` entry, so Back from the new note does not bring the card (and a second note) back.
    const navigateOptions = passage
      ? { replace, state: passageNavigationState({ ...passage, noteId: note.id }) }
      : { replace }
    setSearchParams((prev) => {
      const next = applyTargetToParams(prev, target)
      next.set('note', note.id)
      next.delete(TASK_PARAM)
      if (Number.isInteger(task) && task >= 0) next.set(TASK_PARAM, String(task))
      // Deep-link params ride along in `prev` when a template create opened
      // this note (setSearchParams' functional prev can be a render stale) —
      // drop them here so the final URL is always clean.
      next.delete('new')
      next.delete('ticker')
      // Tier 2 part B: opening a note (the follow-up card's own create included) ends the follow-up offer, in the
      // same URL write -- otherwise closing the note would bring the card back.
      next.delete('followup')
      next.delete('reportDate')
      // Wave H: opening a note leaves the explicit "All notes" grid state —
      // same "leaving X clears Y" discipline as every other selection below.
      next.delete('view')
      return next
    }, navigateOptions)
  }
  const closeNote = (opts) => {
    // Wave 8 (8A): the editor closes itself after a delete with
    // `{ trashed: id }` (every other caller passes nothing, or a click event).
    // The deleted note's row is gone, so focus goes to the row AFTER it in
    // the order it was opened from, or to the pane heading when it was last.
    const trashed = opts && typeof opts === 'object' && typeof opts.trashed === 'string' ? opts.trashed : null
    if (trashed) {
      const order = openedFromRef.current?.id === trashed ? openedFromRef.current.order : []
      const at = order.indexOf(trashed)
      const nextId = at >= 0 ? order[at + 1] : undefined
      // M-5: only when the pane will EMPTY. With a note beside it, that note
      // stays open (below), the pane never empties, and a plan made here would
      // wait for some later, unrelated close and send focus to a stale row.
      if (!sideId) paneFocusPlanRef.current = nextId ? { rowId: nextId } : { heading: true }
      openedFromRef.current = null
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      // Wave 6 item 7: with a note open beside it, closing this one (the
      // editor closes itself after a delete) leaves THAT note open, alone.
      if (sideId) next.set('note', sideId)
      else next.delete('note')
      next.delete(SIDE_PARAM)
      return next
    }, { replace: false })
    refresh()
    refreshAll()
    refreshSidebarCounts()
  }

  // Wave 8 (8A): the pane just emptied (Back, a delete, anything that drops
  // `?note=`). ⛔ Only when focus was LOST with it -- a member who clicked a
  // folder in the sidebar is holding focus there on purpose, and taking it
  // away from them is the opposite defect.
  const prevPaneNoteRef = useRef(noteId)
  useEffect(() => {
    const was = prevPaneNoteRef.current
    prevPaneNoteRef.current = noteId
    if (!was || noteId) return
    const plan = paneFocusPlanRef.current || (openedFromRef.current ? { rowId: openedFromRef.current.id } : { heading: true })
    paneFocusPlanRef.current = null
    const active = document.activeElement
    if (active && active !== document.body && document.contains(active)) return
    focusPaneTarget(plan)
  }, [noteId])

  /** A row by note id (a card is a button; a table row holds one), else the
   *  pane heading. */
  function focusPaneTarget(plan) {
    const root = mainRef.current
    if (plan?.rowId && root) {
      const row = [...root.querySelectorAll('[data-note-card-id]')]
        .find((el) => el.getAttribute('data-note-card-id') === plan.rowId)
      const target = row && (row.matches('button, a[href], [tabindex]')
        ? row
        : row.querySelector('button, a[href], [tabindex]:not([tabindex="-1"])'))
      if (target) { target.focus(); return }
    }
    paneHeadingRef.current?.focus()
  }

  // The skip link's target: the note's title (or its pane, while it loads), or
  // the heading of whatever the pane shows.
  const skipToPane = (e) => {
    e.preventDefault()
    if (noteId) {
      // M-6: the editor's own hook on its title input, never the input's label.
      const title = mainPaneRef.current?.querySelector('[data-note-title]')
      ;(title || mainPaneRef.current)?.focus()
      return
    }
    paneHeadingRef.current?.focus()
  }

  // D2 (I-1): one trail step per navigation, from the router's own entry key
  // and navigation type.
  useEffect(() => {
    const fromList = navigationType === 'PUSH' && leavingListRef.current
    leavingListRef.current = false
    returnTrailRef.current = stepTrail(returnTrailRef.current, {
      type: navigationType, key: location.key, noteOpen: Boolean(noteId), fromList,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  // D2 (D-1): the phone's "Back to notes". A note reached from a list goes back
  // through history to THAT list (its exact URL -- folder, tag, view), past any
  // entry pushed inside the note; anything else (a shared `?note=` link opened
  // fresh) closes to the Notebook's own list.
  const phoneBackToNotes = () => {
    const steps = stepsBackToList(returnTrailRef.current, location.key)
    if (noteId && steps > 0) {
      returnTrailRef.current = null
      navigate(-steps)
      refresh()
      refreshAll()
      refreshSidebarCounts()
      return
    }
    closeNote()
  }

  // Selecting a folder / tag from the (now always-present) sidebar while a note
  // is open should leave the note and show that filtered grid.
  const clearNoteParam = () => setSearchParams((prev) => {
    const next = new URLSearchParams(prev)
    next.delete('note')
    next.delete(SIDE_PARAM)
    return next
  }, { replace: false })
  // Wave H: `?view=all` is the explicit flag distinguishing "the All Notes
  // grid, no filter" from bare-root Research Home -- both otherwise look
  // identical (folderId=null, tag=null, no activeView). Selecting any real
  // folder/tag/saved-view leaves that explicit-all-notes state.
  // S11: a VIEW MODE in the address (`?view=board`) is the member's view, not the All-notes flag, so it
  // stays -- the folder or tag narrows the board, and a reload still opens the board.
  const clearViewAllParam = () => setSearchParams((prev) => {
    const next = new URLSearchParams(prev)
    if (!VIEW_MODES.some((m) => m.id === next.get('view'))) next.delete('view')
    return next
  }, { replace: false })
  const selectAllNotes = () => {
    setFolderId(null)
    setTag(null)
    setActiveView(null)
    setTickerFilter(null)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      // S11: keep a view mode the address already names (`?view=board`); otherwise the explicit All-notes flag
      if (!VIEW_MODES.some((m) => m.id === next.get('view'))) next.set('view', 'all')
      next.delete('note')
      next.delete(SIDE_PARAM)
      return next
    }, { replace: false })
  }
  // Audit 2026-11-05, S15: the Daily brief (the Today home), one click away (`?view=today`).
  const openHomeView = (view) => {
    setFolderId(null)
    setTag(null)
    setActiveView(null)
    setTickerFilter(null)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('view', view)
      next.delete('note')
      next.delete(SIDE_PARAM)
      return next
    }, { replace: false })
  }
  const openTodayHome = () => openHomeView(TODAY_VIEW)
  // Wave 6 item 7 — "open to the side". ⛔⛔ The main note is refused (focus
  // goes to it); the side note already there just takes focus. With no note
  // open there is no "beside" yet, so the note opens as the one note.
  const showBeside = (id) => {
    if (!id) return
    if (!noteId) { openNote({ id }); return }
    if (id === noteId) { refuseSecondPane('main'); return }
    setPaneNotice(null)
    if (id === sideId) { sidePaneRef.current?.focus?.(); return }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set(SIDE_PARAM, id)
      return next
    }, { replace: false })
  }
  const closeSide = () => {
    setPaneNotice(null)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete(SIDE_PARAM)
      return next
    }, { replace: false })
  }
  // Both editors change notes in one commit; React runs every unmount effect
  // before any mount effect, so neither note is ever held by two editors.
  const swapPanes = () => {
    if (!sideId) return
    setPaneNotice(null)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('note', sideId)
      next.set(SIDE_PARAM, noteId)
      return next
    }, { replace: false })
  }
  // ⛔ Stable context values (a ref to the latest function): a fresh object per
  // render would re-render every consumer inside both editors on every render.
  const showBesideRef = useRef(showBeside)
  showBesideRef.current = showBeside
  const openNoteRef = useRef(openNote)
  openNoteRef.current = openNote
  const splitView = useMemo(
    () => ({ canSplit: isDesktop, openToSide: (id) => showBesideRef.current(id) }),
    [isDesktop],
  )
  const mainPaneApi = useMemo(() => ({ pane: 'main', open: (id) => openNoteRef.current({ id }) }), [])
  const sidePaneApi = useMemo(() => ({ pane: 'side', open: (id) => showBesideRef.current(id) }), [])

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
    const mode = SAVEABLE_VIEW_MODES.has(view.viewType) ? view.viewType : 'list'
    trackNotebookEvent(NOTEBOOK_EVENTS.VIEW_USED, { mode, via: 'saved_view' })
    setViewMode(mode)
    // Fix round 1 (review Important 2): a saved view pins its OWN mode, so the address keeps no `?view=<mode>`
    // (a stale `?view=board` reopened the board on reload and dropped the saved view). Writing the view's type there
    // instead would trip the URL effect, which clears a saved view by design.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('view')
      return next
    }, { replace: false })
    if (noteId) clearNoteParam()
  }
  const handleQuickFilter = (propertyId, value) => {
    if (activeView) return // a saved view's spec is server-resolved; ad-hoc filters don't apply on top of it
    setPropertyFilter([{ propertyId, op: 'eq', value }])
  }
  // Wave 11 (lane 11B): one computed column's numeric condition, set from its
  // header. Replaces that column's condition and keeps every other one; a saved
  // view's filter is server-resolved, so nothing applies on top of it.
  const handleComputedFilter = (propertyId, cond) => {
    if (activeView) return
    setPropertyFilter((prev) => {
      const rest = (prev || []).filter((c) => c.propertyId !== propertyId)
      const next = cond ? [...rest, { propertyId, ...cond }] : rest
      return next.length ? next : null
    })
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
    if (viewMode === 'timeline' && timelineSettings) spec.timeline = timelineSettings
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
  const selectionOn = !noteId && !isToday && (isShelfView || viewMode === 'list' || viewMode === 'table')
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
  // Fix round 1 (review finding 7): a sentence another door queued before navigating here (Today,
  // the Compass recap card, Insights: "Saved in your Daily folder."), said once on arrival.
  useEffect(() => {
    const queued = takeQueuedNotebookNotice({ noteId })
    if (queued) setBulkNotice({ message: queued, tone: 'info' })
  }, [])
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
      // F4 / A2R-04: an Esc pressed IN the bulk bar unmounts the bar with the control that
      // held focus; focus goes to the heading of the list the selection was made in,
      // never to <body>.
      const fromBar = Boolean(t && t.closest && t.closest('[data-bulk-bar]'))
      clearSelection()
      if (fromBar) paneHeadingRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selection.count, clearSelection])

  // 13Q-5: Ctrl+Alt+B jumps focus straight into the bulk-action bar once a
  // selection exists -- the measured fix for Q11 (167-179 real Tab presses to
  // reach "Tags"/"Move to select" from a just-ticked row, because the bar sits
  // above however many notes remain in the view -- not shared chrome, the bar's
  // own position). The visible hint lives on the bar itself (BulkActionBar's
  // selectionInfo row), which is on screen, unfocused, the instant the first
  // Space ticks a row -- a sighted member reads it without needing focus there
  // first, which is the whole point of a shortcut that gets them there.
  //
  // ⛔ MEASURED, and it is why this does NOT land on the roving group's own
  // active stop: the Move <select> sits BEFORE "Tags" in the bar's own DOM
  // order, so a first landing on Tags reaches it fine, but after tagging a
  // SECOND press that again lands on Tags cannot reach "Move to select" by
  // forward Tab at all -- it wraps the ENTIRE page back around (measured:
  // 145 real presses, docs/notebook/evidence/wave13-13q5/run-1/clicks.json,
  // Q11 keys@1200 step 23). The jump target is instead the bar's own STABLE
  // first control (the Move select where one exists), which every other
  // control sits AFTER -- cheap to reach from there every time, in either
  // direction this flow is used.
  useEffect(() => {
    if (!selection.count) return undefined
    // Bound through the shared shortcut registry (declared there as `notebook.bulkBar`).
    return registerShortcuts({
      'notebook.bulkBar': (e) => {
        if (!isBulkActionsShortcut(e)) return       // the AltGr guard lives there
        const bar = document.querySelector('[data-bulk-bar]')
        if (!bar) return
        e.preventDefault()
        const target = bar.querySelector('[data-bulk-move-select]')
          || [...bar.querySelectorAll('button, select')].find((el) => !el.disabled)
        target?.focus()
      },
    })
  }, [selection.count])

  // 13Q-5: Shift+Arrow extends the selection to the adjacent note and moves
  // focus with it (file-manager convention) -- Space alone already ticks the
  // focused row cheaply (confirmed in the click-budget trail: 2 Tabs between
  // adjacent rows), this cuts it to one keystroke with no Tab at all. Reuses
  // `toggle`'s EXISTING shift-range math (`noteSelection.js`'s `applyToggle`,
  // the same code Shift+click and Shift+Space already ride) -- never a second
  // range implementation. `notes` is already in DOM/visual order (it is what
  // the grid below maps), so the adjacent note is simply `notes[at ± 1]`.
  const handleSelectionGridKeyDown = (e) => {
    if (!selectionOn) return
    if (!e.shiftKey || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
    const input = e.target
    if (!input || input.tagName !== 'INPUT' || input.type !== 'checkbox') return
    const id = input.getAttribute('data-note-select-id')
    if (id == null) return
    const at = notes.findIndex((n) => String(n.id) === id)
    if (at < 0) return
    const to = at + (e.key === 'ArrowDown' ? 1 : -1)
    if (to < 0 || to >= notes.length) return
    e.preventDefault()
    const target = notes[to]
    selection.toggle(target.id, { shift: true })
    document.querySelector(`[data-note-select-id="${CSS.escape(String(target.id))}"]`)?.focus()
  }

  // Keep a notice on screen long enough to read and act on, then let it go.
  // An error stays until dismissed: it describes something the member has to do.
  useEffect(() => {
    // Go-live wave 1 (D4): a busy line ("Drafting today's recap…") stays until the work it describes is done.
    if (!bulkNotice || bulkNotice.tone === 'error' || bulkNotice.busy) return undefined
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
      const { runNoteBatch, describeBatch, describeUnchecked, undoFor, joinUndo } = await loadNoteBatch()
      const outcome = await runNoteBatch({ ids, op, args, blockedNoteIds, acceptUnchecked })
      const { message, tone } = describeBatch(outcome, { ...ctx, titleOf })
      // R1-S1: notes this device could not be ASKED about are not "still
      // syncing" — they get their own sentence and a confirmed "anyway".
      // N1 (wave 6 fix round 2): `args`/`ctx` are THIS op's own — carried so a
      // confirmed "anyway" resends a request the op's own table (and its own
      // describeBatch branch) can actually read, never `renameTag` with no
      // `{from, to}`.
      const offer = describeUnchecked(
        op, outcome.results.filter((r) => r.status === 'unchecked').map((r) => r.id), { titleOf, args, ctx })
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
      setBulkNotice(e?.chunkLost ? chunkLostNotice()
        : { message: e?.message || 'That did not go through. Nothing was changed.', tone: 'error' })
    } finally {
      endBulk()
    }
  }

  // Wave 6 fix round 1, I4 — the tag tree's own rename door: FolderSidebar
  // already previewed who it touches (GET /notes/tag-members) before calling
  // this, so `ids` is exactly that preview's note ids, never "every note
  // with this tag" re-derived here.
  //
  // M5 (wave 6 fix round 2): `GET /notes/tag-members` is UNCAPPED, but
  // `POST /api/j2/notes/batch` refuses more than NOTE_BATCH_MAX (500) ids in
  // one request (journal_two.py) — a tag on more than 500 notes previewed
  // honestly and then failed outright. Chunked here, SEQUENTIALLY.
  //
  // ⛔⛔ N-b (wave 6 fix round 3). This used to route each chunk through
  // `runBulk` — one `setBulkNotice` call per chunk, each REPLACING the
  // last (`runBulk`'s own docstring: it owns the single-batch notice, and
  // was never meant to be called more than once for one member action). A
  // tag on 900 notes therefore ended on chunk 2's sentence alone: chunk 1's
  // "refused and named" (item 8's own guarantee) and its "unchecked" offer
  // (N1) both vanished, and a chunk 1 that failed on the REQUEST ITSELF
  // (network/4xx/5xx) was invisible — the loop kept sending chunk 2, which
  // could read as complete success while up to 500 notes never went out.
  //
  // This runs its own loop over `runNoteBatch` directly (never `runBulk`,
  // which stays the single-batch primitive every OTHER op uses unchanged),
  // folds every chunk's results into ONE combined outcome, and sets
  // `bulkNotice` exactly ONCE at the end — so "refused and named" and
  // "unchecked and named" hold for a multi-chunk rename exactly as they do
  // for a single-batch one. It STOPS at the first chunk whose REQUEST
  // failed (an exception from `runNoteBatch` — nothing in that chunk was
  // written) and says how many notes were never attempted: a refusal
  // WITHIN a successful chunk (a blocked or unchecked note) is not a stop
  // condition, because the chunk it is in still ran and the notes after it
  // still can.
  const onRenameTag = async (from, to, ids) => {
    if (!ids.length || !startBulk()) return
    const args = { from, to }
    const ctx = { tag: from, renameTo: to }
    let combined = { op: 'renameTag', results: [], changed: 0, unchanged: 0, failed: 0 }
    let stoppedAt = null
    try {
      let nb
      try {
        nb = await loadNoteBatch()
      } catch {
        setBulkNotice(chunkLostNotice())
        return
      }
      const { runNoteBatch, describeBatch, describeUnchecked, describeUnsentRename } = nb
      for (let i = 0; i < ids.length; i += RENAME_TAG_CHUNK_SIZE) {
        const chunk = ids.slice(i, i + RENAME_TAG_CHUNK_SIZE)
        let outcome
        try {
          // eslint-disable-next-line no-await-in-loop
          outcome = await runNoteBatch({ ids: chunk, op: 'renameTag', args, blockedNoteIds })
        } catch (e) {
          // J7: keep WHICH ids never went out and the error's parts, not only a count.
          stoppedAt = { err: e, ids: ids.slice(i), left: ids.length - i }
          break
        }
        combined = {
          op: 'renameTag',
          results: [...combined.results, ...outcome.results],
          changed: combined.changed + outcome.changed,
          unchanged: combined.unchanged + outcome.unchanged,
          failed: combined.failed + outcome.failed,
        }
      }
      // ⚰️ R4-3 (wave 6 fix round 4, NB-1). A LATER chunk failing used to
      // append the sentence below after "Renamed 500 notes from #a to #b.",
      // and with no server `detail` its reason is runNoteBatch's single-batch
      // fallback, which ends "…Nothing was changed." — true of the failed
      // chunk, false of the member's action. When anything WAS renamed, the
      // stop is folded into describeBatch's lead instead ("Renamed N notes;
      // the rest could not be renamed (M notes left unrenamed)."), and the
      // stop sentence is kept only for a rename that changed nothing, where
      // "Nothing was changed" is true.
      //
      // ⭐ J7 (wave 7 lane J). That lead is a COUNT; the sentence after it now
      // says WHICH notes still carry the old tag (the titles this page holds,
      // at most three) and WHY the request failed (the server's own words, its
      // status, or that it never reached the server), then what finishes the
      // job. `describeUnsentRename` owns the words for both branches.
      const renamedSome = combined.changed > 0
      const { message, tone } = describeBatch(combined, {
        ...ctx, titleOf, stoppedLeft: stoppedAt && renamedSome ? stoppedAt.left : 0,
      })
      const offer = describeUnchecked(
        'renameTag', combined.results.filter((r) => r.status === 'unchecked').map((r) => r.id), { titleOf, args, ctx })
      const changedIds = combined.results.filter((r) => r.status === 'changed').map((r) => r.id)
      const parts = [message]
      if (offer) parts.push(offer.message)
      if (stoppedAt) {
        parts.push(describeUnsentRename(stoppedAt.ids, { tag: from, err: stoppedAt.err, renamedSome, titleOf }))
      }
      setBulkNotice({ message: parts.filter(Boolean).join(' '), tone: stoppedAt ? 'error' : (offer ? offer.tone : tone) })
      afterBulkWrite('renameTag', changedIds)
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

  // Wave 9 (lane 9D, D1): `format` is the member's choice in the bulk bar's Export
  // panel (`EXPORT_FORMATS[].id`), carried to the request, to the sentence that names
  // it, and through a confirmed "Export anyway" (its `args`).
  const exportSelection = async (ids = selection.selectedIds, { acceptUnchecked = false, format } = {}) => {
    if (!ids.length || !startBulk()) return
    try {
      // ⛔ A note whose words the server does not have yet would export WITHOUT
      // them, and the member would believe the file complete. It is left out and
      // named instead — a drain-retired note (blocked) AND one still sending
      // (noteHasUnsentWork's raw signal; review S1). A note the device could
      // not be asked about is offered a confirmed "Export anyway" (R1-S1).
      const blocked = ids.filter((id) => blockedNoteIds.has(id))
      const rest = ids.filter((id) => !blockedNoteIds.has(id))
      const { checkUnsentWork, describeExport, describeUnchecked, exportSelectedNotes } = await loadNoteBatch()
      const checked = await checkUnsentWork(rest)
      const unsent = rest.filter((id) => checked.unsent.has(id))
      const unchecked = acceptUnchecked ? [] : rest.filter((id) => checked.unchecked.has(id))
      const send = rest.filter((id) => !checked.unsent.has(id) && !unchecked.includes(id))
      let count = 0
      let skipped = 0
      if (send.length) ({ count, skipped } = await exportSelectedNotes(send, format))
      const said = describeExport({ count, skipped, blocked, unsent, format }, { titleOf })
      const offer = describeUnchecked('export', unchecked, { titleOf, args: { format } })
      const saidAnything = count || skipped || blocked.length || unsent.length
      setBulkNotice(offer
        ? { ...offer, message: [saidAnything ? said.message : '', offer.message].filter(Boolean).join(' ') }
        : said)
    } catch (e) {
      console.error('[notebook] bulk export failed', e)
      setBulkNotice(e?.chunkLost ? chunkLostNotice() : { message: e?.message || 'The export could not be prepared.', tone: 'error' })
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
    if (anyway.op === REMOVE_SAMPLE_OP) removeSample({ acceptUnchecked: true })
    else if (anyway.op === 'export') exportSelection(anyway.ids, { acceptUnchecked: true, format: anyway.args?.format })
    // N1 (wave 6 fix round 2): `anyway.args`/`anyway.ctx` are the op's OWN —
    // dropping them to `{}` is exactly N1 (a `renameTag` retry with no
    // `{from, to}` 400s at the server, and its own success sentence would
    // read "#undefined" without `ctx`).
    else runBulk(anyway.op, anyway.args || {}, anyway.ctx || {}, anyway.ids, { acceptUnchecked: true, continues: true })
  }

  // Notebook P1: the kind picker for the New-note sheet. createNote seeds a ticker only from a door
  // that passes one (S2/B1: never from app focus).
  // `stylesOn` is the switch read once above, beside the Styles manager's state.
  // `focus` is asked for only inside the New-note sheet, never on the inline empty-notebook mount.
  // Follow-up A: a note type (or a style) used from the picker counts as `template_started` (lib/notebookUsage.js).
  const createFromKind = (args) => createNote({ ...args, started: kindStart(args) })
  const kindSection = (focus) => (stylesOn ? <KindSection busy={creating} autoFocusFirst={focus} onCreate={createFromKind} noNotes={notesKnown && !hasAnyNotes} /> : null)

  // Create a note. Blank note passes no title/body; a template seeds both
  // (plus its preset tags and, when known, the ticker). The actual network
  // calls live in lib/noteCreation.js (Wave H) so the Ticker Research
  // Workspace's own New Note/New Thesis actions call the SAME path rather
  // than a second creation flow -- this wrapper only adds NotebookTab's OWN
  // UI concerns (app-focus ticker fallback, current-folder scoping, tree/
  // refresh bookkeeping) on top of it.
  // Journal styles (P1): `styleId` / `kindId` make the note from a style in ONE server insert (the
  // server composes the body), and are passed straight through to the one create door.
  //
  // The finish of a create, in this order: PRIME useJ2Note's SWR cache with what the POST already returned (so
  // NoteEditorPage's first render holds the real note and builds ONE editor -- a server-composed body must never
  // meet an empty first editor and autosave a repair transaction), put the note in the tree, reconcile the
  // lists, open it. `createNote` and the earnings follow-up card both end here; neither may do a partial version.
  // 11.20 walk D1: THE one way a note made from the New note sheet lands -- the sheet closes and the note opens as a
  // fresh note (focus in its title, or its body when blank). `createNote` ends in it, and so does a Template library
  // Use (the note the server already made, handed back by the adoption sheet), which used to navigate and leave the
  // sheet open over the note with focus trapped in it.
  const landPickedNote = (created, openOptions = {}) => {
    setPickerOpen(false)
    // ⛔ Audit 2026-11-05, spec S5 (B3): "Start a note from a template" never ticked. Its evidence
    // was the template's closing walkthrough in the note's `bodyPlain` -- but Research Home's read
    // cuts every summary at 400 characters (notes._LIST_PLAIN_CHARS) and the walkthrough is the
    // LAST block of every template, so it was never in view. The door the member used says it: a
    // note landed from the New note sheet that is not blank came from a template, a style or the
    // Template library. A step never unticks, so a write already recorded writes nothing.
    // Best-effort: a preference that cannot be written (not read yet, offline) never stops the note.
    if (!openOptions.blank) {
      try {
        const p = setPrefMerged?.('notebook_getting_started', (current) => withDone(current, ['template']))
        p?.catch?.(() => {})
      } catch { /* the step ticks next time; the note still lands */ }
    }
    landCreatedNote(created, { fresh: true, ...openOptions })
  }
  // S9 (audit 2026-11-05): a Template library Use names the note itself ("{Template} · {Ddd, Mon D}"), so the caret goes
  // to the note's first field, never the title it already has.
  // Fix round 1 (review finding 10): only a note the Use NAMED skips the title; an untitled one (a members' gallery
  // template made without a name) opens in its title, as every picked note did before.
  // Follow-up A: a note landed from the Template library counts as `template_started` (library).
  // Fix round 1 (M3): with the library row's catalogue family when it has one (TemplateDetailSheet passes it).
  const landTemplateNote = (created, meta) => {
    if (created?.id) {
      trackNotebookEvent(NOTEBOOK_EVENTS.TEMPLATE_STARTED, { source: 'library', family: templateFamily(meta?.family) })
    }
    return landPickedNote(created, typeof created?.title === 'string' && created.title.trim() ? { to: 'field' } : {})
  }
  const landCreatedNote = (created, openOptions) => {
    globalMutate(`/api/j2/notes/${created.id}`, { note: created }, false)
    // Instant: put it in the tree now, then reconcile from the server.
    addNoteToTree(created)
    refreshAll()
    // S6 (B5): every view, not just the sidebar's page -- the list said "3 of 3" beside a 5.
    refreshSidebarCounts()
    openNote(created, null, openOptions)
  }
  const createNote = async ({
    title = '', bodyJson, tags, ticker, properties, revealPropertyIds, focusFirst = null, styleId, kindId, onCreated, started,
  } = {}) => {
    setCreating(true)
    setPickerOpen(false)
    try {
      // ⛔ Audit 2026-11-05, spec S2 (B1): the ticker comes from the DOOR, never app focus.
      // This was `ticker || focusSymbol`: every blank note inherited the last symbol charted
      // (charts Group A, a stored preference -- CDNA on the test account), the server then
      // autofilled sector, industry and theme, and the note grew thesis controls. The doors that
      // know a symbol pass it explicitly: the `?new=…&ticker=` deep link (Today, the EOD recap,
      // TradeDrawer), a template's assembled context, the Ticker Research Workspace and the
      // earnings follow-up (both through createNoteViaApi with their own ticker).
      const seededTicker = ticker || null
      const created = await createNoteViaApi({
        title, bodyJson, tags, ticker: seededTicker, folderId: newNoteFolderId, properties, styleId, kindId,
      })
      // Wave 12 (12B-2): a template's definitions start empty, and the Properties
      // section hides an empty property -- so the new note shows them (this tab only).
      if (revealPropertyIds?.length) rememberTemplateReveal(created?.id, revealPropertyIds)
      // 13Q-Q1check -- PRIME useJ2Note's SWR CACHE WITH WHAT THIS POST ALREADY
      // RETURNED, before NoteEditorPage ever mounts and asks for it.
      //
      // Without this, `useJ2Note(noteId)`'s useSWR has nothing cached for a
      // note that did not exist a moment ago, so NoteEditorPage's FIRST render
      // sees `note: null` -- and `useEditor` is deliberately keyed on
      // `[note?.id]` (see NoteEditorPage.jsx's own comment on that hook call:
      // the editor must be rebuilt once the real note arrives, or an
      // ALREADY-templated note would flash empty and risk autosaving a
      // ProseMirror repair transaction). For a note THIS function just made,
      // that rebuild is pure cost: `note?.id` silently flips from `undefined`
      // to `created.id` a render or two after mount, React tears down the
      // first (empty) TipTap editor instance and builds a second one, and the
      // 'body' openFocus effect's one `editor.commands.focus('end')' call
      // -- a useLayoutEffect, correctly beating first paint, exactly as its
      // own long comment documents -- fires against whichever instance is
      // current on ITS render. On a freshly-created note that is reliably the
      // EPHEMERAL first one: its DOM node is gone by the time the command's
      // own deferred view.focus() rAF would have run, so the caret is lost
      // with no error and no trace on the instance that survives.
      //
      // Measured (R-RAW, addInitScript focusin/MutationObserver recorder, 10
      // reps x 2 widths, no harness help):
      // docs/notebook/evidence/wave13-q1check/remount-trace-diagnosis/results.json
      // -- a second `.ProseMirror` identity is added AND removed in the same
      // batch every single rep, and `.ProseMirror` never receives a `focusin`
      // event at all, in any rep. That is this rebuild, caught directly.
      //
      // Seeding the cache here (the exact shape `useJ2Note`'s fetcher
      // returns -- `{note: ...}`, never revalidated, since this response IS
      // the freshest possible copy) means `note` is already the real object
      // on NoteEditorPage's FIRST render: `useEditor` builds the ONE stable
      // instance from the start, the rebuild never happens, and the existing
      // single-call effect (unchanged) lands on it directly. This is the same
      // state a member reopening an already-viewed note gets from SWR's
      // ordinary cache hit -- not a new code path, just reaching the
      // already-tested one sooner.
      // (The sequence itself -- prime, tree, refreshAll, open -- is `landCreatedNote`, above: the follow-up card's
      // create finishes through the same one.)
      // I-1: the one open that lands in the title -- the member made this note.
      // 13Q-2: UNLESS it is blank (no title, no template body) -- then straight
      // to the body (`blank`, computed from what the CALLER passed in, never
      // from the server's response: every note's stored bodyJson is a real doc,
      // even an empty one, so reading `created.bodyJson` could not tell blank
      // from templated).
      // A styled note is not blank either: the server composed its body (its outline).
      // S12: a door that hands the new note something to place (the "+" sheet's photo) does it BEFORE it opens.
      if (created?.id) onCreated?.(created)
      // Follow-up A: a note started from a template counts once, after the server made it ({source, family}).
      if (created?.id && started) trackNotebookEvent(NOTEBOOK_EVENTS.TEMPLATE_STARTED, started)
      landPickedNote(created, { blank: !title && !bodyJson && !styleId && !kindId, to: focusFirst })
    } catch (e) {
      console.error('[notebook] create note failed', e)
      // Plan Task 11 / ruling R4 (a documented deviation from spec P1.6, which asks for an outbox
      // queue): a create -- a styled one included -- is REFUSED offline and never queued; the member
      // is told so rather than shown a bare failure.
      // Review M-3: a STYLED create's 4xx carries the server's own sentence ("Choose a note type."); every
      // other create says exactly what it said before. A 404 is the switch or a gone style: no sentence to show.
      setActionError(typeof navigator !== 'undefined' && navigator.onLine === false
        ? "You're offline. A new note needs a connection; nothing was saved."
        : ((styleId || kindId) && e?.status < 500 && e.status !== 404 && e.detail)
          || "Couldn't create that note. Nothing was saved.")
    } finally {
      setCreating(false)
    }
  }

  // Wave 11 lane 11A: a saved voice note goes through the voice-note create door
  // (`createVoiceNote` -> createNoteViaApi + settleNoteWrite), then the same tree
  // bookkeeping and open as any other new note.
  const saveVoiceNote = async ({ title, result }) => {
    const created = await createVoiceNote({ title, result, folderId: newNoteFolderId })
    addNoteToTree(created)
    refreshAll()
    refreshSidebarCounts()   // S6
    openNote(created, null, { fresh: true })
    return created
  }
  const startVoiceNote = (source) => {
    setPickerOpen(false)
    setVoiceNote({ source })
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
    // Wave 12 (lane 12B-2): a template that declares property DEFINITIONS (the
    // Position Tracker) has them created or reused first, then the note is made.
    // Best-effort by design: with formulas off the formulas are left out before any
    // request, a definition that fails is skipped, and nothing here can stop the
    // note -- which is ONE create carrying no property values, so it is never
    // half-applied (lib/templatePropertyDefs.js).
    let revealPropertyIds
    if (Array.isArray(tpl.propertyDefinitions) && tpl.propertyDefinitions.length) {
      try {
        revealPropertyIds = (await ensureTemplatePropertyDefs(tpl)).revealIds
      } catch (e) {
        console.warn('[notebook] template properties were not set up; the note is still made', e)
      }
      refreshPropertyDefs()
    }
    await createNote({
      title: tpl.defaultTitle(ctx),
      bodyJson: tpl.build(ctx),
      tags: tpl.tags,
      ticker: ctx.ticker,
      properties: tpl.properties,
      revealPropertyIds,
      // Lane KEYS3 (Q2): the template's title would have named the ticker and none is
      // known, so naming it is the member's next act: the note opens in its Ticker field.
      focusFirst: !ctx.ticker && templateWantsTicker(tpl) ? 'ticker' : null,
      started: { source: 'catalogue', family: templateFamily(tpl.family) },
    })
  }

  // Wave 6: a member's OWN template (saved from one of their notes). The full
  // template is read when picked, then made through the SAME createNote ->
  // createNoteViaApi path as a built-in: title, body and property values.
  //
  // Wave 10 (DR-C follow-up): the gallery's card passes a bare SUMMARY
  // (`{id, name, title, createdAt}` -- no `bodyJson`), which still needs this
  // read. But Preview's "Use this template" already ran that exact read to
  // show the body, and hands back the FULL record it fetched -- re-reading it
  // here would be the same GET twice for one pick. `bodyJson` is the key
  // `getMemberTemplate` always includes and a bare summary never does, so its
  // presence (not truthiness -- an empty body is a real, valid template) is
  // what tells the two apart.
  const createFromMemberTemplate = async (summary) => {
    setCreating(true)
    setPickerOpen(false)
    const alreadyFull = Object.prototype.hasOwnProperty.call(summary || {}, 'bodyJson')
    let full
    try {
      full = alreadyFull ? summary : await getMemberTemplate(summary.id)
    } catch (e) {
      console.error('[notebook] read member template failed', e)
      setActionError(`Couldn't open the template “${summary.name}”. Nothing was created.`)
      setCreating(false)
      return
    }
    // W11-R77 (review n-1): a template used as a style outline holds `{{block:...}}` lines. A Use from Your templates
    // places no block (spec §10: only a style's Use does), so the note gets exactly what the preview showed: each
    // placeholder as the block's name, through the SAME function the preview used (MemberTemplates.openPreview).
    // Loaded on demand: this tab is in the first-open closure.
    // W11-R80 m-3: and in the form the editor will hold it (lib/editorNormalForm.js: the editor itself is the
    // authority), so a template ending on a list or a heading does not make a note its first open writes.
    let bodyJson = full.bodyJson
    try {
      const [{ outlineWithBlockNames }, { editorNormalForm }] = await Promise.all([
        import('../lib/templateSlots'), import('../lib/editorNormalForm')])
      bodyJson = editorNormalForm(outlineWithBlockNames(full.bodyJson, null))
    } catch (e) {
      console.error('[notebook] template words failed to load', e)
      setActionError(`Couldn't open the template “${summary.name}”. Nothing was created.`)
      setCreating(false)
      return
    }
    await createNote({ title: full.title, bodyJson, properties: full.properties, started: { source: 'own', family: 'custom' } })
  }

  const handlePick = (tplOrNull) =>
    tplOrNull ? createFromTemplate(tplOrNull) : createNote()

  // Wave 11 lane 11D: "Trade-plan canvas" in the New note sheet -- a note whose
  // body is a board, made through the canvas's create door (`createTradeCanvasNote`
  // -> createNoteViaApi + settleNoteWrite), then the same tree bookkeeping and
  // open as any other new note. Offered only while the gate is LATCHED on.
  const canvasOn = tradeCanvasEnabled()
  const createCanvas = async () => {
    setCreating(true)
    setPickerOpen(false)
    try {
      const created = await createTradeCanvasNote({ folderId: newNoteFolderId })
      addNoteToTree(created)
      refreshAll()
      refreshSidebarCounts()   // S6 (B5): the canvas door refreshed the sidebar's page only
      openNote(created, null, { fresh: true })
    } catch (e) {
      console.error('[notebook] create trade-plan canvas failed', e)
      setActionError("Couldn't create that trade plan. Nothing was saved.")
    } finally {
      setCreating(false)
    }
  }

  // Notebook simplify, Task 5: the list toolbar's "AI" button opens the notebook-wide Ask (Research home's Ask
  // section, moved) under the toolbar; pressed again it closes it. On a phone the button gives way (the row holds
  // Folders, View, sort and ⋯) and ⋯ carries "Ask your Notebook". Closing the question panel hands focus back to
  // whichever door opened it.
  // Fix round 1: the saved-views group's chunk, once, when the browser is idle after the first paint (see above).
  useEffect(() => whenIdle(preloadSavedViewsGroup), [])
  // Fix round 2: the AI section's chunk, the same way (and on pointer or focus of "AI", below).
  useEffect(() => whenIdle(warmAiPanel), [])
  // Follow-up A: the bulk actions' library, on idle and the moment a selection starts (the bulk bar appears).
  useEffect(() => whenIdle(warmNoteBatch), [])
  const selecting = selection.selectedIds.length > 0
  useEffect(() => { if (selecting) warmNoteBatch() }, [selecting])
  const [aiOpen, setAiOpen] = useState(false)
  const aiBtnRef = useRef(null)
  const aiOpenerRef = useRef(null)
  const toggleAi = () => {
    aiOpenerRef.current = aiBtnRef.current
    setAiOpen((o) => !o)
  }
  const openAiFromMenu = () => {
    aiOpenerRef.current = document.activeElement   // the ⋯ button: the menu hands focus back to it before this runs
    setAiOpen(true)
  }
  // Simplify pass 2, Task 1 fix round 1: the phone "+" sheet's "Ask your Notebook". The "+" is drawn on every Notebook
  // view, the section only with the list, so from a note or the Daily brief this first goes to the list (the panel's
  // "All notes") and opens the section there, in one press. The sheet's row is gone by the time Ask closes, so the
  // opener is the "+" itself.
  const openAiFromPlus = () => {
    if (!listToolbarShown) selectAllNotes()
    aiOpenerRef.current = plusRef.current
    setAiOpen(true)
  }
  // Preview fix round 1 (item 4): closing the question panel closes the WHOLE AI section -- the question panel and
  // "Or tell Notebook what to change" together (that door used to stay behind on its own) -- and hands focus back.
  // Fix round 1 (Task 1): only to an opener still in the page; a removed one falls back to "AI".
  const closeAi = () => {
    setAiOpen(false)
    requestAnimationFrame(() => {
      const opener = aiOpenerRef.current
      ;(opener?.isConnected ? opener : aiBtnRef.current)?.focus?.()
    })
  }
  // ...and the section is closed whenever the list is entered: it closes as the member leaves the list (a note, the
  // Daily brief), so coming back never finds it reopened by itself. Pressing "AI" again opens both pieces.
  useEffect(() => { if (!listToolbarShown) setAiOpen(false) }, [listToolbarShown])
  // Notebook simplify, Task 5: Research home's first-run doors for a member with no notes -- "Add a sample notebook"
  // and the get-started list -- are in the list's own empty state now (Research home is no longer routed).
  const sampleNotebook = useAddSampleNotebook({ onOpenNote: openNote })

  // Wave 6 (item 4): Today — open the member's note for today's ET date,
  // making it the first time (the server keeps it to one per day). The daily
  // template is the member's own preference.
  const { prefs, setPrefMerged } = usePreferences()
  const dailyTemplateId = prefs?.[DAILY_TEMPLATE_PREF] || ''
  const openingTodayRef = useRef(false)
  const { mutate: mutateSwrKey } = useSWRConfig()   // the cache this tree reads from (the brief's read is in it)
  // Simplify pass 2 (B1): also the Daily brief's "Start today's note". One door, one note: every caller (the list's
  // button, Ctrl+Alt+D, the phone row, the brief's Start) asks for `seedToday`, today's plan from the held figures, which
  // the server writes only into a note THIS call makes (an existing note is opened unchanged).
  // Final fix I4 (ruling): the brief's Start makes the note and STAYS on the brief (`stay`): the plan card arrives with
  // the re-read below and the brief moves focus to "Open today's note". Every other caller opens the note. Resolves
  // true when the note is there (made or found), false when the press failed (the failure sentence is on screen).
  const startToday = async ({ stay = false, door } = {}) => {
    if (openingTodayRef.current) return false
    openingTodayRef.current = true
    setActionError('')
    try {
      const { note, created, templateMissing } = await openDailyNote({ templateId: dailyTemplateId, seedToday: true, door })
      // The Daily brief's cached answer may say "Start today's note": it says the note exists at once (a return to the
      // brief, or the brief still on screen, reads "Open today's note"), and is read again for the plan lines.
      mutateSwrKey(TODAY_READ_URL, (d) => d && {
        ...d, todayNote: { ...d.todayNote, id: note.id, title: note.title, missing: false, trashed: false },
      })
      if (created) {
        addNoteToTree(note)
        refreshAll()
        refreshSidebarCounts()
        // Audit 2026-11-05, spec S2 (B12): a new day's note lands in a Daily folder the server makes
        // on first use. Say where it went (the template sentence below, when there is one, wins).
        if (!templateMissing) setBulkNotice({ message: DAILY_FOLDER_NOTICE, tone: 'info' })
      }
      if (templateMissing) {
        setActionError(DAILY_TEMPLATE_MISSING)
      }
      if (!stay) openNote(note)
      return true
    } catch (e) {
      console.error('[notebook] open daily note failed', e)
      setActionError("Couldn't open today's note. Nothing was created.")
      return false
    } finally {
      openingTodayRef.current = false
    }
  }
  // ⛔ Both take NO arguments, on purpose: they are click handlers and the shortcut's callback, so an event can never be
  // read as options. `openToday` opens the note (the list's button, Ctrl+Alt+D, the phone row); `startTodayHere` is the
  // Daily brief's Start (final fix I4).
  // Follow-up A: each door names itself (`today_door_used`, sent by openDailyNote when the note is there).
  const openToday = () => startToday({ door: 'list_button' })
  const openTodayFromRow = () => startToday({ door: 'phone_row' })
  const openTodayFromBrief = () => startToday({ door: 'brief_open' })
  const startTodayHere = () => startToday({ stay: true, door: 'brief_start' })
  const openTodayRef = useRef(openToday)
  openTodayRef.current = () => startToday({ door: 'shortcut' })
  useEffect(() => {
    const onKey = (e) => {
      if (!isDailyShortcut(e)) return
      e.preventDefault()
      openTodayRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The New-note menu's other doors, ONE each (the notes list's New menu, its phone rows in ⋯, the phone "+" sheet):
  // null while its gate is off, so a menu lists no door that opens nothing.
  const openNewNoteSheet = () => setPickerOpen(true)
  const fromStyle = stylesOn ? () => setPickerOpen('kinds') : null
  const recordVoiceNote = voiceOn ? () => startVoiceNote('record') : null

  // VIS-5: the empty folder names its folder. Read from the folders list FolderSidebar already fetched
  // (the same SWR key, never a second request); a folder not in it yet reads as "this folder".
  const { cache: swrCache, mutate: swrMutate } = useSWRConfig()
  const activeFolderName = (folderId
    && swrCache.get('/api/j2/note-folders')?.data?.folders?.find((f) => f.id === folderId)?.name) || 'this folder'
  // "Move notes…": back to All notes, where every note can be selected and moved with the bulk bar's Move.
  const moveNotesHere = () => {
    const name = activeFolderName
    // Fix round 1 (review Important 3): selectAllNotes sets the explicit All-notes flag (`view=all`). A bare
    // setFolderId(null) left neither a filter nor the flag, so the member landed on Research Home.
    selectAllNotes()
    setBulkNotice({ message: `Select the notes you want, then choose Move to put them in ${name}.`, tone: 'info' })
  }
  // Notebook simplify, Task 2: the filtered-empty message's "Clear filter". Every list filter goes (tag, ticker, saved
  // view, property filter and sort) and the member lands on All notes -- selectAllNotes sets the explicit `view=all`
  // flag, so this never drops them on a landing page. Its button leaves with the message, so focus goes to the pane's
  // heading.
  const clearListFilters = () => {
    setPropertyFilter(null)
    setPropertySort(null)
    selectAllNotes()
    paneHeadingRef.current?.focus()
  }

  // Notebook simplify, Task 3: the New ▾ "Reviews" group. The account is the member's selected one, the same hook
  // Research Home's box reads (not fetched while drafts are off). One draft at a time; a failure says so in the
  // list's notice line, worded by the same door.
  const reviewsOn = reviewDraftsEnabled()
  const { accountId: reviewAccountId } = useJ2SelectedAccount(reviewsOn)
  const reviewDraftBusy = useRef(false)
  // Go-live wave 1 (D4): while a review drafts, the list's notice line says so ("Drafting today's recap…", held until
  // the draft lands or fails) and the Reviews rows are disabled, so a second press cannot start a second draft.
  const [reviewDrafting, setReviewDrafting] = useState(null)
  const runReviewDraft = async (period) => {
    if (reviewDraftBusy.current) return
    reviewDraftBusy.current = true
    setReviewDrafting(period)
    setBulkNotice({ message: reviewDraftingSentence(period), tone: 'info', busy: true })
    try {
      // Fix round 1: fetched on the first press, under the busy line already on screen (a failed fetch says the
      // draft failed, like a failed draft).
      const { draftReview } = await importWithOneRetry(() => import('../lib/reviewDraftRun'), undefined,
        (m) => typeof m?.draftReview === 'function')
      await draftReview(period, {
        accountId: reviewAccountId,
        dailyTemplateId,   // final fix I1: a recap that makes today's note makes it from the member's template
        onOpenNote: openNote,
        onNotice: (message) => setBulkNotice({ message, tone: 'info' }),
      })
      // The busy line leaves with the draft; a sentence the draft said (where a new daily note went) stays.
      setBulkNotice((n) => (n?.busy ? null : n))
    } catch (e) {
      setBulkNotice({ message: reviewDraftFailedSentence(period, e), tone: 'error' })
    } finally {
      reviewDraftBusy.current = false
      setReviewDrafting(null)
    }
  }

  // Simplify pass 2 (C2): the three reviews are the second view of ONE row, "Draft a review", in the New menu and in the
  // phone ⋯. Disabled while a draft runs (D4). The walkthrough's anchors are written once, here, and drawn by whichever
  // menu is open: the two are never open together (opening one closes the other, and the New menu is not drawn on a
  // phone), so an anchor is on the page at most once, and the phone tier's "Open Draft a review" step can wait for the
  // first one. Pass 2 merged the walkthrough's weekly and monthly steps (the registry's six-step budget), so the
  // monthly row carries no anchor.
  const REVIEW_ROW_ANCHOR = {
    daily: (p, c) => <button {...p} data-tour="review-drafts-daily">{c}</button>,
    weekly: (p, c) => <button {...p} data-tour="review-drafts-weekly">{c}</button>,
  }
  const draftReviewRow = (more) => ({
    key: 'reviews', label: 'Draft a review', icon: 'book', row: 'reviews',
    children: REVIEW_PERIODS.map(({ period, label }) => ({
      key: period, label, icon: 'book', run: () => runReviewDraft(period), disabled: Boolean(reviewDrafting), row: `review_${period}`,
      render: REVIEW_ROW_ANCHOR[period],
    })),
    ...more,
  })

  // S11 (audit 2026-11-05): the notes list's three toolbar menus. Each item is the SAME handler its
  // old toolbar button ran -- moved, never re-implemented -- and an item whose gate is off is absent.
  const viewMenu = useMenuButton('view')
  const newMenu = useMenuButton('new')
  const moreMenu = useMenuButton('list_more')

  // Go-live wave 1 (A7): "Remove the sample notebook", a row of ⋯ at every width while the sample is active. It was
  // Research home's strip ("Remove it"); the flow is the same: the bulk trash's pre-check over the sample notes still
  // out of Trash (a note holding unsent words holds the whole removal back and is named; a device that could not be
  // asked gets a confirmed "Remove anyway" in the list's notice line), then the DELETE, then every Notebook read
  // refreshed and one sentence saying what happened.
  // ⛔ ONE READ, ON DEMAND: the sample's status (`GET /api/j2/onboarding/sample-notebook`) is asked for the first time ⋯
  // opens, and only for a member whose preferences record a sample at all (onboarding switch on), never on every open.
  const sampleRecorded = notebookFlag('notebook_onboarding_enabled') === true && Boolean(readSamplePref(prefs?.[SAMPLE_PREF]))
  const [moreMenuAsked, setMoreMenuAsked] = useState(false)
  useEffect(() => { if (moreMenu.open) { setMoreMenuAsked(true); warmNoteBatch() } }, [moreMenu.open])
  const { data: sampleStatus, error: sampleStatusError, mutate: refreshSampleStatus } = useSWR(
    sampleRecorded && moreMenuAsked ? SAMPLE_URL : null, fetchSampleStatus, SAMPLE_STATUS_SWR)
  const sampleActiveIds = Array.isArray(sampleStatus?.activeIds) ? sampleStatus.activeIds : []
  const removingSampleRef = useRef(false)
  const removeSample = async ({ acceptUnchecked = false } = {}) => {
    if (removingSampleRef.current || !sampleActiveIds.length) return
    removingSampleRef.current = true
    setBulkNotice({ message: SAMPLE_ROW_COPY.removingLine, tone: 'info', busy: true })
    let m = null
    try {
      // Fix round 1 (first-open bytes): the sample's client is fetched on the press, under the busy line.
      m = await loadSampleNotebook()
      // Fix round 1 (review 4d): the pre-check runs over the sample notes out of Trash NOW, not as they were when ⋯
      // first opened (a sample note restored from Trash since then is one the DELETE will trash too).
      const fresh = await refreshSampleStatus()
      if (!fresh) throw new Error('the sample status could not be read')   // said below; LoadFailed says it too
      const ids = Array.isArray(fresh?.activeIds) ? fresh.activeIds : []
      if (!ids.length) {
        setBulkNotice(null)
        return
      }
      const { precheckNoteBatch } = await loadNoteBatch()
      const pre = await precheckNoteBatch({ ids, op: 'trash', blockedNoteIds, acceptUnchecked })
      // Final fix (C1): a held note is always named, on screen or not (sampleNotebook.js `heldTitles`).
      const hold = m.describeSampleHold(pre, { titleOf: await m.heldTitles(pre, titleOf) })
      if (hold) {
        setBulkNotice({ message: hold.message, tone: 'error', anyway: hold.anyway ? { ...hold.anyway, op: REMOVE_SAMPLE_OP } : undefined })
        return
      }
      const out = await m.removeSampleNotebook()
      if (!out.ok) {
        setBulkNotice({ message: out.message, tone: 'error' })
        return
      }
      // Review 4d: the row leaves at once (no second press between the DELETE and the re-read).
      refreshSampleStatus({ activeIds: [] }, { revalidate: false })
      swrMutate(m.isNotebookKey)
      handleImported()   // the list, the tree, the counts and the folders (the sample's folder may be gone)
      setBulkNotice({ message: m.removedMessage(out), tone: 'info' })
    } catch (e) {
      console.error('[notebook] remove sample notebook failed', e)
      if (e?.chunkLost) { setBulkNotice(chunkLostNotice()); return }
      setBulkNotice({ message: m?.SAMPLE_COPY?.removeFailed || "We couldn't remove the sample notebook. Try again in a moment.", tone: 'error' })
    } finally {
      removingSampleRef.current = false
    }
  }
  const currentView = VIEW_MODES.find((m) => m.id === viewMode) || VIEW_MODES[0]
  // The view goes in the address (`?view=board`), so a reload or a shared link opens it again. The URL
  // effect above reads the same param, so this is one fact in one place, not a second store.
  const chooseViewMode = (id) => {
    // Follow-up A: a mode the member picked from the View menu (once per change; the address write below is ours, so
    // the `?view=` effect does not count it again as a link).
    if (id !== viewMode) trackNotebookEvent(NOTEBOOK_EVENTS.VIEW_USED, { mode: id, via: 'menu' })
    viewWrittenRef.current = viewParam === id ? null : id
    setViewMode(id)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('view', id)
      return next
    }, { replace: true })
  }
  const modeRow = ({ id, icon, short }) => ({ key: id, label: short, icon, checked: viewMode === id, run: () => chooseViewMode(id), row: id })
  const chooseLayout = (layout) => {
    trackNotebookEvent(NOTEBOOK_EVENTS.LIST_LAYOUT_USED, { layout })
    setListLayout(layout)
  }
  const viewMenuItems = [
    ...VIEW_MODES.filter((m) => !m.more).flatMap((m) => [
      modeRow(m),
      // Notebook simplify, Task 3: List's own two-way choice, directly under it, while List is the mode.
      m.id === 'list' && viewMode === 'list' && {
        key: 'list-layout',
        // Simplify pass 2 (A10): "Show as"; "layout" is the page-layout panels' word.
        group: 'Show as',
        className: styles.layoutGroup,
        items: [
          { key: 'rows', label: 'Rows', checked: listLayout === 'rows', run: () => chooseLayout('rows'), row: 'rows' },
          { key: 'cards', label: 'Cards', checked: listLayout === 'cards', run: () => chooseLayout('cards'), row: 'cards' },
        ],
      },
    ].filter(Boolean)),
    // Simplify pass 2 (C1): Graph and Timeline wait one press deeper, in a second view of this same menu. A saved view
    // or a `?view=graph` / `?view=timeline` link still opens them directly; while one is on, the trigger names it and
    // this row reads as the active one.
    {
      key: 'more-views', label: 'More views', icon: 'more', current: Boolean(currentView.more), row: 'more_views',
      children: VIEW_MODES.filter((m) => m.more).map(modeRow),
    },
    // ⛔ NO Save view IN GRAPH MODE, nor in a mode the table marks `saveable: false` (Tasks): graph has
    // nothing of its own to store, so a "saved" graph view would reopen as a plain Graph click -- a silent
    // trap (competitive audit UX #18, 2026-09-22).
    // Notebook simplify, Task 2: the menu now also lists the saved views (below), so it stays open to use while one
    // is on; picking a mode leaves the saved view (the `?view=` effect clears it). Save view is not offered while a
    // saved view is on: the ad-hoc filter it stores was cleared when the view was picked, so it would save a copy of
    // nothing.
    ...(!activeView && viewMode !== 'graph' && SAVEABLE_VIEW_MODES.has(viewMode) ? [
      { key: 'sep', separator: true },
      { key: 'save', label: 'Save view', icon: 'plus', run: () => setSaveViewOpen(true), row: 'save_view' },
    ] : []),
  ]
  const newMenuItems = [
    { key: 'blank', label: 'Blank', icon: 'document', run: () => createNote(), row: 'blank' },
    // "From a template": with the template switch on, the sheet with focus on the first note type (the old list
    // caret's door); with it off there are no note types, and it is the plain sheet. Notebook simplify, Task 3: the
    // "From an outline" row is gone -- it opened the same sheet (search first), one door too many.
    { key: 'template', label: 'From a template', icon: 'library', run: fromStyle || openNewNoteSheet, row: 'template' },
    // Go-live wave 1 (C1): the voice-notes walkthrough points at this row (a literal anchor, MenuRows `render`).
    recordVoiceNote && {
      key: 'voice', label: 'Voice note', icon: 'mic', run: recordVoiceNote, row: 'voice',
      render: (p, c) => <button {...p} data-tour="new-note-voice">{c}</button>,
    },
    { key: 'import', label: 'Import', icon: 'upload', run: openImport, row: 'import' },
    // Notebook simplify, Task 3: Research Home's "Reviews that write themselves", from the list too. Each runs the ONE
    // drafting door (lib/reviewDraftRun.js); absent while review drafts are off, so no row opens nothing.
    // Go-live wave 1 (C2): the review-drafts walkthrough points at the three rows (literal anchors).
    reviewsOn && draftReviewRow({ render: (p, c) => <button {...p} data-tour="review-drafts-open">{c}</button> }),
  ].filter(Boolean)
  // On a phone "+ New", Today and AI give way to the floating "+" (S12) and the row, so ⋯ carries them there (CSS shows
  // `phoneOnlyItem` rows at <=640px only): every toolbar action stays reachable at every width.
  // Go-live wave 1 (D2): the toolbar's "AI" is desktop-only (>=1025px), so "Ask your Notebook" is a TOUCH-tier row
  // (`touchOnlyItem`, <=1024px). (C1, C2) The New menu's Voice note and Reviews are phone rows here too: on a phone the
  // "+ New" group is not drawn, and these two had no other door on the list there. They sit just under Import, high
  // in the menu, so a walkthrough card at the foot of a phone screen never covers them.
  const phoneOnly = styles.phoneOnlyItem
  const touchOnly = styles.touchOnlyItem
  const moreMenuItems = [
    // Final fix (C5): the same words as the toolbar's button and the first run ("Today's note").
    { key: 'today', label: "Today's note", icon: 'sun', run: openTodayFromRow, className: phoneOnly, row: 'today_note' },
    { key: 'ask', label: 'Ask your Notebook', icon: 'sparkle', run: openAiFromMenu, className: touchOnly, row: 'ask_notebook' },
    // Final fix (A1): the template-gallery and template-library walkthroughs open here on a phone (a literal anchor).
    {
      key: 'template', label: 'New from a template', icon: 'library', run: openNewNoteSheet, className: phoneOnly, row: 'template',
      render: (p, c) => <button {...p} data-tour="new-from-template-phone">{c}</button>,
    },
    { key: 'import', label: 'Import', icon: 'upload', run: openImport, className: phoneOnly, row: 'import' },
    recordVoiceNote && {
      key: 'voice', label: 'Voice note', icon: 'mic', run: recordVoiceNote, className: phoneOnly, row: 'voice',
      render: (p, c) => <button {...p} data-tour="new-note-voice-phone">{c}</button>,
    },
    reviewsOn && draftReviewRow({ className: phoneOnly, render: (p, c) => <button {...p} data-tour="review-drafts-phone">{c}</button> }),
    // Tier 2 fix round 1 (review Important 1): on the phone Notebook list the Journal header's tools fold into this
    // row (lib/journalToolsDoor.js), so the header takes no row and nothing sits over the section strip.
    // Simplify pass 2 (A9): "Trade journal tools", so it is not read as a sibling of "My tools" below.
    { key: 'journal-tools', label: 'Trade journal tools', icon: 'sliders', run: openJournalTools, className: phoneOnly, row: 'journal_tools' },
    { key: 'export', label: 'Export', icon: 'download', run: () => setExportOpen(true), row: 'export' },
    // Go-live wave 1 (A7): at every width, only while the sample is active (its status read says so). Final fix residual
    // R3: right after Export, so on a desktop (no phone rows) More never opens with focus on this destructive row; on a
    // phone the menu scrolls inside the window above the "+" (C3), so it stays reachable there.
    // Simplify pass 2 (C6): one line on a phone ("Remove sample notebook"); the desktop words are unchanged.
    sampleActiveIds.length > 0 && {
      key: 'remove-sample', label: SAMPLE_ROW_COPY[onPhone ? 'removeRowPhone' : 'removeRow'], icon: 'trash', run: () => removeSample(), row: 'remove_sample',
    },
    toolsOn && { key: 'tools', label: 'My tools', icon: 'wrench', run: openTools, row: 'my_tools' },
    // S7 (one vocabulary): the journal styles manager is where a member manages templates.
    stylesOn && { key: 'manage', label: 'Manage templates', icon: 'sliders', run: () => openStyles(), row: 'manage_templates' },
  ].filter(Boolean)

  // A successful import can create notes AND folders — refresh both. Notes
  // come back through useJ2Notes' own refresh(); folders live behind
  // FolderSidebar's own useJ2NoteFolders() hook with no exposed handle up
  // here, so a key bump remounts it and its SWR hook re-fetches fresh.
  const handleImported = () => {
    refresh()
    refreshAll()
    refreshSidebarCounts()   // S6
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
    const ticker = searchParams.get('ticker')
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('new')
      next.delete('ticker')
      return next
    }, { replace: true })
    if (newKey !== 'blank') {
      // Task 7.2: the catalog loads on demand. The params were stripped above BEFORE the await, so a
      // slow or failed load can never loop; a key the catalog does not know still creates nothing.
      // Task 7.4 (R-6): and when it lands, nothing is made if the tab unmounted or a note was opened or a create
      // started while it loaded.
      getTemplateAsync(newKey)
        .then((tpl) => {
          if (!tpl || !deepLinkAlive.current || openOrCreating.current) return undefined
          return createFromTemplate(tpl, { ticker })
        })
        .catch((e) => console.warn('[notebook] the template catalog did not load; nothing was made', e))
    } else {
      // Same uppercase-and-trim normalization assembleTemplateContext applies
      // for the template path (templateContext.js) — kept consistent so a
      // deep-linked ticker behaves identically regardless of which "new
      // note" door it came through.
      const normalizedTicker = (ticker || '').trim().toUpperCase() || undefined
      createNote({ ticker: normalizedTicker })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newKey])

  // Tier 2 part B: /journal/notebook?followup=SYM&reportDate=YYYY-MM-DD (the earnings follow-up bell's link).
  // The card parses and checks the two values itself; nothing is made until its button is pressed. BOTH switches
  // (the follow-up gate and Journal styles -- the note is made through the styled-create door) must be on, or the
  // card never renders and its chunk is never fetched. No note open: the card is an offer, not an overlay.
  const followupOpen = searchParams.has('followup') && !noteId && earningsFollowupEnabled() && journalStylesEnabled()
  // F4: keyed by the raw link, so a SECOND notice opened in this same tab mounts a fresh card with a live button.
  const followupKey = `${searchParams.get('followup') || ''}:${searchParams.get('reportDate') || ''}`
  // Just leave the offer (Not now): drop both params, replacing the entry so Back does not bring the card back.
  const leaveFollowup = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('followup')
      next.delete('reportDate')
      return next
    }, { replace: true })
  }, [setSearchParams])

  // One FolderSidebar's props, for the panel and for the phone note's folders sheet (fix round 1, Important 6).
  const folderSidebarProps = {
    notes: allNotes,
    notesTotal: allNotesTotal,
    activeFolderId: folderId,
    onSelectFolder: handleSelectFolder,
    activeTag: tag,
    onSelectTag: handleSelectTag,
    onOpenNote: openNote,
    activeNoteId: noteId,
    onToggleSidebar: toggleSidebar,
    sidebarOpen: sidebarOpen,
    searchRequest: searchRequest,
    searchSeed: searchSeed,
    // Notebook simplify, Task 2: the saved views are listed in the notes list's View menu now, not in the panel.
    // `isHome`: All notes is not lit while the Daily brief is the page (the panel's name for "not the list").
    isHome: isToday,
    onSelectAllNotes: selectAllNotes,
    // Notebook simplify, Task 5: the "Daily brief" row, directly under All notes (`?view=today`).
    isToday: isToday,
    onSelectToday: openTodayHome,
    onRenameTag: onRenameTag,
    extraFolderActions: extraFolderActions,
    // Wave 10 F7 (Part A): the saved views are read here, so their failure is said in the panel with the panel's own
    // reads. (Task 2 moved the list into the View menu; the panel is the one place always on screen to say it.)
    extraLoadFailures: [{ what: 'your saved views', error: savedViewsError, retry: refreshSavedViews }],
  }
  return (
    // Wave 6 item 7: the split-view door for everything below — the sidebar's
    // Ctrl/Cmd+click and every note link inside either editor (lib/splitView.js).
    <SplitViewContext.Provider value={splitView}>
    <div
      ref={wrapRef}
      className={`${styles.wrap} ${sidebarOpen ? '' : styles.collapsed} ${dragging ? styles.dragging : ''}`}
      data-list-toolbar={!noteId && !isToday ? '' : undefined}
      style={{ '--nb-sb-w': `${sidebarWidth}px` }}
      // D2 (design finding D-1): a phone stacks the folder panel ABOVE the notes,
      // so a `?note=` link painted the folder panel first and put the note's title
      // 1,530 px down at 390 px (measured on fa6710394). With a note open, the
      // phone rule in NotebookTab.module.css hides the panel; the note is the
      // page, and the phone back control below returns to the list.
      data-note-open={noteId ? 'true' : undefined}
    >
      {/* Wave 8 (8A, A4): the FIRST focusable thing in the tab -- past the
          folder tree, straight to the note or the list. Visually hidden until
          it takes focus. F4 (A2R-01): inside the app shell it renders in the
          shell's skip-link slot, so it is the SECOND Tab stop on the page,
          right after "Skip to main content" -- not the 36th, behind the nav
          and the Journal's header. Rendered alone, it stays here. */}
      <SkipLinkPortal>
        {/* W14-keys: "Skip to getting started", FIRST among the Notebook's skip links while
            the get-started checklist is on screen (it renders nothing otherwise, so every
            other member's Tab order is unchanged). Same hidden-until-focused class as the
            link below, so it has the same H14 tap behaviour (a11y/skipLinkUntappable). */}
        <GettingStartedSkipLink className={styles.skipLink} />
        <a href="#notebook-pane" className={styles.skipLink} onClick={skipToPane}>
          {noteId ? 'Skip to note' : 'Skip to notes list'}
        </a>
      </SkipLinkPortal>
      {actionError && (
        <div className={styles.actionError} role="alert">{actionError}</div>
      )}
      {/* Tier 2 part B: the earnings follow-up offer. Created only on its button; opened through the SAME finish a
          new note gets (landCreatedNote), which also strips the link's two parameters. */}
      <FollowupOfferSlot
        key={followupKey}
        open={followupOpen}
        searchParams={searchParams}
        folderId={newNoteFolderId}
        focusFallback={() => focusPaneTarget(null)}
        onCreated={(created) => { if (created?.id) landCreatedNote(created, { fresh: true, replace: true }) }}
        onDismiss={leaveFollowup}
      />
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
              {/* Follow-up A: the bulk actions' library could not be fetched twice (likely a stale tab after a deploy). */}
              {bulkNotice.reload && (
                <button type="button" className={styles.bulkNoticeBtn} onClick={pageReload.run}>Reload</button>
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
      {/* B13: inside a note on a phone the panel is hidden by the note-open rule, so THIS is Folders there (phone only,
          CSS): it opens the folders sheet and stays on screen, so focus can come back to it. */}
      {noteId && (
        <button type="button" ref={folderSheetBtnRef} className={`${styles.sidebarToggle} ${styles.noteFoldersBtn}`}
          onClick={openFolders} aria-label="Show folders" title="Show folders" aria-haspopup="dialog"
          aria-expanded={folderSheet}>
          <SidebarToggleIcon />
          <span className={styles.sidebarToggleLabel} aria-hidden="true">Folders</span>
        </button>
      )}
      {!sidebarOpen && (
        <button
          type="button"
          className={styles.sidebarToggle}
          onClick={toggleSidebar}
          aria-label="Show folders panel"
          title="Show folders"
        >
          <SidebarToggleIcon />
          {/* Phone only (CSS): the drawer's door says what it opens. */}
          <span className={styles.sidebarToggleLabel} aria-hidden="true">Folders</span>
        </button>
      )}

      {/* ⛔ Hidden means hidden to every input: the collapsed panel slides off-screen but stays
          mounted (so reopening loses nothing), and without `inert` Tab and a screen reader still
          walked its folder tree, All notes and Trash -- controls nobody can see (desktop crawl,
          2026-10-09). */}
      <div id="notebook-folders-panel" className={styles.sidebarSlot} inert={!sidebarOpen || folderSheet ? true : undefined} data-tour-reveal="notebook-sidebar">
        <div className={styles.sidebarInner}>
          <FolderSidebar {...folderSidebarProps} key={folderRefreshKey} />
        </div>
      </div>

      <div
        className={styles.divider}
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize folders panel"
      />

      <div
        ref={mainRef}
        id="notebook-pane"
        className={`${styles.main} ${noteId ? styles.mainNote : ''} ${sideId ? styles.mainSplit : ''}`}
      >
        {/* Wave 8 (8A, A4): what the pane shows, as a heading -- the landing
            place for the skip link and for focus when a delete leaves no row
            after it. Visually hidden until it takes focus. */}
        {/* Simplify pass 2: the Daily brief draws its own visible "Daily brief" heading and takes this ref for it, so the
            page has ONE heading of that name and every focus call below lands on the visible one. */}
        {!noteId && !isToday && (
          <h2 ref={paneHeadingRef} tabIndex={-1} className={styles.paneHeading} data-focus-fallback="">{paneHeading}</h2>
        )}
        {/* Finish program, lane FE2 round 2: this confirm and its error line sit ABOVE the
            note / Research Home / notes-list branches. They used to be inside the notes-list
            branch only, while the folders panel (and its saved views) is also shown beside
            Research Home and beside an open note: there the Delete button set the state and
            nothing appeared. (Notebook simplify, Task 2: the saved views are the list's View menu
            now, so Delete is only pressed from the list; the confirm stays above the branches,
            because deleting the view in use can take the list away while it is open.) */}
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
            // F3: a landing on "All notes" is its TREEITEM, the folder tree's focus target.
            fallbackFocus={treeRowOf(() => firstFocusable(
              paneHeadingRef, () => wrapRef.current?.querySelector('[data-all-notes-row]')))}
          />
        )}
        {savedViewError && (
          <div className={styles.error} role="alert">{savedViewError}</div>
        )}
        {noteId ? (
          <>
          {/* D2 (D-1): the way back to the list on a phone, where the folder
              panel is hidden while a note is open. Shown at <=640 px only
              (the stylesheet decides); above that the panel is beside the note
              and is the way back. The same close every other door uses. */}
          <button
            type="button"
            className={styles.phoneBack}
            onClick={phoneBackToNotes}
            data-nb-phone-back=""
            data-tour="note-phone-back"
          >
            <UIcon name="chevronRight" size={16} gold={false} aria-hidden="true" style={{ transform: 'rotate(180deg)' }} />
            {/* Finish pass (2026-10-10): on a phone the control is the chevron, on the editor's own
                action row; the words stay its accessible name (.phoneBackLabel). */}
            <span className={styles.phoneBackLabel}>Back to notes</span>
          </button>
          {/* ⛔ Wave 6 item 7: the main editor sits in the SAME pane element
              whether or not a note is beside it — moving it into a new parent
              when the side opens would remount it (a flushed save, a reloaded
              note, under the member's cursor). */}
          <div
            ref={mainPaneRef}
            tabIndex={-1}
            className={styles.notePane}
            data-note-pane="main"
            role={sideId ? 'region' : undefined}
            aria-label={sideId ? 'Main note' : undefined}
          >
            {paneNotice?.pane === 'main' && (
              <p className={styles.paneNotice} role="status">{paneNotice.text}</p>
            )}
            <NotePaneContext.Provider value={sideId ? mainPaneApi : null}>
              {/* Key by noteId so switching notes from the persistent sidebar remounts
                  the editor fresh (TipTap state + autosave), same as opening from the grid. */}
              <NoteEditorPage
                key={noteId}
                noteId={noteId}
                onBack={closeNote}
                showBack={false}
                // Wave 8 (8A; final-review fix I-1): an explicit open lands on
                // the note's heading, or in the title of a note just made.
                openFocus={openFocus?.id === noteId ? openFocus.to : null}
                onOpenFocused={() => setOpenFocus(null)}
                onTitleChange={updateTreeNoteTitle}
                ownsDocumentTitle
                // Wave 6 (lane E), I1: the note menu's organisation actions.
                // The editor (lane D's NoteEditorPage.jsx) renders
                // `{noteMenu?.(note, { refresh, unlockNote })}` in its header
                // row, past both early returns — wired in fix round 1 (M1:
                // this comment used to describe that render as still
                // pending; it landed). N-f (fix round 3): the object gained
                // `unlockNote` in M2 (round 2); this comment did not, until now.
                noteMenu={(note, api) => (
                  <NoteMenuActions
                    note={note}
                    onOpenBeside={isDesktop ? (n) => showBeside(n.id) : undefined}
                    besideExclude={sideId ? [sideId] : []}
                    // M2 (wave 6 fix round 2): route the menu's Unlock
                    // through the editor's OWN unlock (lands the revision,
                    // moves the save baseline, settles the offline queue) —
                    // never a second, thinner door.
                    onUnlock={api?.unlockNote}
                    // M-9 (wave 7): the template copies the SERVER's note, so the
                    // editor's pending edits are sent first.
                    onBeforeTemplate={api?.sendPendingEdits}
                    onChanged={() => {
                      api?.refresh?.()
                      refresh()
                      refreshAll()
                      refreshSidebarCounts()
                    }}
                  />
                )}
              />
            </NotePaneContext.Provider>
          </div>
          {sideId && (
            <div
              ref={sidePaneRef}
              tabIndex={-1}
              className={`${styles.notePane} ${styles.sidePane}`}
              data-note-pane="side"
              role="region"
              aria-label="Side note"
            >
              <div className={styles.sidePaneBar}>
                <span className={styles.sidePaneLabel}>Beside</span>
                <button type="button" className={styles.sidePaneBtn} onClick={swapPanes}
                  title="Put this note on the left and the other on the right">
                  <UIcon name="columns" size={12} gold={false} />
                  Swap panes
                </button>
                <button type="button" className={styles.sidePaneClose} onClick={closeSide}
                  aria-label="Close the side note" title="Close the side note">
                  <UIcon name="x" size={12} gold={false} />
                </button>
              </div>
              {paneNotice?.pane === 'side' && (
                <p className={styles.paneNotice} role="status">{paneNotice.text}</p>
              )}
              <NotePaneContext.Provider value={sidePaneApi}>
                <NoteEditorPage
                  key={`side:${sideId}`}
                  noteId={sideId}
                  onBack={closeSide}
                  showBack={false}
                  onTitleChange={updateTreeNoteTitle}
                  noteMenu={(note, api) => (
                    <NoteMenuActions
                      note={note}
                      // M2 (remainder, wave 6 fix round 3): the side pane's
                      // menu took the thin `setNoteLock`-only door — the
                      // round-2 re-review found only the MAIN pane's
                      // `noteMenu` was wired to `api?.unlockNote`. Same fix,
                      // same reason: the editor's own unlock is the one door
                      // that also moves the save baseline and settles the
                      // offline queue.
                      onUnlock={api?.unlockNote}
                      onBeforeTemplate={api?.sendPendingEdits}
                      onChanged={() => {
                        api?.refresh?.()
                        refresh()
                        refreshAll()
                        refreshSidebarCounts()
                      }}
                    />
                  )}
                />
              </NotePaneContext.Provider>
            </div>
          )}
          </>
        ) : isToday ? (
          // Audit 2026-11-05, S15 (M1): the Daily brief (the Today home) -- one read, the cards in the session's order.
          <>
          {repairNotice}
          <TodayHome
            onOpenNote={openNote}
            onOpenToday={openTodayFromBrief}
            onStartToday={startTodayHere}
            headingRef={paneHeadingRef}
            dailyTemplateId={dailyTemplateId}
            onNotice={(message) => setBulkNotice({ message, tone: 'info' })}
          />
          </>
        ) : (
          <>
        {/* Lane KEYS round 4: ONE Tab stop for the list's header row (the toolbar pattern:
            Left and Right inside it, Home and End to its ends). Tabindex only. */}
        <div className={styles.toolbar} role="toolbar" aria-label="Notes list tools"
          ref={listToolbar.ref} onKeyDown={listToolbar.onKeyDown} onFocus={listToolbar.onFocus}>
          {isArchiveView && <span className={styles.trashLabel}>Archived</span>}
          {/*
            S11 + VIS-4 (audit 2026-11-05, V2): ONE row, in this order -- a labelled View menu (every mode,
            and Save view inside it), sort, Today, "+ New" with its ▾ (Blank · From a template · Voice note ·
            Import) as the ONLY solid primary, and ⋯ (Export, My tools, Manage templates). It replaced eight
            44 px buttons, seven unlabelled view icons and a Save view link. Every action that was on the row
            is still one menu away: NotebookTab.toolbar.test.jsx enumerates them. The three menus run the ONE
            menu-button engine (`useMenuButton`, NewNoteMenu.jsx); each trigger is a literal <button> here so
            its tour anchor stays a literal attribute (tourAnchors.test.js).
          */}
          {/* S12 (V4): on a phone the folders drawer's door joins this row as a labelled dropdown (CSS shows it
              at <=640px and hides the standalone toggle above), so folders, view and sort are ONE 44 px row. */}
          {!sidebarOpen && (
            // Review Minor 17: it discloses the folders panel, and says so.
            <button type="button" className={`btn btn-secondary btn-sm ${styles.phoneFolders}`} onClick={toggleSidebar}
              aria-expanded={sidebarOpen} aria-controls="notebook-folders-panel">
              <span className="sr-only">Folder: </span>{folderId ? activeFolderName : 'All notes'}
              <UIcon name="chevronDown" {...TOOLBAR_ICON} />
            </button>
          )}
          {!isShelfView && (
            <div className={styles.menuSlot}>
              <button {...viewMenu.triggerProps} type="button" className={`btn btn-secondary btn-sm ${styles.toolBtn}`}
                data-tour="view-switcher" onPointerEnter={preloadSavedViewsGroup} onFocus={preloadSavedViewsGroup}>
                {/* the visible words ARE the name: "View: List" (a menu button, so a reader hears "menu") */}
                View: {currentView.short}
                <UIcon name="chevronDown" {...TOOLBAR_ICON} />
              </button>
              {viewMenu.open && (
                <div {...viewMenu.menuProps} aria-label="View">
                  <MenuRows menu={viewMenu} items={viewMenuItems} label="View" />
                  {/* Notebook simplify, Task 2: the saved views left the folders panel and live here. Not in the
                      "More views" second view (pass 2, C1): that view holds only Back, Graph and Timeline. */}
                  {!viewMenu.sub && <SavedViewsMenuGroup
                    menu={viewMenu}
                    views={savedViews}
                    activeViewId={activeView?.id ?? null}
                    onSelectView={handleSelectView}
                    onRenameView={onRenameView}
                    onDeleteView={onDeleteViewRequest}
                    onAddStarterViews={savedViewsLoading || savedViewsError ? null : addStarterThesisViews}
                    loadFailed={Boolean(savedViewsError)}
                  />}
                </div>
              )}
            </div>
          )}
          {isTrashView ? (
            // Trash view sort is fixed (most recently deleted first) — the
            // toolbar's Recently-updated/Recently-created/Title options are
            // for the active library, not a meaningful choice here.
            <span className={styles.trashLabel}>Trash</span>
          ) : (
            // VIS-6 (live finding, 390 px): the touch tier's `select { font-size: 16px !important }` (tokens.css, it
            // stops iOS zooming on focus) drew "Updated" far larger than Folders and View beside it. At <=1024 px the
            // select stays 16 px but is a transparent layer over `.sortFace`, a face drawn with the SAME button classes
            // as View. The select is still the control (its name, its keyboard, the native picker); the face is
            // aria-hidden. Above 1024 px the face is not drawn and the select renders as before.
            <span className={styles.sortWrap} data-sort-wrap="">
            <span className={`btn btn-secondary btn-sm ${styles.toolBtn} ${styles.sortFace}`} aria-hidden="true" data-sort-face="">
              {SORT_OPTIONS.find((o) => o.value === sortField)?.[onPhone ? 'short' : 'label'] || 'Sort'}
              <UIcon name="chevronDown" {...TOOLBAR_ICON} />
            </span>
            <select
              className={styles.sortSelect}
              // FX4 (wave 10, coordinator round 2): the Table view's header
              // buttons can now set `sort` to a DIRECTIONAL value
              // (`updated_asc`/`title_desc`) this dropdown has no option
              // for -- an unmapped `value` renders as an unselected control,
              // which would read as "nothing chosen" while the table is very
              // much sorted. Show the FIELD regardless of direction; picking
              // an option here still resets to that field's natural
              // direction, which is the expected behavior either way.
              value={sortField}
              onChange={(e) => setSort(e.target.value)}
              // Wave 8 (8A, axe select-name): a select with no name is read as
              // "combo box, Recently updated" with nothing saying what it orders.
              aria-label="Sort notes"
            >
              {/* Tier 2 (production check of Tier 1b, 390 px): "Recently upd…" was cut off and pushed ⋯ onto a line
                  of its own. On a PHONE the words are compact (review minor 12: only there); the control's NAME
                  ("Sort notes") says what they order. Wider screens keep "Recently updated". */}
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{onPhone ? o.short : o.label}</option>)}
            </select>
            </span>
          )}
          {tickerFilter && (
            <span className={styles.tickerFilterChip}>${tickerFilter}</span>
          )}
          {(folderId || tag || activeView || propertyFilter || tickerFilter) && (
            <button
              type="button"
              className={`btn btn-ghost btn-sm ${styles.toolBtn}`}
              onClick={() => {
                setFolderId(null); setTag(null)
                setActiveView(null); setPropertyFilter(null); setPropertySort(null)
                setTickerFilter(null)
              }}
            >
              Clear filter
            </button>
          )}
          <div className={styles.newWrap}>
            {/* Notebook simplify, Task 5: Research home's notebook-wide Ask (and "Or tell Notebook what to change"
                while that switch is on) opens under this row. */}
            <button
              ref={aiBtnRef}
              type="button"
              className={`btn btn-secondary btn-sm ${styles.toolBtn} ${styles.aiBtn}`}
              onClick={toggleAi}
              onPointerEnter={warmAiPanel}
              onFocus={warmAiPanel}
              aria-expanded={aiOpen}
              aria-controls={aiOpen ? 'notebook-ai-panel' : undefined}
              title="Ask your Notebook"
            >
              <UIcon name="sparkle" {...TOOLBAR_ICON} />
              AI
            </button>
            <button
              type="button"
              className={`btn btn-secondary btn-sm ${styles.toolBtn} ${styles.todayBtn}`}
              onClick={openToday}
              title="Open today's daily note (Ctrl+Alt+D)"
              aria-keyshortcuts="Control+Alt+D Meta+Alt+D"
            >
              <UIcon name="sun" {...TOOLBAR_ICON} />
              Today's note
            </button>
            {/* "+ New" makes a blank note in one press; its ▾ lists every way in. The group carries the
                base tour's Import step: Import lives in this ▾ now (tourCopy.js says so). */}
            <div className={styles.newSplit} data-tour="import">
              <button
                type="button"
                className={`btn btn-primary btn-sm ${styles.toolBtn} ${styles.newMain}`}
                onClick={() => createNote()}
                disabled={creating}
                data-tour="new-note"
                data-guide="journal.newNote"
                // Go-live wave 1: the voice tour's "Make a note first" card focuses this ("Show me where",
                // tourStart.js UNREACHABLE_COPY.firstNote); it was Research Home's "Start a note". Not a tour anchor.
                data-start-note=""
              >
                + New
              </button>
              <button {...newMenu.triggerProps} type="button"
                className={`btn btn-primary btn-sm ${styles.toolBtn} ${styles.newCaret}`}
                aria-label="More ways to start a note" data-tour="templates">
                <UIcon name="chevronDown" {...TOOLBAR_ICON} />
              </button>
              {newMenu.open && (
                <div {...newMenu.menuProps} aria-label="Start a note">
                  <MenuRows menu={newMenu} items={newMenuItems} label="Start a note" />
                </div>
              )}
            </div>
            <div className={styles.menuSlot}>
              <button {...moreMenu.triggerProps} type="button" className={`btn btn-ghost btn-sm btn-icon ${styles.toolBtn}`}
                aria-label="More notebook actions" title="More notebook actions" data-tour="styles-button"
                data-journal-tools-door="">
                <UIcon name="more" {...TOOLBAR_ICON} />
              </button>
              {moreMenu.open && (
                <div {...moreMenu.menuProps} aria-label="More notebook actions">
                  <MenuRows menu={moreMenu} items={moreMenuItems} label="More notebook actions" />
                </div>
              )}
            </div>
          </div>
        </div>

        {aiOpen && (
          <NotebookAiPanelSlot id="notebook-ai-panel" onOpenNote={openNote} onClose={closeAi} blockedNoteIds={blockedNoteIds} />
        )}

        <NoteConnectorsTrustStrip />

        {repairNotice}

        <ExportDialog
          open={exportOpen}
          onClose={() => setExportOpen(false)}
        />

        <SavedViewEditor
          open={saveViewOpen}
          onClose={() => setSaveViewOpen(false)}
          onSave={handleSaveCurrentView}
        />


        {error && (
          <div className={styles.error} role="alert">
            Couldn't load your notes — this looks like a connection problem, not lost work.{' '}
            <button type="button" className="btn btn-ghost" onClick={refresh}>Try again</button>
          </div>
        )}
        {/* Wave 10 F7 (Part A, 5d): without the property definitions the table's property
            columns, the board's groups and the calendar's date fields are missing -- said,
            not silently absent. */}
        {/* Go-live wave 1 (A7): the sample's status read (asked for when ⋯ first opens) failing is said too: without it
            ⋯ cannot offer "Remove the sample notebook". */}
        <LoadFailed failures={[
          { what: 'your note properties', error: propertyDefsError, retry: refreshPropertyDefs },
          { what: "your sample notebook's status", error: sampleStatusError, retry: () => refreshSampleStatus() },
        ]} />

        {selectionOn && selection.count > 0 && (
          <BulkActionBar
            count={selection.count}
            totalInView={visibleIds.length}
            allSelected={selection.allSelected}
            onSelectAll={selection.selectAll}
            // F4 / A2R-04: "Clear" unmounts the bar it sits in -- focus goes to the list's heading.
            onClear={() => { selection.clear(); paneHeadingRef.current?.focus() }}
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
            onExport={(format) => exportSelection(selection.selectedIds, { format })}
            onTrash={() => runBulk('trash')}
            onRestore={() => runBulk('restore')}
            onArchive={() => runBulk('archive')}
            onUnarchive={() => runBulk('unarchive')}
          />
        )}

        {viewMode === 'tasks' && !isShelfView ? (
          /* Wave 6: every checklist item across the notebook. ⛔ Tested BEFORE
             the notes list's loading/empty branches: it reads its own endpoint
             (GET /api/j2/notes/tasks), not this page's filtered notes, so it
             neither waits for them nor carries their "Showing N of M" row. A
             row opens its note AT that task through `openNote`, the tab's one
             door — so split view's one-pane rule holds here too. Excluded from
             Trash/Archive like every other mode. */
          <NoteTasksView onOpenTask={(id, index) => openNote({ id }, null, { task: index })} />
        ) : (isLoading || allNotesCountPending) && notes.length === 0 ? (
          // Notebook simplify, Task 2: an empty list waits for the account's note count too, so the empty message
          // below can say WHICH empty it is (a view that matches nothing, or a notebook with nothing in it).
          // G-106 (Wave B lower-frequency sweep): a small grid of card-shaped
          // skeleton placeholders -- reusing the same `.grid` layout the real
          // NoteCard grid renders into -- instead of bare text. Not
          // view-mode-aware (this branch runs before viewMode is even
          // consulted below), so it approximates the DEFAULT list/grid view.
          // Notebook simplify, Task 3: shaped like the layout the notes will arrive in (rows or cards).
          <div className={listLayout === 'cards' ? styles.grid : styles.rows} role="status" aria-label="Loading…">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className={listLayout === 'cards' ? styles.noteCardSkeleton : styles.noteRowSkeleton} aria-hidden="true">
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
        ) : notes.length === 0 && folderId ? (
          // VIS-5 (audit 2026-11-05, issue 15): an EMPTY FOLDER says so, by name, with the two things a member
          // does next. ⚰️ It used to say "Your notebook is empty." and render the whole template gallery
          // (536 text nodes) inside a folder of a notebook that was not empty at all.
          <div className={styles.empty} data-empty="folder">
            {/* Fix round 1 (review Minor 18): with a tag, ticker or property filter on too, the folder may hold notes. */}
            <p>{tag || tickerFilter || propertyFilter
              ? `No notes match these filters in ${activeFolderName}`
              : `No notes in ${activeFolderName} yet`}</p>
            <div className={styles.emptyActions}>
              {/* Review Minor 10: secondary -- the toolbar's "+ New" is the screen's one solid primary (VIS-3). */}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => createNote()} disabled={creating}>
                New note here
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={moveNotesHere}>
                Move notes…
              </button>
            </div>
          </div>
        ) : notes.length === 0 && (hasAnyNotes || (hasActiveFilters && !accountEmpty)) ? (
          // Notebook simplify, Task 2: the list is empty because of a filter, a saved view, a ticker or a tag, and the
          // account HAS notes: say that, with the one way back, and nothing else. ⚰️ It used to say "Your notebook is
          // empty." and draw the whole template picker (measured: "Add thesis starter views" opened a view matching
          // nothing in an account of 15 notes). The picker and "Import notes" are for an account with no notes.
          <div className={styles.empty} data-empty="filtered">
            <p>No notes match this view.</p>
            {hasActiveFilters && (
              <div className={styles.emptyActions}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={clearListFilters}>
                  Clear filter
                </button>
              </div>
            )}
          </div>
        ) : notes.length === 0 ? (
          <div className={styles.empty}>
            <p>Your notebook is empty.</p>
            <p className={styles.emptyHint}>
              Start from a template, or a blank page.
            </p>
            {!hasActiveFilters && (
              <div className={styles.emptyImportPitch}>
                <p className={styles.emptyHint}>
                  Bring your notes from Notion, Obsidian, Evernote, or anywhere else.
                </p>
                <div className={styles.emptyActions}>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={openImport}
                    aria-haspopup="dialog"
                  >
                    <UIcon name="upload" size={16} gold={false} />
                    Import notes
                  </button>
                  <SampleNotebookDoor {...sampleNotebook} />
                </div>
              </div>
            )}
            {/* The get-started list renders only for a member with no notes, while its switches are on and it is not
                closed (GettingStartedChecklist decides; nothing is fetched otherwise). */}
            <GettingStartedChecklist hasAnyNotes={hasAnyNotes} onCreateNote={() => createNote()}
              onAddSample={auth?.isPaid === true ? sampleNotebook.add : null} />
            {/* P5 final fix: not while the New note sheet is open, so the page holds ONE picker (one
                gallery door for a tour to wait on, one "How do you trade?", ruling P5-T10-R2). */}
            <div className={styles.emptyPicker}>
              {!pickerOpen && !gridWaits && <TemplatePicker onPick={handlePick} onPickMember={createFromMemberTemplate} onLandNote={landTemplateNote} busy={creating} kindSection={kindSection(false)} />}
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
            {viewMode === 'timeline' && !isShelfView ? (
              /* ⛔ THE RESTORE BRANCH: keyed by the saved view, so opening one
                 remounts the timeline with THAT view's settings (a stale
                 instance would keep drawing the previous view's axis). */
              <NoteTimelineView
                key={activeView?.id || 'adhoc'}
                notes={notes}
                propertyDefs={propertyDefs}
                onOpenNote={openNote}
                initialSettings={activeView?.spec?.timeline || null}
                onSettingsChange={setTimelineSettings}
              />
            ) : viewMode === 'calendar' && !isShelfView ? (
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
                propertyFilter={activeView ? null : propertyFilter}
                onComputedFilter={activeView ? null : handleComputedFilter}
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
              // Lane KEYS round 5: the list is ONE Tab stop. Down and Up go note to note,
              // Right and Left between a note's own controls. Shift+Arrow stays 13Q-5's.
              // Notebook simplify, Task 3: rows by default (one column, hairlines), or the card grid ("Cards").
              <div className={listLayout === 'cards' ? styles.grid : styles.rows} data-list-layout={listLayout}
                role="group" aria-label="Notes" ref={notesGrid.ref} onFocus={notesGrid.onFocus}
                onKeyDown={(e) => { handleSelectionGridKeyDown(e); notesGrid.onKeyDown(e) }}>
                {notes.map((n) => (
                  <NoteCard
                    key={n.id}
                    note={n}
                    layout={listLayout === 'cards' ? 'card' : 'row'}
                    onOpen={openNote}
                    onRestore={isTrashView ? restoreNote : undefined}
                    onUnarchive={isArchiveView ? unarchiveNote : undefined}
                    blocked={blockedNoteIds.has(n.id)}
                    selectable={selectionOn}
                    selected={selection.isSelected(n.id)}
                    selecting={selection.count > 0}
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
        {/* Notebook P1: the Styles manager is mounted OUTSIDE the pane's branches for the same reason as the
            New-note sheet below: a door can open it from a page that is not the list (found by the Task 15 walk,
            when the Settings card's `?styles=1` landed on Research Home, since deleted). */}
        {/* Plan F Task 10 (concern 2): the import wizard is mounted OUTSIDE the pane's branches for the
            same reason (Research Home's "Import notes" and its repair notice were dead buttons there). */}
        <ImportWizard
          open={importOpen}
          initialRecover={importRecover}
          returnFocusTo={importReturnFocus}
          onClose={() => setImportOpen(false)}
          onImported={handleImported}
        />
        {stylesOn && <StylesManager open={stylesOpen} onClose={() => setStylesOpen(false)} blockedNoteIds={[...(blockedNoteIds || [])]}
          show={stylesAsk.show} showKey={stylesAsk.n} />}
        {/* P0.1: the New-note sheet and the voice-note dialog are mounted OUTSIDE the pane's
            branches, so a door beside an open note (the phone "+" sheet) is never a dead button.
            (Research Home's "New note" menu was the first such door; it went in go-live wave 1.) */}
        <Sheet
          open={!!pickerOpen}
          onClose={() => setPickerOpen(false)}
          title="New note"
          // F4 / A2R-08: named by its visible title (it had no name at all).
          labelledByTitle
          variant="auto"
          maxWidth={720}
        >
          {voiceOn && (
            <div className={styles.voiceStarts} role="group" aria-label="Start from audio">
              <span className={styles.voiceStartsLabel}>Start from audio</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => startVoiceNote('record')}>
                <UIcon name="mic" size={15} gold={false} /> Voice note
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => startVoiceNote('upload')}>
                <UIcon name="upload" size={15} gold={false} /> Upload recording
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => startVoiceNote('desk')}>
                <UIcon name="desk" size={15} gold={false} /> From a Desk session
              </button>
            </div>
          )}
          {canvasOn && (
            <div className={styles.canvasStart} role="group" aria-label="Plan a trade">
              <button type="button" className="btn btn-secondary btn-sm" onClick={createCanvas} disabled={creating}>
                <UIcon name="board" size={15} gold={false} /> Trade-plan canvas
              </button>
              <span className={styles.canvasStartHint}>
                A board for a chart, your entry, stop and target, and notes — then link it from your thesis.
              </span>
            </div>
          )}
          {/* 13Q-5: autoFocus only in the Sheet dialog -- the inline empty-notebook
              mount above (the picker at the empty-notebook branch) must never steal focus from a
              page load. */}
          <TemplatePicker onPick={handlePick} onPickMember={createFromMemberTemplate} onLandNote={landTemplateNote} busy={creating} autoFocusSearch={pickerOpen !== 'kinds'} kindSection={kindSection(pickerOpen === 'kinds')} />
        </Sheet>

        {voiceNote && voiceOn && (
          <VoiceNoteDialog
            open
            initialSource={voiceNote.source}
            onSave={saveVoiceNote}
            onClose={() => setVoiceNote(null)}
          />
        )}
      </div>
      {/* Wave 9 (lane 9D, D2): mounted OUTSIDE the pane's branches. The folder tree it opens
          from is on screen on the home page, beside an open note and over the list alike; a
          sheet mounted inside the list branch would make the action a dead button everywhere
          else. */}
      <PublishFolderSheet
        open={Boolean(publishFolder?.open)}
        folder={publishFolder}
        returnFocusTo={publishFolder?.opener || null}
        onClose={closePublishFolder}
      />
      {notebookFlag('notebook_onboarding_enabled') === true && (
        <NotebookTourGate hasAnyNotes={hasAnyNotes} notesKnown={notesKnown} />
      )}
      {/* S16 (audit 2026-11-05): the 60-second first run, on a member's first visit (no notes yet) and from Settings.
          The gate is small; the sheet is a lazy leaf fetched only when it shows. */}
      <FirstRunGate hasAnyNotes={hasAnyNotes} notesKnown={notesKnown} onOpenNote={openNote}
        onOpenToday={todayLandingOn() ? openTodayHome : undefined} />
      {/* Wave 14 (lane W14-C2): the one-time offer for a tour whose capability is on and
          which the member has never seen. Never while a note is open (R4). */}
      <TourOfferDoor tours={OTHER_TOURS} hasAnyNotes={hasAnyNotes} notesKnown={notesKnown} noteOpen={Boolean(noteId)} />
      {/* S12 (M9): the phone Notebook's one floating "+" (phone only, CSS). Its rows are this tab's own doors; the
          sheet is fetched on its first open (lazyDialog), so the first open pays only for the button. */}
      {noteId && (
        <FolderSheet open={folderSheet} onClose={() => setFolderSheet(false)} returnFocusTo={folderSheetBtnRef}>
          {/* Fix round 2 (N4): every choice in the sheet CLOSES it first, then acts -- a folder or a note leaves this
              note, which unmounts the sheet and its trigger; closing first lets the Sheet release its lock and hand
              focus back in order. (N3: the in-page panel is `inert` meanwhile.) */}
          <FolderSidebar {...folderSidebarProps} sidebarOpen onToggleSidebar={() => setFolderSheet(false)}
            onSearchModeChange={NOOP}
            onSelectFolder={closeSheetThen(handleSelectFolder)} onSelectTag={closeSheetThen(handleSelectTag)}
            onOpenNote={closeSheetThen(openNote)}
            onSelectAllNotes={closeSheetThen(selectAllNotes)} onSelectToday={closeSheetThen(openTodayHome)} />
        </FolderSheet>
      )}
      <NotebookPlusFab ref={plusRef} open={plusOpen} onOpen={() => setPlusOpen(true)} />
      <NotebookPlusSheet open={plusOpen} onClose={() => setPlusOpen(false)} returnFocusTo={plusRef}
        onQuickNote={() => createNote()} onVoiceNote={recordVoiceNote}
        onPhoto={(file) => createNote({ title: 'Chart screenshot', onCreated: (c) => holdImageForNote(c.id, file) })}
        onAskNotebook={auth?.isPaid === true ? openAiFromPlus : null} busy={creating} />
    </div>
    </SplitViewContext.Provider>
  )
}
