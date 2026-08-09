// app/src/components/screener/reachable.test.js
//
// ─── 🔴 THE RAIL THAT CATCHES THE THIRTEENTH INSTANCE WITHOUT ANYONE
//     REMEMBERING TO WRITE A TEST ──────────────────────────────────────────
//
// `Screener.scanmount.test.jsx` proves ONE surface is reachable, and it had to
// be written by hand after the defect was found by hand. This file asks the
// structural question instead: **is every component in this directory reachable
// from the app's entry point at all?** — by walking the real import graph from
// `App.jsx` with an AST, following `lazy(() => import(…))` as well as static
// imports.
//
// ⛔ AN AST, NEVER A GREP. `lesson_probe_names_must_be_derived_not_typed`: a grep
// for a module name reports the import line, the comment above it and every
// piece of prose that mentions it — this repo has already measured a probe that
// "found 5 call sites, all five of them prose". Only the parsed `source` of an
// `ImportDeclaration` / `ImportExpression` is an edge.
//
// ⭐ THE DYNAMIC EDGE IS NOT OPTIONAL HERE, AND ONE OF THE CONTROLS BELOW PROVES
// IT. `App.jsx` reaches every page through `lazy(() => import('./pages/X'))`, so
// a walker that only followed static imports would find NOTHING under `pages/`
// — and would then report this directory's components unreachable for a reason
// that has nothing to do with the defect. The control asserts exactly that
// difference, which is what stops the rail from passing for the wrong reason.
//
// ⚠️ SCOPE IS THIS DIRECTORY, DELIBERATELY. The walker is repo-wide; the
// ASSERTION is scoped to `app/src/components/screener/**` because that is the
// directory this task owns and three other agents are adding files elsewhere as
// this ships. Widening it is a one-line change and the hand-off is in the report.

import fs from 'node:fs'
import path from 'node:path'
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

const SRC = path.join(ROOT, 'app', 'src')
const SCREENER_DIR = path.join(SRC, 'components', 'screener')
/** The app's entry: `main.jsx` mounts `App.jsx`, and `App.jsx` owns the routes. */
const ROOTS = ['main.jsx', 'App.jsx']
  .map((f) => path.join(SRC, f))
  .filter((p) => fs.existsSync(p))

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

/**
 * Every module specifier this source imports, BY AST.
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
  })
  return out
}

const CODE_EXT = ['.js', '.jsx']

/** Resolve a RELATIVE specifier to a real JS/JSX file, or `null`.
 *  ⛔ Packages and asset imports (`.css`, `.svg`, `?url`) are not edges in this
 *  graph — a CSS module cannot render a component, and a bare specifier leaves
 *  `app/src` entirely. */
function resolve(fromFile, spec) {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), spec)
  const candidates = [base, ...CODE_EXT.map((e) => base + e),
    ...CODE_EXT.map((e) => path.join(base, `index${e}`))]
  for (const c of candidates) {
    if (!CODE_EXT.includes(path.extname(c))) continue
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  }
  return null
}

/**
 * Every module reachable from `roots`, as repo-relative paths.
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
      const next = resolve(file, spec)
      if (next && !seen.has(next)) queue.push(next)
    }
  }
  return seen
}

/** Every shipped component in this directory — ⛔ DERIVED from the directory,
 *  never listed. A hand-list would agree with today's contents right up until
 *  somebody adds the next unreachable file, which is the whole failure mode. */
function shippedComponents() {
  return fs.readdirSync(SCREENER_DIR)
    .filter((f) => /\.jsx?$/.test(f) && !/\.test\.jsx?$/.test(f))
    .map((f) => path.join(SCREENER_DIR, f))
}

describe('🔴 every screener component is REACHABLE from the app entry point', () => {
  const reachable = reachableFrom(ROOTS)
  const components = shippedComponents()

  it('the walk itself is not vacuous', () => {
    expect(ROOTS.length, 'no app entry point was found — the walk starts nowhere')
      .toBeGreaterThan(0)
    expect(reachable.size, 'the import graph collapsed to almost nothing — the '
      + 'resolver is broken and every reachability claim below would be a lie')
      .toBeGreaterThan(150)
    expect(components.length, 'no components were found in app/src/components/screener '
      + '— this rail would pass on an empty directory').toBeGreaterThan(1)
  })

  it('and no component in this directory is connected to nothing', () => {
    const orphans = components.filter((f) => !reachable.has(f)).map(key)
    expect(orphans,
      'these components are BUILT and possibly GREEN, and no route a member can '
      + 'navigate to reaches them. Their own test files will stay green forever — '
      + 'component tests are structurally blind to a severed wire. Mount them, or '
      + 'delete them; do not leave them looking shipped.').toEqual([])
  })

  it('ScanResults specifically — the surface this task mounted — is reachable', () => {
    // ⛔ Named on purpose, and it is not redundant with the sweep above: the
    // sweep passes trivially if somebody ever deletes the file, and this is the
    // one component whose unreachability was the measured defect.
    expect(reachable.has(path.join(SCREENER_DIR, 'ScanResults.jsx')),
      'app/src/components/screener/ScanResults.jsx is reachable from NO route. '
      + 'CoverageLine is imported only by ScanResults, so spec §6.3\'s four-outcome '
      + 'coverage receipt cannot be seen by any member.').toBe(true)
    expect(reachable.has(path.join(SCREENER_DIR, 'CoverageLine.jsx'))).toBe(true)
  })
})

describe('the controls — a rail nobody has seen fail cannot be trusted', () => {
  // ⏱️ EXPLICIT TIME BUDGET (2026-08-09). These two controls each re-walk the
  // WHOLE import graph from `App.jsx` with acorn — the planted cut walks it a
  // second time with one edge severed, the dynamic-edge control a third time
  // with `ImportExpression` disabled. As the repo grew that crossed vitest's 5s
  // default: both went red under full-suite load, then red in isolation. ⛔ A
  // rail that ALWAYS fails is as useless as one that CANNOT fail — nobody reads
  // either, and this one is the standing guard on screener reachability. The
  // assertions are untouched; only the budget is now stated out loud.
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
  }, 30000)

  it('THE DYNAMIC EDGE IS LOAD-BEARING: static-only imports never reach the page', () => {
    // `App.jsx` routes through `lazy(() => import('./pages/Screener'))`. A walker
    // blind to `ImportExpression` would report this whole directory unreachable
    // for a reason that has nothing to do with a missing mount — a rail that
    // fails for the wrong reason is as useless as one that cannot fail.
    const staticOnly = (() => {
      const seen = new Set()
      const queue = [...ROOTS]
      while (queue.length) {
        const file = queue.pop()
        if (seen.has(file)) continue
        seen.add(file)
        for (const spec of specifiersOf(read(file), { dynamic: false })) {
          const next = resolve(file, spec)
          if (next && !seen.has(next)) queue.push(next)
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
  }, 30000)

  it('a specifier that is prose, not an import, is not an edge', () => {
    // The grep failure mode, asserted directly.
    const prose = "// see ./ScanResults for the surface\nconst s = './ScanResults'\n"
    expect(specifiersOf(prose)).toEqual([])
    expect(specifiersOf("import X from './ScanResults'\n")).toEqual(['./ScanResults'])
    expect(specifiersOf("const p = () => import('./ScanResults')\n")).toEqual(['./ScanResults'])
  })
})
