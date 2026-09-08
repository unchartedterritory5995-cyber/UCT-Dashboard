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
      return Reflect.get(target, prop, recv)
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
