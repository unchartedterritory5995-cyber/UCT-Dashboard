import useSWR from 'swr'
import { useCallback } from 'react'
import { mergeSettingsOverride } from '../components/chart/chartDefaults'

const fetcher = url => fetch(url).then(r => r.ok ? r.json() : {})

const DEFAULTS = {
  default_chart_tf: 'D',
  // OLED Black is the app-wide default theme for anyone who hasn't picked one in
  // Settings. setPref only ever persists an EXPLICIT choice, so users who chose a
  // theme (incl. Midnight) keep theirs; everyone else now loads on OLED.
  theme: 'oled',
}

const PREFS_URL = '/api/auth/preferences'

/** The one pref whose value is a structured document several writers edit at
 *  once, and therefore the one that gets a merge rule of its own below. */
const CHART_SETTINGS_KEY = 'chart_settings'

// Preferences are stored server-side as TEXT. Reads can therefore come back as
// a JSON string (the normal case) OR — from the optimistic cache below — as an
// already-parsed object/array. Parse defensively and fall back on bad input.
export function parsePref(raw, fallback) {
  if (raw == null) return fallback
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) } catch { return fallback }
}

// ─── Per-key write queue ─────────────────────────────────────────────────────
//
// MODULE-level, not per-hook, and that is the whole point: sixteen grid cells
// call `usePreferences()` sixteen times, so a ref inside the hook would give
// each writer its own queue and serialise nothing. The SWR cache these writers
// share is module-global too, so the queue that guards it has to live at the
// same scope.
//
// It exists because merging atomically is only half the fix. Two POSTs in
// flight at once can be delivered in either order, and the server keeps
// whichever ARRIVES last — which may be the earlier, smaller blob, undoing the
// merge that had just been computed correctly. One request per key at a time
// makes arrival order equal merge order.
const _writeChains = new Map()

function queueWrite(key, task) {
  const previous = _writeChains.get(key) || Promise.resolve()
  const next = previous.then(task)
  // Store a NEUTRALISED handle, never `next` itself. If a failed write stayed in
  // the chain as a rejected promise, every later write for that key would be
  // skipped behind it — one flaky POST and settings silently stop saving until
  // reload, which is a worse bug than the one this queue exists to fix. The
  // caller still gets `next`, so it sees its own failure.
  _writeChains.set(key, next.then(() => {}, () => {}))
  return next
}

/**
 * Build the blob to persist for `chart_settings`.
 *
 * `mergeSettingsOverride` is IMPORTED, not reimplemented: it already carries the
 * merge-instances-by-`instanceId` rule (`chartDefaults.js:438-448`) that the
 * multi-chart grid needed for exactly the same reason, and a second copy of that
 * rule would be a second thing to keep correct.
 *
 * Applying it here is what protects an updater that ignores its argument — which
 * is the shape EVERY existing caller has, since they build a whole `persisted`
 * blob out of a possibly-stale `cs` and hand it over. Union-by-id means such a
 * writer cannot delete an instance it never knew about.
 *
 * The flip side, stated plainly: union-by-id also cannot express a REMOVAL, and
 * last-write-wins still governs any scalar both writers name. This is add
 * protection, not a CRDT. It is the right trade for now because losing an add is
 * silent and unrecoverable while a resurrected delete is visible and can simply
 * be redone — and because nothing writes instances in B2 at all.
 */
function resolveWriteValue(key, current, next) {
  if (key !== CHART_SETTINGS_KEY) return next

  const patch = typeof next === 'string' ? parsePref(next, null) : next
  const isMergeable = v => v && typeof v === 'object' && !Array.isArray(v)
  if (!isMergeable(patch)) return next          // nothing to merge into shape
  if (!isMergeable(current)) return patch       // no base yet: the patch IS the blob
  return mergeSettingsOverride(current, patch)
}

export default function usePreferences() {
  const { data, mutate, isLoading } = useSWR(PREFS_URL, fetcher, {
    dedupingInterval: 300000, // 5 min
    revalidateOnFocus: false,
  })

  // Merge server prefs over defaults
  const prefs = { ...DEFAULTS, ...(data || {}) }

  const setPref = useCallback(async (key, value) => {
    // The backend's SetPreferenceRequest types `value` as a str, so an
    // object/array would be rejected with a 422. Coerce non-strings to JSON
    // here so callers can pass structured values transparently (read them
    // back with parsePref).
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    // Optimistic update
    mutate(prev => ({ ...DEFAULTS, ...prev, [key]: serialized }), false)
    try {
      await fetch(PREFS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: serialized }),
      })
    } catch {
      // Revert on failure
      mutate()
    }
  }, [mutate])

  /**
   * Write a preference by TRANSFORMING the freshest value, instead of
   * overwriting it with a snapshot.
   *
   * `setPref(key, value)` takes a value the caller computed at some earlier
   * moment and blind-writes it. With up to sixteen chart widgets each holding
   * their own copy of `chart_settings`, "some earlier moment" is routinely
   * before another cell's write, and the second POST erases the first. This is
   * not a risk the engine introduces — it can already lose an indicator toggle
   * today (see `usePreferences.test.js`, which reproduces it).
   *
   *   setPrefMerged('chart_settings', cs => ({ ...cs, indicatorInstances: [...] }))
   *
   * `updater(current) -> next` runs INSIDE the SWR cache update, so `current` is
   * whatever the cache holds at that instant — after any write that has already
   * landed, never the value this component last rendered with. SWR's functional
   * mutate reads and writes the cache in one synchronous step, so two writers
   * cannot interleave between the read and the write.
   *
   * Returning `undefined` from the updater abandons the write entirely (nothing
   * to change ⇒ no request). An updater that THROWS abandons it too, and the
   * error is re-thrown rather than swallowed — a broken updater should be a
   * visible failure, not a setting that silently stops saving.
   *
   * Existing `setPref` callers are deliberately untouched: migrating them all is
   * a change to every settings surface in the app and belongs in its own step.
   *
   * @param {string} key
   * @param {(current: any) => any} updater
   */
  const setPrefMerged = useCallback(async (key, updater) => {
    let serialized = null
    let updaterError = null

    await mutate(prev => {
      const base = { ...DEFAULTS, ...prev }
      const current = parsePref(base[key], undefined)

      let next
      try {
        next = typeof updater === 'function' ? updater(current) : updater
      } catch (err) {
        updaterError = err
        return prev            // leave the cache exactly as it was
      }
      if (next === undefined) return prev

      const resolved = resolveWriteValue(key, current, next)
      serialized = typeof resolved === 'string' ? resolved : JSON.stringify(resolved)
      return { ...base, [key]: serialized }
    }, false)

    if (updaterError) throw updaterError
    if (serialized === null) return

    // The value is FROZEN at merge time and the POSTs are queued in that same
    // order, so what the server ends up with is what the last merge computed.
    //
    // The POST deliberately does NOT swallow its own failure: the queue has to
    // SEE a rejected write to keep itself unwedged, and a task that always
    // resolves would make that handling unreachable. The revert therefore hangs
    // off the returned promise, which still resolves — a fire-and-forget caller
    // never gets an unhandled rejection.
    return queueWrite(key, () => fetch(PREFS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: serialized }),
    })).catch(() => {
      // Revert on failure — same contract as setPref.
      mutate()
    })
  }, [mutate])

  return { prefs, setPref, setPrefMerged, loading: isLoading }
}
