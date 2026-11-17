#!/usr/bin/env node
// tools/headless_work.mjs
//
// ─── THE HEADLESS EXPORT UNDER A BARE `node` (Studio R6: the server computes a definition's work) ──
//
// Reads ONE JSON request on STDIN and writes ONE JSON answer on STDOUT. It runs the shipped
// `app/src/components/chart/engine/headlessCompute.js::computeHeadless` (through
// `headless_work_hooks.mjs`: JSON imports, extensionless relative imports), so the web pod's Python can
// compute a definition's work itself, never trusting a client's number.
//
//   request   { "definition": {...},                       a saved definition (`compute.kind` ast/runtime)
//               "reference": true }                        over `referenceSeries.js`'s reference series and
//                                                          `referenceOptions()` (what a load budget reads)
//          or { "definition": {...}, "bars": [...], "opts": {tf, symbol, historyFromListing,
//               newestBarIsForming, inputs, otherBars: {<storeKey>: [...]}} }
//             optional "values": false   leave each output's `values` out (a budget needs lane and work)
//   answer    { "ok": true, "result": <computeHeadless's answer>, "ceiling": {name, module, value},
//               "reference"?: {bars, sha256} }
//             { "ok": false, "error": "...", "lane"?: "..." }   (a lane with no work counter, a bad request)
//   exit      0 answered (a refusal by name is an answer: `result.refusal`), 2 a bad request,
//             3 the definition is on a lane with no work counter
//
// `NaN` in a series is written as JSON `null`. The ceiling is the work's denominator for the lane that
// computed it, read from its declaring module (never retyped here): `runtime/limits.js::
// DEFAULT_LIMITS.TOTAL_INSTRUCTIONS`, `ast/interpret.js::MAX_EVALUATION_UNITS`.
import { register } from 'node:module'

register('./headless_work_hooks.mjs', import.meta.url)

// literal specifiers, imported after the hooks are registered (a static import would be resolved before
// them), and literal so `tools/pine_runtime_closure.mjs::walk` follows them (`tests/test_headless_work_driver.py`)
const { computeHeadless } = await import('../app/src/components/chart/engine/headlessCompute.js')
const { COMPUTE_LANE } = await import('../app/src/components/chart/engine/computeLane.js')
const { referenceBars, referenceOptions, REFERENCE_BARS_SHA256 } = await import('../app/src/components/chart/engine/referenceSeries.js')
const { DEFAULT_LIMITS } = await import('../app/src/components/chart/engine/runtime/limits.js')
const { MAX_EVALUATION_UNITS } = await import('../app/src/components/chart/engine/ast/interpret.js')

const CEILINGS = {
  [COMPUTE_LANE.RUNTIME]: { name: 'DEFAULT_LIMITS.TOTAL_INSTRUCTIONS', module: 'app/src/components/chart/engine/runtime/limits.js', value: DEFAULT_LIMITS.TOTAL_INSTRUCTIONS },
  [COMPUTE_LANE.AST]: { name: 'MAX_EVALUATION_UNITS', module: 'app/src/components/chart/engine/ast/interpret.js', value: MAX_EVALUATION_UNITS },
}

const answer = (doc, code) => {
  process.stdout.write(JSON.stringify(doc))
  process.exitCode = code
}

let raw = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) raw += chunk

let req
try {
  req = JSON.parse(raw)
} catch (err) {
  answer({ ok: false, error: `the request is not JSON: ${err.message}` }, 2)
}
if (req !== undefined) {
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (!isObj(req) || !isObj(req.definition)) {
    answer({ ok: false, error: 'the request carries no `definition` object' }, 2)
  } else if (req.reference !== true && !Array.isArray(req.bars)) {
    answer({ ok: false, error: 'give `"reference": true`, or `bars` (an array of {t, o, h, l, c, v})' }, 2)
  } else {
    let bars
    let opts
    if (req.reference === true) {
      bars = referenceBars()
      opts = referenceOptions()
    } else {
      bars = req.bars
      opts = isObj(req.opts) ? { ...req.opts } : {}
    }
    try {
      const result = computeHeadless(req.definition, bars, opts)
      if (req.values === false && Array.isArray(result.outputs)) {
        result.outputs = result.outputs.map(({ values, ...rest }) => rest)
      }
      answer({
        ok: true, result, ceiling: CEILINGS[result.lane] || null,
        ...(req.reference === true ? { reference: { bars: bars.length, sha256: REFERENCE_BARS_SHA256 } } : {}),
      }, 0)
    } catch (err) {
      answer({ ok: false, error: String((err && err.message) || err), ...(err && err.lane ? { lane: err.lane } : {}) },
        err && err.lane ? 3 : 2)
    }
  }
}
