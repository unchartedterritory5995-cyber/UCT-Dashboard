// Which Watchlist / Scanner widgets are mounted, as each one draws itself: a small registry, so a reader outside the
// React tree (the Agent's host, agent/host.js buildListViewSource) reads the rows in their on-screen order and the
// columns and sort a member sees, and reaches that widget's OWN writers. Nothing is stored here but the widget's getter;
// a widget that unmounts is gone, so a stale view can never answer.

const VIEWS = new Set()

/** `meta` = { type: 'watchlist' | 'scanner', color, key (its watchKey / scanKey) }; `live()` = the widget's current state + writers. */
export function publishListView(meta, live) {
  const entry = { type: meta.type, color: meta.color, key: meta.key, live }
  VIEWS.add(entry)
  return () => { VIEWS.delete(entry) }
}

export const mountedListViews = () => [...VIEWS]
