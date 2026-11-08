// UCT RS Phase 3, unit 3-01 — the server gate and legacy inputs, end to end:
// the definitions read (`serverCompute.serverDeclares`), the form model
// (`indicatorRegistry.fieldsForInstance`) and the preset filter
// (`indicatorRegistry.visiblePresets`).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  serverDeclares, fetchServerDefinitions, primeServerDefinitions, clearServerDefinitions,
  declarationFromRow, subscribeServerDefinitions, __setServerDefinitionsFetcherForTests,
  SERVER_DEFINITIONS_PATH,
} from '../serverCompute'
import {
  fieldsForInstance, fieldsFromDefinition, fieldFromInput, styleInputKeys, visiblePresets,
  visibleInputs, isInputHidden,
} from '../../indicatorRegistry'
import { validateDefinition } from '../defSchema'
import { validateInstance } from '../instances'
import * as engineRegistry from '../nativeRegistry'

// ⭐ THE REAL SHAPE, copied from `/api/signature/definitions`
// (`api/routers/signature.py::server_definitions` over
// `registry_defs.list_definitions()`, the `_rs_line_row` v3 row): an envelope
// `{schemaVersion, definitions: [row]}`, each row's inputs `{key, type, default,
// options?, min?, max?}`, an enum's options a bare list of VALUES.
const realBody = (extraInputs = []) => ({
  schemaVersion: 1,
  definitions: [
    { schemaVersion: 1, id: 'dpl', version: 1, compute: { kind: 'server', fn: 'dpl', rev: 1 }, inputs: [], columns: [] },
    {
      schemaVersion: 1, id: 'probeServer', version: 3,
      compute: { kind: 'server', fn: 'probeServer', rev: 3 },
      meta: { name: 'Probe' }, placement: { target: 'pane' },
      inputs: [
        { key: 'benchmark', type: 'enum', default: 'SPY', options: ['SPY', 'RSP', 'QQQ'] },
        { key: 'length', type: 'int', default: 14, min: 2, max: 200 },
        ...extraInputs,
      ],
      columns: ['line'], payload_keys: ['payload'], rules_key: null,
    },
  ],
})

const RAW = {
  schemaVersion: 1, id: 'probeServer', version: 1,
  compute: { kind: 'server', fn: 'probeServer', rev: 1 },
  meta: {
    name: 'Probe', shortName: 'P', category: 'Momentum', tier: 'premium', repaint: 'non-repainting',
    serverInputs: ['benchmark', 'length', 'view', 'window', 'oldView'],
    presets: [
      { id: 'plain', label: 'Plain', inputs: { length: 21, color: '#ffffff' } },
      { id: 'custom', label: 'Custom', inputs: { benchmark: 'CUSTOM' } },
      { id: 'viaView', label: 'Via view', inputs: { view: 'rotation' } },
      { id: 'gated', label: 'Gated', requiresServer: true, inputs: { length: 14, window: 10, color: '#000000' } },
      { id: 'old', label: 'Old meaning', inputs: { oldView: true } },
    ],
  },
  placement: { target: 'pane' },
  inputs: [
    { key: 'benchmark', type: 'enum', default: 'SPY',
      options: [['SPY', 'S&P 500'], ['RSP', 'Equal weight'], ['CUSTOM', 'Your symbol', { requiresServer: true }]] },
    { key: 'length', type: 'int', default: 14, min: 2, max: 200, group: 'Line' },
    { key: 'view', type: 'enum', default: 'ratio', options: ['ratio', 'rotation'], requiresServer: true },
    { key: 'window', type: 'int', default: 10, min: 2, max: 50, requiresServer: true },
    { key: 'oldView', type: 'bool', default: false, legacy: true },
    { key: 'color', type: 'color', default: 'token:info' },
  ],
  plots: [{ key: 'line', label: 'Line', style: 'line', color: '$color', width: 1 }],
  events: [],
}
const reg = validateDefinition(RAW)
if (!reg.ok) throw new Error(reg.errors.join('\n'))
const DEF = reg.def

const keys = (declared) => fieldsForInstance(DEF, null, { declared }).all.map((f) => f.key)
const optionsOf = (declared, key) => fieldsForInstance(DEF, null, { declared }).all
  .find((f) => f.key === key).options.map((o) => o[0])
const presetIds = (declared) => visiblePresets(DEF, declared).map((p) => p.id)

beforeEach(() => {
  clearServerDefinitions()
  __setServerDefinitionsFetcherForTests(null)
})
afterEach(() => {
  clearServerDefinitions()
  __setServerDefinitionsFetcherForTests(null)
})

describe('serverDeclares — the live row, read once per page load', () => {
  it('parses the REAL route shape: input keys, and each enum input\'s option values', () => {
    primeServerDefinitions(realBody())
    const d = serverDeclares('probeServer')
    expect(d).toEqual({ defId: 'probeServer', inputs: ['benchmark', 'length'], options: { benchmark: ['SPY', 'RSP', 'QQQ'] } })
    expect(Object.isFrozen(d) && Object.isFrozen(d.inputs) && Object.isFrozen(d.options)).toBe(true)
    // the same object each read: a `useSyncExternalStore` snapshot is stable
    expect(serverDeclares('probeServer')).toBe(d)
    // a row with no inputs declares nothing, and an id the server does not publish is null
    expect(serverDeclares('dpl')).toEqual({ defId: 'dpl', inputs: [], options: {} })
    expect(serverDeclares('nope')).toBeNull()
  })

  it('reads option pairs and {value} objects to the same values, and drops non-scalars', () => {
    const d = declarationFromRow({ id: 'x', inputs: [{ key: 'b', options: [['SPY', 'S&P'], { value: 'RSP' }, 'QQQ', { no: 1 }, [null]] }] })
    expect(d.options.b).toEqual(['SPY', 'RSP', 'QQQ'])
    for (const junk of [null, [], 'row', { inputs: [] }, { id: '' }]) expect(declarationFromRow(junk)).toBeNull()
  })

  it('ONE GET per page load: many readers, many definitions, one request at the published path', async () => {
    const fetcher = vi.fn(async () => realBody())
    expect(serverDeclares('probeServer', fetcher)).toBeNull()        // unknown until it lands
    expect(serverDeclares('dpl', fetcher)).toBeNull()
    expect(serverDeclares('probeServer', fetcher)).toBeNull()
    await fetchServerDefinitions(fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(SERVER_DEFINITIONS_PATH)
    expect(serverDeclares('probeServer', fetcher).inputs).toEqual(['benchmark', 'length'])
    expect(serverDeclares('dpl', fetcher)).not.toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('announces the landing once, so a surface can re-read', async () => {
    const seen = vi.fn()
    const unsub = subscribeServerDefinitions(seen)
    serverDeclares('probeServer', async () => realBody())
    await fetchServerDefinitions()
    expect(seen).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('⛔ FAILS CLOSED: a failed fetch, a 402-shaped throw or a malformed body is null — and is not re-asked', async () => {
    for (const fetcher of [
      vi.fn(async () => { throw new Error('HTTP 402') }),
      vi.fn(async () => ({ detail: 'Payment required' })),
      vi.fn(async () => ({ definitions: 'rows' })),
      vi.fn(async () => null),
    ]) {
      clearServerDefinitions()
      serverDeclares('probeServer', fetcher)
      await fetchServerDefinitions(fetcher)
      expect(serverDeclares('probeServer', fetcher)).toBeNull()
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  })

  it('⛔ never fires in a test unless a fetcher is injected or armed', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('a stray GET') })
    try {
      expect(serverDeclares('probeServer')).toBeNull()
      await fetchServerDefinitions()
      expect(spy).not.toHaveBeenCalled()
      // …and an ARMED fetcher is what runs
      const armed = vi.fn(async () => realBody())
      __setServerDefinitionsFetcherForTests(armed)
      serverDeclares('probeServer')
      await fetchServerDefinitions()
      expect(armed).toHaveBeenCalledTimes(1)
      expect(spy).not.toHaveBeenCalled()
      expect(serverDeclares('probeServer')).not.toBeNull()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('fieldsForInstance — gated controls follow the live row', () => {
  it('a fake definitions response SHOWS the gated input and option it declares', async () => {
    const fetcher = async () => realBody([
      { key: 'view', type: 'enum', default: 'ratio', options: ['ratio', 'rotation'] },
      { key: 'window', type: 'int', default: 10 },
    ])
    serverDeclares('probeServer', fetcher)
    await fetchServerDefinitions()
    expect(keys(serverDeclares('probeServer'))).toEqual(['benchmark', 'length', 'view', 'window', 'color'])
    // the row lists SPY/RSP/QQQ — CUSTOM is not among them, so it stays hidden
    expect(optionsOf(serverDeclares('probeServer'), 'benchmark')).toEqual(['SPY', 'RSP'])
    const withCustom = { inputs: ['benchmark', 'length'], options: { benchmark: ['SPY', 'RSP', 'CUSTOM'] } }
    expect(optionsOf(withCustom, 'benchmark')).toEqual(['SPY', 'RSP', 'CUSTOM'])
  })

  it('⛔ a FAILED fetch hides every gated control (null = not declared)', async () => {
    serverDeclares('probeServer', async () => { throw new Error('HTTP 503') })
    await fetchServerDefinitions()
    const declared = serverDeclares('probeServer')
    expect(declared).toBeNull()
    expect(keys(declared)).toEqual(['benchmark', 'length', 'color'])
    expect(optionsOf(declared, 'benchmark')).toEqual(['SPY', 'RSP'])
    // absent opts is the same answer
    expect(fieldsForInstance(DEF, null).all.map((f) => f.key)).toEqual(['benchmark', 'length', 'color'])
  })

  it('an UNGATED control is never hidden, whatever the server says', () => {
    for (const declared of [null, { inputs: [], options: {} }, { inputs: ['view'], options: { benchmark: [] } }]) {
      const k = keys(declared)
      for (const ungated of ['benchmark', 'length', 'color']) expect(k).toContain(ungated)
      expect(optionsOf(declared, 'benchmark').slice(0, 2)).toEqual(['SPY', 'RSP'])
    }
  })

  it('a gated input with no options declared shows, but its gated option needs its own declaration', () => {
    expect(keys({ inputs: ['window'] })).toEqual(['benchmark', 'length', 'window', 'color'])
    expect(optionsOf({ inputs: ['benchmark'] }, 'benchmark')).toEqual(['SPY', 'RSP'])
  })

  it('a LEGACY input stored on an instance validates, is kept in `values`, and is never rendered', () => {
    const inst = { instanceId: 'probeServer', defId: 'probeServer', inputs: { oldView: true } }
    const v = validateInstance(inst, (id) => (id === DEF.id ? DEF : null))
    expect(v.ok, JSON.stringify(v.errors)).toBe(true)
    const everything = { inputs: DEF.inputs.map((i) => i.key), options: { benchmark: ['SPY', 'RSP', 'CUSTOM'] } }
    for (const declared of [null, everything]) {
      const model = fieldsForInstance(DEF, inst, { declared })
      expect(model.values.oldView).toBe(true)
      expect(model.all.map((f) => f.key)).not.toContain('oldView')
      expect([...model.inputs, ...model.style].map((f) => f.key)).not.toContain('oldView')
    }
    expect(fieldsFromDefinition(DEF).map((f) => f.key)).not.toContain('oldView')
    expect(isInputHidden(DEF.inputs.find((i) => i.key === 'oldView'), everything)).toBe(true)
  })

  it('a hidden input is still computed with: `values` keeps every declared default', () => {
    const { values } = fieldsForInstance(DEF, null)
    expect(values).toMatchObject({ view: 'ratio', window: 10, oldView: false })
  })

  it('the gate never leaks into a field: the marker element is not an option label', () => {
    const opts = fieldsForInstance(DEF, null, { declared: { inputs: [], options: { benchmark: ['CUSTOM'] } } })
      .all.find((f) => f.key === 'benchmark').options
    expect(opts).toEqual([['SPY', 'S&P 500'], ['RSP', 'Equal weight'], ['CUSTOM', 'Your symbol']])
  })
})

describe('visiblePresets — filtered by input, by option value, and by its own marker', () => {
  const full = { inputs: ['benchmark', 'length', 'view', 'window'], options: { benchmark: ['SPY', 'RSP', 'CUSTOM'], view: ['ratio', 'rotation'] } }

  it('nothing declared: a preset naming a hidden input or option, and a gated preset, are hidden', () => {
    expect(presetIds(null)).toEqual(['plain', 'old'])
  })

  it('everything declared: every preset shows, in declared order, as the definition\'s own objects', () => {
    const shown = visiblePresets(DEF, full)
    expect(shown.map((p) => p.id)).toEqual(['plain', 'custom', 'viaView', 'gated', 'old'])
    expect(shown[0]).toBe(DEF.meta.presets[0])
  })

  it('by OPTION VALUE: CUSTOM shows only when the row lists it', () => {
    expect(presetIds({ ...full, options: { ...full.options, benchmark: ['SPY', 'RSP'] } })).not.toContain('custom')
  })

  it('by INPUT: the view preset shows only when the row declares `view`', () => {
    expect(presetIds({ ...full, inputs: ['benchmark', 'length', 'window'] })).not.toContain('viaView')
  })

  it('a requiresServer preset needs every SERVER input it sets declared — never its style keys', () => {
    expect(presetIds({ inputs: ['length', 'window'], options: {} })).toContain('gated')   // color is not sent
    expect(presetIds({ inputs: ['length'], options: {} })).not.toContain('gated')
    expect(presetIds({ inputs: ['window'], options: {} })).not.toContain('gated')
  })

  it('a preset that sets a legacy input is NOT hidden for it (the key is still a valid write)', () => {
    expect(presetIds(null)).toContain('old')
  })

  it('a definition with no presets, or no meta, yields []', () => {
    expect(visiblePresets({ inputs: [] }, full)).toEqual([])
    expect(visiblePresets(null, full)).toEqual([])
  })
})

describe('⭐ the byte-identical CONTROL — a definition using neither field renders what it rendered before', () => {
  // TODAY'S `fieldsForInstance`, restated from the pre-3-01 source, over the same
  // exported building blocks. Any difference for an ungated definition is a
  // regression in the shared model behind the dialog and the phone sheet.
  function todaysFieldsForInstance(def, instance) {
    const declared = Array.isArray(def?.inputs) ? def.inputs : []
    const byKey = new Map(declared.map((i) => [i && i.key, i]))
    const stored = (instance && instance.inputs && typeof instance.inputs === 'object') ? instance.inputs : {}
    const values = {}
    for (const d of declared) {
      if (!d || typeof d.key !== 'string') continue
      if (d.default !== undefined) values[d.key] = d.default
      if (Object.prototype.hasOwnProperty.call(stored, d.key)) values[d.key] = stored[d.key]
    }
    const all = declared.map(fieldFromInput).filter(Boolean).map((f) => {
      const d = byKey.get(f.key) || {}
      return {
        ...f, inputType: d.type, isInt: d.type === 'int',
        group: typeof d.group === 'string' ? d.group : null,
        inline: typeof d.inline === 'string' ? d.inline : null,
        tooltip: typeof d.tooltip === 'string' ? d.tooltip : null,
        activeWhen: d.activeWhen || null,
      }
    })
    const styleKeys = styleInputKeys(def)
    return {
      defId: def?.id, instanceId: instance?.instanceId, values, all,
      inputs: all.filter((f) => !styleKeys.has(f.key)), style: all.filter((f) => styleKeys.has(f.key)),
    }
  }

  const defs = engineRegistry.listDefinitions()
  const ungated = defs.filter((d) => !d.inputs.some((i) => i.legacy === true || i.requiresServer === true
    || (Array.isArray(i.options) && i.options.some((o) => (Array.isArray(o) ? o[2] : o)?.requiresServer === true))))

  it('the sweep is not vacuous', () => {
    expect(ungated.length).toBeGreaterThan(20)
    expect(ungated.map((d) => d.id)).toContain('rsLine')
  })

  it('every shipped ungated definition: byte-identical, with and without a declaration, at defaults and on an instance', () => {
    const anyDecl = { inputs: ['benchmark', 'period', 'nothing'], options: { benchmark: [] } }
    for (const def of ungated) {
      const inst = { instanceId: `${def.id}-x`, defId: def.id, inputs: Object.fromEntries(def.inputs.slice(0, 1).map((i) => [i.key, i.default])) }
      const want = JSON.stringify(todaysFieldsForInstance(def, inst))
      expect(JSON.stringify(fieldsForInstance(def, inst)), def.id).toBe(want)
      expect(JSON.stringify(fieldsForInstance(def, inst, { declared: null })), def.id).toBe(want)
      expect(JSON.stringify(fieldsForInstance(def, inst, { declared: anyDecl })), def.id).toBe(want)
      expect(JSON.stringify(fieldsForInstance(def, null)), def.id).toBe(JSON.stringify(todaysFieldsForInstance(def, null)))
      // …and the inputs reach `fieldFromInput` by IDENTITY
      visibleInputs(def, null).forEach((i, n) => expect(i, def.id).toBe(def.inputs[n]))
      // …and every preset shows
      expect(visiblePresets(def, null), def.id).toEqual(Array.isArray(def.meta?.presets) ? def.meta.presets : [])
    }
  })
})
