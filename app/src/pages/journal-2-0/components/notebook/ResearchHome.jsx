import { Suspense, useEffect, useId, useRef, useState } from 'react'
import lazyChunk, { importWithOneRetry } from '../../lib/lazyChunk'
import { Link, useNavigate } from 'react-router-dom'
import useSWR, { useSWRConfig } from 'swr'
import UIcon from '../../../../components/ui/UIcon'
import usePreferences from '../../../../hooks/usePreferences'
import { useIsPaid } from '../../../../context/AuthContext'
import useNotebookHome from '../../hooks/useNotebookHome'
import { notebookFlag } from '../../lib/offline/notebookFlags'
import { openNotebookTour } from './onboarding/tourControl'
import {
  SAMPLE_URL, SAMPLE_PREF, SAMPLE_COPY, readSamplePref, addSampleNotebook, removeSampleNotebook, isNotebookKey,
  describeSampleHold,
} from './onboarding/sampleNotebook'
import { precheckNoteBatch } from '../../lib/noteBatch'
import { openSpanningCitation } from '../../lib/openCitation'
import AskPanel from './AskPanel'
import { earningsPrepEnabled } from '../../lib/earningsPrepShared'
import { passedSetupsEnabled } from '../../lib/researchCapture'
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
function ReviewDraftsHomeBox({ onOpenNote }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  if (!reviewDraftsEnabled()) return null

  const run = async (period, fn) => {
    if (busy) return
    setBusy(period)
    setError(null)
    try {
      // A failed fetch of the drafts chunk lands in the catch below, like a failed draft.
      const { note } = await fn(await loadReviewDrafts())
      onOpenNote(note)
    } catch {
      setError(`Could not draft the ${period} review — try again.`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={styles.section} data-tour="review-drafts-home">
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Reviews that write themselves</h3>
      </div>
      <div className={styles.rows} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '4px 0' }}>
        <button type="button" className="btn btn-ghost" disabled={Boolean(busy)} data-tour="review-drafts-daily"
          onClick={() => run('daily', (m) => m.draftDailyReview({ day: m.todayDayIso() }))}>
          <UIcon name="book" size={14} gold={false} /> {busy === 'daily' ? 'Drafting…' : "Today's recap"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={Boolean(busy)} data-tour="review-drafts-weekly"
          onClick={() => run('weekly', (m) => m.draftWeeklyReview({ weekStart: m.mondayOfIso() }))}>
          <UIcon name="book" size={14} gold={false} /> {busy === 'weekly' ? 'Drafting…' : "This week's review"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={Boolean(busy)} data-tour="review-drafts-monthly"
          onClick={() => run('monthly', (m) => m.draftMonthlyReview({ month: m.thisMonthIso() }))}>
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
}) {
  const { home, isLoading, error: homeError, refresh: refreshHome } = useNotebookHome()
  const navigate = useNavigate()
  // What an Ask citation opened in place: a document page, or a captured web
  // passage (lib/openCitation.js decides which).
  const [previewDoc, setPreviewDoc] = useState(null)
  const [capturedSource, setCapturedSource] = useState(null)

  const openNote = (note) => (onOpenNote ? onOpenNote(note) : navigate(notePath(note.id)))

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
      setSampleMessage({ alert: false, text: SAMPLE_COPY.removed })
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
    // Wave 14 lane W14-A (plan 4.1, default D1): today's buttons stay exactly as they are,
    // first. Under them, a short text preview of what the Notebook can do (only the
    // capabilities armed for this member) and the sample notebook's promotion. Both ride
    // `welcomeExtras` (onboarding AND the checklist's own flag; integration ruling).
    const canAddSample = onboarding && isPaid && !sample
    return (
      <div className={styles.firstRun}>
        {/* W14-keys: with the wave-14 switch on, the heading is where focus lands when the
            auto-started base tour closes with nothing to hand focus back to (NotebookTour.jsx),
            so the next Tab is "Start a note". Script-focusable only; off, it is the old heading. */}
        <h2 className={styles.firstRunTitle}
          {...(welcomeExtras ? { tabIndex: -1, [FIRST_RUN_HEADING_ATTR]: '' } : {})}>
          Welcome to your Notebook
        </h2>
        <p className={styles.firstRunHint}>
          This is where your research lives — theses, company notes, captured facts, and everything
          connected to your trades. It fills in as you use it.
        </p>
        <div className={styles.firstRunActions} data-tour="first-run">
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
            <button type="button" className="btn btn-ghost" onClick={addSample} disabled={adding}
              aria-describedby={welcomeExtras ? samplePromoId : undefined}>
              <UIcon name="book" size={14} gold={false} /> {adding ? SAMPLE_COPY.adding : SAMPLE_COPY.add}
            </button>
          )}
          {onboarding && (
            <button type="button" className="btn btn-ghost" onClick={openNotebookTour}>
              <UIcon name="sparkle" size={14} gold={false} /> {SAMPLE_COPY.tour}
            </button>
          )}
        </div>
        {addError && <p className={styles.sampleError} role="alert">{addError}</p>}
        {welcomeExtras && (
          <Suspense fallback={null}>
            <CapabilityPreview canAddSample={canAddSample} promoId={samplePromoId} />
          </Suspense>
        )}
        {gettingStartedSlot}
        {sampleNotice}
      </div>
    )
  }

  const nothingToShow = [
    home.continueWorking, home.favorites, home.activeTheses, home.openPositionResearch, home.needsReview,
  ].every((s) => !s || s.length === 0)

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
  const prepBox = earningsPrepEnabled()
    ? <Suspense fallback={null}><ReportingSoon onOpenNote={openNote} /></Suspense>
    : null
  // Wave 13 lane 13G-1: "Passed setups" -- nothing (and no fetch) while
  // notebook_passed_setups_enabled is off. The THIRD child of the same fragment in every
  // return below, for the same reason as the two boxes above.
  const passedBox = passedSetupsEnabled()
    ? <Suspense fallback={null}><PassedSetups /></Suspense>
    : null
  // Wave 13 lane 13F: "Reviews that write themselves" -- the FOURTH child of the same
  // fragment in every return below, for the same reason as the three boxes above (a
  // home that flips between quiet and full must not remount it mid-draft).
  const reviewBox = <ReviewDraftsHomeBox onOpenNote={openNote} />
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

  if (nothingToShow && homeError) {
    return (
      <>
        {aiBox}
        {prepBox}
        {passedBox}
        {reviewBox}
        {gettingStartedSlot}
        <div className={styles.quietState}>
          {sampleNotice}
          {todayBox}
          {setupsLink}
          <LoadFailed what="your research home" error={homeError} onRetry={refreshHome} />
        </div>
      </>
    )
  }

  if (nothingToShow) {
    return (
      <>
        {aiBox}
        {prepBox}
        {passedBox}
        {reviewBox}
        {gettingStartedSlot}
        <div className={styles.quietState}>
          {sampleNotice}
          {todayBox}
          {setupsLink}
          <p>Nothing needs your attention right now.</p>
          <p className={styles.quietHint}>Favorite a note or set a thesis to Active to see it here.</p>
        </div>
      </>
    )
  }

  return (
    <>
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
      <div className={styles.askRow}>
        {/* ⛔ An EXCERPT citation used to be a dead click here: its navigation
            carries no `note_id`, and this handler knew nothing else. The one
            shared router opens it in place, and returns a sentence for
            AskPanel to show when a source cannot be opened. */}
        <AskPanel scope="notebook" onOpenNote={openNote} onNavigate={(s, _r, { signal } = {}) => openSpanningCitation(s, {
          signal, openNote, openDocument: setPreviewDoc, openCapturedSource: setCapturedSource,
        })} />
      </div>
      <Section title="Continue working" notes={home.continueWorking} onOpen={openNote} viewAllHref="/journal/notebook?view=all" />
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
