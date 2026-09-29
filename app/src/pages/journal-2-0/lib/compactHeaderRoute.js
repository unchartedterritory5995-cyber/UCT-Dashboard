/**
 * Wave 10 lane D2 (design finding D-1): the routes whose Journal header folds on a
 * phone. Measured at 390 px on fa6710394, the Journal took 257 px below the app's
 * top bar before the Notebook began (the title row, then the action cluster
 * wrapped onto two rows, then the section strip), and a note's title sat 1,530 px
 * down. On these routes, and only at <=640 px (CSS decides the width; this decides
 * the route), the header shows Log Trade and one "Journal tools" toggle; the rest
 * of the cluster is one tap away and works exactly as before when open. The
 * section strip is NOT folded: every Journal tab stays one tap away.
 *
 * Fix round 1 (M-5):
 * - The route is NOTEBOOK_PATH (lib/journalRoutes.js), the constant App.jsx and the
 *   section nav use -- never a restated literal.
 * - Matched the way React Router matches it: case-insensitively, on whole path
 *   segments (`/journal/notebookx` is not the Notebook).
 * - RULING: the Ticker Research page (`/journal/notebook/research/:symbol`) folds
 *   too. It is inside the Notebook -- the Notebook tab stays lit there -- so every
 *   route under NOTEBOOK_PATH folds.
 */
import { matchPath } from 'react-router-dom'
import { NOTEBOOK_PATH } from './journalRoutes'

export function isCompactHeaderRoute(pathname) {
  return matchPath({ path: NOTEBOOK_PATH, caseSensitive: false, end: false }, pathname || '') !== null
}
