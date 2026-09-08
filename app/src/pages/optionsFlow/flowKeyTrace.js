// Which bootstrap keys does first paint ACTUALLY read?
//
// ⛔ WHY THIS EXISTS RATHER THAN A STATIC AUDIT. The recorded bootstrap ledger
// says "CONV has no first-paint renderer". That is false — `FD.CONV` builds the
// primary BULL/BEAR lists and the unusual-activity lists. A partition decision
// taken from that note would have deferred content the default tab renders. A
// static walk is not much safer: reads inside the page's large JSX regions are
// hard to attribute to a consumer mechanically, and "which tab was open" is a
// runtime fact.
//
// So: record the reads as they happen, in the member's own browser, on the real
// page. A Proxy over the dataset notes the FIRST time each key is touched and
// how long after mount that was, which is exactly the classification the
// partition needs — before first paint, just after, or only on interaction.
//
// ⛔ OFF BY DEFAULT AND FREE WHEN OFF. `traceDataset` returns the object
// UNCHANGED unless tracing is armed, so the shipped page carries no Proxy, no
// wrapper allocation and no per-read cost. Arming is per-browser (a query param
// or a localStorage key), so measuring needs no rebuild and no flag flip that
// could reach members.

const STORE_KEY = 'uct.flow.traceKeys'

/** Row arrays worth tracing field-by-field. Deep-proxying everything would be
 *  far too costly and would distort the timings this file also reports. */
const DEEP_KEYS = new Set(['TICKER_DB', 'CONV', 'clean_confirmed'])

/**
 * Wrap an array of row objects so field reads are recorded per key.
 *
 * ⛔ ROWS ARE COUNTED, NOT COPIED. We record how many DISTINCT row indices were
 * touched and the union of field names — enough to size a derived product,
 * without retaining the rows themselves or turning a render into a log.
 */
const ARRAY_PROXIES = new WeakMap()

function traceRows(arr, key, store) {
  const seen = (store.deep[key] = store.deep[key] || {
    fields: {}, rowsTouched: new Set(), rowCount: arr.length, arrayOps: {},
  })
  const cached = ARRAY_PROXIES.get(arr)
  // ⛔ MEMOISE THE PROXY, NOT THE ACCUMULATOR. Caching a proxy that closed over
  // the `seen` it was built with meant a second trace recorded into a dead
  // store — reads happened and the report showed none. Caught by the
  // rows-visited test.
  if (cached && cached.store === store) return cached.proxy
  const wrapped = new Proxy(arr, {
    get(t, p, r) {
      if (typeof p === 'string' && /^\d+$/.test(p)) {
        seen.rowsTouched.add(p)
        const row = Reflect.get(t, p, r)
        return row && typeof row === 'object' ? traceRow(row, seen) : row
      }
      if (typeof p === 'string' && p !== 'length') {
        seen.arrayOps[p] = (seen.arrayOps[p] || 0) + 1
      }
      const v = Reflect.get(t, p, r)
      // .map/.filter/.find hand each row to a callback — wrap so their field
      // reads are captured too, otherwise the busiest consumers are invisible.
      if (typeof v === 'function' && ITER_OPS.has(p)) {
        return function (cb, ...rest) {
          const out = v.call(t, (row, i, a) => {
            seen.rowsTouched.add(String(i))
            return cb(row && typeof row === 'object' ? traceRow(row, seen) : row, i, a)
          }, ...rest)
          // ⛔ WRAP WHAT COMES BACK, OR THE REPORT UNDER-SIZES THE PRODUCT.
          // `find`/`filter` return the RAW rows, so a consumer doing
          // `const tk = TICKER_DB.find(...)` then reading `tk.prem` would have
          // those field reads recorded NOWHERE — and a derived product built
          // from the report would be missing exactly the fields the renderer
          // needs. Caught by a test whose consumer was shaped like the real ones.
          if (p === 'find' && out && typeof out === 'object') return traceRow(out, seen)
          if (p === 'filter' && Array.isArray(out)) {
            return out.map(row => (row && typeof row === 'object' ? traceRow(row, seen) : row))
          }
          return out
        }
      }
      return v
    },
  })
  ARRAY_PROXIES.set(arr, { proxy: wrapped, store })
  return wrapped
}

const ITER_OPS = new Set(['map', 'filter', 'find', 'findIndex', 'forEach', 'some', 'every', 'flatMap', 'reduce', 'sort'])

// ⛔ ONE PROXY PER ROW, EVER. The first version allocated a fresh Proxy on every
// row access. With FD traced (the hot object) and ~900-row arrays re-read across
// renders, that ran into millions of allocations and FROZE the page — the
// instrument stopped the thing it was measuring from happening at all. A
// WeakMap makes wrapping idempotent and keeps the traced page usable.
const ROW_PROXIES = new WeakMap()

function traceRow(row, seen) {
  const hit = ROW_PROXIES.get(row)
  if (hit && hit.seen === seen) return hit.proxy
  const proxied = new Proxy(row, {
    get(t, p, r) {
      if (typeof p === 'string') seen.fields[p] = (seen.fields[p] || 0) + 1
      return Reflect.get(t, p, r)
    },
  })
  ROW_PROXIES.set(row, { proxy: proxied, seen })
  return proxied
}

/** Armed by `?tracekeys=1` (sticky) or localStorage. Never on by default. */
export function tracingArmed() {
  if (typeof window === 'undefined') return false
  try {
    const q = new URLSearchParams(window.location.search)
    if (q.get('tracekeys') === '1') {
      try { window.localStorage.setItem(STORE_KEY, '1') } catch { /* private mode */ }
      return true
    }
    if (q.get('tracekeys') === '0') {
      try { window.localStorage.removeItem(STORE_KEY) } catch { /* private mode */ }
      return false
    }
    return window.localStorage.getItem(STORE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Wrap a dataset so the FIRST read of each key is recorded.
 *
 * Returns the input untouched when tracing is not armed — a caller can apply it
 * unconditionally at every assignment site without paying for it in production.
 *
 * ⛔ FIRST READ ONLY. Recording every access would turn a hot render path into a
 * log and change the timings it is supposed to be measuring; the question here
 * is "was this key needed, and when", which the first touch answers.
 */
export function traceDataset(obj, label = 'D') {
  if (!obj || typeof obj !== 'object' || !tracingArmed()) return obj
  const store = ensureStore()
  return new Proxy(obj, {
    get(target, prop, recv) {
      // ⛔ AN ESCAPE HATCH THAT RECORDS NOTHING. Spreading a Proxy reads EVERY
      // key, so `{...prev}` at the merge site would mark the whole dataset as
      // read and the trace would say "first paint needs everything". Callers
      // unwrap with `.__raw` before spreading.
      if (prop === '__raw') return target
      if (typeof prop === 'string' && !(prop in store.firstRead)) {
        store.firstRead[prop] = {
          ms: Math.round(performance.now() - store.t0),
          label,
          paintedYet: store.firstContentMs != null,
        }
        store.order.push(prop)
      }
      const value = Reflect.get(target, prop, recv)
      // ⛔ FIELD-LEVEL TRACE FOR THE ROW ARRAYS. Knowing that `TICKER_DB` was
      // read says nothing about what a derived product would have to CONTAIN.
      // The question is which FIELDS of which ROWS first paint actually touches
      // -- a 1,026-row array whose consumers read four fields off twenty rows
      // is a very different product from one that reads everything.
      if (typeof prop === 'string' && DEEP_KEYS.has(prop) && Array.isArray(value)) {
        return traceRows(value, prop, store)
      }
      return value
    },
  })
}

function ensureStore() {
  if (!window.__flowKeyReads) {
    window.__flowKeyReads = {
      t0: performance.now(),
      firstContentMs: null,
      firstRead: {},
      order: [],
      deep: {},
      /** Field-level summary for the deep-traced row arrays. */
      fieldReport() {
        const out = {}
        for (const [k, v] of Object.entries(window.__flowKeyReads.deep)) {
          out[k] = {
            rowCount: v.rowCount,
            rowsTouched: v.rowsTouched.size,
            fields: Object.entries(v.fields).sort((a, b) => b[1] - a[1])
              .map(([f, n]) => `${f}:${n}`),
            arrayOps: Object.keys(v.arrayOps),
          }
        }
        return out
      },
      /** Keys read before the page reported real content. */
      beforePaint() {
        const c = window.__flowKeyReads.firstContentMs
        return Object.entries(window.__flowKeyReads.firstRead)
          .filter(([, v]) => c == null || v.ms <= c)
          .map(([k, v]) => `${k}@${v.ms}ms`)
      },
      /** Keys never touched at all. Pass the served key list. */
      unread(all) {
        return (all || []).filter((k) => !(k in window.__flowKeyReads.firstRead))
      },
    }
  }
  return window.__flowKeyReads
}

/**
 * Mark the moment the page has real content, so reads can be split into
 * "needed for first paint" and "needed after it".
 *
 * ⛔ THE PAGE MUST SAY THIS, not a timer. A fixed cutoff would classify keys by
 * how fast the network happened to be that run.
 */
export function markFirstContent() {
  if (typeof window === 'undefined' || !tracingArmed()) return
  const s = ensureStore()
  if (s.firstContentMs == null) s.firstContentMs = Math.round(performance.now() - s.t0)
}
