/**
 * Wave 10 lane D2, fix round 1 (review M-5): the Journal's Notebook route, ONE
 * authority. App.jsx declares the nested routes from these segments, the Journal's
 * section nav (desktop PRIMARY_NAV and the phone JournalMobileNav) links to
 * NOTEBOOK_PATH, and the phone's compact header (lib/compactHeaderRoute.js) folds
 * on it. A rename here moves all of them together.
 * Rail: JournalLayout.compactHeader.test.jsx ("one authority for the Notebook route").
 */
export const JOURNAL_BASE = '/journal'
export const NOTEBOOK_SEGMENT = 'notebook'
export const NOTEBOOK_RESEARCH_SEGMENT = `${NOTEBOOK_SEGMENT}/research/:symbol`
export const NOTEBOOK_PATH = `${JOURNAL_BASE}/${NOTEBOOK_SEGMENT}`
