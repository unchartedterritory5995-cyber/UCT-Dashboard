// app/src/components/chart/supportLoop/assistantPineReference.test.js
//
// ⭐ THE COMMITTED REFERENCE IS THE CURRENT BUILD'S ANSWER. `assistantPineReference.json` is
// regenerated here, from the engine's own tables and through the member's own paste path, and
// compared with the committed bytes. A change to what the engine serves reds this file until the
// reference is regenerated in the same change:
//
//   (cd app && WRITE_ASSISTANT_PINE_REFERENCE=1 node node_modules/vitest/vitest.mjs run \
//      src/components/chart/supportLoop/assistantPineReference.test.js)
import { describe, it, expect, beforeAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { inspectSource } from '../builder/PineBox'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { editorStatus } from '../builder/editorStatus'
import { __permitRuntimePaneForTests } from '../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../engine/runtimeKill'
import { RUNTIME_OUTPUT_CALLS } from '../engine/ast/pineRuntimeFrontend'
import DOOR_NAMES from './doorNameCoverage.json'
import EXAMPLE_INDEX from './assistantExamples/index.json'
import {
  buildAssistantPineReference, servedOutputs, outputProbeScript, OUTPUT_PROBES, PITFALL_PROBES, RUNS_STATES, DRAWING_FAMILIES,
} from './assistantPineReference'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')

const HERE = path.resolve(process.cwd(), 'src/components/chart/supportLoop')
const FILE = path.join(HERE, 'assistantPineReference.json')
const ALLOWLIST = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '..', 'api', 'data', 'pine_runtime_allowlist.json'), 'utf8'))
const LF = String.fromCharCode(10)
const EXAMPLES = EXAMPLE_INDEX.examples.map((e) => ({
  ...e, source: fs.readFileSync(path.join(HERE, 'assistantExamples', e.file), 'utf8').replace(/\r\n/g, LF),
}))

/** The member's paste path on one script: the report, the pane, and the status panel's verdict. */
let n = 0
function verdictOf(source) {
  const report = inspectSource(source, 'pine')
  const pane = memberPaneDefinition({ source, id: `u_ref_${n += 1}`, name: 'reference' })
  const status = editorStatus({ report, pane, savedRow: null, inspectedSource: source })
  return { ok: pane.ok === true, lane: pane.lane || 'host', state: status.state, headline: status.headline }
}

const build = (over = {}) => buildAssistantPineReference({
  allowlist: ALLOWLIST, doorNames: DOOR_NAMES, examples: EXAMPLES, verdictOf, outputCalls: RUNTIME_OUTPUT_CALLS, ...over,
})

describe('assistantPineReference.json is the current build\'s answer', () => {
  beforeAll(() => { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests() })

  it('regenerates byte-for-byte (WRITE_ASSISTANT_PINE_REFERENCE=1 rewrites it)', () => {
    const text = `${JSON.stringify(build(), null, 1)}${LF}`
    if (process.env.WRITE_ASSISTANT_PINE_REFERENCE === '1') fs.writeFileSync(FILE, text)
    const committed = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, LF) : ''
    expect(committed === text,
      'assistantPineReference.json is stale: the engine now serves something else. Regenerate it with '
      + 'WRITE_ASSISTANT_PINE_REFERENCE=1 (see this file\'s header) and commit it with the change.').toBe(true)
  }, 300_000)

  it('every worked example runs fully on the member\'s path: one that did not would teach a script the engine refuses', () => {
    const ref = build()
    expect(ref.examples.length).toBeGreaterThanOrEqual(10)
    for (const e of ref.examples) {
      expect(e.ok, `${e.id}: ${e.headline}`).toBe(true)
      expect(RUNS_STATES, `${e.id}: ${e.state} (${e.headline})`).toContain(e.state)
    }
    // each of the things the assistant could not make before has an example that shows it
    const all = ref.examples.map((e) => e.source).join(LF)
    for (const needle of ['table.new', 'table.cell', 'label.new', 'line.new', 'line.delete', 'box.new', 'fill(', 'plotshape(',
      'bgcolor(', 'barcolor(', 'array.push', 'for ', 'request.security', 'ta.pivothigh', 'input.int', 'str.tostring']) {
      expect(all.includes(needle), needle).toBe(true)
    }
  }, 300_000)

  it('lists a drawing function only for an ADMITTED family, with the engine\'s own parameters', () => {
    const ref = build()
    expect(ref.families).toEqual([...DRAWING_FAMILIES])
    expect(ref.drawing.table.map((o) => o.name)).toEqual(expect.arrayContaining(['table.new', 'table.cell', 'table.clear']))
    expect(ref.drawing.line.find((o) => o.name === 'line.new').params).toEqual(expect.arrayContaining(['x1', 'y1', 'x2', 'y2']))
    const names = Object.values(ref.drawing).flat().map((o) => o.name)
    expect(names.some((x) => x.startsWith('linefill.') || x.startsWith('polyline.'))).toBe(false)
    // take a family's admission away and it is gone, constants and limits with it
    const caps = { ...ALLOWLIST.capabilities, 'obj:table': { ...ALLOWLIST.capabilities['obj:table'], admitted: false } }
    const without = build({ allowlist: { ...ALLOWLIST, capabilities: caps } })
    expect(without.families).toEqual(['line', 'label', 'box'])
    expect(without.drawing.table).toBeUndefined()
    expect(without.admitted).not.toContain('obj:table')
    // and with no array admission there is no array function
    const noArrays = { ...ALLOWLIST.capabilities, 'collections:array': { admitted: false } }
    expect(build({ allowlist: { ...ALLOWLIST, capabilities: noArrays } }).arrays).toEqual([])
    expect(ref.arrays).toEqual(expect.arrayContaining(['array.push', 'array.new_float', 'array.size']))
    expect(ref.arrays.some((x) => x.startsWith('map.') || x.startsWith('matrix.') || x.includes(' '))).toBe(false)
  }, 300_000)

  it('a value function is listed with the call the door itself proved', () => {
    const ref = build()
    const sma = ref.values.find((v) => v.name === 'ta.sma')
    expect(sma && sma.call).toMatch(/^ta\.sma\(/)
    expect(ref.values.length).toBe(Object.values(DOOR_NAMES.names).filter((v) => v.status === 'reachable').length)
    // a name the door does not reach is not listed, whatever TradingView has
    const unreached = Object.entries(DOOR_NAMES.names).find(([, v]) => v.status !== 'reachable')[0]
    expect(ref.values.some((v) => v.name === unreached)).toBe(false)
  }, 300_000)

  it('an output call is asked of the paste path, and only one that runs is served', () => {
    const ref = build()
    expect(ref.outputs.map((o) => o.name).sort()).toEqual(Object.keys(OUTPUT_PROBES).sort())
    const served = servedOutputs(ref)
    expect(served).toEqual(expect.arrayContaining(['plot', 'plotshape', 'bgcolor', 'barcolor', 'fill']))
    for (const o of ref.outputs) {
      if (!served.includes(o.name)) expect(o.ok && RUNS_STATES.includes(o.state), o.name).toBe(false)
    }
    // CONTROL: a path that refuses everything serves nothing
    const refusing = build({ verdictOf: () => ({ ok: false, lane: 'host', state: 'not-yet', headline: 'Not yet' }) })
    expect(servedOutputs(refusing)).toEqual([])
    expect(refusing.examples.every((e) => e.ok === false)).toBe(true)
    expect(outputProbeScript('plot')).toContain('plot(close')
  }, 300_000)

  it('a pitfall stands only while the engine still does not draw it', () => {
    const ref = build()
    expect(ref.pitfalls.map((p) => p.id)).toEqual(Object.keys(PITFALL_PROBES).sort())
    // today both stand: untitled plots kept only as fill anchors draw nothing, and hline is withheld
    expect(ref.pitfalls.filter((p) => p.standing).map((p) => p.id)).toEqual(['hline', 'untitled-fill-anchor'])
    // CONTROL: on an engine that runs everything, no pitfall stands
    const running = build({ verdictOf: () => ({ ok: true, lane: 'host', state: 'runs', headline: 'Runs fully' }) })
    expect(running.pitfalls.every((p) => p.standing === false)).toBe(true)
  }, 300_000)

  it('names the engine refuses are listed apart, never among what is served', () => {
    const ref = build()
    expect(ref.refusedNames).toEqual(expect.arrayContaining(['barstate.isnew', 'syminfo.type']))
    for (const name of ref.refusedNames) {
      expect(ref.barstate.includes(name) || ref.symbol.includes(name) || ref.values.some((v) => v.name === name), name).toBe(false)
    }
  }, 300_000)
})
