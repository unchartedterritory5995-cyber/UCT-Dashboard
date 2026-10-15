// app/src/pages/journal-2-0/components/notebook/ScreenshotTagOffer.jsx
/**
 * Tier 2 part A, item 10 -- "Tag NVDA · Daily" on a pasted chart screenshot, ONE TAP, never
 * automatic. Accepting labels the image (its alt: an editor transaction on the note's own save
 * path) and, when the note has no ticker yet, the page sets it through the metadata door
 * (R-T2A-8). Floated under the image; gone when the image is.
 *
 * The editor half (findImagePos / labelImage) lives in lib/screenshotLabel.js, shared with the lazy
 * accept decision (lib/screenshotTag.js); they are re-exported below for this file's own tests.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { findImagePos, isImageAt, labelImage } from '../../lib/screenshotLabel'
import { barPlacement } from '../../lib/barPlacement'
import styles from './ScreenshotTagOffer.module.css'

export { findImagePos, labelImage }
export const SCREENSHOT_OFFER_LABEL = 'Screenshot tag'

export function offerWords(offer, noteTicker) {
  const what = offer.timeframe ? `${offer.symbol} · ${offer.timeframe.label}` : offer.symbol
  const other = noteTicker && String(noteTicker).toUpperCase() !== offer.symbol
  return other ? `Tag image ${what}` : `Tag ${what}`
}

const scan = (editor, src) => (editor && !editor.isDestroyed ? findImagePos(editor.state.doc, src) : null)

/**
 * Where the image is NOW. Re-read on a doc change only, and a moved image is found by mapping its old
 * position through the transaction (O(1)); the whole-document scan runs only when that misses. The state
 * is the number itself, so a keystroke that leaves the image where it is changes nothing and re-renders
 * nothing (the typing path stays clean while a chip is showing).
 */
function useImagePos(editor, src) {
  // Keyed by the editor and the image it was computed for, re-derived DURING render when either changes
  // (React's derived-state pattern), so there is no setState in an effect and no stale position for a new offer.
  const [tracked, setTracked] = useState(() => ({ editor, src, pos: scan(editor, src) }))
  let current = tracked
  if (tracked.editor !== editor || tracked.src !== src) {
    current = { editor, src, pos: scan(editor, src) }
    setTracked(current)
  }
  useEffect(() => {
    if (!editor) return undefined
    const onTr = ({ transaction }) => {
      if (!transaction?.docChanged || editor.isDestroyed) return
      setTracked((t) => {
        if (t.editor !== editor || t.src !== src) return t
        let next = null
        if (t.pos != null) {
          const moved = transaction.mapping.map(t.pos)
          if (isImageAt(editor.state.doc, moved, src)) next = moved
        }
        if (next == null) next = scan(editor, src)
        return next === t.pos ? t : { ...t, pos: next }
      })
    }
    editor.on('transaction', onTr)
    return () => { editor.off('transaction', onTr) }
  }, [editor, src])
  return current.pos
}

export default function ScreenshotTagOffer({ editor, offer, noteTicker, onAccept, onDismiss, onGone }) {
  const barRef = useRef(null)
  const pos = useImagePos(editor, offer.url)

  // ⛔ An offer whose image is gone must END, not idle: while this component is mounted its transaction listener
  // re-scans the whole document on every doc-changing keystroke (the scan never matches once the image is gone),
  // which lands on the typing path F-LONGNOTE-TYPING already breaches. Tell the page, which clears the offer and
  // so unmounts this (and its listener). Also covers an image deleted while the read was still running.
  useEffect(() => {
    if (pos == null) onGone?.()
  }, [pos, onGone])

  // Re-read where the image is and put the bar under it, inside the window. Runs after every render (the layout may have
  // moved) and, below, on any scroll or resize: the image moves under a fixed bar when the page scrolls.
  const place = useCallback(() => {
    const bar = barRef.current
    if (!bar || pos == null || !editor || editor.isDestroyed) return
    let rect = null
    try { rect = editor.view.nodeDOM(pos)?.getBoundingClientRect?.() } catch { rect = null }
    if (!rect) return
    const at = barPlacement(
      rect,
      { width: bar.offsetWidth || 0, height: bar.offsetHeight || 0 },
      { width: window.innerWidth, height: window.innerHeight },
    )
    bar.style.left = `${at.left}px`
    bar.style.top = `${at.top}px`
  }, [editor, pos])

  useLayoutEffect(() => { place() })

  // Capture + passive: the Notebook scrolls an inner element, not the window, and scroll does not bubble.
  // Mouse/touch/scroll/resize only -- no key listener (keyListenerCensus).
  useEffect(() => {
    window.addEventListener('scroll', place, { capture: true, passive: true })
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, { capture: true })
      window.removeEventListener('resize', place)
    }
  }, [place])

  if (pos == null) return null
  const hold = (e) => e.preventDefault()
  return (
    <div ref={barRef} className={styles.bar} role="toolbar" aria-label={SCREENSHOT_OFFER_LABEL}>
      <button type="button" className={styles.btn} onMouseDown={hold} onClick={() => onAccept(offer)}>
        <UIcon name="tag" size={14} /> <span>{offerWords(offer, noteTicker)}</span>
      </button>
      <button type="button" className={styles.icon} onMouseDown={hold} onClick={onDismiss}
        aria-label="Dismiss screenshot tag"><UIcon name="x" size={14} /></button>
    </div>
  )
}
