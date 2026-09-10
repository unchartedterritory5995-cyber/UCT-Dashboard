import UIcon from '../../../../components/ui/UIcon'
import { BLOCKED_BADGE, BLOCKED_TITLE } from '../../lib/offline/unsyncedCopy'
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

// `onRestore`, when passed, renders a trashed note: opening it would 404
// (a soft-deleted note must be restored before it can be edited — see
// notes_service.get_note's default filter), so the card is inert rather
// than a click-to-open button, with an explicit Restore action instead.
// Wave Q1 — the note is holding words the server does not have, and the queue
// has stopped trying on its own. ⛔ The sentence names the ACTION, because the
// state alone ("not synced") tells a member something is wrong and nothing
// about what to do; a later edit is what un-blocks it.
function BlockedBadge() {
  return (
    <span className={styles.unsynced} title={BLOCKED_TITLE}>
      <UIcon name="warning" size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />
      {BLOCKED_BADGE}
    </span>
  )
}

export default function NoteCard({ note, onOpen, onRestore, blocked = false }) {
  const title = note.title?.trim() || 'Untitled'
  const thumb = cardThumb(note)

  if (onRestore) {
    return (
      <div className={styles.card} data-trashed="true">
        <div className={styles.body}>
          <div className={styles.title}>{title}</div>
          {note.subtitle && <div className={styles.subtitle}>{note.subtitle}</div>}
          <div className={styles.metaRow}>
            <span className={styles.date}>{relativeDate(note.updatedAt)}</span>
            {note.ticker && <span className={styles.ticker}>${note.ticker}</span>}
            {/* ⛔ NO blocked badge on a TRASHED card, deliberately. The sentence
                names an action — "edit it again" — and a trashed note cannot be
                opened to edit; it must be restored first. A badge instructing a
                member to do something the card will not let them do is worse
                than silence, and this card is already the one surface that is
                inert by design. */}
          </div>
          <button
            type="button"
            className={styles.restoreBtn}
            onClick={() => onRestore(note)}
          >
            Restore
          </button>
        </div>
        {thumb && (
          <div className={styles.thumb} aria-hidden="true">
            <img src={thumb} alt="" loading="lazy" />
          </div>
        )}
      </div>
    )
  }

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
          {blocked && <BlockedBadge />}
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
