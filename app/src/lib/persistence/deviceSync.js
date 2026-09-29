// TERM-076 (FB-A12-02) — the member-facing matrix of "what syncs across your devices", DERIVED
// from the census manifest. Nothing here names a key or a store: the manifest's `scope` (itself
// derived by `tools/persistence_census.mjs` from the call each key actually uses) decides which
// list a row lands in, so moving a key between stores moves its row with no copy edit.
import MANIFEST from './persistenceManifest.json'

/** Kinds a member would recognise as theirs. `cache` and `internal` rows are counted, not
 *  listed, when they stay on the device — they speed things up or steer rollouts, and clearing
 *  them loses nothing a member made. Anything that follows the ACCOUNT is always listed. */
export const MEMBER_KINDS = new Set(['setting', 'work', 'state'])

const bySurface = (rows) => {
  const groups = new Map()
  for (const r of rows) {
    if (!groups.has(r.surface)) groups.set(r.surface, [])
    groups.get(r.surface).push(r)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([surface, items]) => ({ surface, items: items.sort((x, y) => x.label.localeCompare(y.label)) }))
}

export function deviceSyncMatrix(manifest = MANIFEST) {
  const row = (e) => ({ id: `${e.store}:${e.key}`, surface: e.surface, label: e.label, store: e.store, kind: e.kind })
  const cross = manifest.entries.filter((e) => e.scope === 'cross-device')
  const local = manifest.entries.filter((e) => e.scope === 'device-local')
  return {
    crossDevice: bySurface(cross.map(row)),
    deviceLocal: bySurface(local.filter((e) => MEMBER_KINDS.has(e.kind)).map(row)),
    background: local.filter((e) => !MEMBER_KINDS.has(e.kind)).length,
  }
}
