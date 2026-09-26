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
 *  tabs/NotebookTab.jsx and the three Notebook Settings cards; never a test. */
export function derivePopulation() {
  return [
    ...jsxIn('components/notebook'),
    ...jsxIn('components/notebook/export'),
    ...jsxIn('components/notebook/import'),
    'tabs/NotebookTab.jsx',
    'components/PersonalApiCard.jsx',
    'components/InboundEmailCard.jsx',
    'components/BrowserCaptureCard.jsx',
  ].sort()
}
