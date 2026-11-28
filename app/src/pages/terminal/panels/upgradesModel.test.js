// UPDG's day model (gap audit P1 + R3): the URL for a day, the typed day, the picker options, and what a dated
// answer says about itself. Pure functions; the panel's own test drives them through the screen.
import { describe, it, expect } from 'vitest'
import { ARG_KINDS, applyArgs } from '../args'
import { variantFor } from '../functions'
import {
  LATEST, UPGRADES_BASE, dayLabel, dayMeta, dayOptions, normUpgradesDate, sourceTag, upgradesDayArgs, upgradesUrl,
} from './upgradesModel'
import { analystActions } from './UpgradesPanel'

describe('upgradesModel', () => {
  it('a day is a real calendar day or nothing', () => {
    expect(normUpgradesDate('2026-11-20')).toBe('2026-11-20')
    expect(normUpgradesDate(' 2026-11-20 ')).toBe('2026-11-20')
    for (const bad of ['2026-02-30', '2026-13-01', '11/20', '2026-11-2', '', null, undefined, 20261120]) {
      expect(normUpgradesDate(bad), String(bad)).toBeNull()
    }
  })

  it('the read is always the whole list: the latest day with full=1, a day with date=', () => {
    expect(UPGRADES_BASE).toBe('/api/analyst-actions')
    expect(upgradesUrl()).toBe('/api/analyst-actions?full=1')
    expect(upgradesUrl(null)).toBe('/api/analyst-actions?full=1')
    expect(upgradesUrl('2026-11-20')).toBe('/api/analyst-actions?date=2026-11-20')
    expect(upgradesUrl('2026-02-30')).toBe('/api/analyst-actions?full=1')   // never a made-up day
  })

  it('the command arguments: the kind token then the day; the latest day writes none', () => {
    expect(upgradesDayArgs(null, null)).toEqual([])
    expect(upgradesDayArgs('DOWN', null)).toEqual(['DOWN'])
    expect(upgradesDayArgs(null, '2026-11-20')).toEqual(['2026-11-20'])
    expect(upgradesDayArgs('PT', '2026-11-20')).toEqual(['PT', '2026-11-20'])
  })

  it('what the command writes, the registry reads back to the same props', () => {
    const { variant } = variantFor('UPDG', false)
    const ctx = { today: '2026-11-28' }
    expect(applyArgs(variant, upgradesDayArgs('DOWN', '2026-11-20'), ctx)).toMatchObject({ props: { kind: 'downgrades', date: '2026-11-20' }, ignored: [] })
    expect(applyArgs(variant, ['11/20'], ctx)).toMatchObject({ props: { date: '2026-11-20' }, ignored: [] })
    // a day ahead has no actions yet: not taken, and said so
    expect(applyArgs(variant, ['2026-12-01'], ctx).ignored).toEqual(['2026-12-01'])
    expect(ARG_KINDS.etDate.parse('2026-11-20', ctx)).toBe(normUpgradesDate('2026-11-20'))
  })

  it('a day reads as a weekday and a date, with no time zone able to move it', () => {
    expect(dayLabel('2026-11-20')).toBe('Fri Nov 20, 2026')
    expect(dayLabel('2026-01-01')).toBe('Thu Jan 1, 2026')
    expect(dayLabel('nope')).toBeNull()
  })

  it('the picker: the latest wire first, then held days newest first; a typed day not held is still shown, marked', () => {
    expect(dayOptions(['2026-11-20', '2026-11-26', 'junk', '2026-11-20'])).toEqual([
      { value: LATEST, label: 'Latest wire' },
      { value: '2026-11-26', label: 'Thu Nov 26, 2026' },
      { value: '2026-11-20', label: 'Fri Nov 20, 2026' },
    ])
    expect(dayOptions(['2026-11-26'], '2026-11-10').map((o) => o.label)).toEqual(['Latest wire', 'Thu Nov 26, 2026', 'Tue Nov 10, 2026 (not held)'])
    expect(dayOptions(undefined)).toEqual([{ value: LATEST, label: 'Latest wire' }])
  })

  it('dayMeta reads the dated answer, and the old capped shape as not full', () => {
    const m = dayMeta({
      full: true, latest: false, held: true, date: '2026-11-20', store_ok: true, dates: ['2026-11-26', 'x'],
      sources: { wire: { held: false }, fmp: { count: 3, may_grow: true, settle_days: 7 } },
      cut: { limit: 50, lists: ['upgrades', 'nonsense'] }, totals: { upgrades: 80 }, retention_days: 400,
    })
    expect(m).toEqual({
      full: true, date: '2026-11-20', latest: false, held: true, wireHeld: false, fmpCount: 3, fmpMayGrow: true,
      fmpSettleDays: 7, storeOk: true, dates: ['2026-11-26'], cut: [{ list: 'upgrades', total: 80 }], cutLimit: 50,
      retentionDays: 400,
    })
    const old = dayMeta({ upgrades: [], summary: {} })
    expect(old.full).toBe(false)
    expect(old.held).toBeNull()
    expect(old.cut).toEqual([])
    for (const junk of [null, undefined, [], 'x']) expect(dayMeta(junk).full).toBe(false)
  })

  it('a row names its source; only the FMP pass is tagged, the wire is the default', () => {
    expect(sourceTag('fmp')).toBe('FMP pass')
    expect(sourceTag('FMP')).toBe('FMP pass')
    expect(sourceTag('wire')).toBeNull()
    expect(sourceTag(undefined)).toBeNull()
    const rows = analystActions({ upgrades: [{ ticker: 'A', action: 'upgrade', source: 'fmp' }, { ticker: 'B', action: 'upgrade', source: 'wire' },
      { ticker: 'C', action: 'upgrade' }, { ticker: 'D', action: 'upgrade', source: 'elsewhere' }] }).rows
    expect(rows.map((r) => r.source)).toEqual(['fmp', 'wire', null, null])
  })
})
