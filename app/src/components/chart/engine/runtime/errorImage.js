// app/src/components/chart/engine/runtime/errorImage.js
//
// ⛔⛔ THE RULE (RS Rating L10b, 2026-11-18): AN ERROR THAT CROSSES A WORKER BOUNDARY KEEPS EVERY FIELD THE
// MAIN THREAD READS.
//
// A structured clone of an `Error` keeps its name and message and drops every field a lane set on it.
// The runtime worker therefore posted a hand-picked list (`name, message, guard, limit, bar, ms`), and
// the main thread rebuilt that list. When `pending` was added (a run waiting for another symbol's bars),
// it was on neither list. Waits crossed as refusals and RS Rating flashed "refused" on slow loads.
// So no list: the worker sends every own enumerable field whose value is plain data, and the main thread
// puts every one back. A field added tomorrow crosses without anyone remembering to name it here.
//
// What does not cross: a field whose value is an object or a function (a structured clone could carry
// some objects, but an error's object fields are things like `cause` chains, which no reader of a run
// error reads). The host lane's worker (#1746, `hostLaneWire.js`) follows the same rule.

/** A throw, as plain data the worker can post: its name, its message, and every own enumerable field
 *  whose value is `null`, a string, a number or a boolean. */
export function errorImageOf(err) {
  const img = { name: (err && err.name) || 'Error', message: String((err && err.message) || err) }
  if (err && typeof err === 'object') {
    for (const [k, v] of Object.entries(err)) {
      if (k === 'name' || k === 'message') continue
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) img[k] = v
    }
  }
  return img
}

/** The throw an image carried, rebuilt on this side with its name and every field it carried. */
export function errorFromImage(img, fallbackMessage = 'the runtime lane failed') {
  const err = new Error(img && img.message ? img.message : fallbackMessage)
  err.name = (img && img.name) || 'Error'
  for (const [k, v] of Object.entries(img || {})) {
    if (k === 'name' || k === 'message' || v === null || v === undefined) continue
    err[k] = v
  }
  return err
}
