// "The Research Type offer was applied" must outlive the Notebook route (spec P1.2: a one-shot offer). The server
// keeps counting the notes it skipped (locked, unsent), so without this the offer would be asked again on the next
// visit, e.g. when the member arrives from Settings (?styles=1) and the whole tab remounts.
// Kept per member in sessionStorage (every read and write wrapped: private mode and blocked storage throw), with a
// module-level set as the fallback so a throwing store still hides it for the rest of the session.
const memory = new Set()
const keyFor = (userId) => `uct.nb.kindOfferApplied.${userId ?? 'anon'}`

export function offerApplied(userId) {
  if (memory.has(userId ?? 'anon')) return true
  try { return sessionStorage.getItem(keyFor(userId)) === '1' } catch { return false }
}

export function markOfferApplied(userId) {
  memory.add(userId ?? 'anon')
  try { sessionStorage.setItem(keyFor(userId), '1') } catch { /* the module-level set still holds it */ }
}

/** Test support: forget everything. */
export function __resetOfferApplied() { memory.clear() }
