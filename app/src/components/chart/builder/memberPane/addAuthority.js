// app/src/components/chart/builder/memberPane/addAuthority.js
//
// ─── ⭐⭐ (e94 train, coordinator ruling 2026-11-22) — ONE ANSWER TO "WHAT MAY ADD SEND, AND MAY IT SEND IT NOW?" ─────
//
// Two units met in `MemberPane.jsx` and each wrote its guard twice: ITEM 2 (a preview the store cannot hold is kept as
// its runtime-lane document, or Add is refused up front: in the render AND in the Add handler) and the paste worker (an
// Add while a newer build of the box runs waits: the disabled button AND the handler). A guard written twice cannot be
// mutation-proved (break one copy and the other still holds, so no rail goes red), and the next edit to one copy silently
// relies on the other. So the render (whether Add is shown, whether it is pressable) and the handlers (a press, a press
// queued on a pending admission) read THESE, and `addAuthority.test.js` rails them directly. No behaviour changed.

/** ⭐⭐ ITEM 2 — the build Add keeps: the door's own build, or, for a preview the store cannot hold (`built.oversize`),
 *  the same build carrying the runtime-lane document Add saves instead (`oversize.saveAs`); null when Add is refused up
 *  front (`oversize.refusal`) or there is no build this door saves (none, refused, `saveable === false`): nothing is sent. */
export function keptForAdd(b) {
  if (!b || !b.ok || b.saveable === false) return null
  if (!b.oversize) return b
  return b.oversize.saveAs ? { ...b, definition: b.oversize.saveAs.definition } : null
}

/** ⭐ THE PASTE WORKER — the build Add sends for the box's text: the kept build, but only when the build on screen was
 *  made of the box's OWN text (`doorSource === source`); a build of an older text is never attached under a newer one. */
export function addSendsFor({ built, doorSource, source }) {
  return doorSource === source ? keptForAdd(built) : null
}

/** Add is pressable now: something to send for this text (`addSendsFor`), and no newer build of the box running. */
export function addReady({ built, building, doorSource, source }) {
  return !building && addSendsFor({ built, doorSource, source }) !== null
}
