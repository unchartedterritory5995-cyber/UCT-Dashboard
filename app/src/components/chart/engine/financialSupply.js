// app/src/components/chart/engine/financialSupply.js
//
// ─── ⭐⭐ T4 F1b — THE CHART'S OWN FINANCIAL FIGURES, ASKED ONCE PER SYMBOL ─────────────────────────────────────
//
// A Pine script's `request.financial` reads the chart's own symbol's figures from company filings (`pineFinancial.js`).
// They come from ONE door, `GET /api/pine/financial/<symbol>` (F1a, `api/routers/pine_financial.py`), never from
// `/api/bars`, and this module is the chart's cache of that door's answers, built by the SAME factory as the events
// door (`eventSupply.js::makeDoorCache`), so every rule there holds here: 200 `available` (`financial`: the document;
// `rev`: its refresh time), 202 `pending` (asked again after `Retry-After`, a bounded number of times), 401 / 402 / 403 /
// 404 `dark` (`PINE_FINANCIAL_SUPPLY_ENABLED` unset answers 404 to every member: a plain named refusal, never asked
// again this session), anything else `error` (asked again later), a switch-abort forgotten.
import { makeDoorCache } from './eventSupply'

/** How long a held answer is served before the next ensure asks again (F1a's own copy refreshes every 12 hours). */
export const FINANCIAL_MAX_AGE_MS = 6 * 3600 * 1000

const FINANCIAL = makeDoorCache({ path: '/api/pine/financial/', field: 'financial', maxAgeMs: FINANCIAL_MAX_AGE_MS,
  revOf: (doc) => (doc.refreshedAt == null ? '' : String(doc.refreshedAt)) })

/** The one URL this module asks. */
export function financialUrl(symbol) { return FINANCIAL.urlOf(symbol) }
/** Notified whenever an entry changes, so a chart can bind again. @returns {() => void} */
export function subscribeFinancial(fn) { return FINANCIAL.subscribe(fn) }
/** Test seam. */
export function clearFinancial() { FINANCIAL.clear() }
/** Ask the door now. */
export function fetchFinancial(symbol, fetcher) { return FINANCIAL.fetch(symbol, fetcher) }
/** The chart's entry for its symbol's figures (`{status: 'loading'}` until the door answers); the same object until it changes. */
export function ensureFinancial(symbol, fetcher) { return FINANCIAL.ensure(symbol, fetcher) }
