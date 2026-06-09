# Live Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect a silently-dropped live SSE within ~30s and reconnect within ~20s, and show an honest LIVE / STALE / RECONNECTING feed indicator — without touching the resilient 2s REST price floor.

**Architecture:** A pure `streamStatus` helper (status + tuning constants), a client watchdog + faster reconnect cap in `useRealtimePrices` (enabled by making the server heartbeat a client-visible named event), and a status badge in StockChart. The 2s REST poll and the bars/IDB/correctness paths are untouched.

**Tech Stack:** React + Vite, SSE (`EventSource`), FastAPI SSE generator. Tests: vitest 4 (run from `app/`).

---

## File Structure

- **Create** `app/src/utils/streamStatus.js` — pure `streamStatus({isStreaming,isStale})` + the `STREAM_WATCHDOG_MS` / `STREAM_WATCHDOG_TICK_MS` / `STREAM_RECONNECT_CAP_MS` constants. One responsibility: derive feed status + hold tuning.
- **Create** `app/src/utils/streamStatus.test.js` — unit tests.
- **Modify** `api/routers/stream.py` — heartbeat comment → named event (1 line).
- **Modify** `app/src/hooks/useRealtimePrices.js` — watchdog, heartbeat listener, lastMsg tracking, cap.
- **Modify** `app/src/hooks/useRealtimeBars.js` — reconnect cap only (no watchdog; bars stream has no heartbeat).
- **Modify** `app/src/components/StockChart.jsx` + `StockChart.module.css` — status badge + `.liveIndicator` style.

**Build order:** Task 1 (helper) → Task 2 (server heartbeat) → Task 3 (hooks) → Task 4 (badge). Task 1 is pure/TDD. Tasks 2–4 are wiring verified by build + manual check (SSE/EventSource isn't jsdom-renderable).

---

## Task 1: streamStatus helper (pure + TDD)

**Files:**
- Create: `app/src/utils/streamStatus.js`
- Test: `app/src/utils/streamStatus.test.js`

- [ ] **Step 1: Write the failing test**

```js
// app/src/utils/streamStatus.test.js
import { describe, it, expect } from 'vitest'
import {
  streamStatus,
  STREAM_WATCHDOG_MS, STREAM_WATCHDOG_TICK_MS, STREAM_RECONNECT_CAP_MS,
} from './streamStatus'

describe('streamStatus', () => {
  it('live when streaming and not stale', () => {
    expect(streamStatus({ isStreaming: true, isStale: false }))
      .toEqual({ state: 'live', label: 'LIVE', tone: 'live' })
  })

  it('stale when streaming but server reports the symbol paused', () => {
    expect(streamStatus({ isStreaming: true, isStale: true }).state).toBe('stale')
  })

  it('reconnecting when not streaming', () => {
    expect(streamStatus({ isStreaming: false, isStale: false }).state).toBe('reconnecting')
  })

  it('reconnecting outranks stale (dead connection wins)', () => {
    expect(streamStatus({ isStreaming: false, isStale: true }).state).toBe('reconnecting')
  })

  it('exposes tuning constants', () => {
    expect(STREAM_WATCHDOG_MS).toBe(30000)
    expect(STREAM_WATCHDOG_TICK_MS).toBe(10000)
    expect(STREAM_RECONNECT_CAP_MS).toBe(20000)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run src/utils/streamStatus.test.js`
Expected: FAIL — cannot resolve `./streamStatus`.

- [ ] **Step 3: Write the implementation**

```js
// app/src/utils/streamStatus.js
// Pure derivation of the chart's live-feed status from the realtime-prices hook
// signals, plus the shared stream tuning constants. No React, no side effects.

// No inbound event (incl. the 15s heartbeat) for this long ⇒ treat the SSE as
// silently dead and force a reconnect (EventSource.onerror is unreliable behind
// a proxy).
export const STREAM_WATCHDOG_MS = 30000
// How often the watchdog checks.
export const STREAM_WATCHDOG_TICK_MS = 10000
// Max reconnect backoff (was 120000) — recover within ~20s on a trading chart.
export const STREAM_RECONNECT_CAP_MS = 20000

// Precedence: a dead connection outranks a server-stale symbol.
export function streamStatus({ isStreaming, isStale }) {
  if (!isStreaming) return { state: 'reconnecting', label: 'RECONNECTING', tone: 'warn' }
  if (isStale) return { state: 'stale', label: 'STALE', tone: 'warn' }
  return { state: 'live', label: 'LIVE', tone: 'live' }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run src/utils/streamStatus.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/utils/streamStatus.js app/src/utils/streamStatus.test.js
git commit -m "feat(charts): streamStatus helper + stream tuning constants (B6)"
```

---

## Task 2: Server — client-visible heartbeat

**Files:**
- Modify: `api/routers/stream.py` (the heartbeat line, ~178)

> No automated test (the SSE generator is an async streaming loop). Verified by an import check + the Task 4 manual badge test. The change is additive: a named `heartbeat` event keeps the connection alive exactly like the old comment, but is now visible to the client's listener.

- [ ] **Step 1: Make the heartbeat a named event**

In `api/routers/stream.py`, find (~line 176-179):

```python
                # Heartbeat to keep connection alive through proxies
                if time.time() - last_heartbeat > heartbeat_interval:
                    yield f": heartbeat\n\n"
                    last_heartbeat = time.time()
```

Replace the `yield` line so it reads:

```python
                # Heartbeat to keep connection alive through proxies. Sent as a
                # NAMED event (not an SSE comment) so the client's watchdog can
                # reset on it and tell a quiet-but-healthy stream from a dead one.
                if time.time() - last_heartbeat > heartbeat_interval:
                    yield "event: heartbeat\ndata: {}\n\n"
                    last_heartbeat = time.time()
```

- [ ] **Step 2: Confirm it imports (no syntax error)**

Run: `cd /c/Users/Patrick/uct-dashboard && python -c "import api.routers.stream; print('stream OK')"`
Expected: prints `stream OK` (no traceback).

- [ ] **Step 3: Commit**

```bash
git add api/routers/stream.py
git commit -m "feat(charts): emit SSE heartbeat as a named event for client watchdog (B6)"
```

---

## Task 3: Client watchdog + faster reconnect

**Files:**
- Modify: `app/src/hooks/useRealtimePrices.js` (imports, refs, `connect`, cleanup)
- Modify: `app/src/hooks/useRealtimeBars.js` (reconnect cap only)

> No automated test (EventSource isn't jsdom-renderable). Verified by build + Task 4's manual check. Edits are whole-block replacements to minimize error.

- [ ] **Step 1: Add the import to `useRealtimePrices.js`**

Find (line ~3):

```js
import * as realtimeCandle from '../lib/realtimeCandle'
```

Add directly below it:

```js
import { STREAM_WATCHDOG_MS, STREAM_WATCHDOG_TICK_MS, STREAM_RECONNECT_CAP_MS } from '../utils/streamStatus'
```

- [ ] **Step 2: Add the watchdog refs**

Find (line ~19):

```js
  const retryDelayRef = useRef(5000)  // exponential backoff: 5→10→20→40→80→120s
```

Replace with:

```js
  const retryDelayRef = useRef(5000)  // exponential backoff: 5→10→20s (capped)
  const lastMsgRef = useRef(Date.now())   // epoch ms of the last inbound event (any type, incl. heartbeat)
  const watchdogRef = useRef(null)         // setInterval id for the silent-death watchdog
```

- [ ] **Step 3: Replace the whole `connect` callback**

Find the entire `const connect = useCallback(() => { … }, [sorted])` block (lines ~26-112) and replace it with:

```js
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
      esRef.current = null
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
```

- [ ] **Step 4: Clear the watchdog in the effect cleanup**

Find the lifecycle effect (lines ~114-126):

```js
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
      setConnected(false)
    }
  }, [sorted, connect])
```

Replace with (adds the watchdog teardown):

```js
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
```

- [ ] **Step 5: Lower the reconnect cap in `useRealtimeBars.js`**

In `app/src/hooks/useRealtimeBars.js`, add the import below the existing top imports (after line 1 `import { useEffect, useRef, useState, useCallback } from 'react'`):

```js
import { STREAM_RECONNECT_CAP_MS } from '../utils/streamStatus'
```

Then find (line ~63):

```js
      retryDelayRef.current = Math.min(delay * 2, 120000)
```

Replace with:

```js
      retryDelayRef.current = Math.min(delay * 2, STREAM_RECONNECT_CAP_MS)  // cap at 20s (was 120s)
```

(No watchdog here — the `/api/stream/bars` stream sends no heartbeat, so a silence-watchdog would falsely trip during quiet periods. This hook is also off by default via `VITE_REALTIME_BARS`.)

- [ ] **Step 6: Build to confirm both hooks compile**

Run: `cd app && npm run build`
Expected: succeeds (a pre-existing `LiveFlow.jsx` duplicate-key warning is fine; only fix errors referencing the files you changed).

- [ ] **Step 7: Commit**

```bash
git add app/src/hooks/useRealtimePrices.js app/src/hooks/useRealtimeBars.js
git commit -m "feat(charts): silent-death watchdog + 20s reconnect cap on the prices SSE (B6)"
```

---

## Task 4: Live indicator badge in StockChart

**Files:**
- Modify: `app/src/components/StockChart.jsx` (import ~line 33; hook destructure ~1701; `isStale` line ~1702; the `isStale` render block ~4963)
- Modify: `app/src/components/StockChart.module.css` (add `.liveIndicator`)

> No automated test (StockChart mounts a canvas charting lib; EventSource not jsdom-renderable). Verified by build + the manual check in Step 6.

- [ ] **Step 1: Import the helper**

Find (line ~32):

```js
import styles from './StockChart.module.css'
```

Add directly below it:

```js
import { streamStatus } from '../utils/streamStatus'
```

- [ ] **Step 2: Expose `isStreaming` from the hook + derive feed status**

Find (line ~1701-1702):

```js
  const { prices: livePrices, staleSymbols } = useRealtimePrices(liveUpdates && sym ? [sym] : [])
  const isStale = !!(sym && staleSymbols && staleSymbols.has(String(sym).toUpperCase()))
```

Replace with:

```js
  const { prices: livePrices, staleSymbols, isStreaming } = useRealtimePrices(liveUpdates && sym ? [sym] : [])
  const isStale = !!(sym && staleSymbols && staleSymbols.has(String(sym).toUpperCase()))
  const feed = streamStatus({ isStreaming, isStale })
```

- [ ] **Step 3: Replace the stale-only block with the feed badge**

Find (line ~4963-4967):

```jsx
      {isStale && (
        <div className={styles.staleIndicator} title="Live feed has paused — last tick is older than expected">
          ⏸ STALE
        </div>
      )}
```

Replace with:

```jsx
      {liveUpdates && realtimeTfEligible && (
        <div
          className={feed.state === 'live' ? styles.liveIndicator : styles.staleIndicator}
          title={
            feed.state === 'reconnecting' ? 'Reconnecting to the live feed…'
            : feed.state === 'stale' ? 'Live feed has paused — last tick is older than expected'
            : 'Live feed connected'
          }
        >
          {feed.state === 'live' ? '● LIVE' : feed.state === 'reconnecting' ? '⟳ RECONNECTING' : '⏸ STALE'}
        </div>
      )}
```

(`realtimeTfEligible` and `liveUpdates` are already in scope — `realtimeTfEligible` is defined ~line 2357, `liveUpdates` is a prop.)

- [ ] **Step 4: Add the `.liveIndicator` CSS**

In `app/src/components/StockChart.module.css`, find the `.staleIndicator` rule (it starts ~line 228). Immediately AFTER its closing `}`, add:

```css
.liveIndicator {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 100;
  background: rgba(22, 163, 74, 0.9);
  color: #fff;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 4px;
  letter-spacing: 1px;
  animation: liveIndicatorPulse 2s ease-in-out infinite;
}
@keyframes liveIndicatorPulse {
  0%, 100% { opacity: 0.8; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .liveIndicator { animation: none; }
}
```

- [ ] **Step 5: Build**

Run: `cd app && npm run build`
Expected: succeeds.

- [ ] **Step 6: Manual verification in the running app**

```bash
cd app && npm run build
cd .. && python -m uvicorn api.main:app --port 8077
```

Open `http://localhost:8077` → `/charts`, intraday TF (e.g. 5m), during or near market hours:
1. A subtle **● LIVE** badge (green, top-right) shows when the stream is connected.
2. In DevTools → Network, block `/api/stream/prices` (or toggle Offline). Within ~30s the badge flips to **⟳ RECONNECTING**, and prices still update (~2s) via the REST floor.
3. Unblock → within ~20s the badge returns to **● LIVE**.
4. On a Daily chart (or a non-`liveUpdates` surface like a Model Book chart), NO badge shows.

- [ ] **Step 7: Commit**

```bash
git add app/src/components/StockChart.jsx app/src/components/StockChart.module.css
git commit -m "feat(charts): LIVE / STALE / RECONNECTING feed indicator (B6)"
```

---

## Final verification

- [ ] **Full frontend suite**

Run: `cd app && npx vitest run`
Expected: PASS — all green incl. the new `streamStatus.test.js`.

- [ ] **Push**

```bash
git pull --rebase --autostash origin master
git push origin master
```

---

## Spec coverage check

- **Client-visible heartbeat** → Task 2.
- **`streamStatus` pure helper + constants** → Task 1.
- **Watchdog (no event in ~30s → reconnect), prices-only** → Task 3 Steps 2-4.
- **Heartbeat listener resets watchdog; every event resets `lastMsgRef`** → Task 3 Step 3.
- **Reconnect cap 120s→20s (both hooks)** → Task 3 Step 3 (prices) + Step 5 (bars).
- **No watchdog in bars (no heartbeat there)** → Task 3 Step 5 note.
- **LIVE / STALE / RECONNECTING badge, intraday + liveUpdates only** → Task 4 Steps 2-4.
- **2s REST floor untouched; no bars/IDB/correctness changes** → no task touches those paths.
- **Testing: streamStatus unit-tested; wiring manual** → Task 1 tests; Tasks 2-4 manual/build.

## Tunables (defaults chosen)
`STREAM_WATCHDOG_MS=30000`, `STREAM_WATCHDOG_TICK_MS=10000`, `STREAM_RECONNECT_CAP_MS=20000`, heartbeat 15s (stream.py, unchanged).
