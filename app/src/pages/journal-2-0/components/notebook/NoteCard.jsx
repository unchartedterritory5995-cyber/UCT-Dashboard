import BlockedBadge from './BlockedBadge'
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
// about what to do; a later edit is what un-blocks it. BlockedBadge is now
// shared across all four note-list views (UX #15, 2026-09-22) -- see
// BlockedBadge.jsx.

/**
 * Wave 5 bulk operations: `selectable` puts a real checkbox BESIDE the card —
 * never inside it: the active card is a <button>, and a checkbox nested in a
 * button is invalid HTML that screen readers flatten into one control.
 * ⛔ `data-note-card-id` stays on the card itself and nowhere else: the
 * joystick hub reads that attribute document-wide to count and address the
 * notes on screen, so a second element carrying it would double-count.
 * Shift is read off the click that produced the change, so Shift+click (or
 * Shift+Space) selects a range.
 */
export default function NoteCard({
  note, onOpen, onRestore, blocked = false,
  selectable = false, selected = false, onToggleSelect,
}) {
  const title = note.title?.trim() || 'Untitled'
  const card = renderCard({ note, title, onOpen, onRestore, blocked })
  if (!selectable) return card
  return (
    <div className={`${styles.selectWrap} ${selected ? styles.selectWrapOn : ''}`}>
      <label className={styles.selectBox}>
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggleSelect?.(note, { shift: Boolean(e.nativeEvent?.shiftKey) })}
          aria-label={`Select ${title}`}
        />
      </label>
      {card}
    </div>
  )
}

function renderCard({ note, title, onOpen, onRestore, blocked }) {
  const thumb = cardThumb(note)

  if (onRestore) {
    return (
      <div className={styles.card} data-note-card-id={note.id} data-trashed="true">
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
    <button type="button" className={styles.card} data-note-card-id={note.id} onClick={() => onOpen(note)}>
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
