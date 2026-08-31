// app/src/components/navGroups.js
//
// ⭐ ONE AUTHORITY for the app's route taxonomy. It already existed, inline,
// inside MobileTabBar — desktop kept 16 unlabeled icons in a flat rail and
// the two surfaces could drift. Both now derive from here: MobileTabBar.jsx
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
  { key: 'home', label: 'Home', icon: 'dashboard', routes: ['/dashboard', '/morning-wire'] },
  { key: 'markets', label: 'Markets', icon: 'markets',
    routes: ['/breadth', '/options-flow', '/flow-scoreboard', '/live-massive', '/dark-pool',
             '/post-market', '/screener', '/calendar', '/catalysts', '/ai-search', '/uct-20'] },
  { key: 'charts', label: 'Charts', icon: 'chart',
    routes: ['/charts', '/watchlists', '/theme-tracker', '/model-book', '/setup-library'] },
  { key: 'journal', label: 'Journal', icon: 'journal',
    routes: ['/journal', '/community', '/desk', '/support'] },
]

// The full set of `to` targets a consumer actually navigates a user to,
// derived from NAV_GROUPS rather than hand-typed. Every group contributes
// its first route (the rule MobileTabBar.jsx's tab-building map follows);
// `home` additionally contributes its SECOND route because MobileTabBar
// splits it into two mutually-exclusive tabs — paid users get `/dashboard`,
// free users get `/morning-wire` (the free tier's only page) — never both at
// once, but both are real navigation targets across the two tiers. Every
// other route in every group (e.g. `/catalysts`) is a match-prefix only.
export function navigableTargets() {
  const out = []
  for (const g of NAV_GROUPS) {
    out.push(g.routes[0])
    if (g.key === 'home') out.push(g.routes[1])
  }
  return out
}
