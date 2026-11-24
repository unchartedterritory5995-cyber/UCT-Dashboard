// The UCT Agent's TERMINAL DATA WAVES: wave 1's four local-only answers (terminalDataLocal.js) and waves 2-11.
// Every one is SERVER-GATED and registers nothing unless /api/agent/config serves its own isolated kind (each
// register function is idempotent and returns the names IT registered), so calling this again after the config
// changes registers only what became served.
//
// ⛔ LOADED LAZILY, NEVER IMPORTED STATICALLY BY THE APP (2026-11-23). It lives in its own chunk, reached only by
// the dynamic import() in terminalWavesLoader.js, which useAgent.js runs right after registerServerGatedBuiltins().
// Why: while builtins.js imported the waves, the Terminal panel models they reuse (levelsModel, groupStatsModel,
// cotModel ...) were static dependencies of the lazy AgentPanel chunk, and every such model chunk's file name went
// into the ENTRY chunk's preload list for that import. Wave 11 added six of them (+243 B) and took the Notebook's
// first-open byte budget (notebook-bytes.yml, a promotion gate) 209 B over. agentTerminalWavesLazy.test.js keeps
// builtins.js and the AgentPanel chunk free of any static path to this module or to a wave.
//
// ⭐ THE HOOK (2026-11-24): when this module is evaluated it hands registerTerminalWaves() to terminalWavesHook.js, and
// from then on builtins.js's registerServerGatedBuiltins() runs it at its end, where the waves always ran (the hook
// imports nothing, so builtins.js keeps no static path here). In the app that happens when the loader import()s this
// chunk. A TEST that calls registerServerGatedBuiltins() and expects a served wave's capability at once imports this
// file itself (`import './terminalWaves'`): the same calls, in the same order, synchronously, as before the split.
// (No vitest alias: the queue's agent-ci-required check treats app/vite.config.js as self-protected.)
import { setTerminalWavesRegistrar } from './terminalWavesHook'
import { registerTerminalLocalCapabilities } from './capabilities/terminalDataLocal'
import { registerTerminalWave2Capabilities } from './capabilities/terminalDataWave2'
import { registerTerminalWave3Capabilities } from './capabilities/terminalDataWave3'
import { registerTerminalWave4Capabilities } from './capabilities/terminalDataWave4'
import { registerTerminalWave5Capabilities } from './capabilities/terminalDataWave5'
import { registerTerminalWave6Capabilities } from './capabilities/terminalDataWave6'
import { registerTerminalWave7Capabilities } from './capabilities/terminalDataWave7'
import { registerTerminalWave8Capabilities } from './capabilities/terminalDataWave8'
import { registerTerminalWave9Capabilities } from './capabilities/terminalDataWave9'
import { registerTerminalWave10Capabilities } from './capabilities/terminalDataWave10'
import { registerTerminalWave11Capabilities } from './capabilities/terminalDataWave11'

/** Registers every Terminal data wave whose kind the server serves. Idempotent. Returns the names registered by this call. */
export function registerTerminalWaves() {
  return [
    ...registerTerminalLocalCapabilities(),   // Terminal data wave 1: four local-only answers, each while the server serves its own isolated kind
    ...registerTerminalWave2Capabilities(),   // Terminal data wave 2: five local-only answers
    ...registerTerminalWave3Capabilities(),   // Terminal data wave 3: four local-only answers
    ...registerTerminalWave4Capabilities(),   // Terminal data wave 4: three local-only answers
    ...registerTerminalWave5Capabilities(),   // Terminal data wave 5: two local-only answers (FINRA short interest)
    ...registerTerminalWave6Capabilities(),   // Terminal data wave 6: five local-only answers (seasonality, Market Tide by session, open interest change, Treasury yields)
    ...registerTerminalWave7Capabilities(),   // Terminal data wave 7: six local-only answers (market regime, confirmed setups, events timeline, UCT 20 list, IV history, dilution watch)
    ...registerTerminalWave8Capabilities(),   // Terminal data wave 8: three local-only answers (corporate actions, the IPO calendar, dividends and splits ahead)
    ...registerTerminalWave9Capabilities(),   // Terminal data wave 9: three local-only answers (Treasury auctions, real yields and breakevens, the Fed watch)
    ...registerTerminalWave10Capabilities(),  // Terminal data wave 10: six local-only answers (stock statistics, volume footprint, factor exposure, setup history, public records, fund holders)
    ...registerTerminalWave11Capabilities(),  // Terminal data wave 11: seven local-only answers (group rank, group crowding, earnings by sector, revisions by sector, IV rank leaders, IPO lockups, COT by trader type)
  ]
}

setTerminalWavesRegistrar(registerTerminalWaves)
