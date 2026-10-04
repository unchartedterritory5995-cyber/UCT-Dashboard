// The "get started" checklist on Research Home (wave 14, lane W14-D; plan section 4.4,
// controller default D4) -- the LAZY half. Research Home mounts the small eager gate,
// `GettingStartedChecklist.jsx`, which fetches this chunk only for a member the list is
// for (the onboarding flag on, preferences loaded, the list not closed), so a member who
// dismissed it never downloads it and none of it joins the Notebook's first-open bytes.
// Every rule lives in `onboarding/gettingStarted.js`; this file reads the inputs and
// renders the answer.
//
//   * WHAT IT LISTS -- derived, never restated: write a note, start one from a template,
//     the sample notebook (only where it can be had), then one step per registered,
//     replayable tour whose capability flag is armed (`tourRegistry.js` + `notebookFlag`).
//   * WHAT TICKS A STEP -- the member's real action or that tour's own seen-state, never
//     a click here. A click only opens the door: the Notebook's own create, Research
//     Home's own sample add (passed in, so there is one authority for that write), the
//     template picker, or the tour's own open door (`openNotebookTour` /
//     `openRegistryTour`).
//   * WHEN IT SHOWS -- while `notebook_onboarding_enabled` is on (the flag the base tour
//     and the sample door already ride), once the preferences have loaded (a dismissed
//     list must never flash), until it is closed. ONE preference key,
//     `notebook_getting_started`: Hide writes `dismissed`; ticking the last step writes
//     `done`, once (a ref guard plus the closed read -- the write can never repeat,
//     which is the render-loop class usePreferences.js's settle note describes).
//   * D4 -- closed stays closed. A capability that arms later adds its tour to the
//     derivation, but a closed list never reopens for it; Help > Walkthroughs lists
//     every registered tour instead.
//   * THE FIRST-RUN STAGE (components/firstRun/firstRunStage.js, plan 5.6) -- this list
//     is page content in normal flow, never portaled, never fixed. It does NOT claim the
//     stage: claiming is for a floating first-run card, and a list that can stay on
//     screen for days would hold the "Meet Compass" card back for all of them. A card
//     that takes its own page space cannot stack on another; the stylesheet rail in
//     GettingStartedChecklist.test.jsx keeps it that way.
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import UIcon from '../../../../components/ui/UIcon'
import usePreferences from '../../../../hooks/usePreferences'
import useNotebookHome from '../../hooks/useNotebookHome'
import { notebookFlag } from '../../lib/offline/notebookFlags'
import { openNotebookTour } from './onboarding/tourControl'
import { openRegistryTour } from './onboarding/tourRegistryControl'
import { BASE_TOUR_ID } from './onboarding/tourRegistry'
import {
  CHECKLIST_PREF, CHECKLIST_STATES, CHECKLIST_COPY, checklistClosed, checklistRecord,
  deriveChecklistItems,
} from './onboarding/gettingStarted'
import styles from './GettingStartedList.module.css'

/** Where "Start a note from a template" goes: All notes, which offers the template
 *  picker inline for an empty notebook and a Templates button otherwise. */
const TEMPLATES_HREF = '/journal/notebook?view=all'

export default function GettingStartedList({ hasAnyNotes = false, onCreateNote = null, onAddSample = null }) {
  const enabled = notebookFlag('notebook_onboarding_enabled') === true
  const { prefs, setPref, loading } = usePreferences()
  const { home } = useNotebookHome()
  const titleId = useId()
  const [adding, setAdding] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const closed = checklistClosed(prefs?.[CHECKLIST_PREF])
  const items = deriveChecklistItems({
    prefs,
    home,
    hasAnyNotes,
    canAddSample: !hasAnyNotes && typeof onAddSample === 'function',
    flag: notebookFlag,
  })
  const doneCount = items.filter((i) => i.done).length
  const allDone = items.length > 0 && doneCount === items.length

  // Every step ticked by what the member did: record it ONCE so the list stays closed
  // (D4) even when a capability arms later and adds an unticked step.
  const recorded = useRef(false)
  useEffect(() => {
    if (!enabled || loading || closed || !allDone || recorded.current) return
    recorded.current = true
    // Literal key (== CHECKLIST_PREF) so the preference-key rail reads this call site.
    setPref('notebook_getting_started', checklistRecord(CHECKLIST_STATES.done))
  }, [enabled, loading, closed, allDone, setPref])

  if (!enabled || loading || closed || allDone) return null

  const dismiss = () => {
    setPref('notebook_getting_started', checklistRecord(CHECKLIST_STATES.dismissed))
  }

  const addSample = async () => {
    if (adding) return
    setAdding(true)
    try {
      await onAddSample()
    } finally {
      if (mounted.current) setAdding(false)
    }
  }

  const action = (item) => {
    if (item.kind === 'template') {
      return <Link className={styles.action} to={TEMPLATES_HREF}>{item.label}</Link>
    }
    let onClick = null
    let label = item.label
    if (item.kind === 'note') onClick = onCreateNote
    else if (item.kind === 'sample') {
      onClick = addSample
      if (adding) label = CHECKLIST_COPY.sampleAdding
    } else if (item.kind === 'tour') {
      onClick = item.tourId === BASE_TOUR_ID ? () => openNotebookTour() : () => openRegistryTour(item.tourId)
    }
    if (typeof onClick !== 'function') return <span className={styles.label}>{label}</span>
    return (
      <button type="button" className={styles.action} onClick={onClick}
        disabled={item.kind === 'sample' && adding}>
        {label}
      </button>
    )
  }

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <div className={styles.header}>
        <h3 id={titleId} className={styles.title}>{CHECKLIST_COPY.title}</h3>
        <span className={styles.progress}>{CHECKLIST_COPY.progress(doneCount, items.length)}</span>
        <button type="button" className={styles.hide} onClick={dismiss} aria-label={CHECKLIST_COPY.hideLabel}>
          {CHECKLIST_COPY.hide}
        </button>
      </div>
      <ol className={styles.list}>
        {items.map((item) => (
          <li key={item.id} className={styles.item}>
            <span className={`${styles.mark} ${item.done ? styles.markDone : ''}`} aria-hidden="true">
              {item.done ? <UIcon name="check" size={12} /> : null}
            </span>
            {item.done ? (
              <span className={styles.doneLabel}>
                {item.label}
                <span className="sr-only"> {CHECKLIST_COPY.doneLabel}</span>
              </span>
            ) : action(item)}
          </li>
        ))}
      </ol>
    </section>
  )
}
