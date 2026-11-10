// UCT RS Phase 3, unit 3-01 — `requiresServer` and `legacy` in the schema.
//
// Accept and refuse PAIRS: every refusal sits beside the accepted spelling it
// is one keystroke from, so a validator that refused everything (or nothing)
// fails here rather than passing on half the pairs.
import { describe, it, expect } from 'vitest'
import {
  validateDefinition, enumOptionRequiresServer, PRESET_FIELDS, PRESET_GATE_FIELDS,
} from './defSchema'
import { validateInstance } from './instances'
import { inputsAsRead } from './legacyInputs'

const serverDef = (patch = {}) => ({
  schemaVersion: 1, id: 'probeServer', version: 1,
  compute: { kind: 'server', fn: 'probeServer', rev: 1 },
  meta: {
    name: 'Probe', shortName: 'P', category: 'Momentum', tier: 'premium', repaint: 'non-repainting',
    serverInputs: ['benchmark', 'length', 'view', 'oldView'],
    ...(patch.meta || {}),
  },
  placement: { target: 'pane' },
  inputs: patch.inputs || [
    { key: 'benchmark', type: 'enum', default: 'SPY',
      options: [['SPY', 'S&P 500'], ['CUSTOM', 'Your symbol', { requiresServer: true }]] },
    { key: 'length', type: 'int', default: 14, min: 2, max: 200 },
    { key: 'view', type: 'enum', default: 'ratio', options: ['ratio', 'rotation'], requiresServer: true },
    { key: 'oldView', type: 'bool', default: false, legacy: true },
    { key: 'color', type: 'color', default: 'token:info' },
  ],
  plots: [{ key: 'line', label: 'Line', style: 'line', color: '$color', width: 1 }],
  events: [],
})

const ok = (d) => {
  const r = validateDefinition(d)
  expect(r.ok, JSON.stringify(r.errors)).toBe(true)
  return r.def
}
const refused = (d, re) => {
  const r = validateDefinition(d)
  expect(r.ok, 'expected a refusal').toBe(false)
  expect(r.errors.join(' | ')).toMatch(re)
}
const withInput = (key, patch) => {
  const d = serverDef()
  const i = d.inputs.findIndex((x) => x.key === key)
  d.inputs[i] = { ...d.inputs[i], ...patch }
  return d
}

describe('requiresServer and legacy on an INPUT', () => {
  it('accepts both as `true`, and keeps them on the registered definition', () => {
    const def = ok(serverDef())
    expect(def.inputs.find((i) => i.key === 'view').requiresServer).toBe(true)
    expect(def.inputs.find((i) => i.key === 'oldView').legacy).toBe(true)
  })

  it('refuses any other value, by name (fail closed)', () => {
    for (const v of [false, 'true', 1, null, {}]) {
      refused(withInput('view', { requiresServer: v }), /inputs\[2\]\.requiresServer: expected true or absent/)
      refused(withInput('oldView', { legacy: v }), /inputs\[3\]\.legacy: expected true or absent/)
    }
  })

  it('refuses a gated legacy input — the gate would decide nothing', () => {
    ok(withInput('oldView', { legacy: true }))
    refused(withInput('oldView', { legacy: true, requiresServer: true }), /legacy input is never rendered/)
  })

  it('refuses a gate on a definition the server does not compute', () => {
    ok(serverDef())
    const d = serverDef(); d.compute = { kind: 'native', fn: 'rsi', rev: 1 }
    refused(d, /inputs\[2\]\.requiresServer: compute\.kind is "native"/)
  })

  it('refuses a gate on an input the definition never sends to the server', () => {
    ok(serverDef())
    const d = serverDef(); d.meta.serverInputs = ['benchmark', 'length']
    refused(d, /"view" is not in meta\.serverInputs/)
  })

  it('a legacy input is not a gate: it needs no server, and any kind may declare one', () => {
    const d = serverDef({ inputs: [{ key: 'oldView', type: 'bool', default: false, legacy: true },
      { key: 'color', type: 'color', default: 'token:info' }] })
    d.compute = { kind: 'native', fn: 'rsi', rev: 1 }
    ok(d)
  })
})

describe('requiresServer on an enum OPTION', () => {
  it('accepts the pair-with-marker and the object form', () => {
    ok(serverDef())
    ok(withInput('benchmark', { options: [{ value: 'SPY', label: 'S&P 500' },
      { value: 'CUSTOM', label: 'Your symbol', requiresServer: true }] }))
  })

  it('refuses a third element that is not exactly {requiresServer: true}', () => {
    for (const extra of [{ requiresServer: false }, { requiresServer: true, hint: 'x' }, 'requiresServer', true, {}]) {
      refused(withInput('benchmark', { options: [['SPY', 'S&P 500'], ['CUSTOM', 'Your symbol', extra]] }),
        /inputs\[0\]\.options\[1\]\[2\]: expected \{requiresServer: true\}/)
    }
    refused(withInput('benchmark', { options: [['SPY', 'S&P 500'], ['CUSTOM', 'Your symbol', { requiresServer: true }, 'x']] }),
      /options\[1\]: an option pair is/)
  })

  it('refuses an object form whose marker is not `true`', () => {
    refused(withInput('benchmark', { options: ['SPY', { value: 'CUSTOM', requiresServer: 'yes' }] }),
      /inputs\[0\]\.options\[1\]\.requiresServer: expected true or absent/)
  })

  it('refuses a DEFAULT that is a gated option', () => {
    ok(withInput('benchmark', { default: 'SPY' }))
    refused(withInput('benchmark', { default: 'CUSTOM' }), /the default "CUSTOM" is a requiresServer option/)
  })

  it('refuses a gated option on a definition the server does not compute, or on an unsent input', () => {
    const native = serverDef(); native.compute = { kind: 'native', fn: 'rsi', rev: 1 }
    native.inputs = native.inputs.filter((i) => i.key !== 'view')
    refused(native, /inputs\[0\]\.options: compute\.kind is "native"/)
    const unsent = serverDef(); unsent.meta.serverInputs = ['length', 'view', 'oldView']
    refused(unsent, /inputs\[0\]\.options: "benchmark" is not in meta\.serverInputs/)
  })

  it('the marker reader knows both spellings and nothing else', () => {
    expect(enumOptionRequiresServer(['C', 'c', { requiresServer: true }])).toBe(true)
    expect(enumOptionRequiresServer({ value: 'C', requiresServer: true })).toBe(true)
    for (const o of ['C', ['C', 'c'], ['C', 'c', { requiresServer: 1 }], { value: 'C' }, null, undefined]) {
      expect(enumOptionRequiresServer(o)).toBe(false)
    }
  })

  it('the gated option still validates as a value — a stored CUSTOM is not refused', () => {
    const def = ok(serverDef())
    const reg = (id) => (id === def.id ? def : null)
    const r = validateInstance({ instanceId: 'probeServer', defId: def.id, inputs: { benchmark: 'CUSTOM' } }, reg)
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
  })
})

describe('requiresServer on a PRESET', () => {
  const withPreset = (p) => serverDef({ meta: { presets: [{ id: 'rot', label: 'Rotation', inputs: { view: 'rotation' }, ...p }] } })

  it('accepts `true`, and the key stays out of the APPLIED fields', () => {
    ok(withPreset({ requiresServer: true }))
    ok(withPreset({}))
    expect(PRESET_GATE_FIELDS).toEqual(['requiresServer'])
    expect(PRESET_FIELDS).not.toContain('requiresServer')
    expect(Object.isFrozen(PRESET_GATE_FIELDS)).toBe(true)
  })

  it('refuses any other value, and a gated preset on a definition the server does not compute', () => {
    for (const v of [false, 'true', 1, null]) {
      refused(withPreset({ requiresServer: v }), /meta\.presets\[0\]\.requiresServer: expected true or absent/)
    }
    const d = withPreset({ requiresServer: true })
    d.compute = { kind: 'native', fn: 'rsi', rev: 1 }
    d.inputs = d.inputs.filter((i) => i.key !== 'view' && i.key !== 'benchmark')
    refused(d, /meta\.presets\[0\]\.requiresServer: compute\.kind is "native"/)
  })

  it('a typo of the key is still an unknown preset field', () => {
    refused(withPreset({ requireServer: true }), /meta\.presets\[0\]\.requireServer: .*unknown preset field/)
  })
})

describe('a legacy input stored on an instance VALIDATES (F20)', () => {
  it('is accepted with a legal value, and refused with an illegal one — still typed', () => {
    const def = ok(serverDef())
    const reg = (id) => (id === def.id ? def : null)
    const good = validateInstance({ instanceId: 'probeServer', defId: def.id, inputs: { oldView: true } }, reg)
    expect(good.ok, JSON.stringify(good.errors)).toBe(true)
    const bad = validateInstance({ instanceId: 'probeServer', defId: def.id, inputs: { oldView: 'on' } }, reg)
    expect(bad.ok).toBe(false)
    expect(bad.errors.join(' ')).toMatch(/inputs\.oldView: type "bool"/)
  })
})

// ─── unit 3-08b — `mapsTo` on a legacy input ────────────────────────────────
describe('mapsTo: a legacy input read as its successor', () => {
  const MAP = { when: true, key: 'view', value: 'rotation' }
  const mapped = (mapsTo, patch = {}) => withInput('oldView', { legacy: true, mapsTo, ...patch })

  it('accepts the well-formed mapping and keeps it on the registered definition', () => {
    const def = ok(mapped(MAP))
    expect(def.inputs.find((i) => i.key === 'oldView').mapsTo).toEqual(MAP)
  })

  it('only a legacy input may declare one', () => {
    refused(withInput('oldView', { legacy: undefined, mapsTo: MAP }), /inputs\[3\]\.mapsTo: only a legacy input/)
    refused(withInput('length', { mapsTo: { when: 20, key: 'view', value: 'rotation' } }), /inputs\[1\]\.mapsTo: only a legacy input/)
  })

  it('exactly {when, key, value}', () => {
    refused(mapped('view'), /inputs\[3\]\.mapsTo: expected \{when, key, value\}/)
    refused(mapped({ when: true, key: 'view' }), /mapsTo: expected exactly \{when, key, value\}, missing value/)
    refused(mapped({ ...MAP, also: 1 }), /mapsTo: expected exactly \{when, key, value\}, unknown also/)
  })

  it('the successor is a declared, live input other than itself', () => {
    refused(mapped({ ...MAP, key: 'nope' }), /mapsTo\.key: "nope" names no declared input/)
    refused(mapped({ ...MAP, key: 'oldView', value: true }), /mapsTo\.key: "oldView" is the legacy input itself/)
    const d = mapped({ ...MAP, key: 'older', value: true })
    d.inputs.push({ key: 'older', type: 'bool', default: false, legacy: true })
    refused(d, /mapsTo\.key: "older" is itself legacy/)
  })

  it('when is a legal, non-default value of the legacy input', () => {
    refused(mapped({ ...MAP, when: 'yes' }), /mapsTo\.when: type "bool" requires true or false/)
    refused(mapped({ ...MAP, when: false }), /mapsTo\.when: false is "oldView"'s default/)
  })

  it('value is a legal, non-default value of the successor', () => {
    refused(mapped({ ...MAP, value: 'mansfeld' }), /mapsTo\.value: "mansfeld" is not one of the declared options/)
    refused(mapped({ ...MAP, value: 'ratio' }), /mapsTo\.value: "ratio" is "view"'s default/)
    refused(mapped({ ...MAP, key: 'length', value: 7.5 }), /mapsTo\.value: type "int" requires an integer/)
  })

  it('one mapping per successor', () => {
    const d = mapped(MAP)
    d.inputs.push({ key: 'older', type: 'bool', default: false, legacy: true, mapsTo: MAP })
    refused(d, /mapsTo\.key: "view" is already the successor of inputs\[3\]/)
  })

  it('reads the successor only where it was never stored, and never writes', () => {
    const def = ok(mapped(MAP))
    const legacy = Object.freeze({ oldView: true })
    const read = inputsAsRead(def, legacy)
    expect(read).toEqual({ oldView: true, view: 'rotation' })
    expect(legacy).toEqual({ oldView: true })
    const explicit = { oldView: true, view: 'ratio' }
    expect(inputsAsRead(def, explicit)).toBe(explicit)
    expect(inputsAsRead(def, { oldView: true, view: undefined }).view).toBe('rotation')
    for (const none of [{}, { oldView: false }, { length: 20 }]) expect(inputsAsRead(def, none)).toBe(none)
    expect(inputsAsRead(def, read)).toBe(read)
    expect(inputsAsRead(def, null)).toBe(null)
  })
})

// ⭐ UCT RS 3-14 — `plots[].requiresServer`: the Phase 3 lines offer no Plot style
// until the live row declares the gated inputs (`indicatorRegistry.isPlotHidden`).
describe('3-14 · a gated plot', () => {
  const withPlot = (patch, def = serverDef()) => ({
    ...def, plots: [...def.plots, { key: 'ratio2', label: 'Ratio', style: 'line', color: '#6ba3be', width: 1, ...patch }],
  })

  it('accepts `requiresServer: true` on a server definition with a gated input; refuses every other spelling', () => {
    ok(withPlot({ requiresServer: true }))
    ok(withPlot({}))
    refused(withPlot({ requiresServer: false }), /plots\[1\]\.requiresServer: expected true or absent/)
    refused(withPlot({ requiresServer: 'yes' }), /plots\[1\]\.requiresServer: expected true or absent/)
  })

  it('refuses it where no live row could ever arm it', () => {
    const local = { ...serverDef(), compute: { kind: 'native', fn: 'probeServer', rev: 1 } }
    const noGated = serverDef({ inputs: [{ key: 'length', type: 'int', default: 14, min: 2, max: 200 },
      { key: 'color', type: 'color', default: 'token:info' }] })
    refused(withPlot({ requiresServer: true }, noGated), /declares no requiresServer input/)
    const r = validateDefinition(withPlot({ requiresServer: true }, local))
    expect(r.ok).toBe(false)
    expect(r.errors.join(' | ')).toMatch(/plots\[1\]\.requiresServer/)
  })
})

// ⭐ UCT RS split, unit U1 — `meta.requiresServer`: the DEFINITION-level gate.
// Every surface that offers indicators to add hides the definition until the
// live server lists its id (`serverCompute.isDefinitionOffered`).
describe('U1 · meta.requiresServer on a DEFINITION', () => {
  it('accepts `true` on a server definition, and absent; the flag survives validation', () => {
    const def = ok(serverDef({ meta: { requiresServer: true } }))
    expect(def.meta.requiresServer).toBe(true)
    expect(ok(serverDef()).meta.requiresServer).toBeUndefined()
  })

  it('refuses every other spelling by name — false, "yes", 1, null gate nothing', () => {
    for (const v of [false, 'yes', 1, null, 'true']) {
      refused(serverDef({ meta: { requiresServer: v } }), /meta\.requiresServer: expected true or absent/)
    }
  })

  it('refuses it on a definition no live row could ever list (native lane)', () => {
    const local = { ...serverDef({ meta: { requiresServer: true } }), compute: { kind: 'native', fn: 'probeServer', rev: 1 } }
    // the native lane also refuses the input-level gates; the definition-level
    // message is asserted by name so the case cannot pass on those alone.
    const r = validateDefinition(local)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' | ')).toMatch(/meta\.requiresServer: compute\.kind is "native"/)
  })

  it('⭐ an instance of a gated definition still VALIDATES (F20): the gate hides offers, never saved charts', () => {
    const def = ok(serverDef({ meta: { requiresServer: true } }))
    const reg = (id) => (id === def.id ? def : null)
    const r = validateInstance({ instanceId: 'probeServer', defId: def.id, inputs: { length: 21 } }, reg)
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
  })
})
