// app/src/components/chart/__tests__/rsSplitFlagOn.test.jsx
//
// ─── UCT RS split, U7 — THE BUILD FLAG PICKS THE REGISTERED `rsLine` ─────────
//
// `nativeRegistry.js` reads `VITE_RS_SPLIT_ENABLED` ONCE, at module load, and
// registers the slim UCT RS Line under '1' or today's UCT Relative Strength
// otherwise. The suite's default is OFF (`test-setup.js` deletes the key), and
// every other RS file pins today's shape under it. This file is the one place
// the registration itself is proved, both ways, through a fresh module graph:
// the env stubbed, `vi.resetModules()`, dynamic imports.
//
//   · '1'  → `getDefinition('rsLine')` is the slim definition, byte for byte the
//            registered `RS_LINE_SLIM_RAW`; the phone sheet opens "UCT RS Line
//            settings" with no Preset row and the slim groups;
//   · unset, '', '0', 'true' → today's definition, byte for byte the registered
//            `RS_LINE_V5_RAW` (the OFF-mode identity rail the brief asks for).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState, createElement as h } from 'react'
import { render, screen, cleanup } from '@testing-library/react'

const REG = '../engine/nativeRegistry'
const SHEET = '../../../pages/charts/mobile/MobileIndicatorSheet'

async function fresh(value) {
  vi.resetModules()
  if (value === undefined) vi.stubEnv('VITE_RS_SPLIT_ENABLED', undefined)
  else vi.stubEnv('VITE_RS_SPLIT_ENABLED', value)
  if (value === undefined) {
    try { delete import.meta.env.VITE_RS_SPLIT_ENABLED } catch { /* read-only */ }
  }
  return import(REG)
}

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.resetModules() })

describe('VITE_RS_SPLIT_ENABLED', () => {
  it("'1': the registry holds the slim UCT RS Line, byte for byte the registered slim raw", async () => {
    const reg = await fresh('1')
    expect(reg.rsSplitEnabled()).toBe(true)
    const def = reg.getDefinition('rsLine')
    expect(def.meta.name).toBe('UCT RS Line')
    expect(def.placement.target).toBe('price')
    expect(def.meta.presets).toBeUndefined()
    expect(JSON.stringify(def)).toBe(JSON.stringify(reg.registerDefinitions([reg.RS_LINE_SLIM_RAW]).defs[0]))
    expect(reg.SERVER_DEFS.map((d) => d.id)).toContain('rsLine')
    expect(reg.listDefinitions().filter((d) => d.id === 'rsLine')).toHaveLength(1)
  })

  for (const value of [undefined, '', '0', 'true']) {
    it(`${JSON.stringify(value)}: today's UCT Relative Strength, byte for byte the registered v5 raw (rollback is safe)`, async () => {
      const reg = await fresh(value)
      expect(reg.rsSplitEnabled()).toBe(false)
      const def = reg.getDefinition('rsLine')
      expect(def.meta.name).toBe('UCT Relative Strength')
      expect(def.placement.target).toBe('pane')
      expect(def.meta.presets.map((p) => p.id)).toContain('classic')
      expect(JSON.stringify(def)).toBe(JSON.stringify(reg.registerDefinitions([reg.RS_LINE_V5_RAW]).defs[0]))
      // U7a: the slim definition's new key is declared legacy here, so a slim-era instance survives the rollback
      expect(def.inputs.find((i) => i.key === 'showAverage')).toMatchObject({ type: 'bool', default: false, legacy: true })
    })
  }

  it("'1': the phone sheet opens UCT RS Line settings — no Preset row, Simple open, Average / New highs / Rating folded", async () => {
    await fresh('1')
    const { default: MobileIndicatorSheet } = await import(SHEET)
    function Harness() {
      const [cs, setCs] = useState({ indicatorInstances: [{ instanceId: 'rs-1', defId: 'rsLine', inputs: {}, hidden: false }] })
      return h(MobileIndicatorSheet, { open: true, onClose: () => {}, cs, onWrite: (next) => setCs(next),
        onBrowseLibrary: () => {}, onOpenSettings: () => {}, initialEditing: { kind: 'study', defId: 'rsLine', instanceId: 'rs-1' } })
    }
    render(h(Harness))
    const editor = screen.getByRole('dialog', { name: 'UCT RS Line settings' })
    expect(editor.querySelector('[data-testid="preset-row"]')).toBeNull()
    // the sheet groups the colour inputs too (no Style tab on the phone), so Line has a head here
    const heads = [...editor.querySelectorAll('[data-group] > button[aria-expanded]')]
    expect(heads.map((b) => b.textContent)).toEqual(['Simple', 'Average', 'Line', 'New highs', 'Rating'])
    expect(heads.map((b) => b.getAttribute('aria-expanded'))).toEqual(['true', 'false', 'false', 'false', 'false'])
    for (const k of ['benchmark', 'showAverage', 'showNewHigh', 'showNewHighBeforePrice', 'showRedDay', 'showRating']) {
      expect(editor.querySelector(`[data-input-key="${k}"]`), k).not.toBeNull()
    }
    for (const k of ['view', 'showMansfield', 'headlineRating', 'anchorDate']) {
      expect(editor.querySelector(`[data-input-key="${k}"]`), `${k} is legacy`).toBeNull()
    }
  })
})
