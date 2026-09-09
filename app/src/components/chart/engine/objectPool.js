// app/src/components/chart/engine/objectPool.js
//
// ─── R0.2 — PINE'S DRAWING-OBJECT QUOTA AND ITS SILENT FIFO EVICTION ─────────
//
// ⚠️⚠️ THERE IS ALREADY A `pool.js` IN THIS DIRECTORY AND IT IS NOT THIS. That one
// pools **lightweight-charts series** for reuse across symbol flips (its key is
// the LWC series type). This one models **Pine's `max_lines_count` /
// `max_labels_count` / `max_boxes_count` / `max_polylines_count` budgets** and
// their eviction rule. Neither is the other; a grep for "pool" finds the wrong
// file half the time, so both headers say so.
//
// ─── WHAT PINE ACTUALLY DOES ────────────────────────────────────────────────
//
// Four independent FIFO pools (spec C152). When one overflows, the OLDEST object
// is deleted automatically, silently, with no runtime error (C156). `*.all` is
// read-only and oldest-first, and *"index zero … is the ID of the oldest object
// on the chart"* — index 0 is always the next victim, which is why the documented
// "keep only N" idiom is `label.delete(array.get(label.all, 0))`.
//
// ⛔⛔ THE POOL NEVER LOOKS INSIDE A PAYLOAD, AND THAT IS HOW IT GETS THE QUOTA
// RIGHT. Pine charges a slot for things that draw nothing: a label with `x = na`
// (*"its ID still exists and thus contributes to a script's drawing totals"*), a
// zero-length line, a zero-area box, `box.new(na, na, na, na)` — which is a
// documented idiom for a live-but-invisible box — and every `*.copy()` result. A
// pool that skipped "empty" objects would keep MORE than Pine does and diverge
// exactly where an author was leaning on the quota. So: it counts IDs. Only IDs.
//
// ─── ⚠️ THE ONE PLACE WE KNOWINGLY DIFFER FROM TRADINGVIEW ──────────────────
//
// TradingView's own enforcement is APPROXIMATE and the reference says so for all
// four types: *"The limit specified by the argument is approximate; the script
// might display more drawings than specified."* The user manual's worked example
// observes **54** labels under the ~50 default. The spec's ruling from that:
//
//   ⇒ a renderer must NOT assert `count <= max_*_count`, and must NOT assume
//     exactly `max_*_count` objects survive. Treat it as a RETENTION FLOOR.
//
// This pool evicts at exactly `capacity`, so it can show a few FEWER of the very
// oldest objects than TradingView would. That direction is deliberate: missing
// the oldest is a far quieter wrong answer than inventing drawings the script's
// budget did not pay for, and the oldest end is the least load-bearing end of a
// FIFO. `slack` is the knob that closes the gap the day it is measured — it
// defaults to 0 because ONE observation (54 under ~50) is one data point, not a
// rate, and a slack derived from it would be a guessed number wearing a
// measurement's clothes. Tracked as verification debt.
//
// ⭐ `size <= capacity` is therefore OUR guarantee about OUR pool, never a claim
// about Pine. Nothing downstream may use it to validate a TradingView capture.

/** The four FIFO drawing pools, with the parameter that sizes each one.
 *
 *  `since` is the Pine version the TYPE arrived in, from
 *  `docs/pine/pine-version-evolution.md`: label + line v4 (June 2019), box v4
 *  (May 2021), polyline v5 (October 2023). Drawing objects do not exist at all
 *  before v4 — v1–v3 is *"plot family + hline/fill/bgcolor/barcolor, no drawing
 *  objects"* — so a pool requested for an older script is a translator bug, not
 *  a rendering decision, and is refused by name.
 *
 *  Provenance: docs/pine/pine-presentation-spec.md §3.1 + C152–C156;
 *  docs/pine/pine-version-evolution.md rows 15, 41, 251–257. */
export const POOL_LIMITS = Object.freeze({
  line: Object.freeze({ param: 'max_lines_count', fallback: 50, ceiling: 500, since: 4 }),
  label: Object.freeze({ param: 'max_labels_count', fallback: 50, ceiling: 500, since: 4 }),
  box: Object.freeze({ param: 'max_boxes_count', fallback: 50, ceiling: 500, since: 4 }),
  polyline: Object.freeze({ param: 'max_polylines_count', fallback: 50, ceiling: 100, since: 5 }),
})

export const OBJECT_KINDS = Object.freeze(Object.keys(POOL_LIMITS))

/** The lowest Pine version with any drawing object at all. */
export const DRAWINGS_SINCE_VERSION = 4

/** Kinds that exist but are NOT FIFO-budgeted, and why. Refused by name rather
 *  than quietly pooled — treating either as FIFO would evict an object Pine
 *  keeps, and that is invisible on a chart. */
export const NOT_FIFO = Object.freeze({
  table:
    'tables have no max_tables_count. At most 9 render, one per position.* anchor, and a ' +
    'same-position collision is resolved newest-wins with the loser silently not rendered ' +
    'while STILL existing in table.all. That is position-keyed, not FIFO — it needs its own ' +
    'allocator.',
  linefill:
    'linefills have no documented cap and no max_*_count. A linefill is tied to its two lines: ' +
    'deleting either line deletes the linefill. It is a dependent of the line pool, not a pool ' +
    'of its own — cascade it from the line pool onEvict hook.',
})

/** One polyline consumes ONE slot regardless of point count: 10,000 points = 1
 *  id. The number is the per-polyline VERTEX budget and belongs beside the quota
 *  it is so often confused with.
 *
 *  ⚠️ This pool does not enforce it and must not — the pool never inspects a
 *  payload (see the header). R2's polyline primitive is its consumer. */
export const POLYLINE_MAX_POINTS = 10000

function requireKind(kind) {
  if (POOL_LIMITS[kind]) return POOL_LIMITS[kind]
  if (NOT_FIFO[kind]) throw new Error(`${kind} is not a FIFO drawing pool — ${NOT_FIFO[kind]}`)
  throw new Error(`unknown drawing object kind: ${kind}`)
}

/**
 * The retention floor for one pool, clamped to the range Pine documents.
 *
 * @param {string} kind
 * @param {number|null|undefined} requested  the script's `max_*_count`, if any
 * @param {number} pineVersion
 * @returns {{capacity: number, clamped: boolean, param: string}}
 *
 * ⚠️ AN OUT-OF-RANGE REQUEST IS CLAMPED AND REPORTED, NOT REFUSED. Every
 * `max_*_count` is `const int`, so Pine rejects a bad one at COMPILE time and a
 * value reaching us out of range means our own translator let it through. Failing
 * the render would hide that behind a blank chart; clamping keeps the indicator
 * drawing and leaves `clamped` for the caller to surface. The translator owns the
 * refusal — one authority per decision.
 */
export function resolveCapacity(kind, requested, pineVersion = 6) {
  const limit = requireKind(kind)
  if (pineVersion < limit.since) {
    throw new Error(
      `${kind} does not exist in Pine v${pineVersion} — it arrived in v${limit.since}` +
      (pineVersion < DRAWINGS_SINCE_VERSION
        ? `; v1–v${DRAWINGS_SINCE_VERSION - 1} has no drawing objects at all`
        : ''),
    )
  }
  if (requested === null || requested === undefined) {
    return { capacity: limit.fallback, clamped: false, param: limit.param }
  }
  const n = Math.trunc(Number(requested))
  if (!Number.isFinite(n)) {
    return { capacity: limit.fallback, clamped: true, param: limit.param }
  }
  // ⚠️ `clamped` is measured against what was ASKED FOR, not against the
  // truncated integer. `max_*_count` is `const int`, so a float can never
  // legally reach here — silently truncating 12.9 to 12 and calling that
  // unclamped would hide the translator bug that produced the float.
  const capacity = Math.min(Math.max(n, 1), limit.ceiling)
  return { capacity, clamped: capacity !== Number(requested), param: limit.param }
}

/**
 * One FIFO drawing pool for one object kind, for one script instance.
 *
 * @param {string} kind  'line' | 'label' | 'box' | 'polyline'
 * @param {object} [opts]
 * @param {number} [opts.capacity]     the script's `max_*_count`; defaults to ~50
 * @param {number} [opts.pineVersion]
 * @param {number} [opts.slack]        extra objects retained above capacity — see the header
 * @param {(id:number, payload:any) => void} [opts.onEvict]  called for every
 *        automatic eviction AND every explicit delete, so a dependent (linefill)
 *        can cascade. It is called AFTER the slot is freed.
 *
 * ⛔ ONE POOL PER KIND PER SCRIPT INSTANCE. Two instances of the same indicator
 * do not share a budget, and consumption in one kind never evicts from another
 * (C152). That is guaranteed structurally here — each pool is its own closure
 * over its own map — but it is asserted in the tests anyway, because "structural"
 * is exactly the kind of guarantee a later refactor into a shared registry
 * quietly removes.
 */
export function createObjectPool(kind, {
  capacity: requested,
  pineVersion = 6,
  slack = 0,
  onEvict = null,
} = {}) {
  const { capacity, clamped, param } = resolveCapacity(kind, requested, pineVersion)
  const retain = capacity + Math.max(0, Math.trunc(Number(slack) || 0))

  // Insertion order IS creation order for a JS Map, which is exactly the FIFO
  // order Pine's `.all` exposes — so the order is a property of the structure
  // rather than a sort we have to keep correct on every mutation.
  const live = new Map()
  let nextId = 1
  let evicted = 0

  /** ⛔ IDS ARE NEVER REUSED. A recycled id lets a stale handle — a `line` still
   *  referenced by a linefill, an object captured in a closure — resurrect a
   *  deleted object as whatever now occupies its slot. Monotonic ids make that
   *  class of bug impossible rather than unlikely. */
  function allocate(payload) {
    const id = nextId++
    live.set(id, payload)
    return id
  }

  function release(id) {
    const payload = live.get(id)
    live.delete(id)
    if (onEvict) onEvict(id, payload)
  }

  function evictToFit() {
    while (live.size > retain) {
      // Index 0 of Pine's `.all` — the oldest object, always the next victim.
      const oldest = live.keys().next().value
      release(oldest)
      evicted += 1
    }
  }

  return {
    kind,
    capacity,
    retain,
    param,
    /** True when the script's `max_*_count` was outside Pine's documented range
     *  and we clamped it. The caller decides whether to surface it. */
    capacityClamped: clamped,

    get size() { return live.size },
    /** Automatic evictions only — an explicit `delete()` is not one. */
    get evictedCount() { return evicted },

    /**
     * Allocate an id. Silently evicts the oldest object if that overflows.
     * @returns {number} the new id
     */
    add(payload) {
      const id = allocate(payload)
      evictToFit()
      return id
    },

    /**
     * Clone into a NEW independent object with a NEW id and a NEW slot — Pine's
     * `*.copy()`. *"Any changes to the copied box do not affect the original."*
     * The clone is shallow; the caller owns payload depth.
     * @returns {number|null} the new id, or null if `id` is not live
     */
    copy(id) {
      if (!live.has(id)) return null
      const src = live.get(id)
      const clone = src && typeof src === 'object' && !Array.isArray(src) ? { ...src } : src
      return this.add(clone)
    },

    get(id) { return live.get(id) },
    has(id) { return live.has(id) },

    /**
     * Free a slot. **Idempotent** — Pine's `*.delete()` on an already-deleted or
     * never-existing id *"does nothing"* and raises no error.
     * @returns {boolean} whether this call actually freed a slot
     */
    delete(id) {
      if (!live.has(id)) return false
      release(id)
      return true
    },

    /** Ids oldest-first. Index 0 is the next eviction victim — the same contract
     *  as `label.all` / `line.all` / `box.all` / `polyline.all`, which are all
     *  documented read-only and oldest-first. The returned array is a copy, so a
     *  caller mutating it cannot corrupt the pool's order. */
    all() { return [...live.keys()] },

    /** Every live payload, oldest-first. */
    values() { return [...live.values()] },

    /** Drop everything without firing onEvict — for tearing an instance down,
     *  not for a script-visible operation. Pine has no bulk delete. */
    clear() { live.clear() },
  }
}

/**
 * The four pools one script instance needs, sized from its declaration.
 *
 * @param {object} [maxCounts]  e.g. `{max_labels_count: 200}` — the parameter
 *        NAMES as written in Pine, so a caller passes the declaration through
 *        rather than re-deriving a mapping from parameter to kind.
 * @param {object} [opts] `{pineVersion, slack, onEvict}` applied to every pool
 * @returns {Record<string, object>} keyed by kind; omits kinds the version lacks
 *
 * ⚠️ A KIND THE SCRIPT'S VERSION CANNOT HAVE IS OMITTED, NOT EMPTY. A v4 script
 * gets no `polyline` key at all, so a consumer that reaches for one gets an
 * immediate `undefined` at the call site instead of a pool that accepts polylines
 * and silently draws them onto a chart no v4 script could have produced.
 */
export function createPoolSet(maxCounts = {}, { pineVersion = 6, slack = 0, onEvict = null } = {}) {
  const pools = {}
  for (const kind of OBJECT_KINDS) {
    const { param, since } = POOL_LIMITS[kind]
    if (pineVersion < since) continue
    pools[kind] = createObjectPool(kind, {
      capacity: maxCounts?.[param],
      pineVersion,
      slack,
      onEvict,
    })
  }
  return pools
}
