# Breadth Grouping — Theme Dimension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Theme" as a third grouping dimension (alongside Sector/Industry) on the breadth +4%/-4% stock lists (DrillModal + CustomScan).

**Architecture:** A ticker's "primary theme" (its highest-tier UCT theme membership: core > relevant > peripheral, tie-broken by `theme_id`) is resolved via a new shared helper `theme_db._resolve_primary()`, reused by both the existing single-ticker `ticker_meta._primary_theme()` (powers chart watermarks) and a new batch `theme_db.get_theme_map()` (powers this feature). A new `POST /api/breadth/themes` endpoint mirrors the existing `/api/breadth/industries` endpoint's shape and error-degradation contract. The frontend grouping hook chain (`useGroupMeta` → `useBreadthGrouping` → `GroupControls`) gains a third `theme` dimension alongside the existing `sector`/`industry` ones.

**Tech Stack:** FastAPI + SQLite (backend), React + Vite + Vitest (frontend), pytest (backend tests).

**Spec:** `docs/superpowers/specs/2026-07-11-breadth-theme-grouping-design.md`

## Global Constraints

- Primary-theme tie-break is **tier rank (core=0, relevant=1, peripheral=2) then alphabetical `theme_id`** — must match `ticker_meta._primary_theme()`'s existing algorithm exactly, since that value is shown in chart watermarks app-wide. Do not use `display_order` as the tie-break.
- `POST /api/breadth/themes` must never raise past a 400 (bad body) — a lookup failure degrades to `{t: None for t in tickers}`, same posture as `/api/breadth/industries`.
- Ticker list input is capped at 500 per request, same as the industries endpoint.
- No caching/self-heal layer for `get_theme_map()` — `theme_memberships` is a small (1,928 rows), fully-seeded, static local table, unlike the externally-sourced `industry_map`.
- Existing tests `test_ticker_meta.py::test_primary_theme_prefers_core_then_relevant_then_peripheral` and `::test_primary_theme_none_when_no_membership_or_error` must still pass unchanged after the `_primary_theme` refactor.

---

## File Structure

**New files**
- `tests/test_breadth_themes.py` — covers `theme_db._resolve_primary`, `theme_db.get_theme_map`, and the `POST /api/breadth/themes` endpoint (mirrors `tests/test_breadth_industries.py`'s combined service+endpoint style).

**Modified files**
- `api/services/theme_db.py` — add `_TIER_RANK`, `_resolve_primary(rows)`, `get_theme_map(tickers)`.
- `api/services/ticker_meta.py` — refactor `_primary_theme()` to call `theme_db._resolve_primary` instead of its own inline sort; remove the now-redundant local `_TIER_RANK`.
- `api/routers/breadth_monitor.py` — add `POST /api/breadth/themes`.
- `app/src/pages/breadth/grouping/useGroupMeta.js` — fetch `/api/breadth/themes` in parallel with the existing industries/sectors fetch; return `{ industries, sectors, themes }`.
- `app/src/pages/breadth/grouping/useBreadthGrouping.js` — allow `dimension: 'theme'`; pick `meta.themes` as `labelByTicker` when active.
- `app/src/pages/breadth/grouping/GroupControls.jsx` — add a third "Theme" segmented button.
- `app/src/pages/breadth/grouping/GroupSummaryStrip.jsx` — replace the hardcoded binary `sector`/`industry` ternary with a three-way label lookup that includes `theme`.
- `app/src/pages/breadth/grouping/GroupSummaryStrip.test.jsx` — add a `dimension="theme"` case.

**Reference (do not modify):** `api/services/auth_db.py` (`get_connection`, `_DB_PATH` — theme_db's connection source), `app/src/pages/breadth/grouping/groupItems.js` (already label-agnostic, no changes needed), `app/src/pages/Breadth.jsx` / `app/src/pages/CustomScan.jsx` (both pass `dimension`/`setDimension` through generically — no changes needed).

---

## Task 1: `theme_db._resolve_primary()` — shared tie-break helper

**Files:**
- Modify: `api/services/theme_db.py`
- Test: `tests/test_breadth_themes.py` (create)

**Interfaces:**
- Produces: `theme_db._resolve_primary(rows: list[dict] | None) -> dict | None` — given rows shaped like `get_themes_for_ticker()`'s return value (each a dict with at least `theme_name`, `tier`, `theme_id`), returns the single row with the lowest `(tier_rank, theme_id)`, or `None` if `rows` is falsy.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_breadth_themes.py
"""Tests for the theme taxonomy DB batch lookup behind the breadth "group by
theme" drill view, plus the POST /api/breadth/themes endpoint.

Verifies primary-theme resolution (core > relevant > peripheral, tie-broken
by theme_id) matches the existing single-ticker ticker_meta._primary_theme
algorithm, that the batch path returns one entry per requested ticker, and
that the endpoint degrades to nulls rather than raising.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import auth_db
from api.services import theme_db


def test_resolve_primary_prefers_core_then_relevant_then_peripheral():
    rows = [
        {"theme_name": "Peripheral One", "tier": "peripheral", "theme_id": "a"},
        {"theme_name": "Core One", "tier": "core", "theme_id": "z"},
        {"theme_name": "Relevant One", "tier": "relevant", "theme_id": "b"},
    ]
    primary = theme_db._resolve_primary(rows)
    assert primary["theme_name"] == "Core One"


def test_resolve_primary_tie_breaks_by_theme_id():
    rows = [
        {"theme_name": "Semiconductors", "tier": "core", "theme_id": "semis"},
        {"theme_name": "Artificial Intelligence", "tier": "core", "theme_id": "ai"},
    ]
    primary = theme_db._resolve_primary(rows)
    assert primary["theme_name"] == "Artificial Intelligence"  # "ai" < "semis"


def test_resolve_primary_none_for_empty_or_missing():
    assert theme_db._resolve_primary([]) is None
    assert theme_db._resolve_primary(None) is None


def test_resolve_primary_unknown_tier_ranks_last():
    rows = [
        {"theme_name": "Weird", "tier": "watchlist", "theme_id": "a"},
        {"theme_name": "Peripheral One", "tier": "peripheral", "theme_id": "z"},
    ]
    primary = theme_db._resolve_primary(rows)
    assert primary["theme_name"] == "Peripheral One"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_breadth_themes.py -v`
Expected: FAIL with `AttributeError: module 'api.services.theme_db' has no attribute '_resolve_primary'`

- [ ] **Step 3: Implement `_resolve_primary` in `theme_db.py`**

Add this between `get_themes_for_ticker` (ends line 170 with `conn.close()`) and `get_theme_holdings` (starts line 173) in the current file:

```python
# Tier priority: a ticker's "core" theme membership beats "relevant" beats
# "peripheral". Shared by ticker_meta._primary_theme (single-ticker, powers
# chart watermarks) and get_theme_map (batch, powers Breadth "group by
# theme") so a ticker's primary theme agrees everywhere it's shown.
_TIER_RANK = {"core": 0, "relevant": 1, "peripheral": 2}


def _resolve_primary(rows):
    """Pick the single most-relevant theme membership row from `rows` (as
    returned by get_themes_for_ticker): lowest (tier_rank, theme_id) wins.
    Returns None if `rows` is empty or None."""
    if not rows:
        return None
    return sorted(
        rows,
        key=lambda m: (_TIER_RANK.get(m.get("tier"), 99), m.get("theme_id") or ""),
    )[0]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_breadth_themes.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add api/services/theme_db.py tests/test_breadth_themes.py
git commit -m "feat(theme_db): add shared primary-theme tie-break helper"
```

---

## Task 2: Refactor `ticker_meta._primary_theme()` to reuse `_resolve_primary`

**Files:**
- Modify: `api/services/ticker_meta.py:116-138`
- Test: `tests/test_ticker_meta.py` (existing — no changes, run as regression check)

**Interfaces:**
- Consumes: `theme_db._resolve_primary` (Task 1).
- Produces: `ticker_meta._primary_theme(ticker: str) -> str | None` — same public signature and behavior as before, now delegating its tie-break to `theme_db._resolve_primary`.

- [ ] **Step 1: Confirm the existing tests currently pass (baseline)**

Run: `python -m pytest tests/test_ticker_meta.py -v`
Expected: all tests PASS (this establishes the pre-refactor baseline — no test changes in this task)

- [ ] **Step 2: Replace the inline tier-rank + sort with a call to `theme_db._resolve_primary`**

In `api/services/ticker_meta.py`, replace lines 116-138 (the `_TIER_RANK` constant and `_primary_theme` function) with:

```python
def _primary_theme(ticker: str):
    """The single most-relevant UCT theme name for a ticker, or None.

    Cheap indexed SQLite lookup via the theme taxonomy DB — read fresh each
    call (sub-ms) so taxonomy edits reflect immediately and it never caches a
    stale theme. Never raises (theme DB may be unseeded in some contexts).
    Tie-break lives in theme_db._resolve_primary — shared with the batch
    get_theme_map() used by Breadth grouping, so a ticker's primary theme
    agrees everywhere it's shown (this field AND the Breadth "group by
    theme" bucket)."""
    ticker = (ticker or "").upper().strip()
    if not ticker:
        return None
    try:
        from api.services.theme_db import get_themes_for_ticker, _resolve_primary
        rows = get_themes_for_ticker(ticker)
        primary = _resolve_primary(rows)
        if not primary:
            return None
        return primary.get("theme_name") or None
    except Exception as e:
        _logger.info("ticker_meta theme lookup failed for %s: %s", ticker, e)
        return None
```

- [ ] **Step 3: Run tests to verify the refactor is behavior-preserving**

Run: `python -m pytest tests/test_ticker_meta.py -v`
Expected: all tests PASS, identical to Step 1's baseline (in particular
`test_primary_theme_prefers_core_then_relevant_then_peripheral` and
`test_primary_theme_none_when_no_membership_or_error`)

- [ ] **Step 4: Commit**

```bash
git add api/services/ticker_meta.py
git commit -m "refactor(ticker_meta): delegate primary-theme tie-break to theme_db"
```

---

## Task 3: `theme_db.get_theme_map()` — batch primary-theme lookup

**Files:**
- Modify: `api/services/theme_db.py`
- Test: `tests/test_breadth_themes.py`

**Interfaces:**
- Consumes: `theme_db._resolve_primary` (Task 1), `theme_db.get_connection` (existing import from `auth_db`).
- Produces: `theme_db.get_theme_map(tickers: list[str]) -> dict[str, str | None]` — one entry per requested ticker (deduped, upper-cased), `None` for tickers with no theme membership. Same always-present-key contract as `industry_map.get_groups()`.

- [ ] **Step 1: Add the DB fixture and write the failing tests**

Append to `tests/test_breadth_themes.py`:

```python
@pytest.fixture()
def tdb(tmp_path, monkeypatch):
    """Isolated theme DB: theme_db.get_connection() resolves through
    auth_db._DB_PATH (same mechanism as test_support_tickets.py /
    test_broker_sync.py use for auth_db-backed services)."""
    db_path = str(tmp_path / "theme_test.db")
    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)
    theme_db.init_theme_tables()
    conn = theme_db.get_connection()
    try:
        conn.execute("INSERT INTO theme_sectors (id, name, display_order) VALUES ('tech', 'Technology', 1)")
        conn.executemany(
            "INSERT INTO themes (id, name, sector_id, display_order) VALUES (?, ?, 'tech', ?)",
            [
                ("semis", "Semiconductors", 1),
                ("ai", "Artificial Intelligence", 2),
                ("quantum", "Quantum Computing", 3),
            ],
        )
        conn.executemany(
            "INSERT INTO theme_memberships (theme_id, sym, tier) VALUES (?, ?, ?)",
            [
                ("semis", "NVDA", "core"),
                ("ai", "NVDA", "core"),       # ties with semis at 'core' -> 'ai' wins alphabetically
                ("quantum", "NVDA", "relevant"),
                ("semis", "AMD", "peripheral"),
            ],
        )
        conn.commit()
    finally:
        conn.close()
    return db_path


def test_get_theme_map_picks_highest_tier(tdb):
    out = theme_db.get_theme_map(["AMD"])
    assert out == {"AMD": "Semiconductors"}


def test_get_theme_map_tie_breaks_by_theme_id(tdb):
    out = theme_db.get_theme_map(["NVDA"])
    assert out == {"NVDA": "Artificial Intelligence"}


def test_get_theme_map_returns_none_for_unclassified(tdb):
    out = theme_db.get_theme_map(["ZZZZ"])
    assert out == {"ZZZZ": None}


def test_get_theme_map_uppercases_and_dedupes(tdb):
    out = theme_db.get_theme_map(["amd", "AMD", ""])
    assert out == {"AMD": "Semiconductors"}


def test_get_theme_map_multiple_tickers_one_call(tdb):
    out = theme_db.get_theme_map(["AMD", "NVDA", "ZZZZ"])
    assert out == {
        "AMD": "Semiconductors",
        "NVDA": "Artificial Intelligence",
        "ZZZZ": None,
    }


def test_get_theme_map_empty_input(tdb):
    assert theme_db.get_theme_map([]) == {}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_breadth_themes.py -v`
Expected: FAIL with `AttributeError: module 'api.services.theme_db' has no attribute 'get_theme_map'`

- [ ] **Step 3: Implement `get_theme_map` in `theme_db.py`**

Add directly after `_resolve_primary` (from Task 1):

```python
def get_theme_map(tickers):
    """Batch primary-theme lookup for the Breadth "group by theme" view.

    Returns {TICKER: theme_name|None} — one entry per requested ticker
    (deduped, upper-cased), matching industry_map.get_groups()'s
    always-present-key contract. No caching/self-heal: theme_memberships is
    a small, fully-seeded, static local table (re-populated wholesale from
    themes_taxonomy.json on deploy), not an externally-sourced cache."""
    seen = set()
    want = []
    for raw in (tickers or []):
        if not raw:
            continue
        t = str(raw).upper().strip()
        if t and t not in seen:
            seen.add(t)
            want.append(t)
    if not want:
        return {}

    by_sym = {}
    conn = get_connection()
    try:
        for i in range(0, len(want), 400):
            chunk = want[i:i + 400]
            placeholders = ",".join("?" * len(chunk))
            rows = conn.execute(f"""
                SELECT tm.sym, tm.tier, tm.theme_id, t.name as theme_name
                FROM theme_memberships tm
                JOIN themes t ON tm.theme_id = t.id
                WHERE tm.sym IN ({placeholders})
            """, chunk).fetchall()
            for r in rows:
                by_sym.setdefault(r["sym"], []).append(dict(r))
    finally:
        conn.close()

    out = {}
    for t in want:
        primary = _resolve_primary(by_sym.get(t))
        out[t] = primary["theme_name"] if primary else None
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_breadth_themes.py -v`
Expected: 10 passed (4 from Task 1 + 6 new)

- [ ] **Step 5: Commit**

```bash
git add api/services/theme_db.py tests/test_breadth_themes.py
git commit -m "feat(theme_db): add get_theme_map batch primary-theme lookup"
```

---

## Task 4: `POST /api/breadth/themes` endpoint

**Files:**
- Modify: `api/routers/breadth_monitor.py`
- Test: `tests/test_breadth_themes.py`

**Interfaces:**
- Consumes: `theme_db.get_theme_map` (Task 3).
- Produces: `POST /api/breadth/themes` — body `{"tickers": [...]}` → `{"themes": {TICKER: name|None}}`. 400 on non-list `tickers` or invalid JSON. Never 500s — degrades to nulls on internal error.

- [ ] **Step 1: Write the failing endpoint tests**

Append to `tests/test_breadth_themes.py`:

```python
# ── Endpoint ────────────────────────────────────────────────────────────────

@pytest.fixture()
def client(tdb):
    from api.routers import breadth_monitor
    app = FastAPI()
    app.include_router(breadth_monitor.router)
    return TestClient(app)


def test_endpoint_shape(client):
    r = client.post("/api/breadth/themes", json={"tickers": ["AMD", "NOPE"]})
    assert r.status_code == 200
    body = r.json()
    assert body["themes"]["AMD"] == "Semiconductors"
    assert body["themes"]["NOPE"] is None


def test_endpoint_caps_at_500(client):
    r = client.post("/api/breadth/themes", json={"tickers": [f"T{i}" for i in range(900)]})
    assert r.status_code == 200
    assert len(r.json()["themes"]) == 500


def test_endpoint_bad_body(client):
    r = client.post("/api/breadth/themes", json={"tickers": "notalist"})
    assert r.status_code == 400


def test_endpoint_degrades_on_lookup_error(client, monkeypatch):
    from api.services import theme_db as tdb_module

    def _boom(tickers):
        raise RuntimeError("db down")

    monkeypatch.setattr(tdb_module, "get_theme_map", _boom)
    r = client.post("/api/breadth/themes", json={"tickers": ["AMD"]})
    assert r.status_code == 200
    assert r.json()["themes"]["AMD"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_breadth_themes.py -v`
Expected: FAIL with 404 (route doesn't exist yet) on the four new endpoint tests

- [ ] **Step 3: Implement the endpoint in `breadth_monitor.py`**

Add directly after the existing `breadth_industries_refresh` function, which ends at line 182 (`raise HTTPException(status_code=500, detail=str(e))`) — insert before the blank lines that precede `@router.patch("/api/breadth-monitor/{date_str}/field")` at line 185. The file has more routes after this point (a `PATCH .../field` route) — do not append at the true end of the file, insert at this specific spot so the new route sits next to its `/api/breadth/*` siblings:

```python
@router.post("/api/breadth/themes")
async def breadth_themes(request: Request):
    """Map a list of tickers → primary UCT theme for the drill-down "group by"
    view. A ticker can belong to multiple themes; this returns its single
    highest-tier membership (core > relevant > peripheral, tie-broken by
    theme_id) — the same resolution ticker_meta._primary_theme uses for
    chart watermarks, so a stock's theme group always matches what's shown
    elsewhere.

    Body: {"tickers": ["NVDA", ...]}  →  {"themes": {"NVDA": "Artificial Intelligence", ...}}
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    tickers = body.get("tickers") or []
    if not isinstance(tickers, list):
        raise HTTPException(status_code=400, detail="tickers must be a list")
    tickers = [str(t).upper() for t in tickers if t][:500]
    try:
        from api.services import theme_db
        themes = theme_db.get_theme_map(tickers)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("[breadth] themes lookup failed: %s", e)
        themes = {t: None for t in tickers}
    return {"themes": themes}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_breadth_themes.py -v`
Expected: 14 passed

- [ ] **Step 5: Run the full existing industries test suite as a regression check**

Run: `python -m pytest tests/test_breadth_industries.py tests/test_ticker_meta.py tests/test_breadth_themes.py -v`
Expected: all PASS — confirms the new endpoint/router changes didn't disturb the neighboring `/api/breadth/industries` route or `ticker_meta`.

- [ ] **Step 6: Commit**

```bash
git add api/routers/breadth_monitor.py tests/test_breadth_themes.py
git commit -m "feat(breadth): add POST /api/breadth/themes endpoint"
```

---

## Task 5: `GroupSummaryStrip.jsx` — fix hardcoded dimension label

**Files:**
- Modify: `app/src/pages/breadth/grouping/GroupSummaryStrip.jsx`
- Test: `app/src/pages/breadth/grouping/GroupSummaryStrip.test.jsx`

**Interfaces:**
- Consumes: `dimension` prop (now `'sector' | 'industry' | 'theme'`).
- Produces: no change to exported shape — same default-export component.

- [ ] **Step 1: Write the failing test**

Add to `app/src/pages/breadth/grouping/GroupSummaryStrip.test.jsx`, inside the existing `describe('GroupSummaryStrip', ...)` block:

```js
  it('shows "Top themes" for the theme dimension', () => {
    const summary = [{ key: 'Artificial Intelligence', count: 9, avgPct: 5.2 }]
    render(<GroupSummaryStrip summary={summary} dimension="theme" />)
    expect(screen.getByText('Top themes')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/breadth/grouping/GroupSummaryStrip.test.jsx`
Expected: FAIL — the new test can't find text "Top themes" (renders "Top industries" instead, since `dimension === 'sector' ? 'sectors' : 'industries'` falls through to the `industries` branch for any non-`'sector'` value)

- [ ] **Step 3: Fix the hardcoded ternary**

In `app/src/pages/breadth/grouping/GroupSummaryStrip.jsx`, add a module-level label map above the component and use it in the JSX:

```jsx
import styles from './GroupSummaryStrip.module.css'

const DIMENSION_LABELS = { sector: 'sectors', industry: 'industries', theme: 'themes' }

// One-line leaderboard above a grouped list: which groups dominate today.
//   summary — [{ key, count, avgPct }] | null (from useBreadthGrouping)
//   onPick  — optional (key) => void  (e.g. collapse/expand that group)
export default function GroupSummaryStrip({ summary, dimension, onPick }) {
  if (!summary || !summary.length) return null
  const real = summary.filter(s => s.key !== 'Unclassified')
  if (!real.length) return null
  return (
    <div className={styles.strip}>
      <span className={styles.lead}>Top {DIMENSION_LABELS[dimension] || 'groups'}</span>
      {real.map(s => (
        <button
          key={s.key}
          type="button"
          className={styles.chip}
          onClick={onPick ? () => onPick(s.key) : undefined}
          title={onPick ? 'Jump to this group' : undefined}
        >
          <span className={styles.name}>{s.key}</span>
          <span className={styles.count}>{s.count}</span>
          <span className={s.avgPct >= 0 ? styles.up : styles.dn}>
            {s.avgPct > 0 ? '+' : ''}{s.avgPct.toFixed(1)}%
          </span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/breadth/grouping/GroupSummaryStrip.test.jsx`
Expected: 4 passed (3 existing + 1 new)

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/grouping/GroupSummaryStrip.jsx app/src/pages/breadth/grouping/GroupSummaryStrip.test.jsx
git commit -m "fix(breadth): GroupSummaryStrip theme dimension label"
```

---

## Task 6: Wire the Theme dimension through the frontend grouping hook chain

**Files:**
- Modify: `app/src/pages/breadth/grouping/useGroupMeta.js`
- Modify: `app/src/pages/breadth/grouping/useBreadthGrouping.js`
- Modify: `app/src/pages/breadth/grouping/GroupControls.jsx`

**Interfaces:**
- Consumes: `POST /api/breadth/themes` (Task 4).
- Produces: `useGroupMeta(tickers)` now returns `{ industries, sectors, themes }`; `useBreadthGrouping(...)`'s `dimension` state accepts `'theme'`; `GroupControls` renders a third "Theme" button that calls `setDimension('theme')`.

No dedicated test files exist today for these three modules (confirmed via `useBreadthGrouping.js` and `GroupControls.jsx` having zero test files, and they're only exercised indirectly through `Breadth.jsx`/`CustomScan.jsx`) — this task is verified via manual smoke test in Step 4 plus the full existing frontend suite in Step 5, consistent with the spec's decision not to add new test files for this tier.

- [ ] **Step 1: Extend `useGroupMeta.js` to fetch themes in parallel**

Replace the full contents of `app/src/pages/breadth/grouping/useGroupMeta.js` with:

```js
import { useState, useEffect } from 'react'

// Fetches { industries, sectors, themes } maps for a list of tickers.
// industries/sectors come from the universe industry map (Finviz-seeded,
// with cold-cache stragglers backfilled server-side — hence the one delayed
// retry). themes comes from the local UCT theme taxonomy DB (fully seeded,
// static — no cold-cache concept, so no retry). Non-blocking on the server.
// Shared by every grouped breadth surface.
//
//   tickers — array of ticker strings (stable reference preferred)
// Returns { industries: {T:ind|null}, sectors: {T:sec|null}, themes: {T:theme|null} }
export default function useGroupMeta(tickers) {
  const [meta, setMeta] = useState({ industries: {}, sectors: {}, themes: {} })

  useEffect(() => {
    if (!tickers || !tickers.length) return
    let cancelled = false
    const syms = tickers.filter(Boolean)

    const fetchIndustries = () => fetch('/api/breadth/industries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: syms }),
    })
      .then(r => r.json())
      .then(d => {
        if (cancelled || !d) return false
        setMeta(prev => ({
          ...prev,
          industries: { ...prev.industries, ...(d.industries || {}) },
          sectors: { ...prev.sectors, ...(d.sectors || {}) },
        }))
        // any industry still missing? (cold-cache straggler being warmed)
        return Object.values(d.industries || {}).some(v => !v)
      })
      .catch(() => false)

    fetchIndustries().then(hadMisses => {
      if (cancelled || !hadMisses) return
      setTimeout(() => { if (!cancelled) fetchIndustries() }, 2500)
    })

    fetch('/api/breadth/themes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: syms }),
    })
      .then(r => r.json())
      .then(d => {
        if (cancelled || !d) return
        setMeta(prev => ({ ...prev, themes: { ...prev.themes, ...(d.themes || {}) } }))
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [tickers])

  return meta
}
```

- [ ] **Step 2: Extend `useBreadthGrouping.js` to allow the `theme` dimension**

In `app/src/pages/breadth/grouping/useBreadthGrouping.js`, change line 27:

```js
  const [dimension, setDimensionState] = useState(() => readLS(LS_DIM, ['industry', 'sector'], 'industry'))
```

to:

```js
  const [dimension, setDimensionState] = useState(() => readLS(LS_DIM, ['industry', 'sector', 'theme'], 'industry'))
```

And change line 51:

```js
  const labelByTicker = dimension === 'sector' ? meta.sectors : meta.industries
```

to:

```js
  const labelByTicker = dimension === 'sector' ? meta.sectors
    : dimension === 'theme' ? meta.themes
      : meta.industries
```

- [ ] **Step 3: Add the "Theme" button to `GroupControls.jsx`**

In `app/src/pages/breadth/grouping/GroupControls.jsx`, add a third button inside the `dimension` toggle group (after the "Industry" button, before the closing `</div>` at line 31):

```jsx
      {viewMode === 'grouped' && (
        <div className={styles.toggle} role="group" aria-label="Group dimension">
          <button
            className={`${styles.btn} ${dimension === 'sector' ? styles.active : ''}`}
            onClick={() => setDimension('sector')}
            title="Group by GICS sector — 11 broad buckets (macro read)"
          >Sector</button>
          <button
            className={`${styles.btn} ${dimension === 'industry' ? styles.active : ''}`}
            onClick={() => setDimension('industry')}
            title="Group by industry — granular clusters"
          >Industry</button>
          <button
            className={`${styles.btn} ${dimension === 'theme' ? styles.active : ''}`}
            onClick={() => setDimension('theme')}
            title="Group by UCT theme — story-driven clusters"
          >Theme</button>
        </div>
      )}
```

- [ ] **Step 4: Manual smoke test**

Run the dev servers:

```bash
uvicorn api.main:app --reload --port 8000
```

```bash
cd app && npm run dev
```

In the browser: open the Breadth page, click into a drill (e.g. "Up 4% Today"), switch to Grouped view, and confirm a third "Theme" button appears next to Sector/Industry. Click it and confirm stocks regroup under theme names (e.g. "Semiconductors", "Artificial Intelligence") instead of sectors/industries, and that the summary strip above the list reads "Top themes".

- [ ] **Step 5: Run the full frontend test suite for the grouping folder as a regression check**

Run: `cd app && npx vitest run src/pages/breadth/grouping/`
Expected: all PASS (no test files exist for the three modified files themselves, but `groupItems.test.js` and `GroupSummaryStrip.test.jsx` must stay green)

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/breadth/grouping/useGroupMeta.js app/src/pages/breadth/grouping/useBreadthGrouping.js app/src/pages/breadth/grouping/GroupControls.jsx
git commit -m "feat(breadth): wire Theme as a third grouping dimension"
```

---

## Task 7: Final end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite for every file touched this plan**

Run: `python -m pytest tests/test_breadth_themes.py tests/test_breadth_industries.py tests/test_ticker_meta.py -v`
Expected: all PASS

- [ ] **Step 2: Run the full frontend test suite for every file touched this plan**

Run: `cd app && npx vitest run src/pages/breadth/grouping/`
Expected: all PASS

- [ ] **Step 3: Manual smoke test on both consumer surfaces**

With both dev servers running (from Task 6 Step 4):
1. Breadth page (`/breadth`) → open a drill modal → Grouped → Theme. Confirm regrouping works and the dimension choice persists (localStorage `breadth.group.dimension`) across a page refresh.
2. Scanner page (`/screener`) → CustomScan tab → Grouped → Theme. Confirm the same regrouping behavior there (shared hook chain).

- [ ] **Step 4: Report completion**

No further commit needed — this task is verification-only. If any step fails, return to the relevant task above and fix before considering the plan complete.
