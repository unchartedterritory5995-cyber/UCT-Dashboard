// app/src/components/chart/engine/runtime/__tests__/strategyServeAudit.measure.test.js
//
// ─── THE SERVE-READINESS AUDIT: GATE ON, WHAT EACH STRATEGY SHOWS A MEMBER ──────────────────
//
// A MEASUREMENT, run only when its env is set (never in the ordinary suite): the 70 sampled strategies of
// the coverage map live in the local sample cache (the built-in and reference sources are never committed,
// the repo being public), so this runs on the dev PC under the heavy lock. The committed corpus has its own
// standing rail, `strategyServeCensus.test.js`.
//
// Each strategy goes through `strategyServe.js::strategyServeOutcome` (served, or refused by name, or a
// THIRD state the rails forbid) twice, with the three Pine flags stubbed on (objects-only, runtime pane,
// strategy broker) inside this test:
//
//   granted     the runtime lane's admission granted to every script (`__allowEveryRuntimeScriptForTests`):
//               the armed census's condition (`strategyArmed.js`), so its served set can be compared;
//   production  the admission a production tab latches: the server's own kill-list read payload and its own
//               per-source capability verdict (`api/services/runtime_definitions.py`, PINE_RUNTIME_CAPABILITY_ADMISSION
//               on), prepared per source into the input file beside each path.
//
// Env: STRATEGY_SERVE_INPUT (json {lists, rows: [{key, path, admission:{admitted, historyOnly}, armed}]}),
//      STRATEGY_SERVE_OUT (jsonl, rewritten),
//      STRATEGY_SERVE_BARS=product (optional, 2026-11-17): the reference bars in the shape a member's DAILY chart hands
//      the binder (`ourSide.js::toProductBars`: `/api/bars`'s ISO date keys), not the capture's epoch seconds. Unset,
//      the run is the one #1664 measured (`barsOfCapture`, epoch seconds), unchanged.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { __permitRuntimePaneForTests } from '../../runtimePaneGate'
import {
  __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList, __resetRuntimeAdmission, latchRuntimeLists,
  latchRuntimeAdmission, runtimeSourceHash,
} from '../../runtimeKill'
import { loadCapture } from '../../__tests__/vendorHarness/harness.js'
import { barsOfCapture } from '../../__tests__/vendorHarness/strategyHarness.js'
import { toProductBars } from '../../__tests__/vendorHarness/ourSide.js'
import { historyWindowBarsOf } from './strategyArmed.js'
import { strategyServeOutcome } from './strategyServe.js'
import StrategyReportPanel from '../../../pane/StrategyReportPanel'

const INPUT = process.env.STRATEGY_SERVE_INPUT
const OUT = process.env.STRATEGY_SERVE_OUT
const RUN = !!(INPUT && OUT)
const PRODUCT_BARS = process.env.STRATEGY_SERVE_BARS === 'product'
const WINDOW = historyWindowBarsOf(path.resolve(process.cwd(), '..'))
const REFERENCE = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness/k-clustering-rddt-1d-2026-09-28.json')
const SYMBOL = Object.freeze({ ticker: 'RDDT', exchange: 'NYSE' })
const GATE = (rel) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
const flagOf = (src) => (src.match(/(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe.skipIf(!RUN)('strategy serve audit, broker gate on (measurement only)', () => {
  it('answers every sampled strategy in both admission states', () => {
    fs.writeFileSync(`${OUT}.started`, new Date().toISOString())
    const flags = ['objectsOnlyPaneGate.js', 'runtimePaneGate.js', 'strategyBrokerGate.js']
      .map((f) => flagOf(GATE(`src/components/chart/engine/${f}`)))
    for (const f of flags) expect(f).toMatch(/^VITE_/)
    const reference = loadCapture(REFERENCE).capture
    const bars = PRODUCT_BARS ? toProductBars(reference) : barsOfCapture(reference)
    const ctx = { tf: 'D', symbol: SYMBOL, newestBarIsForming: false, historyFromListing: true, historyWindowBars: WINDOW }
    const input = JSON.parse(fs.readFileSync(INPUT, 'utf8'))
    // ⛔ no request leaves this test: a consult that would re-read the lists or re-ask a verdict gets nothing
    vi.stubGlobal('fetch', () => Promise.reject(new Error('no network in the audit')))
    const rows = []
    for (const it of input.rows) {
      const source = fs.readFileSync(it.path, 'utf8')
      const row = { key: it.key, population: it.population, version: it.version, armed: it.armed, armedWall: it.armedWall,
        admission: it.admission }
      for (const mode of ['granted', 'production']) {
        for (const f of flags) vi.stubEnv(f, '1')
        __permitRuntimePaneForTests()
        if (mode === 'granted') {
          __allowEveryRuntimeScriptForTests()
        } else {
          __resetRuntimeAllowList()
          __resetRuntimeAdmission()
          latchRuntimeLists(input.lists)
          if (input.lists.capability_admission === true) {
            latchRuntimeAdmission(runtimeSourceHash(source),
              { admitted: it.admission.admitted === true, historyOnly: it.admission.historyOnly })
          }
        }
        const t0 = Date.now()
        row[mode] = strategyServeOutcome({ source, bars, ctx, Panel: StrategyReportPanel })
        row[mode].ms = Date.now() - t0
        vi.unstubAllEnvs()
      }
      __allowEveryRuntimeScriptForTests()
      rows.push(row)
    }
    fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
    console.log(`strategy serve audit (${PRODUCT_BARS ? 'product daily bars, ISO keys' : 'epoch-second bars'}): ${rows.length} rows -> ${OUT}`)
    expect(rows.length).toBe(input.rows.length)
  }, 3600 * 1000)
})
