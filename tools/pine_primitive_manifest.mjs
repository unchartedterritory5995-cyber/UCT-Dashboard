import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appRequire = createRequire(pathToFileURL(path.join(REPO, 'app', 'package.json')))
const { Parser } = appRequire('acorn')

const ENGINE = 'app/src/components/chart/engine'

// Each entry: which file, which top-level const, and how to read its literal
// members (a Set(['a','b']), an object whose KEYS are the primitives, or a
// plain array literal). This is the single place the five source constants
// are named — everything downstream reads primitiveManifest()'s output.
const TARGETS = [
  { file: `${ENGINE}/presentation.js`, constant: 'RESTYLEABLE_DEF_STYLES', shape: 'set' },
  { file: `${ENGINE}/ast/pine.js`, constant: 'OUTPUT_CALLS', shape: 'objectKeys' },
  { file: `${ENGINE}/ast/pine.js`, constant: 'MULTI_OUTPUT_CALLS', shape: 'objectKeys' },
  { file: `${ENGINE}/ast/pine.js`, constant: 'CHART_ONLY_CALLS', shape: 'set' },
  { file: `${ENGINE}/ast/pineObjects.js`, constant: 'OBJECT_NAMESPACES', shape: 'array' },
]

// Primitives that need renaming/merging to a stable vocabulary name distinct
// from a Pine drawing-object namespace of the same word (e.g. `line` the
// rendering style vs. `line.new(...)` the drawing object).
const OBJECT_NAMESPACE_SUFFIX = new Set(['line', 'label', 'box', 'table', 'linefill'])

function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return
  fn(node)
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue
    const val = node[key]
    if (Array.isArray(val)) val.forEach((v) => walk(v, fn))
    else if (val && typeof val.type === 'string') walk(val, fn)
  }
}

function literalOf(node) {
  if (node.type === 'Literal') return node.value
  return undefined
}

function extractConst(fileRel, constantName, shape) {
  const src = readFileSync(path.join(REPO, fileRel), 'utf8')
  const ast = Parser.parse(src, { ecmaVersion: 2022, sourceType: 'module' })
  let found
  walk(ast, (node) => {
    if (found) return
    if (
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'Identifier' &&
      node.id.name === constantName
    ) {
      found = node.init
    }
  })
  if (!found) {
    throw new Error(`primitiveManifest: could not find const ${constantName} in ${fileRel} — was it renamed?`)
  }
  // Unwrap Object.freeze(...) / new Set(Object.freeze([...])) wrappers.
  let inner = found
  while (
    inner.type === 'CallExpression' &&
    inner.callee?.type === 'MemberExpression' &&
    inner.callee.object?.name === 'Object' &&
    inner.callee.property?.name === 'freeze'
  ) {
    inner = inner.arguments[0]
  }
  if (inner.type === 'NewExpression' && inner.callee?.name === 'Set') {
    inner = inner.arguments[0]
  }

  if (shape === 'array') {
    if (inner.type !== 'ArrayExpression') {
      throw new Error(`primitiveManifest: ${constantName} in ${fileRel} is not an array literal after unwrapping`)
    }
    return inner.elements.map(literalOf).filter((v) => v !== undefined)
  }
  if (shape === 'set') {
    if (inner.type !== 'ArrayExpression') {
      throw new Error(`primitiveManifest: ${constantName} in ${fileRel} (Set) has no array literal after unwrapping`)
    }
    return inner.elements.map(literalOf).filter((v) => v !== undefined)
  }
  if (shape === 'objectKeys') {
    if (inner.type !== 'ObjectExpression') {
      throw new Error(`primitiveManifest: ${constantName} in ${fileRel} is not an object literal after unwrapping`)
    }
    return inner.properties
      .map((p) => (p.key?.type === 'Identifier' ? p.key.name : literalOf(p.key)))
      .filter((v) => v !== undefined)
  }
  throw new Error(`primitiveManifest: unknown shape ${shape}`)
}

export function primitiveManifest() {
  const primitives = new Set()
  const sources = {}

  for (const target of TARGETS) {
    const names = extractConst(target.file, target.constant, target.shape)
    for (const raw of names) {
      const name = OBJECT_NAMESPACE_SUFFIX.has(raw) && target.constant === 'OBJECT_NAMESPACES'
        ? `${raw}_obj`
        : raw
      primitives.add(name)
      sources[name] = { file: target.file, constant: target.constant }
    }
  }

  // `band` (Pine's `fill()` between two plots) and `candles` are real
  // rendering primitives the corpus must cover, confirmed present in
  // presentation.js (:90-95 band, :33-41 candles) but not captured by the
  // five TARGETS above (they live in inline conditionals, not a named
  // const collection) — declared explicitly rather than parsed, and each
  // has a comment explaining why it's the one exception to "never hand-type".
  primitives.add('band') // presentation.js:90-95 — fill()/band handling, not a named const
  sources.band = { file: `${ENGINE}/presentation.js`, constant: '(inline band handling, :90-95)' }
  primitives.add('candles') // presentation.js:33-41 — PLOT_STYLES 'candles' entry
  sources.candles = { file: `${ENGINE}/presentation.js`, constant: 'PLOT_STYLES' }

  return { primitives: [...primitives].sort(), sources }
}

function selfCheck() {
  const { primitives } = primitiveManifest()
  const required = ['line', 'plotshape', 'plotarrow', 'bgcolor', 'plotcandle', 'table_obj']
  const missing = required.filter((r) => !primitives.includes(r))
  if (missing.length) {
    console.error('SELF-CHECK FAILED — missing:', missing)
    process.exit(1)
  }
  console.log('SELF-CHECK OK —', primitives.length, 'primitives found')
}

const argv = process.argv.slice(2)
if (argv.includes('--self-check')) {
  selfCheck()
} else if (argv.includes('--json')) {
  console.log(JSON.stringify(primitiveManifest(), null, 2))
} else if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { primitives } = primitiveManifest()
  console.log(primitives.join('\n'))
}
