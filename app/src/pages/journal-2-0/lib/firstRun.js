// Audit 2026-11-05, spec S16 (M2): the 60-second first run -- WHEN it shows, and what is remembered. EAGER and
// small: NotebookTab's gate and Research Home's inline slot read it; the sheet itself is a lazy chunk.
//
// ⛔ PER ACCOUNT, never per device. The first run's marks ride the Notebook's one-time-tips preference
// (`notebook_tips` = {v:1, seen:[ids]}, lib/notebookTips.js, Tier 2), written through `setPrefMerged`, so a phone and
// a desktop agree. Its server allow-list row already exists (api/routers/auth.py `notebook_tips`). The ids:
//   first-run          the sheet was SHOWN (recorded when it shows, so a reload or a second tab never reopens it);
//   first-run-skipped  the member pressed Skip: Home then asks the same two things inline (S17);
//   first-run-built    Build landed: nothing asks again;
//   first-run-inline   the member closed the inline ask on Home.
//
// ⛔ WHO IT IS FOR: a member on their first Notebook visit -- no notes yet (the same "is this member new?" NotebookTab
// derives once for the tour) -- while the starter packs are on (they are the "How do you trade?" it asks; always on
// in production since 2026-11-04). Settings opens it again for anyone ("Set up my Notebook"), with
// `location.state.openFirstRun`.
import { useSyncExternalStore } from 'react'
import { TIP_IDS, seenTips } from './notebookTips'

export const FIRST_RUN_MARKS = Object.freeze({
  shown: TIP_IDS.firstRun,
  skipped: TIP_IDS.firstRunSkipped,
  built: TIP_IDS.firstRunBuilt,
  inlineClosed: TIP_IDS.firstRunInline,
})

/** The navigation state Settings sends to open the first run again. */
export const FIRST_RUN_STATE = 'openFirstRun'

/** Whether the first run opens BY ITSELF for this member now. */
export function firstRunIsDue({ enabled, prefsReady, tipsRaw, notesKnown, hasAnyNotes }) {
  if (!enabled || !prefsReady || !notesKnown || hasAnyNotes) return false
  return !seenTips(tipsRaw).has(FIRST_RUN_MARKS.shown)
}

/** Whether Home asks the two first-run questions inline: the member skipped, never built, never closed the ask. */
export function firstRunInlineIsDue({ enabled, prefsReady, tipsRaw }) {
  if (!enabled || !prefsReady) return false
  const seen = seenTips(tipsRaw)
  return seen.has(FIRST_RUN_MARKS.skipped) && !seen.has(FIRST_RUN_MARKS.built) && !seen.has(FIRST_RUN_MARKS.inlineClosed)
}

// ── "Is the first run on screen?" -- one fact the tour gate reads, so the two never open together ─────────────
let showing = false
const subs = new Set()
export function setFirstRunShowing(on) {
  const next = on === true
  if (next === showing) return
  showing = next
  for (const f of Array.from(subs)) f()
}
const subscribe = (f) => { subs.add(f); return () => subs.delete(f) }
const read = () => showing
export function useFirstRunShowing() {
  return useSyncExternalStore(subscribe, read, () => false)
}

// ── "May the first run still open here?" -- for the walkthrough gate in the app shell ───────────────────────────
// Final fix (C5): the shell's RegistryToursGate cannot compute `firstRunIsDue` (it does not know the notes count), and
// the "showing" fact above is set in FirstRunGate's effect, after the render that decides it. So the notes list, which
// knows both inputs, publishes "the first run is due here, or cannot be decided yet" from a LAYOUT effect (before any
// walkthrough's passive effects look for an anchor). Null wherever the list is not mounted: the first run only opens
// on the Notebook.
// Follow-up B, item 2c: WHICH of the two it is, because the gate treats them differently. 'due': the first run opens
// here (the gate holds a walkthrough for a bounded time). 'undecided': the preferences or the notes count have not
// answered yet (the gate holds without a limit: a member who is NOT new but whose preferences read is slow must not
// lose the walkthrough they asked for). `true` is read as 'due'.
export const FIRST_RUN_DUE = 'due'
export const FIRST_RUN_UNDECIDED = 'undecided'
let pending = null
const pendingSubs = new Set()
export function setFirstRunPending(state) {
  const next = state === true ? FIRST_RUN_DUE : state || null
  if (next === pending) return
  pending = next
  for (const f of Array.from(pendingSubs)) f()
}
const subscribePending = (f) => { pendingSubs.add(f); return () => pendingSubs.delete(f) }
const readPending = () => pending
export function useFirstRunPending() {
  return useSyncExternalStore(subscribePending, readPending, () => false)
}
