// ⭐ GUIDE SYSTEM — Replay Mode's "Pick on chart" (pages/charts/ReplayPanel.jsx data-guide="replay.pick"): the replay date
// picked by clicking a bar. Inventory rows C1-044 and C3-211. The words that name a cut-off, or replay with a click on the
// chart, reach this walkthrough; a typed date ("replay from October 15") and leaving replay stay where they were.
// The browser proof (the ring on Pick on chart, then the chart, then Start replay) is teach.mjs --filter 'C1-044|C3-211'.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { guideFeature } from './guide/registry'
import { slotValues, stepsFor } from './guide/slots'

beforeAll(() => { registerBuiltins() })

const route = (q) => getCapability('guide.show').fast({ raw: q, host: { surface: 'charts' } })
const rowOf = (q) => slotValues(guideFeature('panelAction'), q).panelAct?.id

const REACHES = [
  // the inventory's own words
  'how do I pick the cutoff on the chart',
  'how do I pick the cutoff by clicking the chart',
  // the same ask, other words
  'how do I set the replay cut-off by clicking a bar',
  'show me how to start a replay from a bar I click',
  'how can I click the chart to choose where the replay starts',
  'how do I pick the replay date on the chart',
  'how do I choose my replay start from the chart',
  'walk me through replaying from a candle I tap',
]
const STAYS = [
  ['how do I replay from October 15', 'replay'],
  ['show me how replay works', 'replay'],
  ['how do I exit replay', 'panelAction', 'replayExit'],
  ['how do I stop replay', 'panelAction', 'replayExit'],
]

describe('replay: the date picked on the chart', () => {
  for (const q of REACHES) {
    it(`"${q}" → Picking the replay date on the chart`, () => {
      const r = route(q)
      expect(r?.feature, q).toBe('panelAction')
      expect(rowOf(q), q).toBe('replayPick')
    })
  }
  for (const [q, feature, row] of STAYS) {
    it(`"${q}" stays ${feature}${row ? ` / ${row}` : ''}`, () => {
      expect(route(q)?.feature, q).toBe(feature)
      if (row) expect(rowOf(q), q).toBe(row)
    })
  }

  it('walks Tools → Replay Mode → Pick on chart → the chart → Start replay, each on its own control', () => {
    const q = 'how do I pick the cutoff on the chart'
    const steps = stepsFor(guideFeature('panelAction'), q)
    expect(steps.map(s => s.target)).toEqual(['workspace.tools', 'workspace.tools.replay', 'replay.pick', 'chart.plot', 'replay.start'])
    const [, open, pick, chart, start] = steps
    expect(open.waitFor).toBe('replay.panel')
    // the panel closing is the pick's result; its reopening (with the date) is the chart click's
    expect(pick.waitFor).toEqual({ not: 'replay.panel' })
    expect(pick.retreat).toBe(false)
    expect(chart.waitFor).toBe('replay.panel')
    expect(start.text).toMatch(/Start replay/)
  })

  it('Pick on chart carries its data-guide in the product', () => {
    const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../pages/charts/ReplayPanel.jsx'), 'utf8')
    expect(src).toMatch(/data-guide="replay\.pick"[\s\S]{0,80}onArmPick\(\)[\s\S]{0,40}Pick on chart/)
  })
})
