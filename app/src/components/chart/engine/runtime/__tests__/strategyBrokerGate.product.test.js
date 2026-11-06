// W9-T1 B1: the flag reader that keeps members dark, railed through the PRODUCT path.
//   - strategyBrokerEnabled() under stubbed env: only the literal '1' opens it.
//   - the registry's default (nothing registered) is off, and a non-function registration is off.
//   - memberPaneDefinition.js registers the real reader: a broker-reading strategy built with NO option refuses
//     pine:strategy-call when the env is unset / '' / '0' / 'true', and retries into broker mode when it is '1'.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const SRC = ['//@version=5', 'strategy("t")', 'if bar_index == 3', '    strategy.entry("L", strategy.long)',
  'plot(strategy.position_size)', ''].join(String.fromCharCode(10))
const BARS = Array.from({ length: 30 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100 + i, h: 101.5 + i, l: 99 + i, c: 100.5 + i, v: 1000 }))
const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' }

vi.setConfig({ testTimeout: 120000 })
beforeEach(() => { vi.resetModules() })
afterEach(() => { vi.unstubAllEnvs() })

describe('W9-T1 B1 the build flag reader', () => {
  it('strategyBrokerEnabled(): unset, empty, 0 and true are OFF; only the literal 1 is ON', async () => {
    const { strategyBrokerEnabled } = await import('../../strategyBrokerGate.js')
    for (const v of [undefined, '', '0', 'true', 'yes', 'false']) {
      vi.stubEnv('VITE_PINE_STRATEGY_BROKER_ENABLED', v === undefined ? '' : v)
      if (v === undefined) vi.unstubAllEnvs()
      expect(strategyBrokerEnabled(), String(v)).toBe(false)
    }
    vi.stubEnv('VITE_PINE_STRATEGY_BROKER_ENABLED', '1')
    expect(strategyBrokerEnabled()).toBe(true)
  })

  it('the registry default (nothing registered) is OFF, and a non-function registration is OFF', async () => {
    const reg = await import('../../strategyBrokerGateRegistry.js')
    expect(reg.strategyBrokerGateOn()).toBe(false)
    reg.registerStrategyBrokerGate('1')
    expect(reg.strategyBrokerGateOn()).toBe(false)
    reg.registerStrategyBrokerGate(() => true)
    expect(reg.strategyBrokerGateOn()).toBe(true)
    reg.registerStrategyBrokerGate(null)
    expect(reg.strategyBrokerGateOn()).toBe(false)
  })
})

describe('W9-T1 B1 the member door registers the real reader (product path)', () => {
  const build = async () => {
    await import('../../../builder/memberPane/memberPaneDefinition.js') // registers the reader
    const { buildRuntimeIr } = await import('../../ast/pineRuntimeFrontend.js')
    return buildRuntimeIr(SRC, { bars: BARS, inputs: {}, symbol: SYMBOL }) // NO strategyBroker option
  }
  for (const v of ['', '0', 'true']) {
    it(`env ${JSON.stringify(v)}: a broker value refuses pine:strategy-call (dark)`, async () => {
      vi.stubEnv('VITE_PINE_STRATEGY_BROKER_ENABLED', v)
      const b = await build()
      expect(b.ok).toBe(false)
      expect(b.refusal.guard).toBe('pine:strategy-call')
    })
  }
  it('env unset: dark', async () => {
    vi.unstubAllEnvs()
    const b = await build()
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('pine:strategy-call')
  })
  it('env "1": the same build retries into broker mode (the registration is the real reader)', async () => {
    vi.stubEnv('VITE_PINE_STRATEGY_BROKER_ENABLED', '1')
    const b = await build()
    expect(b.ok).toBe(true)
    expect(b.ir.broker).not.toBe(null)
  })
})
