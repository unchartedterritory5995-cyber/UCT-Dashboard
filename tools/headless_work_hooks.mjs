// tools/headless_work_hooks.mjs
//
// The module hooks `tools/headless_work.mjs` registers so a bare `node` (the web pod's: `Dockerfile.web`
// carries the node binary, the source tree and ONLY `jsep` of node_modules) imports the engine's
// SHIPPED source unchanged:
//   · load    — a `.json` import is loaded as an ES module whose default export is the parsed document:
//               the JSON-import hook `tools/ast_conformance.py` (`_JS_JSON_HOOK`) registers to run
//               `interpret.js` on web, the same body;
//   · resolve — a RELATIVE specifier written without its extension (`./ast/interpret`, which vite
//               resolves and bare node does not) is resolved as `<specifier>.js`, then
//               `<specifier>/index.js`, the forms `tools/pine_runtime_closure.mjs` walks.
// ⛔ SCOPED TO THOSE TWO AND NOTHING ELSE: no source is rewritten, so the driver runs the shipped files.
import { readFile } from 'node:fs/promises'

const KNOWN = /\.(?:[cm]?js|json)$/

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !KNOWN.test(specifier)) {
    for (const candidate of [`${specifier}.js`, `${specifier}/index.js`]) {
      try {
        return await nextResolve(candidate, context)
      } catch (err) {
        if (!err || err.code !== 'ERR_MODULE_NOT_FOUND') throw err
      }
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.json')) {
    const source = await readFile(new URL(url), 'utf8')
    return { format: 'module', shortCircuit: true, source: `export default ${source}\n` }
  }
  return nextLoad(url, context)
}
