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
//
// ⭐⭐ 2026-09-28 — THE MEASUREMENT ARRIVED, AND IT IS NOT A SLACK. TradingView
// collects in BATCHES (`GC_BATCH` below): nothing happens until a family passes
// `capacity + 5`, then it is cut back to `capacity`, sparing the running bar's
// creates and anything a drawing variable holds. A fixed `slack` cannot express
// that — the held count cycles through six values depending on the phase of the
// last bar. The rule lives in `objectRuntime`'s create, the ONLY collector any
// lane runs (both the columnar lane's `evaluateObjects` and the runtime lane's
// `beginObjects` go through it). `createObjectPool` below is imported by nothing
// but its own tests and keeps the strict primitive; it is not a lane.

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

/**
 * ⭐⭐ TRADINGVIEW'S COLLECTOR, MEASURED (2026-09-28, triage class C7).
 *
 * The "approximate" limit is a BATCHED collector, and it is exact once read by
 * id. A family is collected only when a create takes its live count past
 * `capacity + GC_BATCH`; the collection then deletes the OLDEST objects until
 * `capacity` remain, skipping two kinds of object:
 *
 *   · one created on the bar that is running (the bar's own creates are spared,
 *     so a bar that creates more than `capacity` keeps all of them)
 *   · one a drawing variable currently holds (a `var box b = box.new(…)` is
 *     never collected — it still COUNTS toward the total)
 *
 * ⭐ W-C22-DEL r6 — an object held only in an ARRAY: for BOXES it is WITNESSED —
 * it is collected like any other box (not spared). `sonarlab-order-blocks-spy-1d`
 * keeps every box in a `var array<box>` (`max_boxes_count = 20`): TradingView holds
 * 24, this collector (array members not spared) gives 24/24, and sparing them would
 * give 36. ⛔ NOT witnessed: lines, labels and polylines in an array, and any
 * family in a map, a matrix or a UDT field — where the collector reaches one, both
 * lanes withhold the family (`objectRuntime.js`, `runtime/objectStore.js`), queued
 * as Q-C22-1 (`docs/pine/capture-queue-2026-11-10-c22-array-gc.md`).
 *
 * The live count therefore saw-tooths between `capacity` and
 * `capacity + GC_BATCH` (`label.all` read per bar: 5,6,…,10 then 5 at cap 5).
 * Measured on eight TradingView captures of `vw-object-gc-{a,b,c,d}.pine`
 * (AMEX:SPY 1D and 1W, caps 3/5/7/50): a model of this rule reproduces every
 * held set id for id, 24 of 24 families, and the engine reproduces the 18 it can
 * run (probe D reads `label.all`, which the member door refuses) — plus the
 * corpus rows that had no rule, id for id: makuchaku 51, ultimate-pivot 51/51,
 * contraction-box 50, multi-timeframe S&D 504 of 500. Five, not any other
 * offset: offsets 0–11 were scanned and only 5 fits all 24.
 * `objectRuntime`'s create is the one collector that implements it. */
export const GC_BATCH = 5

/** The live count above which a create triggers a collection — see `GC_BATCH`. */
export function collectsAbove(capacity) {
  return capacity + GC_BATCH
}

/** ⭐⭐ DRAW-1 (2026-11-16, coordinator ruling) — A BOX FAMILY WHOSE COLLECTOR RAN IS WITHHELD BY NAME
 *  ON THE RUNTIME LANE. The reference calls `max_boxes_count` approximate ("The count is approximate;
 *  more drawings than the specified count may be displayed."), and the batch rule above does not hold
 *  for every box script: inside-bar-boxes (rddt 1d, 2026-11-14) made 158 boxes on both sides
 *  (TradingView's newest id 158, ours 158), every one of the 50 boxes both sides hold agrees, and
 *  TradingView holds 52 (ids 107-158) where this rule holds 50 (109-158). Which of the oldest boxes
 *  TradingView still shows once the collector has run is therefore not settled, and the run's store
 *  withholds the box family (`runtime/objectStore.js` `collect`); the member reads
 *  `NOT_SHOWN.COUNT_AT_CAP` (`ast/objectLoss.js`). Capture queue Q-DRAW-CAP-1/2
 *  (`tools/visual_conformance/probes/vw-draw-count-at-cap.pine`).
 *  For boxes the committed captures DISAGREE: sonarlab-order-blocks (spy, brk-a; cap 20) hold 24 boxes,
 *  every one paired, as this rule predicts, and inside-bar-boxes holds two more than it predicts. Which
 *  of the two applies to a given script is the unsettled question, so a box family is withheld once
 *  its collector runs, whichever shape the script has.
 *  ⛔ BOXES ONLY, on purpose: labels and lines reach their caps in served runtime-lane scripts too, and
 *  there every committed capture whose collector ran agrees with this rule (parabolic-sar-rddt-1d-
 *  2026-11-15: 52 labels held, every one paired, runtime-on MATCH; trendlines-spy and
 *  swing-highlow-zigzag-chartprime-spy: 52 lines, every one paired). Polylines (cap 100) reach no cap
 *  in a committed capture, and tables are withheld past their count already (`objectStore.js`). */
export const COUNT_AT_CAP_FAMILIES = Object.freeze(['box'])
/** ⭐⭐ DRAW-1 GC (2026-11-17, coordinator ruling after the engine-66 regression) — THE CARVE-OUT IS THE
 *  SHAPE THE CAPTURES DO NOT WITNESS, NEVER THE WHOLE FAMILY. Withholding every box family whose collector
 *  ran threw away TradingView's own garbage collection where it IS witnessed: rs-arm-label-last-bar-spy
 *  (s10, cap 500: TradingView holds the newest 503, ours drew 0), sonarlab-order-blocks (boxes in arrays,
 *  cap 20: 24 held, every one paired). The committed vw-draw-count-at-cap captures (2026-11-16, cap 20,
 *  one create per family every third bar) separate the shapes: lines never held and labels held in a
 *  `var` follow C7 on both charts (SPY 22 / 22 of 2836 made, RDDT 25 / 25 of 223), while BOXES held in a
 *  `var` whose PAST value the script reads (`box.set_right(myBox[1], ...)`, inside-bar-boxes' shape) hold
 *  20 and 23: C7 does not describe them, as it did not describe inside-bar-boxes (52 where it holds 50).
 *  So a box family is withheld only when its collector runs AND the script reads a past value of a
 *  variable holding a box (`historyHeldOf`); every other box family keeps C7: the oldest dropped, the
 *  newest kept. */
export const COUNT_AT_CAP_GUARD = 'objects:count-at-cap'
export const COUNT_AT_CAP_PREFIX = 'The script held more '
/** The store's reason for a family withheld because its collector ran. */
export function countAtCapReason(family, capacity) {
  const plural = family === 'box' ? 'boxes' : `${family}s`
  return `${COUNT_AT_CAP_PREFIX}${plural} than its maximum count (${capacity}) and TradingView's collector ran; `
    + `which of the oldest TradingView still shows then is not measured for a script that reads a past value of `
    + `the variable holding its ${plural}`
}

/** ⭐ DRAW-1 GC — the families of `COUNT_AT_CAP_FAMILIES` whose handle a script keeps in a variable it
 *  reads at a past offset (`myBox[1]`), off the stripped source (comments and strings out,
 *  `pine.js::strippedForScan`), as `{ historyHeld: [...] }` beside the declared caps, or `{}`. A name is a
 *  family's when it is declared with the family's type (`var box b = na`, `box b = ...`) or assigned that
 *  family's constructor (`b := box.new(...)`); an array of them (`box[]`) is not a name of this kind. */
export function historyHeldOf(stripped) {
  const s = String(stripped || '')
  const out = []
  for (const fam of COUNT_AT_CAP_FAMILIES) {
    const names = new Set()
    for (const m of s.matchAll(new RegExp(`\\b${fam}\\s+([A-Za-z_]\\w*)\\s*=`, 'g'))) names.add(m[1])
    for (const m of s.matchAll(new RegExp(`\\b([A-Za-z_]\\w*)\\s*:?=\\s*${fam}\\.new\\b`, 'g'))) names.add(m[1])
    for (const n of names) {
      if (new RegExp(`\\b${n}\\s*\\[\\s*\\d+\\s*\\]`).test(s)) { out.push(fam); break }
    }
  }
  return out.length ? { historyHeld: out } : {}
}

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
