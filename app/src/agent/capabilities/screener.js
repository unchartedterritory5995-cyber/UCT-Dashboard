// ── SCREENER capabilities: run real UCT screens from the Agent ──────────────
//
// Registered through the same public seam as every other domain. The Screener's
// engine is a STATELESS server API — the Screener page posts the same spec:
//   GET  /api/screener/fields        the field catalog (key, label, type, unit) — the
//                                    filter registry without /meta's measurements
//   POST /api/screener/count|scan    {filters:[{key, op, min?, max?, value?}], sort}
//   GET  /api/screener/saved-screens {saved, starters}
// The Agent builds that spec from the catalog's own keys, the server validates it
// (an unknown key or op is a 400 with a sentence), and the rows shown are exactly
// the rows the server returned. "Open in Screener" hands the same spec to the
// Screener page through its own `?s=` door (specUrl.encodeSpec), or opens a saved
// screen through `?savedScreen=`.
//
// ⭐ READ-ONLY. Running a screen here changes nothing in UCT (the Screener page's
// own state lives inside that page), so every action is a QUERY: nothing to undo,
// nothing to propose. The Agent remembers its LAST screen so "add price above $10"
// can refine it — per CONVERSATION, kept on the server (W1-C C-01, scanRefine.js):
// a reload or a chat switch restores it, so "now only technology", "exclude anything
// under $10", "sort them by three-month performance" still compose onto it. A refinement
// that would add a hidden UCT field is refused with the F-16 sentence + one public alternative.
//
// ⭐ NO FIELD LIST HERE. Fields come from the live catalog; a field the Screener
// gains is usable the moment `/fields` lists it. Range, yes/no and LIST fields (sector,
// industry, exchange, theme…): the model writes the member's words ("software") and they are
// matched HERE to the field's real values (`/fields?options=1`) — every value used is named in
// the answer, an unmatched word is refused with the real names, never guessed.
//
// ⭐ SCREEN MEASURES (registerScreenMeasures): numbers the Screener snapshot does not hold —
// e.g. the LATEST COMPLETED SESSION's dollar volume (capabilities/sessionMeasures.js) — are
// checked after the engine's own filters, on the engine's complete result set (paged, never the
// first page only). A measure provider may SUPERSEDE a catalog field on the same clock (the
// session's close replaces the snapshot price) so every number in one screen is one session's.
//
// ⭐ SC-1 GATEWAY (dark): while GET /api/agent/config says `scan`, the run / runSaved / listSaved ANSWERS
// read through the MD-1 gateway (`screen.run`, `screen.saved`) instead — see runViaGateway below.
//
// ⭐ COMPOSITION (the model composes, no handler per sentence): a field against a field (`gt_col` & co with `other`),
// `contains` on a token list (Candle Type), a weighted `rank`, and a `logic` tree (all / any / none / not) that comes as
// a JSON string, because the planner's closed schemas cannot be recursive. A tree that is EXACTLY a flat screen is
// flattened (flattenLogic). Any other tree needs SCREENER_LOGIC_ENABLED: with it off the screen is refused in a sentence,
// never run looser. Every shape reaches the same F-16 check (hiddenRefusal, then the server's spec.validate).
//
// ⛔ Not here: operating the Screener PAGE's own filters (it only exists inside
// /screener), My Scans (Indicator formulas), arithmetic. Saving / renaming / copying /
// deleting SAVED screens is capabilities/savedScreens.js (the same routes the Screener's menu uses).

import { registerCapability, registerTargetKind, registerContextProvider, registerWarmup, registerOutputSource, SYMBOLS } from '../capabilities'
import { encodeSpec } from '../../pages/screener/shell/specUrl'
import { matchName } from '../nl/match'
import { serverServesScan, serverDataKinds, activeConversationId } from '../agentClient'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { isHidden, refusalFor, DEFAULT_SORT, DEFAULT_ORDER_WORDS, hiddenPhraseIn } from './scanHidden'
import { composeRefine, refineRefusal, persistLastScreen, restoreLastScreen, NO_LAST_SCREEN, UNIVERSE_KEYS } from './scanRefine'

// W1.1 R-05: a message shaped like a screen or a refinement of one (a screen verb, "only / just", a universe noun, a
// "which stocks" question) — the gate for claiming a hidden-field PHRASE before the planner (screener.run `fast`)
export const HIDDEN_SCREEN_SHAPED = /^(?:(?:now|and|ok|okay|then|also|but|next)[ ,]+)*(?:(?:please|pls|can you|could you|would you)\s+)?(?:(?:show|find|get|give|list|pull up|screen|scan|filter|run|rank|sort|order|narrow|limit|restrict|keep|refine|exclude|drop|remove)\b|only\b|just\b|(?:all |the )?(?:stocks|names|tickers|ones)\b|(?:which|what) (?:stocks|names|tickers)\b|those\b|top \d+\b|(?:any|every)thing\b)/
// …over a UNIVERSE or the last screen's results (never one stock's figure: "show me the composite rating for NVDA")
export const HIDDEN_SCREEN_UNIVERSE = /\b(?:stocks|names|tickers|equities|ones|those|them|these|screens?|scans?|filter|rank|sort|order|only|just|top \d+|anything|everything|leaders|which|what)\b/
// …but never a question, an explanation, a guide request or a chart control that happens to use the same words
export const HIDDEN_NOT_A_SCREEN = /\b(?:where|how|what(?:'s| is| does| do| are)|explain|meaning|means|definition|defined|charts?|levels?|toggle|settings?|overlay|widget|turn (?:on|off)|enable|disable|bars)\b/
/** W1.1 R-05: is this message a screen (or a refinement) over a universe, as far as words can tell? */
export const hiddenScreenRequest = (lower) => HIDDEN_SCREEN_SHAPED.test(lower) && HIDDEN_SCREEN_UNIVERSE.test(lower) && !HIDDEN_NOT_A_SCREEN.test(lower)

const META_TTL_MS = 6 * 3600 * 1000      // the registry changes only on deploy
const SAVED_TTL_MS = 60 * 1000
const MAX_FILTERS = 12
const SHOW_DEFAULT = 10
const SHOW_MAX = 25
const RANGE_OPS = ['gt', 'gte', 'lt', 'lte', 'eq', 'between']
const LIST_OPS = ['in', 'not_in']
// The engine's field-to-field comparisons (filters.COL_OPS): the right-hand side is a second catalog key, `other`
const COL_OPS = ['gt_col', 'gte_col', 'lt_col', 'lte_col']
// A list field's value test: on a token list (Candle Type) `in` is any of the tokens, `contains` requires each one
const TOKEN_OPS = ['contains']
const OP_WORD = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', between: 'between', gt_col: '>', gte_col: '≥', lt_col: '<', lte_col: '≤' }
// screener/logic.py's own limits, checked here for the sentence; the engine re-checks them
const LOGIC_DEPTH = 4
const LOGIC_LEAVES = 25
const LOGIC_CHARS = 6000
// ⛔ SCREENER_LOGIC_ENABLED is off: this tree has no exact flat form, and a flat screen near it would be a different screen
export const LOGIC_OFF = "this needs an any-of or none-of group, and those aren't switched on for the Agent yet. I didn't run a looser screen in its place"
// screener/ranking.py MAX_CRITERIA
const RANK_MAX = 8
const PAGE = 500                  // the engine's own page cap (services/screener/query.py _MAX_PAGE)
// The most stocks one screen hands to another action (e.g. filling a watchlist). Not a storage
// limit (the watchlist server has none): a bound on one request, always SAID, never a silent cut.
export const FILL_MAX = 1000
const CANDIDATES_MAX = 10000      // a screen with measure conditions reads at most this many candidates
// SC-1 §2d (owner F-16): never the Screener's own default order (UCT Composite, a proprietary rating). DEFAULT_SORT
// and DEFAULT_ORDER_WORDS come from scanHidden.js, generated from the server's spec.DEFAULT_SORT: one authority.
/** SC-1 §2d: the refusal sentence when ANY part of a wire spec names a hidden field (a filter, an `other`, a logic
 *  leaf, an arithmetic term, the sort, a rank criterion, a column), or null. One walk, every shape. */
export function hiddenRefusal(spec) {
  const keys = []
  const walk = (v, depth = 0) => {
    if (depth > 24 || v == null || typeof v !== 'object') return
    if (Array.isArray(v)) { v.forEach(x => walk(x, depth + 1)); return }
    for (const k of ['key', 'other', 'f', 'column']) if (typeof v[k] === 'string') keys.push(v[k])
    for (const x of Object.values(v)) walk(x, depth + 1)
  }
  walk(spec)
  if (Array.isArray(spec?.columns)) keys.push(...spec.columns.filter(c => typeof c === 'string'))
  return refusalFor(keys)
}
// A saved screen named in the member's words before the saved list had loaded (SAT-1 F-SAT-3) — never an id.
const BY_NAME = 'name:'

// ── the engine (the Screener's own routes) ──
const req = (u, o) => fetch(u, { credentials: 'include', ...o })
async function json(r, what) {
  if (!r.ok) {
    const b = await r.json().catch(() => ({}))
    const d = typeof b.detail === 'string' ? b.detail : null
    throw new Error(r.status === 402 ? 'the Screener needs a paid plan' : (d || `${what} failed (${r.status})`))
  }
  return r.json()
}

const cache = { meta: null, metaAt: 0, metaP: null, options: null, optionsAt: 0, optionsP: null, saved: null, savedAt: 0, last: null, lastConv: null, restoreP: null, said: null }
export function _resetScreenerCache() { cache.said = null; cache.meta = null; cache.metaAt = 0; cache.metaP = null; cache.options = null; cache.optionsAt = 0; cache.optionsP = null; cache.saved = null; cache.savedAt = 0; cache.last = null; cache.lastConv = null; cache.restoreP = null }

// ── the LAST SCREEN, per conversation (W1-C C-01) ──
/** Record the screen just run as the conversation's last screen and persist it server-side (fire-and-forget). */
function setLast(last) {
  cache.last = last
  cache.lastConv = activeConversationId()
  persistLastScreen(last)
}
/** Is the screen held here the CURRENT conversation's? A screen run before the chat had an id (a new chat gets its
 *  id on its first turn) belongs to whichever chat is open now; one from another chat does not. Sync. */
function lastIsCurrent() {
  if (!cache.last) return false
  const conv = activeConversationId()
  if (cache.lastConv == null) {
    if (conv) { cache.lastConv = conv; persistLastScreen(cache.last) }   // adopt: the id arrived after the screen ran
    return true
  }
  return cache.lastConv === conv
}
/** The last screen for the member's CURRENT conversation: the one run here, else the server's copy (a reload, a
 *  chat switch). One read per conversation switch; null when there is none. */
export function ensureLast() {
  if (lastIsCurrent()) return Promise.resolve(cache.last)
  const conv = activeConversationId()
  if (!conv) { cache.last = null; cache.lastConv = null; return Promise.resolve(null) }   // a new chat: the old chat's screen is not its
  if (!cache.restoreP) {
    cache.restoreP = restoreLastScreen().then(l => {
      if (activeConversationId() !== conv) return lastIsCurrent() ? cache.last : null    // the chat changed meanwhile
      cache.last = l
      cache.lastConv = conv
      return l
    }).catch(() => (lastIsCurrent() ? cache.last : null)).finally(() => { cache.restoreP = null })
  }
  return cache.restoreP
}

export function loadMeta() {
  if (cache.meta && Date.now() - cache.metaAt < META_TTL_MS) return Promise.resolve(cache.meta)
  if (!cache.metaP) {
    cache.metaP = req('/api/screener/fields').then(r => json(r, 'Reading the Screener fields')).then(m => {
      const list = Array.isArray(m.fields) ? m.fields : []
      const live = new Set(Array.isArray(m.live_fields) ? m.live_fields : [])
      cache.meta = {
        fields: list.filter(f => f && f.key && !isHidden(f.key) && (f.type === 'range' || f.type === 'bool' || f.type === 'enum')).map(f => ({ key: f.key, label: f.label || f.key, type: f.type === 'enum' ? 'list' : f.type, unit: f.unit || '', category: f.category || null, ...(f.description ? { description: String(f.description) } : {}), ...(live.has(f.key) ? { live: true } : {}) })),
        // SCREENER_LOGIC_ENABLED as the server reports it. Absent (an older server) reads as unknown: the screen is tried
        // and the engine's own refusal is the answer. The engine stays the authority either way.
        logic: typeof m.logic_enabled === 'boolean' ? m.logic_enabled : null,
      }
      cache.metaAt = Date.now()
      return cache.meta
    }).finally(() => { cache.metaP = null })
  }
  return cache.metaP
}
// ⭐ SAT-1 F-SAT-3 (agent-lead spec): a message the fast path claimed while the catalog was still loading
// waits for it here, BOUNDED, then runs normally. A load that fails or takes longer is a local answer:
// no model call, no receipt, nothing applied. (fast() itself is synchronous by contract — fastPath.js —
// so the wait lives in the answer, which is where the catalog is first needed.)
export const META_WAIT_MS = 3000
export const META_UNAVAILABLE = "The screener's field list couldn't load, so I didn't run that — try again."
export function metaWithin(ms = META_WAIT_MS) {
  if (cache.meta && Date.now() - cache.metaAt < META_TTL_MS) return Promise.resolve(cache.meta)
  let timer
  const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms) })
  return Promise.race([loadMeta(), timeout]).finally(() => clearTimeout(timer))
}
/** Each list field's real values + how much of the universe it classifies (`/fields?options=1`). */
export function loadOptions() {
  if (cache.options && Date.now() - cache.optionsAt < META_TTL_MS) return Promise.resolve(cache.options)
  if (!cache.optionsP) {
    cache.optionsP = req('/api/screener/fields?options=1').then(r => json(r, 'Reading the Screener values')).then(b => {
      cache.options = b && typeof b.options === 'object' && b.options ? b.options : {}
      cache.optionsAt = Date.now()
      return cache.options
    }).finally(() => { cache.optionsP = null })
  }
  return cache.optionsP
}

// ── SCREEN MEASURES: numbers checked after the engine's filters (see the header) ──
//   registerScreenMeasures({ id, measures: [{ key, label, unit, supersedes? }], note?, resolve(symbols) })
//   resolve → { asOf, values: { TICKER: { key: number } }, error? }
const PROVIDERS = new Map()
export function registerScreenMeasures(p) { PROVIDERS.set(p.id, p); return () => PROVIDERS.delete(p.id) }
const measureOf = (key) => { for (const p of PROVIDERS.values()) { const m = p.measures.find(x => x.key === key); if (m) return { ...m, provider: p } } return null }
const allMeasures = () => [...PROVIDERS.values()].flatMap(p => p.measures.map(m => ({ ...m, provider: p })))

export async function loadSaved({ force = false } = {}) {
  if (!force && cache.saved && Date.now() - cache.savedAt < SAVED_TTL_MS) return cache.saved
  const b = await json(await req('/api/screener/saved-screens'), 'Reading your screens')
  cache.saved = {
    saved: (b.saved || []).map(s => ({ id: String(s.id), name: s.name, spec: s.spec, kind: 'yours' })),
    starters: (b.starters || []).map(s => ({ id: String(s.id), name: s.name, spec: s.spec, kind: 'starter' })),
  }
  cache.savedAt = Date.now()
  return cache.saved
}
const post = (path, body) => req(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
/** The saved-screens list as last read (sync), and the last screen run here (its wire spec). */
export const savedScreensNow = () => cache.saved
export const lastScreenNow = () => cache.last

// ── catalog helpers ──
const fieldOf = (key) => cache.meta?.fields.find(f => f.key === key) || measureOf(key) || null
// Dollar amounts a trader says in millions / billions read that way ($10M, $2.5B); smaller ones as typed.
const big = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n) || Math.abs(n) < 1e6) return String(v)
  const [d, s] = Math.abs(n) >= 1e9 ? [1e9, 'B'] : [1e6, 'M']
  return `${Number((n / d).toFixed(2))}${s}`
}
/** A wire value in the member's words: a token list stores `,hammer,`, the catalog calls it Hammer. */
const shownValue = (key, v) => {
  const wire = cache.options?.[key]?.wire
  const hit = wire ? Object.entries(wire).find(([, x]) => x === v) : null
  return hit ? hit[0] : String(v ?? '').replace(/^,|,$/g, '')
}
const fmtVal = (f, v) => (v == null ? '' : f?.unit === '$' ? `$${big(v)}` : f?.unit === '%' ? `${v}%` : String(v))
function describeFilter(fl) {
  const f = fieldOf(fl.key)
  const label = f?.label || fl.key
  if (fl.key === 'list') return `In “${fl.label || 'your watchlist'}”`
  if (fl.op === 'in' || fl.op === 'not_in') return `${label}${fl.op === 'not_in' ? ' not' : ''}: ${(fl.values || []).map(v => shownValue(fl.key, v)).join(', ')}`
  if (fl.op === 'contains') return `${label}: ${shownValue(fl.key, fl.value)}`
  if (COL_OPS.includes(fl.op)) return `${label} ${OP_WORD[fl.op]} ${fieldOf(fl.other)?.label || fl.other}`
  if (f?.type === 'bool') return `${label}: ${Number(fl.value) === 1 ? 'yes' : 'no'}`
  if (fl.op === 'between') return `${label} ${fmtVal(f, fl.min)}–${fmtVal(f, fl.max)}`
  const v = fl.op === 'lt' || fl.op === 'lte' ? fl.max : fl.op === 'eq' ? fl.value : fl.min
  return `${label} ${OP_WORD[fl.op] || fl.op} ${fmtVal(f, v)}`
}

/** One group of a `logic` tree in words: "any of (RSI ≤ 30 or RSI ≥ 70)". A leaf reads as the same filter does outside it. */
function describeLogic(n) {
  if (n.key) return describeFilter(n)
  if (n.not) return `not (${describeLogic(n.not)})`
  const k = ['all', 'any', 'none'].find(g => Array.isArray(n[g]))
  return `${{ all: 'all of', any: 'any of', none: 'none of' }[k]} (${n[k].map(describeLogic).join(k === 'all' ? ' and ' : ' or ')})`
}
const rankWords = (rank) => {
  const c = rank?.criteria || []
  const sum = c.reduce((a, x) => a + (Number(x.weight) || 0), 0) || 1
  return c.map(x => `${fieldOf(x.key)?.label || x.key} ${Math.round(100 * (Number(x.weight) || 0) / sum)}%${x.ascending ? ' (lower is better)' : ''}`).join(', ')
}
/** Every condition of a spec in words: flat filters, measures, then the group. One list for every place a screen is said. */
const specParts = (spec) => [...[...(spec.filters || []), ...(spec.post || [])].map(describeFilter), ...(spec.logic ? [describeLogic(spec.logic)] : [])]

const tok = (s) => ` ${String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `

/** A member's words → the field's real values: an exact value, else every value containing the
 *  words as a whole-word run ("software" → "Software - Application", "Software - Infrastructure").
 *  → { values } | { unmatched: [words] } */
function matchValues(options, words) {
  const values = []
  const unmatched = []
  for (const w of words) {
    const t = tok(w)
    if (t.trim() === '') continue
    const exact = options.filter(o => tok(o) === t)
    const hits = exact.length ? exact : options.filter(o => tok(o).includes(t))
    if (!hits.length) unmatched.push(w)
    for (const h of hits) if (!values.includes(h)) values.push(h)
  }
  return unmatched.length ? { unmatched } : { values }
}
const suggestFor = (options, word) => {
  const parts = tok(word).trim().split(' ').filter(p => p.length >= 3)
  const near = options.filter(o => parts.some(p => tok(o).includes(` ${p.slice(0, 4)}`)))
  return (near.length ? near : options).slice(0, 8)
}

/** One list filter → the engine's `in` / `not_in`, resolved against the real values. With the
 *  values not loaded yet (`lenient`), the words are kept for describing; apply re-resolves. */
// ⛔ SG-2 (AUDIT live prod f591d31720, 2026-11-04): "only tech" became Industry = "Information Technology Services" (one
// small IT-services industry) instead of the Technology SECTOR. A word that NAMES a sector — the sector's own value, or a
// common name for it — is the `sector` field's whenever the catalog has one, whichever list field the model chose; only a
// value the sector field really holds is used. Words naming a sector AND words that don't, together on the industry
// field, are asked about, never guessed.
const SECTOR_NAMES = [
  [/^(?:tech|techs|technology|technologies|info(?:rmation)? tech(?:nology)?|tech stocks?|tech sector)$/, ['Technology', 'Information Technology']],
  [/^(?:energy|energy stocks?)$/, ['Energy']],
  [/^(?:health ?care|health|healthcare stocks?)$/, ['Healthcare', 'Health Care']],
  [/^(?:financials?|finance|financial services)$/, ['Financial Services', 'Financials']],
  [/^(?:utilities|utility)$/, ['Utilities']],
  [/^(?:real estate)$/, ['Real Estate']],
  [/^(?:materials|basic materials)$/, ['Basic Materials', 'Materials']],
  [/^(?:industrials?)$/, ['Industrials']],
  [/^(?:consumer staples|staples|consumer defensive|defensives?)$/, ['Consumer Defensive', 'Consumer Staples']],
  [/^(?:consumer discretionary|discretionary|consumer cyclicals?|cyclicals?)$/, ['Consumer Cyclical', 'Consumer Discretionary']],
  [/^(?:communications?|communication services)$/, ['Communication Services']],
]
/** The sector value (one the sector field holds) a member's word names, or null. Pure over the options. */
export function sectorNamed(word, sectorValues) {
  const w = tok(word).trim()
  const exact = (sectorValues || []).find(v => tok(v).trim() === w)
  if (exact) return exact
  const hit = SECTOR_NAMES.find(([re]) => re.test(w))
  return hit ? (hit[1].find(n => (sectorValues || []).includes(n)) || null) : null
}
/** The real values `words` name, as labels: a field whose list is its presets (Candle Type, Bar Character) also carries a
 *  label → stored value map, and a word that IS the stored value ("up" for Uptrend) reads as that label. */
function resolveValues(opts, wire, words) {
  const m = matchValues(opts, words)
  if (!m.unmatched || !wire) return m
  const raw = Object.entries(wire)
  return matchValues(opts, words.map(w => raw.find(([, v]) => tok(v) === tok(w))?.[0] || w))
}
function listFilter(f, x, { lenient = false } = {}) {
  const contains = TOKEN_OPS.includes(x.op)
  const op = x.op === 'not_in' ? 'not_in' : (contains || LIST_OPS.includes(x.op) || x.op === 'eq') ? 'in' : null
  if (!op) return { error: `${f.label} takes a list of values (in / not in)` }
  const words = (Array.isArray(x.values) ? x.values : []).map(v => String(v || '').trim()).filter(Boolean)
  if (!words.length) return { error: `which ${f.label.toLowerCase()}?` }
  if (contains && words.length > 1 && cache.options?.[f.key] && !cache.options[f.key].token) return { error: `${f.label} holds one value per stock, so it can't contain all of ${words.join(', ')}` }
  const sectorField = (cache.meta?.fields || []).find(g => g.key === 'sector' && g.type === 'list')
  const sectorValues = cache.options?.sector?.values
  if (sectorField && sectorValues && (f.key === 'sector' || f.key === 'industry')) {
    const named = words.map(w => sectorNamed(w, sectorValues))
    if (named.every(Boolean)) {
      const values = [...new Set(named)]
      return { filter: { key: 'sector', op, values }, ...(f.key !== 'sector' ? { note: `“${words.join(', ')}” ${words.length === 1 ? 'is a sector' : 'are sectors'}, so I used Sector: ${values.join(', ')}` } : {}) }
    }
    if (f.key === 'industry' && named.some(Boolean)) {
      return { error: `“${words.filter((_, i) => named[i]).join(', ')}” ${named.filter(Boolean).length === 1 ? 'is a sector' : 'are sectors'} and “${words.filter((_, i) => !named[i]).join(', ')}” is not — say whether to screen by sector or by industry` }
    }
  }
  const opts = cache.options?.[f.key]?.values
  if (!opts) return lenient ? { filter: { key: f.key, op, values: words, pending: true } } : { error: `the ${f.label} values couldn't be read right now` }
  const wire = cache.options[f.key].wire || null
  const token = cache.options[f.key].token === true
  const stored = (l) => wire?.[l] ?? l
  // `contains` requires EVERY word; one word naming several values ("star" with no exact hit) is any of those
  if (contains && token) {
    const filters = []
    for (const w of words) {
      const r = resolveValues(opts, wire, [w])
      if (!r.values) return { error: `the Screener has no ${f.label} matching “${w}” (it has ${suggestFor(opts, w).join(', ')}${opts.length > 8 ? ', …' : ''})` }
      const v = r.values.map(stored)
      filters.push(v.length === 1 ? { key: f.key, op: 'contains', value: v[0] } : { key: f.key, op: 'in', values: v })
    }
    return { filters }
  }
  const m = resolveValues(opts, wire, words)
  if (m.values) return { filter: { key: f.key, op, values: m.values.map(stored) } }
  // The member's words may name the sibling field ("software" is an Industry, not a Sector):
  // used ONLY when exactly one other list field of the same kind holds every word, and said so.
  const sibs = (cache.meta?.fields || []).filter(g => g.type === 'list' && g.key !== f.key && g.category === f.category && cache.options?.[g.key]?.values)
  const fits = sibs.map(g => ({ g, m: matchValues(cache.options[g.key].values, words) })).filter(r => r.m.values)
  if (fits.length === 1) return { filter: { key: fits[0].g.key, op, values: fits[0].m.values.map(l => cache.options[fits[0].g.key].wire?.[l] ?? l) }, note: `“${words.join(', ')}” is ${/^[aeiou]/i.test(fits[0].g.label) ? 'an' : 'a'} ${fits[0].g.label}, so I matched it there` }
  const w = m.unmatched[0]
  return { error: `the Screener has no ${f.label} matching “${w}” (it has ${suggestFor(opts, w).join(', ')}${opts.length > 8 ? ', …' : ''})` }
}

// ⛔ SG-1 (AUDIT live prod f591d31720, 2026-11-04): "near 52-week highs" was built as "Dist from 52W High ≤ 5%". The
// Screener stores a distance from a HIGH as a NEGATIVE percent (price / high − 1: 0 at the high, −5 five percent below,
// screener/technicals.py `_pct`) and a distance from a LOW as a POSITIVE one, so "≤ 5" passed EVERY stock. A threshold on
// the wrong side of zero for such a field is a magnitude said the member's way ("within 5% of the high", "more than 20%
// off it"): it is read on the field's own side — the value negated, the comparison mirrored — and the answer says so.
// The sign is the field's (its key names a high or a low), never a guess about the member.
const DIST_BELOW_HIGH = /^dist_(?:\w+_)?high_pct$|^dist_ath_pct$/
const DIST_ABOVE_LOW = /^dist_(?:\w+_)?low_pct$/
/** 'neg' (≤ 0: below a high), 'pos' (≥ 0: above a low) or null — the sign convention of a distance field. */
export const distanceSign = (key) => (DIST_BELOW_HIGH.test(String(key || '')) ? 'neg' : DIST_ABOVE_LOW.test(String(key || '')) ? 'pos' : null)
// SG-1: the catalog line the model reads says the sign ("near the 52-week high" = dist_52w_high_pct gte -5)
const DIST_UNIT = { neg: '(%, ≤0: −5 = 5% below the high)', pos: '(%, ≥0: 5 = 5% above the low)' }
const MIRROR = { gt: 'lt', gte: 'lte', lt: 'gt', lte: 'gte', eq: 'eq' }
/** A range filter {op, value, max} on a distance field, put on the field's own side of zero → { x, note } (x unchanged
 *  and note null when it already was). Pure; exported for tests. */
export function signedDistance(x, f) {
  const sign = distanceSign(f?.key)
  if (!sign || !x) return { x, note: null }
  const v = Number(x.value)
  const wrong = (n) => Number.isFinite(n) && (sign === 'neg' ? n > 0 : n < 0)
  let y = null
  if (x.op === 'between') {
    const hi = Number(x.max)
    // mirrored onto the field's side ("between 0 and 5% of the high" → −5..0; "2 to 5% off it" → −5..−2)
    if (Number.isFinite(v) && Number.isFinite(hi)) {
      if (sign === 'neg' && hi > 0) y = v >= 0 ? { ...x, value: -hi, max: -v || 0 } : { ...x, value: Math.min(v, -hi), max: 0 }
      if (sign === 'pos' && v < 0) y = hi <= 0 ? { ...x, value: -hi, max: -v } : { ...x, value: 0, max: Math.max(hi, -v) }
    }
  } else if (MIRROR[x.op] && wrong(v)) y = { ...x, op: MIRROR[x.op], value: -v }
  if (!y) return { x, note: null }
  const side = sign === 'neg' ? `below the high, so 0 is at the high and −5 is 5% below it` : `above the low, so 0 is at the low and 5 is 5% above it`
  const shown = y.op === 'between' ? `between ${y.value}% and ${y.max}%` : `${OP_WORD[y.op]} ${y.value}%`
  return { x: y, note: `${f.label} is measured ${side} — read as ${f.label} ${shown}` }
}

/** The model's filters → { filters (the engine's wire filters), post (measure conditions), notes }. */
export function toWireFilters(filters, { lenient = false } = {}) {
  const out = []
  const post = []
  const notes = []
  for (const x of filters || []) {
    if (isHidden(String(x.field || ''))) return { error: refusalFor([x.field]) }
    const f = fieldOf(String(x.field || ''))
    if (!f) return { error: `the Screener has no field “${x.field}”` }
    if (f.type === 'list') {
      const r = listFilter(f, x, { lenient })
      if (r.error) return { error: r.error }
      out.push(...(r.filters || [r.filter]))
      if (r.note) notes.push(r.note)
      continue
    }
    if (COL_OPS.includes(x.op)) {
      if (f.type !== 'range') return { error: `${f.label} can't be compared with another field` }
      const name = String(x.other || '')
      if (isHidden(name)) return { error: refusalFor([name]) }
      const g = fieldOf(name)
      if (!g) return { error: `the Screener has no field “${name}” to compare ${f.label} with` }
      if (g.type !== 'range') return { error: `${f.label} can only be compared with a number field, and ${g.label} isn't one` }
      // the engine compares two snapshot columns; a latest-session measure is checked here, after it, on another clock
      if (f.provider || g.provider) return { error: `${(f.provider ? f : g).label} is checked after the Screener's own filters, so it can't be compared with another field` }
      out.push({ key: f.key, op: x.op, other: g.key })
      // ⛔ TWO CLOCKS: during the session one side can follow the live price while the other stands at the last close
      if (!!f.live !== !!g.live) notes.push(`${(f.live ? f : g).label} updates with the live price during the session and ${(f.live ? g : f).label} does not, so this comparison mixes two clocks while the market is open`)
      continue
    }
    const v0 = Number(x.value)
    if (f.type === 'bool') {
      if (!(v0 === 0 || v0 === 1)) return { error: `${f.label} is yes/no` }
      out.push({ key: f.key, op: 'eq', value: v0 })
      continue
    }
    if (!RANGE_OPS.includes(x.op)) return { error: `“${x.op}” isn't a Screener comparison` }
    if (x.value == null || !Number.isFinite(v0)) return { error: `${f.label} needs a number` }
    // SG-1: a distance from a high / low is read on the field's own side of zero (see signedDistance)
    const sd = signedDistance(x, f)
    if (sd.note) notes.push(sd.note)
    const y = sd.x
    const v = Number(y.value)
    let w
    if (y.op === 'between') {
      const hi = Number(y.max)
      if (!Number.isFinite(hi) || hi <= v) return { error: `${f.label} “between” needs a higher upper bound` }
      w = { key: f.key, op: 'between', min: v, max: hi }
    } else if (y.op === 'lt' || y.op === 'lte') w = { key: f.key, op: y.op, max: v }
    else if (y.op === 'eq') w = { key: f.key, op: 'eq', value: v }
    else w = { key: f.key, op: y.op, min: v }
    ;(f.provider ? post : out).push(w)
  }
  return { filters: out, post, notes }
}

/** A leaf the tree holds as a filter, or not: {field} (the model's) or {key} (a wire leaf). */
const isLeaf = (n) => !!n && typeof n === 'object' && !Array.isArray(n) && (n.field != null || n.key != null)
const GROUPS = ['all', 'any', 'none']
function groupOf(n) {
  if (!n || typeof n !== 'object' || Array.isArray(n)) return null
  const keys = Object.keys(n)
  if (keys.length !== 1) return null
  if (keys[0] === 'not') return n.not && typeof n.not === 'object' ? 'not' : null
  return GROUPS.includes(keys[0]) && Array.isArray(n[keys[0]]) && n[keys[0]].length ? keys[0] : null
}
/** Every field name in a model tree, at any depth (a leaf's `field`, `key` and `other`), for the F-16 sentence. */
function logicNames(n, depth = 0) {
  if (depth > 24 || !n || typeof n !== 'object') return []
  if (Array.isArray(n)) return n.flatMap(x => logicNames(x, depth + 1))
  return [...['field', 'key', 'other'].filter(k => typeof n[k] === 'string').map(k => n[k]), ...Object.values(n).flatMap(x => logicNames(x, depth + 1))]
}
/** The wire leaves of a tree, in order. */
const logicLeaves = (n) => (!n ? [] : n.key ? [n] : n.not ? logicLeaves(n.not) : GROUPS.flatMap(g => (n[g] || []).flatMap(logicLeaves)))
/** `logic` as the model sends it (a JSON string; an object is taken as it is) → { tree } | { error }. */
function readLogic(raw) {
  if (raw == null || raw === '') return { tree: null }
  if (typeof raw === 'object') return { tree: raw }
  if (String(raw).length > LOGIC_CHARS) return { error: 'that group of conditions is too large' }
  try { return { tree: JSON.parse(raw) } } catch { return { error: "I couldn't read that group of conditions" } }
}
/** A model tree → the wire tree (`logic.py`'s shape), each leaf through toWireFilters: the same checks as a flat filter. */
function logicToWire(tree, { lenient = false } = {}) {
  const notes = []
  let leaves = 0
  const walk = (n, depth) => {
    if (depth > LOGIC_DEPTH) return { error: `groups can nest at most ${LOGIC_DEPTH} deep` }
    if (isLeaf(n)) {
      if (++leaves > LOGIC_LEAVES) return { error: `a group can hold at most ${LOGIC_LEAVES} conditions` }
      const w = toWireFilters([{ ...n, field: n.field ?? n.key }], { lenient })
      if (w.error) return { error: w.error }
      // a latest-session measure is checked after the engine's own filters, so it can't sit inside the engine's OR / NOT
      if (w.post.length) return { error: `${fieldOf(w.post[0].key)?.label || w.post[0].key} is checked after the Screener's own filters, so it can't go inside an any-of or none-of group` }
      notes.push(...w.notes)
      return { node: w.filters.length === 1 ? w.filters[0] : { all: w.filters } }
    }
    const k = groupOf(n)
    if (!k) return { error: 'a group is exactly one of all, any, none or not' }
    if (k === 'not') {
      const r = walk(n.not, depth + 1)
      return r.error ? r : { node: { not: r.node } }
    }
    const kids = []
    for (const c of n[k]) {
      const r = walk(c, depth + 1)
      if (r.error) return r
      kids.push(r.node)
    }
    return { node: { [k]: kids } }
  }
  const r = walk(tree, 1)
  return r.error ? { error: r.error } : { tree: r.node, notes }
}

/**
 * A tree that says EXACTLY what a flat list says → that list, else null. Exact over every row, the blank ones included:
 * logic.py is two-valued (a blank fails a leaf, so it PASSES "none of" it), and `not_in` keeps a blank for the same
 * reason, so `none of (sector in X)` is `sector not_in X`. `none of (price > 10)` is NOT `price ≤ 10`, which drops a blank
 * price: it stays a tree. A tree this can't reduce needs SCREENER_LOGIC_ENABLED; nothing here ever approximates one.
 * Pure over wire leaves. Pinned on real rows by tests/test_uct_agent_scan_compose.py (composition_flatten_cases.json).
 */
export function flattenLogic(node, neg = false) {
  if (node.key) {
    if (!neg) return [node]
    if (node.op === 'in') return [{ ...node, op: 'not_in' }]
    if (node.op === 'not_in') return [{ ...node, op: 'in' }]
    if (node.op === 'contains') return [{ key: node.key, op: 'not_in', values: [node.value] }]
    return null
  }
  if (node.not) return flattenLogic(node.not, !neg)
  const k = GROUPS.find(g => Array.isArray(node[g]))
  const parts = node[k].map(c => flattenLogic(c, k === 'none' ? !neg : neg))
  if (parts.some(p => p === null)) return null
  if (k === 'any' ? neg : !neg) return parts.flat()                     // every part must hold
  if (parts.length === 1) return parts[0]
  // any ONE part may hold: "any of" one field's values is one `in`; anything else is a real OR
  const one = parts.map(p => (p.length === 1 ? p[0] : null))
  if (one.some(p => !p || p.op !== 'in' || p.key !== one[0].key)) return null
  return [{ ...one[0], values: [...new Set(one.flatMap(p => p.values))] }]
}

/** The model's `rank` → { rank: the engine's {criteria} | null } | { error }. Direction is the model's to state, never defaulted. */
function rankOf(raw) {
  if (!Array.isArray(raw) || !raw.length) return { rank: null }
  if (raw.length > RANK_MAX) return { error: `a rank takes at most ${RANK_MAX} measures` }
  const criteria = []
  for (const c of raw) {
    const name = String(c?.field || '')
    if (isHidden(name)) return { error: refusalFor([name]) }
    const f = fieldOf(name)
    if (!f) return { error: `the Screener has no field “${name}” to rank by` }
    if (f.provider || f.type !== 'range') return { error: `${f.label} can't be ranked: a rank needs a number field from the Screener` }
    if (criteria.some(x => x.key === f.key)) return { error: `${f.label} is in the rank twice` }
    const weight = c.weight == null ? 1 : Number(c.weight)
    if (!(weight > 0) || !Number.isFinite(weight)) return { error: `the weight for ${f.label} must be a positive number` }
    criteria.push({ key: f.key, weight, ...(c.lower_better === true ? { ascending: true } : {}) })
  }
  return { rank: { criteria } }
}

/** ONE CLOCK: with any measure of a provider in use, a catalog field that provider supersedes
 *  (the snapshot price, superseded by the session's close) is checked on the provider's value. */
function settleClock(spec) {
  const post = [...(spec.post || [])]
  if (!post.length) return spec
  const used = new Set(post.map(f => measureOf(f.key)?.provider.id))
  const swap = new Map(allMeasures().filter(m => m.supersedes && used.has(m.provider.id)).map(m => [m.supersedes, m.key]))
  const filters = []
  for (const f of spec.filters || []) {
    if (swap.has(f.key) && f.op !== 'in' && f.op !== 'not_in' && !COL_OPS.includes(f.op)) post.push({ ...f, key: swap.get(f.key) })
    else filters.push(f)
  }
  return { ...spec, filters, post }
}
/** ⛔ ONE CLOCK, the part settleClock can't swap: a superseded field inside a group, a comparison or a rank is evaluated by
 *  the engine on the SNAPSHOT, beside measures from the session. Refused in a sentence, never two clocks in one screen. */
function clockClash(spec) {
  const post = spec.post || []
  if (!post.length || (!spec.logic && !spec.rank && !(spec.filters || []).some(f => COL_OPS.includes(f.op)))) return null
  const used = new Set(post.map(f => measureOf(f.key)?.provider.id))
  const old = new Set(allMeasures().filter(m => m.supersedes && used.has(m.provider.id)).map(m => m.supersedes))
  const named = [...logicLeaves(spec.logic).flatMap(f => [f.key, f.other]), ...(spec.filters || []).filter(f => COL_OPS.includes(f.op)).flatMap(f => [f.key, f.other]), ...(spec.rank?.criteria || []).map(c => c.key)]
  const hit = named.find(k => old.has(k))
  return hit ? `${fieldOf(hit)?.label || hit} can't be used in a group, comparison or rank together with latest-session conditions: they read different days` : null
}

// A filter as the engine takes it: without the local `pending` mark (and without `key` for the page link).
const wireOf = (f, noKey = false) => { const o = { ...f }; delete o.pending; delete o.label; if (noKey) delete o.key; return o }
const openLinkFor = (spec, savedId = null) => {
  if (savedId && /^\d+$/.test(savedId)) return { href: `/screener?savedScreen=${savedId}`, label: 'Open in Screener' }
  const map = Object.fromEntries((spec.filters || []).map(f => [f.key, wireOf(f, true)]))
  const s = encodeSpec({ filters: map, sort: spec.sort, ...(spec.rank ? { rank: spec.rank } : {}), ...(spec.logic ? { logic: spec.logic } : {}) })
  // The Screener page can't hold a measure condition, or two filters on one field: the link says what it leaves out.
  const left = [...(spec.post || []), ...(spec.filters || []).filter((f, i, all) => all.findIndex(g => g.key === f.key) !== i)]
  const label = left.length ? `Open in Screener (without ${[...new Set(left.map(f => fieldOf(f.key)?.label || f.key))].join(', ')})` : 'Open in Screener'
  return { href: s ? `/screener?s=${s}` : '/screener', label }
}

const scanBody = (spec, columns, page, size) => ({
  filters: (spec.filters || []).map(f => wireOf(f)), sort: spec.sort || DEFAULT_SORT, ...(spec.rank ? { rank: spec.rank } : {}),
  ...(spec.logic ? { logic: spec.logic } : {}), columns, page, page_size: size,
})

/** The engine's COMPLETE result for a spec, page by page (pages after the first in parallel),
 *  up to `max` rows. → { rows, total, res (the first page's envelope), cut } */
async function scanAll(spec, columns, max) {
  const first = await json(await post('/api/screener/scan', scanBody(spec, columns, 1, Math.min(PAGE, max))), 'Running the screen')
  const total = Number(first.total) || 0
  const want = Math.min(total, max)
  const pages = Math.ceil(want / PAGE)
  const more = pages > 1 ? await Promise.all(Array.from({ length: pages - 1 }, (_, i) => post('/api/screener/scan', scanBody(spec, columns, i + 2, PAGE)).then(r => json(r, 'Running the screen')))) : []
  const rows = [first, ...more].flatMap(r => r.rows || []).slice(0, want)
  return { rows, total, res: first, cut: total > want }
}

const passes = (v, f) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false
  if (f.op === 'gt') return v > f.min
  if (f.op === 'gte') return v >= f.min
  if (f.op === 'lt') return v < f.max
  if (f.op === 'lte') return v <= f.max
  if (f.op === 'eq') return v === f.value
  if (f.op === 'between') return v >= f.min && v <= f.max
  return false
}

/** Measure conditions over the engine's rows (in the engine's order). → { rows, values, asOf, notes } */
async function applyMeasures(spec, rows) {
  const ids = [...new Set((spec.post || []).map(f => measureOf(f.key)?.provider.id).filter(Boolean))]
  const values = {}
  const notes = []
  let asOf = null
  for (const id of ids) {
    const p = PROVIDERS.get(id)
    const r = await p.resolve(rows.map(x => x.ticker))
    if (r?.error) throw new Error(r.error)
    asOf = r.asOf || asOf
    for (const [t, v] of Object.entries(r.values || {})) values[t] = { ...(values[t] || {}), ...v }
    const missing = rows.filter(x => !r.values?.[x.ticker]).length
    if (missing) notes.push(`${missing.toLocaleString()} of the ${rows.length.toLocaleString()} candidate${rows.length === 1 ? '' : 's'} had no ${p.label || 'data'}${r.asOf ? ` for ${r.asOf}` : ''}, so they can't match`)
  }
  const kept = rows.filter(x => (spec.post || []).every(f => passes(values[x.ticker]?.[f.key], f)))
  return { rows: kept, values, asOf, notes }
}

/** How much of the universe each list field in the spec classifies (a row with none can't match). */
function coverageNotes(spec) {
  const out = []
  for (const f of spec.filters || []) {
    if (f.op !== 'in') continue
    const c = cache.options?.[f.key]
    if (c && c.total && c.with_value < c.total) {
      out.push(`${fieldOf(f.key)?.label || f.key} is known for ${c.with_value.toLocaleString()} of the ${c.total.toLocaleString()} stocks in UCT's Screener; the others can't match`)
    }
  }
  return out
}

/** The full result of a spec: the engine's rows, then any measure conditions. */
async function resultOf(spec, columns, max) {
  if (!(spec.post || []).length) {
    const r = await scanAll(spec, columns, max)
    return { rows: r.rows, total: r.total, res: r.res, cut: r.cut, asOf: null, values: {}, notes: [] }
  }
  const r = await scanAll(spec, columns, CANDIDATES_MAX)
  if (r.cut) throw new Error(`that screen has ${r.total.toLocaleString()} candidates before the latest-session conditions — more than I check at once (${CANDIDATES_MAX.toLocaleString()}). Add a condition (an industry, a price floor…)`)
  const m = await applyMeasures(spec, r.rows)
  return { rows: m.rows.slice(0, max), total: m.rows.length, res: r.res, cut: m.rows.length > max, asOf: m.asOf, values: m.values, notes: m.notes, candidates: r.total }
}

/** How many of `rows` carry a usable value (a finite number) of the sort field. A value of 0 counts. */
function sortCoverage(spec, rows, values = {}) {
  if (!spec?.sort) return { label: null, ranked: 0 }
  const k = spec.sort.key
  const isMeasure = (spec.post || []).some(f => f.key === k)
  const ranked = rows.filter(x => { const v = isMeasure ? values[x.ticker]?.[k] : x[k]; return typeof v === 'number' && Number.isFinite(v) }).length
  return { label: fieldOf(k)?.label || k, ranked }
}

/** ⛔ RANKING INTEGRITY (integration 2026-10-11): a requested ranking whose field has NO usable value
 *  in the results cannot be established. Nothing is presented as that ranking — no rows shown as "the
 *  strongest", no first-N handed to a list or charts — and nothing is substituted or invented. */
const unrankableText = (label, dir) => `${label} data is unavailable for these results, so the ${dir === 'asc' ? 'lowest' : 'highest'} ${label} stocks can't be established from the available data — no list is shown as a ${label} ranking`

// Fields a screen is about: its flat filters, a compared field, its group and rank, the sort. The columns the answer asks for.
const fieldsIn = (spec) => [...new Set([...(spec.filters || []).flatMap(f => [f.key, f.other]), ...logicLeaves(spec.logic).flatMap(f => [f.key, f.other]), ...(spec.rank?.criteria || []).map(c => c.key), spec.sort?.key].filter(k => k && fieldOf(k) && !fieldOf(k).provider && fieldOf(k).type !== 'list'))]
// ⛔ A ranked screen drops a row missing a ranked value (ranking.py): the count is said, never a quieter market.
const rankNotes = (receipt) => (receipt?.excluded_incomplete ? [`${Number(receipt.excluded_incomplete).toLocaleString()} more matched but ${receipt.excluded_incomplete === 1 ? 'is' : 'are'} missing a ranked value, so ${receipt.excluded_incomplete === 1 ? 'it was' : 'they were'} left out of the rank`] : [])

/** Run a wire spec through the engine: the real count + the first `show` rows. */
async function runSpec(spec, { show = SHOW_DEFAULT, name = null, savedId = null, notes: extra = [] } = {}) {
  const hidden = hiddenRefusal(spec)                      // SC-1 §2d: refused, never stripped
  if (hidden) return `I didn't run ${name ? `“${name}”` : 'it'}: ${hidden}.`
  const keys = fieldsIn(spec)
  const shown = Math.min(SHOW_MAX, Math.max(1, show))
  const t0 = Date.now()
  const r = await resultOf(spec, ['ticker', 'company', 'price', 'chg_pct_1d', ...keys], shown)
  const ms = Date.now() - t0
  const rows = r.rows.slice(0, shown)
  const mkeys = [...new Set((spec.post || []).map(f => f.key))]
  const extra3 = keys.filter(k => !['price', 'chg_pct_1d'].includes(k)).slice(0, 3)
  const priceCol = mkeys.some(k => fieldOf(k)?.supersedes === 'price') ? [] : [{ key: 'price', label: 'Price' }]
  const columns = [
    { key: 'ticker', label: 'Symbol' }, ...priceCol,
    ...mkeys.map(k => ({ key: k, label: fieldOf(k)?.label || k })),
    ...extra3.map(k => ({ key: k, label: fieldOf(k)?.label || k })), { key: 'chg_pct_1d', label: 'Chg 1D' },
  ]
  const fmt = (k, v) => {
    if (v == null || v === '') return '—'
    if (typeof v !== 'number') return String(v)
    const f = k === 'chg_pct_1d' ? { unit: '%' } : fieldOf(k)
    const n = Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toFixed(2)
    return f?.unit === '$' || k === 'price' ? `$${n}` : f?.unit === '%' ? `${n}%` : n
  }
  const valueOf = (row, k) => (mkeys.includes(k) ? r.values[row.ticker]?.[k] : row[k])
  const total = r.total
  setLast({ spec, name, savedId, total, asOf: r.asOf || r.res.snapshot_date || null, live: r.res.snapshot?.live?.state || null, symbols: rows.map(x => x.ticker), ms })
  const head = `${name ? `${name}: ` : ''}${Number(total).toLocaleString()} stock${total === 1 ? '' : 's'} match${total === 1 ? 'es' : ''}`
  const all = specParts(spec)
  const what = all.length ? ` (${all.join(' · ')})` : ''
  const asOf = r.asOf ? ` Latest completed session: ${r.asOf}.` : r.res.snapshot_date ? ` Data: ${r.res.snapshot_date} snapshot${r.res.snapshot?.live?.state === 'live' ? ', live prices' : ''}.` : ''
  // ⭐ ACCEPTANCE (2026-10-11): "by RS Rank" only as far as the RETURNED rows actually carry it. On a
  // snapshot with no RS Rank (measured: 3,665/3,665 null on the local copy) the engine's order is
  // not an RS Rank order, so it is not called one; partial coverage is said with its count.
  const { label: sortLabel, ranked } = sortCoverage(spec, rows, r.values)
  // ⛔ NO usable value at all: the engine's order is not that ranking, so no rows are shown as one.
  const unrankable = !!spec.sort && rows.length > 0 && ranked === 0
  const sortWord = spec.rank ? ` by your weighted rank (${rankWords(spec.rank)})` : !spec.sort ? `, ${DEFAULT_ORDER_WORDS}`
    : ` by ${sortLabel} (${spec.sort.dir === 'asc' ? 'lowest' : 'highest'} first)${ranked < rows.length ? `; only ${ranked} of these ${rows.length} have ${sortLabel} values — the other ${rows.length - ranked} have none and are not ranked by it` : ''}`
  const showing = unrankable ? ` ${unrankableText(sortLabel, spec.sort.dir)}.` : rows.length ? ` Showing the first ${rows.length}${sortWord}.` : ''
  const notes = [...extra, ...coverageNotes(spec), ...rankNotes(r.res.rank), ...r.notes]
  return {
    text: `${head}${what}.${showing}${asOf}${notes.length ? ` ${notes.map(n => `${n}.`).join(' ')}` : ''}`,
    table: rows.length && !unrankable ? { columns, rows: rows.map(x => Object.fromEntries(columns.map(c => [c.key, c.key === 'ticker' ? x.ticker : fmt(c.key, valueOf(x, c.key))]))) } : null,
    link: openLinkFor(spec, savedId),
  }
}

// ── SC-1 GATEWAY PATH (dark: only while the server serves Agent scans — GET /api/agent/config → scan) ──
// With the gateway on, a conversational screen ANSWER is one MD-1 read: `screen.run` (≤50 rows, the
// coverage receipt, the data's own `as_of`, stale) — never the /api/screener/* routes, never a second
// scan engine. The server spends the turn's ONE scan on it; `trace.currentTurnId()` (the member's turn) is what
// that budget is keyed by, so a missing turn id REFUSES rather than minting one (a per-call id would
// void the one-scan-per-turn limit).
// ⚠️ NOT on this path, by SC-1's 50-row cap: `produce()` (up to FILL_MAX symbols for a list) and screens
// with latest-session measure conditions (they page up to CANDIDATES_MAX candidates). Both stay on the
// Screener's own routes.
// #621: the server must ALSO list the kind in `data_kinds` (UCT_AGENT_DATA_KINDS, fail-closed). Not listed, or an older
// server with no list: the Screener's own route, exactly as with the flags off -- never a refused gateway read.
const servesKind = (kind) => serverServesScan() && (serverDataKinds() || []).includes(kind)
const usesGateway = (spec) => servesKind('screen.run') && !(spec?.post || []).length

/** One `screen.run` through the gateway → the answer text/table, or a refusal sentence. */
async function runViaGateway(spec, { show = SHOW_DEFAULT, name = null, savedId = null, notes: extra = [] } = {}) {
  const hidden = hiddenRefusal(spec)                      // SC-1 §2d: refused, never stripped
  if (hidden) return `I didn't run ${name ? `“${name}”` : 'it'}: ${hidden}.`
  // the member's open turn (trace.js: ONE per message / panel action) — the server's budget key; never minted
  const turnId = currentTurnId()
  if (!turnId) return "I didn't run it: this screen needs the Agent's turn, which wasn't available."
  const keys = fieldsIn(spec)
  const shown = Math.min(SHOW_MAX, Math.max(1, show))
  const own = savedId && /^\d+$/.test(String(savedId))
  const params = own
    ? { saved_id: Number(savedId), limit: shown }
    : { spec: { filters: (spec.filters || []).map(f => wireOf(f)), sort: spec.sort || DEFAULT_SORT, ...(spec.rank ? { rank: spec.rank } : {}), ...(spec.logic ? { logic: spec.logic } : {}), columns: ['ticker', 'company', 'price', 'chg_pct_1d', ...keys] }, limit: shown }
  const t0 = Date.now()
  const env = await readData('screen.run', params, { purpose: 'answer', turnId })
  const ms = Date.now() - t0
  if (!env || (env.status !== 'ok' && env.status !== 'partial')) {
    const why = (env?.notes || [])[0] || 'the Screener could not answer'
    return `I didn't run it: ${why.replace(/\.$/, '')}.`
  }
  const d = env.data || {}
  const rows = (d.rows || []).slice(0, shown).map(r => ({ ...r, ticker: r.symbol }))
  const total = Number(d.total_matches) || 0
  const extra3 = keys.filter(k => !['price', 'chg_pct_1d'].includes(k)).slice(0, 3)
  const columns = [{ key: 'ticker', label: 'Symbol' }, { key: 'price', label: 'Price' }, ...extra3.map(k => ({ key: k, label: fieldOf(k)?.label || k })), { key: 'chg_pct_1d', label: 'Chg 1D' }]
  const fmt = (k, v) => {
    if (v == null || v === '') return '—'
    if (typeof v !== 'number') return String(v)
    const f = k === 'chg_pct_1d' ? { unit: '%' } : fieldOf(k)
    const n = Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toFixed(2)
    return f?.unit === '$' || k === 'price' ? `$${n}` : f?.unit === '%' ? `${n}%` : n
  }
  const asOfDay = typeof env.as_of === 'string' ? env.as_of.slice(0, 10) : null
  setLast({ spec, name: name || d.origin?.name || null, savedId, total, asOf: asOfDay, live: null, symbols: rows.map(x => x.ticker), ms, envelope: { as_of: env.as_of, stale: env.stale, coverage: env.coverage, freshness: env.freshness } })
  const head = `${name ? `${name}: ` : ''}${total.toLocaleString()} stock${total === 1 ? '' : 's'} match${total === 1 ? 'es' : ''}`
  const parts = specParts(spec)
  const what = parts.length ? ` (${parts.join(' · ')})` : ''
  const { label: sortLabel, ranked } = sortCoverage(spec, rows, {})
  const unrankable = !!spec.sort && rows.length > 0 && ranked === 0
  const sortWord = spec.rank ? ` by your weighted rank (${rankWords(spec.rank)})` : !spec.sort ? `, ${DEFAULT_ORDER_WORDS}`
    : ` by ${sortLabel} (${spec.sort.dir === 'asc' ? 'lowest' : 'highest'} first)${ranked < rows.length ? `; only ${ranked} of these ${rows.length} have ${sortLabel} values — the other ${rows.length - ranked} have none and are not ranked by it` : ''}`
  const showing = unrankable ? ` ${unrankableText(sortLabel, spec.sort.dir)}.` : rows.length ? ` Showing the first ${rows.length}${sortWord}.` : ''
  const c = env.coverage
  const covLine = c && (c.dropped || c.not_computable) ? `Checked ${c.evaluated.toLocaleString()} stocks: ${c.answered.toLocaleString()} could be decided${c.not_computable ? `, ${c.not_computable.toLocaleString()} had a missing value` : ''}${c.dropped ? `, ${c.dropped.toLocaleString()} ${c.dropped === 1 ? 'was' : 'were'} excluded for stopped price history` : ''}` : null
  // the envelope's own notes carry the data's time ("as of the <date> close, not live"), staleness and any overlay
  // (the coverage line above already says what was excluded / not computable: the envelope's own coverage notes would repeat it)
  const envNotes = (env.notes || []).filter(n => !/^Showing \d+ of \d+ matches\.?$/.test(n) && !/^Ordered by market cap, largest first/.test(n) && !/^\d[\d,]* names? (?:was|were) excluded because|^\d[\d,]* names? could not be decided/.test(n)).map(n => n.replace(/\.$/, ''))
  const notes = [...extra, ...coverageNotes(spec), ...rankNotes(d.rank), ...(env.stale ? ['This data is stale'] : []), ...(covLine ? [covLine] : []), ...envNotes]
  return {
    text: `${head}${what}.${showing}${notes.length ? ` ${notes.map(n => `${n}.`).join(' ')}` : ''}`,
    table: rows.length && !unrankable ? { columns, rows: rows.map(x => Object.fromEntries(columns.map(col => [col.key, col.key === 'ticker' ? x.ticker : fmt(col.key, x[col.key])]))) } : null,
    link: openLinkFor(spec, own ? String(savedId) : null),
  }
}

/** The member's own saved screens through `screen.saved` (read-only) → the answer text. */
async function listSavedViaGateway() {
  // the member's open turn (trace.js: ONE per message / panel action) — the server's budget key; never minted
  const turnId = currentTurnId()
  if (!turnId) return "I couldn't read your screens: this needs the Agent's turn, which wasn't available."
  const env = await readData('screen.saved', {}, { purpose: 'answer', turnId })
  if (!env || (env.status !== 'ok' && env.status !== 'partial')) return `I couldn't read your screens: ${((env?.notes || [])[0] || 'the Screener could not answer').replace(/\.$/, '')}.`
  const screens = env.data?.screens || []
  if (!screens.length) return "You haven't saved any screens yet."
  const names = screens.map(s => (s.runnable ? s.name : `${s.name} (can't run here: ${s.reason})`))
  return `Your screens: ${names.join(', ')}`
}

// ⛔ A NEW SCREEN STARTS CLEAN (AUDIT live, 2026-11-05): in an existing chat, "find stocks up 20% this month near 52-week
// highs" kept the previous screen's industry, while the same words in a new chat did not. `mode` is the model's call, and
// nothing checked it. AUDIT's ruling, 2026-11-05: structure first, and a narrow fix. Two or more conditions of its own and
// no reference to the earlier results is a fully specified screen, so it starts clean. One condition ("only tech", "drop
// under $10") or a word pointing back stays the model's refinement. A turn whose words aren't known here (a panel action, a
// fast path) keeps the model's mode. ⛔ Reference words are the ONLY word class here: no list of verbs or openers.
const POINTS_BACK = /\b(?:those|them|these|they|ones|same|results?|remaining|rest|(?:that|this) (?:list|screen|scan))\b/
/** 'new' when `text` with `conditions` conditions of its own stands alone, else 'refine'. Pure. */
export const followUpShape = (text, conditions) => (conditions >= 2 && !POINTS_BACK.test(String(text || '').toLowerCase()) ? 'new' : 'refine')
/** This turn's own words, or null: never a past turn's, which would decide today's screen from yesterday's request. */
const saidThisTurn = () => (cache.said && cache.said.turn && cache.said.turn === currentTurnId() ? cache.said.text : null)
const askWhich = () => `Should I narrow your last screen (${specWords(cache.last.spec)}), or start a new one with only these conditions?`
/** A list value from the last screen that this request's words never name: copied across, not asked for. */
const carried = (wire, text) => {
  const lastOnes = cache.last?.spec?.filters || []
  const said = tok(text)
  return wire.find(f => Array.isArray(f.values) && lastOnes.some(g => g.key === f.key && JSON.stringify(g.values) === JSON.stringify(f.values))
    && !f.values.some(v => tok(shownValue(f.key, v)).trim().split(' ').some(w => w.length >= 3 && said.includes(` ${w.slice(0, 4)}`)))) || null
}

/** The model's screen args → the Screener's wire spec (with "refine" building on the last screen). */
function buildSpec({ filters, sort_field: sortField, sort_dir: sortDir, mode, within = null, logic: logicArg = null, rank: rankArg = null }, { lenient = false, host = null } = {}) {
  if ((filters || []).length > MAX_FILTERS) return { error: `that's more than ${MAX_FILTERS} conditions at once` }
  const read = readLogic(logicArg)
  if (read.error) return { error: read.error }
  const rankRead = readLogic(rankArg)
  if (rankRead.error) return { error: "I couldn't read that rank" }
  const rankList = rankRead.tree
  // W1-C C-01: a screen that names a hidden UCT field gets the SC-1 §2d sentence PLUS one public alternative
  // (scanRefine.js), checked before the catalog so the alternative is always offered — on a refinement AND on a new
  // screen (W1.1 R-05 / live LT-11: "show me my strongest stocks" gave the bare sentence with no alternative)
  {
    // ...and through every new shape: a compared field, a leaf of the tree, a rank measure
    const why = refineRefusal([...(filters || []).flatMap(x => [String(x?.field || ''), String(x?.other || '')]), ...logicNames(read.tree), ...(Array.isArray(rankList) ? rankList.map(c => String(c?.field || '')) : []), ...(sortField ? [sortField] : [])])
    if (why) return { error: why.replace(/\.$/, '') }
  }
  const w = toWireFilters(filters, { lenient })
  if (w.error) return { error: w.error }
  let wire = w.filters
  const rk = rankOf(rankList)
  if (rk.error) return { error: rk.error }
  if (rk.rank && sortField) return { error: 'a weighted rank sets the order, so it can\'t also be sorted: say which one you want' }
  // ⛔ THE TREE. Exactly a flat list → that list (the same rows, on any server). Otherwise it stays a tree: see the gate below.
  let logic = null
  const notes = [...w.notes]
  if (read.tree) {
    const t = logicToWire(read.tree, { lenient })
    if (t.error) return { error: t.error }
    notes.push(...t.notes)
    const flat = flattenLogic(t.tree)
    if (!flat) logic = t.tree
    else if (wire.length + flat.length > MAX_FILTERS) return { error: `that's more than ${MAX_FILTERS} conditions at once` }
    else wire = [...wire, ...flat]
  }
  // WITHIN one of the member's own lists: the engine's own "My Lists" universe (`list` ∈ wl:<id>).
  if (within != null && within !== '') {
    const lists = host?.watchlists?.snapshot?.() || null
    const l = lists ? lists.find(x => String(x.id) === String(within)) : null
    if (lists && !l) return { error: 'that isn\'t one of your watchlists' }
    wire = [...wire.filter(f => f.key !== 'list'), { key: 'list', op: 'in', value: `wl:${within}`, label: l?.name || null }]
  }
  // A follow-up's shape, over the conditions of every kind: flat, a tree's leaves, a rank
  const said = saidThisTurn()
  const standing = said && lastIsCurrent()
  const shape = standing && mode === 'refine' ? followUpShape(said, (filters || []).length + (read.tree ? leavesOfArgs({ logic: logicArg }).length : 0) + (rk.rank ? 1 : 0)) : null
  const fresh = shape === 'new'
  if (fresh) notes.push("That's a new screen, so nothing from your last one carried over")
  // the same mistake the other way round: mode new, with the last screen's list filter written back in
  if (standing && mode !== 'refine' && !POINTS_BACK.test(said.toLowerCase()) && carried(wire, said)) return { error: askWhich().replace(/\?$/, ''), ask: askWhich() }
  let postF = w.post
  let sort = null
  let rank = rk.rank
  if (sortField) {
    if (isHidden(sortField)) return { error: refusalFor([sortField]) }
    const sf = fieldOf(sortField)
    if (!sf || sf.provider || sf.type === 'list') return { error: `the Screener has no field “${sortField}” to sort by` }
    sort = { key: sortField, dir: sortDir === 'asc' ? 'asc' : 'desc' }
  }
  if (mode === 'refine' && !fresh) {
    // SC-2 §3 (W1-C C-01): a follow-up is a DELTA on the last screen — add / narrow replace by key, a sector or
    // industry replaces the universe slot, a sort replaces only the sort — and a hidden UCT field is refused with
    // the F-16 sentence + one public alternative (scanRefine.js). No last screen: ask, never guess.
    if (!lastIsCurrent()) return { error: NO_LAST_SCREEN.replace(/\.$/, '') }
    const c = composeRefine(cache.last.spec, { wire: wire.filter(f => f.key !== 'list'), post: postF, sort, logic, rank })
    if (c.error) return { error: c.error.replace(/\.$/, '') }
    const listF = wire.find(f => f.key === 'list')
    wire = listF ? [...c.spec.filters.filter(f => f.key !== 'list'), listF] : c.spec.filters
    postF = c.spec.post
    sort = c.spec.sort
    logic = c.spec.logic
    rank = c.spec.rank
    // a sector swapped on a screen whose group also names a sector still has to pass that group: said, never dropped
    if (cache.last.spec.logic && logicLeaves(cache.last.spec.logic).some(f => UNIVERSE_KEYS.includes(f.key)) && wire.some(f => UNIVERSE_KEYS.includes(f.key))) notes.push(`Your earlier group still applies: ${describeLogic(cache.last.spec.logic)}`)
  }
  if (!wire.length && !postF.length && !sort && !logic && !rank) return { error: 'which conditions? For example: ADR above 5% and price above $10' }
  if (logic && cache.meta?.logic === false) return { error: LOGIC_OFF }
  const spec = settleClock({ filters: wire, post: postF, sort: sort || null, ...(logic ? { logic } : {}), ...(rank ? { rank } : {}) })
  const clash = clockClash(spec)
  return clash ? { error: clash } : { spec, notes }
}

const specWords = (spec) => specParts(spec).join(' · ') || 'no filters'

/** A screen's RESULT as a typed symbol set: EVERY match (up to FILL_MAX) in the engine's own order.
 *  `count` is the true number of matches, so a consumer can refuse rather than cut. */
async function produceSymbols(spec, { name = null, savedId = null, notes: extra = [] } = {}) {
  const hidden = hiddenRefusal(spec)                      // SC-1 §2d: refused, never stripped
  if (hidden) throw new Error(hidden)
  const sk = spec.sort?.key
  const sortCol = sk && fieldOf(sk) && !fieldOf(sk).provider && fieldOf(sk).type !== 'list' && !(spec.post || []).some(f => f.key === sk) ? [sk] : []
  const r = await resultOf(spec, ['ticker', ...sortCol], FILL_MAX)
  const symbols = r.rows.map(x => x.ticker).filter(Boolean)
  const cov = sortCoverage(spec, r.rows, r.values)
  // ⛔ the result's ORDER is that ranking only as far as its rows carry the field: none → a first-N of
  // it is refused downstream (compose); some → the count is said on the receipt line.
  const unranked = spec.sort && r.rows.length && cov.ranked === 0 ? { label: cov.label, dir: spec.sort.dir } : null
  const partial = spec.sort && cov.ranked > 0 && cov.ranked < r.rows.length ? `only ${cov.ranked} of ${r.rows.length} have ${cov.label} values; the rest are not ranked by it` : null
  setLast({ spec, name, savedId, total: r.total, asOf: r.asOf || r.res.snapshot_date || null, live: r.res.snapshot?.live?.state || null, symbols, ms: 0 })
  const what = name ? `${name} (${specWords(spec)})` : specWords(spec)
  const notes = [...extra, ...coverageNotes(spec), ...rankNotes(r.res.rank), ...r.notes, ...(unranked ? [`${unranked.label} data is unavailable for these results`] : []), ...(partial ? [partial] : [])]
  const when = r.asOf ? ` on ${r.asOf}` : ''
  return {
    symbols, count: r.total, cap: FILL_MAX, ...(unranked ? { unranked } : {}),
    summary: (r.total ? `Screened ${what}${when}: ${Number(r.total).toLocaleString()} match${r.total === 1 ? '' : 'es'}` : `No stocks matched ${what}${when}`)
      + (notes.length ? ` (${notes.join('; ')})` : ''),
  }
}

/** Can the Screener page itself hold this spec (no measure conditions)? */
export const screenerExpressible = (spec) => !(spec?.post || []).length

// ── the target: the Screener engine as this member can use it ──
function snap() {
  return { ref: 'screener', label: 'Screener', ready: !!cache.meta, last: cache.last }
}
export const screenerKind = {
  name: 'screener',
  boardScoped: false,
  list: () => [snap()],
  read: (_h, ref) => (ref === 'screener' ? snap() : null),
  // Queries only: nothing here is ever committed.
  stateOf: (s) => ({ ...s }),
  patch: () => null,
  commit: () => false,
  landed: () => true,
  undoPatch: () => null,
  fingerprint: (s) => JSON.stringify(s.last?.spec || null),
}

const norm = (s) => String(s || '').toLowerCase().replace(/[“”"'`‘’]/g, '').replace(/\s+/g, ' ').trim()
/** W1.1 R-05: does the message name one of the member's saved (or UCT's starter) screens, whole words? */
function namesSavedScreen(lower) {
  const lib = cache.saved
  if (!lib) return false
  const text = ` ${norm(lower)} `
  return [...(lib.saved || []), ...(lib.starters || [])].some(s => { const n = norm(s?.name); return n.length >= 3 && text.includes(` ${n} `) })
}
const FILTER_ITEM = {
  type: 'object',
  properties: {
    field: { type: 'string' }, op: { type: 'string', enum: [...RANGE_OPS, ...LIST_OPS, ...TOKEN_OPS] },
    value: { type: ['number', 'null'] }, max: { type: ['number', 'null'] },
    values: { type: ['array', 'null'], items: { type: 'string' } },
  },
  required: ['field', 'op', 'value', 'max', 'values'], additionalProperties: false,
}
// A branch of its own, so the five-key condition every existing plan writes stays valid exactly as it was: the server
// checks nested objects closed, and a required `other` left out of ANY condition would fail the whole turn.
const COMPARE_ITEM = {
  type: 'object',
  properties: { field: { type: 'string' }, op: { type: 'string', enum: COL_OPS }, other: { type: 'string' } },
  required: ['field', 'op', 'other'], additionalProperties: false,
}
// What the model reads beside the field list: the manifest's hints (1000 characters) and shape (600) are full.
const COMPOSE_RULES = 'filters are ANDed. Field vs field: {field, op: gt_col|gte_col|lt_col|lte_col, other: a second number key} ("above the price target" = price gt_col pt_target). '
  + 'Candle Type: op contains, values = pattern words (every word must match); op in = any of them. '
  + 'OR / NOT: logic = a JSON STRING holding one tree of {"any":[…]}, {"all":[…]}, {"none":[…]} or {"not":x}, at most 4 deep; a leaf is one filter object, numbers in value/max as in filters; it is ANDed with filters. '
  + 'Up 5% today or 15% on the week: logic = "{\\"any\\":[{\\"field\\":\\"chg_pct_1d\\",\\"op\\":\\"gte\\",\\"value\\":5},{\\"field\\":\\"chg_pct_1w\\",\\"op\\":\\"gte\\",\\"value\\":15}]}". '
  + 'rank = a JSON STRING of [{"field":…,"weight":…,"lower_better":true|false}], number fields, percentile-weighted within the screen, sets the order (sort_field null). lower_better is the member\'s, ask if unclear. '
  + 'Never replace an any / none / not with a nearby flat filter, and never drop a condition you cannot say. '
  + 'mode: a request with its own stocks and conditions that does not point at the earlier results is new, even right after a screen; never copy lastScreen filters into it.'
const LOGIC_OFF_RULE = 'logic is OFF on this server: a tree runs only if it is exactly a flat screen (any of one list field\'s values, none of them), and anything else is refused. Say so, offer the conditions one at a time, never approximate it.'
// Does a screen use a list field (its values must be read before it can run)?
const usesList = (args) => [...(args?.filters || []), ...leavesOfArgs(args)].some(x => fieldOf(String(x?.field ?? x?.key ?? ''))?.type === 'list')
const leavesOfArgs = (args) => {
  const { tree } = readLogic(args?.logic)
  const walk = (n, depth = 0) => (depth > 24 || !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(x => walk(x, depth + 1)) : isLeaf(n) ? [n] : Object.values(n).flatMap(x => walk(x, depth + 1)))
  return walk(tree)
}
async function specFor(args, host = null) {
  await loadMeta()
  if (usesList(args)) await loadOptions()
  if (args?.mode === 'refine') await ensureLast()        // a reload / chat switch: the conversation's last screen
  return buildSpec(args, { host })
}

// Could this request involve screening? Deliberately BROAD (a false positive costs ~3 KB; a
// false negative still leaves every field key visible).
const SCREEN_WORDS = /\b(stocks?|screens?|screener|scan\w*|find|filter\w*|sort\w*|tickers?|names|compan\w+|results?|matches|those|them|top\s+\d+|above|below|over|under|between|at least|more than|less than|greater|higher|lower|adr|atr|rsi|volume|price|market cap|cap|growth|margin|eps|revenue|p\/?e|dividend|beta|float|earnings|perf\w*|gainers?|losers?|up|down|etfs?|sector|industry|leaders?|momentum|high|low|caps?|ripp\w*|runners?|movers?|oversold|overbought|pullbacks?|uptrends?|downtrends?|growers?|semis?|chips?|software|breakouts?|bases?)\b|%|\$/i
export const screenRelevant = (message) => SCREEN_WORDS.test(String(message || ''))

/**
 * The catalog's definitions for the model, inside the context limit. Six signed-run fields share one rule of about 400
 * bytes and most fields one closing sentence, so a sentence two fields share is written once in `key` and each field cites
 * it by letter. Nothing is shortened: every field's definition reads back whole from `notes` + `key`. Pure.
 */
export function fieldNotes(fields) {
  // a sentence ends at '.' or ':' followed by whitespace: the mark is kept, the whitespace dropped (no lookbehind: iOS 16 floor)
  const sentencesOf = (t) => {
    const s = String(t)
    const out = []
    let from = 0
    for (const m of s.matchAll(/[.:](\s+)/g)) { out.push(s.slice(from, m.index + 1)); from = m.index + 1 + m[1].length }
    out.push(s.slice(from))
    return out.filter(Boolean)
  }
  const seen = new Map()
  for (const f of fields) for (const s of new Set(sentencesOf(f.description || ''))) seen.set(s, (seen.get(s) || 0) + 1)
  const key = {}
  const mark = new Map()
  for (const [s, n] of seen) {
    if (n < 2 || s.length < 24) continue
    const id = mark.size < 26 ? String.fromCharCode(97 + mark.size) : `z${mark.size}`
    mark.set(s, id)
    key[id] = s
  }
  const notes = {}
  for (const f of fields) {
    if (!f.description) continue
    notes[f.key] = sentencesOf(f.description).map(s => (mark.has(s) ? `[${mark.get(s)}]` : s)).join(' ')
  }
  return Object.keys(notes).length ? { notes, key } : null
}

let registered = false
export function registerScreenerCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(screenerKind)
  registerWarmup(() => loadMeta())
  registerWarmup(() => loadOptions().catch(() => {}))

  registerContextProvider({
    key: 'screener',
    build: (_host, refFor, { message = '', nl1 = false } = {}) => {
      // W1-C C-01: the conversation's last screen may live only on the server yet (a reload); start the one read
      // so the model sees `lastScreen` from the next turn on, and a refine in THIS turn awaits it in specFor
      if (!lastIsCurrent() && activeConversationId()) ensureLast()
      const last = lastIsCurrent() ? cache.last : null
      // CONTEXT RELEVANCE: the full catalog (key:Label(unit), ~5 KB) only when the request could
      // be about screening; otherwise its KEYS (~2 KB) — the model can still see every field it
      // could screen on and discover a screen is wanted, it just gets no labels/units.
      // NL-1 (`nl1`, flag off by default): always the full catalog — no keyword decides it.
      const full = nl1 || !!last || screenRelevant(message)
      const notes = full && cache.meta ? fieldNotes(cache.meta.fields) : null
      if (message) cache.said = { text: message, turn: currentTurnId() }   // the words a follow-up's shape is read from
      return [{
        ref: refFor('screener', 'screener'), label: 'Screener',
        // The live catalog. Use ONLY these keys.
        fields: !cache.meta ? 'loading' : full
          ? [...cache.meta.fields, ...allMeasures()].map(f => `${f.key}:${f.label}${DIST_UNIT[distanceSign(f.key)] || (f.unit ? `(${f.unit})` : f.type === 'bool' ? '(yes/no)' : f.type === 'list' ? '(list)' : '')}`).join(';')
          : [...cache.meta.fields, ...allMeasures()].map(f => f.key).join(','),
        ...(full ? {} : { fieldsDetail: 'keys only (labels and units omitted for this request)' }),
        ...(notes ? { fieldNotes: notes.notes, fieldNotesKey: notes.key } : {}),
        ...(full ? { compose: `${COMPOSE_RULES}${cache.meta?.logic === false ? ` ${LOGIC_OFF_RULE}` : ''}` } : {}),
        ...(last ? { lastScreen: { ref: 'lastScreen', filters: specParts(last.spec), sort: last.spec.sort ? `${last.spec.sort.key} ${last.spec.sort.dir}` : null, ...(last.spec.rank ? { rank: rankWords(last.spec.rank) } : {}), matches: last.total, name: last.name } } : {}),
        ...(cache.saved ? { savedScreens: [...cache.saved.saved, ...cache.saved.starters].slice(0, 40).map(s => ({ id: s.id, name: s.name, kind: s.kind })) } : {}),
      }]
    },
    // Over the context budget the field notes go first: the keys and labels still let every screen be asked for
    compact: (sections) => sections.map((x) => { const s = { ...x }; if (!s.fieldNotes) return s; delete s.fieldNotes; delete s.fieldNotesKey; return { ...s, fieldNotesDetail: 'field definitions omitted for size' } }),
  })
  registerWarmup(() => loadSaved().catch(() => {}))
  // "Put the top 10 in Momentum" after a screen: the LAST screen, re-run fresh at apply.
  registerOutputSource({
    ref: 'lastScreen', type: SYMBOLS,
    available: () => lastIsCurrent(),
    summary: () => `Use your last screen (${specWords(cache.last.spec)}) — run fresh when you apply`,
    resolve: () => produceSymbols(cache.last.spec, { name: cache.last.name, savedId: cache.last.savedId }),
  })

  // ── screener.run ──
  registerCapability({
    name: 'screener.run',
    target: 'screener', query: true, surfaces: ['*'],
    // tried on the WHOLE message first, so "rank them by RS" is the screener's, never read as a plural chart target
    fastWhole: true,
    summary: 'Run a stock screen on UCT\'s Screener and show the real matches (count + top rows). Changes nothing in UCT. Use this for "show me / find stocks with …".',
    hints: 'target = the screener entry ref. Comparisons, OR/NOT, rank: `compose`. filters: each {field: a key from `fields` (never invented), op, value, max, values}. '
      + 'Numbers: op gt|gte|lt|lte|eq|between, value, max (between only, else null), values null; % fields take 5 for 5%, $ fields take dollars (10M = 10000000). '
      + 'yes/no: op eq, value 1|0. (list) fields: op in|not_in, values = the member\'s own words (["software"]) — UCT matches real values; value/max null. '
      + '"(latest session)" fields only when a session is named ("today", "yesterday"); "$10M a day" / "per day" if none named = the 30-day average, not share volume. '
      + 'A measure not in `fields`: say so, never substitute. sort_field/sort_dir or null. mode refine = change the LAST screen, else new. '
      + 'show: rows (null = 10, max 25). as: name the RESULT (screen1) when a later op uses its stocks ({from:"screen1", top:null} = all); else null. '
      + 'within: a watchlist ref only if they name that list ("in Momentum"); else null (whole market).',
    args: {
      type: 'object',
      properties: {
        filters: { type: 'array', items: { anyOf: [FILTER_ITEM, COMPARE_ITEM] } },
        sort_field: { type: ['string', 'null'] }, sort_dir: { type: ['string', 'null'], enum: ['asc', 'desc', null] },
        mode: { type: 'string', enum: ['new', 'refine'] }, show: { type: ['integer', 'null'] }, as: { type: ['string', 'null'] },
        within: { type: ['string', 'null'] },
        // a JSON STRING: the closed schemas every planner path compiles cannot hold a recursive tree (see COMPOSE_RULES)
        logic: { type: ['string', 'null'] },
        // a JSON string too: as a closed array its schema pushed the v2 flagship turn past DEFAULT_TURN_USD on Haiku 4.5
        rank: { type: ['string', 'null'] },
      },
      required: ['filters', 'sort_field', 'sort_dir', 'mode', 'show', 'as', 'within', 'logic', 'rank'], additionalProperties: false,
    },
    // args from before composition existed (fast paths, stored plans, older tests) read as no group and no rank
    absentAsNull: ['logic', 'rank'],
    // `within`: one of the member's own watchlists — the Screener's own "My Lists" universe (wl:<id>)
    argRefs: { within: 'watchlist' },
    // W1.1 R-01 (LT-3, live "sort them by 3 month performance" refused as off-schema): a refinement that only re-orders
    // comes without `filters`, with a nested {sort:{field,dir}}, or with "descending" — read as the schema's shape, never guessed
    argAliases: {
      sort_field: ['sort.field', 'sort.key', 'sort.by', 'sort_by', 'sortBy', 'sort_key', 'sortKey', 'order_by', 'orderBy', 'sort_on'],
      sort_dir: ['sort.dir', 'sort.direction', 'sort.order', 'sort_direction', 'sortDir', 'sortDirection', 'direction', 'order', 'sort_order', 'sortOrder'],
      show: ['limit', 'top', 'rows', 'count', 'page_size', 'pageSize'],
      filters: ['conditions', 'criteria'],
    },
    coerce: {
      sort_dir: { descending: 'desc', ascending: 'asc', descend: 'desc', ascend: 'asc', highest: 'desc', lowest: 'asc', 'high to low': 'desc', 'low to high': 'asc', 'highest first': 'desc', 'lowest first': 'asc', down: 'desc', up: 'asc' },
      mode: { refinement: 'refine', refined: 'refine', update: 'refine', modify: 'refine', narrow: 'refine', fresh: 'new', create: 'new', run: 'new' },
    },
    defaults: { filters: [] },
    // W1.1 review NB-2: only a REFINEMENT may leave filters out; a new screen without filters is still refused (never universe-wide)
    defaultsWhen: { filters: { mode: ['refine'] } },
    shape: 'a refinement that only changes the ORDER ("sort them by 3-month performance") is {"filters":[],"sort_field":"chg_pct_3m",'
      + '"sort_dir":"desc","mode":"refine","show":null,"as":null,"within":null,"logic":null,"rank":null} — filters is ALWAYS present ([] when nothing is added), '
      + 'sort_field is a key from `fields`, sort_dir is exactly "asc" or "desc" (never "descending"), and there is no nested "sort" object.',
    // As a PRODUCER (compose.js): the screen's tickers, in the engine's own order.
    produces: SYMBOLS,
    // Checked before a proposal (catalog permitting; the engine re-checks at apply).
    validateProduce(args, _target, host) {
      if (!cache.meta) return null
      const b = buildSpec(args, { lenient: true, host })
      return b.error ? `the screen can't run: ${b.error}` : null
    },
    describeProduce(args, _target, host) {
      const b = buildSpec(args, { lenient: true, host })
      const when = (b.spec?.post || []).length ? ' (latest completed session)' : ''
      return b.error ? 'Run the screen' : `Screen for ${specWords(b.spec)}${when}${b.spec.sort ? `, sorted by ${fieldOf(b.spec.sort.key)?.label || b.spec.sort.key}` : ''}${b.spec.rank ? `, ranked by ${rankWords(b.spec.rank)}` : ''} — run fresh when you apply`
    },
    async produce(args, host) {
      const b = await specFor(args, host)
      if (b.error) throw new Error(b.error)
      return produceSymbols(b.spec, { notes: b.notes })
    },
    // ⭐ STABILIZATION (2026-10-11 live check, owner ruling: the WHOLE market). Two obvious phrasings,
    // no model call, onto this same screen and the Screener's own RS Rank field:
    //   "show me my strongest stocks", "what are the strongest names", "RS leaders"
    //     → every stock, highest RS Rank first (within: null — a watchlist only when they name one,
    //       which goes to the model)
    //   "now only the ones above $50" (a screen already ran here) → that screen REFINED with price
    // Anything else — a named list, a second condition, a bare number — goes to the model.
    // ⭐ SAT-1 F-SAT-3: a message typed while the field catalog is still loading must not fall through to
    // the (paid) planner. The strongest phrase is fixed wording, so it is claimed WITHOUT the catalog; answer()
    // awaits the catalog and checks `rs_rank` exists then (a failed load is a refusal sentence, never a model
    // call). With the catalog loaded and no `rs_rank`, it is the planner's, exactly as before.
    fast: ({ lower }) => {
      if (/^(?:please )?(?:(?:show(?: me)?|find(?: me)?|list|give me|get(?: me)?|what are|which are) )?(?:my |the )?(?:strongest|rs leaders|relative strength leaders|highest rs(?: rank(?:ed)?)?)(?: stocks| names)?(?: right now| today)?$/.test(lower)) {
        // ⛔ SC-1 §2d (owner F-16 ruling): "strongest" in UCT's vocabulary IS the RS Rank ranking, a proprietary
        // rating. The phrase stays claimed so it never reaches the planner, and answer() refuses it with the §2d
        // sentence: 0 model calls, no screen, nothing substituted (never a return sort in its place).
        return { filters: [], sort_field: 'rs_rank', sort_dir: 'desc', mode: 'new', show: null, as: null, within: null }
      }
      // ⛔ the same refusal for an explicit request to RANK by RS ("rank them by RS", "sort by relative strength").
      // ONLY a screen or ranking by strength is claimed here: "put the strongest five on my watchlist" (the shown
      // order, memory), "the strongest of those", "stocks looking really strong today" (today's performance) and
      // "which is stronger, NVDA or AMD" are never claimed, so they never get a false refusal.
      if (/^(?:please )?(?:rank|sort|order)(?: (?:them|these|those|it|my stocks|the results|the list|this screen))? by (?:rs|rs rank|relative strength)(?: rank(?:ing)?)?$/.test(lower)) {
        return { filters: [], sort_field: 'rs_rank', sort_dir: 'desc', mode: 'new', show: null, as: null, within: null }
      }
      // ⛔ W1.1 R-05 (live LT-8, 2026-11-03): a SCREEN-SHAPED request whose own words name a hidden UCT field ("now only
      // the ones with rs rank over 90", "stocks with a uct composite over 90", "sort them by sponsorship grade") is
      // claimed HERE, before the planner can re-map the phrase to a public look-alike (rs_rank → rs_line_trend). The
      // claimed args carry the hidden key itself, so buildSpec refuses them with the F-16 sentence + the public
      // alternative: 0 model calls, no scan, nothing substituted. Questions and guide requests ("what is rs rank",
      // "where do i see the uct composite", "show dark pool levels on this chart") are not screens and stay unclaimed.
      // (a SAVED screen named in the message — "run my Composite screen" — is screener.runSaved's, which refuses a rated
      // saved screen by its own name; the planner / its fast path keep it)
      const hp = hiddenPhraseIn(lower)
      if (hp && hiddenScreenRequest(lower) && !namesSavedScreen(lower)) {
        return { filters: [{ field: hp.key, op: 'gte', value: 0, max: null, values: null }], sort_field: null, sort_dir: null, mode: 'new', show: null, as: null, within: null }
      }
      if (!cache.meta) return null
      const m = /^(?:(?:now|and|ok|okay) )?(?:show me )?(?:only|just) (?:the ones|those|them|the stocks|the names|stocks|names)? ?(above|over|under|below) \$(\d+(?:\.\d+)?)$/.exec(lower)
      if (m && cache.last && fieldOf('price')) {
        const op = m[1] === 'above' || m[1] === 'over' ? 'gt' : 'lt'
        return { filters: [{ field: 'price', op, value: Number(m[2]), max: null, values: null }], sort_field: null, sort_dir: null, mode: 'refine', show: null, as: null, within: null }
      }
      return null
    },
    async answer(_snap, args, host) {
      try { await metaWithin() } catch { return META_UNAVAILABLE }
      let b
      try { b = await specFor(args, host) } catch (e) { return `I didn't run it: ${e?.message || 'the Screener could not be read'}.` }
      if (b.ask) return b.ask
      if (b.error) return `I didn't run it: ${b.error}.`
      // the engine's own refusal (a group on a server that has them off, a rule of its own) is the answer, in a sentence
      try {
        if (usesGateway(b.spec)) return await runViaGateway(b.spec, { show: args.show || SHOW_DEFAULT, notes: b.notes })
        return await runSpec(b.spec, { show: args.show || SHOW_DEFAULT, notes: b.notes })
      } catch (e) {
        if (b.spec.logic || b.spec.rank) return `I didn't run it: ${String(e?.message || 'the Screener could not answer').replace(/\.$/, '')}.`
        throw e
      }
    },
  })

  // ── screener.runSaved ──
  // `screen` is a saved-screen id, or (F-SAT-3, before the list had loaded) `BY_NAME + <the member's words>`,
  // resolved here with the same rules the fast path uses: an exact name, else ONE clear fuzzy match.
  const resolveSaved = (lib, screen) => {
    const all = [...lib.saved, ...lib.starters]
    const key = String(screen)
    if (!key.startsWith(BY_NAME)) return { s: all.find(x => x.id === key) || null }
    const words = key.slice(BY_NAME.length)
    const exact = all.filter(x => norm(x.name) === norm(words) || norm(x.name) === norm(`${words} screen`))
    if (exact.length === 1) return { s: exact[0] }
    const f = exact.length ? { kind: 'none' } : matchName(words, all.map(x => x.name))
    const one = f.kind === 'fuzzy' ? all.filter(x => x.name === f.name) : []
    if (one.length === 1) return { s: one[0] }
    const names = all.map(x => x.name)
    return { s: null, why: `I couldn't find one saved screen called “${words}”${names.length ? ` (your screens: ${names.slice(0, 12).join(', ')})` : ''}` }
  }
  registerCapability({
    name: 'screener.runSaved',
    target: 'screener', query: true, surfaces: ['*'],
    summary: 'Run one of the member\'s saved screens (or a UCT starter screen) and show the real matches.',
    hints: 'target = the ref of the screener entry; screen = the id of an entry in savedScreens (never invent one; clarify with the real names if unsure). show: rows (null = 10). '
      + 'as: name its RESULT when a later op in the same request uses its stocks; else null.',
    args: { type: 'object', properties: { screen: { type: 'string' }, show: { type: ['integer', 'null'] }, as: { type: ['string', 'null'] }, }, required: ['screen', 'show', 'as'], additionalProperties: false },
    produces: SYMBOLS,
    describeProduce({ screen }) {
      const s = cache.saved && resolveSaved(cache.saved, screen).s
      const label = s ? `“${s.name}”` : String(screen).startsWith(BY_NAME) ? `“${String(screen).slice(BY_NAME.length)}”` : String(screen)
      return `Run your screen ${label} — fresh when you apply`
    },
    async produce({ screen }) {
      await loadMeta()
      const lib = await loadSaved()
      const { s, why } = resolveSaved(lib, screen)
      if (!s) throw new Error(why || "that saved screen isn't there any more")
      return produceSymbols({ filters: s.spec?.filters || [], sort: s.spec?.sort || null, rank: s.spec?.rank || null, logic: s.spec?.logic || null }, { name: s.name, savedId: s.kind === 'yours' ? s.id : null })
    },
    fast: ({ raw }) => {
      const m = /^(?:run|open|show(?: me)?|load) (?:my |the )?(.+?)(?: screen| scan)?[.!]?$/i.exec(String(raw).trim())
      if (!m) return null
      // ⭐ SAT-1 F-SAT-3: the saved list is still loading. Only an EXPLICIT "… screen"/"… scan" is claimed
      // (so "show me AAPL" is never mistaken for a screen), carried by NAME and resolved in answer()/produce()
      // against the member's own list exactly as below; no match or a tie is a sentence, never a model call.
      if (!cache.saved) return /\s(?:screen|scan)[.!]?$/i.test(String(raw).trim()) ? { screen: `${BY_NAME}${m[1]}`, show: null, as: null } : null
      const all = [...cache.saved.saved, ...cache.saved.starters]
      const hits = all.filter(s => norm(s.name) === norm(m[1]) || norm(s.name) === norm(`${m[1]} screen`))
      if (hits.length) return hits.length === 1 ? { screen: hits[0].id, show: null, as: null } : null
      // NL N2: a typo in the screen's own name ("run my breakuot screen") — running is read-only;
      // ONE clear match only, a tie or nothing close → the model, which sees the real names
      const f = matchName(m[1], all.map(s => s.name))
      const one = f.kind === 'fuzzy' ? all.filter(s => s.name === f.name) : []
      return one.length === 1 ? { screen: one[0].id, show: null, as: null } : null
    },
    async answer(_snap, { screen, show }) {
      try { await metaWithin() } catch { return META_UNAVAILABLE }
      let lib
      try { lib = await loadSaved() } catch (e) { return `I couldn't run it: ${e?.message || 'your screens could not be read'}.` }
      const { s, why } = resolveSaved(lib, screen)
      if (!s) return why ? `${why}.` : "I couldn't find that saved screen."
      const sspec = { filters: s.spec?.filters || [], sort: s.spec?.sort || null, rank: s.spec?.rank || null, logic: s.spec?.logic || null }
      // the member's OWN screen is run by id (the server resolves it among THEIR screens only); a starter by its spec
      if (usesGateway(sspec)) return runViaGateway(sspec, { show: show || SHOW_DEFAULT, name: s.name, savedId: s.kind === 'yours' ? s.id : null })
      return runSpec({ filters: s.spec?.filters || [], sort: s.spec?.sort || null, rank: s.spec?.rank || null, logic: s.spec?.logic || null }, { show: show || SHOW_DEFAULT, name: s.name, savedId: s.kind === 'yours' ? s.id : null })
    },
  })

  // ── screener.state / screener.listSaved ──
  registerCapability({
    name: 'screener.state',
    target: 'screener', query: true, surfaces: ['*'],
    summary: 'Say what the last screen run here was: its filters, sort and number of matches.',
    hints: 'target = the ref of the screener entry.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    fast: ({ lower }) => (/^(what filters (am i using|are on|are applied)|how is (this|it|the screen) sorted|how many (results|matches|stocks)( are there| did (it|that) find)?|what('s| is) (this|the) screen)$/.test(lower) ? {} : null),
    answer() {
      const l = cache.last
      if (!l) return "I haven't run a screen in this conversation yet. (I can't see the filters open on the Screener page itself from here.)"
      const f = specParts(l.spec).join(' · ') || 'no filters'
      const s = l.spec.rank ? `by a weighted rank (${rankWords(l.spec.rank)})` : l.spec.sort ? `by ${fieldOf(l.spec.sort.key)?.label || l.spec.sort.key}, ${l.spec.sort.dir === 'asc' ? 'lowest' : 'highest'} first` : "in UCT's default order"
      return `${l.name ? `${l.name}: ` : 'The last screen I ran: '}${f}. Sorted ${s}. ${Number(l.total).toLocaleString()} matches${l.asOf ? ` (data ${l.asOf})` : ''}.`
    },
  })
  registerCapability({
    name: 'screener.listSaved',
    target: 'screener', query: true, surfaces: ['*'],
    summary: 'List the member\'s saved screens and UCT\'s starter screens.',
    hints: 'target = the ref of the screener entry.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    fast: ({ lower }) => (/^((what|which) (saved )?(screens|scans) (do i have|have i saved)|(show|list)( me)?( my)? (saved )?screens|my (saved )?screens)$/.test(lower) ? {} : null),
    async answer() {
      if (servesKind('screen.saved')) return listSavedViaGateway()
      const lib = await loadSaved()
      const mine = lib.saved.map(s => s.name)
      const starters = lib.starters.map(s => s.name)
      return [mine.length ? `Your screens: ${mine.join(', ')}` : "You haven't saved any screens yet.", starters.length ? `UCT starters: ${starters.join(', ')}` : ''].filter(Boolean).join('\n')
    },
  })
}
