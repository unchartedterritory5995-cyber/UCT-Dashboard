import { Suspense, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import lazyChunk, { importWithOneRetry } from '../../lib/lazyChunk'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import useSWR, { useSWRConfig } from 'swr'
import UIcon from '../../../../components/ui/UIcon'
import usePreferences from '../../../../hooks/usePreferences'
import { useIsPaid } from '../../../../context/AuthContext'
import { claimFirstRunStage } from '../../../../components/firstRun/firstRunStage'
import useNotebookHome from '../../hooks/useNotebookHome'
import useJ2Notes from '../../hooks/useJ2Notes'
import useJ2SelectedAccount from '../../hooks/useJ2SelectedAccount'
import { notebookFlag } from '../../lib/offline/notebookFlags'
import { NOTEBOOK_SEARCH_HASH } from '../../lib/notebookSearchDoor'
import { NOTEBOOK_PREP_HASH } from '../../lib/notebookDoors'
import CollapsibleSection from '../CollapsibleSection'
import { openNotebookTour } from './onboarding/tourControl'
import { getRegistryTourWanted, subscribeRegistryTourWanted } from './onboarding/tourRegistryControl'
import LearnMenu from './onboarding/LearnMenu'
import {
  SAMPLE_URL, SAMPLE_PREF, SAMPLE_COPY, readSamplePref, addSampleNotebook, removeSampleNotebook, removedMessage, isNotebookKey,
  describeSampleHold,
} from './onboarding/sampleNotebook'
import { precheckNoteBatch } from '../../lib/noteBatch'
import { openSpanningCitation, passageNavigationState } from '../../lib/openCitation'
import AskPanel from './AskPanel'
import { SOON_URL, earningsPrepEnabled, fetchReportingSoon } from '../../lib/earningsPrepShared'
import { PASSED_URL, fetchPassedSetups, passedSetupsEnabled } from '../../lib/researchCapture'
import { reviewDraftsEnabled } from '../../lib/reviewDraftsFlag'
import { setupsBoardEnabled, SETUPS_BOARD_PATH } from '../../lib/setupsBoardLink'
import GettingStartedChecklist from './GettingStartedChecklist'
import { checklistEnabled } from './onboarding/gettingStartedPref'
import { FIRST_RUN_HEADING_ATTR } from './onboarding/keyboardDoors'
import DocumentPreviewSheet from './DocumentPreviewSheet'
import CapturedSourceSheet from './CapturedSourceSheet'
import { notePath } from '../../../../hooks/useNoteBacklinks'
import { SkeletonLine } from '../../../../components/Skeleton'
import LoadFailed from '../LoadFailed'
import { SkipLinkPortal } from '../../../../components/skipLinks'
import styles from './ResearchHome.module.css'

// Wave 13 lane 13G-1: Passed setups, loaded only when its gate is on (the Notebook's
// first-open bytes do not carry it).
const PassedSetups = lazyChunk(() => import('./PassedSetups'))
// Wave 14 lane W14-A: the first-run welcome's capability preview. Only a member with no
// notes ever sees it, so every other open does not pay for it (plan G7: onboarding must not
// regrow the Notebook's first-open bytes).
const CapabilityPreview = lazyChunk(() => import('./onboarding/CapabilityPreview'))
// Wave 14 perf lane (docs/notebook/wave14-perf.md): the same for wave 13's two other dark
// boxes. "Reporting soon" loads only while notebook_earnings_prep_enabled is on, and the
// review-drafts box's doc builder (`lib/reviewDrafts.js`) loads on its first click -- the box's
// own flag is read from `lib/reviewDraftsFlag.js`, which carries nothing else.
const ReportingSoon = lazyChunk(() => import('./ReportingSoon'))
// Landing 12-15 (byte gate): wave 11's "Ask Notebook to do something" box, the lever
// docs/notebook/wave14-perf.md section 5 named. Fetched only while notebook_ai_actions_enabled is
// on (the box still checks the flag itself), at the same tree position in every return, so a
// quiet/full flip keeps its state exactly as before.
const AiActionsBox = lazyChunk(() => import('./AiActionsPanel'))
const loadReviewDrafts = () => importWithOneRetry(() => import('../../lib/reviewDrafts'))

const STATUS_LABEL = { watching: 'Watching', active: 'Active', invalidated: 'Invalidated', closed: 'Closed' }
const CONFIDENCE_LABEL = { low: 'Low', medium: 'Medium', high: 'High' }

function relativeDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return d.toLocaleDateString()
}

function NoteRow({ note, onOpen, reason }) {
  const props = note.propertiesJson || {}
  const status = props['builtin:thesis_status']
  const confidence = props['builtin:confidence']
  return (
    <button type="button" className={styles.row} onClick={() => onOpen(note)}>
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>{note.title?.trim() || 'Untitled'}</span>
        {note.ticker && <span className={styles.rowTicker}>${note.ticker}</span>}
      </span>
      <span className={styles.rowMeta}>
        {status && <span className={`${styles.chip} ${styles[`status_${status}`] || ''}`}>{STATUS_LABEL[status] || status}</span>}
        {confidence && <span className={styles.chipMuted}>{CONFIDENCE_LABEL[confidence] || confidence} confidence</span>}
        {reason || <span className={styles.rowDate}>{relativeDate(note.updatedAt)}</span>}
      </span>
    </button>
  )
}

// Wave 13 lane 13F: one small, self-contained door on Home -- "Reviews that write
// themselves". Renders nothing (and calls nothing) while notebook_review_drafts_enabled
// is off, the same contract as the other Home boxes below (aiBox/prepBox/passedBox).
// Notebook UX pass: on Research Home the box sits in a collapsible section whose header already
// names it, so `titleHidden` keeps its heading for screen readers and the skip link below while
// it is not drawn a second time.
export function ReviewDraftsHomeBox({ onOpenNote, skipLinkClassName = '', titleHidden = false }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const headingRef = useRef(null)
  // Finish program, lane AI-FE (K2): the drafts are asked for the member's SELECTED account,
  // the same hook every Journal read uses (the Insights door already hands its id in). With
  // no id the server has no account to look a Compass review up for, so the quote never
  // showed. `null` ("All accounts") still sends no id. The hook is told not to fetch while
  // the box is off, so a dark box still asks for nothing.
  const on = reviewDraftsEnabled()
  const { accountId } = useJ2SelectedAccount(on)
  if (!on) return null

  const run = async (period, fn) => {
    if (busy) return
    setBusy(period)
    setError(null)
    try {
      // A failed fetch of the drafts chunk lands in the catch below, like a failed draft.
      const { note } = await fn(await loadReviewDrafts())
      // Lane KEYS3 (Q18): a drafted review's findings are its collapsed blocks. The note opens
      // with focus on the first of them, not at its top (18 to 24 Tab stops above it).
      onOpenNote(note, null, { to: 'collapsed' })
    } catch (e) {
      // `memberMessage` is a sentence the door wrote for the member (the note is still syncing).
      setError(e?.memberMessage || `Could not draft the ${period} review — try again.`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={styles.section} data-tour="review-drafts-home">
      {/* Lane KEYS: the reviews and the morning board sat 21 and 24 Tabs into this page. This
          link goes in the shell's skip-link slot (hidden until focused) and lands on the
          heading below, so the next Tab is "Today's recap". Only when the Notebook hands in
          its skip-link class: rendered alone, the box is unchanged. */}
      {skipLinkClassName && (
        <SkipLinkPortal>
          <a href="#nb-home-reviews" className={skipLinkClassName}
            onClick={(e) => { e.preventDefault(); headingRef.current?.focus() }}>
            Skip to reviews and setups
          </a>
        </SkipLinkPortal>
      )}
      <div className={styles.sectionHeader}>
        <h3 id="nb-home-reviews" ref={headingRef} tabIndex={-1}
          className={titleHidden ? 'sr-only' : styles.sectionTitle}>Reviews that write themselves</h3>
      </div>
      <div className={styles.rows} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '4px 0' }}>
        <button type="button" className="btn btn-ghost" disabled={Boolean(busy)} data-tour="review-drafts-daily"
          onClick={() => run('daily', (m) => m.draftDailyReview({ accountId, day: m.todayDayIso() }))}>
          <UIcon name="book" size={14} gold={false} /> {busy === 'daily' ? 'Drafting…' : "Today's recap"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={Boolean(busy)} data-tour="review-drafts-weekly"
          onClick={() => run('weekly', (m) => m.draftWeeklyReview({ accountId, weekStart: m.mondayOfIso() }))}>
          <UIcon name="book" size={14} gold={false} /> {busy === 'weekly' ? 'Drafting…' : "This week's review"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={Boolean(busy)} data-tour="review-drafts-monthly"
          onClick={() => run('monthly', (m) => m.draftMonthlyReview({ accountId, month: m.thisMonthIso() }))}>
          <UIcon name="book" size={14} gold={false} /> {busy === 'monthly' ? 'Drafting…' : "This month's review"}
        </button>
      </div>
      {error && <p className={styles.sampleError} role="alert">{error}</p>}
    </div>
  )
}

function Section({ title, notes, onOpen, viewAllHref, emptyReason }) {
  if (!notes || notes.length === 0) return null
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {viewAllHref && (
          <Link className={styles.viewAll} to={viewAllHref} aria-label={`View all ${title.toLowerCase()}`}>
            View all
          </Link>
        )}
      </div>
      <div className={styles.rows}>
        {notes.map((n) => <NoteRow key={n.id} note={n} onOpen={onOpen} reason={emptyReason} />)}
      </div>
    </div>
  )
}

/** How many recent notes the top of Home lists (the home read carries at most five). */
export const RECENT_NOTES_SHOWN = 5

// Notebook UX pass (2026-10-10): the top of Home for a member with notes is THEIR NOTES -- a
// search box and their recent notes -- before any dashboard box. A member with 25 notes landed
// on a page that showed none of them.
//
// ⛔ THE SEARCH BOX IS A DOOR, NOT A SECOND SEARCH. It opens the Notebook's one search (the
// folders panel's, FolderSidebar.jsx) through the door the command palette already uses: the
// Notebook reads `#search`, shows the panel and puts the cursor in its box
// (lib/notebookSearchDoor.js). Nothing here queries notes.
export function HomeSearch() {
  const navigate = useNavigate()
  return (
    <button type="button" className={styles.searchBox} data-home-search=""
      onClick={() => navigate(`/journal/notebook${NOTEBOOK_SEARCH_HASH}`)}>
      <UIcon name="search" size={14} gold={false} />
      <span className={styles.searchText}>Search your notes</span>
    </button>
  )
}

// ⛔ RECENT NOTES ARE THE HOME READ'S OWN `continueWorking` (the notes the member opened
// last). A member who has never opened a note (an import, the first visit after a move) has
// none there, so the list falls back to their most recently EDITED notes from the Notebook's
// own list read (`useJ2Notes`, the All notes endpoint) -- asked for only in that case.
function RecentNotes({ opened, edited, onOpen }) {
  const notes = (opened.length ? opened : edited).slice(0, RECENT_NOTES_SHOWN)
  if (notes.length === 0) return null
  return (
    <div className={styles.section} data-recent-notes="">
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Recent notes</h3>
        <Link className={styles.viewAll} to="/journal/notebook?view=all" aria-label="View all notes">
          All notes
        </Link>
      </div>
      <div className={styles.rows}>
        {notes.map((n) => <NoteRow key={n.id} note={n} onOpen={onOpen} />)}
      </div>
    </div>
  )
}

// A dashboard box on Home, folded or unfolded (Notebook UX pass). It is the Analytics tab's
// CollapsibleSection, reused: the member's own open/closed choice is kept per box in
// localStorage, and a folded box's content is UNMOUNTED (so it costs nothing while folded).
//   * `defaultOpen` -- a box with something to show starts open; an EMPTY one starts folded to
//     its one-line header, whose `meta` says why ("None saved yet"). Until the box's own read
//     has answered, the default is not known: it starts folded ("Checking…") and is mounted
//     again with the real default the moment it is (`known` keys the section). A choice the
//     member made wins either way.
//   * `openSignal` -- a walkthrough running now, or a door aimed inside the box, unfolds it
//     (never persisted: being sent somewhere once is not a change of mind).
//   * The box's own heading stays in the page for screen readers and its own doors, but is
//     not drawn under the section header that already names it (`.boxBody`).
function HomeBox({ id, title, meta, defaultOpen, known = true, openSignal, children }) {
  return (
    <div className={styles.homeBox} data-home-box={id}>
      <CollapsibleSection key={known ? 'known' : 'checking'} id={id} title={title} meta={meta}
        defaultOpen={known ? defaultOpen : false} openSignal={openSignal}>
        <div className={styles.boxBody}>{children}</div>
      </CollapsibleSection>
    </div>
  )
}

/** A box's one-line answer from its read: null while unknown, else what the header says. */
function boxState({ on, data, error, count, some, none, failed }) {
  if (!on) return { known: true, open: false, meta: null }
  if (error) return { known: true, open: true, meta: failed }
  if (!data) return { known: false, open: false, meta: 'Checking…' }
  const n = count(data)
  return { known: true, open: n > 0, meta: n > 0 ? some(n, data) : none(data) }
}

const SWR_ONCE = Object.freeze({ revalidateOnFocus: false, shouldRetryOnError: false })

// Wave 10 F7 (Part A, 5d): a failed status read THROWS -- `null` on a 500 hid the sample's
// remove strip without a word, as if the sample were gone.
const fetchStatus = (url) => fetch(url, { credentials: 'include' }).then((r) => {
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
})

/**
 * Wave H — Research Home. Renders in place of the bare-root All Notes grid
 * (checkpoint decision 33/57) -- "All notes" itself stays one click away in
 * the sidebar, unchanged. Four sections (checkpoint decision 11), each
 * independently collapsing when empty (checkpoint decision 13) -- no
 * dashboard grid of dead cards. "Upcoming Catalysts" and "Recent Captures"
 * are deliberately absent (checkpoint decision 12).
 *
 * Notebook UX pass (2026-10-10, "easy and simple to use but has tons of cool stuff"):
 *   * a member with notes meets THEIR NOTES first: a search box (a door into the Notebook's
 *     one search) and their recent notes, with the Learn menu on the same row;
 *   * the dashboard boxes (Reporting soon, Passed setups, Reviews that write themselves) fold,
 *     and an empty one starts folded to its one-line header (HomeBox);
 *   * a new member gets ONE short welcome: one sentence, one primary action, two secondary
 *     ones, the Learn menu, and "See what it can do" folded away. The welcome holds the
 *     first-run stage while it shows, so the tour offer and the "Meet Compass" card wait
 *     behind it instead of stacking on it. With the wave-14 switch off, both screens stay as
 *     they were before wave 14.
 */
export default function ResearchHome({
  onOpenNote, onCreateNote, onCreateThesis, onImport, hasAnyNotes,
  // Fix I-3: what the sample's "Remove it" pre-check needs from the Notebook -- the notes
  // this device holds as blocked (useBlockedNotes), and a title for each held note it names.
  blockedNoteIds = null, titleOf = () => null,
  // Wave 13 lane 13Q-3 (click-budget fix, Q5): NotebookTab's own `openToday` -- the SAME
  // function its All Notes list header's "Today" button already calls (one authority, never
  // a second day-note opener). Optional so every existing caller/test keeps working unchanged.
  onOpenToday = null,
  // Lane KEYS: the Notebook's hidden-until-focused skip-link class, for this page's own link.
  skipLinkClassName = '',
}) {
  const { home, isLoading, error: homeError, refresh: refreshHome } = useNotebookHome()
  const navigate = useNavigate()
  // What an Ask citation opened in place: a document page, or a captured web
  // passage (lib/openCitation.js decides which).
  const [previewDoc, setPreviewDoc] = useState(null)
  const [capturedSource, setCapturedSource] = useState(null)

  // Whatever a box passes after the note (a drafted review's `{ to: 'collapsed' }`) goes on to
  // the tab unchanged; a box that passes only the note still calls with only the note.
  // Without a tab, a cited passage (fin walk 8.3; `openNote(note, null, { passage })` from
  // lib/openCitation.js) still rides the entry's state, the way NotebookTab carries it, so the
  // editor can land on it; every other open navigates exactly as before.
  const openNote = (note, ...rest) => {
    if (onOpenNote) return onOpenNote(note, ...rest)
    const passage = rest[1]?.passage
    return navigate(notePath(note.id), passage ? { state: passageNavigationState({ ...passage, noteId: note.id }) } : undefined)
  }

  // ── Wave 8 lane 8C (C3): the sample notebook and the tour's door ──────────────────
  // Both appear only while `notebook_onboarding_enabled` is on; the sample button only
  // for a paid member who has never had the sample (its ids are in `notebook_sample`).
  // While any recorded sample note is still out of Trash, a strip offers to remove them.
  const onboarding = notebookFlag('notebook_onboarding_enabled') === true
  // Wave 14 integration ruling: W14-A's capability preview and sample promotion are NOT
  // live on merge. They ride the SAME check as W14-D's checklist (checklistEnabled: the
  // onboarding flag AND notebook_getting_started_enabled) -- one gate, no second flag.
  // Off, the first-run screen is the pre-wave-14 screen: no preview chunk, no promotion,
  // and no aria-describedby on the sample button.
  const welcomeExtras = checklistEnabled(notebookFlag)
  const isPaid = useIsPaid()
  const { prefs, setPref } = usePreferences()
  const { mutate } = useSWRConfig()
  const sample = onboarding ? readSamplePref(prefs[SAMPLE_PREF]) : null
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [removing, setRemoving] = useState(false)
  // { alert: bool, text, anyway?: {label, confirm, confirmLabel}, armed?: bool }
  const [sampleMessage, setSampleMessage] = useState(null)
  const anywayRef = useRef(null)
  const anywayConfirmRef = useRef(null)
  // Wave 14 lane W14-A: the capability preview's sample promotion describes the sample
  // button (aria-describedby), so the button and the sentence about it stay one door.
  const samplePromoId = useId()
  const wantStatus = onboarding && hasAnyNotes && !!sample && !sample.dismissedAt
  const { data: sampleStatus, error: sampleStatusError, mutate: refreshSampleStatus } = useSWR(
    wantStatus ? SAMPLE_URL : null, fetchStatus, { revalidateOnFocus: false, shouldRetryOnError: false })
  const showStrip = wantStatus && Array.isArray(sampleStatus?.activeIds) && sampleStatus.activeIds.length > 0

  // ── Notebook UX pass: the new welcome, the top of Home, and the folding boxes ────────────
  // "See what it can do" -- the capability preview, folded away until asked for.
  const [previewOpen, setPreviewOpen] = useState(false)
  const previewId = useId()
  // The welcome is ONE nudge at a time (see the docblock): it holds the first-run stage while
  // it shows, exactly as a tour card does, so the offer and the Compass card wait for it.
  const welcomeShowing = welcomeExtras && !isLoading && !hasAnyNotes
  useEffect(() => (welcomeShowing ? claimFirstRunStage() : undefined), [welcomeShowing])
  // Recent notes: the home read's own recents, or -- only when it has none -- the member's most
  // recently edited notes from the Notebook's list read.
  const opened = Array.isArray(home?.continueWorking) ? home.continueWorking : []
  const { notes: editedNotes } = useJ2Notes({
    sort: 'updated', limit: RECENT_NOTES_SHOWN,
    enabled: Boolean(hasAnyNotes) && !isLoading && opened.length === 0,
  })
  // The boxes' own reads, under the SAME keys and fetchers the boxes use (SWR shares one
  // answer), so Home can tell an empty box from a full one without a second request.
  const prepOn = earningsPrepEnabled()
  const passedOn = passedSetupsEnabled()
  const soon = useSWR(hasAnyNotes && prepOn ? SOON_URL : null, () => fetchReportingSoon(), SWR_ONCE)
  const passed = useSWR(hasAnyNotes && passedOn ? PASSED_URL : null, () => fetchPassedSetups(), SWR_ONCE)
  const prepState = boxState({
    on: prepOn, data: soon.data, error: soon.error,
    count: (d) => (Array.isArray(d?.items) ? d.items.length : 0),
    some: (n) => `${n} reporting in the next ${soon.data?.windowDays ?? 7} days`,
    none: (d) => `None of your names in the next ${d?.windowDays ?? 7} days`,
    failed: 'Could not check the calendar',
  })
  const passedState = boxState({
    on: passedOn, data: passed.data, error: passed.error,
    count: (d) => (Array.isArray(d?.items) ? d.items.length : 0),
    some: (n) => `${n} saved`,
    none: () => 'None saved yet',
    failed: 'Could not load',
  })
  // A walkthrough running now unfolds every box, so its anchors are on screen
  // (tourRegistryControl.js); the palette's "Earnings prep" (`#prep`) unfolds Reporting soon.
  const tourWanted = useSyncExternalStore(subscribeRegistryTourWanted, getRegistryTourWanted, () => null)
  const location = useLocation()
  const tourSignal = tourWanted ? `tour:${tourWanted}` : null
  const prepSignal = location.hash === NOTEBOOK_PREP_HASH ? `prep:${location.key}` : null

  const addSample = async () => {
    if (adding) return
    setAdding(true)
    setAddError('')
    const out = await addSampleNotebook()
    setAdding(false)
    if (!out.ok) {
      setAddError(out.message)
      return
    }
    mutate(isNotebookKey)
    if (out.welcomeNoteId) openNote({ id: out.welcomeNoteId })
  }

  // ⛔⛔ Fix I-3: "Remove it" TRASHES notes, so it asks what the bulk trash asks first
  // (lib/noteBatch.js `precheckNoteBatch`, op 'trash') over the sample notes still out of
  // Trash. The DELETE trashes all of them at once, so ONE note holding unsent words holds the
  // whole removal back, and is named; a device that could not be asked is offered a
  // CONFIRMED "Remove anyway" -- whose re-run still refuses a note it DOES find unsent.
  // Before this, a note trashed under queued words met its next save as a 404 and was
  // stranded as BLOCKED, in the Trash, where no card shows it.
  const removeSample = async ({ acceptUnchecked = false } = {}) => {
    if (removing) return
    setRemoving(true)
    setSampleMessage(null)
    try {
      const ids = Array.isArray(sampleStatus?.activeIds) ? sampleStatus.activeIds : []
      const hold = describeSampleHold(
        await precheckNoteBatch({ ids, op: 'trash', blockedNoteIds, acceptUnchecked }),
        { titleOf },
      )
      if (hold) {
        setSampleMessage({ alert: true, text: hold.message, anyway: hold.anyway || null, armed: false })
        return
      }
      const out = await removeSampleNotebook()
      if (!out.ok) {
        setSampleMessage({ alert: true, text: out.message })
        return
      }
      setSampleMessage({ alert: false, text: removedMessage(out) })
      mutate(isNotebookKey)
    } finally {
      setRemoving(false)
    }
  }

  // The offer holds focus through its two steps, as the bulk trash's does: when it appears
  // focus goes to "Remove anyway"; arming it moves focus to the confirmation; Cancel brings
  // it back -- never dropped on the page.
  const offer = sampleMessage?.anyway || null
  const armed = Boolean(sampleMessage?.armed)
  useEffect(() => {
    if (!offer) return
    ;(armed ? anywayConfirmRef : anywayRef).current?.focus()
  }, [offer, armed])

  const dismissStrip = () => {
    // S5 CP2: literal key (== SAMPLE_PREF) so this call site is a literal, not
    // opaque, setPref site; stored key unchanged.
    if (sample) setPref('notebook_sample', { ...sample, dismissedAt: new Date().toISOString() })
  }

  const sampleNotice = (
    <>
      {wantStatus && (
        <LoadFailed compact what="your sample notebook's status" error={sampleStatusError}
          onRetry={() => refreshSampleStatus()} />
      )}
      {showStrip && (
        <div className={styles.sampleStrip}>
          <span className={styles.sampleStripText}>{SAMPLE_COPY.strip} —</span>
          <button type="button" className={styles.sampleStripAction} onClick={() => removeSample()} disabled={removing}>
            {removing ? SAMPLE_COPY.removing : SAMPLE_COPY.remove}
          </button>
          <button type="button" className={styles.sampleStripDismiss} onClick={dismissStrip}
            aria-label={SAMPLE_COPY.dismiss} title={SAMPLE_COPY.dismiss}>
            <UIcon name="x" size={14} gold={false} />
          </button>
        </div>
      )}
      {sampleMessage && (
        <p className={sampleMessage.alert ? styles.sampleError : styles.sampleNote}
          role={sampleMessage.alert ? 'alert' : 'status'}>
          {armed ? offer.confirm : sampleMessage.text}
        </p>
      )}
      {offer && !armed && (
        <button type="button" ref={anywayRef} className={styles.sampleStripAction}
          onClick={() => setSampleMessage((m) => (m ? { ...m, armed: true } : m))}>
          {offer.label}
        </button>
      )}
      {offer && armed && (
        <>
          <button type="button" ref={anywayConfirmRef} className={styles.sampleStripAction}
            disabled={removing} onClick={() => removeSample({ acceptUnchecked: true })}>
            {offer.confirmLabel}
          </button>
          <button type="button" className={styles.sampleStripAction}
            onClick={() => setSampleMessage((m) => (m ? { ...m, armed: false } : m))}>
            {SAMPLE_COPY.cancel}
          </button>
        </>
      )}
    </>
  )

  // ── Wave 14 lane W14-D's mount point: the "get started" checklist (plan 4.4) ──────────
  // ⛔ ONE line for W14-D to fill, rendered in the first-run screen AND in all three Home
  // returns below (plan 4.1: visible on first run and from then on until dismissed). In the
  // Home returns it is the FIFTH child of the same fragment, after the four boxes, so a home
  // that flips between quiet and full never remounts it mid-task. ResearchHome.welcome.test
  // .jsx holds this to exactly one assignment and four uses.
  // Integration (wave 14): W14-D's checklist fills it. It decides its own visibility
  // (checklistEnabled + its closed key), so the slot itself is unconditional.
  const gettingStartedSlot = <GettingStartedChecklist hasAnyNotes={hasAnyNotes} onCreateNote={onCreateNote} onAddSample={isPaid ? addSample : null} /> // W14-D

  if (isLoading) {
    // G-106 (Wave B lower-frequency sweep): a skeleton approximating Home's
    // own section-row layout (title, then a couple of rows) -- same idiom
    // as NoteEditorPage's note-loading skeleton -- instead of bare text.
    return (
      <div className={styles.loading} role="status" aria-label="Loading…">
        <SkeletonLine width="40%" height={18} />
        <div style={{ height: 16 }} />
        <SkeletonLine width="85%" height={13} />
        <SkeletonLine width="65%" height={13} />
      </div>
    )
  }

  if (!hasAnyNotes) {
    const canAddSample = onboarding && isPaid && !sample
    // Notebook UX pass (2026-10-10): with the wave-14 switch on (`welcomeExtras`), ONE short
    // welcome -- a sentence, ONE primary action ("Start a note"), two secondary ones (the
    // sample, where it can be had, and Import), the Learn menu beside the title, and the
    // capability preview folded into "See what it can do". "Create a thesis" and "Today" stay
    // as quiet text links (the base tour's first step still names a thesis), and "Take the
    // tour" is the Learn menu's first item. The sample button points at the preview's
    // promotion only while the preview is open (an aria-describedby must name something that
    // is there).
    // Off, it is the pre-wave-14 screen, unchanged: the six buttons, nothing wave 14 added.
    // ⛔ ONE first-run tour anchor element for both screens (the base tour's first step;
    // tourAnchors.test.js holds the attribute to exactly one occurrence in this file).
    const actions = welcomeExtras ? (
      <>
        <div className={styles.firstRunActions}>
          <button type="button" className="btn btn-primary" onClick={onCreateNote}>
            <UIcon name="plus" size={14} gold={false} /> Start a note
          </button>
          {canAddSample && (
            <button type="button" className="btn btn-ghost" onClick={addSample} disabled={adding}
              aria-describedby={previewOpen ? samplePromoId : undefined}>
              <UIcon name="book" size={14} gold={false} /> {adding ? SAMPLE_COPY.adding : SAMPLE_COPY.add}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onImport}>
            <UIcon name="upload" size={14} gold={false} /> Import notes
          </button>
        </div>
        <p className={styles.welcomeLinks}>
          <span>Or</span>
          <button type="button" className={styles.textLink} onClick={onCreateThesis}>create a thesis</button>
          {onOpenToday && (
            <>
              <span aria-hidden="true">·</span>
              <button type="button" className={styles.textLink} onClick={onOpenToday}
                title="Open today's daily note (Ctrl+Alt+D)">
                open today&apos;s note
              </button>
            </>
          )}
        </p>
      </>
    ) : (
      <>
        <button type="button" className="btn btn-primary" onClick={onCreateNote}>
          <UIcon name="plus" size={14} gold={false} /> Start a note
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCreateThesis}>
          <UIcon name="compass" size={14} gold={false} /> Create a thesis
        </button>
        <button type="button" className="btn btn-ghost" onClick={onImport}>
          <UIcon name="upload" size={14} gold={false} /> Import notes
        </button>
        {onOpenToday && (
          <button type="button" className="btn btn-ghost" onClick={onOpenToday} title="Open today's daily note (Ctrl+Alt+D)">
            <UIcon name="sun" size={14} gold={false} /> Today
          </button>
        )}
        {canAddSample && (
          <button type="button" className="btn btn-ghost" onClick={addSample} disabled={adding}>
            <UIcon name="book" size={14} gold={false} /> {adding ? SAMPLE_COPY.adding : SAMPLE_COPY.add}
          </button>
        )}
        {onboarding && (
          <button type="button" className="btn btn-ghost" onClick={openNotebookTour}>
            <UIcon name="sparkle" size={14} gold={false} /> {SAMPLE_COPY.tour}
          </button>
        )}
      </>
    )
    return (
      <div className={welcomeExtras ? `${styles.firstRun} ${styles.welcome}` : styles.firstRun}>
        {welcomeExtras ? (
          <div className={styles.welcomeHeader}>
            {/* W14-keys: the heading is where focus lands when the auto-started base tour closes
                with nothing to hand focus back to (NotebookTour.jsx), so the next Tab is the
                Learn button, then "Start a note". Script-focusable only. */}
            <h2 className={styles.firstRunTitle} tabIndex={-1} {...{ [FIRST_RUN_HEADING_ATTR]: '' }}>
              Welcome to your Notebook
            </h2>
            <LearnMenu />
          </div>
        ) : (
          <h2 className={styles.firstRunTitle}>
            Welcome to your Notebook
          </h2>
        )}
        {welcomeExtras ? (
          <p className={styles.firstRunHint}>
            Your research lives here: theses, company notes and everything tied to your trades.
          </p>
        ) : (
          <p className={styles.firstRunHint}>
            This is where your research lives — theses, company notes, captured facts, and everything
            connected to your trades. It fills in as you use it.
          </p>
        )}
        <div className={welcomeExtras ? styles.welcomeActions : styles.firstRunActions} data-tour="first-run">
          {actions}
        </div>
        {addError && <p className={styles.sampleError} role="alert">{addError}</p>}
        {welcomeExtras && (
          <div className={styles.previewDisclosure}>
            <button type="button" className={styles.previewToggle} aria-expanded={previewOpen}
              aria-controls={previewOpen ? previewId : undefined} onClick={() => setPreviewOpen((o) => !o)}>
              <UIcon name={previewOpen ? 'chevronUp' : 'chevronDown'} size={12} gold={false} />
              See what it can do
            </button>
            {previewOpen && (
              <div id={previewId}>
                <Suspense fallback={null}>
                  <CapabilityPreview canAddSample={canAddSample} promoId={samplePromoId} />
                </Suspense>
              </div>
            )}
          </div>
        )}
        {gettingStartedSlot}
        {sampleNotice}
      </div>
    )
  }

  const nothingToShow = [
    home.continueWorking, home.favorites, home.activeTheses, home.openPositionResearch, home.needsReview,
  ].every((s) => !s || s.length === 0)

  // Notebook UX pass: THE TOP OF HOME is the member's notes -- the search door and the Learn
  // menu on one row, then their recent notes. It is the FIRST child of the same fragment in
  // every return below, so the boxes after it keep their positions (and their state) when the
  // home flips between quiet and full, exactly as before.
  const homeTop = (
    <div className={styles.homeTop} data-export-exclude>
      <div className={styles.homeHeader}>
        <HomeSearch />
        <LearnMenu />
      </div>
      <RecentNotes opened={opened} edited={Array.isArray(editedNotes) ? editedNotes : []} onOpen={openNote} />
    </div>
  )

  // Wave 10 F7 (Part A, 5d): a FAILED read is not a quiet day. "Nothing needs your attention"
  // after a failed load told a member there was nothing, when we could not look.
  // Wave 11 lane 11C: "Ask Notebook to do something" -- renders nothing while its flag is
  // off. ⛔ ONE element at ONE tree position for both the quiet and the full home: applying a
  // change set refreshes the home, which can flip it from quiet to full, and a box mounted in
  // each branch was REMOUNTED by that flip -- the member's applied list and its Undo button
  // vanished mid-task (found by the lane's real-browser walk, W8 -> W9). As the first child of
  // the same fragment in both returns, React keeps it, and its state, across the flip.
  const aiBox = (
    <div className={styles.aiSlot}>
      {notebookFlag('notebook_ai_actions_enabled') === true
        ? <Suspense fallback={null}><AiActionsBox blockedNoteIds={blockedNoteIds} onOpenNote={openNote} /></Suspense>
        : null}
    </div>
  )
  // Wave 13 lane 13C: "Reporting soon" -- renders nothing while notebook_earnings_prep_enabled
  // is off. The SECOND child of the same fragment in every return below, for the same reason
  // as the box above: a home that flips between quiet and full must not remount it mid-draft.
  // Wave 14 perf lane: loaded on demand, and only while its flag is on (the box itself still
  // checks the flag too). Same element type at the same position, so a flip keeps its state.
  // Notebook UX pass: each box below folds (HomeBox), and an empty one starts folded.
  const prepBox = prepOn ? (
    <HomeBox id="nb-home-reporting-soon" title="Reporting soon" meta={prepState.meta}
      known={prepState.known} defaultOpen={prepState.open} openSignal={tourSignal || prepSignal}>
      <Suspense fallback={null}><ReportingSoon onOpenNote={openNote} /></Suspense>
    </HomeBox>
  ) : null
  // Wave 13 lane 13G-1: "Passed setups" -- nothing (and no fetch) while
  // notebook_passed_setups_enabled is off. The THIRD child of the same fragment in every
  // return below, for the same reason as the two boxes above.
  const passedBox = passedOn ? (
    <HomeBox id="nb-home-passed-setups" title="Passed setups" meta={passedState.meta}
      known={passedState.known} defaultOpen={passedState.open} openSignal={tourSignal}>
      <Suspense fallback={null}><PassedSetups /></Suspense>
    </HomeBox>
  ) : null
  // Wave 13 lane 13F: "Reviews that write themselves" -- the FOURTH child of the same
  // fragment in every return below, for the same reason as the three boxes above (a
  // home that flips between quiet and full must not remount it mid-draft). Its three drafts
  // are always there to press, so it starts open.
  const reviewBox = reviewDraftsEnabled() ? (
    <HomeBox id="nb-home-reviews" title="Reviews that write themselves" meta="Daily, weekly and monthly"
      defaultOpen openSignal={tourSignal}>
      <ReviewDraftsHomeBox onOpenNote={openNote} skipLinkClassName={skipLinkClassName} titleHidden />
    </HomeBox>
  ) : null
  // Wave 13 lane 13Q-3 (click-budget fix, Q5): same "one authority" reasoning as the three
  // boxes above -- rendered in EVERY non-first-run, non-loading state (quiet-with-error,
  // quiet, and the full home) so a member landing on bare-root Research Home always has a
  // one-press door to Today, whatever else is or isn't on the page that day.
  const todayBox = onOpenToday ? (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={onOpenToday}
      title="Open today's daily note (Ctrl+Alt+D)"
      style={{ marginBottom: 10 }}
    >
      <UIcon name="sun" size={14} gold={false} /> Today
    </button>
  ) : null
  // Finish program, lane NAV: the active setups board's one door (BETA-HANDOFF 1b said "No
  // menu link to it yet"). Rendered beside Today in the same three states, and ONLY while
  // notebook_setups_board_enabled is on: off, this is null and the page is the page it was
  // (ResearchHome.setupsDoor.test.jsx compares the two renders). A link, never an import of
  // the board page: Research Home is on the first-open path and the board carries charts.
  const setupsLink = setupsBoardEnabled() ? (
    <Link className={`btn btn-ghost ${styles.setupsLink}`} to={SETUPS_BOARD_PATH}
      title="Your open chart plans, closest to their entry first">
      Active setups
    </Link>
  ) : null

  // Finish program (fin-walk 8.3): a member with notes but nothing surfaced -- the quiet home --
  // had NO Ask door; it was rendered only by the full home below. Ask reads the whole Notebook,
  // not the sections, so it belongs in every state that has notes to ask about (the first-run
  // branch above has none). The same element at the same tree position (fourth child of the
  // state's container, after the sample notice, Today and Active setups) in the quiet, the
  // quiet-with-error and the full home, so a flip between them keeps an open panel and its
  // answer mounted -- the same reasoning as the four boxes above.
  const askRow = (
    <div className={styles.askRow}>
      {/* ⛔ An EXCERPT citation used to be a dead click here: its navigation
          carries no `note_id`, and this handler knew nothing else. The one
          shared router opens it in place, and returns a sentence for
          AskPanel to show when a source cannot be opened. */}
      <AskPanel scope="notebook" onOpenNote={openNote} onNavigate={(s, _r, { signal } = {}) => openSpanningCitation(s, {
        signal, openNote, openDocument: setPreviewDoc, openCapturedSource: setCapturedSource,
      })} />
    </div>
  )

  if (nothingToShow && homeError) {
    return (
      <>
        {homeTop}
        {aiBox}
        {prepBox}
        {passedBox}
        {reviewBox}
        {gettingStartedSlot}
        <div className={styles.quietState}>
          {sampleNotice}
          {todayBox}
          {setupsLink}
          {askRow}
          <LoadFailed what="your research home" error={homeError} onRetry={refreshHome} />
        </div>
      </>
    )
  }

  if (nothingToShow) {
    return (
      <>
        {homeTop}
        {aiBox}
        {prepBox}
        {passedBox}
        {reviewBox}
        {gettingStartedSlot}
        <div className={styles.quietState}>
          {sampleNotice}
          {todayBox}
          {setupsLink}
          {askRow}
          <p>Nothing needs your attention right now.</p>
          <p className={styles.quietHint}>Favorite a note or set a thesis to Active to see it here.</p>
        </div>
      </>
    )
  }

  return (
    <>
    {homeTop}
    {aiBox}
    {prepBox}
    {passedBox}
    {reviewBox}
    {gettingStartedSlot}
    <div className={styles.home} data-export-exclude>
      {sampleNotice}
      {todayBox}
      {setupsLink}
      {/* ⛔ A CALM ENTRY POINT, NOT AN AI DASHBOARD. Research Home still
          answers "what was I working on, and where do I resume?" -- Ask is
          one affordance on that page, not the page. */}
      {askRow}
      {/* "Continue working" is the top of Home now (Recent notes, homeTop). */}
      <Section title="Favorites" notes={home.favorites} onOpen={openNote} />
      <Section title="Active theses" notes={home.activeTheses} onOpen={openNote} />
      <Section
        title="Connected to your open positions"
        notes={home.openPositionResearch}
        onOpen={openNote}
        emptyReason={<span className={styles.rowDate}>Open position</span>}
      />
      <Section title="Needs review" notes={home.needsReview} onOpen={openNote} />
      <DocumentPreviewSheet
        open={!!previewDoc}
        href={previewDoc?.href}
        name={previewDoc?.name}
        page={previewDoc?.page}
        onClose={() => setPreviewDoc(null)}
        /* The viewer emphasises an excerpt only if it is HANDED that excerpt. */
        excerpts={previewDoc?.emphasizeExcerpt ? [previewDoc.emphasizeExcerpt] : []}
        emphasizeExcerptId={previewDoc?.emphasizeExcerptId}
        documentId={previewDoc?.documentId}
        onOpenNote={openNote}
      />
      <CapturedSourceSheet
        open={!!capturedSource}
        excerpt={capturedSource}
        onClose={() => setCapturedSource(null)}
        onOpenOwningNote={capturedSource ? () => {
          const id = capturedSource.noteId
          setCapturedSource(null)
          openNote({ id })
        } : null}
      />
    </div>
    </>
  )
}
