// THE STUDY BANK, from the workbench (owner, batch 10: "it cycled through the same 3 examples. We will need
// hundreds if not thousands of examples"). The sandbox serves the real Study API: a skill session returns the
// approved chart items for that setup with their bars inline, and an attempt is scored SERVER-SIDE (the key never
// reaches the browser), returning the verdict, the lesson and the first forward bars. Nothing here invents a
// market fact: every bar and every verdict is the bank's own.
import { normalizeBars } from '../pages/study/useStudySession'

export const SETUP_SKILLS = {
  'setup.family3.kicker': 'Kicker',
  'setup.family1.launchpad': 'Launchpad',
  'setup.family4.slingshot': 'Slingshot',
  'setup.family4.oops': 'Oops Reversal',
  'setup.family3.hve': 'High Volume Edge',
  'setup.family3.gap_support': 'Gap Support',
  'setup.family3.bear_gap': 'Bear gap',
}
export const setupName = (skillId) => SETUP_SKILLS[skillId] || (skillId || '').split('.').pop().replace(/_/g, ' ')

export class SignedOut extends Error { constructor() { super('signed out'); this.name = 'SignedOut' } }
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
  if (r.status === 401 || r.status === 403) throw new SignedOut()
  if (!r.ok) throw new Error(`${url} ${r.status}`)
  return r.json()
}
/** Sign the sandbox in from the lab page itself (the owner's browser session lapses; the lab has no login screen). */
export async function signIn(email, password) {
  const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email, password }) })
  return r.ok
}

function shuffle(a, seed = Date.now()) {
  let s = seed % 2147483647 || 1
  const rnd = () => { s = (s * 48271) % 2147483647; return s / 2147483647 }
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

/** Pool the chart (spot) items of several setups into one shuffled list. Each item: id, skill, name, q, choices,
 *  bars (normalized), sessionId (so the attempt lands in a real session). */
export async function fetchSpotPool(skillIds = Object.keys(SETUP_SKILLS), size = 12) {
  const sets = await Promise.all(skillIds.map((skill_id) => post('/api/study/sessions', { kind: 'skill', skill_id, size }).catch((e) => (e instanceof SignedOut ? e : null))))
  if (sets.some((x) => x instanceof SignedOut)) throw new SignedOut()
  const pool = []
  sets.forEach((set) => {
    if (!set?.items) return
    set.items.forEach((it) => {
      if (it.type !== 'spot' || !it.bars?.bars?.length) return
      pool.push({ id: it.id, skill: it.skill_id, name: setupName(it.skill_id), q: it.prompt_json?.q || '', choices: it.prompt_json?.choices || ['Yes', 'No'], bars: normalizeBars(it.bars), sessionId: set.session_id, difficulty: it.difficulty })
    })
  })
  return shuffle(pool)
}

/** Score one answer on the server. Returns { correct, reveal, progress, forward } with forward bars normalized. */
export async function scoreAttempt(item, answer, timeMs) {
  const a = await post('/api/study/attempts', { item_id: item.id, answer, time_ms: Math.max(0, Math.round(timeMs || 0)), session_id: item.sessionId })
  return { ...a, forward: normalizeBars(a?.reveal?.forward_bars || []) }
}

/** Quick-recognition items with a chart from the recall bank (candle names, chart words): the bank's own four-way
 *  question, scored on the server. */
export async function fetchRecallPool(skillIds = ['vocab.candle', 'vocab.chart'], size = 12) {
  const sets = await Promise.all(skillIds.map((skill_id) => post('/api/study/sessions', { kind: 'skill', skill_id, size }).catch((e) => (e instanceof SignedOut ? e : null))))
  if (sets.some((x) => x instanceof SignedOut)) throw new SignedOut()
  const pool = []
  sets.forEach((set) => {
    if (!set?.items) return
    set.items.forEach((it) => {
      if (it.type !== 'recall' || !it.bars?.bars?.length || !Array.isArray(it.prompt_json?.choices)) return
      pool.push({ id: it.id, skill: it.skill_id, name: it.skill_id === 'vocab.candle' ? 'Candle name' : 'Chart word', q: it.prompt_json?.q || '', choices: it.prompt_json.choices, bars: normalizeBars(it.bars), sessionId: set.session_id, highlight: it.prompt_json?.chart?.highlight_last_bars || 0 })
    })
  })
  return shuffle(pool)
}
