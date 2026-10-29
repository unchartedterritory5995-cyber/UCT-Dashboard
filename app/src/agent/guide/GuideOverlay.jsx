// ── UCT Agent PRODUCT GUIDE: the walkthrough on the real board ──────────────────────────────────────────────
//
// SHOW ME, never DO IT: a ring around the real control and a short card beside it — Back, Next, Exit. Nothing is
// clicked, typed or changed for the member; a step that needs them to act ("open the gear") says so and moves on by
// itself when what it waits for appears.
//
//   • the ring and the dim are pointer-events: none — the chart, its menus and trading controls work as always
//   • the target is re-found every POLL_MS (scrolling, resizing, a panel opening or closing); the ring follows it
//   • a target that is gone for LOST_MS ends the walkthrough and says so (an `optional` step is skipped instead) —
//     the card never points at nothing and never claims a control is visible when it is not
//   • Escape from inside the card ends it — no window-level key listener, so every other Escape (a sheet, the palette,
//     the chart's own keys) works exactly as before; the card's × always ends it
//   • leaving Charts or closing the Agent unmounts it: the walkthrough ends, every timer and listener with it
//   • the card is announced politely (aria-live) and never takes focus from what the member is doing

import { useEffect, useRef, useState, useSyncExternalStore, useId } from 'react'
import { createPortal } from 'react-dom'
import { subscribeGuide, guideSnapshot, nextStep, prevStep, endGuide } from './guideStore'
import { findTarget, rectOf, reveal } from './targets'
import { POLL_MS, LOST_MS, sameRect, placeCard } from './placement'
import styles from './GuideOverlay.module.css'

export default function GuideOverlay() {
  const { state: st, notice } = useSyncExternalStore(subscribeGuide, guideSnapshot, guideSnapshot)
  // the rectangle found for ONE step (keyed, so a new step never shows the last step's ring)
  const [found, setFound] = useState({ key: null, rect: null })
  const cardRef = useRef(null)
  const titleId = useId()
  const step = st ? st.steps[st.index] : null
  const stepKey = st ? `${st.id}:${st.index}` : null
  const rect = found.key === stepKey ? found.rect : null

  // follow the target; advance on `waitFor`; end (or skip) when it is gone — every update from a timer
  useEffect(() => {
    if (!st || !step) return undefined
    let lostSince = null
    let shown = false
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      if (step.waitFor && findTarget(step.waitFor, { chartRef: st.chartRef })) { nextStep(); return }
      const el = findTarget(step.target, { chartRef: st.chartRef })
      if (el) {
        lostSince = null
        if (!shown) { shown = true; reveal(el) }
        const r = rectOf(el)
        setFound(prev => (prev.key === stepKey && sameRect(prev.rect, r) ? prev : { key: stepKey, rect: r }))
        return
      }
      setFound(prev => (prev.key === stepKey && prev.rect === null ? prev : { key: stepKey, rect: null }))
      const now = Date.now()
      if (lostSince == null) lostSince = now
      if (now - lostSince >= LOST_MS) {
        if (step.optional) nextStep()
        else endGuide('lost')
      }
    }
    const first = setTimeout(tick, 0)
    const t = setInterval(tick, POLL_MS)
    return () => { cancelled = true; clearTimeout(first); clearInterval(t) }
  }, [st, step, stepKey])

  // closing the Agent / leaving Charts ends the walkthrough
  useEffect(() => () => endGuide('closed'), [])

  if (typeof document === 'undefined') return null
  if (!st || !step) {
    return notice ? createPortal(<div className={styles.notice} role="status" data-testid="guide-notice">{notice}</div>, document.body) : null
  }
  const vw = window.innerWidth || 1280
  const vh = window.innerHeight || 800
  const pos = placeCard(rect, { vw, vh })
  const last = st.index === st.steps.length - 1
  const waiting = !!step.waitFor
  return createPortal(
    <>
      {rect && <div className={styles.ring} data-testid="guide-ring" aria-hidden="true" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />}
      <div
        ref={cardRef}
        className={styles.card}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        data-escape-layer=""
        data-testid="guide-card"
        style={{ top: pos.top, left: pos.left, width: pos.width }}
        // Escape from inside the card ends it (no window-level key listener: the board's own keys are untouched)
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); endGuide('exit') } }}
      >
        <div className={styles.head}>
          <span id={titleId} className={styles.title}>{st.feature.title}</span>
          <span className={styles.count}>{st.steps.length > 1 ? `${st.index + 1} of ${st.steps.length}` : ''}</span>
          <button type="button" className={styles.close} aria-label="Exit the guide" onClick={() => endGuide('exit')}>×</button>
        </div>
        <p className={styles.text} aria-live="polite" data-testid="guide-text">{rect ? step.text : 'Looking for it on your screen…'}</p>
        <div className={styles.actions}>
          {st.index > 0 && <button type="button" className={styles.btn} onClick={prevStep}>Back</button>}
          <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={nextStep}>
            {last ? 'Done' : waiting ? 'Skip' : 'Next'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}
