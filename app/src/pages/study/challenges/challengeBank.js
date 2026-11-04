// THE BANK FOR THE CHALLENGES. Ported from the workbench (lab/bank.js) once the owner delegated the port
// (2026-11-03, "you do it all now"). A skill session (POST /api/study/sessions {kind:'skill', skill_id, size})
// returns the approved chart items of one setup with their bars inline; an attempt is scored SERVER-SIDE
// (POST /api/study/attempts; the key never reaches the browser) and returns the verdict, the lesson and the
// first forward bars. Nothing here invents a market fact: every bar and every verdict is the bank's own; the two
// "quick read" facts in Blitz are measured from the bars in front of the member.
import { ATTEMPTS_URL, SESSIONS_URL, normalizeBars, studyFetch } from '../useStudySession'

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

function isSignedOut(e) { return e && (e.status === 401 || e.status === 403) }

async function skillSets(skillIds, size, fetcher) {
  const sets = await Promise.all(skillIds.map((skill_id) => fetcher(SESSIONS_URL, { method: 'POST', body: { kind: 'skill', skill_id, size } }).catch((e) => (isSignedOut(e) ? e : null))))
  const out = sets.find(isSignedOut)
  if (out) throw out
  return sets.filter(Boolean)
}

/** The chart (spot) items of several setups, one shuffled list. Each: id, skill, name, q, choices, bars
 *  (normalized), sessionId (so the attempt lands in a real session), difficulty. */
export async function fetchSpotPool(skillIds = Object.keys(SETUP_SKILLS), size = 12, fetcher = studyFetch, seed) {
  const pool = []
  for (const set of await skillSets(skillIds, size, fetcher)) {
    for (const it of set.items || []) {
      if (it.type !== 'spot' || !it.bars?.bars?.length) continue
      pool.push({ id: it.id, skill: it.skill_id, name: setupName(it.skill_id), q: it.prompt_json?.q || it.prompt_json?.question || '', choices: it.prompt_json?.choices || ['Yes', 'No'], bars: normalizeBars(it.bars), sessionId: set.session_id, difficulty: it.difficulty })
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
      pool.push({ id: it.id, skill: it.skill_id, name: it.skill_id === 'vocab.candle' ? 'Candle name' : 'Chart word', q: it.prompt_json?.q || it.prompt_json?.question || '', choices: it.prompt_json.choices, bars: normalizeBars(it.bars), sessionId: set.session_id, highlight: it.prompt_json?.chart?.highlight_last_bars || 0 })
    }
  }
  return shuffle(pool, seed)
}

/** Score one answer on the server. Returns the attempt payload plus `forward` (the reveal's forward bars, normalized). */
export async function scoreAttempt(item, answer, timeMs, fetcher = studyFetch) {
  const a = await fetcher(ATTEMPTS_URL, { method: 'POST', body: { item_id: item.id, answer, time_ms: Math.max(0, Math.round(timeMs || 0)), session_id: item.sessionId } })
  return { ...a, forward: normalizeBars(a?.reveal?.forward_bars || []) }
}

function pick(arr, n, rnd) { const a = [...arr]; const out = []; while (a.length && out.length < n) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out }

/** Blitz's questions, a shuffled mix over the pools (owner ruling 2026-11-03: "Both, and possibly a variety of
 *  other questions that are quick recognition style ones"):
 *   name    a setup chart, "What fired on the last candle?", four setup names, keyed on the item's skill
 *   fires   the bank's own Yes/No on a named setup, scored on the server
 *   fact    green or red / over yesterday's high, measured from the bars
 *   recall  the bank's candle-name or chart-word item, scored on the server */
export function buildBlitzQuestions(spots, recalls, seed = Date.now()) {
  let s = seed % 2147483647 || 1
  const rnd = () => { s = (s * 48271) % 2147483647; return s / 2147483647 }
  const qs = []
  spots.forEach((it, k) => {
    const n = it.bars.length, b = it.bars[n - 1], p = it.bars[n - 2]
    const r = k % 4
    if (r === 0 || r === 1) {
      const others = pick(SETUP_NAMES.filter((x) => x !== it.name), 3, rnd)
      const choices = pick([it.name, ...others], 4, rnd)
      qs.push({ kind: 'name', tag: 'Name it', q: 'What setup fired on the last candle?', choices, item: it, answer: it.name, server: false })
    } else if (r === 2) {
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
