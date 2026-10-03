// F4 (step 85) — OPT-IN sweep (F4_SWEEP_OUT=<json>): every capture under
// tests/fixtures/vendor graded in two door states (objects pane on; + runtime
// pane), the verdict and the object verdict per file, so a change can be read
// as "MATCH -> anything else" counts. Optional PINE_LIBRARY_STORE loads the
// libraries for the whole run. Nothing here grades or adjusts a capture.
import { it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { loadCapture, gradeCapture, VENDOR_DIR } from './harness'
import { loadPineLibraryStore } from '../../ast/__tests__/pineLibraryStoreLoader.js'
import { clearPineLibraries } from '../../ast/pineLibraryStore'

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.json')) out.push(p)
  }
  return out.sort()
}

it.skipIf(!process.env.F4_SWEEP_OUT)('F4 sweep: every capture, two door states', () => {
  const store = process.env.PINE_LIBRARY_STORE || ''
  const rows = {}
  for (const f of walk(VENDOR_DIR)) {
    const loaded = loadCapture(f)
    if (!loaded.capture) continue
    for (const state of ['on', 'runtime']) {
      if (store) loadPineLibraryStore(store)
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      if (state === 'runtime') vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
      let v
      try { v = gradeCapture(loaded.capture).verdict } catch (err) { v = { verdict: 'THREW', reason: String(err && err.message) } }
      vi.unstubAllEnvs()
      clearPineLibraries()
      const o = v.objects || null
      rows[`${loaded.file}|${state}`] = {
        verdict: v.verdict,
        objects: o ? o.verdict : null,
        counts: o && o.counts ? o.counts.filter((c) => c.agree === false).map((c) => [c.family, c.vendor, c.ours]) : null,
      }
    }
  }
  fs.writeFileSync(process.env.F4_SWEEP_OUT, JSON.stringify(rows, null, 1))
}, 7200000)
