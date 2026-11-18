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
import { subscribeGuide, guideSnapshot, nextStep, prevStep, endGuide, pinWidget, goToStep, restartGuide, requestGuideDoIt, escapeOnBoard, SELECTED_DRAWING } from './guideStore'
import { needsOwnPress, findTarget, rectOf, reveal, isDisabled, coveredBy, startIndex, reachableAfter, earlierOnScreen, unclip, restoreClipped } from './targets'
import { POLL_MS, LOST_MS, LATE_MS, CLICK_MS, PAUSE_MS, sameRect, placeCard } from './placement'
import { registerShortcuts, isEditableFocus } from '../../pages/command/shortcutRegistry'
import { layerOpenedSince } from '../../lib/topLayer'
import styles from './GuideOverlay.module.css'

const COVERED = 'That control is behind the window that’s open. Close the window, and I’ll carry on from here.'
const OFF = 'This control is greyed out right now, so it can’t be clicked yet.'
// a step waiting for a ROW of a menu (`{ within: '…Menu', … }`): the menu, by its own anchor
const rowOfMenu = (w) => (w && typeof w === 'object' && !Array.isArray(w) && typeof w.within === 'string' && /Menu$/.test(w.within) ? w.within : null)
// how long an open menu may lack the row before it is taken as not offered (menus render their rows at once)
export const ABSENT_MS = 1500
const BUSY = 'I’m still working on your last request. Press Do it for me again when I’ve finished.'
const FIRST = 'This step comes first — the next control only appears once it’s done. Follow the highlight, or press Exit.'

// the menu or window a control sits in: the card keeps off it when there is room
const holderRect = (el) => {
  const box = el?.closest?.('[role="dialog"],[role="menu"],[data-guide$="Menu"],[data-guide="chartSettings"]')
  return box && box !== el ? rectOf(box, 0) : null
}
const hasDoIt = (feature) => !!feature?.doIt

// the menus that close on Escape carry no layer attribute (a plain dropdown is not a layer): which were open at the press
const MENUS = '[role="menu"],[data-guide$="Menu"]'
// an armed drawing tool, or a selected drawing (guideStore.SELECTED_DRAWING: desktop and touch)
const TOOL_OWNS = '[data-guide^="chart.tool."][aria-pressed="true"],[data-guide^="chart.tool."][data-guide-on="true"],' + SELECTED_DRAWING
const NO_LAYERS_BENEATH = new Set()

// the walkthrough chart's symbol, from its own label (components/chart/pane/ChartIdentityRow.jsx sym-label)
const symbolOf = (chartRef) => { try { const cell = document.querySelector(`[data-widget-id="${String(chartRef).split("~")[0].replace(/"/g, "")}"]`); return cell?.querySelector("[data-testid=\"sym-label\"]")?.textContent?.trim() || null } catch { return null } }
// a walkthrough whose OWN steps change the symbol: the symbol search
const changesSymbol = (feature) => feature?.id === "symbol" || (feature?.steps || []).some(s => s?.target === "chart.symbol")

export default function GuideOverlay() {
  const { state: st, notice } = useSyncExternalStore(subscribeGuide, guideSnapshot, guideSnapshot)
  // what was found for ONE step (keyed, so a new step never shows the last step's ring)
  const [found, setFound] = useState({ key: null, rect: null, holder: null, why: null, paused: false })
  const [hint, setHint] = useState(null)   // { key, text } — the step the member tried to Skip past
  const [cardH, setCardH] = useState(undefined)
  const cardRef = useRef(null)
  // the symbol each walkthrough started on, per walkthrough id (the owner rule above)
  const symbolSeen = useRef(new Map())
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
    // ⭐ its own control pressed (needsOwnPress): another chart's gear opening Chart Settings is not this chart's step
    let pressedOwn = false
    // ⭐ the menu this step opens is open, and the row the next step needs is not in it: a step that knows its row is offered
    // only when it is on for this member (`absent`: what is true then — a layout's Version history while the version store is
    // off) says so and ends, never waits on a row that will not come. Opt-in: a menu whose rows differ by where it was opened
    // (the chart's, by region) is a misclick to recover from, not a missing row
    let absentSince = null
    const tick = () => {
      if (cancelled) return
      // ⭐ OWNER RULE (2026-11-07): the walkthrough's chart changed symbol from OUTSIDE the walkthrough (a linked watchlist row
      // loaded into it, a keyboard jump): the chart it was teaching on is now another chart's content, so it ends cleanly — no
      // notice, no restart. Read from the chart's own state (its symbol label), never the click; a walkthrough whose own steps
      // change the symbol (the symbol search) is the exception.
      if (st.chartRef && !changesSymbol(st.feature)) {
        const sym = symbolOf(st.chartRef)
        const seen = symbolSeen.current.get(st.id)
        if (sym && seen == null) symbolSeen.current.set(st.id, sym)
        else if (sym && seen && sym !== seen) { endGuide('switched'); return }
      }
      // the card's real height, so placeCard can keep it off the control whatever the sentence's length
      const h = cardRef.current?.offsetHeight
      if (h) setCardH(h)
      if (step.waitFor) {
        const met = findTarget(step.waitFor, st)
        // ⭐ ...and only when another chart on the board has the same control: with one chart there is no other to confuse
        const others = typeof step.target === 'string' && document.querySelectorAll(`[data-guide="${step.target}"]`).length > 1
        if (met && armed && (pressedOwn || !needsOwnPress(step) || !others)) { nextStep(); return }
        if (!met) armed = true
        const menu = !met && step.absent && rowOfMenu(step.waitFor)
        if (menu && findTarget({ id: menu }, st)) {
          if (absentSince == null) absentSince = Date.now()
          else if (Date.now() - absentSince >= ABSENT_MS) {
            endGuide('absent', step.absent)
            return
          }
        } else absentSince = null
      }
      // a list's first entry is the control itself: below the fold of a long window it is scrolled up, not passed over for the fallback
      if (Array.isArray(step.target)) unclip(step.target[0], st)
      const el = findTarget(step.target, st) || (unclip(step.target, st) ? findTarget(step.target, st) : null)
      if (el) {
        lostSince = null
        if (!shown) { shown = true; reveal(el) }
        if (step.pin) pinWidget(el.closest?.('[data-widget-id]')?.getAttribute('data-widget-id'))
        const r = rectOf(el)
        const holder = holderRect(el)
        // the last entry of a list is the fallback; any earlier one is the control itself, in another form
        const alt = step.altText && Array.isArray(step.target) && !step.target.slice(0, -1).some(t => findTarget(t, st)) ? step.altText : null
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
      if (el && el.contains?.(e.target)) {
        clicked = Date.now()
        pressedOwn = true
        // ⭐ a step with no result to wait for is DONE when the member presses its control, whether or not the control goes
        // away (a menu that stays open, a toggle): the walkthrough moves on, or ends on its last step — it never leaves its
        // ring and card up over a thing already done. Not a field (a click there is only the start of typing), not a right-click.
        const field = e.target?.closest?.('input, textarea, select, [contenteditable="true"]')
        if (!step.waitFor && !step.endsOnClick && e.button === 0 && !field) {
          setTimeout(() => {
            if (cancelled) return   // the step already moved on (its control went away with the click)
            if (st.index >= st.steps.length - 1) endGuide('done'); else nextStep()
          }, POLL_MS * 2)
        }
      }
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

  // where the member's pointer is (passive: nothing is consumed), so the card is never placed under it
  const pointerRef = useRef(null)
  useEffect(() => {
    const onMove = (e) => { pointerRef.current = { x: e.clientX, y: e.clientY } }
    window.addEventListener('pointermove', onMove, { capture: true, passive: true })
    window.addEventListener('pointerdown', onMove, { capture: true, passive: true })
    return () => { window.removeEventListener('pointermove', onMove, { capture: true }); window.removeEventListener('pointerdown', onMove, { capture: true }) }
  }, [])

  // ⭐ OWNER DECISION (2026-11-07): pressing ANOTHER chart (a board chart or a Multi Chart cell) switches the chart the member is
  // working on, so a walkthrough on a chart ENDS there — cleanly (ring, card and notice go; nothing in the workspace changes) and it
  // does not restart on the chart pressed. A press on the walkthrough's OWN chart (its menus, its controls the steps use), on the
  // card, on a menu or window outside any board cell, or on a widget that is not a chart (a watchlist row only changes what a linked
  // chart shows, not which chart the walkthrough is on) does not end it. Passive: the press is only noted.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const onPress = (e) => {
      const st = guideSnapshot().state
      if (!st?.chartRef) return
      const cell = e.target?.closest?.('[data-widget-id]')
      if (!cell) return
      const isChart = cell.getAttribute('data-widget-type') === 'chart' || cell.hasAttribute('data-grid-cell-id')
      if (!isChart) return
      if (cell.getAttribute('data-widget-id') === String(st.chartRef).split('~')[0]) return
      endGuide('switched')
    }
    document.addEventListener('pointerdown', onPress, { capture: true, passive: true })
    return () => document.removeEventListener('pointerdown', onPress, { capture: true })
  }, [])

  // ⭐ a NEW request sent from the Agent's Send button mid-walkthrough ends it (a guide request then starts its own). Passive.
  // Enter in the message box is the Agent's own key (no raw key listener here: keyListenerCensus) — useAgent calls
  // guideStore.endForNewRequest when a request starts
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const box = () => document.querySelector('[aria-label="Message UCT Agent"]')
    const onDown = (e) => { const send = e.target?.closest?.('button[aria-label="Send"]'); if (send && String(box()?.value || '').trim()) endGuide('replaced') }
    document.addEventListener('pointerdown', onDown, { capture: true, passive: true })
    return () => { document.removeEventListener('pointerdown', onDown, { capture: true }) }
  }, [])

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
      // `tool`: an armed drawing tool or a selected drawing had the press (it disarms or deselects on Escape)
      'agent.guideEscapeGate': () => { press = { field: isEditableFocus(), layer: layerOpenedSince(cardRef.current, NO_LAYERS_BENEATH), menus: [...document.querySelectorAll(MENUS)], tool: !!document.querySelector(TOOL_OWNS) } },
      // round 6: heard first (window capture), whatever the board's own handlers then do with the key; never prevents or stops it
      'agent.guideEscapeBoard': () => { if (!isEditableFocus() && !layerOpenedSince(cardRef.current, NO_LAYERS_BENEATH)) escapeOnBoard() },
      'agent.guideEscape': (e) => {
        const { field, layer, menus } = press
        if (e.defaultPrevented || field || layer || press.tool) return
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
  const pt = pointerRef.current
  const pos = placeCard(rect, { vw, vh, cardH, avoid: found.key === stepKey && found.holder ? [found.holder] : [], pointer: pt ? { top: pt.y - 16, left: pt.x - 16, width: 32, height: 32 } : null })
  const last = st.index === st.steps.length - 1
  const waiting = !!step.waitFor
  const shownHint = hint?.key === stepKey ? hint.text : null
  const control = step.name || st.feature.control || 'that control'
  const text = !rect
    ? (paused ? `I can’t see ${control} right now. Bring it back and I’ll carry on from here, or start again.` : 'Looking for it on your screen…')
    : (hint?.key === stepKey && hint.busy ? hint.text : why || shownHint || step.text)
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
        // not role="dialog": utils/modalOpen.js reads any dialog as a modal and the chart then ignores its keys, so a card
        // saying "press Alt+Shift+A" would disable that very key. The card never takes focus or blocks anything
        role="region"
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
          {hasDoIt(st.feature) && <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => { setHint(requestGuideDoIt() ? null : { key: stepKey, text: BUSY, busy: true }) }}>Do it for me</button>}
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
