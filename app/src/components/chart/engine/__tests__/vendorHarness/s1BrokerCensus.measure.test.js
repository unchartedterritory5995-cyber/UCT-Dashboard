// app/src/components/chart/engine/__tests__/vendorHarness/s1BrokerCensus.measure.test.js
//
// ─── ⭐⭐ S1 — THE STRATEGY BROKER, MEASURED: captures graded, strategies censused ─
//
// OPT-IN (`S1_MEASURE=1`; `S1_MEASURE_OUT=<file.json>` writes the rows). Two halves:
//
//  (A) every committed harness capture whose source declares `strategy(` is graded in
//      the three door states (`off` / `on` / `runtime`) with the broker flag OFF and
//      ON (`VITE_PINE_STRATEGY_BROKER_ENABLED`). The rule is "0 MATCH lost": every
//      capture's verdict signature must be identical between the two flag states.
//  (B) every committed corpus `strategy()` script, flag OFF and ON: the member door in
//      the runtime state (attach / first refusal), the runtime build's guard, and - for a
//      broker build - a run over the R1 RDDT capture's bars (636 bars from the listing):
//      does it complete, or which unsettled rule stops it.
//
// ⛔ IT ASSERTS ONLY (A)'s identity and that every script was accounted for; the counts
// are what the triage doc's S1 section records.
//   cd app && S1_MEASURE=1 S1_MEASURE_OUT=<file> node node_modules/vitest/vitest.mjs run \
//     src/components/chart/engine/__tests__/vendorHarness/s1BrokerCensus.measure.test.js --maxWorkers=1
import { it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { gradeCapture, loadCapture, HARNESS_DIR, enterDoorState, REPO } from './harness'
import { cap3Signature } from './cap3Signature'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../../runtime/lowerIr.js'
import { execute } from '../../runtime/vm.js'

const RUN = process.env.S1_MEASURE === '1'
const OUT = process.env.S1_MEASURE_OUT
const FLAG = 'VITE_PINE_STRATEGY_BROKER_ENABLED'
const isStrategy = (src) => /^\s*strategy\s*\(/m.test(String(src || ''))

afterEach(() => { vi.unstubAllEnvs() })

it.skipIf(!RUN)('S1 (A): strategy captures graded with the broker flag off and on - 0 MATCH lost', () => {
  const files = fs.readdirSync(HARNESS_DIR).filter((f) => f.endsWith('.json')).sort()
  const rows = []
  for (const f of files) {
    const cap = loadCapture(path.join(HARNESS_DIR, f)).capture
    if (!cap || !isStrategy(cap.source && cap.source.text)) continue
    for (const state of ['off', 'on', 'runtime']) {
      const sig = {}
      for (const flag of ['', '1']) {
        enterDoorState(state)
        vi.stubEnv(FLAG, flag)
        const v = gradeCapture(cap).verdict
        sig[flag || 'off'] = { verdict: v.verdict, signature: cap3Signature(v) }
        vi.unstubAllEnvs()
      }
      rows.push({ capture: f.replace(/\.json$/, ''), state, off: sig.off.verdict, on: sig['1'].verdict,
        same: JSON.stringify(sig.off.signature) === JSON.stringify(sig['1'].signature) })
    }
  }
  const tally = (k) => rows.reduce((acc, r) => { acc[r[k]] = (acc[r[k]] || 0) + 1; return acc }, {})
  console.log(JSON.stringify({ captures: rows.length / 3, flagOff: tally('off'), flagOn: tally('on'),
    changed: rows.filter((r) => !r.same) }, null, 1))
  if (OUT) fs.writeFileSync(`${OUT}.captures.json`, JSON.stringify(rows, null, 1))
  expect(rows.length).toBeGreaterThan(0)
  expect(rows.filter((r) => !r.same)).toEqual([])
})

it.skipIf(!RUN)('S1 (B): the corpus strategies, flag off and on', () => {
  const corpus = path.join(REPO, 'corpus', 'committed')
  const r1 = loadCapture(path.join(HARNESS_DIR, 'r1-strategy-draws-rddt-1d-2026-10-02.json')).capture
  const fields = r1.bars.fields
  const bars = r1.bars.rows.map((row) => {
    const o = Object.fromEntries(fields.map((k, i) => [k, row[i]]))
    return { t: o.time, o: o.open, h: o.high, l: o.low, c: o.close, v: o.volume }
  })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const symbol = { ticker: 'RDDT', exchange: 'NYSE' }
  const rows = []
  for (const f of fs.readdirSync(corpus).filter((x) => x.endsWith('.pine')).sort()) {
    const src = fs.readFileSync(path.join(corpus, f), 'utf8')
    if (!isStrategy(src)) continue
    const row = { script: f.replace(/\.pine$/, '') }
    for (const flag of ['', '1']) {
      const k = flag ? 'on' : 'off'
      enterDoorState('runtime')
      vi.stubEnv(FLAG, flag)
      const door = enterMemberDoor(src)
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      row[`door_${k}`] = door.def ? 'attach' : `${door.stage}: ${String(door.refusal).slice(0, 160)}`
      const b = buildRuntimeIr(src, { bars, inputs: {}, symbol, strategyBroker: flag === '1' })
      row[`build_${k}`] = b.ok ? (b.ir.broker ? 'ok (broker)' : 'ok') : `${b.refusal.guard}: ${String(b.refusal.message).slice(0, 160)}`
      if (b.ok && b.ir.broker) {
        try {
          const program = lowerIrProgram(b.ir, { historyFromListing: true })
          const res = execute(program, { bars: bars.length, series, columns: program.columns, confirmed: true,
            barTimes: bars.map((x) => x.t) })
          row.run_on = `completed: ${res.broker.closed.length} closed / ${res.broker.open.length} open trades`
        } catch (e) {
          row.run_on = `${e.guard || e.name}: ${String(e.message).slice(0, 200)}`
        }
      }
      vi.unstubAllEnvs()
    }
    rows.push(row)
  }
  console.log(JSON.stringify(rows, null, 1))
  if (OUT) fs.writeFileSync(`${OUT}.corpus.json`, JSON.stringify(rows, null, 1))
  expect(rows.length).toBeGreaterThan(0)
})
