// F4 (step 85) — OPT-IN sweep (F4_SWEEP_OUT=<json>): every capture under
// tests/fixtures/vendor graded in two door states (objects pane on; + runtime
// pane), the verdict and the object verdict per file, so a change can be read
// as "MATCH -> anything else" counts. Optional PINE_LIBRARY_STORE loads the
// libraries for the whole run. Nothing here grades or adjusts a capture.
//
// U15 — two opt-in narrowings, for a re-grade of named captures (the host-only
// re-grade behind tools/pine_library/promotion_allowlist.json is the `on` state:
// objects pane on, VITE_PINE_RUNTIME_PANE_ENABLED unset):
//   F4_SWEEP_ONLY=<regex>   only the capture files whose path matches
//   F4_SWEEP_DIRS=<a;b>     more capture folders (the out-of-git capture store),
//                           read where they are and never copied into the repository
// Each row also carries the door's refusal sentence when our side did not run.
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
  const only = process.env.F4_SWEEP_ONLY ? new RegExp(process.env.F4_SWEEP_ONLY) : null
  const dirs = [VENDOR_DIR, ...String(process.env.F4_SWEEP_DIRS || '').split(';').filter(Boolean)]
  for (const f of dirs.flatMap((d) => walk(d))) {
    if (only && !only.test(f.split(path.sep).join('/'))) continue
    const loaded = loadCapture(f)
    if (!loaded.capture) continue
    for (const state of ['on', 'runtime']) {
      if (store) loadPineLibraryStore(store)
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', state === 'runtime' ? '1' : '')
      let v
      let ours = null
      try { ({ verdict: v, ours } = gradeCapture(loaded.capture)) } catch (err) { v = { verdict: 'THREW', reason: String(err && err.message) } }
      vi.unstubAllEnvs()
      clearPineLibraries()
      const o = v.objects || null
      rows[`${loaded.file}|${state}`] = {
        id: loaded.capture.id || null,
        verdict: v.verdict,
        refusal: ours && ours.ok === false ? String(ours.refusal && (ours.refusal.sentence || ours.refusal.message || JSON.stringify(ours.refusal))).slice(0, 300) : null,
        objects: o ? o.verdict : null,
        counts: o && o.counts ? o.counts.filter((c) => c.agree === false).map((c) => [c.family, c.vendor, c.ours]) : null,
      }
    }
  }
  fs.writeFileSync(process.env.F4_SWEEP_OUT, JSON.stringify(rows, null, 1))
}, 7200000)
