// The Notebook tour's steps (wave 8 seam S8-3): WHICH element each step points at.
//
// Each step names a `data-tour` anchor and the file that carries it, relative to
// `app/src/pages/journal-2-0/`. The anchors are attributes on elements that already
// existed in lane 8A's files (NotebookTab, FolderSidebar, NoteEditorPage), so the tour
// can point at them without 8C editing 8A's files. `tourAnchors.test.js` reads each named
// file and fails BY NAME if an anchor is removed, renamed or duplicated there.
//
// Wave 8 lane 8C adds ONE step, on an anchor in its own file: `first-run`, the first-run
// screen's actions (ResearchHome), which is what a member with no notes actually sees.
//
// ⛔ The copy is lane 8C's and lives in `tourCopy.js`, keyed by step id (a step here is
// exactly {id, anchor, file} -- tourAnchors.test.js holds it to that). A step whose
// anchor is not on screen is skipped by the tour, never shown pointing at nothing — the
// editor's anchors exist only while a note is open, the list-view ones only off the home
// screen.
const step = (id, anchor, file) => Object.freeze({ id, anchor, file })

export const TOUR_STEPS = Object.freeze([
  step('first-run', 'first-run', 'components/notebook/ResearchHome.jsx'),
  step('sidebar', 'sidebar', 'components/notebook/FolderSidebar.jsx'),
  step('search', 'search', 'components/notebook/FolderSidebar.jsx'),
  step('new-note', 'new-note', 'tabs/NotebookTab.jsx'),
  step('view-switcher', 'view-switcher', 'tabs/NotebookTab.jsx'),
  step('import', 'import', 'tabs/NotebookTab.jsx'),
  step('ask', 'ask-row', 'components/notebook/NoteEditorPage.jsx'),
  step('export', 'note-export', 'components/notebook/NoteEditorPage.jsx'),
])
