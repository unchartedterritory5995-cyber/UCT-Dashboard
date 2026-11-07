// UCT Agent AUTOTEST: the TUTORIAL oracle. Pure. Grades a walkthrough from what the page really holds: the guide's own store
// (guideStore.guideState / guideEnded, read in the page through the module the app itself uses) and the DOM (the ring, the card,
// the element the ring encloses, the chart that element sits in). Never from the Agent's words.
//
// A probe (tutorialRun.mjs): { store: { active, feature, index, steps, chartRef, ended: { featureId, reason } | null },
//   ring: { x, y, w, h } | null, card: bool, text, inRole: role | null, encloses: [{ guide, role }], notice }
//
// Checks, each [name, ...args]:
//   ['starts', feature]        a walkthrough of `feature` started (store), with a ring and a card on screen
//   ['ringOn', role, guide]    the ring encloses an element carrying data-guide=`guide` INSIDE `role`'s widget (the named chart),
//                              and the ring's centre is in that widget too
//   ['endsGone', reasonRe]     at the end: no walkthrough in the store, its ended reason matches, no ring, no card
//   ['stillOn', index]         at the end: still running, at step `index` (a wrong click must not advance it)
//   ['noRing']                 no ring anywhere at the end (a walkthrough whose chart is gone must not ring a ghost)
//   ['stillActive']            at the end it is still running (any step), with its ring and card
//   ['advancedOrDone']         at the end it is past its first step, or it ended as done
//   ['nothingOnScreen']        no walkthrough, ring or card at the end (after a reload)
//   ['endFeature', feature]    a new how-to replaced the walkthrough: `feature` is running at the end
//   ['ringOnAtEnd', role, g]   at the end the ring is still on `g` of `role` (another chart went away, this one did not)
//   ['stillOnOrGone', index]   at the end it is at step `index` or has ended: it never moved on
//   ['unchanged']              the board's state is exactly as it was before the request (the guide never executes a change)
//   ['noReceipt']              no success receipt appeared while it ran
const near = (a, b, tol = 6) => Math.abs(a - b) <= tol

/** Does the ring rect enclose this element rect (the ring is the control's box grown by a few pixels)? */
export function encloses(ring, el, pad = 12) {
  if (!ring || !el) return false
  return ring.x <= el.x + 1 && ring.y <= el.y + 1 && ring.x + ring.w >= el.x + el.w - 1 && ring.y + ring.h >= el.y + el.h - 1
    && near(ring.w, el.w, 2 * pad) && near(ring.h, el.h, 2 * pad)
}

export function gradeTutorial(spec, ev) {
  const C = []
  const push = (name, pass, detail, tag = 'guide') => C.push({ name, pass: !!pass, detail: pass ? undefined : detail, tag })
  const start = ev.start || {}, end = ev.end || {}
  const show = (p) => JSON.stringify({ active: p.store?.active, feature: p.store?.feature, index: p.store?.index, ended: p.store?.ended?.reason, ring: !!p.ring, card: p.card, inRole: p.inRole, encloses: (p.encloses || []).slice(0, 4) }).slice(0, 300)
  for (const [k, ...a] of spec.expect) {
    if (k === 'starts') push(`a ${a[0]} walkthrough started, ring and card on screen`, start.store?.active && (!a[0] || start.store.feature === a[0]) && start.ring && start.card, show(start))
    else if (k === 'ringOn') {
      const hit = (start.encloses || []).some(e => e.guide === a[1] && e.role === a[0])
      push(`the ring is on ${a[1]} of the ${a[0]} chart`, hit && start.inRole === a[0], show(start), 'target')
    } else if (k === 'endsGone') push(`it ended (${a[0]}) and left nothing on screen`, !end.store?.active && new RegExp(a[0]).test(end.store?.ended?.reason || '') && !end.ring && !end.card, show(end))
    else if (k === 'stillOn') push(`still running at step ${a[0] + 1}`, end.store?.active && end.store.index === a[0] && end.ring && end.card, show(end))
    else if (k === 'advancedTo') push(`moved on to step ${a[0] + 1}`, end.store?.active && end.store.index === a[0], show(end))
    else if (k === 'noRing') push('no ring left on screen', !end.ring, show(end))
    else if (k === 'stillActive') push('still running: a control of its own chart did not end it', end.store?.active && end.ring && end.card, show(end))
    else if (k === 'stillActiveOrDone') push('a control of its own chart did not end it as a click elsewhere', (end.store?.active && end.ring && end.card) || /done/.test(end.store?.ended?.reason || ''), show(end))
    else if (k === 'advancedOrDone') push('its own control moved it on or finished it', (end.store?.active && end.store.index > (start.store?.index ?? 0)) || (!end.store?.active && /done/.test(end.store?.ended?.reason || '')), show(end))
    else if (k === 'nothingOnScreen') push('no walkthrough, ring or card after it', !end.store?.active && !end.ring && !end.card, show(end))
    else if (k === 'endFeature') push(`the new request replaced it with ${a[0]}`, end.store?.active && end.store.feature === a[0] && end.ring && end.card, show(end))
    else if (k === 'ringOnAtEnd') push(`the ring is still on ${a[1]} of the ${a[0]} chart`, (end.encloses || []).some(e => e.guide === a[1] && e.role === a[0]) && end.inRole === a[0], show(end), 'target')
    else if (k === 'stillOnOrGone') push(`still at step ${a[0] + 1}, or ended: never moved on`, !end.store?.active || end.store.index === a[0], show(end))
    else if (k === 'unchanged') push('the board is exactly as it was: the guide changed nothing', ev.worldBefore === ev.worldAfter, `${String(ev.worldBefore).slice(0, 160)} -> ${String(ev.worldAfter).slice(0, 160)}`, 'unchanged')
    else if (k === 'noReceipt') push('no success receipt while it ran', !ev.newReceipt, ev.receiptText, 'receipt')
    else throw new Error(`unknown tutorial check ${k}`)
  }
  if (ev.errors?.length) push('no console errors', false, ev.errors.slice(0, 3).join(' | '), 'console')
  return { pass: C.length > 0 && C.every(c => c.pass), graded: C.length, na: 0, checks: C }
}

/** A failed check → its family (one defect per family, not per sentence). */
export function tutorialFamily(spec, result) {
  const f = result.checks.find(c => !c.pass)
  if (!f) return null
  if (f.tag === 'target') return 'targeting: ring not on the named chart\'s control'
  if (f.tag === 'unchanged' || f.tag === 'receipt') return 'the guide changed the board'
  if (/started/.test(f.name)) return 'no walkthrough started'
  if (/ended/.test(f.name)) return `lifecycle: still on screen after ${spec.lifecycle || 'it should end'}`
  if (/still running|moved on/.test(f.name)) return `step advance: ${spec.lifecycle || 'wrong step'}`
  if (/no ring/.test(f.name)) return 'stale ring after its chart went away'
  return f.name
}
