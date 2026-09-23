/**
 * Wave 5 — the quiet word-count / reading-time readout in the editor toolbar
 * ("1,204 words · 5 min read"), which becomes the selection's share while
 * text is selected ("38 of 1,204 words selected").
 *
 * ⛔ OFF THE KEYSTROKE PATH. The page already re-renders on every transaction;
 * counting a large note is a full walk of its text, so the NOTE count is
 * recomputed a beat after typing pauses (`DOC_DEBOUNCE_MS`), never inside the
 * keystroke. The selection count walks only the selection, on a shorter beat.
 * Not a live region: a count that changes with every word must not talk over
 * the member's screen reader; it is plain text in the toolbar's reading order.
 */
import { useEffect, useState } from 'react'
import { noteStats, selectionWords, statsLabel } from '../../lib/noteStats'
import styles from './NoteStats.module.css'

export const DOC_DEBOUNCE_MS = 400
export const SELECTION_DEBOUNCE_MS = 120

export default function NoteStats({ editor }) {
  const [stats, setStats] = useState(() => (editor ? noteStats(editor.state.doc) : { words: 0, minutes: 0 }))
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    if (!editor) return undefined
    let docTimer = null
    let selTimer = null
    setStats(noteStats(editor.state.doc))
    const onUpdate = () => {
      clearTimeout(docTimer)
      docTimer = setTimeout(() => {
        if (!editor.isDestroyed) setStats(noteStats(editor.state.doc))
      }, DOC_DEBOUNCE_MS)
    }
    const onSelection = () => {
      clearTimeout(selTimer)
      selTimer = setTimeout(() => {
        if (!editor.isDestroyed) setSelected(selectionWords(editor.state))
      }, SELECTION_DEBOUNCE_MS)
    }
    editor.on('update', onUpdate)
    editor.on('selectionUpdate', onSelection)
    return () => {
      clearTimeout(docTimer)
      clearTimeout(selTimer)
      editor.off('update', onUpdate)
      editor.off('selectionUpdate', onSelection)
    }
  }, [editor])

  const label = statsLabel(stats, selected)
  return (
    <span className={styles.stats} data-testid="note-stats" title={label}>
      {label}
    </span>
  )
}
