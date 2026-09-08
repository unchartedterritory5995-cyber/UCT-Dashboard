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
import { parseCSV, processFlowData, filterRowsByDate, availableDatesFrom, makeIsETF } from './flowCompute'
import { partsFrom } from './flowBootstrap'
import { buildTopPickProduct } from './flowTopPicksProduct'
import { buildSearchProduct } from './flowSearchProduct'
import { readFileSync } from 'node:fs'

export const USAGE = [
  'usage:',
  '  flow-facts aggregate [--date-filter=Last1] [--split] < flow.csv   dataset as JSON',
  '  flow-facts stats     < flow.csv   sizing/telemetry only, no row payload',
  '',
  '  --split  emit {parts} instead of {D}: `bootstrap` plus ONE part per deferred',
  '           key. Same computation, same values; only the PARTITION differs, and',
  '           recombining every part yields the identical object. Per-key parts so',
  '           a surface fetches what it reads — never most of the tape on the first',
  '           tab click. See flowBootstrap.js for the consumption audit.',
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
  // The trading calendar of the FETCHED window, hoisted because it is now also
  // EMITTED (see stats.availableDates below) rather than only used here.
  const availableDates = availableDatesFrom(rows)
  const selected = dateFilter
    ? filterRowsByDate(rows, { dateFilter, availableDates })
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
      // ⛔ NOT a statistic — a VALUE the page cannot otherwise obtain without
      // the tape. `availableDates` drives the date-range picker, and the page
      // derives it by parsing the raw CSV. Defer that download and the picker
      // gates itself off (`availableDates.length > 0`) and DISAPPEARS — a
      // control vanishing is exactly the "hide missing data" failure the
      // deferral is not allowed to buy speed with.
      //
      // Emitted from the SAME function over the SAME unfiltered rows the page
      // would have used, so it is identical by construction rather than by
      // agreement — no second implementation to drift. It is deliberately the
      // UNFILTERED calendar: `availableDates` follows the FETCHED window, not
      // the current selection, which is why /api/flow/dates (every date in the
      // DB) cannot stand in for it.
      availableDates,
    },
  }
}

/**
 * Load the ETF/index replica the TOP 10 product must be classified against.
 *
 * The file is `{"generation": "<digest>", "symbols": ["SPY", ...]}` written by
 * the caller from `optionsflow_etf_replica`. A path, not stdin, because stdin
 * already carries the CSV; a file, not an env var, because the set is ~19.5k
 * symbols.
 *
 * ⛔ RETURNS NULL ON ANY PROBLEM, AND NULL MEANS "DO NOT EMIT THE PRODUCT".
 * It must never fall back to classifying with the hardcoded set alone: that
 * would produce a well-formed TOP 10 computed against a DIFFERENT universe than
 * the browser uses, stamped with a generation that would then match. Declining
 * to emit leaves the client on its existing path, which is the safe direction.
 */
export function loadEtfReplica(path) {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    const gen = raw && raw.generation
    if (typeof gen !== 'string' || gen === '') return null
    if (!Array.isArray(raw.symbols)) return null
    const set = new Set()
    for (const sym of raw.symbols) set.add(String(sym || '').toUpperCase())
    if (set.size === 0) return null
    return { generation: gen, symbols: set }
  } catch {
    return null
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
  if (cmd !== 'aggregate' && cmd !== 'stats' && cmd !== 'search') {
    process.stderr.write(USAGE + '\n')
    process.exitCode = 2
    return
  }
  routeConsoleToStderr()
  try {
    const flag = argv.find(a => a.startsWith('--date-filter='))
    const dateFilter = flag ? flag.slice('--date-filter='.length) : null
    const etfFlag = argv.find(a => a.startsWith('--etf-file='))
    const replica = etfFlag ? loadEtfReplica(etfFlag.slice('--etf-file='.length)) : null
    const csv = await readStdin()
    if (cmd === 'search') {
      // The Search deep dive for ONE ticker.
      //
      // ⛔ `erSoon` IS NULL, DELIBERATELY. `processFlowData` treats a Set as the
      // authority and sets `er = set.has(symbol)`; null lets the tape's own
      // column speak. Computing with null is what makes this product
      // USER-INDEPENDENT and therefore cacheable — the client re-applies its own
      // earnings set on arrival (flowSearchProduct.applyErOverlay), which is
      // deep-equal to having computed it with that set. Proven in
      // searchErIndependence.test.js, with the wrong-set control.
      //
      // ⛔ NO --date-filter HERE. `/api/flow/ticker` has no range parameter: it
      // returns the ticker's COMPLETE history and the page scopes it at render
      // time (_scopeAllDirectional). Filtering here would make the product
      // range-specific, which would both change the answer and silently break
      // a cache key that legitimately omits range.
      const rows = parseCSV(csv)
      const D = rows.length ? processFlowData(rows, null) : null
      const product = buildSearchProduct(D)
      process.stdout.write(JSON.stringify({ ok: true, product, rows: rows.length }) + String.fromCharCode(10))
      return
    }
    const { D, stats } = aggregateCsv(csv, { dateFilter })
    // 3b: the TOP 10 product. Built ONLY when a replica was supplied and read
    // cleanly — see loadEtfReplica. It is emitted as its own part and is
    // DERIVED, not a partition of D, so partsFrom() keeps its lossless
    // property: bootstrap + the deferred parts still reconstitute D exactly.
    const topPicks = replica
      ? buildTopPickProduct(D, { isEtfFn: makeIsETF(replica.symbols), generation: replica.generation })
      : null
    // --split changes only how the SAME result is partitioned for the wire. The
    // default output stays byte-identical, so the existing endpoint and its
    // fallback path are untouched by this flag existing.
    let payload
    if (cmd === 'stats') {
      payload = { ok: true, stats }
    } else if (argv.includes('--split-frames')) {
      // ⛔ FRAMES, NOT JSON, AND THE REASON IS THE POD.
      // The caller is a single uvicorn process that has OOM'd on this box before.
      // Handing it {parts:{...}} would make it json.loads() a 20+ MB document and
      // materialise a six-figure object graph — transiently, but once per data
      // version, on the request path of whoever missed the cache. Length-prefixed
      // frames let it slice each part out as opaque BYTES and gzip them without
      // ever parsing the arrays. The partition itself is still partsFrom(), so
      // this is a transport detail and not a second authority on what is deferred.
      //
      //   STATS <byteLen>\n<json>\n
      //   PART <name> <byteLen>\n<json>\n   (repeated, one per part)
      const parts = partsFrom(D)
      const chunks = []
      const frame = (header, body) => {
        const b = Buffer.from(body, 'utf8')
        chunks.push(Buffer.from(`${header} ${b.length}\n`, 'utf8'), b, Buffer.from('\n', 'utf8'))
      }
      frame('STATS', JSON.stringify(stats))
      for (const name of Object.keys(parts)) frame(`PART ${name}`, JSON.stringify(parts[name]))
      if (topPicks) frame('PART TOP_PICKS', JSON.stringify(topPicks))
      process.stdout.write(Buffer.concat(chunks))
      return
    } else if (argv.includes('--split')) {
      // One part per deferred key, not one deferred blob — so a surface can be
      // served exactly what it reads instead of most of the tape on first click.
      payload = { ok: true, stats, parts: topPicks
        ? { ...partsFrom(D), TOP_PICKS: topPicks }
        : partsFrom(D) }
    } else {
      payload = { ok: true, stats, D }
    }
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
