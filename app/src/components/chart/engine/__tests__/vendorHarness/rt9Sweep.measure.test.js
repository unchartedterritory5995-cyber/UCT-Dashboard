// RT9 (step 89) — OPT-IN sweep (RT9_SWEEP_OUT=<json>): every capture under
// tests/fixtures/vendor graded in two door states (objects pane on; + runtime
// pane), with the verdict, the object verdict, each plot's verdict and the paint
// verdict per file, so a change reads as "MATCH -> anything else" at every level.
// Optional PINE_LIBRARY_STORE loads the libraries for the whole run; optional
// RT9_SWEEP_ONLY=<substring> narrows the files. Nothing here grades or adjusts a capture.
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

it.skipIf(!process.env.RT9_SWEEP_OUT)('RT9 sweep: every capture, two door states, every level', () => {
  const store = process.env.PINE_LIBRARY_STORE || ''
  const only = process.env.RT9_SWEEP_ONLY || ''
  const rows = {}
  for (const f of walk(VENDOR_DIR)) {
    if (only && !f.includes(only)) continue
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
        plots: (v.plots || []).map((p) => [p.title, p.verdict]),
        paints: v.paints ? (v.paints.verdict || null) : null,
      }
    }
  }
  fs.writeFileSync(process.env.RT9_SWEEP_OUT, JSON.stringify(rows, null, 1))
}, 14400000)
