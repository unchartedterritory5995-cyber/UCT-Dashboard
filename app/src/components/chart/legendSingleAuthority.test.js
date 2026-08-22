import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

// ─── ONE READER FOR "IS THE LEGEND SHOWING", ASSERTED STRUCTURALLY ───────────
//
// `header.showLegend` (boolean) and `header.legendMode` (three states) describe
// the SAME fact. That is survivable only while exactly one module resolves the
// pair and everything else asks it — the moment a second surface reads either
// key directly, the two disagree for any user whose stored blob predates the
// mode, and the disagreement is invisible (a legend that is on here and off
// there looks like a rendering quirk, not a data bug).
//
// ⛔ AN AST, NOT A GREP. `showLegend` appears in a dozen COMMENTS across these
// files — including the ones explaining why not to read it — so a text search
// reports permanent false positives and gets muted or deleted. This walks the
// parse tree and counts only real member expressions and object keys.
//
// ⭐ THE FILE LIST IS DERIVED by walking `app/src`, not typed here. A hand-typed
// list is the one thing that cannot fail when someone adds the reader to a file
// nobody thought to list — which is exactly the regression this exists for.

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', '..')

/** Every source file under `app/src`, tests and fixtures excluded. */
function sourceFiles(dir = SRC, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__fixtures__') continue
      sourceFiles(full, out)
    } else if (/\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** The modules allowed to name `showLegend` in code (not in prose). */
const RESOLVER = path.join(SRC, 'components', 'chart', 'legendMode.js')
const SCHEMA = path.join(SRC, 'components', 'chart', 'chartDefaults.js')
// A frozen JSON preset blob — stored DATA carrying the legacy key, which is the
// exact input the resolver's fallback exists to read. Not a reader.
const PRESET_BLOB = path.join(SRC, 'pages', 'charts', 'ChartsWorkspace.jsx')

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return }
  if (typeof node.type === 'string') visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue
    walk(node[key], visit)
  }
}

/** Real code references to `showLegend` — member reads and object keys. */
function codeReferences(file) {
  const src = fs.readFileSync(file, 'utf8')
  // Cheap prefilter: parsing all ~1,400 files costs seconds we don't need to spend.
  if (!src.includes('showLegend')) return 0
  const ast = parse(src, {
    sourceType: 'module',
    plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
  })
  let hits = 0
  walk(ast.program, (node) => {
    if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
      if (!node.computed && node.property?.type === 'Identifier'
        && node.property.name === 'showLegend') hits++
    }
    if (node.type === 'ObjectProperty' && !node.computed) {
      const k = node.key
      if ((k?.type === 'Identifier' && k.name === 'showLegend')
        || (k?.type === 'StringLiteral' && k.value === 'showLegend')) hits++
    }
  })
  return hits
}

describe('the legend has ONE authority', () => {
  const files = sourceFiles()

  it('the sweep is not vacuous — it can see the resolver that legitimately reads the key', () => {
    // Without this control the whole file passes just as happily against a
    // parser that silently matched nothing.
    expect(codeReferences(RESOLVER)).toBeGreaterThan(0)
    expect(files).toContain(RESOLVER)
    expect(files.length).toBeGreaterThan(500)
  })

  it('no module outside the resolver, the schema and a stored preset blob reads header.showLegend', () => {
    const allowed = new Set([RESOLVER, SCHEMA, PRESET_BLOB])
    const offenders = files
      .filter(f => !allowed.has(f))
      .filter(f => codeReferences(f) > 0)
      // Names, not a count — a rail that reports "3 offenders" makes the reader
      // go find them, and the finding is the whole product of the rail.
      .map(f => path.relative(SRC, f))
    expect(offenders,
      'these read `header.showLegend` directly; call `legendModeOf(cs)` instead — '
      + 'the legacy boolean is a fallback INPUT to that resolver, not an answer',
    ).toEqual([])
  })
})
