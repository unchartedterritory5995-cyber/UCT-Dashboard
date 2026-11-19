// app/src/pages/breadth/drill/drillBoardFidelity.test.js
//
// ⛔⛔ OPENING THE DRILL NEVER REWRITES A MEMBER'S VALUES.
//
// Measured 2026-11-17 on the synthetic account: merely opening the Breadth drill
// rewrote 28 chart colours of a `breadth_drill_board` saved before the drill
// followed the app theme (no `look` marker). That account's colours were the
// DEFAULTS, so following was the feature. A member's board saved in their OWN
// look took the same path and lost it: these rails drive the exact sequence
// `BreadthDrillModal` runs on open (parseBoard → followAppTheme, then the
// render-time re-follow, then serializeBoard) and read the stored blob back.
//
// And the second half: the averages' line styles survive the read-time adoption
// (`maAdoption.js`) through the drill's own open + Remove + save.

import { describe, it, expect } from 'vitest'
import { CHART_DEFAULTS, mergeChartSettings } from '../../../components/chart/chartDefaults'
import { averageSlotView } from '../../../components/chart/maAdoption'
import { removeUnavailable } from '../../../components/chart/engine/instanceControls'
import * as registry from '../../../components/chart/engine/nativeRegistry'
import { WATCHLIST_DEFAULTS, watchlistDefaultsForTheme } from '../../watchlist/watchlistSettings'
import { uctDefaultTabSettings } from '../../charts/chartTabs'
import { parseBoard, serializeBoard, LIST_WIDGET_ID, CHART_WIDGET_ID } from './drillBoardPrefs'
import { followAppTheme, appLook } from './drillTheme'

const clone = (v) => JSON.parse(JSON.stringify(v))

/** What `BreadthDrillModal` does with a stored pref on open, and what it saves. */
function openAndSave(raw, appTheme) {
  const seed = { settings: uctDefaultTabSettings(), scanTemplate: 'scan' }
  const opened = followAppTheme(parseBoard(raw, seed), appTheme, seed.settings)
  const rendered = followAppTheme(opened, appTheme, uctDefaultTabSettings())
  return JSON.parse(serializeBoard(rendered))
}
const chartOf = (b) => b.widgets.find((w) => w.id === CHART_WIDGET_ID).opts
const listOf = (b) => b.widgets.find((w) => w.id === LIST_WIDGET_ID).opts

/** A board as stored before 2026-11-09: no `look`, chart settings in the shape a
 *  pre-adoption save wrote (live `overlays`, no `ovl:` instances). */
function legacyBoard({ chart = clone(CHART_DEFAULTS), list } = {}) {
  return JSON.stringify({
    split: 340,
    widgets: [
      { id: LIST_WIDGET_ID, opts: { source: 'breadthDrill', ...(list ? { settings: list } : {}) } },
      { id: CHART_WIDGET_ID, opts: { settings: chart } },
    ],
  })
}

function setAt(obj, path, value) {
  let o = obj
  for (const k of path.slice(0, -1)) { if (o[k] == null) o[k] = {}; o = o[k] }
  o[path[path.length - 1]] = value
}
const getAt = (obj, path) => path.reduce((v, k) => (v == null ? undefined : v[k]), obj)

// The chart fields the 2026-11-17 open rewrote, read off that diff (not off the
// code under test), plus the two canvas-mode fields a gradient theme writes.
const CHART_LOOK_FIELDS = [
  ['background'], ['bgMode'], ['bgGradient', 'top'], ['textColor'], ['grid', 'color'], ['crosshair', 'color'],
  ['candles', 'upColor'], ['candles', 'downColor'], ['candles', 'upBorder'], ['candles', 'downBorder'],
  ['candles', 'upWick'], ['candles', 'downWick'], ['candles', 'oneColor'],
  ['volume', 'upColor'], ['volume', 'downColor'], ['volume', 'maColor'], ['watermark', 'color'],
  ['header', 'colors', 'dayChangeUp'], ['header', 'colors', 'dayChangeDown'],
  ['header', 'colors', 'legend'], ['header', 'colors', 'title'],
  ['markers', 'earningsBeat'], ['markers', 'earningsMiss'],
  ['prevDayLevels', 'high', 'color'], ['prevDayLevels', 'low', 'color'], ['prevDayLevels', 'close', 'color'],
  ['overlays', 0, 'color'], ['overlays', 1, 'color'], ['overlays', 2, 'color'], ['overlays', 3, 'color'],
]
const LIST_LOOK_FIELDS = ['bg', 'bgMode', 'textColor', 'upColor', 'downColor', 'gridColor', 'tintEnabled', 'tintUp', 'tintDown']
const customFor = (path) => (path[path.length - 1] === 'bgMode' ? 'gradient' : '#13579b')

describe('⛔⛔ A LEGACY board in the member\'s own look survives an open', () => {
  it('every chart and list colour comes back byte-equal, and it stops following', () => {
    const chart = clone(CHART_DEFAULTS)
    chart.background = '#202020'
    chart.candles = { ...chart.candles, upColor: '#00ffaa', downColor: '#aa0055' }
    chart.grid = { ...chart.grid, color: '#303030' }
    chart.overlays = chart.overlays.map((o, i) => ({ ...o, color: ['#111111', '#222222', '#333333', '#444444'][i] }))
    const list = { ...WATCHLIST_DEFAULTS, bg: '#123123', textColor: '#abcdef', upColor: '#00ff00', downColor: '#ff00ff' }

    const saved = openAndSave(legacyBoard({ chart, list }), 'oled')
    expect(chartOf(saved).settings, 'opening re-skinned the member\'s chart').toEqual(chart)
    expect(listOf(saved).settings, 'opening re-skinned the member\'s list').toEqual(list)
    expect(chartOf(saved).lookManual).toBe(true)
    expect(listOf(saved).lookManual).toBe(true)

    // …and an app theme switch later does not take it either.
    const later = openAndSave(JSON.stringify(saved), 'light')
    expect(chartOf(later).settings).toEqual(chart)
    expect(listOf(later).settings).toEqual(list)
  })

  it.each(CHART_LOOK_FIELDS.map((p) => [p.join('.'), p]))('chart: a member\'s %s alone is kept', (_name, path) => {
    const chart = clone(CHART_DEFAULTS)
    setAt(chart, path, customFor(path))
    const saved = openAndSave(legacyBoard({ chart }), 'oled')
    expect(getAt(chartOf(saved).settings, path)).toBe(customFor(path))
    expect(chartOf(saved).settings).toEqual(chart)
  })

  it.each(LIST_LOOK_FIELDS)('list: a member\'s %s alone is kept', (key) => {
    const list = { ...WATCHLIST_DEFAULTS, [key]: key === 'tintEnabled' ? false : customFor([key]) }
    const saved = openAndSave(legacyBoard({ list }), 'oled')
    expect(listOf(saved).settings).toEqual(list)
  })
})

describe('⭐ the other direction: a legacy board still in the DEFAULT look follows the app theme', () => {
  it('chart + list (no list settings) take the app theme, and are marked as following', () => {
    const saved = openAndSave(legacyBoard(), 'oled')
    const look = appLook('oled')
    expect(chartOf(saved).settings.background).toBe(look.bg)
    expect(chartOf(saved).settings.candles.upColor).toBe(look.up)
    expect(chartOf(saved).look.app).toBe('oled')
    expect(chartOf(saved).lookManual).toBeUndefined()
    expect(listOf(saved).settings.upColor).toBe(look.up)
    expect(listOf(saved).look.app).toBe('oled')
  })

  it('a list saved in the dark OR the light defaults (a font change, no colours) follows', () => {
    for (const theme of [null, 'light']) {
      const list = { ...watchlistDefaultsForTheme(theme), fontSize: 13 }
      const saved = openAndSave(legacyBoard({ list }), 'uct:slate')
      expect(listOf(saved).lookManual).toBeUndefined()
      expect(listOf(saved).settings.upColor).toBe(appLook('uct:slate').up)
      expect(listOf(saved).settings.fontSize, 'the font size is the member\'s').toBe(13)
    }
  })

  it('the observed 2026-11-17 shape (defaults + a member indicator + watermark position) follows', () => {
    const chart = { ...clone(CHART_DEFAULTS), preset: 'custom', theme: 'dark', settingsVersion: 2,
      indicatorInstances: [{ instanceId: 'inst:u_x:1', defId: 'u_x', defVersion: 1, inputs: { color: '#c9a84c' }, hidden: false }] }
    const raw = JSON.stringify({ split: 340, widgets: [
      { id: LIST_WIDGET_ID, opts: { source: 'breadthDrill' } },
      { id: CHART_WIDGET_ID, opts: { settings: chart, watermarkPos: { x: 0.2, y: 0.2 } } },
    ] })
    const saved = openAndSave(raw, 'oled')
    expect(chartOf(saved).settings.background).toBe(appLook('oled').bg)
    expect(chartOf(saved).watermarkPos).toEqual({ x: 0.2, y: 0.2 })
    expect(chartOf(saved).settings.indicatorInstances).toEqual(chart.indicatorInstances)
  })
})

describe('⛔ the averages\' line styles survive adoption through the drill (open → Remove → save)', () => {
  it('lineWidth / lineStyle / offset / overlap ride presentation; defaults stay absent and read back as defaults', () => {
    const chart = clone(CHART_DEFAULTS)
    const styles = [
      { lineWidth: 3, lineStyle: 'dashed', offset: 2, onTop: false },
      { lineWidth: 2, lineStyle: 'dotted', offset: -1, onTop: true },
      { lineWidth: 1, lineStyle: 'solid', offset: 0, onTop: false },
      { lineWidth: 4, lineStyle: 'dashed', offset: 5, onTop: false },
    ]
    chart.overlays = chart.overlays.map((o, i) => ({ ...o, ...styles[i] }))
    chart.indicatorInstances = [{ instanceId: 'inst:u_gone:1', defId: 'u_gone', defVersion: 1, inputs: { color: '#c9a84c', lineWidth: 1 }, hidden: false }]
    chart.indicators = { ...chart.indicators, u_gone: { enabled: true } }

    // Open (a default-look board follows the app theme), then the member's Remove
    // of the indicator whose definition is gone, written back the way the chart does.
    const opened = openAndSave(legacyBoard({ chart }), 'oled')
    const cs = mergeChartSettings(chartOf(opened).settings)
    const next = removeUnavailable(cs, 'inst:u_gone:1', registry)
    expect(next).not.toBe(cs)
    const board = { ...opened, widgets: opened.widgets.map((w) => (w.id === CHART_WIDGET_ID ? { ...w, opts: { ...w.opts, settings: next } } : w)) }
    const stored = JSON.parse(serializeBoard(board))

    const view = averageSlotView(mergeChartSettings(chartOf(stored).settings))
    styles.forEach((st, i) => {
      expect(view[i], `slot ${i} lost its average`).not.toBeNull()
      expect(view[i].lineWidth, `slot ${i} lineWidth`).toBe(st.lineWidth)
      expect(view[i].lineStyle, `slot ${i} lineStyle`).toBe(st.lineStyle)
      expect(view[i].offset, `slot ${i} offset`).toBe(st.offset)
      expect(view[i].onTop, `slot ${i} overlap`).toBe(st.onTop)
      expect(view[i].period).toBe(CHART_DEFAULTS.overlays[i].period)
    })
    const inst = (id) => chartOf(stored).settings.indicatorInstances.find((x) => x.instanceId === id)
    expect(inst('ovl:0').presentation).toEqual({ lineWidth: 3, lineStyle: 'dashed', offset: 2 })
    expect(inst('ovl:2'), 'a default-styled average adopts with no presentation').not.toHaveProperty('presentation')
    expect(inst('inst:u_gone:1')).toEqual({ instanceId: 'inst:u_gone:1', deleted: true })
  })
})
