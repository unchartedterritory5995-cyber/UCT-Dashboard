// Writes docs/agent/CHARTS_TEACH_STATUS.md from a browser run (teach.mjs) and the routing probe (agentGuideInventory).
//   node src/testing/agent/guide/status.mjs <teach-results.json>... <teach-probe.json> > ../docs/agent/CHARTS_TEACH_STATUS.md
// Several result files merge in order: a later run's row replaces an earlier one's (a full run, then a re-run of some rows).
// Only a browser pass is VERIFIED. Everything else says what it rests on.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const files = process.argv.slice(2)
const probeFile = files.pop()
const runs = files.map(f => JSON.parse(readFileSync(f, 'utf8')))
const merged = new Map()
for (const r of runs) for (const x of r.results) merged.set(x.id, x)
const run = { at: runs.map(r => r.at).sort().pop(), results: [...merged.values()] }
const probe = JSON.parse(readFileSync(probeFile, 'utf8'))
const expected = JSON.parse(readFileSync(path.join(HERE, 'expected.json'), 'utf8'))
// rows whose control the shipped product does not have (notInProduct.json, reviewed by hand): never counted as missing
let notInProduct = {}
try { notInProduct = JSON.parse(readFileSync(path.join(HERE, 'notInProduct.json'), 'utf8')).rows || {} } catch { notInProduct = {} }
const byId = new Map(run.results.map(r => [r.id, r]))
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()

const rows = probe.report.map(r => {
  const exp = expected[r.id]
  const res = byId.get(r.id)
  let status, evidence
  if (notInProduct[r.id] && !res?.pass) { status = 'NOT IN PRODUCT'; evidence = notInProduct[r.id] }
  else if (res?.pass) { status = 'VERIFIED'; evidence = `Browser ${run.at.slice(0, 10)}: "${res.say}" → ring on the last step's control` }
  else if (res) { const last = (res.steps || []).at(-1); status = 'ROUTED / BROWSER FAILED'; evidence = `"${res.say}" reaches it; browser: ${res.why || res.error || (last ? `step ${last.i + 1} was not completed by the runner's input (card: ${last.text})` : 'failed')}` }
  else if (exp) { status = 'ASSIGNED / NOT REACHED'; evidence = `Assigned ${exp.feature}${exp.title ? ` (${exp.title})` : ''}; the inventory's own words do not reach it` }
  else if (r.a || r.b) { status = 'NO ASSIGNED WALKTHROUGH'; evidence = `The words reach ${(r.a || r.b).feature}${(r.a || r.b).ask ? ' (asks which)' : ''}; nobody has judged it right` }
  else { status = 'NO WALKTHROUGH'; evidence = 'The inventory words reach none.' }
  return { ...r, status, evidence, feature: exp ? `${exp.feature}${exp.title ? `: ${exp.title}` : ''}` : '', prior: r.teach || '' }
})
const ORDER = ['VERIFIED', 'ROUTED / BROWSER FAILED', 'ASSIGNED / NOT REACHED', 'NO ASSIGNED WALKTHROUGH', 'NO WALKTHROUGH', 'NOT IN PRODUCT']
const count = (part) => ORDER.map(s => rows.filter(r => (!part || r.id.startsWith(part)) && r.status === s).length)

const out = []
out.push('# Charts visual teaching status', '', '> **BROWSER-MOCK-MODEL.** Every count below is from the local agent harness with a scripted model. It is not production evidence and not gate evidence.', '')
out.push(`Generated ${run.at.slice(0, 10)} by \`app/src/testing/agent/guide/status.mjs\` from a committed browser run (\`teach.mjs\`, README in that folder). LOCAL native Windows Node, headless Chrome on the agent harness (real ChartsWorkspace and Agent panel, synthetic bars, fixture lists and layouts, one price-alert fixture), BROWSER-MOCK-MODEL / SIMULATED. Not production evidence.`, '')
out.push('**Method.** Each inventory row (`CHARTS_COVERAGE_MATRIX.md`) is asked in its own words: "how do I " + its Human action, or "show me how to " + its Example phrase. A row becomes a browser case only when those words reach the walkthrough a person assigned to it (`expected.json`: the 2026-11-05 matrix\'s Guide feature column, plus catalog controls reviewed by hand 2026-11-07). The runner types the words into the real composer and follows the card with real mouse input. VERIFIED means the walkthrough reached its last step with the gold ring on that step\'s own control, not on a fallback. A family walkthrough (one feature, many rows) is matched at the feature.', '')
out.push('This replaces the 2026-11-05 count (283 VERIFIED). Its runner was never committed, so it could not be reproduced. That count is kept per row as "11-05" for reference only.', '')
out.push('| Part | ' + ORDER.join(' | ') + ' |', '|---|' + ORDER.map(() => '---').join('|') + '|')
for (const part of ['C1', 'C2', 'C3']) out.push(`| ${part} | ${count(part).join(' | ')} |`)
out.push(`| All | ${count().join(' | ')} |`, '')
out.push('- VERIFIED: proved in the browser, as above.', '- ROUTED / BROWSER FAILED: the words reach the right walkthrough, but the browser run did not end on its control. Routing only; the reason is in the row.', '- ASSIGNED / NOT REACHED: a walkthrough is assigned, but the inventory\'s own words do not reach it. Other words may.', '- NO ASSIGNED WALKTHROUGH: the words reach some walkthrough, or a question, that no person has judged right for this row.', '- NO WALKTHROUGH: nothing.', '- NOT IN PRODUCT: the shipped product has no such control (notInProduct.json, with the reason in the row): not a missing walkthrough.', '')
out.push('| ID | Area | Action | Teach status | Assigned walkthrough | Evidence | 11-05 |', '|---|---|---|---|---|---|---|')
for (const r of rows) out.push(`| ${r.id} | ${cell(r.area)} | ${cell(r.action)} | ${r.status} | ${cell(r.feature)} | ${cell(r.evidence)} | ${cell(r.prior)} |`)
// ⭐ held-out KNOWN MISSES (knownMisses.json): asserted both ways in their held-out file, so they pass as tests — named here so
// nobody reads them as passes
try {
  const km = JSON.parse(readFileSync(path.join(HERE, 'knownMisses.json'), 'utf8'))
  if (km.misses?.length) {
    out.push('', '## Held-out KNOWN MISSES (not passes)', '', km.note, '', '| Set | Words | Named | Reaches | Why |', '|---|---|---|---|---|')
    for (const m of km.misses) out.push(`| ${cell(m.set)} | ${cell(m.say)} | ${cell(m.named)} | ${cell(m.reaches)} | ${cell(m.why)} |`)
  }
} catch { /* none */ }
process.stdout.write(out.join('\n') + '\n')
