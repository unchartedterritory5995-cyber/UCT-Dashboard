// ⭐ THE SINGLE AUTHORITY for Zone D. The backend signposts endpoint
// (`api/routers/dashboard_signposts.py`) is keyed by these `key`s.
// Do not restate this list anywhere.
//
// Two rails, and they answer different questions — keep both:
//   * `doors.test.js`       — FORMAT only: key/label/route/icon shape and
//                             uniqueness. It does NOT resolve routes.
//   * `doors.route.test.jsx` — RESOLUTION: renders the real `App` at the
//                             hrefs `ZoneDoors` itself produced and asserts
//                             none of them lands on the 404 page.
//
// ⚰️ This header USED TO SAY `doors.test.js` "resolves these `to`s against the
// real route table (`app/src/App.jsx`)". It never did — it only checked that
// `to` starts with a `/`, so all eight doors could have pointed at `/nowhere`
// and stayed green. A comment making a false claim about what a rail does is
// how the real rail never gets written; `doors.route.test.jsx` is that rail,
// and this line is now a description of it rather than a substitute for it.
export const DOORS = [
  { key: 'breadth',      label: 'Breadth',       to: '/breadth',         icon: 'breadth' },
  { key: 'options_flow', label: 'Options Flow',  to: '/options-flow',    icon: 'flow' },
  { key: 'uct20',        label: 'UCT 20',        to: '/uct-20',          icon: 'star' },
  { key: 'calendar',     label: 'Calendar',      to: '/calendar',        icon: 'calendar' },
  { key: 'screener',     label: 'Screener',      to: '/screener',        icon: 'screener' },
  { key: 'desk',         label: 'The Desk',      to: '/desk',            icon: 'desk' },
  { key: 'journal',      label: 'Journal',       to: '/journal',         icon: 'journal' },
  { key: 'community',    label: 'Community',     to: '/community',       icon: 'community' },
]
