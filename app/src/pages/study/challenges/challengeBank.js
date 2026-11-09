// THE BANK FOR THE CHALLENGES. Ported from the workbench (lab/bank.js) once the owner delegated the port
// (2026-11-03, "you do it all now"). A skill session (POST /api/study/sessions {kind:'skill', skill_id, size})
// returns the approved chart items of one setup with their bars inline; an attempt is scored SERVER-SIDE
// (POST /api/study/attempts; the key never reaches the browser) and returns the verdict, the lesson and the
// first forward bars. Nothing here invents a market fact: every bar and every verdict is the bank's own; the two
// "quick read" facts in Blitz are measured from the bars in front of the member.
// A skill session is a FRESH draw from the whole approved pool of the setup (study_select.compose_today keeps no
// per-member list of charts seen), so a pool never "drains" with play: it is thin when a setup has few approved
// charts and empty only when it has none, and the empty copy says so (2026-11-05; it read "no unseen charts left").
import { ATTEMPTS_URL, SESSIONS_URL, normalizeBars, studyFetch } from '../useStudySession'
import { brandWords } from '../drills/types'   // the owner's rule 11: our name is UCT, never "the firm"

export const SETUP_SKILLS = {
  'setup.family3.kicker': 'Kicker',
  'setup.family1.launchpad': 'Launchpad',
  'setup.family4.slingshot': 'Slingshot',
  'setup.family4.oops': 'Oops Reversal',
  'setup.family3.hve': 'High Volume Edge',
  'setup.family3.gap_support': 'Gap Support',
  'setup.family3.bear_gap': 'Bear gap',
}
export const SETUP_NAMES = Object.values(SETUP_SKILLS)
export const setupName = (skillId) => SETUP_SKILLS[skillId] || (skillId || '').split('.').pop().replace(/_/g, ' ')

/** A small seeded shuffle: the same pool plays in a different order each time, deterministically per seed. */
export function shuffle(list, seed = Date.now()) {
  const a = [...list]
  let s = seed % 2147483647 || 1
  const rnd = () => { s = (s * 48271) % 2147483647; return s / 2147483647 }
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

/** A status that means the MEMBER cannot play at all (signed out, unpaid, Study off): the whole pool fails. */
export function isFatal(e) { return !!e && (e.status === 401 || e.status === 402 || e.status === 403 || e.status === 404) }

/** One skill session per setup, ONE AT A TIME. The first version fired them all at once; on the live pod nine
 *  concurrent session writes against one SQLite file can refuse ("database is locked"), and one refused skill took
 *  the whole pool down with it ("Couldn't load the Blitz pool", the owner, 2026-11-04, on his phone). Now a skill
 *  that fails for a non-fatal reason is skipped and the others still play; only a member-level refusal (signed
 *  out, unpaid, Study off) or EVERY skill failing surfaces as an error, and that error names the status. */
async function skillSets(skillIds, size, fetcher, extra = null) {
  const sets = []
  let lastErr = null
  for (const skill_id of skillIds) {
    try {
      sets.push(await fetcher(SESSIONS_URL, { method: 'POST', body: { kind: 'skill', skill_id, size, ...(extra || {}) } }))
    } catch (e) {
      if (isFatal(e)) throw e
      lastErr = e
      try { console.warn('[study] skill session failed, skipped', skill_id, e?.status || e?.message) } catch { /* no console */ }
    }
  }
  if (!sets.length && lastErr) throw lastErr
  return sets
}

/** The chart (spot) items of several setups, one shuffled list. Each: id, skill, name, q, choices, bars
 *  (normalized), sessionId (so the attempt lands in a real session), difficulty. `hard: true` asks the server for
 *  the charts Hard mode may ask "what fired?" about (api/services/study_hard.py: a Yes chart nothing else fires on,
 *  a No chart nothing fires on at all; owner, batch 21: "We cannot have incorrect examples and explanations!"). */
export async function fetchSpotPool(skillIds = Object.keys(SETUP_SKILLS), size = 12, fetcher = studyFetch, seed, { hard = false } = {}) {
  const pool = []
  for (const set of await skillSets(skillIds, size, fetcher, hard ? { hard: true } : null)) {
    for (const it of set.items || []) {
      if (it.type !== 'spot' || !it.bars?.bars?.length) continue
      pool.push({ id: it.id, skill: it.skill_id, name: setupName(it.skill_id), q: brandWords(it.prompt_json?.q || it.prompt_json?.question || ''), choices: it.prompt_json?.choices || ['Yes', 'No'], bars: normalizeBars(it.bars), sessionId: set.session_id, difficulty: it.difficulty })
    }
  }
  return shuffle(pool, seed)
}

/** Quick-recognition items with a chart from the recall bank (candle names, chart words): the bank's own four-way
 *  question, scored on the server. */
export async function fetchRecallPool(skillIds = ['vocab.candle', 'vocab.chart'], size = 12, fetcher = studyFetch, seed) {
  const pool = []
  for (const set of await skillSets(skillIds, size, fetcher)) {
    for (const it of set.items || []) {
      if (it.type !== 'recall' || !it.bars?.bars?.length || !Array.isArray(it.prompt_json?.choices)) continue
      pool.push({ id: it.id, skill: it.skill_id, name: it.skill_id === 'vocab.candle' ? 'Candle name' : 'Chart word', q: brandWords(it.prompt_json?.q || it.prompt_json?.question || ''), choices: it.prompt_json.choices, bars: normalizeBars(it.bars), sessionId: set.session_id, highlight: it.prompt_json?.chart?.highlight_last_bars || 0 })
    }
  }
  return shuffle(pool, seed)
}

/** Score one answer on the server. Returns the attempt payload plus `forward` (the reveal's forward bars, normalized). */
// THE RUN'S XP (2026-11-08, the reward system: "improve the reward system and scoring of the app a lot more"): every scored
// answer returns the member's total XP (study_store.record_attempt `progress.xp`); a run notes where it started and where
// it ended, so its end screen can fill the level bar and call a level up. Only the server's own numbers.
let run = null
export function beginRunXp() { run = { before: null, after: null } }
export function runXp() { return run && run.before != null && run.after != null ? { before: run.before, after: run.after } : null }

export async function scoreAttempt(item, answer, timeMs, fetcher = studyFetch) {
  const a = await fetcher(ATTEMPTS_URL, { method: 'POST', body: { item_id: item.id, answer, time_ms: Math.max(0, Math.round(timeMs || 0)), session_id: item.sessionId } })
  const p = a?.progress
  if (run && p && Number.isFinite(Number(p.xp))) {
    if (run.before == null) run.before = Number(p.xp) - Number(p.xp_gained || 0)
    run.after = Number(p.xp)
  }
  return { ...a, forward: normalizeBars(a?.reveal?.forward_bars || []) }
}

/** The rest of a chart's forward strip after the reveal's first bars (POST /attempts/{id}/step; the server serves
 *  them only to the member who answered). Resolves to the normalized bars past `have`; [] when there are none or the
 *  call fails (the run-on then stops where the reveal's bars stop). */
export async function fetchForwardRest(attempt, have, fetcher = studyFetch) {
  const total = Number(attempt?.reveal?.forward_total || 0)
  const id = attempt?.attempt_id
  if (!id || total <= have) return []
  try {
    const r = await fetcher(`${ATTEMPTS_URL}/${encodeURIComponent(id)}/step`, { method: 'POST', body: { offset: have, n: total - have } })
    return normalizeBars(r?.bars || [])
  } catch {
    return []
  }
}

function pick(arr, n, rnd) { const a = [...arr]; const out = []; while (a.length && out.length < n) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out }

/** Blitz's questions, a shuffled mix over the pools (owner ruling 2026-11-03: "Both, and possibly a variety of
 *  other questions that are quick recognition style ones"):
 *   name    a setup chart, "What fired on the last candle?", four setup names, keyed on the item's skill
 *   fires   the bank's own Yes/No on a named setup, scored on the server
 *   fact    green or red / over yesterday's high, measured from the bars
 *   recall  the bank's candle-name or chart-word item, scored on the server */
/** The charts a "What setup fired on the last candle?" question may use: only charts whose last candle IS their setup
 *  and no other, checked by the setups' own detectors on the server (POST /api/study/spot-setup, the Spot the Setup
 *  pool). A bank spot item can be a "No, it does not fire" chart, so naming its setup from it would teach a wrong
 *  answer (found 2026-11-08 in Blitz; the owner's rule: never an incorrect example). */
export async function fetchNamedPool(rounds = 20, fetcher = studyFetch, seed = String(Date.now())) {
  const set = await fetcher('/api/study/spot-setup', { method: 'POST', body: { rounds, view: 90, seed } })
  return (set?.items || []).filter((it) => it.look && it.bars?.bars?.length).map((it) => ({
    id: it.id, skill: it.skill_id, name: setupName(it.skill_id), bars: normalizeBars(it.bars), sessionId: set.session_id,
  }))
}

export function buildBlitzQuestions(spots, recalls, seed = Date.now(), named = []) {
  let s = seed % 2147483647 || 1
  const rnd = () => { s = (s * 48271) % 2147483647; return s / 2147483647 }
  const qs = []
  // name it: verified charts only (fetchNamedPool), never a bank spot item, which may be a "does not fire" chart
  ;(named || []).forEach((it) => {
    const others = pick(SETUP_NAMES.filter((x) => x !== it.name), 3, rnd)
    const choices = pick([it.name, ...others], 4, rnd)
    qs.push({ kind: 'name', tag: 'Name it', q: 'What setup fired on the last candle?', choices, item: it, answer: it.name, server: false })
  })
  spots.forEach((it, k) => {
    const n = it.bars.length, b = it.bars[n - 1], p = it.bars[n - 2]
    const r = k % 2
    if (r === 0) {
      qs.push({ kind: 'fires', tag: it.name, q: it.q, choices: it.choices, item: it, server: true })
    } else if (p) {
      const up = b.c > b.o
      const overHigh = b.c > p.h
      qs.push(rnd() < 0.5
        ? { kind: 'fact', tag: 'Quick read', q: 'The last candle: did it close green or red?', choices: ['Green', 'Red'], item: it, answer: up ? 'Green' : 'Red', server: false }
        : { kind: 'fact', tag: 'Quick read', q: "Did the last candle close over yesterday's high?", choices: ['Yes', 'No'], item: it, answer: overHigh ? 'Yes' : 'No', server: false })
    }
  })
  recalls.forEach((it) => qs.push({ kind: 'recall', tag: it.name, q: it.q, choices: it.choices, item: it, server: true, highlight: it.highlight }))
  for (let i = qs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [qs[i], qs[j]] = [qs[j], qs[i]] }
  return qs
}

/** Blitz's multiplier: climbs with the combo, resets on a miss (lab/rewards.js BLITZ). */
export const BLITZ_SECS = 60
export const blitzMult = (combo) => (combo >= 9 ? 5 : combo >= 6 ? 4 : combo >= 3 ? 3 : combo >= 1 ? 2 : 1)
export const BLITZ_POINTS = 10
export const BLITZ_BEST_KEY = 'study.blitz.best'
export const BOSS_TOTAL = 10
