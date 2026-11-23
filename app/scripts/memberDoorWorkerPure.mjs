// app/scripts/memberDoorWorkerPure.mjs
//
// ⭐⭐ THE PASTE WORKER (2026-11-20) — THE MEMBER DOOR'S WORKER HOLDS NO REACT: NAMED SPECIFIERS, FROM NAMED FILES,
// NOTHING ELSE.
//
// Three page modules the member door's worker runs import a pure function through a React component that
// re-exports it: `memberPane/memberPaneDefinition.js` (the chart door) imports `buildDefinition` from
// `../BuilderSheet` and `evaluateFormula` from `../FormulaField`; `inspectSource.js` (PasteBox's report) and
// `libraryIntake.js` (a paste of several scripts) import `evaluateFormula` (and `canSaveFormula`) from
// `./FormulaField`. Each component re-exports the function from its pure module (`buildDefinition.js`,
// `evaluateFormula.js`). On the page those imports stay as they are, so every route's chunk graph is master's
// (cutting the door's graph loose from the sheet re-cut Rollup's shared chunks and grew every route's preload list:
// Notebook first open +419 B over master on #2254). Inside a WORKER bundle (`vite.config.js` `worker.plugins`, which
// applies to worker bundles only) exactly those specifiers, from exactly those files, resolve to the pure modules,
// so `memberDoorWorker.js` holds no React, no sheet and no CSS. The same functions either way, and the resolver
// matches nothing else: `src/components/chart/builder/memberPane/memberDoorWorkerGraph.test.js`.

/** importer (relative to `app/`) -> { specifier -> the pure module it resolves to inside a worker bundle }. */
export const WORKER_PURE_RESOLUTIONS = Object.freeze({
  'src/components/chart/builder/memberPane/memberPaneDefinition.js': Object.freeze({
    '../BuilderSheet': '../buildDefinition.js',
    '../FormulaField': '../evaluateFormula.js',
  }),
  'src/components/chart/builder/inspectSource.js': Object.freeze({
    './FormulaField': './evaluateFormula.js',
  }),
  'src/components/chart/builder/libraryIntake.js': Object.freeze({
    './FormulaField': './evaluateFormula.js',
  }),
})

const normalise = (p) => String(p || '').split('?')[0].replace(/\\/g, '/')
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/** The pure module a worker resolves `source` (imported by `importer`, an absolute path) to, or null for every other
 *  import: an exact specifier, from exactly one of the named files (`app/<file>`). */
export function memberDoorWorkerPureTarget(source, importer) {
  if (typeof source !== 'string') return null
  const from = normalise(importer)
  for (const file of Object.keys(WORKER_PURE_RESOLUTIONS)) {
    if (!from.endsWith(`/app/${file}`)) continue
    const table = WORKER_PURE_RESOLUTIONS[file]
    return own(table, source) ? table[source] : null
  }
  return null
}

/** The Vite plugin (`worker.plugins`). */
export function memberDoorWorkerPure() {
  return {
    name: 'uct-member-door-worker-pure',
    enforce: 'pre',
    async resolveId(source, importer) {
      const target = memberDoorWorkerPureTarget(source, importer)
      return target ? this.resolve(target, importer, { skipSelf: true }) : null
    },
  }
}
