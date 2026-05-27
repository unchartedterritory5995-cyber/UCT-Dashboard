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

export default function NoteCard({ note, onOpen }) {
  const title = note.title?.trim() || 'Untitled'
  const initials = title.slice(0, 2).toUpperCase()
  const snippet = (note.bodyPlain || '').slice(0, 160)
  return (
    <button type="button" className={styles.card} onClick={() => onOpen(note)}>
      {note.heroImageUrl ? (
        <div className={styles.hero}>
          <img src={note.heroImageUrl} alt="" />
        </div>
      ) : (
        <div className={styles.heroFallback}>
          <span>{initials}</span>
        </div>
      )}
      <div className={styles.body}>
        <div className={styles.title}>{title}</div>
        {note.subtitle && <div className={styles.subtitle}>{note.subtitle}</div>}
        {snippet && <div className={styles.snippet}>{snippet}</div>}
        <div className={styles.metaRow}>
          <span className={styles.date}>{relativeDate(note.updatedAt)}</span>
          {note.ticker && <span className={styles.ticker}>${note.ticker}</span>}
          {(note.tags || []).slice(0, 3).map((t) => (
            <span key={t} className={styles.tag}>#{t}</span>
          ))}
        </div>
      </div>
    </button>
  )
}
