// app/scripts/memberDoorWorkerPure.mjs
//
// ⭐⭐ THE PASTE WORKER (2026-11-20) — THE MEMBER DOOR'S WORKER HOLDS NO REACT: TWO SPECIFIERS, FROM ONE FILE, NOTHING ELSE.
//
// `src/components/chart/builder/memberPane/memberPaneDefinition.js` imports `buildDefinition` from `../BuilderSheet` and
// `evaluateFormula` from `../FormulaField`, as it always has, and both re-export those functions from the pure modules
// `../buildDefinition.js` and `../evaluateFormula.js`. On the page that keeps every route's chunk graph as master has
// it (cutting the door's graph loose from the sheet re-cut Rollup's shared chunks and grew every route's preload list:
// Notebook first open +419 B over master on #2254). Inside a WORKER bundle (`vite.config.js` `worker.plugins`, which
// applies to worker bundles only) exactly these two specifiers, from exactly that file, resolve to the pure modules,
// so `memberDoorWorker.js` holds no React, no sheet and no CSS. The same functions either way, and the resolver
// matches nothing else: `src/components/chart/builder/memberPane/memberDoorWorkerGraph.test.js`.

/** The one importer whose two imports are resolved differently in a worker (relative to `app/`). */
export const MEMBER_DOOR_FILE = 'src/components/chart/builder/memberPane/memberPaneDefinition.js'

/** Specifier -> the pure module it resolves to inside a worker bundle. */
export const MEMBER_DOOR_WORKER_PURE = Object.freeze({
  '../BuilderSheet': '../buildDefinition.js',
  '../FormulaField': '../evaluateFormula.js',
})

const normalise = (p) => String(p || '').split('?')[0].replace(/\\/g, '/')

/** The pure module a worker resolves `source` (imported by `importer`, an absolute path) to, or null for every other
 *  import: an exact specifier, from exactly `app/<MEMBER_DOOR_FILE>`. */
export function memberDoorWorkerPureTarget(source, importer) {
  if (typeof source !== 'string' || !Object.prototype.hasOwnProperty.call(MEMBER_DOOR_WORKER_PURE, source)) return null
  if (!normalise(importer).endsWith(`/app/${MEMBER_DOOR_FILE}`)) return null
  return MEMBER_DOOR_WORKER_PURE[source]
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
