import { describe, it, expect, beforeEach } from 'vitest'
import { noteTfPress, habitualTfs, __resetTfHabitForTests, TF_HABIT_KEY, TF_HABIT_HALF_LIFE_MS } from './tfHabit'

const BAR = ['1', '5', '15', '30', '45', '60', '120', '240', 'D', 'W', 'M']

describe('tfHabit', () => {
  let t
  beforeEach(() => { t = 1_800_000_000_000; __resetTfHabitForTests(() => t) })

  it('names the timeframes a member went to from here, most often first', () => {
    noteTfPress('D', 'W'); noteTfPress('D', '240'); noteTfPress('D', '240'); noteTfPress('D', '5')
    expect(habitualTfs('D', { k: 2 })).toEqual(['240', '5'])   // 240 twice; W and 5 once each: the tie goes to the shorter
  })

  it('never names the timeframe it is asked from', () => {
    noteTfPress('D', 'W')
    expect(habitualTfs('W', { k: 3, available: BAR })).not.toContain('W')
    expect(habitualTfs('D', { k: 3, available: BAR })).not.toContain('D')
  })

  it('with no history, the bar neighbours: the next longer, then the next shorter', () => {
    expect(habitualTfs('D', { k: 2, available: BAR })).toEqual(['W', '240'])
    expect(habitualTfs('1', { k: 2, available: BAR })).toEqual(['5', '15'])
    expect(habitualTfs('M', { k: 2, available: BAR })).toEqual(['W', 'D'])
    // a timeframe not on the bar is placed by its duration
    expect(habitualTfs('65', { k: 2, available: BAR })).toEqual(['120', '60'])
  })

  it('history first, the bar fills the rest, and only codes on the bar', () => {
    noteTfPress('D', '45'); noteTfPress('D', '2D')
    expect(habitualTfs('D', { k: 2, available: BAR })).toEqual(['45', 'W'])
  })

  it('old presses fade (a 14-day half-life): a recent habit beats an old one', () => {
    for (let i = 0; i < 3; i++) noteTfPress('D', 'W')
    t += 5 * TF_HABIT_HALF_LIFE_MS
    noteTfPress('D', '60')
    expect(habitualTfs('D', { k: 1 })).toEqual(['60'])
  })

  it('persists across a reload of the module state (localStorage)', () => {
    noteTfPress('15', '240')
    expect(JSON.parse(localStorage.getItem(TF_HABIT_KEY))['15']['240'].w).toBe(1)
  })

  it('ignores empty and same-timeframe presses', () => {
    noteTfPress('D', 'D'); noteTfPress('', 'W'); noteTfPress('D', null)
    expect(habitualTfs('D', { k: 2 })).toEqual([])
  })
})
