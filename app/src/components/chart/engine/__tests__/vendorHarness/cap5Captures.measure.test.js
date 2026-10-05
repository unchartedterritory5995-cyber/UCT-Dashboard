// app/src/components/chart/engine/__tests__/vendorHarness/cap5Captures.measure.test.js
//
// CAP5 (capture round 5, prepared 2026-10-04) - OPT-IN measurement (CAP5_MEASURE=1), the
// same shape as cap4Captures.measure.test.js: grade every capture listed in
// `cap5-verdicts.json` in the door state its row names and REWRITE the row's `signature`
// from the harness's own verdict (`cap3Signature`, the reducer CAP3 / CAP4 rails read).
//
// Unlike CAP4's file, rows are keyed by `idPrefix` (the capture date is not known when the
// round is prepared): each row resolves to the NEWEST
// `tests/fixtures/vendor/harness/<idPrefix>-<yyyy-mm-dd>.json` and its `id` is written.
// A row whose capture is not on disk is left as it is (id null, signature null) and named
// in the printed summary - so the ingest lane can run this after every batch of captures.
//
// Read the diff and commit it with the captures; the pins file the ingest lane writes
// (vendorHarness.cap5Captures.test.js, modelled on vendorHarness.cap4Captures.test.js)
// then pins each signature. Never edit a signature by hand.
//   CAP5_ONLY=<substring>      grade only rows whose idPrefix contains it
//   CAP5_MEASURE_PRINT=1       also print each grade's plot / object summary
//   PINE_LIBRARY_STORE=<dir>   needed for rows with `library: true` (skipped without it)
import { it, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'

import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { cap3Signature } from './cap3Signature'
import { loadPineLibraryStore } from '../../ast/__tests__/pineLibraryStoreLoader.js'
import { clearPineLibraries } from '../../ast/pineLibraryStore'

const FILE = path.join(__dirname, 'cap5-verdicts.json')

/** The newest `<prefix>-<yyyy-mm-dd>.json` in the harness dir, as an id, or null. */
export function resolveCapture(prefix, files) {
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^${esc}-(\\d{4}-\\d{2}-\\d{2})\\.json$`)
  const hits = files.filter((f) => re.test(f)).sort()
  return hits.length ? hits[hits.length - 1].replace(/\.json$/, '') : null
}

it.skipIf(!process.env.CAP5_MEASURE)('CAP5 captures: rewrite the pinned signatures from the harness', () => {
  const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  const store = process.env.PINE_LIBRARY_STORE || ''
  const only = process.env.CAP5_ONLY || ''
  const files = fs.readdirSync(HARNESS_DIR)
  const absent = []
  const graded = []
  for (const row of doc.captures) {
    if (only && !row.idPrefix.includes(only)) continue
    const id = resolveCapture(row.idPrefix, files)
    if (!id) { absent.push(`${row.idPrefix} [${row.state}]`); continue }
    if (row.library && !store) { absent.push(`${row.idPrefix} [${row.state}] (library row: set PINE_LIBRARY_STORE)`); continue }
    if (row.library) loadPineLibraryStore(store)
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    if (row.state === 'runtime') vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const cap = loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
    const v = gradeCapture(cap).verdict
    row.id = id
    row.signature = cap3Signature(v)
    graded.push(`${id} [${row.state}] ${v.verdict}`)
    if (process.env.CAP5_MEASURE_PRINT) {
      console.log(JSON.stringify({ id, state: row.state, verdict: v.verdict, reason: v.reason, plots: (v.plots || []).map((p) => [p.title, p.verdict, p.reason || null, p.stats && p.stats.steady && p.stats.steady.first]), objects: v.objects && { verdict: v.objects.verdict, reason: v.objects.reason, counts: v.objects.counts, texts: v.objects.texts } }, null, 1))
    }
    vi.unstubAllEnvs()
    clearPineLibraries()
  }
  console.log(`CAP5 measure: graded ${graded.length}, not on disk ${absent.length}\n  graded:\n    ${graded.join('\n    ')}\n  absent:\n    ${absent.join('\n    ')}`)
  fs.writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`)
}, 3600000)
