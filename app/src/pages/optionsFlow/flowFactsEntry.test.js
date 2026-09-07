// The Options Flow analytics must run under Node, unchanged, so the server can
// produce the SAME numbers the browser does.
//
// WHY: /api/flow/data?days=1 is a 14 MB CSV of 107,348 raw prints, and the
// browser spends ~502 ms building row objects + ~1,351 ms in processFlowData
// (its own comment) to reduce them to ~26.8k trades and a handful of
// aggregates — on every first load, on the member's machine.
//
// ⛔ The point of bundling the REAL functions is that the numbers cannot drift.
// A Python port would be a second authority over the figures members trade on.
// So the load-bearing test is not "it returns something" — it is that the entry
// calls the same parseCSV/processFlowData the page imports.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { aggregateCsv, USAGE } from './flowFactsEntry.js'
import { parseCSV, processFlowData, availableDatesFrom } from './flowCompute.js'

const FIXTURE = path.resolve(process.cwd(), 'src/pages/optionsFlow/__fixtures__/flow-sample.csv')

describe('flowFactsEntry', () => {
  const csv = fs.readFileSync(FIXTURE, 'utf8')

  it('produces byte-identical output to the browser pipeline — the whole point', () => {
    // If these ever diverge, the server is serving different numbers than the
    // page would compute, which is worse than the slowness it exists to fix.
    const viaEntry = aggregateCsv(csv).D
    // `null`, not `new Set()` — that is the argument the entry actually passes,
    // and the two are NOT equivalent (see the earnings-flag test below). Pinning
    // parity against a call the entry does not make would pass here only because
    // this fixture's ER column happens to be uniformly 'F'.
    const direct = processFlowData(parseCSV(csv), null)
    expect(JSON.stringify(viaEntry)).toBe(JSON.stringify(direct))
  })

  it("lets the CSV's OWN earnings flag survive when no caller supplies one", () => {
    // ⛔ THE BUG THIS PINS. processFlowData reads `erSoonSet instanceof Set` as
    // "the caller is the authority on earnings" and otherwise falls back to the
    // row's own ER column. An EMPTY SET IS STILL A SET, so passing `new Set([])`
    // — the obvious server-side default — satisfies that test and silently
    // rewrites every row to er:false, discarding a flag the tape already carries.
    // This process has no user and therefore no earnings list to impose, so it
    // passes null and lets the data speak.
    //
    // ⚠️ The shipped fixture CANNOT catch this: its ER column is uniformly 'F',
    // so both behaviours agree on it. Hence this hand-built CSV, which carries
    // one ER=T row and one ER=F row.
    const header = 'CreatedDate,CreatedTime,Symbol,Type,Volume,Price,Side,CallPut,'
      + 'Strike,Spot,Premium,ExpirationDate,Color,ImpliedVolatility,Dte,ER,'
      + 'StockEtf,Sector,Uoa,Weekly,MktCap,OI'
    const row = (sym, er) => `7/24/2026,10:00:00 AM,${sym},SWEEP,500,10.5,,CALL,`
      + `100,95.0,525000,7/31/2026,WHITE,0,7,${er},STOCK,Information Technology,F,T,5e10,900`
    const mixed = [header, row('AAAA', 'T'), row('BBBB', 'F')].join('\n') + '\n'

    const rows = parseCSV(mixed)
    const erOf = (D) => Object.fromEntries(
      (D.all_trades || []).map(t => [t.S, !!t.er]))

    // The control: this fixture DISCRIMINATES. An empty Set must lose the flag
    // that null keeps — if these agree, the test below proves nothing.
    const viaEmptySet = erOf(processFlowData(rows, new Set()))
    const viaNull = erOf(processFlowData(rows, null))
    expect(viaNull.AAAA).toBe(true)
    expect(viaEmptySet.AAAA).toBe(false)

    // And the entry must take the honest branch.
    expect(erOf(aggregateCsv(mixed).D).AAAA).toBe(true)
    expect(erOf(aggregateCsv(mixed).D).BBBB).toBe(false)

    // A caller that DOES supply a list still wins outright.
    expect(erOf(aggregateCsv(mixed, { erSoon: ['BBBB'] }).D))
      .toEqual({ AAAA: false, BBBB: true })
  })

  it('reports sizing telemetry the caller can act on', () => {
    const { stats } = aggregateCsv(csv)
    expect(stats.rawRows).toBeGreaterThan(0)
    expect(stats.csvBytes).toBe(csv.length)
    expect(typeof stats.parseMs).toBe('number')
    expect(typeof stats.processMs).toBe('number')
    expect(stats.totalMs).toBe(stats.parseMs + stats.processMs)
  })

  it('refuses an empty CSV rather than returning an empty dataset', () => {
    // An empty result served as though it were the day's flow is the failure
    // that looks like a quiet market.
    expect(() => aggregateCsv('')).toThrow(/non-empty/)
    expect(() => aggregateCsv('CreatedDate,Symbol\n')).toThrow(/0 valid rows/)
  })

  it('does not self-run when imported — only the built CLI does', () => {
    // The sentinel is stamped in by the bundler. If importing this module ran
    // main(), every test importing it would hang on stdin.
    expect(USAGE).toMatch(/flow-facts aggregate/)
  })

  it('is importable under Node with no DOM — no window, document or fetch', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/optionsFlow/flowFactsEntry.js'), 'utf8')
    const body = src.replace(/^\/\/.*$/gm, '')          // strip the comment header
    for (const forbidden of ['window.', 'document.', 'fetch(']) {
      expect(body.includes(forbidden), `entry touches ${forbidden}`).toBe(false)
    }
  })

  // ── stats.availableDates — the date picker's calendar ─────────────────────
  //
  // WHY THIS IS EMITTED AT ALL. The page derives `availableDates` by PARSING
  // THE TAPE, and the date-range picker renders only when
  // `availableDates.length > 0`. Deferring the tape off the cold path therefore
  // made the whole control DISAPPEAR — speed bought by hiding a capability.
  // The server already parsed the same rows, so it emits the same calendar.
  describe('stats.availableDates', () => {
    const header = 'CreatedDate,CreatedTime,Symbol,Type,Volume,Price,Side,CallPut,'
      + 'Strike,Spot,Premium,ExpirationDate,Color,ImpliedVolatility,Dte,ER,'
      + 'StockEtf,Sector,Uoa,Weekly,MktCap,OI'
    const row = (date, sym) => `${date},10:00:00 AM,${sym},SWEEP,500,10.5,,CALL,`
      + `100,95.0,525000,12/31/2026,WHITE,0,7,F,STOCK,Information Technology,F,T,5e10,900`

    it('is exactly what the page would derive from the same rows', () => {
      // Identity, not agreement: one helper, one input. A second implementation
      // is what would let the picker and the tape disagree.
      const { stats } = aggregateCsv(csv)
      expect(stats.availableDates).toEqual(availableDatesFrom(parseCSV(csv)))
      expect(stats.availableDates.length).toBeGreaterThan(0)
    })

    it('is the FETCHED calendar, not the SELECTED one', () => {
      // ⛔ THE LOAD-BEARING CASE. `availableDates` follows the fetched window —
      // it is what the picker offers, so it must include days the current
      // filter excludes. Emitting the post-filter set would be invisible on a
      // single-date fixture (the shipped one) and would silently shrink the
      // picker to the one day already on screen, making every other day
      // unreachable. Three dates in, Last1 selects the newest.
      const multi = [header, row('7/22/2026', 'AAAA'), row('7/23/2026', 'BBBB'),
                     row('7/24/2026', 'CCCC')].join('\n') + '\n'

      const { stats } = aggregateCsv(multi, { dateFilter: 'Last1' })
      expect(stats.availableDates).toEqual(['7/22/2026', '7/23/2026', '7/24/2026'])

      // The control: this fixture DISCRIMINATES. The selection really is
      // narrower, so a post-filter emit would have produced a different — and
      // wrong — answer here rather than coincidentally matching.
      expect(stats.selectedRows).toBe(1)
      expect(stats.rawRows).toBe(3)
    })

    it('is chronological, so min/max bound the picker correctly', () => {
      // The picker reads [0] and [length-1] as its range ends; input order must
      // not decide them.
      const shuffled = [header, row('7/24/2026', 'CCCC'), row('7/22/2026', 'AAAA'),
                        row('7/23/2026', 'BBBB')].join('\n') + '\n'
      const { stats } = aggregateCsv(shuffled)
      expect(stats.availableDates).toEqual(['7/22/2026', '7/23/2026', '7/24/2026'])
    })

    it('survives JSON transport — it crosses a process boundary', () => {
      // The value reaches the page as JSON over HTTP, not as a live array.
      const { stats } = aggregateCsv(csv)
      expect(JSON.parse(JSON.stringify(stats)).availableDates)
        .toEqual(stats.availableDates)
    })
  })

})

// ── the CLI contract: stdout carries ONLY the payload ───────────────────────

describe('the built CLI', () => {
  const { execFileSync } = require('node:child_process')
  const BUNDLE = path.resolve(process.cwd(), 'dist/flow-facts.cjs')
  const csv = fs.readFileSync(FIXTURE, 'utf8')
  const built = fs.existsSync(BUNDLE)

  it.runIf(built)('writes ONLY JSON to stdout — processFlowData logs to stdout otherwise', () => {
    // ⛔ THE BUG THIS PINS, caught on the CLI's first real run: processFlowData
    // emits progress notes ("[ML/ rescue] rescued 2 isolated ML/ trades") via
    // console.log, which in Node is STDOUT. That line landed in front of the
    // JSON, so a caller doing json.loads(stdout) failed with a parse error that
    // said nothing about its cause. The entry now routes console to stderr.
    const out = execFileSync('node', [BUNDLE, 'stats'], { input: csv, encoding: 'utf8' })
    expect(() => JSON.parse(out)).not.toThrow()
    expect(JSON.parse(out).ok).toBe(true)
  })

  it.runIf(built)('still EMITS those diagnostics, on stderr — redirected, not muted', () => {
    // The control for the test above: muting console.log would also make stdout
    // clean, and would throw away information the caller wants.
    const res = require('node:child_process').spawnSync(
      'node', [BUNDLE, 'stats'], { input: csv, encoding: 'utf8' })
    expect(res.stderr).toMatch(/ML\/ rescue/)
  })

  it.runIf(built)('writes NOTHING to stdout when it fails', () => {
    // So a caller can never mistake a diagnostic for a payload.
    const res = require('node:child_process').spawnSync(
      'node', [BUNDLE, 'aggregate'], { input: '', encoding: 'utf8' })
    expect(res.status).toBe(2)
    expect(res.stdout).toBe('')
    expect(res.stderr).toMatch(/non-empty|0 valid rows/)
  })

})
