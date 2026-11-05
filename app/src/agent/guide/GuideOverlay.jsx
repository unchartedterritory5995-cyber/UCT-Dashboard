// ── UCT Agent PRODUCT GUIDE: the walkthrough on the real board ──────────────────────────────────────────────
//
// SHOW ME, never DO IT: a ring around the real control and a short card beside it — Back, Next, Exit. Nothing is
// clicked, typed or changed for the member; a step that needs them to act ("open the gear") says so and moves on by
// itself when what it waits for appears.
//
//   • the ring and the dim are pointer-events: none — the chart, its menus and trading controls work as always
//   • the target is re-found every POLL_MS (scrolling, resizing, a panel opening or closing); the ring follows it
//   • a target that is gone for LOST_MS ends the walkthrough and says so (an `optional` step is skipped instead; a
//     `retreat` step — a menu that closed, a form cancelled — returns to the nearest earlier step still on screen) —
//     the card never points at nothing and never claims a control is visible when it is not
//   • Back goes to the nearest earlier step whose control is on screen, and a `waitFor` already met does not bounce it
//     forward again; the step moves on by itself once what it waits for goes away and comes back
//   • Escape ends it wherever focus is (the card never takes focus, so a key on the card alone would almost never
//     fire). Declared in the shortcut registry (`agent.guideEscape`), bound only while a walkthrough is on screen, and
//     never consumed: a sheet, the palette, an inline form or the chart's own keys still answer the same press. The
//     card's × always ends it
//   • leaving Charts or closing the Agent unmounts it: the walkthrough ends, every timer and listener with it
//   • the card is announced politely (aria-live) and never takes focus from what the member is doing

import { useEffect, useRef, useState, useSyncExternalStore, useId } from 'react'
import { createPortal } from 'react-dom'
import { subscribeGuide, guideSnapshot, nextStep, prevStep, endGuide, pinWidget } from './guideStore'
import { findTarget, rectOf, reveal } from './targets'
import { POLL_MS, LOST_MS, sameRect, placeCard } from './placement'
import { registerShortcuts } from '../../pages/command/shortcutRegistry'
import styles from './GuideOverlay.module.css'

/** The nearest step before this one whose control is on screen → its index, or null. */
function earlierStep(st) {
  for (let i = st.index - 1; i >= 0; i--) if (findTarget(st.steps[i].target, st)) return i
  return null
}

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
    // returned to by Back: a `waitFor` still met from last time is not a new event — wait until it has gone once
    let armed = !st.back
    const tick = () => {
      if (cancelled) return
      if (step.waitFor) {
        const met = findTarget(step.waitFor, st)
        if (met && armed) { nextStep(); return }
        if (!met) armed = true
      }
      const el = findTarget(step.target, st)
      if (el) {
        lostSince = null
        if (!shown) { shown = true; reveal(el) }
        if (step.pin) pinWidget(el.closest?.('[data-widget-id]')?.getAttribute('data-widget-id'))
        const r = rectOf(el)
        setFound(prev => (prev.key === stepKey && sameRect(prev.rect, r) ? prev : { key: stepKey, rect: r }))
        return
      }
      setFound(prev => (prev.key === stepKey && prev.rect === null ? prev : { key: stepKey, rect: null }))
      const now = Date.now()
      if (lostSince == null) lostSince = now
      if (now - lostSince >= LOST_MS) {
        const back = step.retreat ? earlierStep(st) : null
        if (step.optional) nextStep()
        else if (back != null) prevStep(back)
        else endGuide('lost')
      }
    }
    const first = setTimeout(tick, 0)
    const t = setInterval(tick, POLL_MS)
    return () => { cancelled = true; clearTimeout(first); clearInterval(t) }
  }, [st, step, stepKey])

  // closing the Agent / leaving Charts ends the walkthrough
  useEffect(() => () => endGuide('closed'), [])

  // Escape, wherever focus is — never consumed (no preventDefault, no stopPropagation)
  const active = !!st
  useEffect(() => (active ? registerShortcuts({ 'agent.guideEscape': () => endGuide('exit') }) : undefined), [active])

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
          {st.index > 0 && !step.noBack && <button type="button" className={styles.btn} onClick={() => prevStep(earlierStep(st) ?? st.index - 1)}>Back</button>}
          <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={nextStep}>
            {last ? 'Done' : step.nextLabel || (waiting ? 'Skip' : 'Next')}
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}
