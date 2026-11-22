// app/src/components/chart/builder/memberPane/storedBytes.parity.test.js
//
// ⭐ ENGINE 53 — THE DOOR COUNTS THE BYTES THE STORE COUNTS (`storedBytes.js` ⇄
// `api/services/user_definitions.stored_bytes_for_new`), by ONE fixture both suites read:
// `tests/fixtures/run_half_stored_bytes.json` (the pytest twin is
// `tests/test_run_half_source_binding.py`). The fixture holds a run-half document as the script
// door's save SENDS it, and the same document carrying the values whose JSON text differs
// between JavaScript and Python (small floats, escapes, astral characters).
//   Regenerate: RUN_HALF_BYTES_WRITE=1 node node_modules/vitest/vitest.mjs run <this file>
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { memberPaneDefinition } from './memberPaneDefinition'
import { sentDocument, storeBytes, pyJsonBytes } from './storedBytes'
import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../engine/runtimeKill'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..')
const FIXTURE_PATH = path.join(REPO, 'tests/fixtures/run_half_stored_bytes.json')
const LF = String.fromCharCode(10)
const SRC = ['//@version=5', 'indicator("run half", overlay = true)', 'len = input.int(5, "len")',
  'm = ta.sma(close, len)', 'plot(m, "m")', 'plot(m * 2, "m2")', 'if barstate.islast',
  '    line.new(bar_index - 1, low, bar_index, high)', '    for i = 0 to 4',
  '        if close[i] > open[i]', '            label.new(bar_index - i, high[i], "up")'].join(LF)
const EDGE = [1e-5, 0.0001, 0.00012, 1.5e-7, 123.456, -2.5e-9, 1e21, 7, 'tab\tq"\u0001é😀\\']

if (process.env.RUN_HALF_BYTES_WRITE === '1') {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  const d = memberPaneDefinition({ source: SRC, id: 'u_0123456789ab', name: 'rh' })
  if (!d.runHalf) throw new Error(`the fixture document did not mint a run half: ${JSON.stringify(d.runHalfDeclined)}`)
  const sent = sentDocument(d.definition)
  const edge = { ...sent, meta: { ...sent.meta, bytesProbe: EDGE } }
  fs.writeFileSync(FIXTURE_PATH, JSON.stringify({
    _readme: 'ENGINE 53: a run-half document as the script door SENDS it, and the same with values whose JSON text differs between JS and Python. Both suites count the bytes the store counts: storedBytes.parity.test.js and tests/test_run_half_source_binding.py.',
    source: SRC, sent, sentBytes: storeBytes(sent), edge, edgeBytes: storeBytes(edge),
  }, null, 1) + '\n')
}
const FIXTURE = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))

describe('the door counts what the store counts', () => {
  it('the fixture document carries a run half and its own script stamp', () => {
    expect(FIXTURE.sent.compute.runtimeObjects.source).toBe(FIXTURE.source)
    expect(typeof FIXTURE.sent.meta.pineSourceSha256).toBe('string')
  })

  it('the sent document and the edge document count to the fixture bytes', () => {
    expect(storeBytes(FIXTURE.sent)).toBe(FIXTURE.sentBytes)
    expect(storeBytes(FIXTURE.edge)).toBe(FIXTURE.edgeBytes)
    // ⛔ CONTROL: JavaScript's own text for one of these values is not the store's
    expect(pyJsonBytes(1e-5)).not.toBe(JSON.stringify(1e-5).length)
  })

  it('each value is counted as Python writes it', () => {
    const cases = [[1e-5, '1e-05'], [0.0001, '0.0001'], [0.00012, '0.00012'], [1.5e-7, '1.5e-07'],
      [123.456, '123.456'], [-2.5e-9, '-2.5e-09'], [1e21, '1e+21'], [7, '7'],
      ['é', '"é"'], ['\u0001', '"\\u0001"'], ['😀', '"😀"'], ['a"b', '"a\\"b"'], ['\t', '"\\t"']]
    for (const [v, py] of cases) expect(pyJsonBytes(v), JSON.stringify(v)).toBe(new TextEncoder().encode(py).length)
  })
})
