// app/src/components/firstRun/viewportLockedRoutes.js
//
// Wave 10 follow-up F5, fix round 2: the pages sized to the viewport. The "Meet Compass" card
// sits IN the page flow (Layout's first-run slot), so on such a page it pushes the page's
// own height past the fold: /charts at 1200 px scrolled 78 px while the card was up and its
// workspace bottom sat 50 px below the fold (docs/notebook/proof/f5-r1-charts/). On these
// routes the card WAITS (it is not dismissed) and shows on the next ordinary page, as it
// already does on the phone chart shell.
//
// ⛔ DERIVED BY MEASUREMENT, NOT BY GUESSING. Every NavBar route plus /settings at 1200x800,
// scrollbars shown, card pending vs already dismissed
// (docs/notebook/proof/f5-r2-routes/routes-before-a0c32d2e2.json, instrument beside it): a
// route is here when the pending card makes <main> scroll and the dismissed state does not
// (or pushes the page below the fold with no scroll to reach it). The rail
// (viewportLockedRoutes.test.js) holds this list EQUAL to that measurement's `locked`, and
// fails when NavBar gains a route the measurement never saw.
//
// EXACT paths only. A child route (/calendar/mystocks, /community/:threadId) is a different
// page that was not measured, so it is not assumed locked.
export const VIEWPORT_LOCKED_ROUTES = Object.freeze([
  '/calendar',
  '/charts',
  '/dashboard',
  '/ai-search',
  '/breadth',
  '/screener',
  '/model-book',
  '/community',
  '/terminal',
])

const LOCKED = new Set(VIEWPORT_LOCKED_ROUTES)

/** Whether `pathname` is one of those pages ('/charts', or '/charts/' with a trailing slash). */
export function isViewportLockedRoute(pathname) {
  const p = String(pathname || '')
  return LOCKED.has(p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p)
}
