// app/src/pages/journal-2-0/a11y/population.js
//
// The Notebook's surface POPULATION, derived by reading the directories — never
// typed (wave 8, lane 8A; the plan's own method, dispatch plan §1.1). Shared by
// the coverage rail (A1) and the aria census (A2), so the two can never count
// different sets. Test support only: nothing in the app imports this.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

export const J2_DIR = join(process.cwd(), 'src', 'pages', 'journal-2-0')

const jsxIn = (rel) => readdirSync(join(J2_DIR, rel))
  .filter((f) => f.endsWith('.jsx') && !f.endsWith('.test.jsx'))
  .map((f) => (rel ? `${rel}/${f}` : f))

/** Top-level components/notebook/*.jsx, the export/ and import/ subfolders,
 *  components/notebook/blocks/ (Notebook P2 trader blocks), components/notebook/routines/ (the routine and
 *  tracker editors, wave 9), components/notebook/myTools/ (My tools: the Widgets, Routines and Trackers tabs, wave 9
 *  Task 9.18 fix 1; until then a new myTools file could ship unrailed), components/notebook/widgetBuilder/ and its
 *  sections/ (the widget builder, wave 9 Task 9.17 fix 1),
 *  tabs/NotebookTab.jsx and the three Notebook Settings cards; never a test. */
export function derivePopulation() {
  return [
    ...jsxIn('components/notebook'),
    ...jsxIn('components/notebook/export'),
    ...jsxIn('components/notebook/import'),
    ...jsxIn('components/notebook/blocks'),
    ...jsxIn('components/notebook/routines'),
    ...jsxIn('components/notebook/myTools'),
    // Wave 9 Task 9.17 fix 1 (ruling W9-R50): the widget builder and its sections, so a new builder file cannot ship
    // unrailed (until then no axe rail had covered any builder level).
    ...jsxIn('components/notebook/widgetBuilder'),
    ...jsxIn('components/notebook/widgetBuilder/sections'),
    'tabs/NotebookTab.jsx',
    'components/PersonalApiCard.jsx',
    'components/InboundEmailCard.jsx',
    'components/BrowserCaptureCard.jsx',
  ].sort()
}
