// ⛔ IN THE APP THIS DOES NOTHING, ON PURPOSE. builtins.js calls it at the end of registerServerGatedBuiltins(),
// where the Terminal data waves used to be registered; in the build and the dev server the waves load lazily
// instead (terminalWavesLoader.js, run by useAgent.js right after registerServerGatedBuiltins()), so this module
// must never import them: it is how builtins.js stays free of any static path to the waves' chunk.
//
// ⭐ UNDER VITEST ONLY, app/vite.config.js's test.alias maps the exact specifier './terminalWavesEager' (as builtins.js
// writes it) to ./terminalWaves.js, whose registerTerminalWaves() registers every served wave synchronously. So the
// test files that call registerServerGatedBuiltins() and expect a wave's capability at once behave exactly as they
// did when builtins.js imported the waves itself, in the same order. agentTerminalWavesLazy.test.js rails both halves.

/** Production: a no-op (the waves arrive through terminalWavesLoader.js). Same name and shape as terminalWaves.js's export. */
export function registerTerminalWaves() {
  return []
}
