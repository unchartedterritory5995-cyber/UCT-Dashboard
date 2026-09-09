// Joystick hub — route <-> mode-id table; the single authority for "is this pathname a section."
// See docs/plans/joystick/00-master-spec-v1.3.md §4 (Phase 1), Part C (home — "Last-used section defined").

import { modes, HOME_MODE_ID } from './registry'

// ⛔ DERIVED FROM THE REGISTRY, NEVER HAND-TYPED. Every mode object already names its
// own route (or omits one, for the in-place `catalysts` mode, which has no route at
// all). Hand-typing a second route table here would be exactly the "second authority
// over one value" defect this codebase keeps re-discovering (the writer-index count,
// the COT-router route count, the setup-catalog count — a hand-typed artifact beside
// the source that owns it). Deriving it means a route changing in `registry.js` can
// never leave this table silently stale.
//
// The nine entries are the eight route-backed modes (wire · breadth · scan · chart ·
// journal · notebook · calendar · flow) PLUS home (`/dashboard`). `catalysts` has no
// `route` field and is therefore absent here — it is reached in-place on /dashboard,
// never by navigation (spec §2e, Part C "catalysts").
/** @type {Readonly<Record<string, string>>} */
export const SECTION_ROUTES = Object.freeze(
  Object.fromEntries(modes.filter((m) => m.route).map((m) => [m.route, m.id])),
)

/**
 * Resolve a pathname to a hub mode id, EXACT match only.
 *
 * ⛔ Not a prefix match. `/journal` has nine sibling sub-routes and only two of
 * them (`/journal/trades`, `/journal/notebook`) are hub modes — `/journal/insights`
 * must return null, not `journal`. A plain object-key lookup on `SECTION_ROUTES`
 * is exact by construction, which is what makes it safe to be "the" resolver
 * rather than a `startsWith`/regex approximation of one.
 *
 * Includes `/dashboard` -> `home` (mode DERIVATION cares about home). For
 * "is this pathname a SECTION" (which deliberately excludes `/dashboard`), use
 * `isSectionRoute` below — two different functions on purpose, so the
 * distinction between "what mode is this" and "is this a section" can't be
 * collapsed back into one at a call site.
 *
 * @param {string} pathname
 * @returns {string|null} a mode id, or null when the route isn't registered.
 */
export function routeToModeId(pathname) {
  return SECTION_ROUTES[pathname] ?? null
}

/**
 * True when `pathname` is one of the eight route-backed SECTIONS — never
 * `/dashboard`. This is the gate for the `lastSection` write (Part C, home
 * mode, "Last-used section defined"): recording `/dashboard` itself would make
 * Home's "last-used section" Primary a no-op exactly when it is tapped.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
export function isSectionRoute(pathname) {
  const id = SECTION_ROUTES[pathname]
  return Boolean(id) && id !== HOME_MODE_ID
}
