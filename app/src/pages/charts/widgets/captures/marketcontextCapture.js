// Notebook widgets Task 16: the Market Context capture, ONE builder for both doors.
//
// The /charts MarketContextWidget's "Send to Journal" and the Notebook's `/marketcontext` insert both build
// the frozen capture here. `/api/breadth` serves the CURRENT wire payload only, so this is a freeze, never a
// re-fetch (see the widget's header). Held dark by Wave R: the / menu offers it only when captureEnabled().
import { fetchSnapshot, isFailed } from '../widgetSnapshotFetcher'
import { readingsFrom } from '../marketContextModel'
import { isOffline, captureFailure, etStamp, boundedFetch } from './captureFetch'

/** The one URL both doors read. */
export const MARKET_CONTEXT_URL = '/api/breadth'

/** The wire's run date, when the payload names one. */
export const marketContextWireDate = (data) => (typeof data?.wire_date === 'string' ? data.wire_date : null)

/** The footer stamp: when the payload landed, or null. */
export const marketContextUpdated = (data) => (data?._fetchedAt ? etStamp(data._fetchedAt) : null)

/** The frozen capture. Pure: the readings on screen, the wire date and the stamp. */
export function buildMarketContextCapture({ readings, wireDate, updated }) {
  return { readings, wireDate, updated }
}

/** What the widget fetches: `/api/breadth` through the widget's own fetch-and-check. A failed read inserts
 *  nothing; the slash door never freezes an all-blank reading of a payload that never arrived. Never throws. */
export async function fetchMarketContextCaptureData() {
  if (isOffline()) return { ok: false, reason: 'offline' }
  const data = await fetchSnapshot(MARKET_CONTEXT_URL, { fetchImpl: boundedFetch })
  if (isFailed(data)) return captureFailure()
  return { ok: true, data }
}

/** The slash insert: fetch, then build the capture a fresh widget's Send to Journal would build. */
export async function slashCapture() {
  const res = await fetchMarketContextCaptureData()
  if (!res.ok) return res
  const data = res.data
  return {
    ok: true,
    payload: buildMarketContextCapture({
      readings: readingsFrom(data), wireDate: marketContextWireDate(data), updated: marketContextUpdated(data),
    }),
  }
}
