// app/src/components/provenance/panelAdoption.measure.test.js
//
// ─── ⭐⭐ HOW MANY PANELS ADOPT THE FOUR PROVENANCE PRIMITIVES, AND WHICH ─────
//
// S8 shipped four shared primitives — `Provenance` · `FreshnessBadge` ·
// `CoverageLine` · `Cited`. The rail this programme eventually wants is *"a panel
// that renders a value and imports none of them fails BY NAME"*.
//
// ⛔⛔ THIS FILE IS NOT THAT RAIL, DELIBERATELY. Nobody knows the denominator, and
// a threshold picked before the number is known fires on everything or on
// nothing. This is the CENSUS that tells us which — so it prints
// `examined / adopting / not-adopting` WITH THE NAMES and asserts nothing that
// can fail on product state.
//
//     cd app && npx vitest run \
//       src/components/provenance/panelAdoption.measure.test.js
//
// ── THE DENOMINATOR, ARGUED ─────────────────────────────────────────────────
//
// ⛔ THERE IS NO PANEL MANIFEST IN THIS REPO. `app/src/surfaces/manifest.js` says
// in its own header that it is a ROUTE manifest, AST-derived from `App.jsx`; a
// route is not a panel and mistaking the two would put a second authority on a
// fact neither file owns. So the population has to be DERIVED, and because four
// honest derivations disagree, FOUR are reported rather than one picked:
//
//   D-ALL      every tracked, non-test module under `app/src` that is REACHABLE
//              from the entry graph and CONTAINS JSX. The widest honest answer
//              to "what can put a value on a member's screen", and the only one
//              that can see the two live `CoverageLine` consumers — both live
//              under `components/`, NOT under `pages/`, so a pages-only
//              denominator is structurally blind to them.
//   D-PAGES    D-ALL narrowed to `app/src/pages/**`. This is the brief's lean
//              (a), and it is reported because it is the population a route-
//              derived rail would actually walk — but see the count: it is too
//              large for its not-adopting list to be a to-do list, and that is
//              the census's most useful finding.
//   D-VALUE    D-PAGES narrowed by a SECOND, INDEPENDENT signal: does the file
//              FORMAT a value at all? ⚠️ A LABELLED HEURISTIC, never a verdict —
//              it reads `toFixed` / `toLocale*` / `Intl.*Format` off the AST and
//              counts an import of the repo's own shared formatters. Reported
//              because the eventual rail's antecedent is "renders a value", and
//              the honest denominator for a metric excludes rows that cannot
//              move it (the `drawingDenominator` idiom: a script with no drawing
//              call cannot draw).
//   D-WIDGETS  the brief's lean (b), `pages/charts/widgets/**`. ⚰️ The brief
//              calls it "the 43 files"; this file COUNTS it instead, and the
//              count printed below is not 43. A hand-typed count beside the
//              directory it describes is this repo's most-repeated defect.
//   D-REGISTRY the brief's lean (c), `WIDGET_REGISTRY` → the `/charts` bindings
//              in `WidgetHost.jsx` → the component FILES, all three hops by AST.
//              The smallest population and the only one with a declared
//              membership — worth reporting precisely because a rail over it
//              could never be vacuous.
//
// ⛔ (d) — A DECLARED LIST — IS REFUSED. A hand-typed roster beside the thing it
// describes is the defect this repo has paid for as the writer-index `FOUR`, the
// COT router's "4 routes", the setup catalog's "24", and the widget switch's
// "four types" beside thirteen. Every population here is derived or it is not
// reported.
//
// ⚠️ PARTNER-OWNED FILES ARE REPORTED, NOT SILENTLY DROPPED. `pages/OptionsFlow.jsx`
// is Ravi's and a route-derived denominator pulls it in. It is printed in its own
// line so the eventual rail can exclude it by name with the exclusion VISIBLE,
// rather than a quiet filter nobody can audit.
//
// ── THE RE-EXPORT SHIM ──────────────────────────────────────────────────────
//
// ⛔⛔ `components/screener/CoverageLine.jsx` IS A 13-LINE RE-EXPORT of
// `provenance/CoverageLine`, kept deliberately until its two consumers are
// repointed. A naive import scan gets this wrong TWICE: it counts the shim as a
// fifth implementation, and it counts the shim's importers as non-adopting. This
// census DERIVES the alias set instead of naming it — a module whose entire body
// is re-exports and whose every resolved edge lands on a primitive IS that
// primitive for adoption purposes. Derived, so the day the shim is deleted the
// census needs no edit, and the day a second shim appears it is covered.
//
// ── AST, NEVER GREP ─────────────────────────────────────────────────────────
//
// ⛔ Measured while writing this file: a grep for `provenance/` over `app/src`
// reports `lib/presentation/presentationPrimitives.js` as an importer of the
// primitives. It imports none of them — all nine matches are PROSE in its
// comments. Only a parsed module specifier is an edge.
//
// ⛔⛔ AND THE RESOLVER BELOW IS TRANSCRIBED FROM `components/screener/reachable.test.js`,
// NOT IMPORTED — measured, because the obvious thing does not work: importing
// that file executes its top-level `describe()` calls during THIS file's
// collection, so its 18 tests are registered as part of this suite, and one of
// them fails on master today (four orphan modules). A census that drags a rail's
// product-state verdict into its own totals line is not a census.
//
// ⭐ So the copy is PINNED AGAINST ITS SOURCE. `the transcribed resolver is
// byte-identical` below extracts the same anchored slice out of BOTH files and
// compares them, which is the only thing that makes a second copy safe
// (`lesson_a_second_authority_over_one_value`). If it goes red, re-transcribe
// the slice — do not edit the copy to agree with itself.
//
// ── WHAT IS ASSERTED, AND WHAT IS NOT ───────────────────────────────────────
//
// ⛔ NO COUNT, NO THRESHOLD, NO RATIO. Every number here is printed. What is
// asserted is that the INSTRUMENT works: the transcription has not drifted, the
// graph walk found a real graph, the population is non-empty, the import
// detector can SEE a planted import and can tell an absent one, a re-export shim
// is resolved to what it fronts, and one real adopter is named.
//
// ⛔⛔ NON-VACUITY IS THE WHOLE RISK IN A CENSUS: a census that examined nothing
// prints a tidy `examined=0` and reads as success. So the census test REFUSES —
// it calls `assertDetectorAlive()` and `assertGraphAlive()` before it prints, so
// a broken resolver produces a RED with a reason instead of a table of zeros.
// Mutation-proved by making `edgesFromSource` return `[]`.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

// ─── TRANSCRIBED VERBATIM FROM `components/screener/reachable.test.js` ───────
// ⛔ DO NOT EDIT THIS BLOCK BY HAND. It is byte-compared against that file by
// the first test below. Its own comments are part of the transcription.
// ── BEGIN PINNED SLICE ──────────────────────────────────────────────────────
const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'api'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`reachable.test: could not find the repo root from ${process.cwd()}`)
})()

const APP = path.join(ROOT, 'app')
const SRC = path.join(APP, 'src')
const SCREENER_DIR = path.join(SRC, 'components', 'screener')
const VITE_CONFIG = path.join(APP, 'vite.config.js')

/** ⚠️ CRLF NORMALISED AT THE DOOR — `core.autocrlf` is on in this checkout. */
const read = (abs) => fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
const key = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')

const parse = (src) => Parser.extend(jsx()).parse(src, {
  ecmaVersion: 'latest', sourceType: 'module',
})

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return }
  if (typeof node.type === 'string') visit(node)
  for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, visit)
}

/** `import.meta.glob(...)` / `vi.mock(...)` — a two-segment callee, matched on
 *  the AST rather than on the source text. */
function calleeIs(n, obj, prop) {
  if (!n || n.type !== 'MemberExpression' || n.computed) return false
  if (n.property?.name !== prop) return false
  if (obj === 'import.meta') {
    return n.object?.type === 'MetaProperty'
      && n.object.meta?.name === 'import' && n.object.property?.name === 'meta'
  }
  return n.object?.type === 'Identifier' && n.object.name === obj
}

/**
 * Every module specifier this source names, BY AST.
 *
 * ⛔ `vi.mock` is DELIBERATELY NOT AN EDGE. A test mocking a module does not
 * make it reachable by a member — the deleted `BrokerSyncStatus` was mocked by
 * two live test files while no screen rendered it. Mocks are collected by the
 * census tool for triage; they are not reachability.
 *
 * @param {boolean} dynamic follow `import(…)` expressions as well as `import …`
 *        declarations. Exposed so a control can measure the difference.
 */
export function specifiersOf(src, { dynamic = true } = {}) {
  const out = []
  walk(parse(src), (n) => {
    if ((n.type === 'ImportDeclaration'
      || n.type === 'ExportNamedDeclaration'
      || n.type === 'ExportAllDeclaration')
      && n.source && typeof n.source.value === 'string') out.push(n.source.value)
    if (dynamic && n.type === 'ImportExpression'
      && n.source && n.source.type === 'Literal'
      && typeof n.source.value === 'string') out.push(n.source.value)
    // `new Worker(new URL('./x.js', import.meta.url))` and Vite's asset-URL form.
    if (n.type === 'NewExpression' && n.callee?.type === 'Identifier' && n.callee.name === 'URL'
      && n.arguments?.[0]?.type === 'Literal'
      && typeof n.arguments[0].value === 'string') out.push(n.arguments[0].value)
    if (n.type === 'CallExpression') {
      const a0 = n.arguments?.[0]
      const lit = a0?.type === 'Literal' && typeof a0.value === 'string' ? a0.value : null
      if (n.callee?.type === 'Identifier' && n.callee.name === 'require' && lit) out.push(lit)
      if (calleeIs(n.callee, 'import.meta', 'glob') && lit) out.push(lit)
    }
  })
  return out
}

const CODE_EXT = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']

/** Resolve a specifier to real JS/JSX file(s), or `[]`.
 *  ⛔ Packages and asset imports (`.css`, `.svg`) are not edges in this graph —
 *  a CSS module cannot render a component, and a bare specifier leaves
 *  `app/src` entirely. `/src/…` (how `index.html` names the entry) and a `?query`
 *  suffix both ARE edges. A `*` makes it an `import.meta.glob` pattern. */
function resolve(fromFile, specRaw) {
  const spec = String(specRaw).split('?')[0]
  let base
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  else if (spec.startsWith('/src/')) base = path.join(APP, spec.slice(1))
  else return []

  if (spec.includes('*')) {
    const dir = path.dirname(base)
    if (!fs.existsSync(dir)) return []
    const pattern = new RegExp(`^${path.basename(base)
      .split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}`)
    return fs.readdirSync(dir).map((f) => path.join(dir, f))
      .filter((p) => CODE_EXT.includes(path.extname(p))
        && pattern.test(path.basename(p)) && fs.statSync(p).isFile())
  }

  const candidates = [base, ...CODE_EXT.map((e) => base + e),
    ...CODE_EXT.map((e) => path.join(base, `index${e}`))]
  for (const c of candidates) {
    if (!CODE_EXT.includes(path.extname(c))) continue
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return [c]
  }
  return []
}

/**
 * Entry points Vite loads that no module imports — READ OFF THE CONFIG.
 *
 * `test.setupFiles` and the `resolve.alias` stub target are entry points in
 * exactly the sense this rail means, and `vite.config.js` already owns both
 * facts. Every string literal in the config that resolves to a real file under
 * `app/src` is taken; nothing else in the config can accidentally qualify,
 * because a string that does not name a file resolves to nothing.
 */
export function configEntryPoints() {
  if (!fs.existsSync(VITE_CONFIG)) return []
  const found = new Set()
  walk(parse(read(VITE_CONFIG)), (n) => {
    if (n.type !== 'Literal' || typeof n.value !== 'string') return
    if (!n.value.startsWith('.') && !n.value.startsWith('/src/')) return
    for (const f of resolve(VITE_CONFIG, n.value)) if (f.startsWith(SRC)) found.add(f)
  })
  return [...found]
}

/** The app's entry: `main.jsx` mounts `App.jsx`, and `App.jsx` owns the routes. */
const APP_ROOTS = ['main.jsx', 'App.jsx']
  .map((f) => path.join(SRC, f))
  .filter((p) => fs.existsSync(p))
const ROOTS = [...APP_ROOTS, ...configEntryPoints()]

/**
 * Every module reachable from `roots`, as absolute paths.
 *
 * @param {Map<string,string>} overrides  abs path -> source to use INSTEAD of
 *        the file on disk. This is how the planted-cut control severs an edge
 *        without touching the working tree.
 */
export function reachableFrom(roots, overrides = new Map()) {
  const seen = new Set()
  const queue = [...roots]
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    const src = overrides.has(file) ? overrides.get(file) : read(file)
    for (const spec of specifiersOf(src)) {
      for (const next of resolve(file, spec)) if (!seen.has(next)) queue.push(next)
    }
  }
  return seen
}
// ── END PINNED SLICE ────────────────────────────────────────────────────────

const SELF = fileURLToPath(import.meta.url)
const SOURCE_OF_TRUTH = path.join(SRC, 'components', 'screener', 'reachable.test.js')

/** The anchors that bound the transcription, in BOTH files. Chosen because each
 *  is unique in each file: the second `return seen` in `reachable.test.js` is
 *  indented six spaces, inside a test. */
// ⛔ ASSEMBLED, NOT WRITTEN AS ONE LITERAL — a literal open anchor would appear
// TWICE in this file (here and in the slice) and the uniqueness check below would
// fire on the instrument rather than on a real drift. Measured: it did.
const SLICE_OPEN = ['const', 'ROOT = (() => {'].join(' ')
const SLICE_CLOSE = '\n  return seen\n}\n'

/**
 * The pinned slice, read out of a file.
 *
 * ⛔ IT RAISES RATHER THAN RETURNING `''`. An empty result here would make the
 * byte-comparison below pass over nothing, which is the failure this whole file
 * is written to avoid (`an empty result is a failed invocation until proven
 * otherwise`).
 */
function pinnedSlice(file) {
  const src = read(file)
  const a = src.indexOf(SLICE_OPEN)
  const b = src.indexOf(SLICE_CLOSE, a)
  if (a < 0) throw new Error(`pinnedSlice: open anchor not found in ${key(file)}`)
  if (b < 0) throw new Error(`pinnedSlice: close anchor not found in ${key(file)}`)
  const slice = src.slice(a, b + SLICE_CLOSE.length)
  if (slice.length < 2000) throw new Error(`pinnedSlice: implausibly short (${slice.length}B) in ${key(file)}`)
  // ⛔ The anchors must be UNIQUE or the slice is whatever came first. Checked
  // here rather than assumed, because a future edit is what would break it.
  if (src.indexOf(SLICE_OPEN, a + 1) >= 0) throw new Error(`pinnedSlice: open anchor is not unique in ${key(file)}`)
  if (src.indexOf(SLICE_CLOSE, b + 1) >= 0) throw new Error(`pinnedSlice: close anchor is not unique in ${key(file)}`)
  return slice
}

// ─── THE CENSUS ─────────────────────────────────────────────────────────────

const PAGES_DIR = path.join(SRC, 'pages')
const PROV_DIR = path.join(SRC, 'components', 'provenance')
const WIDGETS_DIR = path.join(PAGES_DIR, 'charts', 'widgets')
const WIDGET_HOST = path.join(PAGES_DIR, 'charts', 'WidgetHost.jsx')
const REGISTRY_FILE = path.join(SRC, 'widgets', 'registry.js')

/** ⛔ PARTNER-OWNED, DECLARED AND PRINTED — never a silent filter. `OptionsFlow.jsx`
 *  is Ravi's (`project_partner_collab_branch`); a route-derived denominator pulls
 *  it in and the eventual rail will want it out. Declared here as a LABEL, not an
 *  exclusion: this file reports it in its own line and removes it from nothing. */
const PARTNER_OWNED = [path.join(PAGES_DIR, 'OptionsFlow.jsx')]

/** The four shipped primitives, as FILES. */
const PRIMITIVE_FILES = ['Provenance.jsx', 'FreshnessBadge.jsx', 'CoverageLine.jsx', 'Cited.jsx']
  .map((f) => path.join(PROV_DIR, f))

/** The provenance directory's SUPPORTING modules — contracts and formatters,
 *  read off the directory rather than listed. A panel that imports one of these
 *  and none of the four components is a real third state, and it is reported. */
const HELPER_FILES = fs.readdirSync(PROV_DIR)
  .filter((f) => CODE_EXT.includes(path.extname(f)) && !/\.(test|spec)\./.test(f))
  .map((f) => path.join(PROV_DIR, f))
  .filter((p) => !PRIMITIVE_FILES.includes(p))

const isTestFile = (p) => /\.(test|spec)\.(js|jsx|ts|tsx|mjs|cjs)$/.test(path.basename(p))
const underDir = (p, dir) => p === dir || p.startsWith(dir + path.sep)

/** Every module git TRACKS under `app/src`. ⛔ Asked, never guessed — an
 *  untracked file is somebody's half-written module, and a FAILED git read must
 *  not silently exempt the whole tree, so the caller asserts this is non-empty. */
function trackedUnderSrc() {
  const out = execFileSync('git', ['ls-files', '--', 'app/src'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return new Set(out.split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((p) => CODE_EXT.includes(path.extname(p)))
    .map((p) => path.join(ROOT, p)))
}

const TRACKED = trackedUnderSrc()

const _ast = new Map()
const astOf = (file) => {
  if (!_ast.has(file)) _ast.set(file, parse(read(file)))
  return _ast.get(file)
}

/**
 * The DIRECT import edges of one source text, as absolute file paths.
 *
 * ⛔⛔ THIS IS THE MUTATION POINT. Making this return `[]` breaks resolution
 * everywhere, and the census must REFUSE rather than print `adopting=0` — that
 * is what `assertDetectorAlive()` is for. Taking the source as an argument (not
 * reading the file) is what lets the controls plant an import without touching
 * the working tree.
 */
function edgesFromSource(fromFile, src) {
  const out = []
  for (const spec of specifiersOf(src)) for (const t of resolve(fromFile, spec)) out.push(t)
  return [...new Set(out)]
}

const _edges = new Map()
const edgesOf = (file) => {
  if (!_edges.has(file)) _edges.set(file, edgesFromSource(file, read(file)))
  return _edges.get(file)
}

/** Does this module put an element on screen at all? A module with no JSX cannot
 *  render a value to a member, so it is not a panel — which is an AST property,
 *  not a naming convention. */
function hasJsx(file) {
  let found = false
  walk(astOf(file), (n) => { if (typeof n.type === 'string' && n.type.startsWith('JSX')) found = true })
  return found
}

/** ⚠️ A LABELLED HEURISTIC, AND THE ONLY ONE IN THIS FILE. "Renders a value" is
 *  the eventual rail's antecedent and nothing in the repo declares it, so it is
 *  APPROXIMATED two ways and reported as an approximation: a formatting call on
 *  the AST, or an edge to one of the repo's own shared formatters. It is never a
 *  verdict and nothing is asserted about it. */
const FORMAT_PROPS = new Set(['toFixed', 'toLocaleString', 'toLocaleTimeString',
  'toLocaleDateString', 'NumberFormat', 'DateTimeFormat', 'toPrecision'])
const FORMATTER_MODULES = [
  path.join(SRC, 'lib', 'presentation', 'presentationPrimitives.js'),
  path.join(PROV_DIR, 'presentationFormat.js'),
]
function formatsAValue(file) {
  let hit = false
  walk(astOf(file), (n) => {
    if (n.type === 'MemberExpression' && !n.computed && FORMAT_PROPS.has(n.property?.name)) hit = true
  })
  if (hit) return true
  return edgesOf(file).some((t) => FORMATTER_MODULES.includes(t))
}

/**
 * A RE-EXPORT SHIM, derived.
 *
 * ⛔⛔ `components/screener/CoverageLine.jsx` is one, and a naive scan gets it
 * wrong twice: it reads as a fifth implementation, and its importers read as
 * non-adopting. The test is structural — every top-level statement is a
 * re-export WITH a source, and every resolved edge lands on a primitive — so
 * the day the shim is deleted this needs no edit, and the day a second one
 * appears it is already covered. NOT a named exception.
 */
function isReExportAlias(file) {
  const body = astOf(file).body
  let reexports = 0
  for (const n of body) {
    const isRe = (n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source
    if (isRe) reexports += 1
    else return false
  }
  if (reexports === 0) return false
  const edges = edgesOf(file)
  return edges.length > 0 && edges.every((t) => PRIMITIVE_FILES.includes(t))
}

// ── the graph ───────────────────────────────────────────────────────────────

const REACHABLE = reachableFrom(ROOTS)

/** Tracked, non-test, reachable modules under `app/src`. */
const REACHABLE_MODULES = [...REACHABLE]
  .filter((p) => underDir(p, SRC) && !isTestFile(p) && TRACKED.has(p))
  .sort()

const ALIASES = REACHABLE_MODULES.filter((p) => !PRIMITIVE_FILES.includes(p) && isReExportAlias(p))
const ADOPT_TARGETS = new Set([...PRIMITIVE_FILES, ...ALIASES])

const adopts = (file) => edgesOf(file).some((t) => ADOPT_TARGETS.has(t))
const helpersOnly = (file) => !adopts(file)
  && edgesOf(file).some((t) => HELPER_FILES.includes(t))

/** Does a primitive appear ANYWHERE in this module's own import closure? ⭐ The
 *  gap between this and `adopts` is the interesting number: a panel that imports
 *  none of the four but renders a child that does. */
function reachesAdoption(file) {
  const visited = new Set()
  const queue = [file]
  while (queue.length) {
    const cur = queue.pop()
    if (visited.has(cur)) continue
    visited.add(cur)
    for (const t of edgesOf(cur)) {
      if (ADOPT_TARGETS.has(t)) return true
      if (!visited.has(t)) queue.push(t)
    }
  }
  return false
}

// ── the registry hop ────────────────────────────────────────────────────────

/**
 * `WORKSPACE_WIDGETS` → component FILES, by AST.
 *
 * ⛔ AND THIS IS WHY CANDIDATE (c) CANNOT BE A FILE POPULATION ON ITS OWN:
 * `widgets/registry.js` is metadata-only BY DESIGN — its own header says "no
 * component imports, no host imports" — so `WIDGET_REGISTRY` names no file
 * anywhere. Ids become files only at the host binding map, which is where this
 * reads them. `widgets/registry.test.js` is what pins the two together.
 *
 * Handles both binding forms: a static `import X from './widgets/X'` and
 * `const X = lazy(() => import('./widgets/X'))`.
 */
function registryBoundFiles() {
  const ast = astOf(WIDGET_HOST)
  const localToSpec = new Map()
  for (const n of ast.body) {
    if (n.type === 'ImportDeclaration' && typeof n.source?.value === 'string') {
      for (const s of n.specifiers) localToSpec.set(s.local.name, n.source.value)
    }
    if (n.type === 'VariableDeclaration') {
      for (const d of n.declarations) {
        if (d.id?.type !== 'Identifier' || !d.init) continue
        let spec = null
        walk(d.init, (x) => {
          if (x.type === 'ImportExpression' && x.source?.type === 'Literal'
            && typeof x.source.value === 'string' && spec === null) spec = x.source.value
        })
        if (spec) localToSpec.set(d.id.name, spec)
      }
    }
  }
  const bindings = new Map()
  walk(ast, (n) => {
    if (n.type !== 'VariableDeclarator') return
    if (n.id?.type !== 'Identifier' || n.id.name !== 'WORKSPACE_WIDGETS') return
    if (n.init?.type !== 'ObjectExpression') return
    for (const p of n.init.properties) {
      if (p.type !== 'Property') continue
      const id = p.key?.name ?? p.key?.value
      if (p.value?.type !== 'ObjectExpression') continue
      const comp = p.value.properties.find((q) => q.type === 'Property'
        && (q.key?.name ?? q.key?.value) === 'component')
      const local = comp?.value?.type === 'Identifier' ? comp.value.name : null
      const spec = local ? localToSpec.get(local) : null
      const files = spec ? resolve(WIDGET_HOST, spec) : []
      if (id && files.length) bindings.set(id, files[0])
    }
  })
  return bindings
}

// ── refusals ────────────────────────────────────────────────────────────────

/**
 * ⛔⛔ THE REFUSAL. A census whose detector is broken prints `adopting=0` for
 * every population and reads exactly like a product finding. This plants a real
 * import into a synthetic source and demands the detector see it, then plants an
 * unrelated one and demands it does not — so resolution failure is a RED with a
 * reason instead of a tidy table of zeros.
 */
function assertDetectorAlive() {
  const from = path.join(PAGES_DIR, 'research', 'tabs', 'NewsTab.jsx')
  const planted = edgesFromSource(from,
    "import P from '../../../components/provenance/Provenance'\n")
  if (!planted.includes(PRIMITIVE_FILES[0])) {
    throw new Error('REFUSING: the import detector cannot see a PLANTED import of '
      + `${key(PRIMITIVE_FILES[0])} — every count below would be about the instrument, `
      + `not the product. Resolved instead: ${JSON.stringify(planted.map(key))}`)
  }
  const absent = edgesFromSource(from, "import x from './useCompanyNews'\n")
  if (absent.some((t) => ADOPT_TARGETS.has(t))) {
    throw new Error('REFUSING: the detector reports a primitive for a source that imports none '
      + '— it cannot distinguish adopting from not-adopting.')
  }
}

/** ⛔ The other half: a graph that came back empty satisfies every filter below. */
function assertGraphAlive() {
  if (TRACKED.size < 500) throw new Error(`REFUSING: git ls-files returned ${TRACKED.size} tracked modules`)
  if (REACHABLE.size < 200) throw new Error(`REFUSING: the walk reached ${REACHABLE.size} modules from ${ROOTS.length} roots`)
  const app = path.join(SRC, 'App.jsx')
  const n = edgesOf(app).length
  if (n < 20) throw new Error(`REFUSING: App.jsx resolved ${n} edges — the resolver is not resolving`)
  for (const p of PRIMITIVE_FILES) {
    if (!fs.existsSync(p)) throw new Error(`REFUSING: primitive missing from disk: ${key(p)}`)
  }
}

// ── reporting ───────────────────────────────────────────────────────────────

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a')

function names(list, cap) {
  const rows = list.map((p) => `      ${key(p)}`)
  if (cap === null || rows.length <= cap) return rows
  return [...rows.slice(0, cap), `      …and ${rows.length - cap} more`]
}

/** One population's census block. ⛔ Counts are PRINTED, never asserted. */
function block(label, note, population, cap) {
  const adopting = population.filter(adopts)
  const notAdopting = population.filter((p) => !adopts(p))
  const helperOnly = notAdopting.filter(helpersOnly)
  const transitive = notAdopting.filter(reachesAdoption)
  return [
    '',
    `── ${label} ${'─'.repeat(Math.max(0, 62 - label.length))}`,
    `   ${note}`,
    `   examined=${population.length} adopting=${adopting.length} `
      + `not-adopting=${notAdopting.length}   (${pct(adopting.length, population.length)} adopting)`,
    '',
    `   ADOPTING (${adopting.length}) — imports one of the four directly:`,
    ...names(adopting, null),
    '',
    `   NOT-ADOPTING (${notAdopting.length}) — ⭐ THIS LIST IS THE DELIVERABLE:`,
    ...names(notAdopting, cap),
    '',
    `   of those not-adopting, ${transitive.length} REACH a primitive transitively`,
    '     (a child they render imports one — the eventual rail would fail them by',
    '      name while a member already sees provenance on that surface)',
    ...names(transitive, Math.min(cap ?? 20, 20)),
    `   and ${helperOnly.length} import a provenance HELPER but none of the four components`,
    ...names(helperOnly, 20),
  ]
}

/** Where the not-adopting mass actually is. ⭐ Far more useful for choosing a
 *  threshold than a thousand-name list: a rail is scoped by directory long
 *  before it is scoped by file. */
function byDirectory(population) {
  const tally = new Map()
  for (const p of population) {
    if (adopts(p)) continue
    const rel = key(p).replace(/^app\/src\//, '')
    // ⛔ The PARENT directory, never the first three path segments — a top-level
    // `pages/Admin.jsx` otherwise becomes its own "directory" with a count of 1,
    // and the rollup degenerates into the file list it exists to summarise.
    const dir = rel.split('/').slice(0, -1).slice(0, 3).join('/') || '(src root)'
    tally.set(dir, (tally.get(dir) || 0) + 1)
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1])
    .map(([d, n]) => `      ${String(n).padStart(5)}  ${d}`)
}

// ─── TESTS ──────────────────────────────────────────────────────────────────

describe('⛔ the instrument, before any number is believed', () => {
  it('⛔⛔ the transcribed resolver is byte-identical to reachable.test.js\'s', () => {
    // ⭐ THE ONLY THING THAT MAKES A SECOND COPY SAFE. Both sides are extracted
    // from FILES by the same anchor pair — not one side typed. If this is red,
    // re-transcribe the slice out of `reachable.test.js`; do NOT edit the copy.
    const mine = pinnedSlice(SELF)
    const theirs = pinnedSlice(SOURCE_OF_TRUTH)
    expect(mine.length).toBeGreaterThan(4000)
    expect(mine, 'the transcription has DRIFTED from components/screener/reachable.test.js')
      .toBe(theirs)
  })

  it('⛔ the graph walk found a real graph', () => {
    expect(() => assertGraphAlive()).not.toThrow()
    // Named members rather than a count — a count can be satisfied by the wrong
    // set (`prefer naming a specific expected member over a count`).
    expect(REACHABLE_MODULES).toContain(path.join(SRC, 'App.jsx'))
    expect(REACHABLE_MODULES).toContain(path.join(SRC, 'components', 'ui', 'UIcon.jsx'))
  }, 600000)

  it('⛔⛔ the detector can SEE a planted import, and can tell an absent one', () => {
    expect(() => assertDetectorAlive()).not.toThrow()
    // And the mutation, asserted rather than described: a detector that ignored
    // its source would answer the same for both of these.
    const from = path.join(PAGES_DIR, 'research', 'tabs', 'NewsTab.jsx')
    const a = edgesFromSource(from, "import P from '../../../components/provenance/Cited'\n")
    const b = edgesFromSource(from, "import P from './useCompanyNews'\n")
    expect(a).not.toEqual(b)
  })

  it('⛔ a RE-EXPORT SHIM is resolved to the primitive it fronts', () => {
    // Synthetic, so it holds after the real shim is deleted: the classifier is
    // handed a re-export body and must call it an alias…
    const shim = path.join(SRC, 'components', 'screener', '__synthetic__.jsx')
    const edges = edgesFromSource(shim, "export { default } from '../provenance/CoverageLine'\n")
    expect(edges).toEqual([path.join(PROV_DIR, 'CoverageLine.jsx')])
    // …and a module that merely IMPORTS the primitive is NOT an alias, or every
    // adopter would be reclassified as a fifth implementation.
    const notShim = edgesFromSource(shim, "import C from '../provenance/CoverageLine'\nexport default function X() { return C }\n")
    expect(notShim).toEqual([path.join(PROV_DIR, 'CoverageLine.jsx')])
    // eslint-disable-next-line no-console
    console.log(['', `RE-EXPORT ALIASES DERIVED (${ALIASES.length}) — counted as the primitive they front:`,
      ...names(ALIASES, null), ''].join('\n'))
  }, 600000)

  it('⛔ a KNOWN adopter is in the adopting set BY NAME', () => {
    // ⚠️ THE ONE ASSERTION IN THIS FILE THAT TOUCHES PRODUCT STATE, and it is
    // here on purpose: without it the census can pass by seeing nothing. It is a
    // DETECTOR control, not a threshold — if `NewsTab` ever legitimately stops
    // importing a primitive, MOVE this to another real adopter, do not delete it.
    const newsTab = path.join(PAGES_DIR, 'research', 'tabs', 'NewsTab.jsx')
    expect(REACHABLE_MODULES, 'NewsTab.jsx is not reachable from the entry graph').toContain(newsTab)
    expect(adopts(newsTab), 'NewsTab.jsx imports Provenance + FreshnessBadge at :2-3').toBe(true)
    // And the negative half, so "adopts" is not just "returns true":
    expect(adopts(path.join(SRC, 'App.jsx'))).toBe(false)
  }, 600000)
})

describe('⭐⭐ the census — five derived denominators, no assertion on any count', () => {
  it('prints examined / adopting / not-adopting, with the names', () => {
    // ⛔ REFUSE FIRST. Everything below is a count, and a broken instrument
    // produces the most convincing counts in the file.
    assertGraphAlive()
    assertDetectorAlive()

    const dAll = REACHABLE_MODULES.filter(hasJsx)
    const dPages = dAll.filter((p) => underDir(p, PAGES_DIR))
    const dValue = dPages.filter(formatsAValue)
    const widgetsTracked = [...TRACKED].filter((p) => underDir(p, WIDGETS_DIR) && !isTestFile(p)).sort()
    const dWidgets = widgetsTracked.filter((p) => REACHABLE.has(p) && hasJsx(p))
    const bindings = registryBoundFiles()
    const dRegistry = [...new Set(bindings.values())].sort()

    // ⛔ POPULATIONS NON-EMPTY — the census's own non-vacuity. Each of these is a
    // fact about the derivation, not about adoption: a zero here means the
    // population was never found, which is the tidy-`examined=0` failure.
    expect(dAll.length, 'D-ALL derived nothing').toBeGreaterThan(0)
    expect(dPages.length, 'D-PAGES derived nothing').toBeGreaterThan(0)
    expect(dValue.length, 'D-VALUE derived nothing').toBeGreaterThan(0)
    expect(dWidgets.length, 'D-WIDGETS derived nothing').toBeGreaterThan(0)
    expect(dRegistry.length, 'D-REGISTRY derived nothing — the WidgetHost binding hop failed')
      .toBeGreaterThan(0)

    const partner = dPages.filter((p) => PARTNER_OWNED.includes(p))

    // ⭐ THE HEURISTIC AUDITS ITSELF. A known adopter that the "formats a value"
    // narrowing DROPS is a measured recall miss — derived here rather than
    // claimed in a comment, because a hand-typed rate beside a derived filter is
    // the defect this whole file is written around.
    const dValueSet = new Set(dValue)
    const valueMissed = dPages.filter(adopts).filter((p) => !dValueSet.has(p))

    // eslint-disable-next-line no-console
    console.log([
      '',
      '════ PROVENANCE PANEL ADOPTION CENSUS ═════════════════════════════════',
      `  the four primitives : ${PRIMITIVE_FILES.map((p) => path.basename(p)).join(' · ')}`,
      `  re-export aliases   : ${ALIASES.length ? ALIASES.map((p) => key(p)).join(', ') : '(none)'}`,
      `  provenance helpers  : ${HELPER_FILES.map((p) => path.basename(p)).join(' · ')}`,
      `  entry roots         : ${ROOTS.map(key).join(', ')}`,
      `  reachable modules   : ${REACHABLE_MODULES.length} tracked non-test under app/src`,
      `  of those, with JSX  : ${dAll.length}`,
      '',
      '  ⛔ NO COUNT BELOW IS ASSERTED. This file exists to produce the number',
      '     the real rail needs, not to defend one.',
      ...block('D-ALL — every reachable JSX module under app/src',
        'the widest honest population; the only one that can see the two CoverageLine consumers under components/',
        dAll, 40),
      ...block('D-PAGES — reachable JSX modules under app/src/pages/**',
        "the brief's lean (a); a route-derived rail would walk exactly this",
        dPages, 40),
      ...block('D-VALUE — D-PAGES that also FORMAT a value (⚠️ heuristic)',
        'the eventual rail\'s antecedent, approximated by AST format calls + shared-formatter edges',
        dValue, null),
      '',
      '── THE D-VALUE HEURISTIC, AUDITED AGAINST ITSELF ───────────────────────',
      `   ${valueMissed.length} of the ${dPages.filter(adopts).length} known D-PAGES adopters are DROPPED by the`,
      '   "formats a value" narrowing. ⭐ That is the heuristic\'s RECALL, measured',
      '   rather than claimed — a panel it drops is a panel the eventual rail would',
      '   never examine, so this number bounds how much a D-VALUE-scoped rail can see.',
      ...names(valueMissed, null),
      ...block('D-WIDGETS — pages/charts/widgets/** (reachable, with JSX)',
        `the brief's lean (b) — it calls this "the 43 files"; the directory holds ${widgetsTracked.length} tracked non-test modules TODAY`,
        dWidgets, null),
      ...block('D-REGISTRY — WORKSPACE_WIDGETS bindings, by AST',
        `the brief's lean (c); ${bindings.size} widget ids bind to ${dRegistry.length} distinct component files`,
        dRegistry, null),
      '',
      '── WHERE THE NOT-ADOPTING MASS IS (D-PAGES, by directory) ──────────────',
      '   ⭐ a rail is scoped by directory long before it is scoped by file',
      ...byDirectory(dPages),
      '',
      '── PARTNER-OWNED, REPORTED NOT EXCLUDED ────────────────────────────────',
      ...(partner.length
        ? partner.map((p) => `      ${key(p)}  adopting=${adopts(p)}  (Ravi — ack before any edit)`)
        : ['      (none of the declared partner files are in D-PAGES today)']),
      '',
      '═══════════════════════════════════════════════════════════════════════',
      '',
    ].join('\n'))
  }, 900000)
})
