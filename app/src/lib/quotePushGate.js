// The door to pushed list prices (lib/quotePush.js), kept OUT of every first-open graph.
//
// lib/quotePush.js is loaded with a dynamic import() only when the client flag is on: the stores
// (hooks/livePriceStore, lib/priceStreamManager) import THIS file statically, never quotePush itself. Two
// reasons, both measured on #2751's CI: the notebook's first-open bytes budget (the push client reached its
// first-open chunks, +1,943 B over), and the member door worker's load-time-registration rail (the stores
// registered quotePush sinks when they LOADED). Now a store registers only once the module has loaded, and a
// member without the flag never downloads it. lib/quotePush.lazy.test.js keeps every static import of it out.
//
// The flag lives here so quotePush and the stores read ONE rule: `localStorage['uct.quotePush'] = '1'` or the
// cookie `uct_quote_push=1`; the kill switch `localStorage['uct.quotePush.disabled'] = '1'` beats both.

export function quotePushFlagOn() {
  try {
    if (typeof localStorage !== 'undefined') {
      if (localStorage.getItem('uct.quotePush.disabled') === '1') return false
      if (localStorage.getItem('uct.quotePush') === '1') return true
    }
  } catch { /* storage refused: fall through to the cookie */ }
  try {
    return typeof document !== 'undefined' && /(?:^|;\s*)uct_quote_push=1(?:;|$)/.test(document.cookie || '')
  } catch {
    return false
  }
}

let _mod = null
let _loading = null
const _waiting = new Set()

/** The loaded module, or null (not flagged on, or still loading). */
export function getQuotePush() {
  return _mod
}

/** Run `fn(module)` once the module is loaded: at once if it is, after loading it if the flag is on, and
 *  otherwise when a later call (flag turned on) loads it. The same `fn` waits once. */
export function whenQuotePush(fn) {
  if (_mod) { fn(_mod); return }
  _waiting.add(fn)
  if (_loading || !quotePushFlagOn()) return
  _loading = import('./quotePush').then((m) => {
    _mod = m
    const fns = [..._waiting]
    _waiting.clear()
    for (const f of fns) {
      try { f(m) } catch { /* one waiter never stops the others */ }
    }
  }).catch(() => { _loading = null })
}

/** Test seam: the module as a test imported it (and forget waiters). */
export function __setQuotePushForTest(m) {
  _mod = m || null
  _loading = null
  _waiting.clear()
}
