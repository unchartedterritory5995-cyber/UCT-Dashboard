// app/src/components/chart/engine/ast/w3ObjectWhy.measure.test.js
//
// --- W3 MEASUREMENT HARNESS: WHY EACH OBJECT OP OF A DRAWING-WALLED SCRIPT IS DROPPED ---
//
// Env-gated like every *.measure.test.js: it is skipped unless BOTH are set, so the
// ordinary chart vitest run never executes it.
//   W3_INPUT  json [{key, path}] built by tools/pine_coverage/w3_why_input.py (licence-held
//             sources are read in place from the sample cache, never committed)
//   W3_OUT    json written here: per script the object diagnostics (dropped/attempted ops,
//             drop reasons, cellTextWhy, createDropWhy, guardRefusalWhy); identifiers only.
// It produced docs/pine/census/w3-object-why-2026-11-02.json. From app/, with both env set:
//   node node_modules/vitest/vitest.mjs run src/components/chart/engine/ast/w3ObjectWhy.measure.test.js --maxWorkers=2
import { it } from 'vitest'
import fs from 'node:fs'
import process from 'node:process'
import { translatePine } from './pine'
import { memberInputTranslation } from '../../builder/builderInputs'

const INPUT = process.env.W3_INPUT
const OUT = process.env.W3_OUT
it.runIf(!!(INPUT && OUT))('w3 why', () => {
  const rows = JSON.parse(fs.readFileSync(INPUT, 'utf8'))
  const out = []
  for (const r of rows) {
    const src = fs.readFileSync(r.path, 'utf8')
    let res
    try {
      // W3W4-T0: the MEMBER DOOR's lane (memberPaneDefinition's options), not the screener's `{}`
      res = memberInputTranslation(translatePine, src, { paramManifest: true, strict: true, colourInputs: true, guardInputs: true })
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
