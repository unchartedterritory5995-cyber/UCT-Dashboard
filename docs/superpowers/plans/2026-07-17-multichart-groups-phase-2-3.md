# Multi-Chart "Groups" — Phases 2 & 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Groups feature — an AI peer fallback for tickers not in the taxonomy (Phase 2), plus time-range sync, saved Group boards, pinned group ETF, and fast-switch polish (Phase 3).

**Architecture:** Phase 2 adds a bounded, cached, grounded-Haiku peer resolver behind `resolve_peers`'s existing `source:"none"` taxonomy-miss path. Phase 3 adds a time-range sync bus that mirrors the shipped crosshair bus — but first closes the echo-storm gap the v1 review flagged by adding an `applyingExternalRangeRef` guard inside `StockChart` (the crosshair applier has this guard; the time-range applier does not). Saved boards, ETF pin, and fast-switch reuse existing stores/components.

**Tech Stack:** FastAPI (Python) + `_get_anthropic_client()` (Anthropic SDK, `claude-haiku-4-5`); React + Vite; lightweight-charts v5 (`StockChart.jsx`); pytest; vitest (`--pool=threads`).

## Global Constraints

- Canonical ticker form is **HYPHEN + uppercase** (`normalize_sym`); a peer is usable only if `is_chartable(sym)` (in `cap_universe`). **ETFs are the one exception** — a theme's `etf_ticker` charts on-demand via Massive and bypasses the `cap_universe` check.
- AI peers must be **validated**: in `cap_universe`, share the seed's sector *or* industry from `ticker_meta`, dedup the seed, and require the seed's `ticker_meta.name` to be non-null (refuse the AI path — nothing to ground on — otherwise). Cache on `(SEED_UPPER, n, version)`; **bound concurrency** (module semaphore) and **bound latency** (client timeout) so a cold miss can't hang the web pod's shared threadpool.
- The AI call uses the repo idiom: `from api.services.engine import _get_anthropic_client` → `client.with_options(timeout=…).messages.create(model=…, max_tokens=…, system=…, messages=[{"role":"user","content":…}])`; model id from `os.environ.get("GROUPS_AI_PEERS_MODEL", "claude-haiku-4-5")`.
- **Time-range sync must not ship without the StockChart guard.** The reporter (`subscribeVisibleTimeRangeChange` → `onTimeRangeChange`) must bail while an external range is being applied; the applier (`setVisibleRange`) must set the guard and clear it on the next rAF — mirroring the crosshair `applyingExternalRef` at `StockChart.jsx:6855,6892`.
- `fillCells` is one `apply()`; mount queue keyed on `${id}::${sym}`; never duplicate the SSE stream; state extensions go through `sanitizeState`'s allowlist (it already carries `group` + `syncTimeRange`).
- No emoji as UI icons — use `UIcon`. Deploy is push-frozen 9:15 AM–4:20 PM ET; commit locally.

---

## File structure

**Phase 2 — Backend:**
- Modify `api/services/groups.py` — add `_ai_peers(seed, n)` + wire into `resolve_peers`.
- Modify `tests/test_groups.py`.

**Phase 2 — Frontend:**
- Modify `app/src/pages/charts/grid/peerFill.js` — seed-immediate fill.
- Modify `app/src/pages/charts/grid/peerFill.test.js`.

**Phase 3 — Time-range sync:**
- Create `app/src/pages/charts/grid/rangeGuard.js` (+ test) — pure `shouldApplyRange` helper.
- Modify `app/src/components/StockChart.jsx` — `applyingExternalRangeRef` guard + epsilon gate.
- Modify `app/src/pages/charts/grid/useMultiChartState.js` (+ test) — `setSyncTimeRange`.
- Modify `app/src/pages/charts/grid/MultiChartGrid.jsx` — time-range bus + wiring.
- Modify `app/src/pages/charts/grid/GridChartCell.jsx` — range report/apply.
- Modify `app/src/pages/charts/grid/MultiChartMenu.jsx` — "Sync time range" toggle.

**Phase 3 — Saved boards / ETF / fast-switch:**
- Modify `useMultiChartState.js` + test — `applyGridTemplate` restores `group`.
- Modify `MultiChartMenu.jsx` — save embeds `group`.
- Modify `api/services/groups.py` + `api/routers/groups.py` — `top_n` returns `etf`.
- Modify `groupsApi.js`, `GroupPicker.jsx` — ETF pin + recents + prev/next arrows.
- Create `app/src/pages/charts/grid/groupRecents.js` (+ test) — pure recents helper.

---

# PHASE 2 — AI peer fallback

## Task 1: Grounded-Haiku AI peers (backend)

**Files:**
- Modify: `api/services/groups.py`
- Test: `tests/test_groups.py`

**Interfaces:**
- Consumes: `ticker_meta.get_ticker_meta(sym) -> {name, sector, industry, theme}` (any None); `normalize_sym`, `cap_universe_set`, `_get_anthropic_client`; `from api.services.cache import cache` (`cache.get(key)` / `cache.set(key, value, ttl)`).
- Produces: `_ai_peers(seed_hy: str, n: int) -> list[str]` (validated hyphen tickers, seed excluded); `resolve_peers` now returns `source:"ai"` when the taxonomy misses but AI yields peers, else `source:"none"`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_groups.py  (append)
def test_ai_peers_validates_sector_match_and_dedups_seed(monkeypatch):
    from api.services import ticker_meta
    # Seed SNDK: SanDisk, Technology / Computer Storage.
    metas = {
        "SNDK": {"name": "SanDisk Corp", "sector": "Technology", "industry": "Computer Storage", "theme": None},
        "WDC":  {"name": "Western Digital", "sector": "Technology", "industry": "Computer Storage", "theme": None},
        "STX":  {"name": "Seagate", "sector": "Technology", "industry": "Computer Storage", "theme": None},
        "AAPL": {"name": "Apple", "sector": "Technology", "industry": "Consumer Electronics", "theme": None},
        "XYZZY": {"name": "Nope", "sector": "Energy", "industry": "Oil", "theme": None},
    }
    monkeypatch.setattr(ticker_meta, "get_ticker_meta", lambda s: metas.get(groups.normalize_sym(s), {"name": None, "sector": None, "industry": None, "theme": None}))
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"SNDK", "WDC", "STX", "AAPL", "XYZZY"})
    # Haiku returns: WDC (good), STX (good), SNDK (the seed — must dedup),
    # XYZZY (wrong sector — must drop), FAKE (not in cap_universe — must drop).
    monkeypatch.setattr(groups, "_ai_peer_raw", lambda seed, n, meta: ["WDC", "STX", "SNDK", "XYZZY", "FAKE"])
    cache_store = {}
    monkeypatch.setattr(groups.cache, "get", lambda k: cache_store.get(k))
    monkeypatch.setattr(groups.cache, "set", lambda k, v, ttl: cache_store.__setitem__(k, v))
    out = groups._ai_peers("SNDK", 5)
    assert out == ["WDC", "STX"]        # seed + wrong-sector + non-chartable all dropped
    # AAPL shares sector (Technology) but industry differs — sector match is enough,
    # but the model didn't return it, so it's simply absent (validation is a filter).


def test_ai_peers_refuses_when_seed_meta_name_is_null(monkeypatch):
    from api.services import ticker_meta
    monkeypatch.setattr(ticker_meta, "get_ticker_meta", lambda s: {"name": None, "sector": None, "industry": None, "theme": None})
    called = {"raw": 0}
    monkeypatch.setattr(groups, "_ai_peer_raw", lambda *a: called.__setitem__("raw", called["raw"] + 1) or [])
    monkeypatch.setattr(groups.cache, "get", lambda k: None)
    monkeypatch.setattr(groups.cache, "set", lambda k, v, ttl: None)
    assert groups._ai_peers("GHOST", 5) == []
    assert called["raw"] == 0            # never grounds on a null-name seed


def test_resolve_peers_uses_ai_on_taxonomy_miss(monkeypatch):
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: None)   # not in taxonomy
    monkeypatch.setattr(groups, "_ai_peers", lambda seed, n: ["WDC", "STX"])
    out = groups.resolve_peers("SNDK", 5)
    assert out == {"seed": "SNDK", "group_id": None, "peers": ["WDC", "STX"], "source": "ai"}


def test_resolve_peers_none_when_ai_empty(monkeypatch):
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: None)
    monkeypatch.setattr(groups, "_ai_peers", lambda seed, n: [])
    out = groups.resolve_peers("GHOST", 5)
    assert out == {"seed": "GHOST", "group_id": None, "peers": [], "source": "none"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_groups.py -k "ai_peers or resolve_peers_uses_ai or resolve_peers_none" -q`
Expected: FAIL (`_ai_peers` / `_ai_peer_raw` not defined; `resolve_peers` returns `source:"none"` today, so the AI test fails).

- [ ] **Step 3: Write the implementation**

Add near the top of `api/services/groups.py` (with the other imports and module constants):

```python
import os
import threading
from api.services.cache import cache

_AI_PEERS_MODEL = os.environ.get("GROUPS_AI_PEERS_MODEL", "claude-haiku-4-5")
_AI_PEERS_TTL = 6 * 3600.0            # peers of a ticker barely change — cache 6h
_AI_PEERS_VERSION = "v1"              # bump to invalidate the whole AI-peer cache
_AI_PEERS_TIMEOUT = float(os.environ.get("GROUPS_AI_PEERS_TIMEOUT", "6"))
_AI_PEERS_SEM = threading.Semaphore(int(os.environ.get("GROUPS_AI_PEERS_CONCURRENCY", "3")))
```

Add these functions (place them just above `resolve_peers`):

```python
def _ai_peer_raw(seed_hy: str, n: int, meta: dict) -> list:
    """One grounded Haiku call → a list of candidate tickers (unvalidated).
    Grounded on the seed's real company identity so the model reasons about a
    named company, not a bare symbol. Bounded by a module semaphore + a client
    timeout so a cold miss can't pin the web pod's shared threadpool. Returns []
    on any error (caller keeps the seed solo)."""
    name = meta.get("name") or ""
    sector = meta.get("sector") or "unknown sector"
    industry = meta.get("industry") or "unknown industry"
    system = (
        "You are a markets assistant. Given a company, list its closest US-listed "
        "public-equity peers — same sector/industry, comparable business. Reply with "
        "ONLY a JSON array of ticker symbols (e.g. [\"WDC\",\"STX\"]). No prose."
    )
    prompt = (
        f"Company: {name} (ticker {seed_hy}). Sector: {sector}. Industry: {industry}.\n"
        f"Return up to {n + 3} closest US-listed peer tickers as a JSON array, "
        f"excluding {seed_hy} itself."
    )
    if not _AI_PEERS_SEM.acquire(timeout=_AI_PEERS_TIMEOUT):
        return []
    try:
        from api.services.engine import _get_anthropic_client
        client = _get_anthropic_client().with_options(timeout=_AI_PEERS_TIMEOUT)
        msg = client.messages.create(
            model=_AI_PEERS_MODEL, max_tokens=200,
            system=system, messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(getattr(b, "text", "") for b in msg.content)
        start, end = text.find("["), text.rfind("]")
        if start == -1 or end <= start:
            return []
        import json
        arr = json.loads(text[start:end + 1])
        return [str(t) for t in arr if t] if isinstance(arr, list) else []
    except Exception:
        return []


def _ai_peers(seed_hy: str, n: int) -> list:
    """Validated AI peers for a ticker NOT in the taxonomy. Grounds on
    ticker_meta; refuses when the seed has no name (nothing to ground on).
    Validates every returned ticker: in cap_universe, shares the seed's sector
    or industry, not the seed. Cached on (SEED, n, version)."""
    seed_hy = normalize_sym(seed_hy)
    key = f"grp_ai_peers::{seed_hy}::{n}::{_AI_PEERS_VERSION}"
    hit = cache.get(key)
    if hit is not None:
        return hit
    from api.services import ticker_meta
    meta = ticker_meta.get_ticker_meta(seed_hy) or {}
    if not meta.get("name"):
        cache.set(key, [], _AI_PEERS_TTL)     # cache the refusal too (cheap, avoids re-calling)
        return []
    seed_sector = (meta.get("sector") or "").strip().lower()
    seed_industry = (meta.get("industry") or "").strip().lower()
    cap = cap_universe_set()
    out = []
    seen = {seed_hy}
    for raw in _ai_peer_raw(seed_hy, n, meta):
        hy = normalize_sym(raw)
        if hy in seen or hy not in cap:
            continue
        pm = ticker_meta.get_ticker_meta(hy) or {}
        ps = (pm.get("sector") or "").strip().lower()
        pi = (pm.get("industry") or "").strip().lower()
        # Sector OR industry must match the seed (drops a real-but-unrelated ticker).
        if (seed_sector and ps == seed_sector) or (seed_industry and pi == seed_industry):
            seen.add(hy)
            out.append(hy)
        if len(out) >= n:
            break
    cache.set(key, out, _AI_PEERS_TTL)
    return out
```

Then edit `resolve_peers`'s taxonomy-miss branch. Find:

```python
    row = resolve_primary_theme(sym)
    if not row:
        return {"seed": seed_hy, "group_id": None, "peers": [], "source": "none"}
```

and replace with:

```python
    row = resolve_primary_theme(sym)
    if not row:
        ai = _ai_peers(seed_hy, n)
        return {"seed": seed_hy, "group_id": None,
                "peers": ai, "source": "ai" if ai else "none"}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_groups.py -q`
Expected: PASS (all prior + the 4 new).

- [ ] **Step 5: Commit**

```bash
git add api/services/groups.py tests/test_groups.py
git commit -m "feat(groups): grounded-Haiku AI peer fallback (validated + cached + bounded)"
```

---

## Task 2: Seed renders immediately, peers stream in (frontend)

**Files:**
- Modify: `app/src/pages/charts/grid/peerFill.js`
- Test: `app/src/pages/charts/grid/peerFill.test.js`

**Interfaces:**
- Consumes: `fetchPeers`, `fillCells` (from the factory).
- Produces: `makePeerFiller(...).run(seed, ...)` now fills `[seed]` **immediately** (so the seed chart appears at once — matters for the ~1–2s cold AI case), then fills `[seed, ...peers]` when the fetch resolves. Both fills are latch-gated (a superseded run does neither).

- [ ] **Step 1: Write the failing test**

```javascript
// app/src/pages/charts/grid/peerFill.test.js  (append inside the describe)
it('fills the seed immediately, then the full set when peers resolve', async () => {
  let resolve
  const fetchPeers = vi.fn(() => new Promise(r => { resolve = () => r({ seed: 'SNDK', peers: ['WDC', 'STX'], source: 'ai' }) }))
  const fillCells = vi.fn()
  const filler = makePeerFiller({ fetchPeers, fillCells, onUndoAvailable: () => {} })
  const p = filler.run('SNDK', { n: 3, group: null, snapshot: {} })
  // Seed-solo fill happens synchronously, before the fetch resolves:
  expect(fillCells).toHaveBeenNthCalledWith(1, ['SNDK'], null)
  resolve()
  await p
  expect(fillCells).toHaveBeenNthCalledWith(2, ['SNDK', 'WDC', 'STX'], null)
})

it('a superseded run does not fill the seed either', async () => {
  const fetchPeers = vi.fn(() => new Promise(() => {}))   // never resolves
  const fillCells = vi.fn()
  const filler = makePeerFiller({ fetchPeers, fillCells, onUndoAvailable: () => {} })
  filler.run('AAPL', { n: 3, group: null, snapshot: {} })   // gen 1: fills [AAPL]
  filler.run('MSFT', { n: 3, group: null, snapshot: {} })   // gen 2: fills [MSFT]
  // Each run fills its own seed immediately; both are the latest at their moment.
  expect(fillCells).toHaveBeenNthCalledWith(1, ['AAPL'], null)
  expect(fillCells).toHaveBeenNthCalledWith(2, ['MSFT'], null)
  expect(fillCells).toHaveBeenCalledTimes(2)   // neither fetch resolved → no peer fills
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/peerFill.test.js`
Expected: FAIL (only one `fillCells` call today — the seed-immediate call doesn't exist).

- [ ] **Step 3: Write the implementation**

In `peerFill.js`, in `run`, add the immediate seed fill right after computing `seed` and bumping `gen`:

```javascript
  async function run(seedSym, { n = 8, group = null, snapshot = null } = {}) {
    const mine = ++gen
    const seed = (seedSym || '').toUpperCase()
    // Seed appears instantly (the peer fetch — especially a cold AI resolve —
    // can take 1-2s; the trader sees their ticker immediately, peers stream in).
    fillCells([seed], group || null)
    const res = await fetchPeers(seed, { n: Math.max(1, n - 1) })
    if (mine !== gen) return                     // a newer commit superseded this one
    const peers = (res && Array.isArray(res.peers)) ? res.peers : []
    const syms = [seed, ...peers].slice(0, n)
    const nextGroup = res && res.group_id ? { id: res.group_id, by: 'today', n } : group
    fillCells(syms, nextGroup || null)
    if (snapshot) onUndoAvailable?.({ label: `filled peers of ${seed}`, snapshot })
  }
```

(The seed-solo fill is intentionally *not* latch-gated — each `run` fills its own seed at the moment it's the latest gesture, which is correct: the most recent commit's seed should show. Only the *peer* fill is latch-gated.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/peerFill.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/charts/grid/peerFill.js app/src/pages/charts/grid/peerFill.test.js
git commit -m "feat(groups): peer-fill shows the seed immediately, streams peers in"
```

---

# PHASE 3 — time-range sync, saved boards, ETF pin, fast-switch

## Task 3: Time-range echo guard in StockChart (the risky one)

**Files:**
- Create: `app/src/pages/charts/grid/rangeGuard.js`
- Test: `app/src/pages/charts/grid/rangeGuard.test.js`
- Modify: `app/src/components/StockChart.jsx` (reporter `:6812-6822`, applier `:6827-6835`, refs near `:1586`)

**Interfaces:**
- Produces: `shouldApplyRange(incoming, lastApplied, epsilonSec = 2) -> boolean` — false when `incoming` is within `epsilonSec` of `lastApplied` on both `from` and `to` (kills the near-identical re-apply that keeps a bidirectional bus oscillating across charts with slightly different bar spacing). StockChart gains an `applyingExternalRangeRef` so its own `setVisibleRange` never re-triggers the report→broadcast loop.

- [ ] **Step 1: Write the failing test**

```javascript
// app/src/pages/charts/grid/rangeGuard.test.js
import { describe, it, expect } from 'vitest'
import { shouldApplyRange } from './rangeGuard'

describe('shouldApplyRange', () => {
  it('applies when there is no prior range', () => {
    expect(shouldApplyRange({ from: 100, to: 200 }, null)).toBe(true)
  })
  it('skips a near-identical range (within epsilon on both ends)', () => {
    expect(shouldApplyRange({ from: 101, to: 199 }, { from: 100, to: 200 }, 2)).toBe(false)
  })
  it('applies when either end moved beyond epsilon', () => {
    expect(shouldApplyRange({ from: 100, to: 260 }, { from: 100, to: 200 }, 2)).toBe(true)
    expect(shouldApplyRange({ from: 140, to: 200 }, { from: 100, to: 200 }, 2)).toBe(true)
  })
  it('rejects a malformed incoming range', () => {
    expect(shouldApplyRange(null, { from: 100, to: 200 })).toBe(false)
    expect(shouldApplyRange({ from: 'x', to: 200 }, null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/rangeGuard.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the helper**

```javascript
// app/src/pages/charts/grid/rangeGuard.js
// Echo/oscillation gate for cross-chart time-range sync. Charts with different
// bar spacing produce slightly different {from,to} for "the same" view, so a
// naive bidirectional bus never settles. Skip an incoming range that's within
// `epsilonSec` of the last one we applied on BOTH ends. Pure + unit-tested;
// the StockChart applyingExternalRangeRef latch handles the same-tick echo.

export function shouldApplyRange(incoming, lastApplied, epsilonSec = 2) {
  if (!incoming || !Number.isFinite(incoming.from) || !Number.isFinite(incoming.to)) return false
  if (!lastApplied) return true
  const near = Math.abs(incoming.from - lastApplied.from) <= epsilonSec &&
               Math.abs(incoming.to - lastApplied.to) <= epsilonSec
  return !near
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/rangeGuard.test.js`
Expected: PASS.

- [ ] **Step 5: Add the guard to StockChart**

In `StockChart.jsx`, near the existing `const applyingExternalRef = useRef(false)` (line ~1586), add:

```javascript
  const applyingExternalRangeRef = useRef(false)
  const lastAppliedRangeRef = useRef(null)
```

Add the import at the top of `StockChart.jsx` (with the other imports):

```javascript
import { shouldApplyRange } from '../pages/charts/grid/rangeGuard'
```

Replace the **reporter** effect (currently `:6812-6822`) so it bails while an external range is being applied:

```javascript
  useEffect(() => {
    if (!chartRef.current || typeof onTimeRangeChange !== 'function') return
    const ts = chartRef.current.timeScale()
    const handler = (range) => {
      // Bail while WE are applying an external range — otherwise setVisibleRange
      // below re-fires this handler and the bus oscillates across every chart.
      if (range && !applyingExternalRangeRef.current) {
        onTimeRangeChange({ from: range.from, to: range.to })
      }
    }
    try { ts.subscribeVisibleTimeRangeChange(handler) } catch { return }
    return () => {
      try { ts.unsubscribeVisibleTimeRangeChange(handler) } catch {}
    }
  }, [onTimeRangeChange])
```

Replace the **applier** effect (currently `:6827-6835`) so it sets the guard + epsilon-gates:

```javascript
  useEffect(() => {
    if (!chartRef.current || !externalTimeRange) return
    if (!shouldApplyRange(externalTimeRange, lastAppliedRangeRef.current)) return
    applyingExternalRangeRef.current = true
    try {
      chartRef.current.timeScale().setVisibleRange({
        from: externalTimeRange.from,
        to: externalTimeRange.to,
      })
      lastAppliedRangeRef.current = { from: externalTimeRange.from, to: externalTimeRange.to }
    } catch {}
    // Clear on the next frame — mirrors the crosshair applier's rAF release, so
    // the subscribeVisibleTimeRangeChange fired by setVisibleRange is swallowed.
    const raf = requestAnimationFrame(() => { applyingExternalRangeRef.current = false })
    return () => cancelAnimationFrame(raf)
  }, [externalTimeRange])
```

- [ ] **Step 6: Verify the grid dir + a StockChart smoke build**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/rangeGuard.test.js && npm run build 2>&1 | grep -E "error|✓ built" | tail -1`
Expected: rangeGuard PASS + `✓ built` (StockChart still compiles with the new import + refs).

- [ ] **Step 7: Commit**

```bash
git add app/src/pages/charts/grid/rangeGuard.js app/src/pages/charts/grid/rangeGuard.test.js app/src/components/StockChart.jsx
git commit -m "feat(charts): time-range echo guard in StockChart (applyingExternalRangeRef + epsilon gate)"
```

---

## Task 4: `syncTimeRange` toggle in state + menu

**Files:**
- Modify: `app/src/pages/charts/grid/useMultiChartState.js`
- Modify: `app/src/pages/charts/grid/MultiChartMenu.jsx`
- Test: `app/src/pages/charts/grid/useMultiChartState.test.jsx`

**Interfaces:**
- Consumes: `apply(updater)`; `sanitizeState` already carries `syncTimeRange` (bool) from v1.
- Produces: `setSyncTimeRange(on)` on the hook; `state.syncTimeRange` exposed; a "Sync time range across charts" checkbox in the menu mirroring the crosshair one.

- [ ] **Step 1: Write the failing test**

```javascript
// app/src/pages/charts/grid/useMultiChartState.test.jsx  (append inside describe('fillCells'... or a new describe)
describe('syncTimeRange', () => {
  it('toggles and exposes syncTimeRange', () => {
    const { result } = renderHook(() => useMultiChartState())
    expect(result.current.state.syncTimeRange).toBe(false)
    act(() => result.current.setSyncTimeRange(true))
    expect(result.current.state.syncTimeRange).toBe(true)
    act(() => result.current.setSyncTimeRange(false))
    expect(result.current.state.syncTimeRange).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/useMultiChartState.test.jsx`
Expected: FAIL (`setSyncTimeRange is not a function`).

- [ ] **Step 3: Add the callback**

In `useMultiChartState.js`, after `setSyncCrosshair`, add:

```javascript
  const setSyncTimeRange = useCallback((on) => {
    apply(prev => ({ ...prev, syncTimeRange: !!on }))
  }, [apply])
```

Add `setSyncTimeRange` to the returned object.

- [ ] **Step 4: Add the menu checkbox**

In `MultiChartMenu.jsx`, right after the existing "Sync crosshair across charts" `<label>`, add:

```jsx
      <label className={wsStyles.menuCheck}>
        <input
          type="checkbox"
          checked={mc.state.syncTimeRange}
          onChange={e => mc.setSyncTimeRange(e.target.checked)}
        />
        Sync time range across charts
      </label>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/useMultiChartState.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/charts/grid/useMultiChartState.js app/src/pages/charts/grid/MultiChartMenu.jsx app/src/pages/charts/grid/useMultiChartState.test.jsx
git commit -m "feat(groups): syncTimeRange toggle (state + menu)"
```

---

## Task 5: Time-range bus wired through the grid

**Files:**
- Modify: `app/src/pages/charts/grid/MultiChartGrid.jsx`
- Modify: `app/src/pages/charts/grid/GridChartCell.jsx`

**Interfaces:**
- Consumes: Task 3's StockChart `onTimeRangeChange` / `externalTimeRange` props (now echo-guarded); Task 4's `state.syncTimeRange`; the crosshair-bus pattern (`busRef` `{emit(sourceId,payload), subscribe(fn)}`).
- Produces: a second ref-bus (`rangeBusRef`) passed to cells as `rangeBus` only when `syncTimeRange` is on; `GridChartCell` reports its visible range to the bus and applies the last range from any *other* cell.

- [ ] **Step 1: Add the range bus in MultiChartGrid**

In `MultiChartGrid.jsx`, next to the existing crosshair `busRef` block, add a second bus:

```jsx
  const rangeBusRef = useRef(null)
  if (!rangeBusRef.current) {
    const listeners = new Set()
    rangeBusRef.current = {
      emit: (sourceId, payload) => listeners.forEach((fn) => fn({ sourceId, payload })),
      subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
    }
  }
  const rangeBus = spikeActive ? null : (state.syncTimeRange ? rangeBusRef.current : null)
```

Pass it to each `<GridChartCell>` in the render (next to `crosshairBus={crosshairBus}`):

```jsx
                rangeBus={rangeBus}
```

- [ ] **Step 2: Consume the range bus in GridChartCell**

In `GridChartCell.jsx`, add `rangeBus` to the props destructure (next to `crosshairBus`). Then mirror the crosshair wiring (below the existing crosshair block, ~line 126):

```jsx
  // ── Time-range sync (mirrors the crosshair ref-bus; echo-guarded in StockChart) ──
  const [externalTimeRange, setExternalTimeRange] = useState(null)
  const reportRange = useCallback((payload) => {
    rangeBus?.emit(cellIdRef.current, payload)
  }, [rangeBus])
  useEffect(() => {
    if (!rangeBus || !sym) return undefined
    return rangeBus.subscribe(({ sourceId, payload }) => {
      if (sourceId !== cellIdRef.current) setExternalTimeRange(payload)
    })
  }, [rangeBus, sym])
  useEffect(() => { setExternalTimeRange(null) }, [sym])
  useEffect(() => { if (!rangeBus) setExternalTimeRange(null) }, [rangeBus])
```

Then pass the two props to `<StockChart>` (next to `onCrosshairMove`/`externalCrosshair`, ~line 356):

```jsx
            onTimeRangeChange={rangeBus ? reportRange : null}
            externalTimeRange={externalTimeRange}
```

- [ ] **Step 3: Verify grid dir + build**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/ && npm run build 2>&1 | grep -E "error|✓ built" | tail -1`
Expected: grid dir all pass + `✓ built`.

- [ ] **Step 4: Manual verification (visible tab)**

On the local dev server, enter a group grid, toggle **Sync time range across charts** on, then pan/zoom one cell. Confirm every other cell's visible window follows, and that it **settles** (no runaway flicker / CPU spin — the echo guard + epsilon gate holding). Toggle off → cells move independently again.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/charts/grid/MultiChartGrid.jsx app/src/pages/charts/grid/GridChartCell.jsx
git commit -m "feat(groups): time-range sync bus across grid cells"
```

---

## Task 6: Saved Group boards (restore the group)

**Files:**
- Modify: `app/src/pages/charts/grid/useMultiChartState.js`
- Modify: `app/src/pages/charts/grid/MultiChartMenu.jsx`
- Test: `app/src/pages/charts/grid/useMultiChartState.test.jsx`

**Interfaces:**
- Consumes: `applyGridTemplate(tpl)` (applies a saved `{kind:'multichart', layout, cells}`); `sanitizeState` already validates+carries `group`.
- Produces: a saved multichart layout now embeds `group`, and `applyGridTemplate` restores it — so opening a saved Group board comes back as a live group (Refresh + heat header + badges work).

- [ ] **Step 1: Write the failing test**

```javascript
// app/src/pages/charts/grid/useMultiChartState.test.jsx  (append)
describe('applyGridTemplate group restore', () => {
  it('restores the embedded group from a saved board', () => {
    const { result } = renderHook(() => useMultiChartState())
    act(() => result.current.applyGridTemplate({
      layout: { kind: 'multichart', layout: '2x2',
                cells: [{ sym: 'XOP', tf: 'D' }, { sym: 'XLE', tf: 'D' }],
                group: { id: 'oil_gas_ep', by: 'today', n: 4 } },
    }))
    expect(result.current.state.mode).toBe('grid')
    expect(result.current.state.group).toEqual({ id: 'oil_gas_ep', by: 'today', n: 4 })
    expect(result.current.state.cells.map(c => c.sym).slice(0, 2)).toEqual(['XOP', 'XLE'])
  })

  it('a board with no group restores as a plain grid (group null)', () => {
    const { result } = renderHook(() => useMultiChartState())
    act(() => result.current.applyGridTemplate({
      layout: { kind: 'multichart', layout: '2x2', cells: [{ sym: 'AAPL', tf: 'D' }] },
    }))
    expect(result.current.state.group).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/useMultiChartState.test.jsx`
Expected: FAIL (`applyGridTemplate` today doesn't thread `group` — `state.group` is null after restore).

- [ ] **Step 3: Thread group through applyGridTemplate**

In `useMultiChartState.js`, in `applyGridTemplate`, add `group` to the `sanitizeState` input:

```javascript
  const applyGridTemplate = useCallback((tpl) => {
    const l = tpl?.layout
    if (!l || l.kind !== 'multichart') return
    apply(prev => {
      const s = sanitizeState({ layout: l.layout, cells: l.cells,
        syncCrosshair: prev.syncCrosshair, syncTimeRange: prev.syncTimeRange, group: l.group })
      return { mode: 'grid', ...s }
    })
  }, [apply])
```

- [ ] **Step 4: Embed group on save**

In `MultiChartMenu.jsx`, in `handleSaveAs`'s `saveLayout({ ... layout: { kind:'multichart', ... } })`, add `group` to the layout blob:

```jsx
        layout: {
          kind: 'multichart',
          widgets: [],
          layout: mc.state.layout,
          cells: mc.state.cells.map(c => ({ sym: c.sym, tf: c.tf, chartType: c.chartType || null })),
          group: mc.state.group || null,
        },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/useMultiChartState.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/charts/grid/useMultiChartState.js app/src/pages/charts/grid/MultiChartMenu.jsx app/src/pages/charts/grid/useMultiChartState.test.jsx
git commit -m "feat(groups): saved Group boards restore the live group"
```

---

## Task 7: Pinned group ETF

**Files:**
- Modify: `api/services/groups.py`
- Modify: `api/routers/groups.py` (no shape change — `top_n` already flows through)
- Modify: `app/src/pages/charts/grid/GroupPicker.jsx`
- Modify: `app/src/pages/charts/grid/groupsApi.js` (safe-empty shape gains `etf`)
- Test: `tests/test_groups.py`, `app/src/pages/charts/grid/GroupPicker.test.jsx`

**Interfaces:**
- Consumes: `theme_db.get_all_themes()` (themes carry `etf_ticker`); `top_n(theme_id, n, by)`.
- Produces: `top_n` returns `etf: <ticker>|None` (the theme's `etf_ticker`, uppercased — ETFs bypass `cap_universe`); GroupPicker pins it as cell 0 (`[etf, ...syms].slice(0, n)`).

- [ ] **Step 1: Write the failing backend test**

```python
# tests/test_groups.py  (append)
def test_top_n_includes_group_etf(monkeypatch):
    monkeypatch.setattr(groups, "_theme_holdings",
                        lambda tid: [{"sym": "RKLB", "tier": "core", "rationale": "Launch"}])
    monkeypatch.setattr(groups, "rank_holdings", lambda h, by="today", seed=None: ["RKLB"])
    monkeypatch.setattr(groups, "_theme_etf",
                        lambda tid: "UFO" if tid == "space" else None)
    assert groups.top_n("space", 4, by="today")["etf"] == "UFO"
    monkeypatch.setattr(groups, "_theme_etf", lambda tid: None)
    assert groups.top_n("nustar", 4, by="today")["etf"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_groups.py::test_top_n_includes_group_etf -q`
Expected: FAIL (`_theme_etf` not defined; `top_n` has no `etf` key).

- [ ] **Step 3: Add `_theme_etf` + the `etf` field**

In `groups.py`, add a cached-map helper near `_theme_sizes` (reuse the same `_get_all_themes()` read):

```python
def _theme_etf(theme_id: str) -> str | None:
    """The theme's ETF ticker (uppercased hyphen form), or None. ETFs chart via
    Massive on demand, so they are NOT cap_universe-filtered."""
    try:
        for t in _get_all_themes().get("themes", []):
            if t["id"] == theme_id:
                etf = t.get("etf_ticker")
                return normalize_sym(etf) if etf else None
    except Exception:
        pass
    return None
```

In `top_n`, add `etf` to the returned dict:

```python
    return {
        "group_id": theme_id,
        "syms": top,
        "rows": rows,
        "etf": _theme_etf(theme_id),
        "total": len(ranked),
        "by": "rs" if by == "rs" else "today",
        "ranked_as_of": _ranked_as_of(),
    }
```

- [ ] **Step 4: Run backend test**

Run: `python -m pytest tests/test_groups.py -q`
Expected: PASS.

- [ ] **Step 5: Pin the ETF in the picker (frontend)**

In `groupsApi.js`, `fetchGroupTop`'s safe-empty shape gains `etf: null`:

```javascript
    if (!r.ok) return { syms: [], rows: [], etf: null, total: 0, by, ranked_as_of: 'unknown' }
```

In `GroupPicker.jsx`'s `pick`, prepend the ETF (deduped) when present:

```javascript
    const { syms, etf } = await fetchGroupTop(g.id, { n, by: 'today' })
    const filled = etf ? [etf, ...(syms || []).filter(s => s !== etf)].slice(0, n) : (syms || [])
    if (filled.length) mc.fillCells(filled, { id: g.id, by: 'today', n })
```

- [ ] **Step 6: Update the GroupPicker test for the pinned ETF**

In `GroupPicker.test.jsx`, change the `fetchGroupTop` mock in the `vi.mock('./groupsApi', …)` block to return an `etf`:

```javascript
  fetchGroupTop: vi.fn(async () => ({ syms: ['RKLB', 'ASTS', 'LUNR', 'BKSY'], etf: 'UFO', total: 6, by: 'today', ranked_as_of: 'regular' })),
```

and change the `fillCells` assertion in the "lists groups and fills the grid on click" test from the current no-ETF expectation to the ETF-pinned one:

```javascript
    expect(mc.fillCells).toHaveBeenCalledWith(
      ['UFO', 'RKLB', 'ASTS', 'LUNR'],
      { id: 'space', by: 'today', n: 4 },
    )
```

(Cell 0 is now `UFO`; the top-N is sliced to 4 so `BKSY` drops off the end.)

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/GroupPicker.test.jsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add api/services/groups.py tests/test_groups.py app/src/pages/charts/grid/groupsApi.js app/src/pages/charts/grid/GroupPicker.jsx app/src/pages/charts/grid/GroupPicker.test.jsx
git commit -m "feat(groups): pin the group ETF as cell 0"
```

---

## Task 8: Fast-switch — recents + prev/next arrows

**Files:**
- Create: `app/src/pages/charts/grid/groupRecents.js`
- Test: `app/src/pages/charts/grid/groupRecents.test.js`
- Modify: `app/src/pages/charts/grid/GroupPicker.jsx` (record + surface recents)
- Modify: `app/src/pages/charts/grid/MultiChartMenu.jsx` (‹ › arrows when a group is active)

**Interfaces:**
- Produces: `pushRecent(id) -> string[]` (most-recent-first, deduped, capped 6, persisted in `localStorage['uct.groups.recents']`); `getRecents() -> string[]`; `neighborGroup(groups, currentId, dir) -> id|null` (the id `dir` steps away in the rotation-sorted list, wrapping).

- [ ] **Step 1: Write the failing test**

```javascript
// app/src/pages/charts/grid/groupRecents.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { pushRecent, getRecents, neighborGroup } from './groupRecents'

beforeEach(() => localStorage.clear())

describe('groupRecents', () => {
  it('pushRecent de-dupes, most-recent-first, caps at 6', () => {
    pushRecent('a'); pushRecent('b'); pushRecent('a')
    expect(getRecents()).toEqual(['a', 'b'])
    for (const id of ['c', 'd', 'e', 'f', 'g']) pushRecent(id)
    expect(getRecents()).toHaveLength(6)
    expect(getRecents()[0]).toBe('g')
  })
  it('neighborGroup steps and wraps', () => {
    const list = [{ id: 'x' }, { id: 'y' }, { id: 'z' }]
    expect(neighborGroup(list, 'y', 1)).toBe('z')
    expect(neighborGroup(list, 'y', -1)).toBe('x')
    expect(neighborGroup(list, 'z', 1)).toBe('x')   // wraps
    expect(neighborGroup(list, 'x', -1)).toBe('z')  // wraps
    expect(neighborGroup(list, 'missing', 1)).toBe('x')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/groupRecents.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the helper**

```javascript
// app/src/pages/charts/grid/groupRecents.js
// Recent-groups list (localStorage) + prev/next neighbor for fast group scanning.

const KEY = 'uct.groups.recents'
const CAP = 6

export function getRecents() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(arr) ? arr.slice(0, CAP) : []
  } catch { return [] }
}

export function pushRecent(id) {
  if (!id) return getRecents()
  const next = [id, ...getRecents().filter(x => x !== id)].slice(0, CAP)
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore quota */ }
  return next
}

export function neighborGroup(groups, currentId, dir) {
  const list = Array.isArray(groups) ? groups : []
  if (!list.length) return null
  const i = list.findIndex(g => g.id === currentId)
  if (i === -1) return list[0].id
  const j = (i + dir + list.length) % list.length
  return list[j].id
}
```

- [ ] **Step 4: Surface recents + record on pick (GroupPicker)**

In `GroupPicker.jsx`: import `{ pushRecent, getRecents }`; call `pushRecent(g.id)` inside `pick` (right before `setBusy('')`); and render a "Recent" strip above the full list when the search box is empty:

```jsx
import { pushRecent, getRecents } from './groupRecents'
// ...inside the component:
const recents = useMemo(() => {
  const byId = new Map(groups.map(g => [g.id, g]))
  return getRecents().map(id => byId.get(id)).filter(Boolean)
}, [groups])
// ...in pick(), before setBusy(''):
pushRecent(g.id)
// ...in the render, above the main .groupList (only when no search text):
{!q.trim() && recents.length > 0 && (
  <>
    <div className={wsStyles.menuSection} style={{ padding: '4px 10px 0' }}>Recent</div>
    <div className={styles.groupList}>
      {recents.map(g => (
        <button key={`r-${g.id}`} type="button" className={wsStyles.addMenuItem}
          disabled={busy === g.id} onClick={() => pick(g)}>
          <span style={{ flex: 1 }}>{g.name}</span>
          <span className={styles.groupCount}>{g.chartable}</span>
        </button>
      ))}
    </div>
  </>
)}
```

- [ ] **Step 5: Add ‹ › arrows to the menu (MultiChartMenu)**

In `MultiChartMenu.jsx`, in the `{mc.state.group && (...)}` block (next to Refresh / Exit Groups), add a prev/next row. Import `{ fetchGroups, fetchGroupTop }` (fetchGroups may already be needed) and `{ neighborGroup }`; add a helper that steps to a neighbor and fills it:

```jsx
import { neighborGroup } from './groupRecents'
// ...
const stepGroup = async (dir) => {
  const list = await fetchGroups()
  const nextId = neighborGroup(list, mc.state.group.id, dir)
  if (!nextId) return
  const n = mc.state.cells.length
  const { syms, etf } = await fetchGroupTop(nextId, { n, by: mc.state.group.by || 'today' })
  const filled = etf ? [etf, ...(syms || []).filter(s => s !== etf)].slice(0, n) : (syms || [])
  if (filled.length) mc.fillCells(filled, { id: nextId, by: mc.state.group.by || 'today', n })
}
// ...in the {mc.state.group && (...)} block, add a row:
<div className={styles.nxmForm} style={{ justifyContent: 'space-between' }}>
  <button type="button" className={wsStyles.toolbarBtn} onClick={() => stepGroup(-1)} aria-label="Previous group">‹ Prev</button>
  <button type="button" className={wsStyles.toolbarBtn} onClick={() => stepGroup(1)} aria-label="Next group">Next ›</button>
</div>
```

(Settle-delay: the arrows are click-driven, not held, so each step is one debounced fill — no extra throttle needed beyond the existing 500 ms save + mount-queue admission.)

- [ ] **Step 6: Run tests + build**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/ && npm run build 2>&1 | grep -E "error|✓ built" | tail -1`
Expected: grid dir all pass + `✓ built`.

- [ ] **Step 7: Commit**

```bash
git add app/src/pages/charts/grid/groupRecents.js app/src/pages/charts/grid/groupRecents.test.js app/src/pages/charts/grid/GroupPicker.jsx app/src/pages/charts/grid/MultiChartMenu.jsx
git commit -m "feat(groups): fast-switch — recents strip + prev/next group arrows"
```

---

## Final verification (after all tasks)

- Backend: `python -m pytest tests/test_groups.py -q` — all green.
- Frontend: `cd app && npx vitest run --pool=threads src/pages/charts/grid/` — all green.
- Build: `cd app && npm run build` — `✓ built`.
- Manual (visible tab, local dev): (1) type an off-taxonomy ticker (e.g. `SNDK`) into a group cell → seed appears instantly, AI peers stream in within ~2s; (2) toggle Sync time range → pan one cell, all follow, no runaway; (3) save a Group board, reload, reopen it → comes back as a live group (Refresh works); (4) pick a group with an ETF → cell 0 is the ETF; (5) ‹ ›/recents switch groups fast.

## Non-goals (still deferred)

RVOL badge (no cheap source yet); drag-to-rearrange; per-cell drawing tools; Perplexity fallback; the taxonomy curation itself (the chartable filter's worklist is the trigger, owner-driven).
