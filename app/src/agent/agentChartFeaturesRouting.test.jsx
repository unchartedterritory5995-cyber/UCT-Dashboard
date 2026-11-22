// chartFeatures × boardEdit routing (AUDIT #1167): with every controls-bearing widget on the board, a Company Info panel TAB
// name ("… on the news tab", "the news tab of the company panel") is the panel's tab, not the News / Earnings widget's name:
// it brings no boardEdit (no +5,258 manifest bytes), exactly as with no widget on the board. Controls: a request that really
// names the News widget with one of its control words still routes boardEdit as before, and a bare "news widget" is still the
// widget's name for the context. Same setup as agentExecSideEffect.test.jsx (the catalog, the full Charts manifest).
import { it, expect, vi } from 'vitest'
import { registerCatalog } from './qa/capabilityRegression/testing/registry'
import { manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { routeManifest, namedBoardWidgets } from './routing'
vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog()

const ALL = ['themes', 'breadth', 'indexes', 'calendar', 'optionsflow', 'nhnl', 'volumescan', 'scatter', 'tradeExchangeNews', 'news', 'fundamentals', 'periodsort']
const o = { enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold }
const full = () => manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
// the manifest bytes the board's widget names add to this message's request (0 = the names bring nothing)
const added = (t) => {
  const m = full()
  return JSON.stringify(routeManifest(m, t, { ...o, names: { widgetTypes: ALL } }).manifest).length
    - JSON.stringify(routeManifest(m, t, { ...o, names: { widgetTypes: [] } }).manifest).length
}
const boardEdit = (t) => routeManifest(full(), t, { ...o, names: { widgetTypes: ALL } }).manifest.some(c => c.name === 'widget.setOption')

const TAB_PHRASINGS = [
  'show the company info panel on the news tab', 'open the news tab of the company panel', 'put the company panel on the news tab',
  'switch the company panel to the earnings tab', 'show the ownership tab on the company panel', 'show the company info on the valuation tab',
  'open the company profile panel on the financials tab', 'switch the info panel to the overview tab',
]
it.each(TAB_PHRASINGS)('a company-panel tab name is not a widget\'s name: "%s" — no widget named, no boardEdit, +0 bytes', (t) => {
  expect(namedBoardWidgets(t, ALL)).toEqual([])
  expect(added(t)).toBe(0)
  expect(boardEdit(t)).toBe(false)
})
it.each(['filter the news widget to bullish', 'switch the news widget to the bullish tab', 'sort the news widget by time'])(
  'control: the News widget with its own control words still routes boardEdit: "%s"', (t) => {
    expect(namedBoardWidgets(t, ALL)).toEqual(expect.arrayContaining(['news']))
    expect(added(t)).toBeGreaterThan(0)
    expect(boardEdit(t)).toBe(true)
  })
it.each(['add a news widget', 'open the news widget', 'add the company panel and the news widget'])(
  'control: "%s" still names the News widget (the context reads the name)', (t) => {
    expect(namedBoardWidgets(t, ALL)).toEqual(expect.arrayContaining(['news']))
  })
