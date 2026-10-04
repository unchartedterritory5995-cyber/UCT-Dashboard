// app/src/components/chart/engine/__tests__/vendorHarness/cap4Captures.measure.test.js
//
// CAP4 (2026-10-04, step 91) - OPT-IN measurement (CAP4_MEASURE=1): grade every CAP4
// capture listed in `cap4-verdicts.json` in the door state its row names and REWRITE the
// row's `signature` from the harness's own verdict (`cap3Signature`, the same reducer
// CAP3's rails read). Read the diff and commit it with the captures;
// `vendorHarness.cap4Captures.test.js` then pins each signature. Never edit by hand.
// With CAP4_MEASURE_PRINT=1 it also prints each grade's plot / object summary.
import { it, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'

import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { cap3Signature } from './cap3Signature'
import { loadPineLibraryStore } from '../../ast/__tests__/pineLibraryStoreLoader.js'
import { clearPineLibraries } from '../../ast/pineLibraryStore'

const FILE = path.join(__dirname, 'cap4-verdicts.json')

it.skipIf(!process.env.CAP4_MEASURE)('CAP4 captures: rewrite the pinned signatures from the harness', () => {
  const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  const store = process.env.PINE_LIBRARY_STORE || ''
  const only = process.env.CAP4_ONLY || ''
  for (const row of doc.captures) {
    if (only && !row.id.includes(only)) continue
    if (row.library && !store) continue
    if (row.library) loadPineLibraryStore(store)
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    if (row.state === 'runtime') vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const cap = loadCapture(path.join(HARNESS_DIR, `${row.id}.json`)).capture
    const v = gradeCapture(cap).verdict
    row.signature = cap3Signature(v)
    if (process.env.CAP4_MEASURE_PRINT) {
      console.log(JSON.stringify({ id: row.id, state: row.state, verdict: v.verdict, reason: v.reason, plots: (v.plots || []).map((p) => [p.title, p.verdict, p.reason || null, p.stats && p.stats.steady && p.stats.steady.first]), objects: v.objects && { verdict: v.objects.verdict, reason: v.objects.reason, counts: v.objects.counts, texts: v.objects.texts } }, null, 1))
    }
    vi.unstubAllEnvs()
    clearPineLibraries()
  }
  fs.writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`)
}, 3600000)
