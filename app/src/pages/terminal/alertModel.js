// UCT Terminal — ALRT's pure half (lane 9): the price token, the direction, the words.
// No React, no fetch: args.js and parseCommand read `parseAlertPrice`, so this module must stay
// import-cheap. The network half (create, current price) is alertCommand.js.
import { formatCurrency } from '../../lib/presentation/presentationPrimitives'

/** The widest move from the current price an alert may sit at before it is called a typo. */
export const MAX_DISTANCE = 10   // 10x away (or 1/10th) — `NVDA ALRT 9500` on a $180 stock

const PRICE_RE = /^([<>])?\$?(\d{1,7}(?:\.\d{1,4})?)$/

/** Pure: an alert price token → `{ price, direction }` (direction null = work it out), or null. */
export function parseAlertPrice(tok) {
  const m = String(tok ?? '').trim().match(PRICE_RE)
  if (!m) return null
  const price = Number(m[2])
  if (!Number.isFinite(price) || price <= 0) return null
  return { price, direction: m[1] === '>' ? 'above' : m[1] === '<' ? 'below' : null }
}

/** Pure: which way the price must cross to reach `target` from `current`. */
export function inferDirection(target, current) {
  const c = Number(current)
  if (!Number.isFinite(c) || c <= 0) return null
  return target >= c ? 'above' : 'below'
}

/** Pure: a dollar amount the way an alert reads it: "$950.00", "$1,234.50". */
export function money(v) {
  return formatCurrency(Number(v), { decimals: 2, grouping: true })
}

/**
 * Pure: what a parsed `ALRT` command asks for, or the plain-English reason it cannot.
 *   { ok: true, sym, price, direction|null } · { ok: false, error }
 * Only a command that CARRIES a price is a create; `NVDA ALRT` / `ALRT` list (`create: false`).
 */
export function planAlert(cmd) {
  const args = (cmd?.args || []).filter((a) => a != null && String(a) !== '')
  if (!args.length) return { ok: true, create: false }
  const [first, ...rest] = args
  const parsed = parseAlertPrice(first)
  if (!parsed) {
    return { ok: false, error: `"${first}" is not a price. Type a number, e.g. ${cmd?.sym || 'NVDA'} ALRT 950 (or <950 for below, >950 for above).` }
  }
  if (rest.length) {
    return { ok: false, error: `ALRT sets one price at a time; "${rest.join(' ')}" was not used. Type ${cmd?.sym || 'NVDA'} ALRT ${first}.` }
  }
  if (!cmd?.sym) {
    return { ok: false, error: `Which stock? Put the ticker first: NVDA ALRT ${first}.` }
  }
  return { ok: true, create: true, sym: cmd.sym, price: parsed.price, direction: parsed.direction }
}

/** Pure: the confirmation line. */
export function alertSetText({ sym, price, direction, current }) {
  const now = Number.isFinite(Number(current)) && Number(current) > 0 ? ` (now ${money(current)})` : ''
  return `Alert set: ${sym} ${direction} ${money(price)}${now}. It rings the bell, and sends email or Discord if you have those on. ALRT lists your alerts.`
}
