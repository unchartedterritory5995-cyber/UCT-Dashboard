// app/src/components/navGroups.js
//
// ⭐ ONE AUTHORITY for the app's route taxonomy. It already existed, inline,
// inside the retired MobileTabBar — desktop kept 16 unlabeled icons in a flat rail and
// the two surfaces could drift. Consumers derive from here: MoreSheet.jsx
// maps a group's `routes` to its tab's `match` prefixes (and `routes[0]` to
// its `to`), NavBar.jsx groups `NAV_ITEMS` under a heading per group.
//
// ⛔ `routes` doubles as a MATCH-PREFIX list, and a prefix here is NOT a
// promise that it is itself a real route. `/catalysts` is listed under
// `markets` only so a visit to `/catalysts/history` (the real route) still
// lights the Markets tab/heading — `/catalysts` alone 404s. It must NEVER
// become a navigable `to`. `navGroups.route.test.jsx` asserts every `to` a
// consumer actually navigates to resolves against the real route table
// (`app/src/App.jsx`), and separately asserts `/catalysts` on its own does
// not — so the one deliberate gap stays a documented, verified fact instead
// of a silent landmine the next person re-derives by hand.
export const NAV_GROUPS = [
  // routes[0] = the group's primary navigable target. `/morning-wire` is a
  // match-prefix here only (it lights Home); it is NOT a free-tier tab — there
  // is no free tier (owner ruling 2026-10-02, TERM-081 / OI-12).
  { key: 'home', label: 'Home', icon: 'dashboard', routes: ['/calendar', '/morning-wire', '/charts', '/terminal'] },
  { key: 'markets', label: 'Markets', icon: 'markets',
    routes: ['/dashboard', '/breadth', '/options-flow', '/flow-scoreboard', '/live-massive', '/dark-pool',
             '/post-market', '/screener', '/catalysts', '/catalysts/history', '/ai-search', '/uct-20'] },
  { key: 'charts', label: 'Charts', icon: 'chart',
    routes: ['/model-book', '/watchlists', '/theme-tracker', '/setup-library', '/formulas/reference'] },
  { key: 'journal', label: 'Journal', icon: 'journal',
    routes: ['/journal', '/community', '/desk', '/support', '/portfolio-heat'] },
]

// The full set of `to` targets a consumer actually navigates a user to,
// derived from NAV_GROUPS rather than hand-typed. Every group contributes
// its first route (the rule the retired tab bar's map followed). Every other
// route in every group (e.g. `/catalysts`) is a match-prefix only.
//
// ⚰️ Until 2026-10-02 `home` ALSO contributed routes[1], `/morning-wire`, as
// the free tier's own tab (free members got the Wire, paid members the
// Dashboard). The owner ruled "everything is paywall": there is no free tab,
// so there is no second home target.
export function navigableTargets() {
  return NAV_GROUPS.map((g) => g.routes[0])
}
