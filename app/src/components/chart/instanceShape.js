// app/src/components/chart/instanceShape.js
//
// ─── THE INSTANCE SHAPE, AND THE OVERRIDE MERGE — SPLIT OUT OF chartDefaults ──
//
// ⭐⭐ B5 TASK 9 MOVED THESE HERE, AND THE REASON IS A MEASURED BUNDLE NUMBER.
//
// `chartDefaults.js` gained a static import of `engine/instances` (the v1→v2
// fold) and with it the whole native registry and every `compute*` function.
// `hooks/usePreferences.js` — which is on the EAGER path, mounted for every user
// on every page — imported `mergeSettingsOverride` from `chartDefaults`, so that
// one edge dragged 42 kB raw / **13.9 kB gzip** of indicator maths into the entry
// chunk. Measured on the real build: `index` 379,254 → 421,032 bytes.
//
// ⛔ `manualChunks` CANNOT FIX AN EAGER STATIC IMPORT — the EDGE has to move.
// So the two things `usePreferences` actually needs live here, in a module that
// imports nothing, and `chartDefaults` RE-EXPORTS them so every existing import
// keeps working.
//
// ⭐ AND IT REMOVES AN IMPORT CYCLE. `engine/instances.js` imported the tombstone
// helpers back out of `chartDefaults`, which after the fold made the two modules
// mutually dependent. It was safe (both sides are hoisted `export function`
// declarations, neither calls the other at module scope) but it was safe by
// accident, and a `const` added to either side at the wrong moment is a TDZ
// crash in the merge every chart is on.

// ─── Removing an indicator instance: the tombstone ───────────────────────────
//
// The instance merge below is a UNION BY ID, which is what stops a grid cell
// holding a stale blob from deleting an instance another cell just added. The
// same property makes OMISSION meaningless as a delete signal: "absent from this
// patch" and "deleted" look identical, and treating them the same reintroduces
// the exact data loss the union exists to prevent.
//
// So a removal is stated, not implied. `{instanceId, deleted: true}` is a
// TOMBSTONE: it stays in the array, and it wins over any later patch that does
// not explicitly clear it. That last part is the whole point — the writer that
// resurrects a deleted instance is not a buggy one, it is an ordinary grid cell
// whose snapshot predates the delete and which names the instance in full on its
// next unrelated write. Nothing short of a persisted marker survives that.
//
// Reversal is an EXPLICIT `deleted: false` (a re-add), so the undo is a user
// action rather than a race.
//
// KNOWN LIMIT, stated rather than discovered: tombstones accumulate — one per
// distinct id ever deleted. Re-deleting the same id does not grow the list, and
// the ids are few (fourteen legacy ones are deterministic), so this is bounded in
// practice. Compaction needs a writer that can prove no stale snapshot survives;
// that is a B4 question, not a reason to make deletion lossy now.
const INSTANCE_DELETED_FIELD = 'deleted'

/** The stored form of "this instance is gone". Minimal on purpose: a delete must
 *  not keep the user's old settings lying around in the blob, and "undelete
 *  restores what you had" is a promise nothing else here makes. */
export function instanceTombstone(instanceId) {
  return { instanceId, [INSTANCE_DELETED_FIELD]: true }
}

/** Explicit `true` only. A truthy-but-not-true value is malformed data, and
 *  guessing that it meant deletion is how a chart loses an indicator to a typo. */
export function isInstanceTombstone(inst) {
  return !!inst && typeof inst === 'object' && inst[INSTANCE_DELETED_FIELD] === true
}

// ─── Per-instance settings override (multi-chart grid cells) ─────────────────
// Deep-merges a PARTIAL settings blob over an already-merged base (the user's
// global chart_settings). Primitives replace; the section objects
// mergeChartSettings treats as objects merge one level (watermark.lines and
// per-indicator two); arrays replace wholesale. Precedence: CHART_DEFAULTS <
// global blob < override. Callers must pass a STABLE object (useMemo) — it is
// a memo dependency inside StockChart.
const _OVERRIDE_SECTION_KEYS = [
  'candles', 'bgGradient', 'grid', 'crosshair', 'volume',
  'drawingDefaults', 'swingLabels', 'markers', 'positionCalc', 'header',
  'signature',
]
export function mergeSettingsOverride(base, partial) {
  if (!partial) return base
  const out = { ...base }
  for (const [k, v] of Object.entries(partial)) {
    if (v === undefined) continue
    if (k === 'watermark' && v && typeof v === 'object') {
      out.watermark = { ...base.watermark, ...v, lines: { ...base.watermark?.lines, ...(v.lines || {}) } }
    } else if (k === 'indicators' && v && typeof v === 'object') {
      const ind = { ...base.indicators }
      for (const [ik, iv] of Object.entries(v)) ind[ik] = { ...(base.indicators?.[ik] || {}), ...(iv || {}) }
      out.indicators = ind
    } else if (k === 'indicatorInstances') {
      // Merge by instanceId. The generic path below replaces arrays wholesale, which
      // in a grid cell would delete every instance the override didn't happen to
      // mention. Must stay ABOVE that fall-through.
      const byId = new Map((out.indicatorInstances || []).map(i => [i.instanceId, i]))
      for (const patch of (Array.isArray(v) ? v : [])) {
        if (!patch?.instanceId) continue
        const prev = byId.get(patch.instanceId)
        const merged = prev ? { ...prev, ...patch, inputs: { ...prev.inputs, ...patch.inputs } } : { ...patch }
        // A tombstone collapses whatever it merged with — that is what makes a
        // stale writer's full instance (which carries no `deleted` key, so the
        // spread leaves the previous `true` standing) fail to resurrect it, and
        // it keeps the corpse from re-accumulating that writer's payload.
        if (merged[INSTANCE_DELETED_FIELD] === true) {
          byId.set(patch.instanceId, instanceTombstone(patch.instanceId))
          continue
        }
        // An explicit `deleted: false` is the re-add. Drop the field once it has
        // done its job so a revived instance is stored as a plain one.
        if (INSTANCE_DELETED_FIELD in merged) delete merged[INSTANCE_DELETED_FIELD]
        byId.set(patch.instanceId, merged)
      }
      out.indicatorInstances = [...byId.values()]
    } else if (_OVERRIDE_SECTION_KEYS.includes(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = { ...(base[k] || {}), ...v }
    } else {
      out[k] = v
    }
  }
  return out
}
