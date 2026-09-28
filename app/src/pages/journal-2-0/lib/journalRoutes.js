/**
 * Wave 10 lane D2, fix round 1 (review M-5): the Journal's Notebook route, ONE
 * authority. The Journal's section nav (desktop PRIMARY_NAV and the phone
 * JournalMobileNav) links to NOTEBOOK_PATH, and the phone's compact header
 * (lib/compactHeaderRoute.js) folds on it.
 * ⛔ App.jsx keeps its two Notebook routes as LITERAL strings ("notebook",
 * "notebook/research/:symbol") -- fix round 2: rails that derive the route list from
 * App.jsx (surfaces/manifest.test.js, pages/Support.notebook.test.jsx) read path
 * literals, and a constant there blinded them. The tie runs the other way: the rail
 * asserts App.jsx's literals EQUAL these constants, so neither side can drift alone.
 * Rail: JournalLayout.compactHeader.test.jsx ("one authority for the Notebook route").
 */
export const JOURNAL_BASE = '/journal'
export const NOTEBOOK_SEGMENT = 'notebook'
export const NOTEBOOK_RESEARCH_SEGMENT = `${NOTEBOOK_SEGMENT}/research/:symbol`
export const NOTEBOOK_PATH = `${JOURNAL_BASE}/${NOTEBOOK_SEGMENT}`
