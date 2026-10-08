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
// gains is usable the moment `/fields` lists it. Range and yes/no fields only —
// list-valued fields (sector, exchange, …) need their options and are not offered.
//
// ⛔ Not here: operating the Screener PAGE's own filters (it only exists inside
// /screener), saving screens, My Scans (Indicator formulas), logic groups.

import { registerCapability, registerTargetKind, registerContextProvider, registerWarmup, registerOutputSource, SYMBOLS } from '../capabilities'
import { encodeSpec } from '../../pages/screener/shell/specUrl'

const META_TTL_MS = 6 * 3600 * 1000      // the registry changes only on deploy
const SAVED_TTL_MS = 60 * 1000
const MAX_FILTERS = 12
const SHOW_DEFAULT = 10
const SHOW_MAX = 25
const RANGE_OPS = ['gt', 'gte', 'lt', 'lte', 'eq', 'between']
const OP_WORD = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', between: 'between' }
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

const cache = { meta: null, metaAt: 0, metaP: null, saved: null, savedAt: 0, last: null }
export function _resetScreenerCache() { cache.meta = null; cache.metaAt = 0; cache.metaP = null; cache.saved = null; cache.savedAt = 0; cache.last = null }

export function loadMeta() {
  if (cache.meta && Date.now() - cache.metaAt < META_TTL_MS) return Promise.resolve(cache.meta)
  if (!cache.metaP) {
    cache.metaP = req('/api/screener/fields').then(r => json(r, 'Reading the Screener fields')).then(m => {
      const list = Array.isArray(m.fields) ? m.fields : []
      cache.meta = { fields: list.filter(f => f && f.key && (f.type === 'range' || f.type === 'bool')).map(f => ({ key: f.key, label: f.label || f.key, type: f.type, unit: f.unit || '' })) }
      cache.metaAt = Date.now()
      return cache.meta
    }).finally(() => { cache.metaP = null })
  }
  return cache.metaP
}
async function loadSaved() {
  if (cache.saved && Date.now() - cache.savedAt < SAVED_TTL_MS) return cache.saved
  const b = await json(await req('/api/screener/saved-screens'), 'Reading your screens')
  cache.saved = {
    saved: (b.saved || []).map(s => ({ id: String(s.id), name: s.name, spec: s.spec, kind: 'yours' })),
    starters: (b.starters || []).map(s => ({ id: String(s.id), name: s.name, spec: s.spec, kind: 'starter' })),
  }
  cache.savedAt = Date.now()
  return cache.saved
}
const post = (path, body) => req(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// ── catalog helpers ──
const fieldOf = (key) => cache.meta?.fields.find(f => f.key === key) || null
const fmtVal = (f, v) => (v == null ? '' : f?.unit === '$' ? `$${v}` : f?.unit === '%' ? `${v}%` : String(v))
function describeFilter(fl) {
  const f = fieldOf(fl.key)
  const label = f?.label || fl.key
  if (f?.type === 'bool') return `${label}: ${Number(fl.value) === 1 ? 'yes' : 'no'}`
  if (fl.op === 'between') return `${label} ${fmtVal(f, fl.min)}–${fmtVal(f, fl.max)}`
  const v = fl.op === 'lt' || fl.op === 'lte' ? fl.max : fl.op === 'eq' ? fl.value : fl.min
  return `${label} ${OP_WORD[fl.op] || fl.op} ${fmtVal(f, v)}`
}

/** The model's filters → the Screener's wire filters, checked against the catalog. */
export function toWireFilters(filters) {
  const out = []
  for (const x of filters || []) {
    const f = fieldOf(String(x.field || ''))
    if (!f) return { error: `the Screener has no field “${x.field}”` }
    const v = Number(x.value)
    if (f.type === 'bool') {
      if (!(v === 0 || v === 1)) return { error: `${f.label} is yes/no` }
      out.push({ key: f.key, op: 'eq', value: v })
      continue
    }
    if (!RANGE_OPS.includes(x.op)) return { error: `“${x.op}” isn't a Screener comparison` }
    if (!Number.isFinite(v)) return { error: `${f.label} needs a number` }
    if (x.op === 'between') {
      const hi = Number(x.max)
      if (!Number.isFinite(hi) || hi <= v) return { error: `${f.label} “between” needs a higher upper bound` }
      out.push({ key: f.key, op: 'between', min: v, max: hi })
    } else if (x.op === 'lt' || x.op === 'lte') out.push({ key: f.key, op: x.op, max: v })
    else if (x.op === 'eq') out.push({ key: f.key, op: 'eq', value: v })
    else out.push({ key: f.key, op: x.op, min: v })
  }
  return { filters: out }
}

const openLinkFor = (spec, savedId = null) => {
  if (savedId && /^\d+$/.test(savedId)) return { href: `/screener?savedScreen=${savedId}`, label: 'Open in Screener' }
  const map = Object.fromEntries((spec.filters || []).map(({ key, ...rest }) => [key, rest]))
  const s = encodeSpec({ filters: map, sort: spec.sort })
  return { href: s ? `/screener?s=${s}` : '/screener', label: 'Open in Screener' }
}

/** Run a wire spec through the engine: the real count + the first `show` rows. */
async function runSpec(spec, { show = SHOW_DEFAULT, name = null, savedId = null } = {}) {
  const keys = [...new Set([...(spec.filters || []).map(f => f.key), spec.sort?.key].filter(k => k && fieldOf(k)))]
  const t0 = Date.now()
  const res = await json(await post('/api/screener/scan', {
    filters: spec.filters || [], sort: spec.sort || DEFAULT_SORT, ...(spec.rank ? { rank: spec.rank } : {}),
    ...(spec.logic ? { logic: spec.logic } : {}), columns: ['ticker', 'company', 'price', 'chg_pct_1d', ...keys],
    page: 1, page_size: Math.min(SHOW_MAX, Math.max(1, show)),
  }), 'Running the screen')
  const ms = Date.now() - t0
  const rows = (res.rows || []).map(r => r)
  const extra = keys.filter(k => !['price', 'chg_pct_1d'].includes(k)).slice(0, 3)
  const columns = [
    { key: 'ticker', label: 'Symbol' }, { key: 'price', label: 'Price' },
    ...extra.map(k => ({ key: k, label: fieldOf(k)?.label || k })), { key: 'chg_pct_1d', label: 'Chg 1D' },
  ]
  const fmt = (k, v) => {
    if (v == null || v === '') return '—'
    if (typeof v !== 'number') return String(v)
    const f = k === 'chg_pct_1d' ? { unit: '%' } : fieldOf(k)
    const n = Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toFixed(2)
    return f?.unit === '$' || k === 'price' ? `$${n}` : f?.unit === '%' ? `${n}%` : n
  }
  cache.last = { spec, name, savedId, total: res.total, asOf: res.snapshot_date || null, live: res.snapshot?.live?.state || null, symbols: rows.map(r => r.ticker), ms }
  const shown = rows.length
  const head = `${name ? `${name}: ` : ''}${Number(res.total).toLocaleString()} stock${res.total === 1 ? '' : 's'} match${res.total === 1 ? 'es' : ''}`
  const what = (spec.filters || []).length ? ` (${spec.filters.map(describeFilter).join(' · ')})` : ''
  const asOf = res.snapshot_date ? ` Data: ${res.snapshot_date} snapshot${res.snapshot?.live?.state === 'live' ? ', live prices' : ''}.` : ''
  const showing = shown ? ` Showing the first ${shown}${spec.sort ? ` by ${fieldOf(spec.sort.key)?.label || spec.sort.key} (${spec.sort.dir === 'asc' ? 'lowest' : 'highest'} first)` : ''}.` : ''
  return {
    text: `${head}${what}.${showing}${asOf}`,
    table: shown ? { columns, rows: rows.map(r => Object.fromEntries(columns.map(c => [c.key, c.key === 'ticker' ? r.ticker : fmt(c.key, r[c.key])]))) } : null,
    link: openLinkFor(spec, savedId),
  }
}

/** The model's screen args → the Screener's wire spec (with "refine" building on the last screen). */
function buildSpec({ filters, sort_field: sortField, sort_dir: sortDir, mode }) {
  if ((filters || []).length > MAX_FILTERS) return { error: `that's more than ${MAX_FILTERS} conditions at once` }
  const w = toWireFilters(filters)
  if (w.error) return { error: w.error }
  let wire = w.filters
  let sort = cache.last && mode === 'refine' ? cache.last.spec.sort : null
  if (mode === 'refine' && cache.last) {
    const mine = new Set(wire.map(f => f.key))
    wire = [...(cache.last.spec.filters || []).filter(f => !mine.has(f.key)), ...wire]
  }
  if (sortField) {
    if (!fieldOf(sortField)) return { error: `the Screener has no field “${sortField}” to sort by` }
    sort = { key: sortField, dir: sortDir === 'asc' ? 'asc' : 'desc' }
  }
  if (!wire.length && !sort) return { error: 'which conditions? For example: ADR above 5% and price above $10' }
  return { spec: { filters: wire, sort: sort || null } }
}

const PRODUCE_MAX = 100
const specWords = (spec) => (spec.filters || []).map(describeFilter).join(' · ') || 'no filters'

/** A screen's RESULT as a typed symbol set: the tickers in the engine's own order. */
async function produceSymbols(spec, { name = null, savedId = null } = {}) {
  const res = await json(await post('/api/screener/scan', {
    filters: spec.filters || [], sort: spec.sort || DEFAULT_SORT, ...(spec.rank ? { rank: spec.rank } : {}),
    ...(spec.logic ? { logic: spec.logic } : {}), columns: ['ticker'], page: 1, page_size: PRODUCE_MAX,
  }), 'Running the screen')
  const symbols = (res.rows || []).map(r => r.ticker).filter(Boolean)
  cache.last = { spec, name, savedId, total: res.total, asOf: res.snapshot_date || null, live: res.snapshot?.live?.state || null, symbols, ms: 0 }
  const what = name ? `${name} (${specWords(spec)})` : specWords(spec)
  return {
    symbols, count: Number(res.total) || 0,
    summary: res.total ? `Screened ${what}: ${Number(res.total).toLocaleString()} match${res.total === 1 ? '' : 'es'}` : `No stocks matched ${what}`,
  }
}

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
    field: { type: 'string' }, op: { type: 'string', enum: RANGE_OPS },
    value: { type: 'number' }, max: { type: ['number', 'null'] },
  },
  required: ['field', 'op', 'value', 'max'], additionalProperties: false,
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
          ? cache.meta.fields.map(f => `${f.key}:${f.label}${f.unit ? `(${f.unit})` : f.type === 'bool' ? '(yes/no)' : ''}`).join(';')
          : cache.meta.fields.map(f => f.key).join(','),
        ...(full ? {} : { fieldsDetail: 'keys only (labels and units omitted for this request)' }),
        ...(last ? { lastScreen: { ref: 'lastScreen', filters: (last.spec.filters || []).map(describeFilter), sort: last.spec.sort ? `${last.spec.sort.key} ${last.spec.sort.dir}` : null, matches: last.total, name: last.name } } : {}),
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
    hints: 'target = the ref of the screener entry. filters: each {field: a key from the screener `fields` list (never invent one), op: gt|gte|lt|lte|eq|between, value: number, max: number for between else null}. '
      + 'Percent fields take plain numbers (5 means 5%). Yes/no fields: op eq, value 1 or 0. "above"=gt, "at least"=gte. sort_field: a field key or null; sort_dir: asc|desc|null. '
      + 'mode: "refine" when they add to / narrow / change the LAST screen ("also", "and price above…"), else "new". show: rows to show (null = 10, max 25). '
      + 'If they ask for a measure that is not in `fields`, say the Screener doesn\'t have it — never substitute another field. '
      + 'as: name this screen\'s RESULT (e.g. "screen1") when a later op in the same request uses its stocks (watchlist.add symbols {from:"screen1", top:N}); else null.',
    args: {
      type: 'object',
      properties: {
        filters: { type: 'array', items: FILTER_ITEM },
        sort_field: { type: ['string', 'null'] }, sort_dir: { type: ['string', 'null'], enum: ['asc', 'desc', null] },
        mode: { type: 'string', enum: ['new', 'refine'] }, show: { type: ['integer', 'null'] }, as: { type: ['string', 'null'] },
      },
      required: ['filters', 'sort_field', 'sort_dir', 'mode', 'show', 'as'], additionalProperties: false,
    },
    // As a PRODUCER (compose.js): the screen's tickers, in the engine's own order.
    produces: SYMBOLS,
    // Checked before a proposal (catalog permitting; the engine re-checks at apply).
    validateProduce(args) {
      if (!cache.meta) return null
      const b = buildSpec(args)
      return b.error ? `the screen can't run: ${b.error}` : null
    },
    describeProduce(args) {
      const b = buildSpec(args)
      return b.error ? 'Run the screen' : `Screen for ${specWords(b.spec)}${b.spec.sort ? `, sorted by ${fieldOf(b.spec.sort.key)?.label || b.spec.sort.key}` : ''} — run fresh when you apply`
    },
    async produce(args) {
      await loadMeta()
      const b = buildSpec(args)
      if (b.error) throw new Error(b.error)
      return produceSymbols(b.spec)
    },
    async answer(_snap, args) {
      await loadMeta()
      const b = buildSpec(args)
      if (b.error) return `I didn't run it: ${b.error}.`
      return runSpec(b.spec, { show: args.show || SHOW_DEFAULT })
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
