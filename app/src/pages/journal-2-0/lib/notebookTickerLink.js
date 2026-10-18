/**
 * The Notebook filtered to one ticker: the URL NotebookTab reads (`?ticker=`, composed with
 * `?view=all`; tabs/NotebookTab.jsx, Wave H checkpoint decision 23). ONE builder, so every door
 * that opens "the notes about this symbol" (the Ticker Research Workspace's "View all Notes", the
 * year page's ticker chips) lands on the same filter.
 */
export function notebookTickerHref(symbol) {
  return `/journal/notebook?view=all&ticker=${encodeURIComponent(symbol)}`
}
