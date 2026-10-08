/**
 * Finish program, lane KEYS: the one name for "open the Notebook's search panel".
 *
 * The command palette's "Search Notebook" navigates to the Notebook with this hash; the
 * Notebook (tabs/NotebookTab.jsx) reads it, shows the folders panel if it was hidden, and asks
 * the panel (FolderSidebar.jsx) to switch to search with the cursor in the box. One constant,
 * imported by both sides, so the door and its reader cannot drift. Tiny on purpose: the palette
 * is app-wide chrome and must not pull Notebook code into its chunk.
 */
export const NOTEBOOK_SEARCH_HASH = '#search'
