// ROUTING SIDE EFFECT RAIL (pl-exec round 2): with EVERY widget that has controls on the board, how many of the capability-
// regression corpus phrasings does a widget's name newly route to boardEdit, and how many manifest bytes does that add?
// Before the control-word gate: 19 of 693, +3,671 bytes each ("any news on TSLA", "how's breadth today"). Pinned at 0.
import { it, vi, expect } from 'vitest'
import { registerCatalog, isDark } from './qa/capabilityRegression/testing/registry'
import { corpus, phrasingsOf } from './qa/capabilityRegression/testing/corpus'
import { manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { routeManifest, namedBoardWidgets } from './routing'
import { widgetControls } from '../widgets/widgetControls'
vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog()
it('side effect', async () => {
  const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
  const ALL = ['themes', 'breadth', 'indexes', 'calendar', 'optionsflow', 'nhnl', 'volumescan', 'scatter', 'tradeExchangeNews', 'news', 'fundamentals', 'periodsort']
  const o = { enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold }
  let n = 0, hit = 0, added = 0, ctx = 0; const by = {}
  for (const intent of corpus.intents.filter(i => !isDark(i))) for (const ph of phrasingsOf(intent)) {
    n++
    const a = routeManifest(full, ph.text, { ...o, names: { widgetTypes: [] } })
    const b = routeManifest(full, ph.text, { ...o, names: { widgetTypes: ALL } })
    const d = JSON.stringify(b.manifest).length - JSON.stringify(a.manifest).length
    if (d !== 0) {
      hit++; added += d
      const named = namedBoardWidgets(ph.text, ALL)
      const c = JSON.stringify(Object.fromEntries(named.map(t => [t, widgetControls(t).map(f => f.key).join(',')]))).length
      ctx += c
      for (const t of named) by[t] = (by[t] || 0) + 1
      console.log('[side]', JSON.stringify(ph.text), d, named.join(','))
    }
  }
  expect(hit).toBe(0)
  console.log(`[side] phrasings ${n}; changed ${hit}; manifest bytes added ${added} (avg ${hit ? Math.round(added / hit) : 0}/affected turn); by type ${JSON.stringify(by)}`)
}, 120000)
