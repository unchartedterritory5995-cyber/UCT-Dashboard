// ⭐ A walkthrough that lives on ANOTHER page, taken there only on the member's Yes (cov-4 item 8). The walkthrough the member
// said Yes to waits here (a module of the app, so it outlives the page change) until the Agent panel that lands on that page
// takes it, ONCE. It never writes the workspace: it holds three strings and a time. Teaching only.
export const PAGE_PATHS = { watchlists: '/watchlists' }
const PAGE_NAMES = { watchlists: 'Watchlists' }
const TTL_MS = 60000          // a page that never shows its Agent (or a member who wandered off) does not start it later

let pending = null

// ⛔ A page is offered only once it shows the Agent and the walkthrough's anchors (the Watchlists page: the unapplied patch
// docs/agent/program/TEACH-WATCHLISTS-PAGE.patch, waiting for the owner). Until then nothing is offered, so no member is ever
// sent to a page where the walkthrough cannot start. Flip with the patch.
const READY = { watchlists: false }
export const pageReady = (surface) => READY[surface] === true
/** Tests only: a page's readiness (the rails run against a test double of the page). */
export function _setPageReady(surface, on) { READY[surface] = !!on }

/** The question asked before any page change. */
export const pageAskText = (surface) => `This is on the ${PAGE_NAMES[surface] || surface} page. Go there now?`
export const PAGE_CHOICES = [{ label: 'Yes, go there', ref: 'guidePage:yes' }, { label: 'No, stay here', ref: 'guidePage:no' }]

/** The member said Yes: hold the walkthrough, then change page through the host's own (allow-listed) navigate. → true | false */
export function goToPageWalk(walk, host) {
  const path = PAGE_PATHS[walk?.surface]
  if (!path || typeof host?.navigate !== 'function') return false
  pending = { surface: walk.surface, feature: walk.feature, detail: walk.detail || '', at: Date.now() }
  host.navigate(path)
  return true
}
/** The panel that landed on `surface`: the walkthrough waiting for it, once (then gone). */
export function takePageWalk(surface, now = Date.now()) {
  if (!pending || pending.surface !== surface) return null
  const p = pending
  pending = null
  return now - p.at <= TTL_MS ? p : null
}
export const peekPageWalk = () => pending
export function _resetPageWalk() { pending = null }
