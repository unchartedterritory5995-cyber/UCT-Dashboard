// ── TARGET DECLARATIONS — Phase 2 prep: the SHADOW SINK (UNWIRED) ───────────────────────────────────────────────────────────
//
// What a shadow run records, in memory, for AUDIT's probes and the real-panel re-measure (the capreg finalState shards) to read.
// NOT imported by railOf / AgentPanel / useAgent yet: the one call from railOf lands with the shadow wiring, after #1247 and #1261.
//
// Each entry is { path, verdict, kinds } — the same letters and names as shadowTelemetry (targetDecl.js), never member words,
// symbols or ids. Bounded (SINK_MAX, oldest dropped first) so a long session never grows it without limit. Never throws.
import { shadowTelemetry } from './targetDecl'

export const SINK_MAX = 500
/** The sink itself (module-level, this tab only). Read it with readShadow(); tests may read it directly. */
export const __tdShadowSink = []

/** Record one validation: `result` from validateDeclaration / validateFanOut, `decl` from declareTargets, `path` the execute path. */
export function recordShadow(result, decl, { path = null } = {}) {
  try {
    const t = shadowTelemetry(result, decl, { path })
    __tdShadowSink.push({ path: t.tdPath, verdict: t.td, kinds: { ...t.tdKinds } })
    while (__tdShadowSink.length > SINK_MAX) __tdShadowSink.shift()
    return true
  } catch {
    return false
  }
}
/** A copy of what the sink holds (oldest first). */
export const readShadow = () => __tdShadowSink.map(e => ({ ...e, kinds: { ...e.kinds } }))
/** Empty the sink (between tests / probes). */
export function resetShadow() { __tdShadowSink.length = 0 }
