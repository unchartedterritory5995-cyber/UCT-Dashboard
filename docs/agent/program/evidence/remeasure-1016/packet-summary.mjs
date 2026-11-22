// One line per #1016 packet file from its vitest json: files passed/failed, tests passed/failed/todo/skipped, it.fails not separated.
//   node packet-summary.mjs <attempt dir>/packet
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const d = process.argv[2]
for (const f of readdirSync(d).filter(x => x.endsWith('.json')).sort()) {
  const V = JSON.parse(readFileSync(join(d, f), 'utf8'))
  const st = V.testResults.flatMap(r => r.assertionResults.map(a => a.status))
  const c = (s) => st.filter(x => x === s).length
  console.log(`| ${f.replace(/\.json$/, '')} | files ${V.testResults.filter(r => r.status === "passed").length} passed, ${V.testResults.filter(r => r.status !== "passed").length} not passed (${V.testResults.length}) | tests ${c('passed')} passed, ${c('failed')} failed, ${c('todo')} todo, ${c('skipped') + c('pending')} skipped (${st.length}) | success=${V.success} |`)
}
