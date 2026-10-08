// app/src/components/chart/builder/studio/SaveReceipt.jsx
//
// ─── ⭐ BATCH 1 — THE SAVE RECEIPT, SHOWN AFTER THE PANEL CLOSES ───────────────
//
// The Create Indicator panel closes on Save; its receipt (`saveOutcomeReceipt.js`) is
// handed to the toolbar, which renders this card on the chart edge. A COMPLETE
// save fades after a few seconds; a PARTIAL one (the definition saved but adding
// it to the chart, a setting, a header value or an alert did not complete) stays
// until the member dismisses it — it is announced as an alert, never a toast that
// slides away before it is read.

import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import styles from './SaveReceipt.module.css'

export const RECEIPT_COMPLETE_MS = 6000
const INSET = 8
const WIDTH = 320

function place(anchorRef) {
  if (typeof window === 'undefined') return { top: INSET, left: INSET }
  const el = anchorRef && anchorRef.current
  if (!el) return { top: INSET + 48, left: INSET }
  const r = el.getBoundingClientRect()
  return {
    top: Math.max(INSET, r.top + INSET),
    left: Math.max(INSET, Math.min(r.left + INSET, window.innerWidth - WIDTH - INSET)),
  }
}

/**
 * @param {{receipt: object, onDismiss: Function, anchorRef?: {current: Element|null}}} props
 */
export default function SaveReceipt({ receipt, onDismiss, anchorRef = null }) {
  // measured once per receipt, against the chart it was saved from
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `receipt` re-places a new receipt
  const pos = useMemo(() => place(anchorRef), [anchorRef, receipt])
  const complete = receipt && receipt.status === 'complete'
  useEffect(() => {
    if (!complete) return undefined
    const t = setTimeout(() => onDismiss?.(), RECEIPT_COMPLETE_MS)
    return () => clearTimeout(t)
  }, [complete, receipt, onDismiss])
  if (!receipt) return null

  const card = (
    <div
      className={`${styles.receipt} ${complete ? '' : styles.partial}`}
      style={{ top: pos.top, left: pos.left }}
      role={complete ? 'status' : 'alert'}
      aria-live={complete ? 'polite' : 'assertive'}
      data-testid="save-receipt"
      data-status={receipt.status}
    >
      <div className={styles.head}>
        <span className={styles.title} data-testid="save-receipt-title">{receipt.title}</span>
        <button type="button" className={styles.close} aria-label="Dismiss" data-testid="save-receipt-dismiss"
          onClick={() => onDismiss?.()}>✕</button>
      </div>
      <ul className={styles.items}>
        {receipt.items.map((it, i) => (
          <li key={i} className={`${styles.item} ${it.ok ? '' : styles.failed}`} data-ok={it.ok ? 'true' : 'false'} data-kind={it.kind}>
            <span className={styles.mark} aria-hidden="true">{it.ok ? '✓' : '!'}</span>
            <span>{it.ok ? '' : <span className="sr-only">Not completed: </span>}{it.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
  if (typeof document === 'undefined') return card
  return createPortal(card, document.body)
}
