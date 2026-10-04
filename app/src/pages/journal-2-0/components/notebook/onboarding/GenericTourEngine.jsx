// The ONE engine for every registered tour beyond the wave-8 base tour (wave 14,
// lane W14-0). Loaded lazily by `RegistryToursGate.jsx`, exactly once a tour is
// WANTED -- never imported anywhere else, so its own weight (and every future
// tour's steps/copy, pulled in through `entry.load()`) never reaches the
// Notebook's first-open bytes (risk R3).
//
// Deliberately smaller than NotebookTour.jsx:
//   * no auto-start, no `hasAnyNotes`/`isPaid` eligibility -- a future tour's own
//     anchor IS its eligibility (no anchor on screen, no tour, exactly how the
//     base tour already behaves); wiring "offer once when a capability newly
//     arms" is W14-C's charter, stated in docs/notebook/wave14-w14-0.md.
//   * Replay always starts at step one (plan section 4.2: "replay ... reopens it
//     from step one regardless of saved state") -- there is no auto-start path to
//     resume FROM in this lane, so resume is not exercised here. The seen-state
//     module still records every step as the member walks, so W14-C's auto-start
//     trigger has real data to resume from the day it ships.
//
// What IS shared, by direct reuse rather than a second copy: anchor visibility
// (`anchorFor`, from `tourAnchorVisibility.js` -- the SAME function NotebookTour.jsx
// itself imports, never a copy and never a static import of NotebookTour.jsx: that
// file is held to exactly one importer, its own lazy gate, by tourLazy.test.js),
// the keyboard/focus-trap contract (`trapTabKey`), the first-run stage coordinator
// (`claimFirstRunStage`), and the card's own visual language
// (NotebookTour.module.css -- one stylesheet, not a second one).
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import usePreferences from '../../../../../hooks/usePreferences'
import { trapTabKey } from '../../../../../components/mobile/useFocusTrap'
import { claimFirstRunStage } from '../../../../../components/firstRun/firstRunStage'
import { anchorFor } from './tourAnchorVisibility'
import { TOUR_STATES, recordTourState } from './tourSeenState'
import styles from './NotebookTour.module.css'

const ACTIVE_ATTR = 'data-tour-active'

/** The steps whose anchors are on screen now, in the tour's own order -- the same
 *  rule `NotebookTour.jsx`'s `availableSteps` applies to `TOUR_STEPS`, generalized
 *  to whichever tour is open. */
function availableSteps(steps) {
  return steps.filter((s) => anchorFor(s.anchor))
}

export default function GenericTourEngine({ entry, onClose }) {
  const { setPrefMerged } = usePreferences()
  const [content, setContent] = useState(null)   // {steps, copy} once entry.load() resolves
  const [steps, setSteps] = useState(null)        // the available steps once opened
  const [index, setIndex] = useState(0)
  const cardRef = useRef(null)
  const titleRef = useRef(null)
  const returnFocusRef = useRef(null)
  const titleId = useId()
  const bodyId = useId()

  useEffect(() => {
    let cancelled = false
    entry.load().then((c) => { if (!cancelled) setContent(c) })
    return () => { cancelled = true }
  }, [entry])

  const record = useCallback((state, stepId) => {
    recordTourState(setPrefMerged, entry.id, state, stepId)
  }, [setPrefMerged, entry.id])

  // Open at step one the moment the content is in. If, by the time it arrives, no
  // anchor is on screen at all, there is no tour and nothing is recorded -- the
  // same "no anchor, no tour" rule the base engine applies.
  useEffect(() => {
    if (!content || steps) return
    const available = availableSteps(content.steps)
    if (!available.length) {
      onClose()
      return
    }
    if (!returnFocusRef.current) returnFocusRef.current = document.activeElement
    setSteps(available)
    setIndex(0)
    record(TOUR_STATES.started, available[0].id)
    // content/record/onClose are intentionally not deps: this effect fires exactly
    // once per mount, the instant `content` first lands (`steps` guards re-entry).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  const close = useCallback((state) => {
    const current = steps ? steps[index] : null
    setSteps(null)
    setIndex(0)
    record(state, current?.id)
    onClose()
  }, [steps, index, record, onClose])

  const tourOpen = Boolean(steps)
  useEffect(() => (tourOpen ? claimFirstRunStage() : undefined), [tourOpen])

  const step = steps ? steps[index] : null
  useEffect(() => {
    if (!step) return undefined
    const el = anchorFor(step.anchor)
    if (!el) return undefined
    el.setAttribute(ACTIVE_ATTR, 'true')
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    return () => el.removeAttribute(ACTIVE_ATTR)
  }, [step])

  useEffect(() => { if (step) titleRef.current?.focus() }, [step])
  useEffect(() => {
    if (steps) return
    const back = returnFocusRef.current
    returnFocusRef.current = null
    if (back && typeof back.focus === 'function' && document.contains(back)) back.focus()
  }, [steps])

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

  if (!step || !content) return null

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
  const copy = content.copy[step.id] || { title: '', body: '' }

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
        <p className={styles.progress}>{`Step ${index + 1} of ${steps.length}`}</p>
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className={styles.title}>{copy.title}</h2>
        <p id={bodyId} className={styles.body}>{copy.body}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.skip} onClick={() => close(TOUR_STATES.dismissed)}>
            Skip tour
          </button>
          <span className={styles.nav}>
            <button type="button" className="btn btn-secondary" onClick={goBack} disabled={isFirst}>
              Back
            </button>
            {isLast ? (
              <button type="button" className="btn btn-primary" onClick={() => close(TOUR_STATES.done)}>
                Done
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={goNext}>
                Next
              </button>
            )}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
