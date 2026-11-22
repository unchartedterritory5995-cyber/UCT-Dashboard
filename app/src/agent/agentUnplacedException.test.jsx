// head re-merged onto fecbf19fb6 (engine move inside spatialCheck's closure); this line triggers the Agent CI push run
// An exception the readers cannot PLACE but whose words name a CHART is UNPLACED — the plan is asked, never applied — not
// silently "nothing" (AUDIT #1143 follow-up 2: the chart the member excluded was not protected; live on master fc564e7096).
// Own phrasings. Controls: an exception that is a value or a time ("except on Fridays", "except volume", "except the 50 day",
// "excluding after-hours") still excludes nothing; placed exceptions (the click, a named chart) are exactly as before.
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans through the real panel.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { excludedCharts, UNPLACED } from './spatialCheck'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

const B = [{ ref: 'a', symbol: 'SPY', position: 'top-left' }, { ref: 'b', symbol: 'QQQ', position: 'top-right' },
  { ref: 'c', symbol: 'NVDA', position: 'bottom-left' }, { ref: 'd', symbol: 'AMD', position: 'bottom-right' }]
const ex = (t) => [...excludedCharts(t, B, 'a')]

const UNPLACEABLE = [
  'everything except the one next to mine flips to weekly',
  "make every chart weekly except this one's neighbour",
  'every chart to weekly other than the chart I opened',
  'switch all of them to weekly apart from the one beside my chart',
  "make everything weekly excluding the cell to my chart's right",
  'turn every chart weekly except the pane in the corner by the news',
]
const NOT_A_CHART = [
  'make everything weekly except on Fridays', 'make every chart weekly except volume', 'show the 20 on every chart except the 50 day',
  'make everything weekly excluding after-hours', 'make all of them log except during earnings week', 'every chart to weekly other than that, thanks',
]
const PLACED = [['make everything weekly except mine', ['a']], ['make everything weekly except the QQQ one', ['b']],
  ['every chart weekly but the NVDA chart', ['c']], ['make all charts weekly apart from the bottom right one', ['d']]]

describe('reader: an unplaceable chart exception is UNPLACED; a value / time exception is nothing', () => {
  it.each(UNPLACEABLE.map(t => [t]))('"%s" → UNPLACED (never nothing)', (t) => {
    expect(ex(t)).toContain(UNPLACED)
  })
  it.each(NOT_A_CHART.map(t => [t]))('control, not a chart: "%s" → nothing', (t) => {
    expect(ex(t)).toEqual([])
  })
  it.each(PLACED)('control, placed: "%s" → exactly that chart', (t, refs) => {
    expect(ex(t)).toEqual(refs)
  })
})

// ── end to end: with the plan on every chart, nothing is applied for an unplaceable exception (asked); a value exception runs ──
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const W = 8, H = 10
const IDS = [['TL', 0, 0], ['TR', 0, 1], ['BL', 1, 0], ['BR', 1, 1]]
const SYMS = ['SPY', 'QQQ', 'NVDA', 'AMD']
const transcript = () => screen.getByTestId('agent-transcript').textContent
const mount = (sel) => {
  const widgets = IDS.map(([id, r, c]) => ({ id, x: c * W, y: r * H, w: W, h: H, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, SYMS[i]])), { decorate: (s) => ({ ...s, label: `Chart (${s.ref})` }) })
  p.select(sel)
  return m
}
const changed = (b) => b.state.widgets.filter(x => (x.opts?.tf || 'D') === 'W').map(x => x.id).sort()
const planAll = (body) => p.env('apply', IDS.map(([id]) => ({ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } })))

describe('panel: a plan on every chart is never applied when the exception cannot be placed', () => {
  it.each(UNPLACEABLE.map(t => [t]))('"%s": nothing applied', async (t) => {
    const m = mount('TL')
    p.st.envelopes.push(planAll)
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([])
  }, 60000)
  it('control: "make every chart weekly except on Fridays" — the plan on every chart runs', async () => {
    const m = mount('TL')
    p.st.envelopes.push(planAll)
    await m.say('make every chart weekly except on Fridays')
    expect(changed(m.board), transcript()).toEqual(['BL', 'BR', 'TL', 'TR'])
  }, 60000)
})

// a LINE relation is not an exception: "the same column but the other row" / "the same row but a different column" excludes nothing
describe('control: a line relation with "but" is never read as an exception', () => {
  it.each([['make the one in the same column but the other row weekly'], ['make the chart in the same row but a different column weekly']])('"%s" → nothing excluded', (t) => {
    expect(ex(t)).toEqual([])
  })
})

// (AUDIT #1148) a possessive 's that is NOT a chart — a company, a day, a session — stays nothing; a chart's 's is UNPLACED
describe('control: a non-chart possessive is never read as a chart exception', () => {
  it.each([["make every chart weekly except Apple's earnings day"], ["make everything log other than Friday's close"],
    ["switch all of them to weekly except the Fed's meeting week"], ["every chart to weekly excluding today's open"]])('"%s" → nothing', (t) => {
    expect(ex(t)).toEqual([])
  })
  it.each([["make every chart weekly except SPY's neighbour"], ["switch everything to weekly apart from the chart's twin"]])('a chart\'s \'s: "%s" → UNPLACED', (t) => {
    expect(ex(t)).toContain(UNPLACED)
  })
})
