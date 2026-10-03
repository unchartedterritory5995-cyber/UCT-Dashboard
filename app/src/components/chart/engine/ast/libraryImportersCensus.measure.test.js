// app/src/components/chart/engine/ast/libraryImportersCensus.measure.test.js
//
// ─── ⭐ L1 — THE CORPUS SCRIPTS THAT IMPORT A LIBRARY, AND WHAT THEY HIT NEXT ───
//
// For every committed script with an `import Author/Library/Version` line: is each
// imported library in the registry, and what is the FIRST wall in each lane once
// the import is linked (or still the import, when it is not).
//
//   PINE_LIBRARY_STORE=<scratch store dir> npx vitest run \
//     src/components/chart/engine/ast/libraryImportersCensus.measure.test.js
//
// ⛔ IT ASSERTS NO COUNT (a pinned count goes red on the progress it measures). It
// asserts only that the importers were found and every one was accounted for.
// Unset `PINE_LIBRARY_STORE` measures the registry as production starts it: empty.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { runtimeClockOpts } from './pineRuntimeClock.js'
import { importPathsOf, pineLibraryEntry } from './pineLibraryStore.js'
import { loadPineLibraryStoreFromEnv } from './__tests__/pineLibraryStoreLoader.js'

const LOADED = loadPineLibraryStoreFromEnv()
const DIR = path.resolve(process.cwd(), '..', 'corpus/committed')
const SCRIPTS = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort() : []

const first = (r) => (r ? `${r.guard}${/library|registry|module/.test(r.message || '') ? `: ${String(r.message).split(' — ').slice(-1)[0].slice(0, 90)}` : ''}` : null)

describe('⭐ L1 — library importers in the committed corpus', () => {
  it('accounts for every importing script, in both lanes', () => {
    const rows = []
    for (const f of SCRIPTS) {
      const src = fs.readFileSync(path.join(DIR, f), 'utf8')
      const paths = importPathsOf(src)
      if (!paths.length) continue
      let host
      try {
        const t = translatePine(src, { mode: 'host' })
        host = t.ok ? `ok (${(t.outputs || []).length} outputs)` : (first(t.refusal) || 'refused')
      } catch (e) { host = `threw: ${String(e && e.message).slice(0, 60)}` }
      let rt
      try {
        const b = buildRuntimeIr(src, { tf: 'D', ...runtimeClockOpts(false), objectTrees: [] })
        rt = b.ok ? 'ok' : first(b.refusal)
      } catch (e) { rt = `threw: ${String(e && e.message).slice(0, 60)}` }
      rows.push({ f, libs: paths.map((p) => `${p}${pineLibraryEntry(p) ? '' : ' (MISSING)'}`), host, rt })
    }
    expect(SCRIPTS.length).toBeGreaterThan(200)
    expect(rows.length).toBeGreaterThan(0)
    const pastWall = (s) => !/^pine:module|^runtime:library/.test(String(s))
    // eslint-disable-next-line no-console
    console.log([
      '',
      `LIBRARY IMPORTERS — ${rows.length} scripts, ${LOADED.length} libraries in the registry`,
      `past the import wall: host ${rows.filter((r) => pastWall(r.host)).length}/${rows.length}, `
        + `runtime ${rows.filter((r) => pastWall(r.rt)).length}/${rows.length}`,
      ...rows.map((r) => `${r.f.slice(0, 48).padEnd(48)} | host ${String(r.host).padEnd(40)} | rt ${r.rt}\n    ${r.libs.join(' ')}`),
      '',
    ].join('\n'))
  }, 300000)
})
