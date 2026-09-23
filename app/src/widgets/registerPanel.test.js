// S1 CP3 (gate fc609961a) acceptance tests, §7 rows 1-2.
import { describe, it, expect } from 'vitest'
import {
  WIDGET_REGISTRY, WIDGET_IDS,
  registerPanel, validatePanelManifest, PanelManifestError, PARAM_FIELD_TYPES,
} from './registry'

// A manifest with every required field present, used as the base for each
// "break exactly one thing" case below.
function validManifest(overrides = {}) {
  return {
    labels: { header: 'Test', menu: 'Test', tab: 'Test' },
    defaults: { w: 4, h: 4, minW: 2, minH: 2 },
    paramsSchema: [{ key: 'symbol', type: 'symbol', required: true }],
    menus: { workspace: true, tab: true, mobile: true, journal: false },
    ...overrides,
  }
}

describe('registerPanel — validates required manifest fields at registration', () => {
  it('accepts a complete manifest and defaults menus.terminal to false', () => {
    const out = registerPanel('demo', validManifest())
    expect(out.menus.terminal).toBe(false)
    // Every other field passes through unchanged (identity, not a partial copy).
    expect(out.labels).toEqual(validManifest().labels)
    expect(out.defaults).toEqual(validManifest().defaults)
  })

  it('honors an explicit menus.terminal: true rather than overwriting it', () => {
    const out = registerPanel('demo', validManifest({ menus: { workspace: true, tab: true, mobile: true, journal: false, terminal: true } }))
    expect(out.menus.terminal).toBe(true)
  })

  it('rejects a missing labels.header (not at first render — HERE)', () => {
    const m = validManifest()
    delete m.labels.header
    expect(() => registerPanel('demo', m)).toThrow(PanelManifestError)
    expect(validatePanelManifest('demo', m)).toContain('labels.header must be a non-empty string')
  })

  it('rejects a missing defaults.minW', () => {
    const m = validManifest()
    delete m.defaults.minW
    expect(validatePanelManifest('demo', m)).toContain('defaults.minW must be a positive number')
  })

  it('rejects a paramsSchema entry with an unknown type (the typo case)', () => {
    const m = validManifest({ paramsSchema: [{ key: 'sym', type: 'symbool' }] })
    const problems = validatePanelManifest('demo', m)
    expect(problems.some(p => p.includes('paramsSchema[0].type'))).toBe(true)
  })

  it('rejects a duplicate paramsSchema key', () => {
    const m = validManifest({ paramsSchema: [{ key: 'x', type: 'string' }, { key: 'x', type: 'number' }] })
    expect(validatePanelManifest('demo', m).some(p => p.includes('declared twice'))).toBe(true)
  })

  it('rejects an enum field with no options', () => {
    const m = validManifest({ paramsSchema: [{ key: 'x', type: 'enum' }] })
    expect(validatePanelManifest('demo', m).some(p => p.includes('needs a non-empty options array'))).toBe(true)
  })

  it('rejects a non-boolean menu flag', () => {
    const m = validManifest({ menus: { workspace: 'yes', tab: true, mobile: true, journal: false } })
    expect(validatePanelManifest('demo', m)).toContain('menus.workspace must be a boolean')
  })

  it('reports every problem at once, not just the first', () => {
    const problems = validatePanelManifest('demo', {})
    expect(problems.length).toBeGreaterThan(1)
  })

  it('PARAM_FIELD_TYPES matches every case coerce() actually handles (registry.js)', () => {
    // coerce()'s switch is the ground truth; this list must never silently
    // diverge from it (a type registerPanel accepts but coerce drops would
    // validate clean and then lose the value on first normalizeParams call).
    const src = readSourceOfCoerce()
    const cases = [...src.matchAll(/case '([a-z]+)':/g)].map(m => m[1])
    expect(new Set(PARAM_FIELD_TYPES)).toEqual(new Set(cases))
  })
})

function readSourceOfCoerce() {
  // Vitest runs against source, not a bundle — a plain relative read is fine here
  // and keeps this test from importing the whole registry module as text twice.
  const fs = require('node:fs')
  const path = require('node:path')
  return fs.readFileSync(path.join(__dirname, 'registry.js'), 'utf-8')
}

describe('registerPanel — every existing WIDGET_REGISTRY entry passes through it', () => {
  it('defaults menus.terminal false for every existing entry (test_registerPanel_defaults_menus_terminal_false_for_existing_entries)', () => {
    // Derived from the live registry, never a typed count (⚰️ this proposal's own
    // earlier drafts said "21" against a registry of 20 — see the proposal's §1/§2
    // corrections). A widget added tomorrow is covered the day it lands.
    expect(WIDGET_IDS.length).toBeGreaterThan(0)
    for (const id of WIDGET_IDS) {
      expect(WIDGET_REGISTRY[id].menus.terminal).toBe(false)
    }
  })

  it('the registry is still frozen (registerPanel does not weaken deepFreeze)', () => {
    expect(Object.isFrozen(WIDGET_REGISTRY)).toBe(true)
    expect(Object.isFrozen(WIDGET_REGISTRY.chart)).toBe(true)
    expect(Object.isFrozen(WIDGET_REGISTRY.chart.menus)).toBe(true)
  })
})
