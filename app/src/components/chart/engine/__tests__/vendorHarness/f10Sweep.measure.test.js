// app/src/components/chart/engine/__tests__/vendorHarness/f10Sweep.measure.test.js
//
// F10 (2026-10-04) - OPT-IN whole-harness sweep (F10_SWEEP=<out.jsonl>): every capture
// under `tests/fixtures/vendor` graded in EVERY door state (off / on / runtime), entered
// by `withDoorState` (never inherited), with the library store loaded once when
// `PINE_LIBRARY_STORE` is set (as H11 / RT16 graded). One JSON line per (file, state):
// the verdict and its `cap3Signature`, so two trees' sweeps diff row by row.
//   F10_ONLY=<a,b,...>     grade only files whose path contains one of them
//   F10_STATES=off,on      a subset of the door states
// Nothing is pinned here and no fixture is written; the output file is the record.
import { it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { gradeCapture, loadCapture, VENDOR_DIR, REPO, withDoorState } from './harness'
import { cap3Signature } from './cap3Signature'
import { loadPineLibraryStore } from '../../ast/__tests__/pineLibraryStoreLoader.js'

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.json')) out.push(p)
  }
  return out.sort()
}

it.skipIf(!process.env.F10_SWEEP)('F10 sweep: every capture, every door state', () => {
  const out = process.env.F10_SWEEP
  const only = (process.env.F10_ONLY || '').split(',').filter(Boolean)
  const states = (process.env.F10_STATES || 'off,on,runtime').split(',')
  const libs = loadPineLibraryStore(process.env.PINE_LIBRARY_STORE || '')
  fs.writeFileSync(out, `${JSON.stringify({ libraries: libs.length })}\n`)
  for (const f of walk(VENDOR_DIR)) {
    const rel = path.relative(REPO, f).replace(/\\/g, '/')
    if (only.length && !only.some((o) => rel.includes(o))) continue
    const loaded = loadCapture(f)
    if (!loaded.capture) continue
    for (const state of states) {
      let line
      try {
        line = withDoorState(state, () => {
          const t0 = Date.now()
          const v = gradeCapture(loaded.capture).verdict
          return { file: rel, state, verdict: v.verdict, reason: String(v.reason || '').slice(0, 160), sig: cap3Signature(v), ms: Date.now() - t0 }
        })
      } catch (err) {
        line = { file: rel, state, verdict: 'ERROR', reason: String(err && err.message).slice(0, 200) }
      }
      fs.appendFileSync(out, `${JSON.stringify(line)}\n`)
    }
  }
}, 6 * 3600000)
