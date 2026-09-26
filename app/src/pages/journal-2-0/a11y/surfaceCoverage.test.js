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
//
// ⛔ Wave 8 final review M-12: "registered" means the FIRST ARGUMENT of an
// `axeSurface(` call, read from the parse tree (acorn + acorn-jsx, the tree's
// parser). It used to accept the id as ANY quoted literal anywhere in a rail file
// that called `axeSurface(` -- so a generic id such as `editor` could be
// "registered" by an unrelated string (a label, a test name). The first argument
// is resolved in three forms: a string literal; a template whose head is the id
// (`editor${flagsOn ? '' : ':flags-off'}` registers `editor`); and a loop
// variable bound by `for (const [id, …] of TABLE)` over a module-level array of
// arrays, or `for (const id of IDS)` over an array of strings. Anything else is
// UNRESOLVED and fails by name -- it is never quietly accepted.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { SURFACES, OTHER_LANES_OUTSIDE_POPULATION } from './notebookSurfaces'
import { derivePopulation, J2_DIR } from './population'

const J2 = J2_DIR
const A11Y = join(J2, 'a11y')
const KINDS = ['recipe', 'coveredBy', 'OTHER_LANES', 'exempt']

function railSources() {
  return readdirSync(A11Y)
    .filter((f) => f.endsWith('.a11y.test.jsx'))
    .map((f) => ({ file: f, text: readFileSync(join(A11Y, f), 'utf8') }))
}

const JsxParser = Parser.extend(jsx())
const isStr = (n) => n?.type === 'Literal' && typeof n.value === 'string'

/** The ids `text` registers: the first argument of every `axeSurface(` call, and
 *  the calls whose first argument could not be resolved (`file:line`). */
export function registeredIds(text, file = '<source>') {
  const tree = JsxParser.parse(text, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  // module-level `const NAME = [ ... ]`
  const arrays = new Map()
  for (const n of tree.body) {
    if (n.type !== 'VariableDeclaration') continue
    for (const d of n.declarations) {
      if (d.id?.type === 'Identifier' && d.init?.type === 'ArrayExpression') arrays.set(d.id.name, d.init)
    }
  }
  const ids = new Set()
  const unresolved = []
  const fromLoop = (name, stack) => {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const loop = stack[i]
      if (loop.type !== 'ForOfStatement' || loop.left?.type !== 'VariableDeclaration') continue
      const bind = loop.left.declarations[0]?.id
      const table = loop.right?.type === 'Identifier' ? arrays.get(loop.right.name) : null
      if (bind?.type === 'Identifier' && bind.name === name) {
        if (!table || !table.elements.every(isStr)) return null
        return table.elements.map((e) => e.value)
      }
      if (bind?.type === 'ArrayPattern' && bind.elements[0]?.type === 'Identifier' && bind.elements[0].name === name) {
        if (!table || !table.elements.every((e) => e?.type === 'ArrayExpression' && isStr(e.elements[0]))) return null
        return table.elements.map((e) => e.elements[0].value)
      }
    }
    return null
  }
  const walk = (n, stack) => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'CallExpression' && n.callee?.type === 'Identifier' && n.callee.name === 'axeSurface') {
      const a = n.arguments[0]
      let got = null
      if (isStr(a)) got = [a.value]
      else if (a?.type === 'TemplateLiteral' && a.quasis[0]?.value.cooked) got = [a.quasis[0].value.cooked]
      else if (a?.type === 'Identifier') got = fromLoop(a.name, stack)
      if (got) got.forEach((id) => ids.add(id))
      else unresolved.push(`${file}:${n.loc.start.line}`)
    }
    const next = n.type === 'ForOfStatement' ? [...stack, n] : stack
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach((c) => walk(c, next))
      else if (v && typeof v.type === 'string') walk(v, next)
    }
  }
  walk(tree, [])
  return { ids, unresolved }
}

function registry(sources) {
  const ids = new Set()
  const unresolved = []
  for (const { file, text } of sources) {
    const r = registeredIds(text, file)
    r.ids.forEach((id) => ids.add(id))
    unresolved.push(...r.unresolved)
  }
  return { ids, unresolved }
}
function registered(id, sources) {
  return registry(sources).ids.has(id)
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

  it('every axeSurface call in a11y/ names its id in a form the parser resolves (M-12)', () => {
    const { ids, unresolved } = registry(sources)
    expect(unresolved, 'an axeSurface id the rail cannot read is never quietly accepted').toEqual([])
    // non-vacuity: all three forms are in use and were read
    expect(ids.has('editor-slash')).toBe(true)          // a string literal
    expect(ids.has('editor')).toBe(true)                // the head of a flag-variant template
    expect(ids.has('embed-chart')).toBe(true)           // a loop over a table of rows
  })

  it('CONTROLS (M-12): only the FIRST argument of axeSurface( registers an id', () => {
    const src = [
      "const ROWS = [['row-a', 1], ['row-b', 2]]",
      "const NAMES = ['name-a']",
      "axeSurface('lit-a', async () => { expect(x).toBe('stray-in-body') })",
      'axeSurface(`tpl-a${on ? "" : ":off"}`, f)',
      'for (const [id] of ROWS) axeSurface(id, f)',
      'for (const n of NAMES) axeSurface(n, f)',
      "it('stray-in-a-test-name', () => {})",
      "const label = 'stray-const'",
    ].join('\n')
    const { ids, unresolved } = registeredIds(src)
    expect([...ids].sort()).toEqual(['lit-a', 'name-a', 'row-a', 'row-b', 'tpl-a'])
    expect(unresolved).toEqual([])
    // the old matcher's false positives: a literal elsewhere in a file that calls axeSurface(
    for (const stray of ['stray-in-body', 'stray-in-a-test-name', 'stray-const']) expect(ids.has(stray)).toBe(false)
    // an id the parser cannot resolve is reported, not accepted
    expect(registeredIds('axeSurface(makeId(), f)', 'x.jsx').unresolved).toEqual(['x.jsx:1'])
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
