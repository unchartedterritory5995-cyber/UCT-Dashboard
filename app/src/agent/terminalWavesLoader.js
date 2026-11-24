// Loads the UCT Agent's Terminal data waves (terminalWaves.js) in their OWN chunk, after /api/agent/config has
// answered, and registers them. useAgent.js chains it right after registerServerGatedBuiltins(), the point where
// builtins.js used to register the waves itself; each wave registers nothing unless the server serves its kind.
// Loading the chunk also hands the waves to terminalWavesHook.js, so later registerServerGatedBuiltins() calls run them.
//
// ⛔ The import() below is the ONLY door to terminalWaves.js in the app. A static import of it, or of any wave, from
// builtins.js or anything else the AgentPanel chunk imports puts the waves' panel-model chunks back into the entry
// chunk's preload list and spends the Notebook first-open byte budget (see terminalWaves.js; railed by
// agentTerminalWavesLazy.test.js).
//
// Idempotent: ONE chunk request however often it is called (a failed one is forgotten so the next call retries);
// each call re-runs the idempotent registration, so a config that serves a kind later still registers it.
// A failure (the chunk cannot load, e.g. a stale tab after a deploy, or a register throws) is logged and the
// Agent carries on without those answers: the returned promise never rejects.

const defaultImport = () => import('./terminalWaves')
let importWaves = defaultImport
let pending = null

/** Loads (once) and registers the Terminal data waves. Resolves the names registered by this call, or null on a failure. */
export function loadTerminalWaves() {
  if (!pending) {
    pending = importWaves().catch((e) => { pending = null; throw e })
  }
  return pending
    .then((m) => m.registerTerminalWaves())
    .catch((e) => {
      try { console.warn(`[uct-agent] the Terminal data answers did not load (${e?.message || 'error'}); the Agent carries on without them`) } catch { /* no console */ }
      return null
    })
}

/** Tests only: swap the chunk import (a rejecting or counting stand-in); call with no argument to restore it. */
export function _setTerminalWavesImportForTest(fn) { importWaves = fn || defaultImport; pending = null }
export function _resetTerminalWavesLoaderForTest() { importWaves = defaultImport; pending = null }
