// @vitest-environment node
/**
 * ⛔ NO NOTEBOOK COMPONENT IS DECLARED INSIDE ANOTHER COMPONENT.
 *
 * Wave 10 lane 10A (clause 4d, typing cost). A component declared inside a component's body
 * is a NEW type on every render of its parent, so React unmounts and re-mounts its whole
 * subtree each time instead of updating it. `ToolButton` inside NoteEditorPage did exactly
 * that to the editor toolbar on every keystroke -- ~12.6 buttons and their SVG icons rebuilt
 * per key at 2,000 paragraphs, the largest self-time entries of a traced keystroke
 * (docs/notebook/perf-budgets.md §7). The behaviour is railed where a member sees it
 * (NoteEditorPage.toolbarIdentity.test.jsx); this rail keeps the SHAPE from coming back
 * anywhere in the Notebook.
 *
 * The rule: a PascalCase function that returns JSX, whose nearest NAMED enclosing function is
 * itself PascalCase (a component). A PascalCase component built by a lowercase FACTORY
 * (`lazyView`, `makeTourGate`) is called once at module scope and is not a render-time type.
 *
 * ⛔ AN AST, NEVER A REGEX; the file set is WALKED, never typed.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const HERE = dirname(fileURLToPath(import.meta.url))
const NOTEBOOK = join(HERE, '..')                      // app/src/pages/journal-2-0
const JsxParser = Parser.extend(jsx())

function sourceFiles(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) sourceFiles(full, acc)
    else if (/\.jsx$/.test(e.name) && !/\.test\.jsx$/.test(e.name)) acc.push(full)
  }
  return acc
}

const isFn = (n) => !!n && /Function/.test(n.type)
const isPascal = (s) => typeof s === 'string' && /^[A-Z]/.test(s)

function* walk(node, ancestors = []) {
  if (!node || typeof node.type !== 'string') return
  yield [node, ancestors]
  for (const key of Object.keys(node)) {
    if (key === 'loc') continue
    const v = node[key]
    if (Array.isArray(v)) { for (const c of v) yield* walk(c, [...ancestors, node]) }
    else if (v && typeof v.type === 'string') yield* walk(v, [...ancestors, node])
  }
}

const containsJsx = (node) => {
  for (const [n] of walk(node)) if (n.type === 'JSXElement' || n.type === 'JSXFragment') return true
  return false
}

/** The name a function is known by: its own id, or the variable it initialises. */
function fnName(fn, parent) {
  if (fn.id && fn.id.name) return fn.id.name
  if (parent && parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name
  return null
}

/** Every component declared inside a component in `src`, as `Name:line (inside Outer)`. */
function nestedComponents(src) {
  const ast = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const out = []
  for (const [node, anc] of walk(ast)) {
    if (!isFn(node)) continue
    const name = fnName(node, anc[anc.length - 1])
    if (!isPascal(name) || !containsJsx(node.body)) continue
    // the nearest NAMED enclosing function
    let outer = null
    for (let i = anc.length - 1; i >= 0; i -= 1) {
      if (isFn(anc[i])) {
        const nm = fnName(anc[i], anc[i - 1])
        if (nm) { outer = nm; break }
      }
    }
    if (isPascal(outer)) out.push(`${name}:${node.loc.start.line} (inside ${outer})`)
  }
  return out
}

describe('no Notebook component is declared inside another component (wave 10, lane 10A)', () => {
  it('the detector sees the defect it names, and not the factory shape', () => {
    // CONTROL: the exact shape that re-mounted the toolbar on every keystroke
    expect(nestedComponents(`
      export default function Page() {
        const ToolButton = ({ label }) => <button>{label}</button>
        return <ToolButton label="B" />
      }`)).toEqual(['ToolButton:3 (inside Page)'])
    expect(nestedComponents(`
      function Outer() { function Inner() { return <i /> } return <Inner /> }`)).toEqual(['Inner:2 (inside Outer)'])
    // a lowercase factory building a component once, at module scope, is not the defect
    expect(nestedComponents(`
      function lazyView(load) { function LazyView(p) { return <div {...p} /> } return LazyView }`)).toEqual([])
    // a lowercase render helper inside a component returns elements, not a type
    expect(nestedComponents(`
      function Page() { const row = (x) => <li>{x}</li>; return <ul>{[1].map(row)}</ul> }`)).toEqual([])
  })

  it('holds for every Notebook .jsx file', () => {
    const files = sourceFiles(NOTEBOOK)
    expect(files.length).toBeGreaterThan(50)                       // non-vacuity: the walk found the tree
    expect(files.some((f) => f.endsWith('NoteEditorPage.jsx'))).toBe(true)
    const hits = []
    for (const f of files) {
      for (const h of nestedComponents(readFileSync(f, 'utf8'))) hits.push(`${relative(NOTEBOOK, f)} ${h}`)
    }
    expect(hits).toEqual([])
  })
})
