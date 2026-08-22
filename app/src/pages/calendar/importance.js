// app/src/pages/calendar/importance.js
// Pure helpers — no React, no fetch. THE hierarchy algorithm: one number
// (imp) ranks every reporter, one boost (imp_eff) personalizes it, one tier
// map drives Board, Week, and Month identically so the views can never
// disagree about what matters.
//
// Computed CLIENT-side over the payloads the client already joins (week +
// day-metrics + enrichment) — the server cannot see mc_b/expected-move at
// build time on the live path, and a server-side imp would flip the Main
// Event seconds after first paint when the enrichment overlay lands.

// ── math ─────────────────────────────────────────────────────────────────────

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length }

function std(xs, mu) {
  const v = xs.reduce((a, b) => a + (b - mu) * (b - mu), 0) / xs.length
  return Math.sqrt(v)
}

// z-scores over the DEFINED values only; entries missing the field contribute
// 0 to imp (neither rewarded nor punished for provider gaps).
function zMap(values) {
  const defined = values.filter(v => v != null && Number.isFinite(v))
  if (defined.length < 2) return () => 0
  const mu = mean(defined)
  const sd = std(defined, mu)
  if (sd === 0) return () => 0
  return v => (v == null || !Number.isFinite(v)) ? 0 : (v - mu) / sd
}

const ln1p = v => (v == null || !Number.isFinite(v) || v < 0) ? null : Math.log(1 + v)

// ── imp / imp_eff ────────────────────────────────────────────────────────────

export function hasDatum(e) {
  return e.eps_est != null || e.rev_est != null || e.eps_act != null ||
         e.expected_move?.pct != null
}

/**
 * computeImportance(entries) → Map sym → imp
 * entries: EVERY entry of the visible week (all days, all sessions) — the
 * z-score population must be the whole week so a Tuesday microcap and a
 * Thursday megacap are ranked on one scale.
 */
export function computeImportance(entries) {
  const ews  = entries.map(e => ln1p(e.ew))
  const caps = entries.map(e => ln1p(e.mc_b))
  const dvol = entries.map(e => {
    const v = (e._avg_vol != null && e._price != null) ? e._avg_vol * e._price : null
    return ln1p(v)
  })
  const _zEw  = zMap(ews)
  const _zCap = zMap(caps)
  const _zDv  = zMap(dvol)

  const out = new Map()
  entries.forEach((e, i) => {
    const em = e.expected_move?.pct
    const emTerm = (em != null && Number.isFinite(em))
      ? Math.min(Math.max(em / 5, 0), 3)
      : 0
    const imp =
      2.0  * _zEw(ews[i]) +
      1.5  * _zCap(caps[i]) +
      1.0  * _zDv(dvol[i]) +
      0.75 * emTerm
    out.set(e.sym, Math.round(imp * 100) / 100)
  })
  return out
}

/** Personal boost on top of imp — mirrors the my-sets join. */
export function impEff(imp, entry) {
  const src = entry._sources || []
  let boost = 0
  if (src.includes('positions')) boost += 3.0
  if (src.includes('watchlist') || src.includes('flagged')) boost += 2.0
  if (src.includes('uct20')) boost += 1.0
  return imp + boost
}

// ── ordering ─────────────────────────────────────────────────────────────────

/** Positive finite, else null. A 0/negative cap or ew is a provider gap, not a rank. */
const rankNum = v => (v != null && Number.isFinite(v) && v > 0) ? v : null

/** Descending by value, MISSING values last — never interleaved with real ones. */
function byDesc(av, bv) {
  if (av == null && bv == null) return 0
  if (av == null) return 1
  if (bv == null) return -1
  return bv - av
}

/**
 * rankEntries(rows, impBySym) → a NEW sorted array.
 *
 * THE single ordering authority for the calendar's ranked surfaces (the Week
 * mosaic and the Feed). It was hand-copied into both views as
 * `mine desc || imp desc`, and BOTH keys collapse to zero on first paint:
 *
 *   • `mine` is uniform under the My Stocks audience (every visible row is mine)
 *   • `imp` is 0 for EVERY name until the enrichment-batch and day-metrics-batch
 *     fetches land — computeImportance's zMap() bails to `() => 0` when it has
 *     fewer than two defined values, which is exactly the pre-overlay state.
 *
 * A comparator that returns 0 for every pair makes Array#sort a NO-OP, so the
 * grid rendered the provider's own serialization — alphabetical — for the first
 * seconds of every load and then visibly re-shuffled. Hence the deterministic
 * tail: mc_b and ew ride the BASE /api/calendar payload (they do not wait on an
 * overlay), so first paint is already ranked and the overlay only refines it.
 *
 * Symbol is the LAST key, deliberately — alphabetical is now a considered final
 * tiebreak between genuinely equal rows, never an accident of fetch order.
 */
export function rankEntries(rows, impBySym) {
  const effOf = e => impEff(impBySym?.get?.(e.sym) ?? 0, e)
  const dollarVol = e => (e._avg_vol != null && e._price != null)
    ? e._avg_vol * e._price
    : null
  return [...rows].sort((a, b) =>
    (b.mine === true) - (a.mine === true) ||
    effOf(b) - effOf(a) ||
    byDesc(rankNum(a.mc_b), rankNum(b.mc_b)) ||
    byDesc(rankNum(dollarVol(a)), rankNum(dollarVol(b))) ||
    byDesc(rankNum(a.ew), rankNum(b.ew)) ||
    (a.sym || '').localeCompare(b.sym || '')
  )
}

// ── tiering ──────────────────────────────────────────────────────────────────

export const FEATURED_CAP = 4        // per day, INCLUDING the Main Event
const FEATURED_CAP_MCB = 10          // $10B+ always earns a card
const MAIN_EVENT_PERCENTILE = 0.75   // quiet days get no Main Event

function percentile(sorted, p) {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[idx]
}

/**
 * tierWeek(days, weekDates) → { [ds]: { mainEvent, featured:Set, table:Set, compact:Set } }
 *
 * days: the tagged/merged day map from Calendar.jsx ({bmo, amc, tbd} lists,
 * entries already carrying mine/_sources/expected_move/_price/_avg_vol).
 *
 * Rules (spec, as amended by the adversarial review):
 *   MAIN EVENT — argmax imp_eff of the day, exactly 1, only when its imp_eff
 *     ≥ the WEEK's P75 and it has a datum (quiet days get none).
 *   FEATURED — mine === true OR mc_b ≥ 10 OR top-3 by imp_eff; hard cap 4/day
 *     including the Main Event. A mine name is featured even data-thin.
 *   TABLE — ANY datum (the `AND mc_b≥2` gate is dead: it hid data for the
 *     sub-$2B names this audience trades).
 *   COMPACT — genuinely zero-data names only.
 */
export function tierWeek(days, weekDates) {
  const allEntries = []
  for (const ds of weekDates) {
    const d = days[ds]
    if (!d) continue
    for (const bucket of ['bmo', 'amc', 'tbd']) {
      for (const e of (d[bucket] || [])) allEntries.push(e)
    }
  }
  const impBySym = computeImportance(allEntries)
  const effOf = e => impEff(impBySym.get(e.sym) ?? 0, e)

  const weekEffSorted = allEntries.map(effOf).sort((a, b) => a - b)
  const p75 = percentile(weekEffSorted, MAIN_EVENT_PERCENTILE)

  const out = {}
  for (const ds of weekDates) {
    const d = days[ds]
    if (!d) continue
    const dayEntries = [...(d.bmo || []), ...(d.amc || []), ...(d.tbd || [])]
    const featured = new Set()
    const table = new Set()
    const compact = new Set()

    const withDatum = dayEntries.filter(hasDatum)
    const ranked = [...dayEntries].sort((a, b) => effOf(b) - effOf(a))

    // Main Event: best of the day, only if it clears the week bar
    let mainEvent = null
    const best = ranked.find(hasDatum)
    if (best && effOf(best) >= p75 && withDatum.length > 0) {
      mainEvent = best.sym
    }

    // Featured: mine OR $10B+ OR top-3, cap 4 incl. main
    const wantFeatured = e =>
      e.mine === true ||
      (e.mc_b != null && e.mc_b >= FEATURED_CAP_MCB) ||
      ranked.slice(0, 3).includes(e)
    for (const e of ranked) {
      if (featured.size >= FEATURED_CAP) break
      if (e.sym === mainEvent) continue
      if (!wantFeatured(e)) continue
      if (!hasDatum(e) && !e.mine) continue   // data-thin non-mine → table/compact
      featured.add(e.sym)
    }
    // Main Event occupies one featured slot conceptually
    if (mainEvent && featured.size >= FEATURED_CAP) {
      const arr = [...featured]
      featured.delete(arr[arr.length - 1])
    }

    for (const e of dayEntries) {
      if (e.sym === mainEvent || featured.has(e.sym)) continue
      if (hasDatum(e) || e.mine) table.add(e.sym)
      else compact.add(e.sym)
    }

    out[ds] = { mainEvent, featured, table, compact, impBySym }
  }
  return out
}

// ── the Main Event's zero-LLM editorial line ─────────────────────────────────

function fmtCap(mcB) {
  if (mcB == null || mcB <= 0) return null
  return mcB >= 1000 ? `$${(mcB / 1000).toFixed(1)}T` : mcB >= 1 ? `$${Math.round(mcB)}B` : `$${Math.round(mcB * 1000)}M`
}

/**
 * editorialLine(entry, isLargest) → plain-language one-liner composed from
 * fields already on the entry. Never fabricates: parts render only when
 * their data exists.
 */
export function editorialLine(entry, isLargest) {
  const parts = []
  const cap = fmtCap(entry.mc_b)   // null for missing OR zero-garbage caps
  if (isLargest && cap) {
    parts.push(`Largest report of the day (${cap})`)
  } else if (cap) {
    parts.push(`${cap} market cap`)
  }
  const em = entry.expected_move?.pct
  if (em != null) {
    let s = `options price a ±${em}% swing`
    const typ = entry.hist_stats?.avg_abs_move
    if (typ != null) s += ` · typically moves ±${typ.toFixed(1)}%`
    parts.push(s)
  }
  const bh = entry.beat_history || []
  if (bh.length >= 4) {
    const beats = bh.filter(b => b.beat === true).length
    parts.push(`beat ${beats} of last ${bh.length}`)
  }
  return parts.join(' · ')
}
