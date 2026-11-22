// S13.6 remainder (audit 2026-11-05, "Hidden gems"): the COT positioning capture from inside a note.
//
// `/cot ES` (and Insert > COT positioning) freezes the SAME card the COT tab's "Save to Notebook" freezes
// for the latest report week: the rail's own figures, built by the rail's own functions. The rail reads
// `GET /api/cot/{symbol}?weeks=520` (CotData.jsx FETCH_WEEKS) and composes the week with
// `computeSnapshot` + `buildRead` (cotCompose.composeWeek's first two steps; the rest -- analogs,
// divergences, narrative facts -- never reaches the capture). `buildCotCapture` is the rail's builder.
//
// ⛔ NO VENDOR CALL. Both reads are this app's stored CFTC tables (cot_service); the insert asks nothing a
// member opening the COT tab would not. The market name comes from `/api/cot/symbols`, the picker's list.
// ⛔ `market`, NEVER `symbol`, in the payload (registry.js cot paramsSchema): buildCotCapture already says so,
// and normalizeParams drops the `symbol` the slash grammar carries.
import { computeSnapshot, buildRead } from '../../../cot/cotRead'
import { buildCotCapture } from '../../../cot/cotNotebookCapture'
import { getJson, isOffline, captureFailure } from './captureFetch'
import { COT_SYMBOLS_URL, COT_MARKET_RE, cotMarketName } from '../../../journal-2-0/lib/cotMarkets'

/** The weeks the COT tab fetches (CotData.jsx FETCH_WEEKS): the 3-year index needs the history. */
export const COT_FETCH_WEEKS = 520

/** The slash insert: the latest report week, as the rail would show it. Never throws. */
export async function slashCapture(params = {}) {
  if (isOffline()) return { ok: false, reason: 'offline' }
  const market = String(params.symbol || params.market || '').trim().toUpperCase()
  if (!COT_MARKET_RE.test(market)) return { ok: false, reason: 'failed' }
  const [rows, symbols] = await Promise.all([
    getJson(`/api/cot/${encodeURIComponent(market)}?weeks=${COT_FETCH_WEEKS}`),
    getJson(COT_SYMBOLS_URL),
  ])
  if (!rows.ok) {
    if (rows.status === 404) return { ok: false, message: `There is no COT market called ${market}, so nothing was added.` }
    if (rows.status === 402) return { ok: false, message: 'COT data needs a paid plan, so nothing was added.' }
    return captureFailure()
  }
  const data = Array.isArray(rows.data) ? rows.data : []
  if (!data.length) return { ok: false, message: `${market} has no COT reports yet, so nothing was added.` }
  try {
    const name = cotMarketName(symbols.ok ? symbols.data : null, market) || market
    const snap = computeSnapshot(data, data.length - 1)
    const read = buildRead(snap, { symbol: market, name })
    const payload = buildCotCapture({ symbol: market, name, snap, read })
    return payload ? { ok: true, payload } : captureFailure()
  } catch {
    return captureFailure()
  }
}
