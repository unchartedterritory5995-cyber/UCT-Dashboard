// ⭐ THE SINGLE AUTHORITY for Zone D. The backend signposts endpoint
// (`api/routers/dashboard_signposts.py`) is keyed by these `key`s and
// `doors.test.js` resolves these `to`s against the real route table
// (`app/src/App.jsx`). Do not restate this list anywhere.
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
