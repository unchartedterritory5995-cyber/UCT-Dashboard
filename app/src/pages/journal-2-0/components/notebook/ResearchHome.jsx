import { useEffect, useRef, useState } from 'react'
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
import DocumentPreviewSheet from './DocumentPreviewSheet'
import CapturedSourceSheet from './CapturedSourceSheet'
import { notePath } from '../../../../hooks/useNoteBacklinks'
import { SkeletonLine } from '../../../../components/Skeleton'
import styles from './ResearchHome.module.css'

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

const fetchStatus = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

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
}) {
  const { home, isLoading } = useNotebookHome()
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
  const wantStatus = onboarding && hasAnyNotes && !!sample && !sample.dismissedAt
  const { data: sampleStatus } = useSWR(wantStatus ? SAMPLE_URL : null, fetchStatus, { revalidateOnFocus: false })
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
    if (sample) setPref(SAMPLE_PREF, { ...sample, dismissedAt: new Date().toISOString() })
  }

  const sampleNotice = (
    <>
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
    return (
      <div className={styles.firstRun}>
        <h2 className={styles.firstRunTitle}>Welcome to your Notebook</h2>
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
          {onboarding && isPaid && !sample && (
            <button type="button" className="btn btn-ghost" onClick={addSample} disabled={adding}>
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
        {sampleNotice}
      </div>
    )
  }

  const nothingToShow = [
    home.continueWorking, home.favorites, home.activeTheses, home.openPositionResearch, home.needsReview,
  ].every((s) => !s || s.length === 0)

  if (nothingToShow) {
    return (
      <div className={styles.quietState}>
        {sampleNotice}
        <p>Nothing needs your attention right now.</p>
        <p className={styles.quietHint}>Favorite a note or set a thesis to Active to see it here.</p>
      </div>
    )
  }

  return (
    <div className={styles.home} data-export-exclude>
      {sampleNotice}
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
  )
}
