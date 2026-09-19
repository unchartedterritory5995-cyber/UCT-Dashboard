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

import { describe, it, expect } from 'vitest'
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
