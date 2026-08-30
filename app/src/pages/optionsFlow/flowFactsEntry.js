// app/src/pages/optionsFlow/flowFactsEntry.js
//
// Node CLI entry for the Options Flow analytics — plain ESM, no React, no DOM,
// no `window`. `scripts/build-flow-facts.mjs` bundles it into
// `dist/flow-facts.cjs` so the Python backend can run the SAME aggregation the
// browser runs (`flowCompute.js`) — ONE AUTHORITY, no Python port.
//
// WHY THIS EXISTS (measured on prod 2026-08-29)
// ---------------------------------------------
// `/api/flow/data?days=1` is a 14 MB CSV of 107,348 raw option prints. The
// browser then:
//     builds 107,346 row objects × 21 fields  ~502 ms
//     runs processFlowData (30+ passes)      ~1,351 ms   (its own comment)
// …to render summary numbers, DTE buckets, sector totals and top-N lists. That
// ~1.85 s of pure client compute happens on EVERY first load, on the member's
// machine, to reduce 107k prints to ~26.8k trades and a handful of aggregates.
//
// The server already holds the rows in SQLite. Doing this once per data VERSION
// and caching the result turns a per-member cost into a per-version one.
//
// ⛔ THE ANALYTICS ARE NOT REIMPLEMENTED. A Python port would put a second
// authority on the product's numbers — the defect this repo names most often —
// and these are the numbers members trade on. This bundles the exact functions
// the browser calls, the way `cotFactsEntry.js` already does for COT.
//
//   node flow-facts.cjs aggregate < flow.csv   → {"ok":true,"stats":{...},"D":{...}}
//   node flow-facts.cjs stats     < flow.csv   → {"ok":true,"stats":{...}}   (no D)
//
// Output is compact JSON plus one newline. On failure a message goes to stderr,
// the exit code is 2, and NOTHING is written to stdout — so a caller can never
// mistake a diagnostic for a payload.
/* global process, Buffer, __FLOW_FACTS_CLI__ */
import { parseCSV, processFlowData, filterRowsByDate, availableDatesFrom } from './flowCompute'

export const USAGE = [
  'usage:',
  '  flow-facts aggregate [--date-filter=Last1] < flow.csv   dataset as JSON',
  '  flow-facts stats     < flow.csv   sizing/telemetry only, no row payload',
].join('\n')

/**
 * Run the browser's own pipeline over a CSV.
 *
 * `erSoon` is the earnings-soon symbol set the page passes in; it drives the
 * per-row `er` badge.
 *
 * ⛔ WHEN NO SET IS SUPPLIED, PASS `null` — NOT AN EMPTY SET.
 * `processFlowData` reads `erSoonSet instanceof Set` as "the caller is the
 * authority on earnings" and otherwise falls back to the CSV's OWN `er` column.
 * An empty Set is still a Set, so it satisfies that test and silently overrides
 * every row to `er:false` — discarding a flag the tape already carries. Passing
 * null lets the data speak for itself, which is the honest server-side default:
 * this process has no user, and therefore no earnings-soon list to impose.
 */
export function aggregateCsv(csv, { erSoon = null, dateFilter = null } = {}) {
  if (typeof csv !== 'string' || csv.length === 0) {
    throw new Error('stdin must be a non-empty CSV')
  }
  const t0 = Date.now()
  const rows = parseCSV(csv)
  const parseMs = Date.now() - t0
  if (!rows.length) throw new Error('CSV parsed but contained 0 valid rows')

  // APPLY THE PAGE'S OWN DATE SELECTION, through the page's own helper.
  // The page opens on dateFilter='Last1' over a days=1 fetch, so aggregating
  // the whole CSV USUALLY lands on the same rows -- but only because that
  // window usually holds exactly one session. On a CSV spanning two dates (a
  // boundary, a backfill) "usually" silently becomes a DIFFERENT dataset than
  // the page renders, and the numbers would change under the reader a couple
  // of seconds after first paint. Filtering here with filterRowsByDate makes
  // the match structural instead of coincidental.
  const selected = dateFilter
    ? filterRowsByDate(rows, { dateFilter, availableDates: availableDatesFrom(rows) })
    : rows
  if (!selected.length) throw new Error('no rows match dateFilter=' + dateFilter)

  const t1 = Date.now()
  const D = processFlowData(selected, erSoon == null ? null : new Set(erSoon))
  const processMs = Date.now() - t1

  return {
    D,
    stats: {
      csvBytes: csv.length,
      rawRows: rows.length,
      dateFilter: dateFilter || 'All',
      selectedRows: selected.length,
      parseMs,
      processMs,
      totalMs: parseMs + processMs,
      // What the client would otherwise have had to build for itself.
      totalTrades: D ? D.totalTrades : 0,
      confirmedCount: D ? D.confirmedCount : 0,
    },
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = []
    process.stdin.on('data', (c) => chunks.push(c))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', reject)
  })
}

/**
 * Send every console channel to STDERR for the duration of a CLI run.
 *
 * ⛔ NOT cosmetic. `processFlowData` logs progress notes — e.g.
 * "[ML/ rescue] rescued 2 isolated ML/ trades" — via console.log, which in Node
 * is STDOUT. That line lands in front of the JSON and a caller doing
 * `json.loads(stdout)` fails on it. Caught the first time the CLI was run
 * against the fixture; without this the integration would have failed on a real
 * day's data with a parse error that says nothing about its cause.
 *
 * The notes are still worth having, so they are redirected rather than muted —
 * stderr is where a CLI's diagnostics belong, and the caller already reads it.
 */
function routeConsoleToStderr() {
  const write = (...a) => process.stderr.write(a.map(String).join(' ') + '\n')
  console.log = write
  console.info = write
  console.warn = write
  console.debug = write
}

export async function main(argv) {
  const cmd = argv[0]
  if (cmd !== 'aggregate' && cmd !== 'stats') {
    process.stderr.write(USAGE + '\n')
    process.exitCode = 2
    return
  }
  routeConsoleToStderr()
  try {
    const flag = argv.find(a => a.startsWith('--date-filter='))
    const dateFilter = flag ? flag.slice('--date-filter='.length) : null
    const csv = await readStdin()
    const { D, stats } = aggregateCsv(csv, { dateFilter })
    const payload = cmd === 'stats' ? { ok: true, stats } : { ok: true, stats, D }
    process.stdout.write(JSON.stringify(payload) + '\n')
  } catch (err) {
    process.stderr.write(String((err && err.message) || err) + '\n')
    process.exitCode = 2
  }
}

// The bundler defines __FLOW_FACTS_CLI__ = true so only the built CLI self-runs;
// importing this module from a test must never execute it. Same sentinel idiom
// as cotFactsEntry.js.
if (typeof __FLOW_FACTS_CLI__ !== 'undefined' && __FLOW_FACTS_CLI__) {
  main(process.argv.slice(2))
}
