// app/src/components/chart/legend/chipMenu.preset.test.js
//
// ─── UCT RS Phase 2a visual round, unit VA3 · PRESET ▸ in the chip menu (A6) ─
//
// A definition that declares `meta.presets` gets a **Preset** row right after
// Display in, carrying the current preset's name, and a page listing every
// preset with the current one checked and `Custom` as a state. The rows come
// from the caller's `presetsOf(def)` + `detectPreset` answer, so this pure file
// reads no definition field. The control: RSI and MACD (no presets) get the
// exact rows they always had.
import { describe, it, expect, vi } from 'vitest'
import { chipMenuItems, presetSubmenu, presetLabelOf, CUSTOM_PRESET_LABEL } from './chipMenu'
import * as engineRegistry from '../engine/nativeRegistry'
import { presetsOf, detectPreset } from '../engine/instanceControls'

const handlers = () => ({
  onSettings: vi.fn(), onToggleHidden: vi.fn(), onMove: vi.fn(), onDuplicate: vi.fn(),
  onAlerts: vi.fn(), onAbout: vi.fn(), onRemove: vi.fn(), onPreset: vi.fn(),
})
const RS = engineRegistry.getDefinition('rsLine')
const rsChip = { defId: 'rsLine', plotKey: 'rsLine', instanceId: 'inst:rs', label: 'UCT RS(SPY)', hidden: false }
const keys = (items) => items.filter((i) => !i.separator).map((i) => i.key)

describe('the Preset row', () => {
  const presets = presetsOf(RS)

  it('UCT RS declares presets, and the row sits right after Display in, before the editor', () => {
    expect(presets.length).toBeGreaterThan(1)
    const items = chipMenuItems(rsChip, RS, handlers(), { presets, presetCurrent: 'classic' })
    expect(keys(items).slice(0, 4)).toEqual(['hidden', 'move', 'preset', 'settings'])
    // the separator still sits between Display in / Preset and the editor
    const at = items.findIndex((i) => i.key === 'preset')
    expect(items[at + 1].separator).toBe(true)
  })

  it('the row carries the CURRENT preset name as its trailing label, `Custom` when none matches', () => {
    const on = chipMenuItems(rsChip, RS, handlers(), { presets, presetCurrent: 'classic' }).find((i) => i.key === 'preset')
    expect(on.label).toBe('Preset')
    expect(on.trailing).toBe("Classic (O'Neil)")
    const off = chipMenuItems(rsChip, RS, handlers(), { presets, presetCurrent: null }).find((i) => i.key === 'preset')
    expect(off.trailing).toBe(CUSTOM_PRESET_LABEL)
    expect(presetLabelOf(presets, 'nope')).toBe('Custom')
  })

  it('the page lists every declared preset in order with its origin, then Custom; the current one is checked', () => {
    const page = presetSubmenu(presets, 'trend', vi.fn(), 'inst:rs')
    expect(page.map((r) => r.presetId)).toEqual([...presets.map((p) => p.id), null])
    expect(page.filter((r) => r.checked).map((r) => r.presetId)).toEqual(['trend'])
    expect(page.find((r) => r.presetId === 'classic').origin).toBe('IBD, MarketSurge')
    const custom = page[page.length - 1]
    expect(custom).toMatchObject({ label: 'Custom', custom: true, checked: false })
    expect(custom.onClick, 'Custom is a state, never a choice').toBeUndefined()
  })

  it('nothing matches → Custom is the checked row and no preset is', () => {
    const page = presetSubmenu(presets, null, vi.fn(), 'inst:rs')
    expect(page.filter((r) => r.checked).map((r) => r.key)).toEqual(['preset-custom'])
  })

  it('pressing a preset hands the INSTANCE id and the preset id to the one handler', () => {
    const h = handlers()
    const row = chipMenuItems(rsChip, RS, h, { presets, presetCurrent: 'classic' }).find((i) => i.key === 'preset')
    row.submenu.find((r) => r.presetId === 'stress').onClick()
    expect(h.onPreset).toHaveBeenCalledWith('inst:rs', 'stress')
  })

  it('a fresh UCT RS instance reads as Classic through `detectPreset` (the marker the caller passes in)', () => {
    const inst = { instanceId: 'inst:rs', defId: 'rsLine', inputs: {} }
    const hit = detectPreset(presets, engineRegistry.resolveInputs(RS, {}), { instance: inst, def: RS, cs: { indicatorInstances: [inst] } })
    expect(hit && hit.id).toBe('classic')
  })

  it('no row without the handler or without presets — the caller opts in', () => {
    expect(keys(chipMenuItems(rsChip, RS, { ...handlers(), onPreset: undefined }, { presets }))).not.toContain('preset')
    expect(keys(chipMenuItems(rsChip, RS, handlers(), {}))).not.toContain('preset')
  })
})

describe('⛔ the control — RSI and MACD menus are exactly what they were', () => {
  for (const [id, label] of [['rsi', 'RSI(14)'], ['macd', 'MACD(12, 26, 9)']]) {
    it(`${id}: no presets, so no Preset row, and the shipped row order`, () => {
      const def = engineRegistry.getDefinition(id)
      expect(presetsOf(def)).toEqual([])
      const chip = { defId: id, plotKey: id, instanceId: `i:${id}`, label, hidden: false }
      const items = chipMenuItems(chip, def, handlers(), { presets: presetsOf(def), presetCurrent: null })
      expect(keys(items)).toEqual(['hidden', 'move', 'settings', 'duplicate', 'alerts', 'about', 'remove'])
      expect(items.map((i) => (i.separator ? '—' : i.key)))
        .toEqual(['hidden', 'move', '—', 'settings', 'duplicate', 'alerts', 'about', '—', 'remove'])
    })
  }
})
