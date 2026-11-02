// SCRATCH (W3 measurement, not committed): why each object op of the drawing-walled
// census scripts is dropped. Env W3_INPUT (json [{key,path}]), W3_OUT (json).
import { it } from 'vitest'
import fs from 'node:fs'
import process from 'node:process'
import { translatePine } from './pine'

const INPUT = process.env.W3_INPUT
const OUT = process.env.W3_OUT
it.runIf(!!(INPUT && OUT))('w3 why', () => {
  const rows = JSON.parse(fs.readFileSync(INPUT, 'utf8'))
  const out = []
  for (const r of rows) {
    const src = fs.readFileSync(r.path, 'utf8')
    let res
    try {
      res = translatePine(src, {})
    } catch (e) {
      out.push({ key: r.key, threw: String(e && e.message).slice(0, 200) })
      continue
    }
    const d = (res && res.objectDiagnostics) || {}
    out.push({
      key: r.key,
      dropped: d.droppedOps, attempted: d.attemptedOps, reasons: d.dropReasons,
      cellTextWhy: d.cellTextWhy, createDropWhy: d.createDropWhy, guardRefusalWhy: d.guardRefusalWhy,
      guardRefusals: d.guardRefusals,
    })
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
}, 1200000)
