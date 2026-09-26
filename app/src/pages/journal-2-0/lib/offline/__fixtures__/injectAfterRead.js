/**
 * D3b (wave 6) — fire a write at an exact moment in someone else's read-then-write.
 *
 * Wraps `db.transaction` (a fake store from `fakeIndexedDb.js`) and calls
 * `inject()` ONCE, right after the chosen read completes:
 *   'note'   — a `get` on the notes store (the read of the note record)
 *   'queue'  — a read of the outbox: a `getAll`, or a walk of an index cursor
 *              to its END (the read of the note's queued entries)
 * The hook is written against WHEN a caller reads, never against how many
 * transactions it uses, so one rail reads a three-transaction implementation and
 * a one-transaction implementation alike.
 *
 * @returns disarm() — puts `db.transaction` back
 */
export function injectAfterRead(db, which, inject) {
  const orig = db.transaction.bind(db)
  let fired = false
  const fire = () => { if (!fired) { fired = true; inject() } }
  const passThrough = (req, after) => {
    const wrapped = { get result() { return req.result } }
    req.onsuccess = () => { wrapped.onsuccess?.(); after() }
    return wrapped
  }
  db.transaction = (names, mode) => {
    const tx = orig(names, mode)
    const objectStore = tx.objectStore
    tx.objectStore = (name) => {
      const store = objectStore(name)
      if (name === 'notes' && which === 'note') {
        return { ...store, get: (key) => passThrough(store.get(key), fire) }
      }
      if (name === 'outbox' && which === 'queue') {
        return {
          ...store,
          getAll: () => passThrough(store.getAll(), fire),
          index: (ix) => {
            const index = store.index(ix)
            return {
              ...index,
              openCursor: (range) => {
                const req = index.openCursor(range)
                return passThrough(req, () => { if (req.result === null) fire() })
              },
            }
          },
        }
      }
      return store
    }
    return tx
  }
  return () => { db.transaction = orig }
}
