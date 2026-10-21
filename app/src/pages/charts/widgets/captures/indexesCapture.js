// Notebook widgets Task 16: the Indexes capture, ONE builder for both doors.
//
// The /charts IndexesWidget's "Send to Journal" and the Notebook's `/indexes` insert both build the frozen
// capture here. `/api/snapshot` takes no date, so the levels are a freeze, never a re-fetch (see the
// widget's header). Held dark by Wave R: the / menu offers it only when captureEnabled() is true.
import { fetchSnapshot, isFailed } from '../widgetSnapshotFetcher'
import { rowsFromSnapshot } from '../indexesModel'
import { isOffline, captureFailure, etStamp, boundedFetch } from './captureFetch'

/** The one URL both doors read. */
export const INDEXES_URL = '/api/snapshot'

/** The footer stamp for one snapshot: when it LANDED, or null when no time travelled with it. */
export const indexesUpdated = (data) => (data?._fetchedAt ? etStamp(data._fetchedAt) : null)

/** The frozen capture. Pure: the rows on screen and the stamp beside them. */
export function buildIndexesCapture({ rows, updated }, { hiddenSymbols }) {
  return { hiddenSymbols: Array.isArray(hiddenSymbols) ? hiddenSymbols : [], rows, updated }
}

/** What the widget fetches: `/api/snapshot`, through the widget's own fetch-and-check. A failed read, or a
 *  snapshot with none of the six readings, inserts nothing (the widget offers no Send then). Never throws. */
export async function fetchIndexesCaptureData() {
  if (isOffline()) return { ok: false, reason: 'offline' }
  const data = await fetchSnapshot(INDEXES_URL, { fetchImpl: boundedFetch })
  if (isFailed(data) || !rowsFromSnapshot(data, []).length) return captureFailure()
  return { ok: true, data }
}

/** The slash insert: fetch, then build the capture a fresh widget's Send to Journal would build. */
export async function slashCapture() {
  const res = await fetchIndexesCaptureData()
  if (!res.ok) return res
  return {
    ok: true,
    payload: buildIndexesCapture({ rows: rowsFromSnapshot(res.data, []), updated: indexesUpdated(res.data) }, { hiddenSymbols: [] }),
  }
}
