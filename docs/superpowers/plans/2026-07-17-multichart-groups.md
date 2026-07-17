# Multi-Chart "Groups" Mode — Implementation Plan (v1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Groups" mode to the `/charts` multi-chart grid: pick a theme → the grid fills with that theme's most-active names (today's-move ranked); commit a ticker → the other cells fill with its peers. Fast group-to-group scanning during and after market hours.

**Architecture:** A new `/api/groups` router (identity/holdings from `theme_db` SQLite, ranking overlay from `theme_performance` + `rs_ranking`, peers derived from the taxonomy) hands the React client a clean, **chartable** ordered ticker list. The client fills grid cells via a new single-transaction `fillCells()` that routes symbol changes through the existing mount queue (fetch-herd safe), tracks the current group for Refresh/restore, and renders a heat layer (group header + per-cell badges).

**Tech Stack:** FastAPI (Python) backend, React + Vite frontend, SQLite (`theme_db`), lightweight-charts v5 (`StockChart`), pytest (backend), vitest (frontend, run with `--pool=threads`).

## Global Constraints

- **Canonical ticker form is HYPHEN + uppercase** (`BRK-B`) — matches `cap_universe.json`, `/api/ticker-search`, `/api/bars`. The taxonomy (`theme_db`) stores **dot** class-shares (`BRK.B`). Convert with `to_taxonomy_sym()` for `theme_db` queries; return/chart/validate everything else in hyphen form.
- **Never place a non-chartable symbol in a cell.** A holding is chartable iff `normalize_sym(sym) in cap_universe`. Filter before returning from any endpoint.
- **`get_rs_for_ticker` / `compute_rs_scores` are cache-only and return `[]`/`None` when cold** (post-deploy, ~2.5 min). `theme_performance.get_theme_performance()` returns `{"themes": [], "status": "computing"}` when cold. Ranking MUST fall back to the taxonomy's curated tier order so a cold group still fills.
- **Compute top-N server-side from ONE ranked list.** Never call `/api/rs-rankings/{ticker}` per holding (N+1 over ~500 items).
- **`fillCells` must be a single `apply(prev => …)` transaction** (never a loop of `updateCellAt` — that races the 500 ms debounced pref save reading a stale `stateRef`).
- **Mount queue is keyed on cell `id` today.** Symbol swaps (group→group) must re-enter the throttle or they reintroduce the 2026-05-24 fetch-herd (16 simultaneous cold `/api/bars`). Key the queue on `${id}::${sym}` and gate the *sym the cell loads*, not whether it's mounted (no remount).
- **Do NOT duplicate the SSE stream** — `priceStreamManager`/`barsStreamManager` pool browser-wide; group cells reuse it.
- **Grid state extension must go through `sanitizeState`'s allowlist** or it's stripped on reload. Add `group` + `syncTimeRange` explicitly.
- **No emoji as UI icons** — use `UIcon` (per repo CLAUDE.md).
- **Deploy is push-frozen 9:15 AM–4:20 PM ET.** This plan is committed locally; shipping happens off-hours or via the owner-authorized override.

---

## File structure

**Backend — create:**
- `api/services/groups.py` — symbol normalization, chartable filter, group list, top-N ranking, seed→theme resolver, peer resolver.
- `api/routers/groups.py` — `GET /api/groups`, `GET /api/groups/{id}/top`, `GET /api/groups/peers`.
- `tests/test_groups.py` — backend tests.

**Backend — modify:**
- `api/main.py` — register the router (import + `include_router`, as a unit).
- `api/services/ticker_meta.py` — `_primary_theme` delegates to `groups.resolve_primary_theme` so the displayed theme and filled peers agree.

**Frontend — create:**
- `app/src/pages/charts/grid/groupsApi.js` — fetch helpers (`fetchGroups`, `fetchGroupTop`, `fetchPeers`).
- `app/src/pages/charts/grid/symAdmission.js` — pure helper: which cells' new syms are admitted by the mount queue this render.
- `app/src/pages/charts/grid/GroupPicker.jsx` — the group picker (rendered in `MultiChartMenu`).
- `app/src/pages/charts/grid/GroupHeatHeader.jsx` — the group-heat summary bar.
- Tests: `groupsApi.test.js`, `symAdmission.test.js`, `GroupPicker.test.jsx`, plus additions to `gridLayouts.test.js` and a new `useMultiChartState.test.jsx`.

**Frontend — modify:**
- `app/src/pages/charts/grid/gridLayouts.js` — `sanitizeState` carries `group` + `syncTimeRange`.
- `app/src/pages/charts/grid/useMultiChartState.js` — `fillCells`, `setGroup`, `clearGroup`; `parseRaw` carries `group`.
- `app/src/pages/charts/grid/MultiChartGrid.jsx` — composite mount-queue keys + sym-admission gate; group-fill on committed ticker + async latch + Undo; render `GroupHeatHeader`; pass per-cell badge/rationale.
- `app/src/pages/charts/grid/GridChartCell.jsx` — accept a `badge` + `rationale` prop; commit-only `onCommitSym` for group mode.
- `app/src/pages/charts/grid/MultiChartMenu.jsx` — mount `GroupPicker`; Refresh + "Exit Groups" when a group is active.

---

## Task 1: Symbol normalization + chartable filter

**Files:**
- Create: `api/services/groups.py`
- Test: `tests/test_groups.py`

**Interfaces:**
- Produces: `normalize_sym(s: str) -> str` (uppercase, dot→hyphen); `to_taxonomy_sym(s: str) -> str` (uppercase, hyphen→dot); `cap_universe_set() -> set[str]` (cached); `is_chartable(sym: str) -> bool`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_groups.py
from api.services import groups


def test_normalize_sym_hyphen_and_upper():
    assert groups.normalize_sym("brk.b") == "BRK-B"
    assert groups.normalize_sym("AAPL") == "AAPL"
    assert groups.normalize_sym(" nvda ") == "NVDA"


def test_to_taxonomy_sym_uses_dot():
    assert groups.to_taxonomy_sym("BRK-B") == "BRK.B"
    assert groups.to_taxonomy_sym("aapl") == "AAPL"


def test_is_chartable_uses_cap_universe(monkeypatch):
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"AAPL", "BRK-B"})
    assert groups.is_chartable("AAPL") is True
    assert groups.is_chartable("brk.b") is True     # normalized to BRK-B
    assert groups.is_chartable("ZZZZ") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_groups.py -q`
Expected: FAIL (`ModuleNotFoundError: api.services.groups`)

- [ ] **Step 3: Write minimal implementation**

```python
# api/services/groups.py
"""Multi-Chart "Groups" service.

Turns a theme (or a ticker's theme) into a chartable, ranked list of symbols
for the /charts grid. Identity/holdings come from theme_db (SQLite, always
warm); the ranking overlay comes from theme_performance + rs_ranking with a
cold-cache fallback to the taxonomy's curated tier order.

CANONICAL SYMBOL FORM IS HYPHEN + UPPERCASE (BRK-B) — matches cap_universe,
ticker-search, and /api/bars. The taxonomy stores dot class-shares (BRK.B);
convert with to_taxonomy_sym() only for theme_db lookups.
"""
import json
import os
import time

_CAP_CACHE = {"set": None, "at": 0.0}
_CAP_TTL = 3600.0


def normalize_sym(s: str) -> str:
    """App-canonical form for charting/search/cells: uppercase, dot->hyphen."""
    return (s or "").strip().upper().replace(".", "-")


def to_taxonomy_sym(s: str) -> str:
    """Taxonomy (theme_db) form: uppercase, hyphen->dot class-shares."""
    return (s or "").strip().upper().replace("-", ".")


def _cap_universe_path() -> str:
    here = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
    return here if os.path.exists(here) else os.path.join("api", "data", "cap_universe.json")


def cap_universe_set() -> set:
    """Cached set of chartable tickers (hyphen form). 1h TTL."""
    now = time.monotonic()
    if _CAP_CACHE["set"] is not None and (now - _CAP_CACHE["at"]) < _CAP_TTL:
        return _CAP_CACHE["set"]
    out = set()
    try:
        with open(_cap_universe_path(), "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, list):
            out = {normalize_sym(t) for t in data if t}
    except Exception:
        out = set()
    _CAP_CACHE["set"] = out
    _CAP_CACHE["at"] = now
    return out


def is_chartable(sym: str) -> bool:
    return normalize_sym(sym) in cap_universe_set()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_groups.py -q`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add api/services/groups.py tests/test_groups.py
git commit -m "feat(groups): symbol normalization + chartable filter"
```

---

## Task 2: Group list (rotation-sorted, with chartable counts)

**Files:**
- Modify: `api/services/groups.py`
- Test: `tests/test_groups.py`

**Interfaces:**
- Consumes: `theme_db.get_all_themes()` → `{"sectors":[...], "themes":[{id,name,sector_id,etf_ticker,sub_themes,holdings:[{sym,tier,sub_theme_id,rationale}]}]}`; `theme_performance.compute_rotation_signals()`.
- Produces: `list_groups() -> list[dict]` — `[{id, name, sector_id, etf_ticker, total, chartable, sub_theme_count}]`, hot themes first.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_groups.py  (append)
def test_list_groups_shapes_and_chartable_count(monkeypatch):
    fake = {"sectors": [], "themes": [
        {"id": "space", "name": "Space", "sector_id": "innovation",
         "etf_ticker": "UFO", "sub_themes": [{"id": "launch", "name": "Launch"}],
         "holdings": [{"sym": "RKLB"}, {"sym": "ASTS"}, {"sym": "DEADCO"}]},
    ]}
    monkeypatch.setattr(groups, "_get_all_themes", lambda: fake)
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"RKLB", "ASTS"})
    monkeypatch.setattr(groups, "_rotation_order", lambda: {})
    out = groups.list_groups()
    row = next(r for r in out if r["id"] == "space")
    assert row["total"] == 3
    assert row["chartable"] == 2          # DEADCO excluded
    assert row["etf_ticker"] == "UFO"
    assert row["sub_theme_count"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_groups.py::test_list_groups_shapes_and_chartable_count -q`
Expected: FAIL (`AttributeError: module ... has no attribute 'list_groups'`)

- [ ] **Step 3: Write minimal implementation**

```python
# api/services/groups.py  (append)
def _get_all_themes():
    from api.services import theme_db
    return theme_db.get_all_themes()


def _rotation_order():
    """theme_name (lower) -> rank index, hottest first. Empty on cold cache."""
    try:
        from api.services import theme_performance
        sig = theme_performance.compute_rotation_signals()
        themes = sig.get("themes") if isinstance(sig, dict) else sig
        order = {}
        for i, t in enumerate(themes or []):
            nm = (t.get("name") or "").strip().lower()
            if nm:
                order[nm] = i
        return order
    except Exception:
        return {}


def list_groups() -> list:
    data = _get_all_themes()
    cap = cap_universe_set()
    order = _rotation_order()
    rows = []
    for t in data.get("themes", []):
        holdings = t.get("holdings") or []
        chartable = sum(1 for h in holdings if normalize_sym(h.get("sym", "")) in cap)
        rows.append({
            "id": t["id"],
            "name": t["name"],
            "sector_id": t.get("sector_id"),
            "etf_ticker": t.get("etf_ticker"),
            "total": len(holdings),
            "chartable": chartable,
            "sub_theme_count": len(t.get("sub_themes") or []),
        })
    # Hot themes first (rotation rank); themes not in the signal sink to the
    # bottom in stable name order — cold cache => plain alphabetical.
    big = len(rows) + 1
    rows.sort(key=lambda r: (order.get((r["name"] or "").strip().lower(), big), r["name"]))
    return rows
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_groups.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/groups.py tests/test_groups.py
git commit -m "feat(groups): rotation-sorted group list with chartable counts"
```

---

## Task 3: Top-N ranking (today's move, cold-cache fallback chain)

**Files:**
- Modify: `api/services/groups.py`
- Test: `tests/test_groups.py`

**Interfaces:**
- Consumes: `theme_db.get_theme_holdings(theme_id)` → `[{sym, tier, sub_theme_id, rationale}]`; `massive.get_etf_snapshots(list[str]) -> dict[str, float]` (todaysChangePerc); `rs_ranking.compute_rs_scores() -> list[{ticker, rs_rank, returns:{1m,...}}]`.
- Produces: `rank_holdings(holdings, by, seed=None) -> list[str]` (chartable, hyphen, ranked best-first); `top_n(theme_id, n, by="today") -> dict` — `{group_id, syms:[...], total, by, ranked_as_of}`.

Ranking bands (best band wins; within a band, higher value wins; **no-data names sort last, never dropped**):
- `by="today"`: band0 today's %, band1 RS rank, band2 1-month return, band3 curated tier order.
- `by="rs"`: band0 RS rank, band1 today's %, band2 1-month return, band3 tier order.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_groups.py  (append)
def test_rank_holdings_today_then_fallbacks(monkeypatch):
    holdings = [
        {"sym": "AAA", "tier": "core"},       # today +5
        {"sym": "BBB", "tier": "core"},       # no today, rs 80
        {"sym": "CCC", "tier": "relevant"},   # no today, no rs, 1m +12
        {"sym": "DDD", "tier": "peripheral"}, # no data at all -> last, tier order
        {"sym": "DEAD", "tier": "core"},      # not chartable -> excluded
    ]
    monkeypatch.setattr(groups, "cap_universe_set",
                        lambda: {"AAA", "BBB", "CCC", "DDD"})
    monkeypatch.setattr(groups, "_today_map",
                        lambda syms: {"AAA": 5.0})
    monkeypatch.setattr(groups, "_rs_map",
                        lambda: {"BBB": {"rs_rank": 80, "returns": {"1m": 3.0}},
                                 "CCC": {"rs_rank": None, "returns": {"1m": 12.0}}})
    ranked = groups.rank_holdings(holdings, by="today")
    assert ranked == ["AAA", "BBB", "CCC", "DDD"]
    assert "DEAD" not in ranked
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_groups.py::test_rank_holdings_today_then_fallbacks -q`
Expected: FAIL (`AttributeError: rank_holdings`)

- [ ] **Step 3: Write minimal implementation**

```python
# api/services/groups.py  (append)
from api.services.ticker_meta import _TIER_RANK  # {core:0, relevant:1, peripheral:2}


def _today_map(syms: list) -> dict:
    """{sym(hyphen upper): todaysChangePerc}. One batched Massive snapshot; the
    same source theme_performance uses. Empty on failure (falls back to RS)."""
    if not syms:
        return {}
    try:
        from api.services.massive import get_etf_snapshots
        raw = get_etf_snapshots(syms) or {}
        return {normalize_sym(k): v for k, v in raw.items()}
    except Exception:
        return {}


def _rs_map() -> dict:
    """{ticker(hyphen upper): rs item}. Cache-only; {} when cold."""
    try:
        from api.services.rs_ranking import compute_rs_scores
        return {normalize_sym(it["ticker"]): it for it in (compute_rs_scores() or [])}
    except Exception:
        return {}


def rank_holdings(holdings: list, by: str = "today", seed: str = None) -> list:
    """Rank taxonomy holdings; return chartable hyphen syms best-first.

    holdings: [{sym, tier, sub_theme_id?}] in taxonomy (dot) form.
    Excludes the seed and non-chartable names. No-data names sort last.
    """
    cap = cap_universe_set()
    seed_hy = normalize_sym(seed) if seed else None
    cands = []
    for idx, h in enumerate(holdings):
        hy = normalize_sym(h.get("sym", ""))
        if not hy or hy not in cap or hy == seed_hy:
            continue
        cands.append((idx, hy, h))
    if not cands:
        return []

    today = _today_map([hy for _, hy, _ in cands])
    rs = _rs_map()

    def bands(hy, h):
        t = today.get(hy)
        r = rs.get(hy) or {}
        rank = r.get("rs_rank")
        m1 = (r.get("returns") or {}).get("1m")
        tier = _TIER_RANK.get(h.get("tier"), 99)
        metrics = {"today": t, "rs": rank, "m1": m1}
        primary = "today" if by != "rs" else "rs"
        secondary = "rs" if by != "rs" else "today"
        order = [primary, secondary, "m1"]
        for band, key in enumerate(order):
            v = metrics[key]
            if v is not None:
                return (band, -float(v))
        # Band 3: no data — curated tier order, then taxonomy list position.
        return (len(order), tier)

    cands.sort(key=lambda c: (bands(c[1], c[2]), c[0]))
    return [hy for _, hy, _ in cands]


def _ranked_as_of() -> str:
    try:
        from api.services.massive import _detect_session
        return _detect_session()
    except Exception:
        return "unknown"


def top_n(theme_id: str, n: int, by: str = "today") -> dict:
    from api.services import theme_db
    holdings = theme_db.get_theme_holdings(theme_id)
    ranked = rank_holdings(holdings, by=by)
    return {
        "group_id": theme_id,
        "syms": ranked[: max(1, int(n))],
        "total": len(ranked),
        "by": "rs" if by == "rs" else "today",
        "ranked_as_of": _ranked_as_of(),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_groups.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/groups.py tests/test_groups.py
git commit -m "feat(groups): today's-move top-N ranking with cold-cache tier fallback"
```

---

## Task 4: Seed→theme resolver + peer resolver

**Files:**
- Modify: `api/services/groups.py`
- Test: `tests/test_groups.py`

**Interfaces:**
- Consumes: `theme_db.get_themes_for_ticker(sym)` → `[{theme_id, theme_name, tier, sub_theme_id, ...}]`; `theme_db.get_theme_holdings(theme_id)`.
- Produces: `resolve_primary_theme(sym) -> dict | None` (the seed's membership row for the chosen theme — tier-first, factor buckets excluded); `resolve_peers(sym, n) -> dict` — `{seed, group_id|None, peers:[...], source: "taxonomy"|"none"}`.

Resolver rule (fixes NVDA→Video Games, GE→Hydrogen-peripheral, V/MA→Bitcoin): pick the membership whose `(tier_rank, theme_size, theme_id)` is smallest — i.e. the **smallest theme where the seed ranks highest by tier** — after excluding factor/style buckets by name.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_groups.py  (append)
def test_resolve_primary_theme_prefers_core_over_smaller_relevant(monkeypatch):
    # NVDA: core in Semiconductors (size 3) + AI (size 3); relevant in
    # Video Games (size 2, the "fewest holdings"). Core must win.
    rows = [
        {"theme_id": "semis", "theme_name": "Semiconductors", "tier": "core", "sub_theme_id": None},
        {"theme_id": "video_games", "theme_name": "Video Games", "tier": "relevant", "sub_theme_id": None},
    ]
    monkeypatch.setattr(groups, "_themes_for_ticker", lambda s: rows)
    monkeypatch.setattr(groups, "_theme_size", lambda tid: {"semis": 3, "video_games": 2}.get(tid, 0))
    r = groups.resolve_primary_theme("NVDA")
    assert r["theme_id"] == "semis"


def test_resolve_primary_theme_excludes_factor_buckets(monkeypatch):
    rows = [
        {"theme_id": "meme_retail", "theme_name": "Meme & Retail", "tier": "core", "sub_theme_id": None},
        {"theme_id": "fintech", "theme_name": "Fintech", "tier": "relevant", "sub_theme_id": None},
    ]
    monkeypatch.setattr(groups, "_themes_for_ticker", lambda s: rows)
    monkeypatch.setattr(groups, "_theme_size", lambda tid: 10)
    r = groups.resolve_primary_theme("PLTR")
    assert r["theme_id"] == "fintech"   # Meme & Retail excluded


def test_resolve_peers_sub_theme_first_then_widen(monkeypatch):
    seed_row = {"theme_id": "space", "theme_name": "Space", "tier": "core", "sub_theme_id": "launch"}
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: seed_row)
    monkeypatch.setattr(groups, "cap_universe_set",
                        lambda: {"RKLB", "ASTS", "LUNR", "LMT"})
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    monkeypatch.setattr(groups, "_rs_map", lambda: {})
    holdings = [
        {"sym": "RKLB", "tier": "core", "sub_theme_id": "launch"},   # the seed
        {"sym": "ASTS", "tier": "core", "sub_theme_id": "satellites"},
        {"sym": "LUNR", "tier": "relevant", "sub_theme_id": "launch"},  # same sub-theme -> boosted
        {"sym": "LMT", "tier": "core", "sub_theme_id": "defense"},
    ]
    monkeypatch.setattr(groups, "_theme_holdings", lambda tid: holdings)
    out = groups.resolve_peers("RKLB", 3)
    assert out["source"] == "taxonomy"
    assert out["peers"][0] == "LUNR"      # same sub-theme floats to top
    assert "RKLB" not in out["peers"]     # seed excluded
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_groups.py -k resolve -q`
Expected: FAIL (`AttributeError: resolve_primary_theme`)

- [ ] **Step 3: Write minimal implementation**

```python
# api/services/groups.py  (append)
# Style/factor buckets are poor peer sets — excluded from seed resolution.
_FACTOR_THEME_NAMES = {
    "meme & retail", "small cap growth", "dividend aristocrats",
}


def _themes_for_ticker(sym: str) -> list:
    from api.services import theme_db
    return theme_db.get_themes_for_ticker(to_taxonomy_sym(sym))


def _theme_holdings(theme_id: str) -> list:
    from api.services import theme_db
    return theme_db.get_theme_holdings(theme_id)


def _theme_size(theme_id: str) -> int:
    for r in list_groups():
        if r["id"] == theme_id:
            return r["total"]
    return 0


def resolve_primary_theme(sym: str):
    """The membership row whose theme the seed should take peers from, or None.
    Smallest theme where the seed ranks highest by tier; factor buckets excluded.
    Shared with ticker_meta so the displayed theme and filled peers agree."""
    rows = [r for r in _themes_for_ticker(sym)
            if (r.get("theme_name") or "").strip().lower() not in _FACTOR_THEME_NAMES]
    if not rows:
        return None
    rows.sort(key=lambda r: (
        _TIER_RANK.get(r.get("tier"), 99),
        _theme_size(r.get("theme_id")),
        r.get("theme_id") or "",
    ))
    return rows[0]


def resolve_peers(sym: str, n: int) -> dict:
    """Peers = the seed's primary theme's other chartable holdings, same
    sub-theme floated to the top, ranked by today's move. v1: no AI fallback —
    a taxonomy miss returns source='none' (caller keeps the seed solo)."""
    seed_hy = normalize_sym(sym)
    row = resolve_primary_theme(sym)
    if not row:
        return {"seed": seed_hy, "group_id": None, "peers": [], "source": "none"}

    theme_id = row.get("theme_id")
    seed_sub = row.get("sub_theme_id")
    holdings = _theme_holdings(theme_id)
    ranked = rank_holdings(holdings, by="today", seed=seed_hy)  # chartable, seed-excluded

    sub_by_sym = {normalize_sym(h.get("sym", "")): h.get("sub_theme_id") for h in holdings}
    # Stable float: same-sub-theme names first, preserving the ranked order within each group.
    ranked.sort(key=lambda hy: 0 if (seed_sub and sub_by_sym.get(hy) == seed_sub) else 1)

    return {
        "seed": seed_hy,
        "group_id": theme_id,
        "peers": ranked[: max(1, int(n))],
        "source": "taxonomy",
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_groups.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/groups.py tests/test_groups.py
git commit -m "feat(groups): tier-first seed resolver + similarity peer resolver"
```

---

## Task 5: Share the resolver with ticker-meta (UI/fill agreement)

**Files:**
- Modify: `api/services/ticker_meta.py:120-138` (`_primary_theme`)
- Test: `tests/test_groups.py`

**Interfaces:**
- Consumes: `groups.resolve_primary_theme(sym)`.
- Produces: `ticker_meta._primary_theme(ticker)` returns the SAME theme the peer-fill uses (its `theme_name`), or `None`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_groups.py  (append)
def test_ticker_meta_primary_theme_matches_resolver(monkeypatch):
    from api.services import ticker_meta
    monkeypatch.setattr(groups, "resolve_primary_theme",
                        lambda s: {"theme_id": "semis", "theme_name": "Semiconductors"})
    assert ticker_meta._primary_theme("NVDA") == "Semiconductors"


def test_ticker_meta_primary_theme_none_when_unresolved(monkeypatch):
    from api.services import ticker_meta
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: None)
    assert ticker_meta._primary_theme("ZZZZ") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_groups.py -k ticker_meta -q`
Expected: FAIL (current `_primary_theme` uses its own tier-then-id sort, not the shared resolver — `Semiconductors` assertion may pass by luck but `None` path and factor-exclusion differ; the test pins delegation).

- [ ] **Step 3: Write minimal implementation**

Replace the body of `_primary_theme` in `api/services/ticker_meta.py` (keep the docstring + the `not ticker` guard):

```python
def _primary_theme(ticker: str):
    """The single most-relevant UCT theme NAME for a ticker, or None.

    Delegates to groups.resolve_primary_theme so the theme shown here and the
    peers the /charts Groups mode fills always agree (tier-first, factor
    buckets excluded). Lazy import avoids a module-load cycle. Never raises."""
    ticker = (ticker or "").upper().strip()
    if not ticker:
        return None
    try:
        from api.services.groups import resolve_primary_theme
        row = resolve_primary_theme(ticker)
        return (row or {}).get("theme_name") or None
    except Exception as e:
        _logger.info("ticker_meta theme lookup failed for %s: %s", ticker, e)
        return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_groups.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/ticker_meta.py tests/test_groups.py
git commit -m "refactor(ticker-meta): share the Groups tier-first theme resolver"
```

---

## Task 6: Router + registration

**Files:**
- Create: `api/routers/groups.py`
- Modify: `api/main.py` (import near line 95; `include_router` near line 3310)
- Test: `tests/test_groups.py`

**Interfaces:**
- Produces: `GET /api/groups` → `{groups:[...]}`; `GET /api/groups/{group_id}/top?n=&by=` → `top_n(...)`; `GET /api/groups/peers?sym=&n=` → `resolve_peers(...)`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_groups.py  (append)
from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)


def test_groups_list_endpoint(monkeypatch):
    monkeypatch.setattr(groups, "list_groups",
                        lambda: [{"id": "space", "name": "Space", "total": 6, "chartable": 6}])
    r = client.get("/api/groups")
    assert r.status_code == 200
    assert r.json()["groups"][0]["id"] == "space"


def test_group_top_endpoint(monkeypatch):
    monkeypatch.setattr(groups, "top_n",
                        lambda tid, n, by: {"group_id": tid, "syms": ["RKLB", "ASTS"],
                                            "total": 2, "by": by, "ranked_as_of": "regular"})
    r = client.get("/api/groups/space/top?n=2&by=today")
    assert r.status_code == 200
    assert r.json()["syms"] == ["RKLB", "ASTS"]


def test_group_peers_endpoint(monkeypatch):
    monkeypatch.setattr(groups, "resolve_peers",
                        lambda sym, n: {"seed": sym, "group_id": "space",
                                        "peers": ["ASTS"], "source": "taxonomy"})
    r = client.get("/api/groups/peers?sym=RKLB&n=5")
    assert r.status_code == 200
    assert r.json()["source"] == "taxonomy"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_groups.py -k endpoint -q`
Expected: FAIL (404 — router not registered)

- [ ] **Step 3: Write minimal implementation**

```python
# api/routers/groups.py
"""Multi-Chart Groups endpoints.

GET /api/groups                     -> theme list for the picker (rotation-sorted)
GET /api/groups/{group_id}/top      -> ranked, chartable top-N of a theme
GET /api/groups/peers?sym=&n=       -> a ticker's peers (taxonomy, similarity)
"""
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from api.services import groups as svc

router = APIRouter()


@router.get("/api/groups")
def list_groups():
    try:
        return {"groups": svc.list_groups()}
    except Exception as e:
        return JSONResponse(status_code=503, content={"error": f"groups unavailable: {e}"})


@router.get("/api/groups/{group_id}/top")
def group_top(group_id: str, n: int = Query(9, ge=1, le=16), by: str = Query("today")):
    try:
        return svc.top_n(group_id, n, by=by)
    except Exception as e:
        return JSONResponse(status_code=503, content={"error": f"groups unavailable: {e}"})


@router.get("/api/groups/peers")
def group_peers(sym: str = Query(..., max_length=12), n: int = Query(8, ge=1, le=16)):
    try:
        return svc.resolve_peers(sym, n)
    except Exception as e:
        return JSONResponse(status_code=503, content={"error": f"groups unavailable: {e}"})
```

In `api/main.py`, add the import next to the other router imports (after line 95):

```python
from api.routers import groups as groups_router
```

and the registration next to the other `include_router` calls (after `theme_performance_router`, ~line 3309):

```python
app.include_router(groups_router.router)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_groups.py -q`
Expected: PASS (all groups tests)

- [ ] **Step 5: Commit**

```bash
git add api/routers/groups.py api/main.py tests/test_groups.py
git commit -m "feat(groups): /api/groups router (list, top-N, peers)"
```

---

## Task 7: Persist the current group (sanitizer allowlist)

**Files:**
- Modify: `app/src/pages/charts/grid/gridLayouts.js:80-97` (`sanitizeState`)
- Test: `app/src/pages/charts/grid/gridLayouts.test.js`

**Interfaces:**
- Produces: `sanitizeState(raw)` now returns `{layout, cells, syncCrosshair, syncTimeRange, group}` where `group` is `{id, by, n} | null` (validated) and `syncTimeRange` is a boolean.

- [ ] **Step 1: Write the failing test**

```javascript
// app/src/pages/charts/grid/gridLayouts.test.js  (append inside describe)
it('sanitizeState carries a valid group and drops a malformed one', () => {
  const ok = sanitizeState({ layout: '3x3', cells: [], group: { id: 'space', by: 'today', n: 9 } })
  expect(ok.group).toEqual({ id: 'space', by: 'today', n: 9 })
  expect(ok.syncTimeRange).toBe(false)

  const bad = sanitizeState({ layout: '2x2', cells: [], group: { by: 'today' } }) // no id
  expect(bad.group).toBeNull()

  const none = sanitizeState({ layout: '2x2', cells: [] })
  expect(none.group).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/gridLayouts.test.js`
Expected: FAIL (`group` is `undefined` — stripped by the allowlist)

- [ ] **Step 3: Write minimal implementation**

In `gridLayouts.js`, add a validator above `sanitizeState` and extend the returned object:

```javascript
// Validate a persisted group descriptor. Unknown => null (feature degrades to
// a plain grid rather than restoring a bogus group).
function sanitizeGroup(g) {
  if (!g || typeof g !== 'object') return null
  const id = typeof g.id === 'string' && g.id ? g.id : null
  if (!id) return null
  const by = g.by === 'rs' ? 'rs' : 'today'
  const n = Number.isFinite(g.n) ? Math.max(1, Math.min(GRID_MAX_CELLS, g.n | 0)) : null
  return { id, by, ...(n ? { n } : {}) }
}
```

and in `sanitizeState`'s returned object add the two keys:

```javascript
  return {
    layout: layout.id,
    cells: reconcileCells(cells, layout.cellCount),
    syncCrosshair: raw.syncCrosshair === true,
    syncTimeRange: raw.syncTimeRange === true,
    group: sanitizeGroup(raw.group),
  }
```

Also add `group: null, syncTimeRange: false` to `makeDefaultState()`'s returned object so fresh state is shaped consistently.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/gridLayouts.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/charts/grid/gridLayouts.js app/src/pages/charts/grid/gridLayouts.test.js
git commit -m "feat(groups): persist current group through the state sanitizer"
```

---

## Task 8: `fillCells` + group state (single transaction, id reuse)

**Files:**
- Modify: `app/src/pages/charts/grid/useMultiChartState.js`
- Test: `app/src/pages/charts/grid/useMultiChartState.test.jsx` (create)

**Interfaces:**
- Consumes: `sanitizeGroup` behavior from Task 7; `reconcileCells`, `parseLayoutId`.
- Produces: `fillCells(syms: string[], group?: {id,by,n}|null)` — one `apply()`; maps `syms` onto the current cells, **reusing a cell's `id` when its new sym equals an existing cell's sym** (no remount for overlap); `setGroup(group)`, `clearGroup()`. `state.group` exposed. `parseRaw` carries `group`.

- [ ] **Step 1: Write the failing test**

```javascript
// app/src/pages/charts/grid/useMultiChartState.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: vi.fn(), loading: false }),
}))

import useMultiChartState from './useMultiChartState'

describe('fillCells', () => {
  it('reuses ids for overlapping syms and sets the group', () => {
    const { result } = renderHook(() => useMultiChartState())
    act(() => result.current.enterGrid('2x2'))
    const before = result.current.state.cells.map(c => ({ id: c.id, sym: c.sym }))
    // before = QQQ,SPY,IWM,DIA. Fill with a set that overlaps SPY.
    act(() => result.current.fillCells(['SPY', 'RKLB', 'ASTS', 'LUNR'], { id: 'space', by: 'today', n: 4 }))
    const after = result.current.state.cells
    expect(after.map(c => c.sym)).toEqual(['SPY', 'RKLB', 'ASTS', 'LUNR'])
    // SPY existed before (cell idx 1) -> its id is REUSED (no remount).
    const spyBeforeId = before.find(c => c.sym === 'SPY').id
    expect(after.find(c => c.sym === 'SPY').id).toBe(spyBeforeId)
    expect(result.current.state.group).toEqual({ id: 'space', by: 'today', n: 4 })
  })

  it('clearGroup drops group identity but keeps cells', () => {
    const { result } = renderHook(() => useMultiChartState())
    act(() => result.current.enterGrid('2x2'))
    act(() => result.current.fillCells(['AAA', 'BBB', 'CCC', 'DDD'], { id: 'x', by: 'today', n: 4 }))
    act(() => result.current.clearGroup())
    expect(result.current.state.group).toBeNull()
    expect(result.current.state.cells.map(c => c.sym)).toEqual(['AAA', 'BBB', 'CCC', 'DDD'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/useMultiChartState.test.jsx`
Expected: FAIL (`fillCells is not a function`)

- [ ] **Step 3: Write minimal implementation**

In `useMultiChartState.js`: (a) make `parseRaw` carry `group` — it already spreads `...sanitizeState(parsed)`, which now includes `group`, so **no change needed there**. (b) Add the three callbacks after `updateCellAt`:

```javascript
  // Bulk fill (Groups mode). ONE apply() — never a loop of updateCellAt (that
  // races the debounced save). Reuse a cell id when the target sym matches an
  // existing cell's sym so overlapping charts don't remount; mint fresh ids
  // only for genuinely-new syms. Grows/shrinks the layout to fit N (<= cap).
  const fillCells = useCallback((syms, group = null) => {
    apply(prev => {
      const want = (Array.isArray(syms) ? syms : [])
        .map(s => (typeof s === 'string' ? s.trim().toUpperCase() : null))
        .filter(Boolean)
      const layout = parseLayoutId(prev.layout)
      const count = Math.min(layout.cellCount, want.length || layout.cellCount)
      // Pool of reusable {id} by sym, from the current cells (each id once).
      const pool = new Map()
      for (const c of prev.cells) {
        if (c.sym && !pool.has(c.sym)) pool.set(c.sym, c.id)
      }
      const used = new Set()
      const cells = []
      for (let i = 0; i < count; i++) {
        const sym = want[i] || null
        let id
        if (sym && pool.has(sym) && !used.has(pool.get(sym))) {
          id = pool.get(sym); used.add(id)
        } else {
          id = Math.random().toString(36).slice(2, 8)
        }
        cells.push({ id, sym, tf: prev.cells[i]?.tf || 'D' })
      }
      return { ...prev, mode: 'grid', cells, group: group || prev.group || null }
    })
  }, [apply])

  const setGroup = useCallback((group) => {
    apply(prev => ({ ...prev, group: group || null }))
  }, [apply])

  const clearGroup = useCallback(() => {
    apply(prev => ({ ...prev, group: null }))
  }, [apply])
```

Then add `fillCells, setGroup, clearGroup` to the returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/useMultiChartState.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/charts/grid/useMultiChartState.js app/src/pages/charts/grid/useMultiChartState.test.jsx
git commit -m "feat(groups): fillCells single-transaction bulk fill + group state"
```

---

## Task 9: Sym-admission gate (fetch-herd–safe group switch)

**Files:**
- Create: `app/src/pages/charts/grid/symAdmission.js`
- Test: `app/src/pages/charts/grid/symAdmission.test.js`

**Interfaces:**
- Produces: `chartKeys(cells) -> string[]` (`"${id}::${sym}"` for cells with a sym); `admittedSym(cell, mountedKeys, prevSyms) -> {sym, admitted}` — the sym the cell should LOAD now: its target sym once the `${id}::${sym}` key is admitted by the mount queue, else the previously-admitted sym for that id (keeps the old chart on screen, no remount), else `null` (first mount → skeleton).

This pairs with `useStaggeredMount(chartKeys(cells))`: a group switch changes every cell's `sym`, so its composite key changes → the queue purges the old key and throttles admission of the new one (≤ limit at a time), exactly like a fresh mount. The DOM cell (keyed by `cell.id` in `MultiChartGrid`) stays mounted; only the sym it loads is gated.

- [ ] **Step 1: Write the failing test**

```javascript
// app/src/pages/charts/grid/symAdmission.test.js
import { describe, it, expect } from 'vitest'
import { chartKeys, admittedSym } from './symAdmission'

describe('symAdmission', () => {
  it('chartKeys skips empty cells and encodes id::sym', () => {
    const cells = [{ id: 'a', sym: 'NVDA' }, { id: 'b', sym: null }, { id: 'c', sym: 'AMD' }]
    expect(chartKeys(cells)).toEqual(['a::NVDA', 'c::AMD'])
  })

  it('shows target sym once admitted', () => {
    const cell = { id: 'a', sym: 'RKLB' }
    const mounted = new Set(['a::RKLB'])
    expect(admittedSym(cell, mounted, {})).toEqual({ sym: 'RKLB', admitted: true })
  })

  it('holds the previous sym while the new one awaits admission (no remount)', () => {
    const cell = { id: 'a', sym: 'RKLB' }       // just swapped from SPY
    const mounted = new Set()                   // RKLB not admitted yet
    const prev = { a: 'SPY' }                    // SPY was admitted before
    expect(admittedSym(cell, mounted, prev)).toEqual({ sym: 'SPY', admitted: false })
  })

  it('null on first-ever mount (skeleton)', () => {
    expect(admittedSym({ id: 'a', sym: 'RKLB' }, new Set(), {})).toEqual({ sym: null, admitted: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/symAdmission.test.js`
Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```javascript
// app/src/pages/charts/grid/symAdmission.js
//
// Fetch-herd guard for group switches. The mount queue (useStaggeredMount) is
// keyed by cell id, so a same-id symbol swap slips past it -> N simultaneous
// cold /api/bars fetches (the 2026-05-24 incident). Keying the queue on
// `${id}::${sym}` makes a sym swap re-enter the throttle. This module decides
// which sym a still-mounted cell should LOAD this render so the chart instance
// is never torn down: the target sym once admitted, else the last admitted sym
// (old chart stays), else null (first mount -> skeleton).

export function chartKeys(cells) {
  const out = []
  for (const c of cells || []) {
    if (c && c.sym) out.push(`${c.id}::${c.sym}`)
  }
  return out
}

export function admittedSym(cell, mountedKeys, prevSyms) {
  if (!cell || !cell.sym) return { sym: null, admitted: false }
  if (mountedKeys.has(`${cell.id}::${cell.sym}`)) return { sym: cell.sym, admitted: true }
  const prev = prevSyms && prevSyms[cell.id]
  return { sym: prev || null, admitted: false }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/symAdmission.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/charts/grid/symAdmission.js app/src/pages/charts/grid/symAdmission.test.js
git commit -m "feat(groups): sym-admission gate (fetch-herd-safe group switch)"
```

---

## Task 10: Groups API client + `useGroups` hook

**Files:**
- Create: `app/src/pages/charts/grid/groupsApi.js`
- Test: `app/src/pages/charts/grid/groupsApi.test.js`

**Interfaces:**
- Produces: `fetchGroups() -> Promise<Group[]>`; `fetchGroupTop(id, {n, by}) -> Promise<{syms,total,by,ranked_as_of}>`; `fetchPeers(sym, {n}) -> Promise<{seed,group_id,peers,source}>`. All return safe empty shapes on non-OK responses (never throw into the render path).

- [ ] **Step 1: Write the failing test**

```javascript
// app/src/pages/charts/grid/groupsApi.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchGroups, fetchGroupTop, fetchPeers } from './groupsApi'

afterEach(() => vi.restoreAllMocks())

function mockFetch(status, body) {
  globalThis.fetch = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }))
}

describe('groupsApi', () => {
  it('fetchGroups returns the groups array', async () => {
    mockFetch(200, { groups: [{ id: 'space', name: 'Space' }] })
    expect(await fetchGroups()).toEqual([{ id: 'space', name: 'Space' }])
  })

  it('fetchGroupTop passes n/by and returns syms', async () => {
    mockFetch(200, { syms: ['RKLB', 'ASTS'], total: 2, by: 'today', ranked_as_of: 'regular' })
    const r = await fetchGroupTop('space', { n: 9, by: 'today' })
    expect(r.syms).toEqual(['RKLB', 'ASTS'])
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/groups/space/top?n=9&by=today')
  })

  it('fetchPeers returns a safe empty shape on error', async () => {
    mockFetch(503, { error: 'x' })
    expect(await fetchPeers('RKLB', { n: 5 })).toEqual({ seed: 'RKLB', group_id: null, peers: [], source: 'none' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/groupsApi.test.js`
Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```javascript
// app/src/pages/charts/grid/groupsApi.js
// Thin fetch helpers for the /api/groups endpoints. Never throw into render —
// return safe empty shapes so a cold backend degrades to an empty picker / a
// solo seed rather than a crash.

export async function fetchGroups() {
  try {
    const r = await fetch('/api/groups')
    if (!r.ok) return []
    const j = await r.json()
    return Array.isArray(j.groups) ? j.groups : []
  } catch { return [] }
}

export async function fetchGroupTop(id, { n = 9, by = 'today' } = {}) {
  try {
    const r = await fetch(`/api/groups/${encodeURIComponent(id)}/top?n=${n}&by=${by}`)
    if (!r.ok) return { syms: [], total: 0, by, ranked_as_of: 'unknown' }
    return await r.json()
  } catch { return { syms: [], total: 0, by, ranked_as_of: 'unknown' } }
}

export async function fetchPeers(sym, { n = 8 } = {}) {
  const seed = (sym || '').toUpperCase()
  try {
    const r = await fetch(`/api/groups/peers?sym=${encodeURIComponent(seed)}&n=${n}`)
    if (!r.ok) return { seed, group_id: null, peers: [], source: 'none' }
    return await r.json()
  } catch { return { seed, group_id: null, peers: [], source: 'none' } }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/groupsApi.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/charts/grid/groupsApi.js app/src/pages/charts/grid/groupsApi.test.js
git commit -m "feat(groups): API client for list/top/peers"
```

---

## Task 11: Group picker (in the Multi Charts menu)

**Files:**
- Create: `app/src/pages/charts/grid/GroupPicker.jsx`
- Modify: `app/src/pages/charts/grid/MultiChartMenu.jsx` (mount the picker)
- Modify: `app/src/pages/charts/grid/MultiChartGrid.module.css` (picker styles)
- Test: `app/src/pages/charts/grid/GroupPicker.test.jsx`

**Interfaces:**
- Consumes: `fetchGroups`, `fetchGroupTop`; `mc.state.layout`, `mc.fillCells`, `mc.enterGrid`.
- Produces: `<GroupPicker mc onClose />` — a searchable list of groups; clicking one enters grid mode (if not already), fetches its top-N for the current grid's cell count, and calls `mc.fillCells(syms, {id, by:'today', n})`.

- [ ] **Step 1: Write the failing test**

```javascript
// app/src/pages/charts/grid/GroupPicker.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('./groupsApi', () => ({
  fetchGroups: vi.fn(async () => [
    { id: 'space', name: 'Space', total: 6, chartable: 6 },
    { id: 'memory_chips', name: 'Memory & HBM', total: 8, chartable: 8 },
  ]),
  fetchGroupTop: vi.fn(async () => ({ syms: ['RKLB', 'ASTS', 'LUNR', 'BKSY'], total: 6, by: 'today', ranked_as_of: 'regular' })),
}))

import GroupPicker from './GroupPicker'
import { fetchGroupTop } from './groupsApi'

const mc = {
  state: { layout: '2x2', mode: 'grid' },
  enterGrid: vi.fn(),
  fillCells: vi.fn(),
}

beforeEach(() => { mc.enterGrid.mockClear(); mc.fillCells.mockClear() })

describe('GroupPicker', () => {
  it('lists groups and fills the grid on click', async () => {
    render(<GroupPicker mc={mc} onClose={() => {}} />)
    const btn = await screen.findByRole('button', { name: /Space/ })
    fireEvent.click(btn)
    await waitFor(() => expect(fetchGroupTop).toHaveBeenCalledWith('space', { n: 4, by: 'today' }))
    expect(mc.fillCells).toHaveBeenCalledWith(
      ['RKLB', 'ASTS', 'LUNR', 'BKSY'],
      { id: 'space', by: 'today', n: 4 },
    )
  })

  it('filters by search text', async () => {
    render(<GroupPicker mc={mc} onClose={() => {}} />)
    await screen.findByRole('button', { name: /Space/ })
    fireEvent.change(screen.getByPlaceholderText(/search groups/i), { target: { value: 'mem' } })
    expect(screen.queryByRole('button', { name: /Space/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Memory/ })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/GroupPicker.test.jsx`
Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```jsx
// app/src/pages/charts/grid/GroupPicker.jsx
//
// Groups picker for the Multi Charts menu. Pick a theme -> the grid repopulates
// with its today's-move leaders (top-N for the CURRENT grid size; no resize).
import { useEffect, useMemo, useState } from 'react'
import { parseLayoutId } from './gridLayouts'
import { fetchGroups, fetchGroupTop } from './groupsApi'
import wsStyles from '../ChartsWorkspace.module.css'
import styles from './MultiChartGrid.module.css'

export default function GroupPicker({ mc, onClose }) {
  const [groups, setGroups] = useState([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => { let live = true; fetchGroups().then(g => { if (live) setGroups(g) }); return () => { live = false } }, [])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return groups
    return groups.filter(g => (g.name || '').toLowerCase().includes(s))
  }, [groups, q])

  const pick = async (g) => {
    setBusy(g.id)
    const n = parseLayoutId(mc.state.layout).cellCount
    if (mc.state.mode !== 'grid') mc.enterGrid(mc.state.layout)
    const { syms } = await fetchGroupTop(g.id, { n, by: 'today' })
    if (syms && syms.length) mc.fillCells(syms, { id: g.id, by: 'today', n })
    setBusy('')
    onClose?.()
  }

  return (
    <div className={styles.groupPicker}>
      <div className={wsStyles.menuSection}>Groups</div>
      <input
        className={wsStyles.menuInput}
        placeholder="Search groups…"
        value={q}
        onChange={e => setQ(e.target.value)}
        aria-label="Search groups"
      />
      <div className={styles.groupList}>
        {shown.map(g => (
          <button
            key={g.id}
            type="button"
            className={wsStyles.addMenuItem}
            disabled={busy === g.id}
            onClick={() => pick(g)}
          >
            <span style={{ flex: 1 }}>{g.name}</span>
            <span className={styles.groupCount}>{g.chartable}</span>
          </button>
        ))}
        {shown.length === 0 && <div className={styles.groupEmpty}>No groups</div>}
      </div>
    </div>
  )
}
```

Add styles to `MultiChartGrid.module.css`:

```css
/* Groups picker (inside the Multi Charts menu). */
.groupPicker { display: flex; flex-direction: column; max-width: 260px; }
.groupList { max-height: 320px; overflow-y: auto; }
.groupCount { font-size: 11px; color: var(--text-muted, #6b7280); flex: 0 0 auto; }
.groupEmpty { padding: 8px 10px; color: var(--text-muted, #6b7280); font-size: 12px; }
```

Mount it in `MultiChartMenu.jsx` — import at the top:

```jsx
import GroupPicker from './GroupPicker'
```

and render it just before the closing `</div>` of the menu (after the saved-grids block), so the picker sits under the layout controls:

```jsx
      <div className={wsStyles.menuDivider} />
      <GroupPicker mc={mc} onClose={onClose} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/GroupPicker.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/charts/grid/GroupPicker.jsx app/src/pages/charts/grid/MultiChartMenu.jsx app/src/pages/charts/grid/MultiChartGrid.module.css app/src/pages/charts/grid/GroupPicker.test.jsx
git commit -m "feat(groups): group picker in the Multi Charts menu"
```

---

## Task 12: Peer auto-fill on committed ticker (async latch + Undo)

**Files:**
- Modify: `app/src/pages/charts/grid/MultiChartGrid.jsx`
- Modify: `app/src/pages/charts/grid/GridChartCell.jsx` (commit-only callback in group mode)
- Test: `app/src/pages/charts/grid/peerFill.test.js` (create — tests the latch helper in isolation)

**Interfaces:**
- Consumes: `fetchPeers`; `mc.fillCells`; `mc.state.group`.
- Produces: a `makePeerFiller({ fetchPeers, fillCells, onUndoAvailable })` factory returning `run(seedSym, ctx)` guarded by a monotonic request id (a stale response is discarded); on success it snapshots the prior `{cells, group}` for one-click Undo.

Rationale (owner kept auto-on-type): in group mode, committing a ticker in any cell = new seed → replace the grid with `[seed, ...peers]`. The latch prevents a fast second commit from losing to a slow first; the Undo toast restores the prior board. A **commit** = Enter / search-selection (already how `GridChartCell`'s `SymbolSearch` reports a chosen ticker), never a mid-keystroke.

- [ ] **Step 1: Write the failing test**

```javascript
// app/src/pages/charts/grid/peerFill.test.js
import { describe, it, expect, vi } from 'vitest'
import { makePeerFiller } from './peerFill'

describe('makePeerFiller', () => {
  it('discards a stale (out-of-order) peer response', async () => {
    let resolveAAPL, resolveMSFT
    const fetchPeers = vi.fn((sym) => {
      if (sym === 'AAPL') return new Promise(r => { resolveAAPL = () => r({ seed: 'AAPL', peers: ['A1', 'A2'], source: 'taxonomy' }) })
      return new Promise(r => { resolveMSFT = () => r({ seed: 'MSFT', peers: ['M1', 'M2'], source: 'taxonomy' }) })
    })
    const fillCells = vi.fn()
    const filler = makePeerFiller({ fetchPeers, fillCells, onUndoAvailable: () => {} })

    const p1 = filler.run('AAPL', { n: 3, group: { id: 'a' }, snapshot: {} })
    const p2 = filler.run('MSFT', { n: 3, group: { id: 'b' }, snapshot: {} })
    resolveMSFT()      // newer request resolves first
    await p2
    resolveAAPL()      // older request resolves late -> MUST be ignored
    await p1

    expect(fillCells).toHaveBeenCalledTimes(1)
    expect(fillCells).toHaveBeenCalledWith(['MSFT', 'M1', 'M2'], { id: 'b' })
  })

  it('keeps the seed solo when the taxonomy has no group', async () => {
    const fetchPeers = vi.fn(async () => ({ seed: 'SNDK', peers: [], source: 'none' }))
    const fillCells = vi.fn()
    const filler = makePeerFiller({ fetchPeers, fillCells, onUndoAvailable: () => {} })
    await filler.run('SNDK', { n: 3, group: null, snapshot: {} })
    expect(fillCells).toHaveBeenCalledWith(['SNDK'], null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/peerFill.test.js`
Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```javascript
// app/src/pages/charts/grid/peerFill.js
//
// Commit-triggered peer fill for Groups mode. A monotonic request id makes a
// slow earlier response lose to a faster later one (type AAPL then MSFT fast ->
// only MSFT's peers land). On success it hands the caller an undo snapshot.

export function makePeerFiller({ fetchPeers, fillCells, onUndoAvailable }) {
  let gen = 0
  async function run(seedSym, { n = 8, group = null, snapshot = null } = {}) {
    const mine = ++gen
    const seed = (seedSym || '').toUpperCase()
    const res = await fetchPeers(seed, { n: Math.max(1, n - 1) })
    if (mine !== gen) return                     // a newer commit superseded this one
    const peers = (res && Array.isArray(res.peers)) ? res.peers : []
    const syms = [seed, ...peers].slice(0, n)
    const nextGroup = res && res.group_id ? { id: res.group_id, by: 'today', n } : group
    fillCells(syms, nextGroup || null)
    if (snapshot) onUndoAvailable?.({ label: `filled peers of ${seed}`, snapshot })
  }
  return { run }
}
```

Wire it in `MultiChartGrid.jsx`:
- Import `makePeerFiller` and `fetchPeers`; create the filler once with `useMemo`, an undo-toast state, and a ref to the current `{cells, group}` for snapshots:

```jsx
import { makePeerFiller } from './peerFill'
import { fetchPeers } from './groupsApi'
// ...
const [undo, setUndo] = useState(null)   // {label, snapshot} | null
const peerFiller = useMemo(
  () => makePeerFiller({
    fetchPeers,
    fillCells: (syms, group) => { if (!spikeActive) mc.fillCells(syms, group) },
    onUndoAvailable: setUndo,
  }),
  [mc.fillCells, spikeActive],
)
```

- Only in group mode does a committed sym fill peers; otherwise fall back to per-cell edit. Replace the `onChangeFns` memo with a group-aware version:

```jsx
const inGroupMode = !!state.group
const onChangeFns = useMemo(
  () => cells.map((_, i) => (next) => {
    if (spikeActive) return
    if (inGroupMode && next?.sym && next.sym !== cellsRef.current[i]?.sym) {
      const n = cellsRef.current.length
      peerFiller.run(next.sym, {
        n,
        group: state.group,
        snapshot: { cells: cellsRef.current, group: state.group },
      })
    } else {
      mc.updateCellAt(i, next)
    }
  }),
  [cells.length, mc.updateCellAt, spikeActive, inGroupMode, peerFiller, state.group],
)
```

- Render an Undo toast above the grid (uses existing `UIcon`; auto-dismiss via a 6 s timer):

```jsx
{undo && (
  <div className={styles.undoToast} role="status">
    <span>{undo.label}</span>
    <button type="button" onClick={() => {
      // Restore the pre-fill board: re-fill with the snapshot's syms + group.
      mc.fillCells(undo.snapshot.cells.map(c => c.sym).filter(Boolean), undo.snapshot.group)
      setUndo(null)
    }}>Undo</button>
  </div>
)}
```

Add a self-clearing effect + styles:

```jsx
useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), 6000); return () => clearTimeout(t) }, [undo])
```

```css
/* Undo toast (peer-fill). */
.undoToast {
  position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  z-index: 8; display: flex; align-items: center; gap: 10px;
  background: var(--bg-elevated, #12171f); border: 1px solid var(--border, #2a3340);
  border-radius: 6px; padding: 6px 12px; font-size: 12px; color: var(--text-bright, #e5e9f0);
}
.undoToast button { color: var(--ut-gold, #c9a84c); background: none; border: none; cursor: pointer; font-weight: 600; }
```

`GridChartCell.jsx` already routes a committed ticker through `onChange({...cell, sym})`; no change needed for the trigger. (The commit-only guarantee comes from `SymbolSearch` reporting on Enter/selection, not per keystroke.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/peerFill.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/charts/grid/peerFill.js app/src/pages/charts/grid/peerFill.test.js app/src/pages/charts/grid/MultiChartGrid.jsx app/src/pages/charts/grid/MultiChartGrid.module.css
git commit -m "feat(groups): peer auto-fill on committed ticker (latch + undo)"
```

---

## Task 13: Heat layer — group header + per-cell badge + rationale

**Files:**
- Create: `app/src/pages/charts/grid/GroupHeatHeader.jsx`
- Create: `app/src/pages/charts/grid/GroupHeatHeader.test.jsx`
- Modify: `app/src/pages/charts/grid/MultiChartGrid.module.css` (header + badge styles)

**Interfaces:**
- Produces: `<GroupHeatHeader groupName total shown holdings />` where `holdings` = `[{sym, changePct}]` (live today's %, from the shared `useLivePrices` the cells already feed). Renders `Space · 8/13 green · +2.1% · RKLB +8%` and a "showing N of total" note. Badges themselves are added to `GridChartCell` in a follow-up wire-up; this task delivers the header + the pure summary math (`summarizeHeat`).

- [ ] **Step 1: Write the failing test**

```javascript
// app/src/pages/charts/grid/GroupHeatHeader.test.jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import GroupHeatHeader, { summarizeHeat } from './GroupHeatHeader'

describe('summarizeHeat', () => {
  it('counts greens, averages %, finds the leader', () => {
    const h = [{ sym: 'RKLB', changePct: 8 }, { sym: 'ASTS', changePct: -2 }, { sym: 'LUNR', changePct: 4 }]
    expect(summarizeHeat(h)).toEqual({ green: 2, count: 3, avg: 3.33, leader: { sym: 'RKLB', changePct: 8 } })
  })
  it('handles an empty set', () => {
    expect(summarizeHeat([])).toEqual({ green: 0, count: 0, avg: 0, leader: null })
  })
})

describe('GroupHeatHeader', () => {
  it('renders the summary line and the N-of-total note', () => {
    render(<GroupHeatHeader groupName="Space" total={13} shown={9}
      holdings={[{ sym: 'RKLB', changePct: 8 }, { sym: 'ASTS', changePct: -2 }]} />)
    expect(screen.getByText(/Space/)).toBeTruthy()
    expect(screen.getByText(/1\/2 green/)).toBeTruthy()
    expect(screen.getByText(/9 of 13/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/GroupHeatHeader.test.jsx`
Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```jsx
// app/src/pages/charts/grid/GroupHeatHeader.jsx
//
// One-line group heat summary above the grid in Groups mode. Live, not frozen:
// it reads the same live today's-% the cells already stream.

export function summarizeHeat(holdings) {
  const list = (holdings || []).filter(h => Number.isFinite(h?.changePct))
  const count = list.length
  if (!count) return { green: 0, count: 0, avg: 0, leader: null }
  let green = 0, sum = 0, leader = list[0]
  for (const h of list) {
    if (h.changePct > 0) green++
    sum += h.changePct
    if (h.changePct > leader.changePct) leader = h
  }
  return { green, count, avg: Math.round((sum / count) * 100) / 100, leader }
}

function pct(n) { return `${n > 0 ? '+' : ''}${n.toFixed(1)}%` }

export default function GroupHeatHeader({ groupName, total, shown, holdings }) {
  const { green, count, avg, leader } = summarizeHeat(holdings)
  return (
    <div className="groupHeatHeader" style={heaterStyle}>
      <strong style={{ color: 'var(--ut-gold, #c9a84c)' }}>{groupName}</strong>
      {count > 0 && (
        <>
          <span>{green}/{count} green</span>
          <span style={{ color: avg >= 0 ? '#22c55e' : '#f87171' }}>{pct(avg)}</span>
          {leader && <span>{leader.sym} {pct(leader.changePct)}</span>}
        </>
      )}
      {Number.isFinite(total) && Number.isFinite(shown) && total > shown && (
        <span style={{ color: 'var(--text-muted, #6b7280)', marginLeft: 'auto' }}>{shown} of {total}</span>
      )}
    </div>
  )
}

const heaterStyle = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '4px 10px',
  fontSize: 12, borderBottom: '1px solid var(--border, #2a3340)',
}
```

(Style is inline here to keep the component self-contained; the module-CSS class `.groupHeatHeader` is available if a later pass wants to move it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/GroupHeatHeader.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/charts/grid/GroupHeatHeader.jsx app/src/pages/charts/grid/GroupHeatHeader.test.jsx
git commit -m "feat(groups): group heat header + summary math"
```

---

## Task 14: Wire it together — mode chrome, mount-queue keys, heat header, Refresh

**Files:**
- Modify: `app/src/pages/charts/grid/MultiChartGrid.jsx`
- Modify: `app/src/pages/charts/grid/MultiChartMenu.jsx` (Refresh + Exit Groups)
- Test: manual + the existing `?gridspike` harness (board-swap check)

**Interfaces:**
- Consumes: everything above.
- Produces: `MultiChartGrid` renders `GroupHeatHeader` when `state.group` is set; the mount queue is keyed by `chartKeys(cells)` and cells load via `admittedSym(...)`; a **Refresh** action re-pulls the current group; **Exit Groups** clears the group.

- [ ] **Step 1: Switch the mount queue to composite keys**

In `MultiChartGrid.jsx`, import the helpers and a live-price hook, and replace the `chartIds` memo + `mountedIds` usage:

```jsx
import { chartKeys, admittedSym } from './symAdmission'
import GroupHeatHeader from './GroupHeatHeader'
import { fetchGroupTop } from './groupsApi'
// ...
const keys = useMemo(() => chartKeys(cells), [cells])
const { mountedIds, release } = useStaggeredMount(keys, { limit: 3, slotTimeoutMs: 5000 })

// Remember the last admitted sym per cell id so a not-yet-admitted swap keeps
// the previous chart on screen (no remount) instead of flashing a skeleton.
const prevSymRef = useRef({})
useEffect(() => {
  for (const c of cells) {
    if (c.sym && mountedIds.has(`${c.id}::${c.sym}`)) prevSymRef.current[c.id] = c.sym
  }
}, [mountedIds, cells])
```

Update `onBarsReadyFns` to release the composite key:

```jsx
const onBarsReadyFns = useMemo(
  () => cells.map((_, i) => () => {
    const c = cellsRef.current[i]
    if (c?.id && c?.sym) release(`${c.id}::${c.sym}`)
  }),
  [cells.length, release],
)
```

In the cell render, compute the sym to load and pass it (fall back to the previous sym while awaiting admission):

```jsx
const { sym: loadSym, admitted } = admittedSym(cell, mountedIds, prevSymRef.current)
const queued = hydrated && cell.sym && !admitted && !loadSym   // first mount, nothing to show yet
// ...render skeleton when `queued`; otherwise render GridChartCell with a
// cell whose sym is loadSym (so a throttled swap keeps the old chart):
<GridChartCell cell={{ ...cell, sym: loadSym }} ... />
```

- [ ] **Step 2: Render the heat header in group mode**

Build the live-holdings array from the shared live-price cache the cells already use, and render the header above `.gridBody`:

```jsx
import useLivePrices from '../../../hooks/useLivePrices'
// ...
const gridSyms = useMemo(() => cells.map(c => c.sym).filter(Boolean), [cells])
const livePrices = useLivePrices(gridSyms)   // shared pool; cells already poll these
const heatHoldings = useMemo(
  () => gridSyms.map(s => ({ sym: s, changePct: livePrices?.[s]?.change_pct })),
  [gridSyms, livePrices],
)
// ... in the returned JSX, before <div className={styles.gridBody}>:
{state.group && (
  <GroupHeatHeader
    groupName={groupNameFor(state.group.id)}
    total={groupTotalRef.current}
    shown={gridSyms.length}
    holdings={heatHoldings}
  />
)}
```

(`groupNameFor` / `groupTotalRef` are populated from the last `fetchGroups`/`fetchGroupTop` — store the picked group's `name` + `total` on the `group` object when `fillCells` is called, i.e. extend the picker to pass `{ id, by, n, name, total }`; `sanitizeGroup` already drops unknown keys on reload, so re-derive `name`/`total` from a cached `/api/groups` fetch on hydration. Keep it defensive: fall back to the id.)

- [ ] **Step 3: Add Refresh + Exit Groups to the menu**

In `MultiChartMenu.jsx`, when `mc.state.group` is set, render two actions:

```jsx
{mc.state.group && (
  <>
    <div className={wsStyles.menuDivider} />
    <button type="button" className={wsStyles.addMenuItem} onClick={async () => {
      const g = mc.state.group
      const n = mc.state.cells.length
      const { syms } = await fetchGroupTop(g.id, { n, by: g.by || 'today' })
      if (syms?.length) mc.fillCells(syms, { ...g, n })
      onClose()
    }}>↻ Refresh group</button>
    <button type="button" className={wsStyles.addMenuItem} onClick={() => { mc.clearGroup(); onClose() }}>
      Exit Groups
    </button>
  </>
)}
```

(Import `fetchGroupTop` at the top of `MultiChartMenu.jsx`.)

- [ ] **Step 4: Verify (local, visible tab — the harness can't cover the swap herd)**

Run the backend + vite dev server, open `/charts`, enter grid mode, open Multi Charts → Groups, pick "Space", then pick "Memory & HBM". Confirm: the grid repopulates each time, charts don't flash a full skeleton wall (overlapping/instant), the heat header updates, and the Network panel shows `/api/bars` fetches admitted ≤3 at a time (not 9–16 at once). Then type a ticker (e.g. `RKLB`) into a cell and press Enter → the grid fills with peers and an Undo toast appears; click Undo → the prior board returns. Run the full test suites:

Run: `python -m pytest tests/test_groups.py -q && cd app && npx vitest run --pool=threads src/pages/charts/grid/`
Expected: PASS (backend groups + all grid frontend tests)

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/charts/grid/MultiChartGrid.jsx app/src/pages/charts/grid/MultiChartMenu.jsx
git commit -m "feat(groups): wire mode chrome, composite mount-queue keys, heat header, refresh"
```

---

## Deferred to later phases (NOT in this plan)

- **Phase 2 — AI peer fallback** (grounded Haiku for tickers absent from the taxonomy): `groups.resolve_peers` returns `source:'none'` today; add a `_ai_peers(seed)` path (ticker-meta grounding → `claude-haiku-4-5` structured output → validate against `cap_universe` + sector match + seed dedup → cache `(SEED, n, version)`, offloaded off the request path).
- **Phase 3 — time-range sync** (add the `applyingExternalRangeRef` echo guard to `StockChart` first — the hooks exist but the applier has no guard), **saved named Group boards** (via `/api/charts/layouts` with the group id in the `layout` blob), **fast-switch polish** (recents/favorites, ‹ › arrows, RVOL badge if a cheap source appears), **per-cell badges + rationale tooltip** wired into `GridChartCell` (the header math from Task 13 is ready), and the **`?gridspike` board-swap mode** for automated group-switch perf proof.
- **Curation track** — the chartable filter (Task 1) makes the endpoints skip the 183 non-chartable holdings; a follow-up should surface that set as a worklist and fix the taxonomy (`themes_taxonomy.json` is ~3 months stale).
