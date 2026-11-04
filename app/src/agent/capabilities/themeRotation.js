// UCT Agent — `stock.themeRotation` (Track D workflow "themeRotation", DARK): which of UCT's curated themes are
// ROTATING — each leading theme's rank this week beside its rank over one and three months, the themes NEW to this
// week's top 10, the ones that have FALLEN OUT of it after leading over three months, and the ones in the top 10 on
// all three periods.
//
// "which themes are rotating", "theme rotation", "which themes are new leaders this week", "which themes are fading":
// answered DETERMINISTICALLY from THREE `themes` reads (1w, 1m, 3m; leaders; the kind's MAX_LIMIT of 30 each) through
// the gateway — the Theme Tracker's own cached payload, never built (0 provider calls). No model call.
//
// The cross-period logic (pure, `rotationOf`):
//   • each period's rows are RE-RANKED here, never trusted in the adapter's order: by the return ROUNDED TO 2 dp (what
//     the member sees) descending, then by name; tied returns SHARE a rank (competition ranking 1, 2, 2, 4);
//   • a theme is keyed by its ticker (or its name when it has none); one missing from a period's top 30 is
//     "outside the top 30" for that period — never a rank, never inferred (it may also have no return there);
//   • new to the top 10      rank1w ≤ 10 and (rank1m > 10 or outside the 1m top 30)
//     out of the top 10      rank3m ≤ 10 and (rank1w > 10 or outside the 1w top 30)
//     top 10 on all three    rank1w, rank1m, rank3m all ≤ 10
//   each list in this week's rank order (then 3-month rank, then name). A period that could not be read is said, and
//   the categories needing it are not given. Ends "Descriptive, not a recommendation."
//
// Isolation: the stock.themes contract (a served NON-local market read; turn.DATA_READ_ACTIONS blanks the model's
// pre-read reply). Dark: workflowGate (UCT_AGENT_WORKFLOWS lists themeRotation) + `themes` served.

import { registerCapability } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { num } from './marketDataFormat'
import { stampET } from './marketDataQuote'
import { workflowServed, armGroupWords, DESCRIPTIVE } from './workflowGate'

export const CAPABILITY = 'stock.themeRotation'
export const WORKFLOW = 'themeRotation'
export const KINDS = ['themes']
export const PERIODS = ['1w', '1m', '3m']
export const LIMIT = 30                 // the themes kind's MAX_LIMIT
export const TOP = 10
const PERIOD_WORDS = { '1w': 'one week', '1m': 'one month', '3m': 'three months' }

export const themeRotationServed = () => workflowServed(WORKFLOW, KINDS)

const r2 = (v) => Math.round(v * 100) / 100
const sp = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`
const keyOf = (t) => String(t.ticker || t.name || '').trim().toUpperCase()
const usable = (env) => !!env && (env.status === 'ok' || env.status === 'partial') && Array.isArray(env.data?.themes)

/** Pure: one period's envelope → Map(key → { name, ret, rank }) with ties sharing a rank; null when unusable. */
export function ranksOf(env) {
  if (!usable(env)) return null
  const rows = env.data.themes
    .filter(t => t && keyOf(t) && num(t.return_pct) != null)
    .map(t => ({ key: keyOf(t), name: String(t.name || t.ticker), ret: r2(t.return_pct) }))
  const seen = new Set()
  const uniq = rows.filter(r => (seen.has(r.key) ? false : (seen.add(r.key), true)))
  uniq.sort((a, b) => (b.ret - a.ret) || a.name.localeCompare(b.name))
  const out = new Map()
  uniq.forEach((r, i) => { out.set(r.key, { ...r, rank: i > 0 && uniq[i - 1].ret === r.ret ? out.get(uniq[i - 1].key).rank : i + 1 }) })
  return out
}

/** Pure: the three envelopes → { ok, read: {1w,1m,3m: bool}, leaders, fresh, faded, steady } */
export function rotationOf(envs) {
  const R = Object.fromEntries(PERIODS.map(p => [p, ranksOf(envs[p])]))
  if (!R['1w']) return { ok: false }
  const rank = (p, k) => (R[p] ? R[p].get(k)?.rank ?? null : undefined)       // null = outside the top 30; undefined = period unread
  const inTop = (p, k) => { const r = rank(p, k); return r != null && r <= TOP }
  const row = (k) => {
    const base = R['1w'].get(k) || R['3m']?.get(k) || R['1m']?.get(k)
    return { key: k, name: base.name, ret1w: R['1w'].get(k)?.ret ?? null, rank1w: rank('1w', k), rank1m: rank('1m', k), rank3m: rank('3m', k) }
  }
  const order = (a, b) => ((a.rank1w ?? 1e9) - (b.rank1w ?? 1e9)) || ((a.rank3m ?? 1e9) - (b.rank3m ?? 1e9)) || a.name.localeCompare(b.name)
  const weekKeys = [...R['1w'].keys()]
  const leaders = weekKeys.filter(k => inTop('1w', k)).map(row).sort(order)
  const fresh = R['1m'] ? leaders.filter(r => !inTop('1m', r.key)) : null
  const faded = R['3m'] ? [...R['3m'].keys()].filter(k => inTop('3m', k) && !inTop('1w', k)).map(row).sort(order) : null
  const steady = R['1m'] && R['3m'] ? leaders.filter(r => inTop('1m', r.key) && inTop('3m', r.key)) : null
  return { ok: true, read: Object.fromEntries(PERIODS.map(p => [p, !!R[p]])), leaders, fresh, faded, steady }
}

const rankWord = (r, p) => (r === undefined ? `${p} not read` : r == null ? `${p} outside the top ${LIMIT}` : `${p} #${r}`)
const whenOf = (env) => (env?.as_of ? `as of the ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(env.as_of))} close`
  : env?.data?.live_applied_at ? `including intraday prices UCT applied at ${stampET(env.data.live_applied_at, null)} — not a live feed` : 'at an unstated time')

/** The member's card (pure; exported for tests). → { text, table, present, rotation } */
export function answerFromRotation(envs) {
  const rot = rotationOf(envs)
  if (!rot.ok) {
    const warming = envs['1w'] && envs['1w'].status === 'unavailable'
    return { text: `I couldn't compare UCT's themes across periods: ${warming ? "this week's theme returns are not available yet (theme data may be warming)" : "this week's theme returns could not be read"}. No figure is stated.` }
  }
  const whens = [...new Set(PERIODS.filter(p => rot.read[p]).map(p => whenOf(envs[p])))]
  const lines = [`Theme rotation — UCT's curated themes ranked by equal-weight return over one week, one month and three months (${whens.length === 1 ? whens[0] : `periods read at different times: ${PERIODS.filter(p => rot.read[p]).map(p => `${p} ${whenOf(envs[p])}`).join('; ')}`}):`]
  lines.push(`This week's top ${TOP}: ${rot.leaders.map(r => `${r.name} ${sp(r.ret1w)} (#${r.rank1w}; ${rankWord(r.rank1m, '1m')}; ${rankWord(r.rank3m, '3m')})`).join(' · ')}.`)
  if (rot.fresh) lines.push(rot.fresh.length ? `New to the top ${TOP} this week (not in the one-month top ${TOP}): ${rot.fresh.map(r => r.name).join(', ')}.` : `New to the top ${TOP} this week: none — every one was also in the one-month top ${TOP}.`)
  if (rot.faded) lines.push(rot.faded.length ? `Out of this week's top ${TOP} after leading over three months: ${rot.faded.map(r => `${r.name} (${rankWord(r.rank3m, '3m')}; ${rankWord(r.rank1w, '1w')})`).join(', ')}.` : `Out of this week's top ${TOP} after leading over three months: none.`)
  if (rot.steady) lines.push(rot.steady.length ? `In the top ${TOP} on all three periods: ${rot.steady.map(r => r.name).join(', ')}.` : `In the top ${TOP} on all three periods: none.`)
  const unread = PERIODS.filter(p => !rot.read[p])
  if (unread.length) lines.push(`Not compared: the ${unread.map(p => PERIOD_WORDS[p]).join(' and ')} returns could not be read, so the categories that need them are not given.`)
  if (PERIODS.some(p => envs[p]?.stale && rot.read[p])) lines.push('Note: some theme returns were computed before the last completed session, so they are behind.')
  lines.push(`Ranks are among the top ${LIMIT} themes of each period; tied returns share a rank.`, DESCRIPTIVE)
  const table = { columns: ['Theme', '1w %', '1w rank', '1m rank', '3m rank'],
    rows: rot.leaders.map(r => [r.name, r.ret1w.toFixed(2), String(r.rank1w), r.rank1m == null ? `>${LIMIT}` : String(r.rank1m ?? '—'), r.rank3m == null ? `>${LIMIT}` : String(r.rank3m ?? '—')]) }
  return {
    text: lines.join('\n'),
    table,
    link: { href: '/themes', label: 'Open the Theme Tracker' },
    present: { kind: 'table', title: 'Theme rotation', short: 'Themes', table, text: `${lines[0]}\n${DESCRIPTIVE}` },
    rotation: { leaders: rot.leaders.map(r => r.key), fresh: rot.fresh?.map(r => r.key) ?? null, faded: rot.faded?.map(r => r.key) ?? null, steady: rot.steady?.map(r => r.key) ?? null, read: rot.read },
  }
}

export async function answerThemeRotation() {
  if (!themeRotationServed()) return "UCT's theme rotation view isn't available to the Agent here."
  const turnId = currentTurnId()
  if (!turnId) return "I couldn't read UCT's theme returns: this needs the Agent's turn, which wasn't available."
  // THREE reads, each a string LITERAL kind (agent-qa's isolation rail)
  const envs = {}
  envs['1w'] = await readData('themes', { period: '1w', order: 'leaders', limit: LIMIT }, { purpose: 'answer', turnId })
  envs['1m'] = await readData('themes', { period: '1m', order: 'leaders', limit: LIMIT }, { purpose: 'answer', turnId })
  envs['3m'] = await readData('themes', { period: '3m', order: 'leaders', limit: LIMIT }, { purpose: 'answer', turnId })
  return answerFromRotation(envs)
}

// ── fast path (pure, fail-closed) ───────────────────────────────────────────────────────────────────────────────
const PHRASES = [
  /^(?:show(?: me)? |what(?:'s| is) (?:the )?|give me (?:the )?)?(?:the )?themes? rotation(?: (?:this week|lately|right now))?$/i,
  /^(?:which|what) themes are (?:rotating(?: in| out| in or out| in and out)?|fading|losing (?:steam|momentum)|new (?:leaders|to the top)|emerging)(?: this week| lately| right now)?$/i,
  /^(?:what|which) themes (?:are )?rotat(?:ing|ed) (?:in|into|out)(?: (?:the )?leadership)?(?: this week)?$/i,
  /^(?:show(?: me)? )?(?:new|emerging|fading) themes?(?: this week)?$/i,
]
export function match(text) {
  if (!themeRotationServed()) return null
  const s = String(text || '').replace(/[’`]/g, "'").trim().replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim()
  if (!s || s.length > 100) return null
  return PHRASES.some(re => re.test(s)) ? { action: CAPABILITY, params: {} } : null
}

// the data group's extra words while this is registered ("theme" alone routes the CHART theme group)
export const ROTATION_WORDS = [/\b(?:themes?|sectors?|groups?) rotation\b|\bthemes? (?:are |is )?(?:rotating|fading|emerging|losing (?:steam|momentum))\b|\b(?:new|emerging|fading) themes?\b|\bthemes? (?:are )?new (?:leaders|to the top)\b/]

let registered = false
let unregister = null
/** Idempotent; registers nothing unless the workflow is switched on and `themes` is served; a later config that switches
 *  it off takes the capability and its routing words out. */
export function registerThemeRotationCapability() {
  if (registered) { if (!themeRotationServed()) _resetThemeRotationForTest(); return false }
  if (!themeRotationServed()) return false
  registered = true
  unregister = registerCapability({
    name: 'stock.themeRotation',      // a LITERAL: turn.DATA_READ_ACTIONS names it (the server blanks a pre-read reply)
    surfaces: ['*'],
    target: 'market', query: true,
    summary: 'THEME ROTATION from UCT\'s Theme Tracker: this week\'s top 10 themes with their one- and three-month ranks, the themes NEW to the weekly top 10, the ones that FELL OUT of it after leading over three months, '
      + 'and the ones in the top 10 on all three periods. UCT computes and words every rank. Use this (disposition apply, research null) for "which themes are rotating", "theme rotation", "which themes are fading". '
      + 'For a single period\'s leaders use stock.themes. Descriptive, never a recommendation.',
    hints: 'target = the ref of the stockData entry. No arguments. reply: one short line, no figures.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    fastWhole: true,
    fastCorrect: false,
    fast: ({ raw }) => (match(raw) ? {} : null),
    answer: () => answerThemeRotation(),
  })
  armGroupWords('data', ROTATION_WORDS, true)
  return true
}
export const _resetThemeRotationForTest = () => { if (unregister) unregister(); unregister = null; registered = false; armGroupWords('data', ROTATION_WORDS, false) }
