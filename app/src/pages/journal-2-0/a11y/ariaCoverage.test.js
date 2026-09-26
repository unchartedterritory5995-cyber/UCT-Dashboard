// app/src/pages/journal-2-0/a11y/ariaCoverage.test.js
//
// A2's census rail. The plan's "24 of 58 components carry no aria" was a count
// produced by a METHOD (dispatch plan §1.1): a file in the Notebook's surface
// population with no `aria-` token and no `role=` token. This re-derives that
// list on every run, over the same population the coverage rail uses
// (population.js), and requires every file it finds to be CLASSIFIED — listed
// in EXEMPT with a one-line reason. A new component with no aria that is
// neither fixed nor exempt fails here, BY NAME.
//
// Measured with this method: a5668a8a8 (the plan's commit) 25 of 86; the lane's
// start 09220eedf 26 of 88 (NoteExportControls arrived with seam S8-3); after
// lane 8A's A2 fixes, 4 — all four exempt below, 0 unclassified.
//
// ⚠️ It is a grep over source, not an audit: a token proves a file SAYS
// something to assistive technology, not that it says the right thing. The axe
// rails (a11y/*.a11y.test.jsx) and the owner's screen-reader pass are what judge
// the words.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { derivePopulation, J2_DIR } from './population'

const TOKEN = /aria-|role=/

/** Files that render nothing an assistive technology needs named. One reason
 *  each — the reason is the audit record. */
export const EXEMPT = Object.freeze({
  'components/notebook/NotebookFlagGate.jsx':
    'renders its children or null; no markup or control of its own',
  'components/notebook/CaptureHost.jsx':
    'mounts CaptureDialog (itself a named dialog) and a global key listener; no markup of its own',
  'components/notebook/NoteStats.jsx':
    'one line of plain text (word count, reading time) read as text; deliberately NOT a live region, which would talk over typing',
})

/** Another lane's file in the population. Classified, but its staleness is the
 *  owner's: when 8C adds aria to it, this entry simply stops applying. */
export const OTHER_LANE_EXEMPT = Object.freeze({
  'components/notebook/NoteExportControls.jsx':
    'lane 8C (seam S8-3): three buttons whose visible text is their name; axe-clean inside the editor (recipe "editor"); 8C rebuilds it into an Export menu and owns its aria',
})

export function deriveNoAriaFiles() {
  return derivePopulation().filter((f) => !TOKEN.test(readFileSync(join(J2_DIR, f), 'utf8')))
}

describe('the aria census is derived and fully classified', () => {
  const noAria = deriveNoAriaFiles()

  it('non-vacuity: the derivation finds a file that truly has none (NotebookFlagGate)', () => {
    expect(noAria).toContain('components/notebook/NotebookFlagGate.jsx')
  })

  it('the token test can tell the two apart (control over a real file WITH aria)', () => {
    expect(TOKEN.test(readFileSync(join(J2_DIR, 'components/notebook/FolderSidebar.jsx'), 'utf8'))).toBe(true)
  })

  it('0 unclassified: every file with no aria is exempt with a reason (a new one fails here, by name)', () => {
    const unclassified = noAria.filter((f) => !Object.hasOwn(EXEMPT, f) && !Object.hasOwn(OTHER_LANE_EXEMPT, f))
    expect(unclassified, `fix (give it the role/name it needs) or add to EXEMPT with a reason: ${unclassified.join(', ')}`).toEqual([])
  })

  it('every 8A exemption still applies (a file that gained aria leaves the table)', () => {
    const stale = Object.keys(EXEMPT).filter((f) => !noAria.includes(f))
    expect(stale).toEqual([])
  })

  it('each reason is a real sentence', () => {
    for (const [f, why] of Object.entries({ ...EXEMPT, ...OTHER_LANE_EXEMPT })) {
      expect(why.length, f).toBeGreaterThan(30)
    }
  })

  it('the files the plan named as interactive are no longer in the census (fixed, not exempted)', () => {
    for (const f of ['DocumentPreviewSheet', 'LinkedNotesPanel', 'NoteBacklinksSection', 'NoteLinkView',
      'NoteVideoHero', 'SavedViewEditor', 'ShareTargetPage', 'TemplatePicker']) {
      expect(noAria, f).not.toContain(`components/notebook/${f}.jsx`)
    }
  })

  it('every embed renderer and FrozenList carries a role (a named figure or list)', () => {
    const embeds = derivePopulation().filter((f) => /Embed\.jsx$|FrozenList\.jsx$/.test(f))
    expect(embeds.length).toBeGreaterThanOrEqual(13)
    for (const f of embeds) expect(noAria, f).not.toContain(f)
  })
})
