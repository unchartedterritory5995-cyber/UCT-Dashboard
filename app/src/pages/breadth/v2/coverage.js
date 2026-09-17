/**
 * V2-3 · the honest-coverage computation (A-10) and the era note.
 *
 * ⛔⛔ THE DEFECT, IN THE AUDIT'S OWN WORDS (`01-audit.md:109-119`): *"Stale, carried,
 * reconstructed and not-yet-recorded data look identical to fresh data… Series that begin
 * 2026-01-02 simply start mid-plot. 191 of 365 served rows were reconstructed from bars
 * and nothing says so."*
 *
 * ⛔ A SERIES THAT HAS NOT STARTED YET MUST NOT READ AS FLAT. That is the whole thing. A
 * gap rendered as blank space is indistinguishable from a measured period of no movement,
 * and a breadth reader acts on exactly that difference. So the span BEFORE a series begins
 * is shaded and labelled, never left empty.
 *
 * ⭐ PURE, AND RETURNS "NOTHING TO SAY" RATHER THAN EMPTY DECORATION. Every helper here
 * returns null/[] when there is no honest claim to make, so the component can render
 * nothing at all — which is what makes "coverage absent ⇒ V2-3 renders exactly what V2-2
 * renders" achievable as a byte-identity rail rather than an aspiration.
 */

/**
 * Where each series actually begins.
 *
 * ⛔ Derived from the DATA (first non-null), not from a declared start date. A declared
 * start is a record, and this programme has just spent a day on records that were true
 * when written. The readings themselves cannot drift from themselves.
 *
 * @returns { [key]: { startIndex, startDate, present, absent } }  — `startIndex` is -1
 *          for a series with no readings at all, which is a REPORTABLE state, not a gap.
 */
export function seriesCoverage(dates, valuesByKey, keys) {
  const out = {}
  for (const key of keys ?? []) {
    const values = valuesByKey?.[key] ?? []
    let startIndex = -1
    let present = 0
    for (let i = 0; i < values.length; i += 1) {
      const v = values[i]
      if (v !== null && v !== undefined) {
        present += 1
        if (startIndex < 0) startIndex = i
      }
    }
    out[key] = {
      startIndex,
      startDate: startIndex >= 0 ? dates?.[startIndex] ?? null : null,
      present,
      absent: values.length - present,
    }
  }
  return out
}

/**
 * The shaded "not recorded" region for one series: from the window's start to the
 * session before its first reading.
 *
 * ⛔ Returns null when the series covers the whole window — there is no region, and a
 * zero-width band drawn anyway is chrome that says something false.
 */
export function notRecordedRegion(dates, cov) {
  if (!dates?.length || !cov || cov.startIndex <= 0) return null
  return { fromIndex: 0, toIndex: cov.startIndex - 1, from: dates[0], to: dates[cov.startIndex - 1] }
}

/**
 * Contiguous runs of reconstructed sessions, as index ranges into `dates`.
 *
 * ⭐ RUNS, NOT A COUNT. "191 reconstructed sessions" is a fact about the window; WHERE
 * they are is the fact a reader needs, because a reconstructed block at the left edge and
 * one straddling the part they are reading mean different things.
 */
export function reconstructedRuns(dates, reconstructed) {
  if (!dates?.length || !reconstructed?.length) return []
  const flagged = new Set(reconstructed)
  const runs = []
  let start = -1
  for (let i = 0; i < dates.length; i += 1) {
    const isRecon = flagged.has(dates[i])
    if (isRecon && start < 0) start = i
    if (!isRecon && start >= 0) {
      runs.push({ fromIndex: start, toIndex: i - 1, from: dates[start], to: dates[i - 1] })
      start = -1
    }
  }
  if (start >= 0) {
    const last = dates.length - 1
    runs.push({ fromIndex: start, toIndex: last, from: dates[start], to: dates[last] })
  }
  return runs
}

/** The era-note threshold, verbatim from `01-audit.md:309-311`: "more than 20 %". */
export const ERA_GROWTH_THRESHOLD_PCT = 20

/**
 * Metrics that have a ratio counterpart, for the note's one-tap swap.
 * ⛔ From the audit's own text (`hi_ratio`, `lo_ratio`) — not invented here.
 */
export const RATIO_SWAP = {
  new_52w_highs: 'hi_ratio',
  new_52w_lows: 'lo_ratio',
}

/**
 * The era note (A-11's "Era comparability", `01-audit.md:309-311`).
 *
 * > When the window's `universe_count` changes by more than 20 % end to end, count panels
 * > show "Counts depend on the measured universe (1,521 → 2,648 names); % versions
 * > compare across years" with a one-tap swap to the ratio metric where one exists.
 *
 * ⛔ THE NUMBERS IN THE AUDIT ARE ILLUSTRATIVE. The real pair is computed from the
 * window's own first and last `universe_count`; hard-coding 1,521 → 2,648 would be a
 * second authority over a value the data already owns.
 *
 * ⛔ IT NEEDS `universe_count` IN THE RESPONSE. `/series` caps at 8 keys, so if it was not
 * requested the note CANNOT be computed — and this returns null rather than guessing. A
 * note that quietly stops appearing because a key was dropped is worse than no note.
 *
 * @returns null when it does not fire, else { from, to, growthPct, text, swap }
 */
export function eraNote(universeCounts, panelKeys = []) {
  const vals = (universeCounts ?? []).filter(v => typeof v === 'number' && Number.isFinite(v))
  if (vals.length < 2) return null
  const first = vals[0]
  const last = vals[vals.length - 1]
  if (!first) return null
  const growthPct = ((last - first) / first) * 100
  if (Math.abs(growthPct) <= ERA_GROWTH_THRESHOLD_PCT) return null

  const swapFrom = panelKeys.find(k => RATIO_SWAP[k])
  return {
    from: first,
    to: last,
    growthPct,
    // ⭐ The audit's sentence, with the window's own numbers substituted.
    text: `Counts depend on the measured universe (${fmt(first)} → ${fmt(last)} names); `
        + '% versions compare across years',
    swap: swapFrom ? { from: swapFrom, to: RATIO_SWAP[swapFrom] } : null,
  }
}

const fmt = n => Math.round(n).toLocaleString('en-US')

/**
 * Everything V2-3 has to say about a window, or `null` if it has nothing.
 *
 * ⛔⛔ `null` IS THE LOAD-BEARING RETURN. The owner's rail is that with coverage absent,
 * V2-3 renders EXACTLY what V2-2 renders — byte for byte. That is only achievable if this
 * can answer "nothing", so it does, rather than returning an object full of empty arrays
 * that a component would then have to remember not to render.
 */
export function coverageModel({ dates, valuesByKey, keys, reconstructed, panels }) {
  if (!dates?.length || !keys?.length) return null

  const perKey = seriesCoverage(dates, valuesByKey, keys)
  const regions = {}
  for (const key of keys) {
    const r = notRecordedRegion(dates, perKey[key])
    if (r) regions[key] = r
  }
  const runs = reconstructedRuns(dates, reconstructed)
  const countKeys = (panels ?? []).flatMap(p => (p.unit === 'count' ? p.keys : []))
  const era = eraNote(valuesByKey?.universe_count, countKeys)

  const hasAnything = Object.keys(regions).length > 0 || runs.length > 0 || era !== null
  if (!hasAnything) return null

  return { perKey, regions, runs, era }
}
