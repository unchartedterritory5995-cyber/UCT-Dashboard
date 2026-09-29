// TERM-052 (FB-S6-01) — the personalization publications are DERIVED from the code that governs
// them, and this rail is what makes that a fact rather than a comment.
//
// FB-S6-01's own acceptance test: "Changing a density constant changes the published ceiling with
// no content edit; changing an object's autosave behaviour changes the published list; and a rail
// fails if any of the three cannot be resolved to a source, printing `unreadable` rather than a
// default." So this file proves, by AST over the real sources (never a grep — comments quote these
// names as prose):
//
//   1. every published ceiling's `value` is an identifier IMPORTED from its declared source file —
//      a typed number, even the right one, goes red;
//   2. that source file declares the constant as a number, and the published value equals it;
//   3. the named consumer imports the same constant and actually uses it — a constant nobody
//      applies is a number about nothing;
//   4. `ChartsWorkspace.jsx` gates its auto-save on `layoutAutoSaves`, the same function the card
//      asks — so the published list and the behaviour cannot drift apart;
//   5. every layout scope the workspace writes has a kind here, so a new scope cannot slip past
//      the publication unnamed.
//
// Each has a planted-drift control (move the source, the publication moves) and a non-vacuity
// control (the thing being compared is not empty).
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import {
  CEILINGS, LAYOUT_KINDS, densityCeilings, ceilingDisplay, layoutAutosaveMatrix,
} from './personalization'
import { layoutAutoSaves, UCT_DEFAULT_ID } from '../../pages/charts/layoutDockPins'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../../..')
const JsxParser = Parser.extend(jsx())

const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8')
const parse = (rel) => JsxParser.parse(read(rel), { ecmaVersion: 'latest', sourceType: 'module', locations: true })

function walk(node, fn, parent = null) {
  if (!node || typeof node.type !== 'string') return
  fn(node, parent)
  for (const k of Object.keys(node)) {
    if (k === 'loc') continue
    const v = node[k]
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, fn, node))
    else if (v && typeof v.type === 'string') walk(v, fn, node)
  }
}

/** Resolve an import specifier written in `fromRel` to a repo-relative path, or null. */
function resolveSpec(fromRel, spec) {
  if (!spec.startsWith('.')) return null
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec))
  for (const cand of [base, `${base}.js`, `${base}.jsx`, `${base}/index.js`]) {
    if (existsSync(path.join(REPO, cand))) return cand
  }
  return null
}

/** local name -> { imported, from } for every named import in a file. */
function importsOf(rel) {
  const out = new Map()
  for (const node of parse(rel).body) {
    if (node.type !== 'ImportDeclaration') continue
    const from = resolveSpec(rel, node.source.value)
    for (const s of node.specifiers) {
      if (s.type === 'ImportSpecifier') out.set(s.local.name, { imported: s.imported.name, from })
    }
  }
  return out
}

/** The numeric literal a file exports under `name`, or 'unreadable'. */
function exportedNumber(rel, name) {
  let found = 'unreadable'
  for (const node of parse(rel).body) {
    if (node.type !== 'ExportNamedDeclaration' || node.declaration?.type !== 'VariableDeclaration') continue
    for (const d of node.declaration.declarations) {
      if (d.id.name === name && d.init?.type === 'Literal' && typeof d.init.value === 'number') found = d.init.value
    }
  }
  return found
}

/** The CEILINGS array's element nodes, parsed from personalization.js itself. */
function ceilingNodes() {
  let arr = null
  walk(parse('app/src/lib/persistence/personalization.js'), (n) => {
    if (n.type === 'VariableDeclarator' && n.id.name === 'CEILINGS') arr = n.init
  })
  return arr?.elements || []
}
const prop = (obj, key) => obj.properties.find((p) => p.key?.name === key)?.value

describe('density ceilings are the constants the enforcing code applies', () => {
  it('CONTROL: there are ceilings to check, and the AST sees every one of them', () => {
    expect(CEILINGS.length).toBeGreaterThanOrEqual(3)
    expect(ceilingNodes().length).toBe(CEILINGS.length)
  })

  it('every value is an identifier imported from its own source file — never a typed number', () => {
    const imports = importsOf('app/src/lib/persistence/personalization.js')
    const problems = []
    ceilingNodes().forEach((node, i) => {
      const c = CEILINGS[i]
      const v = prop(node, 'value')
      if (v?.type !== 'Identifier') { problems.push(`${c.id}: value is a ${v?.type} — unreadable as a source`); return }
      const imp = imports.get(v.name)
      if (!imp) { problems.push(`${c.id}: ${v.name} is not imported — unreadable`); return }
      if (imp.from !== c.source.file) problems.push(`${c.id}: ${v.name} comes from ${imp.from}, source says ${c.source.file}`)
      if (imp.imported !== c.source.name) problems.push(`${c.id}: imports ${imp.imported}, source says ${c.source.name}`)
    })
    expect(problems).toEqual([])
  })

  it('each source declares its constant as a number, and the published value is that number', () => {
    const got = CEILINGS.map((c) => [c.id, exportedNumber(c.source.file, c.source.name), c.value])
    for (const [id, declared, published] of got) {
      expect(declared, `${id}: source constant`).not.toBe('unreadable')
      expect(published, id).toBe(declared)
    }
  })

  it('each consumer imports the same constant and uses it beyond the import', () => {
    const problems = []
    for (const c of CEILINGS) {
      const imp = [...importsOf(c.consumer).entries()]
        .find(([, v]) => v.imported === c.source.name && v.from === c.source.file)
      if (!imp) { problems.push(`${c.consumer} does not import ${c.source.name} from ${c.source.file}`); continue }
      let uses = 0
      walk(parse(c.consumer), (n, parent) => {
        if (n.type === 'Identifier' && n.name === imp[0] && parent?.type !== 'ImportSpecifier') uses += 1
      })
      if (uses === 0) problems.push(`${c.consumer} imports ${imp[0]} and never uses it`)
    }
    expect(problems).toEqual([])
  })

  it('PLANTED DRIFT: moving a ceiling moves its published number, and a lost one reads `unreadable`', () => {
    const moved = CEILINGS.map((c) => (c.id === 'multichart-grid' ? { ...c, value: c.value + 7 } : c))
    const lost = CEILINGS.map((c) => (c.id === 'chart-comparisons' ? { ...c, value: undefined } : c))
    const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r.display]))
    expect(byId(densityCeilings(moved))['multichart-grid']).toBe(String(CEILINGS[0].value + 7))
    expect(byId(densityCeilings(lost))['chart-comparisons']).toBe('unreadable')
    expect(densityCeilings().every((r) => r.display !== 'unreadable')).toBe(true)
    for (const bad of [0, -3, 2.5, NaN, null, '16']) expect(ceilingDisplay(bad)).toBe('unreadable')
  })
})

describe('the layouts that save themselves are the workspace rule\'s own answer', () => {
  it('CONTROL: under the real rule both lists are non-empty and nothing is unreadable', () => {
    const m = layoutAutosaveMatrix()
    expect(m.autosaves.length).toBeGreaterThan(0)
    expect(m.manual.length).toBeGreaterThan(0)
    expect(m.unreadable).toEqual([])
    expect(m.autosaves.length + m.manual.length).toBe(LAYOUT_KINDS.length)
  })

  it('each kind lands where layoutAutoSaves puts it', () => {
    const m = layoutAutosaveMatrix()
    for (const k of LAYOUT_KINDS) {
      const list = layoutAutoSaves(k.probe) ? m.autosaves : m.manual
      expect(list.map((r) => r.id)).toContain(k.id)
    }
  })

  it('PLANTED DRIFT: a different rule moves the lists; an unanswerable one lands in unreadable', () => {
    expect(layoutAutosaveMatrix(() => true).manual).toEqual([])
    expect(layoutAutosaveMatrix(() => false).autosaves).toEqual([])
    expect(layoutAutosaveMatrix(() => undefined).unreadable.length).toBe(LAYOUT_KINDS.length)
    expect(layoutAutosaveMatrix(() => { throw new Error('x') }).unreadable.length).toBe(LAYOUT_KINDS.length)
  })

  it('ChartsWorkspace gates its auto-save on layoutAutoSaves, imported from layoutDockPins', () => {
    const rel = 'app/src/pages/charts/ChartsWorkspace.jsx'
    const imp = importsOf(rel).get('layoutAutoSaves')
    expect(imp?.from).toBe('app/src/pages/charts/layoutDockPins.js')
    let gate = null
    let okUsesGate = false
    walk(parse(rel), (n) => {
      if (n.type === 'VariableDeclarator' && n.id.name === 'dockAutoSaves') gate = n.init
      if (n.type === 'VariableDeclarator' && n.id.name === 'autoSaveOk') {
        walk(n.init, (m) => { if (m.type === 'Identifier' && m.name === 'dockAutoSaves') okUsesGate = true })
      }
    })
    expect(gate?.type).toBe('CallExpression')
    expect(gate?.callee?.name).toBe('layoutAutoSaves')
    expect(okUsesGate).toBe(true)
  })

  it('every layout scope the workspace writes has a kind here, and every probe uses a real scope', () => {
    // A LAYOUT object is one carrying `name` beside `scope` — the dock entries, the
    // charts_active_template value and the saveLayout payloads. (Theme objects also say `scope`,
    // with values like 'charts'/'widgets', and carry no name.)
    const written = new Set()
    const keyOf = (p) => p.key?.name ?? p.key?.value
    walk(parse('app/src/pages/charts/ChartsWorkspace.jsx'), (n) => {
      if (n.type !== 'ObjectExpression') return
      const props = n.properties.filter((p) => p.type === 'Property')
      if (!props.some((p) => keyOf(p) === 'name')) return
      const scope = props.find((p) => keyOf(p) === 'scope')
      if (scope?.value?.type === 'Literal' && typeof scope.value.value === 'string') written.add(scope.value.value)
    })
    expect(written.size).toBeGreaterThanOrEqual(2) // CONTROL: the AST found the workspace's scopes
    const probed = new Set(LAYOUT_KINDS.map((k) => k.probe.scope))
    expect([...written].filter((s) => !probed.has(s))).toEqual([])
    expect([...probed].filter((s) => !written.has(s))).toEqual([])
    expect(LAYOUT_KINDS.some((k) => k.probe.id === UCT_DEFAULT_ID)).toBe(true)
  })
})
