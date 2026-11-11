// app/src/components/chart/legend/chipMenu.pane.test.js
//
// ─── B9 (2026-11-07) · the rows a right-click inside an indicator PANE leads with ─
//
// `paneMenuItems` picks the legend chip's own rows (`chipMenuItems`) in the
// order the decision record names: `<name> settings…`, `Preset` when the
// definition declares presets, Hide, `Add alert…`, `About <name>`. The rows are
// the chip's, so each handler is the chip's handler, called with the INSTANCE id.
import { describe, it, expect, vi } from 'vitest'
import { paneMenuItems, chipMenuItems, PANE_MENU_KEYS } from './chipMenu'
import * as engineRegistry from '../engine/nativeRegistry'
import { presetsOf } from '../engine/instanceControls'

const handlers = () => ({
  onSettings: vi.fn(), onToggleHidden: vi.fn(), onAlerts: vi.fn(), onAbout: vi.fn(), onPreset: vi.fn(),
})
const RS = engineRegistry.getDefinition('rsLine')
const RSI = engineRegistry.getDefinition('rsi')
const rsChip = { defId: 'rsLine', plotKey: 'rsLine', instanceId: 'inst:rs', label: 'UCT RS(SPY)', hidden: false }
const rsiChip = { defId: 'rsi', plotKey: 'rsi', instanceId: 'inst:rsi', label: 'RSI(14)', hidden: false }

describe('paneMenuItems', () => {
  it('a definition with presets leads with settings, Preset, Hide, Add alert, About, in that order', () => {
    const presets = presetsOf(RS)
    expect(presets.length, 'UCT RS declares no presets: this case asserts on nothing').toBeGreaterThan(1)
    const rows = paneMenuItems(rsChip, RS, handlers(), { paneName: 'UCT RS', presets, presetCurrent: 'classic' })
    expect(rows.map((r) => r.key)).toEqual(['settings', 'preset', 'hidden', 'alerts', 'about'])
    expect(rows.map((r) => r.label)).toEqual(['UCT RS settings…', 'Preset', 'Hide', 'Add alert…', 'About UCT Relative Strength'])
    expect(rows.find((r) => r.key === 'preset').trailing).toBe("Classic (O'Neil)")
    expect(rows.some((r) => r.separator), 'a pane block carries no separators of its own').toBe(false)
  })

  it('no presets → no Preset row; every other row is still there', () => {
    const rows = paneMenuItems(rsiChip, RSI, handlers(), { paneName: 'RSI', presets: presetsOf(RSI) })
    expect(rows.map((r) => r.key)).toEqual(['settings', 'hidden', 'alerts', 'about'])
    expect(rows[0].label).toBe('RSI settings…')
    expect(rows.at(-1).label).toBe('About Relative Strength Index')
  })

  it('leaves the placement and destructive verbs on the chip (Display in, Duplicate, Delete)', () => {
    const keys = paneMenuItems(rsiChip, RSI, handlers(), { paneName: 'RSI' }).map((r) => r.key)
    for (const k of ['move', 'duplicate', 'remove', 'custom-copy']) expect(keys).not.toContain(k)
    expect(PANE_MENU_KEYS).toEqual(['settings', 'preset', 'hidden', 'alerts', 'about'])
  })

  it('every row is the chip row: same handler, called with the instance id', () => {
    const h = handlers()
    const rows = paneMenuItems(rsChip, RS, h, { paneName: 'UCT RS', presets: presetsOf(RS), presetCurrent: null })
    const by = (k) => rows.find((r) => r.key === k)
    by('settings').onClick(); expect(h.onSettings).toHaveBeenCalledWith('inst:rs')
    by('hidden').onClick(); expect(h.onToggleHidden).toHaveBeenCalledWith('inst:rs')
    by('alerts').onClick(); expect(h.onAlerts).toHaveBeenCalledWith('inst:rs')
    by('about').onClick(); expect(h.onAbout).toHaveBeenCalledWith('inst:rs')
    by('preset').submenu.find((s) => s.presetId === 'phase').onClick()
    expect(h.onPreset).toHaveBeenCalledWith('inst:rs', 'phase')
    // …and apart from the editor's label, the rows ARE the chip menu's rows.
    const chip = chipMenuItems(rsChip, RS, h, { presets: presetsOf(RS), presetCurrent: null })
    for (const k of ['preset', 'hidden', 'alerts', 'about']) {
      expect(by(k).label, k).toBe(chip.find((r) => r.key === k).label)
      expect(by(k).icon, k).toBe(chip.find((r) => r.key === k).icon)
    }
  })

  it('a hidden instance offers Show, and a refused alert row keeps its reason and no handler', () => {
    const rows = paneMenuItems({ ...rsiChip, hidden: true }, RSI, handlers(),
      { paneName: 'RSI', alertsRefusal: 'this chart has no alert form (read-only mount)' })
    expect(rows.find((r) => r.key === 'hidden').label).toBe('Show')
    const alert = rows.find((r) => r.key === 'alerts')
    expect(alert.disabled).toBe('this chart has no alert form (read-only mount)')
    expect(alert.onClick).toBeUndefined()
  })

  it('with no paneName the editor row falls back to the chip label', () => {
    expect(paneMenuItems(rsiChip, RSI, handlers())[0].label).toBe('RSI(14) settings…')
  })
})
