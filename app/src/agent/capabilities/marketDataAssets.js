// UCT Agent market data — index / commodity / crypto questions (W1-C C-03, builder-c). Contract: MD-1 §4.7 + the
// `index.quote` / `commodity.quote` / `crypto.quote` kinds (api/services/uct_agent/marketdata/asset_quotes.py).
//
// "price of gold", "where's the s&p", "btc" (lowercase): `instrument.resolve` keeps its §4.7 class for the word and
// ADDS a parallel route (`data.routes[i]` = {kind, asset, label}) for asset-class words typed without explicit
// capitals. When the routed kind is served by THIS server (data_kinds), the answer is ONE read of that kind:
//   * ok        → the level/price with its freshness said in words (never "live" unless the read is live and fresh);
//   * otherwise → the honest decline in FIXED words: "I don't have a licensed source for commodity prices, so I can't
//                 price gold. No price is stated." — never an ETF's share price, never a ticker guess.
// When the kind is NOT served (the default), the §4.7.3 sentence stands exactly as before (held-out sets unchanged).
// Only { text, present } leave this module; the envelope's notes are never echoed.

import * as agentClient from '../agentClient'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { num, signedPct } from './marketDataFormat'

export const ASSET_KINDS = ['index.quote', 'commodity.quote', 'crypto.quote']
const CLASS_WORDS = { 'index.quote': 'index levels', 'commodity.quote': 'commodity prices', 'crypto.quote': 'cryptocurrency prices' }
const ET = 'America/New_York'

/** Is this asset kind served by THIS server? Fail closed (no accessor, no list, or the kind absent ⇒ no). */
export function assetKindServed(kind) {
  if (!ASSET_KINDS.includes(kind) || !agentClient.serverServesData()) return false
  const kinds = typeof agentClient.serverDataKinds === 'function' ? agentClient.serverDataKinds() : null
  return Array.isArray(kinds) && kinds.includes(kind)
}

/** The first served route among a resolve read's `data.routes` (parallel to its results), or null. Pure. */
export function servedRoute(env, results) {
  const routes = Array.isArray(env?.data?.routes) ? env.data.routes : []
  for (let i = 0; i < routes.length; i += 1) {
    const r = routes[i]
    if (r && typeof r.kind === 'string' && typeof r.asset === 'string' && assetKindServed(r.kind)) {
      const word = String(results?.[i]?.input || '').replace(/^\$/, '')
      return { kind: r.kind, asset: r.asset, label: typeof r.label === 'string' && r.label ? r.label : word, word }
    }
  }
  return null
}

/** The honest decline (fixed words; the kind's own note is never echoed). */
export function declineText(route) {
  return `I don't have a licensed source for ${CLASS_WORDS[route.kind] || 'that'}, so I can't price ${route.label}. No price is stated.`
}

const fmtValue = (v, kind) => (num(v) == null ? null : kind === 'index.quote'
  ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const stampET = (iso) => {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${new Intl.DateTimeFormat('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric' }).format(d)}, ${new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' }).format(d)} ET`
}

/** An asset-kind envelope → the member's answer (pure; exported for tests). */
export function answerFromAsset(env, route) {
  const usable = env && (env.status === 'ok' || env.status === 'partial') && env.data && num(env.data.value) != null
  if (!usable) return { text: declineText(route) }
  const d = env.data
  const value = fmtValue(d.value, route.kind)
  const chg = num(d.change_pct) != null ? `, ${signedPct(d.change_pct)} vs the previous close` : ''
  const when = stampET(d.as_of || env.as_of)
  const live = env.freshness === 'live' && !env.stale
  const fresh = live ? 'live' : env.freshness === 'delayed' && num(env.delay_s) != null ? `delayed ${Math.round(env.delay_s / 60)} minutes` : 'not a real-time figure'
  const stale = env.stale ? ' This reading is stale.' : ''
  const text = `${route.label} ${value}${chg} — ${fresh}${when ? `, as of ${when}` : ''}.${stale}\nSource: UCT's data gateway (${route.kind === 'index.quote' ? 'index level' : 'price'} from a licensed source).`
  return { text, present: { kind: 'metrics', title: route.label, short: route.label, items: [{ label: route.kind === 'index.quote' ? 'Level' : 'Price', value, note: when ? `${fresh}, as of ${when}` : fresh, aka: ['price', 'level', 'quote'] }] } }
}

/** ONE read of the routed kind for the open turn, then the answer. The kind is a string LITERAL at each call
 *  (agent-qa's isolation rail checks every readData kind statically). */
export async function answerAssetRoute(route) {
  const turnId = currentTurnId()
  if (!turnId) return "I couldn't read that: this needs the Agent's turn, which wasn't available."
  const params = { asset: route.asset }
  let env
  if (route.kind === 'index.quote') env = await readData('index.quote', params, { purpose: 'answer', turnId })
  else if (route.kind === 'commodity.quote') env = await readData('commodity.quote', params, { purpose: 'answer', turnId })
  else if (route.kind === 'crypto.quote') env = await readData('crypto.quote', params, { purpose: 'answer', turnId })
  else return declineText(route)
  return answerFromAsset(env, route)
}
