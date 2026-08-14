import { useState } from 'react'
import useNoteBacklinks, { notePath } from '../hooks/useNoteBacklinks'
import UIcon from './ui/UIcon'
import styles from './JournalBacklinks.module.css'

/**
 * "4 entries" — the journal, visible from any ticker surface in the app.
 *
 * ONE component so every surface that adopts it reads the same way (the
 * six hand-rolled capture doors are the cautionary tale). Renders NOTHING
 * when the ticker appears in no entry: a chip that says "0 entries" on
 * every symbol you have never written about is noise, not information.
 *
 * `enabled` gates the fetch — see useNoteBacklinks (TickerPopup hovers).
 */
export default function JournalBacklinks({ symbol, enabled = true, style }) {
  const { count, notes } = useNoteBacklinks(symbol, enabled)
  const [open, setOpen] = useState(false)
  if (!count) return null

  return (
    <span className={styles.wrap} style={style}>
      <button
        type="button"
        className={`${styles.chip} ${open ? styles.chipOpen : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={`${symbol} appears in ${count} journal ${count === 1 ? 'entry' : 'entries'}`}
        aria-expanded={open}
      >
        <UIcon name="journal" size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
        {count} {count === 1 ? 'entry' : 'entries'}
      </button>
      {open && (
        <div className={styles.pop} role="dialog" aria-label={`Journal entries mentioning ${symbol}`}>
          {notes.map((n) => (
            <a key={n.id} className={styles.row} href={notePath(n.id)}>
              <span className={styles.rowTitle}>{n.title}</span>
              <span className={styles.rowMeta}>
                {n.refs > 1 ? `${n.refs}×` : ''} {fmtDay(n.updatedAt)}
              </span>
            </a>
          ))}
          {count > notes.length && (
            <div className={styles.more}>+{count - notes.length} more</div>
          )}
        </div>
      )}
    </span>
  )
}

function fmtDay(iso) {
  const d = new Date(iso || '')
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
