// app/src/components/chart/IndicatorUndoToast.jsx
//
// ⭐ A1.2 — "RSI hidden (2) · Undo". Shown in the chart for 8 s after a member's indicator
// change on this surface (paused while hovered or focused); after Undo it turns into
// "Undone · Redo" for 5 s. A refusal ("Can't undo: RSI changed since.") writes nothing.
//
// ⛔ CTRL+Z ONLY WHILE VISIBLE. While the toast shows, a window CAPTURE-phase listener takes
// Ctrl/Cmd+Z (and Ctrl+Shift+Z / Ctrl+Y while "Redo" shows) — ahead of the drawing layer's
// bubble-phase undo. It never acts in a text field, a select, an editable element or an
// open modal, so native text undo and the builder win. With no toast there is no listener,
// and Ctrl+Z undoes drawings exactly as before.

import { useEffect, useState, useCallback } from 'react'
import {
  useIndicatorHistory, undoIndicatorChange, redoIndicatorChange,
} from './indicatorHistoryStore'
import { isModalOpen } from '../../utils/modalOpen'
import { registerShortcuts } from '../../pages/command/shortcutRegistry'
import styles from './IndicatorUndoToast.module.css'

export const TOAST_MS = 8000
export const REDO_MS = 5000

const isEditable = (t) => !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

// ONE toast owns the keys at a time (the registry refuses a second live binding of an id).
let keyOwner = null

/**
 * @param {object} p
 * @param {string} p.surfaceKey   `indicatorHistoryKey(...)` for this chart
 * @param {string|null} p.userId
 * @param {string|null} p.chartId  this chart's id; an entry from another chart on the same
 *                                 surface is not toasted here
 * @param {object} p.cs            the chart's CURRENT settings (what Undo is checked against)
 * @param {(cs:object)=>void} p.write  the surface's own sink (it must NOT record)
 */
export default function IndicatorUndoToast({ surfaceKey, userId = null, chartId = null, cs, write }) {
  const { past } = useIndicatorHistory(surfaceKey, userId)
  const newest = past[past.length - 1] || null
  const [shown, setShown] = useState(null)   // { mode: 'undo'|'redo'|'refused', entry, text }
  const [paused, setPaused] = useState(false)
  // When this chart mounted: an entry older than that (a reload's restored stack) is not
  // toasted. A NEW entry — from this chart, or from no chart in particular — replaces what
  // is showing. Derived during render (React's "adjust state on prop change"), not in an effect.
  const [mountedAt] = useState(() => Date.now())
  // EVERY id ever seen here — after an Undo the previous entry becomes the newest again,
  // and it must not toast a second time.
  const [seen, setSeen] = useState(() => new Set())
  if (newest && !seen.has(newest.id)) {
    setSeen(new Set([...seen, newest.id]))
    if (newest.toast && newest.at >= mountedAt && !(newest.origin && chartId && newest.origin !== chartId)) {
      setShown({ mode: 'undo', entry: newest, text: newest.label })
    }
  }

  // The timer: 8 s for Undo, 5 s for Redo / a refusal; held while hovered or focused.
  useEffect(() => {
    if (!shown || paused) return undefined
    const t = setTimeout(() => setShown(null), shown.mode === 'undo' ? TOAST_MS : REDO_MS)
    return () => clearTimeout(t)
  }, [shown, paused])

  const doUndo = useCallback(() => {
    const r = undoIndicatorChange(surfaceKey, cs, write, { userId })
    if (r.ok) setShown({ mode: 'redo', entry: r.entry, text: 'Undone' })
    else if (r.reason === 'changed-since') setShown({ mode: 'refused', entry: r.entry, text: `Can't undo: ${r.entry?.label ? r.entry.label.replace(/ (hidden|shown|added)( \(\d+\))?$/, '') : 'the indicator'} changed since.` })
    else setShown(null)
  }, [surfaceKey, cs, write, userId])

  const doRedo = useCallback(() => {
    const r = redoIndicatorChange(surfaceKey, cs, write, { userId })
    if (r.ok) setShown({ mode: 'undo', entry: r.entry, text: r.entry.label })
    else if (r.reason === 'changed-since') setShown({ mode: 'refused', entry: r.entry, text: "Can't redo: the chart changed since." })
    else setShown(null)
  }, [surfaceKey, cs, write, userId])

  // ⛔ CAPTURE-PHASE Ctrl+Z, ONLY WHILE VISIBLE (see the header) — declared in the keyboard
  // registry (`indicators.undo` / `indicators.redo` / `indicators.redoY`).
  useEffect(() => {
    if (!shown || shown.mode === 'refused') return undefined
    if (keyOwner) return undefined
    const token = {}
    keyOwner = token
    const take = (want, fn) => (e) => {
      if (isEditable(e.target) || isModalOpen(e.target)) return
      if (shown.mode !== want) return
      e.preventDefault()
      e.stopImmediatePropagation()
      fn()
    }
    let unbind = null
    try {
      unbind = registerShortcuts({
        'indicators.undo': take('undo', doUndo),
        'indicators.redo': take('redo', doRedo),
        'indicators.redoY': take('redo', doRedo),
      })
    } catch { keyOwner = null; return undefined }
    return () => {
      if (unbind) unbind()
      if (keyOwner === token) keyOwner = null
    }
  }, [shown, doUndo, doRedo])

  if (!shown) return null
  return (
    <div
      className={styles.toast}
      role="status"
      aria-live="polite"
      data-testid="indicator-undo-toast"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setShown(null) } }}
    >
      <span className={`${styles.label} ${shown.mode === 'refused' ? styles.refused : ''}`}>{shown.text}</span>
      {shown.mode === 'undo' && <button type="button" className={styles.action} onClick={doUndo}>Undo</button>}
      {shown.mode === 'redo' && <button type="button" className={styles.action} onClick={doRedo}>Redo</button>}
      <button type="button" className={styles.close} aria-label="Dismiss" onClick={() => setShown(null)}>×</button>
    </div>
  )
}
