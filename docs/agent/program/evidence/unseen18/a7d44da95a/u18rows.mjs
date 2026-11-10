// scratch: node u18rows.mjs <attempt dir> ids... : per row the sentence, pass, receipt, card, what the Agent last said (trimmed), failed check names
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const [dir, ...ids] = process.argv.slice(2)
const res = JSON.parse(readFileSync(join(dir, 'results.BROWSER-MOCK-MODEL.json'), 'utf8'))
const rows = Array.isArray(res) ? res : (res.rows || res.results || Object.values(res))
for (const id of ids) {
  const r = rows.find(x => (x.id || x.request?.id) === id) || {}
  const fp = join(dir, 'failures', id, 'failure.json')
  const f = existsSync(fp) ? JSON.parse(readFileSync(fp, 'utf8')) : null
  const t = f?.turns?.at(-1) || {}
  console.log(`${id} ${r.pass ? 'PASS' : 'FAIL'} expected=${(r.expectedActions || []).join(',')} say="${(r.say || []).join(' | ')}"`)
  if (f) {
    console.log(`   receipt=${!!t.newReceipt} text=${JSON.stringify(t.receiptText || null)?.slice(0, 160)} card=${!!t.card} undoable=${t.undoable}`)
    console.log(`   last: ${JSON.stringify(String(t.last || '').replace(/\s+/g, ' ').slice(-260))}`)
    for (const c of r.failed || []) console.log(`   x ${c.name}: ${String(c.detail || '').slice(0, 160)}`)
  }
}
