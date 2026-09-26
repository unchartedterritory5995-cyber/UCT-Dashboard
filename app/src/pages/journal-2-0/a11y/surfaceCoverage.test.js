// app/src/pages/journal-2-0/a11y/surfaceCoverage.test.js
//
// A1's coverage rail. "Every Notebook surface has zero axe violations" means
// nothing unless "every surface" is a list nobody typed. This DERIVES the
// population by reading the directories (the plan's own method, dispatch plan
// §1.1): the top-level components/notebook/*.jsx files, tabs/NotebookTab.jsx,
// the three Notebook Settings cards, and the export/ and import/ subfolders —
// never *.test.jsx. Then it holds `notebookSurfaces.js` to that list:
//   · a file in the population with no entry fails BY NAME;
//   · an entry naming a file that no longer exists fails BY NAME;
//   · each entry is exactly one of recipe / coveredBy / OTHER_LANES / exempt;
//   · every recipe or coveredBy id is registered by an axe rail in this
//     directory (`axeSurface('<id>'` …), so a manifest line cannot point at a
//     rail that does not exist.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { SURFACES, OTHER_LANES_OUTSIDE_POPULATION } from './notebookSurfaces'
import { derivePopulation, J2_DIR } from './population'

const J2 = J2_DIR
const A11Y = join(J2, 'a11y')
const KINDS = ['recipe', 'coveredBy', 'OTHER_LANES', 'exempt']

/** Every surface id an axe rail in this directory registers: a string literal
 *  (quoted or the head of a template) that is a registered `axeSurface` id or
 *  sits in a table an `axeSurface(id, …)` loop reads. The id must be followed by
 *  its closing quote, or by `${` for a flag-variant template. */
function railSources() {
  return readdirSync(A11Y)
    .filter((f) => f.endsWith('.a11y.test.jsx'))
    .map((f) => ({ file: f, text: readFileSync(join(A11Y, f), 'utf8') }))
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function registered(id, sources) {
  const re = new RegExp(`['\`]${esc(id)}(?:['\`]|\\$\\{)`)
  return sources.some(({ text }) => re.test(text) && /axeSurface\(/.test(text))
}

describe('the population is derived, and non-vacuous', () => {
  const pop = derivePopulation()

  it('contains the two files the plan names (a directory read that returned nothing would pass every check below)', () => {
    expect(pop).toContain('components/notebook/NoteEditorPage.jsx')
    expect(pop).toContain('components/notebook/NoteGraphView.jsx')
    expect(pop).toContain('components/notebook/export/ExportDialog.jsx')
    expect(pop).toContain('components/notebook/import/ImportWizard.jsx')
  })

  it('never includes a test file', () => {
    expect(pop.filter((f) => /\.test\.jsx$/.test(f))).toEqual([])
  })
})

describe('the manifest covers exactly the population', () => {
  const pop = derivePopulation()

  it('every file in the population has an entry (a new component fails here, by name)', () => {
    const missing = pop.filter((f) => !Object.hasOwn(SURFACES, f))
    expect(missing, `add these to a11y/notebookSurfaces.js: ${missing.join(', ')}`).toEqual([])
  })

  it('every entry names a file that exists (a deleted or renamed component fails here, by name)', () => {
    const gone = Object.keys(SURFACES).filter((f) => !existsSync(join(J2, f)))
    expect(gone, `remove or rename these manifest entries: ${gone.join(', ')}`).toEqual([])
  })

  it('every entry is in the population (no stray path that the walk would never see)', () => {
    const stray = Object.keys(SURFACES).filter((f) => !pop.includes(f))
    expect(stray).toEqual([])
  })

  it('each entry is exactly ONE of recipe / coveredBy / OTHER_LANES / exempt', () => {
    const bad = Object.entries(SURFACES)
      .filter(([, v]) => Object.keys(v).filter((k) => KINDS.includes(k)).length !== 1 || Object.keys(v).length !== 1)
      .map(([f]) => f)
    expect(bad).toEqual([])
  })
})

describe('each entry points at something real', () => {
  const sources = railSources()

  it('the rail files were found (non-vacuity: this directory holds the notebook-tab rail)', () => {
    expect(sources.map((s) => s.file)).toContain('notebookTab.a11y.test.jsx')
  })

  it('every recipe and coveredBy id is registered by an axe rail in a11y/', () => {
    const unregistered = Object.entries(SURFACES)
      .flatMap(([f, v]) => (v.recipe || v.coveredBy ? [[f, v.recipe || v.coveredBy]] : []))
      .filter(([, id]) => !registered(id, sources))
      .map(([f, id]) => `${f} -> ${id}`)
    expect(unregistered).toEqual([])
  })

  it('the registration check can fail (control: an id no rail registers)', () => {
    expect(registered('no-such-surface-xyz', sources)).toBe(false)
    expect(registered('tab-list', sources)).toBe(true)
  })

  it('an exemption carries a real reason', () => {
    for (const [f, v] of Object.entries(SURFACES)) {
      if ('exempt' in v) expect(String(v.exempt).length, f).toBeGreaterThan(20)
    }
  })

  it('OTHER_LANES names a lane that owns files this wave and a rail file path', () => {
    const all = { ...Object.fromEntries(Object.entries(SURFACES).filter(([, v]) => v.OTHER_LANES).map(([f, v]) => [f, v.OTHER_LANES])), ...OTHER_LANES_OUTSIDE_POPULATION }
    for (const [f, o] of Object.entries(all)) {
      expect(['8B', '8C'], f).toContain(o.lane)
      expect(o.railFile, f).toMatch(/\.test\.jsx$/)
      // A rail file in 8A's own directory must already exist; another lane's
      // is theirs to create, and the controller checks it before the gate.
      if (o.railFile.startsWith('a11y/')) expect(existsSync(join(J2, o.railFile)), o.railFile).toBe(true)
      expect(existsSync(join(J2, f)), f).toBe(true)
    }
  })
})
