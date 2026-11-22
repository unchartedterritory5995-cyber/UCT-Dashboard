// Audit 2026-11-05, spec S2: the ticker a note is linked to is the member's choice.
//
// ⛔ A blank note used to inherit the last symbol charted (B1: `ticker || focusSymbol` in
// NotebookTab's createNote), and the server then autofilled sector, industry and theme for a stock
// the member never typed. That stamp is gone. This is what replaces it: once the body names the
// same `$TICKER` twice, a quiet line under the title OFFERS the link -- "Link this note to $NVDA?"
// [Link] [No] -- and nothing changes until the member answers.
//
// * The `$SYM` reading is the editor's own (`findTickerRanges`, the same regex the `$TICKER` chip
//   decorates with), never a second one. A bare word is not a ticker: RS, EMA and GAP are real
//   symbols AND ordinary words, so only the `$` the member typed counts.
// * Link goes through the editor's ticker door (`onLink` = NoteEditorPage's onTickerChange), the
//   one the Ticker field uses: same check, same metadata write, same settle.
// * No hides the offer for THIS note, on this device (localStorage, one key per note id).
// * Never on a note that already has a ticker, or a read-only (locked, unreadable) note.
// * Reads the body on the editor's `update` event, debounced, never on every render.
import { useEffect, useState } from 'react'
import { findTickerRanges } from '../../lib/tickerChip'
import styles from './TickerSuggestion.module.css'

export const TICKER_SUGGEST_DISMISS_KEY = 'uct.nb.tickerSuggest.no.'
const READ_DELAY_MS = 400

/** The first `$SYM` the text names twice, or null. */
export function suggestedTicker(text) {
  const seen = new Map()
  for (const r of findTickerRanges(text)) {
    const n = (seen.get(r.symbol) || 0) + 1
    if (n >= 2) return r.symbol
    seen.set(r.symbol, n)
  }
  return null
}

function dismissed(noteId) {
  try { return localStorage.getItem(`${TICKER_SUGGEST_DISMISS_KEY}${noteId}`) === '1' } catch { return false }
}

export default function TickerSuggestion({ editor, noteId, ticker, readOnly = false, onLink }) {
  const [symbol, setSymbol] = useState(() => (editor ? suggestedTicker(editor.getText()) : null))
  const [no, setNo] = useState(() => dismissed(noteId))
  const [busy, setBusy] = useState(false)

  useEffect(() => { setNo(dismissed(noteId)) }, [noteId])

  useEffect(() => {
    if (!editor || ticker || readOnly || no) return undefined
    setSymbol(suggestedTicker(editor.getText()))
    let t = null
    const onUpdate = () => {
      clearTimeout(t)
      t = setTimeout(() => {
        if (!editor.isDestroyed) setSymbol(suggestedTicker(editor.getText()))
      }, READ_DELAY_MS)
    }
    editor.on('update', onUpdate)
    return () => { clearTimeout(t); editor.off('update', onUpdate) }
  }, [editor, ticker, readOnly, no])

  const showing = Boolean(symbol && !ticker && !readOnly && !no && noteId)
  const sentence = showing ? `Link this note to $${symbol}?` : ''

  const link = async () => {
    if (busy) return
    setBusy(true)
    try { await onLink?.(symbol) } finally { setBusy(false) }
  }
  const decline = () => {
    try { localStorage.setItem(`${TICKER_SUGGEST_DISMISS_KEY}${noteId}`, '1') } catch { /* private mode: this visit only */ }
    setNo(true)
  }

  // Fix round 1 (review minor 10): a polite status region that is THERE before the offer appears,
  // so a screen reader hears it once when it does (a region mounted with its words is not read).
  if (!editor || !noteId) return null
  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">{sentence}</span>
      {showing && (
        <div role="group" aria-label="Ticker suggestion" className={styles.offer} data-export-exclude>
          <span className={styles.text} aria-hidden="true">{sentence}</span>
          {/* Names that say what they do out of context; each holds its visible word (label in name). */}
          <button type="button" className={styles.btn} onClick={link} disabled={busy}
            aria-label={`Link note to $${symbol}`}>Link</button>
          <button type="button" className={styles.btn} onClick={decline} disabled={busy}
            aria-label="No, don't link">No</button>
        </div>
      )}
    </>
  )
}
