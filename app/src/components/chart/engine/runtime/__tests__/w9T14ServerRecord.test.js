// app/src/components/chart/engine/runtime/__tests__/w9T14ServerRecord.test.js
//
// W9-T14 rail: HOST PARITY OF THE RECORD. The service's job adapter
// (services/pine_runtime/job.mjs), run on the server bundle's own surface (serverEntry.js),
// serves the SAME `strategy` record the browser's run carries (W9 design 3.2, rule 3: one record
// feeds the values, the markers, the report and the server). The seal
// (services/pine_runtime/protocol.mjs) checks it with the one shape check and hashes it, and the
// sealed answer is byte-equal to the committed fixture tests/fixtures/pine_runtime/
// w9t14_strategy_result.json, which tests/test_pine_strategy_backtest.py decodes through the
// Python client: one record, two hosts, two languages.
//
// ⛔ PINS: the committed ledger pins nothing, so a run that should SERVE mocks the ledger reader
// here, in the test, and only here (as w9T11Record.test.js does). No product code takes a pin set.
// ⛔ The broker gate is registered ON here only; the service never registers it (strategy.test.mjs).
//
// Regenerate the fixture (only when the record's shape or the engine legitimately changes):
//   W9T14_WRITE_FIXTURE=1 npx vitest run src/components/chart/engine/runtime/__tests__/w9T14ServerRecord.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('../brokerPins.js', () => ({ pinned: () => true }))
vi.setConfig({ testTimeout: 120000 })

import * as serverRt from '../serverEntry.js'
import { computeRuntimeColumns } from '../runtimeColumns.js'
import { registerStrategyBrokerGate } from '../../strategyBrokerGateRegistry.js'
import { STRATEGY_WINDOW_HISTORY, runtimeStrategyOf } from '../strategyRecord.js'
import { runJob } from '../../../../../../../services/pine_runtime/job.mjs'
import { STRATEGY_WANT, sealRunResults } from '../../../../../../../services/pine_runtime/protocol.mjs'

const FIXTURE = path.resolve(__dirname, '../../../../../../../tests/fixtures/pine_runtime/w9t14_strategy_result.json')
// r1: the service's REAL sealed reply for a strategy document with the broker gate unregistered (the
// service's state today); tests/test_pine_strategy_backtest.py replays it through the route.
const DARK_FIXTURE = path.resolve(__dirname, '../../../../../../../tests/fixtures/pine_runtime/w9t14_dark_result.json')
const NL = String.fromCharCode(10)
const N = 30
const BARS = Array.from({ length: N }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100 + i, h: 101.5 + i, l: 99 + i, c: 100.5 + i, v: 1000 + i }))
// a synthetic script written for this rail (no licence-held text)
const SRC = ['//@version=5', 'strategy("w9t14")', 'if bar_index == 3', '    strategy.entry("L", strategy.long)',
  'if bar_index == 10', '    strategy.close("L")', 'if bar_index == 20', '    strategy.entry("S", strategy.short)',
  'plot(strategy.position_size)', ''].join(NL)
const DOC = { id: 'w9t14-parity', meta: { runtimeHistory: STRATEGY_WINDOW_HISTORY },
  compute: { kind: 'runtime', fn: 'runtime:w9t14-parity', outputs: { p: 0 }, source: SRC } }
const IDENTITY = { script_engine: 'fixture', runtime_language: 'pine', runtime_frontend: 1, runtime_ir: 1, bundle_sha256: 'ab'.repeat(32) }
const CODEC = { columnDigest: serverRt.columnDigest, decodeColumn: serverRt.decodeColumn,
  strategyRecordShapeErrors: serverRt.strategyRecordShapeErrors }

const gate = (on) => registerStrategyBrokerGate(on ? () => true : () => false)
afterEach(() => gate(false))

/** One parsed wire job (protocol.mjs parseRunRequest's output shape). */
function jobOf({ listing = true, window = N } = {}) {
  const col = (k) => BARS.map((b) => b[k])
  return { job: 'RDDT', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, tf: 'D',
    bars: { n: N, t: col('t'), o: col('o'), h: col('h'), l: col('l'), c: col('c'), v: col('v') },
    ctx: { newestBarIsForming: false, historyFromListing: listing, runtimeInputs: {}, historyWindowBars: window },
    want: [STRATEGY_WANT] }
}
const browserCtx = (job) => ({ tf: 'D', newestBarIsForming: false, historyFromListing: job.ctx.historyFromListing,
  runtimeInputs: {}, symbol: job.symbol, historyWindowBars: job.ctx.historyWindowBars })

describe('W9-T14 host parity of the record', () => {
  it('the service adapter serves the record the browser run carries, field for field', () => {
    gate(true)
    const job = jobOf()
    const browser = runtimeStrategyOf(computeRuntimeColumns(DOC, BARS, browserCtx(job), { incremental: false }))
    expect(browser).not.toBe(null)
    expect(browser.trades.length).toBe(2)
    const served = runJob(serverRt, DOC, job)
    expect(served.status).toBe('ok')
    expect(served.columns).toEqual({})
    expect(JSON.parse(served.strategy)).toEqual(browser)
    expect(served.strategy).toBe(JSON.stringify(browser))
  })

  it('the sealed answer is the committed fixture, byte for byte', () => {
    gate(true)
    const job = jobOf()
    const { ms, ...served } = runJob(serverRt, DOC, job)
    const sealed = sealRunResults(CODEC, IDENTITY, [job], [served])
    expect(sealed.ok).toBe(true)
    const fixture = { identity: IDENTITY, job: { job: job.job, n: N, want: job.want }, result: sealed.results[0] }
    const text = `${JSON.stringify(fixture, null, 1)}\n`
    if (process.env.W9T14_WRITE_FIXTURE === '1') fs.writeFileSync(FIXTURE, text)
    expect(fs.readFileSync(FIXTURE, 'utf8')).toBe(text)
  })

  it('a window off the listing (what the route always sends) refuses by the SAME name on both hosts', () => {
    gate(true)
    const job = jobOf({ listing: false })
    let err
    try { computeRuntimeColumns(DOC, BARS, browserCtx(job), { incremental: false }) } catch (e) { err = e }
    expect(err && err.guard).toBe('runtime:strategy-unsettled')
    const served = runJob(serverRt, DOC, job)
    expect(served.status).toBe('withheld')
    expect(served.refusals[0].guard).toBe(err.guard)
    expect(served.refusals[0].sentence).toBe(String(err.message))
    expect(sealRunResults(CODEC, IDENTITY, [job], [served]).ok).toBe(true)
  })

  it('DARK: with the gate off, the service refuses pine:strategy-call and serves no record', () => {
    gate(false)
    const served = runJob(serverRt, DOC, jobOf())
    expect(served.status).toBe('withheld')
    expect(served.refusals[0].guard).toBe('pine:strategy-call')
    expect(Object.hasOwn(served, 'strategy')).toBe(false)
  })

  it('r1 DARK: the sealed gate-off reply over the route ctx (no listing, the window) is the committed fixture', () => {
    gate(false)
    const job = jobOf({ listing: false, window: 5000 })
    const { ms, ...served } = runJob(serverRt, DOC, job)
    const sealed = sealRunResults(CODEC, IDENTITY, [job], [served])
    expect(sealed.ok).toBe(true)
    expect(sealed.results[0].refusals[0].guard).toBe('pine:strategy-call')
    const text = `${JSON.stringify({ identity: IDENTITY, result: sealed.results[0] }, null, 1)}\n`
    if (process.env.W9T14_WRITE_FIXTURE === '1') fs.writeFileSync(DARK_FIXTURE, text)
    expect(fs.readFileSync(DARK_FIXTURE, 'utf8')).toBe(text)
  })
})
