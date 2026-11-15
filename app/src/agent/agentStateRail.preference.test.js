// #1234 (chartShare / Shift+T): the chart's light/dark palette is a member PREFERENCE on the state rail — its change is an
// OVERWRITE, licensed only by its own words; an additive request never licenses it. (Pure: the rail over a planned chart patch.)
// Evidence: LOCAL (unit) — stateEffects / stateRailRefusal over synthetic plans.
import { describe, it, expect } from 'vitest'
import { stateEffects, stateRailRefusal, CLASS } from './stateRail'
import { settingDescriptor } from '../components/chart/chartSettingsDescriptors'

const planOf = (beforeTheme, settings) => ({ ok: true, plans: [{ kind: 'chart', ref: 'c1', before: { cs: beforeTheme == null ? { grid: { visible: true } } : { theme: beforeTheme } }, after: {}, patch: { settings } }] })
const fx = (plan) => stateEffects(plan).map(e => `${e.state}:${e.type}`)
const REFUSED = /^I didn’t change anything/

describe('the light/dark palette is a preference the state rail reads', () => {
  it('dark → light (and light → dark) is a preference overwrite; an unchanged palette is nothing', () => {
    expect(fx(planOf('dark', { theme: 'light', preset: 'custom' }))).toEqual(['preference:overwrite'])
    expect(fx(planOf('light', { theme: 'dark', preset: 'custom' }))).toEqual(['preference:overwrite'])
    // a chart that never set it is dark (CHART_DEFAULTS.theme): a blob with no `theme` changes nothing
    expect(fx(planOf(null, { grid: { visible: false } }))).toEqual([])
    expect(fx(planOf('light', { theme: 'light', grid: { visible: false } }))).toEqual([])
    // a blob that drops `theme` on a light chart puts it back on dark: that IS a change
    expect(fx(planOf('light', { grid: { visible: true } }))).toEqual(['preference:overwrite'])
  })
  it.each(['add a 20 EMA', 'add an RSI to this chart', 'also MSFT', 'add a light grid', 'add AAPL, and remove the indicators', 'do it'])(
    'words that do not ask for the palette never license it: "%s"', (w) => {
      expect(stateRailRefusal(planOf('dark', { theme: 'light' }), { words: w })).toMatch(REFUSED)
    })
  it.each(['make this chart light', 'make this chart light mode', 'switch this chart to the light palette', 'put the chart on the light palette like shift+t',
    'add a 20 EMA, and change the palette to light', 'add a 20 EMA and set the chart to light mode'])(
    'its own words license it: "%s"', (w) => {
      expect(stateRailRefusal(planOf('dark', { theme: 'light' }), { words: w })).toBe(null)
    })
  it('a negated palette clause licenses nothing', () => {
    expect(stateRailRefusal(planOf('dark', { theme: 'light' }), { words: "add a 20 EMA, but don't switch to the light palette" })).toMatch(REFUSED)
  })
  it('a UCT chart THEME is not the palette: "theme" never names this class (chart.applyTheme never writes `theme`)', () => {
    for (const w of ['apply the Sunrise theme', 'use the Midnight theme on this chart', 'switch themes']) expect(CLASS.preference.test(w), w).toBe(false)
    for (const w of ['the light palette', 'dark mode', 'press shift+t']) expect(CLASS.preference.test(w), w).toBe(true)
  })
  it('ONE source (AUDIT #1234): the palette class is the theme descriptor\'s own options and words (#1059\'s two folded in)', () => {
    const d = settingDescriptor('theme')
    expect(d.words).toEqual(expect.arrayContaining(['light palette', 'dark palette']))
    for (const w of [...d.options, ...d.words]) expect(CLASS.preference.test(`use the ${w}`), w).toBe(true)
  })
  it('naming the OTHER palette does not license this change ("dark mode" never licenses dark → light)', () => {
    expect(stateRailRefusal(planOf('dark', { theme: 'light' }), { words: 'add a 20 EMA in dark mode' })).toMatch(REFUSED)
  })
})
