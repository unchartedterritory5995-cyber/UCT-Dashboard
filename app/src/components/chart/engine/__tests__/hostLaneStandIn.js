// app/src/components/chart/engine/__tests__/hostLaneStandIn.js
//
// ⭐ HOST WORKER — a stand-in for the host lane's Web Worker, for the rails. Each "worker" runs the
// worker's OWN handler (`hostLaneWorkerCore.answerHostLaneJob`) over a STRUCTURED CLONE of the exact
// message the chart's thread posted (with the same transfer list), and answers with a structured
// clone of the exact reply: the boundary a `postMessage` is, byte for byte, without a browser.
// Each holds its own documents, so a restarted worker holds none, as a real one would.
import { answerHostLaneJob } from '../hostLaneWorkerCore'

export function standInWorkers() {
  const made = []
  const factory = () => {
    const w = {
      docs: new Map(), inbox: [], terminated: false, onmessage: null, onerror: null, onmessageerror: null,
      postMessage(msg, transfer) {
        if (w.terminated) throw new Error('the worker was terminated')
        w.inbox.push(structuredClone(msg, { transfer }))
      },
      terminate() { w.terminated = true },
    }
    made.push(w)
    return w
  }
  /** Answer every message the live workers hold (and those their answers cause to be posted). */
  const drain = () => {
    let total = 0
    for (let guard = 0; guard < 1000; guard += 1) {
      let n = 0
      for (const w of made) {
        while (!w.terminated && w.inbox.length) {
          const { reply, transfer } = answerHostLaneJob(w.inbox.shift(), w.docs)
          n += 1
          if (w.onmessage) w.onmessage({ data: structuredClone(reply, { transfer }) })
        }
      }
      total += n
      if (!n) break
    }
    return total
  }
  const posted = () => made.reduce((a, w) => a + w.inbox.length, 0)
  /** Answer exactly ONE message (the oldest the newest live worker holds). */
  const answerOne = () => {
    const w = [...made].reverse().find((x) => !x.terminated && x.inbox.length)
    if (!w) return false
    const { reply, transfer } = answerHostLaneJob(w.inbox.shift(), w.docs)
    if (w.onmessage) w.onmessage({ data: structuredClone(reply, { transfer }) })
    return true
  }
  /** Answer exactly ONE message, the oldest worker `i` holds (in the order the workers were made). */
  const answerFrom = (i) => {
    const w = made[i]
    if (!w || w.terminated || !w.inbox.length) return false
    const { reply, transfer } = answerHostLaneJob(w.inbox.shift(), w.docs)
    if (w.onmessage) w.onmessage({ data: structuredClone(reply, { transfer }) })
    return true
  }
  return { factory, made, drain, posted, answerOne, answerFrom }
}

/** Every own property of a column map (enumerable or not), compared as the chart reads them:
 *  a typed array BYTE for byte, everything else by `Object.is` member by member, objects to the
 *  same frozen depth. Returns the first difference as a sentence, or null. */
export function firstDifference(a, b, path = '$') {
  if (Object.is(a, b)) return null
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)) return `${path}: one is a typed array, the other is not`
    // by NAME: a structured clone in a test host may build its array in another realm (a browser's
    // worker answer arrives in the page's own); the bytes below are what is compared
    if (a.constructor.name !== b.constructor.name) return `${path}: ${a.constructor.name} vs ${b.constructor.name}`
    if (a.length !== b.length) return `${path}: length ${a.length} vs ${b.length}`
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
    for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return `${path}: byte ${i} differs (bar ${Math.floor(i / a.BYTES_PER_ELEMENT)}: ${a[Math.floor(i / a.BYTES_PER_ELEMENT)]} vs ${b[Math.floor(i / b.BYTES_PER_ELEMENT)]})`
    return null
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return `${path}: ${String(a)} vs ${String(b)}`
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: an array and not an array`
  if (Object.isFrozen(a) !== Object.isFrozen(b)) return `${path}: frozen ${Object.isFrozen(a)} vs ${Object.isFrozen(b)}`
  const ka = Reflect.ownKeys(a).filter((k) => typeof k === 'string')
  const kb = Reflect.ownKeys(b).filter((k) => typeof k === 'string')
  if (ka.length !== kb.length || ka.some((k) => !Object.prototype.hasOwnProperty.call(b, k))) {
    return `${path}: keys [${ka.join(', ')}] vs [${kb.join(', ')}]`
  }
  for (const k of ka) {
    const da = Object.getOwnPropertyDescriptor(a, k)
    const db = Object.getOwnPropertyDescriptor(b, k)
    if (!!da.enumerable !== !!db.enumerable) return `${path}.${k}: enumerable ${da.enumerable} vs ${db.enumerable}`
    const d = firstDifference(a[k], b[k], `${path}.${k}`)
    if (d) return d
  }
  return null
}
