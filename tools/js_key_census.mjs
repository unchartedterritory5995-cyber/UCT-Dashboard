// tools/js_key_census.mjs
//
// A REAL-AST census of `app/src`: every object-literal key written, and every
// property name read, per file — so a Python-side contract rail can ask "which
// functions project this payload?" and "does anything actually READ this key?"
// without ever grepping.
//
// ⛔ WHY NOT GREP. `useCalendarData.js`'s own comment contains the string
// `expected_move_outcome`, and `cardBits.jsx`'s comment block discusses the
// reason vocabulary at length. A text search for a key name therefore reports
// "consumed" for a field that no code reads — the exact vacuous-pass this
// census exists to prevent (see `lesson_probe_names_must_be_derived_not_typed`:
// "a grep reported 5 call sites; all five were prose"). Comments and string
// literals are not nodes of interest in an AST, so they cannot lie here.
//
// Usage:  node tools/js_key_census.mjs <src-dir> <app-dir>
// Stdout: {
//   files: <int>,                       // scanned (abort-on-zero material)
//   parse_errors: [{file, message}],    // a file we could not read cannot be
//                                       // trusted to be free of a dropped key
//   literals: [{file, fn, keys[], spread, line}],
//   reads:    { "<property>": ["<file>", ...] }
// }
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const [, , SRC_DIR, APP_DIR] = process.argv
if (!SRC_DIR || !APP_DIR) {
  console.error('usage: node js_key_census.mjs <src-dir> <app-dir>')
  process.exit(2)
}

// The parser lives in the FRONTEND's node_modules; this script does not. Resolve
// it explicitly rather than relying on cwd (ESM resolves bare specifiers from the
// importing FILE's directory, not the working directory — a `cwd=app` subprocess
// would still have failed).
const require = createRequire(path.join(APP_DIR, 'node_modules', '_resolve_anchor.cjs'))
const { Parser } = require('acorn')
const jsx = require('acorn-jsx')
const JsxParser = Parser.extend(jsx())

const SKIP_DIRS = new Set(['node_modules', '__tests__', '__mocks__', 'dist', 'assets'])
const isTest = (name) => /\.(test|spec)\.[jt]sx?$/.test(name)

function sources(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) sources(path.join(dir, ent.name), out)
    } else if (/\.jsx?$/.test(ent.name) && !isTest(ent.name)) {
      out.push(path.join(dir, ent.name))
    }
  }
  return out
}

/** The name a function is KNOWN BY at its definition site — `function f(){}`,
 *  `const f = () => {}`, `{ f() {} }`. Falls back to the enclosing name so a
 *  literal built inside an anonymous callback is still attributed to the
 *  function a reader would go look at. */
function nameFromParent(parent) {
  if (!parent) return null
  if (parent.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') return parent.id.name
  if (parent.type === 'Property' && !parent.computed) return parent.key?.name ?? parent.key?.value ?? null
  if (parent.type === 'MethodDefinition' && !parent.computed) return parent.key?.name ?? null
  if (parent.type === 'AssignmentExpression' && parent.left?.type === 'Identifier') return parent.left.name
  return null
}

const IGNORED_KEYS = new Set(['type', 'loc', 'range', 'start', 'end', 'parent'])

function walk(node, parent, fnName, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const n of node) walk(n, parent, fnName, visit)
    return
  }
  if (typeof node.type !== 'string') return
  let fn = fnName
  if (node.type === 'FunctionDeclaration') {
    fn = node.id?.name || fn
  } else if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
    fn = node.id?.name || nameFromParent(parent) || fn
  }
  visit(node, fn)
  for (const k of Object.keys(node)) {
    if (IGNORED_KEYS.has(k)) continue
    walk(node[k], node, fn, visit)
  }
}

/** A non-computed property name, or a computed one written as a string
 *  literal — both are the same fact about which key the code touches. */
function propName(node) {
  if (!node.computed) {
    if (node.property?.type === 'Identifier') return node.property.name
    if (node.property?.type === 'Literal' && typeof node.property.value === 'string') return node.property.value
    return null
  }
  if (node.property?.type === 'Literal' && typeof node.property.value === 'string') return node.property.value
  return null
}

const literals = []
const reads = new Map()
const parseErrors = []
const files = sources(SRC_DIR)

const addRead = (name, rel) => {
  if (!name) return
  if (!reads.has(name)) reads.set(name, new Set())
  reads.get(name).add(rel)
}

for (const file of files) {
  const rel = path.relative(APP_DIR, file).split(path.sep).join('/')
  let tree
  try {
    tree = JsxParser.parse(fs.readFileSync(file, 'utf8'), {
      ecmaVersion: 'latest', sourceType: 'module', locations: true,
    })
  } catch (err) {
    parseErrors.push({ file: rel, message: String(err && err.message) })
    continue
  }
  walk(tree, null, null, (node, fn) => {
    if (node.type === 'ObjectExpression') {
      const keys = []
      let spread = false
      for (const p of node.properties) {
        if (p.type === 'SpreadElement' || p.type === 'ExperimentalSpreadProperty') { spread = true; continue }
        if (p.computed) continue
        const k = p.key?.name ?? (typeof p.key?.value === 'string' ? p.key.value : null)
        if (k) keys.push(k)
      }
      if (keys.length) {
        literals.push({ file: rel, fn: fn || '<module>', keys, spread, line: node.loc?.start?.line ?? 0 })
      }
    } else if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
      addRead(propName(node), rel)
    } else if (node.type === 'ObjectPattern') {
      // Destructuring IS a read: `const { live_outcome } = payload`.
      for (const p of node.properties) {
        if (p.type !== 'Property' || p.computed) continue
        addRead(p.key?.name ?? (typeof p.key?.value === 'string' ? p.key.value : null), rel)
      }
    }
  })
}

process.stdout.write(JSON.stringify({
  files: files.length,
  parse_errors: parseErrors,
  literals,
  reads: Object.fromEntries([...reads].map(([k, v]) => [k, [...v].sort()])),
}))
