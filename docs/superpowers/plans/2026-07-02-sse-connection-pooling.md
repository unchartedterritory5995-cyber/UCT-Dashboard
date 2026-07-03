# SSE Connection Pooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the 4–8 per-user EventSource connections to `/api/stream/prices` into a shared, bucketed pool (usually 1 connection) with zero behavior change for `useRealtimePrices` consumers and zero backend changes.

**Architecture:** A module-level singleton (`app/src/lib/priceStreamManager.js`) owns all EventSource connections: it unions all subscribers' tickers, slices the union into ≤50-ticker buckets (backend cap), debounces reconnects on union changes, and fans events out through a `useSyncExternalStore`-compatible snapshot. `useRealtimePrices` keeps its exact public API; a module-load kill-switch (`localStorage 'uct.ssePool.disabled' = '1'`) selects the legacy per-instance implementation instead.

**Tech Stack:** React 18 (`useSyncExternalStore`), EventSource/SSE, vitest + @testing-library/react.

## Global Constraints

- **ZERO backend changes** — `api/routers/stream.py` and everything under `api/` must not be touched.
- `useRealtimePrices` public API is FROZEN: `useRealtimePrices(tickers = []) → { prices, isLoading, isStreaming, staleSymbols }` (same semantics: `prices` merged REST+stream per-field, filtered to the hook's own tickers; `staleSymbols` a Set filtered to the hook's tickers; `isLoading = !connected && restLoading`).
- Bucket cap mirrors the backend: `MAX_SSE_TICKERS = 50` (from `stream.py`).
- Rebuild debounce: `REBUILD_DEBOUNCE_MS = 400`.
- Reuse the existing tuning constants verbatim from `app/src/utils/streamStatus.js`: `STREAM_WATCHDOG_MS = 30000`, `STREAM_WATCHDOG_TICK_MS = 10000`, `STREAM_RECONNECT_CAP_MS = 20000`; initial reconnect backoff 5000ms doubling to the cap.
- Candle events (`tick`/`bar_close`/`bar_correction`) are applied to `realtimeCandle` exactly once per event (by the manager, not per subscriber).
- `streamPrices` is never cleared on rebuild/reconnect — last-known prices persist.
- No `EventSource` constructed at module import time (test mock + SSR safety).
- Kill-switch is decided at MODULE LOAD (no conditional hook calls): the default export is chosen between the pooled and legacy hook implementations when the module is imported. Flipping the flag requires a page refresh — documented behavior.
- All frontend work runs from `app/`: tests via `npx vitest run <file>`, full check via `npx vitest run` + `npm run build`.
- Worktree: `.worktrees/ssepool`, branch `feat/sse-connection-pooling`. Commit after every task.

---

## File Structure

| File | Responsibility |
|---|---|
| `app/src/lib/priceStreamManager.js` (create) | Singleton: subscriber registry, ticker union, ≤50 bucketing, debounced rebuild, per-bucket connect/backoff/watchdog, event fanout, snapshot for `useSyncExternalStore` |
| `app/src/lib/priceStreamManager.test.js` (create) | Manager unit tests with a controllable FakeEventSource + fake timers |
| `app/src/hooks/useRealtimePrices.js` (rewrite) | Thin hook over the manager (pooled path) + the current implementation preserved as the legacy path; module-load kill-switch picks the default export |
| `app/src/hooks/useRealtimePrices.test.jsx` (create) | Hook tests: pooled rendering, per-ticker filter, kill-switch legacy fallback |

---

### Task 1: priceStreamManager — subscriptions, union, bucketing, debounced rebuild, connection lifecycle

**Files:**
- Create: `app/src/lib/priceStreamManager.js`
- Test: `app/src/lib/priceStreamManager.test.js`

**Interfaces:**
- Produces (consumed by Tasks 2–3):
  - `subscribe(tickers: string[], listener: () => void): () => void` — registers a consumer; returns unsubscribe.
  - `getSnapshot(): { prices: object, staleSymbols: Set, connected: boolean }` — referentially stable between publishes.
  - `_resetForTests(): void` — closes all connections, clears all module state.
  - `_getBuckets(): Array` — test-only view of internal buckets.
  - Constants: `MAX_SSE_TICKERS = 50`, `REBUILD_DEBOUNCE_MS = 400`.

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/priceStreamManager.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('./realtimeCandle', () => ({
  applyTick: vi.fn(),
  applyBarClose: vi.fn(),
  applyCorrection: vi.fn(),
}))

import * as mgr from './priceStreamManager'

class FakeEventSource {
  static instances = []
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.listeners = {}
    this.onopen = null
    this.onmessage = null
    this.onerror = null
    this.closed = false
    FakeEventSource.instances.push(this)
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
  close() { this.readyState = 2; this.closed = true }
  emitOpen() { this.readyState = 1; this.onopen?.() }
  emitMessage(obj) { this.onmessage?.({ data: JSON.stringify(obj) }) }
  emitEvent(type, obj) { for (const fn of this.listeners[type] || []) fn({ data: JSON.stringify(obj) }) }
  emitError() { this.onerror?.() }
}

function openInstances() {
  return FakeEventSource.instances.filter(es => !es.closed)
}

function flushRebuild() {
  vi.advanceTimersByTime(mgr.REBUILD_DEBOUNCE_MS + 10)
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeEventSource.instances = []
  globalThis.EventSource = FakeEventSource
  mgr._resetForTests()
})

afterEach(() => {
  mgr._resetForTests()
  vi.useRealTimers()
})

describe('subscriptions → union → buckets', () => {
  it('two subscribers share ONE connection carrying the deduped sorted union', () => {
    mgr.subscribe(['NVDA', 'AAPL'], () => {})
    mgr.subscribe(['AAPL', 'MSFT'], () => {})
    flushRebuild()
    const open = openInstances()
    expect(open).toHaveLength(1)
    expect(open[0].url).toBe('/api/stream/prices?tickers=AAPL,MSFT,NVDA')
  })

  it('unions above 50 tickers split into buckets of at most 50', () => {
    const many = Array.from({ length: 120 }, (_, i) => `T${String(i).padStart(3, '0')}`)
    mgr.subscribe(many, () => {})
    flushRebuild()
    const open = openInstances()
    expect(open).toHaveLength(3)
    for (const es of open) {
      const n = es.url.split('=')[1].split(',').length
      expect(n).toBeLessThanOrEqual(50)
    }
  })

  it('last unsubscribe closes every connection', () => {
    const un1 = mgr.subscribe(['AAPL'], () => {})
    const un2 = mgr.subscribe(['MSFT'], () => {})
    flushRebuild()
    expect(openInstances()).toHaveLength(1)
    un1(); un2()
    flushRebuild()
    expect(openInstances()).toHaveLength(0)
  })

  it('rapid subscribe/unsubscribe inside the debounce window causes ONE rebuild', () => {
    const un = mgr.subscribe(['AAPL'], () => {})
    un()
    mgr.subscribe(['AAPL', 'MSFT'], () => {})
    mgr.subscribe(['NVDA'], () => {})
    flushRebuild()
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0].url).toBe('/api/stream/prices?tickers=AAPL,MSFT,NVDA')
  })

  it('a bucket whose ticker list is unchanged across a rebuild keeps its EventSource', () => {
    mgr.subscribe(['AAPL', 'MSFT'], () => {})
    flushRebuild()
    const first = openInstances()[0]
    // Adding a subscriber with the SAME tickers → union unchanged → no reconnect
    mgr.subscribe(['AAPL'], () => {})
    flushRebuild()
    expect(openInstances()).toHaveLength(1)
    expect(openInstances()[0]).toBe(first)
  })

  it('empty ticker lists never open a connection', () => {
    mgr.subscribe([], () => {})
    flushRebuild()
    expect(openInstances()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `app/`): `npx vitest run src/lib/priceStreamManager.test.js`
Expected: FAIL — `Cannot find module './priceStreamManager'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

Create `app/src/lib/priceStreamManager.js`:

```js
// Shared SSE connection pool for /api/stream/prices.
//
// Every useRealtimePrices() instance used to open its OWN EventSource; the
// Dashboard mounts desktop+mobile layouts simultaneously, so one user held
// 4-8 concurrent server-side stream loops — the load class behind the
// 2026-07-01 524 outage. This manager owns ALL price-stream connections:
// subscribers register their tickers, the manager streams the deduped union
// over as few connections as the backend's 50-ticker/connection cap allows
// (usually one), and fans events out via a useSyncExternalStore snapshot.
//
// SSE subscriptions are fixed in the URL, so a changed union requires a
// reconnect — debounced so a page transition causes one rebuild, not five.
// streamPrices is never cleared on rebuild: last-known prices stay on screen
// and the 2s REST poll continues underneath, making reconnects invisible.
//
// Kill-switch: localStorage 'uct.ssePool.disabled' = '1' (read at module load
// in useRealtimePrices.js) reverts to the legacy one-connection-per-hook path.

import * as realtimeCandle from './realtimeCandle'
import {
  STREAM_WATCHDOG_MS, STREAM_WATCHDOG_TICK_MS, STREAM_RECONNECT_CAP_MS,
} from '../utils/streamStatus'

export const MAX_SSE_TICKERS = 50   // mirror of api/routers/stream.py MAX_SSE_TICKERS
export const REBUILD_DEBOUNCE_MS = 400
const INITIAL_RETRY_MS = 5000

let _nextId = 1
const _subscribers = new Map()  // id -> { tickers: string[], listener }
let _buckets = []               // [{ key, tickers, es, connected, retryDelay, reconnectTimer, lastMsg }]
let _streamPrices = {}
let _staleSymbols = new Set()
let _rebuildTimer = null
let _watchdogTimer = null
let _snapshot = { prices: {}, staleSymbols: new Set(), connected: false }

function _allConnected() {
  return _buckets.length > 0 && _buckets.every(b => b.connected)
}

function _publish() {
  _snapshot = { prices: _streamPrices, staleSymbols: _staleSymbols, connected: _allConnected() }
  for (const sub of _subscribers.values()) {
    try { sub.listener() } catch { /* one bad listener never breaks fanout */ }
  }
}

export function getSnapshot() {
  return _snapshot
}

export function subscribe(tickers, listener) {
  const id = _nextId++
  _subscribers.set(id, { tickers: [...new Set((tickers || []).filter(Boolean))], listener })
  _scheduleRebuild()
  return () => {
    _subscribers.delete(id)
    _scheduleRebuild()
  }
}

function _union() {
  const set = new Set()
  for (const sub of _subscribers.values()) {
    for (const t of sub.tickers) set.add(String(t).toUpperCase())
  }
  return [...set].sort()
}

function _scheduleRebuild() {
  if (_rebuildTimer) clearTimeout(_rebuildTimer)
  _rebuildTimer = setTimeout(_rebuild, REBUILD_DEBOUNCE_MS)
}

function _rebuild() {
  _rebuildTimer = null
  const union = _union()
  const chunks = []
  for (let i = 0; i < union.length; i += MAX_SSE_TICKERS) {
    chunks.push(union.slice(i, i + MAX_SSE_TICKERS))
  }

  const next = []
  for (let i = 0; i < chunks.length; i++) {
    const key = chunks[i].join(',')
    const existing = _buckets[i]
    if (existing && existing.key === key) {
      next.push(existing)  // unchanged bucket keeps its live connection
      continue
    }
    if (existing) _teardownBucket(existing)
    const bucket = {
      key, tickers: chunks[i], es: null, connected: false,
      retryDelay: INITIAL_RETRY_MS, reconnectTimer: null, lastMsg: Date.now(),
    }
    next.push(bucket)
    _connectBucket(bucket)
  }
  for (let i = chunks.length; i < _buckets.length; i++) _teardownBucket(_buckets[i])
  _buckets = next

  if (_buckets.length > 0 && !_watchdogTimer) {
    _watchdogTimer = setInterval(_watchdogSweep, STREAM_WATCHDOG_TICK_MS)
  } else if (_buckets.length === 0 && _watchdogTimer) {
    clearInterval(_watchdogTimer)
    _watchdogTimer = null
  }
  _publish()
}

function _teardownBucket(bucket) {
  if (bucket.reconnectTimer) { clearTimeout(bucket.reconnectTimer); bucket.reconnectTimer = null }
  if (bucket.es) { try { bucket.es.close() } catch { /* already closed */ } bucket.es = null }
  bucket.connected = false
}

function _connectBucket(bucket) {
  if (typeof EventSource === 'undefined') return  // SSR / non-browser safety
  const es = new EventSource(`/api/stream/prices?tickers=${bucket.key}`)
  bucket.es = es
  bucket.lastMsg = Date.now()

  const touch = () => { bucket.lastMsg = Date.now() }

  es.onopen = () => {
    if (bucket.es !== es) return
    bucket.connected = true
    bucket.retryDelay = INITIAL_RETRY_MS
    touch()
    _publish()
  }

  es.onmessage = (event) => {
    if (bucket.es !== es) return
    touch()
    try {
      const data = JSON.parse(event.data)
      _streamPrices = { ..._streamPrices, ...data }
      _publish()
    } catch { /* malformed frame — ignore */ }
  }

  es.addEventListener('heartbeat', touch)

  es.addEventListener('stale', (event) => {
    if (bucket.es !== es) return
    touch()
    try {
      const data = JSON.parse(event.data)
      if (!data?.sym) return
      const sym = String(data.sym).toUpperCase()
      if (_staleSymbols.has(sym)) return
      _staleSymbols = new Set(_staleSymbols)
      _staleSymbols.add(sym)
      _publish()
    } catch { /* ignore */ }
  })

  es.addEventListener('fresh', (event) => {
    if (bucket.es !== es) return
    touch()
    try {
      const data = JSON.parse(event.data)
      if (!data?.sym) return
      const sym = String(data.sym).toUpperCase()
      if (!_staleSymbols.has(sym)) return
      _staleSymbols = new Set(_staleSymbols)
      _staleSymbols.delete(sym)
      _publish()
    } catch { /* ignore */ }
  })

  es.addEventListener('tick', (event) => {
    if (bucket.es !== es) return
    touch()
    try {
      const data = JSON.parse(event.data)
      if (data?.sym) realtimeCandle.applyTick(data.sym, data.price, data.vol, data.ts)
    } catch { /* ignore */ }
  })

  es.addEventListener('bar_close', (event) => {
    if (bucket.es !== es) return
    touch()
    try {
      const data = JSON.parse(event.data)
      if (data?.sym && data?.bar) realtimeCandle.applyBarClose(data.sym, data.tf || '1', data.bar)
    } catch { /* ignore */ }
  })

  es.addEventListener('bar_correction', (event) => {
    if (bucket.es !== es) return
    touch()
    try {
      const data = JSON.parse(event.data)
      if (data?.sym && data?.bar) realtimeCandle.applyCorrection(data.sym, data.tf || '1', data.bar)
    } catch { /* ignore */ }
  })

  es.onerror = () => {
    if (bucket.es !== es) return  // a rebuild/watchdog already replaced this connection
    try { es.close() } catch { /* ignore */ }
    bucket.es = null
    bucket.connected = false
    const delay = bucket.retryDelay
    bucket.retryDelay = Math.min(delay * 2, STREAM_RECONNECT_CAP_MS)
    bucket.reconnectTimer = setTimeout(() => {
      bucket.reconnectTimer = null
      if (_buckets.includes(bucket)) _connectBucket(bucket)
    }, delay)
    _publish()
  }
}

function _watchdogSweep() {
  const now = Date.now()
  for (const bucket of _buckets) {
    if (bucket.es && now - bucket.lastMsg > STREAM_WATCHDOG_MS) {
      // Silent death: nothing (not even the 15s heartbeat) arrived — force reconnect.
      _teardownBucket(bucket)
      bucket.retryDelay = INITIAL_RETRY_MS
      _connectBucket(bucket)
      _publish()
    }
  }
}

// ── test hooks ──────────────────────────────────────────────────────────────

export function _resetForTests() {
  if (_rebuildTimer) { clearTimeout(_rebuildTimer); _rebuildTimer = null }
  if (_watchdogTimer) { clearInterval(_watchdogTimer); _watchdogTimer = null }
  for (const b of _buckets) _teardownBucket(b)
  _buckets = []
  _subscribers.clear()
  _streamPrices = {}
  _staleSymbols = new Set()
  _snapshot = { prices: {}, staleSymbols: new Set(), connected: false }
}

export function _getBuckets() {
  return _buckets
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `app/`): `npx vitest run src/lib/priceStreamManager.test.js`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/priceStreamManager.js app/src/lib/priceStreamManager.test.js
git commit -m "feat(stream): priceStreamManager — shared SSE pool with union bucketing + debounced rebuild"
```

---

### Task 2: priceStreamManager — event fanout, candle single-apply, backoff + watchdog

**Files:**
- Modify: `app/src/lib/priceStreamManager.js` (only if a test exposes a gap — the Task 1 implementation already contains this logic; this task PROVES it)
- Test: `app/src/lib/priceStreamManager.test.js` (append)

**Interfaces:**
- Consumes: everything from Task 1 (same file, same FakeEventSource harness).
- Produces: verified snapshot semantics for Task 3 — `getSnapshot().prices` (new object reference per change), `.staleSymbols` (new Set per change), `.connected` (true only when every bucket is open).

- [ ] **Step 1: Append the failing/verifying tests**

Append to `app/src/lib/priceStreamManager.test.js`:

```js
import * as realtimeCandle from './realtimeCandle'

describe('event fanout + snapshot', () => {
  it('price messages merge into the snapshot and notify listeners', () => {
    const listener = vi.fn()
    mgr.subscribe(['AAPL', 'MSFT'], listener)
    flushRebuild()
    const es = openInstances()[0]
    es.emitOpen()
    es.emitMessage({ AAPL: { price: 101.5, change_pct: 1.2 } })
    expect(listener).toHaveBeenCalled()
    expect(mgr.getSnapshot().prices.AAPL.price).toBe(101.5)
    es.emitMessage({ MSFT: { price: 402 } })
    // AAPL survives later messages (accumulator, not replacement)
    expect(mgr.getSnapshot().prices.AAPL.price).toBe(101.5)
    expect(mgr.getSnapshot().prices.MSFT.price).toBe(402)
  })

  it('snapshot reference only changes when data changes', () => {
    mgr.subscribe(['AAPL'], () => {})
    flushRebuild()
    const es = openInstances()[0]
    es.emitOpen()
    es.emitMessage({ AAPL: { price: 1 } })
    const snap1 = mgr.getSnapshot()
    expect(mgr.getSnapshot()).toBe(snap1)  // stable between publishes
    es.emitMessage({ AAPL: { price: 2 } })
    expect(mgr.getSnapshot()).not.toBe(snap1)
  })

  it('connected is true only when every bucket is open', () => {
    const many = Array.from({ length: 60 }, (_, i) => `T${String(i).padStart(2, '0')}`)
    mgr.subscribe(many, () => {})
    flushRebuild()
    const [es1, es2] = openInstances()
    es1.emitOpen()
    expect(mgr.getSnapshot().connected).toBe(false)
    es2.emitOpen()
    expect(mgr.getSnapshot().connected).toBe(true)
  })

  it('stale/fresh transitions maintain the global stale set', () => {
    mgr.subscribe(['AAPL'], () => {})
    flushRebuild()
    const es = openInstances()[0]
    es.emitOpen()
    es.emitEvent('stale', { sym: 'AAPL' })
    expect(mgr.getSnapshot().staleSymbols.has('AAPL')).toBe(true)
    es.emitEvent('fresh', { sym: 'AAPL' })
    expect(mgr.getSnapshot().staleSymbols.has('AAPL')).toBe(false)
  })

  it('candle events hit realtimeCandle exactly once each', () => {
    realtimeCandle.applyTick.mockClear()
    realtimeCandle.applyBarClose.mockClear()
    mgr.subscribe(['AAPL'], () => {})
    mgr.subscribe(['AAPL'], () => {})   // second consumer of the SAME ticker
    flushRebuild()
    const es = openInstances()[0]
    es.emitOpen()
    es.emitEvent('tick', { sym: 'AAPL', price: 100, vol: 5, ts: 1 })
    expect(realtimeCandle.applyTick).toHaveBeenCalledTimes(1)
    es.emitEvent('bar_close', { sym: 'AAPL', tf: '1', bar: { t: 0, c: 100, v: 5 } })
    expect(realtimeCandle.applyBarClose).toHaveBeenCalledTimes(1)
  })
})

describe('reconnect + watchdog', () => {
  it('onerror backs off 5s → 10s → 20s (capped) and reconnects the bucket', () => {
    mgr.subscribe(['AAPL'], () => {})
    flushRebuild()
    const es1 = openInstances()[0]
    es1.emitOpen()
    es1.emitError()
    expect(mgr.getSnapshot().connected).toBe(false)
    expect(openInstances()).toHaveLength(0)
    vi.advanceTimersByTime(5000 + 10)
    expect(openInstances()).toHaveLength(1)   // reconnected after 5s
    const es2 = openInstances()[0]
    es2.emitError()
    vi.advanceTimersByTime(5000 + 10)
    expect(openInstances()).toHaveLength(0)   // second retry waits 10s, not 5s
    vi.advanceTimersByTime(5000)
    expect(openInstances()).toHaveLength(1)
  })

  it('prices persist across a reconnect (never cleared)', () => {
    mgr.subscribe(['AAPL'], () => {})
    flushRebuild()
    const es = openInstances()[0]
    es.emitOpen()
    es.emitMessage({ AAPL: { price: 55 } })
    es.emitError()
    expect(mgr.getSnapshot().prices.AAPL.price).toBe(55)
  })

  it('watchdog force-reconnects a silently dead bucket', () => {
    mgr.subscribe(['AAPL'], () => {})
    flushRebuild()
    const es1 = openInstances()[0]
    es1.emitOpen()
    // No events (not even heartbeat) for > STREAM_WATCHDOG_MS (30s) → sweep kills it
    vi.advanceTimersByTime(45000)
    const open = openInstances()
    expect(open).toHaveLength(1)
    expect(open[0]).not.toBe(es1)
    expect(es1.closed).toBe(true)
  })

  it('heartbeats keep the watchdog satisfied', () => {
    mgr.subscribe(['AAPL'], () => {})
    flushRebuild()
    const es1 = openInstances()[0]
    es1.emitOpen()
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(10000)
      es1.emitEvent('heartbeat', {})
    }
    expect(openInstances()[0]).toBe(es1)  // never replaced
    expect(es1.closed).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests**

Run (from `app/`): `npx vitest run src/lib/priceStreamManager.test.js`
Expected: all pass (Task 1's implementation already carries this logic). If any test fails, fix the manager — the failing test defines the correct behavior.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/priceStreamManager.test.js app/src/lib/priceStreamManager.js
git commit -m "test(stream): prove fanout, single candle apply, backoff + watchdog on the SSE pool"
```

---

### Task 3: useRealtimePrices rewrite — pooled path + legacy kill-switch

**Files:**
- Modify: `app/src/hooks/useRealtimePrices.js` (full rewrite, legacy preserved inside)
- Test: `app/src/hooks/useRealtimePrices.test.jsx` (create)

**Interfaces:**
- Consumes: `subscribe`, `getSnapshot` from `../lib/priceStreamManager`.
- Produces: `useRealtimePrices(tickers)` default export — FROZEN public API `{ prices, isLoading, isStreaming, staleSymbols }`.

- [ ] **Step 1: Write the failing tests**

Create `app/src/hooks/useRealtimePrices.test.jsx`:

```jsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('./useLivePrices', () => ({
  default: vi.fn(() => ({ prices: {}, isLoading: false })),
}))
vi.mock('../lib/realtimeCandle', () => ({
  applyTick: vi.fn(),
  applyBarClose: vi.fn(),
  applyCorrection: vi.fn(),
}))

class FakeEventSource {
  static instances = []
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.listeners = {}
    this.onopen = null
    this.onmessage = null
    this.onerror = null
    this.closed = false
    FakeEventSource.instances.push(this)
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
  close() { this.readyState = 2; this.closed = true }
  emitOpen() { this.readyState = 1; this.onopen?.() }
  emitMessage(obj) { this.onmessage?.({ data: JSON.stringify(obj) }) }
}

function openInstances() {
  return FakeEventSource.instances.filter(es => !es.closed)
}

beforeEach(() => {
  vi.resetModules()
  FakeEventSource.instances = []
  globalThis.EventSource = FakeEventSource
  localStorage.removeItem('uct.ssePool.disabled')
})

afterEach(async () => {
  const mgr = await import('../lib/priceStreamManager')
  mgr._resetForTests()
  vi.useRealTimers()
})

describe('pooled useRealtimePrices', () => {
  it('two hook instances share one connection and each sees only its own tickers', async () => {
    vi.useFakeTimers()
    const { default: useRealtimePrices } = await import('./useRealtimePrices')
    const mgr = await import('../lib/priceStreamManager')

    const a = renderHook(() => useRealtimePrices(['AAPL']))
    const b = renderHook(() => useRealtimePrices(['MSFT']))
    act(() => { vi.advanceTimersByTime(mgr.REBUILD_DEBOUNCE_MS + 10) })

    expect(openInstances()).toHaveLength(1)
    const es = openInstances()[0]
    act(() => {
      es.emitOpen()
      es.emitMessage({ AAPL: { price: 111 }, MSFT: { price: 222 } })
    })

    expect(a.result.current.prices.AAPL.price).toBe(111)
    expect(a.result.current.prices.MSFT).toBeUndefined()   // per-ticker filter holds
    expect(b.result.current.prices.MSFT.price).toBe(222)
    expect(b.result.current.prices.AAPL).toBeUndefined()
    expect(a.result.current.isStreaming).toBe(true)

    a.unmount(); b.unmount()
    act(() => { vi.advanceTimersByTime(mgr.REBUILD_DEBOUNCE_MS + 10) })
    expect(openInstances()).toHaveLength(0)
  })

  it('staleSymbols is filtered to the hook’s own tickers', async () => {
    vi.useFakeTimers()
    const { default: useRealtimePrices } = await import('./useRealtimePrices')
    const mgr = await import('../lib/priceStreamManager')

    const a = renderHook(() => useRealtimePrices(['AAPL']))
    const b = renderHook(() => useRealtimePrices(['MSFT']))
    act(() => { vi.advanceTimersByTime(mgr.REBUILD_DEBOUNCE_MS + 10) })
    const es = openInstances()[0]
    act(() => {
      es.emitOpen()
      for (const fn of es.listeners['stale'] || []) {
        fn({ data: JSON.stringify({ sym: 'AAPL' }) })
      }
    })
    expect(a.result.current.staleSymbols.has('AAPL')).toBe(true)
    expect(b.result.current.staleSymbols.size).toBe(0)
    a.unmount(); b.unmount()
  })
})

describe('kill-switch', () => {
  it('uct.ssePool.disabled=1 selects the legacy per-instance path', async () => {
    localStorage.setItem('uct.ssePool.disabled', '1')
    const { default: useRealtimePrices } = await import('./useRealtimePrices')

    const a = renderHook(() => useRealtimePrices(['AAPL']))
    const b = renderHook(() => useRealtimePrices(['MSFT']))
    // Legacy path: one EventSource PER hook instance, immediately (no debounce)
    expect(FakeEventSource.instances).toHaveLength(2)
    const urls = FakeEventSource.instances.map(e => e.url).sort()
    expect(urls).toEqual([
      '/api/stream/prices?tickers=AAPL',
      '/api/stream/prices?tickers=MSFT',
    ])
    a.unmount(); b.unmount()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `app/`): `npx vitest run src/hooks/useRealtimePrices.test.jsx`
Expected: FAIL — the pooled tests fail (current hook opens one connection per instance: `openInstances()` has length 2, not 1). The kill-switch test also fails (flag not honored yet).

- [ ] **Step 3: Rewrite the hook**

Replace the entire contents of `app/src/hooks/useRealtimePrices.js` with:

```js
import { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } from 'react'
import useLivePrices from './useLivePrices'
import * as realtimeCandle from '../lib/realtimeCandle'
import * as priceStreamManager from '../lib/priceStreamManager'
import { STREAM_WATCHDOG_MS, STREAM_WATCHDOG_TICK_MS, STREAM_RECONNECT_CAP_MS } from '../utils/streamStatus'

/**
 * Real-time price streaming via Server-Sent Events.
 * Merges Finnhub WebSocket (tick-by-tick) with Massive REST (2s polling).
 *
 * Per-field merge: stream provides {price, change_pct, updated_at},
 * REST provides {day_open, day_high, day_low, prev_close, volume}.
 * Both combined give the chart everything it needs.
 *
 * POOLED (default): all hook instances share the priceStreamManager's
 * connection pool — one browser-wide EventSource union instead of one per
 * component (which piled 4-8 stream loops per user onto the single-process
 * backend). KILL-SWITCH: localStorage 'uct.ssePool.disabled' = '1' (then
 * refresh) reverts to the legacy per-instance implementation below.
 */

function usePooledRealtimePrices(tickers = []) {
  // Massive REST polling always runs (2s) — provides session OHLC + volume
  const { prices: polledPrices, isLoading } = useLivePrices(tickers)

  const sorted = [...new Set(tickers)].sort().join(',')

  const subscribeStore = useCallback(
    (onStoreChange) => priceStreamManager.subscribe(sorted ? sorted.split(',') : [], onStoreChange),
    [sorted],
  )
  const snap = useSyncExternalStore(subscribeStore, priceStreamManager.getSnapshot, priceStreamManager.getSnapshot)

  // Per-field merge: REST fields are preserved, stream fields overlay.
  // CRITICAL: only merge for tickers in the CURRENT subscription set — the
  // manager's price store is a browser-wide accumulator; without this filter,
  // consumers would see prices for unrelated tickers from other components.
  const tickerSet = useMemo(() => new Set(tickers.filter(Boolean)), [sorted]) // eslint-disable-line react-hooks/exhaustive-deps
  const mergedPrices = useMemo(() => {
    const result = {}
    for (const sym of tickerSet) {
      const merged = { ...polledPrices[sym], ...snap.prices[sym] }
      if (merged.price != null || merged.day_open != null) result[sym] = merged
    }
    return result
  }, [polledPrices, snap.prices, tickerSet])

  const staleSymbols = useMemo(() => {
    const filtered = new Set()
    for (const sym of tickerSet) {
      if (snap.staleSymbols.has(sym)) filtered.add(sym)
    }
    return filtered
  }, [snap.staleSymbols, tickerSet])

  return {
    prices: mergedPrices,
    isLoading: !snap.connected && isLoading,
    isStreaming: snap.connected,
    staleSymbols,
  }
}

// ── Legacy per-instance implementation (kill-switch fallback) ────────────────
// This is the pre-pooling implementation, byte-for-byte behavior. Remove only
// after the pool has weeks of green prod.

function useLegacyRealtimePrices(tickers = []) {
  const [streamPrices, setStreamPrices] = useState({})
  const [connected, setConnected] = useState(false)
  const [staleSymbols, setStaleSymbols] = useState(() => new Set())
  const esRef = useRef(null)
  const reconnectRef = useRef(null)
  const retryDelayRef = useRef(5000)  // exponential backoff: 5→10→20s (capped)
  const lastMsgRef = useRef(Date.now())   // epoch ms of the last inbound event (any type, incl. heartbeat)
  const watchdogRef = useRef(null)         // setInterval id for the silent-death watchdog

  // Massive REST polling always runs (2s) — provides session OHLC + volume
  const { prices: polledPrices, isLoading } = useLivePrices(tickers)

  const sorted = [...new Set(tickers)].sort().join(',')

  const connect = useCallback(() => {
    if (!sorted || esRef.current) return

    const es = new EventSource(`/api/stream/prices?tickers=${sorted}`)
    esRef.current = es
    lastMsgRef.current = Date.now()

    es.onopen = () => {
      setConnected(true)
      lastMsgRef.current = Date.now()
      retryDelayRef.current = 5000  // reset backoff on successful connection
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current)
        reconnectRef.current = null
      }
    }

    es.onmessage = (event) => {
      lastMsgRef.current = Date.now()
      try {
        const data = JSON.parse(event.data)
        setStreamPrices(prev => ({ ...prev, ...data }))
      } catch {}
    }

    // Heartbeat (named event, 15s): keeps the connection alive AND lets the
    // watchdog distinguish a quiet-but-healthy stream from a dead one.
    es.addEventListener('heartbeat', () => { lastMsgRef.current = Date.now() })

    es.addEventListener('stale', (event) => {
      lastMsgRef.current = Date.now()
      try {
        const data = JSON.parse(event.data)
        if (!data?.sym) return
        const sym = String(data.sym).toUpperCase()
        setStaleSymbols(prev => {
          if (prev.has(sym)) return prev
          const next = new Set(prev)
          next.add(sym)
          return next
        })
      } catch {}
    })

    es.addEventListener('fresh', (event) => {
      lastMsgRef.current = Date.now()
      try {
        const data = JSON.parse(event.data)
        if (!data?.sym) return
        const sym = String(data.sym).toUpperCase()
        setStaleSymbols(prev => {
          if (!prev.has(sym)) return prev
          const next = new Set(prev)
          next.delete(sym)
          return next
        })
      } catch {}
    })

    es.addEventListener('tick', (event) => {
      lastMsgRef.current = Date.now()
      try {
        const data = JSON.parse(event.data)
        if (data?.sym) realtimeCandle.applyTick(data.sym, data.price, data.vol, data.ts)
      } catch {}
    })

    es.addEventListener('bar_close', (event) => {
      lastMsgRef.current = Date.now()
      try {
        const data = JSON.parse(event.data)
        if (data?.sym && data?.bar) realtimeCandle.applyBarClose(data.sym, data.tf || "1", data.bar)
      } catch {}
    })

    es.addEventListener('bar_correction', (event) => {
      lastMsgRef.current = Date.now()
      try {
        const data = JSON.parse(event.data)
        if (data?.sym && data?.bar) realtimeCandle.applyCorrection(data.sym, data.tf || "1", data.bar)
      } catch {}
    })

    es.onerror = () => {
      setConnected(false)
      // Don't clear streamPrices — show last known prices rather than blanking
      // the UI on a transient network hiccup or brief server restart.
      es.close()
      if (esRef.current === es) esRef.current = null  // identity guard: don't clobber a newer es a watchdog reconnect may have opened
      if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null }
      const delay = retryDelayRef.current
      retryDelayRef.current = Math.min(delay * 2, STREAM_RECONNECT_CAP_MS)  // cap at 20s
      reconnectRef.current = setTimeout(() => connect(), delay)
    }

    // Silent-death watchdog: EventSource.onerror is unreliable at detecting a
    // connection dropped behind a proxy. If nothing (not even the 15s heartbeat)
    // arrives for STREAM_WATCHDOG_MS, force a reconnect instead of waiting.
    if (watchdogRef.current) clearInterval(watchdogRef.current)
    watchdogRef.current = setInterval(() => {
      if (esRef.current === es && Date.now() - lastMsgRef.current > STREAM_WATCHDOG_MS) {
        clearInterval(watchdogRef.current)
        watchdogRef.current = null
        setConnected(false)
        try { es.close() } catch {}
        if (esRef.current === es) esRef.current = null
        retryDelayRef.current = 5000  // prompt recovery after a silent stall
        connect()
      }
    }, STREAM_WATCHDOG_TICK_MS)
  }, [sorted])

  useEffect(() => {
    if (sorted) connect()
    return () => {
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current)
      }
      if (watchdogRef.current) {
        clearInterval(watchdogRef.current)
        watchdogRef.current = null
      }
      setConnected(false)
    }
  }, [sorted, connect])

  // Per-field merge: REST fields (day_open, day_high, day_low, volume, prev_close)
  // are preserved, stream fields (price, change_pct, updated_at, timestamp) overlay.
  const tickerSet = useMemo(() => new Set(tickers.filter(Boolean)), [sorted]) // eslint-disable-line react-hooks/exhaustive-deps
  const mergedPrices = useMemo(() => {
    const result = {}
    for (const sym of tickerSet) {
      const merged = { ...polledPrices[sym], ...streamPrices[sym] }
      if (merged.price != null || merged.day_open != null) result[sym] = merged
    }
    return result
  }, [polledPrices, streamPrices, tickerSet])

  return { prices: mergedPrices, isLoading: !connected && isLoading, isStreaming: connected, staleSymbols }
}

// Kill-switch decided at MODULE LOAD (never per-render — that would violate
// the rules of hooks). Flipping the flag requires a page refresh.
const POOL_DISABLED = (() => {
  try { return localStorage.getItem('uct.ssePool.disabled') === '1' } catch { return false }
})()

export default POOL_DISABLED ? useLegacyRealtimePrices : usePooledRealtimePrices
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `app/`): `npx vitest run src/hooks/useRealtimePrices.test.jsx src/lib/priceStreamManager.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useRealtimePrices.js app/src/hooks/useRealtimePrices.test.jsx
git commit -m "feat(stream): useRealtimePrices rides the shared SSE pool (legacy path behind uct.ssePool.disabled)"
```

---

### Task 4: Full-suite regression, production build, docs

**Files:**
- Modify: `CLAUDE.md` (Performance & Scale section — one new bullet)

**Interfaces:**
- Consumes: everything above.
- Produces: green suite + build; documented kill-switch.

- [ ] **Step 1: Run the ENTIRE frontend test suite**

Run (from `app/`): `npx vitest run`
Expected: all tests pass (500+). Pay attention to any test that renders components using `useRealtimePrices` (StockChart, Screener, tiles) — they must pass unchanged. If one fails, the pooled hook broke a consumer semantics — fix the hook/manager, not the consumer test.

- [ ] **Step 2: Production build**

Run (from `app/`): `npm run build`
Expected: build succeeds, no new warnings about the changed files.

- [ ] **Step 3: Document the kill-switch in CLAUDE.md**

In `CLAUDE.md`, in the `## Performance & Scale — 2026-07-01 launch-hardening (do NOT regress)` section, add this bullet after the "Frontend:" bullet:

```markdown
- **SSE connection pooling (2026-07-02):** all `useRealtimePrices` instances share
  ONE browser-wide EventSource pool (`app/src/lib/priceStreamManager.js` — ticker
  union, ≤50/bucket mirroring `stream.py MAX_SSE_TICKERS`, 400ms debounced
  reconnect on union change, per-bucket backoff+watchdog, candle events applied
  once). Was 4-8 connections/user (dashboard mounts desktop+mobile layouts
  simultaneously) = 4-8 server stream loops each. KILL-SWITCH: in DevTools run
  `localStorage.setItem('uct.ssePool.disabled','1')` + refresh → legacy
  per-instance connections (kept verbatim in `useRealtimePrices.js`). Remove the
  legacy path only after weeks of green prod.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: SSE pool kill-switch + architecture note in CLAUDE.md perf section"
```

---

## Post-plan verification (controller, not a plan task)

After merge + deploy: in the production app with DevTools open (Network tab, filter `stream`), confirm Dashboard shows 1 `/api/stream/prices` connection (was 4-8); walk Dashboard → Watchlists → Charts workspace → Screener → UCT20 → Calendar feed → TickerPopup and confirm live prices tick on each; set the kill-switch flag + refresh and confirm multiple connections return; unset + refresh.
