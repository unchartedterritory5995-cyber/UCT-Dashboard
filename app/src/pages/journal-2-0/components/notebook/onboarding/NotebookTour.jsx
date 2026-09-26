// The Notebook's first-run tour (wave 8, lane 8C, C2; ruling D-C7).
//
// THE MOUNT (NotebookTourGate.jsx, which tabs/NotebookTab.jsx renders): its own lazy chunk,
// fetched only while `notebook_onboarding_enabled` is on AND the tour is about to show
// (wave 8 final review, fix I-2), inside a boundary that renders nothing if the chunk fails.
// Handed `hasAnyNotes` (the same value the first-run screen reads) and `notesKnown` (false
// while the count loads — `hasAnyNotes` also reads false then, so a member WITH notes would
// look new to anything that trusted it alone).
//
// WHEN IT SHOWS.
//   * Auto-start, once per mount, only when ALL hold: the gate is on, the member is paid,
//     the note count is known and is zero, the preferences have loaded, and `notebook_tour`
//     is neither `done` nor `dismissed`. A tour left half-way resumes at its step.
//   * "Take the tour" (Research Home; tourControl.js) and the help article's link
//     (`state: {startTour: true}`) open it whatever the preference says.
//   * It records `{v: 1, state, step}` in ONE preference key through `setPref`, which
//     replaces the whole value — so every write carries all three fields.
//
// HOW IT BEHAVES.
//   * Each step points at a `[data-tour="…"]` anchor (tourSteps.js), outlined in place. A
//     step whose anchor is not on screen is SKIPPED; with no anchor at all there is no tour.
//   * The card is a modal dialog (`role="dialog"`, `aria-modal`, `aria-labelledby`), focus
//     trapped by the one shared `trapTabKey`; Escape and "Skip tour" record `dismissed`,
//     Done records `done`, and focus goes back to whatever held it before.
//   * On the touch tier the card sits at the bottom; motion only without reduced motion.
//
// ⛔ H14: NOTHING HERE MEASURES THE PAGE ON A LOOP. An anchor's box is read at two moments
// only -- when the tour opens and when a step moves past one -- to ask whether the member
// can see it (fix M-7); the anchor is then outlined with an attribute and the card has a
// fixed place. No read is taken in response to layout, and none sets state per frame
// (NotebookTour.renderLoop.test.jsx, mutation-proved).
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import usePreferences from '../../../../../hooks/usePreferences'
import { useIsPaid } from '../../../../../context/AuthContext'
import { trapTabKey } from '../../../../../components/mobile/useFocusTrap'
import { notebookFlag } from '../../../lib/offline/notebookFlags'
import { TOUR_STEPS } from './tourSteps'
import { TOUR_STEP_COPY, TOUR_UI } from './tourCopy'
import { TOUR_OPEN_EVENT, takePendingTourOpen } from './tourControl'
import { TOUR_PREF, TOUR_STATES, readTourPref, tourFinished, tourIsForThisMember } from './tourPref'
import styles from './NotebookTour.module.css'

// The preference and the "is it for this member" rule live in tourPref.js, which the
// gate that fetches this chunk reads too (fix I-2). Re-exported: callers import them here.
export { TOUR_PREF, TOUR_STATES, readTourPref }
/** How long the auto-start waits for the page it points at to finish its first paint. */
export const AUTO_START_DELAY_MS = 300
const ACTIVE_ATTR = 'data-tour-active'

/**
 * Whether the member can SEE `el` (wave 8 final review, fix M-7). Present is not visible:
 * the collapsed sidebar keeps its anchors in the DOM, translated out of a 0-width slot that
 * clips them, and a `display: none` anchor has no box at all. So an anchor counts only when
 *   * it has a box (client rects, and a non-zero area);
 *   * that box is not wholly left or right of the window (a page scrolls up and down, never
 *     sideways, so nothing can bring a sideways box into view); and
 *   * no ancestor that CLIPS (overflow hidden/clip) cuts it to nothing.
 * Below the fold is fine: the step scrolls its anchor into view. An ancestor that SCROLLS
 * (auto/scroll) can bring the anchor into its own box, so past it what must be visible is
 * that scroller's box, not the anchor's.
 */
const CLIPS = new Set(['hidden', 'clip'])
const SCROLLS = new Set(['auto', 'scroll', 'overlay'])
export function isOnScreen(el) {
  if (!el?.getClientRects || el.getClientRects().length === 0) return false
  const r = el.getBoundingClientRect()
  const box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  const area = (b) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top)
  if (area(box) === 0) return false
  const vw = window.innerWidth || document.documentElement?.clientWidth || 0
  if (vw && (box.right <= 0 || box.left >= vw)) return false
  for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const cs = window.getComputedStyle(a)
    // A browser always resolves both axes; the shorthand is the fallback for an engine
    // that reports only what it was given (jsdom does).
    const x = cs.overflowX || cs.overflow
    const y = cs.overflowY || cs.overflow
    if (!CLIPS.has(x) && !CLIPS.has(y) && !SCROLLS.has(x) && !SCROLLS.has(y)) continue
    const ar = a.getBoundingClientRect()
    if (SCROLLS.has(x)) { box.left = ar.left; box.right = ar.right }
    else if (CLIPS.has(x)) { box.left = Math.max(box.left, ar.left); box.right = Math.min(box.right, ar.right) }
    if (SCROLLS.has(y)) { box.top = ar.top; box.bottom = ar.bottom }
    else if (CLIPS.has(y)) { box.top = Math.max(box.top, ar.top); box.bottom = Math.min(box.bottom, ar.bottom) }
    if (area(box) === 0) return false
  }
  return true
}

/** The on-screen element for an anchor, or null. Explicitly hidden elements do not count,
 *  and nor does one the member cannot see (M-7: a collapsed sidebar's anchors). */
export function anchorFor(anchor) {
  if (typeof document === 'undefined') return null
  const el = document.querySelector(`[data-tour="${anchor}"]`)
  if (!el || el.closest('[hidden],[aria-hidden="true"]')) return null
  if (!isOnScreen(el)) return null
  return el
}

/** The steps whose anchors are on screen now, in tour order. */
export function availableSteps() {
  return TOUR_STEPS.filter((s) => anchorFor(s.anchor))
}

export default function NotebookTour({ hasAnyNotes = false, notesKnown = false }) {
  const enabled = notebookFlag('notebook_onboarding_enabled') === true
  const isPaid = useIsPaid()
  const { prefs, setPref, loading } = usePreferences()
  const location = useLocation()
  const navigate = useNavigate()
  const saved = readTourPref(prefs[TOUR_PREF])
  const savedState = saved?.state ?? null
  const savedStep = typeof saved?.step === 'string' ? saved.step : null

  const [steps, setSteps] = useState(null)       // null = closed
  const [index, setIndex] = useState(0)
  const cardRef = useRef(null)
  const titleRef = useRef(null)
  const returnFocusRef = useRef(null)
  const autoTriedRef = useRef(false)
  const titleId = useId()
  const bodyId = useId()

  const record = useCallback((state, stepId) => {
    setPref(TOUR_PREF, { v: 1, state, step: stepId ?? null })
  }, [setPref])

  const open = useCallback((startId) => {
    const available = availableSteps()
    if (!available.length) return null
    const at = Math.max(0, available.findIndex((s) => s.id === startId))
    if (!returnFocusRef.current) returnFocusRef.current = document.activeElement
    setSteps(available)
    setIndex(at)
    return available[at]
  }, [])

  const close = useCallback((state) => {
    const current = steps ? steps[index] : null
    setSteps(null)
    setIndex(0)
    record(state, current?.id)
  }, [steps, index, record])

  // ── auto-start: once per mount, and only for a member the tour is for ──────────────
  // The rule is tourPref.js's, shared with the gate that fetched this chunk (fix I-2).
  useEffect(() => {
    if (autoTriedRef.current || steps) return undefined
    if (!tourIsForThisMember({ enabled, isPaid, notesKnown, hasAnyNotes, loading })) return undefined
    if (tourFinished(savedState)) {
      autoTriedRef.current = true
      return undefined
    }
    // The attempt counts when the timer FIRES: a dependency changing inside the wait (the
    // preferences revalidating) cancels this timer and the next run sets a fresh one.
    const timer = setTimeout(() => {
      autoTriedRef.current = true
      const first = open(savedState === TOUR_STATES.started ? savedStep : null)
      if (first) record(TOUR_STATES.started, first.id)
    }, AUTO_START_DELAY_MS)
    return () => clearTimeout(timer)
  }, [enabled, isPaid, notesKnown, hasAnyNotes, loading, savedState, savedStep, steps, open, record])

  // ── the doors that reopen it whatever the preference says ──────────────────────────
  useEffect(() => {
    if (!enabled) return undefined
    const onOpen = () => {
      takePendingTourOpen()
      const first = open(null)
      if (first) record(TOUR_STATES.started, first.id)
    }
    if (takePendingTourOpen()) onOpen()
    window.addEventListener(TOUR_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(TOUR_OPEN_EVENT, onOpen)
  }, [enabled, open, record])

  // ⛔ Fix M-7: the help link's timer is cleared if the tour unmounts first (a member who
  // navigates away inside the wait used to have the tour open -- and record `started` -- on
  // a page they had left). A REF, cleared on unmount only: the effect below re-runs the
  // moment it clears `state.startTour` from the URL, and a cleanup there would cancel the
  // very timer it had just set.
  const startTimerRef = useRef(null)
  useEffect(() => () => clearTimeout(startTimerRef.current), [])
  useEffect(() => {
    if (!enabled || !location.state?.startTour) return
    const rest = { ...location.state }
    delete rest.startTour
    navigate(`${location.pathname}${location.search}`, { replace: true, state: Object.keys(rest).length ? rest : null })
    // Arriving from another page, the Notebook is still painting: give it the same moment
    // the auto-start gives it before looking for anchors.
    clearTimeout(startTimerRef.current)
    startTimerRef.current = setTimeout(() => {
      startTimerRef.current = null
      const first = open(null)
      if (first) record(TOUR_STATES.started, first.id)
    }, AUTO_START_DELAY_MS)
  }, [enabled, location.state, location.pathname, location.search, navigate, open, record])

  // ── the anchor, outlined in place (an attribute, never a measurement) ───────────────
  const step = steps ? steps[index] : null
  useEffect(() => {
    if (!step) return undefined
    const el = anchorFor(step.anchor)
    if (!el) return undefined
    el.setAttribute(ACTIVE_ATTR, 'true')
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    return () => el.removeAttribute(ACTIVE_ATTR)
  }, [step])

  // ── focus: into the card on each step, back where it was when the tour ends ─────────
  useEffect(() => {
    if (step) titleRef.current?.focus()
  }, [step])
  useEffect(() => {
    if (steps) return
    const back = returnFocusRef.current
    returnFocusRef.current = null
    if (back && typeof back.focus === 'function' && document.contains(back)) back.focus()
  }, [steps])

  // ── keys: Escape dismisses, Tab stays inside the card ──────────────────────────────
  useEffect(() => {
    if (!steps) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close(TOUR_STATES.dismissed)
      } else if (e.key === 'Tab') {
        trapTabKey(e, cardRef.current)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [steps, close])

  if (!enabled || !step) return null

  // A step whose anchor left the page since the tour opened is skipped on the way past it.
  const nextIndex = (from, dir) => {
    for (let i = from + dir; i >= 0 && i < steps.length; i += dir) {
      if (anchorFor(steps[i].anchor)) return i
    }
    return -1
  }
  const goNext = () => {
    const i = nextIndex(index, 1)
    if (i < 0) { close(TOUR_STATES.done); return }
    setIndex(i)
    record(TOUR_STATES.started, steps[i].id)
  }
  const goBack = () => {
    const i = nextIndex(index, -1)
    if (i < 0) return
    setIndex(i)
    record(TOUR_STATES.started, steps[i].id)
  }
  const isFirst = index === 0
  const isLast = index === steps.length - 1
  const copy = TOUR_STEP_COPY[step.id] || { title: '', body: '' }

  return createPortal(
    <div className={styles.layer}>
      <div
        ref={cardRef}
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <p className={styles.progress}>{TOUR_UI.progress(index + 1, steps.length)}</p>
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className={styles.title}>{copy.title}</h2>
        <p id={bodyId} className={styles.body}>{copy.body}</p>
        {isLast && (
          <p className={styles.help}>
            <Link to="/support" state={{ from: '/journal/notebook' }} onClick={() => close(TOUR_STATES.done)}>
              {TOUR_UI.help}
            </Link>
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.skip} onClick={() => close(TOUR_STATES.dismissed)}>
            {TOUR_UI.skip}
          </button>
          <span className={styles.nav}>
            <button type="button" className="btn btn-secondary" onClick={goBack} disabled={isFirst}>
              {TOUR_UI.back}
            </button>
            {isLast ? (
              <button type="button" className="btn btn-primary" onClick={() => close(TOUR_STATES.done)}>
                {TOUR_UI.done}
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={goNext}>
                {TOUR_UI.next}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// The steps this tour walks (kept from the seam stub, which attached them here).
NotebookTour.steps = TOUR_STEPS
