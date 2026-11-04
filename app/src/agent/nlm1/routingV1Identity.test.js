// NLM-1 D1 (d) — FLAG OFF: routing is BYTE-IDENTICAL to master's v1. A sha256 over routeManifest's full answer
// (manifest names, routing, overBudget, refresh) for every capreg corpus phrasing, collision row and golden step —
// with and without follow-up context — frozen from PRISTINE master (c87ab6d578) before any NLM-1 code existed.
// The flag-off path must reproduce it exactly: with `v2` absent, `v2: false`, and with the browser switch set but
// the server flag off (the two-key gate).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { configFor, PROD_KINDS } from '../qa/capabilityRegression/testing/registry'
import { loadAgentConfig, _resetAgentConfig } from '../agentClient'
import { pickRouter, routingV2Active } from './flag'
import { routeManifestV2 } from './routingV2'
import { createHash } from 'node:crypto'
import { registerCatalog } from '../qa/capabilityRegression/testing/registry'
import { corpus, golden } from '../qa/capabilityRegression/testing/corpus'
import collisions from '../qa/capabilityRegression/baseline/routingCollisions.json'
import { manifestFor, MANIFEST_CONTRACT } from '../capabilities'
import { routeManifest } from '../routing'
import { pinClock } from '../qa/capabilityRegression/testing/clock'
import frozen from './baseline/routingV1.hash.json'

pinClock()
await registerCatalog()

const texts = () => {
  const t = []
  for (const i of corpus.intents) for (const p of i.phrasings) t.push(typeof p === 'string' ? p : p.text)
  for (const r of collisions.rows) t.push(r.text)
  for (const w of golden.workflows) for (const s of w.steps || []) if (typeof s.say === 'string') t.push(s.say)
  return t
}
const CONTEXTS = [{}, { recentActions: ['indicator.add'] }, { recentActions: ['chart.setSymbol'], pendingActions: ['widget.remove'] }, { after: ['indicatorAlerts'] }]

export function fingerprint(router = routeManifest, extraOpts = {}) {
  const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
  const h = createHash('sha256')
  let n = 0
  for (const text of texts()) for (const ctx of CONTEXTS) {
    const r = router(full, text, { enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold, ...ctx, ...extraOpts })
    h.update(JSON.stringify([text, ctx, r.manifest.map(c => c.name), r.routing, r.overBudget ?? null, r.refresh ?? null])); n++
  }
  return { sha256: h.digest('hex'), cases: n }
}

afterEach(() => { try { localStorage.removeItem('uct.agent.routingV2') } catch { /* */ } })

describe('NLM-1 flag off — v1 routing byte-identical (hash)', () => {
  it('matches the fingerprint frozen from pristine master', () => {
    const fp = fingerprint()
    expect(fp).toEqual({ sha256: frozen.sha256, cases: frozen.cases })
    expect(fingerprint(routeManifest, { v2: false }).sha256).toBe(frozen.sha256)
  })
})

async function serverSays(routingV2) {
  _resetAgentConfig()
  const saved = globalThis.fetch
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ...configFor(PROD_KINDS), routing_v2: routingV2 }), { status: 200, headers: { 'content-type': 'application/json' } }))
  await loadAgentConfig()
  globalThis.fetch = saved
}

describe('NLM-1 two-key gate — anything but BOTH keys on is v1, byte-identical', () => {
  it('server off: browser unset / on → v1, same fingerprint through the chooser useAgent calls', async () => {
    await serverSays(false)
    expect(pickRouter()).toBe(routeManifest)
    localStorage.setItem('uct.agent.routingV2', '1')
    expect(routingV2Active()).toBe(false)
    expect(fingerprint(pickRouter()).sha256).toBe(frozen.sha256)
  })
  it('server on: browser unset / off → v1, same fingerprint', async () => {
    await serverSays(true)
    expect(pickRouter()).toBe(routeManifest)
    localStorage.setItem('uct.agent.routingV2', '0')
    expect(fingerprint(pickRouter()).sha256).toBe(frozen.sha256)
  })
  it('both on → routing v2 (which does route differently)', async () => {
    await serverSays(true)
    localStorage.setItem('uct.agent.routingV2', '1')
    expect(pickRouter()).toBe(routeManifestV2)
    expect(fingerprint(pickRouter()).sha256).not.toBe(frozen.sha256)
    await serverSays(false)
  })
})
