// app/src/components/provenance/panelAdoption.ratchet.test.js
//
// ─── ⭐⭐ THE PROVENANCE ADOPTION RATCHET — ADOPTION MAY NOT GO BACKWARDS ─────
//
// S8 shipped four shared primitives — `Provenance` · `FreshnessBadge` ·
// `CoverageLine` · `Cited`. `panelAdoption.measure.test.js` is the CENSUS that
// counted who uses them. This is the rail the census exists to make possible.
//
//     cd app && npx vitest run \
//       src/components/provenance/panelAdoption.ratchet.test.js
//
// ── ⛔⛔ THE RAIL THE ROADMAP ASKED FOR IS RED ON ARRIVAL AND IS NOT BUILT ────
//
// The roadmap words TERM-019 / RM-N12 as *"a rail asserting every panel uses the
// shared provenance set"*. Measured tonight by the census, on this tree:
//
//     all of app/src   examined 771   adopting   8   not-adopting 763
//     pages/**         examined 525   adopting   6   not-adopting 519
//     "formats value"  examined 182   adopting   5   not-adopting 177
//     chart widgets    examined  53   adopting   0   not-adopting  53
//     widget registry  examined  20   adopting   0   not-adopting  20
//
// ⛔ At 0–8 adopters that assertion fails on the day it lands, on every
// population. A rail that is red on arrival is muted within a week and then it
// protects nothing — the red IS the failure mode, not the goal. So it is not
// built, and the honest sequencing the census exists to enable is followed
// instead: measure first, threshold second.
//
// ── THE SHAPE: A RATCHET OVER A NAMED SET ───────────────────────────────────
//
// ⭐ What is asserted is that adoption does not DECREASE. Every panel the
// committed baseline records as an adopter must still adopt; a panel that stops
// FAILS BY NAME. It passes today at 8, it fails on a real regression, and it
// forces the number up over time without anybody having to guess a threshold.
//
// ⛔ AND BY NAME IS NOT ENOUGH — IT ALSO FAILS BY KIND. A panel leaves this
// population when the ROUTE that mounted it is deleted just as surely as when its
// import is removed, so `classifyMissing()` separates DELETED · UNTRACKED ·
// UNREACHABLE-but-still-importing · STOPPED IMPORTING. Telling somebody to
// "restore the import" while the import is still sitting in the file sends them to
// the wrong file and teaches them the rail is unreliable.
//
// ⛔⛔ AND THE BASELINE STORES NAMES, NEVER A COUNT. A hard-coded count beside
// the thing it counts is this repo's single most-recorded defect — the
// writer-index `FOUR` beside six, the COT router's "4 routes" beside five, the
// widget switch's "four types" beside thirteen. A count would ALSO be a second
// authority over a value the AST walk below already owns
// (`lesson_a_second_authority_over_one_value`). A list of names is not a
// restatement of that value: it is a record of WHICH panels were adopting when
// the list was last committed, which is a different fact, and every number this
// file prints is `list.length` — derived, never stored.
//
// ── WHERE THE BASELINE LIVES, AND WHY IT IS NOT A SECOND AUTHORITY ──────────
//
// `panelAdoption.baseline.json`, beside this file, committed, READ here and
// written only by the update mode below. It is the one thing this rail cannot
// derive: "was this panel adopting yesterday" is a fact about history, and
// history is not in the tree.
//
//   • ADDING a name is mechanical — `maybeUpdateBaseline()` appends whatever is
//     newly adopting, and the rail tells you the exact command. That is how a
//     new adopter is banked in the same commit that creates it.
//   • ⛔ REMOVING a name is a HAND EDIT to a committed artifact, and the update
//     mode REFUSES to do it (`REFUSING to update`). So a regression cannot be
//     laundered by re-running the generator: retiring an adopter costs one
//     deliberate, reviewable line in a diff, with the reason in the commit
//     message. That refusal is what makes the set monotone, and monotone is
//     what makes this a ratchet rather than a snapshot.
//
// ⚠️ A MANIFEST IS EDITED AS TEXT, NEVER ROUND-TRIPPED THROUGH A SERIALISER —
// and the update mode does round-trip it, so the hazard is converted into a
// checked property instead of a promise: `the committed baseline is byte-exactly
// what the writer produces` asserts the serialisation is IDEMPOTENT for this
// file (stable key order, sorted array, LF, trailing newline), so appending one
// adopter is a ONE-LINE diff and never a 3,000-line one. Same guard, same
// reason, as `chart/engine/ast/manifestFormatting.test.js`.
//
// ── THE POPULATION, AND HOW ANOTHER WORKSTREAM'S DIRECTORY STAYS OUT ────────
//
// ⭐⭐ THE POPULATION IS THE ADOPTERS THEMSELVES, DERIVED — every tracked,
// non-test, reachable module under `app/src` that imports one of the four (or a
// derived re-export alias of one), less the targets themselves. That last clause
// was measured, not foreseen: without it the population came back at 9 and the
// ninth was the re-export SHIM, which satisfies `adopts` trivially and is
// scheduled for deletion — see `POPULATION` below.
//
// ⛔ It is NOT `pages/**`, and the census says why in one number: **204 of that
// population's 519 non-adopting files are one directory,
// `pages/journal-2-0/components`**. A rail scoped to `pages/**` is a Notebook
// rail wearing a provenance label, and it would fire on another workstream's
// files under a label that gives them no way to answer it.
//
// ⭐ AND IT IS KEPT OUT BY DERIVATION, NOT BY A NAMED EXCLUSION. There is no
// `journal-2-0` literal anywhere in this file. A directory with zero adopters
// contributes zero rows to the population and therefore zero possible failures,
// by construction — which also means the day a Notebook panel DOES adopt, it
// joins the population and this rail starts protecting their adoption instead of
// accusing them of lacking it. A hand-typed exclusion list could not do either
// half: it would need maintaining, and it would have to be trusted rather than
// read. The count is printed below, derived, so the reasoning stays checkable.
//
// ── WHY NOT THE OTHER THREE ─────────────────────────────────────────────────
//
// (a) ⛔ A DECLARED-EXEMPTION REGISTER — each non-adopting panel carrying a
//     recorded reason, the repo's own `AWAITING_A_DECISION` idiom. That idiom
//     works at 20 entries because every entry is a countdown somebody owns. At
//     **519** it is a ledger nobody maintains, and an unmaintained register is
//     worse than none: it reads as coverage. Its own rails would also invert —
//     `AWAITING_A_DECISION` is guarded by two tests whose job is to make the
//     list SHRINK, and a 519-row list can only grow.
//
// (b) ⛔ SCOPE TO THE WIDGET REGISTRY (20 files) — small enough to enumerate and
//     the only population with a declared membership, but measured at **0%
//     adopting**, so as an assertion it is red on arrival too. As a ratchet it
//     would be a ratchet at zero: "no widget regresses from zero" asserts
//     nothing at all and can never fail (`lesson_gate_that_cannot_fail`). Its 20
//     names are the best to-do list in the census; they are not a rail.
//
// (c) ⛔ THE "FORMATS A VALUE" NARROWING — refused on the census's OWN
//     measurement, not on taste: the census audits that filter against itself
//     and reports it **drops 1 of the 6 known `pages/**` adopters**
//     (`research/tabs/AskAiTab.jsx`). A rail scoped to it would never examine a
//     panel that demonstrably renders provenance today, and the filter's
//     precision is unmeasured in the other direction. A population that cannot
//     see a known member is not a population.
//
// ⚠️ AND WHAT A RATCHET DOES NOT DO, stated so nobody reads more into it: it
// makes every gain permanent; it does not create one. Growth comes from the
// census's not-adopting list being worked as a to-do list. This rail is what
// stops that work being silently undone.
//
// ── PARTNER-OWNED FILES ARE LABELLED, NEVER SILENTLY FILTERED ───────────────
//
// `pages/OptionsFlow.jsx` renders values and is Ravi's
// (`project_partner_collab_branch`). The census prints it as
// `adopting=false (Ravi — ack before any edit)` and a quiet exclusion was
// refused there; it stays refused here. This rail removes it from nothing: it is
// in the population if and only if it adopts, which today it does not, so the
// ratchet neither protects nor accuses it. If it ever adopts, its baseline entry
// carries the same label, and the failure text says `ack before any edit` so
// nobody "fixes" a partner-owned file to re-green a rail.
//
// ── AST, NEVER GREP · AND THE TRANSCRIBED CENSUS LAYER ──────────────────────
//
// ⛔ Only a parsed module specifier is an edge. The census measured that a grep
// for `provenance/` over `app/src` reports
// `lib/presentation/presentationPrimitives.js` as an importer of the primitives
// — it imports none of them; all nine matches are PROSE in its comments.
//
// ⛔⛔ THE BLOCK BELOW IS TRANSCRIBED FROM `panelAdoption.measure.test.js`, NOT
// IMPORTED — for the same measured reason the census transcribes rather than
// imports `components/screener/reachable.test.js`: importing a file that calls
// `describe()` at top level registers ITS tests into THIS suite, so the census's
// six tests (and its product-state assertion) would land in this rail's totals
// line. It also exports none of what is needed (`edgesFromSource`,
// `isReExportAlias`, `ADOPT_TARGETS`, `adopts`, `PARTNER_OWNED`), so importing
// would not even work.
//
// ⭐ SO THE COPY IS PINNED AGAINST ITS SOURCE, TWICE. `the transcribed census
// layer is byte-identical` extracts the same anchored slice out of BOTH files
// and compares them; `the transcribed resolver is byte-identical` reaches
// through to `reachable.test.js`, which is where the resolver actually lives.
// That is the only thing that makes a second copy safe. If either goes red,
// re-transcribe the slice — do NOT edit the copy to agree with itself. The two
// anchors are the `CENSUS_OPEN` / `CENSUS_CLOSE` constants below: extract
// everything from the census's repo-root IIFE opener through the closing brace of
// its `reachesAdoption`, and paste it between the BEGIN/END markers here. ⭐ Both
// anchors are ASSEMBLED from fragments rather than written as one literal, for the
// reason the census records: a whole literal would appear TWICE in this file —
// once in the constant and once inside the transcription — and the uniqueness
// check would then fire on the instrument instead of on a real drift. It did,
// for the census, when it tried the obvious thing.
//
// ⚠️ The `BEGIN/END PINNED SLICE` markers inside the block are the CENSUS's own
// transcription markers, carried across verbatim. They are part of the bytes
// being compared; do not tidy them.
//
// ── NON-VACUITY: WHAT MUST BE TRUE BEFORE ANY VERDICT IS BELIEVED ───────────
//
// ⛔⛔ A ratchet over an empty population passes, prints a tidy `0 lost`, and
// reads exactly like a clean tree — so this file REFUSES before it asserts:
// the transcription has not drifted · the graph walk found a real graph · the
// population is non-empty · the detector can SEE a planted import and can tell
// an absent one · a re-export shim resolves to the primitive it fronts · a
// KNOWN adopter (`pages/research/tabs/NewsTab.jsx`) is in the population and in
// the baseline BY NAME · and `App.jsx` is not, so "adopts" is not just "returns
// true".
//
// ⛔⛔ AND THE MUTATION IS A PERMANENT TEST, NOT A NOTE IN A REPORT.
// `MUTATION, PERMANENT` takes a real adopter's real source, strips its
// provenance imports IN MEMORY, and asserts (i) the adoption predicate flips to
// false and (ii) `ratchetVerdict` then names that file in `missing`. Nothing on
// disk is touched — `edgesFromSource` takes its source as an argument precisely
// so a control can sever an edge without editing the working tree. On-disk
// mutations were also run against the baseline artifact (add a non-adopting
// path · drop a recorded adopter) and each one went red by name; those are
// reproducible from the shell and are recorded in the checkpoint, but the
// in-memory one is the version that cannot rot.
//
// ⛔ The re-export shim is not decoration here: `components/screener/CoverageLine.jsx`
// is a 13-line re-export of `provenance/CoverageLine`, and BOTH of the two
// adopters under `components/` reach a primitive ONLY through it. A naive import
// scan gets that wrong twice — it counts the shim as a fifth implementation and
// its importers as non-adopting — so a quarter of this population exists only
// because the alias set is DERIVED. `every adopter that reaches no primitive
// directly reaches one through a DERIVED alias` is that fact as an assertion.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

// ─── TRANSCRIBED VERBATIM FROM `provenance/panelAdoption.measure.test.js` ────
// ⛔ DO NOT EDIT THIS BLOCK BY HAND. It is byte-compared against that file — and
// through it against `components/screener/reachable.test.js` — by the first two
// tests below. Its own comments and markers are part of the transcription.
// ── BEGIN TRANSCRIBED CENSUS LAYER ──────────────────────────────────────────
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

// ── END TRANSCRIBED CENSUS LAYER ────────────────────────────────────────────

// ─── THE PINS ───────────────────────────────────────────────────────────────

const CENSUS_FILE = path.join(PROV_DIR, 'panelAdoption.measure.test.js')

/** ⛔ ASSEMBLED, NOT WRITTEN AS ONE LITERAL — a whole-literal anchor would appear
 *  twice in this file (here and inside the transcription) and `anchoredSlice`'s
 *  uniqueness refusal would fire on the instrument rather than on a real drift.
 *  The census measured exactly that on its own copy. */
const CENSUS_OPEN = ['const', 'ROOT = (() => {'].join(' ')
const CENSUS_CLOSE = ['\n  return ', 'false\n}\n'].join('')

/**
 * The anchored slice, read out of a FILE — never one side typed.
 *
 * ⛔ IT RAISES RATHER THAN RETURNING `''`. An empty result would make the
 * byte-comparison below pass over nothing, which is the failure this whole file
 * is written to avoid (`an empty result is a failed invocation until proven
 * otherwise`). The anchors must also be UNIQUE, or the slice is whatever came
 * first — checked here rather than assumed, because a future edit is what would
 * break it.
 */
function anchoredSlice(file, open, close, minBytes) {
  const src = read(file)
  const a = src.indexOf(open)
  if (a < 0) throw new Error(`anchoredSlice: open anchor not found in ${key(file)}`)
  const b = src.indexOf(close, a)
  if (b < 0) throw new Error(`anchoredSlice: close anchor not found in ${key(file)}`)
  if (src.indexOf(open, a + 1) >= 0) throw new Error(`anchoredSlice: open anchor is not unique in ${key(file)}`)
  if (src.indexOf(close, b + 1) >= 0) throw new Error(`anchoredSlice: close anchor is not unique in ${key(file)}`)
  const slice = src.slice(a, b + close.length)
  if (slice.length < minBytes) {
    throw new Error(`anchoredSlice: implausibly short (${slice.length}B < ${minBytes}B) in ${key(file)}`)
  }
  return slice
}

// ─── THE POPULATION ─────────────────────────────────────────────────────────

/**
 * ⭐⭐ THE POPULATION: THE ADOPTERS, DERIVED.
 *
 * Every tracked, non-test, reachable module under `app/src` that imports one of
 * the four primitives or a DERIVED re-export alias of one. No directory literal,
 * no exclusion list, no threshold — so a directory with zero adopters (the
 * Notebook's `pages/journal-2-0/components`, 204 non-adopting files, printed
 * below) contributes zero rows and therefore zero possible failures.
 *
 * ⚠️ NO `hasJsx` FILTER, deliberately: the census narrows to JSX modules because
 * it is answering "what could put a value on a screen", and a denominator needs
 * that. A RATCHET wants the widest honest numerator — a non-rendering module that
 * imports a primitive is still an adoption the tree would be poorer for losing.
 * Whether the two sets differ is not assumed; it is printed.
 *
 * ⛔⛔ BUT THE TARGETS ARE NOT ADOPTERS OF THEMSELVES — and this was MEASURED, not
 * foreseen: without the filter the population came back at 9, and the ninth was
 * `components/screener/CoverageLine.jsx`, the re-export SHIM. A shim satisfies
 * `adopts` trivially (its only edge IS a primitive), and it is scheduled for
 * DELETION once its two consumers are repointed — so counting it would file a
 * planned cleanup as a provenance regression and demand a hand edit to excuse
 * progress. `ADOPT_TARGETS` (the four primitives plus every derived alias) is
 * therefore subtracted. Derived, so a second shim is handled the day it appears.
 */
const POPULATION = REACHABLE_MODULES.filter((p) => !ADOPT_TARGETS.has(p)).filter(adopts)
const OBSERVED = POPULATION.map(key).sort()

/** The same predicate the ratchet uses, over a source string instead of the file
 *  on disk. ⛔ This is what lets the permanent mutation control sever an adopter's
 *  import without touching the working tree. `adopts(f)` must equal
 *  `adoptsSource(f, read(f))` for every member, and a test asserts it does —
 *  otherwise the mutation proves something about a different predicate. */
const adoptsSource = (file, src) => edgesFromSource(file, src).some((t) => ADOPT_TARGETS.has(t))

// ─── THE BASELINE ARTIFACT ──────────────────────────────────────────────────

const BASELINE_FILE = path.join(PROV_DIR, 'panelAdoption.baseline.json')
const UPDATE_ENV = 'UPDATE_PROVENANCE_ADOPTION_BASELINE'
const UPDATE_CMD = `cd app && ${UPDATE_ENV}=1 npx vitest run `
  + 'src/components/provenance/panelAdoption.ratchet.test.js'

const DEFAULT_NOTE = [
  'THE PROVENANCE ADOPTION RATCHET BASELINE. Read by panelAdoption.ratchet.test.js.',
  'NAMES, NEVER A COUNT: every number the rail prints is derived by counting this list.',
  `ADDING a name is mechanical: ${UPDATE_ENV}=1 npx vitest run src/components/provenance/panelAdoption.ratchet.test.js`,
  'REMOVING a name is a HAND EDIT. The update mode refuses to drop a path, so a',
  'regression cannot be laundered by re-running the generator. Retiring an adopter',
  'costs one reviewable line in a diff, with the reason in the commit message.',
  'Paths are repo-relative with forward slashes, sorted, and the file is LF with a',
  'trailing newline: the rail asserts these bytes are exactly what its writer',
  'produces, so appending one adopter is a one-line diff.',
  'coverage_line_exempt (TERM-047) is the OPPOSITE kind of list: SHRINK-ONLY and hand-edited.',
  'Each key is a derived result surface that renders no CoverageLine; each value is ONE line',
  'starting with its kind (not-a-result-set: / no-counts: / delegates:). The rail fails by name',
  'on an entry that outlives its gap, and no generator ever adds one.',
]

/** ⛔ ONE SHAPE, ONE KEY ORDER, ONE INDENT — so the round trip is IDEMPOTENT and
 *  an append is a one-line diff rather than a whole-file rewrite. Asserted, not
 *  promised, by `the committed baseline is byte-exactly what the writer produces`. */
//  TERM-047's `coverage_line_exempt` rides the SAME artifact, after the
//  adopters, and only when present — so a baseline without it serialises to the
//  bytes it always did. The writer carries it through VERBATIM and never adds a
//  key to it: that map is hand-edited only (see the TERM-047 section below).
const serialiseBaseline = (doc) => `${JSON.stringify({
  note: doc.note,
  adopters: doc.adopters,
  ...(doc.coverage_line_exempt ? { coverage_line_exempt: doc.coverage_line_exempt } : {}),
}, null, 2)}\n`

function writeBaselineFile(doc) {
  const text = serialiseBaseline(doc)
  const tmp = `${BASELINE_FILE}.tmp-${process.pid}`
  // ⛔ Encode to a temp file then rename — `open('w')` truncates before your write
  // can fail, and a half-written baseline reads as a mass regression.
  fs.writeFileSync(tmp, text, { encoding: 'utf8' })
  fs.renameSync(tmp, BASELINE_FILE)
  return text
}

/**
 * ⭐ THE RATCHET VERDICT — a pure function, so it can be table-tested and its
 * failure can be PROVED rather than described (`lesson_gate_that_cannot_fail`).
 *
 * `missing` is the regression: a panel the baseline records as adopting that does
 * not adopt any more. `added` is progress the baseline has not banked yet.
 */
function ratchetVerdict(recorded, observed) {
  const obs = new Set(observed)
  const rec = new Set(recorded)
  return {
    missing: recorded.filter((p) => !obs.has(p)),
    added: observed.filter((p) => !rec.has(p)),
  }
}

/**
 * ⛔⛔ `missing` CONFLATES THREE DIFFERENT FACTS, AND THE FIX FOR EACH IS
 * DIFFERENT — so the failure names the kind rather than just the path.
 *
 * The population is the reachable graph, so an adopter drops out of it when the
 * ROUTE that mounted it is deleted just as surely as when its import is removed.
 * A message that says "restore its provenance import" to somebody whose import is
 * still sitting there sends them to the wrong file and teaches them the rail is
 * unreliable. `lesson_a_guard_that_tests_the_adjacent_thing` in miniature: the
 * condition and the diagnosis are two sentences.
 */
function classifyMissing(rel) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) return 'DELETED — retire its baseline line BY HAND'
  if (!TRACKED.has(abs)) return 'UNTRACKED — git no longer tracks it'
  if (!REACHABLE_MODULES.includes(abs)) {
    return adoptsSource(abs, read(abs))
      ? 'UNREACHABLE but STILL IMPORTS — a routing/mount regression, NOT a provenance one'
      : 'UNREACHABLE and no longer importing — both wires are cut'
  }
  return 'STOPPED IMPORTING — restore its provenance import'
}

/**
 * ⛔⛔ THE UPDATE MODE ADDS AND NEVER REMOVES.
 *
 * This is the half that makes the baseline monotone. A generator that could drop
 * a name would turn every regression into a re-run, and the artifact would become
 * a snapshot of today rather than a record of the best the tree has ever done.
 */
function maybeUpdateBaseline() {
  if (process.env[UPDATE_ENV] !== '1') return
  const existing = fs.existsSync(BASELINE_FILE)
    ? JSON.parse(read(BASELINE_FILE))
    : { note: DEFAULT_NOTE, adopters: [] }
  const recorded = Array.isArray(existing.adopters) ? existing.adopters : []
  const { missing } = ratchetVerdict(recorded, OBSERVED)
  if (missing.length) {
    throw new Error(`REFUSING to update ${key(BASELINE_FILE)}: these recorded adopters no `
      + `longer adopt, and the update mode does not remove names —\n  ${missing.join('\n  ')}\n`
      + 'Either restore their provenance imports, or retire them by DELETING those lines '
      + 'from the baseline BY HAND, with the reason in the commit message. That removal is '
      + 'meant to be a deliberate, reviewable act; laundering it through a generator is not.')
  }
  const merged = [...new Set([...recorded, ...OBSERVED])].sort()
  writeBaselineFile({ note: existing.note ?? DEFAULT_NOTE, adopters: merged,
    coverage_line_exempt: existing.coverage_line_exempt })
}

maybeUpdateBaseline()

/** ⛔ Every refusal here exists because the thing it refuses would pass. */
function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    throw new Error(`REFUSING: the baseline artifact is missing (${key(BASELINE_FILE)}). `
      + `It is a COMMITTED artifact this rail reads, not something it may invent — run:\n  ${UPDATE_CMD}`)
  }
  const doc = JSON.parse(read(BASELINE_FILE))
  if (!Array.isArray(doc.adopters)) {
    throw new Error(`REFUSING: ${key(BASELINE_FILE)} has no \`adopters\` array.`)
  }
  if (doc.adopters.length === 0) {
    throw new Error(`REFUSING: ${key(BASELINE_FILE)} records no adopters — an EMPTY baseline `
      + 'satisfies every assertion below and prints a tidy "0 lost", which is exactly the '
      + 'vacuous pass this rail is written to avoid.')
  }
  if (new Set(doc.adopters).size !== doc.adopters.length) {
    throw new Error(`REFUSING: ${key(BASELINE_FILE)} lists a path twice.`)
  }
  const sorted = [...doc.adopters].sort()
  if (doc.adopters.some((p, i) => p !== sorted[i])) {
    throw new Error(`REFUSING: ${key(BASELINE_FILE)}'s adopter list is not sorted — an `
      + 'unsorted list makes every append a scattered diff.')
  }
  // TERM-047's exemption map: absent is not the same as empty, and an absent
  // map would make every result surface a violation — which is loud, so that is
  // allowed to fail in the rail below rather than here. A PRESENT map must be the
  // right shape, or its entries would be read as reasons they are not.
  const ex = doc.coverage_line_exempt
  if (ex !== undefined && (ex === null || typeof ex !== 'object' || Array.isArray(ex))) {
    throw new Error(`REFUSING: ${key(BASELINE_FILE)}'s \`coverage_line_exempt\` is not a `
      + '{ path: reason } map.')
  }
  return doc
}

const BASELINE = readBaseline()
const VERDICT = ratchetVerdict(BASELINE.adopters, OBSERVED)

/** ⛔ The population being non-empty is not enough — a graph that came back empty
 *  satisfies every filter above, and then the baseline's own names become the only
 *  thing that fails, which reads as a mass product regression. */
function assertInstrumentAlive() {
  if (TRACKED.size < 500) throw new Error(`REFUSING: git ls-files returned ${TRACKED.size} tracked modules`)
  if (REACHABLE.size < 200) throw new Error(`REFUSING: the walk reached ${REACHABLE.size} modules from ${ROOTS.length} roots`)
  const n = edgesOf(path.join(SRC, 'App.jsx')).length
  if (n < 20) throw new Error(`REFUSING: App.jsx resolved ${n} edges — the resolver is not resolving`)
  for (const p of PRIMITIVE_FILES) {
    if (!fs.existsSync(p)) throw new Error(`REFUSING: primitive missing from disk: ${key(p)}`)
  }
  if (POPULATION.length === 0) {
    throw new Error('REFUSING: the population is EMPTY — no module in the graph imports any of '
      + `${PRIMITIVE_FILES.map((p) => path.basename(p)).join(' · ')}. A ratchet over an empty `
      + 'population cannot fail.')
  }
}

/** ⛔ The other half: plant a real import and demand the detector sees it, then
 *  plant an unrelated one and demand it does not. Without both, "adopts" could be
 *  "returns true". */
function assertDetectorAlive() {
  const from = path.join(PAGES_DIR, 'research', 'tabs', 'NewsTab.jsx')
  const planted = edgesFromSource(from, "import P from '../../../components/provenance/Provenance'\n")
  if (!planted.includes(PRIMITIVE_FILES[0])) {
    throw new Error('REFUSING: the import detector cannot see a PLANTED import of '
      + `${key(PRIMITIVE_FILES[0])} — every verdict below would be about the instrument, `
      + `not the product. Resolved instead: ${JSON.stringify(planted.map(key))}`)
  }
  if (edgesFromSource(from, "import x from './useCompanyNews'\n").some((t) => ADOPT_TARGETS.has(t))) {
    throw new Error('REFUSING: the detector reports a primitive for a source that imports none '
      + '— it cannot distinguish adopting from not-adopting.')
  }
}

// ─── REPORTING ──────────────────────────────────────────────────────────────

const rows = (list) => (list.length ? list.map((p) => `      ${p}`) : ['      (none)']);

/** Adoption per directory, over the census's own JSX population — the frontier
 *  where the number can actually go up. ⛔ Derived and printed, never asserted:
 *  a per-directory threshold would red on every file move and buy no coverage the
 *  named set above does not already have. */
function frontier() {
  const jsx = REACHABLE_MODULES.filter(hasJsx)
  const tally = new Map()
  for (const p of jsx) {
    const rel = key(p).replace(/^app\/src\//, '')
    const dir = rel.split('/').slice(0, -1).join('/') || '(src root)'
    const t = tally.get(dir) ?? { total: 0, adopting: 0 }
    t.total += 1
    if (adopts(p)) t.adopting += 1
    tally.set(dir, t)
  }
  const adopting = [...tally.entries()].filter(([, t]) => t.adopting > 0)
    .sort((a, b) => b[1].adopting - a[1].adopting)
  const biggestGaps = [...tally.entries()].filter(([, t]) => t.adopting === 0)
    .sort((a, b) => b[1].total - a[1].total).slice(0, 6)
  return { adopting, biggestGaps, jsxTotal: jsx.length }
}

// ─── TESTS ──────────────────────────────────────────────────────────────────

describe('⛔ the instrument, before any verdict is believed', () => {
  it('⛔⛔ the transcribed census layer is byte-identical to panelAdoption.measure.test.js', () => {
    // ⭐ THE ONLY THING THAT MAKES A SECOND COPY SAFE. Both sides are extracted
    // from FILES by the same anchor pair — not one side typed. If this is red,
    // re-transcribe the slice out of the census; do NOT edit the copy.
    const mine = anchoredSlice(SELF, CENSUS_OPEN, CENSUS_CLOSE, 12000)
    const theirs = anchoredSlice(CENSUS_FILE, CENSUS_OPEN, CENSUS_CLOSE, 12000)
    expect(mine.length).toBeGreaterThan(12000)
    expect(mine, 'the transcription has DRIFTED from provenance/panelAdoption.measure.test.js')
      .toBe(theirs)
  })

  it('⛔ the transcribed resolver reaches through to components/screener/reachable.test.js', () => {
    // The census pins ITS copy of the resolver against `reachable.test.js` in its
    // own suite. That proves nothing inside THIS suite, so the chain is closed
    // here too — using the anchors the transcription itself carries.
    const mine = pinnedSlice(SELF)
    const theirs = pinnedSlice(SOURCE_OF_TRUTH)
    expect(mine.length).toBeGreaterThan(4000)
    expect(mine, 'the resolver has DRIFTED from components/screener/reachable.test.js').toBe(theirs)
  })

  it('⛔ the graph walk found a real graph and the population is non-empty', () => {
    expect(() => assertInstrumentAlive()).not.toThrow()
    // Named members rather than a count — a count can be satisfied by the wrong set.
    expect(REACHABLE_MODULES).toContain(path.join(SRC, 'App.jsx'))
    expect(REACHABLE_MODULES).toContain(path.join(SRC, 'components', 'ui', 'UIcon.jsx'))
    expect(POPULATION.length).toBeGreaterThan(0)
  }, 600000)

  it('⛔⛔ the detector can SEE a planted import, and can tell an absent one', () => {
    expect(() => assertDetectorAlive()).not.toThrow()
    const from = path.join(PAGES_DIR, 'research', 'tabs', 'NewsTab.jsx')
    const a = edgesFromSource(from, "import P from '../../../components/provenance/Cited'\n")
    const b = edgesFromSource(from, "import P from './useCompanyNews'\n")
    expect(a).not.toEqual(b)
  })

  it('⛔ the file-reading predicate and the source predicate are the SAME predicate', () => {
    // Otherwise the permanent mutation below proves something about a predicate
    // the ratchet does not use.
    for (const p of POPULATION) expect(adoptsSource(p, read(p)), key(p)).toBe(adopts(p))
    const app = path.join(SRC, 'App.jsx')
    expect(adoptsSource(app, read(app))).toBe(adopts(app))
  }, 600000)

  it('⛔ a RE-EXPORT SHIM resolves to the primitive it fronts, and the alias set is load-bearing', () => {
    // Synthetic first, so this holds after the real shim is deleted: the
    // classifier is handed a re-export body and must resolve it to the primitive…
    const shim = path.join(SRC, 'components', 'screener', '__synthetic__.jsx')
    expect(edgesFromSource(shim, "export { default } from '../provenance/CoverageLine'\n"))
      .toEqual([path.join(PROV_DIR, 'CoverageLine.jsx')])
    // …and every derived alias must actually BE a re-export, or the derivation is
    // admitting fifth implementations into the adopting set.
    for (const a of ALIASES) expect(isReExportAlias(a), key(a)).toBe(true)
    // ⭐ THE INVARIANT THAT MAKES `adopts` CORRECT, and a quarter of this
    // population depends on it: an adopter that reaches no primitive DIRECTLY must
    // reach one through a derived alias. Vacuously true the day the shim is
    // deleted and its consumers repointed — which is why the synthetic control
    // above carries the non-vacuity, not this.
    const direct = new Set(PRIMITIVE_FILES)
    const aliasOnly = POPULATION.filter((p) => !edgesOf(p).some((t) => direct.has(t)))
    for (const p of aliasOnly) {
      expect(edgesOf(p).some((t) => ALIASES.includes(t)), `${key(p)} adopts through neither a `
        + 'primitive nor a derived alias').toBe(true)
    }
  }, 600000)

  it('⛔ a KNOWN adopter is in the population AND in the baseline, BY NAME', () => {
    // ⚠️ The assertions here touch product state on purpose: without them this
    // rail can pass by seeing nothing. If `NewsTab` ever legitimately stops
    // importing a primitive, MOVE this to another real adopter — do not delete it.
    const newsTab = path.join(PAGES_DIR, 'research', 'tabs', 'NewsTab.jsx')
    expect(REACHABLE_MODULES, 'NewsTab.jsx is not reachable from the entry graph').toContain(newsTab)
    expect(adopts(newsTab), 'NewsTab.jsx imports Provenance + FreshnessBadge at :2-3').toBe(true)
    expect(OBSERVED).toContain('app/src/pages/research/tabs/NewsTab.jsx')
    expect(BASELINE.adopters).toContain('app/src/pages/research/tabs/NewsTab.jsx')
    // And the negative half, so "adopts" is not just "returns true":
    expect(adopts(path.join(SRC, 'App.jsx'))).toBe(false)
    expect(OBSERVED).not.toContain('app/src/App.jsx')
  }, 600000)

  it('⛔⛔ MUTATION, PERMANENT: strip a real adopter\'s imports and the ratchet names it', () => {
    const newsTab = path.join(PAGES_DIR, 'research', 'tabs', 'NewsTab.jsx')
    const rel = key(newsTab)
    const real = read(newsTab)
    const stripped = real.split('\n').filter((l) => !l.includes('components/provenance/')).join('\n')
    // ⛔ Non-vacuity of the mutation ITSELF: a strip that removed nothing would
    // make the two assertions below agree for the wrong reason.
    expect(stripped, 'the strip removed nothing — NewsTab no longer imports by that path')
      .not.toBe(real)
    expect(adoptsSource(newsTab, real), 'the unmutated source must adopt').toBe(true)
    expect(adoptsSource(newsTab, stripped), 'the mutated source must NOT adopt').toBe(false)
    // …and the ratchet must NAME it rather than report a number.
    const v = ratchetVerdict(BASELINE.adopters, OBSERVED.filter((p) => p !== rel))
    expect(v.missing).toEqual([rel])
    expect(v.added).toEqual([])
  })

  it('⛔ the ratchet verdict can FAIL — table cases, with a discriminator', () => {
    const A = 'app/src/a.jsx'; const B = 'app/src/b.jsx'; const C = 'app/src/c.jsx'
    expect(ratchetVerdict([A, B], [A, B])).toEqual({ missing: [], added: [] })
    expect(ratchetVerdict([A, B], [A])).toEqual({ missing: [B], added: [] })
    expect(ratchetVerdict([A], [A, C])).toEqual({ missing: [], added: [C] })
    expect(ratchetVerdict([A, B], [A, C])).toEqual({ missing: [B], added: [C] })
    expect(ratchetVerdict([A], [])).toEqual({ missing: [A], added: [] })
    // The discriminator: four different answers, so the function is not constant.
    const answers = new Set([[A, B], [A], [A, C], []]
      .map((o) => JSON.stringify(ratchetVerdict([A, B], o))))
    expect(answers.size).toBe(4)
  })

  it('⛔ a missing adopter is DIAGNOSED, not just named — and the branches differ', () => {
    const invented = 'app/src/pages/__does_not_exist__.jsx'
    expect(classifyMissing(invented)).toContain('DELETED')
    // Tracked, reachable, and it has never imported a primitive — the ordinary
    // "the import went away" diagnosis.
    expect(classifyMissing('app/src/App.jsx')).toContain('STOPPED IMPORTING')
    // The discriminator: two inputs, two different answers, so the classifier is
    // not one constant sentence wearing three labels.
    expect(classifyMissing(invented)).not.toBe(classifyMissing('app/src/App.jsx'))
    // ⭐ The UNREACHABLE branch is exercised against a DERIVED orphan rather than a
    // named one — naming a file would pin another rail's red state into this one.
    // `components/screener/reachable.test.js` owns the orphan list; this only
    // borrows a member of it if one exists, and says so when none does.
    const orphan = [...TRACKED].sort()
      .find((p) => underDir(p, SRC) && !isTestFile(p) && !REACHABLE.has(p))
    if (orphan) {
      expect(classifyMissing(key(orphan))).toContain('UNREACHABLE')
    } else {
      // eslint-disable-next-line no-console
      console.log('\n  ⚠️ no tracked unreachable module exists today, so the UNREACHABLE'
        + ' branch of classifyMissing() is currently unexercised by a real file.\n')
    }
  }, 600000)

  it('⛔ the committed baseline is byte-exactly what the writer produces', () => {
    // A round trip through a serialiser is how a 2-line edit becomes a 3,000-line
    // diff. It is safe HERE only because it is idempotent, and that is asserted
    // rather than assumed.
    expect(read(BASELINE_FILE), `${key(BASELINE_FILE)} is not in the writer's own shape — `
      + 'an append would rewrite the whole file').toBe(serialiseBaseline(BASELINE))
  })
})

describe('⭐⭐ the ratchet — adoption may not go backwards', () => {
  it('⭐⭐ every adopter the baseline records STILL ADOPTS — failing BY NAME', () => {
    assertInstrumentAlive()
    assertDetectorAlive()
    const partnerLabel = (p) => (PARTNER_OWNED.some((q) => key(q) === p)
      ? '   ⛔ (Ravi — ack before any edit; do NOT "fix" a partner-owned file to re-green this)'
      : '')
    expect(VERDICT.missing.map((p) => `${p}   ${classifyMissing(p)}${partnerLabel(p)}`),
      'PROVENANCE ADOPTION REGRESSED. These panels are recorded as adopting one of '
      + `${PRIMITIVE_FILES.map((p) => path.basename(p)).join(' · ')} and no longer import one `
      + '(directly or through a derived re-export alias). Restore the import, or — if the '
      + 'panel was deliberately retired — delete its line from '
      + `${key(BASELINE_FILE)} BY HAND, with the reason in the commit message.`)
      .toEqual([])
  }, 600000)

  it('⭐ the baseline is CURRENT — a new adopter is banked in the same commit', () => {
    // ⛔ WHY AN ADDITION IS ALSO RED, since it looks like punishing progress: a
    // baseline nobody updates decays into a record of an older tree, and the
    // panels that adopted since are protected by nothing. That is the "when was
    // this last true?" failure in its quietest form — no test goes red, the rail
    // just slowly stops covering anything. The cost of keeping it honest is one
    // command, and the diff it produces is the record of the gain.
    expect(VERDICT.added, 'NEW ADOPTERS ARE NOT RECORDED — this is progress, and the baseline '
      + `is behind. Bank it in the same commit:\n  ${UPDATE_CMD}`).toEqual([])
  }, 600000)

  it('prints the population, the frontier, and the labels', () => {
    const { adopting, biggestGaps, jsxTotal } = frontier()
    const direct = new Set(PRIMITIVE_FILES)
    const aliasOnly = POPULATION.filter((p) => !edgesOf(p).some((t) => direct.has(t))).map(key)
    const noJsx = POPULATION.filter((p) => !hasJsx(p)).map(key)
    const partner = PARTNER_OWNED.map((p) => `      ${key(p)}   adopting=${adopts(p)}`
      + '   (Ravi — ack before any edit)')
    // eslint-disable-next-line no-console
    console.log([
      '',
      '════ PROVENANCE ADOPTION RATCHET ══════════════════════════════════════',
      `  the four primitives : ${PRIMITIVE_FILES.map((p) => path.basename(p)).join(' · ')}`,
      `  re-export aliases   : ${ALIASES.length ? ALIASES.map(key).join(', ') : '(none)'}`,
      `  reachable modules   : ${REACHABLE_MODULES.length} tracked non-test under app/src`,
      `  of those, with JSX  : ${jsxTotal}`,
      '',
      `  POPULATION (${POPULATION.length}) — every reachable module that adopts, derived:`,
      ...rows(OBSERVED),
      '',
      `  baseline records ${BASELINE.adopters.length}  ·  observed ${OBSERVED.length}  ·  `
        + `lost ${VERDICT.missing.length}  ·  unbanked ${VERDICT.added.length}`,
      `  baseline file : ${key(BASELINE_FILE)}`,
      '',
      `  ⭐ ADOPTING ONLY THROUGH A DERIVED ALIAS (${aliasOnly.length}) — a naive import scan`,
      '     would call each of these NOT-adopting and the shim a fifth implementation:',
      ...rows(aliasOnly),
      '',
      `  adopters without JSX (${noJsx.length}) — the gap between this population and the`,
      "     census's JSX-filtered D-ALL adopting set, derived rather than assumed. Empty",
      '     means the two coincide today, which is why the census\'s number can be read',
      '     straight across:',
      ...rows(noJsx),
      '',
      '── THE FRONTIER — where the number can go up ───────────────────────────',
      '   ⭐ directories that already show provenance, adopting / with-JSX:',
      ...adopting.map(([d, t]) => `      ${String(t.adopting).padStart(4)} / ${String(t.total).padEnd(5)} ${d}`),
      '',
      '── THE LARGEST ZERO-ADOPTION DIRECTORIES ───────────────────────────────',
      '   ⛔ derived, printed, and asserted over by NOTHING. The top row is why the',
      '      population above is the adopter set and not `pages/**`: a rail scoped',
      '      there is a Notebook rail wearing a provenance label. No literal in this',
      '      file names it — it is absent from the population because it has no',
      '      adopters, so the day it gains one this rail protects that gain instead.',
      ...biggestGaps.map(([d, t]) => `      ${String(t.total).padStart(4)}  ${d}`),
      '',
      '── PARTNER-OWNED, LABELLED NOT FILTERED ────────────────────────────────',
      ...(partner.length ? partner : ['      (none declared)']),
      '',
      '═══════════════════════════════════════════════════════════════════════',
      '',
    ].join('\n'))
  }, 600000)
})

// ─── TERM-047 (FB-A9-02) — `CoverageLine` ON EVERY RESULT SURFACE ─────────────
//
// The spec's own test: *"A rail DERIVES the set of result surfaces and fails by
// name on one that does not route through the component"* — and it names this
// family of rails (`i1S8Boundary.test.js`'s shape) as the one to extend rather
// than rewrite. So it lives HERE, on the census layer above, and reuses its graph,
// its resolver, its derived alias set and its baseline artifact. No second walk.
//
// ── THE CRITERION: WHAT A "RESULT SURFACE" IS ───────────────────────────────
//
// The spec places the receipt in row A9 (Screening & Discovery) and says what it
// is FOR: best-of-breed §6.1 item 5, *"`CoverageLine`'s four counts distinguish
// 'no match' from 'cannot compute'"*. A result surface is therefore a surface
// showing the answer to a SCREEN — a predicate evaluated over a universe, where
// "no match" and "cannot compute" are different facts. Mechanically, a module is
// one when ALL of these hold on its AST:
//
//   (1) it is tracked, non-test and REACHABLE from the app's entry graph (the
//       census's own `REACHABLE_MODULES` — a harness page is not a member door);
//   (2) it has JSX — it can put a list on a screen;
//   (3) its OWN DATA DOOR addresses an A9 route: a `/api/…` string literal (or a
//       template literal's head) whose route FAMILY — the first segment after
//       `/api/` — has a word beginning `scan` or `screen` (`/api/scans/*`,
//       `/api/screener/*`, `/api/volume-scan/*`). "Its own door" is the module
//       itself plus every React HOOK (`use[A-Z]…`, no JSX) it imports directly,
//       because a hook is how a component in this app fetches.
//
// THE SET IS DERIVED; THE VOCABULARY IS NOT, AND IT IS TWO WORDS. The spec's
// gloss "filtered / screened / searched" was MEASURED as a vocabulary first
// (`scan|screen|search|filter` over every route literal): it adds ticker
// autocomplete (`/api/ticker-search`, eight modules), document and transcript
// text search, and the AI-search admin panel. Not one of those evaluates a
// predicate over a universe, so "not computable" has no meaning on any of them,
// and filing them as exemptions would be the 519-row register this file's header
// already refused (why-not (a)). They stay out by criterion, and a control below
// proves the criterion keeps `CommandPalette.jsx` out.
//
// WHAT IT DOES NOT SEE, stated so a green run is not read as more:
//   • a route named ONLY in a non-hook helper module (`screenShareLink.js`'s
//     path constants reach `App.jsx` and `SharedScreen.jsx` that way — measured;
//     neither renders a result set, which is why helpers are not followed);
//   • a result list served from outside the A9 route namespaces (`/api/candidates`,
//     `/api/nhnl`). Widening is a one-word change to `RESULT_FAMILY_STEMS`, and
//     the rail will then NAME every surface the widening admits.
//
// ── WHAT "ROUTES THROUGH THE COMPONENT" MEANS ────────────────────────────────
//
// A surface routes through `CoverageLine` when it RENDERS it ITSELF — a parsed
// JSX element bound to a default import that resolves to
// `provenance/CoverageLine.jsx` or a derived alias of it (the screener shim). An
// import alone is not a render (`adopts` above is the ratchet's weaker question,
// and the right one THERE).
//
// NOT "OR THROUGH A CHILD" — AND THAT WAS MEASURED, NOT ASSUMED. The first
// version of this rail also accepted ONE hop (a rendered child whose own module
// renders the line). Its own permanent mutation below then stripped
// `ScanResults`' CoverageLine import — and the rail still called ScanResults
// routed, because it renders `<EvidenceTab>`, which renders a BACKTEST's receipt.
// A child's line is that child's query's receipt, not this surface's: one hop was
// already enough to launder a missing receipt, so the closure would be worse. A
// surface whose answer genuinely lives in a child (`ScreensManager` →
// `<ScanResults>`) is a DECLARED delegation — see `delegates:` below — and the
// rail checks that the delegate it names really does render the line.
//
// ── THE EXEMPTIONS: SHRINK-ONLY, ONE LINE EACH ──────────────────────────────
//
// `coverage_line_exempt` in `panelAdoption.baseline.json` — `{ path: reason }`,
// sorted, hand-edited as TEXT. Every reason starts with its KIND, so the list
// reads as a to-do list rather than a pile:
//
//   `not-a-result-set:` the door is A9 but the surface lists no screen answer
//                       (methodology, a catalogue, saved-screen controls);
//   `no-counts:`        a result set whose backend does NOT return the four
//                       counts. Adopting there means fabricating them, which
//                       is the defect this component exists to prevent — the
//                       follow-up is a BACKEND receipt, then the adoption;
//   `delegates:`        the surface hands its answer to another that renders it.
//                       The reason must NAME that delegate by repo path, and
//                       the rail checks the named module renders CoverageLine
//                       itself — so a delegation cannot outlive its delegate.
//
// THE LIST CAN ONLY SHRINK, enforced the way `AWAITING_A_DECISION` and
// `RECORDED_BOUNDARY_DEBT` are: an entry that no longer names a NON-routing
// result surface FAILS BY NAME (it adopted, or it stopped being a result
// surface), so an entry cannot outlive the gap it records; and no generator
// writes this map — the update mode above carries it through verbatim. Adding
// a line is a decision recorded in a diff with its reason beside it.

const COVERAGE_LINE_FILE = path.join(PROV_DIR, 'CoverageLine.jsx')

/** CoverageLine and every DERIVED alias that fronts it — never a typed path. */
const COVERAGE_TARGETS = new Set([COVERAGE_LINE_FILE,
  ...ALIASES.filter((a) => edgesOf(a).includes(COVERAGE_LINE_FILE))])

/** The A9 route-family stems. The ONE hand-typed input here; see the header. */
const RESULT_FAMILY_STEMS = ['scan', 'screen']

const EXEMPT_KINDS = ['not-a-result-set:', 'no-counts:', 'delegates:']

const routeWords = (s) => String(s)
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** `/api/scans/period-change?start=` → `scans`. */
const routeFamily = (route) => String(route).split(/[?#]/)[0].split('/')[2] || ''

const isResultRoute = (route) => String(route).startsWith('/api/')
  && routeWords(routeFamily(route)).some((w) => RESULT_FAMILY_STEMS.some((s) => w.startsWith(s)))

/** Every `/api/…` route this AST names: a string literal, or a template
 *  literal's HEAD (`/api/scans/${key}` → `/api/scans/`). A comment is not a
 *  node, so prose naming a route is not a door. */
function apiRoutesIn(ast) {
  const out = []
  walk(ast, (n) => {
    let s = null
    if (n.type === 'Literal' && typeof n.value === 'string') s = n.value
    else if (n.type === 'TemplateLiteral' && n.quasis?.length) s = n.quasis[0].value?.cooked
    if (typeof s === 'string' && s.startsWith('/api/')) out.push(s)
  })
  return out
}

const jsxIn = (ast) => {
  let found = false
  walk(ast, (n) => { if (typeof n.type === 'string' && n.type.startsWith('JSX')) found = true })
  return found
}

/** A React hook module: named `use[A-Z]…` and puts nothing on screen itself. */
const isHookModule = (file) => /^use[A-Z]/.test(path.basename(file)) && !hasJsx(file)

/**
 * The A9 routes a module's OWN data door addresses, as `{ route, via }` — `via`
 * is the hook it came through, or null for the module itself. Takes the source
 * as an argument so the planted controls classify a module that is not on disk.
 * `hooks: false` exists for the control that proves the hook hop is load-bearing.
 */
function resultDoorsOf(file, src, { hooks = true } = {}) {
  const ast = parse(src)
  const own = apiRoutesIn(ast).filter(isResultRoute).map((route) => ({ route, via: null }))
  if (!hooks) return own
  const via = edgesFromSource(file, src).filter(isHookModule)
    .flatMap((h) => apiRoutesIn(astOf(h)).filter(isResultRoute).map((route) => ({ route, via: h })))
  return [...own, ...via]
}

const isResultSurfaceSource = (file, src) => jsxIn(parse(src)) && resultDoorsOf(file, src).length > 0

/** Local component names bound to an import, and the module(s) each resolves to. */
function importTable(file, ast) {
  const table = new Map()
  for (const n of ast.body) {
    if (n.type !== 'ImportDeclaration' || typeof n.source?.value !== 'string') continue
    const targets = resolve(file, n.source.value)
    for (const s of n.specifiers || []) {
      if (s.type === 'ImportNamespaceSpecifier') continue
      table.set(s.local.name, { targets, isDefault: s.type === 'ImportDefaultSpecifier'
        || (s.type === 'ImportSpecifier' && s.imported?.name === 'default') })
    }
  }
  return table
}

/** Every JSX element name this AST renders (`<X>` and `<a.X>` → `X`). */
function renderedNames(ast) {
  const out = new Set()
  walk(ast, (n) => {
    if (n.type !== 'JSXOpeningElement' || !n.name) return
    if (n.name.type === 'JSXIdentifier') out.add(n.name.name)
    if (n.name.type === 'JSXMemberExpression' && n.name.object?.type === 'JSXIdentifier') {
      out.add(n.name.object.name)
    }
  })
  return out
}

/** Does this source RENDER `<CoverageLine>` ITSELF — an element bound to a
 *  DEFAULT import of the component or a derived alias of it? */
function rendersCoverageLineSource(file, src) {
  const ast = parse(src)
  const table = importTable(file, ast)
  return [...renderedNames(ast)].some((name) => {
    const b = table.get(name)
    return !!b && b.isDefault && b.targets.some((t) => COVERAGE_TARGETS.has(t))
  })
}

/** `'direct'` or `null`. No child hop — the header records the measurement
 *  that removed it. */
const coverageRouting = (file, src) => (rendersCoverageLineSource(file, src) ? 'direct' : null)

const rendersCoverageLine = (file) => rendersCoverageLineSource(file, read(file))

const routingLabel = (r) => (r ? 'direct' : 'NONE')

/** The repo paths a `delegates:` reason names (`app/src/<path>.jsx`). */
const delegatesNamedIn = (why) => [...String(why).matchAll(/app\/src\/[\w./-]+\.(?:jsx|js|tsx|ts)/g)]
  .map((m) => m[0])

// ── the derived set ─────────────────────────────────────────────────────────

const RESULT_SURFACES = REACHABLE_MODULES
  .filter((p) => !ADOPT_TARGETS.has(p) && hasJsx(p))
  .filter((p) => isResultSurfaceSource(p, read(p)))
  .map((p) => ({ abs: p, rel: key(p), routing: coverageRouting(p, read(p)), doors: resultDoorsOf(p, read(p)) }))

/**
 * THE VERDICT — pure, so its failure is PROVED by table cases rather than
 * described. `violations`: a result surface that renders no CoverageLine and is
 * not exempt. `stale`: an exemption that no longer names a non-routing result
 * surface — the shrink half.
 */
function coverageVerdict(surfaces, exempt) {
  const bySurface = new Map(surfaces.map((s) => [s.rel, s]))
  return {
    violations: surfaces.filter((s) => !s.routing && !Object.hasOwn(exempt, s.rel)).map((s) => s.rel),
    stale: Object.keys(exempt).filter((rel) => !bySurface.has(rel) || !!bySurface.get(rel).routing),
  }
}

const staleWhy = (rel) => {
  const s = RESULT_SURFACES.find((x) => x.rel === rel)
  if (!s) {
    return fs.existsSync(path.join(ROOT, rel))
      ? 'is NO LONGER A RESULT SURFACE (no A9 door, no JSX, or unreachable) — delete its line'
      : 'was DELETED — delete its line'
  }
  return `now routes through CoverageLine (${routingLabel(s.routing)}) — the gap is closed, delete its line`
}

const EXEMPT = BASELINE.coverage_line_exempt ?? {}
const COVERAGE_VERDICT = coverageVerdict(RESULT_SURFACES, EXEMPT)

describe('TERM-047 — CoverageLine on every result surface', () => {
  it('the derivation is not vacuous: a known member BY NAME, and it discriminates', () => {
    assertInstrumentAlive()
    expect(RESULT_SURFACES.length, 'no result surface was derived — every assertion below would '
      + 'pass over an empty set').toBeGreaterThan(0)
    // The door a member walks through (CLAUDE.md), by name, rendering the line itself.
    const scan = RESULT_SURFACES.find((s) => s.rel === 'app/src/components/screener/ScanResults.jsx')
    expect(scan, 'ScanResults.jsx is not in the derived set — the criterion lost the screener').toBeTruthy()
    expect(scan.routing, 'ScanResults.jsx renders <CoverageLine> at the foot of the result set').toBe('direct')
    expect(scan.doors.map((d) => d.route)).toContain('/api/scans/definition-results')
    // THE NEGATIVES, so "is a result surface" is not "returns true": a reachable
    // search surface on a NON-A9 route, and the app root.
    const palette = path.join(SRC, 'components', 'CommandPalette.jsx')
    expect(REACHABLE_MODULES, 'CommandPalette.jsx is not reachable — pick another negative').toContain(palette)
    expect(apiRoutesIn(astOf(palette)).some((r) => r.startsWith('/api/ticker-search')),
      'CommandPalette no longer names /api/ticker-search — this negative measures nothing').toBe(true)
    expect(RESULT_SURFACES.map((s) => s.rel)).not.toContain(key(palette))
    expect(RESULT_SURFACES.map((s) => s.rel)).not.toContain('app/src/App.jsx')
  }, 600000)

  it('THE HOOK HOP IS LOAD-BEARING: the screener shell is a surface only through its hooks', () => {
    const shell = path.join(PAGES_DIR, 'screener', 'shell', 'ScannerShell.jsx')
    const src = read(shell)
    expect(resultDoorsOf(shell, src, { hooks: false }), 'ScannerShell names an A9 route itself now — '
      + 'this control no longer isolates the hook hop; pick another hook-only surface').toEqual([])
    const viaHooks = resultDoorsOf(shell, src)
    expect(viaHooks.map((d) => path.basename(d.via || '')))
      .toEqual(expect.arrayContaining(['useScreenerScan.js']))
    expect(RESULT_SURFACES.map((s) => s.rel)).toContain(key(shell))
  }, 600000)

  it('the classifier: a route stem, a template head, a hook, and prose are told apart', () => {
    expect(isResultRoute('/api/scans/definition-results')).toBe(true)
    expect(isResultRoute('/api/screener/scan')).toBe(true)
    expect(isResultRoute('/api/volume-scan/live?show_all=1')).toBe(true)
    expect(isResultRoute('/api/ticker-search?q=')).toBe(false)
    expect(isResultRoute('/api/j2/notes/enrichment/scan')).toBe(false)   // family `j2`
    expect(isResultRoute('/api/ai-search/stream')).toBe(false)
    const from = path.join(PAGES_DIR, '__planted__', 'Planted.jsx')
    expect(isResultSurfaceSource(from, "// fetch('/api/scans/x')\nexport default () => <ul />\n"),
      'a route named in a COMMENT was read as a door — this is a grep wearing an AST').toBe(false)
    expect(isResultSurfaceSource(from, 'const u = `/api/scans/${k}`\nexport default () => <ul />\n')).toBe(true)
    expect(isResultSurfaceSource(from, "const u = '/api/scans/x'\nexport const f = () => u\n"),
      'a module with no JSX cannot put a list on screen').toBe(false)
  })

  it('every exemption has a KIND and a one-line reason, and the map is sorted', () => {
    const rows = Object.entries(EXEMPT)
    expect(rows.length, 'coverage_line_exempt is absent or empty — if every result surface '
      + 'routes through CoverageLine, delete this assertion; otherwise the map was lost').toBeGreaterThan(0)
    for (const [rel, why] of rows) {
      expect(typeof why, rel).toBe('string')
      expect(why.includes('\n'), `${rel}: the reason must be ONE line`).toBe(false)
      expect(EXEMPT_KINDS.some((k) => why.startsWith(k)),
        `${rel}: the reason must start with one of ${EXEMPT_KINDS.join(' ')} — got "${why}"`).toBe(true)
      expect(why.length, `${rel}: a kind with no reason after it is not a reason`).toBeGreaterThan(30)
    }
    const keys = rows.map(([k]) => k)
    expect(keys, 'coverage_line_exempt keys are not sorted').toEqual([...keys].sort())
  })

  it('a `delegates:` exemption names its delegate, and the delegate RENDERS the line', () => {
    const delegations = Object.entries(EXEMPT).filter(([, why]) => why.startsWith('delegates:'))
    const broken = []
    for (const [rel, why] of delegations) {
      const named = delegatesNamedIn(why)
      if (named.length === 0) { broken.push(`${rel}: names no delegate path`); continue }
      for (const d of named) {
        const abs = path.join(ROOT, ...d.split('/'))
        if (!fs.existsSync(abs)) broken.push(`${rel}: delegate ${d} does not exist`)
        else if (!rendersCoverageLine(abs)) broken.push(`${rel}: delegate ${d} renders no <CoverageLine>`)
      }
    }
    expect(broken, 'A DELEGATION WHOSE DELEGATE NO LONGER RENDERS THE RECEIPT is an exemption '
      + 'for a gap nobody covers. Adopt CoverageLine on the surface, or correct the reason.').toEqual([])
    // The check can fail: a delegation naming a module with no line is caught.
    const planted = 'delegates: app/src/App.jsx renders it (planted control)'
    const plantedAbs = path.join(ROOT, ...delegatesNamedIn(planted)[0].split('/'))
    expect(rendersCoverageLine(plantedAbs)).toBe(false)
  }, 600000)

  it('every result surface renders CoverageLine or is exempt with a reason — FAILING BY NAME', () => {
    expect(COVERAGE_VERDICT.violations.map((rel) => {
      const s = RESULT_SURFACES.find((x) => x.rel === rel)
      return `${rel}   doors: ${[...new Set(s.doors.map((d) => d.route))].join(' ')}`
    }), 'RESULT SURFACES WITHOUT A COVERAGE RECEIPT. Each of these shows the answer to a screen '
      + '(an A9 route) and renders no <CoverageLine> — so a screen that silently loses symbols '
      + 'reads as a quiet market. Render <CoverageLine coverage={…}/> from the BACKEND\'s four counts, '
      + `or — if the backend returns none, or this is not a result set — add a one-line reason to `
      + `coverage_line_exempt in ${key(BASELINE_FILE)} (${EXEMPT_KINDS.join(' ')}).`)
      .toEqual([])
  }, 600000)

  it('the exemption list can only SHRINK — an entry outliving its gap fails by name', () => {
    expect(COVERAGE_VERDICT.stale.map((rel) => `${rel}   ${staleWhy(rel)}`),
      `STALE EXEMPTIONS in ${key(BASELINE_FILE)} coverage_line_exempt. An entry that outlives the `
      + 'gap it records is a standing excuse: the day the surface regresses, it would stay green.')
      .toEqual([])
  }, 600000)

  it('PLANTED VIOLATION: a new result surface with no receipt is NAMED', () => {
    // A module that is not on disk, classified by the SAME functions the rail
    // uses, joined to the real derived set.
    const planted = path.join(PAGES_DIR, 'screener', '__planted__', 'PlantedResults.jsx')
    const src = "import { useEffect, useState } from 'react'\n"
      + 'export default function PlantedResults() {\n'
      + '  const [rows, setRows] = useState([])\n'
      + "  useEffect(() => { fetch('/api/scans/planted').then((r) => r.json()).then((d) => setRows(d.rows)) }, [])\n"
      + '  return <ul>{rows.map((r) => <li key={r.sym}>{r.sym}</li>)}</ul>\n'
      + '}\n'
    expect(isResultSurfaceSource(planted, src)).toBe(true)
    expect(coverageRouting(planted, src)).toBe(null)
    const rel = key(planted)
    const v = coverageVerdict([...RESULT_SURFACES, { rel, routing: null, doors: [] }], EXEMPT)
    expect(v.violations).toContain(rel)
    // …and the same module, rendering the line, is NOT named.
    const fixed = "import CoverageLine from '../../../components/provenance/CoverageLine'\n"
      + src.replace('return <ul>', 'return <><CoverageLine coverage={null} /><ul>').replace('</ul>\n', '</ul></>\n')
    expect(coverageRouting(planted, fixed)).toBe('direct')
  })

  it('MUTATION, PERMANENT: strip ScanResults\' CoverageLine import and the rail names it', () => {
    const abs = path.join(SRC, 'components', 'screener', 'ScanResults.jsx')
    const rel = key(abs)
    const real = read(abs)
    const stripped = real.split('\n').filter((l) => !/^import\s+CoverageLine\b/.test(l)).join('\n')
    expect(stripped, 'the strip removed nothing — ScanResults imports CoverageLine differently now')
      .not.toBe(real)
    expect(coverageRouting(abs, real)).toBe('direct')
    expect(coverageRouting(abs, stripped), 'an element with no import binding still counted — the '
      + 'render check is matching a NAME, not a resolved import').toBe(null)
    const surfaces = RESULT_SURFACES.map((s) => (s.rel === rel ? { ...s, routing: null } : s))
    // The mutation's OWN effect, net of whatever the live tree already reports:
    // exactly one new violation, and it is the stripped surface, by name.
    const added = coverageVerdict(surfaces, EXEMPT).violations
      .filter((x) => !COVERAGE_VERDICT.violations.includes(x))
    expect(added).toEqual([rel])
  }, 600000)

  it('an IMPORT is not a RENDER, and a NAMED import is not the component', () => {
    const from = path.join(PAGES_DIR, 'screener', '__planted__', 'Planted.jsx')
    const importOnly = "import CoverageLine from '../../../components/provenance/CoverageLine'\n"
      + "const u = '/api/scans/x'\nexport default () => <ul data-u={u} />\n"
    expect(coverageRouting(from, importOnly)).toBe(null)
    // The SHIM counts, because the alias set is derived — the screener imports it that way.
    const viaShim = "import CoverageLine from '../../../components/screener/CoverageLine'\n"
      + 'export default () => <CoverageLine coverage={null} />\n'
    expect(coverageRouting(from, viaShim)).toBe('direct')
  })

  it('the verdict can FAIL both ways — table cases, with a discriminator', () => {
    const A = { rel: 'a.jsx', routing: 'direct', doors: [] }
    const B = { rel: 'b.jsx', routing: null, doors: [] }
    const C = { rel: 'c.jsx', routing: 'direct', doors: [] }
    expect(coverageVerdict([A, B, C], {})).toEqual({ violations: ['b.jsx'], stale: [] })
    expect(coverageVerdict([A, B, C], { 'b.jsx': 'r' })).toEqual({ violations: [], stale: [] })
    expect(coverageVerdict([A, B, C], { 'b.jsx': 'r', 'a.jsx': 'r' })).toEqual({ violations: [], stale: ['a.jsx'] })
    expect(coverageVerdict([A, C], { 'b.jsx': 'r' })).toEqual({ violations: [], stale: ['b.jsx'] })
    expect(coverageVerdict([A, B, C], { 'c.jsx': 'r' })).toEqual({ violations: ['b.jsx'], stale: ['c.jsx'] })
    // The stale guard, on the REAL set: exempting a surface that renders the line is caught.
    const real = coverageVerdict(RESULT_SURFACES,
      { ...EXEMPT, 'app/src/components/screener/ScanResults.jsx': 'delegates: planted stale entry for the control' })
    expect(real.stale).toContain('app/src/components/screener/ScanResults.jsx')
  }, 600000)

  it('prints the derived set, how each routes, and the exemptions by kind', () => {
    const rows = RESULT_SURFACES.map((s) => {
      const mark = s.routing ? `routes ${routingLabel(s.routing)}` : (Object.hasOwn(EXEMPT, s.rel) ? 'EXEMPT' : 'VIOLATION')
      const doors = [...new Set(s.doors.map((d) => (d.via ? `${path.basename(d.via)}→${d.route}` : d.route)))]
      return `      ${mark.padEnd(28)} ${s.rel}\n${' '.repeat(35)}${doors.join('  ')}`
    })
    const byKind = EXEMPT_KINDS.map((k) => {
      const hits = Object.entries(EXEMPT).filter(([, why]) => why.startsWith(k))
      return [`   ${k} ${hits.length}`, ...hits.map(([rel, why]) => `      ${rel}\n         ${why}`)]
    }).flat()
    // eslint-disable-next-line no-console
    console.log([
      '',
      '════ TERM-047 — CoverageLine ON EVERY RESULT SURFACE ═════════════════════',
      `  route-family stems : ${RESULT_FAMILY_STEMS.join(' · ')}   (A9 Screening & Discovery)`,
      `  CoverageLine doors : ${[...COVERAGE_TARGETS].map(key).join(', ')}`,
      `  RESULT SURFACES (${RESULT_SURFACES.length}), derived:`,
      ...rows,
      '',
      `  routing ${RESULT_SURFACES.filter((s) => s.routing).length}  ·  exempt `
        + `${RESULT_SURFACES.filter((s) => !s.routing && Object.hasOwn(EXEMPT, s.rel)).length}  ·  violations `
        + `${COVERAGE_VERDICT.violations.length}  ·  stale exemptions ${COVERAGE_VERDICT.stale.length}`,
      '',
      '── EXEMPTIONS BY KIND — the follow-up list ─────────────────────────────',
      ...byKind,
      '═══════════════════════════════════════════════════════════════════════',
      '',
    ].join('\n'))
  }, 600000)
})
