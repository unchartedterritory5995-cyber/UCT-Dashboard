// The history lake's piece decoder, off the main thread (decoder.js says why and what it answers).
//
// Protocol, correlated by `id`:  { id, headerJson, body: Uint8Array }  ->  { id, ok: true, cols } | { id, ok: false, piece, message }
// and once, when this module has loaded: { ready: true }.
import { decodeReply } from './decodeCore'

self.onmessage = (e) => {
  const { msg, transfer } = decodeReply(e.data)
  self.postMessage(msg, transfer)
}
self.postMessage({ ready: true })
