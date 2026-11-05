// S13 (audit 2026-11-05): the one-time tip's card -- a toast, so its arrival moves nothing on the page, with one
// "Got it". The LAZY half (NotebookTipSlot.jsx decides when, records it, and announces it in its status line, so this
// card's text is not a second live region).
import { useEffect } from 'react'
import styles from './NotebookTip.module.css'
import { TIP_COPY } from '../../lib/notebookTips'

export default function NotebookTip({ id, text, onDismiss, onShown }) {
  // The tip is recorded as seen only once this card is on screen (NotebookTipSlot.jsx).
  useEffect(() => { onShown?.() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={styles.tip} role="note" aria-label={TIP_COPY.label} data-notebook-tip={id}>
      <p className={styles.text}>{text}</p>
      <button type="button" className={`btn btn-secondary btn-sm ${styles.dismiss}`} onClick={onDismiss}>
        {TIP_COPY.dismiss}
      </button>
    </div>
  )
}
