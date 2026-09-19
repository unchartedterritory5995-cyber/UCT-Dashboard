import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appRequire = createRequire(pathToFileURL(path.join(REPO, 'app', 'package.json')))
const { Parser } = appRequire('acorn')

const ENGINE = 'app/src/components/chart/engine'

// The canonical rendering-primitive vocabulary this task establishes (task
// brief, verbatim) — every later task in this plan uses this exact 22-name
// list. It doubles as the filter TARGETS are cross-referenced against below:
// several of the real engine constants parsed here mix in members that are
// genuinely theirs but are NOT part of this vocabulary. See the comment on
// the TARGETS loop in primitiveManifest() for exactly which, and why.
const CANONICAL_PRIMITIVES = new Set([
  'line', 'stepline', 'histogram', 'area', 'baseline', 'markers', 'band', 'candles',
  'plotshape', 'plotchar', 'plotarrow', 'bgcolor', 'barcolor', 'fill', 'hline',
  'plotcandle', 'plotbar',
  'line_obj', 'label_obj', 'box_obj', 'table_obj', 'linefill_obj',
])

// Each entry: which file, which top-level const, and how to read its literal
// members (a Set(['a','b']), an object whose KEYS are the primitives, or a
// plain array literal). This is the single place the source constants are
// named — everything downstream reads primitiveManifest()'s output.
const TARGETS = [
  { file: `${ENGINE}/presentation.js`, constant: 'RESTYLEABLE_DEF_STYLES', shape: 'set' },
  // defSchema.js declares its OWN `PLOT_STYLES` — the AUTHOR vocabulary
  // (line/stepline/histogram/area/baseline/hlines/markers/band; see
  // defSchema.js:150-158). presentation.js separately declares a DIFFERENT
  // `PLOT_STYLES` — the USER vocabulary — and its own top-of-file JSDoc
  // (presentation.js:16-22) says so explicitly: "defSchema.PLOT_STYLES is the
  // AUTHOR's vocabulary... The USER's vocabulary is the five below". Two
  // distinct constants, two distinct files, same name on purpose;
  // extractConst always takes an explicit file path below, so parsing both is
  // unambiguous. This entry is the one real, parseable source for `band` —
  // no fabricated citation needed.
  { file: `${ENGINE}/defSchema.js`, constant: 'PLOT_STYLES', shape: 'array' },
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

  // TARGETS are parsed IN FULL — nothing is filtered out of the AST read
  // itself, so a renamed constant still throws loudly (see extractConst)
  // rather than silently returning less. CANONICAL_PRIMITIVES is applied
  // AFTER parsing, per extracted member, to cross-reference each real,
  // parsed name against this task's declared 22-name vocabulary — the
  // question asked below is always "is this name in the list?", never "is
  // this call semantically non-rendering?" (several excluded members below
  // ARE rendering calls; that is not why they're excluded). Three targets
  // carry real members that fall out this way:
  //   OUTPUT_CALLS             — `alertcondition` (a notification mechanism,
  //                              not a rendering primitive) and `plot` (real
  //                              rendering, but not a standalone name in this
  //                              vocabulary — it's covered by the generic
  //                              style names line/histogram/area/etc. above)
  //                              both fall out here. `plotshape`, `plotchar`,
  //                              `plotarrow` are in the vocabulary and stay.
  //   CHART_ONLY_CALLS         — `alert` (a notification mechanism, not a
  //                              rendering primitive) falls out the same way.
  //                              `bgcolor`, `barcolor`, `hline`, `plotshape`,
  //                              `plotchar` all stay — this file's own
  //                              comments call this group "paint", i.e.
  //                              rendering (see pine.js ~1774).
  //   defSchema.js PLOT_STYLES — `hlines` (plural: an internal def-style name
  //                              for a guide line) falls out here. Pine's own
  //                              `hline()` call (singular) is a different,
  //                              separate construct, sourced from
  //                              CHART_ONLY_CALLS above, and it stays.
  for (const target of TARGETS) {
    const names = extractConst(target.file, target.constant, target.shape)
    for (const raw of names) {
      const name = OBJECT_NAMESPACE_SUFFIX.has(raw) && target.constant === 'OBJECT_NAMESPACES'
        ? `${raw}_obj`
        : raw
      if (!CANONICAL_PRIMITIVES.has(name)) continue
      if (primitives.has(name)) continue // first real citation wins
      primitives.add(name)
      sources[name] = { file: target.file, constant: target.constant }
    }
  }

  // `candles` and `fill` are real rendering primitives that do not live in
  // any of the TARGETS' enumerable const collections, so — like the five
  // drawing-object namespaces above are the one place suffixing happens —
  // these are the only two hand-added entries. Each citation below was
  // verified fresh against the actual file this session, not inherited from
  // a prior claim.
  //
  // `candles`: presentation.js's OWN `PLOT_STYLES` (the different,
  // deliberately same-named constant — see the TARGETS comment above) lists
  // it at :33-41: the one entry whose data shape differs from every other
  // style above (four columns, not one — see the comment there explaining
  // why it is "recognised, mapped, and not yet offered").
  primitives.add('candles')
  sources.candles = { file: `${ENGINE}/presentation.js`, constant: 'PLOT_STYLES (:33-41, the "candles" entry)' }

  // `fill`: the literal Pine SOURCE CONSTRUCT — the text `fill(...)` that
  // appears in real .pine scripts (a later task's corpus grep needs this
  // exact name, because that's what's on the page; `band` above is a
  // different thing — defSchema.js's internal name for the render STYLE that
  // `fill()` compiles to). `fill`'s own implementation lives in its own
  // module rather than a single enumerable array, so it is hand-added too,
  // even though `fill` is ALSO a real (and kept) member of CHART_ONLY_CALLS
  // above — this citation intentionally replaces that one with the more
  // useful pointer to where the behaviour is actually implemented.
  primitives.add('fill')
  sources.fill = {
    file: `${ENGINE}/fillPrimitive.js`,
    constant: '(hand-added: Pine fill() statement — implemented as the "band" render style; see fillPrimitive.js for the implementation and defSchema.js:156-158 PLOT_STYLES for the internal style name)',
  }

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
  if (primitives.length !== 22) {
    console.error('SELF-CHECK FAILED — expected exactly 22 primitives, found', primitives.length, primitives)
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
