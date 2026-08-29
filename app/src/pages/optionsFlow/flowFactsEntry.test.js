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
import { parseCSV, processFlowData } from './flowCompute.js'

const FIXTURE = path.resolve(process.cwd(), 'src/pages/optionsFlow/__fixtures__/flow-sample.csv')

describe('flowFactsEntry', () => {
  const csv = fs.readFileSync(FIXTURE, 'utf8')

  it('produces byte-identical output to the browser pipeline — the whole point', () => {
    // If these ever diverge, the server is serving different numbers than the
    // page would compute, which is worse than the slowness it exists to fix.
    const viaEntry = aggregateCsv(csv).D
    const direct = processFlowData(parseCSV(csv), new Set())
    expect(JSON.stringify(viaEntry)).toBe(JSON.stringify(direct))
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
