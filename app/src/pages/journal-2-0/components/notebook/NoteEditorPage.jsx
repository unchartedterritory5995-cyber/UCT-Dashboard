import { useEditor, EditorContent } from '@tiptap/react'
import {
  Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState,
} from 'react'
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom'
import useSWR, { mutate as globalMutate } from 'swr'
import {
  buildExtensions, uploadInlineImage, uploadNoteAttachment,
  ALLOWED_IMAGE_MIMES, ALLOWED_ATTACHMENT_MIMES,
} from '../../lib/tiptap'
import { createMemoDocJSON } from '../../lib/memoDocJSON'
import { createMemoStringify, stringifyDraftPayload } from '../../lib/memoStringifyBody'
import { nodeActiveAtCursor, canBlockquoteFast } from '../../lib/fastToolbarProbes'
import Toast from '../Toast'
import DocumentPreviewSheet from './DocumentPreviewSheet'
import CapturedSourceSheet from './CapturedSourceSheet'
import { targetFromParams, applyTargetToParams, citationTarget,
         reviewTargetFromParams } from '../../lib/searchNavigation'
import { openExcerptCitation, openDocumentCitation, openDocumentPage, SOURCE_NOWHERE,
         PASSAGE_GONE, PASSAGE_NOT_PINPOINTED, NOTE_LEVEL_SOURCE,
         passageFromNavigationState } from '../../lib/openCitation'
import { SOURCE_WEB } from '../../lib/searchResultLabel'
import useNoteDocuments from '../../hooks/useNoteDocuments'
import DocumentTextStatus from './DocumentTextStatus'
import useNoteExcerpts from '../../hooks/useNoteExcerpts'
import useNoteFacts from '../../hooks/useNoteFacts'
import useThesisSummary from '../../hooks/useThesisSummary'
import useEvidenceCandidates from '../../hooks/useEvidenceCandidates'
import LoadFailed, { SaveFailed } from '../LoadFailed'
import { useJ2Note, setNoteFavorite, recordNoteOpened } from '../../hooks/useJ2Notes'
import useJ2NoteFolders from '../../hooks/useJ2NoteFolders'
import ConfirmModal from '../ConfirmModal'
import HeroImagePicker from './HeroImagePicker'
import NoteVideoHero, { getNoteVideoTime } from './NoteVideoHero'
import { NoteRailLeft, NoteRailRight, seekNoteVideo } from './NoteVideoRails'
import TranscriptPanel from '../../../../components/video/TranscriptPanel'
import { useDeskVideoByYoutube } from '../../../../hooks/useDeskVideoByYoutube'
import { useVideoInsights } from '../../../../hooks/useVideoInsights'
import linkifyTimestamps from '../../lib/linkifyTimestamps'
import UIcon from '../../../../components/ui/UIcon'
import { SkipLinkPortal } from '../../../../components/skipLinks'
import usePreferences from '../../../../hooks/usePreferences'
import { useAuth } from '../../../../context/AuthContext'
import {
  useDurableNote, settleLandedSave, beginInFlightSave, endInFlightSave,
  recordLandedRevision, settleOwnerFork, SESSION_ID,
} from '../../lib/offline/useDurableNote'
import { useBlockedNotes } from '../../lib/offline/useBlockedNotes'
import { blockedLabel, unsyncedLabel, OFFLINE_VIEWING_BANNER } from '../../lib/offline/unsyncedCopy'
import { usableBaseline, isUsableBaseline, isSupersededBaseline } from '../../lib/offline/baseline'
import { settleNoteWrite } from '../../lib/offline/settleNoteWrite'
import { baseHasNoBody, sameAuthoredContent } from '../../lib/offline/recoverLocalState'
import {
  appendedServerNodes, missingServerNodes, nodeKeyOf, classifyServerChange, METADATA_ONLY,
} from '../../lib/offline/serverChange'
import { ownerReconcilePlan, LANDED, FORK } from '../../lib/offline/ownerReconcile'
import { stampChartSettings } from '../../lib/widgetEmbedCore'
import WidgetPalette from './WidgetPalette'
// Wave 8 seam S8-3: the share controls (lane 8B) and the export group (lane 8C)
// live in their own files so neither lane edits this one.
import NoteShareControls from './NoteShareControls'
import NoteExportControls from './NoteExportControls'
import NoteMoreMenu from './NoteMoreMenu'
import moreStyles from './NoteMoreMenu.module.css'
import AskPanel, { PRECISE_CITATION } from './AskPanel'
import { PRECISE_STATES, resolveNoteCitation, selectResolvedPassage } from '../../lib/askCitation'
import { appendAskInsert } from '../../lib/askInsert'
import { VOICE_NOTE_EVENT, VOICE_NOTE_LOCKED_SENTENCE, appendVoiceNote, voiceNotesEnabled } from '../../lib/voiceNote'
import usePendingAskInsert from '../../hooks/usePendingAskInsert'
import NoteFindBar from './NoteFindBar'
import TextColorMenu, { TEXT_COLOR_MENU_LABEL } from './TextColorMenu'
import { isReplaceChord, modKeyLabel } from '../../lib/platform'
import NoteStats from './NoteStats'
import NoteOutline from './NoteOutline'
import TableToolbar from './TableToolbar'
import LinkPasteMenu from './LinkPasteMenu'
import UnlinkedMentions from './UnlinkedMentions'
import { TextSelection } from '@tiptap/pm/state'
import { taskIndexFromParams, findTaskItemPos } from '../../lib/noteTasks'
import { NOTEBOOK_EVENTS, startNoteOpenTimer, trackNotebookEvent } from '../../lib/notebookTelemetry'
import { noteIsLocked, setNoteLock } from '../../lib/lockedNote'
import NoteTagsField from './NoteTagsField'
import useJ2NoteTags from '../../hooks/useJ2NoteTags'
import { fallbackNodes } from '../../lib/tagTree'
import { mergeTagDelta, sameTagList } from '../../lib/tagDelta'
import UnsentTrashDialog from './UnsentTrashDialog'
import { noteHasUnsentWork } from '../../lib/offline/noteHasUnsentWork'
import { openNotebookDb } from '../../lib/offline/notebookDb'
import { holdsUnsentWork } from '../../lib/noteBatch'
import { textColorClass } from '../../lib/textColor'
import NoteHistoryPanel from './NoteHistoryPanel'
import NoteBacklinksSection from './NoteBacklinksSection'
import PropertiesSection from './PropertiesSection'
import ThesisSection from './ThesisSection'
import { createNoteViaApi } from '../../lib/noteCreation'
import { refreshEvidenceCandidates } from '../../hooks/useEvidenceCandidates'
import { invalidateNoteLinkTarget } from '../../lib/noteLinkTargetsBatch'
import { SkeletonLine } from '../../../../components/Skeleton'
import {
  noteContentGuardOptions, replaceDocument, isUnreadable, useUnreadableNote,
} from '../../lib/noteContentGuard'
import {
  OWN_READ, bodyWrittenSchema, isSchemaRefusal, writtenSchemaOf,
} from '../../lib/notebookSchema'
import UnreadableNoteNotice from '../../lib/UnreadableNoteNotice'
import styles from './NoteEditorPage.module.css'
import useDisclosureFocus from '../../lib/useDisclosureFocus'
import { focusableWithin } from '../../../../components/mobile/useFocusTrap'
import { MQ } from '../../../../styles/breakpoints'
import { useIsPhone } from '../../../../hooks/useBreakpoint'
import { claimFirstRunStage } from '../../../../components/firstRun/firstRunStage'
import { FONT_OPTIONS } from '../../../../utils/fontFamilies'
import { DICTATE_EVENT, insertDictation } from '../../lib/dictationInsert'
import {
  WRITING_HELP_EVENT, acceptWritingHelp, captureWritingHelpScope, INSIDE_ANSWER_SENTENCE,
} from '../../lib/writingHelp'
import { notebookFlag } from '../../lib/offline/notebookFlags'
import lazyChunk from '../../lib/lazyChunk'
import useToolbarRoving from '../../lib/useToolbarRoving'
import { CANVAS_EVENT, extraBlockCount, isTradeCanvasDoc } from '../../lib/tradeCanvas'
import { createTradeCanvasNote, tradeCanvasEnabled } from '../../lib/tradeCanvasCreate'
import useNoteLinkTarget from '../../hooks/useNoteLinkTarget'
import { notePath } from '../../../../hooks/useNoteBacklinks'
import { TranscriptInsertHost } from './TranscriptDoors'
import { normalizeNoteTicker } from '../../lib/noteTicker'

// Wave 7 lane H1 — the toolbar mic. LAZY: the recorder (MediaRecorder, the Web
// Speech fallback, the Whisper upload) is not needed to open a note, and a
// member who is not paid never downloads it at all (the mount below is gated on
// `isPaid`). Rendered inside its own <Suspense fallback={null}>, so a note never
// waits for it.
// ⛔ Through lib/lazyChunk.js, never a bare React.lazy (wave 7 whole-branch fix,
// frontend review I-1): a chunk that fails to fetch is asked for again in place,
// then handed to the app's one-reload-per-session stale-chunk recovery. A bare lazy
// sent the first failure straight to the route boundary -- the whole Notebook blanked
// over an optional control. Railed tree-wide in tabs/NotebookTab.lazyViews.test.js.
const VoiceInputButton = lazyChunk(() => import('../VoiceInputButton'))
// Wave 7 lane H2 — the writing-help preview. LAZY for the same reason: it is
// fetched the first time a member opens it, never on note open.
const WritingHelpPanel = lazyChunk(() => import('./WritingHelpPanel'))
// Wave 11 lane 11A: the voice-note dialog loads on first use, like writing help.
const VoiceNoteDialog = lazyChunk(() => import('./VoiceNoteDialog'))
// Wave 11 lane 11D — the trade-plan canvas board. LAZY: only a canvas note
// renders it, and only a chart card on it ever loads the chart.
const TradeCanvasBoard = lazyChunk(() => import('./TradeCanvasBoard'))
// Wave 13 lane 13D — "what you wrote then": a resurfacing insight opens the note with
// `?resurfaceVersion=<id>`. LAZY: only that door ever renders it.
const ResurfaceVersionSheet = lazyChunk(() => import('./ResurfaceVersionSheet'))
// The canvas's link-from-a-thesis offer, shown on the note the member picked:
// "Add a link to <plan> at the end of this note?" -- nothing is written until
// the member presses Add (an editor transaction on THIS note's own autosave).
export const LINK_CANVAS_PARAM = 'linkCanvas'
function LinkCanvasOffer({ canvasId, onAdd, onDismiss }) {
  const target = useNoteLinkTarget(canvasId)
  const name = target.title || 'the trade plan'
  return (
    <div className={styles.lockBanner} role="region" aria-label="Link a trade plan" data-export-exclude>
      <UIcon name="link" size={14} gold={false} style={{ verticalAlign: '-2px' }} />
      <span>Add a link to “{name}” at the end of this note?</span>
      <button type="button" className={styles.lockBannerBtn} onClick={onAdd}>Add link</button>
      <button type="button" className={styles.lockBannerBtn} onClick={onDismiss}>Not now</button>
    </div>
  )
}

// A note can carry its source video in heroImageUrl (set by the Desk "Save
// notes to Journal Notebook" export). When it does, we render an embedded
// player + link in the hero slot instead of the image picker.
function parseYouTubeId(url) {
  if (typeof url !== 'string') return null
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/)
  return m ? m[1] : null
}

const AUTOSAVE_MS = 800
// Backoff schedule for transient (5xx / network) save failures.
// After the last entry, retries continue at the cap forever (or until the
// user edits / closes the tab). 4xx errors bypass retry entirely.
const RETRY_BACKOFFS_MS = [1000, 2000, 4000, 8000, 15000, 30000]

// P1-1 fix: `update()` (useJ2Notes.js) throws `new Error(body.detail ||
// \`${res.status}\`)` -- a REAL backend-authored detail when the API
// supplied one (preserve it verbatim; it's already meaningful, e.g. a
// validation message), or just a bare numeric HTTP status code string
// (e.g. "500") when it didn't -- which means nothing to a member and used
// to render as-is ("Save failed: 500"). This only ever replaces the bare
// code, never a real detail.
//
// ⭐ Wave 7 fix round 1 (review M-4): nor is it ever the BROWSER's words. A
// fetch that never reached the server throws a TypeError carrying the
// browser's own message -- Chrome "Failed to fetch", Safari "Load failed",
// Firefox "NetworkError when attempting to fetch resource." -- which is
// plumbing, not the server's detail this function preserves, and it reached a
// member verbatim on Insert image / Scan / attach. It reads as the network
// failure it is.
//
// ⭐ Wave 7 whole-branch fix (lane H nit N-3): the network reading is keyed on those
// WORDS, never on the error's class. A TypeError is also what a programming fault on
// the save or upload path throws ("Cannot read properties of undefined …"); reading
// every TypeError as the network sent a member to check a connection that was fine.
// A TypeError that is not a network word is a code fault: never called the network,
// never shown verbatim (it is plumbing too), and said as a plain failed save.
const BROWSER_NETWORK_FAILURE = /^(failed to fetch|load failed|networkerror when attempting to fetch resource\.?|network request failed)$/i
function friendlySaveError(e, status, { retrying = false } = {}) {
  const msg = e?.message
  const browserSaid = Boolean(msg && BROWSER_NETWORK_FAILURE.test(msg.trim()))
  const codeFault = e instanceof TypeError && !browserSaid
  if (codeFault) return retrying ? 'Could not save — retrying automatically.' : 'Could not save. Please try again.'
  if (msg && !browserSaid && !/^\d{3}$/.test(msg)) return msg
  if (!status || status >= 500) {
    return retrying
      ? "Couldn't reach the server — your note is unchanged, retrying automatically."
      : "Couldn't reach the server. Your note is unchanged — please try again."
  }
  if (status === 404) return 'This note could not be found.'
  if (status === 403) return "You don't have permission to edit this note."
  return 'Could not save. Please try again.'
}

// Wave 0 (P1-10) local draft safety net: the network autosave is debounced
// 800ms behind the last keystroke, so a tab closed WHILE still typing (or
// mid-backoff, offline) can lose everything after the last successful PUT —
// a page refresh, a crashed tab, or the OS closing the browser never runs
// React's unmount cleanup. This mirrors the in-progress edit to
// localStorage on every keystroke (synchronous, local-only, no network),
// so reopening the SAME note can recover it. Cleared the moment a real
// network save actually lands — the local copy is a safety net, never a
// second source of truth for content the server already has.
const DRAFT_KEY = (noteId) => `uct.j2.notedraft.${noteId}`

// ⛔⛔ `setContent(body, false)` STOPPED SUPPRESSING `onUpdate` AT TIPTAP v3, AND
// SAID NOTHING. In v2 the second argument WAS `emitUpdate`; in v3 it is an
// options OBJECT, destructured as `{ emitUpdate = true, … } = {}`. A `false`
// there is not `undefined`, so the default does not apply to the argument — it
// applies to the missing PROPERTY, and `emitUpdate` comes out **true**. Every
// call site in this file carried a comment claiming the update was suppressed,
// and every one of them had been emitting into `scheduleAutosave` since the v3
// upgrade — turning three deliberate "put the canonical copy on screen" moments
// (note load, draft restore, conflict reconcile) into autosaves of content the
// server had just handed us. Measured against the installed TipTap, both ways:
// `setContent(x, false)` emits, `setContent(x, EMIT_NOTHING)` does not.
// ⛔ One authority, named, so a fifth call site cannot quietly get it wrong.
const EMIT_NOTHING = { emitUpdate: false }

/**
 * Wave 10 (G-144): can the editor's own history command run? The touch Undo /
 * Redo buttons ask this for their disabled state, the same `can()` probe the
 * table toolbar uses. A destroyed editor, or one without the history
 * extension, answers false -- a disabled button, never a dead click.
 */
export function canRunHistory(editor, cmd) {
  if (!editor || editor.isDestroyed || !editor.isEditable) return false
  try { return Boolean(editor.can()[cmd]?.()) } catch { return false }
}

/**
 * Wave 10 (TY, standard 4 -- typing budget): the toolbar-sync SIGNATURE the
 * `transaction` / `selectionUpdate` listeners below compare against, so a
 * keystroke that leaves every one of these values unchanged triggers NO
 * re-render of the whole editor page -- see `toolbarStateReducer`.
 *
 * ⛔⛔ THE AUDIT (owner finding, L12 full proof walk 62e252649, G-131 touch
 * BROKEN after this reducer landed): every value the NoteEditorPage SUBTREE
 * reads from `editor.state` / `editor.isActive` / `editor.getAttributes` /
 * `editor.can()` at RENDER time, live, with no subscription of its own --
 * cross-referenced against the field that covers it. A component with its OWN
 * `editor.on('transaction', …)` (LinkPasteMenu, NoteStats, NoteOutline, and
 * -- added by this same finding -- TableToolbar) is NOT in this list: it
 * re-renders itself and this reducer cannot make it stale. TableToolbar was
 * the first one FOUND this way (`NoteEditorPage.wave6.test.jsx`'s "Add a row"
 * hung behind the bailout before it got a field), but it reads FAR more than
 * one boolean at render time -- `tableAtSelection`, then six commands' worth
 * of `editor.can()` for its row/column buttons' disabled state, `sortable`,
 * `ctx`, `width`, `header` -- every one of them selection- or doc-dependent,
 * and every table EDIT is itself a transaction that touches none of the
 * fields below. Enumerating all of those here would have been both fragile
 * and the wrong shape; giving the bar its own subscription (mirroring
 * LinkPasteMenu) is what removed `inTable` from this signature entirely. A
 * component that only reads `editor` inside an EVENT HANDLER (CaptureInboxTray's
 * `place()`, the task-jump effect, the conflict-merge path) is not in this
 * list either -- those run at click/effect time, never render time, so they
 * always see the live editor regardless of this bailout.
 *
 *   read (file:line)                                           | field
 *   ------------------------------------------------------------|----------------
 *   NoteEditorPage.jsx isActive('bold')                          | bold
 *   NoteEditorPage.jsx isActive('italic')                        | italic
 *   NoteEditorPage.jsx isActive('heading',{level:1})             | h1
 *   NoteEditorPage.jsx isActive('heading',{level:2})             | h2
 *   NoteEditorPage.jsx isActive('bulletList')                    | bulletList
 *   NoteEditorPage.jsx isActive('orderedList')                   | orderedList
 *   NoteEditorPage.jsx isActive('blockquote')                    | blockquote
 *   NoteEditorPage.jsx isActive('codeBlock')                     | codeBlock
 *   NoteEditorPage.jsx getAttributes('textStyle').fontFamily     | fontFamily
 *   NoteEditorPage.jsx getAttributes('textStyle').fontSize       | fontSize
 *   NoteEditorPage.jsx getAttributes('textColor').color          | textColor
 *   NoteEditorPage.jsx canRunHistory(editor,'undo'/'redo')       | canUndo/canRedo
 *   TextColorMenu.jsx `editor.getAttributes('textColor').color`  | textColor (shared)
 *   TextColorMenu.jsx `editor.isActive('highlight')`             | highlightActive
 *   TextColorMenu.jsx `editor.getAttributes('highlight').color`  | highlightColor
 *
 * `isActive` / `getAttributes` resolve against the CURRENT SELECTION, never a
 * document walk -- so every row above is O(1) per keystroke regardless of note
 * size AT THE APP LEVEL this file controls.
 *
 * ⛔⛔ THAT CLAIM WAS WRONG FOR THE SIX NODE-TYPE ROWS (h1/h2/bulletList/
 * orderedList/blockquote/codeBlock) AND FOR canBlockquote, measured by lane
 * TY7 via a CPU-profile call-tree walk, not assumed:
 * `docs/notebook/perf-runs/ty7/ty7-caller-table.json`. `editor.isActive` for
 * a NODE type (not a mark) calls `@tiptap/core`'s `isNodeActive`, which ALWAYS
 * calls `state.doc.nodesBetween(from, to, …)` -- and prosemirror-model's
 * `Fragment.prototype.nodesBetween` iterates its children from index 0 up to
 * `to`, REGARDLESS of `from`, so resolving a position near the end of a flat
 * 2,000-paragraph doc costs O(preceding siblings) on EVERY call. canBlockquote
 * is the same shape one level up (`findWrapping` -> `canReplaceWith` ->
 * `contentMatchAt`, walking the PARENT's preceding children). Marks (bold,
 * italic, highlight) and getAttributes genuinely stay O(1) -- confirmed the
 * same way -- which is why only those two function families changed.
 * `nodeActiveAtCursor` / `canBlockquoteFast` (`lib/fastToolbarProbes.js`)
 * answer the SAME question from `$from`'s already-resolved ancestor chain
 * (O(depth)) instead, with an equivalence test against the real
 * `editor.isActive` / `editor.can().toggleBlockquote()` over a real editor
 * (`lib/fastToolbarProbes.equivalence.test.js`) -- this file's own calls
 * below changed, this comment's field LIST and the toolbarSignatureAudit rail
 * below did not, because the toolbar still shows exactly the same values.
 *
 * A field added to ANY of these render reads -- this file's JSX or a
 * child that does not self-subscribe -- must be added here too, or it goes
 * stale behind a bailed-out render; `NoteEditorPage.toolbarSignatureAudit.test.js`
 * greps this file and TextColorMenu.jsx for exactly this shape and fails BY
 * NAME on an uncovered one. A component whose render-time reads are numerous
 * or fine-grained (TableToolbar's shape) should get ITS OWN subscription
 * instead of growing this list -- re-rendering one small floating bar every
 * keystroke costs nothing the typing budget measures.
 *
 * ⛔⛔ `selectionEmpty` (`editor.state.selection.empty`) closes the gap the
 * walk actually exercises: `TextColorMenu.jsx`'s `apply()` calls
 * `editor.chain().focus().setTextColor(...)`, and a color/highlight command
 * run against an EMPTY selection sets a STORED MARK for the next character
 * typed -- it colors NOTHING already on the page, so the note's HTML shows no
 * mark at all ("no colour mark in the note" is exactly what that produces).
 * `select text -> open the picker -> pick a swatch` is a SELECTION
 * transitioning empty -> non-empty immediately before the picker opens --
 * precisely the shape none of the other fields track, since none of them
 * describe "is there a selection", only what marks/blocks apply to wherever
 * it is. Tracked as a BOOLEAN, not the selection's `from`/`to` range:
 * continuous typing keeps the cursor collapsed throughout (`empty` stays
 * `true` the entire time), so the typing budget's win is UNCHANGED -- only
 * the act of selecting text (or replacing one), which is not itself a
 * keystroke the 16 ms/char budget measures, now pays the one render it needs.
 *
 * ⛔⛔ `canBlockquote` (second G-131 finding, L12 full walk 62e252649 +
 * `docs/notebook/proof/l12full-62e252649/deadclick.json`): the dead-click
 * sweep read the ❝ button DEAD right after "1. List" on BOTH `nb-note` and
 * `ed-property`. Measured directly (`editor.can().toggleBlockquote()`,
 * `app/src/pages/journal-2-0/lib/__bqProbe.test.js`, real buildExtensions()):
 * the selection was collapsed inside an ordered-list item's paragraph, and
 * `toggleBlockquote().run()` genuinely returns `false` there and changes
 * NOTHING -- the same click on a plain paragraph (no list) works exactly as
 * expected (`can()===true`, HTML gains a `<blockquote>`). This is PROSEMIRROR
 * SCHEMA, not a regression: `listItem`'s content expression is `paragraph
 * block*`, so wrapping its one paragraph in a blockquote would leave the
 * listItem without the leading `paragraph` the schema requires, and
 * `findWrapping` correctly refuses. It was refused before e1999ca5f too --
 * the pre-bailout walk's "LIVE" verdict
 * (`docs/notebook/proof/l12dc-0100a3032/deadclick.json`) was a FALSE
 * POSITIVE: its only recorded effects were `attributes:type` mutations on
 * two unrelated INPUT elements (Add-a-tag, Upload-image) -- collateral DOM
 * churn from the OLD whole-page re-render, not the blockquote toggle. And
 * `blockquote: editor.isActive('blockquote')` was already in THIS reducer
 * the moment e1999ca5f introduced it (verified: `git show
 * e1999ca5f -- NoteEditorPage.jsx | grep blockquote`), so the button's
 * pressed state was never missing from the signature either -- 3b6e6fde4
 * changes NOTHING about this outcome. The real gap: nothing told the MEMBER
 * the click did nothing. `canBlockquote` closes it -- mirrors
 * `canUndo`/`canRedo`'s `canRunHistory(editor, cmd)` pattern exactly, so the
 * button now renders `disabled` with a reason instead of silently eating
 * the tap.
 */
export function readToolbarFormatState(editor) {
  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    h1: nodeActiveAtCursor(editor, 'heading', { level: 1 }),
    h2: nodeActiveAtCursor(editor, 'heading', { level: 2 }),
    bulletList: nodeActiveAtCursor(editor, 'bulletList'),
    orderedList: nodeActiveAtCursor(editor, 'orderedList'),
    blockquote: nodeActiveAtCursor(editor, 'blockquote'),
    canBlockquote: canBlockquoteFast(editor, canRunHistory),
    codeBlock: nodeActiveAtCursor(editor, 'codeBlock'),
    fontFamily: editor.getAttributes('textStyle').fontFamily || '',
    fontSize: editor.getAttributes('textStyle').fontSize || '',
    textColor: editor.getAttributes('textColor').color || '',
    highlightActive: editor.isActive('highlight'),
    highlightColor: editor.isActive('highlight') ? (editor.getAttributes('highlight').color || 'yellow') : '',
    canUndo: canRunHistory(editor, 'undo'),
    canRedo: canRunHistory(editor, 'redo'),
    selectionEmpty: Boolean(editor.state?.selection?.empty),
  }
}

/**
 * `prev` starts `null`, so the first call after mount always re-renders once
 * (matches the old unconditional-bump behaviour). After that, returning the
 * SAME object reference when nothing changed is what lets React bail out of
 * re-rendering NoteEditorPage's subtree (`useReducer`'s documented
 * Object.is bailout) -- never a value the render reads, only a value it is
 * keyed on, so this changes WHEN the page re-renders, never WHAT it renders.
 */
export function toolbarStateReducer(prev, editor) {
  if (!editor || editor.isDestroyed) return prev
  const next = readToolbarFormatState(editor)
  if (prev && Object.keys(next).every((k) => prev[k] === next[k])) return prev
  return next
}

// G-064 fix round 1 (F5) — ONE string, read by both the direct-click insert
// path and the pending-hand-off path, so the two can never say something
// different about the same outcome.
const ASK_INSERT_SUCCESS_MSG = 'Answer inserted at the end of this note.'

// ⛔⛔ B1 — what a member reads when the server refused words this device
// recovered (an old tab's queued copy, a crash draft) because the version of the
// app that wrote them could not read this note. The words are NOT lost: they are
// the `(conflicted copy)` sibling, and the page shows the note as it is.
export const REFUSED_COPY_MESSAGE = 'Unsaved changes on this device came from an older version of the app and could not safely replace this note. They were kept as a separate copy (conflicted copy).'

// Toolbar Font dropdown — the app's approved family set (each option previews in
// its own face). Value is a full CSS font-family stack; '' clears.
//
// ⭐ THE TABLE MOVED TO `utils/fontFamilies.js`. The chart's Text Note gained a
// font picker in Phase 6, and a second hand-typed list is how two surfaces end
// up offering "Helvetica" and "Helvetica Neue" with nobody able to say which is
// approved. Imported under its own name, so nothing else in this file changed.
const FONT_SIZES = [12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 28, 32, 36, 40, 48, 60, 72]

// The capture inbox tray: hotkey captures banked during the session, offered
// for placement while writing. Renders nothing when the inbox is empty (the
// common case costs one lightweight GET). Insert lands the embed at the
// cursor; the row is CONSUMED only after the save that persists the embed
// succeeds (onPlaced → the page's commitSave) — deleting on insert lost the
// capture on both ends whenever that save failed (panel finding). ✕ arms a
// two-step confirm: the delete is unrecoverable and sat one misclick from
// Insert (the 8/10 builder-sweep defect class).
const _inboxFetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : { captures: [] }))
// Age suffix for a capture chip ≥24h old — a stale capture inserted as
// "today's" is wrong evidence (its capturedAt is honest; the CHIP wasn't).
function _capAgeText(capturedAt) {
  const t = Date.parse(capturedAt || '')
  if (!Number.isFinite(t)) return null
  const days = Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000))
  return days >= 1 ? `${days}d ago` : null
}
export function CaptureInboxTray({ editor, onPlaced }) {
  const { data, mutate } = useSWR('/api/j2/inbox', _inboxFetcher, {
    revalidateOnFocus: true, dedupingInterval: 15000,
  })
  // Rows placed this session but not yet consumed (their DELETE waits on the
  // next successful save) — a focus revalidation must not resurrect them.
  const placedIdsRef = useRef(new Set())
  const [confirmId, setConfirmId] = useState(null)
  useEffect(() => {
    if (confirmId == null) return undefined
    const t = setTimeout(() => setConfirmId(null), 2500)
    return () => clearTimeout(t)
  }, [confirmId])
  const captures = (data?.captures || []).filter((c) => !placedIdsRef.current.has(c.id))
  if (!editor || !captures.length) return null

  const place = (cap) => {
    // Insert AT THE CURSOR when the user has one, at the END otherwise —
    // with two guards (both review-found):
    // 1. Never insert into a NodeSelection (or the untouched initial
    //    selection): insertContent REPLACES a selected node — the tray
    //    silently ate the trailing embed (rail: widgetEmbedInsert.test.jsx).
    // 2. Only fall back to 'end' in those cases — an unconditional 'end'
    //    dumped the capture off-screen at the bottom of long notes while the
    //    button said "insert at cursor".
    const sel = editor.state.selection
    const useCursor = !sel.node && sel.from > 1
    const ok = editor.chain().focus(useCursor ? undefined : 'end')
      .insertWidgetEmbed(cap.widgetId, cap.params, {
        capturedAt: cap.capturedAt,
        fallback: cap.fallbackUrl ? { url: cap.fallbackUrl } : null,
        // Capture-time drawings from the row — an explicit array (even empty)
        // wins over buildWidgetEmbedAttrs' live-store re-seed, so the embed
        // shows what was on screen at CAPTURE, not at placement (review
        // finding). Legacy rows without the field keep the re-seed.
        ...(Array.isArray(cap.annotations) ? { annotations: cap.annotations } : {}),
        // Wave 1 (P1-1): a comment/trade link typed before banking to the
        // inbox must still be there once the capture is placed into a note.
        ...(cap.caption ? { caption: cap.caption } : {}),
        ...(cap.tradeRef ? { tradeRef: cap.tradeRef, tradeRefType: cap.tradeRefType } : {}),
      }).run()
    if (!ok) return
    placedIdsRef.current.add(cap.id)
    onPlaced?.(cap.id)
    // Hide locally now; the authoritative DELETE fires after the save lands.
    mutate({ captures: (data?.captures || []).filter((c) => c.id !== cap.id) }, false)
  }
  const discard = async (cap) => {
    if (confirmId !== cap.id) {
      setConfirmId(cap.id)
      return
    }
    setConfirmId(null)
    await fetch(`/api/j2/inbox/${cap.id}`, { method: 'DELETE', credentials: 'include' }).catch(() => {})
    mutate()
  }

  return (
    <div data-export-exclude style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
      margin: '8px 0 4px', padding: '7px 10px', borderRadius: 8,
      border: '1px solid var(--border, #2a2a2a)', background: 'var(--panel, #101010)',
      fontSize: 12,
    }}>
      <span style={{ color: 'var(--ut-gold, #c9a84c)', fontWeight: 700 }}>
        Notebook inbox ({captures.length})
      </span>
      {captures.map((cap) => {
        const age = _capAgeText(cap.capturedAt)
        return (
          <span key={cap.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <button
              type="button"
              onClick={() => place(cap)}
              title={`Insert at cursor${cap.capturedAt ? ` — captured ${new Date(cap.capturedAt).toLocaleDateString()}` : ''}`}
              style={{
                background: 'none', border: '1px solid var(--border, #333)', borderRadius: 6,
                color: 'var(--text, #cfcfcf)', padding: '2px 8px', cursor: 'pointer', font: 'inherit',
              }}
            >
              {cap.searchText || cap.widgetId}
              {age && <span style={{ color: 'var(--text-dim, #777)', marginLeft: 5, fontSize: 11 }}>· {age}</span>}
            </button>
            <button
              type="button"
              onClick={() => discard(cap)}
              aria-label={confirmId === cap.id ? 'Confirm discard' : 'Discard capture'}
              style={confirmId === cap.id
                ? { background: 'none', border: '1px solid var(--ut-gold, #c9a84c)', borderRadius: 6, color: 'var(--ut-gold, #c9a84c)', padding: '2px 7px', cursor: 'pointer', font: 'inherit', fontSize: 11 }
                : { background: 'none', border: 'none', color: 'var(--text-dim, #777)', cursor: 'pointer', font: 'inherit' }}
            >
              {confirmId === cap.id ? 'Discard?' : <UIcon name="x" size={12} gold={false} />}
            </button>
          </span>
        )
      })}
    </div>
  )
}

// ⛔ Wave 10 F7 (Part A, 5d): a failed read THROWS. It used to answer `{ links: [] }` on any
// non-OK status, so a 500 read as "this note links no trade" -- a statement, not a failure.
const _tradeLinksFetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(String(r.status))
    return r.json()
  })

// Wave 3 (Thesis-Trade Link): renders this note's linked trade/strategy as
// clickable chips. Resolution comes ENTIRELY from the server
// (GET /notes/{id}/trade-ref/resolve) -- this component never re-derives or
// guesses a destination. A link whose resolution.kind is "ambiguous_legacy"
// or "unresolved" renders as an inert chip (see note_trade_links.py) rather
// than navigating to a possibly-wrong object.
export function NoteLinkedTradeChips({ noteId }) {
  const navigate = useNavigate()
  const { data, error, mutate } = useSWR(
    noteId ? `/api/j2/notes/${noteId}/trade-ref/resolve` : null,
    _tradeLinksFetcher,
    { revalidateOnFocus: false, dedupingInterval: 15000, shouldRetryOnError: false },
  )
  const links = data?.links || []
  if (error && !links.length) {
    return <LoadFailed compact what="this note's linked trades" error={error} onRetry={() => mutate()} />
  }
  if (!links.length) return null

  return (
    <>
      {links.map((link, i) => {
        const res = link.resolution || {}
        const key = `${link.tradeRef}:${link.tradeRefType}:${i}`
        if (res.kind === 'equity_trade' || res.kind === 'option_strategy') {
          const label = res.symbol ? `${res.symbol} · trade` : 'Linked trade'
          const goto = () => {
            if (res.kind === 'equity_trade') {
              navigate(`/journal-2-0/trade/${res.id}`)
            } else {
              navigate(`/journal?j2tab=journal&openTrade=${res.id}`)
            }
          }
          return (
            <button
              key={key}
              type="button"
              className={styles.linkedTradeChip}
              onClick={goto}
              title={res.kind === 'equity_trade' ? 'Open the linked equity trade' : 'Open the linked option strategy'}
            >
              <UIcon name="link" size={12} gold={false} />
              {label}
            </button>
          )
        }
        if (res.kind === 'position') {
          // Still open (never graduated to a closed trade -- see
          // note_trade_links.py's resolve_trade_ref) -- Open Positions is
          // the one always-reachable destination; TradeDetailPage doesn't
          // exist for a position that hasn't closed.
          const label = res.symbol ? `${res.symbol} · open position` : 'Linked position'
          return (
            <button
              key={key}
              type="button"
              className={styles.linkedTradeChip}
              onClick={() => navigate('/journal?j2tab=positions')}
              title="Open Positions — this position hasn't closed into a trade yet"
            >
              <UIcon name="link" size={12} gold={false} />
              {label}
            </button>
          )
        }
        if (res.kind === 'ambiguous_legacy') {
          return (
            <span
              key={key}
              className={styles.linkedTradeChipMuted}
              title="This note's linked trade reference predates typed references and matches more than one record -- it can't be safely resolved. The note and its stored reference are unaffected."
            >
              Linked trade — ambiguous
            </span>
          )
        }
        if (res.kind === 'unresolved') {
          return (
            <span
              key={key}
              className={styles.linkedTradeChipMuted}
              title="This note's linked trade could not be found (it may have been deleted)."
            >
              Linked trade — not found
            </span>
          )
        }
        return null
      })}
    </>
  )
}

/**
 * One editor-toolbar button (Bold, Italic, H1, H2, the lists, quote, code, link, image).
 *
 * ⛔ DECLARED AT MODULE SCOPE, NEVER INSIDE NoteEditorPage. Wave 10 (lane 10A, clause 4d):
 * declared inside the page, it was a NEW component type on every render of the page, so React
 * UNMOUNTED and re-mounted all twelve buttons -- and the SVG icons inside them -- on every
 * render, and the page renders on every keystroke. A traced keystroke at 2,000 paragraphs
 * spent most of its main-thread time on it: ~12.6 buttons torn down and rebuilt per key
 * (`removeChild` / `insertBefore` the largest self-time entries in the CPU profile), and each
 * insertion re-ran the note pane's `:has()` style invalidation over ~131 elements
 * (docs/notebook/perf-budgets.md §7). Railed by NoteEditorPage.toolbarIdentity.test.jsx
 * (a button keeps its DOM node across a re-render) and lib/nestedComponents.test.js.
 */
/*
 * ⛔⛔ G-160 (F4 amendment, found by lane 10E-1's path census): IT ACTS ON THE KEYBOARD TOO.
 * The action ran on `mousedown` only -- `preventDefault` there keeps the editor's selection,
 * which a click's focus change would drop -- so Enter and Space, which fire `click` and never
 * `mousedown`, did nothing: "Attach a file", "Insert link", "Insert image", Bold and the rest
 * were dead to a keyboard member (WCAG 2.1.1). Now `click` runs the action too, and a pointer
 * press never runs it twice: the `mousedown` that ran it marks the press, and the `click` that
 * follows is swallowed. A key pressed on the button clears that mark first, so a keyboard
 * activation always acts. Rail: NoteEditorPage.toolButtonKeyboard.test.jsx.
 *
 * ⛔ `disabled` (G-131 second finding): a native `disabled` button receives
 * NO mousedown/click at all from the browser, so passing it through is
 * sufficient on its own -- the G-160 press/click dedup above still only
 * matters for an ENABLED button and is untouched for one. `title` doubles as
 * the disabled-state REASON when the caller passes one; a member who taps a
 * disabled tool sees why, rather than a click that silently did nothing
 * (`lesson: a control that can be dismissed [here: refused] needs the member
 * to know it, not just a developer reading the registry`).
 */
function ToolButton({ active, onClick, label, title, disabled }) {
  const ranOnPressRef = useRef(false)
  return (
    <button
      type="button"
      className={`${styles.toolBtn} ${active ? styles.toolBtnActive : ''} ${disabled ? styles.toolBtnDisabled : ''}`}
      disabled={disabled}
      onMouseDown={(e) => { e.preventDefault(); ranOnPressRef.current = true; onClick() }}
      onKeyDown={() => { ranOnPressRef.current = false }}
      onClick={() => {
        if (ranOnPressRef.current) { ranOnPressRef.current = false; return }
        onClick()
      }}
      title={title}
      aria-label={title}
    >{label}</button>
  )
}

/**
 * ⛔⛔ FX2 (wave 10, proof-walk item 3), `unsentInEditor`'s companion to
 * `canonicalBodyJson`: StarterKit's TrailingNode extension appends an empty
 * paragraph via `appendTransaction` whenever a doc's last node is not
 * already one -- a PLUGIN hook that fires on the editor's own initial
 * content-load transaction, never on a bare schema parse. So
 * `editorRef.current.getJSON()` carries that trailing paragraph the moment
 * the editor mounts a note whose last node is a table, code block,
 * block-math node, callout or task list, and a schema-only parse of the
 * server's raw JSON never will. Strips exactly ONE trailing paragraph with
 * NO content (never one holding a member's real, if empty-looking, mark or
 * text node -- `content` absent or `[]` only) from a doc's top-level
 * `content` array, symmetrically on whichever side has it, so the
 * comparison this feeds cannot be fooled into calling a genuine last-line
 * edit "nothing changed" (a paragraph the member actually typed into is
 * never "empty" by this test) or into calling TrailingNode's own housekeeping
 * an edit.
 */
function stripTrailingEmptyParagraph(doc) {
  if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content) || !doc.content.length) return doc
  const last = doc.content[doc.content.length - 1]
  const isEmptyParagraph = last?.type === 'paragraph' && (!last.content || last.content.length === 0)
    && !last.attrs && !last.marks
  if (!isEmptyParagraph) return doc
  return { ...doc, content: doc.content.slice(0, -1) }
}

/** Lane KEYS3 (Q18): how many animation frames a just-opened review is watched for its first
 *  collapsed block before focus falls back to the note's landmark (about 2.5 s). */
const COLLAPSED_FOCUS_FRAMES = 150

export default function NoteEditorPage({
  noteId, onBack, showBack = true, onTitleChange = null, noteMenu = null,
  // Wave 8 (8A, A4; final-review fix I-1): where an explicit open from the
  // Notebook puts focus -- 'title' for a note the member just made with a
  // title or a template (typing/reviewing the title is the next act),
  // 'landmark' for a note that already exists (the note's heading, which is
  // not editable), 'body' (13Q-2) for a note the member just made BLANK (no
  // title, no template -- the next act is writing), null for an open aimed
  // inside the note (a task, a page, an excerpt), which places focus itself.
  openFocus = null, onOpenFocused = null,
}) {
  const { note, isLoading, error: loadError, update, refresh, patchTags } = useJ2Note(noteId)
  // Diagnostic only -- never surfaced to the member (see the !note render
  // branch below for why raw fetch-error text doesn't belong in that UI).
  useEffect(() => {
    if (loadError) console.warn('note load failed', loadError)
  }, [loadError])
  const { folders } = useJ2NoteFolders()
  // `isPaid` (wave 7 H1): the toolbar mic mounts only for a paid member, so an
  // unpaid one never loads the recorder chunk and never sees a dead button.
  const { user, isPaid } = useAuth()
  const [saveStatus, setSaveStatus] = useState('saved')
  const [saveErrorMsg, setSaveErrorMsg] = useState('')
  // Wave 6 item 8 — a LOCKED note (lane E's `locked` field; lib/lockedNote.js).
  // `unlockedHere` covers the moment between Unlock landing and the refreshed
  // note saying so; once the server copy reads unlocked it is cleared, so a
  // later lock (another tab, the note menu) applies again.
  const [unlockedHere, setUnlockedHere] = useState(false)
  const [unlockState, setUnlockState] = useState(null) // null | 'busy' | 'failed'
  const locked = noteIsLocked(note) && !unlockedHere
  // Read by TipTap's `onUpdate`, which is frozen at editor creation (M6).
  const lockedRef = useRef(locked)
  lockedRef.current = locked
  // The member's own tags, for the tag field's suggestions (hierarchy first).
  const { tagTree, tagCounts, refresh: refreshTagNodes } = useJ2NoteTags()
  const tagNodes = useMemo(() => tagTree || fallbackNodes(tagCounts), [tagTree, tagCounts])
  useEffect(() => { setUnlockedHere(false); setUnlockState(null) }, [noteId])
  useEffect(() => { if (note && !noteIsLocked(note)) setUnlockedHere(false) }, [note])
  // Wave Q1: the durable local working copy. ⛔ The account is part of the
  // DATABASE NAME, not a predicate — a wrong name yields no data, a forgotten
  // filter yields another member's research. It degrades to `supported: false`
  // (private windows, old browsers) without taking the editor with it.
  const durable = useDurableNote({ accountId: user?.id, noteId })

  // ⛔⛔ A DIFFERENT AXIS FROM `saveStatus` BELOW — a READ signal, not a write
  // one. Wave Q1's durable working copy lets a member reopen a previously-
  // viewed note while offline (G-083), completely silently. `navigator.onLine`
  // read once at mount would go stale the instant connectivity changes with
  // the tab still open, so this tracks the two DOM events reactively -- the
  // same events `useOutboxDrain.js` already listens for for its own,
  // different reason (retrying the queue). Competitive audit finding
  // Accessibility QW-5, 2026-09-22.
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  )
  useEffect(() => {
    const goOnline = () => setIsOffline(false)
    const goOffline = () => setIsOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // Wave Q1 — THE OPEN NOTE CAN ALSO BE BLOCKED, and until now it said nothing.
  // The sweep never touches the open note (`excludeNoteId`), so this state can
  // only arrive from a PREVIOUS session: the member closed a note whose queued
  // write the drain then refused, and opened it again today. The header's
  // existing "waiting to sync" line is gated on the editor's own save attempt
  // (`error`/`reconnecting`), which on a freshly-opened note is neither — so
  // the one surface that was honest was honest only while a save was failing.
  // ⛔ `durable.status` is the refresh signal: a fresh durable write REPLACES
  // the outbox entry and the replacement carries no `permanent` flag, so the
  // badge has to be able to CLEAR itself the moment the member does the thing
  // it asked them to do.
  const { blocked: blockedNoteIds } = useBlockedNotes({
    accountId: user?.id,
    refreshToken: durable.status,
  })
  const noteIsBlocked = blockedNoteIds.has(noteId)
  // Read through a ref for the same reason every other callback here does:
  // TipTap's onUpdate and every scheduled timeout close over an old render.
  const durableRef = useRef(durable)
  durableRef.current = durable

  // Wave B Recents: fire the "opened" beacon once per real note view (not on
  // every render, not while it's still loading, not on a failed load). Keyed
  // on noteId so switching notes without unmounting (NotebookTab reuses this
  // component across selections) records each one.
  useEffect(() => {
    if (noteId && note) recordNoteOpened(noteId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, Boolean(note)])

  // Wave B Favorites: local + optimistic, reverted on a failed write (§47 —
  // "restore truthful state" on failure). Re-syncs from the server's own
  // value whenever a DIFFERENT note's data lands (note.isFavorite for the
  // note currently open), so switching notes never carries the previous
  // note's star state onto the new one.
  const [isFavorite, setIsFavorite] = useState(false)
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  useEffect(() => {
    setIsFavorite(Boolean(note?.isFavorite))
  }, [noteId, note?.isFavorite])
  // Wave B: find-in-note. Scoped to this page's own keydown (a React
  // synthetic handler bubbling from anywhere inside .page below) rather
  // than a global window listener — the browser's native Ctrl/Cmd+F is
  // untouched everywhere else in the app, since this handler only exists
  // while a note is actually mounted.
  const [findOpen, setFindOpen] = useState(false)
  // Wave 5: opened for REPLACE (Ctrl+H; Cmd+Option+F on a Mac, where Cmd+H
  // hides the app and Ctrl+H is ProseMirror's delete-backward). The platform
  // test is lib/platform.js -- the Notebook's ONE answer to "is this a Mac?".
  const [findWithReplace, setFindWithReplace] = useState(false)
  const onPageKeyDown = (e) => {
    const key = e.key.toLowerCase()
    if (isReplaceChord(e)) {
      e.preventDefault()
      setFindWithReplace(true)
      setFindOpen(true)
    } else if ((e.metaKey || e.ctrlKey) && key === 'f') {
      e.preventDefault()
      setFindOpen(true)
    } else if (key === 'escape' && findOpen) {
      // Only when the find bar's OWN input isn't already handling it (its
      // handler calls stopPropagation on Escape) -- this is the fallback
      // for Escape pressed while focus is elsewhere on the page.
      closeFind()
    }
  }

  // Wave 8 (8A, A4): closing find hands focus back to the note -- the caret
  // where it was -- instead of dropping it with the bar that held it.
  const closeFind = () => {
    setFindOpen(false)
    setFindWithReplace(false)
    editor?.commands.noteFindClear()
    editor?.commands.focus()
  }

  // ⛔ Wave 10 F7 (Part A, 5d): a write that did not land is SAID, and the sentence stays until
  // dismissed or the next attempt OF THAT SAME WRITE lands (SaveFailed). The star was reverted
  // before, silently.
  // ⛔ F7 fix round 1 (review I2): ONE SLOT PER WRITE PATH. A single shared slot let a
  // successful favorite toggle erase an unresolved "Couldn't add that tag" while the field
  // still held the unsaved tag. A success clears only its own path's sentence; both can show.
  // Rail: a11y/silentFailures.test.jsx ("one write's success never erases the other's failure").
  const [favoriteFailure, setFavoriteFailure] = useState(null)
  const [tagWriteFailure, setTagWriteFailure] = useState(null)
  const [tickerFailure, setTickerFailure] = useState(null)
  useEffect(() => { setFavoriteFailure(null); setTagWriteFailure(null) }, [noteId])
  const onToggleFavorite = async () => {
    if (favoriteBusy) return
    const next = !isFavorite
    setIsFavorite(next) // optimistic
    setFavoriteBusy(true)
    try {
      await setNoteFavorite(noteId, next)
      setFavoriteFailure(null)
    } catch {
      setIsFavorite(!next) // revert -- never diverge silently from the server
      setFavoriteFailure(next
        ? "Couldn't add this note to Favorites. Nothing changed."
        : "Couldn't remove this note from Favorites. Nothing changed.")
    } finally {
      setFavoriteBusy(false)
    }
  }

  // Wave C: version history / trust panel.
  const [historyOpen, setHistoryOpen] = useState(false)
  // Restore is NOT reachable through the normal "note loaded" effects below
  // (both are gated on `[note?.id]` only -- a restore keeps the same note
  // id, so they never re-fire). This mirrors exactly what those effects
  // already do on note-open, so a restore behaves identically to "reopening
  // the note with fresh content": pushes the restored body into the live
  // editor, resyncs the title/subtitle inputs, and -- critically -- advances
  // `lastSavedRef` so the very next autosave tick sees nothing changed
  // (the server already has this content) instead of racing a stale
  // baseUpdatedAt into a spurious 409, or re-PUTting content that's already
  // saved.
  //
  // ⭐ Wave 7 whole-branch fix, ruling D-G5: this is THE path by which the open
  // editor adopts a server copy of the same note, so it is named for that --
  // a version restore and the clean editor's re-read on return (below, beside
  // the Delete gate) both go through it, never through a second copy.
  const adoptServerCopy = (restoredNote) => {
    if (!restoredNote) return
    const t = restoredNote.title || ''
    const s = restoredNote.subtitle || ''
    setTitle(t)
    titleRef.current = t
    setSubtitle(s)
    subtitleRef.current = s
    lastSavedRef.current = {
      title: t, subtitle: s,
      bodyJson: restoredNote.bodyJson,
      updatedAt: restoredNote.updatedAt || null,
    }
    try {
      // S1: a restored body this bundle cannot read LOCKS the editor rather than blanking it.
      // B1: a restored version is the SERVER's copy — once it is on screen the editor
      // holds its own read again, whatever it carried before.
      if (replaceDocument(editorRef.current, restoredNote.bodyJson || { type: 'doc', content: [] }, EMIT_NOTHING)) {
        carriedRef.current = OWN_READ
      }
    } catch {
      /* editor view not mounted yet -- next note-open effect will still show it */
    }
  }
  const onVersionRestored = adoptServerCopy

  // ── Export + share (post-v1 round 2) ──────────────────────────────────────
  // Wave 8 seam S8-3: the export buttons (PNG / Print / Markdown) and the share
  // controls moved into NoteExportControls and NoteShareControls, behaviour
  // unchanged. The editor keeps the column they rasterize and the message line
  // they speak through.
  const columnRef = useRef(null)
  const [chromeMsg, setChromeMsg] = useState(null)
  // Widget palette (point-and-click inserts) — toggled from the toolbar row.
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Wave 5: the text colour + highlight picker, toggled from the toolbar row.
  const [colorOpen, setColorOpen] = useState(false)
  const colorToggleRef = useRef(null)
  const colorMenuId = useId()
  // Wave 5: the note outline panel / sheet, toggled from the toolbar row.
  const [outlineOpen, setOutlineOpen] = useState(false)
  const outlineToggleRef = useRef(null)
  // The sticky chrome's MEASURED height, published as --uct-chrome-h on the
  // page root: the watch rails' sticky offset reads it (a literal there goes
  // stale the moment the header wraps — review finding).
  const chromeRef = useRef(null)
  const pageRef = useRef(null)
  // Wave 13 lane 13Q-3 (click-budget fix): a second skip link, landing BEFORE the header so a
  // keyboard member reaches the Ask toggle, Export (inside More note actions) and Insert
  // widget -- all of which sit in the sticky chrome, ABOVE the title -- without first tabbing
  // through the shared app nav AND past where "Skip to note" already lands (the note's title,
  // itself further down than this chrome). Visually hidden until it takes focus, same pattern
  // as NotebookTab.jsx's own skip link and `paneHeading`.
  const toolbarSkipRef = useRef(null)
  const skipToToolbar = (e) => {
    e.preventDefault()
    toolbarSkipRef.current?.focus()
  }
  // Wave 8 (8A, A4): focus has somewhere to land -- the note on an explicit
  // open, the Ask toggle when Ask closes (see `askRowRef` below).
  // ⛔⛔ Final-review fix I-1: an EXISTING note's open lands on the note's
  // heading (`landmarkRef`, tabIndex -1), NEVER in the title input. With a live
  // caret in the title, a reader's Space typed into the title and autosave wrote
  // it, and a phone raised its keyboard over the note on every open. A heading
  // takes no text: Space scrolls, and the screen reader says the note's name.
  // Only a note the member just MADE focuses its title -- and 13Q-2: only when
  // it is NOT blank. A bare "+ New note" has nothing in the title worth a
  // look first, so `openFocus === 'body'` (NotebookTab's `blank` computation)
  // places the caret straight into the body instead -- handled in a SEPARATE
  // effect below (near `editorRef.current = editor`), because the title/
  // landmark refs below are DOM nodes ready on the first render `openFocus`
  // is set, while the editor is an ASYNC TipTap instance that can still be
  // `null` on that same render; sharing one effect/dependency array for both
  // would bail out while `editorRef.current` is still null and then never
  // retry, since nothing in THIS effect's deps changes once `editor` finally
  // resolves. `openFocusDoneRef` is the ONE claim both effects honour, so
  // whichever of the two branches applies still fires exactly once.
  const titleInputRef = useRef(null)
  const tickerInputRef = useRef(null)
  const landmarkRef = useRef(null)
  const openFocusDoneRef = useRef(false)
  const askRowRef = useRef(null)
  useEffect(() => {
    if (!openFocus || openFocus === 'body' || openFocus === 'collapsed' || openFocusDoneRef.current) return
    // Lane KEYS3 (Q2): 'ticker' is a fresh note from a template that asks for one. A note
    // with no Ticker field on screen falls back to the title, as before.
    const target = openFocus === 'ticker' ? (tickerInputRef.current || titleInputRef.current)
      : openFocus === 'title' ? titleInputRef.current : landmarkRef.current
    if (!target) return
    openFocusDoneRef.current = true
    target.focus({ preventScroll: true })
    onOpenFocused?.()
  }, [openFocus, isLoading, note, onOpenFocused])
  // Lane KEYS3 (Q18): 'collapsed' is a review the Notebook just drafted. Its findings are
  // collapsed blocks, and the first of them sat 18 to 24 Tab stops below the top of the note
  // (the header, the title area, two charts). Focus goes to that block's arrow, so Enter opens
  // it. The body is built a moment after the note loads, so it is looked for across frames;
  // a note with no collapsed block gets the landmark, as any existing note does.
  useEffect(() => {
    if (openFocus !== 'collapsed' || openFocusDoneRef.current) return undefined
    let raf = 0
    let frames = 0
    const done = (el, opts) => {
      openFocusDoneRef.current = true
      el?.focus(opts)
      onOpenFocused?.()
    }
    const look = () => {
      const arrow = pageRef.current?.querySelector(
        '.ProseMirror [data-type="toggle"][data-open="false"] button.uctToggleChevron')
      if (arrow) { done(arrow); return }
      frames += 1
      if (frames > COLLAPSED_FOCUS_FRAMES) { done(landmarkRef.current, { preventScroll: true }); return }
      raf = requestAnimationFrame(look)
    }
    raf = requestAnimationFrame(look)
    return () => cancelAnimationFrame(raf)
  }, [openFocus, isLoading, note, onOpenFocused])
  /** Ask's panel lives in AskPanel; its toggle is the button that opened it.
   *  Closing the panel unmounts what held focus, so focus goes back there.
   *  M-6: found by the hook AskPanel puts on its own toggle, never by its
   *  label -- a wording change must not silently break the way back. */
  const focusAskToggle = () => {
    askRowRef.current?.querySelector('[data-ask-toggle]')?.focus()
  }
  useEffect(() => {
    const chrome = chromeRef.current
    const page = pageRef.current
    if (!chrome || !page || typeof ResizeObserver === 'undefined') return undefined
    const set = () => page.style.setProperty('--uct-chrome-h', `${chrome.offsetHeight}px`)
    const ro = new ResizeObserver(set)
    ro.observe(chrome)
    set()
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (!chromeMsg) return undefined
    const t = setTimeout(() => setChromeMsg(null), 2400)
    return () => clearTimeout(t)
  }, [chromeMsg])
  const saveTimerRef = useRef(null)
  const retryTimerRef = useRef(null)
  const retryAttemptsRef = useRef(0)
  const fileInputRef = useRef(null)
  const attachFileInputRef = useRef(null)
  // Wave 7 lane G5 (built by H): the touch tier's camera door — its own hidden
  // input (`capture="environment"`), handed to the SAME image-upload path.
  const scanInputRef = useRef(null)
  // Wave 7 lane H1: the toolbar mic's `{ start(), available }` handle. The
  // slash menu's "Dictate" item starts THIS editor's mic through it.
  const micRef = useRef(null)
  const lastSavedRef = useRef({ title: '', subtitle: '', bodyJson: null, updatedAt: null })
  // One reconcile-and-retry per conflict burst (A15 compare-and-set): a 409
  // means a server-side write (Send-to-Journal append, second tab) landed
  // after our baseline. We merge the missing embeds in and retry ONCE — a
  // second consecutive 409 surfaces as a save error instead of looping.
  const conflictRetriedRef = useRef(false)
  // Inbox rows placed into the doc this session, consumed only AFTER the
  // save that persists them succeeds — a failed save must leave the capture
  // recoverable in the inbox (panel finding; the tray hides them locally).
  const pendingInboxConsumeRef = useRef(new Set())
  const consumePlacedCaptures = () => {
    const ids = [...pendingInboxConsumeRef.current]
    if (!ids.length) return
    pendingInboxConsumeRef.current.clear()
    Promise.all(ids.map((id) =>
      fetch(`/api/j2/inbox/${id}`, { method: 'DELETE', credentials: 'include' }).catch(() => {}),
    )).then(() => globalMutate('/api/j2/inbox')).catch(() => {})
  }
  // Latest-callback refs. TipTap's useEditor freezes the `onUpdate` closure
  // at editor-creation time and React's setTimeout fires whichever closure
  // was scheduled — both routes capture stale `title`/`subtitle`. Reading
  // through these refs guarantees every save runs with the latest values
  // (the refs are updated after every render below).
  const scheduleAutosaveRef = useRef(() => {})
  const commitSaveRef = useRef(async () => {})

  // Local mirrors for fields the user edits inline.
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  // Wave 0 (P1-10): mirrored synchronously in the onChange handlers below
  // (never via a `useEffect` on `title`/`subtitle`) so the local-draft write
  // always sees the value from THIS event, not a stale one from before
  // React's setState batching commits — the same staleness `scheduleAutosave`
  // solves for the network path via the ref-reassignment pattern, one layer
  // earlier (a draft written from stale state would recover the SECOND-to-
  // last keystroke, not the last one).
  const titleRef = useRef('')
  const subtitleRef = useRef('')
  // A locally-drafted, never-successfully-saved version of THIS note,
  // detected on load — offered via the banner below, never auto-applied
  // (silently preferring a local draft over the server's copy could just as
  // easily clobber real, already-synced work from another tab/device).
  const [pendingDraft, setPendingDraft] = useState(null)
  // The reasoning behind `pendingDraft` — which copy won, and whether the two
  // local copies could be ordered at all. ⛔ An ambiguous answer is SAID so,
  // not smoothed over: the member is the only one who can settle it.
  const [recovery, setRecovery] = useState(null)
  // D3 / F5P-1: words the member QUEUED for this note while away, handed back by
  // `recover()` as `adopt`. Held here until the editor can take them (see the
  // effect after the hydration gate).
  const [pendingAdoption, setPendingAdoption] = useState(null)
  // ⛔ S2 (fix round 1): queued words are adopted SILENTLY only while nothing of
  // the member's own is in play — no edit since this note hydrated, and no save
  // pending or on the wire. Otherwise they are OFFERED (the banner) and both
  // copies survive. Refs, because the adoption decision must read the value at
  // the instant it runs, not the one a render captured.
  const editedSinceHydrationRef = useRef(false)
  const saveInFlightRef = useRef(false)
  const saveSettledWaitersRef = useRef([])
  // Re-runs the adoption effect when an in-flight save settles (a Restore waits
  // for it rather than racing it).
  const [adoptionTick, setAdoptionTick] = useState(0)
  // G-064 fix round 1 (F2, controller ruling) — WHICH note the decision is
  // for, not a bare boolean. DEFENSE IN DEPTH: production mounts this page as
  // `<NoteEditorPage key={noteId}>` (tabs/NotebookTab.jsx:715), so each note
  // gets a FRESH instance and this state starts null. The per-note value
  // matters only if this instance is ever reused across notes: on the first
  // render after `noteId` changed, the state would not yet be reset (that
  // happens in an effect, one render later), so a plain `recoveryDecided`
  // boolean would stay stale-true across the switch and gate nothing.
  // `recoveryDecidedFor` is compared against the CURRENT `noteId` at every
  // read, so a decision made for another note can never authorize an insert
  // into this one.
  const [recoveryDecidedFor, setRecoveryDecidedFor] = useState(null)
  // Re-entrancy guard for restoreDraft (see its own comment) — a plain ref,
  // not state, since it must be checked synchronously before any render.
  const restoringDraftRef = useRef(false)
  // ⛔⛔ NOTHING MAY BE PERSISTED BEFORE THE NOTE IS IN THE EDITOR.
  //
  // TipTap's `onUpdate` is NOT "the member typed" — it is "the document
  // changed", and a document changes without a member the moment an editor is
  // constructed with an EMPTY doc: `{type:'doc',content:[]}` violates the
  // schema's `block+`, so ProseMirror appends a repair transaction that inserts
  // an empty paragraph, synchronously, inside `new Editor(...)`. Measured, both
  // directions: an editor built with real content emits ZERO updates; one built
  // empty emits exactly one, and `getJSON()` is then `{doc,[paragraph]}`.
  //
  // `useEditor` is keyed on `[note?.id]`, so the editor is REBUILT when the note
  // arrives — and rebuilt EMPTY whenever the server's copy of that note is empty
  // (the server sends `{doc,content:[]}`, not null, for a blank body). That
  // rebuild happens in `useEditor`'s own effect, which is registered BEFORE the
  // effect below and therefore runs BEFORE it — so the repair fires while the
  // title/subtitle refs still hold their pre-load values, and the autosave path
  // ran with them. Reproduced end to end in `NoteEditorPage.slowload.test.jsx`:
  // an empty title, an empty subtitle and an empty document written to the
  // localStorage draft, the durable working copy AND the outbox, for a note the
  // member never touched.
  //
  // ⛔ This is a GATE, not a nicety: it is the one place that can distinguish
  // "the document changed because a person changed it" from "the document
  // changed because it was constructed". It also closes the long-standing
  // empty-localStorage-draft bug this predates Wave Q1.
  const hydratedRef = useRef(false)

  // ⛔⛔ B1 — WHO WROTE THE BODY THIS EDITOR HOLDS.
  //
  // `OWN_READ` while the editor holds its own read of the server copy (a load,
  // a reconcile's view swap, a version restore). `{ writtenSchema }` from the
  // moment it takes words RECOVERED from a capture another page load wrote — D3
  // adoption, a Restore — until a save of them LANDS (the server accepted them
  // at their writer's level) or the view is swapped back to a server copy.
  //
  // ⚰️ THE HOLE THIS CLOSES (wave 5 final review, B1): a production tab opened a
  // wave-5 note as empty and queued the empty stand-in; this bundle recovered it
  // and saved it declaring ITS OWN level, and the server let it through. Every
  // capture this editor makes (`captureLocalState`: the draft, the durable copy,
  // the queue) and every body it sends is stamped `bodyWrittenSchema(schema,
  // carried)`, so an older writer's words keep that writer's level through every
  // later keystroke — a reload mid-save cannot relabel them either.
  // An object, not a number: a save compares IDENTITY to learn whether the words
  // it sent are still the ones on screen.
  const carriedRef = useRef(OWN_READ)
  const editorWrittenSchema = () => bodyWrittenSchema(
    editorRef.current?.schema,
    carriedRef.current === OWN_READ ? OWN_READ : carriedRef.current.writtenSchema,
  )
  /** The editor now holds recovered words written at `stamp` (absent ⇒ 0). */
  const carryRecovered = (stamp) => { carriedRef.current = { writtenSchema: writtenSchemaOf(stamp) } }
  // Two saves refused together (a keystroke while the first was on the wire)
  // share ONE `(conflicted copy)` — see `keepRefusedWords`. `preservedRef` holds
  // every carried body a fork has already copied into a sibling.
  const refusalForkRef = useRef(null)
  const preservedRef = useRef(new WeakSet())

  useEffect(() => {
    if (!note) return undefined
    setRecoveryDecidedFor(null)
    setTitle(note.title || '')
    titleRef.current = note.title || ''
    setSubtitle(note.subtitle || '')
    subtitleRef.current = note.subtitle || ''
    lastSavedRef.current = {
      title: note.title || '',
      subtitle: note.subtitle || '',
      bodyJson: note.bodyJson,
      updatedAt: note.updatedAt || null,
    }
    editedSinceHydrationRef.current = false
    // B1: a note just loaded is this editor's own read of the server copy.
    carriedRef.current = OWN_READ

    // Wave 0 (P1-10) offered a draft this note's own last session never
    // successfully saved. Wave Q1 makes that a THREE-way decision — the
    // server, the durable working copy, and the synchronous draft — owned by
    // `chooseLocalRecovery`.
    //
    // ⛔ IT IS NOT "PREFER THE OFFLINE STORE". Within a session the draft is
    // written synchronously on the keystroke and the durable copy lags it by
    // the coalescing window, so reaching for IndexedDB because it is the
    // offline store would silently regress the member's last ~200ms of typing.
    // ⛔ And it is still OFFERED, never applied: silently preferring a local
    // copy can clobber real work another device already synced.
    let cancelled = false
    const decide = async () => {
      let raw = null
      let lsDraft = null
      try {
        raw = localStorage.getItem(DRAFT_KEY(note.id))
        lsDraft = raw ? JSON.parse(raw) : null
      } catch { lsDraft = null }
      let decision
      try {
        decision = await durableRef.current.recover({ server: note, lsDraft })
      } catch {
        // A store we cannot read is not a reason to lose the draft we can.
        decision = null
      }
      if (cancelled) return
      // ⭐⭐ D3 / F5P-1 — QUEUED WORDS ARE SENT BY THIS NOTE'S OWNER, NOT OFFERED.
      // The sweep will not send them while this editor owns the note
      // (`excludeNoteId`), so a banner here meant nobody sent them for as long
      // as the member sat on the note. `adopt` is non-null only for provably
      // queued work (see `queuedWorkToAdopt`); everything else still gets the
      // banner below, unchanged.
      if (decision?.adopt) {
        setPendingDraft(null)
        setRecovery(null)
        // `auto`: the effect below adopts silently ONLY if the member has not
        // started on this note meanwhile (S2); otherwise it offers the banner,
        // built from this same decision.
        setPendingAdoption({ ...decision.adopt, auto: true, decision, savedAt: lsDraft?.savedAt ?? null })
        return
      }
      if (decision && decision.unsynced) {
        setPendingDraft({ ...decision.state, savedAt: lsDraft?.savedAt ?? null })
        setRecovery(decision)
        setRecoveryDecidedFor(note.id)
        return
      }
      // Nothing local differs from the server: it saved fine (or was never
      // touched) and surfacing it is pure noise.
      if (raw) { try { localStorage.removeItem(DRAFT_KEY(note.id)) } catch { /* private mode */ } }
      setPendingDraft(null)
      setRecovery(null)
      setRecoveryDecidedFor(note.id)
    }
    decide()
    return () => { cancelled = true }
  }, [note?.id])

  // Wave 10 (lane TY2, standard 4 -- typing budget): the memoized serializer
  // behind `bodyJson` below. ONE instance for the component's whole
  // lifetime, never reset on note switch -- a WeakMap keyed on node OBJECTS
  // needs no reset: a previous note's nodes simply stop being referenced and
  // become ordinary garbage the moment the editor holding them is rebuilt.
  // See `lib/memoDocJSON.js`'s header for why this is safe to cache and
  // `memoDocJSON.test.js` for the byte-identical-output proof.
  const draftJSONRef = useRef(null)
  if (!draftJSONRef.current) draftJSONRef.current = createMemoDocJSON()

  // Wave 10 (lane TY5): the memoized `JSON.stringify()` layered over
  // `draftJSONRef` above -- same convention, same lifetime (one instance for
  // the component's whole lifetime, a WeakMap keyed on the JSON objects
  // `draftJSONRef` already reuses by reference for an untouched subtree).
  // See `lib/memoStringifyBody.js`'s header for why this is safe to cache
  // and `memoStringifyBody.test.js` for the byte-identical-output proof.
  const draftStringifyRef = useRef(null)
  if (!draftStringifyRef.current) draftStringifyRef.current = createMemoStringify()

  // Wave Q1: ONE snapshot per keystroke, shared by both local layers.
  // ⛔ Taken once on purpose: `getJSON()` walks the whole document, and the
  // draft and the durable copy must describe the SAME instant — two reads
  // could differ by a keystroke, which is exactly the disagreement the reopen
  // comparison would then have to resolve without being able to.
  //
  // ⭐ Wave 10 (lane TY2): `bodyJson` is built through `draftJSONRef`, a
  // memoized drop-in for `editor.getJSON()` (same output, byte for byte —
  // `memoDocJSON.test.js`), rather than `editorRef.current.getJSON()`
  // directly. ProseMirror nodes are immutable and structurally shared, so a
  // keystroke that changes one paragraph of a 2,000-paragraph note leaves
  // every OTHER paragraph's node object exactly as it was; the memoized
  // serializer reuses each unchanged paragraph's already-computed JSON
  // instead of re-walking it, which is where this path's cost scaled with
  // document size (perf-budgets.md, "Typing (clause 4d)"). This changes ONLY
  // how fast the snapshot is produced, never what it contains or how often
  // it is taken -- every keystroke still gets a complete, correct,
  // synchronous snapshot, exactly as the Wave Q1 durability design requires.
  const captureLocalState = () => {
    // ⛔ S1/H14: a locked (unreadable) note has no local state worth keeping —
    // the editor holds an EMPTY stand-in, and every layer this feeds (the draft,
    // the durable copy, the outbox, a metadata settle) would carry it.
    if (!noteId || !editorRef.current || isUnreadable(editorRef.current)) return null
    return {
      title: titleRef.current,
      subtitle: subtitleRef.current,
      bodyJson: draftJSONRef.current(editorRef.current.state.doc),
      baseUpdatedAt: lastSavedRef.current.updatedAt || null,
      // ⛔⛔ WHAT THE SERVER LAST HELD, travelling WITH the member's words.
      // The drain cannot classify a conflict without it — diffing the server's
      // copy against the member's working copy would read the member's own
      // unsent edit as somebody else's change and fork every single time. This
      // is the only moment on this device when both are in hand.
      serverBase: { ...lastSavedRef.current },
      // ⛔⛔ B1: the level of whoever WROTE this body — this editor's own, or
      // the recovered words' writer's while it holds them (`carriedRef`). The
      // draft, the durable copy and the queue all carry it, so a later page
      // load sends these words at that level and never at its own.
      writtenSchema: editorWrittenSchema(),
    }
  }
  const saveDraftLocally = (state) => {
    const snap = state || captureLocalState()
    if (!snap) return
    try {
      // Wave 10 (lane TY5): `bodyJson` is stringified through
      // `draftStringifyRef` rather than letting the outer `JSON.stringify`
      // below re-walk it -- an untouched paragraph's JSON object is the SAME
      // object `draftJSONRef` handed back last keystroke, and the memoized
      // stringify reuses its already-computed STRING the same way. This is
      // where this path's cost scaled with document size (perf-budgets.md,
      // `docs/notebook/perf-runs/ty5/`): `saveDraftLocally` alone, not the
      // localStorage write itself, which still writes the same bytes every
      // keystroke as the Wave Q1 "ONE snapshot per keystroke" guarantee
      // requires. `stringifyDraftPayload` then reconstructs the REST of this
      // object's JSON form by hand (see memoStringifyBody.js for why that is
      // safe) with the memoized body spliced in, never re-walked.
      const bodyJsonStr = draftStringifyRef.current(snap.bodyJson)
      localStorage.setItem(DRAFT_KEY(noteId), stringifyDraftPayload({
        title: snap.title, subtitle: snap.subtitle,
        bodyJsonStr, savedAt: Date.now(),
        // Wave Q1: which tab-session wrote it. On reopen that separates "the
        // durable copy from THIS session" (where the draft is written first and
        // can only be equal-or-newer — an exact structural answer) from one
        // left by a previous session (where only timestamps remain, and they
        // are a hint).
        // ⛔ Deliberately NO generation: that number is minted by the durable
        // writer, and taking it here would mean scheduling the durable write
        // BEFORE this synchronous line — reversing the one ordering that owns
        // the crash window.
        sessionId: SESSION_ID,
        // ⭐⭐ D3b (wave 6): THE REVISION THESE WORDS WERE TYPED ON. Without it a
        // crash draft that won recovery had no base, `chooseLocalRecovery` gave it
        // the server's CURRENT revision, and Restore PUT it over another device's
        // words. With it, Restore sends on this revision (`baseOfRecovered`), a
        // server that moved 409s, and the reconcile forks — never a clobber. A
        // draft written before this line has none, and keeps its old path.
        baseUpdatedAt: usableBaseline(snap.baseUpdatedAt),
        // B1: a Restore of this draft on a later load sends it at this level.
        writtenSchema: snap.writtenSchema,
      }))
    } catch { /* private mode / storage full — the network autosave is still the primary path */ }
  }
  const clearDraftLocally = () => {
    try { localStorage.removeItem(DRAFT_KEY(noteId)) } catch { /* private mode */ }
  }

  const restoreDraft = async () => {
    // Re-entrancy guard: found via real browser E2E that a single click can
    // fire this handler twice in quick succession (both invocations reading
    // the SAME still-non-null `pendingDraft` before React commits the first
    // call's `setPendingDraft(null)`) — two concurrent PUTs to the same note
    // racing over the network, with the loser's stale patch sometimes
    // landing last. A restore is a deliberate, one-shot action; the second
    // invocation is never useful, so it's dropped outright rather than
    // trusting click de-duplication anywhere upstream.
    if (restoringDraftRef.current) return
    if (!pendingDraft || !editorRef.current) return
    // ⭐⭐ D3 — A RECOVERED COPY WHOSE BASE IS KNOWN IS RESTORED THE WAY QUEUED WORK
    // IS ADOPTED: on the copy it was written on, through our own save.
    // ⚰️ MEASURED 2026-09-23: the direct PUT below 409'd against a server another
    // device had moved, and left this editor on the SERVER'S CURRENT revision, so
    // the member's next keystroke autosaved over the other device's words — 0
    // forks. (After an append door, the captured block went the same way.)
    // `recovery.base` comes from `baseOfRecovered`; with it, a moved server 409s
    // into `reconcileConflict` like any other save. Without it (a crash draft
    // whose base was never recorded) the path below is unchanged.
    if (recovery?.base) {
      const decision = recovery
      const savedAt = pendingDraft.savedAt ?? null
      setPendingDraft(null)
      setRecovery(null)
      setPendingAdoption({
        state: {
          title: pendingDraft.title || '', subtitle: pendingDraft.subtitle || '',
          bodyJson: pendingDraft.bodyJson,
        },
        base: recovery.base,
        // The member chose these words: no banner fallback for an edit, but a
        // save already on the wire is still waited for (S2 case B).
        auto: false,
        decision,
        savedAt,
        // ⛔ B1: and they are sent at THEIR writer's level (absent ⇒ 0).
        writtenSchema: recovery.writtenSchema,
      })
      return
    }
    restoringDraftRef.current = true
    const draftTitle = pendingDraft.title || ''
    const draftSubtitle = pendingDraft.subtitle || ''
    const draftBodyJson = pendingDraft.bodyJson
    setTitle(draftTitle)
    titleRef.current = draftTitle
    setSubtitle(draftSubtitle)
    subtitleRef.current = draftSubtitle
    // ⛔ `EMIT_NOTHING`, never a bare `false` — see its declaration. Until this
    // was fixed, this line ALSO re-armed the 800ms debounce and the durable
    // write, which is precisely what the comment below says a restore
    // deliberately does not do.
    if (draftBodyJson && !replaceDocument(editorRef.current, draftBodyJson, EMIT_NOTHING)) {
      restoringDraftRef.current = false      // S1: unreadable here -- locked, nothing sent
      return
    }
    // ⛔⛔ B1: the editor now holds words a recovered copy's WRITER produced. They
    // are sent — now, and by every keystroke after — at that writer's level
    // (absent ⇒ 0), until a save of them lands or the view returns to the server's.
    if (draftBodyJson) carryRecovered(recovery?.writtenSchema)
    const carriedAtSend = carriedRef.current
    setPendingDraft(null)
    setRecovery(null)

    // Persist directly and immediately, from the local `draft*` values
    // captured above — NOT via the debounced scheduleAutosave path (a
    // setTimeout deref'd 800ms later through whichever render's `commitSave`
    // closure happens to be current then). A restore is a rare, deliberate
    // action, not a per-keystroke autosave — it doesn't need debouncing, and
    // going straight to the network keeps this one-shot action off that
    // shared, timing-sensitive machinery entirely.
    setSaveStatus('saving')
    saveInFlightRef.current = true
    try {
      const patch = { title: draftTitle, subtitle: draftSubtitle || null }
      if (draftBodyJson) patch.bodyJson = draftBodyJson
      // ⛔ The baseline is the revision this local work was WRITTEN ON, not
      // whatever the server holds now. They differ exactly when another device
      // saved in between — and that is the case where a restore must 409 and
      // fork rather than quietly overwrite the newer copy.
      const base = usableBaseline(recovery?.baseUpdatedAt, lastSavedRef.current.updatedAt)
      if (base) patch.baseUpdatedAt = base
      const saved = await update(patch, { writtenSchema: editorWrittenSchema() })
      // B1: the server accepted these words at their writer's level — they are
      // the server's copy now, and what the member types next is this editor's.
      if (carriedRef.current === carriedAtSend) carriedRef.current = OWN_READ
      lastSavedRef.current = {
        title: draftTitle, subtitle: draftSubtitle,
        bodyJson: draftBodyJson || lastSavedRef.current.bodyJson,
        updatedAt: usableBaseline(saved?.updatedAt, lastSavedRef.current.updatedAt),
      }
      const ackedNow = { title: draftTitle, subtitle: draftSubtitle, bodyJson: draftBodyJson }
      const currentNow = captureLocalState() || ackedNow
      durableRef.current.markSynced({
        acked: ackedNow, current: currentNow, updatedAt: lastSavedRef.current.updatedAt,
      })
      // ⛔⛔ AND AGAIN, WITHOUT THE MOUNT. `markSynced` goes through the hook's
      // writer ref and does nothing once this component is gone — and this
      // promise resolves after the member has navigated away often enough to
      // matter (~1 offline session in 5, measured 2026-09-10). Navigating away
      // is exactly when the note leaves `excludeNoteId` and becomes the sweep's,
      // so the queue's most important moment was the one it could not settle,
      // and a single-device member got a `(conflicted copy)` of their own note.
      // ⛔ Not awaited: a save must not wait on bookkeeping, and this never
      // throws. It is idempotent with `markSynced` — both settle to the same
      // landed baseline.
      settleLandedSave({
        accountId: user?.id, noteId,
        acked: ackedNow, current: currentNow,
        updatedAt: lastSavedRef.current.updatedAt,
      })
      setSaveStatus('saved')
      setSaveErrorMsg('')
      clearDraftLocally()
    } catch (e) {
      // ⛔⛔ B1: refused because the copy's writer could not read this note.
      // Same resolution as a refused save — preserve both, show the server's.
      if (isSchemaRefusal(e) && await keepRefusedWords(carriedAtSend)) return
      setSaveStatus('error')
      setSaveErrorMsg(friendlySaveError(e, e?.status))
      reportSaveFailed(e, false)
    } finally {
      restoringDraftRef.current = false
      saveSettled()
    }
  }

  /**
   * ⛔⛔ B1 — THE SERVER REFUSED WORDS THIS EDITOR SENT AT THEIR WRITER'S LEVEL.
   *
   * The same words from the same writer are refused again, so a retry is the one
   * thing that cannot help — and "Reload to edit it." is the sentence that sent
   * the member here. So preserve BOTH, the way the outbox resolves the same
   * refusal: the words become a `(conflicted copy)` and the page shows the note
   * as the server holds it (`reconcileConflict`'s fork, with every guard it
   * already carries for words typed during the fork).
   *
   * ⛔ Single-flight. Two saves refused together — a keystroke while the first
   * was on the wire — share ONE copy: the second waits for the first's fork,
   * finds the body it was sending already PRESERVED by it (`preservedRef`), and
   * stops. That copy was built from the editor after the second save left, so
   * it holds the second one's words too; and when the member typed during the
   * fork itself, the fork's own guards keep those words in the durable copy and
   * the queue. ⛔ Only a FORK marks a body preserved — a version restore that
   * moved the view preserved nothing, so a refusal after it still keeps a copy.
   *
   * @returns true when the refusal was resolved here (the caller must not show
   *          it as an error), false when keeping a copy failed — the words then
   *          stay in the durable copy and the queue, and the caller reports it.
   */
  const keepRefusedWords = async (carriedAtSend) => {
    if (refusalForkRef.current) await refusalForkRef.current.catch(() => {})
    if (carriedAtSend !== OWN_READ && preservedRef.current.has(carriedAtSend)) return true
    // `sent` is null on purpose: a refusal short-circuits to FORK before the
    // plan ever reads it (a refused write is one the server does not hold).
    const fork = reconcileConflict(null, { refused: true })
    refusalForkRef.current = fork
    try {
      await fork
      return true
    } catch (re) {
      console.warn('could not keep the refused words as a copy', re)
      return false
    } finally {
      if (refusalForkRef.current === fork) refusalForkRef.current = null
    }
  }
  /** A save left the wire (either way): wake whatever waited on it. */
  function saveSettled() {
    saveInFlightRef.current = false
    const waiting = saveSettledWaitersRef.current.splice(0)
    waiting.forEach((wake) => { try { wake() } catch { /* a waiter is not the save */ } })
  }
  const discardDraft = () => {
    clearDraftLocally()
    // ⛔ And the durable copy has to hear about it too. Clearing only the
    // localStorage draft would leave a dirty working copy and a queued sync
    // intent behind, and the next reconnect would push work the member just
    // declined. This states the truth instead: what is on this device now is
    // what the server has.
    const server = {
      title: note?.title || '',
      subtitle: note?.subtitle || '',
      bodyJson: note?.bodyJson ?? null,
    }
    durableRef.current.markSynced({ acked: server, current: server, updatedAt: note?.updatedAt || null })
    setPendingDraft(null)
    setRecovery(null)
  }

  const scheduleAutosave = () => {
    // ⛔ See `hydratedRef`. Before the note is in the editor there is nothing of
    // the member's to save, and everything to lose — so this refuses BEFORE it
    // touches the status, the draft, the durable copy or the save timer.
    if (!hydratedRef.current) return
    // S2: the member has started on this note — queued words are offered from
    // now on, never silently put over what they are doing.
    editedSinceHydrationRef.current = true
    setSaveStatus('dirty')
    setSaveErrorMsg('')
    // Wave 0 (P1-10): mirror to localStorage on EVERY edit, synchronously —
    // not on the 800ms debounce below. A tab closed mid-keystroke (before
    // the debounce ever fires) must still have a local copy of what was
    // just typed; gating this on the same timer would leave exactly that
    // window unprotected, which is the gap this safety net exists to close.
    const snapshot = captureLocalState()
    saveDraftLocally(snapshot)
    // Wave Q1: then — and only then — hand the SAME snapshot to the durable
    // working copy, which coalesces it into an IndexedDB write ~200ms behind
    // the last keystroke. ⛔ Second, never first: localStorage is the
    // synchronous layer that owns the crash window, and IndexedDB's measured
    // p95 (800.7ms in Chrome 152) is as long as the whole server autosave
    // debounce. It is also NOT the network — a durable local write is not a
    // save, and nothing here tells the member otherwise.
    if (snapshot) durableRef.current.schedule(snapshot)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    // Fresh user edit supersedes any in-flight retry — reset the backoff
    // counter so we don't waste a 30s wait on content the user just changed.
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    retryAttemptsRef.current = 0
    conflictRetriedRef.current = false // fresh edit = fresh conflict budget
    saveTimerRef.current = setTimeout(() => commitSaveRef.current(), AUTOSAVE_MS)
  }

  // The editor is read through a ref, NOT the `editor` const: handlePaste /
  // handleDrop are captured in editorProps at editor-CREATION time, when the
  // `editor` const is still null — so closing over it directly made paste throw
  // "Cannot read properties of null (reading 'chain')". The ref is always fresh.
  const editorRef = useRef(null)
  // Wave I: a single toast for both image and file-attachment upload
  // failures — an alert() blocks the whole tab for the multi-second span a
  // PDF upload can take, which is a worse experience than the image case
  // this was copied from.
  const [uploadToast, setUploadToast] = useState(null)
  const navigateTo = useNavigate()
  // Wave I: { href, name } of the PDF currently open in the preview Sheet, or
  // null. Wave J extends it with `documentId` (needed to save an excerpt
  // against) and `page`/`emphasizeExcerptId` (click-to-source targeting --
  // the preview may open at an arbitrary document NOT attached to the
  // currently-open note, e.g. from a thesis-evidence row referencing an
  // excerpt captured in a different note).
  const [previewDoc, setPreviewDoc] = useState(null)
  // Wave N §9 — a captured web passage is revisited AS a captured passage,
  // never as a document. See CapturedSourceSheet for what that means.
  const [capturedSource, setCapturedSource] = useState(null)
  const { documents: noteDocuments, error: documentsError, refresh: refreshDocuments } = useNoteDocuments(noteId)
  const { excerpts: noteExcerpts, error: excerptsError, refresh: refreshExcerpts } = useNoteExcerpts(noteId)
  // ⛔ Wave 10 F7 (Part A, 5d): the side reads of an open note, asked here for their ERRORS --
  // the same SWR keys ThesisSection and the fact nodes read, so no request is added. A failed
  // one used to leave its panel empty, which reads as "this note has none".
  const { error: factsError, refresh: refreshFacts } = useNoteFacts(noteId)
  const { error: candidatesError, refresh: refreshCandidates } = useEvidenceCandidates(noteId)
  const { error: thesisError, refresh: refreshThesis } = useThesisSummary(noteId)

  // Wave J: opens the preview Sheet for a document_excerpt evidence row in
  // ThesisSection -- the excerpt may belong to a DIFFERENT note than the
  // one open here, so it's resolved via GET /excerpts/{id} (carries the
  // source document's attachmentUrl directly, no second lookup) rather
  // than assuming it's among this note's own documents/excerpts.
  // ⛔⛔ WAVE N §9 -- a captured web source carries `web:<sha256>`, an IDENTITY
  // string, not a file, and is revisited as a captured passage, never in a
  // PDF viewer (`excerptRevisitTarget`, the rule Search already obeys).
  // ⭐ The transport now lives in lib/openCitation.js, the ONE path every Ask
  // host shares -- an Ask citation of an excerpt reaches it through
  // `jumpToCitation` below, a thesis evidence row directly. It returns the
  // sentence to show when nothing opened; the evidence row ignores it, as
  // before (that row already says "source no longer available" itself).
  const handleOpenExcerptSource = useCallback((excerptId, { signal } = {}) => openExcerptCitation(excerptId, {
    signal, openDocument: setPreviewDoc, openCapturedSource: setCapturedSource,
  }), [])

  // ⛔⛔ WAVE N §9 -- ONE DOOR FROM "A DOCUMENT OF THIS NOTE" TO A VIEWER.
  // This note's document list holds captured web pages too (their
  // `attachmentUrl` is `web:<sha256>`), and every entry point that holds one of
  // its rows -- the `?doc=&page=` route below (Search, Ask's page route and an
  // old Ask packet, any deep link), an excerpt card's citation, a PDF chip --
  // opens it HERE. A captured page (`sourceKind`, the server's `is_web_capture`
  // answer) opens as a captured passage through the excerpt path, the excerpt
  // `capture_web_source` wrote beside it (`capturePassages`); a page whose
  // saved passage is gone opens nothing -- this note, its honest floor, is
  // already open -- and SAYS so. Everything else is a PDF, opened at its page
  // as before.
  //
  // ⛔ NOTHING IS SILENT HERE EITHER. It returns what the excerpt path returns
  // (null when something opened, else the sentence), or PASSAGE_GONE when the
  // page has no passage left, and it forwards the caller's abort `signal`, so
  // an Ask tap that routes through it keeps last-tap-wins. The Ask route hands
  // the sentence to the panel; the doors outside Ask (the `?doc=` route, an
  // excerpt card, a chip) show it in this page's own Toast (`sayIfNothingOpened`).
  const openNoteDocument = useCallback((doc, { page, excerptId, emphasizeExcerpt, signal } = {}) => {
    if (doc.sourceKind === SOURCE_WEB) {
      const passages = doc.capturePassages || []
      const id = excerptId
        || (page ? passages.find((p) => p.pageNumber === page)?.excerptId : passages[0]?.excerptId)
      return id ? handleOpenExcerptSource(id, { signal }) : PASSAGE_GONE
    }
    setPreviewDoc({
      href: doc.attachmentUrl, name: doc.name, documentId: doc.id,
      page: page || undefined,
      emphasizeExcerptId: excerptId || undefined,
      emphasizeExcerpt: emphasizeExcerpt ?? null,
    })
    return null
  }, [handleOpenExcerptSource])
  // The page's single Toast is mounted at page level, so it outlives the card
  // or chip that asked -- never a message owned by the element that fired it.
  const sayIfNothingOpened = useCallback((outcome) => Promise.resolve(outcome).then((msg) => {
    if (msg) setUploadToast({ message: msg, tone: 'error' })
  }), [])

  // ⭐ WAVE M — SEARCH LANDS ON THE OBJECT IT NAMED. A search hit that reads
  // "NVDA 10-Q · p.47" carries `?doc=&page=` alongside `?note=`, and this opens
  // the SAME `previewDoc` shape Wave J's click-to-source above already uses —
  // one document-navigation contract, reached from either door.
  //
  // ⛔ It waits for `noteDocuments`: the target names a document id, and the
  // preview needs that document's href. Firing before the list resolves would
  // silently drop the deep link and look exactly like "search only opens the
  // note", which is the defect this closes.
  //
  // ⛔ AND IT CLEARS THE PARAMS ONCE CONSUMED, so a refresh, a Back, or simply
  // closing the sheet does not reopen it — the same once-only discipline the
  // mobile share handoff needed.
  const [searchParams, setSearchParams] = useSearchParams()
  const navTarget = targetFromParams(searchParams)
  const navTargetKey = navTarget
    ? `${navTarget.documentId}:${navTarget.page || ''}:${navTarget.excerptId || ''}`
    : null
  const consumedTargetRef = useRef(null)
  useEffect(() => {
    if (!navTarget || !noteDocuments?.length) return
    if (consumedTargetRef.current === navTargetKey) return
    const doc = noteDocuments.find((d) => d.id === navTarget.documentId)
    if (!doc) return
    consumedTargetRef.current = navTargetKey
    const localExcerpt = navTarget.excerptId
      ? noteExcerpts.find((e) => e.id === navTarget.excerptId) || null
      : null
    sayIfNothingOpened(openNoteDocument(doc, {
      page: navTarget.page, excerptId: navTarget.excerptId, emphasizeExcerpt: localExcerpt,
    }))
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const k of ['doc', 'page', 'excerpt']) next.delete(k)
      return next
    }, { replace: true })
  }, [navTargetKey, navTarget, noteDocuments, noteExcerpts, setSearchParams, openNoteDocument,
      sayIfNothingOpened])

  // ── Wave 6 (lane F's services, wired in the editor) ─────────────────────────
  // `?task=<n>` is the Tasks view's "open this note at task n". Read here so the
  // open timer below can say where the note was opened from.
  const taskIndex = taskIndexFromParams(searchParams)
  const taskIndexRef = useRef(taskIndex)
  taskIndexRef.current = taskIndex
  // note_open_ms: from the note being asked for to its editor existing WITH the
  // note in it (stopped in onCreate). One reading per note; the timer is inert
  // after it has spoken.
  const openTimerRef = useRef(null)
  useEffect(() => {
    openTimerRef.current = startNoteOpenTimer()
    return () => { openTimerRef.current = null }
  }, [noteId])
  // save_failed: once when a save gives up, and once when a retry streak BEGINS
  // (never per backoff attempt). No text, no ids: a status and a reason word.
  const reportSaveFailed = (e, retrying) => {
    const status = Number.isFinite(e?.status) ? e.status : 0
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    const reason = !status ? (offline ? 'offline' : 'network')
      : status === 409 ? 'conflict' : status === 413 ? 'too-large' : 'http'
    trackNotebookEvent(NOTEBOOK_EVENTS.SAVE_FAILED, { status, reason, offline, retrying })
  }

  // ⭐ O6 §4: the same routing contract, one param further. A review is NOT a
  // document, so it deliberately does not go through `targetFromParams` /
  // `previewDoc` above — that path opens a viewer, and a viewer handed a
  // review would have nothing to render. The anchor is passed down to the
  // review panel, which owns the only place a review can truthfully be shown.
  const reviewAnchor = reviewTargetFromParams(searchParams)
  // ⭐ Wave 13 lane 13D: a resurfacing insight's door. Dark behind
  // `awareness_note_resurface_enabled` (latched per tab) -- off, the parameter is ignored.
  // Only the editor the `?note=` door opened answers it (a side pane holds another note).
  const resurfaceParam = searchParams.get('resurfaceVersion')
  const routedNote = searchParams.get('note')
  const resurfaceVersionId = resurfaceParam
    && notebookFlag('awareness_note_resurface_enabled') === true
    && (!routedNote || routedNote === noteId) ? resurfaceParam : null
  const clearResurfaceParam = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('resurfaceVersion')
      return next
    }, { replace: true })
  }, [setSearchParams])
  const clearReviewParam = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('review')
      return next
    }, { replace: true })
  }, [setSearchParams])
  const handleImageInsert = async (file) => {
    const ed = editorRef.current
    if (!ed || !file) return
    try {
      const { url } = await uploadInlineImage(noteId, file)
      ed.chain().focus().setImage({ src: url, alt: '' }).run()
    } catch (e) {
      // Wave 7 (G5, the camera "Scan" door): the server's reason is a sentence a
      // member can act on — a phone photo in HEIC is refused with "Only
      // PNG/JPG/GIF/WebP images allowed" — so it is said, through the ONE
      // error-to-copy authority (`friendlySaveError`, mapped on its own line;
      // the attachment path below records why).
      const why = friendlySaveError(e, e?.status)
      const said = /[.!?]$/.test(why) ? why : `${why}.`
      // The network sentences already say the note is unchanged; say it once.
      const tail = /unchanged/i.test(said) ? '' : ' Your note is unchanged.'
      setUploadToast({
        message: `Couldn't upload ${file.name || 'image'} — ${said}${tail}`,
        tone: 'error',
      })
    }
  }
  // Wave 7 lane H1 — dictated words, at the caret, as one undo step
  // (lib/dictationInsert.js). A dictation that cannot land says so: the words
  // were heard and a silent drop would lose them without a trace.
  const insertDictated = useCallback((text) => {
    if (insertDictation(editorRef.current, text)) return
    setUploadToast({
      message: "Couldn't add what you said — this note can't take changes right now.",
      tone: 'error',
    })
  }, [])

  // ── Wave 7 lane H (H2): writing help ──────────────────────────────────────
  // ⛔ DARK behind `notebook_writing_help_enabled` (NOTEBOOK_WRITING_HELP_ENABLED,
  // latched from the auth payload) and paid-only, like the route. Off ⇒ no
  // toolbar entry, no slash item, nothing to click.
  const writingHelpOn = notebookFlag('notebook_writing_help_enabled') === true && isPaid === true
  const writingHelpOnRef = useRef(writingHelpOn)
  writingHelpOnRef.current = writingHelpOn
  // The request captured when the panel OPENS (lib/writingHelp.js), or null.
  const [writingHelp, setWritingHelp] = useState(null)
  const openWritingHelp = useCallback(() => {
    const ed = editorRef.current
    if (!writingHelpOnRef.current || !ed || ed.isDestroyed || !ed.isEditable) return
    const req = captureWritingHelpScope(ed)
    if (!req) return
    // ⛔ D-H7: the caret (or selection) is in an Ask answer. Refused UP FRONT, in the product's
    // own sentence, so no panel opens and none of the member's daily writing-help allowance is
    // spent on a draft that could never be placed. Accept refuses it again (lib/writingHelp.js).
    if (req.insideAnswer) {
      setUploadToast({ message: INSIDE_ANSWER_SENTENCE, tone: 'error' })
      return
    }
    setWritingHelp(req)
  }, [])
  // ── Wave 11 lane 11A: voice notes ─────────────────────────────────────────
  // ⛔ DARK behind `notebook_voice_notes_enabled` and paid-only, like the routes.
  // "Add to this note" is ONE editor transaction at the end of the note (never a
  // server append: that would fork an open or queued copy — G-064's rule); a
  // locked or read-only note refuses it with the standard locked sentence and
  // the dialog keeps the result, so the member can save it as a new note instead.
  const voiceNoteOn = voiceNotesEnabled(isPaid)
  const voiceNoteOnRef = useRef(voiceNoteOn)
  voiceNoteOnRef.current = voiceNoteOn
  const [voiceNoteOpen, setVoiceNoteOpen] = useState(false)
  const openVoiceNote = useCallback(() => {
    const ed = editorRef.current
    if (!voiceNoteOnRef.current || !ed || ed.isDestroyed) return
    if (lockedRef.current || !ed.isEditable) {
      setUploadToast({ message: VOICE_NOTE_LOCKED_SENTENCE, tone: 'error' })
      return
    }
    setVoiceNoteOpen(true)
  }, [])
  const appendVoiceResult = useCallback((result) => {
    const res = appendVoiceNote(editorRef.current, result, { note: lockedRef.current ? { locked: true } : null })
    if (res.ok) setUploadToast({ message: 'Voice note added to this note. Undo takes it back out.', tone: 'success' })
    return res
  }, [])
  const onVoiceNoteSaved = useCallback((created) => {
    if (!created?.id) return
    globalMutate((key) => typeof key === 'string' && key.startsWith('/api/j2/notes'))
    setUploadToast({ message: `Saved as a new note: “${created.title || 'Voice note'}”`, tone: 'success' })
  }, [])
  // ── Wave 11 lane 11D: the trade-plan canvas ───────────────────────────────
  // A canvas note (its body opens with a `tradeCanvas` node) renders the board
  // in place of the text editor; the editor stays mounted, hidden, and is the
  // board's store. ⛔ DARK behind `notebook_trade_canvas_enabled`: off, nothing
  // makes a canvas (no /canvas, no New-note entry, no Plan this trade) and an
  // existing canvas opens READ-ONLY with a sentence saying so -- never hidden.
  const isCanvas = isTradeCanvasDoc(note?.bodyJson)
  const isCanvasRef = useRef(isCanvas)
  isCanvasRef.current = isCanvas
  const canvasOn = tradeCanvasEnabled()
  // Blocks in a canvas note OTHER than the board (a capture appended by a
  // server door, say): shown under the board as ordinary text, never hidden.
  const [canvasExtra, setCanvasExtra] = useState(0)
  // /canvas in a note: make a canvas and link it at the caret.
  const creatingCanvasRef = useRef(false)
  const canvasNoteRef = useRef(null)
  canvasNoteRef.current = note
  const createLinkedCanvas = useCallback(async () => {
    const ed = editorRef.current
    if (!tradeCanvasEnabled() || !ed || ed.isDestroyed || creatingCanvasRef.current) return
    if (lockedRef.current || !ed.isEditable) {
      setUploadToast({ message: 'This note is locked — unlock it in the Notebook first', tone: 'error' })
      return
    }
    creatingCanvasRef.current = true
    try {
      const base = (titleRef.current || '').trim()
      const from = canvasNoteRef.current
      const created = await createTradeCanvasNote({
        title: base ? `${base} — trade plan` : '',
        ticker: from?.ticker || null,
        folderId: from?.folderId || undefined,
      })
      const live = editorRef.current
      if (created?.id && live && !live.isDestroyed && live.isEditable && !lockedRef.current) {
        live.chain().focus().insertContent([
          { type: 'noteLink', attrs: { noteId: created.id } }, { type: 'text', text: ' ' },
        ]).run()
        globalMutate((key) => typeof key === 'string' && key.startsWith('/api/j2/notes'))
        setUploadToast({ message: `Trade plan created and linked: “${created.title}”. Open it from the link.`, tone: 'success' })
      } else if (created?.id) {
        setUploadToast({ message: `Trade plan created: “${created.title}”. This note could not take the link.`, tone: 'error' })
      }
    } catch (e) {
      console.error('[notebook] create trade-plan canvas failed', e)
      setUploadToast({ message: "Couldn't create the trade plan. Nothing was saved.", tone: 'error' })
    } finally {
      creatingCanvasRef.current = false
    }
  }, [])
  // The canvas's "Link from a thesis": open the picked note with the offer.
  const linkCanvasFromNote = useCallback((picked) => {
    if (!picked?.id) return
    navigateTo(`${notePath(picked.id)}&${LINK_CANVAS_PARAM}=${encodeURIComponent(noteId)}`)
  }, [navigateTo, noteId])
  const linkCanvasId = searchParams.get(LINK_CANVAS_PARAM)
  const offerCanvasLink = Boolean(linkCanvasId && linkCanvasId !== noteId && !isCanvas)
  const clearLinkCanvasParam = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete(LINK_CANVAS_PARAM)
      return next
    }, { replace: true })
  }, [setSearchParams])
  const acceptCanvasLink = useCallback(async () => {
    const canvasId = linkCanvasId
    if (!canvasId) return
    if (lockedRef.current) {
      setUploadToast({ message: 'This note is locked — unlock it in the Notebook first', tone: 'error' })
      return
    }
    // ⛔ Walk run 1 (11D): the offer is shown the moment the note opens, while the editor
    // is still adopting the note (not yet editable). A press then was refused with the
    // LOCKED sentence -- false -- and nothing was linked. Wait for the editor (bounded),
    // and say the true thing if it never becomes editable.
    let ed = editorRef.current
    for (let i = 0; i < 25 && (!ed || ed.isDestroyed || !ed.isEditable); i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 200))
      ed = editorRef.current
      if (lockedRef.current) break
    }
    if (!ed || ed.isDestroyed || !ed.isEditable || lockedRef.current) {
      setUploadToast({
        message: lockedRef.current ? 'This note is locked — unlock it in the Notebook first'
          : 'This note is still opening — press Add link again in a moment.',
        tone: 'error',
      })
      return
    }
    const end = ed.state.doc.content.size
    ed.chain().insertContentAt(end, {
      type: 'paragraph', content: [{ type: 'text', text: 'Trade plan: ' }, { type: 'noteLink', attrs: { noteId: canvasId } }],
    }).run()
    clearLinkCanvasParam()
    setUploadToast({ message: 'Linked. The plan now shows this note under “Linked from”. Undo takes the link back out.', tone: 'success' })
  }, [linkCanvasId, clearLinkCanvasParam])

  // Accept — the ONE write: an askInsert block with `action` + `model`, as one
  // undo step. Said either way; a draft that could not land keeps the panel open.
  const acceptWritingHelpDraft = useCallback((draft) => {
    const res = acceptWritingHelp(editorRef.current, draft)
    if (res.ok) {
      setUploadToast({
        message: draft.scope === 'selection' && !res.replaced
          ? 'Your selection changed while Compass wrote, so the draft was added after it. Nothing was replaced.'
          : 'Added from writing help. Undo takes it back out.',
        tone: 'success',
      })
    }
    return res
  }, [])
  // Wave I: the non-image counterpart — the backend endpoint
  // (POST /notes/{id}/attachments) has existed since before this wave; this
  // is its first live-editor caller. Inserts a real AttachmentChip node
  // (already used by every import adapter), never a bare markdown link.
  const handleAttachmentInsert = async (file) => {
    const ed = editorRef.current
    if (!ed || !file) return
    try {
      const { url, name, size } = await uploadNoteAttachment(noteId, file)
      ed.chain().focus().insertContent({
        type: 'attachmentChip', attrs: { href: url, name, size },
      }).run()
      // Wave J, found live in the browser: a PDF uploaded HERE creates its
      // j2_note_documents row server-side, but `useNoteDocuments` was fetched
      // at note-open and never revalidates on its own -- so the brand-new
      // document's id was unresolvable, previewDoc.documentId came back null,
      // and "Save excerpt" on the PDF a member had JUST attached silently did
      // nothing until a full page reload. Refresh the list so the id exists
      // the moment the chip does.
      refreshDocuments()
    } catch (e) {
      // ⚰️ WAVE P POST-CLOSURE — THE SERVER'S REASON WAS BEING THROWN AWAY.
      // `uploadNoteAttachment` already preserves it (`body.detail`), and the
      // server already says something a member can act on: "File is larger
      // than the 25 MB limit…". This catch replaced it with "Couldn't upload",
      // so someone attaching a 30 MB scan could not tell whether to split the
      // file, retry, or report a bug — and with OCR now live, the natural
      // (wrong) guess is that the SCAN failed rather than the upload.
      //
      // ⛔ AND IT GOES THROUGH `friendlySaveError`, NOT THROUGH `e.message`.
      // The first attempt built the sentence from the exception and
      // `rawErrorSurface.test.js` caught it — correctly: a bare "500" or a
      // "Failed to fetch" is not member-facing copy. That mapper already
      // returns the server-authored detail when there is one and a real
      // sentence when there is not, so this reuses the product's ONE
      // error-to-copy authority instead of adding a second.
      // ⛔ The mapping happens FIRST, on its own line. The rail is
      // ancestor-based: `e` anywhere beneath a template literal or a `+` is a
      // violation even when it is only being handed to a function — which is
      // the right conservatism, because "it is only passed to a helper" is
      // exactly what the next unsafe version would also claim.
      const why = friendlySaveError(e, e?.status)
      setUploadToast({
        message: `Couldn't upload ${file.name || 'file'} — ${why}`,
        tone: 'error',
      })
    }
  }

  // Wave I: a PDF AttachmentChip opens the in-context preview Sheet instead
  // of downloading. A CAPTURE-phase React handler on the editor's own
  // wrapper, not TipTap's `handleClickOn` — AttachmentChip.renderHTML()
  // emits a real `download="..."` attribute on the <a> (pre-existing,
  // relied on by every import adapter for the "just download it" case), and
  // a native `<a download>` click is handled by the browser ahead of
  // ProseMirror's own synthetic click routing, so `handleClickOn` never
  // fired. Capture phase + preventDefault() here runs before that native
  // download activates.
  const handleEditorClickCapture = (event) => {
    // Wave J: a documentExcerpt card's citation button (see ExcerptView.jsx)
    // -- click-to-source, the directive's own highest-value exit gate.
    // Reuses this same capture-phase bridge Wave I established for the
    // attachmentChip case, rather than a second click-handling mechanism.
    const citation = event.target.closest?.('button[data-type="documentExcerptCitation"]')
    if (citation) {
      const documentId = citation.getAttribute('data-document-id')
      const page = Number(citation.getAttribute('data-page'))
      const excerptId = citation.getAttribute('data-excerpt-id')
      const doc = noteDocuments.find((d) => d.id === documentId)
      const localExcerpt = noteExcerpts.find((e) => e.id === excerptId)
      if (doc) {
        sayIfNothingOpened(openNoteDocument(doc, { page, excerptId, emphasizeExcerpt: localExcerpt || null }))
      } else if (localExcerpt?.sourceKind === SOURCE_WEB) {
        sayIfNothingOpened(handleOpenExcerptSource(excerptId))
      } else if (localExcerpt?.attachmentUrl) {
        // The excerpt's own document isn't one of THIS note's attachments
        // (an excerpt saved from elsewhere but inserted here) -- the
        // excerpt row itself already carries everything needed.
        setPreviewDoc({
          href: localExcerpt.attachmentUrl, name: localExcerpt.documentName,
          documentId, page, emphasizeExcerptId: excerptId, emphasizeExcerpt: localExcerpt,
        })
      }
      return
    }

    // Wave I: a PDF AttachmentChip opens the in-context preview Sheet instead
    // of downloading. AttachmentChip.renderHTML() emits a real
    // `download="..."` attribute on the <a> (pre-existing, relied on by
    // every import adapter for the "just download it" case), and a native
    // `<a download>` click is handled by the browser ahead of ProseMirror's
    // own synthetic click routing, so `handleClickOn` never fired. Capture
    // phase + preventDefault() here runs before that native download
    // activates.
    const chip = event.target.closest?.('a[data-type="attachmentChip"]')
    if (!chip) return
    const href = chip.getAttribute('href')
    const name = chip.getAttribute('data-name')
    if (!/\.pdf$/i.test(name || '') && !/\.pdf$/i.test(href || '')) return
    event.preventDefault()
    // Wave J: resolve this attachment's documentId (needed to save an
    // excerpt against it) from the note's own already-fetched document
    // list -- the chip's own attrs never carried an id (attachments have
    // none of their own, per Wave I's filesystem-path identity model).
    const doc = noteDocuments.find((d) => d.attachmentUrl === href)
    if (doc?.sourceKind === SOURCE_WEB) { sayIfNothingOpened(openNoteDocument(doc)); return }
    setPreviewDoc({ href, name, documentId: doc?.id || null })
  }

  // Wave J: create the excerpt AND insert its node, in that order -- the
  // combined backend endpoint already does both atomically, so this is
  // just the client-side mirror (insert the returned excerptId) plus the
  // upload-failure toast idiom every other capture path in this file uses.
  /**
   * Land on a cited passage -- or honestly decline to.
   *
   * The panel has already re-read the text at the destination in the LIVE
   * doc (unsaved edits included). A state outside PRECISE_STATES means the
   * passage moved, was duplicated, or is gone.
   *
   * NEVER JUMP TO AN UNVERIFIED POSITION. A failed precise citation is
   * preferable to a confident mis-navigation: landing on the wrong paragraph
   * looks exactly like landing on the right one.
   */
  const jumpToCitation = useCallback((source, resolved, { signal } = {}) => {
    // ⛔ NOTHING HERE IS A SILENT NO-OP. Every branch that does not navigate
    // RETURNS the sentence AskPanel shows inside itself -- the panel is a
    // modal Sheet on touch, and a click that changes nothing reads as broken.
    //
    // ⭐ O6 §4: a cited REVIEW is not a passage in the note body — it lives
    // in the review panel's history, and it may belong to a different note
    // entirely (Ask My Notebook and Ask Security Research both span theses).
    // So it routes through the SAME `?note=` contract Search uses rather than
    // through the editor, and lands on the review itself.
    // ⛔ A citation that cannot name both the note and the review navigates
    // NOWHERE, rather than opening a note and leaving the member to hunt.
    if (source?.navigation?.kind === 'review') {
      const nid = source.navigation.note_id
      const rid = source.navigation.review_id
      if (!nid || !rid) return SOURCE_NOWHERE
      setSearchParams(
        (prev) => applyTargetToParams(prev, { noteId: nid, reviewId: rid, depth: 'review' }),
        { replace: false },
      )
      return null
    }
    // ⚰️ AN EXCERPT CITATION USED TO FALL THROUGH TO THE `kind !== 'note'`
    // GUARD BELOW AND RETURN SILENTLY, while this page already knew how to open
    // an excerpt by id for a thesis evidence row. It now takes that same path.
    if (source?.navigation?.kind === 'excerpt') {
      return handleOpenExcerptSource(source.navigation.excerpt_id, { signal })
    }
    // ⚰️ WAVE P3 §12 — A CITED DOCUMENT PAGE USED TO GO NOWHERE. This handler
    // knew about reviews and about the note body, and returned silently for
    // `kind: 'document'` — so Ask could say "q3-filing.pdf · p.1", the member
    // could click it, and nothing at all would happen. Search has reached the
    // page since Wave M; the Ask citation never learned the same contract.
    // Found by driving the real UI, because every unit rail below asserts the
    // TARGET and none of them clicks the row in the editor.
    //
    // ⛔ THE SAME `?note=&doc=&page=` CONTRACT, never a second route shape —
    // and never an OCR-specific one: a scanned page opens exactly the way a
    // native page does, which is what makes the scanned page authoritative.
    if (source?.navigation?.kind === 'document') {
      // The decision lives in `searchNavigation`, beside the one Search uses,
      // so the two can never answer differently about the same document.
      const openNote = ({ id }) => setSearchParams(
        (prev) => applyTargetToParams(prev, { noteId: id, depth: 'note' }), { replace: false })
      const openPage = (nav) => {
        const here = noteDocuments.find((d) => d.id === nav.document_id)
        // A captured page of THIS note (an old packet has no kind; the list
        // does) goes straight to the door, with the tap's abort signal, and
        // whatever it could not open is said in the panel.
        if (here?.sourceKind === SOURCE_WEB) {
          const page = Number(nav.page_number)
          return openNoteDocument(here, { page: Number.isFinite(page) && page > 0 ? page : null, signal })
        }
        // ⛔ A cited document of THIS note that the list no longer holds used
        // to set `?doc=` and wait forever for a row that never came. Read the
        // list again, and hand the FRESH row to the same one door
        // (`openNoteDocument`) -- a captured page the cached list had not caught
        // up with opens as a captured passage, never as a PDF viewer over
        // `web:<sha256>`, even for a packet that names no kind. A document that
        // left the note says so, in the same words the spanning hosts use: this
        // note is the one already open (`hereNoteId`), so it is never "opened".
        if (!here && (nav.note_id || noteId) === noteId) {
          return openDocumentPage({ ...nav, note_id: noteId }, {
            signal, openNote, hereNoteId: noteId,
            openRow: (doc, { page }) => openNoteDocument(doc, { page, signal }),
          })
        }
        const target = citationTarget({ navigation: nav }, { fallbackNoteId: noteId })
        if (!target) return SOURCE_NOWHERE
        setSearchParams((prev) => applyTargetToParams(prev, target),
                        { replace: false })
        return null
      }
      // ⛔ AND IT GOES BY THE KIND THE SERVER SENT, through lib/openCitation.js
      // like every other host: a PDF takes the page route above; a captured
      // web passage opens as a captured passage (never `?doc=`, whose viewer
      // would be a PDF viewer over `web:<sha256>` -- Wave N §9). A packet with
      // no kind takes the same page route, and it guesses nothing: a row of
      // this note's list opens by the list's `sourceKind`, and a row the list
      // did not hold yet is read fresh and handed to the same door.
      return openDocumentCitation(source.navigation, {
        signal, openPage, legacy: openPage, hereNoteId: noteId,
        openDocument: setPreviewDoc, openCapturedSource: setCapturedSource, openNote,
      })
    }
    const ed = editorRef.current
    if (!ed || source?.navigation?.kind !== 'note') return SOURCE_NOWHERE
    // NEVER JUMP TO AN UNVERIFIED POSITION -- but say why nothing moved,
    // rather than letting the click read as a broken one. A passage the server
    // promised exactly and the live doc can no longer verify has CHANGED; a
    // source it only ever promised at note level (a thesis state, a note-only
    // block) never had a passage to land on.
    if (!resolved || !PRECISE_STATES.has(resolved.state)) {
      return PRECISE_CITATION.has(source?.citation) ? PASSAGE_NOT_PINPOINTED : NOTE_LEVEL_SOURCE
    }
    // The ONE landing (askCitation.js) -- the same one a citation that arrives
    // WITH this note from "My Notebook" takes below (`routedPassage`).
    selectResolvedPassage(ed, resolved)
    return null
  }, [setSearchParams, noteId, handleOpenExcerptSource, noteDocuments, openNoteDocument])

  const handleSaveExcerpt = async ({ pageNumber, capturedText, quotePrefix, quoteSuffix, charStart, charEnd }) => {
    const ed = editorRef.current
    if (!ed) return
    try {
      // Wave J, found live: previewDoc.documentId is resolved from a list
      // fetched at note-open, so ANY document created after that (the common
      // case: attach a PDF, then immediately excerpt it) resolved to null and
      // this handler returned silently. Re-resolve from the server at save
      // time rather than trusting the snapshot -- this closes the whole race
      // class, not just the upload one. A failure past this point surfaces
      // the toast below; it must never be silent again.
      let documentId = previewDoc?.documentId
      if (!documentId && previewDoc?.href) {
        const fresh = await fetch(`/api/j2/notes/${noteId}/documents`, { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : { documents: [] }))
        documentId = fresh.documents?.find((d) => d.attachmentUrl === previewDoc.href)?.id || null
        // Carry the resolution back onto the open preview, or the highlight
        // overlay (previewExcerpts, keyed on previewDoc.documentId) stays
        // empty and the excerpt a member just saved renders no mark on the
        // page it came from until they reopen the document.
        if (documentId) setPreviewDoc((p) => (p && p.href === previewDoc.href ? { ...p, documentId } : p))
      }
      if (!documentId) throw new Error('document not resolvable')
      const res = await fetch(`/api/j2/notes/${noteId}/excerpts`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId, pageNumber, capturedText,
          quotePrefix, quoteSuffix, charStart, charEnd,
        }),
      })
      // Ruling 149: a locked note takes no captures. The lock banner (with its
      // own Unlock button) is already on screen for a locked note, so the
      // member doesn't need a second way THERE -- just the reason nothing saved.
      if (res.status === 423) {
        setUploadToast({ message: 'This note is locked. Unlock it to save excerpts.', tone: 'error' })
        return
      }
      if (!res.ok) throw new Error('save failed')
      const { excerpt, note: excerptNote } = await res.json()
      // ⛔⛔ `append_document_excerpt` ADVANCED THIS NOTE. The editor is open on
      // it, which makes this the worst door to leave unlanded: the very next
      // autosave carries a baseline the server has already passed, 409s, and —
      // before the drain learned to classify — forked the member's note against
      // their own excerpt. The route was changed to return the note for this.
      await settleNoteWrite(noteId, excerptNote)
      // ⛔ insertContentAt(selection.to), NOT insertContent -- found live in
      // the browser, and it DESTROYED the member's attachment. Clicking a PDF
      // chip to open the preview leaves ProseMirror holding a NodeSelection
      // on that chip (it renders with .ProseMirror-selectednode), and
      // insertContent REPLACES the selection: saving the first excerpt from
      // a document silently deleted the chip that document was attached by.
      // Verified against the persisted body afterwards -- the attachmentChip
      // node was simply gone, leaving [documentExcerpt, paragraph].
      // Inserting AT the selection's end preserves a selected node and is
      // identical to the old behaviour for an ordinary caret.
      //
      // Same hazard CaptureInboxTray.place() guards above (see its comment).
      // It resolves differently — falling back to 'end' — because a banked
      // capture has no anchor in the note; an excerpt does: the chip the
      // member just clicked. Landing it right after that chip is the point,
      // and 'end' would be the "dumped off-screen" failure that comment's
      // own second guard exists to prevent.
      ed.chain().focus().insertContentAt(ed.state.selection.to, {
        type: 'documentExcerpt', attrs: { excerptId: excerpt.id },
      }).run()
      // Wave 10 (10D, R-16, study task T6): a page-cited passage from a PDF reached the
      // note. A kind word and a destination — never the passage or the page.
      trackNotebookEvent(NOTEBOOK_EVENTS.CAPTURE_USED, { target: 'current', widget: 'excerpt' })
      await refreshExcerpts()
      // ⛔ WAVE P5 — and the EVIDENCE PICKER's list, which is a different
      // subscription. Without this the passage a member just saved is
      // absent from Add evidence until they reload the note; the picker
      // then tells them to "save an excerpt from a PDF in this note
      // first", about the excerpt they are looking at. Measured on a
      // phone, end to end, in one sitting.
      refreshEvidenceCandidates(noteId)
    } catch (e) {
      setUploadToast({ message: "Couldn't save that excerpt. Your note is unchanged.", tone: 'error' })
    }
  }

  const previewExcerpts = useMemo(() => {
    if (!previewDoc?.documentId) return []
    const fromNote = noteExcerpts.filter((e) => e.documentId === previewDoc.documentId)
    if (previewDoc.emphasizeExcerpt && !fromNote.some((e) => e.id === previewDoc.emphasizeExcerpt.id)) {
      return [...fromNote, previewDoc.emphasizeExcerpt]
    }
    return fromNote
  }, [noteExcerpts, previewDoc])

  const ytId = parseYouTubeId(note?.heroImageUrl)
  // Video notes whose video is a Desk library session get the Desk theater's
  // watch rails on the edges — chapters + setups + recap poster (left), key
  // takeaways + tickers covered (right), and search-the-transcript under the
  // player. Plain/external videos resolve to null and keep the simple column.
  const { video: deskVideo } = useDeskVideoByYoutube(ytId)
  const insights = useVideoInsights(deskVideo?.id ?? null)
  const hasLeftRail = !!deskVideo && (insights.loading ||
    insights.chapters.length > 0 || insights.setups.length > 0 || !!insights.posterUrl)
  const hasRightRail = !!deskVideo && (insights.loading ||
    insights.summary.length > 0 || insights.tickerMoments.length > 0)
  // When the note carries a YouTube hero, upgrade any legacy bold "[MM:SS]"
  // text prefixes into clickable videoTimestamp chips before the editor sees them.
  const bodyForEditor = useMemo(
    () => (ytId && note?.bodyJson ? linkifyTimestamps(note.bodyJson) : note?.bodyJson),
    [ytId, note?.bodyJson],
  )

  const editor = useEditor({
    extensions: buildExtensions(),
    // ⛔ S1/H14: content the schema cannot read LOCKS the editor instead of
    // opening it empty (noteContentGuard.js) -- the empty stand-in is what the
    // next save used to write over the note.
    ...noteContentGuardOptions(),
    content: bodyForEditor || { type: 'doc', content: [] },
    // Node views can't take React props from the page; the widgetEmbed view
    // reads the note id off editor storage for its archive upload
    // (see WidgetEmbedView's self-archive effect).
    onCreate: ({ editor: ed }) => {
      // `canDictate` (wave 7 H1) is a FUNCTION over the mic's ref, read when the
      // slash menu opens: the mic loads lazily and can mount after this editor,
      // and a snapshot taken here would offer "Dictate" to nobody or to everybody.
      ed.storage.uctJournalWidgets = {
        ...(ed.storage.uctJournalWidgets || {}), noteId,
        // When this note's editor opened. A node view compares a block's own capturedAt with
        // it to tell "added during this visit" from "was already here" (FingerprintPanel:
        // viewing a note must never write to it).
        openedAt: Date.now(),
        // One sentence in this note's own toast, for an editor command that could not do what
        // was asked (the /vs lookup). Commands cannot take React props.
        notify: (message, tone = 'error') => setUploadToast({ message, tone }),
        canDictate: () => micRef.current?.available === true,
        // Wave 7 H2: read when the slash menu opens, like `canDictate`.
        canWritingHelp: () => writingHelpOnRef.current === true,
        // Wave 11 11A: the same, for /voice.
        canVoiceNote: () => voiceNoteOnRef.current === true,
        // Wave 11 11D: the same, for /canvas -- never inside a canvas note itself.
        // Read live (the gate is latched per tab), so a payload that arrives after
        // this editor was created is honoured the next time the menu opens.
        canTradeCanvas: () => tradeCanvasEnabled() && !isCanvasRef.current,
      }
      // One reading per note: the timer's own stop() speaks once.
      if (note) openTimerRef.current?.(taskIndexRef.current != null ? { source: 'tasks' } : {})
      // "Send to Journal" from the charts page targets the LAST-ACTIVE note
      // (owner decision #9) — opening a note for editing is what makes it the
      // target. Title rides along for the capture toast.
      // Wave 11 11D: a trade-plan canvas is not a capture target (a capture is
      // text, and the board would show it only as "Also in this note").
      if (isCanvasRef.current) return
      try {
        localStorage.setItem('uct.jw.lastNote', JSON.stringify({
          id: noteId, ts: Date.now(),
          title: (note?.title || '').trim() || null,
        }))
      } catch { /* private mode */ }
    },
    editorProps: {
      // Wave 8 (8A): TipTap makes the body role="textbox" with no name, so a
      // screen reader announced a bare "edit text". It is the note's body.
      // 13Q-2: an explicit `tabindex="0"` is a no-op for a real browser's tab
      // order (a `contenteditable` region is already focusable and already in
      // it) but it is NOT a no-op for `editor.commands.focus()` in jsdom, which
      // this file's own test harness and `focusableWithin`'s `[tabindex]`
      // selector both need to recognise the body as focusable at all --
      // without it `openFocus="body"` (Q1's fix) silently focused nothing.
      attributes: { class: styles.proseEditor, 'aria-label': 'Note body', tabindex: '0' },
      handlePaste(view, event) {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const item of items) {
          if (item.kind !== 'file') continue
          if (ALLOWED_IMAGE_MIMES.has(item.type)) {
            event.preventDefault()
            const file = item.getAsFile()
            if (file) handleImageInsert(file)
            return true
          }
          if (ALLOWED_ATTACHMENT_MIMES.has(item.type)) {
            event.preventDefault()
            const file = item.getAsFile()
            if (file) handleAttachmentInsert(file)
            return true
          }
        }
        return false
      },
      handleDrop(view, event) {
        const file = event.dataTransfer?.files?.[0]
        if (!file) return false
        if (ALLOWED_IMAGE_MIMES.has(file.type)) {
          event.preventDefault()
          handleImageInsert(file)
          return true
        }
        if (ALLOWED_ATTACHMENT_MIMES.has(file.type)) {
          event.preventDefault()
          handleAttachmentInsert(file)
          return true
        }
        return false
      },
    },
    // ⛔ M6 (wave 6 fix round 1): a LOCKED note's document can still change
    // without the member editing it — a TOC or Outline jump opens the toggle
    // around its heading, a toggle's chevron flips `open` — and each of those
    // used to reach the autosave and write the note the member had locked. So
    // while locked, the editor's own changes schedule no save. A save already
    // scheduled (words typed before a lock arrived) still goes out; queued
    // offline words adopted on open go through `scheduleAutosaveRef` directly
    // and still send (the server never refuses a body write for a lock).
    onUpdate: () => { if (!lockedRef.current) scheduleAutosaveRef.current() },
  }, [note?.id])
  // Keep the ref current so the paste/drop handlers (captured at creation) always
  // reach the live editor instance.
  editorRef.current = editor
  // 13Q-2: the 'body' half of the openFocus contract above -- deliberately its
  // own effect, depending on `editor` itself (not just `openFocus`/`note`), so
  // it retries once the async TipTap instance actually exists rather than
  // firing once against a still-null `editorRef.current` and going quiet.
  // `editor.commands.focus('end')` (not a bare DOM `.focus()`) because the
  // ProseMirror root carries no caret position of its own to restore --
  // TipTap's own command is what actually places one, at the end of a
  // genuinely blank document.
  // ⛔⛔ `useLayoutEffect`, NOT `useEffect` -- measured, not guessed. The
  // 13Q-1 instrument's own check for "is the member's keyboard focus in the
  // body" (`focus_in_editor`) runs the instant `.ProseMirror` is PAINTED
  // (Playwright's own visibility poll), with no settle wait of its own (a
  // member would not wait either). A PASSIVE `useEffect` fires only after the
  // browser paints -- strictly later -- so by the time it set focus, the
  // check (and a real member's very next keystroke) had already landed
  // against an unfocused page. Measured live twice: a same-frame `useEffect`
  // call AND a double-`requestAnimationFrame`-delayed one (the AskPanel
  // pattern for a DIFFERENT race -- losing to a focus-stealer, not to paint
  // itself) both left the caret on document.body
  // (`docs/notebook/evidence/wave13-13q2/after-q1-run{1,2}`). `useLayoutEffect`
  // runs synchronously after the DOM mutation, before paint, which is the only
  // place that can still beat a check keyed on the paint itself.
  //
  // ⛔⛔ 13Q-Q1check (re-verification lane, product fix attempted and REVERTED --
  // read before changing this effect again). Re-measured with NO focus()/click
  // from any test after the note was created -- a real foreground page, 5 reps
  // at 1200px and 390px -- `document.activeElement` stayed `BODY` for the full
  // 2s window in 10 of 10 reps, and a real member's next keystrokes (typed
  // with no focus() call) landed in neither the title nor the body, also
  // 10 of 10 (`docs/notebook/evidence/wave13-q1check/results.json`). The PASS
  // 13Q-3's own instrument measured was its OWN compensation's work, not the
  // product's (confirmed).
  //
  // Two different PRODUCT-side fixes were then tried and BOTH measured to
  // fail in this exact real-browser flow, with no exception across 20 more
  // real repetitions: (1) retrying `editor.commands.focus('end')` a second
  // time -- still 0/10, 0/10 typed-landed
  // (`docs/notebook/evidence/wave13-q1check/results-after-retry-fix.json`);
  // (2) a SYNCHRONOUS, un-deferred `editor.view.dom.focus()` call (bypassing
  // TipTap's own command, which defers the real `view.focus()` via its own
  // `requestAnimationFrame`) -- also still 0/10, 0/10 typed-landed
  // (`docs/notebook/evidence/wave13-q1check/results-final.json`), DESPITE the
  // identical direct-DOM call succeeding 3/3 when tried in isolation
  // (`docs/notebook/evidence/wave13-q1check/direct-dom-focus-diagnosis/`).
  //
  // The isolating measurement that settled it
  // (`docs/notebook/evidence/wave13-q1check/natural-vs-injected-diagnosis/`):
  // on the SAME note, SAME page, SAME element, back-to-back -- the product's
  // own effect (this code, running in the page's own natural execution
  // context) left `document.activeElement` on `BODY`; the IDENTICAL
  // `pm.focus()` call, injected a moment later via Playwright's
  // `page.evaluate()` (a DevTools-protocol-level execution, not page script),
  // landed it immediately. The variable is NOT timing, retry count, deferred
  // vs. synchronous, headed vs. headless, or context freshness (all measured
  // and ruled out) -- it is specifically whether the call originates from the
  // page's own natural script or from a CDP-injected one. A page's own code,
  // including this effect, can only ever run in the natural context: there is
  // no way to reach the CDP-privileged one from here. This is the same
  // conclusion 13Q-2/13Q-3 reached, now with a controlled, same-element A/B
  // measurement behind it rather than an assumption.
  //
  // ⛔⛔ SUPERSEDED, 13Q-Q1check controller follow-up #2 -- the CDP-vs-natural
  // theory two paragraphs above was the wrong explanation and no longer
  // governs this effect; read this note instead before touching it again.
  //
  // Measured directly (R-RAW,
  // `docs/notebook/evidence/wave13-q1check/focus-hook-probe/results.json`,
  // commit a90976c005, 10/10 reps across both widths, no harness help):
  // at the exact moment this effect used to call `editor.commands.focus('end')`,
  // `editor.view.dom.isConnected` was FALSE. `@tiptap/react`'s `EditorContent`
  // is a class component that attaches `editor.view.dom`'s contents into its
  // own rendered container inside ITS OWN `componentDidMount`/
  // `componentDidUpdate` (`node_modules/@tiptap/react/dist/index.js`), which
  // is a CHILD effect relative to this `useLayoutEffect` -- and on the first
  // commit `editor.view.dom.parentNode` is not yet truthy, so that attach is
  // deferred past this effect's first (and, before this fix, only) run. The
  // SAME `.ProseMirror` node (tracked by stable WeakMap identity) was then
  // observed becoming connected to the document 135-807ms later in every one
  // of the 10 reps. `focus()` on a disconnected node is a silent no-op -- no
  // `focusin`, no `document.activeElement` change -- which is exactly what
  // every earlier measurement in this lane saw (`BODY` stays active, 0/10),
  // including the two PRODUCT fixes recorded above as having failed: a
  // second `focus('end')` call and a synchronous `editor.view.dom.focus()`
  // call. Both were measured to fail because both still fired before the
  // node was attached; neither retried. No CDP/automation-context theory is
  // needed to explain any of it.
  //
  // THE FIX: poll `editor.view.dom.isConnected` across animation frames and
  // fire the one-shot focus only once it is true (and the editor is still
  // editable), giving up quietly after a bounded number of frames rather
  // than retrying forever. `openFocusDoneRef.current` is still set exactly
  // once, and only at the moment focus is actually applied -- so if the note
  // is destroyed/unmounted before the DOM ever attaches, nothing claims the
  // one-shot and nothing throws. The title/landmark effect above is
  // untouched.
  useLayoutEffect(() => {
    if (openFocus !== 'body' || openFocusDoneRef.current) return
    if (!editor || editor.isDestroyed) return
    let cancelled = false
    let rafId = null
    let frames = 0
    // ~3s at 60fps -- generous against the measured 135-807ms attach gap.
    const FRAME_CAP = 180
    const tryFocus = () => {
      if (cancelled) return
      if (!editor || editor.isDestroyed) return
      const dom = editor.view && editor.view.dom
      if (dom && dom.isConnected && editor.isEditable) {
        openFocusDoneRef.current = true
        editor.commands.focus('end')
        onOpenFocused?.()
        return
      }
      frames += 1
      if (frames >= FRAME_CAP) return
      rafId = requestAnimationFrame(tryFocus)
    }
    tryFocus()
    return () => {
      cancelled = true
      if (rafId != null) cancelAnimationFrame(rafId)
    }
  }, [openFocus, editor, onOpenFocused])
  const unreadable = useUnreadableNote(editor)
  // Wave 11 lane 11D: how many blocks a canvas note holds besides its board.
  useEffect(() => {
    if (!editor || !isCanvas) { setCanvasExtra(0); return undefined }
    const count = () => { if (!editor.isDestroyed) setCanvasExtra(extraBlockCount(editor.state)) }
    count()
    editor.on('transaction', count)
    return () => { editor.off('transaction', count) }
  }, [editor, isCanvas])
  // TipTap v3's useEditor does NOT re-render on transactions, so toolbar state
  // read in render (font/size dropdowns, bold/italic active) goes stale. Bump
  // on every selection/mark change to keep the toolbar in sync -- but through
  // `toolbarStateReducer`, which bails out (same object reference) on a
  // keystroke that changed neither the active marks/block nor undo/redo, so
  // plain typing stops forcing a page-wide re-render (standard 4, O(1) check).
  const [, bumpToolbar] = useReducer(toolbarStateReducer, null)
  useEffect(() => {
    if (!editor) return undefined
    const update = () => bumpToolbar(editor)
    editor.on('transaction', update)
    editor.on('selectionUpdate', update)
    return () => { editor.off('transaction', update); editor.off('selectionUpdate', update) }
  }, [editor])

  // Wave 10 fix round 1 (review M-5): on a phone the chrome is NOT sticky
  // (`.chrome { position: static }` at <=640 -- a wrapped header + toolbar would
  // pin ~200px over a ~600px screen), so the touch Undo / Redo scrolled out of
  // reach the moment a member typed past the first screen -- the very case
  // G-144 exists for. Once the pair's PLACE in the toolbar has scrolled up under
  // the top bar, the pair FLOATS at the top-right (`.historyFloat`, <=640 only);
  // back in view, it returns to the row.
  // ⛔ What is observed is a SENTINEL left in the row where the pair sits
  // (`.historySentinel`), never the pair itself (a floated pair is always on
  // screen, so observing it would un-float it, which would hide it, which would
  // float it: a loop) and never the whole row (at 390 px the row wraps to
  // ~340 px, so the pair at its top was off screen while the row was not --
  // measured in real Chromium by the lane walk's mutant run). The sentinel
  // arrives through a state ref, so the check attaches whenever it mounts (the
  // row renders only after the note loads). A hidden sentinel (zero height:
  // above 640 px, or a locked note) never floats the pair.
  // ⛔ A SCROLL CHECK, not an IntersectionObserver: an observer reports only a
  // CROSSING, and a phone's first tap into the note jumps the sentinel from
  // below the screen to above it in one scroll -- "not visible" to "not
  // visible", so it never fired (measured in real Chromium, fix round 1). The
  // app scrolls its inner .main, not the window: capture phase, one read per
  // frame, and an unchanged answer re-renders nothing (TableToolbar does the
  // same for its own position).
  const [historySentinelEl, setHistorySentinelEl] = useState(null)
  const [historyFloating, setHistoryFloating] = useState(false)
  useEffect(() => {
    if (!historySentinelEl) return undefined
    const topBar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mobile-topbar-h')) || 0
    let frame = 0
    const check = () => {
      frame = 0
      const r = historySentinelEl.getBoundingClientRect()
      setHistoryFloating(r.height > 0 && r.bottom <= topBar)
    }
    const onMove = () => { if (!frame) frame = requestAnimationFrame(check) }
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    check()
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
      if (frame) cancelAnimationFrame(frame)
      setHistoryFloating(false)
    }
  }, [historySentinelEl])

  // Wave 10 lane D3P (D-3 PHONE): at 390 px the formatting row wrapped to about eight rows,
  // so a note opened to a screen of controls with the title below them, and the phone's Log
  // FAB sat over one of them at rest (L3's measurement). On a PHONE (<= 640 px) the row keeps
  // Undo / Redo, Bold, Italic, the bullet list and the mic, and every other formatting control sits
  // behind ONE "Aa Format" disclosure. The collapse is CSS, inside the 640 query
  // (`.formatToggle`, `.formatRun`): the DOM is the same at every width, so desktop and
  // tablet keep their order, their Tab order and their layout (`.formatRun` is
  // `display: contents` there, and the toggle is `display: none`).
  // ⛔ The disclosure is the TOOLBAR ROW, expanded in place. The moved controls are four runs
  // in the row's own order (font + size; colour + H1 + H2; numbered list .. Attach; rule +
  // Insert), and the toggle's `aria-controls` names all four. The row is the container the keyboard contract
  // (lib/useDisclosureFocus.js) acts on: focus moves to the first moved control, Tab stays in
  // the toolbar, Escape closes it and hands focus back to the toggle. It could not be one
  // container of moved controls alone without reordering the desktop row, whose kept and moved
  // controls are interleaved (Undo, Redo, [font, size], B, I, [colour, H1, H2], List, [...], mic, [...]).
  // The runs stay MOUNTED while closed (only hidden by CSS), so a half-open colour picker keeps
  // its state. The mic is kept visible on phones by controller ruling, outside every run.
  const [formatOpen, setFormatOpen] = useState(false)
  const formatToggleRef = useRef(null)
  const toolbarRowRef = useRef(null)
  // Lane KEYS: the formatting toolbar is ONE Tab stop (Left and Right inside it, Home and End
  // to its ends). Off while the phone's Format panel is open: that panel keeps Tab inside the
  // row, so there every control stays an ordinary stop.
  const editorToolbarRoving = useToolbarRoving({ enabled: !formatOpen })
  const formatRunId = useId()
  const closeFormat = useCallback(() => setFormatOpen(false), [])
  const firstFormatControl = useCallback(
    () => focusableWithin(toolbarRowRef.current?.querySelector('[data-format-run]'))[0] || null,
    [],
  )
  const { disclosureProps: formatDisclosureProps } = useDisclosureFocus({
    open: formatOpen && Boolean(editor) && !locked,
    containerRef: toolbarRowRef,
    onClose: closeFormat,
    openerRef: formatToggleRef,
    // ⛔ The toggle is INSIDE the row it opens, so the hook's own "focus moves in" sees focus
    // already inside and (by design: "unless a child already took it") does nothing. Focus
    // is moved to the first moved control here instead, once the runs are displayed.
    focusOnOpen: false,
  })
  useEffect(() => {
    if (formatOpen) firstFormatControl()?.focus?.()
  }, [formatOpen, firstFormatControl])
  // Widening past 640 px with it open (a rotated phone, a resized window): the toggle is gone
  // there, so a disclosure left open would keep Tab inside the toolbar with nothing on screen
  // saying why. It closes on the media change.
  useEffect(() => {
    if (!formatOpen || typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia(MQ.phone)
    const onChange = (e) => { if (!e.matches) setFormatOpen(false) }
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [formatOpen])
  // Locking the note unmounts the toolbar row. Left open, the disclosure would come back
  // EXPANDED on unlock with nothing moving focus into it, so the lock closes it.
  useEffect(() => {
    if (locked) setFormatOpen(false)
  }, [locked])
  // Wave 10 lane D3P round 2 (owner-delegated ruling (a)): on a PHONE, while this editor is
  // open, the two first-run moments WAIT -- the "Meet Compass" coach card (FloatingOrb) and the
  // mic's in-flow dictation hint (VoiceInputButton). At 390x844 they pushed the first body line
  // 78-188 px below the fold on a first visit. Waiting is a RENDER condition only: neither one
  // is marked seen or dismissed here, so both stay pending and show on the next surface that
  // is not the editor. The card waits the way it already waits behind the Notebook tour -- the
  // editor holds the first-run stage (components/firstRun/firstRunStage.js, read by
  // FloatingOrb's `coachmarkOn`); the hint waits on `hintDeferred`. The mic itself stays.
  // Above 640 px nothing changes. Rails: NoteEditorPage.firstRunDefer.test.jsx.
  const deferFirstRun = useIsPhone()
  useEffect(() => (deferFirstRun ? claimFirstRunStage() : undefined), [deferFirstRun])

  // The lock IS `editable`: every surface that edits the note asks
  // `editor.isEditable` (lib/lockedNote.js says why it is not a filter).
  // `false`: turning it on or off is not an edit, so no autosave.
  // ⛔ Wave 6 whole-branch review I-3: an UNREADABLE note (the schema guard,
  // lib/noteContentGuard.js) is read-only whatever its lock says, and the guard
  // owns that. This effect used to hand such a note `setEditable(true)` on
  // mount and on every unlock, until the guard re-locked it a render later.
  useEffect(() => {
    if (!editor || editor.isDestroyed || unreadable || editor.isEditable === !locked) return
    editor.setEditable(!locked, false)
    bumpToolbar(editor)
  }, [editor, locked, unreadable])

  /**
   * ⛔⛔ UNLOCK IS A WRITE DOOR (wave 6 fix round 1, I1). The PATCH advances the
   * note's `updatedAt`, and the only reason to press Unlock is to type — so the
   * very next thing on the wire is this editor's own save.
   *
   * ⚰️ It used to record nothing and only `refresh()`, which never moves the save
   * baseline (the load effect is keyed on the note id): the first autosave went
   * out on the PRE-unlock revision and 409'd on the member's own write, and once
   * the note closed a drain asked "is that revision ours?", found it unrecorded,
   * and forked the note.
   *
   * ⭐ THREE STEPS, IN THIS ORDER, before the editor is made editable:
   *   1. `setNoteLock` lands the revision (`settleNoteWrite`, the one way a
   *      revision is landed) and returns the server's copy.
   *   2. When that copy differs from what this editor last knew by metadata
   *      ONLY (`classifyServerChange` — the reconcile's own authority), the save
   *      baseline moves onto it, so the first save after Unlock carries the
   *      post-unlock revision and lands. ⛔ Never otherwise: a copy whose words
   *      this editor never saw (another device wrote them) is not a base to build
   *      on — the next save goes out on its own base, 409s, and the reconcile
   *      merges or forks exactly as it would for any other writer.
   *   3. `settleMetadataRevision` — the path every metadata door in this file
   *      takes — records the landing for this account and, under the same
   *      metadata-only condition, settles the durable copy onto it.
   * ⛔ A settle that fails never fails the Unlock: the write already happened.
   *
   * ⛔⛔ N-a (wave 6 fix round 3, from M2). This used to swallow a failed
   * `setNoteLock` into `unlockState` alone and return `undefined` either
   * way — indistinguishable from success to a caller that only checks
   * whether the promise resolved. `NoteMenuActions.run` is exactly such a
   * caller: it treats ANY resolved write as success, so a failed menu
   * Unlock rendered "Unlocked. You can edit this note again." beside the
   * banner's own "Couldn't unlock. Try again." — two contradictory
   * sentences, the menu's one false. Returning an outcome (never rejecting:
   * the inline banner's own `onClick={unlockNote}` has no `.catch`, and an
   * unhandled rejection there would be a second, worse silent failure) lets
   * every caller — the banner and the menu alike — tell the two apart.
   */
  const unlockNote = async () => {
    setUnlockState('busy')
    let saved
    try {
      saved = await setNoteLock(noteId, false)
    } catch (error) {
      setUnlockState('failed')
      return { ok: false, error }
    }
    const landed = usableBaseline(saved?.updatedAt)
    if (landed && serverMovedMetadataOnly(saved)) {
      lastSavedRef.current = { ...lastSavedRef.current, updatedAt: landed }
    }
    try { await settleMetadataRevision(saved) } catch { /* the unlock landed; bookkeeping never fails it */ }
    setUnlockedHere(true)
    setUnlockState(null)
    refresh?.()
    return { ok: true }
  }

  // Push fresh body into editor when note loads (one-shot per note).
  // Depends on `editor` (not just note.id) so it re-runs once the editor
  // instance is actually ready. When a content-bearing note opens, the editor
  // is re-created (useEditor keyed on note.id) and for a tick `editor.commands`
  // can throw "Cannot read properties of null (reading 'commands')" because the
  // ProseMirror view/commandManager isn't mounted yet — that TypeError crashed
  // the whole page (empty notes never hit it: their content already matches the
  // empty editor so setContent is skipped). Guard + try/catch make it safe; the
  // editor was already created with this content via useEditor's `content`
  // option, so a swallowed first attempt still shows the note.

  // The user's RESOLVED own-chart settings ride editor storage so the SLASH
  // paths can freeze them at insert (the door captures always did — only
  // typed inserts drifted; panel finding). Re-stamped whenever prefs
  // land/change: onCreate alone raced the prefs fetch. The stamp lives in
  // widgetEmbedCore (one authority) and resolves the workspace WIDGET
  // settings, not the bare chart_settings seed — stamping the seed here was
  // how journal charts lost the user's MAs/legend/colors (chart-parity round).
  // ⛔ Gate on !loading: stamping while the SWR fetch is pending would freeze
  // pure DEFAULTS as "the user's chart" — an insert/Sync in that window ships
  // the exact defect this stamp exists to fix (review finding). And key the
  // effect on the RAW pref values, not the prefs object: usePreferences hands
  // back a new object every render, and this page re-renders per keystroke —
  // an object dep re-parses the whole multi-KB workspace layout on every
  // caret move (review finding).
  const { prefs, loading: prefsLoading } = usePreferences()
  useEffect(() => {
    if (prefsLoading) return
    stampChartSettings(editor, prefs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, prefsLoading, prefs.charts_workspace_layout, prefs.charts_default_chart_widget, prefs.chart_settings])

  useEffect(() => {
    if (!editor || editor.isDestroyed || !note?.bodyJson || editor.isFocused) return
    try {
      const current = JSON.stringify(editor.getJSON())
      const fresh = JSON.stringify(bodyForEditor)
      if (current !== fresh) replaceDocument(editor, bodyForEditor, EMIT_NOTHING)
    } catch {
      /* editor view not mounted yet — content already loaded via useEditor */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id, editor])

  // Wave 6: `?task=<n>` puts the caret in the n-th task (declared AFTER the
  // fresh-body push above: effects run in order, and that one's setContent
  // would otherwise put the caret back), counted in the SAME
  // pre-order the server counted (findTaskItemPos, pinned by
  // tests/fixtures_note_tasks.json), and scrolls it into view. Once per note and
  // task; a link naming a task the note no longer has opens the note normally.
  const openedTaskRef = useRef(null)
  useEffect(() => {
    if (!editor || editor.isDestroyed || taskIndex == null || !note) return
    const key = `${noteId}:${taskIndex}`
    if (openedTaskRef.current === key) return
    const pos = findTaskItemPos(editor.state.doc, taskIndex)
    if (pos == null) return
    openedTaskRef.current = key
    const at = TextSelection.near(editor.state.doc.resolve(pos + 1)).from
    editor.chain().focus().setTextSelection(at).scrollIntoView().run()
  }, [editor, note, noteId, taskIndex])

  // ⛔⛔ A CITATION FROM THE WHOLE NOTEBOOK LANDS ON ITS PASSAGE (fin walk 8.3).
  // "My Notebook" cited a note, the member clicked, and this page opened at the
  // top: the spanning host could only say `openNote({ id })`, and nothing
  // carried the passage the server had located across the page change. It now
  // rides the history entry's state (lib/openCitation.js, NotebookTab.openNote)
  // and lands here -- through the SAME landing the in-note Ask uses
  // (`selectResolvedPassage`, also `jumpToCitation`'s), never a second one.
  //
  // ⛔ VERIFIED, NEVER TRUSTED. `resolveNoteCitation` re-reads the text at the
  // range in the live doc (the note may have changed since the answer) and
  // re-finds it when it moved; a passage it cannot pinpoint lands nowhere and
  // the note stays open at the top with nothing said -- the panel that could
  // say it is on the page the member left, and that open is exactly what this
  // door did before. ⛔ FOR THIS NOTE ONLY: `passageFromNavigationState` answers
  // for the id the passage names, so a state that outlives its entry cannot
  // scroll an unrelated note. ⛔ READ ON FIRST SIGHT INTO A REF: a later
  // `replace` navigation (a param this page or the tab clears) drops the
  // entry's state, and that must not drop the landing. ⛔ ONCE PER MOUNT, like
  // `?task=` above -- the editor is keyed by note, so a Back that remounts it
  // lands again, exactly as a task link does.
  // ⛔ AND IT WAITS FOR THE VIEW'S DOM TO ATTACH, as the body-focus effect
  // below learned to (measured 135-807 ms after this effect's first run): a
  // selection set before then is kept, but `scrollIntoView` against a detached
  // node scrolls nothing, and the member would land at the top of a long note
  // with its highlight below the fold -- the defect this closes, wearing a
  // smaller hat. Bounded, so an editor that never attaches claims nothing.
  const routeLocation = useLocation()
  const routedPassage = passageFromNavigationState(routeLocation.state, noteId)
  const routedPassageRef = useRef(null)
  if (routedPassage) routedPassageRef.current = routedPassage
  const landedPassageRef = useRef(false)
  useEffect(() => {
    const passage = routedPassageRef.current
    if (!passage || landedPassageRef.current) return undefined
    if (!editor || editor.isDestroyed || !note || note.id !== noteId) return undefined
    let cancelled = false
    let rafId = null
    let frames = 0
    const FRAME_CAP = 180   // ~3 s at 60 fps, the body-focus effect's own ceiling
    const tryLand = () => {
      if (cancelled || !editor || editor.isDestroyed) return
      const dom = editor.view && editor.view.dom
      if (!dom || !dom.isConnected) {
        frames += 1
        if (frames < FRAME_CAP) rafId = requestAnimationFrame(tryLand)
        return
      }
      landedPassageRef.current = true
      const resolved = resolveNoteCitation(editor.state.doc, passage.location, passage.text)
      if (PRECISE_STATES.has(resolved.state)) selectResolvedPassage(editor, resolved)
    }
    tryLand()
    return () => {
      cancelled = true
      if (rafId != null) cancelAnimationFrame(rafId)
    }
  }, [editor, note, noteId])

  // ⛔ The arming half of `hydratedRef` — see its declaration for the defect.
  // Declared AFTER `useEditor` on purpose: effects run in the order their hooks
  // were called, so `useEditor`'s own rebuild effect runs first and its
  // construction-time repair transaction is refused by a ref that is still
  // false. It is armed here, one effect later, once `editor` and `note` are
  // both the ones this render is about.
  // ⛔ NOT gated on `note.bodyJson` (as the sync effect above is): a note the
  // server holds with no body at all must still be editable, and gating on the
  // body would leave that member typing into a page that saves nothing.
  // ⛔ S1/H14: and never armed for a note this bundle cannot read.
  useEffect(() => {
    hydratedRef.current = Boolean(editor && !editor.isDestroyed && note && !isUnreadable(editor))
  }, [note?.id, editor, note, unreadable])

  // ⭐⭐ D3 / F5P-1 — TAKE THE QUEUED WORDS AND SEND THEM THROUGH OUR OWN SAVE.
  // Declared AFTER the hydration gate so it runs after it in the same commit.
  // ⛔⛔ THE BASELINE IS THE COPY THE WORDS WERE WRITTEN ON (`adopt.base`), NEVER
  // THE SERVER'S CURRENT REVISION. On the current revision the PUT would succeed
  // without a 409 and silently drop whatever a door appended while the member
  // was away. On the words' own base it 409s whenever the server moved, and
  // `reconcileConflict` decides: metadata ⇒ rebase, append ⇒ merge the block,
  // anything else ⇒ fork, never clobber.
  useEffect(() => {
    if (!pendingAdoption || !editor || editor.isDestroyed || !note || !hydratedRef.current) return undefined
    const { state, base, auto, decision, savedAt, writtenSchema } = pendingAdoption
    // Offer instead of adopting: the HEAD~1 behaviour, which keeps both copies.
    const offer = () => {
      setPendingAdoption(null)
      if (decision) {
        setPendingDraft({ ...decision.state, savedAt: savedAt ?? null })
        setRecovery(decision)
      }
      setRecoveryDecidedFor(note.id)
    }
    // ⛔⛔ S2 (fix round 1) — NEVER PUT QUEUED WORDS OVER WHAT THE MEMBER IS DOING.
    // A: typing before `recover()` resolved — adopting would replace it on
    //    screen, reset its timer and overwrite its draft; it would be in no layer.
    // B: a save on the wire — when it lands it moves `lastSavedRef` to ITS
    //    revision, and the adoption's save would then go out on that revision
    //    with no 409, over the member's words and any door's block.
    // ONE flag covers both, and that is derived, not assumed. The hazard is a
    // save that MOVES `lastSavedRef` when it lands (case B) — not every save:
    // the metadata and excerpt doors reach the wire without touching it, so an
    // adoption during one still sends on its base and 409s into the reconcile.
    // Of the saves that do move it, `commitSave` (its timer, retries and the
    // unmount flush) is downstream of `scheduleAutosave`, which marks the note
    // edited BEFORE it arms anything; the crash-draft Restore comes only from a
    // banner decision, never while an automatic adoption is pending; and a
    // version restore moves it but loses no words in either order.
    // ⚰️ A second `|| busy` term stood here and was deleted: removing it left
    // every rail green, because it could not be true without this one — a guard
    // that reads as protection and cannot fire. (S2-A′ isolates this flag;
    // S2-B (Restore) the in-flight one.)
    if (auto && editedSinceHydrationRef.current) { offer(); return undefined }
    // A Restore is the member's own choice, so an edit does not stop it — but a
    // save already on the wire is waited for, never raced (case B again).
    if (!auto && saveInFlightRef.current) {
      let cancelled = false
      saveSettledWaitersRef.current.push(() => { if (!cancelled) setAdoptionTick((n) => n + 1) })
      return () => { cancelled = true }
    }
    // ⛔ N6: the words go into the EDITOR first, because the save reads its body
    // from the editor, not from `state`. If the view cannot take them, nothing is
    // saved as though it had — they are offered, and the durable copy and the
    // queue still hold them.
    try {
      if (!replaceDocument(editor, state.bodyJson || { type: 'doc', content: [] }, EMIT_NOTHING)) {
        offer(); return undefined
      }
    } catch { offer(); return undefined }
    // ⛔⛔ B1: these words were written by ANOTHER page load, perhaps a bundle
    // that could not read this note and held an empty stand-in. From here every
    // capture and every send of them is at THAT writer's level (absent ⇒ 0), so
    // the server refuses them on a note it could not read and `keepRefusedWords`
    // keeps them as a copy — never this bundle's own level, which let them land.
    // Set BEFORE the autosave below: its snapshot is the first capture.
    carryRecovered(writtenSchema)
    setPendingAdoption(null)
    const t = state.title || ''
    const s = state.subtitle || ''
    setTitle(t)
    titleRef.current = t
    setSubtitle(s)
    subtitleRef.current = s
    lastSavedRef.current = {
      title: base.title || '', subtitle: base.subtitle || '',
      bodyJson: base.bodyJson, updatedAt: base.updatedAt || null,
    }
    setRecoveryDecidedFor(note.id)
    // The ordinary autosave path: draft + durable snapshot + the debounced PUT.
    scheduleAutosaveRef.current()
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAdoption, editor, note, adoptionTick])

  // G-064 — insert an Ask Notebook answer into THIS note: an editor transaction
  // on the normal autosave path (spec §5.2). No endpoint, no settle, no door.
  const insertAskAnswer = useCallback((node) => {
    const ok = appendAskInsert(editorRef.current, node)
    if (ok) setUploadToast({ message: ASK_INSERT_SUCCESS_MSG, tone: 'success' })
    return ok
  }, [])
  // G-064 final fix wave (M1, as amended by the coordinator's ruling) — the
  // CLICK path is offered while the editor is editable and no recovered draft
  // awaits Restore/Discard (a Restore's setContent would erase the insert).
  // ⛔ NOT gated on `saveStatus`: an insert during an ordinary in-flight
  // autosave is the same as typing during one — the transaction re-arms the
  // debounce and the next PUT carries it. Gating on 'saving' made the button
  // blink out on every save. The PENDING path below keeps its own
  // `saveStatus !== 'saving'` gate, which exists for a Restore's PUT
  // specifically. Otherwise the hosts get `null`, and AskPanel offers no Insert.
  const askInsertHere = editor && editor.isEditable && !pendingDraft
    ? insertAskAnswer
    : null

  // G-064 — an answer picked for this note on another page (spec §5.2).
  // ⛔ WHAT KEEPS THIS BEHIND HYDRATION, stated exactly: `ready` below reads
  // `hydratedRef.current` DURING RENDER, so the declaration order of the
  // effects is NOT what protects it. The protection is that `ready` also
  // requires `recoveryDecidedFor === noteId`, and that decision is ALWAYS set
  // asynchronously — after the `await durableRef.current.recover(...)` in the
  // recovery effect, and an `await` yields even on an already-settled value —
  // so it resumes only once the whole effect flush that started it has
  // finished, the arming effect of that same commit included. Its setState
  // then re-renders this page, and that render reads the ref already armed.
  // Inserting before hydration is the "document changed without a person"
  // class the arming effect exists to refuse. (If the note's editor is only
  // committed AFTER the decision, the render that commits it reads the ref
  // before its own arming effect runs, so `ready` stays false until the page
  // next re-renders: the answer WAITS, it is never inserted early.
  // Controller ruling M2: kept as is.)
  //
  // ⛔⛔ G-064 fix round 1 (F2, controller ruling) — `recoveryDecidedFor` is
  // compared against THIS render's `noteId`, never a bare boolean. DEFENSE IN
  // DEPTH: NotebookTab keys this page by noteId today
  // (tabs/NotebookTab.jsx:715), so a switch mounts a fresh instance; if this
  // instance is ever reused across notes, a decision made for A must still
  // never authorize an insert into B. `note?.id === noteId` is the companion
  // half — `note` can lag `noteId` by a render (the fetch hasn't resolved
  // yet), and a stale A note object must not pass either.
  //
  // ⛔⛔ G-064 fix round 1 (F4, controller ruling) — `saveStatus !== 'saving'`
  // closes the slow-restore race: `restoreDraft()` sets `saveStatus:'saving'`
  // BEFORE its `await update(...)`, and clears `pendingDraft` in that same
  // synchronous span. Gating on `pendingDraft` alone left a window, while the
  // restore's own PUT was still in flight, where a pending Ask insert could
  // fire and its OWN autosave would carry the PRE-restore `baseUpdatedAt` —
  // racing the restore's write with a stale baseline. Waiting for
  // `saveStatus` to leave `'saving'` means the insert's autosave always reads
  // `lastSavedRef.current.updatedAt` AFTER the restore has updated it.
  usePendingAskInsert({
    noteId,
    editor,
    // ⛔ M6: `!locked` — an answer for a locked note WAITS for Unlock, as a
    // capture does. Taken while locked, it was refused and gone.
    ready: recoveryDecidedFor === noteId && note?.id === noteId
      && !pendingDraft && hydratedRef.current && saveStatus !== 'saving' && !locked,
    onResult: (ok) => setUploadToast(ok
      ? { message: ASK_INSERT_SUCCESS_MSG, tone: 'success' }
      : { message: "This note can't take changes right now, so the answer wasn't inserted. Ask again to get it back.", tone: 'error' }),
  })

  // A15 conflict reconcile: pull the fresh note, merge in any block the SERVER
  // appended that the local doc lacks, then advance the baseline so the
  // caller's retry wins cleanly.
  //
  // ⭐⭐ THE DECISION IS NOT MADE HERE. `classifyServerChange` owns it, and the
  // drain asks the same function the same question — a guard repeated is a
  // guard unproved, and the copy that used to live in this file knew about
  // `widgetEmbed` and nothing else, so a member who saved a price or captured
  // an excerpt into a note they were also editing got a fork instead of a
  // merge. See `lib/offline/serverChange.js` for the three shapes.

  /** ⚰️⚰️ WAVE Q1 ENTRY GATE — THIS USED TO OVERWRITE THE SERVER.
   *
   * The old handler appended the widget embeds it was missing, advanced the
   * baseline, and let `commitSave` retry with the LOCAL document — so any
   * newer server prose, title or subtitle was replaced. It was built for the
   * Send-to-Journal server-side append (its comment says so) and it is correct
   * for exactly that case. Against two humans it was last-write-wins, and it
   * had no rail.
   *
   * Wave Q makes the stale-baseline case ORDINARY rather than rare — an
   * offline outbox manufactures it on purpose — so the handler now proves the
   * merge is safe or preserves both versions.
   *
   * Returns true when the caller may retry, false when the conflict has been
   * resolved by forking (and the retry must NOT happen), and `{ landed: fresh }`
   * when there was no conflict to resolve: the server already holds exactly what
   * the save sent (`sent`), so the caller settles it as the landing it is.
   */
  const reconcileConflict = async (sent, { refused = false } = {}) => {
    const res = await fetch(`/api/j2/notes/${noteId}`, { credentials: 'include' })
    if (!res.ok) throw new Error(`${res.status}`)
    const fresh = (await res.json())?.note
    if (!fresh) throw new Error('empty note on reconcile')
    const base = lastSavedRef.current

    // ⭐⭐ D3b fix round 1, residual (a) — ONE authority, `ownerReconcilePlan`,
    // which the property rail's model of this function asks too. ⚰️ A sweep whose
    // PUT was already in flight when this note opened lands the SAME queued words
    // this editor adopted; our own send on their base then 409s, and classifying
    // the server's copy against that base read the member's own words as the
    // change and forked the note with nobody else writing. When the server holds
    // exactly what we sent, nothing conflicted: it is settled as a landing.
    //
    // ⛔⛔ B1 (wave 5): a SCHEMA refusal is not a conflict the diff can resolve —
    // the server did not move; the words' writer could not read the note. A merge
    // or rebase would retry the same words into the same refusal, so a refusal
    // takes the preserve-both branch below whatever the plan would have said. It
    // also cannot be LANDED: a refused write is one the server does not hold.
    const { plan } = refused ? { plan: FORK } : ownerReconcilePlan({ fresh, base, sent })
    if (plan === LANDED) return { landed: fresh }
    if (plan !== FORK) {
      // ⛔ METADATA_ONLY appends nothing — the body never moved, so there is
      // nothing to merge and the retry carries the member's words unchanged.
      // The baseline still has to advance, or the retry 409s again for ever.
      const localKeys = new Set()
      editor.state.doc.descendants((n) => {
        const k = nodeKeyOf({ type: n.type.name, attrs: n.attrs })
        if (k) localKeys.add(k)
        return true
      })
      const missing = missingServerNodes(appendedServerNodes(fresh, base), localKeys)
      // focus('end') — the appends rail (widgetEmbedInsert.test.jsx): a text
      // position, never a NodeSelection that would swallow a trailing atom.
      // caretAfterWidgetEmbed: nor may the INSERT leave one armed (the typing-
      // after-insert trap).
      if (missing.length) editor.chain().focus('end').insertContent(missing).caretAfterWidgetEmbed().run()
      lastSavedRef.current.updatedAt = fresh.updatedAt || null
      return true
    }

    // ⛔ PRESERVE BOTH. The server keeps its version untouched; the member's
    // version becomes a sibling, using the vocabulary the connectors already
    // taught members (`sync-conflict`, a titled copy) rather than a second,
    // offline-only conflict system.
    const localTitle = titleRef.current || ''
    const localSubtitle = subtitleRef.current || ''
    const localBody = editor.getJSON()
    // ⛔ S1 (fix round 1): EXACTLY what the sibling will hold. The create below is
    // a network round trip, and anything typed during it is NOT in the sibling.
    const forked = { title: localTitle, subtitle: localSubtitle, bodyJson: localBody }
    // ⛔⛔ THIS USED TO SILENTLY DROP THE SUBTITLE. `createNoteViaApi` took no
    // `subtitle` param until UX #12 (Duplicate note, 2026-09-22) added one --
    // this call sat right beside that gap the whole time, in the ONE path
    // this file's own header calls "PRESERVE BOTH." The prior code's own
    // comment claimed the subtitle "carries... in the body," which was never
    // actually implemented -- nothing appended it anywhere; only a
    // console.info (invisible to the member) recorded the loss. Found while
    // adding the param for an unrelated reason, fixed because it sat exactly
    // on this session's "never lose member data" conflict-handling path.
    await createNoteViaApi({
      title: `${localTitle} (conflicted copy)`.trim(),
      subtitle: localSubtitle || undefined,
      bodyJson: localBody,
      tags: ['sync-conflict'],
      folderId: note?.folderId || undefined,
    })

    // ⛔ S1: did the member type while the sibling was being created? Read BEFORE
    // the view is replaced below, or the answer is always "no".
    const editorHoldsForked = sameAuthoredContent({
      title: titleRef.current || '', subtitle: subtitleRef.current || '', bodyJson: editor.getJSON(),
    }, forked)
    // The sibling exists: count the fork (the member's words are safe in it).
    // `queued`: words typed during the create are still in the queue.
    trackNotebookEvent(NOTEBOOK_EVENTS.CONFLICT_FORKED, { door: 'editor', queued: !editorHoldsForked })
    // ⛔⛔ R1 (fix round 2): when the member typed during the create, those words
    // are in the durable writer's PENDING snapshot, not yet in the store — and
    // the writer keeps only its newest snapshot, so their next keystroke on the
    // server copy below would supersede them before they were ever written.
    // Write them NOW, before the view is replaced: the fix-6 guard then keeps
    // them against later keystrokes, and the queue carries them to a second fork.
    if (!editorHoldsForked) durableRef.current.flush()

    // The editor now shows what the SERVER has — the canonical version — so the
    // member is not typing into a document that no longer exists anywhere.
    setTitle(fresh.title || '')
    titleRef.current = fresh.title || ''
    setSubtitle(fresh.subtitle || '')
    subtitleRef.current = fresh.subtitle || ''
    // B1: once the SERVER's copy is on screen the editor holds its own read again —
    // whatever it carried is in the sibling (recorded, so a second refusal of the
    // same words does not copy them twice). Only when the view really moved.
    const carriedHere = carriedRef.current
    if (fresh.bodyJson && replaceDocument(editor, fresh.bodyJson, EMIT_NOTHING)) {
      if (carriedHere !== OWN_READ) preservedRef.current.add(carriedHere)
      carriedRef.current = OWN_READ
    }
    lastSavedRef.current = {
      title: fresh.title || '', subtitle: fresh.subtitle || '',
      bodyJson: fresh.bodyJson, updatedAt: fresh.updatedAt || null,
    }
    // ⭐ D3 / F5P-1 — THE SIBLING NOW HOLDS THE MEMBER'S WORDS; SETTLE THE DURABLE
    // COPY THE WAY THE SWEEP'S FORK DOES. Without this the record stayed dirty
    // with a queued entry the sibling already preserved, and once the note
    // closed the sweep forked it AGAIN. `settleOwnerFork` first (it clears the
    // queue), THEN `markSynced`, so the writer's latest state is the server copy
    // too and no pending keystroke snapshot can re-dirty the record.
    // ⛔⛔ S1 (fix round 1) — BUT ONLY WHILE THE EDITOR AND THE STORE STILL HOLD
    // EXACTLY WHAT WAS FORKED. Words typed during the create request reach the
    // record, the queue and the draft but NOT the sibling; settling then wrote
    // the server copy clean over them, `markSynced` superseded their pending
    // snapshot and the draft went with them — in no layer at all. When anything
    // moved, keep the pre-E-3 behaviour: no settle, the queue keeps the words,
    // and a later second fork preserves them. A duplicate beats a loss.
    const serverNow = { title: fresh.title || '', subtitle: fresh.subtitle || '', bodyJson: fresh.bodyJson ?? null }
    const settled = editorHoldsForked
      && (await settleOwnerFork({ accountId: user?.id, noteId, serverNote: fresh, forked })) === true
    if (!settled) {
      clearDraftLocally()          // pre-E-3: the durable copy (flushed above when the view moved) and the queue keep the words
    } else if (sameAuthoredContent({
      title: titleRef.current || '', subtitle: subtitleRef.current || '', bodyJson: editor.getJSON(),
    }, serverNow)) {
      // ⛔ Re-read AFTER the settle's await: a keystroke there is on top of the
      // server copy, and its own snapshot, draft and autosave must survive.
      durableRef.current.markSynced({ acked: serverNow, current: serverNow, updatedAt: fresh.updatedAt || null })
      clearDraftLocally()
    }
    setSaveStatus(refused ? 'refused' : 'conflict')
    setSaveErrorMsg('')
    return false
  }

  const commitSave = async () => {
    // ⛔ S1/H14: the last line of defence -- a locked note never reaches the wire.
    if (!editor || isUnreadable(editor)) return
    saveTimerRef.current = null
    retryTimerRef.current = null

    const bodyJson = editor.getJSON()
    // ⛔⛔ B1: the level of whoever WROTE these words, read in the same instant
    // as the words — recovered words keep their writer's level.
    const writtenSchema = editorWrittenSchema()
    const carriedAtSend = carriedRef.current
    const last = lastSavedRef.current
    // ⛔⛔ D3b fix round 1, residual (b) — A BASE WITH NO BODY PROVES NOTHING
    // ABOUT THE TITLE EITHER, so the title and subtitle are sent as they stand.
    // ⚰️ A revision-only base (`baseOfRecovered`: the revision the words were
    // written on, content unknown) reads `''` for both, so a Restore whose copy
    // CLEARED the title sent no title at all; with the server unmoved the PUT was
    // a 200 and the old title stayed — the member's clear was silently dropped.
    // ⭐ Keyed on the missing BODY, not on a flag, because the flag cannot survive
    // the durable store: `snapshotOfServerCopy` (frozen) keeps no `bodyUnknown`,
    // so the next session rebuilds the same base without it. And it is harmless
    // wherever the server's body really is null: under compare-and-set, sending
    // the fields as they stand writes nothing but what the member holds, on the
    // revision the base names. The body is always sent against a null one anyway.
    // ONE authority (lib/offline/recoverLocalState.baseHasNoBody), shared with
    // `queuedWorkToAdopt`: both decisions key on the same missing body.
    const baseUnknown = baseHasNoBody(last)
    const titleChanged = baseUnknown || title !== last.title
    const subtitleChanged = baseUnknown || (subtitle || '') !== (last.subtitle || '')
    const bodyChanged = JSON.stringify(bodyJson) !== JSON.stringify(last.bodyJson)
    if (!titleChanged && !subtitleChanged && !bodyChanged) {
      setSaveStatus('saved')
      retryAttemptsRef.current = 0
      return
    }
    const patch = {}
    if (titleChanged) patch.title = title
    if (subtitleChanged) patch.subtitle = subtitle || null
    if (bodyChanged) patch.bodyJson = bodyJson
    // Compare-and-set baseline (A15): the server 409s instead of letting this
    // full-doc PUT silently delete a write that landed after our baseline.
    if (isUsableBaseline(last.updatedAt)) patch.baseUpdatedAt = last.updatedAt

    setSaveStatus(retryAttemptsRef.current === 0 ? 'saving' : 'reconnecting')
    // ⛔⛔ RAISE THE IN-FLIGHT MARKER BEFORE THE PUT, AND AWAIT IT.
    //
    // ⚰️ 2026-09-10: the self-fork fix shipped `settleLandedSave` into
    // `restoreDraft` and NOT into this function — the debounced autosave every
    // keystroke reaches, and the only path the defect actually rides. Eleven
    // rails and four mutations exercised the FUNCTION; nothing exercised the
    // WIRE, so the suite was green and the fix was not on the path. It
    // reproduced on the rig eight minutes after going live.
    //
    // The marker is what lets the drain decline a note whose answer has not come
    // back yet — the one fact it could never derive, because it lived in this
    // promise, inside a component the member may already have navigated away
    // from. ⛔ Awaited: a marker written after the request is one the drain can
    // miss, which is the whole defect in miniature.
    // ⛔ ISSUED BEFORE THE PUT, AND DELIBERATELY NOT AWAITED.
    //
    // ⚰️ It WAS awaited, and the existing rails rejected it — correctly. Awaiting
    // couples the member's ability to save to IndexedDB being responsive: a
    // blocked upgrade or a stalled store would stop saves outright, and to a
    // member whose network is fine it would look like the network was down.
    // "A save must not wait on bookkeeping" is a rule this file already lives
    // by, and it does not stop applying because the bookkeeping is mine.
    //
    // ⭐ ORDER IS WHAT MATTERS, NOT COMPLETION. The put is issued first and
    // commits in ~1 ms; the PUT it precedes takes ~111 ms at p50 (measured
    // 2026-09-10, n=30). So the marker is in the store long before a 409 could
    // come back, in every ordering anyone has observed.
    // ⛔ AND WHERE IT IS NOT, THAT IS GUARD 2's JOB — the 409 self-supersede
    // asks the SERVER and needs nothing to have worked beforehand. The marker
    // is an optimisation that saves a round trip; it was never the guarantee.
    beginInFlightSave({ accountId: user?.id, noteId, baseUpdatedAt: patch.baseUpdatedAt })
    // ⛔ WHO LOWERS THE MARKER. On success `settleLandedSave` lowers it after it
    // has settled the record — that order matters: a drain reading in between
    // sees a note still marked in-flight, declines, and takes it next pass,
    // whereas the reverse order opens a window with the marker down and the
    // record not yet settled. On failure nothing settles, so the fallback below
    // lowers it instead. Hence the flag rather than an unconditional `finally`.
    let settleStarted = false
    // S2: on the wire from here until the `finally` below, which lowers it on
    // every exit. Raised immediately before the `try` so nothing can throw
    // between the two and leave it up for the rest of the session.
    saveInFlightRef.current = true
    try {
      let saved
      try {
        // B1: the words go out at their WRITER's level (see `writtenSchema` above).
        saved = await update(patch, { writtenSchema })
      } catch (e) {
        // ⛔⛔ B1: THE SCHEMA REFUSAL IS NOT A CONFLICT. The same words from the same
        // writer are refused again, so the reconcile-and-retry below would only
        // walk the member back into "…Reload to edit it." — the sentence that sent
        // them here. Preserve both instead, whatever the retry budget says; a
        // failure to do so is rethrown, surfaces as the non-retryable error below,
        // and the words stay in the durable copy and the queue.
        if (isSchemaRefusal(e)) {
          if (await keepRefusedWords(carriedAtSend)) return
          throw e
        }
        if (e?.status !== 409 || conflictRetriedRef.current) throw e
        conflictRetriedRef.current = true
        let outcome
        try {
          outcome = await reconcileConflict({ title, subtitle, bodyJson })
        } catch (re) {
          console.warn('conflict reconcile failed', re)
          throw e          // surfaces as a non-retryable save error below
        }
        // ⭐⭐ D3b fix round 1, residual (a) — THE SERVER ALREADY HOLDS EXACTLY
        // WHAT THIS PUT CARRIED: it landed, one revision later (another tab's
        // sweep sent the same queued words). Settled below by the SAME lines as a
        // 200 — one settle for a landing, never a second copy of it.
        if (outcome?.landed) {
          saved = outcome.landed
        } else {
          // ⛔ A FORK IS A RESOLUTION, NOT A REASON TO TRY AGAIN. Retrying
          // after one would push the local document over the server version
          // the fork exists to protect — the exact overwrite this gate closes.
          if (outcome) retryTimerRef.current = setTimeout(() => commitSaveRef.current(), 50)
          return
        }
      }
      // ⛔ B1: LANDED — the server accepted these words at their writer's level
      // (or, via `outcome.landed`, already held them), so they are the server's
      // copy now and the next keystroke is this editor's own. Only if they are
      // still what is on screen: a view swap or a new recovery during the PUT is
      // a different body with its own writer.
      // (Read BEFORE `captureLocalState` below, whose stamp this decides.)
      if (carriedRef.current === carriedAtSend) carriedRef.current = OWN_READ
      lastSavedRef.current = {
        title, subtitle, bodyJson,
        updatedAt: usableBaseline(saved?.updatedAt, lastSavedRef.current.updatedAt),
      }
      // Wave Q1: the server now holds `bodyJson`. ⛔ `current` is read AGAIN
      // here rather than reusing what we sent: if the member typed during the
      // PUT, the durable copy is ahead of this ack and its sync intent must
      // SURVIVE — an acknowledgement of older words has never been permission
      // to forget newer ones.
      const ackedNow = { title, subtitle, bodyJson }
      const currentNow = captureLocalState() || ackedNow
      durableRef.current.markSynced({
        acked: ackedNow, current: currentNow, updatedAt: lastSavedRef.current.updatedAt,
      })
      // ⛔⛔ AND THE MOUNT-INDEPENDENT SETTLE — THE LINE THAT WAS MISSING HERE.
      // `markSynced` routes through the hook's writer ref and does nothing once
      // this component is gone, and this promise resolves after the member has
      // navigated away often enough to matter. Navigating away is exactly when
      // the note leaves `excludeNoteId` and becomes the sweep's.
      // ⛔ Not awaited: a save must not wait on bookkeeping, and it never throws.
      // Idempotent with `markSynced` — both settle to the same landed baseline,
      // and this one also lowers the in-flight marker in the same write.
      settleStarted = true
      settleLandedSave({
        accountId: user?.id, noteId,
        acked: ackedNow, current: currentNow,
        updatedAt: lastSavedRef.current.updatedAt,
      })
      conflictRetriedRef.current = false
      setSaveStatus('saved')
      setSaveErrorMsg('')
      retryAttemptsRef.current = 0
      // The embeds this save just persisted are safe — consume their inbox rows.
      consumePlacedCaptures()
      // Wave 0 (P1-10): the server now has this content — the local safety
      // net for it is no longer needed.
      clearDraftLocally()
    } catch (e) {
      const status = e?.status
      // A 409 reaches here only when it was not reconciled above: a second one
      // in this conflict budget, a reconcile that failed, or a B1 schema
      // refusal whose preserve-both step failed (all handled in the inner catch
      // around `update`) — every one surfaces as a non-retryable save error below.
      // No status = network/fetch error; 5xx = backend down or restarting.
      // Both are worth retrying. 4xx = real client/validation error — won't
      // get better on retry, so surface immediately.
      const retryable = !status || status >= 500
      if (!retryable) {
        console.error('autosave failed (non-retryable)', e)
        setSaveStatus('error')
        setSaveErrorMsg(friendlySaveError(e, status))
        retryAttemptsRef.current = 0
        reportSaveFailed(e, false)
        return
      }
      const attempt = retryAttemptsRef.current
      if (attempt === 0) reportSaveFailed(e, true)
      const delay = RETRY_BACKOFFS_MS[Math.min(attempt, RETRY_BACKOFFS_MS.length - 1)]
      retryAttemptsRef.current = attempt + 1
      console.warn(`autosave failed (retry ${attempt + 1} in ${delay}ms)`, e)
      setSaveStatus('reconnecting')
      setSaveErrorMsg(friendlySaveError(e, status, { retrying: true }))
      retryTimerRef.current = setTimeout(() => commitSaveRef.current(), delay)
    } finally {
      // ⛔ A FAILED SAVE MUST NOT LEAVE THE NOTE UNSWEEPABLE. Without this a
      // 500, a dropped connection or a non-retryable 4xx would pin the marker
      // up until the TTL expires, and the member's queued work would sit there
      // for that whole span. `finally`, not the catch tail, because this
      // function returns early from four places inside it.
      // ⛔ This repo has twice shipped a cleanup that lived only on the success
      // branch; the second one was found this morning, in the rig.
      if (!settleStarted) endInFlightSave({ accountId: user?.id, noteId })
      saveSettled()
    }
  }

  // Keep latest-callback refs pointed at the freshest closures every render.
  // Anything that captured these earlier (TipTap onUpdate, scheduled timeouts,
  // unmount cleanup) will dereference through the ref and get the current
  // title/subtitle — fixing the "first keystroke not saved" + "body save
  // clobbers title" + "unmount saves stale empty values" bugs.
  scheduleAutosaveRef.current = scheduleAutosave
  commitSaveRef.current = commitSave

  // Save on unmount if dirty.
  useEffect(() => () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      commitSaveRef.current()
    }
  }, [])

  // Slash menu's "Image" option dispatches this event so we can open the
  // native file picker from outside the editor's React tree.
  // ⛔ Wave 6 fix round 1, I5 — listens on THIS editor's own DOM root
  // (`editor.view.dom`), never `window`: SlashMenu.jsx now dispatches on the
  // exact editor instance the command ran against, so with two panes open
  // only the editor a member actually typed the slash command in ever hears
  // its own request. A second mounted editor's identical listener on the
  // SAME shared target (`window`) is exactly how an image picked from the
  // side pane used to land in the main note.
  //
  // ⛔⛔ Wave 6 fix round 5, R5-1 — `editor.view` IS A THROWING GETTER. With no
  // EditorView (not mounted yet, or unmounted/destroyed) tiptap returns a Proxy
  // whose `get` trap THROWS "The editor view is not available. Cannot access
  // view['dom']" — never `undefined` — so `editor?.view?.dom` walked straight
  // into it (optional chaining guards a null LEFT side only), and the route
  // ErrorBoundary replaced the whole editor on about half of all note-opens
  // (live walk on 7006f1504). Same hazard NoteFindBar.jsx:63 already names.
  // `editor.isDestroyed` is tiptap's own `editorView?.isDestroyed ?? true`, so
  // it is false EXACTLY when a live view exists: read `.view` only past it.
  // ⛔ And a guard alone is half a fix: this effect runs once per editor, so an
  // editor whose view mounts AFTER it would never get the listener and the
  // Image item would silently do nothing. Attach now if the view exists, and
  // again on tiptap's own `mount`/`create`; detach on `unmount`.
  useEffect(() => {
    if (!editor) return undefined
    const onOpenPicker = () => fileInputRef.current?.click()
    // Wave 7 lane H1: the slash menu's "Dictate" item, on the SAME per-editor
    // target and for the same reason — with two panes open, only the pane the
    // command ran in may start listening. `start()` refuses where a click on
    // the mic would do nothing; that is said, never silent.
    const onDictate = () => {
      if (micRef.current?.start?.()) return
      setChromeMsg("Dictation isn't available right now")
    }
    // Wave 7 lane H2: the slash menu's "Writing help", same per-editor target.
    const onWritingHelp = () => openWritingHelp()
    // Wave 11 lane 11A: the slash menu's "Voice note", same per-editor target.
    const onVoiceNote = () => openVoiceNote()
    // Wave 11 lane 11D: the slash menu's "Trade-plan canvas", same per-editor target.
    const onTradeCanvas = () => { createLinkedCanvas() }
    let dom = null
    const detach = () => {
      if (dom) {
        dom.removeEventListener('uct:notebook-open-image-picker', onOpenPicker)
        dom.removeEventListener(DICTATE_EVENT, onDictate)
        dom.removeEventListener(WRITING_HELP_EVENT, onWritingHelp)
        dom.removeEventListener(VOICE_NOTE_EVENT, onVoiceNote)
        dom.removeEventListener(CANVAS_EVENT, onTradeCanvas)
      }
      dom = null
    }
    const attach = () => {
      if (editor.isDestroyed) return   // no live view: `editor.view` would throw
      const next = editor.view.dom
      if (next === dom) return
      detach()
      dom = next
      dom.addEventListener('uct:notebook-open-image-picker', onOpenPicker)
      dom.addEventListener(DICTATE_EVENT, onDictate)
      dom.addEventListener(WRITING_HELP_EVENT, onWritingHelp)
      dom.addEventListener(VOICE_NOTE_EVENT, onVoiceNote)
      dom.addEventListener(CANVAS_EVENT, onTradeCanvas)
    }
    attach()
    editor.on('mount', attach)
    editor.on('create', attach)
    editor.on('unmount', detach)
    return () => {
      editor.off('mount', attach)
      editor.off('create', attach)
      editor.off('unmount', detach)
      detach()
    }
  }, [editor])

  const onHeroChange = async () => {
    // Hero update already persisted by HeroImagePicker — refresh local copy.
    await refresh()
  }

  /**
   * ⛔⛔ A METADATA CHANGE MOVES `updatedAt` TOO — AND THAT INVALIDATES A
   * QUEUED BASELINE JUST AS A BODY SAVE DOES.
   *
   * ⚰️ Found 2026-09-10 by the derived wire rail, not by reading: changing a
   * folder, ticker or tag while offline work sits in the outbox advances the
   * server revision, so the queued entry's baseline goes stale and its next
   * send 409s. Same mechanism as the self-fork, reached by a different door —
   * and it is precisely the door a hand-written list of "save paths" misses,
   * because these three do not look like saves.
   *
   * ⛔ `acked` IS THE SERVER'S COPY, NOT THE LOCAL ONE. Passing the local state
   * as both sides would read as "caught up" and DELETE the member's queued
   * work — the metadata PUT never carried their body. Server-as-acked means:
   * still ahead ⇒ REBASE onto the new revision; genuinely caught up ⇒ clear.
   *
   * ⛔⛔ AND ONLY WHEN THE SERVER'S COPY MOVED BY METADATA ALONE (wave 6 D fix
   * round 1). ⚰️ This settled whatever the door's answer held. When another
   * device had written words after this editor loaded, `acked` carried THEIR
   * body and `current` this editor's older one, so the settle queued the older
   * body as "unsent work" ON THE NEW REVISION — and a drain after the note
   * closed sent it with a matching base: a 200, no 409, no fork, the other
   * device's words gone (NoteEditorPage.metadataSettle.test.jsx, measured). A
   * block the server appended (a Send-to-Journal capture) went the same way.
   * The reconcile's own authority decides: METADATA_ONLY settles; anything else
   * records the landing and stops, and the next save 409s into the reconcile,
   * which merges an append and forks a rewrite.
   */
  const serverMovedMetadataOnly = (saved) => (
    classifyServerChange(saved, lastSavedRef.current) === METADATA_ONLY
  )
  const settleMetadataRevision = async (saved) => {
    if (!saved?.updatedAt) return
    // ⛔ ALWAYS record the landing FIRST. This PUT was ours, so its revision is
    // ours, and that is true whether or not we can settle the queue. Withholding
    // it made guard 2 answer "not ours" about our own write and fork the note.
    await recordLandedRevision({ accountId: user?.id, noteId, updatedAt: saved.updatedAt })
    if (!serverMovedMetadataOnly(saved)) return
    const current = captureLocalState()
    // ⛔⛔ NULL IS "NO EVIDENCE", NOT "CAUGHT UP" — AND THE DIFFERENCE COST A
    // MEMBER'S WORDS.
    //
    // ⚰️ 2026-09-10, streak run 1, door `folder`. This read
    // `current: captureLocalState() || saved`. When the editor could not report
    // its local state, `current` fell back to `saved` — which IS `acked` — so
    // `sameAuthoredContent` read "caught up", the intent became null, and
    // `putNoteWithIntent` DELETED every queued entry for the note. The offline
    // sentence was gone. The drain's own step stayed green throughout, because
    // "the server holds text" is satisfied by the words typed ONLINE.
    //
    // ⛔ THE INVARIANT: a queued entry is never removed unless the server body
    // is PROVEN to contain its content. Absence of local state proves nothing.
    //
    // ⭐ REFUSING IS SAFE, and that is why it is the right answer: the entry
    // stays queued on its own baseline, the drain picks it up, and guard 2
    // rebases it onto the revision this door just created. Doing nothing here
    // costs one drain cycle; guessing here costs the member their work.
    if (!current) return
    await settleLandedSave({
      accountId: user?.id, noteId,
      acked: saved,
      current,
      updatedAt: saved.updatedAt,
    })
  }

  const onFolderChange = async (folderId) => {
    await settleMetadataRevision(await update({ folderId: folderId || null }))
  }
  // The Ticker field is checked against the server's rule BEFORE it is sent, and a refusal is
  // said in a SaveFailed sentence with the field put back -- see lib/noteTicker.js for the
  // uncaught 400 this replaced.
  const onTickerChange = async (raw) => {
    const saved = note?.ticker || ''
    const restore = () => { if (tickerInputRef.current) tickerInputRef.current.value = saved }
    const { ticker, error } = normalizeNoteTicker(raw)
    if (error) {
      setTickerFailure(error)
      restore()
      return
    }
    if ((ticker || '') === saved) {
      if (tickerInputRef.current) tickerInputRef.current.value = saved
      return
    }
    try {
      setTickerFailure(null)
      await settleMetadataRevision(await update({ ticker }))
      if (tickerInputRef.current) tickerInputRef.current.value = ticker || ''
    } catch {
      setTickerFailure("Couldn't change the ticker. Nothing changed.")
      restore()
    }
  }
  // Wave 6 items 9 + 12: a tag change is the member's DELTA, applied to the
  // list the SERVER holds -- never a list this page loaded earlier, which would
  // undo a bulk change made in another tab. When the read below fails nothing
  // is sent: a change that could not be checked is never written.
  // lib/tagDelta.js has the rule.
  // ⭐ Wave 7 (M14): the delta itself goes to PATCH /notes/{id}/tags, which
  // applies it inside ONE transaction -- the read no longer supplies the list
  // that is written (a second device's change between the read and the write
  // survives). The read decides only "nothing to send". Whether the answer's
  // revision is OURS is the server's to say: the route answers `changed`
  // (lane J, J9) and `useJ2Note.patchTags` hands back the note only when THIS
  // request wrote it, null otherwise -- so a no-op answered at another
  // writer's revision is never recorded as ours below.
  const [tagsBusy, setTagsBusy] = useState(false)
  // ⛔ Wave 10 F7 (Part A, 5d): a failed tag write said so in the 2.4 s chrome message, gone by
  // the time a member looked back -- the proof walk read it SILENT at 6 s. It is a SaveFailed
  // sentence now, and the answer (false) lets the field give the typed tag back.
  const tagFailure = (delta) => (delta?.add?.length
    ? "Couldn't add that tag. Nothing changed."
    : "Couldn't remove that tag. Nothing changed.")
  const applyTagDelta = async (delta) => {
    // (One change at a time: the field is `busy` -- disabled -- until this settles.)
    setTagsBusy(true)
    try {
      let serverTags
      try {
        const res = await fetch(`/api/j2/notes/${encodeURIComponent(noteId)}`, { credentials: 'include' })
        if (!res.ok) throw new Error(String(res.status))
        const body = await res.json()
        serverTags = Array.isArray(body?.note?.tags) ? body.note.tags : []
      } catch {
        setTagWriteFailure(tagFailure(delta))
        return false
      }
      const next = mergeTagDelta(serverTags, delta)
      // ⛔ M14 (wave 6 fix round 1): nothing to send -- but the server's list
      // differs from the chips on screen (they did not show the tag the member
      // just added), so re-read the note and let the chips catch up.
      if (sameTagList(next, serverTags)) { refresh?.(); setTagWriteFailure(null); return true }
      await settleMetadataRevision(await patchTags(delta))
      refreshTagNodes()
      setTagWriteFailure(null)
      return true
    } catch {
      setTagWriteFailure(tagFailure(delta))
      return false
    } finally {
      setTagsBusy(false)
    }
  }

  // ⛔⛔ DUPLICATE — no such action existed anywhere in the product (grepped
  // this header, NoteCard.jsx, NotebookTab.jsx: zero clone/duplicate path).
  // Notion: right-click any page -> Duplicate. Evernote: right-click ->
  // Duplicate Note. Competitive audit finding UX #12, 2026-09-22.
  // ⛔ Clones the SAVED note (title/subtitle/bodyJson/tags/ticker/
  // folderId/propertiesJson), not the live unsaved editor buffer -- a
  // member with unsaved edits duplicates what the note IS, not a draft
  // they haven't committed to it yet. Routes through the shared
  // `createNoteViaApi` (already used by every other creation path in
  // NotebookTab.jsx/noteCreation.js), then opens the new note through the
  // app's ONE routing idiom for a note (`applyTargetToParams`, same as the
  // CapturedSourceSheet "open owning note" door above) -- never a second
  // route shape or a full page navigation.
  const [duplicating, setDuplicating] = useState(false)
  const onDuplicate = async () => {
    if (duplicating) return
    setDuplicating(true)
    try {
      const created = await createNoteViaApi({
        title: note.title ? `Copy of ${note.title}` : 'Copy of Untitled',
        subtitle: note.subtitle || undefined,
        bodyJson: note.bodyJson,
        tags: note.tags,
        ticker: note.ticker || undefined,
        folderId: note.folderId || undefined,
        properties: note.propertiesJson || undefined,
      })
      // Same predicate NotebookTab's own refreshSidebarCounts uses -- the
      // sidebar's note lists (All notes/Recents/per-folder) are OTHER
      // components' SWR hooks, unreachable from here except through the
      // shared global cache.
      globalMutate((key) => typeof key === 'string' && key.startsWith('/api/j2/notes'))
      setSearchParams((prev) => applyTargetToParams(prev, { noteId: created.id, depth: 'note' }))
    } catch (e) {
      console.error('[notebook] duplicate failed', e)
    } finally {
      setDuplicating(false)
    }
  }

  // Wave B: native confirm() replaced with the shared ConfirmModal (G-103) —
  // request opens the modal, confirm performs the actual mutation. Wave 0
  // trash: this is a soft delete, restorable from the sidebar's Trash entry
  // for 30 days, so the copy stays proportional rather than "permanently".
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const onDeleteRequest = () => setConfirmingDelete(true)
  // ⛔ Wave 10 F7 (Part A, 5d): a failed trash said so via `chromeMsg`, which auto-dismisses
  // 2.4s after it is set (see the effect above) -- gone long before the proof walk's own
  // 6s wait looked, and gone well before a member who glanced away would look back. Read
  // SILENT under BOTH a forced 500 and a forced-offline DELETE. `trashFailure` is the same
  // "stays until dismissed" SaveFailed slot favorite/tag already use -- one write, one slot.
  // Rail: a11y/silentFailures.test.jsx / NoteEditorPage.unsentTrash.test.jsx.
  const [trashFailure, setTrashFailure] = useState(null)
  useEffect(() => { setTrashFailure(null) }, [noteId])
  const trashNow = async () => {
    let res = null
    try {
      res = await fetch(`/api/j2/notes/${noteId}`, {
        method: 'DELETE', credentials: 'include',
      })
    } catch { res = null }
    if (res?.ok) {
      // This note's target status just flipped active -> trashed -- same
      // "a noteLink chip elsewhere in this tab is now stale" class as a
      // rename (Wave D closure pass finding), so the same cache-bust applies.
      invalidateNoteLinkTarget(noteId)
      setTrashFailure(null)
      // Wave 8 (8A): say WHICH note went, so the list can put focus on the
      // row after it (NotebookTab.closeNote).
      onBack({ trashed: noteId })
      return
    }
    // ⛔ M15 (wave 6 fix round 1): a refused or dropped Delete says so -- a fixed
    // sentence, never the server's words. It used to do nothing at all, so
    // "Trash anyway" closed its dialog and the note simply stayed.
    // ⛔ NEVER TRASHED. `res?.ok` was never true, so the note this editor is
    // showing was never removed from the server or navigated away from --
    // there is no optimistic removal on this path to roll back, only the
    // member's belief that Delete worked, which this sentence corrects.
    setTrashFailure('Couldn’t move this note to the Trash. Nothing changed.')
  }

  // ⛔ Wave 6 item 11 — A NOTE STILL HOLDING UNSENT WORDS IS NOT TRASHED UNASKED.
  // Trashing first sent its queued PUT to a trashed note: a 404, retired as
  // blocked, on a card that never shows the blocked badge -- words stranded.
  // The RAW signal decides (holdsUnsentWork: the door-guard mode cannot hide a
  // dirty or queued note), and UnsentTrashDialog names what is unsent and
  // offers Send first or Trash anyway.
  const [unsentTrash, setUnsentTrash] = useState(null) // null | { what, sending, still }
  // One store connection per question, closed afterwards (noteBatch's rule).
  const unsentVerdict = async () => {
    let opened = null
    const connect = (acct) => { opened = Promise.resolve(openNotebookDb(acct)); return opened }
    try {
      return await noteHasUnsentWork(noteId, { accountId: user?.id, connect })
    } finally {
      if (opened) opened.then((db) => db?.close?.()).catch(() => {})
    }
  }
  /**
   * ⛔⛔ FX2 (wave 10, proof-walk item 3): `cur.bodyJson` is
   * `editorRef.current.getJSON()` -- ProseMirror's OWN serialization, which
   * fills in every node/mark's declared attribute defaults (a table cell's
   * `colspan`/`rowspan`/`colwidth`, and the same shape for callouts, task
   * items and block-math). `last.bodyJson` was never round-tripped through
   * that schema -- it is the RAW JSON the server returned on load, which for
   * a note authored with minimal attrs (most imports, and every fixture in
   * this program's own seed data) never carried those defaults at all. Two
   * documents describing the SAME content then serialize to two DIFFERENT
   * JSON strings, and a note that was never edited reads as "the note's
   * text" is unsent -- reached live, on a note with a table, a code block, a
   * block-math node, a callout or a task list, immediately after opening it
   * and choosing Delete: the FIRST confirm produced "This note has words the
   * server doesn't have yet" instead of trashing it. Reproduced for every one
   * of those five node types (`docs/notebook/proof/fx2-<sha>/repro4-*.json`);
   * a bare paragraph or heading was never affected, because neither node
   * declares an attribute with a default.
   *
   * The fix compares like with like: `last.bodyJson` is parsed through the
   * SAME schema and re-serialized ONCE before the comparison, so both sides
   * carry the same filled-in defaults. Never throws -- a body the schema
   * cannot parse (a truly stale/incompatible shape) falls back to the RAW
   * value, which is exactly today's comparison and therefore never a new
   * failure mode, only a narrower one.
   *
   * ⛔⛔ ATTRIBUTE DEFAULTS ARE NOT THE ONLY GAP `nodeFromJSON` LEAVES.
   * StarterKit's TrailingNode extension appends an empty paragraph via
   * `appendTransaction` -- a PLUGIN hook, which only runs on a dispatched
   * transaction, never on a bare `Schema.nodeFromJSON` parse -- whenever the
   * doc's last node is not already a paragraph (a table, a code block, a
   * block-math node, a callout, a task list: measured live, every one of
   * them). So `editorRef.current.getJSON()` (`cur.bodyJson`) carries that
   * trailing paragraph the moment the editor mounts, and a schema-only parse
   * of the server's raw JSON never will. `stripTrailingEmptyParagraph`
   * normalizes it away on BOTH sides (symmetric, so it costs nothing when
   * neither side has one) rather than re-deriving TrailingNode's own rule
   * (which node types need one) -- a second copy of that rule would drift
   * the moment the editor's own trailing-node config changes.
   */
  const canonicalBodyJson = (json) => {
    try {
      const schema = editorRef.current?.schema
      if (!schema || json == null) return json
      return schema.nodeFromJSON(json).toJSON()
    } catch {
      return json
    }
  }
  /**
   * What the EDITOR holds that the server's last copy does not -- the one
   * answer both the Delete gate and its dialog ask.
   *
   * ⛔ M9 (wave 6 fix round 1): the durable store is not the only witness. Its
   * write is debounced (~200 ms), so a word typed a moment ago is in the editor
   * and nowhere else; a store that answers "clean" at that instant proves
   * nothing, the note was trashed, and the unmount autosave then PUT to a
   * trashed note and got a 404. Unknown (a base with no body) is not "ahead".
   */
  const unsentInEditor = () => {
    const cur = captureLocalState()
    const last = lastSavedRef.current
    const parts = []
    if (cur && !baseHasNoBody(last)) {
      if ((cur.title || '') !== (last.title || '')) parts.push('the title')
      if ((cur.subtitle || '') !== (last.subtitle || '')) parts.push('the subtitle')
      const curBody = stripTrailingEmptyParagraph(cur.bodyJson)
      const lastBody = stripTrailingEmptyParagraph(canonicalBodyJson(last.bodyJson))
      if (JSON.stringify(curBody) !== JSON.stringify(lastBody)) parts.push('the note’s text')
    }
    return parts
  }
  const holdsUnsent = (verdict) => holdsUnsentWork(verdict) || unsentInEditor().length > 0
  const describeUnsent = (verdict) => {
    const parts = unsentInEditor()
    if (parts.length) return `Not on the server yet: ${parts.join(', ')}.`
    if (verdict?.why === 'unreadable') return 'This device could not check whether every edit to this note reached the server.'
    if (verdict?.why === 'queued') return 'Edits made to this note earlier on this device are still waiting to send.'
    return 'Edits to this note are still waiting to send.'
  }
  const onDeleteConfirm = async () => {
    // Write what is typed to the durable copy NOW (it no longer waits out the
    // debounce), so a "Trash anyway" can never outrun it.
    durableRef.current.flush()
    const verdict = await unsentVerdict()
    if (holdsUnsent(verdict)) {
      setUnsentTrash({ what: describeUnsent(verdict), sending: false, still: false })
      return
    }
    await trashNow()
  }
  const sendThenTrash = async () => {
    setUnsentTrash((u) => (u ? { ...u, sending: true, still: false } : u))
    try { await commitSaveRef.current() } catch { /* the save reports its own failure */ }
    // The landed save settles the durable copy without being awaited, so ask
    // again a few times before saying it is still sending.
    let verdict = null
    for (let i = 0; i < 5; i += 1) {
      verdict = await unsentVerdict()
      if (!holdsUnsent(verdict)) break
      await new Promise((r) => setTimeout(r, 200))
    }
    if (holdsUnsent(verdict)) {
      setUnsentTrash({ what: describeUnsent(verdict), sending: false, still: true })
      return
    }
    setUnsentTrash(null)
    await trashNow()
  }
  const trashAnyway = async () => {
    setUnsentTrash(null)
    await trashNow()
  }
  // ⭐ Wave 7 (M-9): "Save as template" copies the SERVER's copy of the note,
  // so words still inside the autosave window (or queued) would be missing from
  // the template while the note keeps them. The note menu asks this first: send
  // what is pending NOW, then confirm nothing is left unsent -- the same
  // witnesses the Delete gate asks (`holdsUnsent`). -> true when the server
  // holds everything this editor has.
  const sendPendingEdits = async () => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    durableRef.current.flush()
    try { await commitSaveRef.current() } catch { /* the save reports its own failure */ }
    // The landed save settles the durable copy without being awaited, so ask
    // again a few times before saying something is still unsent.
    for (let i = 0; i < 5; i += 1) {
      if (!holdsUnsent(await unsentVerdict())) return true
      await new Promise((r) => setTimeout(r, 200))
    }
    return false
  }

  // ⭐⭐ Ruling D-G5 (wave 7 whole-branch fix, frontend review I-3) — A CLEAN OPEN EDITOR RE-READS
  // ITS NOTE WHEN THE MEMBER COMES BACK, AND ADOPTS A NEWER SERVER COPY.
  //
  // ⚰️ The editor adopted a server body only when the note id changed, and the single-note SWR does
  // not revalidate on focus. So after a personal-API or email-in append (no client, nothing told
  // this tab), the member's next keystroke saved against the pre-append base, 409'd, and the
  // classifier -- F5-frozen, merging only widgetEmbed / financialFact / documentExcerpt -- read the
  // appended paragraph as a BODY_REWRITE and FORKED a note whose tab held no unsent words at all.
  //
  // On `visibilitychange` (to visible) or window `focus`, an editor that is CLEAN re-reads the note
  // and, when the server's revision is NEWER than its own baseline, adopts it through
  // `adoptServerCopy` -- the path a version restore takes. CLEAN is every witness the Delete gate
  // asks, plus the save machinery: nothing typed since the last landed save (`unsentInEditor`), no
  // save pending, retrying or on the wire, no recovery decision on screen, and nothing unsent for
  // the note by the offline layer's own predicate (`noteHasUnsentWork`: not dirty, nothing queued;
  // an unreadable store is not known to be clean). The sync half is asked again after the read, so
  // a word typed while it was on the wire keeps today's behaviour.
  //
  // ⛔ An editor HOLDING unsent words is untouched: its save 409s and the note forks, never
  // clobbered. ⛔ No F5-frozen file is involved; the revision is ANOTHER writer's, so it is not
  // recorded as landed. Rail: NoteEditorPage.cleanReread.test.jsx.
  const rereadInFlightRef = useRef(false)
  const rereadCleanNoteRef = useRef(null)
  rereadCleanNoteRef.current = async () => {
    const ed = editorRef.current
    const editorIsClean = () => Boolean(
      ed && editorRef.current === ed && !ed.isDestroyed && ed.isEditable && !isUnreadable(ed)
      && hydratedRef.current && !saveTimerRef.current && !retryTimerRef.current
      && !saveInFlightRef.current && unsentInEditor().length === 0,
    )
    if (rereadInFlightRef.current || !noteId || pendingAdoption || pendingDraft || !editorIsClean()) return
    rereadInFlightRef.current = true
    try {
      if (holdsUnsentWork(await unsentVerdict())) return
      const fresh = (await refresh())?.note
      if (!fresh || fresh.id !== noteId || !editorIsClean()) return
      // Our baseline is older than the server's revision -- PARSED, never string-compared, and an
      // unparseable revision on either side is not newer (lib/offline/baseline.js).
      if (!isSupersededBaseline(lastSavedRef.current.updatedAt, fresh.updatedAt)) return
      const { from, to } = ed.state.selection
      adoptServerCopy(fresh)
      // The caret stays where the member left it (clamped into the new document), so the next
      // keystroke lands there rather than wherever a whole-document swap put it. Focus untouched.
      try {
        const size = ed.state.doc.content.size
        const $at = (p) => ed.state.doc.resolve(Math.max(0, Math.min(size, p)))
        ed.view.dispatch(ed.state.tr.setSelection(TextSelection.between($at(from), $at(to))))
      } catch { /* a caret that cannot be placed is left where the swap put it */ }
    } catch {
      /* a failed re-read changes nothing: the next save reconciles exactly as it always did */
    } finally {
      rereadInFlightRef.current = false
    }
  }
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState !== 'hidden') rereadCleanNoteRef.current?.() }
    const onFocus = () => { rereadCleanNoteRef.current?.() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  if (isLoading) {
    // Wave B (G-106 adoption): a skeleton approximating the note page's own
    // layout (title, then body lines) — reduces layout shift vs. a bare
    // spinner and matches every other high-frequency structural load's
    // treatment in this wave.
    return (
      <div className={styles.loading} role="status" aria-label="Loading…">
        <SkeletonLine width="45%" height={26} />
        <div style={{ height: 20 }} />
        <SkeletonLine width="92%" height={14} />
        <SkeletonLine width="88%" height={14} />
        <SkeletonLine width="70%" height={14} />
      </div>
    )
  }

  // P0-2 fix: `error` is real and returned by useJ2Note, but was never
  // consumed here -- so a failed fetch (transient network blip, a stale
  // link to a deleted note, anything) left `note` permanently null while
  // `isLoading` settled false, and the page hung on "Loading…" forever
  // with no way forward. `noteId` is always truthy for every real mount of
  // this component (NotebookTab only renders it once a note is selected),
  // so once loading has settled, `!note` here always means the fetch
  // failed -- never a normal transient state -- and is the right signal to
  // branch on (unlike `loadError` alone, which SWR can also set on a LATER
  // background revalidation failure while a perfectly good `note` from an
  // earlier successful fetch is still on screen; that case must keep
  // rendering the note, not this error card).
  if (!note) {
    return (
      <div className={styles.loadError} role="alert">
        <p>Couldn't load this note.</p>
        <p className={styles.loadErrorHint}>
          Nothing here has been changed or lost — this looks like a connection
          problem, not a save problem.
        </p>
        <div className={styles.loadErrorActions}>
          <button type="button" className="btn btn-primary" onClick={refresh}>
            Try again
          </button>
          {showBack && (
            <button type="button" className="btn btn-ghost" onClick={onBack}>
              ← Notebook
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page} ref={pageRef} onKeyDown={onPageKeyDown}>
      {/* Final-review fix I-1: where an existing note's open puts focus. A
          heading, not a field, named by the note's title; visually hidden (the
          title input below shows the same words), and the pane's ring shows
          where focus went for a keyboard open (NotebookTab.module.css,
          `.notePane:has([data-note-landmark]:focus-visible)`). */}
      <h2 ref={landmarkRef} tabIndex={-1} className="sr-only" data-note-landmark>
        {title.trim() || 'Untitled note'}
      </h2>
      <Toast
        message={uploadToast?.message}
        tone={uploadToast?.tone}
        onDismiss={() => setUploadToast(null)}
      />
      <DocumentPreviewSheet
        open={!!previewDoc}
        href={previewDoc?.href}
        name={previewDoc?.name}
        page={previewDoc?.page}
        onClose={() => setPreviewDoc(null)}
        excerpts={previewExcerpts}
        onSaveExcerpt={handleSaveExcerpt}
        emphasizeExcerptId={previewDoc?.emphasizeExcerptId}
        documentId={previewDoc?.documentId}
        onInsert={askInsertHere}
      />
      <CapturedSourceSheet
        open={!!capturedSource}
        excerpt={capturedSource}
        onClose={() => setCapturedSource(null)}
        onOpenOwningNote={
          capturedSource && capturedSource.noteId !== noteId
            ? () => {
                // ⛔ The app's ONE routing idiom for a note — the same `?note=`
                // param NotebookTab owns and Search writes through
                // `applyTargetToParams`. Never a second route shape.
                const nid = capturedSource.noteId
                setCapturedSource(null)
                setSearchParams((prev) => {
                  const next = applyTargetToParams(prev, { noteId: nid, depth: 'note' })
                  return next
                })
              }
            : null
        }
      />
      <div className={styles.chrome} ref={chromeRef}>
      <SkipLinkPortal>
        <a href="#notebook-editor-toolbar" className={styles.skipLink} onClick={skipToToolbar}>
          Skip to editor toolbar
        </a>
      </SkipLinkPortal>
      <h2 ref={toolbarSkipRef} tabIndex={-1} className="sr-only">Editor toolbar</h2>
      <header className={styles.header}>
        {showBack && (
          <button type="button" className={styles.backBtn} onClick={onBack}>
            ← Notebook
          </button>
        )}
        {/* Only surface a PROBLEM (reconnecting / save failed) — the steady
            "Saved"/"Saving"/"Editing" chatter is dropped so the formatting
            toolbar sits at the far left of the header. */}
        {/* ⛔ CSS-module classes are hashes, not strings: `styles.saveState`
            would have compiled to `undefined` and rendered unstyled. Reuse the
            class the other save states already use. */}
        {/* Wave Q1 — PERMANENT RULE: SAVED ON THIS DEVICE ≠ SYNCED TO UCT.
            Shown only while the server does NOT have the work (the healthy
            path already stays quiet), and only once the durable write has
            actually COMMITTED — never while it is pending, in flight, or
            failed. `durable.unsynced` is that commit, not an intention.

            ⛔ AND THE NOUN NARROWS WHEN THE PLATFORM WILL NOT PROMISE RETENTION.
            "This device" implies the words outlive the browsing session; only a
            granted `persisted()` supports that. Everywhere else — a private
            window, a fresh profile, Safari and Firefox as measured — the honest
            claim is "in this browser", which is true in every environment in the
            §32 matrix.

            ⛔ THIS IS NOT PRIVATE-MODE DETECTION AND MUST NEVER BECOME IT.
            `persisted() === false` is equally true of a brand-new ordinary
            profile; it means only that persistent-storage protection has not
            been positively granted. No badge, no claim, no behaviour change. */}
        {/* ⛔ THE BLOCKED CASE WINS, and it is NOT gated on the editor's own
            save attempt. The queue has retired this note's write from retrying:
            that is true whether or not a save is in flight right now, and the
            member's next edit is what changes it. Two lines at once would read
            as two different states, so this is an either/or, not an also.
            ⛔ The words come from `unsyncedCopy` — one authority, so the list
            and the header can never drift apart. */}
        {noteIsBlocked ? (
          <div className={styles.saveStatus} role="status">
            <UIcon name="warning" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            {blockedLabel(durable.persisted)}
          </div>
        ) : durable.unsynced && (saveStatus === 'error' || saveStatus === 'reconnecting') && (
          <div className={styles.saveStatus} role="status">
            <UIcon name="check" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            {unsyncedLabel(durable.persisted)}
          </div>
        )}
        {saveStatus === 'conflict' && (
          <div className={styles.saveStatus} role="status">
            <UIcon name="warning" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            {'Conflict — this note changed elsewhere. Your version was kept as a conflicted copy.'}
          </div>
        )}
        {/* ⛔ B1: the server refused recovered words their writer could not have
            read this note to produce — kept as a copy, never lost, never retried. */}
        {saveStatus === 'refused' && (
          <div className={styles.saveStatus} role="status">
            <UIcon name="warning" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            {REFUSED_COPY_MESSAGE}
          </div>
        )}
        {/* ⛔⛔ A DIFFERENT AXIS FROM THE THREE ABOVE — connectivity, not save
            status. Independent (never else-if'd with the blocked/unsynced/
            conflict states): a member can be offline AND have an unrelated
            queued-write problem at the same time, and each fact is honest on
            its own. Auto-clears the instant `online` fires -- no dismiss
            state to manage for something that already un-shows itself.
            Competitive audit finding Accessibility QW-5, 2026-09-22. */}
        {isOffline && (
          <div className={styles.saveStatus} role="status">
            <UIcon name="warning" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            {OFFLINE_VIEWING_BANNER}
          </div>
        )}
        {/* ⛔ Wave 10 F7 (Part A, 5d): the retrying state used to put its whole sentence
            (`friendlySaveError(..., {retrying:true})`, e.g. "Couldn't reach the server —
            your note is unchanged, retrying automatically.") ONLY in the `title` tooltip
            attribute, and rendered nothing but the single word "Reconnecting…" as VISIBLE
            text. A member reading the screen -- never hovering a status line -- saw one word
            with no explanation of what failed or whether their words were safe: the proof
            walk's silent-failure sweep read this as SILENT under a forced-offline autosave
            PUT (`is_sentence` requires 3+ words; "Reconnecting…" is one). The sentence is
            now the VISIBLE text, same as the 'error' branch already did. */}
        {(saveStatus === 'error' || saveStatus === 'reconnecting') && (
          <div className={styles.saveStatus} role="status">
            <UIcon name="warning" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            {saveStatus === 'reconnecting'
              ? (saveErrorMsg || 'Reconnecting…')
              : `Save failed${saveErrorMsg ? `: ${saveErrorMsg}` : ''}`}
          </div>
        )}
        <div className={styles.headerControls} data-tour="ask-row" ref={askRowRef}>
          <button
            type="button"
            className={styles.chromeBtn}
            onClick={onToggleFavorite}
            disabled={favoriteBusy}
            aria-pressed={isFavorite}
            aria-label={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
            title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
          >
            <UIcon name={isFavorite ? 'star-fill' : 'star'} size={15} gold={isFavorite} />
          </button>
          <NoteLinkedTradeChips noteId={noteId} />
          <AskPanel
            scope="note"
            target={noteId}
            /* The LIVE doc, unsaved edits included -- it is where the member
               would actually land, so it is what a citation must verify
               against. */
            getEditorDoc={() => editorRef.current?.state?.doc}
            onNavigate={jumpToCitation}
            onInsert={askInsertHere}
            onClose={focusAskToggle}
          />
          {/*
            ⛔ FIND HAD NO VISIBLE ENTRY POINT -- Cmd/Ctrl+F was the ONLY door
            (grepped the whole file for setFindOpen(true): one call site, the
            keydown handler). History, two buttons over, has always had a
            labeled button in this same row. Competitive audit finding UX #5,
            2026-09-22. NoteFindBar's own Escape/Enter handling is untouched
            by this -- purely a missing entry point, not new find logic.
          */}
          {!isCanvas && (
            <button
              type="button"
              className={styles.chromeBtn}
              onClick={() => setFindOpen(true)}
              title="Find in this note"
              aria-label="Find in note"
            >
              <UIcon name="search" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              Find
            </button>
          )}
          <NoteShareControls noteId={noteId} onMessage={setChromeMsg} />
          {/* Wave 8 (8A): the header's select and inputs carry names -- a
              placeholder vanishes once there is a value, and a select has none. */}
          <select
            className={styles.headerSelect}
            value={note.folderId || ''}
            onChange={(e) => onFolderChange(e.target.value)}
            aria-label="Folder"
          >
            <option value="">Unfiled</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          <input
            ref={tickerInputRef}
            className={styles.headerInput}
            placeholder="Ticker"
            aria-label="Ticker"
            defaultValue={note.ticker || ''}
            onBlur={(e) => onTickerChange(e.target.value)}
            style={{ width: 84 }}
          />
          <SaveFailed message={tickerFailure} onDismiss={() => setTickerFailure(null)} />
          <SaveFailed message={tagWriteFailure} onDismiss={() => setTagWriteFailure(null)} />
          <SaveFailed message={favoriteFailure} onDismiss={() => setFavoriteFailure(null)} />
          <SaveFailed message={trashFailure} onDismiss={() => setTrashFailure(null)} />
          {chromeMsg && <span className={styles.chromeMsg} role="status">{chromeMsg}</span>}
          {/* Wave 10 lane K2 (D-3): Writing help and Outline moved up from the formatting row
              so the formatting row fits ONE line at 1200 px. Both keep their names, their
              `onMouseDown` / `aria-expanded` behaviour and their keyboard doors. */}
          {editor && !locked && writingHelpOn && editor.isEditable && !isCanvas && (
            <button
              type="button"
              className={styles.chromeBtn}
              onMouseDown={(e) => e.preventDefault()}
              onClick={openWritingHelp}
              aria-label="Writing help"
              data-tour="writing-help"
              title="Writing help — summarize, rewrite, continue or translate"
            >
              <UIcon name="sparkle" size={13} gold={false} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              Writing help
            </button>
          )}
          {/* Wave 5: the note's outline (every heading, click to jump) -- a
              panel beside the note on desktop, a sheet on touch. It shares
              the palette's corner, so opening one closes the other. */}
          {editor && (
            <button
              ref={outlineToggleRef}
              type="button"
              className={`${styles.chromeBtn} ${outlineOpen ? styles.toolBtnActive : ''}`}
              onClick={() => { setPaletteOpen(false); setOutlineOpen((o) => !o) }}
              aria-expanded={outlineOpen}
              aria-label="Outline"
              title="Outline — every heading in this note"
            >
              <UIcon name="rows" size={13} gold={false} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              Outline
            </button>
          )}
          {/* Wave 10 lane K2 (design finding D-3): the page-level actions live behind ONE
              "More note actions" door, Notion's "…" -- the review measured up to five rows of
              controls above the title at 1200 px with a red Delete among the first. Delete is
              LAST in it, apart from the rest; the tags moved under the title, beside the
              note's other properties. Every action keeps its name and its keyboard door
              (NoteMoreMenu.jsx; rails: NoteEditorPage.moreMenu.test.jsx). */}
          {/* The tour's Export step points here now: the file doors are inside. */}
          <span className={styles.tourWrap} data-tour="note-export">
          <NoteMoreMenu buttonClassName={styles.chromeBtn}>
            <button
              type="button"
              className={styles.chromeBtn}
              onClick={() => setHistoryOpen(true)}
              title="See earlier versions of this note and restore one"
              aria-label="Version history"
            >
              <UIcon name="clock" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              History
            </button>
            <button
              type="button"
              className={styles.chromeBtn}
              onClick={onDuplicate}
              disabled={duplicating}
              title="Create a copy of this note"
              aria-label="Duplicate note"
            >
              <UIcon name="copy" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              {duplicating ? 'Duplicating…' : 'Duplicate'}
            </button>
            {/* Wave 6 (lane E) fix round 1, I1 — the note menu's organisation
                actions (Lock, Archive, Save as template, Open beside). Lane E's
                own file (NoteMenuActions.jsx) renders itself; this is the one
                line that reads the render prop NotebookTab has passed since wave
                6 landed.
                M2 (wave 6 fix round 2): `unlockNote` is THIS editor's own
                unlock — the one that lands the revision, moves the save
                baseline when the server moved by metadata only, and settles
                the offline queue (`settleMetadataRevision`). The menu's own
                Unlock button used a second door (`setNoteLock` alone) that did
                only the first of those three, costing the next save a 409 +
                re-fetch; passing this through lets the menu route through the
                SAME settle instead of restating a worse copy of it. */}
            {noteMenu?.(note, { refresh, unlockNote, sendPendingEdits })}
            {editor && (<>
              <div className={moreStyles.sep} role="separator" />
              {/* Final review M-9: the four file formats are built from the server's copy, so
                  this editor's pending edits are sent first (the Save-as-template precedent). */}
              <NoteExportControls noteId={noteId} title={title} columnRef={columnRef} onMessage={setChromeMsg}
                onBeforeExport={sendPendingEdits} />
              {/* Wave 5: word count + reading time (the selection's share while
                  text is selected). */}
              <div className={moreStyles.meta}><NoteStats editor={editor} /></div>
            </>)}
            <div className={moreStyles.sep} role="separator" />
            <button type="button" className={`${styles.chromeBtn} ${moreStyles.danger}`} onClick={onDeleteRequest}>
              Delete
            </button>
          </NoteMoreMenu>
          </span>
        </div>
      </header>

      {unsentTrash && (
        <UnsentTrashDialog
          what={unsentTrash.what}
          sending={unsentTrash.sending}
          still={unsentTrash.still}
          onSendFirst={sendThenTrash}
          onTrashAnyway={trashAnyway}
          onClose={() => setUnsentTrash(null)}
        />
      )}
      {confirmingDelete && (
        <ConfirmModal
          title="Delete this note?"
          body="It moves to Trash and can be restored for 30 days before it's permanently removed."
          confirmLabel="Delete"
          tone="danger"
          onConfirm={onDeleteConfirm}
          onClose={() => setConfirmingDelete(false)}
        />
      )}

      {/* Wave 0 (P1-10): a locally-drafted version of this note from a
          session that never actually saved it to the server (tab closed,
          crashed, or offline mid-edit). Offered, never auto-applied — the
          member decides whether it's worth more than what's on screen. */}
      {/* S1/H14: a locked note offers no Restore -- the banner is restoreDraft's only door. */}
      {pendingDraft && !unreadable && (
        <div className={styles.draftBanner} data-export-exclude role="status">
          <span>
            {recovery?.ambiguous
              ? 'Two unsaved copies of this note were found on this device and they cannot be put in order. Restore uses the most recent one.'
              : 'Unsaved changes from a previous session were found for this note.'}
          </span>
          <div className={styles.draftBannerActions}>
            <button
              type="button"
              className={`${styles.draftBannerBtn} ${styles.draftBannerBtnPrimary}`}
              onClick={restoreDraft}
            >
              Restore
            </button>
            <button type="button" className={styles.draftBannerBtn} onClick={discardDraft}>
              Discard
            </button>
          </div>
        </div>
      )}

      {/* The editor toolbar ROW (owner ask, chart-parity round): the font/
          formatting cluster and the PNG/Print exports grouped as ONE
          discoverable surface, full-width under the header instead of split
          across a crowded header line. Sticky via the shared .chrome wrapper;
          data-export-exclude keeps the row out of the PNG rasterization. */}
      {/* Wave 6: a locked note shows no editing controls at all -- a control that would do
          nothing is hidden, never silent. Since wave 10 lane K2 (D-3) every control left in
          this row is an editing control, so on a locked note the ROW is not rendered at all
          (review M-4: it rendered as an empty, named toolbar). */}
      {editor && !locked && !isCanvas && (
        <div
          ref={(el) => { toolbarRowRef.current = el; editorToolbarRoving.ref.current = el }}
          className={styles.toolbarRow}
          role="toolbar"
          aria-label="Editor toolbar"
          onKeyDown={editorToolbarRoving.onKeyDown}
          onFocus={editorToolbarRoving.onFocus}
          data-tour="note-toolbar"
          data-export-exclude
          data-format-open={formatOpen ? 'true' : undefined}
          {...(formatOpen ? formatDisclosureProps : {})}
        >
          <>
            {/* Wave 10 (G-144): Undo / Redo on the touch tier. A phone has no
                Ctrl+Z, so without these a mistaken tap on a phone had no way
                back. Shown only at <=1024px (`.historyBtn`, like Scan); each
                runs the editor's OWN history command, so one tap is exactly one
                of the steps Ctrl+Z would take. A control with nothing to undo
                is disabled, never silent. `onMouseDown` keeps the caret (and a
                phone's keyboard) where it was. The pair floats once the row
                has scrolled away on a phone (review M-5, `historyFloating`);
                the sentinel stays in the row to say when. */}
            <span ref={setHistorySentinelEl} className={styles.historySentinel} aria-hidden="true" />
            <span className={`${styles.historyGroup}${historyFloating ? ` ${styles.historyFloat}` : ''}`}
              data-history-floating={historyFloating ? 'true' : undefined}>
              <button
                type="button"
                className={`${styles.toolBtn} ${styles.historyBtn}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!canRunHistory(editor, 'undo')}
                aria-label="Undo"
                title="Undo the last change"
              >
                Undo
              </button>
              <button
                type="button"
                className={`${styles.toolBtn} ${styles.historyBtn}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!canRunHistory(editor, 'redo')}
                aria-label="Redo"
                title="Redo the change you undid"
              >
                Redo
              </button>
            </span>
            {/* Wave 10 lane D3P: the phone's ONE formatting disclosure (display: none above
                640 px, so a desktop or tablet row is unchanged). It opens the four runs below
                in place; see `formatOpen` for the keyboard contract and why the row is the
                container. The name is "Format" (the "Aa" glyph is decoration). */}
            <button
              ref={formatToggleRef}
              type="button"
              className={`${styles.toolBtn} ${styles.formatToggle}${formatOpen ? ` ${styles.toolBtnActive}` : ''}`}
              onClick={() => setFormatOpen((o) => !o)}
              aria-expanded={formatOpen}
              aria-controls={`${formatRunId}-a ${formatRunId}-b ${formatRunId}-c ${formatRunId}-d`}
              data-tour="note-format"
              title="More formatting: font, size, colour, headings, numbered list, quote, code, links, images, files, rule and widgets"
              data-format-toggle=""
            >
              <span aria-hidden="true" className={styles.formatGlyph}>Aa</span>
              Format
            </button>
            <span className={styles.formatRun} id={`${formatRunId}-a`} data-format-run="">
            <select
              className={styles.fontSelect}
              value={editor.getAttributes('textStyle').fontFamily || ''}
              onChange={(e) => {
                const v = e.target.value
                if (v) editor.chain().focus().setFontFamily(v).run()
                else editor.chain().focus().unsetFontFamily().run()
              }}
              title="Font"
              aria-label="Font family"
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.label} value={f.value} style={f.value ? { fontFamily: f.value } : undefined}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              className={styles.fontSizeSelect}
              value={editor.getAttributes('textStyle').fontSize || ''}
              onChange={(e) => {
                const v = e.target.value
                if (v) editor.chain().focus().setFontSize(v).run()
                else editor.chain().focus().unsetFontSize().run()
              }}
              title="Text size"
              aria-label="Text size"
            >
              <option value="">Size</option>
              {FONT_SIZES.map((s) => <option key={s} value={`${s}px`}>{s}</option>)}
            </select>
            </span>
            <ToolButton
              active={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
              label="B"
            />
            <ToolButton
              active={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              label="I"
            />
            {/* Wave 5: text colour + highlight. The glyph's underline shows the
                colour at the caret; the picker is a popover on desktop and a
                bottom sheet on touch (TextColorMenu). */}
            <span className={styles.formatRun} id={`${formatRunId}-b`} data-format-run="">
            <span className={styles.colorAnchor}>
              <button
                ref={colorToggleRef}
                type="button"
                className={`${styles.toolBtn} ${colorOpen ? styles.toolBtnActive : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setColorOpen((o) => !o)}
                // A disclosure, not a menu: the picker is a GROUP of pressed-state
                // buttons, so `aria-haspopup` (which announces a menu) would
                // promise arrow-key menu behaviour it does not have.
                aria-expanded={colorOpen}
                aria-controls={colorOpen ? colorMenuId : undefined}
                aria-label={TEXT_COLOR_MENU_LABEL}
                title={`${TEXT_COLOR_MENU_LABEL} — ${modKeyLabel()}+Shift+H highlights`}
              >
                <span className={`${styles.colorGlyph} ${editor.getAttributes('textColor').color ? textColorClass(editor.getAttributes('textColor').color) : ''}`}>A</span>
              </button>
              {colorOpen && (
                <TextColorMenu id={colorMenuId} editor={editor} onClose={() => setColorOpen(false)} toggleRef={colorToggleRef} />
              )}
            </span>
            <ToolButton
              active={editor.isActive('heading', { level: 1 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              label="H1"
            />
            <ToolButton
              active={editor.isActive('heading', { level: 2 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              label="H2"
            />
            </span>
            <ToolButton
              active={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              label="• List"
            />
            <span className={styles.formatRun} id={`${formatRunId}-c`} data-format-run="">
            <ToolButton
              active={editor.isActive('orderedList')}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              label="1. List"
            />
            <ToolButton
              active={editor.isActive('blockquote')}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              label="❝"
              disabled={!canRunHistory(editor, 'toggleBlockquote')}
              title={canRunHistory(editor, 'toggleBlockquote') ? undefined : "Quote isn't available inside a list -- exit the list first"}
            />
            <ToolButton
              active={editor.isActive('codeBlock')}
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              label="</>"
            />
            <ToolButton
              onClick={() => {
                const url = prompt('Link URL (https only):')
                if (url) editor.chain().focus().setLink({ href: url }).run()
              }}
              label={<UIcon name="link" size={14} />}
              title="Insert link"
            />
            <ToolButton
              onClick={() => fileInputRef.current?.click()}
              label={<UIcon name="document" size={14} />}
              title="Insert image"
            />
            {/* Wave 7 (lane G's G5, built by H): photograph a page on a phone or
                tablet. The touch tier only (`.scanBtn` is display:none above
                1024px); the photo goes through the SAME image upload as Insert
                image, so with NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED and
                J2_OCR_ENABLED on it becomes a searchable document. */}
            <button
              type="button"
              className={`${styles.toolBtn} ${styles.scanBtn}`}
              onClick={() => scanInputRef.current?.click()}
              aria-label="Scan a document with the camera"
              title="Scan a document with the camera"
              data-tour="note-scan"
            >
              <UIcon name="camera" size={14} gold={false} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              Scan
            </button>
            <ToolButton
              onClick={() => attachFileInputRef.current?.click()}
              label={<UIcon name="paperclip" size={14} />}
              title="Attach a file"
            />
            </span>
            {/* Wave 7 lane H1: dictation into THIS editor (the slash menu's
                "Dictate" starts the same mic). Paid members only — the mic
                renders nothing for anyone else, and is not even loaded.
                `holdOnFailure` (review I-4): a failed transcription keeps the
                member's recording and says why, never a silent drop.
                `hintInFlow` (wave 10 follow-up F5): the first-run hint takes its
                own place in this wrapping row instead of hanging over the tag
                input (1200 px) and the formatting row (820 / 390 px). */}
            {isPaid === true && (
              <Suspense fallback={null}>
                <VoiceInputButton ref={micRef} onTranscript={insertDictated} disabled={!editor.isEditable} holdOnFailure hintInFlow hintDeferred={deferFirstRun} />
              </Suspense>
            )}
            {/* Wave 7 lane H2: writing help — the draft opens in a PREVIEW and
                reaches the note only on Accept. Since wave 10 lane K2 (D-3) its button
                sits in the header row, beside Outline. */}
            {/* D3P (controller ruling): the mic stays OUT of the runs, so it stays visible
                on phones beside Undo/Redo, B, I and the bullet list. The last run
                resumes here for the rule and the widget door. */}
            <span className={styles.formatRun} id={`${formatRunId}-d`} data-format-run="">
            <ToolButton
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
              label="―"
              title="Horizontal rule"
            />
          {/* Widget palette door — point-and-click inserts for people who
              don't reach for slash commands (owner ask). */}
          <button
            type="button"
            className={`${styles.toolBtn} ${paletteOpen ? styles.toolBtnActive : ''}`}
            onClick={() => { setOutlineOpen(false); setPaletteOpen((o) => !o) }}
            title="Insert a chart or preset — pick ticker and timeframe by clicking"
            aria-label="Insert widget"
          >
            ⊞ Insert
          </button>
          </span>
          </>
          {/* Wave 10 lane K2 (D-3): Outline moved to the header row; PNG, Print, Export and the
              word count moved into "More note actions". The row is the formatting controls. */}
        </div>
      )}
      {/* Absolute child of the sticky chrome — anchored to its bottom edge,
          so it follows the pinned chrome regardless of how many rows the
          header wraps to (review finding: a fixed viewport offset here
          duplicated the chrome height by hand). */}
      {paletteOpen && editor && !locked && (
        <WidgetPalette editor={editor} onClose={() => setPaletteOpen(false)} />
      )}
      {outlineOpen && editor && (
        <NoteOutline editor={editor} onClose={() => setOutlineOpen(false)} toggleRef={outlineToggleRef} />
      )}
      </div>

      <div
        className={
          `${styles.watchWrap} ${hasLeftRail ? styles.hasLeft : ''} ${hasRightRail ? styles.hasRight : ''}`
        }
      >
        {hasLeftRail && (
          <div className={styles.railLeft}><NoteRailLeft insights={insights} /></div>
        )}
        <div className={styles.column} ref={columnRef} data-print-root>
        {locked && (
          <div className={styles.lockBanner} role="status" data-export-exclude>
            <UIcon name="lock" size={14} gold={false} style={{ verticalAlign: '-2px' }} />
            <span>Locked — editing is off</span>
            {unlockState === 'failed' && (
              <span className={styles.lockBannerError}>Couldn&apos;t unlock. Try again.</span>
            )}
            <button
              type="button"
              className={styles.lockBannerBtn}
              onClick={unlockNote}
              disabled={unlockState === 'busy'}
            >
              {unlockState === 'busy' ? 'Unlocking…' : 'Unlock'}
            </button>
          </div>
        )}
        {ytId ? (
          <>
            <NoteVideoHero youtubeId={ytId} watchUrl={note.heroImageUrl} />
            {deskVideo && (
              <div className={styles.noteTranscript}>
                <TranscriptPanel
                  videoId={deskVideo.id}
                  hasTranscript={insights.hasTranscript}
                  onSeek={seekNoteVideo}
                  getTime={getNoteVideoTime}
                />
              </div>
            )}
          </>
        ) : note.heroImageUrl ? (
          // A note that already has a hero image keeps showing it (it's content,
          // still editable via the picker's controls). Notes without one start
          // straight at the title — no empty drop-zone.
          <HeroImagePicker
            noteId={noteId}
            value={note.heroImageUrl}
            onChange={onHeroChange}
          />
        ) : null}

        {unreadable && <UnreadableNoteNotice editor={editor} />}
        {/* ⛔ ONE `readOnly`, both reasons (wave 6 whole-branch review I-3). The
            wave-5 merge left `readOnly={unreadable}` AND `readOnly={locked}` on
            each input, and the later prop won: an unreadable, unlocked note took
            typing that `commitSave` then dropped. Rails: lib/jsxDuplicateProps.test.js,
            NoteEditorPage.unreadable.test.jsx. */}
        <input
          ref={titleInputRef}
          className={styles.titleInput}
          readOnly={locked || unreadable}
          value={title}
          onChange={(e) => {
            const v = e.target.value
            setTitle(v)
            titleRef.current = v
            scheduleAutosave()
            onTitleChange?.(noteId, v)
          }}
          placeholder="Title"
          aria-label="Note title"
          // M-6: the hook NotebookTab's skip link finds the title by -- never
          // the label, whose wording is free to change.
          data-note-title
        />
        <input
          className={styles.subtitleInput}
          readOnly={locked || unreadable}
          value={subtitle}
          onChange={(e) => {
            const v = e.target.value
            setSubtitle(v)
            subtitleRef.current = v
            scheduleAutosave()
          }}
          placeholder="Subtitle (optional)"
          aria-label="Subtitle"
        />
        {/* Wave 10 lane K2 (D-3): the tags sit with the note's other properties, under the
            title, instead of a row of their own above it. Their failure sentence stays in the
            header's SaveFailed slot (wave 10 F7), unchanged. */}
        <div className={styles.tagsRow} data-export-exclude>
          <NoteTagsField
            tags={note.tags || []}
            nodes={tagNodes}
            busy={tagsBusy}
            onAdd={(tag) => applyTagDelta({ add: [tag] })}
            onRemove={(tag) => applyTagDelta({ remove: [tag] })}
          />
        </div>

        {/* Wave E: below title/subtitle, above the body (checkpoint §21) --
            a note with nothing set renders only a small "+ Add property"
            link, never a permanent header (progressive disclosure). */}
        {/* Wave 10 (G-165): "Suggest values" rides writing help's own gate and
            paid check (`writingHelpOn`, one authority); a suggestion is written
            only on the member's Accept, through `update` -- the same door.
            ⛔ Review M-4: never on a LOCKED or UNREADABLE note -- the same two
            reasons the title and subtitle are read-only for (wave 6: a locked
            note shows no editing controls at all). */}
        <PropertiesSection noteId={noteId} updateNote={update} ticker={note?.ticker}
          autofillOn={writingHelpOn && !locked && !unreadable} />

        {/* Wave P1 §23: why Search/Ask cannot read an attachment yet. Renders
            NOTHING when every document's text is complete — the common case
            gets no chrome. */}
        <DocumentTextStatus documents={noteDocuments} />
        {/* Wave 10 F7 (Part A, 5d): ONE sentence for the note's side reads that failed. */}
        <LoadFailed compact failures={[
          { what: "this note's attachments", error: documentsError, retry: refreshDocuments },
          { what: "this note's saved passages", error: excerptsError, retry: refreshExcerpts },
          { what: "this note's captured facts", error: factsError, retry: refreshFacts },
          { what: "this note's evidence sources", error: candidatesError, retry: refreshCandidates },
          { what: "this note's thesis evidence", error: thesisError, retry: refreshThesis },
        ]} />

        {/* Wave G: Thesis Evidence + Changelog -- below Properties, above the
            body (checkpoint §39); renders nothing for a note that isn't
            being used as a thesis. */}
        {/* Wave 11 11D: a trade-plan canvas is the PLAN, not the thesis (the thesis links
            to it) -- its evidence and review blocks would push the board below the fold. */}
        {!isCanvas && (
          <ThesisSection noteId={noteId} note={note} onOpenExcerptSource={handleOpenExcerptSource}
                         anchorReviewId={reviewAnchor?.reviewId || null}
                         onReviewAnchorConsumed={clearReviewParam} />
        )}

        {/* A locked note takes no captures: they wait in the inbox until Unlock. */}
        {!locked && (
          <CaptureInboxTray editor={editor} onPlaced={(id) => pendingInboxConsumeRef.current.add(id)} />
        )}

        {findOpen && (
          <NoteFindBar
            editor={editor}
            initialReplace={findWithReplace}
            onClose={closeFind}
          />
        )}

        {/* Wave 6: the table toolbar floats over the table the caret is in,
            and renders nothing anywhere else (or on a read-only note). */}
        <TableToolbar editor={editor} />
        <LinkPasteMenu editor={editor} />

        {offerCanvasLink && (
          <LinkCanvasOffer canvasId={linkCanvasId} onAdd={acceptCanvasLink} onDismiss={clearLinkCanvasParam} />
        )}

        {isCanvas && (
          <Suspense fallback={<p className={styles.canvasLoading} role="status">Loading the canvas…</p>}>
            <TradeCanvasBoard
              editor={editor}
              noteId={noteId}
              noteTitle={title}
              ticker={note.ticker || null}
              readOnly={locked || unreadable || !canvasOn}
              readOnlyReason={!canvasOn && !locked
                ? 'Trade-plan canvases are switched off right now, so this plan is read-only. Nothing in it has changed.'
                : null}
              onLinkFromNote={canvasOn ? linkCanvasFromNote : null}
            />
          </Suspense>
        )}

        {/* ⛔ A canvas note keeps its editor MOUNTED (it is the board's store);
            only blocks other than the board are shown, under a heading. */}
        <div
          onClickCapture={handleEditorClickCapture}
          hidden={isCanvas && canvasExtra === 0}
          className={isCanvas ? styles.canvasExtra : undefined}
          data-tour="note-body"
        >
          {isCanvas && canvasExtra > 0 && <h3 className={styles.canvasExtraTitle}>Also in this note</h3>}
          <EditorContent editor={editor} />
        </div>

        {/* Wave D: "Linked from" backlinks -- renders nothing until this
            note has at least one real backlink (directive §70/§16). */}
        <NoteBacklinksSection noteId={noteId} />
        <UnlinkedMentions noteId={noteId} />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          aria-label="Upload image"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleImageInsert(f)
            e.target.value = ''
          }}
        />
        {/* Wave 7 G5: the camera door. `capture="environment"` asks a phone for
            its rear camera; everything after the pick is Insert image's path.
            ⚠️ Whether iOS hands over a JPEG or a HEIC is NOT measured here (it
            needs a real device); a HEIC is refused by the server and the toast
            says so in its own words. */}
        <input
          ref={scanInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          aria-label="Scan a document with the camera — photo"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleImageInsert(f)
            e.target.value = ''
          }}
        />
        <input
          ref={attachFileInputRef}
          type="file"
          accept=".pdf,.txt,.csv,.md,.zip,.mp3,.m4a,.docx,.xlsx"
          aria-label="Upload file attachment"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleAttachmentInsert(f)
            e.target.value = ''
          }}
        />
        </div>
        {hasRightRail && (
          <div className={styles.railRight}><NoteRailRight insights={insights} /></div>
        )}
      </div>
      <NoteHistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        noteId={noteId}
        currentNote={note}
        onRestored={onVersionRestored}
      />
      {resurfaceVersionId && (
        <Suspense fallback={null}>
          <ResurfaceVersionSheet noteId={noteId} versionId={resurfaceVersionId} onClose={clearResurfaceParam} />
        </Suspense>
      )}
      {voiceNoteOpen && voiceNoteOn && (
        <Suspense fallback={null}>
          <VoiceNoteDialog
            onAppend={appendVoiceResult}
            onSaved={onVoiceNoteSaved}
            onClose={() => setVoiceNoteOpen(false)}
          />
        </Suspense>
      )}
      {/* Wave 13 lane 13G-1: the /transcript insert's sheet (renders nothing while its gate is off). */}
      <TranscriptInsertHost editor={editor} noteId={noteId} ticker={note?.ticker} />
      {writingHelp && (
        <Suspense fallback={null}>
          <WritingHelpPanel
            noteId={noteId}
            request={writingHelp}
            onAccept={acceptWritingHelpDraft}
            onClose={() => setWritingHelp(null)}
          />
        </Suspense>
      )}
    </div>
  )
}
