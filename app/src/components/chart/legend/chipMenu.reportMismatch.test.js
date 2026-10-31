// Support loop A3 — the chip menu's "Doesn't match TradingView?" row
// (`docs/pine/support-loop/PHASE-A.md`). The caller decides (`caps.reportMismatch`
// = a Pine translation AND the report flag on); the row exists only then.
import { describe, it, expect, vi } from 'vitest'
import { chipMenuItems } from './chipMenu'
import { isPineOriginDoc } from '../engine/otherSymbols'

const chip = { instanceId: 'i1', defId: 'u_abc', label: 'X', hidden: false }
const h = () => ({
  onSettings: vi.fn(), onToggleHidden: vi.fn(), onMove: vi.fn(), onDuplicate: vi.fn(),
  onAlerts: vi.fn(), onAbout: vi.fn(), onRemove: vi.fn(), onReportMismatch: vi.fn(),
})
const pineDef = { meta: { name: 'Mine', recurrenceOrigin: 'pine' } }

describe('the report row', () => {
  it('is absent unless the caller says so', () => {
    expect(chipMenuItems(chip, pineDef, h(), {}).some((r) => r.key === 'report-mismatch')).toBe(false)
    expect(chipMenuItems(chip, pineDef, h(), { reportMismatch: false }).some((r) => r.key === 'report-mismatch')).toBe(false)
  })

  it('is present when the caller says so, and fires the handler', () => {
    const handlers = h()
    const rows = chipMenuItems(chip, pineDef, handlers, { reportMismatch: true })
    const row = rows.find((r) => r.key === 'report-mismatch')
    expect(row.label).toBe('Doesn’t match TradingView?')
    row.onClick()
    expect(handlers.onReportMismatch).toHaveBeenCalledWith('i1')
    // it sits before Delete, never after the destructive rule
    expect(rows.findIndex((r) => r.key === 'report-mismatch')).toBeLessThan(rows.findIndex((r) => r.key === 'remove'))
  })

  it('the caller’s predicate is the Pine-origin reader the engine already uses', () => {
    expect(isPineOriginDoc(pineDef)).toBe(true)
    expect(isPineOriginDoc({ meta: { name: 'RSI' } })).toBe(false)
  })
})
