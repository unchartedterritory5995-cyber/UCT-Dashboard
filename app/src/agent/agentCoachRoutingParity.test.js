// Wave 3 review B1 (w3-a, 2026-11-03): with the coach dark (no coach capability registered) routing is IDENTICAL to the
// base for every message — the coach group's words are empty until registerCoachCapabilities arms them. Checked over the
// real golden manifest (contract/manifest.golden.json) at the production limit / budget, against a "base" router that has
// no coach group at all. No model call, no network.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { routeManifest, selectGroups, GROUPS } from './routing'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { registerCoachCapabilities, _resetCoachForTest, COACH_ROUTE_WORDS } from './capabilities/coach'
import { _resetConceptsForTest } from './coach/concepts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GOLDEN = JSON.parse(fs.readFileSync(path.join(HERE, 'contract', 'manifest.golden.json'), 'utf8')).capabilities
const OPTS = { limit: 60, budget: 55 }
const CORPUS = ['show me my journal', 'how did my trades go', 'quiz me', 'coach', 'coach me on failed breakouts', 'review my trades',
  'what is relative strength?', 'teach me about position sizing', 'help me understand expectancy', 'where to put my stop',
  'add a 20-day moving average', 'switch to weekly', 'what is a pullback, in plain words?', 'use my journal', 'my win rate',
  'show breadth', 'drawdown', 'consolidation', 'earnings gaps', 'hello']

/** the base router: the same GROUPS without the coach group */
function baseRoute(msg) {
  const i = GROUPS.findIndex(g => g.id === 'coach')
  const [coach] = GROUPS.splice(i, 1)
  try { return routeManifest(GOLDEN, msg, OPTS) } finally { GROUPS.splice(i, 0, coach) }
}
const names = (r) => (r.manifest || []).map(c => c.name)

beforeEach(() => { _resetAgentConfig(); _resetConceptsForTest(); _resetCoachForTest() })

describe('review B1 — flag-off routing equals the base', () => {
  it('the coach group carries no words while nothing is registered', () => {
    expect(GROUPS.find(g => g.id === 'coach').words).toEqual([])
    expect(GOLDEN.length).toBeGreaterThan(OPTS.limit)
  })
  it.each(CORPUS)('dark: "%s" routes exactly as the base (same capabilities, same routing note)', (msg) => {
    const head = routeManifest(GOLDEN, msg, OPTS)
    const base = baseRoute(msg)
    expect(names(head)).toEqual(names(base))
    expect(head.routing).toEqual(base.routing)
  })
  it('armed only while the coach is registered, disarmed again on reset', async () => {
    globalThis.fetch = vi.fn(async (url) => new Response(JSON.stringify(String(url) === '/api/agent/config'
      ? { stream: false, data: false, data_kinds: [], coach: true } : { concepts: [], footer: 'Educational, not advice.' }),
    { status: 200, headers: { 'content-type': 'application/json' } }))
    await loadAgentConfig()
    registerCoachCapabilities()
    expect(GROUPS.find(g => g.id === 'coach').words).toEqual(COACH_ROUTE_WORDS)
    expect(selectGroups('review my trades').selected).toContain('coach')
    _resetCoachForTest()
    expect(GROUPS.find(g => g.id === 'coach').words).toEqual([])
    expect(selectGroups('review my trades').matched).toBe(false)
  })
})
