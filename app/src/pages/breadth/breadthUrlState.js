/**
 * The Breadth Views tab's shareable URL state — PURE. No React, no router, no
 * `window`. Spec §5:
 *
 *   ?view=clock&date=2026-08-14&days=180&compare=clock,divergence,events,analogues
 *
 * ⭐ EVERY PARAM IS UNTRUSTED INPUT and every one has a stated fallback, because
 * "absent or invalid falls back to today's behaviour exactly" is only true if
 * each parser can say NO without throwing:
 *
 * | param     | accepted                                   | invalid / absent    |
 * |-----------|--------------------------------------------|---------------------|
 * | `view`    | a key in the registry's `STYLES`           | → null (stored pref)|
 * | `date`    | a real YYYY-MM-DD calendar date            | → null (no seek)    |
 * | `days`    | an integer in the caller's day choices     | → null (its default)|
 * | `compare` | ≥1 known style key, comma-separated        | → null (Single)     |
 *
 * `compare` is the one that can be PARTLY wrong, and the spec is explicit that
 * an unknown style key is "ignored, not fatal" — so `clock,bogus,events` keeps
 * the two real lenses and tops the quad up from `compareQuad.js` rather than
 * throwing the whole parameter away. Only a `compare` with nothing recognisable
 * in it falls back to Single.
 *
 * ⛔ The style roster is NOT restated here. `isStyleKey` comes from
 * `compareQuad.js`, which reads `STYLES`, so the registry stays the single
 * authority on what a style key is.
 */
import { isStyleKey, normalizeQuad } from './compareQuad'

export const PARAM_VIEW = 'view'
export const PARAM_DATE = 'date'
export const PARAM_DAYS = 'days'
export const PARAM_COMPARE = 'compare'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * A session date, or null. The regex alone is not enough: `2026-02-31` matches
 * it, is not a day, and would be seeked for forever without ever resolving. The
 * round-trip through `Date.UTC` is what rejects it.
 */
export function parseDate(raw) {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!DATE_RE.test(s)) return null
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return s
}

/** A window size the page actually offers, or null. An arbitrary `?days=7000`
 *  would ask the server for a window no pill can undo. */
export function parseDays(raw, choices) {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return Array.isArray(choices) && choices.includes(n) ? n : null
}

export function parseView(raw) {
  const s = typeof raw === 'string' ? raw.trim() : ''
  return isStyleKey(s) ? s : null
}

/** `null` = the param was absent or held nothing recognisable → Single mode. */
export function parseCompare(raw) {
  if (typeof raw !== 'string') return null
  return normalizeQuad(raw.split(','))
}

/** Reads a `URLSearchParams` (or anything with `.get`). Never throws. */
export function parseBreadthParams(params, { dayChoices } = {}) {
  const get = (k) => (params && typeof params.get === 'function' ? params.get(k) : null)
  return {
    view: parseView(get(PARAM_VIEW)),
    date: parseDate(get(PARAM_DATE)),
    days: parseDays(get(PARAM_DAYS), dayChoices),
    compare: parseCompare(get(PARAM_COMPARE)),
  }
}

/**
 * The patch to merge into the current query. A `null` value DELETES its key
 * (see `mergeParams`), which is how the URL sheds a param the state no longer
 * has — a stale `?date=` left behind after LATEST would pin every reload to a
 * session the user already walked away from.
 *
 * `compare` is written ONLY in compare layout: the param's PRESENCE is what
 * says "this link is a 2×2", so leaving the quad in the URL while showing one
 * pane would make Single unshareable.
 */
export function serializeBreadthParams({ view, date, days, compare, layout } = {}) {
  const quad = layout === 'compare' && Array.isArray(compare) && compare.length
    ? compare.filter(isStyleKey).join(',')
    : ''
  return {
    [PARAM_VIEW]: parseView(view),
    [PARAM_DATE]: parseDate(date),
    [PARAM_DAYS]: Number.isInteger(days) ? String(days) : null,
    [PARAM_COMPARE]: quad || null,
  }
}
