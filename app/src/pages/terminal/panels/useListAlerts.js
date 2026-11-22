// List alerts: the one read and the one write every "Alert me when a stock I follow appears here"
// control shares (the three panels' switch and the Settings rows). The pure half is
// listAlertModel.js.
//
// ONE SOURCE OF TRUTH. Every control reads `GET /api/alerts/lists` through marketRead.js under the
// same SWR key, so a switch pressed in one panel is the state every other open control draws.
//
// ⛔ THE SCREEN ONLY EVER SHOWS THE SERVER'S ANSWER. Nothing flips before the write lands: the
// control waits, then the switches the server sent back with the write are what is drawn, and the
// list is read again after every write, landed or not. A failed write changes nothing on screen.
// ⛔ A FAILED READ IS NOT "OFF". A dark route (404), a paywall (402) and a signed-out member (401)
// draw nothing; any other failure is `unreadable`, with a retry and no switch.
import { useRef, useState } from 'react'
import jsonFetcher from '../../../utils/jsonFetcher'
import { useMarketRead } from './marketRead'
import {
  LIST_ALERTS_URL, listAlertWriteUrl, listAlertsRead, readIsQuiet, switchOf, writeFailureText, writeOutcome,
} from './listAlertModel'

const send = (kind, on) => jsonFetcher(listAlertWriteUrl(kind), {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }),
})

/**
 * `{ state, view, busy, result, toggle, retry, error }`
 *   state   'loading' | 'off' (draw nothing) | 'unreadable' (say so, offer `retry`) | 'ok'
 *   view    the member's switches (`listAlertsRead`)
 *   busy    the kind being written, or null
 *   result  the last write's outcome `{ list, kind, text }`, or null
 *   toggle  (kind) => flips that list's switch on the server
 */
export function useListAlerts() {
  const read = useMarketRead(LIST_ALERTS_URL)
  const view = listAlertsRead(read.body)
  // The switches the server sent back with the last write, shown until a later read lands
  // (`since` is the read on screen when the write was answered).
  const [written, setWritten] = useState(null)   // { view, since }
  const [busy, setBusy] = useState(null)
  const [result, setResult] = useState(null)
  const working = useRef(false)
  const lastRead = useRef(null)
  lastRead.current = read.receivedAt

  const fresh = written && written.since === read.receivedAt ? written.view : view
  let state = 'ok'
  if (read.loading) state = 'loading'
  else if (!read.body && read.error) state = readIsQuiet(read.error) ? 'off' : 'unreadable'
  else if (fresh.state === 'off') state = 'off'
  else if (fresh.state !== 'ok') state = 'unreadable'

  const toggle = async (kind) => {
    const now = switchOf(fresh, kind)
    if (working.current || state !== 'ok' || now === null) return
    const want = !now
    working.current = true
    setBusy(kind)
    setResult(null)
    try {
      const out = writeOutcome(await send(kind, want), kind, want)
      if (out.read) setWritten({ view: out.read, since: lastRead.current })
      setResult({ list: kind, kind: out.kind, text: out.text })
    } catch (err) {
      setResult({ list: kind, kind: 'failed', text: writeFailureText(err, kind, want) })
    } finally {
      working.current = false
      setBusy(null)
      read.retry()   // every control showing the switches reads them again, landed or not
    }
  }

  return { state, view: fresh, busy, result, toggle, retry: read.retry, error: read.body ? null : read.error }
}
