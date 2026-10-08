// Wave 14, lane W14-keys: the onboarding surfaces' keyboard doors (docs/notebook/wave14-keys.md).
//
// W14-Q1 measured every onboarding flow over its click budget on a KEYBOARD and inside it with a
// pointer: the cost was chrome order, not the surfaces. This module is the EAGER half of the fix,
// small on purpose (the Notebook's first-open bytes are budgeted):
//   * "Skip to getting started" -- a skip link rendered in the shell's skip-link slot
//     (components/skipLinks.jsx) while, and only while, the get-started checklist is on screen.
//     The checklist (a lazy chunk) announces itself here; NotebookTab renders the link beside its
//     own "Skip to notes list". A presence store rather than a second copy of the checklist's
//     visibility rule: that rule has five inputs (two flags, the preference, its loading state,
//     and "every step done"), and a copy beside it would drift (lesson: a second authority over
//     one value).
//   * the first-run heading's marker -- where focus goes when the auto-started base tour closes
//     and there is nothing it could hand focus back to.
import { useEffect, useSyncExternalStore } from 'react'

/** The checklist heading's id: the skip link's target. One checklist renders at a time. */
export const GETTING_STARTED_HEADING_ID = 'notebook-getting-started'
export const GETTING_STARTED_SKIP_TEXT = 'Skip to getting started'

/** Marks Research Home's first-run heading (wave-14 switch on). */
export const FIRST_RUN_HEADING_ATTR = 'data-first-run-heading'

let showing = 0
const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn())
const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const read = () => showing > 0

/** The checklist calls this with whether it is rendering its card right now. */
export function useMarkGettingStartedShowing(on) {
  useEffect(() => {
    if (!on) return undefined
    showing += 1
    emit()
    return () => {
      showing -= 1
      emit()
    }
  }, [on])
}

/** Whether a get-started checklist is on screen. */
export function useGettingStartedShowing() {
  return useSyncExternalStore(subscribe, read, () => false)
}

/** "Skip to getting started": moves focus to the checklist heading. Nothing while it is absent. */
export function GettingStartedSkipLink({ className }) {
  const on = useGettingStartedShowing()
  if (!on) return null
  const onClick = (e) => {
    e.preventDefault()
    document.getElementById(GETTING_STARTED_HEADING_ID)?.focus()
  }
  return (
    <a href={`#${GETTING_STARTED_HEADING_ID}`} className={className} onClick={onClick}>
      {GETTING_STARTED_SKIP_TEXT}
    </a>
  )
}

/** Focus the first-run heading when focus has nowhere to be (it sits on <body>). Returns
 *  whether it moved. Never steals focus a member has put somewhere. */
export function focusFirstRunHeadingIfLost() {
  if (typeof document === 'undefined') return false
  const active = document.activeElement
  if (active && active !== document.body) return false
  const heading = document.querySelector(`[${FIRST_RUN_HEADING_ATTR}]`)
  if (!heading) return false
  heading.focus()
  return document.activeElement === heading
}
