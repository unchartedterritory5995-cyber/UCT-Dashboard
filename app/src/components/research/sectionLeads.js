// app/src/components/research/sectionLeads.js
//
// The derived opening sentence for the canvases that were presenting
// instruments without stating what they add up to.
//
// EVERY ONE IS DETERMINISTIC, and that is the whole argument. Each reads only
// the payload its own canvas already renders — no model call, so there is no
// cost guard, no cache, no refusal path and no groundedness gate to get wrong,
// and nothing here can be slow. Generated prose about a company belongs in the
// Brief and Call tabs, where it can be checked against its sources.
//
// ⛔ EVERY BUILDER RETURNS null RATHER THAN A HEDGE. A sentence that has to say
// "data unavailable" is worse than no sentence: it spends the most prominent
// line on the canvas saying nothing. The caller renders nothing for null.
//
// ⛔ `Number(null) === 0`, the defect that has landed on this branch more times
// than any other, so every value routes through `num()` and a genuine zero is
// distinguished from a missing one throughout.

const num = (v) => {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** "1 of 8" / "none of its last 8" — plural and zero handled once, not thrice. */
function countPhrase(n, total) {
  return n === 0 ? `none of its last ${total}` : `${n} of its last ${total}`
}

const plural = (n, word) => `${word}${n === 1 ? '' : 's'}`

/**
 * EARNINGS HISTORY — "how does this name behave when it reports?"
 *
 * The canvas draws EPS above and the price reaction below on one axis, and
 * left the reader to combine them. Two facts do that: how often it beats, and
 * how often the stock actually went up afterwards. Keeping them in one
 * sentence is the point — a name that beats constantly and still sells off is
 * the single most useful thing this panel can tell you, and it is invisible
 * when the two series are read separately.
 *
 * ⛔ Beat is read from `surprise_pct` when the provider sent it and from the
 * actual-vs-estimate pair otherwise — NEVER from `eps_actual > eps_estimate`
 * alone, which counts a quarter with no estimate as a beat.
 */
export function historyLead(sym, quarters) {
  const reported = (quarters || []).filter((q) => q?.reported)
  if (!reported.length) return null

  const beatFlags = reported.map((q) => {
    const s = num(q?.surprise_pct)
    if (s != null) return s > 0
    const a = num(q?.eps_actual)
    const e = num(q?.eps_estimate)
    return a != null && e != null ? a > e : null
  })
  const judged = beatFlags.filter((b) => b != null)
  const beats = judged.filter(Boolean).length

  const moves = reported.map((q) => num(q?.reaction_pct)).filter((m) => m != null)
  const ups = moves.filter((m) => m > 0).length
  const avgAbs = moves.length
    ? moves.reduce((a, m) => a + Math.abs(m), 0) / moves.length
    : null

  const name = sym || 'This stock'
  const parts = []
  if (judged.length) parts.push(`${name} beat in ${countPhrase(beats, judged.length)} reported ${plural(judged.length, 'quarter')}`)
  if (moves.length) {
    const rose = `the stock rose after ${countPhrase(ups, moves.length)}`
    parts.push(parts.length ? rose : `${name} rose after ${countPhrase(ups, moves.length)} ${plural(moves.length, 'print')}`)
  }
  if (!parts.length) return null

  const tail = avgAbs == null ? '' : ` It moves ±${avgAbs.toFixed(1)}% on average.`
  return `${parts.join(', and ')}.${tail}`
}

/**
 * THE STREET — "what does everyone else think?"
 *
 * The canvas opens on a 0-99 composite with no scale in sight, then seven
 * sub-scores, then a pass/fail checkup. The number alone does not say whether
 * 91 is remarkable, nor WHICH of the seven inputs earned it. Naming the
 * strongest two does both, and the checkup tally is the one fact on the canvas
 * that is a count rather than a grade.
 *
 * ⛔ `composite` may be a genuine 0 — a real, meaningful score — so presence is
 * tested with `num(...) != null`, never truthiness.
 */
export function streetLead(sym, ratings) {
  const composite = num(ratings?.composite)
  if (composite == null) return null

  const LABELS = { eps: 'EPS strength', rs: 'relative strength', growth: 'growth', value: 'value' }
  const comps = Object.entries(LABELS)
    .map(([key, label]) => ({ label, v: num(ratings?.components?.[key]) }))
    .filter((c) => c.v != null)
    .sort((a, b) => b.v - a.v)

  const name = sym || 'This stock'
  let s = `${name} rates ${composite} of 99 on the UCT composite`
  if (comps.length >= 2) s += `, strongest on ${comps[0].label} (${comps[0].v}) and ${comps[1].label} (${comps[1].v})`
  else if (comps.length === 1) s += `, strongest on ${comps[0].label} (${comps[0].v})`
  s += '.'

  // The checkup is a list of pass/fail rules; anything else (a rule that could
  // not be computed) is deliberately excluded from BOTH sides of the ratio
  // rather than silently counted as a failure.
  const checks = Array.isArray(ratings?.checkup) ? ratings.checkup : []
  const decided = checks.filter((c) => c?.status === 'pass' || c?.status === 'fail')
  if (decided.length) {
    const passed = decided.filter((c) => c.status === 'pass').length
    s += ` It passes ${passed} of ${decided.length} checkup ${plural(decided.length, 'rule')}.`
  }
  return s
}

/**
 * CATALYSTS — "what actually moved this stock?"
 *
 * The canvas is a reverse-chronological feed, so the BIGGEST mover is wherever
 * it happens to fall in time — usually below the fold. The lead names it.
 *
 * ⛔ Ranked by |move|, not by recency and not by signed move: the question is
 * "what moved it most", and a −12% day answers that as fully as a +12% one.
 */
export function catalystsLead(sym, items) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean)
  if (!list.length) return null

  const withMove = list
    .map((it) => ({ it, m: num(it?.move_pct ?? it?.movePct ?? it?.reaction_pct) }))
    .filter((x) => x.m != null)
  const name = sym || 'This stock'
  const n = list.length
  const head = `${n} ${plural(n, 'catalyst')} on file for ${name}`
  if (!withMove.length) return `${head}.`

  const top = withMove.reduce((a, x) => (Math.abs(x.m) > Math.abs(a.m) ? x : a))
  const signed = `${top.m > 0 ? '+' : ''}${top.m.toFixed(1)}%`
  const title = typeof top.it?.title === 'string' ? top.it.title.trim() : ''
  // The headline is provider text of unbounded length; a lead that runs three
  // lines stops being a lead. Trim on a word boundary, and only when needed.
  const short = title.length > 72 ? `${title.slice(0, 69).replace(/\s+\S*$/, '')}…` : title
  return short
    ? `${head}. The biggest moved it ${signed} — ${short}`
    : `${head}. The biggest moved it ${signed}.`
}
