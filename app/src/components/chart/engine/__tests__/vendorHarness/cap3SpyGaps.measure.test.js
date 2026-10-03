// app/src/components/chart/engine/__tests__/vendorHarness/cap3SpyGaps.measure.test.js
//
// CAP3 (2026-10-03, step 81) — OPT-IN measurement (CAP3_SPY_MEASURE=1): grade every
// CAP3 SPY 1D capture listed in `cap3-spy-gap-verdicts.json` in the door state its
// script attaches in, and REWRITE that file's `signature` fields from the harness's
// own verdict (`cap3Signature`). Run it after taking new captures, read the diff, and
// commit it with the captures; `vendorHarness.coverageAudit.test.js` then pins each
// signature. Never edit the signatures by hand.
import { it, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'

import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { cap3Signature } from './cap3Signature'
import { loadPineLibraryStore } from '../../ast/__tests__/pineLibraryStoreLoader.js'
import { clearPineLibraries } from '../../ast/pineLibraryStore'

const FILE = path.join(__dirname, 'cap3-spy-gap-verdicts.json')

it.skipIf(!process.env.CAP3_SPY_MEASURE)('CAP3 SPY gap captures: rewrite the pinned signatures from the harness', () => {
  const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  const store = process.env.PINE_LIBRARY_STORE || ''
  for (const row of doc.captures) {
    if (row.library && !store) continue // left as it was: a library row needs the store
    if (row.library) loadPineLibraryStore(store)
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    if (row.state === 'runtime') vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const cap = loadCapture(path.join(HARNESS_DIR, `${row.id}.json`)).capture
    row.signature = cap3Signature(gradeCapture(cap).verdict)
    vi.unstubAllEnvs()
    clearPineLibraries()
  }
  fs.writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`)
}, 3600000)
