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
  'components/notebook/GettingStartedChecklist.jsx':
    'the eager gate: renders the lazy GettingStartedList (a named section) or null; no markup or control of its own',
  'components/notebook/CaptureHost.jsx':
    'mounts CaptureDialog (itself a named dialog) and a global key listener; no markup of its own',
  'components/notebook/NoteStats.jsx':
    'one line of plain text (word count, reading time) read as text; deliberately NOT a live region, which would talk over typing',
  'components/notebook/TranscriptDoors.jsx':
    'a native <button> named by its visible text ("Save from a transcript") plus a host that mounts SaveTranscriptPassage (itself a named dialog); no markup that needs aria',
  // Notebook P2a stub bodies: one line of text inside BlockNodeView's named group. Each body task
  // REPLACES its stub, and the "every exemption still applies" case below then makes it delete its row.
  'components/notebook/blocks/PriceStampsBlock.jsx':
    'a stub body: one line of text (BlockEmpty) inside BlockNodeView\'s named group; replaced by its own task',
  'components/notebook/blocks/PositionSizingBlock.jsx':
    'a stub body: one line of text (BlockEmpty) inside BlockNodeView\'s named group; replaced by its own task',
})

/** Another lane's file in the population. Classified, but its staleness is the
 *  owner's: when that lane adds aria to it, the entry stops applying and is
 *  deleted. Empty: 8C's NoteExportControls.jsx became the Export menu, with
 *  its own roles and names, so it is held to the census like every other file. */
export const OTHER_LANE_EXEMPT = Object.freeze({})

/** The stub sentence every P2a stub body renders (blocks/*Block.jsx until its task replaces it). */
export const STUB_SENTENCE = 'This block is being built.'

/** Rows whose reason says "a stub body" but whose file no longer renders the stub sentence (comments
 *  stripped first: the sentence in a comment is not the stub). */
export function staleStubExemptions(exempt, read) {
  return Object.entries(exempt)
    .filter(([, why]) => why.startsWith('a stub body'))
    .filter(([f]) => !read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').includes(STUB_SENTENCE))
    .map(([f]) => f)
}

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

  // Fix round 1 (R-T6-1, departure 5): "still has no aria" is not the claim a stub row makes. A real
  // body built from <label>/<input>/named buttons may carry no aria token either, so the case above
  // would keep its row green with a false reason. Pin the claim itself: the stub sentence.
  it('every "a stub body" exemption names a file that is STILL the stub', () => {
    const stubRows = Object.keys(EXEMPT).filter((f) => EXEMPT[f].startsWith('a stub body'))
    expect(stubRows.length).toBeGreaterThan(0)                                  // non-vacuity
    expect(staleStubExemptions(EXEMPT, (f) => readFileSync(join(J2_DIR, f), 'utf8'))).toEqual([])
  })

  it('CONTROL: a real body that kept its stub row is caught; the stub itself is not', () => {
    const rows = { 'x/Body.jsx': 'a stub body: one line of text, replaced by its own task', 'x/Other.jsx': 'renders its children or null' }
    const real = () => 'export default function Body() { return <form><label>Setup<input /></label></form> }'
    const stub = () => 'export default function Body() { return <BlockEmpty title="This block is being built." /> }'
    expect(staleStubExemptions(rows, real)).toEqual(['x/Body.jsx'])
    expect(staleStubExemptions(rows, stub)).toEqual([])
    // the sentence inside a COMMENT is not the stub
    expect(staleStubExemptions(rows, () => '// "This block is being built."\nexport default () => <form />')).toEqual(['x/Body.jsx'])
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
