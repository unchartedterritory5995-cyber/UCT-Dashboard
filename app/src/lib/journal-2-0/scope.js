/**
 * Journal 2.0 — global Scope ↔ URL codec (P3 §6).
 *
 * ONE source of truth for scope ⇄ URL ⇄ backend-params. Pure functions, no
 * React. A "scope" is the FilterSpec the whole J2 UI shares; this module is
 * the shareable-links engine + the single place camelCase UI keys map to the
 * backend's snake_case `parse_filter_query` names.
 *
 * @typedef {Object} Scope
 * @property {string|null} acct     account id (also drives `account_id`)
 * @property {string|null} from     ISO date (exit/trading-day spine) — inclusive lower bound
 * @property {string|null} to       ISO date — inclusive upper bound
 * @property {string|null} symbol   starts-with symbol filter
 * @property {string[]}    sides    e.g. ['Long','Short']
 * @property {string[]}    setups   e.g. ['VCP']
 * @property {string[]}    tags     mistake + emotion tags, OR-matched
 *
 * ── URL keys ────────────────────────────────────────────────────────────────
 * Namespaced with `sc_` so they can NEVER collide with the calendar's
 * `view/y/m/w` nav params or the permanent `j2tab` deep-link contract:
 *   sc_acct · sc_from · sc_to · sc_sym · sc_side · sc_setup · sc_tag · sc_v
 *
 * ── comma / encoding decision (do NOT double-encode) ─────────────────────────
 * Multi-value facets are comma-joined; each member is `encodeURIComponent`'d
 * FIRST, so a literal comma inside a member survives as `%2C` and is not split.
 * The transport layer (URLSearchParams.toString / the fetch querystring
 * builder) then applies its OWN encoding on top — we never encode that layer
 * ourselves. On the read side we split on `,` then `decodeURIComponent` each
 * member. This mirrors the backend `parse_filter_query` exactly, whose
 * `split()` does `[unquote(x) for x in s.split(",") if x]` — the value it
 * RECEIVES (post-transport-decode) still carries `%2C`, which `unquote`
 * restores to a literal comma. `scopeToApiParams` produces that same
 * member-encoded, comma-joined string.
 */

/** Contract version marker so a future schema change can migrate old URLs. */
export const SCOPE_VERSION = 1

/**
 * Default server page size for the paginated closed-trades list. `scopeToApiParams`
 * emits this as `limit` when the scope carries no explicit `limit`. The trades LIST
 * surface (TradeJournalTab) reuses it for the page-window math (offset = page ×
 * DEFAULT_PAGE_SIZE) so the codec and the UI agree on one number.
 */
export const DEFAULT_PAGE_SIZE = 50

/**
 * The zero scope. Deep-frozen: consumers must NOT mutate this shared const —
 * `scopeFromSearchParams` always hands back a fresh, mutable copy instead.
 * @type {Readonly<Scope>}
 */
export const EMPTY_SCOPE = Object.freeze({
  acct: null,
  from: null,
  to: null,
  symbol: null,
  sides: Object.freeze([]),
  setups: Object.freeze([]),
  tags: Object.freeze([]),
})

// ── helpers ──────────────────────────────────────────────────────────────────

/** A scalar facet counts as set when it is non-null and non-empty. */
const scalarSet = (v) => v != null && v !== ''

/** An array facet counts as set when it has ≥1 member. */
const arraySet = (v) => Array.isArray(v) && v.length > 0

/** Member-encode + comma-join a multi-value facet (the on-wire member form). */
const joinMulti = (members) =>
  members.filter((m) => m != null && m !== '').map(encodeURIComponent).join(',')

const safeDecode = (x) => {
  try {
    return decodeURIComponent(x)
  } catch {
    return x
  }
}

/** Split a comma-joined facet string back into decoded members. */
const splitMulti = (raw) =>
  raw ? raw.split(',').filter(Boolean).map(safeDecode) : []

// ── public codec ─────────────────────────────────────────────────────────────

/**
 * Scope → URLSearchParams (canonical `sc_*` keys). Empty/null facets emit no
 * key; `sc_v` is emitted ONLY when the scope carries at least one facet (an
 * empty scope yields empty params — no `sc_v`).
 * @param {Scope} scope
 * @returns {URLSearchParams}
 */
export function scopeToSearchParams(scope) {
  const s = scope || EMPTY_SCOPE
  const params = new URLSearchParams()
  if (scalarSet(s.acct)) params.set('sc_acct', String(s.acct))
  if (scalarSet(s.from)) params.set('sc_from', String(s.from))
  if (scalarSet(s.to)) params.set('sc_to', String(s.to))
  if (scalarSet(s.symbol)) params.set('sc_sym', String(s.symbol))
  if (arraySet(s.sides)) params.set('sc_side', joinMulti(s.sides))
  if (arraySet(s.setups)) params.set('sc_setup', joinMulti(s.setups))
  if (arraySet(s.tags)) params.set('sc_tag', joinMulti(s.tags))
  // Version marker only when the scope is non-empty.
  if ([...params.keys()].length > 0) params.set('sc_v', String(SCOPE_VERSION))
  return params
}

/**
 * URLSearchParams (or anything with `.get`) → a FRESH Scope. Unknown/extra
 * params are ignored; missing facets fall back to EMPTY_SCOPE defaults;
 * multi-value members are split + decoded. Round-trips with
 * `scopeToSearchParams`.
 * @param {URLSearchParams | {get: (k: string) => (string|null)}} params
 * @returns {Scope}
 */
export function scopeFromSearchParams(params) {
  const get = (k) =>
    params && typeof params.get === 'function' ? params.get(k) : null
  const scalar = (k) => {
    const v = get(k)
    return v == null || v === '' ? null : v
  }
  return {
    acct: scalar('sc_acct'),
    from: scalar('sc_from'),
    to: scalar('sc_to'),
    symbol: scalar('sc_sym'),
    sides: splitMulti(get('sc_side')),
    setups: splitMulti(get('sc_setup')),
    tags: splitMulti(get('sc_tag')),
  }
}

/**
 * Scope → the backend snake_case params `parse_filter_query` reads. camelCase
 * `acct`→`account_id`, `from`→`date_from`, `to`→`date_to`; arrays are
 * member-encoded + comma-joined (the backend splits on comma + unquotes each).
 * Facet keys whose value is empty/null are omitted entirely.
 *
 * `limit`/`offset` are ALWAYS emitted (paging is opt-in on the wire, but the
 * codec supplies a bounded first page by default — `DEFAULT_PAGE_SIZE` / 0 —
 * read from the scope when present). They are NOT scope facets: `scopeActiveCount`
 * ignores them and they are NOT written to the `sc_*` URL (paging is ephemeral,
 * not shareable in v1). The analytics + calendar endpoints share this apiParams
 * but compile ONLY WHERE clauses via `trades_where`, so they IGNORE limit/offset —
 * these two keys are inert everywhere except `GET /api/j2/trades`.
 * @param {Scope} scope
 * @returns {{account_id?: string, date_from?: string, date_to?: string, symbol?: string, sides?: string, setups?: string, tags?: string, limit: number, offset: number}}
 */
export function scopeToApiParams(scope) {
  const s = scope || EMPTY_SCOPE
  const out = {}
  if (scalarSet(s.acct)) out.account_id = String(s.acct)
  if (scalarSet(s.from)) out.date_from = s.from
  if (scalarSet(s.to)) out.date_to = s.to
  if (scalarSet(s.symbol)) out.symbol = s.symbol
  if (arraySet(s.sides)) out.sides = joinMulti(s.sides)
  if (arraySet(s.setups)) out.setups = joinMulti(s.setups)
  if (arraySet(s.tags)) out.tags = joinMulti(s.tags)
  // Pagination — read from the scope with defaults (page size / first page). The
  // trades LIST surface overrides `offset` from its page state; the backend
  // FilterSpec clamps both (limit 1..2000, offset ≥ 0).
  out.limit = Number.isFinite(s.limit) ? s.limit : DEFAULT_PAGE_SIZE
  out.offset = Number.isFinite(s.offset) ? s.offset : 0
  return out
}

/**
 * Number of set facets — each non-null scalar (acct/from/to/symbol) = 1, each
 * non-empty array (sides/setups/tags) = 1. `acct` IS a facet.
 * @param {Scope} scope
 * @returns {number}
 */
export function scopeActiveCount(scope) {
  const s = scope || EMPTY_SCOPE
  let n = 0
  if (scalarSet(s.acct)) n += 1
  if (scalarSet(s.from)) n += 1
  if (scalarSet(s.to)) n += 1
  if (scalarSet(s.symbol)) n += 1
  if (arraySet(s.sides)) n += 1
  if (arraySet(s.setups)) n += 1
  if (arraySet(s.tags)) n += 1
  return n
}

/**
 * True when ANY facet is set (acct included).
 * @param {Scope} scope
 * @returns {boolean}
 */
export function scopeIsActive(scope) {
  return scopeActiveCount(scope) > 0
}
