// app/src/components/chart/engine/rescaleSchema.js
//
// ─── THE `def.rescale` GRAMMAR, A LEAF (2026-11-12) ─────────────────────────────
//
// `defSchema.js` validates a definition's `rescale` declaration against these
// constants; `rescale.js` reads the declaration. Kept apart for the reason
// `liveTailSchema.js` is: `defSchema.js` sits in the runtime lane's compute closure
// (`tools/pine_runtime_closure.mjs`), so it imports the grammar and never the reader.
// Imports nothing.

/** The closed set of fields `def.rescale` may carry. */
export const RESCALE_FIELDS = Object.freeze(['input', 'off', 'to', 'anchor', 'at', 'plots', 'timeframes', 'precision'])
/** The timeframe codes a `rescale.timeframes` list may name. */
export const RESCALE_TIMEFRAMES = Object.freeze(['D', 'W', 'M'])
