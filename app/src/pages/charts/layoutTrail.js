// ── Layout trail: which named layouts this TAB had open, most recent first ──
//
// Per tab and per session on purpose (owner decision 2026-10-11): no preference, no sync.
// ChartsWorkspace feeds it every change of the open-layout pointer (charts_active_template),
// which every switch goes through — the Dock, the Agent (it opens through the Dock's own
// handler), save-as, New layout — so manual and Agent switches are recorded alike.
// UCT Agent reads it to resolve "switch back to the previous layout".

export const TRAIL_MAX = 8

const keyOf = (t) => (t && t.id != null ? String(t.id) : null)

/**
 * The trail after the open layout went from `from` to `to`. `from` (the layout left) moves to
 * the front; an unsaved board (no id) is never an entry. A rename (same id) changes nothing here:
 * names are looked up by id when the trail is read.
 */
export function recordSwitch(trail, from, to) {
  const fromKey = keyOf(from)
  if (!fromKey || fromKey === keyOf(to)) return trail
  const entry = { id: from.id, name: from.name || null, scope: from.scope || 'user' }
  return [entry, ...trail.filter(t => keyOf(t) !== fromKey)].slice(0, TRAIL_MAX)
}

/**
 * Track the open-layout pointer across renders (call once per render with the CURRENT pointer).
 * `state` is a mutable { last, trail } held in a ref; idempotent for a repeated render.
 */
export function observeActive(state, active) {
  const now = active && active.id != null ? { id: active.id, name: active.name || null, scope: active.scope || 'user' } : null
  if (keyOf(state.last) !== keyOf(now)) {
    if (state.last) state.trail = recordSwitch(state.trail, state.last, now)
    state.last = now
  } else if (now && state.last) {
    state.last = now                                    // same layout, maybe renamed
  }
  return state.trail
}

/** The trail as UCT Agent sees it: never the layout open now. */
export const recentLayouts = (trail, activeId) => trail.filter(t => String(t.id) !== String(activeId ?? ''))
