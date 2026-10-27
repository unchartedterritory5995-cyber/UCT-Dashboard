// app/src/components/chart/SharedIndicatorsPrompt.jsx
//
// ⭐ A1.3 (D6, owner Q6) — "This shared chart has 3 indicators. [Use theirs] [Keep mine]".
// Shown by StockChart when a share link carries indicators and the member already has
// different ones of their own. Non-modal (the chart stays usable); Keep mine, ✕ and Esc
// write nothing. Not persisted: the link's param is stripped, so a reload never asks again.

import { useEffect, useRef } from 'react'
import styles from './SharedIndicatorsPrompt.module.css'

export default function SharedIndicatorsPrompt({ count, onUseTheirs, onKeepMine }) {
  const ref = useRef(null)
  useEffect(() => { try { ref.current?.querySelector('button')?.focus({ preventScroll: true }) } catch { /* jsdom */ } }, [])
  const n = Number.isFinite(count) ? count : 0
  return (
    <div
      ref={ref}
      className={styles.prompt}
      role="dialog"
      aria-modal="false"
      aria-label="Shared chart indicators"
      data-testid="shared-indicators-prompt"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onKeepMine() } }}
    >
      <span className={styles.text}>This shared chart has {n} indicator{n === 1 ? '' : 's'}.</span>
      <button type="button" className={styles.primary} onClick={onUseTheirs}>Use theirs</button>
      <button type="button" className={styles.secondary} onClick={onKeepMine}>Keep mine</button>
    </div>
  )
}
