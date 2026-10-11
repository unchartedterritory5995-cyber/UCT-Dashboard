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
// nothing to propose. The Agent remembers only its LAST screen in this session, so
// "add price above $10" can refine it.
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
// ⛔ Not here: operating the Screener PAGE's own filters (it only exists inside
// /screener), My Scans (Indicator formulas), logic groups. Saving / renaming / copying /
// deleting SAVED screens is capabilities/savedScreens.js (the same routes the Screener's menu uses).

import { registerCapability, registerTargetKind, registerContextProvider, registerWarmup, registerOutputSource, SYMBOLS } from '../capabilities'
import { encodeSpec } from '../../pages/screener/shell/specUrl'

const META_TTL_MS = 6 * 3600 * 1000      // the registry changes only on deploy
const SAVED_TTL_MS = 60 * 1000
const MAX_FILTERS = 12
const SHOW_DEFAULT = 10
const SHOW_MAX = 25
const RANGE_OPS = ['gt', 'gte', 'lt', 'lte', 'eq', 'between']
const LIST_OPS = ['in', 'not_in']
const OP_WORD = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', between: 'between' }
const PAGE = 500                  // the engine's own page cap (services/screener/query.py _MAX_PAGE)
// The most stocks one screen hands to another action (e.g. filling a watchlist). Not a storage
// limit (the watchlist server has none): a bound on one request, always SAID, never a silent cut.
export const FILL_MAX = 1000
const CANDIDATES_MAX = 10000      // a screen with measure conditions reads at most this many candidates
const DEFAULT_SORT = { key: 'uct_composite', dir: 'desc' }

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

const cache = { meta: null, metaAt: 0, metaP: null, options: null, optionsAt: 0, optionsP: null, saved: null, savedAt: 0, last: null }
export function _resetScreenerCache() { cache.meta = null; cache.metaAt = 0; cache.metaP = null; cache.options = null; cache.optionsAt = 0; cache.optionsP = null; cache.saved = null; cache.savedAt = 0; cache.last = null }

export function loadMeta() {
  if (cache.meta && Date.now() - cache.metaAt < META_TTL_MS) return Promise.resolve(cache.meta)
  if (!cache.metaP) {
    cache.metaP = req('/api/screener/fields').then(r => json(r, 'Reading the Screener fields')).then(m => {
      const list = Array.isArray(m.fields) ? m.fields : []
      cache.meta = { fields: list.filter(f => f && f.key && (f.type === 'range' || f.type === 'bool' || f.type === 'enum')).map(f => ({ key: f.key, label: f.label || f.key, type: f.type === 'enum' ? 'list' : f.type, unit: f.unit || '', category: f.category || null })) }
      cache.metaAt = Date.now()
      return cache.meta
    }).finally(() => { cache.metaP = null })
  }
  return cache.metaP
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
const fmtVal = (f, v) => (v == null ? '' : f?.unit === '$' ? `$${big(v)}` : f?.unit === '%' ? `${v}%` : String(v))
function describeFilter(fl) {
  const f = fieldOf(fl.key)
  const label = f?.label || fl.key
  if (fl.key === 'list') return `In “${fl.label || 'your watchlist'}”`
  if (fl.op === 'in' || fl.op === 'not_in') return `${label}${fl.op === 'not_in' ? ' not' : ''}: ${(fl.values || []).join(', ')}`
  if (f?.type === 'bool') return `${label}: ${Number(fl.value) === 1 ? 'yes' : 'no'}`
  if (fl.op === 'between') return `${label} ${fmtVal(f, fl.min)}–${fmtVal(f, fl.max)}`
  const v = fl.op === 'lt' || fl.op === 'lte' ? fl.max : fl.op === 'eq' ? fl.value : fl.min
  return `${label} ${OP_WORD[fl.op] || fl.op} ${fmtVal(f, v)}`
}

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
function listFilter(f, x, { lenient = false } = {}) {
  const op = x.op === 'not_in' ? 'not_in' : (LIST_OPS.includes(x.op) || x.op === 'eq') ? 'in' : null
  if (!op) return { error: `${f.label} takes a list of values (in / not in)` }
  const words = (Array.isArray(x.values) ? x.values : []).map(v => String(v || '').trim()).filter(Boolean)
  if (!words.length) return { error: `which ${f.label.toLowerCase()}?` }
  const opts = cache.options?.[f.key]?.values
  if (!opts) return lenient ? { filter: { key: f.key, op, values: words, pending: true } } : { error: `the ${f.label} values couldn't be read right now` }
  const m = matchValues(opts, words)
  if (m.values) return { filter: { key: f.key, op, values: m.values } }
  // The member's words may name the sibling field ("software" is an Industry, not a Sector):
  // used ONLY when exactly one other list field of the same kind holds every word, and said so.
  const sibs = (cache.meta?.fields || []).filter(g => g.type === 'list' && g.key !== f.key && g.category === f.category && cache.options?.[g.key]?.values)
  const fits = sibs.map(g => ({ g, m: matchValues(cache.options[g.key].values, words) })).filter(r => r.m.values)
  if (fits.length === 1) return { filter: { key: fits[0].g.key, op, values: fits[0].m.values }, note: `“${words.join(', ')}” is ${/^[aeiou]/i.test(fits[0].g.label) ? 'an' : 'a'} ${fits[0].g.label}, so I matched it there` }
  const w = m.unmatched[0]
  return { error: `the Screener has no ${f.label} matching “${w}” (it has ${suggestFor(opts, w).join(', ')}${opts.length > 8 ? ', …' : ''})` }
}

/** The model's filters → { filters (the engine's wire filters), post (measure conditions), notes }. */
export function toWireFilters(filters, { lenient = false } = {}) {
  const out = []
  const post = []
  const notes = []
  for (const x of filters || []) {
    const f = fieldOf(String(x.field || ''))
    if (!f) return { error: `the Screener has no field “${x.field}”` }
    if (f.type === 'list') {
      const r = listFilter(f, x, { lenient })
      if (r.error) return { error: r.error }
      out.push(r.filter)
      if (r.note) notes.push(r.note)
      continue
    }
    const v = Number(x.value)
    if (f.type === 'bool') {
      if (!(v === 0 || v === 1)) return { error: `${f.label} is yes/no` }
      out.push({ key: f.key, op: 'eq', value: v })
      continue
    }
    if (!RANGE_OPS.includes(x.op)) return { error: `“${x.op}” isn't a Screener comparison` }
    if (x.value == null || !Number.isFinite(v)) return { error: `${f.label} needs a number` }
    let w
    if (x.op === 'between') {
      const hi = Number(x.max)
      if (!Number.isFinite(hi) || hi <= v) return { error: `${f.label} “between” needs a higher upper bound` }
      w = { key: f.key, op: 'between', min: v, max: hi }
    } else if (x.op === 'lt' || x.op === 'lte') w = { key: f.key, op: x.op, max: v }
    else if (x.op === 'eq') w = { key: f.key, op: 'eq', value: v }
    else w = { key: f.key, op: x.op, min: v }
    ;(f.provider ? post : out).push(w)
  }
  return { filters: out, post, notes }
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
    if (swap.has(f.key) && f.op !== 'in' && f.op !== 'not_in') post.push({ ...f, key: swap.get(f.key) })
    else filters.push(f)
  }
  return { ...spec, filters, post }
}

// A filter as the engine takes it: without the local `pending` mark (and without `key` for the page link).
const wireOf = (f, noKey = false) => { const o = { ...f }; delete o.pending; delete o.label; if (noKey) delete o.key; return o }
const openLinkFor = (spec, savedId = null) => {
  if (savedId && /^\d+$/.test(savedId)) return { href: `/screener?savedScreen=${savedId}`, label: 'Open in Screener' }
  const map = Object.fromEntries((spec.filters || []).map(f => [f.key, wireOf(f, true)]))
  const s = encodeSpec({ filters: map, sort: spec.sort })
  // The Screener page can't hold a measure condition: the link says what it leaves out.
  const label = (spec.post || []).length ? `Open in Screener (without ${[...new Set(spec.post.map(f => fieldOf(f.key)?.label || f.key))].join(', ')})` : 'Open in Screener'
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

/** Run a wire spec through the engine: the real count + the first `show` rows. */
async function runSpec(spec, { show = SHOW_DEFAULT, name = null, savedId = null, notes: extra = [] } = {}) {
  const keys = [...new Set([...(spec.filters || []).map(f => f.key), spec.sort?.key].filter(k => k && fieldOf(k) && !fieldOf(k).provider && fieldOf(k).type !== 'list'))]
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
  cache.last = { spec, name, savedId, total, asOf: r.asOf || r.res.snapshot_date || null, live: r.res.snapshot?.live?.state || null, symbols: rows.map(x => x.ticker), ms }
  const head = `${name ? `${name}: ` : ''}${Number(total).toLocaleString()} stock${total === 1 ? '' : 's'} match${total === 1 ? 'es' : ''}`
  const all = [...(spec.filters || []), ...(spec.post || [])]
  const what = all.length ? ` (${all.map(describeFilter).join(' · ')})` : ''
  const asOf = r.asOf ? ` Latest completed session: ${r.asOf}.` : r.res.snapshot_date ? ` Data: ${r.res.snapshot_date} snapshot${r.res.snapshot?.live?.state === 'live' ? ', live prices' : ''}.` : ''
  // ⭐ ACCEPTANCE (2026-10-11): "by RS Rank" only as far as the RETURNED rows actually carry it. On a
  // snapshot with no RS Rank (measured: 3,665/3,665 null on the local copy) the engine's order is
  // not an RS Rank order, so it is not called one; partial coverage is said with its count.
  const sortLabel = spec.sort ? (fieldOf(spec.sort.key)?.label || spec.sort.key) : null
  const ranked = spec.sort ? rows.filter(x => { const v = valueOf(x, spec.sort.key); return typeof v === 'number' && Number.isFinite(v) }).length : 0
  const sortWord = !spec.sort ? ''
    : ranked === 0 ? ` — ${sortLabel} data is unavailable for these results, so they are not in ${sortLabel} order`
      : ` by ${sortLabel} (${spec.sort.dir === 'asc' ? 'lowest' : 'highest'} first)${ranked < rows.length ? `; only ${ranked} of these ${rows.length} have ${sortLabel} values — the other ${rows.length - ranked} have none and are not ranked by it` : ''}`
  const showing = rows.length ? ` Showing the first ${rows.length}${sortWord}.` : ''
  const notes = [...extra, ...coverageNotes(spec), ...r.notes]
  return {
    text: `${head}${what}.${showing}${asOf}${notes.length ? ` ${notes.map(n => `${n}.`).join(' ')}` : ''}`,
    table: rows.length ? { columns, rows: rows.map(x => Object.fromEntries(columns.map(c => [c.key, c.key === 'ticker' ? x.ticker : fmt(c.key, valueOf(x, c.key))]))) } : null,
    link: openLinkFor(spec, savedId),
  }
}

/** The model's screen args → the Screener's wire spec (with "refine" building on the last screen). */
function buildSpec({ filters, sort_field: sortField, sort_dir: sortDir, mode, within = null }, { lenient = false, host = null } = {}) {
  if ((filters || []).length > MAX_FILTERS) return { error: `that's more than ${MAX_FILTERS} conditions at once` }
  const w = toWireFilters(filters, { lenient })
  if (w.error) return { error: w.error }
  let wire = w.filters
  // WITHIN one of the member's own lists: the engine's own "My Lists" universe (`list` ∈ wl:<id>).
  if (within != null && within !== '') {
    const lists = host?.watchlists?.snapshot?.() || null
    const l = lists ? lists.find(x => String(x.id) === String(within)) : null
    if (lists && !l) return { error: 'that isn\'t one of your watchlists' }
    wire = [...wire.filter(f => f.key !== 'list'), { key: 'list', op: 'in', value: `wl:${within}`, label: l?.name || null }]
  }
  let postF = w.post
  let sort = cache.last && mode === 'refine' ? cache.last.spec.sort : null
  if (mode === 'refine' && cache.last) {
    const mine = new Set([...wire, ...postF].map(f => f.key))
    wire = [...(cache.last.spec.filters || []).filter(f => !mine.has(f.key)), ...wire]
    postF = [...(cache.last.spec.post || []).filter(f => !mine.has(f.key)), ...postF]
  }
  if (sortField) {
    const sf = fieldOf(sortField)
    if (!sf || sf.provider || sf.type === 'list') return { error: `the Screener has no field “${sortField}” to sort by` }
    sort = { key: sortField, dir: sortDir === 'asc' ? 'asc' : 'desc' }
  }
  if (!wire.length && !postF.length && !sort) return { error: 'which conditions? For example: ADR above 5% and price above $10' }
  return { spec: settleClock({ filters: wire, post: postF, sort: sort || null }), notes: w.notes }
}

const specWords = (spec) => [...(spec.filters || []), ...(spec.post || [])].map(describeFilter).join(' · ') || 'no filters'

/** A screen's RESULT as a typed symbol set: EVERY match (up to FILL_MAX) in the engine's own order.
 *  `count` is the true number of matches, so a consumer can refuse rather than cut. */
async function produceSymbols(spec, { name = null, savedId = null, notes: extra = [] } = {}) {
  const r = await resultOf(spec, ['ticker'], FILL_MAX)
  const symbols = r.rows.map(x => x.ticker).filter(Boolean)
  cache.last = { spec, name, savedId, total: r.total, asOf: r.asOf || r.res.snapshot_date || null, live: r.res.snapshot?.live?.state || null, symbols, ms: 0 }
  const what = name ? `${name} (${specWords(spec)})` : specWords(spec)
  const notes = [...extra, ...coverageNotes(spec), ...r.notes]
  const when = r.asOf ? ` on ${r.asOf}` : ''
  return {
    symbols, count: r.total, cap: FILL_MAX,
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
const FILTER_ITEM = {
  type: 'object',
  properties: {
    field: { type: 'string' }, op: { type: 'string', enum: [...RANGE_OPS, ...LIST_OPS] },
    value: { type: ['number', 'null'] }, max: { type: ['number', 'null'] },
    values: { type: ['array', 'null'], items: { type: 'string' } },
  },
  required: ['field', 'op', 'value', 'max', 'values'], additionalProperties: false,
}
// Does a screen use a list field (its values must be read before it can run)?
const usesList = (args) => (args?.filters || []).some(x => fieldOf(String(x?.field || ''))?.type === 'list')
async function specFor(args, host = null) {
  await loadMeta()
  if (usesList(args)) await loadOptions()
  return buildSpec(args, { host })
}

// Could this request involve screening? Deliberately BROAD (a false positive costs ~3 KB; a
// false negative still leaves every field key visible).
const SCREEN_WORDS = /\b(stocks?|screens?|screener|scan\w*|find|filter\w*|sort\w*|tickers?|names|compan\w+|results?|matches|those|them|top\s+\d+|above|below|over|under|between|at least|more than|less than|greater|higher|lower|adr|atr|rsi|volume|price|market cap|cap|growth|margin|eps|revenue|p\/?e|dividend|beta|float|earnings|perf\w*|gainers?|losers?|up|down|etfs?|sector|industry|leaders?|momentum|high|low)\b|%|\$/i
export const screenRelevant = (message) => SCREEN_WORDS.test(String(message || ''))

let registered = false
export function registerScreenerCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(screenerKind)
  registerWarmup(() => loadMeta())
  registerWarmup(() => loadOptions().catch(() => {}))

  registerContextProvider({
    key: 'screener',
    build: (_host, refFor, { message = '' } = {}) => {
      const last = cache.last
      // CONTEXT RELEVANCE: the full catalog (key:Label(unit), ~5 KB) only when the request could
      // be about screening; otherwise its KEYS (~2 KB) — the model can still see every field it
      // could screen on and discover a screen is wanted, it just gets no labels/units.
      const full = !!last || screenRelevant(message)
      return [{
        ref: refFor('screener', 'screener'), label: 'Screener',
        // The live catalog. Use ONLY these keys.
        fields: !cache.meta ? 'loading' : full
          ? [...cache.meta.fields, ...allMeasures()].map(f => `${f.key}:${f.label}${f.unit ? `(${f.unit})` : f.type === 'bool' ? '(yes/no)' : f.type === 'list' ? '(list)' : ''}`).join(';')
          : [...cache.meta.fields, ...allMeasures()].map(f => f.key).join(','),
        ...(full ? {} : { fieldsDetail: 'keys only (labels and units omitted for this request)' }),
        ...(last ? { lastScreen: { ref: 'lastScreen', filters: [...(last.spec.filters || []), ...(last.spec.post || [])].map(describeFilter), sort: last.spec.sort ? `${last.spec.sort.key} ${last.spec.sort.dir}` : null, matches: last.total, name: last.name } } : {}),
        ...(cache.saved ? { savedScreens: [...cache.saved.saved, ...cache.saved.starters].slice(0, 40).map(s => ({ id: s.id, name: s.name, kind: s.kind })) } : {}),
      }]
    },
  })
  registerWarmup(() => loadSaved().catch(() => {}))
  // "Put the top 10 in Momentum" after a screen: the LAST screen, re-run fresh at apply.
  registerOutputSource({
    ref: 'lastScreen', type: SYMBOLS,
    available: () => !!cache.last,
    summary: () => `Use your last screen (${specWords(cache.last.spec)}) — run fresh when you apply`,
    resolve: () => produceSymbols(cache.last.spec, { name: cache.last.name, savedId: cache.last.savedId }),
  })

  // ── screener.run ──
  registerCapability({
    name: 'screener.run',
    target: 'screener', query: true, surfaces: ['charts'],
    summary: 'Run a stock screen on UCT\'s Screener and show the real matches (count + top rows). Changes nothing in UCT. Use this for "show me / find stocks with …".',
    hints: 'target = the screener entry ref. filters: each {field: a key from screener `fields` (never invented), op, value, max, values}. '
      + 'Numbers: op gt|gte|lt|lte|eq|between, value, max (between only, else null), values null; % fields take 5 for 5%, $ fields take dollars (10M = 10000000). '
      + 'yes/no: op eq, value 1|0. (list) fields: op in|not_in, values = the member\'s own words (["software"]) — UCT matches the real values; value/max null. '
      + '"(latest session)" fields = the last completed trading day: use them for a daily dollar volume ("trades over $10M a day"), never a 30-day average or share volume. '
      + 'A measure not in `fields`: say the Screener doesn\'t have it, never substitute. sort_field/sort_dir or null. mode refine = change the LAST screen, else new. '
      + 'show: rows (null = 10, max 25). as: name the RESULT (screen1) when a later op uses its stocks ({from:"screen1", top:null} = all); else null. '
      + 'within: a watchlist ref only if they name that list ("in Momentum"); else null (the whole market).',
    args: {
      type: 'object',
      properties: {
        filters: { type: 'array', items: FILTER_ITEM },
        sort_field: { type: ['string', 'null'] }, sort_dir: { type: ['string', 'null'], enum: ['asc', 'desc', null] },
        mode: { type: 'string', enum: ['new', 'refine'] }, show: { type: ['integer', 'null'] }, as: { type: ['string', 'null'] },
        within: { type: ['string', 'null'] },
      },
      required: ['filters', 'sort_field', 'sort_dir', 'mode', 'show', 'as', 'within'], additionalProperties: false,
    },
    // `within`: one of the member's own watchlists — the Screener's own "My Lists" universe (wl:<id>)
    argRefs: { within: 'watchlist' },
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
      return b.error ? 'Run the screen' : `Screen for ${specWords(b.spec)}${when}${b.spec.sort ? `, sorted by ${fieldOf(b.spec.sort.key)?.label || b.spec.sort.key}` : ''} — run fresh when you apply`
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
    fast: ({ lower }) => {
      if (!cache.meta) return null
      if (/^(?:please )?(?:(?:show(?: me)?|find(?: me)?|list|give me|get(?: me)?|what are|which are) )?(?:my |the )?(?:strongest|rs leaders|relative strength leaders|highest rs(?: rank(?:ed)?)?)(?: stocks| names)?(?: right now| today)?$/.test(lower)) {
        return fieldOf('rs_rank') ? { filters: [], sort_field: 'rs_rank', sort_dir: 'desc', mode: 'new', show: null, as: null, within: null } : null
      }
      const m = /^(?:(?:now|and|ok|okay) )?(?:show me )?(?:only|just) (?:the ones|those|them|the stocks|the names|stocks|names)? ?(above|over|under|below) \$(\d+(?:\.\d+)?)$/.exec(lower)
      if (m && cache.last && fieldOf('price')) {
        const op = m[1] === 'above' || m[1] === 'over' ? 'gt' : 'lt'
        return { filters: [{ field: 'price', op, value: Number(m[2]), max: null, values: null }], sort_field: null, sort_dir: null, mode: 'refine', show: null, as: null, within: null }
      }
      return null
    },
    async answer(_snap, args, host) {
      let b
      try { b = await specFor(args, host) } catch (e) { return `I didn't run it: ${e?.message || 'the Screener could not be read'}.` }
      if (b.error) return `I didn't run it: ${b.error}.`
      return runSpec(b.spec, { show: args.show || SHOW_DEFAULT, notes: b.notes })
    },
  })

  // ── screener.runSaved ──
  registerCapability({
    name: 'screener.runSaved',
    target: 'screener', query: true, surfaces: ['charts'],
    summary: 'Run one of the member\'s saved screens (or a UCT starter screen) and show the real matches.',
    hints: 'target = the ref of the screener entry; screen = the id of an entry in savedScreens (never invent one; clarify with the real names if unsure). show: rows (null = 10). '
      + 'as: name its RESULT when a later op in the same request uses its stocks; else null.',
    args: { type: 'object', properties: { screen: { type: 'string' }, show: { type: ['integer', 'null'] }, as: { type: ['string', 'null'] }, }, required: ['screen', 'show', 'as'], additionalProperties: false },
    produces: SYMBOLS,
    describeProduce({ screen }) {
      const s = cache.saved && [...cache.saved.saved, ...cache.saved.starters].find(x => x.id === String(screen))
      return `Run your screen ${s ? `“${s.name}”` : String(screen)} — fresh when you apply`
    },
    async produce({ screen }) {
      await loadMeta()
      const lib = await loadSaved()
      const s = [...lib.saved, ...lib.starters].find(x => x.id === String(screen))
      if (!s) throw new Error("that saved screen isn't there any more")
      return produceSymbols({ filters: s.spec?.filters || [], sort: s.spec?.sort || null, rank: s.spec?.rank || null, logic: s.spec?.logic || null }, { name: s.name, savedId: s.kind === 'yours' ? s.id : null })
    },
    fast: ({ raw }) => {
      const m = /^(?:run|open|show(?: me)?|load) (?:my |the )?(.+?)(?: screen| scan)?[.!]?$/i.exec(String(raw).trim())
      if (!m || !cache.saved) return null
      const all = [...cache.saved.saved, ...cache.saved.starters]
      const hits = all.filter(s => norm(s.name) === norm(m[1]) || norm(s.name) === norm(`${m[1]} screen`))
      return hits.length === 1 ? { screen: hits[0].id, show: null, as: null } : null
    },
    async answer(_snap, { screen, show }) {
      await loadMeta()
      const lib = await loadSaved()
      const s = [...lib.saved, ...lib.starters].find(x => x.id === String(screen))
      if (!s) return "I couldn't find that saved screen."
      return runSpec({ filters: s.spec?.filters || [], sort: s.spec?.sort || null, rank: s.spec?.rank || null, logic: s.spec?.logic || null }, { show: show || SHOW_DEFAULT, name: s.name, savedId: s.kind === 'yours' ? s.id : null })
    },
  })

  // ── screener.state / screener.listSaved ──
  registerCapability({
    name: 'screener.state',
    target: 'screener', query: true, surfaces: ['charts'],
    summary: 'Say what the last screen run here was: its filters, sort and number of matches.',
    hints: 'target = the ref of the screener entry.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    fast: ({ lower }) => (/^(what filters (am i using|are on|are applied)|how is (this|it|the screen) sorted|how many (results|matches|stocks)( are there| did (it|that) find)?|what('s| is) (this|the) screen)$/.test(lower) ? {} : null),
    answer() {
      const l = cache.last
      if (!l) return "I haven't run a screen in this conversation yet. (I can't see the filters open on the Screener page itself from here.)"
      const f = (l.spec.filters || []).map(describeFilter).join(' · ') || 'no filters'
      const s = l.spec.sort ? `by ${fieldOf(l.spec.sort.key)?.label || l.spec.sort.key}, ${l.spec.sort.dir === 'asc' ? 'lowest' : 'highest'} first` : "in UCT's default order"
      return `${l.name ? `${l.name}: ` : 'The last screen I ran: '}${f}. Sorted ${s}. ${Number(l.total).toLocaleString()} matches${l.asOf ? ` (data ${l.asOf})` : ''}.`
    },
  })
  registerCapability({
    name: 'screener.listSaved',
    target: 'screener', query: true, surfaces: ['charts'],
    summary: 'List the member\'s saved screens and UCT\'s starter screens.',
    hints: 'target = the ref of the screener entry.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    fast: ({ lower }) => (/^((what|which) (saved )?(screens|scans) (do i have|have i saved)|(show|list)( me)?( my)? (saved )?screens|my (saved )?screens)$/.test(lower) ? {} : null),
    async answer() {
      const lib = await loadSaved()
      const mine = lib.saved.map(s => s.name)
      const starters = lib.starters.map(s => s.name)
      return [mine.length ? `Your screens: ${mine.join(', ')}` : "You haven't saved any screens yet.", starters.length ? `UCT starters: ${starters.join(', ')}` : ''].filter(Boolean).join('\n')
    },
  })
}
