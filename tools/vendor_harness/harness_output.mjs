// tools/vendor_harness/harness_output.mjs
//
// ─── WHAT A VENDOR-HARNESS RUN WRITES — one authority for both writers ───────
//
// `vendorHarness.corpus.test.js` (a single run) and `parallel_run.mjs` (the
// merge of N shard runs) both write `verdicts.json` and `summary.md` through
// THESE functions, so the merged files cannot drift from a single run's: the
// byte-identity rail (`parallel_rail.mjs`) compares them, and this module is why
// they can be equal by construction rather than by a second copy of the code.
//
// Pure: no engine import. It imports the comparator's table renderer and the
// lane rail, both pure `.mjs`, so the merger runs under plain node.

import fs from 'node:fs'
import path from 'node:path'
import { renderSummary } from './compare.mjs'
import { assertLaneMeasured, laneShown } from '../pine_coverage/runtime_lane.mjs'

/** Declines by code, most first, ties by code. */
export function sortDeclines(declines) {
  return Object.fromEntries(Object.entries(declines).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)))
}

/** The lane evidence object, in its one key order. */
export function laneEvidence({ gateOpen, declined, gated, runtimeDrawn, hostRefused, declines }) {
  return {
    gateOpen, declined, gated, runtimeDrawn, hostRefused, reachedRuntime: declined + runtimeDrawn,
    declines: sortDeclines(declines),
  }
}

/** Shard evidences are counts: their sum is the single run's evidence. */
export function mergeLaneEvidence(list) {
  const declines = {}
  let declined = 0
  let gated = 0
  let runtimeDrawn = 0
  let hostRefused = 0
  const gates = new Set(list.map((e) => e.gateOpen))
  if (gates.size !== 1) throw new Error(`shards disagree on gateOpen: ${[...gates].join(', ')}`)
  for (const e of list) {
    declined += e.declined
    gated += e.gated
    runtimeDrawn += e.runtimeDrawn
    hostRefused += e.hostRefused
    for (const [c, n] of Object.entries(e.declines)) declines[c] = (declines[c] || 0) + n
  }
  return laneEvidence({ gateOpen: list[0].gateOpen, declined, gated, runtimeDrawn, hostRefused, declines })
}

/** The lane line, and the error a wrong lane raises (never thrown here). */
export function laneReport({ requested, evidence, objectsOnly }) {
  const lane = requested || laneShown(evidence)
  let laneLine
  let laneError = null
  try {
    laneLine = requested
      ? assertLaneMeasured({ requested, ...evidence, what: 'vendor harness' })
      : `LANE MEASURED: ${lane} (suite default, not asserted; gate ${evidence.gateOpen ? 'OPEN' : 'CLOSED'}, `
        + `runtime lane reached ${evidence.reachedRuntime}, host refusals ${evidence.hostRefused})`
  } catch (err) {
    laneError = err
    laneLine = String(err.message)
  }
  laneLine += ` · objects-only pane ${objectsOnly ? 'ARMED' : 'off'} · runtime drew ${evidence.runtimeDrawn}, declined ${evidence.declined}`
  return { lane, laneLine, laneError }
}

/** What the run prints. */
export function consoleBlock({ laneLine, results, inventory }) {
  return `\n${laneLine}\n${renderSummary(results)}\n\nNOT COMPARABLE (${inventory.length}):\n${inventory.map((i) => `  - ${i.file}: ${i.reason}`).join('\n')}\n`
}

/** Write `verdicts.json` + `summary.md` into `out`.
 *  @param {string} out
 *  @param {{dirsRel: string[], lane: string, laneLine: string, requested: string|null,
 *           objectsOnly: boolean, evidence: object, results: object[], inventory: object[]}} run */
export function writeHarnessOutputs(out, { dirsRel, lane, laneLine, requested, objectsOnly, evidence, results, inventory }) {
  const table = renderSummary(results)
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, 'verdicts.json'), JSON.stringify({
    generatedBy: 'app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js',
    dirs: dirsRel,
    lane,
    laneEvidence: { requested, objectsOnlyPane: objectsOnly, ...evidence },
    results,
    inventory,
  }, null, 1) + '\n')
  fs.writeFileSync(path.join(out, 'summary.md'), [
    '# Vendor harness — verdicts',
    '',
    `Directories: ${dirsRel.map((d) => `\`${d}\``).join(', ')}`,
    '',
    `Lane: **${lane}**${requested ? '' : ' (suite default, not requested)'}. ${laneLine}`,
    '',
    '```', table, '```', '',
    ...(evidence.declined ? [`## Runtime declines by code (${evidence.declined})`, '',
      ...Object.entries(evidence.declines).map(([c, n]) => `- \`${c}\` ${n}`), ''] : []),
    `## Not comparable (${inventory.length})`, '',
    ...inventory.map((i) => `- \`${i.file}\` — ${i.reason}`), '',
  ].join('\n'))
}

/** The file one shard writes into its own VENDOR_HARNESS_OUT. */
export const HARNESS_SHARD_FILE = 'harness-shard.json'
/** The file one census shard writes (its VENDOR_BATCH_CENSUS_OUT is this path). */
export const CENSUS_SHARD_KIND = 'member-door-census-shard'

/** Order `items` (each with `.file`) by their position in `order` (ids). Throws on an
 *  item the order does not name, or a duplicate: a merge must account for every file
 *  exactly once. */
export function orderByIds(items, order) {
  const at = new Map(order.map((id, i) => [id, i]))
  const seen = new Set()
  for (const it of items) {
    if (!at.has(it.file)) throw new Error(`merge: ${it.file} is not in the run's file list`)
    if (seen.has(it.file)) throw new Error(`merge: ${it.file} appears in two shards`)
    seen.add(it.file)
  }
  return [...items].sort((a, b) => at.get(a.file) - at.get(b.file))
}
