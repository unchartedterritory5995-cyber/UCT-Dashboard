// P1 info — the legend menu's VALUE row ("Value in header", a ✓ while on — UCT Signature).
import { describe, it, expect, vi } from 'vitest'
import { chipMenuItems } from './chipMenu'

const chip = { instanceId: 'inst:rsi:1', plotKey: 'rsi', defId: 'rsi', label: 'RSI 14' }
const h = { onSettings() {}, onToggleHidden() {}, onMove() {}, onDuplicate() {}, onAlerts() {}, onAbout() {}, onRemove() {} }

describe('chipMenuItems — info value row', () => {
  it('absent unless the caller wires onInfoValue (every existing menu is unchanged)', () => {
    expect(chipMenuItems(chip, null, h).some((r) => r.key === 'info-value')).toBe(false)
  })
  it('adds by instanceId + plotKey; toggles to remove when present; a refusal is a disabled row with no handler', () => {
    const onInfoValue = vi.fn()
    const row = chipMenuItems(chip, null, { ...h, onInfoValue }).find((r) => r.key === 'info-value')
    expect(row.label).toBe('Value in header')
    expect(row.checked).toBe(false)
    row.onClick()
    expect(onInfoValue).toHaveBeenCalledWith('inst:rsi:1', 'rsi', false)
    const on = chipMenuItems(chip, null, { ...h, onInfoValue }, { infoValueOn: true }).find((r) => r.key === 'info-value')
    expect(on.label, 'one row, one label: the ✓ says it is on').toBe('Value in header')
    expect(on.checked).toBe(true)
    on.onClick()
    expect(onInfoValue).toHaveBeenLastCalledWith('inst:rsi:1', 'rsi', true)
    const refused = chipMenuItems(chip, null, { ...h, onInfoValue }, { infoValueRefusal: 'nope' }).find((r) => r.key === 'info-value')
    expect(refused.disabled).toBe('nope')
    expect(refused.onClick).toBeUndefined()
    expect(refused.checked).toBe(false)
  })
})
