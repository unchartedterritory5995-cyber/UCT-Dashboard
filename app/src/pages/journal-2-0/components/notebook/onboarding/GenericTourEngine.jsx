// The ONE engine for every registered tour beyond the wave-8 base tour (wave 14, lanes
// W14-0 and W14-C1). Loaded lazily by `RegistryToursGate.jsx`, exactly once a tour is
// WANTED -- never imported anywhere else, so its own weight (and every tour's steps/copy,
// pulled in through `entry.load()`) never reaches the Notebook's first-open bytes (R3).
//
// What it does, in order (W14-C1 made each of these data-driven, never per tour):
//
//   1. START. An entry may name where it starts (`start`, tourRegistry.js): a known page,
//      a note (`{note: 'sample:<key>' | 'recent', embed?}`) or a trade (`{trade: 'recent'}`).
//      If the first step's anchor is not on screen, the engine resolves the start
//      (tourStart.js, read-only) and navigates there. The gate is mounted once in the app
//      shell, so the engine survives that navigation. With nothing to open it says so in
//      the card, with a way out; it never creates a note or a trade to have something to
//      point at.
//   2. WAIT, bounded (START_WAIT_MS), for the first anchor; then open on whatever is on
//      screen, or close quietly with nothing recorded.
//   3. WALK, re-evaluating on every Next and Back. The visible step list is NOT fixed at
//      open: a step whose anchor sits behind a click (a panel, the replay controls, a
//      sheet) shows once its anchor appears. Next waits up to STEP_WAIT_MS for the next
//      step's anchor before skipping it, so a step is skipped only after the wait and the
//      card never points at nothing. A step may declare `waitFor: '<anchor>'` ("do this to
//      continue"): the card asks the member to do it and moves on when that anchor
//      appears.
//   4. MODALITY. A step that targets inside a sheet or dialog, or waits for the member to
//      act, renders NON-modal: no layer holding the page, no Tab trap, and the card is
//      placed inside that sheet so the sheet's own Tab ring includes it. Escape closes
//      only the TOPMOST layer: the tour when it is on top (and the sheet beneath stays
//      open), the sheet when a sheet opened above the tour.
//   5. PASSIVE. A `replayable: false` entry (a 1-2 step explainer) renders as a light,
//      non-modal note that never takes focus, shown once per member (any row in
//      `notebook_tours` means it was seen).
//
// Shared, by direct reuse rather than a copy: anchor visibility (`anchorFor`, the SAME
// function NotebookTour.jsx imports), the focus-trap contract (`trapTabKey`), the
// first-run stage coordinator, and the card's look (NotebookTour.module.css).
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import usePreferences from '../../../../../hooks/usePreferences'
import { trapTabKey } from '../../../../../components/mobile/useFocusTrap'
import { claimFirstRunStage } from '../../../../../components/firstRun/firstRunStage'
import { anchorFor } from './tourAnchorVisibility'
import { TOURS_PREF, TOUR_STATES, readToursPref, recordTourState } from './tourSeenState'
import { UNREACHABLE_COPY, atStart, resolveStart } from './tourStart'
import { cardIsTopmost, dialogHost } from './tourLayers'
import { carryRegistryTourOpen, stripTourState } from './tourRegistryControl'
import { importWithOneRetry } from '../../../lib/lazyChunk'
import { reportError } from '../../../../../lib/errorBeacon'
import { registerShortcuts } from '../../../../command/shortcutRegistry'
import styles from './NotebookTour.module.css'
import own from './GenericTourEngine.module.css'
import PoliteStatus from '../PoliteStatus'

export { atStart }

const ACTIVE_ATTR = 'data-tour-active'

/** How long an opened tour waits for its STARTING anchor before it settles for whatever is
 *  on screen (or, with nothing, closes). A tour opened from Help lands on a page still
 *  loading, and a tour with a start is navigated there first -- the anchor arrives a moment
 *  after (the W14-D finding). Bounded, so a screen that never shows it still ends quietly. */
export const START_WAIT_MS = 8000
/** How long Next waits for the next step's anchor (a panel opening, a sheet loading)
 *  before skipping that step. Bounded: a step that never appears costs this, once. */
export const STEP_WAIT_MS = 1500
const POLL_MS = 100

/** The first index from `from` in direction `dir` whose anchor is on screen, or -1. */
/**
 * Where the passive explainer is portaled (FIN-A11Y round 2): a slot at the START of <body>.
 * It used to go to the END of <body>, which made "Got it" the last Tab stop on the page. The
 * note is `position: fixed`, so where it sits on screen does not change; only its place in
 * the Tab and reading order does. Made once and reused; an empty slot renders nothing.
 */
function explainerSlot() {
  let el = document.querySelector('[data-tour-explainer-slot]')
  if (!el) {
    el = document.createElement('div')
    el.setAttribute('data-tour-explainer-slot', '')
    document.body.prepend(el)
  }
  return el
}

function presentFrom(steps, from, dir) {
  for (let i = from; i >= 0 && i < steps.length; i += dir) {
    if (anchorFor(steps[i].anchor)) return i
  }
  return -1
}

const hasSteps = (m) => !!m && (Array.isArray(m.steps) || Array.isArray(m.STEPS))

/** A tour's steps and copy, through the Notebook's chunk recovery (lib/lazyChunk.js): a failed
 *  fetch is asked for once more under a name the module map has not seen. A second failure
 *  rejects; the engine then closes and says so, it never reloads the page. */
export function loadTourContent(entry, waitMs) {
  return importWithOneRetry(() => entry.load(), waitMs, hasSteps)
    .then((m) => (Array.isArray(m.steps) ? m : { steps: m.STEPS, copy: m.COPY }))
}

export default function GenericTourEngine({
  entry, onClose, startWaitMs = START_WAIT_MS, stepWaitMs = STEP_WAIT_MS,
}) {
  const { prefs, loading: prefsLoading, setPrefMerged } = usePreferences()
  const location = useLocation()
  const navigate = useNavigate()
  const passive = entry.replayable === false
  const [content, setContent] = useState(null)   // {steps, copy} once entry.load() resolves
  const [phase, setPhase] = useState('loading')   // loading | routing | waiting | open | unreachable
  const [index, setIndex] = useState(0)
  const [moving, setMoving] = useState(false)     // Next is waiting for the next anchor
  const [unreachable, setUnreachable] = useState(null)
  const cardRef = useRef(null)
  const titleRef = useRef(null)
  const returnFocusRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  // Whether this tour ever showed a step. Handed to onClose, so a caller that spent
  // something on opening it (the offer: one per session) can tell "taken" from "never opened".
  const openedRef = useRef(false)
  const titleId = useId()
  const bodyId = useId()

  useEffect(() => {
    let cancelled = false
    loadTourContent(entry)
      .then((c) => { if (!cancelled) setContent(c) })
      .catch((err) => {
        // A stale step file after a deploy: close and say so, never hold the one tour slot.
        if (cancelled) return
        reportError(err, { kind: 'tour-load' })
        onCloseRef.current({ opened: false, failed: true })
      })
    return () => { cancelled = true }
  }, [entry])

  const record = useCallback((state, stepId) => {
    recordTourState(setPrefMerged, entry.id, state, stepId)
  }, [setPrefMerged, entry.id])

  const steps = content?.steps || null
  const step = phase === 'open' && steps ? steps[index] : null

  // ── 1. START ──────────────────────────────────────────────────────────────────────────
  // Runs once, the moment the content lands (and, for the passive explainer, once the
  // member's seen-state is known). Location is read at that moment only.
  const startedRef = useRef(false)
  const aliveRef = useRef(true)
  useEffect(() => () => { aliveRef.current = false }, [])
  useEffect(() => {
    if (!content || startedRef.current) return
    if (passive && prefsLoading) return
    startedRef.current = true
    if (!content.steps.length) { onCloseRef.current({ opened: false }); return }
    if (passive) {
      // Shown once per member: any row means it was seen (or dismissed) already.
      if (readToursPref(prefs?.[TOURS_PREF])[entry.id]) { onCloseRef.current({ opened: false }); return }
      setPhase('waiting')
      return
    }
    if (anchorFor(content.steps[0].anchor)) { setPhase('waiting'); return }
    setPhase('routing')
    resolveStart(entry, location).then((r) => {
      if (!aliveRef.current) return
      if (r.none) { setUnreachable(r.none); setPhase('unreachable'); return }
      if (r.path) {
        // A start on another PAGE remounts the app shell (RouteErrorBoundary is keyed by
        // pathname), and this engine with it: carry the request so the new gate goes on
        // with this tour instead of dropping it silently (W14-Q2: trade starts never opened).
        if (new URL(r.path, 'http://tour.invalid').pathname !== location.pathname) carryRegistryTourOpen(entry.id)
        navigate(r.path, { state: stripTourState(location.state) })
      }
      setPhase('waiting')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, prefsLoading])

  // ── 2. WAIT for the first anchor, bounded ───────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'waiting' || !steps) return undefined
    const began = Date.now()
    const open = (at) => {
      if (!returnFocusRef.current && !passive) returnFocusRef.current = document.activeElement
      setIndex(at)
      openedRef.current = true
      setPhase('open')
      record(TOUR_STATES.started, steps[at].id)
    }
    const tick = () => {
      if (anchorFor(steps[0].anchor)) { open(0); return true }
      if (Date.now() - began < startWaitMs) return false
      const at = presentFrom(steps, 0, 1)
      if (at >= 0) open(at)
      // Nothing to point at after the bounded wait. A tour the member asked for says so
      // (the gate shows the sentence); a passive explainer nobody asked for stays silent.
      else onCloseRef.current({ opened: false, failed: !passive })
      return true
    }
    if (tick()) return undefined
    const timer = setInterval(() => { if (tick()) clearInterval(timer) }, POLL_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, steps])

  // Focus goes back where it was BEFORE onClose: the gate unmounts this engine on close,
  // so an effect keyed on the closed phase would never get to run.
  const finish = useCallback(() => {
    setPhase('closed')
    const back = returnFocusRef.current
    returnFocusRef.current = null
    if (back && typeof back.focus === 'function' && document.contains(back)) back.focus()
    onCloseRef.current({ opened: openedRef.current })
  }, [])

  const close = useCallback((state) => {
    const current = steps && phase === 'open' ? steps[index] : null
    record(state, current?.id)
    finish()
  }, [steps, phase, index, record, finish])

  // ── 3. WALK ─────────────────────────────────────────────────────────────────────────────
  const goTo = useCallback((i) => {
    setMoving(false)
    setIndex(i)
    record(TOUR_STATES.started, steps[i].id)
  }, [record, steps])

  // Next: wait (bounded) for the very next step's anchor; at the deadline take the first
  // later step that is on screen; with none, the tour is done.
  const moveTimerRef = useRef(null)
  const stopMove = () => { if (moveTimerRef.current) { clearInterval(moveTimerRef.current); moveTimerRef.current = null } }
  useEffect(() => stopMove, [])
  const goNext = useCallback(() => {
    if (!steps || moving) return
    const target = index + 1
    if (target >= steps.length) { close(TOUR_STATES.done); return }
    if (anchorFor(steps[target].anchor)) { goTo(target); return }
    setMoving(true)
    const began = Date.now()
    stopMove()
    moveTimerRef.current = setInterval(() => {
      if (anchorFor(steps[target].anchor)) { stopMove(); goTo(target); return }
      if (Date.now() - began < stepWaitMs) return
      stopMove()
      const later = presentFrom(steps, target + 1, 1)
      if (later >= 0) goTo(later)
      else { setMoving(false); close(TOUR_STATES.done) }
    }, POLL_MS)
  }, [steps, moving, index, goTo, close, stepWaitMs])

  const goBack = useCallback(() => {
    if (!steps || moving) return
    const prev = presentFrom(steps, index - 1, -1)
    if (prev >= 0) goTo(prev)
  }, [steps, moving, index, goTo])

  // "Do this to continue": the step waits for its `waitFor` anchor, then moves to the step
  // that anchor belongs to (or simply the next one). It moves on when the member DOES the
  // thing -- the anchor appearing after the step was shown -- never because it is already
  // there: Back onto this step with the panel still open used to jump straight forward
  // again, so Back read as broken (W14-Q2 round 2). Then only Next, or redoing it, moves on.
  useEffect(() => {
    if (!step?.waitFor || moving) return undefined
    let seenAbsent = !anchorFor(step.waitFor)
    const timer = setInterval(() => {
      if (!anchorFor(step.waitFor)) { seenAbsent = true; return }
      if (!seenAbsent) return
      clearInterval(timer)
      const owner = steps.findIndex((s, j) => j > index && s.anchor === step.waitFor)
      goTo(owner >= 0 ? owner : Math.min(index + 1, steps.length - 1))
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [step, moving, steps, index, goTo])

  // Never point at nothing: if the current step's anchor leaves the page and stays gone
  // for the bounded wait, move to a step that is on screen, or end the tour.
  useEffect(() => {
    if (!step || moving) return undefined
    let goneSince = null
    const timer = setInterval(() => {
      if (anchorFor(step.anchor) || (step.waitFor && anchorFor(step.waitFor))) { goneSince = null; return }
      goneSince = goneSince ?? Date.now()
      if (Date.now() - goneSince < stepWaitMs) return
      clearInterval(timer)
      const fwd = presentFrom(steps, index + 1, 1)
      const back = fwd >= 0 ? -1 : presentFrom(steps, index - 1, -1)
      if (fwd >= 0) goTo(fwd)
      else if (back >= 0) goTo(back)
      else close(TOUR_STATES.dismissed)
    }, 250)
    return () => clearInterval(timer)
  }, [step, moving, steps, index, goTo, close, stepWaitMs])

  // ── 4. MODALITY, focus, keys ─────────────────────────────────────────────────────────────
  const anchorEl = step ? anchorFor(step.anchor) : null
  const host = anchorEl ? dialogHost(anchorEl) : null
  const modal = !passive && phase === 'open' && !host && !step?.waitFor

  const tourOpen = phase === 'open' || phase === 'unreachable'
  useEffect(() => (tourOpen && !passive ? claimFirstRunStage() : undefined), [tourOpen, passive])

  useEffect(() => {
    if (!step) return undefined
    // The marker goes on the anchor even when it has no box at this instant: a control that
    // shows only while a tour points at it or its container (the chart toolbar, revealed by
    // `[data-tour-active]` in WidgetEmbedView.module.css) loses its box the moment the
    // previous step's marker is cleared, so asking "is it on screen?" here would never mark
    // it, and it would never show (W14-Q2, measured at 1200 px). The card was already
    // opened on it on screen; the "never point at nothing" watch below still applies.
    const el = anchorFor(step.anchor) || document.querySelector(`[data-tour="${step.anchor}"]`)
    if (!el) return undefined
    el.setAttribute(ACTIVE_ATTR, 'true')
    // A "do this to continue" step asks the member to press its anchor, and its card is a
    // non-modal panel pinned to the bottom of the screen: 'nearest' parked a control at the
    // bottom edge, UNDER the card (W14-Q2, measured at 390 px: Templates sat behind the
    // template-gallery card and could not be tapped). Centre it, clear of the card.
    el.scrollIntoView?.({ block: step.waitFor ? 'center' : 'nearest', inline: 'nearest' })
    return () => el.removeAttribute(ACTIVE_ATTR)
  }, [step])

  // A stepper takes focus on every step (so a screen reader reads it); the passive
  // explainer never does.
  useEffect(() => {
    if (passive) return
    if (step || phase === 'unreachable') titleRef.current?.focus()
  }, [step, phase, passive])
  useEffect(() => {
    if (phase === 'unreachable' && !returnFocusRef.current) returnFocusRef.current = document.activeElement
  }, [phase])

  // Window, capture phase: runs BEFORE every document-level handler (Sheet's included), so
  // the tour decides first whether it is the layer a key belongs to.
  useEffect(() => {
    if (!(phase === 'open' || phase === 'unreachable')) return undefined
    // Bound through the shared shortcut registry (declared there with its scope), so the
    // key-listener census can see it. Same node, same phase, same order as before.
    return registerShortcuts({
      'notebook.tourEscape': (e) => {
        const card = cardRef.current
        if (passive && !(card && card.contains(document.activeElement))) return
        if (!cardIsTopmost(card)) return            // a sheet above the tour answers it
        e.preventDefault()
        e.stopPropagation()                          // the sheet beneath stays open
        if (phase === 'unreachable') { finish(); return }
        close(TOUR_STATES.dismissed)
      },
      'notebook.tourTrapTab': (e) => {
        if (!(modal || phase === 'unreachable')) return
        if (trapTabKey(e, cardRef.current)) e.stopPropagation()
      },
    })
  }, [phase, modal, passive, close, finish])

  // ── render ───────────────────────────────────────────────────────────────────────────────
  if (!content) return null

  if (phase === 'unreachable') {
    const copy = UNREACHABLE_COPY[unreachable] || UNREACHABLE_COPY.error
    const leave = finish
    return createPortal(
      <div className={styles.layer}>
        <div ref={cardRef} className={styles.card} role="dialog" aria-modal="true"
          aria-labelledby={titleId} aria-describedby={bodyId}>
          <p className={styles.progress}>{entry.title}</p>
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className={styles.title}>{copy.title}</h2>
          <p id={bodyId} className={styles.body}>{copy.body}</p>
          <div className={styles.actions}>
            <span />
            <span className={styles.nav}>
              <button type="button" className="btn btn-secondary" onClick={leave}>Close</button>
              {copy.exitPath && (
                <button type="button" className="btn btn-primary"
                  onClick={() => { leave(); navigate(copy.exitPath) }}>
                  {copy.exitLabel}
                </button>
              )}
            </span>
          </div>
        </div>
      </div>,
      document.body,
    )
  }

  if (!step) return null
  const copyOf = (s) => content.copy[s.id] || { title: '', body: '' }
  const copy = copyOf(step)

  if (passive) {
    // A light note: the title of its first step, every step's sentence, one button.
    const shown = steps.filter((s, i) => i >= index && anchorFor(s.anchor))
    const done = () => { setPhase('closed'); record(TOUR_STATES.done, steps[steps.length - 1].id); onCloseRef.current({ opened: true }) }
    return createPortal(
      <aside ref={cardRef} className={own.explainer} aria-labelledby={titleId} data-tour-explainer="">
        {/* FIN-A11Y (M-3): the note never takes focus, so it is ANNOUNCED instead, politely. */}
        <PoliteStatus text={[`${copy.title}.`, ...(shown.length ? shown : [step]).map((s) => copyOf(s).body), 'Got it closes this note.'].join(' ')} />
        <h2 id={titleId} className={own.explainerTitle}>{copy.title}</h2>
        {(shown.length ? shown : [step]).map((s) => (
          <p key={s.id} className={own.explainerBody}>{copyOf(s).body}</p>
        ))}
        <div className={own.explainerActions}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={done}>Got it</button>
        </div>
      </aside>,
      host || explainerSlot(),
    )
  }

  const isFirst = presentFrom(steps, index - 1, -1) < 0
  const isLast = index === steps.length - 1
  // FIN-A11Y (I-8): the step count and the "do this" hint are part of what is SAID. The
  // dialog is described by them, and so is the heading that takes focus on every step
  // (a focused element's description is read on arrival, so each step change says both).
  const progressId = `${bodyId}-step`
  const waitId = `${bodyId}-wait`
  const hintId = step.waitFor ? ` ${waitId}` : ''
  const card = (
    <div
      ref={cardRef}
      className={modal ? styles.card : `${styles.card} ${own.floating}`}
      role="dialog"
      aria-modal={modal ? 'true' : undefined}
      aria-labelledby={titleId}
      aria-describedby={`${progressId} ${bodyId}${hintId}`}
      data-tour-card={modal ? 'modal' : 'non-modal'}
    >
      <p id={progressId} className={styles.progress}>{`Step ${index + 1} of ${steps.length}`}</p>
      <h2 id={titleId} ref={titleRef} tabIndex={-1} className={styles.title}
        aria-describedby={`${progressId}${hintId}`}>{copy.title}</h2>
      <p id={bodyId} className={styles.body}>{copy.body}</p>
      {step.waitFor && <p id={waitId} className={own.waiting} role="status">Do this to continue, or choose Next to skip it.</p>}
      {moving && <p className={own.waiting} role="status">Looking for the next step…</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.skip} onClick={() => close(TOUR_STATES.dismissed)}>
          Skip tour
        </button>
        <span className={styles.nav}>
          <button type="button" className="btn btn-secondary" onClick={goBack} disabled={isFirst || moving}>
            Back
          </button>
          {isLast ? (
            <button type="button" className="btn btn-primary" onClick={() => close(TOUR_STATES.done)}>
              Done
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={goNext} disabled={moving}>
              Next
            </button>
          )}
        </span>
      </div>
    </div>
  )
  return createPortal(modal ? <div className={styles.layer}>{card}</div> : card, host || document.body)
}
