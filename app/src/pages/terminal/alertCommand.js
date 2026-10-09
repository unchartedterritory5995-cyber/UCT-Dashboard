// UCT Terminal — ALRT: set a price alert from the command line (lane 9, top-10 #4).
//
//   NVDA ALRT 950    an alert at $950; above or below is worked out from the current price
//   NVDA ALRT >950   explicitly "above $950"        NVDA ALRT <950   explicitly "below $950"
//   NVDA ALRT        that ticker's alerts           ALRT             all of them
//
// ⭐ NO NEW BACKEND. The alert is the SAME row the chart menus, the bell and the Alerts widget
// create: `POST /api/watchlist-alerts` (api/routers/watchlist_alerts.py), checked and delivered
// by api/services/watchlist_alert_service.py exactly as before.
//
// ⛔ THE SHELL CREATES, NEVER THE PANEL. A panel re-mounts on reload, on a restored board and on
// a shared `?cmd=` link; an alert created on mount would be created again each time. The shell
// sets the alert once, from a typed command (never from a URL), then opens `SYM ALRT` (the list),
// so the command a panel keeps is one that creates nothing.
import { mutate as globalMutate } from 'swr'
import jsonFetcher from '../../utils/jsonFetcher'
import { getSnapshot } from '../../hooks/livePriceStore'
import { MAX_DISTANCE, alertSetText, inferDirection, money } from './alertModel'

export { MAX_DISTANCE, alertSetText, inferDirection, money, parseAlertPrice, planAlert } from './alertModel'

/** The list endpoint every alert surface reads (bell, chart menus, the Alerts widget). */
export const ALERTS_URL = '/api/watchlist-alerts'
/** The current price of `sym`: the shared live store first (no request), else one read. */
export async function currentPrice(sym, { fetcher = jsonFetcher } = {}) {
  const cached = Number(getSnapshot()?.[sym]?.price)
  if (Number.isFinite(cached) && cached > 0) return cached
  try {
    const d = await fetcher(`/api/live-prices?tickers=${encodeURIComponent(sym)}`)
    const p = Number(d?.[sym]?.price)
    return Number.isFinite(p) && p > 0 ? p : null
  } catch {
    return null
  }
}

/** Every cached alert list (bell, widget, panels) re-reads after a change. */
export function revalidateAlerts() {
  return globalMutate((k) => typeof k === 'string' && k.startsWith(ALERTS_URL))
}

/** A refusal whose text is the member's next step (thrown by `setAlert`). */
function refusal(text) {
  const e = new Error(text)
  e.memberText = text
  return e
}

/**
 * Create the alert a plan describes. Resolves `{ alert, direction, current, text }`; rejects with
 * `memberText` set to a plain-English sentence for every failure.
 */
export async function setAlert(plan, { fetcher = jsonFetcher } = {}) {
  const { sym, price } = plan
  const current = await currentPrice(sym, { fetcher })
  let direction = plan.direction
  if (!direction) {
    direction = inferDirection(price, current)
    if (!direction) {
      throw refusal(`No current price for ${sym} right now, so above or below cannot be worked out. Say which: ${sym} ALRT >${price} or ${sym} ALRT <${price}.`)
    }
  }
  if (current && (price > current * MAX_DISTANCE || price < current / MAX_DISTANCE)) {
    throw refusal(`${money(price)} is more than ${MAX_DISTANCE} times away from ${sym}'s price (${money(current)}), so it looks like a typo. Nothing was set.`)
  }
  if (current && price === current) {
    throw refusal(`${sym} is at ${money(price)} right now. Set the alert a little above or below it.`)
  }
  let alert
  try {
    alert = await fetcher(ALERTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sym, target_price: price, direction }),
    })
  } catch (err) {
    if (err?.status === 401) throw refusal('Your session has ended. Sign in again, then set the alert.')
    if (err?.status === 402) throw refusal('Price alerts need a paid plan.')
    if (err?.timedOut) throw refusal('The alert service did not answer in time. Nothing was set; try again.')
    throw refusal(`The alert for ${sym} could not be saved just now. Nothing was set; try again.`)
  }
  revalidateAlerts()
  return { alert, direction, current, text: alertSetText({ sym, price, direction, current }) }
}
