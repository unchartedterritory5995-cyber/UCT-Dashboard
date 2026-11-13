// app/src/components/chart/builder/memberPane/runHalf.pairing.rail.test.js
//
// ⭐⭐ ENGINE 53 — ONE ROW PAIRING FOR BOTH LANES (`runRowPairing.js::pairRunRows`).
//
// The runtime document's rows and a host document's run half both need "which run output is
// which host output". Two copies of that rule are two authorities over one mapping, and the
// copy that drifts draws one plot's column under another plot's name (or proves the column
// rail against the wrong column). This rail holds the door to ONE copy: both lanes call
// `pairRunRows`, and the door carries none of the pairing's own idioms. And a run whose
// outputs do not pair is declined by the run half's door, never routed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { pairRunRows } from './runRowPairing'

// ⭐ the run's probe, wrapped: with the switch on, the DRAWING build reports one plot more
// than the script has (a pairing that cannot be known). Off, it is the real probe.
const extra = vi.hoisted(() => ({ on: false }))
vi.mock('../../engine/runtime/runtimeColumns', async (orig) => {
  const real = await orig()
  return {
    ...real,
    probeRuntimeProgram: (source, opts = {}) => {
      const p = real.probeRuntimeProgram(source, opts)
      if (!extra.on || !opts.objectsInRun || !p.ok) return p
      return { ...p, outputs: [...p.outputs, { call: 'plot' }] }
    },
  }
})
// eslint-disable-next-line import/first
import { memberPaneDefinition } from './memberPaneDefinition'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DOOR = fs.readFileSync(path.join(HERE, 'memberPaneDefinition.js'), 'utf8')
/** the door's code, comments stripped (a comment may name the pairing; code may not repeat it) */
const CODE = DOOR.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('one pairing, both lanes', () => {
  it('both lanes call pairRunRows', () => {
    expect((CODE.match(/\bpairRunRows\(/g) || []).length).toBeGreaterThanOrEqual(2)
    expect(CODE).toMatch(/import \{ pairRunRows \} from '\.\/runRowPairing'/)
  })

  it('⛔ the door carries none of the pairing\'s own idioms (no second copy)', () => {
    for (const idiom of [/\bhostByKind\b/, /\.byRole\[[^\]]+\]\s*=/, /runtimeByKind\.set\(/, /runCandles\.set\(/,
      /hostCandles\.set\(/, /\bRUNTIME_ROW_KINDS\s*=/, /\bRUNTIME_CANDLE_KINDS\s*=/]) {
      expect(CODE, String(idiom)).not.toMatch(idiom)
    }
  })

  it('pairs by kind and ordinal, hidden outputs included, candles four to a group by role', () => {
    const t = { outputs: [
      { kind: 'plot' }, { kind: 'plotshape' }, { kind: 'plot', hidden: true },
      { kind: 'plotcandle' }, { kind: 'plotcandle' }, { kind: 'plotcandle' }, { kind: 'plotcandle' },
    ] }
    const run = [{ call: 'plotshape' }, { call: 'plot' }, { call: 'plot' },
      { call: 'plotcandle', group: 0, role: 'open' }, { call: 'plotcandle', group: 0, role: 'high' },
      { call: 'plotcandle', group: 0, role: 'low' }, { call: 'plotcandle', group: 0, role: 'close' }]
    const p = pairRunRows(t, run)
    expect(p.ok).toBe(true)
    expect([...p.runOutputOf.entries()]).toEqual([[0, 1], [1, 0], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]])
  })

  it('⛔ a count that disagrees is a decline by name, never a guess', () => {
    expect(pairRunRows({ outputs: [{ kind: 'plot' }] }, [{ call: 'plot' }, { call: 'plot' }]))
      .toMatchObject({ ok: false, code: 'runtime:output-map' })
    expect(pairRunRows({ outputs: [{ kind: 'plotcandle' }, { kind: 'plotcandle' }, { kind: 'plotcandle' }, { kind: 'plotcandle' }] }, []))
      .toMatchObject({ ok: false, code: 'runtime:output-map' })
  })
})

describe('⛔ the run half\'s door declines a run whose outputs do not pair', () => {
  const LF = String.fromCharCode(10)
  const SRC = ['//@version=5', 'indicator("run half", overlay = true)', 'm = ta.sma(close, 5)', 'plot(m, "m")',
    'if barstate.islast', '    for i = 0 to 4', '        if close[i] > open[i]', '            label.new(bar_index - i, high[i], "up")'].join(LF)
  beforeEach(() => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  })
  afterEach(() => { extra.on = false; vi.unstubAllEnvs() })

  it('one plot more on the run: declined runtime:output-map, nothing minted', () => {
    extra.on = true
    const d = memberPaneDefinition({ source: SRC, id: 'u_member-pane-rhmap', name: 'm' })
    expect(d.ok, d.reason).toBe(true)
    expect(d.runHalfDeclined && d.runHalfDeclined.code).toBe('runtime:output-map')
    expect(d.definition.compute.runtimeObjects).toBeUndefined()
  })

  it('CONTROL: the real probe pairs, and the run half is minted', () => {
    const d = memberPaneDefinition({ source: SRC, id: 'u_member-pane-rhmap', name: 'm' })
    expect(d.runHalf).toEqual({ minted: true, columns: 1 })
  })
})
