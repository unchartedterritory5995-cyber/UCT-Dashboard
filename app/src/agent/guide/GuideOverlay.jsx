// ── UCT Agent PRODUCT GUIDE: the walkthrough on the real board ──────────────────────────────────────────────
//
// SHOW ME, never DO IT: a ring around the real control and a short card beside it — Back, Next, Exit. Nothing is
// clicked, typed or changed for the member; a step that needs them to act ("open the gear") says so and moves on by
// itself when what it waits for appears.
//
//   • the ring and the dim are pointer-events: none — the chart, its menus and trading controls work as always
//   • the card is never placed on the control (placement.placeCard, with the card's measured height), and stays off the
//     menu or window the control sits in whenever there is room
//   • the target is re-found every POLL_MS (scrolling, resizing, a panel opening or closing); the ring follows it
//   • a step's `waitFor` already met is a step already done: it moves on at once (a menu already open, a tab already
//     selected), including while the walkthrough is running
//   • a control the member just clicked that then goes away (a menu item, a last click) is the step DONE, not a lost
//     control: it moves on, or finishes, without a word
//   • any other target gone for LOST_MS: an `optional` step is skipped; otherwise it returns to the nearest earlier step
//     still on screen (a menu that closed, a form cancelled — the member reopens it and carries on)
//   • with nothing earlier on screen it PAUSES (a layout switched, a panel closed): the card says so and offers Restart,
//     and the walkthrough carries on by itself the moment the control is back. After PAUSE_MS it stops and says why
//   • a control that is there but out of reach says so: greyed out (the step's own `off` sentence), or behind an open
//     window. The card never points at nothing and never claims a control is visible when it is not
//   • a control a narrow row has clipped (the gear, with the Agent panel open) is slid into view for its step and put back
//   • Next / Skip go to the next step the member can actually reach. A step that depends on this one stays closed until
//     this one is done: the card says what to do instead of walking off the end of the walkthrough
//   • Back goes to the nearest earlier step whose control is on screen, and a `waitFor` already met does not bounce it
//     forward again; the step moves on by itself once what it waits for goes away and comes back
//   • Restart goes back to the start, from where the member stands now
//   • Do it for me hands over to the Agent (guideStore.requestGuideDoIt → the panel → doItForMe): the feature's EXISTING
//     capability, planner, policy, receipt and Undo. The guide has no writer of its own
//   • Escape ends it only when nothing else answers that press: one press does one thing. The guide listens last
//     (`agent.guideEscape`, window bubble), so a press something stopped never reaches it and one something prevented
//     is left alone; a text field's Escape is the field's (the Agent's own message box, where focus sits after asking, ends
//     the guide from its own handler: the panel keeps its keys from reaching the board); a layer open at the press (a sheet, the palette, a dialog)
//     owns it; a menu the press closed had it (`agent.guideEscapeGate` notes all of that in the capture phase, before
//     any layer reacts: lib/topLayer.js). Bound only while a walkthrough is on screen. The card's × always ends it
//   • leaving Charts or closing the Agent unmounts it: the walkthrough ends, every timer and listener with it
//   • the card is announced politely (aria-live) and never takes focus from what the member is doing

import { useEffect, useRef, useState, useSyncExternalStore, useId } from 'react'
import { createPortal } from 'react-dom'
import { subscribeGuide, guideSnapshot, nextStep, prevStep, endGuide, pinWidget, goToStep, restartGuide, requestGuideDoIt } from './guideStore'
import { findTarget, rectOf, reveal, isDisabled, coveredBy, startIndex, reachableAfter, earlierOnScreen, unclip, restoreClipped } from './targets'
import { POLL_MS, LOST_MS, LATE_MS, CLICK_MS, PAUSE_MS, sameRect, placeCard } from './placement'
import { registerShortcuts, isEditableFocus } from '../../pages/command/shortcutRegistry'
import { layerOpenedSince } from '../../lib/topLayer'
import styles from './GuideOverlay.module.css'

const COVERED = 'That control is behind the window that’s open. Close the window, and I’ll carry on from here.'
const OFF = 'This control is greyed out right now, so it can’t be clicked yet.'
const FIRST = 'This step comes first — the next control only appears once it’s done. Follow the highlight, or press Exit.'

// the menu or window a control sits in: the card keeps off it when there is room
const holderRect = (el) => {
  const box = el?.closest?.('[role="dialog"],[role="menu"],[data-guide$="Menu"],[data-guide="chartSettings"]')
  return box && box !== el ? rectOf(box, 0) : null
}
const hasDoIt = (feature) => !!feature?.doIt

// the menus that close on Escape carry no layer attribute (a plain dropdown is not a layer): which were open at the press
const MENUS = '[role="menu"],[data-guide$="Menu"]'
const NO_LAYERS_BENEATH = new Set()

export default function GuideOverlay() {
  const { state: st, notice } = useSyncExternalStore(subscribeGuide, guideSnapshot, guideSnapshot)
  // what was found for ONE step (keyed, so a new step never shows the last step's ring)
  const [found, setFound] = useState({ key: null, rect: null, holder: null, why: null, paused: false })
  const [hint, setHint] = useState(null)   // { key, text } — the step the member tried to Skip past
  const [cardH, setCardH] = useState(undefined)
  const cardRef = useRef(null)
  const titleId = useId()
  const step = st ? st.steps[st.index] : null
  const stepKey = st ? `${st.id}:${st.index}` : null
  const rect = found.key === stepKey ? found.rect : null
  const paused = found.key === stepKey && found.paused

  // follow the target; advance on `waitFor`; move on, go back, or pause when it is gone — every update from a timer
  useEffect(() => {
    if (!st || !step) return undefined
    let lostSince = null
    let shown = false
    let cancelled = false
    let clicked = 0     // when the member last pressed this step's control: it only explains a disappearance right after it
    // returned to by Back: a `waitFor` still met from last time is not a new event — wait until it has gone once
    // (and a result that is something ENDING has to have begun first)
    let armed = !st.back && !step.waitFor?.not
    const tick = () => {
      if (cancelled) return
      // the card's real height, so placeCard can keep it off the control whatever the sentence's length
      const h = cardRef.current?.offsetHeight
      if (h) setCardH(h)
      if (step.waitFor) {
        const met = findTarget(step.waitFor, st)
        if (met && armed) { nextStep(); return }
        if (!met) armed = true
      }
      const el = findTarget(step.target, st) || (unclip(step.target, st) ? findTarget(step.target, st) : null)
      if (el) {
        lostSince = null
        if (!shown) { shown = true; reveal(el) }
        if (step.pin) pinWidget(el.closest?.('[data-widget-id]')?.getAttribute('data-widget-id'))
        const r = rectOf(el)
        const holder = holderRect(el)
        const alt = step.altText && Array.isArray(step.target) && !findTarget(step.target[0], st) ? step.altText : null
        const why = isDisabled(el) ? (step.off || OFF) : coveredBy(el) ? COVERED : alt
        setFound(prev => (prev.key === stepKey && sameRect(prev.rect, r) && prev.why === why && !prev.paused && (sameRect(prev.holder, holder) || (!prev.holder && !holder))
          ? prev : { key: stepKey, rect: r, holder, why, paused: false }))
        return
      }
      // the member's own click took it away (a menu item, the last click): that step is done, not lost
      if (clicked && Date.now() - clicked < CLICK_MS) { clicked = 0; if (step.endsOnClick) endGuide('done'); else nextStep(); return }
      setFound(prev => (prev.key === stepKey && prev.rect === null && prev.paused === (lostSince != null && Date.now() - lostSince >= LOST_MS) ? prev
        : { key: stepKey, rect: null, holder: null, why: null, paused: lostSince != null && Date.now() - lostSince >= LOST_MS }))
      const now = Date.now()
      if (lostSince == null) lostSince = now
      // a step that may simply not apply (no Place box on a board with room): a moment's look, then on
      if (step.late && now - lostSince >= LATE_MS) { nextStep(); return }
      if (now - lostSince >= LOST_MS) {
        if (step.optional) { nextStep(); return }
        const back = step.retreat === false ? null : earlierOnScreen(st.steps, st.index, st)
        if (back != null) { prevStep(back); return }
        if (now - lostSince >= PAUSE_MS) endGuide('lost')
      }
    }
    // capture, passive: the guide only notes that the member's click landed on the control; it never touches the event
    const onDown = (e) => {
      const el = findTarget(step.target, st)
      if (el && el.contains?.(e.target)) clicked = Date.now()
      // the step's other way of being done: its control stays on screen, so the click itself is the finish
      const also = step.also ? findTarget(step.also, st) : null
      if (also && also.contains?.(e.target)) setTimeout(() => { if (!cancelled) endGuide('done') }, POLL_MS)
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('mousedown', onDown, true)
    const first = setTimeout(tick, 0)
    const t = setInterval(tick, POLL_MS)
    return () => {
      cancelled = true; clearTimeout(first); clearInterval(t)
      restoreClipped()
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [st, step, stepKey])

  // closing the Agent / leaving Charts ends the walkthrough
  useEffect(() => () => endGuide('closed'), [])

  // Escape, only when nothing else answers it (see the header). Never consumed either.
  const active = !!st
  useEffect(() => {
    if (!active) return undefined
    let press = { field: false, layer: false, menus: [] }
    return registerShortcuts({
      // the window capture phase: a layer that closes from its own listener is already gone by the bubble phase
      // (and a field that closes on its own Escape has lost focus by then: the name box of a new list)
      'agent.guideEscapeGate': () => { press = { field: isEditableFocus(), layer: layerOpenedSince(cardRef.current, NO_LAYERS_BENEATH), menus: [...document.querySelectorAll(MENUS)] } },
      'agent.guideEscape': (e) => {
        const { field, layer, menus } = press
        if (e.defaultPrevented || field || layer) return
        // a menu that answered from a React handler has closed by the next task
        setTimeout(() => { if (!e.defaultPrevented && menus.every(m => m.isConnected)) endGuide('exit') }, 0)
      },
    })
  }, [active])

  // a press on the card is not a click outside whatever the walkthrough is pointing at: a popover that closes on an outside
  // press stays open. Native, on the card itself, so the board's document-level listeners never hear it
  useEffect(() => {
    const el = cardRef.current
    if (!el) return undefined
    const stop = (e) => e.stopPropagation()
    el.addEventListener('mousedown', stop)
    el.addEventListener('pointerdown', stop)
    return () => { el.removeEventListener('mousedown', stop); el.removeEventListener('pointerdown', stop) }
  }, [active])

  if (typeof document === 'undefined') return null
  if (!st || !step) {
    return notice ? createPortal(<div className={styles.notice} role="status" data-testid="guide-notice">{notice}</div>, document.body) : null
  }
  const vw = window.innerWidth || 1280
  const vh = window.innerHeight || 800
  const why = found.key === stepKey ? found.why : null
  const pos = placeCard(rect, { vw, vh, cardH, avoid: found.key === stepKey && found.holder ? [found.holder] : [] })
  const last = st.index === st.steps.length - 1
  const waiting = !!step.waitFor
  const shownHint = hint?.key === stepKey ? hint.text : null
  const control = step.name || st.feature.control || 'that control'
  const text = !rect
    ? (paused ? `I can’t see ${control} right now. Bring it back and I’ll carry on from here, or start again.` : 'Looking for it on your screen…')
    : (why || shownHint || step.text)
  const onNext = () => {
    if (last) { endGuide('done'); return }
    const to = reachableAfter(st.steps, st.index, st)
    if (to == null) { setHint({ key: stepKey, text: step.first || FIRST }); return }
    goToStep(to)
  }
  const onBack = () => prevStep(earlierOnScreen(st.steps, st.index, st) ?? st.index - 1)
  const onRestart = () => restartGuide(startIndex(st.steps, st))
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
        data-chart-portal-popup=""
        data-sheet-keep-live="9601"
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
        <p className={styles.text} aria-live="polite" data-testid="guide-text">{text}</p>
        <div className={styles.actions}>
          {hasDoIt(st.feature) && <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={requestGuideDoIt}>Do it for me</button>}
          {(st.index > 0 || paused) && <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={onRestart}>Restart</button>}
          {st.index > 0 && !step.noBack && <button type="button" className={styles.btn} onClick={onBack}>Back</button>}
          {!paused && (
            <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={onNext}>
              {last ? 'Done' : step.nextLabel || (waiting ? 'Skip' : 'Next')}
            </button>
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}
