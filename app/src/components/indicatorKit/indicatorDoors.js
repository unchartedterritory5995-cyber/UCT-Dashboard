// app/src/components/indicatorKit/indicatorDoors.js
//
// One way to ask a chart to open one of its EXISTING indicator doors from
// somewhere that is not the chart (the command palette today). Nothing here
// opens a new surface: each door is a control the chart already has.
//
//   library  -> Chart Settings, Indicators (the window that lists everything)
//   describe -> Create Indicator (the conversation dock)
//   pine     -> the Builder on its "Import" tab (paste a TradingView script)
//   formula  -> the Builder on its formula tab
//   image    -> the Builder on its picture tab
//
// A request is PARKED, not just announced. The asker may be on another route,
// so the chart that will answer may not exist yet; the charts page takes the
// parked request when a chart is ready (`useIndicatorDoors`). A parked request
// goes stale quickly, so a door never opens long after it was asked for.
//
// Plan: docs/pine/studio/STUDIO-TRACK-PLAN.md section 6 (command palette), lane P1.

export const INDICATOR_DOOR_EVENT = 'uct:indicator-door'
export const INDICATOR_DOORS = Object.freeze({
  LIBRARY: 'library',
  DESCRIBE: 'describe',
  PASTE: 'pine',
  FORMULA: 'formula',
  PICTURE: 'image',
})
const DOOR_SET = new Set(Object.values(INDICATOR_DOORS))
export const PENDING_KEY = 'uct.indicatorDoor.pending'
export const PENDING_TTL_MS = 15000
export const CHARTS_PATH = '/charts'

function store() {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null } catch { return null }
}

/** Park a request and tell any chart page that is already open. */
export function requestIndicatorDoor(door, { now = Date.now() } = {}) {
  if (!DOOR_SET.has(door)) return false
  try { store()?.setItem(PENDING_KEY, JSON.stringify({ door, at: now })) } catch { /* storage unavailable */ }
  try { window.dispatchEvent(new CustomEvent(INDICATOR_DOOR_EVENT, { detail: { door } })) } catch { /* noop */ }
  return true
}

/** The parked request, or null when there is none or it has gone stale. Does not remove a live one. */
export function peekPendingIndicatorDoor({ now = Date.now() } = {}) {
  let raw = null
  try { raw = store()?.getItem(PENDING_KEY) ?? null } catch { raw = null }
  if (!raw) return null
  let parsed = null
  try { parsed = JSON.parse(raw) } catch { parsed = null }
  const ok = parsed && DOOR_SET.has(parsed.door) && Number.isFinite(parsed.at)
    && now - parsed.at >= 0 && now - parsed.at <= PENDING_TTL_MS
  if (!ok) { clearPendingIndicatorDoor(); return null }
  return parsed.door
}

export function clearPendingIndicatorDoor() {
  try { store()?.removeItem(PENDING_KEY) } catch { /* noop */ }
}

export function onIndicatorDoor(handler) {
  if (typeof window === 'undefined') return () => {}
  const fn = (e) => handler(e?.detail?.door)
  window.addEventListener(INDICATOR_DOOR_EVENT, fn)
  return () => window.removeEventListener(INDICATOR_DOOR_EVENT, fn)
}

/** The chart that answers: the one the member is on, else the first registered. */
export function pickChartApi(apiById, activeId) {
  if (!apiById || typeof apiById.get !== 'function') return null
  if (activeId != null && apiById.get(activeId)?.agent) return apiById.get(activeId)
  for (const api of apiById.values()) if (api?.agent) return api
  return null
}

/**
 * Ask one chart to open a door. Answers:
 *   'opened'  the chart opened it;
 *   'refused' the chart is here and said no for good (no access, a read-only chart);
 *   'later'   no chart could answer yet, so asking again may work.
 */
export function runIndicatorDoor(door, api) {
  const agent = api?.agent
  if (!agent || !DOOR_SET.has(door)) return 'later'
  try {
    if (door === INDICATOR_DOORS.DESCRIBE) {
      const res = agent.openCreateIndicator?.(null)
      if (res && res.ok) return 'opened'
      return res && (res.reason === 'access' || res.reason === 'readonly') ? 'refused' : 'later'
    }
    return agent.openIndicatorDoor?.(door) ? 'opened' : 'later'
  } catch {
    return 'later'
  }
}
