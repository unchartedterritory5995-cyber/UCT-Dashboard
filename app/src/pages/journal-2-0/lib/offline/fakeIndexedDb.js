/**
 * A small in-memory stand-in for the slice of IndexedDB this wave actually uses
 * — jsdom implements none of it, and the point of these rails is to exercise
 * the REAL adapter (`notebookDb.js`), not a mock of it.
 *
 * ⛔ IT MODELS THE ONE PROPERTY THE ADAPTER LEANS ON: a transaction stages its
 * writes and commits them together, so an abort leaves NEITHER the note nor its
 * outbox intent. A fake that just wrote straight through would let a two-awaits
 * implementation pass the atomicity rail — the exact "fixture that cannot
 * distinguish" this repo keeps paying for. `fakeIndexedDb.test.js` proves the
 * fake can tell the two apart before anything else trusts it.
 */

/** `IDBKeyRange` is a global the adapter calls; jsdom has none. */
export function installKeyRange() {
  if (!globalThis.IDBKeyRange) {
    globalThis.IDBKeyRange = { only: (value) => ({ __only: value }) }
  }
}

const STORE_NAMES = ['notes', 'outbox', 'conflicts', 'meta']
const KEY_PATHS = { notes: 'noteId', outbox: 'mutationId', conflicts: 'conflictId', meta: 'name' }
/** index name → the record field it indexes (only what this wave declares). */
const INDEXES = { outbox: { byNote: 'noteId' }, notes: { byDirty: 'dirty' } }

export function createFakeDb({ failStore = null } = {}) {
  installKeyRange()
  const data = {}
  STORE_NAMES.forEach((n) => { data[n] = new Map() })

  const db = {
    /** test-side view of what is actually committed */
    dump: (name) => [...data[name].values()],
    seed: (name, record) => { data[name].set(record[KEY_PATHS[name]], { ...record }) },
    // The adapter's upgrade path pokes at these; every store exists here by
    // construction, so `contains` is always true and nothing is created.
    objectStoreNames: { contains: (n) => STORE_NAMES.includes(n) },
    createObjectStore: () => ({ createIndex: () => {} }),
    onversionchange: null,
    close() { db.closed = true },
    closed: false,
    transaction(names, mode = 'readonly') {
      const list = Array.isArray(names) ? names : [names]
      const staged = new Map(list.map((n) => [n, new Map(data[n])]))
      const tx = { objectStore: null, oncomplete: null, onerror: null, onabort: null, error: null }
      let pending = 0
      let aborted = false

      const settle = () => {
        if (pending > 0) return
        if (aborted) { tx.onabort?.(); return }
        if (mode === 'readwrite') list.forEach((n) => { data[n] = staged.get(n) })
        tx.oncomplete?.()
      }
      const queue = (fn) => {
        pending += 1
        Promise.resolve().then(() => {
          try { fn() } catch (e) { aborted = true; tx.error = e }
          pending -= 1
          settle()
        })
      }

      const storeApi = (name) => {
        const map = () => staged.get(name)
        const keyPath = KEY_PATHS[name]
        return {
          put(record) {
            const req = {}
            queue(() => {
              if (failStore === name) throw new Error(`fake: ${name} rejected the write`)
              map().set(record[keyPath], { ...record })
              req.onsuccess?.()
            })
            return req
          },
          get(key) {
            const req = { result: undefined }
            queue(() => { req.result = map().get(key) || undefined; req.onsuccess?.() })
            return req
          },
          getAll() {
            const req = { result: [] }
            queue(() => { req.result = [...map().values()]; req.onsuccess?.() })
            return req
          },
          delete(key) {
            const req = {}
            queue(() => { map().delete(key); req.onsuccess?.() })
            return req
          },
          index(indexName) {
            const field = INDEXES[name]?.[indexName]
            return {
              openCursor(range) {
                const req = { result: null }
                queue(() => {
                  const wanted = range?.__only
                  const hits = [...map().values()].filter((r) => r[field] === wanted)
                  let i = 0
                  const step = () => {
                    if (i >= hits.length) { req.result = null; req.onsuccess?.(); return }
                    const row = hits[i]
                    req.result = {
                      value: row,
                      delete: () => { map().delete(row[keyPath]) },
                      continue: () => { i += 1; queue(step) },
                    }
                    req.onsuccess?.()
                  }
                  step()
                })
                return req
              },
            }
          },
        }
      }

      tx.objectStore = storeApi
      // A transaction with no requests must still complete.
      queue(() => {})
      return tx
    },
  }
  return db
}

/** Let every queued microtask and its follow-ups drain. */
export async function settleIdb(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 0))
  }
}

/**
 * An `indexedDB`-shaped factory, so a rail can run the REAL `openNotebookDb`
 * (handlers, versioning and all) instead of injecting past it.
 *
 * ⛔ Databases are keyed BY NAME, which is the only way a cross-account rail
 * can mean anything: `uct_notebook_a` and `uct_notebook_b` are two stores here
 * exactly as they are in a browser, so a leak would show up as one.
 */
export function createFakeIndexedDbFactory({ failStore = null } = {}) {
  installKeyRange()
  const databases = new Map()
  return {
    databases,
    open(name) {
      const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null }
      setTimeout(() => {
        let db = databases.get(name)
        const fresh = !db
        if (!db) { db = createFakeDb({ failStore }); db.name = name; databases.set(name, db) }
        req.result = db
        if (fresh) req.onupgradeneeded?.()
        req.onsuccess?.()
      }, 0)
      return req
    },
  }
}
