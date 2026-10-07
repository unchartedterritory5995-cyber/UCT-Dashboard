import { useState, useEffect, useRef } from 'react'
import ContextPopover from '../../../components/mobile/ContextPopover'
import { targetsFor } from '../lib/captureTargets'
import { sendCaptureToJournal } from '../lib/sendToJournal'
import { buildWidgetEmbedAttrs } from '../lib/widgetEmbedCore'
import styles from './CaptureMenu.module.css'

/** Wave 1 (P1-1): the optional destination + comment picker for a capture.
 *
 * This is a SEPARATE, secondary trigger next to each widget's existing
 * one-click "send to Notebook" action — that default path is untouched by
 * this component and stays exactly as fast as before. This is what a member
 * reaches for when they want to choose WHERE a capture goes, or say why it
 * matters, instead of always taking the default (current note, inbox
 * fallback).
 *
 * `capture` is the ALREADY-BUILT raw capture object (the same one the
 * widget's default one-click handler would use), captured ONCE at the
 * moment this menu was opened — never re-derived on Send. A chart's visible
 * range can change while a member is still deciding where to send it and
 * typing a comment; re-building the capture at Send time would silently
 * freeze a DIFFERENT window than what was on screen when they opened this
 * menu (the exact "frozen means anchored" invariant this codebase already
 * enforces everywhere else a capture happens). */
export default function CaptureMenu({
  open, onClose, anchor, widgetId, capture, label, tradeRef, tradeRefType, onSent,
}) {
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)

  // The host renders <CaptureMenu> unconditionally and toggles `open` — this
  // component instance never unmounts, so its `comment` state would otherwise
  // survive from one capture into the NEXT, unrelated one (sent, cancelled, or
  // dismissed via Escape/click-away all leave stale text sitting in the box
  // for whatever gets captured next). Reset on every open, not just on send.
  useEffect(() => {
    if (open) setComment('')
  }, [open])

  // Lane KEYS3 (Q6): on the touch tier this menu is a sheet, and a sheet takes focus for
  // itself. The default destination was then behind Close and the comment box. Once the
  // sheet HAS taken focus, it goes on to the first destination; never to the comment box (on
  // a phone that raises the keyboard). A member already somewhere in the sheet keeps their
  // place, and the anchored (wide) menu is not touched: it focuses its own comment box.
  const wrapRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    let raf = 0
    let tries = 0
    const tick = () => {
      const wrap = wrapRef.current
      const sheet = wrap?.closest('[data-sheet-panel]')
      if (wrap && !sheet) return                         // the anchored menu
      const at = document.activeElement
      if (sheet && at === sheet) {
        wrap.querySelector('button:not([disabled])')?.focus()
        return
      }
      if (sheet && sheet.contains(at)) return            // the member moved first
      tries += 1
      if (tries < 30) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open])

  if (!open) return null

  // Pure preview build (no bars-warm side effect) — only used to evaluate
  // appliesTo() filters (e.g. copyChartLink needs a real symbol). The actual
  // send below re-derives attrs from the SAME frozen `capture`, so nothing
  // here can drift from what actually gets sent.
  const previewAttrs = buildWidgetEmbedAttrs(widgetId, capture)
  const targets = targetsFor(widgetId, previewAttrs)

  const send = async (targetId) => {
    if (sending) return
    setSending(true)
    try {
      const msg = await sendCaptureToJournal(widgetId, capture, {
        label, target: targetId, comment: comment.trim() || undefined, tradeRef, tradeRefType,
      })
      onSent?.(msg)
    } finally {
      setSending(false)
      onClose?.()
    }
  }

  return (
    <ContextPopover open={open} onClose={onClose} anchor={anchor} title="Send to Notebook" width={260}>
      <div className={styles.wrap} ref={wrapRef}>
        <textarea
          className={styles.comment}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a comment (optional)"
          rows={2}
          disabled={sending}
          aria-label="Capture comment"
        />
        {targets.map((t) => (
          <button
            key={t.id}
            type="button"
            className={styles.targetBtn}
            disabled={sending}
            onClick={() => send(t.id)}
            title={t.hint}
          >
            {t.label}
          </button>
        ))}
      </div>
    </ContextPopover>
  )
}
