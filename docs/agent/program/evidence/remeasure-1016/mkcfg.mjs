// rec.mjs config: tree N = this re-measurement (verified install), tree S = the ledger6 master run on the stale 11-06 install (AUDIT VOID).
//   node mkcfg.mjs <evidence dir> <attempt dir> <measured sha>     (writes the old doc + old vitest json to <attempt>/tmp first)
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import { join } from 'node:path'
const [E, OUT, SHA] = process.argv.slice(2)
const wt = join(E, '..', '..', '..', '..', '..')
writeFileSync(join(OUT, 'tmp', 'doc-b2300e547d.md'), execFileSync('git', ['-C', wt, 'show', 'b2300e547d:docs/agent/CHARTS_EXECUTION_STATUS.md']))
writeFileSync(join(OUT, 'tmp', 'old-vitest-agent.json'), gunzipSync(readFileSync(join(E, 'old-stale-b2300e547d', 'vitest-agent.json.gz'))))
const cfg = {
  head: [`# Re-measured coverage ledger, #1016 (LOCAL, src/agent vitest + recount; scripted model, jsdom; ${new Date().toISOString().slice(0, 10)})`],
  legend: ['V/P/I/M/B/U = the doc state; * = re-proved by that tree\'s src/agent run (every citation matched a passed test); V~ = doc VERIFIED, citation unmatched, its named test files all passed; plain V = doc VERIFIED and NOT re-proved',
    'N = this re-measurement on the verified install; S = ledger6 master b2300e547d on the stale 11-06 install (AUDIT VOID), same recount.mjs'],
  tail: [],
  trees: [
    { tag: 'N', label: 'master (verified install)', sha: SHA.slice(0, 10), doc: join(wt, 'docs', 'agent', 'CHARTS_EXECUTION_STATUS.md'), recount: join(OUT, 'recount.json'), vitest: join(OUT, 'src-agent', 'vitest-agent.json') },
    { tag: 'S', label: 'master (stale 11-06 install, VOID)', sha: 'b2300e547d', doc: join(OUT, 'tmp', 'doc-b2300e547d.md'), recount: join(E, 'old-stale-b2300e547d', 'recount.json'), vitest: join(OUT, 'tmp', 'old-vitest-agent.json') },
  ],
}
console.log(JSON.stringify(cfg, null, 1))
