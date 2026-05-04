# Phase 0: Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three high-leverage, low-risk fixes that eliminate the most user-visible failure modes today: blank-screen crashes (ErrorBoundary), CSV-cascade 502s (cache headers), and chart-render jank (rolling-window SMA). Each is independent and reversible.

**Architecture:** Three independent changes. (1) A React `<ErrorBoundary>` component wrapped around the `<Suspense>` in App.jsx, keyed by route so it resets on navigation. (2) `Cache-Control: public, max-age=300, stale-while-revalidate=86400` headers on five CSV/flow endpoints so Cloudflare caches them. (3) Refactor `computeSMA` from O(n × period) nested loop to O(n) rolling window — algorithmically identical output, dramatically fewer operations on long lookback periods.

**Tech Stack:** React 19, Vite 7, FastAPI, Vitest, Cloudflare CDN, Railway deploy.

**Spec reference:** `docs/superpowers/specs/2026-05-03-perf-overhaul-strategic-overview.md` Phase 0.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `app/package.json` | Modify | Add `test` script for Vitest |
| `app/src/components/StockChart.jsx` | Modify lines 35-43 | Replace SMA implementation with rolling-window O(n) |
| `app/src/components/__tests__/computeSMA.test.js` | Create | Parity + perf test for new SMA |
| `api/main.py` | Modify lines 670-689 | Add cache headers to 3 legacy CSV endpoints via shared helper |
| `api/flow_router.py` | Modify lines 66-117 | Add cache headers to 2 flow_router CSV endpoints |
| `app/src/components/AppErrorFallback.jsx` | Create | Full-page fallback UI for app-level error boundary |
| `app/src/components/RouteErrorBoundary.jsx` | Create | Wrapper that keys ErrorBoundary by route so it resets on nav |
| `app/src/App.jsx` | Modify lines 62-76 | Wrap routed `<Suspense>` with `<RouteErrorBoundary>` |

8 file touches across 3 independent change groups. Each group can ship independently.

---

## Task 1: Add Vitest test script to app/package.json

**Files:**
- Modify: `app/package.json`

This is a prerequisite — the existing tests aren't runnable via `npm test` because there's no script. We need this before Task 2 can be validated locally.

- [ ] **Step 1: Read current package.json scripts**

```bash
cat app/package.json
```

Expected: `scripts` object contains `dev`, `build`, `lint`, `preview` — no `test`.

- [ ] **Step 2: Add the test scripts**

In `app/package.json`, replace the existing `"scripts"` block with:

```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 3: Verify the test runner works on existing tests**

```bash
cd app && npm test
```

Expected: Vitest runs the existing `*.test.{js,jsx}` files. Some may fail (pre-existing) — that's fine. The runner itself must execute successfully (exit code from vitest, not from missing-script).

Note any pre-existing failures so we don't get blamed for them later.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/Patrick/uct-dashboard
git add app/package.json
git commit -m "Add Vitest test script to enable local + CI test runs"
```

---

## Task 2: Replace `computeSMA` with O(n) rolling-window algorithm

**Files:**
- Test: `app/src/components/__tests__/computeSMA.test.js`
- Modify: `app/src/components/StockChart.jsx` lines 35-43

The existing implementation is `O(n × period)` — for SMA200 on 8000 daily bars that's 1.6M operations per chart render. Rolling window is mathematically identical but `O(n)` — 8000 ops.

- [ ] **Step 1: Create test directory if missing**

```bash
mkdir -p app/src/components/__tests__
```

- [ ] **Step 2: Write the parity test FIRST (will reference exported function)**

Create `app/src/components/__tests__/computeSMA.test.js`:

```javascript
import { describe, test, expect } from 'vitest'
import { computeSMA } from '../StockChart'

// Reference (slow) implementation — what we're replacing.
// Kept here so the test is self-contained and proves output equivalence.
function referenceSMA(bars, period) {
  const result = []
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += bars[j].c
    result.push({ time: bars[i].t, value: +(sum / period).toFixed(2) })
  }
  return result
}

function makeBars(n, seed = 1) {
  // Deterministic bars with varied closes — covers edge cases (rising,
  // falling, sideways, volatile) in one fixture.
  const bars = []
  for (let i = 0; i < n; i++) {
    const wave = Math.sin(i * 0.1) * 5
    const drift = i * 0.01
    const noise = ((i * seed) % 7) * 0.3
    bars.push({ t: 1700000000 + i * 86400, c: 100 + wave + drift + noise })
  }
  return bars
}

describe('computeSMA', () => {
  test('output matches reference implementation for SMA50 on 1000 bars', () => {
    const bars = makeBars(1000)
    const ours = computeSMA(bars, 50)
    const ref  = referenceSMA(bars, 50)
    expect(ours).toEqual(ref)
  })

  test('output matches reference implementation for SMA200 on 8000 bars', () => {
    const bars = makeBars(8000, 3)
    const ours = computeSMA(bars, 200)
    const ref  = referenceSMA(bars, 200)
    expect(ours).toEqual(ref)
  })

  test('returns empty array when bars.length < period', () => {
    const bars = makeBars(20)
    expect(computeSMA(bars, 50)).toEqual([])
  })

  test('returns single bar when bars.length === period', () => {
    const bars = makeBars(50)
    const result = computeSMA(bars, 50)
    expect(result).toHaveLength(1)
    expect(result[0].time).toBe(bars[49].t)
  })

  test('handles period=1 (degenerate case = same as close)', () => {
    const bars = makeBars(10)
    const result = computeSMA(bars, 1)
    expect(result).toHaveLength(10)
    expect(result[0].value).toBe(+bars[0].c.toFixed(2))
    expect(result[9].value).toBe(+bars[9].c.toFixed(2))
  })

  test('completes SMA200 on 8000 bars in under 50ms', () => {
    const bars = makeBars(8000)
    const t0 = performance.now()
    computeSMA(bars, 200)
    const elapsed = performance.now() - t0
    // Old algo on 8000 bars × 200 period ≈ 1.6M ops ≈ 30-80ms typical.
    // New algo ≈ 8K ops ≈ <2ms typical. 50ms threshold leaves headroom for slow CI.
    expect(elapsed).toBeLessThan(50)
  })
})
```

- [ ] **Step 3: Export `computeSMA` from StockChart.jsx (it's currently file-local)**

In `app/src/components/StockChart.jsx`, find line 35:

```javascript
function computeSMA(bars, period) {
```

Change to:

```javascript
export function computeSMA(bars, period) {
```

- [ ] **Step 4: Run the test — it must FAIL on the perf assertion (everything else passes)**

```bash
cd app && npm test -- computeSMA
```

Expected: 5 tests pass (parity tests prove existing algo is correct), 1 perf test FAILS (>50ms because the existing algo is O(n × period)).

If parity tests fail: stop — the reference implementation in the test file doesn't match what's in StockChart.jsx. Recheck and re-sync.

- [ ] **Step 5: Replace the implementation with rolling-window O(n)**

In `app/src/components/StockChart.jsx`, replace lines 35-43:

```javascript
export function computeSMA(bars, period) {
  const result = []
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += bars[j].c
    result.push({ time: bars[i].t, value: +(sum / period).toFixed(2) })
  }
  return result
}
```

with:

```javascript
// Rolling-window O(n) SMA. Mathematically identical to the naive
// O(n*period) version but adds the entering bar and subtracts the
// leaving bar instead of re-summing the window each step.
export function computeSMA(bars, period) {
  if (bars.length < period) return []
  const result = []
  let sum = 0
  for (let i = 0; i < period; i++) sum += bars[i].c
  result.push({ time: bars[period - 1].t, value: +(sum / period).toFixed(2) })
  for (let i = period; i < bars.length; i++) {
    sum += bars[i].c - bars[i - period].c
    result.push({ time: bars[i].t, value: +(sum / period).toFixed(2) })
  }
  return result
}
```

- [ ] **Step 6: Run the test — all 6 must pass now**

```bash
cd app && npm test -- computeSMA
```

Expected: All 6 tests pass. Critically, the parity tests still pass (output is byte-equal to old) AND the perf test now passes (<50ms).

If the parity test fails after the change: there's a math bug in the new implementation. Check edge cases — `bars.length === period`, `period === 1`, etc.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Patrick/uct-dashboard
git add app/src/components/StockChart.jsx app/src/components/__tests__/computeSMA.test.js
git commit -m "Optimize computeSMA from O(n*period) to O(n) rolling-window

Same output, dramatically faster. Was the dominant cost in chart render
for SMA200 overlay on 8000 daily bars (~1.6M ops). Rolling window adds
the entering bar and subtracts the leaving bar instead of re-summing
the window each step (~8K ops total). Confirmed via parity test against
the reference implementation."
```

---

## Task 3: Cache-Control headers on the 3 legacy CSV endpoints in main.py

**Files:**
- Modify: `api/main.py` lines 670-689

These endpoints currently return `FileResponse(...)` with no cache headers. Add a small helper that wraps the FileResponse with the same `Cache-Control` policy.

- [ ] **Step 1: Add a helper function above the CSV endpoints**

In `api/main.py`, find line 670 (the `@app.get("/flow-data.csv")` line). Insert this BEFORE it:

```python
# Cacheable static-on-deploy CSV files. 5-min max-age bounds staleness if
# someone hot-swaps the file; SWR makes the next mount-after-expiry instant
# while Cloudflare refreshes asynchronously.
_CSV_CACHE_HEADERS = {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    "Vary": "Accept-Encoding",
}

def _csv_response(csv_path: str, filename: str):
    if os.path.exists(csv_path):
        return FileResponse(csv_path, media_type="text/csv", headers=_CSV_CACHE_HEADERS)
    return JSONResponse(status_code=404, content={"error": f"{filename} not found"})
```

- [ ] **Step 2: Replace the 3 endpoint bodies to use the helper**

Replace lines 670-689 (the three `serve_csv`, `serve_darkpool_csv`, `serve_indexes_csv` functions) with:

```python
@app.get("/flow-data.csv")
def serve_csv():
    return _csv_response(os.path.join(PUBLIC, "flow-data.csv"), "flow-data.csv")

@app.get("/Darkpool-data.csv")
def serve_darkpool_csv():
    return _csv_response(os.path.join(PUBLIC, "Darkpool-data.csv"), "Darkpool-data.csv")

@app.get("/Indexes-data.csv")
def serve_indexes_csv():
    return _csv_response(os.path.join(PUBLIC, "Indexes-data.csv"), "Indexes-data.csv")
```

- [ ] **Step 3: Verify Python syntax (no local server run needed)**

```bash
cd /c/Users/Patrick/uct-dashboard
py -3 -c "import ast; ast.parse(open('api/main.py').read()); print('syntax OK')"
```

Expected: `syntax OK`

If syntax error: fix the indentation or quote/bracket issue and re-run.

- [ ] **Step 4: Commit**

```bash
git add api/main.py
git commit -m "Cache CSV endpoints at Cloudflare with SWR

Adds Cache-Control: public, max-age=300, stale-while-revalidate=86400 +
Vary: Accept-Encoding to /flow-data.csv, /Darkpool-data.csv,
/Indexes-data.csv. Per perf-investigation #1 these were uncached and
hammered origin on every page mount. SWR keeps perceived latency near
zero on cache misses. Single shared helper avoids drift across the
three sibling endpoints."
```

---

## Task 4: Cache-Control headers on the 2 flow_router CSV endpoints

**Files:**
- Modify: `api/flow_router.py` lines 66-119

Same headers, applied to the SQLite-backed CSV endpoints that OptionsFlow now actually fetches.

- [ ] **Step 1: Find the imports at the top of `api/flow_router.py`**

```bash
head -10 /c/Users/Patrick/uct-dashboard/api/flow_router.py
```

Note whether `PlainTextResponse` is already imported.

- [ ] **Step 2: Add a module-level constant near the top of the file**

In `api/flow_router.py`, after the imports block, add:

```python
# Same caching policy as the legacy CSV endpoints in main.py — SWR with a
# 5-min max-age. Query string (?days=N) is part of CF's cache key, so each
# window caches independently.
_FLOW_CACHE_HEADERS = {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    "Vary": "Accept-Encoding",
}
```

- [ ] **Step 3: Update both CSV-returning endpoints to set the headers**

In `api/flow_router.py`, find line 90 (current):

```python
        return PlainTextResponse(csv_text, media_type="text/csv")
```

Change to:

```python
        return PlainTextResponse(csv_text, media_type="text/csv", headers=_FLOW_CACHE_HEADERS)
```

Find line 117 (current):

```python
        return PlainTextResponse(csv_text, media_type="text/csv")
```

Change to:

```python
        return PlainTextResponse(csv_text, media_type="text/csv", headers=_FLOW_CACHE_HEADERS)
```

- [ ] **Step 4: Verify syntax**

```bash
cd /c/Users/Patrick/uct-dashboard
py -3 -c "import ast; ast.parse(open('api/flow_router.py').read()); print('syntax OK')"
```

Expected: `syntax OK`

- [ ] **Step 5: Commit**

```bash
git add api/flow_router.py
git commit -m "Cache /api/flow/data + /api/flow/indexes-data at Cloudflare

Same SWR policy as the legacy CSVs (commit prior). OptionsFlow now hits
these SQLite-backed endpoints instead of the static CSVs, so caching
here is what actually keeps origin load down on the page mount path."
```

---

## Task 5: Create improved AppErrorFallback component

**Files:**
- Create: `app/src/components/AppErrorFallback.jsx`

The existing `ErrorBoundary` default fallback is a 12-px gray sentence — fine for a tile-level boundary, useless for a page-level one. We need a real fallback UI for the app-level boundary.

- [ ] **Step 1: Create the file**

Create `app/src/components/AppErrorFallback.jsx` with:

```jsx
// Full-page fallback UI rendered when the app-level ErrorBoundary catches
// a render error in any routed page. Designed to be informative without
// leaking error.message (which can contain user data).
//
// In dev (import.meta.env.DEV) we show the full stack so the engineer
// can debug; in prod we show only error.name to give support tickets
// a usable identifier without spilling sensitive data.

export default function AppErrorFallback({ error }) {
  const isDev = import.meta.env.DEV
  const errorName = error?.name || 'Error'

  const goHome = () => { window.location.href = '/dashboard' }
  const reload = () => { window.location.reload() }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#0e0f0d',
      color: '#e5e1d3',
      fontFamily: 'Inter, system-ui, sans-serif',
      padding: '24px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
      <h1 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 8px', letterSpacing: '0.5px' }}>
        Something went wrong on this page
      </h1>
      <p style={{ fontSize: '13px', color: '#a8a290', margin: '0 0 24px', maxWidth: '480px' }}>
        Error type: <code style={{ background: '#1a1b18', padding: '2px 6px', borderRadius: '3px' }}>{errorName}</code>
      </p>
      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          onClick={reload}
          style={{
            background: '#c9a84c',
            color: '#0e0f0d',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '4px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '0.3px',
          }}
        >
          Reload page
        </button>
        <button
          onClick={goHome}
          style={{
            background: 'transparent',
            color: '#e5e1d3',
            border: '1px solid #3a3a36',
            padding: '10px 20px',
            borderRadius: '4px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '0.3px',
          }}
        >
          Back to dashboard
        </button>
      </div>
      {isDev && error?.stack && (
        <pre style={{
          marginTop: '32px',
          padding: '16px',
          background: '#1a1b18',
          color: '#a8a290',
          fontSize: '11px',
          fontFamily: 'IBM Plex Mono, monospace',
          maxWidth: '90vw',
          overflow: 'auto',
          textAlign: 'left',
          borderRadius: '4px',
        }}>
          {error.stack}
        </pre>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /c/Users/Patrick/uct-dashboard
git add app/src/components/AppErrorFallback.jsx
git commit -m "Add AppErrorFallback — full-page fallback UI for app-level boundary

Shows error type (no message → no PII leak), Reload + Back-to-dashboard
buttons. In dev shows full stack; in prod hides it. Matches the app's
existing color palette (#0e0f0d bg, #c9a84c accent)."
```

---

## Task 6: Create RouteErrorBoundary wrapper that resets on navigation

**Files:**
- Create: `app/src/components/RouteErrorBoundary.jsx`

The base `ErrorBoundary` doesn't reset on navigation — once it catches an error, the user is stuck on the fallback even if they navigate away. This wrapper keys it by `useLocation().pathname` so route changes naturally remount the boundary with fresh state.

- [ ] **Step 1: Create the file**

Create `app/src/components/RouteErrorBoundary.jsx` with:

```jsx
import { useLocation } from 'react-router-dom'
import ErrorBoundary from './ErrorBoundary'
import AppErrorFallback from './AppErrorFallback'

// React's ErrorBoundary doesn't reset state on its own. Without this wrapper,
// once a render error is caught the user sees the fallback forever — even
// after navigating to a different route. Keying the boundary by
// useLocation().pathname forces a remount on route change, which clears
// the error state.

export default function RouteErrorBoundary({ children }) {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary
      key={pathname}
      fallback={<AppErrorFallback />}
    >
      {children}
    </ErrorBoundary>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /c/Users/Patrick/uct-dashboard
git add app/src/components/RouteErrorBoundary.jsx
git commit -m "Add RouteErrorBoundary — resets ErrorBoundary state on route change

Keys the underlying ErrorBoundary by useLocation().pathname so navigating
away from a crashed route remounts the boundary with fresh state. Without
this, once a page errors the fallback persists across navigations."
```

---

## Task 7: Improve base ErrorBoundary to pass error to fallback prop

**Files:**
- Modify: `app/src/components/ErrorBoundary.jsx`

The current `ErrorBoundary` accepts a `fallback` prop but renders it as a static element — there's no way for the fallback to access `this.state.error`. Update the contract to: if `fallback` is a function, call it with `{error}`; otherwise render it as-is.

- [ ] **Step 1: Read the current file**

```bash
cat /c/Users/Patrick/uct-dashboard/app/src/components/ErrorBoundary.jsx
```

- [ ] **Step 2: Replace the render method to support both element and render-prop fallback**

In `app/src/components/ErrorBoundary.jsx`, find:

```jsx
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'monospace' }}>
          Component error — reload to retry
        </div>
      )
    }
    return this.props.children
  }
```

Replace with:

```jsx
  render() {
    if (this.state.hasError) {
      const { fallback } = this.props
      // Allow fallback to be either a static element or a function that
      // receives {error} — this lets AppErrorFallback show error.name and
      // error.stack without prop-drilling state out of the boundary.
      if (typeof fallback === 'function') {
        return fallback({ error: this.state.error })
      }
      // Element form: clone if it's a React element so we can pass error,
      // otherwise render as-is.
      if (fallback && typeof fallback === 'object' && fallback.type) {
        const { cloneElement } = require('react')
        return cloneElement(fallback, { error: this.state.error })
      }
      return fallback ?? (
        <div style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'monospace' }}>
          Component error — reload to retry
        </div>
      )
    }
    return this.props.children
  }
```

Wait — `require()` doesn't work in ES modules. Replace the inline require with a top-of-file import:

At the top of `app/src/components/ErrorBoundary.jsx`, change:

```jsx
import { Component } from 'react'
```

to:

```jsx
import { Component, cloneElement, isValidElement } from 'react'
```

And in the render method, replace:

```jsx
      if (fallback && typeof fallback === 'object' && fallback.type) {
        const { cloneElement } = require('react')
        return cloneElement(fallback, { error: this.state.error })
      }
```

with:

```jsx
      if (isValidElement(fallback)) {
        return cloneElement(fallback, { error: this.state.error })
      }
```

- [ ] **Step 3: Verify the change doesn't break the existing CotData usage**

```bash
grep -n "ErrorBoundary" /c/Users/Patrick/uct-dashboard/app/src/pages/CotData.jsx | head -5
```

Note the line number, then read the surrounding context:

```bash
sed -n '385,395p' /c/Users/Patrick/uct-dashboard/app/src/pages/CotData.jsx
```

Confirm the existing usage doesn't pass a fallback (so it uses the default), OR if it does, it's a static JSX element that's compatible with the new behavior (cloneElement with error prop is harmless if the fallback ignores it).

- [ ] **Step 4: Run existing tests to confirm no regression**

```bash
cd app && npm test
```

Expected: existing tests pass (or fail in the same pre-existing ways noted in Task 1 step 3, no NEW failures).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Patrick/uct-dashboard
git add app/src/components/ErrorBoundary.jsx
git commit -m "ErrorBoundary: pass error to fallback (function or cloneElement)

Allows fallback to be either a render function (called with {error}) or
a React element (cloned with error prop injected). Existing CotData
usage passes no fallback so behavior is unchanged there. Enables
AppErrorFallback to show error.name + error.stack without prop drilling."
```

---

## Task 8: Wrap App.jsx routed Suspense with RouteErrorBoundary

**Files:**
- Modify: `app/src/App.jsx` lines 62-76

This is the change that actually activates the boundary for all routes.

- [ ] **Step 1: Read the current App.jsx imports**

```bash
sed -n '1,50p' /c/Users/Patrick/uct-dashboard/app/src/App.jsx
```

Note: there's likely no `RouteErrorBoundary` import yet. We're adding it.

- [ ] **Step 2: Add the import to App.jsx**

In `app/src/App.jsx`, add to the imports section (preserve the existing `lazyWithRetry` and other imports):

```jsx
import RouteErrorBoundary from './components/RouteErrorBoundary'
```

Place it near the other `./components/*` imports for consistency.

- [ ] **Step 3: Wrap the routed Suspense with RouteErrorBoundary**

In `app/src/App.jsx`, find the section starting around line 62 that looks like:

```jsx
        <Suspense fallback={
          <div style={{
            display: 'flex',
```

Change to:

```jsx
        <RouteErrorBoundary>
          <Suspense fallback={
            <div style={{
              display: 'flex',
```

And then find the matching closing `</Suspense>` (currently around line 119) and change:

```jsx
        </Suspense>
      </AuthProvider>
```

to:

```jsx
          </Suspense>
        </RouteErrorBoundary>
      </AuthProvider>
```

Indent the contents of `<Suspense>` one extra level for readability (optional but recommended).

- [ ] **Step 4: Verify the JSX is balanced**

```bash
cd /c/Users/Patrick/uct-dashboard/app && npx eslint src/App.jsx
```

Expected: no parse errors. Pre-existing lint warnings are fine; new errors are not.

- [ ] **Step 5: Run tests**

```bash
cd app && npm test
```

Expected: existing App.test.jsx still passes. If it broke, the wrapping changed the component tree shape in a way the test asserted on — adjust the test to match.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Patrick/uct-dashboard
git add app/src/App.jsx
git commit -m "Wrap routed Suspense with RouteErrorBoundary in App.jsx

Catches any uncaught render error from any routed page and shows
AppErrorFallback instead of unmounting the whole tree. Per
perf-investigation #5 — eliminates the blank-screen failure mode that
hit Watchlists and Breadth this session. Boundary resets on route
change via useLocation().pathname key."
```

---

## Task 9: Push and verify in production

**Files:** none — verification only.

- [ ] **Step 1: Push all commits to GitHub**

```bash
cd /c/Users/Patrick/uct-dashboard
git push origin master
```

Expected: push succeeds. If rejected (remote has commits we don't), `git pull --rebase origin master` then retry.

- [ ] **Step 2: Wait for Railway build to deploy**

The build takes 4-8 minutes. Poll the asset hash to detect when the new bundle is live:

```bash
CURRENT=$(curl -s "https://uctintelligence.com/" | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1)
echo "Current hash: $CURRENT"
until ! curl -s "https://uctintelligence.com/" | grep -q "$CURRENT"; do
  sleep 20
  echo "$(date +%H:%M:%S) building..."
done
echo "=== NEW BUILD LIVE ==="
curl -s "https://uctintelligence.com/" | grep -oE 'index-[A-Za-z0-9_-]+\.js' | sort -u
```

- [ ] **Step 3: Verify CSV cache headers are present**

```bash
for url in \
  "https://uctintelligence.com/flow-data.csv" \
  "https://uctintelligence.com/Darkpool-data.csv" \
  "https://uctintelligence.com/Indexes-data.csv" \
  "https://uctintelligence.com/api/flow/data?days=1" \
  "https://uctintelligence.com/api/flow/indexes-data?days=1"; do
  echo "=== $url ==="
  curl -sI -H "Accept-Encoding: gzip" "$url" | grep -iE "cache-control|content-encoding|cf-cache-status"
  echo ""
done
```

Expected: each shows `Cache-Control: public, max-age=300, stale-while-revalidate=86400`. After two requests to the same URL, `cf-cache-status` flips from `MISS` to `HIT`. If `Content-Encoding: gzip` is present too, that's the existing GZipMiddleware doing its job — confirms compression on top of caching.

- [ ] **Step 4: Verify ErrorBoundary catches errors (manual test)**

Open the deployed app in a browser. Navigate to any logged-in page. Open DevTools console and run:

```javascript
throw new Error('test boundary')
```

Expected: nothing happens — that throw is in the console scope, not React's render. To actually test the boundary, briefly add a debug throw to a component (e.g. `if (window.__crashtest) throw new Error('crashtest')` in `Dashboard.jsx`), deploy, navigate to dashboard with `localStorage.__crashtest = '1'` set then `location.reload()`. Confirm `AppErrorFallback` renders with Reload + Back to dashboard buttons. Click Back to dashboard; navigate elsewhere; confirm boundary resets (no longer shows the error). Remove the debug throw before next deploy.

This is the only Task 9 step that requires manual interaction. Skip if you trust the unit-level reasoning, but recommended for true verification.

- [ ] **Step 5: Verify SMA optimization in browser**

Open DevTools Performance tab. Navigate to a chart page (e.g. Breadth or any ticker chart). Click a ticker to open chart popup, observe the flame chart. The `computeSMA` calls should now be sub-millisecond instead of the multi-millisecond bars they were before. No longtask warnings tied to SMA.

- [ ] **Step 6: Sentry / error rate watch (24h)**

Watch Sentry's backend dashboard for the next 24 hours. Error rate should be stable or decrease (the cache headers reduce origin load, which should reduce 502s — perf-investigation root cause #1's cascade). No spikes from Phase 0 changes are expected.

- [ ] **Step 7: Final commit to mark phase complete**

```bash
cd /c/Users/Patrick/uct-dashboard
git commit --allow-empty -m "Phase 0 quick wins deployed and verified

- ErrorBoundary wrapping App routed Suspense (resets on route change)
- Cache-Control with SWR on 5 CSV/flow endpoints
- computeSMA O(n*period) → O(n) rolling-window

Verified:
- All 5 endpoints return correct cache headers
- Cloudflare cf-cache-status: HIT on second request
- SMA parity tests pass (output byte-equal to old algo)
- ErrorBoundary catches deliberate throw and resets on nav
- No backend error rate spike post-deploy
"
```

---

## Self-Review (post-write checklist)

**Spec coverage:**
- ErrorBoundary in App.jsx → Tasks 5, 6, 7, 8 ✓
- Cache-Control headers on 5 endpoints → Tasks 3, 4 ✓
- computeSMA rolling-window fix → Task 2 ✓
- Verification → Task 9 ✓
- Test infrastructure → Task 1 ✓

**Placeholder scan:** None found. Every step has explicit code or commands.

**Type consistency:**
- `RouteErrorBoundary` (Task 6) imports `ErrorBoundary` (Task 7's modified file) — signatures match (children prop + key + fallback element).
- `AppErrorFallback` (Task 5) is referenced by `RouteErrorBoundary` (Task 6) — props expected match (`{error}` injected via cloneElement).
- `computeSMA` (Task 2) export is referenced in test file — name matches.

All consistent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-03-phase-0-quick-wins.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Good for ensuring no mistakes — each subagent has narrow scope and we verify before proceeding.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Faster but less isolation.

**Which approach?**
