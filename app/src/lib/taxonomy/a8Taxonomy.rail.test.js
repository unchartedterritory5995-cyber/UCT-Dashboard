// @vitest-environment node
//
// TERM-075 / FB-A8-01 — the frontend half of the A8 vocabulary rail.
//
// Every non-test module under app/src is parsed (the set is READ from the
// directory, never typed) and a literal that RESTATES an A8 vocabulary fails BY
// NAME (file:line). The Python half is tests/test_a8_taxonomy.py; both read the
// same `a8Taxonomy.json`.
//
// A restated copy of vocabulary V: an array literal (or an object literal's keys)
// whose strings are all members of V with at least two of them, or which holds
// every member of V. An object passed to `keyedBy(V, {...})` is a component's own
// table CHECKED against V at module load, and is allowed.
//
// ⛔ AST, NOT GREP: a comment naming the tags is not a copy; the controls below
// prove the detector sees a planted copy and cannot see a comment.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import DOC from './a8Taxonomy.json'
import {
  CATALYST_TAG, CATALYST_TAGS, CATALYST_TAG_DISPLAY_ORDER, CATALYST_TAG_PRECEDENCE,
  VOCABULARIES, keyedBy,
} from './a8Taxonomy'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const APP = path.resolve(SRC, '..')

const isTestPath = (rel) =>
  /(^|\/)(__tests__|__fixtures__|__mocks__)\//.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel)

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.[cm]?[jt]sx?$/.test(name)) out.push(full)
  }
  return out
}

function productFiles() {
  return walk(SRC)
    .map((f) => path.relative(APP, f).split(path.sep).join('/'))
    .filter((rel) => !isTestPath(rel))
    .sort()
}

function parseSource(src, rel = 'x.jsx') {
  const plugins = ['jsx']
  if (/\.tsx?$/.test(rel)) plugins.push('typescript')
  return parse(src, { sourceType: 'module', plugins, errorRecovery: true })
}

const SKIP = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens'])

function visit(node, parent, fn) {
  if (!node || typeof node.type !== 'string') return
  fn(node, parent)
  for (const key of Object.keys(node)) {
    if (SKIP.has(key)) continue
    const v = node[key]
    if (Array.isArray(v)) v.forEach((c) => visit(c, node, fn))
    else if (v && typeof v.type === 'string') visit(v, node, fn)
  }
}

function restates(strs, vocab) {
  const set = new Set(vocab)
  const members = new Set(strs.filter((s) => set.has(s)))
  if (members.size < 2) return false
  return strs.every((s) => set.has(s)) || vocab.every((v) => strs.includes(v))
}

function calleeName(call) {
  const c = call.callee
  if (c?.type === 'Identifier') return c.name
  if (c?.type === 'MemberExpression' && !c.computed) return c.property.name
  return ''
}

function keyOf(prop) {
  if (prop.type !== 'ObjectProperty' || prop.computed) return null
  if (prop.key.type === 'Identifier') return prop.key.name
  if (prop.key.type === 'StringLiteral') return prop.key.value
  return null
}

const isTagRead = (n) =>
  n?.type === 'MemberExpression' &&
  ((!n.computed && n.property.name === 'tag') || (n.computed && n.property.type === 'StringLiteral' && n.property.value === 'tag'))

/** [{ line, what }] for every restated vocabulary literal and bare tag literal in a tag position. */
export function findings(ast, vocabularies = VOCABULARIES, tags = CATALYST_TAGS) {
  const out = []
  const tagSet = new Set(tags)
  visit(ast.program, null, (node, parent) => {
    let strs = null
    if (node.type === 'ArrayExpression') {
      strs = node.elements.filter((e) => e?.type === 'StringLiteral').map((e) => e.value)
    } else if (node.type === 'ObjectExpression') {
      strs = node.properties.map(keyOf).filter((k) => k != null)
    }
    if (strs) {
      const checked = parent?.type === 'CallExpression' && calleeName(parent) === 'keyedBy' && parent.arguments.indexOf(node) > 0
      for (const [name, vocab] of Object.entries(vocabularies)) {
        if (!checked && restates(strs, vocab)) out.push({ line: node.loc.start.line, what: `restates ${name}` })
      }
    }
    if (node.type === 'LogicalExpression' && isTagRead(node.left) && node.right.type === 'StringLiteral' && tagSet.has(node.right.value)) {
      out.push({ line: node.right.loc.start.line, what: `bare tag literal '${node.right.value}'` })
    }
    if (node.type === 'BinaryExpression' && /^[!=]==?$/.test(node.operator)) {
      for (const [a, b] of [[node.left, node.right], [node.right, node.left]]) {
        if (isTagRead(a) && b.type === 'StringLiteral' && tagSet.has(b.value)) {
          out.push({ line: b.loc.start.line, what: `bare tag literal '${b.value}'` })
        }
      }
    }
  })
  return out
}

describe('A8 vocabulary authority — frontend reader', () => {
  it('reads the JSON and restates nothing', () => {
    expect(CATALYST_TAG_PRECEDENCE).toEqual(DOC.catalyst_tags.precedence)
    expect(CATALYST_TAG_DISPLAY_ORDER).toEqual(DOC.catalyst_tags.display_order)
    expect([...CATALYST_TAG_DISPLAY_ORDER].sort()).toEqual([...CATALYST_TAG_PRECEDENCE].sort())
    expect(CATALYST_TAG.GAPPER).toBe('Gapper')
  })

  it('keyedBy returns the table unchanged, and throws naming a missing or extra key', () => {
    const t = { News: 1, Catalyst: 2, Earnings: 3, Gapper: 4 }
    expect(keyedBy(CATALYST_TAGS, t)).toBe(t)
    expect(() => keyedBy(CATALYST_TAGS, { News: 1, Catalyst: 2, Earnings: 3 })).toThrow(/missing \["Gapper"\]/)
    expect(() => keyedBy(CATALYST_TAGS, { ...t, Mover: 5 })).toThrow(/extra \["Mover"\]/)
  })
})

describe('A8 vocabulary rail — controls', () => {
  it('sees a planted copy, a superset copy, a keyed object and a bare tag literal; not a comment or a checked table', () => {
    const src = [
      "// const TAGS = ['Catalyst', 'Earnings', 'Gapper', 'News']",
      "const COPY = ['Catalyst', 'News']",
      "const SUPER = ['Catalyst', 'Earnings', 'Gapper', 'News', 'Other']",
      'const CLS = { Catalyst: 1, Earnings: 2, Gapper: 3, News: 4 }',
      'const OK = keyedBy(CATALYST_TAGS, { Catalyst: 1, Earnings: 2, Gapper: 3, News: 4 })',
      // shares words with BOTH vocabularies and holds a non-member: a different vocabulary
      "const OTHER = { 'M&A': 1, Earnings: 2, Product: 3 }",
      "const a = row.tag || 'Catalyst'",
      "const b = e.tag === 'Earnings'",
      "const c = row.kind || 'Catalyst'",
    ].join('\n')
    expect(findings(parseSource(src))).toEqual([
      { line: 2, what: 'restates catalyst_tags' },
      { line: 3, what: 'restates catalyst_tags' },
      { line: 4, what: 'restates catalyst_tags' },
      { line: 7, what: "bare tag literal 'Catalyst'" },
      { line: 8, what: "bare tag literal 'Earnings'" },
    ])
  })
})

describe('A8 vocabulary rail — app/src', () => {
  const files = productFiles()

  it('the population is derived and holds the migrated consumers', () => {
    expect(files.length).toBeGreaterThan(500)
    for (const must of [
      'src/components/tiles/CatalystTable.jsx',
      'src/pages/CatalystsHistory.jsx',
      'src/pages/CatalystsRender.jsx',
      'src/pages/research/tabs/CatalystsTab.jsx',
    ]) expect(files).toContain(must)
  })

  it('no product module restates an A8 vocabulary or holds a bare tag literal in a tag position', () => {
    const words = [...new Set(Object.values(VOCABULARIES).flat())]
    const failures = []
    for (const rel of files) {
      const src = readFileSync(path.join(APP, rel), 'utf8')
      // Cheap, conservative pre-filter: a file naming fewer than two vocabulary
      // words anywhere cannot hold a two-member literal. The AST decides the rest.
      if (words.filter((w) => src.includes(w)).length < 2) continue
      for (const f of findings(parseSource(src, rel))) {
        failures.push(`${rel}:${f.line} ${f.what} - import from src/lib/taxonomy/a8Taxonomy (or wrap the table in keyedBy)`)
      }
    }
    expect(failures).toEqual([])
    // Reads and parses the whole of app/src: under ~1 s alone, but a loaded parallel
    // run starves it past the 15 s default (measured), so it carries its own budget.
  }, 120000)
})
