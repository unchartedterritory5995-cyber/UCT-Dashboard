// ── v2-readiness-2 (Mission 3): the REAL requests of the capability-regression corpus, for the deterministic cost model ──
//
// tools/agent_v2_corpus_cost.py prices v1 vs v2 per corpus intent from the ACTUAL prompts: it needs what the browser
// sends, which only the browser can build — the v1 ROUTED manifest + routing block for the phrasing (testing/route.js:
// the same call useAgent's routed request makes), the v2 request's whole manifest (steps.js: manifestFor with the same
// capability context), and the board's workspace context (buildContext over the fixture board). This writes them to
// V2_COST_EXPORT (JSON). Without that variable it only checks that every canonical action is in the v2 manifest.
// No model, no network.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import { registerCatalog } from './qa/capabilityRegression/testing/registry'
import { corpus, phrasingsOf } from './qa/capabilityRegression/testing/corpus'
import { panelHost } from './qa/capabilityRegression/testing/harness'
import { manifestFor, MANIFEST_CONTRACT, buildContext, refreshContext } from './capabilities'
import { routeManifest, routingNames } from './routing'
import { correctTypos, lexiconFor } from './nl/lexicon'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog()

const OUT = globalThis.process?.env?.V2_COST_EXPORT || null
const CAP_CTX = { surface: 'charts', createIndicator: true, manageIndicators: true }

describe('planner v2 cost export — the corpus requests as the browser builds them', () => {
  it('every canonical action of every intent is in the v2 request manifest; export when asked', async () => {
    const full = manifestFor(CAP_CTX)
    const names = new Set(full.map(c => c.name))
    const intents = []
    const boards = {}
    const groupsSeen = new Map()
    for (const intent of corpus.intents) {
      for (const op of intent.model.ops) expect(names.has(op.action), `${intent.id}: ${op.action} in the v2 manifest`).toBe(true)
      const host = panelHost(intent.board)
      await refreshContext(50)
      const phrasings = phrasingsOf(intent).map(ph => {
        const opts = { enabled: true, pendingActions: [], recentActions: intent.recentActions || [], limit: MANIFEST_CONTRACT.limits.maxCapabilities,
          budget: MANIFEST_CONTRACT.routingThreshold, names: routingNames(host), correct: (t) => (correctTypos(t, lexiconFor(host)) || []).map(v => v.text) }
        const r = routeManifest(full, ph.text, opts)
        // the routing block's group catalog is the same for every request: stored once (`routing_groups`), `selected` per phrasing
        if (r.routing?.groups) groupsSeen.set(JSON.stringify(r.routing.groups), r.routing.groups)
        return { text: ph.text, routed: r.manifest.map(c => c.name), routing: r.routing ? { ...r.routing, groups: null } : null }
      })
      if (!boards[intent.board]) boards[intent.board] = buildContext(host, { ...CAP_CTX, message: '' }).context
      intents.push({ id: intent.id, board: intent.board, ops: intent.model.ops, phrasings })
    }
    expect(groupsSeen.size).toBeLessThanOrEqual(1)
    if (OUT) fs.writeFileSync(OUT, JSON.stringify({ about: 'planner v2 cost export (agentPlannerV2CostExport.test.jsx)', manifest: full,
      routing_groups: [...groupsSeen.values()][0] || null, boards, intents }))
    expect(intents).toHaveLength(corpus.intents.length)
  }, 60000)
})
