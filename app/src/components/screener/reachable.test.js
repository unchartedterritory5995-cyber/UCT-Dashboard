// app/src/components/screener/reachable.test.js
//
// ─── 🔴 THE RAIL THAT CATCHES THE NEXT SUPERSEDED FILE THE DAY IT STOPS BEING
//     IMPORTED ────────────────────────────────────────────────────────────────
//
// `Screener.scanmount.test.jsx` proves ONE surface is reachable, and it had to
// be written by hand after the defect was found by hand. This file asks the
// structural question instead: **is every module under `app/src` reachable from
// the app's entry point at all?** — by walking the real import graph from
// `App.jsx` with an AST.
//
// ⛔ AN AST, NEVER A GREP. `lesson_probe_names_must_be_derived_not_typed`: a grep
// for a module name reports the import line, the comment above it and every
// piece of prose that mentions it — this repo has already measured a probe that
// "found 5 call sites, all five of them prose". Only a parsed module specifier
// is an edge.
//
// ⭐ AND THE OTHER HALF OF THAT LESSON, WHICH COST MORE: **a walk that misses one
// import FORM manufactures orphans.** A census on 2026-08-09 reported *"48
// modules unreachable"* and named `components/ui/*` among them — `UIcon` has 222
// import statements. Acting on that list would have deleted the icon system off
// every screen. So the resolver below follows EVERY form this codebase actually
// uses, and two of them were found only because the walk called a live module
// dead:
//
//   * `new Worker(new URL('./flow.worker.js', import.meta.url))` — how
//     `pages/optionsFlow/flowWorkerClient.js` reaches the flow worker. Neither
//     an import nor a require; missing it reported a shipped worker as an orphan.
//   * `?raw` / `?quarterwire` query suffixes — a Vite specifier with a query is
//     still an edge to the module.
//
// ⭐ THE ENTRY POINTS ARE READ OFF `vite.config.js`, NOT LISTED HERE. `main.jsx`
// is not the only thing Vite loads: `test.setupFiles` and the `resolve.alias`
// stub are entry points too, and a hand-list of them here would be a second
// authority over a fact the config already owns — this repo's most repeated
// defect. `configEntryPoints()` parses the config and takes every string literal
// in it that resolves to a real file under `app/src`. Rename the setup file and
// update the config: still green. Delete the config line: correctly red.
//
// ⚠️ SCOPE IS NOW ALL OF `app/src`. It was one directory while four agents were
// adding files at once; the census that justified widening it is
// `.superpowers/sdd/audit/fix-final-two-report.md`.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

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

/** Every shipped module under `app/src` — ⛔ DERIVED by walking the tree, never
 *  listed. A hand-list would agree with today's contents right up until somebody
 *  adds the next unreachable file, which is the whole failure mode. */
function shippedModules(dir = SRC, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') shippedModules(p, out) }
    else if (CODE_EXT.includes(path.extname(e.name))
      && !/\.(test|spec)\.(js|jsx|ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

/**
 * Every module git TRACKS under `app/src`.
 *
 * ⭐ THE SWEEP JUDGES WHAT IS COMMITTED, AND ONLY THAT. Four agents work this
 * worktree at once; a file that exists on disk but is untracked is somebody's
 * half-written module, not a shipped orphan, and failing on it makes this rail
 * the thing that blocks everyone — which is how a rail gets deleted rather than
 * read (`a rail that ALWAYS fails is as useless as one that CANNOT fail`).
 *
 * ⛔ AND IT CANNOT HIDE ANYTHING, WHICH IS THE ONLY REASON IT IS ALLOWED. The
 * exemption lasts exactly until the author commits, at which point the file is
 * judged like everything else — nobody can park an orphan here, because parking
 * it requires never committing it. `git ls-files` is also asked, never guessed:
 * the two assertions in "the walk itself is not vacuous" refuse a tracked set
 * that came back empty or that is missing files this rail already knows exist,
 * so a broken git read goes RED instead of silently exempting the whole tree.
 */
function trackedModules() {
  const out = execFileSync('git', ['ls-files', '--', 'app/src'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return new Set(out.split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((p) => CODE_EXT.includes(path.extname(p)))
    .map((p) => path.join(ROOT, p)))
}

/** Test infrastructure, recognised BY PATH rather than by a per-file list.
 *
 *  ⛔ "ONLY TESTS IMPORT IT" IS NOT THE RULE, and that distinction is the whole
 *  value of this rail. `MobileChartFallback`, `BrokerSyncStatus`, `CustomScan`
 *  and seven others were each imported by exactly one live, green test and by no
 *  screen — a blanket test-only exemption would have excused every one of them.
 *  These four markers say "this file's JOB is to support tests", which is a
 *  property of where it lives, not of who happens to import it today. */
const TEST_INFRA = /(^|[\\/])(__tests__|__fixtures__|__mocks__|testing|test-stubs)[\\/]|(^|[\\/])test-[^\\/]*$/

/**
 * Unreachable ON PURPOSE, each with the reason and the decision still owed.
 *
 * ⭐ THIS LIST CAN ONLY SHRINK. A test below asserts every path here still
 * exists, so an entry outlives its file by exactly zero commits — the failure
 * mode of every allow-list (quietly accumulating names of things that are gone)
 * cannot happen here.
 *
 * ⛔ AND IT IS NOT A PLACE TO PARK A NEW ORPHAN. Adding a line is a decision
 * recorded in a diff with a reason beside it; that is the point.
 */
const AWAITING_A_DECISION = {
  'app/src/components/chart/engine/registrySizes.js':
    'NOT dead — a hand-written DECLARATION of the shipped catalogue that imports '
    + 'nothing on purpose, so nine rails can disagree with it. Deriving it from '
    + 'the registry would make it true by construction and unable to fail.',
  'app/src/pages/EducationalVideos.jsx':
    'A 4-line re-export shim over the LIVE pages/desk/VideosSection. Its test is '
    + 'not test-only coverage: it renders the shim, i.e. VideosSection, and carries '
    + 'four admin-gating assertions with no counterpart in that page\'s own tests. '
    + 'Removing the shim is a test repoint + rename, not a deletion.',
  'app/src/pages/OptionsFlow_admin.jsx': 'Partner-owned; verified zero-importer, awaiting ack.',
  'app/src/pages/LiveFlow_admin.jsx': 'Partner-owned; verified zero-importer, awaiting ack.',
  'app/src/LiveFlow_integration_guide.jsx': 'Partner-owned; verified zero-importer, awaiting ack.',
  'app/src/useFlowWebSocket.js':
    'Reachable only from LiveFlow_integration_guide above — deleting the guide '
    + 'alone would orphan it, so the pair moves together or not at all.',
  'app/src/hooks/useTapeFeed.js':
    'In-flight, NOT mine. A 30s poll of /api/tweets/tape whose docstring names '
    + 'its intended mount (MoversSidebar), so the wire is planned rather than '
    + 'lost. Its most recent commit is literally "revert(web): restore '
    + 'useTapeFeed.js — it was never mine to delete" — another session removed '
    + 'it as an orphan and put it back. Recording it here rather than repeating '
    + 'that: mounting it would be guessing at an owner\'s intent, and deleting '
    + 'it is the move that has already been undone once.',
  'app/src/hooks/useTickerMentions.js':
    'Scaffolding for a specced-but-unbuilt tab, and NOT wireable as-is. Its '
    + 'docstring names two mounts. Phase 2C (chart markers) SHIPPED — but '
    + 'StockChart fetches /api/education/tickers/{sym}/mentions inline with the '
    + 'OPPOSITE error policy on purpose (degrade to {mentions: []} so one marker '
    + 'category cannot take the others down), where this hook throws on !ok so '
    + 'SWR retries. Pointing StockChart at it would reverse that, so this is not '
    + 'a missing wire. Phase 2B is the real mount: the "Desk" tab in TickerPopup '
    + '(design doc 2026-08-11-desk-ticker-moments-phase2 §B.2), which does not '
    + 'exist — that popup\'s tabs are About / Fundamentals / The Street. Build '
    + 'the tab or drop the pair; do not silently delete a specced feature\'s '
    + 'scaffolding, and do not "fix" it by mounting it somewhere it would regress.',
}

describe('🔴 every module under app/src is REACHABLE from an entry point', () => {
  const reachable = reachableFrom(ROOTS)
  const modules = shippedModules()
  const tracked = trackedModules()

  it('the walk itself is not vacuous', () => {
    expect(APP_ROOTS.length, 'no app entry point was found — the walk starts nowhere')
      .toBeGreaterThan(0)
    expect(configEntryPoints().length,
      'vite.config.js named no local file — setupFiles/alias moved, and two real '
      + 'entry points would now read as orphans').toBeGreaterThan(0)
    expect(reachable.size, 'the import graph collapsed to almost nothing — the '
      + 'resolver is broken and every reachability claim below would be a lie')
      .toBeGreaterThan(600)
    expect(modules.length, 'no modules were found under app/src — this rail would '
      + 'pass on an empty tree').toBeGreaterThan(500)
    // ⛔ THE WIP EXEMPTION'S OWN VACUITY GUARD. An empty or partial `git ls-files`
    // would exempt the entire tree and this rail would pass forever.
    expect(tracked.size, '`git ls-files -- app/src` returned almost nothing, so the '
      + 'sweep below would judge almost nothing').toBeGreaterThan(500)
    const untrackedButKnown = Object.keys(AWAITING_A_DECISION)
      .filter((k) => !tracked.has(path.join(ROOT, k)))
    expect(untrackedButKnown, 'git does not track files this rail already records as '
      + 'committed — the tracked set is wrong, not the allow-list').toEqual([])
  })

  it('and nothing committed is connected to nothing', () => {
    const orphans = modules
      .filter((f) => tracked.has(f))
      .filter((f) => !reachable.has(f))
      .filter((f) => !TEST_INFRA.test(path.relative(SRC, f)))
      .map(key)
      .filter((k) => !(k in AWAITING_A_DECISION))
    expect(orphans,
      'these modules are BUILT and possibly GREEN, and no route a member can '
      + 'navigate to reaches them. Their own test files will stay green forever — '
      + 'component tests are structurally blind to a severed wire. Mount them, '
      + 'delete them, or record the decision in AWAITING_A_DECISION above with a '
      + 'reason; do not leave them looking shipped.').toEqual([])
  })

  it('the allow-list cannot outlive its files', () => {
    const gone = Object.keys(AWAITING_A_DECISION)
      .filter((k) => !fs.existsSync(path.join(ROOT, k)))
    expect(gone, 'these files were deleted — drop their AWAITING_A_DECISION entries. '
      + 'An allow-list that keeps names of things that no longer exist is how a '
      + 'real orphan gets excused by a stale line nobody re-read.').toEqual([])
  })

  it('and it cannot excuse something that is actually wired', () => {
    // The other direction: an entry for a REACHABLE file is a line that would
    // silently keep excusing it if the wire were later cut.
    const wired = Object.keys(AWAITING_A_DECISION)
      .filter((k) => reachable.has(path.join(ROOT, k)))
    expect(wired, 'these are reachable — remove their AWAITING_A_DECISION entries, '
      + 'or the day their wire is cut this rail will stay green').toEqual([])
  })

  it('ScanResults specifically — the surface this rail was built for — is reachable', () => {
    // ⛔ Named on purpose, and it is not redundant with the sweep above: the
    // sweep passes trivially if somebody ever deletes the file, and this is the
    // one component whose unreachability was the measured defect.
    expect(reachable.has(path.join(SCREENER_DIR, 'ScanResults.jsx')),
      'app/src/components/screener/ScanResults.jsx is reachable from NO route. '
      + 'CoverageLine is imported only by ScanResults, so spec §6.3\'s four-outcome '
      + 'coverage receipt cannot be seen by any member.').toBe(true)
    expect(reachable.has(path.join(SCREENER_DIR, 'CoverageLine.jsx'))).toBe(true)
  })

  it('UIcon is reachable — the control on the census that got this wrong', () => {
    // A previous census named `components/ui/*` among zero-importer files. If a
    // future resolver change re-manufactures that answer, it fails HERE, beside
    // the reason, instead of in a deletion commit.
    expect(reachable.has(path.join(SRC, 'components', 'ui', 'UIcon.jsx')),
      'the walk called UIcon unreachable. It has 222 import statements — the '
      + 'resolver is broken, not the icon system.').toBe(true)
  })
})

describe('the controls — a rail nobody has seen fail cannot be trusted', () => {
  // ⏱️ EXPLICIT TIME BUDGET (2026-08-09). These controls each re-walk the WHOLE
  // import graph from `App.jsx` with acorn — the planted cut walks it a second
  // time with one edge severed, the dynamic-edge control a third time with
  // `ImportExpression` disabled. As the repo grew that crossed vitest's 5s
  // default: both went red under full-suite load, then red in isolation. ⛔ A
  // rail that ALWAYS fails is as useless as one that CANNOT fail — nobody reads
  // either, and this one is the standing guard on reachability. The assertions
  // are untouched; only the budget is stated out loud.
  // ⚠️ 60s, not 30: measured at 30.6s for the file under a full parallel suite
  // run on this box. The budget exists to absorb machine load, and the failure
  // this rail is FOR is a severed import edge, which takes microseconds.
  it('PLANTED CUT: remove the mount\'s import and ScanResults goes unreachable', () => {
    const panel = path.join(SCREENER_DIR, 'SavedScreensPanel.jsx')
    const src = read(panel)
    const IMPORT = "import ScanResults from './ScanResults'\n"
    // ⛔ NEVER `str.replace` WITHOUT PROVING THE ANCHOR WAS THERE
    // (`lesson_test_that_passes_vacuously`): a mutation that silently failed to
    // apply produces a control that "passes" while measuring the unmutated tree.
    expect(src.includes(IMPORT),
      `the mount import moved — this control cannot cut a wire it cannot find in ${key(panel)}`)
      .toBe(true)
    const cut = src.replace(IMPORT, '')
    expect(cut).not.toEqual(src)

    const after = reachableFrom(ROOTS, new Map([[panel, cut]]))
    expect(after.has(panel), 'the panel itself must stay reachable — otherwise this '
      + 'control proves nothing about the edge it cut').toBe(true)
    expect(after.has(path.join(SCREENER_DIR, 'ScanResults.jsx')),
      'cutting the mount left ScanResults reachable, so this rail cannot see a '
      + 'severed wire and every assertion above is decoration').toBe(false)
    expect(after.has(path.join(SCREENER_DIR, 'CoverageLine.jsx')),
      'CoverageLine is reached only through ScanResults; cutting the mount must '
      + 'take it with it').toBe(false)
  }, 60000)

  it('THE DYNAMIC EDGE IS LOAD-BEARING: static-only imports never reach the page', () => {
    // `App.jsx` routes through `lazy(() => import('./pages/Screener'))`. A walker
    // blind to `ImportExpression` would report most of `pages/**` unreachable for
    // a reason that has nothing to do with a missing mount — a rail that fails
    // for the wrong reason is as useless as one that cannot fail.
    const staticOnly = (() => {
      const seen = new Set()
      const queue = [...ROOTS]
      while (queue.length) {
        const file = queue.pop()
        if (seen.has(file)) continue
        seen.add(file)
        for (const spec of specifiersOf(read(file), { dynamic: false })) {
          for (const next of resolve(file, spec)) if (!seen.has(next)) queue.push(next)
        }
      }
      return seen
    })()
    const page = path.join(SRC, 'pages', 'Screener.jsx')
    expect(staticOnly.has(page),
      'a static-only walk reached the Screener page, so `lazy(() => import(…))` is '
      + 'no longer how App.jsx routes and this control has stopped measuring anything')
      .toBe(false)
    expect(reachableFrom(ROOTS).has(page),
      'the real walk does NOT reach the Screener page — the dynamic-import edge is '
      + 'not being followed and every reachability claim in this file is false')
      .toBe(true)
  }, 60000)

  it('THE WORKER EDGE IS LOAD-BEARING: `new Worker(new URL(…))` is followed', () => {
    // The form that made a census call a shipped worker dead. Cut the specifier
    // out of the client and the worker must drop out of the graph — that is the
    // proof the edge is real and not incidentally reachable some other way.
    const client = path.join(SRC, 'pages', 'optionsFlow', 'flowWorkerClient.js')
    const worker = path.join(SRC, 'pages', 'optionsFlow', 'flow.worker.js')
    expect(fs.existsSync(client) && fs.existsSync(worker),
      'the flow worker pair moved — this control measures nothing').toBe(true)
    expect(reachableFrom(ROOTS).has(worker),
      'flow.worker.js is unreachable: the `new Worker(new URL(…))` form is not '
      + 'being followed, and this walk will manufacture orphans').toBe(true)

    const src = read(client)
    const SPEC = "'./flow.worker.js'"
    expect(src.includes(SPEC), 'the worker specifier moved — cannot cut it').toBe(true)
    const cut = src.replace(SPEC, "'./__no_such_worker__.js'")
    expect(cut).not.toEqual(src)
    expect(reachableFrom(ROOTS, new Map([[client, cut]])).has(worker),
      'cutting the only Worker specifier left the worker reachable, so this walk '
      + 'is not reading that form at all').toBe(false)
  }, 60000)

  it('THE SWEEP REPORTS A TRACKED ORPHAN, and exempts an UNTRACKED one', () => {
    // The classification, exercised directly on synthetic inputs so the boundary
    // of the work-in-progress exemption is a proven property and not a comment.
    const planted = path.join(SRC, 'components', 'screener', '__planted_orphan__.js')
    expect(fs.existsSync(planted),
      'the planted path must NOT exist in the tree — this control fabricates it')
      .toBe(false)
    expect(TEST_INFRA.test(path.relative(SRC, planted)),
      'the planted orphan matched the TEST_INFRA marker, so the marker is far too '
      + 'wide and would excuse ordinary components').toBe(false)
    expect(key(planted) in AWAITING_A_DECISION,
      'the planted orphan is already allow-listed, which cannot be').toBe(false)
    expect(reachableFrom(ROOTS).has(planted)).toBe(false)

    const classify = (trackedSet) => [planted]
      .filter((f) => trackedSet.has(f))
      .filter((f) => !TEST_INFRA.test(path.relative(SRC, f)))
      .map(key)
      .filter((k) => !(k in AWAITING_A_DECISION))

    expect(classify(new Set([planted])), 'a COMMITTED module that nothing imports '
      + 'must be reported — otherwise the sweep can never fail').toEqual([key(planted)])
    expect(classify(new Set()), 'an UNCOMMITTED module must be exempt — four agents '
      + 'share this worktree and a half-written file is not a shipped orphan')
      .toEqual([])
    // ⚠️ 60s LIKE ITS SIBLING, AND FOR THE SAME REASON: line 473 runs the FULL
    // `reachableFrom(ROOTS)` AST walk over the whole tree. On the default 5s
    // budget this went red twice in a row on a loaded box (a full-suite run of
    // 145s against a usual 91s) while passing 11/11 on its own.
    // ⛔ A gate that fails at random gets ignored, which is worse than no gate —
    // the flake is a defect in the RAIL, not a reason to distrust the sweep.
  }, 60000)

  it('a specifier that is prose, not an import, is not an edge', () => {
    // The grep failure mode, asserted directly.
    const prose = "// see ./ScanResults for the surface\nconst s = './ScanResults'\n"
    expect(specifiersOf(prose)).toEqual([])
    expect(specifiersOf("import X from './ScanResults'\n")).toEqual(['./ScanResults'])
    expect(specifiersOf("const p = () => import('./ScanResults')\n")).toEqual(['./ScanResults'])
    expect(specifiersOf("const w = new Worker(new URL('./a.js', import.meta.url))\n"))
      .toEqual(['./a.js'])
    expect(specifiersOf("const m = require('./b')\n")).toEqual(['./b'])
    expect(specifiersOf("const g = import.meta.glob('./c*')\n")).toEqual(['./c*'])
    // ⛔ And a mock is NOT an edge — see specifiersOf's header.
    expect(specifiersOf("vi.mock('./d')\n")).toEqual([])
  })
})
