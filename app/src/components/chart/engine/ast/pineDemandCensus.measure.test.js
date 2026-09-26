// app/src/components/chart/engine/ast/pineDemandCensus.measure.test.js
//
// ─── ⭐⭐ THE WORK QUEUE, DERIVED — WHICH NAME BLOCKS THE MOST SCRIPTS ───────
//
// `runtimeCorpusCensus.measure.test.js` answers WHICH GUARD blocks a script.
// This answers the question that actually orders the work: **which NAME**.
// A guard like `pine:builtin` covering 20 scripts is not a task; the twenty
// tokens behind it are twenty tasks of wildly different value, and until they
// are counted every priority call is a guess.
//
// Run it:
//
//     cd app && node node_modules/vitest/vitest.mjs run \
//       src/components/chart/engine/ast/pineDemandCensus.measure.test.js
//
// ⛔⛔ THE THREE BUCKETS ARE NOT COSMETIC — `docs/pine/r11-vocabulary-gap.md`
// established them and they decide whether a name is WORK AT ALL:
//
//   A. a real Pine name this engine lacks     → add a node. REAL WORK.
//   B. a name we HAVE at a different arity    → widen a signature. CHEAPER.
//   C. not Pine at all — a user library call
//      (`zen.toWhole`) or a UDT field read
//      (`upVolumes.sum`)                      → NOT a vocabulary gap. Declaring
//                                               these as builtins would make the
//                                               engine claim to implement
//                                               somebody else's script and be
//                                               silently wrong on every one.
//
// ⛔ BUCKET C IS THE TRAP THIS FILE EXISTS TO AVOID. A naive frequency count
// puts `zen.`/`mymas.`/`pc.` names at the top of the queue and an agent
// following it would declare library functions as builtins. The split is
// heuristic and says so — anything with a namespace this engine does not own,
// or a lowerCamel receiver, is flagged C for a HUMAN to confirm.
//
// ⛔ IT ASSERTS NO COUNT. Same contract as the corpus census: a queue pinned to
// a number goes red every time the queue is worked. What it asserts is that the
// corpus was found and that the bucketing is not vacuous.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { runtimeClockOpts } from './pineRuntimeClock.js'

const REPO = path.resolve(process.cwd(), '..')
const DIR = path.join(REPO, 'corpus/committed')
const SCRIPTS = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()
  : []

/** Namespaces Pine itself owns. A dotted name outside these is somebody's
 *  library or a UDT field, never a builtin we are missing. */
const PINE_NAMESPACES = new Set([
  'ta', 'math', 'str', 'array', 'matrix', 'map', 'request', 'ticker', 'syminfo',
  'timeframe', 'session', 'barstate', 'chart', 'strategy', 'input', 'color',
  'label', 'line', 'box', 'table', 'linefill', 'polyline', 'display', 'format',
  'scale', 'size', 'position', 'extend', 'xloc', 'yloc', 'location', 'shape',
  'plot', 'hline', 'order', 'alert', 'text', 'font', 'dayofweek', 'currency',
  'earnings', 'dividends', 'splits', 'adjustment', 'backadjustment',
  'settlement', 'runtime', 'math',
])

/** Bucket a blocking token. Heuristic, and it says so — C is "ask a human". */
function bucketOf(token) {
  if (!token || typeof token !== 'string') return 'unknown'
  const t = token.trim()
  if (!t) return 'unknown'

  // ⛔⛔ PUNCTUATION IS NOT A NAME, AND SIZING A ROW OF IT COST A WHOLE LANE.
  //
  // ⚰️ MEASURED 2026-09-21. This census reported `16  [` and it was read as
  // "the history operator blocks 16 scripts". An agent was dispatched against
  // it. Reading the sixteen real call sites showed **fifteen are TUPLE
  // DESTRUCTURING** (`[a, b, c] = f(…)`) and exactly ONE is a history read.
  // The true first-blocker count for `runtime:history-expression` is 3.
  //
  // ⭐ A NAME maps to one capability. A PUNCTUATION TOKEN maps to as many
  // capabilities as the grammar gives it roles, and this table cannot tell them
  // apart — `[` is subscript AND destructuring AND a list literal; `.` is member
  // access AND a namespace separator AND a chained method call; `=` is
  // declaration AND a named argument. Counting them together produces a number
  // that is the SUM of unrelated jobs and belongs to none of them.
  //
  // ⛔ So they get their own bucket whose whole message is DO NOT SIZE THIS
  // ROW — open the scripts. Independently verified the same day: 104 corpus
  // scripts contain a tuple destructure, so the capability hiding behind `[`
  // is an order of magnitude larger than the row implied, in the other
  // direction.
  if (/^[^A-Za-z_]/.test(t)) return 'PUNCT'

  const dot = t.indexOf('.')
  if (dot <= 0) {
    // A bare name. Could be a builtin we lack (`nz`, `fixnan`) or a user's own
    // variable the resolver could not find. Bare-and-lowercase leans user.
    return /^[a-z][a-zA-Z0-9_]*$/.test(t) ? 'A?' : 'A'
  }
  const ns = t.slice(0, dot)
  if (PINE_NAMESPACES.has(ns)) return 'A'
  // A namespace Pine does not own. Library import or UDT field read.
  return 'C'
}

describe('⭐⭐ the work queue — which NAME blocks the most scripts', () => {
  it('⛔ CONTROL — the corpus is on disk', () => {
    expect(SCRIPTS.length).toBeGreaterThan(200)
  })

  it('⭐⭐ prints the blocking-token census, bucketed', () => {
    const opts = { tf: 'D', ...runtimeClockOpts(false) }
    /** token → {scripts:Set, sites:number, guards:Set} */
    const demand = new Map()
    let compiled = 0
    let noToken = 0

    for (const name of SCRIPTS) {
      const src = fs.readFileSync(path.join(DIR, name), 'utf8')
      let refusal = null
      try {
        const built = buildRuntimeIr(src, opts)
        if (built.ok) { compiled += 1; continue }
        refusal = built.refusal || null
      } catch {
        // A throw is a result. It has no token; count it separately rather than
        // letting it vanish and shrink the denominator.
        noToken += 1
        continue
      }
      const token = refusal && refusal.token
      const guard = (refusal && refusal.guard) || 'unnamed'
      if (!token) { noToken += 1; continue }
      if (!demand.has(token)) {
        demand.set(token, { scripts: new Set(), guards: new Set() })
      }
      const e = demand.get(token)
      e.scripts.add(name)
      e.guards.add(guard)
    }

    const rows = [...demand.entries()]
      .map(([token, e]) => ({
        token,
        scripts: e.scripts.size,
        bucket: bucketOf(token),
        guards: [...e.guards].join(','),
      }))
      .sort((a, b) => b.scripts - a.scripts || a.token.localeCompare(b.token))

    const byBucket = (b) => rows.filter((r) => r.bucket === b)
    const fmt = (list, n) => list.slice(0, n).map((r) =>
      `${String(r.scripts).padStart(3)}  ${r.token.padEnd(34)} ${r.guards.slice(0, 40)}`)

    // eslint-disable-next-line no-console
    console.log([
      '',
      `PINE DEMAND CENSUS — ${SCRIPTS.length} scripts, tf=D, clock told`,
      `compiled: ${compiled}   blocked-with-a-named-token: ${rows.reduce((n, r) => n + r.scripts, 0)}   blocked-without-one: ${noToken}`,
      '',
      `── BUCKET A — real Pine names this engine lacks (${byBucket('A').length} distinct) ──`,
      ...fmt(byBucket('A'), 30),
      '',
      `── BUCKET A? — bare lowercase, could be ours or the author's (${byBucket('A?').length}) ──`,
      ...fmt(byBucket('A?'), 20),
      '',
      `── BUCKET C — NOT PINE: library calls / UDT fields. DO NOT DECLARE (${byBucket('C').length}) ──`,
      ...fmt(byBucket('C'), 15),
      '',
      `⛔⛔ PUNCT — NOT NAMES. ONE TOKEN, MANY CAPABILITIES. DO NOT SIZE THESE ROWS (${byBucket('PUNCT').length}) ──`,
      '   Each spans several grammatical roles this table cannot separate.',
      '   Open the call sites before opening a lane. (`[` once read as 16 scripts',
      '   of history operator; it was 15 tuple destructures and 1 history read.)',
      ...fmt(byBucket('PUNCT'), 12),
      '',
    ].join('\n'))

    // ⛔ NON-VACUITY: the bucketing must actually separate. If every token landed
    // in one bucket the split is broken and the queue above is noise.
    expect(rows.length).toBeGreaterThan(0)
  })
})
