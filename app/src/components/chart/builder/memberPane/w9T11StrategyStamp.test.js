// app/src/components/chart/builder/memberPane/w9T11StrategyStamp.test.js
//
// W9-T11 — the member door's runtime path stamps a STRATEGY document with the window rule
// (`strategyRecord.STRATEGY_WINDOW_HISTORY`), and only with the broker flag on. With the flag
// off the door is exactly as before: a strategy that reads a broker value is not drawn
// bar by bar, and an indicator keeps R-W's `listing` stamp.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../engine/runtime/brokerPins.js', () => ({ pinned: () => true }))
vi.setConfig({ testTimeout: 120000 })

import { memberPaneDefinition } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { computeRuntimeColumns } from '../../engine/runtime/runtimeColumns'
import { STRATEGY_WINDOW_HISTORY, runtimeStrategyOf, strategyRecordShapeErrors } from '../../engine/runtime/strategyRecord'

const NL = String.fromCharCode(10)
const ID = 'u_w9t11-stamp'
const SRC = ['//@version=5', 'strategy("t")', 'if bar_index == 3', '    strategy.entry("L", strategy.long)',
  'plot(strategy.position_size, "pos")', ''].join(NL)
const IND = ['//@version=5', 'indicator("i")', 'var float acc = 0.0', 'acc += close', 'plot(acc, "acc")', ''].join(NL)
const BARS = Array.from({ length: 30 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100 + i, h: 101.5 + i, l: 99 + i, c: 100.5 + i, v: 1000 }))
const flags = (broker) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  if (broker) vi.stubEnv('VITE_PINE_STRATEGY_BROKER_ENABLED', '1')
}
const door = (source) => memberPaneDefinition({ source, id: ID, name: 'T' })

afterEach(() => { registry.uninstallUserDefinition(ID); vi.unstubAllEnvs() })

describe('W9-T11 the member door stamps a strategy document with the window rule', () => {
  it('broker flag ON: the strategy is stamped strategy-window, and its run carries the record', () => {
    flags(true)
    const d = door(SRC)
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.meta.runtimeHistory).toBe(STRATEGY_WINDOW_HISTORY)
    const { installed, errors } = registry.installUserDefinitions([d.definition])
    expect(errors).toEqual([])
    const cols = computeRuntimeColumns(installed[0], BARS, { tf: 'D', newestBarIsForming: false, historyFromListing: true,
      symbol: { ticker: 'RDDT', exchange: 'NYSE' }, historyWindowBars: 30 })
    expect(strategyRecordShapeErrors(runtimeStrategyOf(cols))).toEqual([])
  })

  it('broker flag OFF: the strategy is not drawn bar by bar (as before)', () => {
    flags(false)
    const d = door(SRC)
    expect(d.ok).toBe(false)
  })

  it('an indicator keeps the listing stamp with the flag on or off', () => {
    for (const on of [false, true]) {
      flags(on)
      const d = door(IND)
      expect(d.ok, d.reason).toBe(true)
      expect(d.definition.meta.runtimeHistory).toBe('listing')
      vi.unstubAllEnvs()
    }
  })
})
