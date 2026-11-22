// app/src/components/chart/legend/legendRows.test.js
//
// One legend row per NAME an indicator prints. Owner, 2026-11-16: Uncharted Clouds (2 drawn
// averages + 21 hidden fill anchors) printed 22 rows that all read "Uncharted Clouds".
import { describe, it, expect } from 'vitest'
import { legendRows, LEGEND_ROW_VALUES_MAX } from './legendRows'

const chip = (instanceId, plotKey, label, extra = {}) => ({
  defId: 'd', instanceId, plotKey, label, color: '#fff', decimals: 2, value: 1, hidden: false, text: `${label} 1.00`, ...extra,
})

// The owner's chart: two engine averages, then the script.
const clouds = () => [
  chip('ema9', 'value', 'EMA 9'),
  chip('ema20', 'value', 'EMA 20'),
  chip('uc', 'p0', 'Uncharted Clouds', { value: 433.92 }),
  chip('uc', 'p1', 'Uncharted Clouds', { value: null, hidden: true }),
  chip('uc', 'p2', 'Uncharted Clouds', { value: 451.49 }),
  ...Array.from({ length: 20 }, (_, i) => chip('uc', `p${3 + i}`, 'Uncharted Clouds', { value: null, hidden: true })),
]

describe('legendRows', () => {
  it('a script whose plots share one name prints ONE row, carrying every drawn value', () => {
    const rows = legendRows(clouds())
    expect(rows.map((r) => r.chip.label)).toEqual(['EMA 9', 'EMA 20', 'Uncharted Clouds'])
    const uc = rows[2]
    expect(uc.chip.plotKey).toBe('p0')
    expect(uc.chip.hidden).toBe(false)
    expect(uc.more.map((c) => c.plotKey)).toEqual(['p2'])
  })

  it('the hidden plots of a drawn indicator get no row and no value', () => {
    const rows = legendRows(clouds())
    const keys = rows.flatMap((r) => [r.chip, ...r.more]).map((c) => c.plotKey)
    expect(keys.filter((k) => /^p/.test(k))).toEqual(['p0', 'p2'])
  })

  it('a fully hidden indicator keeps exactly one row, hidden: the way back', () => {
    const all = clouds().map((c) => (c.instanceId === 'uc' ? { ...c, hidden: true, value: null } : c))
    const rows = legendRows(all)
    expect(rows).toHaveLength(3)
    expect(rows[2].chip.hidden).toBe(true)
    expect(rows[2].chip.plotKey).toBe('p0')
    expect(rows[2].more).toEqual([])
  })

  it('the row is led by the first DRAWN plot when the first declared one is hidden', () => {
    const rows = legendRows([
      chip('x', 'a', 'Script', { hidden: true, value: null }),
      chip('x', 'b', 'Script', { value: 5 }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].chip.plotKey).toBe('b')
    expect(rows[0].more).toEqual([])
  })

  it('a drawn plot that computed nothing does not lead the row while a sibling has a value', () => {
    const rows = legendRows([
      chip('x', 'a', 'Script', { value: null, computed: false }),
      chip('x', 'b', 'Script', { value: 5, computed: true }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].chip.plotKey).toBe('b')
    expect(rows[0].more.map((c) => c.plotKey)).toEqual(['a'])
    // …and when NONE computed, the first drawn plot leads and says so
    const none = legendRows([
      chip('x', 'a', 'Script', { value: null, computed: false }),
      chip('x', 'b', 'Script', { value: null, computed: false }),
    ])
    expect(none[0].chip.plotKey).toBe('a')
  })

  it('plots that print DIFFERENT names stay separate rows (MACD and its signal)', () => {
    const input = [chip('m', 'macd', 'MACD'), chip('m', 'signal', 'SIG')]
    const rows = legendRows(input)
    expect(rows.map((r) => r.chip)).toEqual(input)
    expect(rows.every((r) => r.more.length === 0)).toBe(true)
  })

  it('two copies of one indicator are never merged into each other', () => {
    const rows = legendRows([chip('a', 'value', 'RSI(14)'), chip('b', 'value', 'RSI(14)')])
    expect(rows).toHaveLength(2)
  })

  it('a chip with no instance (nothing to group on) passes through', () => {
    const loose = { ...chip(null, 'value', 'Loose') }
    expect(legendRows([loose, loose])).toHaveLength(2)
  })

  it('keeps the order the chips arrived in, by each row\'s first plot', () => {
    const rows = legendRows([
      chip('x', 'a', 'Script'), chip('m', 'macd', 'MACD'), chip('x', 'b', 'Script'), chip('m', 'signal', 'SIG'),
    ])
    expect(rows.map((r) => r.chip.label)).toEqual(['Script', 'MACD', 'SIG'])
    expect(rows[0].more.map((c) => c.plotKey)).toEqual(['b'])
  })

  it('tolerates a missing list', () => {
    expect(legendRows(null)).toEqual([])
    expect(legendRows(undefined)).toEqual([])
  })

  it('states how many values one row may print', () => {
    expect(LEGEND_ROW_VALUES_MAX).toBeGreaterThanOrEqual(2)
  })
})
