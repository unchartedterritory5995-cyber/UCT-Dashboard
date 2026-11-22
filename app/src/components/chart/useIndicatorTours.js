// app/src/components/chart/useIndicatorTours.js
//
// ─── WHICH INDICATOR TOURS THIS MEMBER HAS SEEN (UCT RS Phase 4, unit 4-03) ──
//
// A definition may declare `meta.tour` (engine/defSchema.js): a few cards shown
// once, on the first add. This hook is the seen-state for every such tour, keyed
// by DEFINITION id, in ONE preference: `indicator_tours_seen`, a map
// `defId -> ISO date` (the moment the member finished or skipped it). It knows no
// indicator by name; the library and its host pass the id.
//
// ⛔⛔ NEVER A BLIND `setPref`. The `notebook_tours` rule (tourSeenState.js, R8)
// applies here unchanged: a whole-map overwrite computed from an old snapshot
// erases every other tour's row. So `markSeen` writes through `setPrefMerged`,
// whose updater runs over the FRESHEST cache value, and the merge is a UNION
// (`mergeToursSeen`) — a row, once written, is never dropped by a later write.
//
// ⛔ AND A RE-READ FIRST, FOR THE SECOND TAB. `setPrefMerged` merges over THIS
// tab's cache, and a tab never re-reads the preferences after it loads, so a tab
// opened before another tab marked tour A would post a map without A. `markSeen`
// therefore reads the server's current copy of this one key, unions it into the
// cache (`mergeIntoPreferenceCache`, no request), and only then merges its own
// row. The remaining window is two tabs writing within one round trip of each
// other; a per-row server door like `notebook_tours`' would close it and is
// server work this unit does not include.
import { useCallback, useMemo } from 'react'
import usePreferences, { mergeIntoPreferenceCache, parsePref, PREFS_URL, beginPrefsOp } from '../../hooks/usePreferences'

export const INDICATOR_TOURS_PREF = 'indicator_tours_seen'

/** The whole map, parsed defensively: always a plain object of `defId -> string`.
 *  A row whose value is not a non-empty string is dropped (it carries no date). */
export function readToursSeen(raw) {
  const v = parsePref(raw, null)
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out = {}
  for (const [k, d] of Object.entries(v)) {
    if (k && typeof d === 'string' && d) out[k] = d
  }
  return out
}

/** The union of two maps. Where both hold a row, the EARLIER date is kept: the
 *  member first saw the tour then, and a second tab's later mark changes nothing. */
export function mergeToursSeen(a, b) {
  const out = { ...readToursSeen(a) }
  for (const [k, d] of Object.entries(readToursSeen(b))) {
    out[k] = out[k] && out[k] <= d ? out[k] : d
  }
  return out
}

const sameKeys = (a, b) => {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

/** The server's stored copy of the map, or null when it could not be read. */
async function readServerCopy() {
  try {
    const res = await fetch(PREFS_URL)
    if (!res || !res.ok) return null
    const body = await res.json()
    if (!body || typeof body !== 'object') return null
    return readToursSeen(body[INDICATOR_TOURS_PREF])
  } catch {
    return null
  }
}

/**
 * @param {boolean} [enabled=true] false ⇒ no preferences read at all (`usePreferences(false)`):
 *        every tour reads unseen and `markSeen` writes nothing. For a surface mounted where no
 *        host listens for a first add.
 * @returns {{ seen: (defId: string) => boolean, markSeen: (defId: string, now?: Date) => Promise<boolean>, loading: boolean }}
 */
export default function useIndicatorTours(enabled = true) {
  const { prefs, setPrefMerged, loading } = usePreferences(enabled)
  const raw = prefs[INDICATOR_TOURS_PREF]
  const map = useMemo(() => readToursSeen(raw), [raw])

  const seen = useCallback(
    (defId) => !!defId && Object.prototype.hasOwnProperty.call(map, defId),
    [map],
  )

  const markSeen = useCallback(async (defId, now = new Date()) => {
    if (!enabled || !defId) return false
    const op = beginPrefsOp()                 // the member this mark is FOR (begun before any await)
    const server = await readServerCopy()
    if (op.stale()) return false
    if (server) {
      await mergeIntoPreferenceCache(
        INDICATOR_TOURS_PREF,
        (current) => {
          const merged = mergeToursSeen(current, server)
          return sameKeys(merged, readToursSeen(current)) ? undefined : merged
        },
        op,
      )
      if (op.stale()) return false
    }
    const stamp = now.toISOString()
    const out = await setPrefMerged(INDICATOR_TOURS_PREF, (current) => {
      const local = readToursSeen(current)
      // Nothing to add AND the server already holds every row this tab knows: no write.
      if (local[defId] && server && sameKeys(mergeToursSeen(local, server), server)) return undefined
      return mergeToursSeen(local, { [defId]: stamp })
    }, op)
    return out !== false
  }, [enabled, setPrefMerged])

  return { seen, markSeen, loading }
}
