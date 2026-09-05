import { useState, useEffect } from 'react'
import ContextPopover from '../../../components/mobile/ContextPopover'
import { targetsFor } from '../lib/captureTargets'
import { sendCaptureToJournal } from '../lib/sendToJournal'
import { buildWidgetEmbedAttrs } from '../lib/widgetEmbedCore'

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
  open, onClose, anchor, widgetId, capture, label, tradeRef, onSent,
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
        label, target: targetId, comment: comment.trim() || undefined, tradeRef,
      })
      onSent?.(msg)
    } finally {
      setSending(false)
      onClose?.()
    }
  }

  return (
    <ContextPopover open={open} onClose={onClose} anchor={anchor} title="Send to Notebook" width={260}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px 10px' }}>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a comment (optional)"
          rows={2}
          disabled={sending}
          aria-label="Capture comment"
          style={{
            width: '100%', resize: 'vertical', font: 'inherit', fontSize: 13,
            padding: '6px 8px', borderRadius: 6,
            background: 'var(--color-bg, #0b0d12)',
            border: '1px solid var(--color-border, #232932)',
            color: 'var(--color-text-primary, #e8eaed)',
          }}
        />
        {targets.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={sending}
            onClick={() => send(t.id)}
            title={t.hint}
            style={{
              textAlign: 'left', padding: '7px 9px', cursor: sending ? 'default' : 'pointer',
              background: 'transparent', border: '1px solid var(--color-border, #232932)',
              borderRadius: 6, color: 'var(--color-text-primary, #e8eaed)', font: 'inherit', fontSize: 13,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
    </ContextPopover>
  )
}
