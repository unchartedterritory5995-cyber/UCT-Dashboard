// Test-only: a minimal in-memory `indexedDB` — just the surface utils/barsIDB uses (open
// with onupgradeneeded, one object store with keyPath, readonly / readwrite transactions,
// get / put / delete / getAllKeys, tx.oncomplete). Requests settle on microtasks (never on
// timers, so suites with fake timers still progress), values are structured-cloned on put
// and get like the real thing. Never imported by product code.

const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)))
const later = (fn) => Promise.resolve().then(fn)

export function createFakeIndexedDB() {
  const dbs = new Map()   // name → { version, stores: Map<name, {keyPath, rows: Map}> }
  let puts = 0

  function makeDb(rec) {
    const db = {
      objectStoreNames: { contains: (n) => rec.stores.has(n) },
      createObjectStore(n, { keyPath }) { rec.stores.set(n, { keyPath, rows: new Map() }) },
      deleteObjectStore(n) { rec.stores.delete(n) },
      close() {},
      onversionchange: null,
      transaction(name) {
        const st = rec.stores.get(name)
        if (!st) throw new Error(`no store ${name}`)
        let pending = 0
        let finished = false
        const tx = { oncomplete: null, onerror: null, onabort: null }
        const settle = () => { if (pending === 0 && !finished) { finished = true; later(() => tx.oncomplete?.()) } }
        const request = (fn) => {
          const req = { result: undefined, onsuccess: null, onerror: null }
          pending++
          later(() => {
            req.result = fn()
            try { req.onsuccess?.({ target: req }) } finally { pending--; settle() }
          })
          return req
        }
        tx.objectStore = () => ({
          get: (k) => request(() => (st.rows.has(k) ? clone(st.rows.get(k)) : undefined)),
          put: (v) => request(() => { puts++; st.rows.set(v[st.keyPath], clone(v)); return v[st.keyPath] }),
          delete: (k) => request(() => { st.rows.delete(k) }),
          getAllKeys: () => request(() => [...st.rows.keys()]),
        })
        later(settle)
        return tx
      },
    }
    return db
  }

  const api = {
    open(name, version) {
      const req = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null }
      later(() => {
        let rec = dbs.get(name)
        const upgrade = !rec || rec.version < version
        if (!rec) { rec = { version, stores: new Map() }; dbs.set(name, rec) }
        const db = makeDb(rec)
        req.result = db
        if (upgrade) { rec.version = version; req.onupgradeneeded?.({ target: req }) }
        req.onsuccess?.({ target: req })
      })
      return req
    },
    /** Test helpers. */
    _rows(name = 'uct_bars_v1', store = 'bars') { return dbs.get(name)?.stores.get(store)?.rows ?? new Map() },
    _clear() { for (const rec of dbs.values()) for (const st of rec.stores.values()) st.rows.clear() },
    _puts() { return puts },
  }
  return api
}

/** Install as `globalThis.indexedDB` (returns the fake). */
export function installFakeIndexedDB() {
  const fake = createFakeIndexedDB()
  globalThis.indexedDB = fake
  return fake
}
