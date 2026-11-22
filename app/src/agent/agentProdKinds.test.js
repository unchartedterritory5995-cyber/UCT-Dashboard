// W2 release gate (#734 + #746): production's EXACT UCT_AGENT_DATA_KINDS (web, 2026-11-03, 11 kinds). Pins which
// server-gated capabilities register with it: chart.describeSetup and stock.dailyBars YES (they read only bars.daily
// + instrument.resolve, intended live for admins); history.afterEvent NO (history.eventStudy is not listed);
// research.ask NO. No isolated kind (isolation.json) is in the served list, so none is readable from the browser
// (the server refuses them too: tests/test_uct_agent_data_kinds_allowlist.py).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import handshake from './__fixtures__/program/isolation.json'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { allCapabilityNames, manifestFor } from './capabilities'
import { loadAgentConfig, _resetAgentConfig, serverDataKinds } from './agentClient'
import { match as describeMatch } from './capabilities/chartDescribe'
import { match as afterEventMatch } from './capabilities/history'

export const PROD_KINDS = ['instrument.resolve', 'quote', 'quotes', 'bars.daily', 'fundamentals', 'earnings', 'news.company', 'themes',
  'screen.run', 'screen.count', 'screen.saved']

registerBuiltins()
const UNGATED = new Set(allCapabilityNames())

function wire(cfg) {
  globalThis.fetch = vi.fn(async (url) => new Response(JSON.stringify(String(url).endsWith('/api/agent/config') ? cfg : {}),
    { status: String(url).endsWith('/api/agent/config') ? 200 : 404, headers: { 'content-type': 'application/json' } }))
}

describe("production's 11 data kinds", () => {
  beforeEach(() => { _resetAgentConfig() })

  it('registers exactly the intended server-gated capabilities: describeSetup yes, afterEvent no', async () => {
    wire({ stream: false, nl1: false, data: true, scan: false, data_kinds: PROD_KINDS })
    await loadAgentConfig()
    expect(serverDataKinds()).toEqual(PROD_KINDS)
    registerServerGatedBuiltins()
    const gated = allCapabilityNames().filter(n => !UNGATED.has(n)).sort()
    expect(gated).toEqual(GATED_EXPECTED)
    expect(gated).toContain('chart.describeSetup')
    expect(gated).toContain('stock.dailyBars')
    expect(gated).not.toContain('history.afterEvent')
    expect(gated).not.toContain('research.ask')
    expect(describeMatch('describe this setup')).not.toBeNull()
    expect(afterEventMatch('how has NVDA behaved after 5%+ gaps?')).toBeNull()
    const manifest = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true }).map(c => c.name)
    expect(manifest).toContain('chart.describeSetup')
    expect(manifest).not.toContain('history.afterEvent')
  })

  it('no isolated kind is served (so none is readable), and the W2 history kind stays dark', () => {
    expect(handshake.isolated_kinds.length).toBeGreaterThan(0)
    for (const k of [...handshake.isolated_kinds, 'history.eventStudy', 'research.company']) expect(PROD_KINDS).not.toContain(k)
  })

  it('CONTROL: the same afterEvent phrase IS claimed once history.eventStudy is served (the "no" above is the gate)', async () => {
    wire({ stream: false, nl1: false, data: true, scan: false, data_kinds: [...PROD_KINDS, 'history.eventStudy'] })
    await loadAgentConfig()
    expect(afterEventMatch('how has NVDA behaved after 5%+ gaps?')).not.toBeNull()
  })
})

const GATED_EXPECTED = ['chart.describeSetup', 'stock.dailyBars', 'stock.quote', 'stock.themes']
