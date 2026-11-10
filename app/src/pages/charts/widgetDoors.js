// Each mounted widget's own state and writers, published for a reader outside the React tree: agent/host.js
// (`host.widgets.door`), as watchlistViews.js does for a list. Some of what a person sets on a widget is the widget's own
// React state (the Theme Tracker's period, the Calendar's day), and some of what it can do lives in its closures (the
// capture its Journal door freezes). Nothing is stored here but the widget's getter; a widget that unmounts is gone, so a
// stale door can never answer. Rendered outside a /charts widget slot (a journal embed, a page) a widget publishes nothing.
//
// A door is { read?, options?, write?, act?, capture?, about? }:
//   read()            → { key: value } of the controls its registry `controls` mark `door`
//   options()         → { key: [{ value, label }] } the choices a control marked `from: 'door'` offers right now
//   write(key, value) → the widget's own writer for that control
//   act(key)          → runs one of the widget's own buttons (a registry `action` row: Refresh), a Promise that resolves once
//                       it is done, or null when the widget offers no such button right now
//   capture()         → { kind, capture, label } exactly what its Send to Journal door freezes, or null when it offers none
//   about()           → a line a person reads off the widget and no control holds (a scan's criteria)
import { createContext, useContext, useEffect, useRef } from 'react'

const DOORS = new Map()

/** The slot's per-tab id (WidgetHost `groupId`); the main tab's is the widget's id. */
export const WidgetDoorContext = createContext(null)

export function publishWidgetDoor(id, live) {
  const key = String(id)
  DOORS.set(key, live)
  return () => { if (DOORS.get(key) === live) DOORS.delete(key) }
}

export const mountedWidgetDoor = (id) => {
  const live = DOORS.get(String(id))
  return live ? live() : null
}

/** `build` runs on demand and always sees the latest render; nothing re-renders for it. */
export function useWidgetDoor(build) {
  const id = useContext(WidgetDoorContext)
  const ref = useRef(build)
  useEffect(() => { ref.current = build })
  useEffect(() => (id == null ? undefined : publishWidgetDoor(id, () => ref.current())), [id])
}
