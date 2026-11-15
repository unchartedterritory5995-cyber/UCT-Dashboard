// The market caution line above an RS screen's list (unit U8, 2026-11-14). The server names one
// of three states from SPY and QQQ daily closes (api/services/screener/rs_market_state.py) and
// sends it inside the saved-screens payload as `rs_market: { state, text, asof }`, only while the
// RS screens are on. Nothing is asked for it: the page already fetches that payload.
//
// ⛔ FAIL CLOSED. A line is drawn only for a state this file knows AND words the server sent.
// `normal`, null (no state could be claimed), a payload without the key (the flag is off) and
// anything malformed all draw nothing.

// The states that show a line. `normal` is a state too, and it shows none.
const LINE_STATES = new Set(['caution', 'pressure'])

// What to draw, or null. `key` names the line a member hides: the state and the session it is
// about, so tomorrow's line, or a market that moved from pressure to caution, shows again.
export function marketLineOf(market) {
  if (!market || typeof market !== 'object' || Array.isArray(market) || !LINE_STATES.has(market.state)) return null
  const text = typeof market.text === 'string' ? market.text.trim() : ''
  if (!text) return null
  const asof = typeof market.asof === 'string' ? market.asof : ''
  return { state: market.state, text, key: `${market.state}|${asof}` }
}

// "Hide for today" is kept in sessionStorage (declared in persistenceManifest.json): it lasts
// for this tab's visit and no longer, and it is keyed by the line (above), so the next session's
// line is never hidden by yesterday's press. A member preference would have followed the account
// to every device for a note that is only about today; nothing is sent to the server.
export const RS_MARKET_HIDDEN_KEY = 'uct.screener.rsMarketHidden'
export function readMarketHidden() {
  try { return sessionStorage.getItem(RS_MARKET_HIDDEN_KEY) || '' } catch { return '' }
}
export function writeMarketHidden(key) {
  try { sessionStorage.setItem(RS_MARKET_HIDDEN_KEY, String(key)) } catch { /* private mode: hidden until this page is left */ }
}
