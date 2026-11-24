// The ONE seam between builtins.js and the Terminal data waves (2026-11-24). It imports nothing, on purpose: it is
// how builtins.js stays free of any static path to the waves' chunk (terminalWaves.js), which would put their
// panel-model chunks back into the entry chunk's preload list and break the Notebook first-open byte budget.
//
// terminalWaves.js hands its registerTerminalWaves() in here when it is evaluated. In the app that happens when
// terminalWavesLoader.js import()s it (useAgent.js, right after registerServerGatedBuiltins()); from then on
// registerServerGatedBuiltins() runs the waves too, at its end, where they always ran. A test that needs a wave's
// capability from registerServerGatedBuiltins() at once imports terminalWaves.js itself (`import './terminalWaves'`);
// without that import nothing here is set and the call registers no wave. Railed by agentTerminalWavesLazy.test.js.

let registrar = null

/** terminalWaves.js only: the function that registers every served wave (null clears it). */
export function setTerminalWavesRegistrar(fn) {
  registrar = typeof fn === 'function' ? fn : null
}

/** builtins.js's registerServerGatedBuiltins(): registers the served waves once terminalWaves.js has loaded, else nothing. */
export function runTerminalWaves() {
  return registrar ? registrar() : []
}
