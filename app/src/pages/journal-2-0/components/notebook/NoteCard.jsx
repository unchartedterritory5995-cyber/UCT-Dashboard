import styles from './NoteCard.module.css'

function relativeDate(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffSec = Math.max(0, (now - then) / 1000)
  if (diffSec < 60) return 'now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d`
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / (86400 * 7))}w`
  return `${Math.floor(diffSec / (86400 * 30))}mo`
}

// The card's little preview glyph: the first inline image placed in the note,
// or an existing still-image hero. Video heroes (YouTube) are skipped — they're
// not a "photo or png".
function cardThumb(note) {
  if (note.firstImageUrl) return note.firstImageUrl
  const h = note.heroImageUrl
  if (typeof h === 'string' && h && !/youtube\.com|youtu\.be/.test(h)) return h
  return null
}

export default function NoteCard({ note, onOpen }) {
  const title = note.title?.trim() || 'Untitled'
  const thumb = cardThumb(note)
  return (
    <button type="button" className={styles.card} onClick={() => onOpen(note)}>
      <div className={styles.body}>
        <div className={styles.title}>{title}</div>
        {note.subtitle && <div className={styles.subtitle}>{note.subtitle}</div>}
        <div className={styles.metaRow}>
          <span className={styles.date}>{relativeDate(note.updatedAt)}</span>
          {note.ticker && <span className={styles.ticker}>${note.ticker}</span>}
          {(note.tags || []).slice(0, 3).map((t) => (
            <span key={t} className={styles.tag}>#{t}</span>
          ))}
        </div>
      </div>
      {thumb && (
        <div className={styles.thumb} aria-hidden="true">
          <img src={thumb} alt="" loading="lazy" />
        </div>
      )}
    </button>
  )
}
