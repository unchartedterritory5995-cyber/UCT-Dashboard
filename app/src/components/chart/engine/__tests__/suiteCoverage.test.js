// app/src/components/chart/engine/__tests__/suiteCoverage.test.js
//
// ─── ⭐⭐ THE RAIL THAT EXISTS BECAUSE A DIRECTORY WENT UNRUN THREE TIMES ─────
//
// ⚰️⚰️ THREE TIMES IN ONE WAVE, SAME CAUSE, AND THE CAUSE WAS NOT A BROKEN
// RUNNER. `vitest run src/components/chart/engine/` collects every one of these
// files and always has. What happened is that a NARROWER path was run —
// `…/engine/ast/` — and reported as "the engine suite", so `engine/__tests__/`
// and later `engine/runtime/__tests__/` sat red while a green wall of numbers
// said otherwise. Reds shipped in `1d2854b2a`, `998cea97a` and `0a96689ef` on
// exactly that mistake.
//
// ⛔ SO THE FIX IS NOT "REMEMBER THE THIRD DIRECTORY". Remembering is what
// failed. Two mechanical claims replace it:
//
//   1. ONE COMMAND COVERS ALL OF IT, derived rather than asserted — every engine
//      test file on disk must sit under the path `npm run test:engine` hands to
//      vitest. A directory placed outside it fails HERE, naming the file,
//      instead of being discovered by a later red.
//   2. THE SET OF TEST-BEARING DIRECTORIES IS ACKNOWLEDGED. A new one appearing
//      is not an error — it is a fact somebody has to have SEEN, because the
//      whole defect was not knowing a directory existed. The failure names it
//      and says what to do about it.
//
// ⚠️ (2) IS AN ACKNOWLEDGEMENT LIST AND IT WILL DRIFT LIKE ANY OTHER
// (`lesson_a_gate_list_drifts_like_any_other_artifact`). That is accepted on
// purpose and bounded two ways: it is five lines long, and drifting is the
// SIGNAL rather than the failure — the list going stale is precisely the event
// this rail exists to report.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const APP = process.cwd()
const ENGINE = path.join(APP, 'src/components/chart/engine')

/** The vitest DEFAULT include, which this repo does not override — a claim
 *  checked below rather than assumed, because an `include` added to
 *  `vite.config.js` would silently narrow what "the whole suite" means. */
const IS_TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/

/** ⚠️ THE ACKNOWLEDGEMENT LIST — repo-relative, POSIX separators, sorted.
 *  Adding a row is the point: it means somebody looked. */
const ACKNOWLEDGED = [
  'src/components/chart/engine',
  'src/components/chart/engine/__tests__',
  'src/components/chart/engine/ast',
  'src/components/chart/engine/ast/__tests__',
  'src/components/chart/engine/runtime/__tests__',
]

const rel = (p) => path.relative(APP, p).split(path.sep).join('/')

/** Walk once; return both what the run must cover and where it lives.
 *
 *  `node_modules` is skipped for the same reason vitest skips it — the tests of
 *  a dependency are not ours — and `engine/ast/node_modules/.vite` exists on
 *  this tree, so the skip is load-bearing rather than defensive. */
function engineTests(root) {
  const files = []
  const dirs = new Set()
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.vite') continue
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (IS_TEST_FILE.test(entry)) { files.push(rel(full)); dirs.add(rel(dir)) }
    }
  }
  walk(root)
  return { files: files.sort(), dirs: [...dirs].sort() }
}

const PKG = JSON.parse(readFileSync(path.join(APP, 'package.json'), 'utf8'))

describe('⭐ ONE COMMAND COVERS THE WHOLE ENGINE, and the command says so', () => {
  it('a named `test:engine` exists — it is what a person can be told to run', () => {
    expect(PKG.scripts && PKG.scripts['test:engine'],
      'package.json has no `test:engine` script; without one there is nothing to '
      + 'point an engineer at, and "run the engine tests" means whatever gets typed')
      .toBeTruthy()
  })

  it('⛔ every engine test file lies under the path that command runs', () => {
    // ⭐ DERIVED FROM THE SCRIPT TEXT, NOT RETYPED. If somebody narrows the
    // script to `…/engine/ast/`, this goes red naming the files that just fell
    // out of the run — the exact mistake, caught at its source rather than by a
    // later red in a directory nobody was looking at.
    const script = String(PKG.scripts['test:engine'])
    const target = script.split(/\s+/).find((w) => w.includes('src/'))
    expect(target, `test:engine passes no path to vitest: ${script}`).toBeTruthy()

    const prefix = target.replace(/\/$/, '')
    const uncovered = engineTests(ENGINE).files.filter((f) => !f.startsWith(prefix))
    expect(uncovered,
      `these engine test files are NOT under ${target}, so \`npm run test:engine\` `
      + `would not run them:\n  ${uncovered.join('\n  ')}`)
      .toEqual([])
  })

  it('⚠️ the config does not narrow `include` behind the back of the command', () => {
    // A `test.include` added to vite.config.js would make the path argument a
    // lie: the command would still be typed and files under it would still be
    // skipped. Nothing here reads config internals — it reads the FILE, because
    // the claim is about what the config SAYS.
    const cfg = readFileSync(path.join(APP, 'vite.config.js'), 'utf8')
    const testBlock = cfg.slice(cfg.indexOf('  test: {'))
    expect(/^\s*include\s*:/m.test(testBlock),
      'vite.config.js now sets `test.include`. That overrides the vitest default '
      + 'and can quietly exclude a whole directory while the command still names '
      + 'it — reconcile it with this rail before shipping.')
      .toBe(false)
  })
})

describe('⛔ a NEW engine test directory has to be SEEN, not discovered later', () => {
  it('the directories on disk are the ones somebody acknowledged', () => {
    const found = engineTests(ENGINE).dirs
    const added = found.filter((d) => !ACKNOWLEDGED.includes(d))
    const gone = ACKNOWLEDGED.filter((d) => !found.includes(d))
    expect({ added, gone },
      'the test directories of the engine moved.\n'
      + (added.length
        ? '  NEW (run `npm run test:engine`, confirm it is green, then add it to '
          + `ACKNOWLEDGED):\n    ${added.join('\n    ')}\n`
        : '')
      + (gone.length ? `  GONE (delete it from ACKNOWLEDGED):\n    ${gone.join('\n    ')}\n` : ''))
      .toEqual({ added: [], gone: [] })
  })

  it('⛔ NON-VACUITY — the walker sees several directories, and sees THAT one', () => {
    // A walker that returned [] would make the assertion above pass forever, and
    // `runtime/__tests__` is named because it is the one that went unrun.
    const found = engineTests(ENGINE).dirs
    expect(found.length).toBeGreaterThanOrEqual(4)
    expect(found).toContain('src/components/chart/engine/runtime/__tests__')
  })

  it('⭐ POSITIVE CONTROL — the coverage predicate FAILS on an outside file', () => {
    // ⛔ THE COVERAGE ASSERTION ABOVE IS `toEqual([])`, AND AN EMPTY LIST IS ALSO
    // WHAT A BROKEN PROBE PRODUCES. This drives the same predicate over a file
    // that is deliberately outside and requires it to be reported — so "no
    // uncovered files" means the check looked, not that it could not see.
    const prefix = 'src/components/chart/engine'
    const pretend = ['src/components/chart/engine/ast/pine.test.js',
      'src/pages/Screener.scanmount.test.jsx']
    expect(pretend.filter((f) => !f.startsWith(prefix)))
      .toEqual(['src/pages/Screener.scanmount.test.jsx'])
  })
})

// ─── ⭐⭐ THE SAME DEFECT, ONE DIRECTORY UP (added 2026-09-11) ───────────────
//
// ⚰️ THE RAIL ABOVE WORKED AND ITS SCOPE WAS THE BUG. `test:engine` collects 243
// files and every one of them lies under the path it names, so both claims above
// were green all night — while TEN failing files sat in
// `src/components/chart/builder/`, which no named script ran and nothing
// acknowledged. They were found by typing a wider path by hand, which is the
// "a narrower path was reported as the suite" mistake wearing its mirror image:
// this time the SUITE was narrower than the SUBJECT.
//
// ⭐ So the claim is widened rather than duplicated: every test-bearing directory
// under `src/components/chart` must be reachable from SOME named `test:*` script,
// and the script paths are DERIVED from package.json, never retyped.
const CHART = path.join(APP, 'src/components/chart')

/** ⚠️ ACKNOWLEDGEMENT LIST #2 — the whole chart tree, not just the engine.
 *  Measured on disk 2026-09-11; eleven rows. Adding one means somebody looked. */
const ACKNOWLEDGED_CHART = [
  'src/components/chart',
  'src/components/chart/builder',
  'src/components/chart/builder/editor',
  'src/components/chart/engine',
  'src/components/chart/engine/__tests__',
  'src/components/chart/engine/ast',
  'src/components/chart/engine/ast/__tests__',
  'src/components/chart/engine/runtime/__tests__',
  'src/components/chart/legend',
  'src/components/chart/pane',
  'src/components/chart/patternShapes',
]

/** Every `src/`-ish path that any `test*` script hands to vitest. */
function scriptTargets() {
  const out = []
  for (const [name, body] of Object.entries(PKG.scripts || {})) {
    if (!name.startsWith('test')) continue
    for (const word of String(body).split(/\s+/)) {
      if (word.includes('src/')) out.push(word.replace(/\/$/, ''))
    }
  }
  return out
}

describe('⛔ a test directory under chart/ that NO named script runs', () => {
  it('every test-bearing chart directory is reachable from some `test:*` script', () => {
    const targets = scriptTargets()
    // Two controls, because a rail that looked nowhere would pass in silence.
    expect(targets.length, 'no `test*` script passes a src/ path to vitest').toBeGreaterThan(0)
    const dirs = engineTests(CHART).dirs
    expect(dirs.length, 'no test files found under src/components/chart — the walker is '
      + 'pointed at the wrong root, which would make this whole rail vacuous')
      .toBeGreaterThan(5)

    const unreachable = dirs.filter((d) => !targets.some((t) => d === t || d.startsWith(t + '/')))
    expect(unreachable,
      'these chart test directories are run by NO named npm script, so they go red where '
      + 'nobody is looking — this is exactly how builder/ hid ten failures:\n  '
      + unreachable.join('\n  ')
      + '\n  Add a `test:<name>` script that covers them.')
      .toEqual([])
  })

  it('the chart test directories on disk are the ones somebody acknowledged', () => {
    const found = engineTests(CHART).dirs
    const added = found.filter((d) => !ACKNOWLEDGED_CHART.includes(d))
    const gone = ACKNOWLEDGED_CHART.filter((d) => !found.includes(d))
    expect({ added, gone },
      'the test directories under src/components/chart moved.\n'
      + (added.length ? '  NEW (run it, confirm green, then acknowledge):\n    ' + added.join('\n    ') + '\n' : '')
      + (gone.length ? '  GONE (delete from ACKNOWLEDGED_CHART):\n    ' + gone.join('\n    ') + '\n' : ''))
      .toEqual({ added: [], gone: [] })
  })
})
