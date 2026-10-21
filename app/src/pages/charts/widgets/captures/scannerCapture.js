// Notebook widgets Task 16: the Scanner capture, ONE builder for both doors.
//
// The /charts ScannerResults' "Send to Journal" and the Notebook's `/scanner` insert both build the frozen
// capture here. A scan capture is a FULL-LIST FREEZE (re-running it later would change which tickers
// appear), so the payload is the honest record. The slash insert takes the member's DEFAULT scan: the
// first preset, as the scan picker lists them (no saved scans exist yet; "My Scans" is coming soon).
// Like the widget's own door, the / menu offers it only while Wave R's captureEnabled() is on.
import { PRESET_SCANS } from '../presetScans'
import { getJson, isOffline, captureFailure, readLivePrices } from './captureFetch'

/** Gainers scanKey -> the perfData period its server-computed N-day return maps to. */
export const GAINERS_PERIOD = {
  'top-gainers-30d': '30d',
  'top-gainers-60d': '60d',
  'top-gainers-90d': '90d',
}

/** Backend `as_of` (ISO, ET-clock offset) -> "1:26 PM" in market (ET) time. */
export function fmtScanTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('en-US',
      { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
  } catch { return '' }
}

/** The scan's symbols in its own order (keyed by content, as the widget keys them). */
export function scanSymbols(data) {
  const symKey = (data?.results || []).map(r => r.sym).join(',')
  return symKey ? symKey.split(',') : []
}

/** A gainers scan's server-computed N-day return and reference close per symbol, or null. */
export function scanPerfOverride(data, scanKey) {
  const period = GAINERS_PERIOD[scanKey]
  if (!period) return null
  const rows = data?.results || []
  let out = null
  for (const r of rows) {
    if (!r) continue
    const entry = {}
    if (r.change_nd != null) entry[period] = r.change_nd
    if (r.ref_close != null) entry.refs = { [period]: r.ref_close }
    if (entry[period] != null || entry.refs) (out ||= {})[r.sym] = entry
  }
  return out
}

/** The frozen capture. Pure: every symbol the scan holds, with the price and move as they stood. */
export function buildScanCapture({ scanKey, scanName, data, prices }) {
  const period = GAINERS_PERIOD[scanKey] || null
  const perfOverride = scanPerfOverride(data, scanKey)
  return {
    scanKey,
    scanName: scanName || null,
    asOf: data?.as_of ? `${fmtScanTime(data.as_of)} ET` : null,
    rows: scanSymbols(data).map((sym) => {
      const live = prices[sym] || {}
      const nd = period != null ? perfOverride?.[sym]?.[period] : null
      return {
        sym,
        price: Number.isFinite(Number(live.price)) ? Number(live.price) : null,
        chgPct: Number.isFinite(Number(live.change_pct)) ? Number(live.change_pct) : null,
        ...(nd != null ? { extraValue: `${Number(nd) > 0 ? '+' : ''}${Number(nd).toFixed(1)}% ${period}` } : {}),
      }
    }),
  }
}

/** The member's default scan: the first preset the picker lists. */
export const defaultScan = () => PRESET_SCANS[0]

/** What the widget fetches for that scan: `/api/scans/<key>` (the key is the wire contract) and live quotes
 *  for its symbols. A failed or paid-gated read, a scan still being built, or one with no matches inserts
 *  nothing and says which. Never throws. */
export async function fetchScanCaptureData() {
  if (isOffline()) return { ok: false, reason: 'offline' }
  const scan = defaultScan()
  const res = await getJson(`/api/scans/${encodeURIComponent(scan.key)}`)
  if (!res.ok || !res.data || typeof res.data !== 'object') return captureFailure()
  const symbols = scanSymbols(res.data)
  if (!symbols.length) {
    return {
      ok: false, reason: 'empty',
      message: res.data.status === 'computing'
        ? `${scan.name} is still being built. Try again in a minute.`
        : `${scan.name} has no matches right now, so nothing was added.`,
    }
  }
  return { ok: true, data: { scanKey: scan.key, scanName: scan.name, data: res.data, prices: await readLivePrices(symbols) } }
}

/** The slash insert: fetch, then build the capture the widget's Send to Journal would build on that scan. */
export async function slashCapture() {
  const res = await fetchScanCaptureData()
  if (!res.ok) return res
  return { ok: true, payload: buildScanCapture(res.data) }
}
