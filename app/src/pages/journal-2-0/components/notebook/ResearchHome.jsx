import { Link, useNavigate } from 'react-router-dom'
import UIcon from '../../../../components/ui/UIcon'
import useNotebookHome from '../../hooks/useNotebookHome'
import { notePath } from '../../../../hooks/useNoteBacklinks'
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

/**
 * Wave H — Research Home. Renders in place of the bare-root All Notes grid
 * (checkpoint decision 33/57) -- "All notes" itself stays one click away in
 * the sidebar, unchanged. Four sections (checkpoint decision 11), each
 * independently collapsing when empty (checkpoint decision 13) -- no
 * dashboard grid of dead cards. "Upcoming Catalysts" and "Recent Captures"
 * are deliberately absent (checkpoint decision 12).
 */
export default function ResearchHome({ onOpenNote, onCreateNote, onCreateThesis, onImport, hasAnyNotes }) {
  const { home, isLoading } = useNotebookHome()
  const navigate = useNavigate()

  const openNote = (note) => (onOpenNote ? onOpenNote(note) : navigate(notePath(note.id)))

  if (isLoading) {
    return <div className={styles.loading}>Loading…</div>
  }

  if (!hasAnyNotes) {
    return (
      <div className={styles.firstRun}>
        <h2 className={styles.firstRunTitle}>Welcome to your Notebook</h2>
        <p className={styles.firstRunHint}>
          This is where your research lives — theses, company notes, captured facts, and everything
          connected to your trades. It fills in as you use it.
        </p>
        <div className={styles.firstRunActions}>
          <button type="button" className="btn btn-primary" onClick={onCreateNote}>
            <UIcon name="plus" size={14} gold={false} /> Start a note
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCreateThesis}>
            <UIcon name="compass" size={14} gold={false} /> Create a thesis
          </button>
          <button type="button" className="btn btn-ghost" onClick={onImport}>
            <UIcon name="upload" size={14} gold={false} /> Import notes
          </button>
        </div>
      </div>
    )
  }

  const nothingToShow = [
    home.continueWorking, home.favorites, home.activeTheses, home.openPositionResearch, home.needsReview,
  ].every((s) => !s || s.length === 0)

  if (nothingToShow) {
    return (
      <div className={styles.quietState}>
        <p>Nothing needs your attention right now.</p>
        <p className={styles.quietHint}>Favorite a note or set a thesis to Active to see it here.</p>
      </div>
    )
  }

  return (
    <div className={styles.home} data-export-exclude>
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
    </div>
  )
}
