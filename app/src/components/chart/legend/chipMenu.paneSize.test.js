// app/src/components/chart/legend/chipMenu.paneSize.test.js
//
// ─── RS SPLIT U3 · "Reset pane height" ──────────────────────────────────────
//
// The row is offered only when the instance's host pane carries a stored member
// size (`caps.paneSizeStored`) AND the caller wires `h.onResetPaneSize`. A pane on
// its computed default has nothing to reset, so no row. The click hands back the
// INSTANCE id; the caller resolves the host pane and calls `clearPaneSize`, which
// is "return to automatic" — proved here end to end over a real settings blob.
import { describe, it, expect, vi } from 'vitest'
import { chipMenuItems, paneMenuItems } from './chipMenu'
import * as engineRegistry from '../engine/nativeRegistry'
import { clearPaneSize, setPaneSize, storedPaneSizes } from '../engine/paneSizes'
import { paneOwnerOf } from '../engine/displayTarget'

const RS = engineRegistry.getDefinition('rsLine')
const chip = { defId: 'rsLine', plotKey: 'rsLine', instanceId: 'inst:rsLine:1', label: 'UCT RS(SPY)', hidden: false }
const handlers = (extra = {}) => ({
  onSettings: vi.fn(), onToggleHidden: vi.fn(), onMove: vi.fn(), onDuplicate: vi.fn(),
  onAlerts: vi.fn(), onAbout: vi.fn(), onRemove: vi.fn(), ...extra,
})
const keys = (rows) => rows.filter((r) => !r.separator).map((r) => r.key)

describe('the row is shown only when there is something to reset', () => {
  it('⭐ shown: a stored size on the host pane and a wired handler', () => {
    const rows = chipMenuItems(chip, RS, handlers({ onResetPaneSize: vi.fn() }), { paneSizeStored: true })
    const row = rows.find((r) => r.key === 'pane-size-reset')
    expect(row).toBeTruthy()
    expect(row.label).toBe('Reset pane height')
    expect(row.disabled).toBeUndefined()
    expect(typeof row.onClick).toBe('function')
    // right under Display in, the other placement verb
    expect(keys(rows).indexOf('pane-size-reset')).toBe(keys(rows).indexOf('move') + 1)
  })

  it('⛔ hidden: no stored size', () => {
    const rows = chipMenuItems(chip, RS, handlers({ onResetPaneSize: vi.fn() }), { paneSizeStored: false })
    expect(keys(rows)).not.toContain('pane-size-reset')
    const none = chipMenuItems(chip, RS, handlers({ onResetPaneSize: vi.fn() }), {})
    expect(keys(none)).not.toContain('pane-size-reset')
  })

  it('⛔ hidden: no handler wired, even with a stored size (a read-only mount)', () => {
    const rows = chipMenuItems(chip, RS, handlers(), { paneSizeStored: true })
    expect(keys(rows)).not.toContain('pane-size-reset')
  })

  it('⛔ the pane right-click menu does not carry it — placement verbs stay on the chip', () => {
    const rows = paneMenuItems(chip, RS, handlers({ onResetPaneSize: vi.fn() }), { paneSizeStored: true })
    expect(keys(rows)).not.toContain('pane-size-reset')
  })

  it('the row needs a strict `true`, not a truthy stand-in', () => {
    const rows = chipMenuItems(chip, RS, handlers({ onResetPaneSize: vi.fn() }), { paneSizeStored: 'yes' })
    expect(keys(rows)).not.toContain('pane-size-reset')
  })
})

describe('the click clears the size', () => {
  it('hands back the instance id', () => {
    const h = handlers({ onResetPaneSize: vi.fn() })
    chipMenuItems(chip, RS, h, { paneSizeStored: true }).find((r) => r.key === 'pane-size-reset').onClick()
    expect(h.onResetPaneSize).toHaveBeenCalledWith('inst:rsLine:1')
  })

  it('⭐ end to end over a real blob: the host pane is resolved, its entry is gone, the others stay', () => {
    const inst = { defId: 'rsLine', instanceId: 'inst:rsLine:1', inputs: {} }
    let cs = { indicatorInstances: [inst] }
    cs = setPaneSize(cs, 'inst:rsLine:1', 0.04)       // the floor share the 25 px pane was found at
    cs = setPaneSize(cs, 'price', 0.70)
    const hostKey = paneOwnerOf(inst, cs)
    expect(hostKey).toBe('inst:rsLine:1')             // its own pane
    // what StockChart passes
    const caps = { paneSizeStored: storedPaneSizes(cs)[hostKey] !== undefined }
    expect(caps.paneSizeStored).toBe(true)
    // what StockChart does on the click
    const h = handlers({ onResetPaneSize: (id) => { cs = clearPaneSize(cs, paneOwnerOf(inst, cs)) ; expect(id).toBe('inst:rsLine:1') } })
    chipMenuItems(chip, RS, h, caps).find((r) => r.key === 'pane-size-reset').onClick()
    expect(storedPaneSizes(cs)).toEqual({ price: 0.70 })
    // and now there is nothing to reset, so the row is gone
    const again = { paneSizeStored: storedPaneSizes(cs)[hostKey] !== undefined }
    expect(keys(chipMenuItems(chip, RS, h, again))).not.toContain('pane-size-reset')
  })
})
