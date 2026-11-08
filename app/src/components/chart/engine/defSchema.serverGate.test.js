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
