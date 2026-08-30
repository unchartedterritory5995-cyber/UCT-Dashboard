/**
 * The Read — one short paragraph, composed from what the lenses already
 * compute. Spec §4.
 *
 * ═══ THE FOUR RULES, AND HOW THIS FILE HOLDS THEM ═══════════════════════════
 *
 * This is the highest-risk surface on the tab, because prose SOUNDS
 * authoritative in a way a bar chart does not. The whole reason this lens
 * family exists is that the Views tab used to imply things it could not
 * support, so:
 *
 * 1. **NO LLM.** Deterministic, free, instant. There is no network call here,
 *    no model, no prompt, and there must never be one.
 *
 * 2. **EVERY CLAUSE NAMES A NUMBER, AND THE NUMBER COMES FROM THE INPUT.**
 *    A clause whose source data is absent is OMITTED — never guessed, and never
 *    softened into a numberless hedge. "Participation is weak" with no number is
 *    exactly the failure mode this file exists to prevent, so there is no code
 *    path that can emit it: each builder below returns `null` rather than a
 *    vaguer sentence. `theRead.test.js` extracts every number from the produced
 *    paragraph and traces each one back to the fixture.
 *
 * 3. **NO CLAUSE ASSERTS AN OPINION ITS SOURCE VIEW DOES NOT ALREADY ASSERT.**
 *    It reads the instruments. `quadrantOf` names the regime, so the paragraph
 *    names the regime; the Rotation panel declares its own direction word, so
 *    the paragraph quotes that word. There is no forecast, no recommendation,
 *    and no causal claim anywhere in this file — no "which suggests caution
 *    ahead", no "watch for", no "risk of".
 *
 * 4. **IT COMPOSES, IT DOES NOT RECOMPUTE.** Every clause calls the same
 *    function its lens calls — `quadrantOf`, `zscore` + `divergenceRuns`,
 *    `scanEvents`, `rotationReading`, `percentileRank`, `medianOf` — and every
 *    threshold it refuses on (`MIN_SESSIONS`, `LADDER_MIN_READINGS`) is
 *    imported from the module that owns it. A second copy of any of them is how
 *    the strip and the plot below it would come to disagree, which on a
 *    paragraph of prose would read as authority rather than as a bug.
 *
 * The two endpoint-backed clauses (Analogues, Score Attribution) take their
 * payloads as INPUT. The Read never fetches: `TheReadStrip.jsx` reads the SWR
 * cache with a null fetcher and hands whatever is already there to this
 * function — `null` if the reader has not opened those lenses, which omits the
 * clause like any other absent source.
 *
 * Framework-free: no React in this module or its imports, so the composition is
 * testable without rendering anything.
 */
import {
  quadrantOf, medianOf, metricValue, percentileRank, LADDER_MIN_READINGS,
} from './breadthViewShared'
import { zscore, divergenceRuns, MIN_SESSIONS as DIVERGENCE_MIN_SESSIONS } from './divergence'
import { scanEvents } from './breadthEvents'
import { ROTATION_PANELS, rotationReading, rotationWord } from './rotation'
import { optionDefaults, optionLabel } from './viewMetricConfig'

// ── formatting ──────────────────────────────────────────────────────────────
const one = (v) => Number(v).toFixed(1)
const signedOne = (v) => `${v >= 0 ? '+' : ''}${Number(v).toFixed(1)}`
const signedThree = (v) => `${v >= 0 ? '+' : ''}${Number(v).toFixed(3)}`
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const num = (v) => (v == null || isNaN(Number(v)) ? null : Number(v))

/** 1st / 2nd / 3rd / 4th … — English ordinals, for a percentile rank. */
export function ordinal(n) {
  const i = Math.abs(Math.trunc(n)), tens = i % 100, ones = i % 10
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th'}`
}

/**
 * ⭐ THE REGIME CLAUSE — source: `quadrantOf` (the Regime Clock's own quadrant
 * boundaries) over the level series that lens is configured to plot.
 *
 * Refuses on exactly the Clock's condition: the window at the cursor must be
 * deep enough to measure momentum, and the level must be reported at BOTH ends.
 * "Reported at both ends" is not pedantry — a null at the far end with a number
 * at the near end would produce a momentum of `NaN`, and the vaguer repair
 * ("participation is falling") is the sentence rule 2 forbids.
 */
function regimeClause(win, options) {
  const roc = Number(options.rocWindow ?? 20)
  const levelKey = options.level ?? 'pct_above_50sma'
  if (!Number.isFinite(roc) || roc < 1 || win.length < roc + 1) return null
  const now = num(win[0]?.[levelKey])
  const prior = num(win[roc]?.[levelKey])
  if (now == null || prior == null) return null

  const mom = now - prior
  const label = optionLabel('clock', 'level', levelKey)
  const move = mom === 0
    ? `unchanged over ${plural(roc, 'session')}`
    : `${mom > 0 ? 'up' : 'down'} ${one(Math.abs(mom))} points over ${plural(roc, 'session')}`
  return {
    key: 'regime', source: 'quadrantOf (RegimeClockView)',
    text: `${quadrantOf(now, mom)} — ${label} at ${one(now)}, ${move}.`,
  }
}

/**
 * ⭐ THE DIVERGENCE CLAUSE — source: `zscore` + `divergenceRuns`, the Divergence
 * lens's own math, on its own configured pair and `minGap`.
 *
 * ⛔ IT CHECKS COVERAGE, NOT JUST DEPTH. `zscore` returns an array of nulls for
 * a series that is entirely absent, `divergenceRuns` then finds no runs, and the
 * "in step" branch would state — in prose, with a number — that two series agree
 * when one of them was never reported. Both sides must carry at least the
 * lens's own minimum number of readings before either verdict is emitted.
 */
function divergenceClause(asc, options) {
  if (asc.length < DIVERGENCE_MIN_SESSIONS) return null
  const priceKey = options.price ?? 'sp500_close'
  const partKey = options.participation ?? 'pct_above_50sma'
  const minGap = Number(options.minGap ?? 5)

  const zPrice = zscore(asc.map(r => r?.[priceKey]))
  const zPart = zscore(asc.map(r => r?.[partKey]))
  const covered = (zs) => zs.filter(v => v != null).length
  if (covered(zPrice) < DIVERGENCE_MIN_SESSIONS || covered(zPart) < DIVERGENCE_MIN_SESSIONS) return null

  const runs = divergenceRuns(zPrice, zPart, minGap)
  const last = runs.length ? runs[runs.length - 1] : null
  const active = last && last.end === asc.length - 1 ? last : null
  const text = active
    ? (active.dir === 'price-leads'
        ? `Price has led breadth for ${plural(active.end - active.start + 1, 'session')}.`
        : `Breadth has led price for ${plural(active.end - active.start + 1, 'session')}.`)
    : `Price and breadth are in step across the last ${plural(asc.length, 'session')}.`
  return { key: 'divergence', source: 'divergenceRuns (divergence.js)', text }
}

/**
 * ⭐ THE EVENTS CLAUSE — source: `scanEvents`, the Event Ledger's own scan,
 * under that lens's own family filter.
 *
 * ⛔ AN EVENT THE SCAN COULD NOT EVALUATE IS NOT AN EVENT THAT DID NOT FIRE.
 * `scanEvents` distinguishes the two (`unavailable`), and so does this: if every
 * event in the window came back unevaluable, the clause is omitted rather than
 * reporting the quiet tape that the data cannot support.
 */
function eventsClause(win, options) {
  if (!win.length) return null
  const families = options.families && options.families !== 'all' ? [options.families] : null
  const measurable = scanEvents(win, { families }).filter(e => !e.unavailable)
  if (!measurable.length) return null

  const fired = measurable.filter(e => e.firedToday)
  if (fired.length) {
    return {
      key: 'events', source: 'scanEvents (breadthEvents.js)',
      text: `${plural(fired.length, 'named event')} today: ${fired.map(e => e.label).join(', ')}.`,
    }
  }
  const past = measurable
    .filter(e => e.lastIdx != null)
    .reduce((a, b) => (a == null || b.lastIdx < a.lastIdx ? b : a), null)
  return {
    key: 'events', source: 'scanEvents (breadthEvents.js)',
    text: past
      ? `No named event today; the last was ${past.label}, ${plural(past.sessionsAgo, 'session')} ago.`
      : `No named event in the last ${plural(win.length, 'session')}.`,
  }
}

/**
 * ⭐ THE ROTATION CLAUSE — source: `rotationReading` over the Rotation lens's
 * own panel table, at that lens's own lookback.
 *
 * Which panel? The FIRST one in registry order that has both ends of its
 * change — derived, not chosen: a "biggest mover" rule would be an editorial
 * judgement the lens itself does not make, and a hardcoded key would go stale
 * the day the table is reordered. The direction word is the leading word of the
 * panel's OWN declared sentence, so the paragraph cannot name a direction the
 * card below it contradicts (which is a bug this lens has already paid for
 * once, on `vol_spread`).
 */
function rotationClause(win, options) {
  const lookback = Number(options.lookback ?? 20)
  for (const panel of ROTATION_PANELS) {
    const r = rotationReading(win, panel, lookback)
    if (!r) continue
    return {
      key: 'rotation', source: 'rotationReading (rotation.js)',
      text: `${r.label} ${signedThree(r.delta)} over ${plural(r.measured, 'session')}`
        + ` — ${rotationWord(r.verdict)}.`,
    }
  }
  return null
}

/**
 * ⭐ THE PERCENTILE CLAUSE — source: `percentileRank` over each metric's own
 * history at the cursor, exactly as the Percentile Ladder ranks it, over the
 * metric set that lens is showing.
 *
 * ⛔ NO INVENTED "EXTREME" THRESHOLD. Calling 95 notable and 94 not would put a
 * number in the paragraph with no author anywhere in the codebase. This reports
 * the single reading furthest from its own median and says which percentile it
 * is, which is a fact the ladder already draws; the reader decides whether it
 * is notable. Ties keep the first in ladder order, so the sentence is stable.
 */
function percentileClause(win, ladderMetrics) {
  if (!win.length || !ladderMetrics.length) return null
  let best = null
  for (const m of ladderMetrics) {
    const vals = []
    for (const r of win) {
      const v = metricValue(m, r)
      if (v != null) vals.push(v)
    }
    const today = metricValue(m, win[0])
    if (vals.length < LADDER_MIN_READINGS || today == null) continue
    const pct = percentileRank([...vals].sort((a, b) => a - b), today)
    if (pct == null) continue
    if (best == null || Math.abs(pct - 50) > Math.abs(best.pct - 50)) {
      best = { label: m.label, pct, n: vals.length }
    }
  }
  if (!best) return null
  return {
    key: 'percentile', source: 'percentileRank (breadthViewShared.js)',
    text: `Furthest from its own median on the ladder: ${best.label}, `
      + `${ordinal(best.pct)} percentile of ${plural(best.n, 'reading')}.`,
  }
}

/**
 * ⭐ THE ATTRIBUTION CLAUSE — source: the score-components payload the Score
 * Attribution lens already fetched, read out of the SWR cache. It is never
 * fetched here; `attributionData` is `null` until that lens has run.
 *
 * The guard is the lens's own: a non-ok body answers `undefined` to
 * `data.ok === false`, so the SHAPE the sentence needs is what gets checked.
 * `total == null` means the server declined to score the session — the lens
 * prints an em dash there, and this omits the clause.
 */
function attributionClause(data) {
  if (!data || data.ok === false || !Array.isArray(data.components)) return null
  const total = num(data.total)
  if (total === null) return null
  const present = data.components.filter(c => c.present).length
  const prev = num(data.prev?.total)
  const move = prev == null ? '' : `, ${signedOne(total - prev)} from the prior session`
  return {
    key: 'attribution', source: '/api/breadth-monitor/score-components (SWR cache)',
    text: `Score attribution ${total}${move} (${present} of ${data.components.length} inputs).`,
  }
}

/**
 * ⭐ THE ANALOGUES CLAUSE — source: the analogues payload the Analogue Deck
 * already fetched, read out of the SWR cache, summarised with that deck's own
 * `medianOf`.
 *
 * ⛔ IT NAMES THE REFERENCE DATE, AND IS OMITTED WITHOUT ONE. The server always
 * matches against the LATEST stored session, never the cursor — the deck says
 * so in its own header comment and prints "Matched against {reference_date}"
 * for exactly that reason. A paragraph that said "3 of 5 analogues were higher"
 * while the reader was scrubbed to March would be claiming a match set for a
 * session nobody matched.
 */
function analoguesClause(data, options) {
  const list = data?.analogues
  if (!Array.isArray(list) || !list.length || !data.reference_date) return null
  const horizon = options.horizon ?? 'fwd_20d'
  const withReturn = list.filter(a => a.forward_returns?.[horizon] != null)
  if (!withReturn.length) return null
  const higher = withReturn.filter(a => Number(a.forward_returns[horizon]) > 0).length
  const median = medianOf(withReturn.map(a => Number(a.forward_returns[horizon])))
  if (median == null) return null
  return {
    key: 'analogues', source: '/api/breadth-monitor/analogues (SWR cache)',
    text: `Analogues to ${data.reference_date}: ${higher} of ${withReturn.length} were higher `
      + `${optionLabel('analogues', 'horizon', horizon)} later, median ${signedOne(median)}%.`,
  }
}

/**
 * Compose the paragraph.
 *
 * `optionsFor(style)` is the SAME resolver `BreadthViews` hands the lenses, so
 * The Read reads a lens's configured series, window and filter rather than a
 * default of its own. It falls back to the registry's defaults when nothing is
 * passed, which is what an unconfigured lens would draw.
 *
 * Returns `{ clauses, text }`. `clauses` is in a fixed order and carries the
 * source function behind each one; `text` is them joined. A read with nothing
 * composable returns an EMPTY clause list — the strip says so in a sentence of
 * its own rather than this function inventing a hedge.
 */
export function composeRead({
  rows = [], rowIdx = 0,
  optionsFor = optionDefaults,
  ladderMetrics = [],
  analogueData = null,
  attributionData = null,
} = {}) {
  const win = Array.isArray(rows) ? rows.slice(rowIdx) : []
  const asc = [...win].reverse()
  const opts = (style) => optionsFor(style) ?? {}

  const clauses = [
    regimeClause(win, opts('clock')),
    divergenceClause(asc, opts('divergence')),
    eventsClause(win, opts('events')),
    rotationClause(win, opts('rotation')),
    percentileClause(win, ladderMetrics),
    attributionClause(attributionData),
    analoguesClause(analogueData, opts('analogues')),
  ].filter(Boolean)

  return { clauses, text: clauses.map(c => c.text).join(' '), windowLength: win.length }
}

export default composeRead
