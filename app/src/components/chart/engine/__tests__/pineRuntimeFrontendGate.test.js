// app/src/components/chart/engine/__tests__/pineRuntimeFrontendGate.test.js
//
// ─── ⭐⭐ THE GATE, FLIPPED (T3, 2026-09-12) ─────────────────────────────────
//
// ⚰️ WHAT THIS FILE USED TO SAY: "`pineRuntimeFrontend.js` MAY NOT BE WIRED
// YET" — because the four `CLOCK_REALTIME` columns are decided by
// `opts.newestBarIsForming`, a tri-state produced on the Python side by
// `indicator_compute.bar_close_state`, and NOTHING in `app/src` handed it to
// that lane. The module had zero importers, so the blanks were unreachable; the
// day somebody wired it up they would become member-visible with no other test
// going red.
//
// ⭐⭐ THE PRECONDITION IS NOW MET. T4 built the producer —
// `ast/pineRuntimeClock.js`, whose `runtimeClockOptsFrom(payload)` fills BOTH
// `newestBarIsForming` and `interpretOpts.newestBarIsForming` from one value, so
// the gate and the columns cannot disagree — and `pineRuntimeClock.test.js`
// measures the three cases the ruling asked for. The old gate's own closing
// instruction was "build the producer … then DELETE this test, in the same
// commit that wires the module."
//
// ⛔ IT IS FLIPPED RATHER THAN DELETED, AND THE DIFFERENCE MATTERS. Deleting it
// would retire the only thing standing between that lane and a member seeing
// four blank columns; the producer makes the blanks PREVENTABLE, not impossible.
// So the rule becomes the one that is actually true from today:
//
//     a LIVE importer of `pineRuntimeFrontend` must also reach the producer.
//
// ⚠️ AND THE FLIPPED FORM IS VACUOUS UNTIL SOMEBODY WIRES IT — zero importers
// satisfies "every importer also imports the clock" trivially. That is why the
// predicate is a PURE FUNCTION exercised against synthetic file lists below: the
// gate is proved able to fire before it is ever pointed at the real tree.
//
// ⚠️ AND NOTE WHAT T3 ACTUALLY WIRED: ruling D2 (option B) drives the member
// pane from the HOST lane's saved definition, not from this lane, so the count
// of live importers is still zero today. That is a decision about which
// translation is authoritative — not evidence that this lane is safe.
//
// Recorded in `docs/pine/barstate.md` and `docs/pine/SESSION-STATE.md`.
//
// ─── ⭐⭐ AND THE LANE IS NOW WIRED — THROUGH EXACTLY ONE GATED DOOR (2026-09-27) ──
//
// ⚰️ The paragraph above says "the count of live importers is still zero today".
// It was true for fifteen days and is not any more, on purpose: the owner's goal of
// 2026-09-27 — "fully import every and any TradingView Pine script indicator so it
// shows on UCT charts exactly as on TradingView" — supersedes ruling D2 for ONE path.
// When the host lane refuses a script for a limit of its own single-expression value
// model, the member door may try the runtime lane instead
// (`engine/pineRuntimeLane.js`, behind `VITE_PINE_RUNTIME_LANE_ENABLED`).
//
// ⛔ SO THIS FILE'S JOB CHANGES FROM "THE LANE IS UNREACHABLE" TO "THE LANE IS
// REACHABLE ONLY THROUGH THAT DOOR". A second importer — a builder preview, a
// scan, a chart — is a second door, and it would reach members with none of the
// fallback's guards (the host-first order, the ruling-guard exclusion, the flag). The
// second describe block below is the rail on that, and it is exact: the live
// importer set of the lane is NAMED, not bounded, so an addition fails by name.
//
// ⭐ THE PRODUCER RULE ABOVE STILL HOLDS AND STILL MATTERS: `pineRuntimeLane.js`
// imports `pineRuntimeClock` for the reason that rule exists.

import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', '..', '..', '..')      // app/src
const SUBJECT = path.resolve(HERE, '..', 'ast', 'pineRuntimeFrontend.js')
const PRODUCER = path.resolve(HERE, '..', 'ast', 'pineRuntimeClock.js')

/** ⭐⭐ ONE PASS OVER THE TREE, SHARED BY EVERY ASSERTION BELOW.
 *
 *  ⚰️ THIS READ EVERY FILE'S CONTENTS ONCE PER TEST and timed out at vitest's
 *  15 s default on 1 run in 20 — measured, not guessed. Reading the tree ONCE
 *  takes the whole file to well under a second, and raising `testTimeout` would
 *  leave a gate that flakes whenever the box is busy. A gate that flakes is a
 *  gate that gets ignored, which is worse than not having one. */
const FILES = (function scan(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    // ⚠️ SYMLINKED DIRECTORIES ARE NOT FOLLOWED. This repo has had
    // `app/node_modules` be a junction into ANOTHER worktree; a walker that
    // followed one would leave `app/src` and read someone else's tree.
    if (e.isSymbolicLink()) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (['node_modules', 'dist', '.vite', '.vite-temp', '__snapshots__']
        .includes(e.name)) continue
      scan(p, out)
    } else if (/\.(jsx?|mjs)$/.test(e.name)) {
      out.push({
        rel: path.relative(SRC, p).replace(/\\/g, '/'),
        text: fs.readFileSync(p, 'utf-8'),
      })
    }
  }
  return out
})(SRC).filter((f) => path.resolve(SRC, f.rel) !== path.resolve(SUBJECT))

/** Does this text name `mod` in an import / require / dynamic-import position?
 *  ⭐ TEXT, DELIBERATELY, NOT AN AST. This asks "does the file MENTION it in a
 *  module position", which is strictly broader than the import graph — a wiring
 *  attempt through a shape this rail did not anticipate still trips it.
 *  Over-broad is the right direction for a gate. */
function names(text, mod) {
  return new RegExp(
    '(?:from\\s+|import\\s*\\(|require\\s*\\()\\s*[\'"][^\'"]*' + mod + '[^\'"]*[\'"]',
  ).test(text)
}

const isTest = (rel) => /\.test\.[jt]sx?$/.test(rel)

/** ⭐⭐ THE WHOLE GATE, AS A PURE FUNCTION OF A FILE LIST.
 *
 *  Every LIVE (non-test) file that imports the runtime front end and does NOT
 *  also import the tri-state producer. Empty = safe.
 *
 *  ⛔ IT TAKES THE LIST AS AN ARGUMENT SO IT CAN BE FED SYNTHETIC FILES. A gate
 *  that can only be pointed at the real tree cannot be shown to fire while the
 *  real tree is clean, and "it passed" then means nothing at all. */
export function importersMissingProducer(files) {
  return files
    .filter((f) => !isTest(f.rel))
    .filter((f) => names(f.text, 'pineRuntimeFrontend'))
    .filter((f) => !names(f.text, 'pineRuntimeClock'))
    .map((f) => f.rel)
}

describe('⭐⭐ the flipped gate — wiring the pane lane means wiring the producer', () => {
  it('⛔ NON-VACUITY FIRST — both modules exist and the scan can see files', () => {
    expect(fs.existsSync(SUBJECT), 'pineRuntimeFrontend.js is gone — if it was '
      + 'deleted on purpose, delete this gate too').toBe(true)
    expect(fs.existsSync(PRODUCER), 'pineRuntimeClock.js is gone. THE PRODUCER IS '
      + 'THE ONLY REASON THIS GATE IS ALLOWED TO BE PERMISSIVE — without it the '
      + 'old rule (no importer at all) is the correct one again, and this file '
      + 'should be reverted rather than deleted').toBe(true)
    expect(FILES.length, 'the source scan found nothing — the walker is broken '
      + 'and every assertion below is vacuous').toBeGreaterThan(500)
  })

  it('⭐⭐ THE CONTROL — the predicate really fires on an unwired importer', () => {
    // ⛔ THE POINT OF THE WHOLE FILE. Today the real tree has zero importers, so
    // the assertion below passes trivially; without this case, so would a
    // predicate that had been broken into always returning an empty list.
    const bad = [{
      rel: 'x/Pane.jsx',
      text: 'import { buildRuntimeIr } from "./ast/pineRuntimeFrontend"',
    }]
    expect(importersMissingProducer(bad)).toEqual(['x/Pane.jsx'])

    const good = [{
      rel: 'x/Pane.jsx',
      text: 'import { buildRuntimeIr } from "./ast/pineRuntimeFrontend"\n'
        + 'import { runtimeClockOptsFrom } from "./ast/pineRuntimeClock"',
    }]
    expect(importersMissingProducer(good)).toEqual([])

    // A TEST importing it is not a wiring — the lane's own suites must keep working.
    const spec = [{
      rel: 'x/pane.test.js',
      text: 'import x from "./ast/pineRuntimeFrontend"',
    }]
    expect(importersMissingProducer(spec)).toEqual([])

    // And a file that imports neither is not swept up.
    const other = [{ rel: 'x/other.js', text: 'import y from "./indicators"' }]
    expect(importersMissingProducer(other)).toEqual([])
  })

  it('⛔⛔ no live file reaches the runtime lane without the tri-state producer', () => {
    const bad = importersMissingProducer(FILES)
    expect(bad, 'these files import `pineRuntimeFrontend` and NOT '
      + '`pineRuntimeClock`:\n  ' + bad.join('\n  ') + '\n\n'
      + 'THE FOUR CLOCK_REALTIME COLUMNS RENDER BLANK WITHOUT THE PRODUCER: '
      + '`computeClock` fails closed when nobody tells it whether the newest bar '
      + 'has finished, and blank is neither a crash nor a wrong number, so no '
      + 'other test goes red.\n\n'
      + 'THE FIX IS ONE IMPORT. Build the options with '
      + '`runtimeClockOptsFrom(barsPayload)` and spread them into the opts you '
      + 'hand `buildRuntimeIr`. It fills BOTH `newestBarIsForming` and '
      + '`interpretOpts.newestBarIsForming`, which is the pair the gate and the '
      + 'columns read separately. See docs/pine/barstate.md.').toEqual([])
  })
})

// ─── ⭐⭐ THE ONE DOOR ───────────────────────────────────────────────────────────

/** The runtime lane's three entry modules. A live file naming any of them in a
 *  module position is a live importer of the lane. */
const LANE_MODULES = ['pineRuntimeFrontend', 'runtime/lowerIr', 'runtime/vm']

/** ⭐ THE ONLY LIVE FILES ALLOWED TO IMPORT THE LANE, and why each is here.
 *
 *  ⛔ AN EXACT SET, NOT A CEILING. Adding a door must fail this file BY NAME, so
 *  the person adding it has to write down here why a second one is safe. */
export const ALLOWED_LANE_IMPORTERS = Object.freeze([
  // the member-door fallback + the compute for the documents it builds — gated
  'components/chart/engine/pineRuntimeLane.js',
  // the lane's own object adapter; its only importer is `ast/peelToBuilding.js`, an
  // instrument that no rendered component reaches (`tools/pine_lane_reachability.mjs`)
  'components/chart/engine/runtime/objectLane.js',
])

/** The ONLY live files allowed to import the fallback module itself. */
export const ALLOWED_DOOR_IMPORTERS = Object.freeze([
  // the member door: asks `isRuntimeFallbackGuard` after the host lane refuses
  'components/chart/builder/memberPane/memberPaneDefinition.js',
  // builds a runtime-lane document at the member door
  'components/chart/builder/memberPane/runtimeLaneDefinition.js',
  // computes one (`computeFor`, kind `pine`) — refused at install when the flag is off
  'components/chart/engine/nativeRegistry.js',
])

/** Does this text import exactly the module `mod` (its path ENDS there)?
 *  ⛔ `names()` above is a substring test on purpose — over-broad is right for a
 *  gate that must not be dodged — but `pineRuntimeLane` is a substring of
 *  `pineRuntimeLaneGate`, so asking "who imports the door" through it counts every
 *  reader of the FLAG as a caller of the LANE. */
function namesModule(text, mod) {
  return new RegExp(
    '(?:from\\s+|import\\s*\\(|require\\s*\\()\\s*[\'"][^\'"]*' + mod + '(?:\\.js)?[\'"]',
  ).test(text)
}

/** Every live (non-test) file that imports any lane module. Pure, so it can be fed
 *  synthetic files — the same reason `importersMissingProducer` is. */
export function liveLaneImporters(files, modules = LANE_MODULES, match = names) {
  return files
    // ⚠️ TEST INFRASTRUCTURE IS NOT A DOOR — the same rule `tools/pine_lane_
    // reachability.mjs` applies. `__tests__/vendorHarness/ourSide.js` imports the
    // document builder to grade it against the vendor, and no component reaches it.
    .filter((f) => !isTest(f.rel) && !/\.measure\.|(^|\/)__tests__\/|(^|\/)__fixtures__\//.test(f.rel))
    .filter((f) => modules.some((m) => match(f.text, m)))
    .map((f) => f.rel)
    .sort()
}

describe('⭐⭐ the runtime lane is reachable ONLY through the gated member-door fallback', () => {
  it('⭐ CONTROL — the predicate fires on a new importer and ignores a test', () => {
    const files = [
      { rel: 'components/x/Scan.jsx', text: 'import { execute } from "../engine/runtime/vm"' },
      { rel: 'components/x/scan.test.js', text: 'import { execute } from "../engine/runtime/vm"' },
      { rel: 'components/x/__tests__/harness.js', text: 'import { execute } from "../engine/runtime/vm"' },
      { rel: 'components/x/Other.jsx', text: 'import y from "./indicators"' },
    ]
    expect(liveLaneImporters(files)).toEqual(['components/x/Scan.jsx'])
  })

  it('⛔⛔ the live importers of the lane are EXACTLY the named door and the lane-internal adapter', () => {
    const got = liveLaneImporters(FILES)
    expect(got, 'a live file imports the runtime lane that is not the gated fallback:\n  '
      + got.filter((r) => !ALLOWED_LANE_IMPORTERS.includes(r)).join('\n  ') + '\n\n'
      + 'THE LANE HAS ONE DOOR: engine/pineRuntimeLane.js, behind '
      + 'VITE_PINE_RUNTIME_LANE_ENABLED. A second importer reaches members without the '
      + 'host-first order, the ruling-guard exclusion or the flag. Route it through '
      + 'pineRuntimeLane.js, or add it to ALLOWED_LANE_IMPORTERS with the reason.')
      .toEqual([...ALLOWED_LANE_IMPORTERS].sort())
  })

  it('⛔⛔ the fallback itself has exactly the named importers, and the entry points read the flag', () => {
    const doorImporters = liveLaneImporters(FILES, ['pineRuntimeLane'], namesModule)
    expect(doorImporters).toEqual([...ALLOWED_DOOR_IMPORTERS].sort())
    // control: the exact matcher still sees the FLAG's readers as a different module
    expect(liveLaneImporters(FILES, ['pineRuntimeLaneGate'], namesModule))
      .toContain('components/chart/engine/pineRuntimeLane.js')
    // ⭐ THE ADAPTER READS THE FLAG TOO, so a caller that forgot to is still closed.
    const byRel = new Map(FILES.map((f) => [f.rel, f.text]))
    for (const rel of ['components/chart/engine/pineRuntimeLane.js',
      'components/chart/engine/nativeRegistry.js',
      'components/chart/builder/memberPane/memberPaneDefinition.js']) {
      expect(names(byRel.get(rel) || '', 'pineRuntimeLaneGate'),
        `${rel} does not read VITE_PINE_RUNTIME_LANE_ENABLED through pineRuntimeLaneGate`).toBe(true)
    }
    // …and the document builder is reached from the member door alone.
    expect(liveLaneImporters(FILES, ['memberPane/runtimeLaneDefinition', './runtimeLaneDefinition']))
      .toEqual(['components/chart/builder/memberPane/memberPaneDefinition.js'])
  })
})

describe('⛔ with the flag unset, the lane does nothing a member can reach', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('the door answers exactly the host refusal, and the adapter refuses to build or compute', async () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '')
    const { memberPaneDefinition } = await import('../../builder/memberPane/memberPaneDefinition')
    const { runtimeLaneBuild, runtimeLaneColumns } = await import('../pineRuntimeLane')
    const src = '//@version=5\nindicator("s")\nvar float s = 0.0\ns := s + close\nplot(s)\n'
    const d = memberPaneDefinition({ source: src, id: 'u_member-pane-gate' })
    expect(d.ok).toBe(false)
    expect(d.guard).toBe('pine:state')
    expect(d.lane).toBeUndefined()
    expect(d.runtimeRefusal).toBeUndefined()
    expect(runtimeLaneBuild(src).ok).toBe(false)
    const { columns, errors } = runtimeLaneColumns(
      { compute: { kind: 'pine', source: src, columns: { value: { output: 0, call: 'plot' } } } },
      [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }], {}, {})
    expect(columns).toEqual({})
    expect(errors.value.guard).toBe('runtime-door:off')
  })
})
