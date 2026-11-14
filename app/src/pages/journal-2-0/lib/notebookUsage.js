// Follow-up A (usage counting): the small helpers the usage events share. The events and their enums are
// lib/notebookTelemetry.js; what each answers is docs/notebook/simplify-2026-11-11-ledger.md, "Follow-up A".
import { useEffect } from 'react'
import { EVENT_SCHEMAS, MEMBER_BUILT_KIND, NOTEBOOK_EVENTS, trackNotebookEvent } from './notebookTelemetry'

// ── view_used via 'link': a link the member followed ─────────────────────────
/** The router state key the walkthrough engine puts on the navigation that starts a tour (GenericTourEngine). */
export const TOUR_NAV = 'tourNav'
let firstEntrySeen = false
/** Follow-up B, item 6a: the router `location.key` last counted. A remount of the notes list while the navigation type
 *  is still PUSH on the same entry would otherwise count that one link again. */
let lastCountedKey = null
/** The browser's own word for how the document was loaded ('navigate', 'reload', 'back_forward'), or null. */
export const documentNav = {
  type: () => {
    try { return globalThis.performance?.getEntriesByType?.('navigation')?.[0]?.type || null } catch { return null }
  },
}
/** Did the member open this address by a link? An in-app PUSH that the walkthrough engine did not make, or, once per
 *  document, the first entry (POP) when the browser loaded the page by a followed or typed link. Never Back or
 *  Forward, a reload, a REPLACE, or a remount on the same address: `key` (the router's `location.key`) is counted at
 *  most once, whatever the navigation type still says. */
export function linkOpened(navigationType, state, key = null) {
  const first = !firstEntrySeen
  firstEntrySeen = true
  if (key != null && key === lastCountedKey) return false
  let opened = false
  if (navigationType === 'PUSH') opened = !(state && state[TOUR_NAV])
  else if (navigationType === 'POP' && first) {
    const idx = globalThis.history?.state?.idx
    opened = (idx === 0 || idx === undefined) && documentNav.type() === 'navigate'
  }
  if (opened && key != null) lastCountedKey = key
  return opened
}
/** Tests only: a fresh document. */
export const __resetLinkOpenedForTests = () => { firstEntrySeen = false; lastCountedKey = null }

/** `notebook_route_opened`: once per mount of one of the Notebook's side routes (off while `on` is false). */
export function useRouteOpened(route, on = true) {
  useEffect(() => {
    if (on) trackNotebookEvent(NOTEBOOK_EVENTS.NOTEBOOK_ROUTE_OPENED, { route })
  }, [route, on])
}

const FAMILIES = EVENT_SCHEMAS.template_started.family.values

/** A catalogue family id or a built-in note type id, as `template_started.family`; anything else is 'custom'. */
export const templateFamily = (id) => (typeof id === 'string' && FAMILIES.has(id) && id !== 'custom' ? id : 'custom')

/** The `template_started` props for the note type picker's create (`{kindId}` or `{styleId}`). A built-in style
 *  (`builtin:<type>`) is that note type; a member's own style is 'own'. */
export function kindStart({ kindId, styleId } = {}) {
  if (kindId) return { source: 'note_type', family: templateFamily(kindId) }
  const builtin = typeof styleId === 'string' && styleId.startsWith('builtin:') ? styleId.slice(8) : null
  return builtin ? { source: 'note_type', family: templateFamily(builtin) } : { source: 'own', family: 'custom' }
}

// ── block_inserted: which door is inserting ──────────────────────────────────
// A door (the slash menu, the widget palette, the palette opened from the phone "+") runs its insert inside
// `withInsertDoor`; the widget node's plugin (lib/widgetEmbedNode.jsx) reports the FIRST widget the insert adds, once
// per press. An insert outside a door (a template, a paste, a capture, a body reload) counts nothing.
// Fix round 1 (I4): the door is open ONLY for the synchronous code it wraps, so nothing that lands later (a body
// reload through setContent, a paste) can be claimed by it. A press whose insert lands later (a widget fetched first,
// a picker or the widget builder that inserts on its own press) reads `insertVia()` when it starts and wraps its own
// final insert in `withInsertDoor(via, ...)`.
let door = null

/** Run `fn` as one press of `via` (no door when `via` is empty). The door closes when `fn` returns. */
export function withInsertDoor(via, fn) {
  if (!via) return fn()
  const outer = door
  door = { via, sent: false }
  try {
    return fn()
  } finally {
    door = outer
  }
}

/** The door a press is running inside right now (read synchronously when the press starts), or null. */
export const insertVia = () => door?.via || null

/** Is a door open and not yet counted? (the node plugin looks at a transaction only then) */
export const insertDoorOpen = () => Boolean(door && !door.sent)

/** The registry id `widgetId` was just inserted: counted once for the open door, if any. */
export function reportInsertedBlock(widgetId) {
  if (!door || door.sent) return null
  door.sent = true
  const kind = widgetId === MEMBER_BUILT_KIND ? 'custom' : widgetId
  return trackNotebookEvent(NOTEBOOK_EVENTS.BLOCK_INSERTED, { kind, via: door.via })
}
