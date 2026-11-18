// ⭐ GUIDE SYSTEM — the action families (guide/actions.js): the words reach the right family and the right row, a row's own
// steps are what the walkthrough walks, and a family never takes words that belong to a feature ahead of it in meaning.
// The controls themselves are railed by agentGuideTargets.test.js and proved in a real browser (teach-status.md).
import { describe, it, expect, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { guideFeature, GUIDE_IDS } from './guide/registry'
import { slotValues, stepsFor, SLOTS } from './guide/slots'
import { ACTION_FAMILIES } from './guide/actions'

beforeAll(() => { registerBuiltins() })

const route = (q) => getCapability('guide.show').fast({ raw: q, host: { surface: 'charts' } })
const rowOf = (fam, q) => slotValues(guideFeature(fam.id), q)[fam.slot]?.id

const CASES = [
  ['how do I reset the view', 'chartMenu', 'reset'],
  ['how do I change the volume settings', 'chartMenu', 'volumeOptions'],
  ['how do I clear all my drawings', 'chartMenu', 'clearDrawings'],
  ['how do I resize a pane', 'chartView', 'paneResize'],
  ['how do I switch to log scale', 'chartView', 'logScale'],
  ['how do I hide volume', 'chartView', 'volume'],
  ['how do I hide the RSI', 'legendChip', 'hide'],
  ['how do I delete the RSI indicator', 'legendChip', 'remove'],
  ['how do I make a custom copy of the RSI', 'legendChip', 'customCopy'],
  ['how do I remove a compare symbol', 'compareAction', 'remove'],
  ['how do I clear all comparisons', 'compareAction', 'clear'],
  ['how do I star a timeframe', 'panelAction', 'tfStar'],
  ['how do I exit replay', 'panelAction', 'replayExit'],
  ['how do I remove a ticker from my watchlist', 'watchlistAction', 'remove'],
  ['how do I sort my watchlist', 'watchlistAction', 'sort'],
  ['how do I rename a layout', 'layoutAction', 'rename'],
  ['how do I close a chart tab', 'tabAction', 'closeChart'],
  // ⚰️ 'how do I filter catalysts' → newsFilter: withheld while News & Catalysts is a hidden widget (owner 2026-11-13).
  ['how do I lock a drawing', 'drawingEdit', 'lock'],
  ['how do I delete a drawing', 'drawingEdit', 'delete'],
  ['how do I create my own indicator', 'indicatorManage', 'create'],
  ['how do I exit multi chart', 'gridAction', 'exit'],
  ['how do I exit groups in the grid', 'gridAction', 'groupExit'],
  ['how do I open the grid settings', 'gridAction', 'cellSettings'],
  ['how do I change one cell style in the grid', 'gridAction', 'cellStyle'],
  ['how do I paste a pine script', 'builderAction', 'pine'],
  ['how do I enter a formula', 'builderAction', 'enter'],
  ['how do I add company info', 'indicatorManage', 'company'],
  ['how do I collapse the company panel', 'dockAction', 'collapse'],
  ['how do I load a stock from the earnings list', 'widgetAction', 'calRow'],
  ['how do I delete an indicator alert', 'alertAction', 'delete'],
  ['how do I set an alert on another timeframe', 'alertAction', 'timeframe'],
  ['how do I view holdings of an etf', 'dockAction', 'holdings'],
  ['how do I delete an alert', 'widgetAction', 'alertsDelete'],
]
// words a family must leave alone: each already has its own walkthrough
const LEFT_ALONE = [
  ['show me how to create a watchlist', 'watchlistCreate'],
  ['walk me through creating a watchlist', 'watchlistCreate'],
  ['show me where to add an indicator', 'indicators'],
  ['show me how the color of my 50 SMA gets changed', 'indicatorColor'],
  ['walk me through recoloring the VWAP line', 'indicatorColor'],
  ['where are the settings for the breadth widget', 'widgetSettings'],
  ['how do I hide the grid lines', 'chartSetting'],
  ['how do I hide all my drawings', 'hideDrawings'],
  ['how do I draw a trendline', 'drawing'],
  ['how do I compare symbols', 'compare'],
]

describe('the families', () => {
  it.each(CASES)('%s → %s / %s', (q, feature, row) => {
    const got = route(q)
    expect(got?.feature).toBe(feature)
    expect(rowOf(ACTION_FAMILIES.find(f => f.id === feature), got.detail)).toBe(row)
  })
  it.each(LEFT_ALONE)('%s stays %s', (q, feature) => { expect(route(q)?.feature).toBe(feature) })
  it('every family is offered to the model as a walkthrough (the guide.show enum reads the registry)', () => {
    for (const f of ACTION_FAMILIES) expect(GUIDE_IDS).toContain(f.id)
  })
  it('a family a model asks for with no usable words still has a walkthrough', () => {
    for (const f of ACTION_FAMILIES) expect(stepsFor(guideFeature(f.id), '').length, f.id).toBeGreaterThan(0)
  })
})

describe('a row walks its own steps', () => {
  it('stepsFor takes the chosen row’s steps, and only those', () => {
    const steps = stepsFor(guideFeature('watchlistAction'), 'how do I sort my watchlist')
    expect(steps.some(s => s.each)).toBe(false)
    expect(steps[steps.length - 1].target).toEqual({ widgetType: 'watchlist', aria: 'Sort by Symbol' })
  })
  it('a chip step names the indicator asked about, and drops the words when none was', () => {
    const named = stepsFor(guideFeature('legendChip'), 'how do I hide the RSI')
    expect(named[0].text).toMatch(/RSI/)
    expect(JSON.stringify(named)).not.toMatch(/\{ind\./)
    const none = stepsFor(guideFeature('legendChip'), 'how do I hide an indicator')
    expect(JSON.stringify(none)).not.toMatch(/\{ind\./)
  })
  it('no step leaves a template behind', () => {
    for (const f of ACTION_FAMILIES) {
      for (const row of SLOTS[f.slot].rows) {
        const text = JSON.stringify(row.steps).replace(/\{ind\.\w+\}/g, '')
        expect(text, row.id).not.toMatch(/\{\w+\.\w+\}/)
        expect(row.steps.length, row.id).toBeGreaterThan(0)
      }
    }
  })
  it('a step that asks for a right-click moves on only when the row it needs is there', () => {
    const [ask, item] = stepsFor(guideFeature('chartMenu'), 'how do I reset the view')
    expect(ask.text).toMatch(/Right-click anywhere on the chart/)
    expect(ask.waitFor).toEqual(item.target)
    expect(item.endsOnClick).toBe(true)
  })
})

// C3-033/040/041: Rename and Version history are on the member's OWN layouts only — never the first layout on the bar
import { mineOnly } from './capabilities/guide'
describe('a layout row only your own layouts have', () => {
  const host = (entries) => ({ layouts: { snapshot: () => ({ entries }) } })
  const BUILT = [{ id: 'uct', name: 'UCT Default', scope: 'global' }, { id: 'g1', name: 'Breakouts', scope: 'global' }]
  it.each(['how do I rename a layout', 'how do I see a layout’s version history'])('%s rings one of yours, by its name', (q) => {
    const steps = mineOnly(stepsFor(guideFeature('layoutAction'), q), host([...BUILT, { id: 7, name: 'Swing', scope: 'user' }]))
    expect(steps[0].target).toEqual([{ within: 'workspace.layouts', attr: 'title', value: 'Swing' }])
    expect(steps[0].text).toMatch(/Swing/)
  })
  it('with none of your own, it says so instead of ringing a built-in', () => {
    expect(mineOnly(stepsFor(guideFeature('layoutAction'), 'how do I rename a layout'), host(BUILT))).toMatch(/you have none yet/)
  })
  it('a row every layout has (duplicate) is left alone', () => {
    const steps = stepsFor(guideFeature('layoutAction'), 'how do I duplicate a layout')
    expect(mineOnly(steps, host(BUILT))).toBe(steps)
  })
})
