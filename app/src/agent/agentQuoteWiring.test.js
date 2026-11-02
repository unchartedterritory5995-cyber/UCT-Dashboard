// agent-lead wiring for agent-md's stock.quote (#624): the browser learns the server's activated kinds
// (#621 config `data_kinds`) and registers stock.quote only when the server serves BOTH quote kinds AND instrument.resolve (MD-1 §4.7.4).
// Anything else — gateway dark, list missing, one kind absent, config not loaded or failing — leaves the
// manifest exactly as it is (no stock.quote), so every flags-off answer is unchanged.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadAgentConfig, serverDataKinds, _resetAgentConfig } from './agentClient'
import { registerServerGatedBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { _resetForTest } from './capabilities/marketDataQuote'

const withConfig = (cfg, ok = true) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => cfg })))

beforeEach(() => { _resetAgentConfig(); _resetForTest() })
afterEach(() => { vi.unstubAllGlobals(); _resetAgentConfig(); _resetForTest() })

async function boot(cfg, ok = true) {
  withConfig(cfg, ok)
  await loadAgentConfig()
  registerServerGatedBuiltins()
}

describe('serverDataKinds', () => {
  it('is null before the config answers', () => { expect(serverDataKinds()).toBe(null) })
  it('is the activated list while the gateway is on', async () => {
    withConfig({ data: true, data_kinds: ['quote', 'quotes'] }); await loadAgentConfig()
    expect(serverDataKinds()).toEqual(['quote', 'quotes'])
  })
  it('is null while the gateway is off, whatever the list says', async () => {
    withConfig({ data: false, data_kinds: ['quote', 'quotes'] }); await loadAgentConfig()
    expect(serverDataKinds()).toBe(null)
  })
  it('is null for an older server with no list', async () => {
    withConfig({ data: true }); await loadAgentConfig()
    expect(serverDataKinds()).toBe(null)
  })
  it('drops anything that is not a kind name', async () => {
    withConfig({ data: true, data_kinds: ['quote', 7, null, 'quotes'] }); await loadAgentConfig()
    expect(serverDataKinds()).toEqual(['quote', 'quotes'])
  })
  it('hands out a copy', async () => {
    withConfig({ data: true, data_kinds: ['quote'] }); await loadAgentConfig()
    serverDataKinds().push('ratings')
    expect(serverDataKinds()).toEqual(['quote'])
  })
})

describe('stock.quote is registered only when the server serves both quote kinds', () => {
  const DARK = [
    ['production today (everything off)', { stream: false, nl1: false, data: false, scan: false, data_kinds: [] }],
    ['gateway on, nothing activated', { data: true, data_kinds: [] }],
    ['gateway on, only quote', { data: true, data_kinds: ['quote'] }],
    ['gateway on, only quotes', { data: true, data_kinds: ['quotes'] }],
    ['gateway on, an older server with no list', { data: true }],
    ['gateway off, list present', { data: false, data_kinds: ['quote', 'quotes'] }],
    ['gateway on, quote + quotes but no instrument.resolve (§4.7.4: never price an unresolved symbol)', { data: true, data_kinds: ['quote', 'quotes'] }],
  ]
  for (const [label, cfg] of DARK) {
    it(`dark: ${label}`, async () => {
      await boot(cfg)
      expect(getCapability('stock.quote')).toBeFalsy()
    })
  }
  it('dark: the config request fails', async () => {
    await boot(null, false)
    expect(getCapability('stock.quote')).toBeFalsy()
  })
  it('on: quote, quotes and instrument.resolve activated', async () => {
    await boot({ data: true, data_kinds: ['quote', 'quotes', 'instrument.resolve'] })
    expect(getCapability('stock.quote')).toBeTruthy()
  })
  it('idempotent: a second config load registers nothing twice', async () => {
    await boot({ data: true, data_kinds: ['quote', 'quotes', 'instrument.resolve'] })
    expect(() => registerServerGatedBuiltins()).not.toThrow()
    expect(getCapability('stock.quote')).toBeTruthy()
  })
})
