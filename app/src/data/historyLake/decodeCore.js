// The decode the history lake's worker runs and the page falls back to (decoder.js says why). No Worker, no DOM:
// imported by decode.worker.js and by decoder.js, so the worker bundle never contains the page's client.
import { PieceError, decodeColumns, toFloats } from './piece'

/** The decode the worker runs and the page falls back to: header JSON + inflated body -> `{ header, ...float columns }`
 *  (`toFloats` of `decodeColumns`, the header beside them for the caller's identity check). */
export function decodePieceColumns(headerJson, body) {
  const d = decodeColumns(headerJson, body)
  return { header: d.header, ...toFloats(d) }
}

const COLS = ['t', 'o', 'h', 'l', 'c', 'v', 'n']

/** The worker's answer to one message `{ id, headerJson, body }`: `{ msg, transfer }`. */
export function decodeReply(data) {
  const { id, headerJson, body } = data || {}
  try {
    const d = decodePieceColumns(headerJson, body)
    const seen = new Set()
    const transfer = []
    for (const k of COLS) { const b = d[k] && d[k].buffer; if (b && !seen.has(b)) { seen.add(b); transfer.push(b) } }
    return { msg: { id, ok: true, cols: d }, transfer }
  } catch (err) {
    return { msg: { id, ok: false, piece: err instanceof PieceError, message: String((err && err.message) || err) }, transfer: [] }
  }
}

