// HARD MODE helpers (production plan piece 43: "ticker hidden, averages hidden, candles only; a legendary fourth
// crown for a perfect run"). Pure, so the rules are testable without a chart. The chart part is one option set the
// Study chart already understands (`overlays: false`, `volume: false`, studyChartLook.studySettingsOverride); the
// ticker is hidden on every Study chart already (the symbol is the item id until the reveal).
//
// THE QUESTION is "what fired on the last candle?" with setup names as cards plus "Nothing fired", and it is still
// scored on the SERVER against the bank's own Yes / No key, which never reaches the browser: naming the item's
// setup posts the bank's Yes ("the setup fires here"), anything else posts its No. A member is credited only when
// the server agrees AND the pick was the setup or "Nothing fired": on a near-miss chart (the bank's answer is No)
// naming another setup is not credited even though No was the right key, and nothing here pretends to know the
// key. The lab's Hard V3 (name it, enter it, stop it) waits on the owner's levels rulings per setup.
// Round 21 (owner, batch 21, on an AAPL chart a Launchpad key called a near-miss and the screen called "Nothing fired":
// "AAPL in this example IS an oops reversal!"): the pool is swept on the server (study_hard.py) and the reveal's key
// says what fired, so the "Nothing fired" card is right only where nothing did.
import { SETUP_NAMES } from './challengeBank'

export const HARD_TOTAL = 8
export const NOTHING = 'Nothing fired'
// Round 19 (owner, batch 19, on the start card's switches: "I dont like that we are asking questions about stuff with
// important indicators blank ... i dont see the point"): the TICKER is the one thing hidden; the member's own averages and
// volume stay, so the chart is their own. Plan piece 43 said candles only; his words outrank it. `{ overlays: false,
// volume: false }` restores candles only.
export const HARD_CHART = Object.freeze({})
export const RUN_ON_MS = 330   // the owner, batch 10: "show the next candles a bit slower"

function seeded(seed) {
  let s = (Number(seed) || 1) % 2147483647 || 1
  return () => { s = (s * 48271) % 2147483647; return s / 2147483647 }
}

/** A stable seed from an item id, so a re-render never reshuffles the cards under the member's finger. */
export function idSeed(id) {
  let h = 7
  for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) % 2147483647
  return h || 1
}

/** Four cards for one chart: the item's setup, two other setups, and "Nothing fired", in a seeded order. */
export function hardChoices(item, seed = 1, names = SETUP_NAMES) {
  const rnd = seeded(seed)
  const others = names.filter((x) => x !== item.name)
  const picked = []
  while (others.length && picked.length < 2) picked.push(others.splice(Math.floor(rnd() * others.length), 1)[0])
  const cards = [item.name, ...picked, NOTHING]
  for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]] }
  return cards
}

/** What the member's pick posts against the bank's Yes / No question. Naming the chart's setup posts the bank's Yes and
 *  "Nothing fired" its No. ANOTHER setup's name is posted as itself (round 21): every Hard chart is swept on the server
 *  so that only its own setup fires on a Yes chart and nothing fires on a No chart (study_hard.py), so another name is
 *  never right, and posting it as itself lets the server record the miss (no XP) instead of crediting the bank's No. */
export function hardAnswer(picked, item, yes, no) {
  const choice = picked === item.name ? yes : picked === NOTHING ? no : picked
  return { choice, picked_setup: picked }
}

/** The bank's key from the reveal (`reveal.answer`, `{answer: 'yes'}`): true when the setup fires, false when it does
 *  not, null when the reveal carries no yes/no key. */
export function keyFired(answer) {
  const a = answer && typeof answer === 'object' ? (answer.answer ?? answer.correct) : answer
  if (typeof a === 'boolean') return a
  const t = String(a ?? '').trim().toLowerCase()
  if (['yes', 'y', 'true', '1'].includes(t)) return true
  if (['no', 'n', 'false', '0'].includes(t)) return false
  return null
}

/** Credited only when the server agrees and the pick was the setup itself or "Nothing fired". */
export function hardRight(picked, item, serverCorrect) {
  return !!serverCorrect && (picked === item.name || picked === NOTHING)
}

/** Did the setup fire on this chart? The bank's key from the reveal when it came back; otherwise read from the server's
 *  verdict on what was posted (null when that cannot tell: a wrong pick of another setup). */
export function setupFired(picked, item, serverCorrect, revealAnswer = undefined) {
  const k = keyFired(revealAnswer)
  if (k !== null) return k
  if (serverCorrect) return picked === item.name
  if (picked === item.name) return false
  if (picked === NOTHING) return true
  return null
}

/** The setups that are SHORT: their move is measured down. */
export const SHORT_SETUPS = Object.freeze(['Bear gap'])

/** THE CULMINATION (round 21; owner, batch 21: "the full culmination or maximization of the trade and the opportunity"):
 *  the best the move did while the trade was still alive, measured from the signal candle's close. The trade's window
 *  ends at the first CLOSE that breaks the signal candle's range against it (under its low for a long setup, over its
 *  high for a short one), so a later high reached only after the setup had failed is never credited to it. Inside the
 *  window: the highest high long, the lowest low short. { offset (0-based into forward), sessions, pct, broke (the
 *  offset of the breaking close, or null) }, or null. */
export function culmination(signal, forward, short = false) {
  if (!signal || !Number.isFinite(signal.c) || signal.c <= 0 || !forward?.length) return null
  let end = forward.length
  let broke = null
  for (let k = 0; k < forward.length; k++) {
    const c = forward[k].c
    if (short ? (Number.isFinite(signal.h) && c > signal.h) : (Number.isFinite(signal.l) && c < signal.l)) { end = k + 1; broke = k; break }
  }
  let best = 0
  for (let k = 1; k < end; k++) {
    if (short ? forward[k].l < forward[best].l : forward[k].h > forward[best].h) best = k
  }
  const px = short ? forward[best].l : forward[best].h
  return { offset: best, sessions: best + 1, pct: (px / signal.c - 1) * 100, broke }
}

export const RUN_MIN = 12          // even a quick turn shows what came after it
export const RUN_AFTER_PEAK = 5    // and a few sessions past the culmination, so the turn is seen
export const RUN_NOTHING = 30      // a chart where nothing fired runs on a month and a half of sessions

/** How many forward bars the run-on shows: to the culmination and a few past it when the setup fired; a set length when
 *  nothing did; never more than the strip holds. */
export function runLength(forwardLen, culm, fired) {
  if (!forwardLen) return 0
  if (fired && culm) return Math.min(forwardLen, Math.max(RUN_MIN, culm.offset + 1 + RUN_AFTER_PEAK))
  return Math.min(forwardLen, RUN_NOTHING)
}

/** "+23.4% in 14 sessions": the culmination as the chart's label. */
export function culminationLabel(culm) {
  if (!culm || !Number.isFinite(culm.pct)) return ''
  const sign = culm.pct >= 0 ? '+' : '−'
  return `${sign}${Math.abs(culm.pct).toFixed(1)}% in ${culm.sessions} session${culm.sessions === 1 ? '' : 's'}`
}

/** "a Kicker" / "an Oops Reversal". */
export function withArticle(name) {
  const n = String(name || '')
  return `${/^[AEIOU]/i.test(n) ? 'an' : 'a'} ${n}`
}

/** THE KICKER TRADE (round 22; the owner's rules, stored 2026-11-02): entry "over previous day high" on day 2, so over the
 *  kicker candle's own high on the first session after it (his other entry, the day-1 30-minute opening-range break,
 *  needs intraday bars the chart does not carry); stop "under the kicker candle low or entry with a 3.5% stop", whichever
 *  is closer to the entry. A bar that reaches the stop ends the trade before its high counts (the order inside a bar is
 *  unknown, so the cautious reading). Advance is the best high after entry while the trade was alive, from the entry.
 *  { triggered: false, entry } when day 2 never cleared the high; null when there is nothing to measure. */
export const KICKER_MAX_STOP = 0.035
export function kickerTrade(signal, forward) {
  if (!signal || !Number.isFinite(signal.h) || !Number.isFinite(signal.l) || !forward?.length) return null
  const entry = signal.h
  if (!(forward[0].h > entry)) return { kind: 'kicker', triggered: false, entry }
  const stop = Math.max(signal.l, entry * (1 - KICKER_MAX_STOP))
  let best = entry, bestAt = null, stoppedAt = null
  for (let k = 0; k < forward.length; k++) {
    const b = forward[k]
    if (b.l <= stop) { stoppedAt = k; break }
    if (b.h > best) { best = b.h; bestAt = k }
  }
  const riskPct = ((entry - stop) / entry) * 100
  const advancePct = ((best - entry) / entry) * 100
  return {
    kind: 'kicker', triggered: true, entry, stop, riskPct, best, advancePct,
    bestSessions: bestAt == null ? null : bestAt + 1, stoppedSession: stoppedAt == null ? null : stoppedAt + 1,
    r: riskPct > 0 ? advancePct / riskPct : null,
  }
}

/** The trade the lesson card reviews: the owner's own rules where he has given them (the Kicker), and otherwise the move
 *  measured from the signal candle (its close, its low or high as the line the trade must hold, the culmination). */
export function tradeOf(name, signal, forward, culm, fired) {
  if (fired !== true || !signal) return null
  if (name === 'Kicker') return kickerTrade(signal, forward)
  if (!culm) return null
  const short = SHORT_SETUPS.includes(name)
  return { kind: 'signal', short, close: signal.c, line: short ? signal.h : signal.l, advancePct: culm.pct, sessions: culm.sessions, broke: culm.broke == null ? null : culm.broke + 1 }
}
