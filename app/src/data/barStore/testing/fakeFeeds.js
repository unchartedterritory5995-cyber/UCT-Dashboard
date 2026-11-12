// Test-only fakes of the live feeds the BarStore subscribes to: barsStreamManager
// ({subscribe, getStatus}), realtimeCandle ({subscribe, getCandle, getLastTickAt}) and
// priceStreamManager ({subscribe, getSnapshot}). Never imported by product code.

export function fakeStream() {
  const subs = new Map()
  const st = { delivering: true }
  return {
    st,
    subscribe(sym, tf, cbs) {
      const k = `${sym}:${tf}`
      if (!subs.has(k)) subs.set(k, new Set())
      subs.get(k).add(cbs)
      return () => subs.get(k)?.delete(cbs)
    },
    getStatus: () => ({ connected: true, healthy: true, delivering: st.delivering }),
    emit(sym, tf, data) { for (const c of subs.get(`${sym}:${tf}`) || []) c.onBar?.(data) },
    count: () => [...subs.values()].reduce((n, s) => n + s.size, 0),
  }
}
export function fakeCandle() {
  const subs = new Map(), state = new Map(), lastAt = new Map()
  return {
    subscribe(sym, cb) { if (!subs.has(sym)) subs.set(sym, new Set()); subs.get(sym).add(cb); return () => subs.get(sym)?.delete(cb) },
    getCandle: (sym) => state.get(sym) || null,
    getLastTickAt: (sym) => lastAt.get(sym) || 0,
    tick(sym, price, ms) {
      const t = Math.floor(ms / 60000) * 60
      const prev = state.get(sym)
      state.set(sym, prev && prev.t === t ? { ...prev, c: price, h: Math.max(prev.h, price), l: Math.min(prev.l, price) } : { t, o: price, h: price, l: price, c: price, v: 0 })
      lastAt.set(sym, ms)
      for (const cb of subs.get(sym) || []) cb()
    },
    count: () => [...subs.values()].reduce((n, s) => n + s.size, 0),
  }
}
export function fakePrices() {
  const subs = new Set()
  let snap = { prices: {} }
  return {
    subscribe(_t, cb) { subs.add(cb); return () => subs.delete(cb) },
    getSnapshot: () => snap,
    set(sym, price) { snap = { prices: { ...snap.prices, [sym]: { price } } }; for (const cb of subs) cb() },
    count: () => subs.size,
  }
}
