// THE FOURTEEN HOUSE INDICATORS, AS SETTINGS. Every UCT indicator exposes its lengths, levels and
// multiples and nothing structural; and every setting it shows can actually be changed.
import { describe, it, expect } from 'vitest'
import HOUSE from '../../house/houseIndicators.json'
import { openAuthoringState } from './index'
import { settingsOf } from './derivedSettings'
import { settingTurn } from './authoringSession'

const GATE = { tf: 'D', symbol: 'AAPL' }
const items = HOUSE.indicators

describe('the house set', () => {
  it('twelve of the fourteen have something to tune; the two that are pure patterns have no number', () => {
    const counts = Object.fromEntries(items.map((it) => [it.slug, settingsOf(it.definition).length]))
    // the previous week's high and low, and inside / outside bars: nothing in them is a quantity
    expect(counts.previous_week_high_low).toBe(0)
    expect(counts.inside_outside_bars).toBe(0)
    expect(Object.values(counts).filter((n) => n > 0)).toHaveLength(items.length - 2)
    expect(counts).toMatchObject({ distribution_day_count: 2, relative_strength_vs_spy: 1, follow_through_day: 4, flat_base: 8 })
  })

  it('no setting is a colour state’s index, a percent’s 100, or a neighbouring bar', () => {
    for (const item of items) {
      for (const s of settingsOf(item.definition)) {
        expect(s.role === 'number' && Number.isInteger(s.value) && s.value <= 9, `${item.slug}: ${s.captionFull}`).toBe(false)
        expect(s.value === 100 && s.role !== 'length', `${item.slug}: ${s.captionFull}`).toBe(false)
        expect(s.role === 'bars back' && s.value <= 2, `${item.slug}: ${s.captionFull}`).toBe(false)
        expect(s.caption).not.toMatch(/#|\?:/)
      }
    }
  })

  it.each(items.map((it) => [it.slug, it]))('%s: every setting it shows can be changed, in one step', (_slug, item) => {
    const before = openAuthoringState(item.definition)
    for (const s of settingsOf(before.working)) {
      const next = s.whole ? s.value + 1 : (s.negated ? s.value - 0.5 : Number((s.value * 1.1 + 0.01).toFixed(4)))
      const out = settingTurn(before, s, next, { gateCtx: GATE })
      expect(out.ok, `${s.captionFull} -> ${next}: ${out.message || JSON.stringify(out.errors || out.stale)}`).toBe(true)
      expect(out.state.revision).toBe(before.revision + 1)
      const after = settingsOf(out.state.working)
      expect(after.some((a) => a.value === next && a.role === s.role && a.slots.length >= s.slots.length), s.captionFull).toBe(true)
    }
  })
})
