# Index & Macro Group Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing a broad index or macro ETF (SPY/QQQ/IWM/DIA/TLT/GLD/VIXY/…) in Multi-Chart Groups mode fills the grid with a curated 16-name "Index & Macro" board instead of dead-ending on "No group found".

**Architecture:** Two additive fallback steps in `resolve_peers`'s existing precedence chain plus one synthetic group in `list_groups()`/`top_n()`. Both new steps sit BELOW existing theme-membership resolution, so no ticker that has a real peer group today changes behavior. Ranking reuses the already-bounded `_today_map()` snapshot; a cold snapshot degrades to a fixed curated order. No frontend changes — every Groups-mode surface is generic over `{group_id, group_name, syms}`.

**Tech Stack:** Python 3.12, FastAPI, pytest. One file changed (`api/services/groups.py`) + one new test file.

**Spec:** `docs/superpowers/specs/2026-07-23-index-macro-group-design.md`

## Global Constraints

- **Worktree:** all work happens in `C:\Users\Patrick\uct-worktrees\index-macro-group` on branch `feat/index-macro-group`. Use ABSOLUTE paths — a worktree Bash cwd can drift to the main repo.
- **Never `git add -A`** in this repo (shared worktree convention). Every commit stages explicit paths.
- **Canonical symbol form is HYPHEN + UPPERCASE** (`BRK-B`). Always pass symbols through `normalize_sym()`. `to_taxonomy_sym()` (dot form) is ONLY for `theme_db` lookups.
- **Macro fallbacks must never outrank a real theme membership.** `resolve_primary_theme()` runs first, always.
- **Aggregates stay owner-only.** Do not add engine-sourced rows to any count.
- **Never introduce an unbounded blocking external call.** The only network call added is `_today_map()`, which is already wall-clock bounded + cached.
- Group id string: `index_macro`. Display name string: `Index & Macro`. Sector id: `macro`.
- Run tests with `python -m pytest` from the worktree root.

---

### Task 1: Roster constants + core-pinned ordering

**Files:**
- Modify: `api/services/groups.py` (append a new section after `_industry_peers`, before `resolve_peers` — around line 555)
- Test: `tests/test_groups_macro.py` (create)

**Interfaces:**
- Consumes: `normalize_sym(s) -> str` (existing, `groups.py:47`)
- Produces:
  - `MACRO_GROUP_ID: str = "index_macro"`, `MACRO_GROUP_NAME: str = "Index & Macro"`
  - `MACRO_CORE: tuple[str, ...]`, `MACRO_REST: tuple[str, ...]`, `MACRO_ROSTER: tuple[str, ...]`
  - `MACRO_TRIGGERS: frozenset[str]`
  - `_macro_order(today: dict, seed: str | None = None) -> list[str]` — full roster ordered for the grid

- [ ] **Step 1: Write the failing test**

Create `tests/test_groups_macro.py`:

```python
from api.services import groups


def test_macro_roster_is_16_names_core_first():
    assert groups.MACRO_CORE == ("SPY", "QQQ", "IWM", "DIA")
    assert len(groups.MACRO_ROSTER) == 16
    assert groups.MACRO_ROSTER[:4] == groups.MACRO_CORE
    assert len(set(groups.MACRO_ROSTER)) == 16          # no dupes


def test_macro_triggers_exclude_theme_fronting_etfs():
    """SMH/ARKK/IBIT/XLF front real themes — typing them must route THERE,
    not to the macro board. They stay roster MEMBERS, just not triggers."""
    for sym in ("SMH", "ARKK", "IBIT", "XLF"):
        assert sym in groups.MACRO_ROSTER
        assert sym not in groups.MACRO_TRIGGERS
    for sym in ("SPY", "QQQ", "IWM", "DIA", "TLT", "GLD", "VIXY", "VOO", "RSP"):
        assert sym in groups.MACRO_TRIGGERS


def test_macro_order_pins_core_then_sorts_rest_by_absolute_move():
    today = {"VIXY": -1.0, "TLT": 0.4, "GLD": 6.0, "SMH": -5.0, "SPY": 9.9}
    out = groups._macro_order(today)
    assert out[:4] == ["SPY", "QQQ", "IWM", "DIA"]       # core pinned despite SPY's move
    assert out[4:8] == ["GLD", "SMH", "VIXY", "TLT"]     # |6.0| > |-5.0| > |-1.0| > |0.4|


def test_macro_order_no_data_names_keep_curated_order_behind_movers():
    out = groups._macro_order({"GLD": 3.0})
    assert out[4] == "GLD"
    # everything else has no datum -> curated MACRO_REST order, GLD removed
    assert out[5:] == [s for s in groups.MACRO_REST if s != "GLD"]


def test_macro_order_cold_snapshot_is_the_curated_roster():
    assert groups._macro_order({}) == list(groups.MACRO_ROSTER)


def test_macro_order_puts_the_seed_first_without_duplicating_it():
    out = groups._macro_order({}, seed="iwm")
    assert out[0] == "IWM"
    assert out.count("IWM") == 1
    assert out[1:4] == ["SPY", "QQQ", "DIA"]


def test_macro_order_seed_outside_the_roster_is_still_prepended():
    """VOO is a trigger but not a roster member — typing it must still show VOO."""
    out = groups._macro_order({}, seed="VOO")
    assert out[0] == "VOO"
    assert out[1:5] == list(groups.MACRO_CORE)
    assert len(out) == 17
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_groups_macro.py -v`
Expected: FAIL — `AttributeError: module 'api.services.groups' has no attribute 'MACRO_CORE'`

- [ ] **Step 3: Write the implementation**

Insert into `api/services/groups.py` immediately after the `_industry_peers` function (before `def resolve_peers`):

```python
# ---------------------------------------------------------------------------
# Index & Macro — a SYNTHETIC group (not a taxonomy theme).
#
# Typing a broad index ETF used to dead-end: it belongs to no theme, and its
# Finviz industry is the catch-all "Exchange Traded Fund" (_NON_PEER_INDUSTRIES),
# so the whole fallback chain returned nothing. This board answers "what kind of
# tape is this?" — index proxies + vol + risk-appetite + cross-asset macro.
#
# It is NEVER a taxonomy theme: it must not appear in Theme Tracker, theme
# performance, or the theme engine's loops, and it never touches theme_db.
# ---------------------------------------------------------------------------
MACRO_GROUP_ID = "index_macro"
MACRO_GROUP_NAME = "Index & Macro"

# The core four are ALWAYS on the board, ALWAYS in this order — ranking purely
# by today's move would let SPY fall off a 3x3 on a quiet day.
MACRO_CORE = ("SPY", "QQQ", "IWM", "DIA")
# The rest, in curated fallback order. This order IS the cold-snapshot board, so
# keep it meaningful: vol, risk-appetite, rates/credit, metals, dollar, breadth.
MACRO_REST = ("VIXY", "SMH", "ARKK", "IBIT", "TLT", "HYG",
              "GLD", "SLV", "UUP", "RSP", "XLK", "XLF")
MACRO_ROSTER = MACRO_CORE + MACRO_REST

# Typed symbols that route to the board. Deliberately WIDER than the roster
# (VOO/UVXY/MDY aren't charted on it but should still land you here) and safe to
# be generous, because macro routing runs only AFTER theme resolution fails.
# SMH/ARKK/IBIT/XLF are intentionally ABSENT — they front real themes.
MACRO_TRIGGERS = frozenset({
    "SPY", "VOO", "IVV", "SPLG", "VTI", "QQQ", "QQQM", "QQQE",
    "IWM", "IJR", "IJH", "DIA", "RSP", "MDY",
    "VIXY", "VXX", "UVXY", "UVIX", "VIXM", "SVXY",
    "TLT", "IEF", "SHY", "HYG", "LQD", "GLD", "SLV", "UUP", "UDN", "XLK",
})


def _macro_order(today: dict, seed: str = None) -> list:
    """The full roster ordered for the grid.

    seed first (so the cell you typed shows what you typed), then MACRO_CORE in
    fixed order, then MACRO_REST by DESCENDING ABSOLUTE today's move — a -4% VIXY
    day is as worth seeing as a +4% one. Names with no snapshot datum sink behind
    the movers in curated order, so a cold/failed snapshot degrades to
    MACRO_ROSTER verbatim rather than to something arbitrary.
    """
    def _rank(sym):
        try:
            return -abs(float(today.get(sym)))
        except (TypeError, ValueError):
            return float("inf")          # no data -> behind every mover

    rest = sorted(MACRO_REST, key=lambda s: (_rank(s), MACRO_REST.index(s)))
    out = list(MACRO_CORE) + rest
    seed_hy = normalize_sym(seed) if seed else None
    if seed_hy:
        out = [seed_hy] + [s for s in out if s != seed_hy]
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_groups_macro.py -v`
Expected: PASS — 7 passed

- [ ] **Step 5: Commit**

```bash
git add tests/test_groups_macro.py api/services/groups.py
git commit -m "Groups: Index & Macro roster + core-pinned ordering"
```

---

### Task 2: The board fill (`macro_board`)

**Files:**
- Modify: `api/services/groups.py` (immediately after `_macro_order`)
- Test: `tests/test_groups_macro.py`

**Interfaces:**
- Consumes: `_macro_order(today, seed)` (Task 1), `_today_map(syms: list) -> dict` (existing, `groups.py:194` — already wall-clock bounded by `_TODAY_TIMEOUT_S` and cached per sym-set for `_TODAY_CACHE_TTL`)
- Produces: `macro_board(n: int, seed: str | None = None) -> list[str]` — the board bounded to `n` cells

- [ ] **Step 1: Write the failing test**

Append to `tests/test_groups_macro.py`:

```python
def test_macro_board_bounds_to_n_and_snapshots_the_whole_roster(monkeypatch):
    seen = {}

    def _fake_today(syms):
        seen["syms"] = list(syms)
        return {"GLD": 4.0}

    monkeypatch.setattr(groups, "_today_map", _fake_today)
    out = groups.macro_board(9)
    assert len(out) == 9
    assert out[:5] == ["SPY", "QQQ", "IWM", "DIA", "GLD"]
    assert set(seen["syms"]) == set(groups.MACRO_ROSTER)   # ONE batch, 16 syms


def test_macro_board_2x2_is_exactly_the_core_four(monkeypatch):
    monkeypatch.setattr(groups, "_today_map", lambda syms: {"VIXY": 20.0})
    assert groups.macro_board(4) == ["SPY", "QQQ", "IWM", "DIA"]


def test_macro_board_4x4_shows_all_16(monkeypatch):
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    assert groups.macro_board(16) == list(groups.MACRO_ROSTER)


def test_macro_board_seed_leads(monkeypatch):
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    assert groups.macro_board(5, seed="TLT")[0] == "TLT"


def test_macro_board_never_returns_empty_on_a_bad_snapshot(monkeypatch):
    def _boom(_syms):
        raise RuntimeError("massive down")

    monkeypatch.setattr(groups, "_today_map", _boom)
    assert groups.macro_board(9) == list(groups.MACRO_ROSTER)[:9]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_groups_macro.py -v`
Expected: FAIL — `AttributeError: module 'api.services.groups' has no attribute 'macro_board'`

- [ ] **Step 3: Write the implementation**

Append to `api/services/groups.py` right after `_macro_order`:

```python
def macro_board(n: int, seed: str = None) -> list:
    """The Index & Macro board, best-first, bounded to n cells.

    ONE batched snapshot over the 16 roster names (`_today_map` is already
    wall-clock bounded + briefly cached, so repeated typed commits reuse it).
    A snapshot failure is swallowed — the curated roster order is always a valid
    board, so this can never return empty or raise onto the request path.
    """
    try:
        today = _today_map(list(MACRO_ROSTER))
    except Exception:
        today = {}
    return _macro_order(today, seed)[: max(1, int(n))]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_groups_macro.py -v`
Expected: PASS — 12 passed

- [ ] **Step 5: Commit**

```bash
git add tests/test_groups_macro.py api/services/groups.py
git commit -m "Groups: macro_board fill with bounded snapshot + cold fallback"
```

---

### Task 3: Picker entry + `top_n` route

**Files:**
- Modify: `api/services/groups.py` — `list_groups()` (line ~160, at its `return`) and `top_n()` (line ~345, at its top)
- Test: `tests/test_groups_macro.py`

**Interfaces:**
- Consumes: `macro_board(n, seed)` (Task 2), `_ranked_as_of() -> str` (existing, `groups.py:318`)
- Produces:
  - `_macro_group_row() -> dict` — the picker row
  - `_macro_top_n(n: int) -> dict` — same response shape as `top_n()` for a real theme
  - `list_groups()` now returns the macro row FIRST
  - `top_n("index_macro", n)` now returns the macro board

- [ ] **Step 1: Write the failing test**

Append to `tests/test_groups_macro.py`:

```python
def _stub_themes(monkeypatch, rows):
    monkeypatch.setattr(groups, "_get_all_themes", lambda: {"sectors": [], "themes": rows})
    monkeypatch.setattr(groups, "_rotation_order", lambda: {})


def test_list_groups_pins_macro_first(monkeypatch):
    _stub_themes(monkeypatch, [
        {"id": "space", "name": "Space", "sector_id": "innovation", "etf_ticker": "UFO",
         "sub_themes": [], "holdings": [{"sym": "RKLB"}]},
    ])
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"RKLB"})
    out = groups.list_groups()
    assert out[0]["id"] == groups.MACRO_GROUP_ID
    assert out[0]["name"] == "Index & Macro"
    assert out[0]["sector_id"] == "macro"
    assert out[0]["etf_ticker"] is None
    assert out[0]["total"] == 16 and out[0]["chartable"] == 16
    assert out[0]["sub_theme_count"] == 0
    assert [r["id"] for r in out[1:]] == ["space"]      # themes still follow


def test_top_n_serves_the_macro_board(monkeypatch):
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    monkeypatch.setattr(groups, "_ranked_as_of", lambda: "closed")
    out = groups.top_n(groups.MACRO_GROUP_ID, 9)
    assert out["group_id"] == groups.MACRO_GROUP_ID
    assert out["syms"] == list(groups.MACRO_ROSTER)[:9]
    assert out["etf"] is None                           # pinEtf must be a no-op
    assert out["total"] == 16
    assert out["by"] == "today"
    assert [r["sym"] for r in out["rows"]] == out["syms"]
    assert [r["tier"] for r in out["rows"][:4]] == ["core"] * 4
    assert out["rows"][4]["tier"] == "relevant"
    assert all(r["source"] == "owner" for r in out["rows"])   # no engine dot


def test_top_n_macro_never_touches_theme_db(monkeypatch):
    """A macro top_n must not query holdings — it isn't a theme."""
    def _boom(_id):
        raise AssertionError("theme_db must not be queried for the macro group")

    monkeypatch.setattr(groups, "_theme_holdings", _boom)
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    monkeypatch.setattr(groups, "_ranked_as_of", lambda: "closed")
    assert groups.top_n(groups.MACRO_GROUP_ID, 4)["syms"] == list(groups.MACRO_CORE)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_groups_macro.py -v`
Expected: FAIL — `test_list_groups_pins_macro_first` fails with `AssertionError` (first row is `space`)

- [ ] **Step 3: Write the implementation**

3a. Append these two helpers to `api/services/groups.py` right after `macro_board`:

```python
def _macro_group_row() -> dict:
    """The picker row. Shaped exactly like a theme row so GroupPicker,
    MultiChartMenu prev/next, and refresh all treat it as an ordinary group."""
    return {
        "id": MACRO_GROUP_ID,
        "name": MACRO_GROUP_NAME,
        "sector_id": "macro",
        "etf_ticker": None,
        "total": len(MACRO_ROSTER),
        "chartable": len(MACRO_ROSTER),
        "sub_theme_count": 0,
    }


def _macro_top_n(n: int) -> dict:
    """top_n() for the synthetic group — same response contract, no theme_db."""
    syms = macro_board(n)
    return {
        "group_id": MACRO_GROUP_ID,
        "syms": syms,
        "rows": [{
            "sym": s,
            "tier": "core" if s in MACRO_CORE else "relevant",
            "rationale": "",
            "gate_score": None,
            "source": "owner",
        } for s in syms],
        "etf": None,
        "total": len(MACRO_ROSTER),
        "by": "today",
        "ranked_as_of": _ranked_as_of(),
    }
```

3b. In `list_groups()`, replace the final line:

```python
    rows.sort(key=lambda r: (_rank(r), r["name"]))
    return rows
```

with:

```python
    rows.sort(key=lambda r: (_rank(r), r["name"]))
    # Index & Macro is PINNED first: it has no rotation-signal entry, so without
    # this it would sink into the alphabetical tail of 100+ themes.
    return [_macro_group_row()] + rows
```

3c. In `top_n()`, insert the route as the first statement of the body (immediately after the `def top_n(theme_id: str, n: int, by: str = "today") -> dict:` line):

```python
    if theme_id == MACRO_GROUP_ID:
        return _macro_top_n(n)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_groups_macro.py tests/test_groups.py -v`
Expected: PASS — all macro tests plus the existing `test_groups.py` suite green (including `test_list_groups_shapes_and_chartable_count`, which looks its row up by id and is unaffected by the prepend)

- [ ] **Step 5: Commit**

```bash
git add tests/test_groups_macro.py api/services/groups.py
git commit -m "Groups: pin Index & Macro in the picker + serve it from top_n"
```

---

### Task 4: Extract the theme-peers payload (pure refactor)

Tasks 5 and 6 both need to return a full theme-peers payload for a theme the seed
is not a member of. Extract the existing tail of `resolve_peers` first, with NO
behavior change, so the refactor is verifiable on its own.

**Files:**
- Modify: `api/services/groups.py` — `resolve_peers()` (line ~556)
- Test: `tests/test_groups.py` (existing suite is the regression gate)

**Interfaces:**
- Consumes: `_theme_holdings`, `rank_holdings`, `_themes_for_ticker`, `_FACTOR_THEME_NAMES`, `normalize_sym` (all existing)
- Produces: `_theme_peers_payload(theme_id: str, theme_name: str | None, seed_hy: str, seed_sub: str | None, sym: str, n: int) -> dict` — the `source: "taxonomy"` response

- [ ] **Step 1: Write the failing test**

Append to `tests/test_groups_macro.py`:

```python
def test_theme_peers_payload_shape(monkeypatch):
    holdings = [
        {"sym": "AAA", "tier": "core", "source": "owner"},
        {"sym": "BBB", "tier": "core", "source": "engine"},
        {"sym": "SEED", "tier": "core", "source": "owner"},
    ]
    monkeypatch.setattr(groups, "_theme_holdings", lambda tid: holdings)
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"AAA", "BBB", "SEED"})
    monkeypatch.setattr(groups, "_today_map", lambda syms: {"AAA": 3.0, "BBB": 1.0})
    monkeypatch.setattr(groups, "_rs_map", lambda: {})
    monkeypatch.setattr(groups, "_themes_for_ticker", lambda s: [])
    out = groups._theme_peers_payload("space", "Space", "SEED", None, "SEED", 8)
    assert out["group_id"] == "space"
    assert out["group_name"] == "Space"
    assert out["seed"] == "SEED"
    assert out["source"] == "taxonomy"
    assert out["peers"] == ["AAA", "BBB"]          # seed excluded, ranked
    assert out["sources"] == {"AAA": "owner", "BBB": "engine"}
    assert out["also_in"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_groups_macro.py::test_theme_peers_payload_shape -v`
Expected: FAIL — `AttributeError: module 'api.services.groups' has no attribute '_theme_peers_payload'`

- [ ] **Step 3: Write the implementation**

Replace everything in `api/services/groups.py` from `    theme_id = row.get("theme_id")` to the end of `resolve_peers` with a call, and add the extracted helper ABOVE `resolve_peers`.

New helper, inserted immediately before `def resolve_peers`:

```python
def _theme_peers_payload(theme_id: str, theme_name: str, seed_hy: str,
                         seed_sub: str, sym: str, n: int) -> dict:
    """The taxonomy peer-fill response for a theme.

    Extracted so the ETF-front path (a seed that FRONTS a theme rather than
    belonging to it) returns a byte-identical shape to the membership path.
    """
    holdings = _theme_holdings(theme_id)
    # sub-theme float now lives in rank_holdings (seed_sub) so it composes with
    # the swing gate in one pass — liquidity floor first, then sub-theme, then momentum.
    ranked = rank_holdings(holdings, by="today", seed=seed_hy, seed_sub=seed_sub)

    # Multi-membership switcher: the seed's OTHER (non-factor) theme memberships,
    # so the UI can offer "also in: [groups]" to flip which group fills the grid.
    # Defensive — a theme-DB hiccup must never break the peer fill.
    try:
        also_in = [{"id": r.get("theme_id"), "name": r.get("theme_name")}
                   for r in _themes_for_ticker(sym)
                   if r.get("theme_id") and r.get("theme_id") != theme_id
                   and (r.get("theme_name") or "").strip().lower() not in _FACTOR_THEME_NAMES]
    except Exception:
        also_in = []

    # Per-sym membership source for the cell dot (T8): map each ranked sym back
    # to its holding's source. First occurrence wins, mirroring rank_holdings'
    # dedupe; absent source = owner (backward compatible). Peers stay bare syms.
    src_by_sym = {}
    for h in holdings:
        src_by_sym.setdefault(normalize_sym(h.get("sym", "")), h.get("source", "owner"))

    return {
        "seed": seed_hy,
        "also_in": also_in,
        "group_id": theme_id,
        # The theme's display name — without it the frontend header inherits the
        # PREVIOUS group's name on a taxonomy fill (verified mislabel bug).
        "group_name": theme_name,
        "peers": ranked[: max(1, int(n))],
        "sources": {s: src_by_sym.get(s, "owner") for s in ranked},
        "source": "taxonomy",
    }
```

`resolve_peers` now ends like this (the `if not row:` block is unchanged for now — Tasks 5 and 6 edit it):

```python
def resolve_peers(sym: str, n: int) -> dict:
    """Peers = the seed's primary theme's other chartable holdings, same
    sub-theme floated to the top, ranked by today's move. On a taxonomy miss,
    falls back to the seed's INDUSTRY cohort, then to grounded-Haiku AI peers."""
    seed_hy = normalize_sym(sym)
    row = resolve_primary_theme(sym)
    if not row:
        ind = _industry_peers(seed_hy, n)
        if ind and ind.get("peers"):
            return {"seed": seed_hy, "group_id": f"industry:{ind['industry']}",
                    "group_name": ind["industry"], "peers": ind["peers"], "source": "industry"}
        ai = _ai_peers(seed_hy, n)
        return {"seed": seed_hy, "group_id": None,
                "peers": ai, "source": "ai" if ai else "none"}

    return _theme_peers_payload(row.get("theme_id"), row.get("theme_name"),
                                seed_hy, row.get("sub_theme_id"), sym, n)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_groups.py tests/test_groups_macro.py tests/test_groups_gates.py -v`
Expected: PASS — every existing `resolve_peers` test still green (this is the point of the task: a pure extraction)

- [ ] **Step 5: Commit**

```bash
git add tests/test_groups_macro.py api/services/groups.py
git commit -m "Groups: extract _theme_peers_payload from resolve_peers (no behavior change)"
```

---

### Task 5: ETF-front resolution (typing SMH gives Semiconductors)

**Files:**
- Modify: `api/services/groups.py` — new `_etf_theme_map()` + a branch in `resolve_peers`
- Test: `tests/test_groups_macro.py`

**Interfaces:**
- Consumes: `_get_all_themes()`, `normalize_sym`, `_theme_peers_payload` (Task 4)
- Produces: `_etf_theme_map() -> dict[str, tuple[str, str]]` — `{ETF ticker: (theme_id, theme_name)}`, 1h cached; `_ETF_THEME_CACHE` dict for test resets

- [ ] **Step 1: Write the failing test**

Append to `tests/test_groups_macro.py`:

```python
_ETF_THEMES = [
    {"id": "semiconductors", "name": "Semiconductors", "sector_id": "tech",
     "etf_ticker": "SMH", "sub_themes": [],
     "holdings": [{"sym": "NVDA", "tier": "core"}, {"sym": "AVGO", "tier": "core"}]},
    {"id": "financials_broad", "name": "Financials", "sector_id": "fin",
     "etf_ticker": "XLF", "sub_themes": [], "holdings": [{"sym": "JPM", "tier": "core"}]},
]


def _stub_etf_themes(monkeypatch):
    groups._ETF_THEME_CACHE["map"] = None
    monkeypatch.setattr(groups, "_get_all_themes", lambda: {"themes": _ETF_THEMES})
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"NVDA", "AVGO", "JPM"})
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    monkeypatch.setattr(groups, "_rs_map", lambda: {})
    monkeypatch.setattr(groups, "_themes_for_ticker", lambda s: [])


def test_etf_theme_map_indexes_every_etf_backed_theme(monkeypatch):
    _stub_etf_themes(monkeypatch)
    m = groups._etf_theme_map()
    assert m["SMH"] == ("semiconductors", "Semiconductors")
    assert m["XLF"] == ("financials_broad", "Financials")


def test_typing_a_theme_etf_resolves_to_that_theme(monkeypatch):
    """SMH is a theme's etf_ticker, not a holding — before this it dead-ended."""
    _stub_etf_themes(monkeypatch)
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: None)
    out = groups.resolve_peers("SMH", 8)
    assert out["group_id"] == "semiconductors"
    assert out["group_name"] == "Semiconductors"
    assert out["source"] == "taxonomy"
    assert set(out["peers"]) == {"NVDA", "AVGO"}


def test_etf_front_never_overrides_a_real_membership(monkeypatch):
    """A seed that is BOTH a holding and an etf_ticker (IBIT) keeps its
    membership theme — step 1 wins over step 2."""
    _stub_etf_themes(monkeypatch)
    monkeypatch.setattr(groups, "resolve_primary_theme",
                        lambda s: {"theme_id": "financials_broad",
                                   "theme_name": "Financials", "sub_theme_id": None})
    out = groups.resolve_peers("SMH", 8)
    assert out["group_id"] == "financials_broad"


def test_etf_front_is_case_and_dot_insensitive(monkeypatch):
    _stub_etf_themes(monkeypatch)
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: None)
    assert groups.resolve_peers("smh", 8)["group_id"] == "semiconductors"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_groups_macro.py -v -k etf`
Expected: FAIL — `AttributeError: module 'api.services.groups' has no attribute '_ETF_THEME_CACHE'`

- [ ] **Step 3: Write the implementation**

3a. Add the cache pair next to the other module caches near the top of `api/services/groups.py` (after `_SIZES_CACHE` / `_SIZES_TTL`, around line 30):

```python
_ETF_THEME_CACHE = {"map": None, "at": 0.0}
_ETF_THEME_TTL = 3600.0
```

3b. Add the lookup immediately before `_theme_peers_payload`:

```python
def _etf_theme_map() -> dict:
    """{ETF ticker (hyphen upper) -> (theme_id, theme_name)} for every ETF-backed
    theme. A theme's etf_ticker is NOT stored as a holding, so `get_themes_for_ticker`
    misses it entirely — typing SMH used to dead-end even though Semiconductors is
    right there. Cached 1h; only a real (non-empty) map is cached, so a cold
    taxonomy read retries next call. First ETF wins on the (unexpected) duplicate."""
    now = time.monotonic()
    if _ETF_THEME_CACHE["map"] is not None and (now - _ETF_THEME_CACHE["at"]) < _ETF_THEME_TTL:
        return _ETF_THEME_CACHE["map"]
    out = {}
    try:
        for t in _get_all_themes().get("themes", []):
            etf = normalize_sym(t.get("etf_ticker") or "")
            if etf and etf not in out:
                out[etf] = (t["id"], t.get("name"))
    except Exception:
        out = {}
    if out:
        _ETF_THEME_CACHE["map"] = out
        _ETF_THEME_CACHE["at"] = now
    return out
```

3c. In `resolve_peers`, add the ETF-front branch as the FIRST thing inside `if not row:`:

```python
    row = resolve_primary_theme(sym)
    if not row:
        # The seed FRONTS a theme (it is the theme's ETF, not a holding).
        fronted = _etf_theme_map().get(seed_hy)
        if fronted:
            return _theme_peers_payload(fronted[0], fronted[1], seed_hy, None, sym, n)
        ind = _industry_peers(seed_hy, n)
        ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_groups_macro.py tests/test_groups.py -v`
Expected: PASS — all green

- [ ] **Step 5: Commit**

```bash
git add tests/test_groups_macro.py api/services/groups.py
git commit -m "Groups: typing a theme's ETF ticker resolves to that theme"
```

---

### Task 6: Macro routing in `resolve_peers`

**Files:**
- Modify: `api/services/groups.py` — new `_macro_peers()` + a branch in `resolve_peers`
- Test: `tests/test_groups_macro.py`

**Interfaces:**
- Consumes: `macro_board(n, seed)` (Task 2), `MACRO_TRIGGERS` (Task 1)
- Produces: `_macro_peers(seed_hy: str, n: int) -> dict | None` — the `source: "macro"` response, or `None` when the seed isn't a trigger

- [ ] **Step 1: Write the failing test**

Append to `tests/test_groups_macro.py`:

```python
def _stub_orphan(monkeypatch):
    """Seed resolves to no theme, no ETF-front, and the industry/AI fallbacks
    would fire — so anything that lands on macro got there on purpose."""
    groups._ETF_THEME_CACHE["map"] = None
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: None)
    monkeypatch.setattr(groups, "_etf_theme_map", lambda: {})
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    monkeypatch.setattr(groups, "_industry_peers",
                        lambda s, n: {"industry": "Banks - Regional", "peers": ["WAL"]})
    monkeypatch.setattr(groups, "_ai_peers", lambda s, n: [])


def test_typing_spy_fills_the_macro_board(monkeypatch):
    _stub_orphan(monkeypatch)
    out = groups.resolve_peers("SPY", 8)
    assert out["group_id"] == "index_macro"
    assert out["group_name"] == "Index & Macro"
    assert out["source"] == "macro"
    assert out["seed"] == "SPY"
    assert out["peers"] == ["QQQ", "IWM", "DIA", "VIXY", "SMH", "ARKK", "IBIT", "TLT"]
    assert "SPY" not in out["peers"]          # seed never duplicated into a peer cell


def test_typing_a_macro_trigger_outranks_the_industry_cohort(monkeypatch):
    """TLT's industry cohort would otherwise win — macro must be checked first."""
    _stub_orphan(monkeypatch)
    out = groups.resolve_peers("TLT", 8)
    assert out["group_id"] == "index_macro"
    assert out["peers"][:4] == ["SPY", "QQQ", "IWM", "DIA"]


def test_a_non_trigger_orphan_still_falls_through_to_industry(monkeypatch):
    _stub_orphan(monkeypatch)
    out = groups.resolve_peers("WAL", 8)
    assert out["group_id"] == "industry:Banks - Regional"
    assert out["source"] == "industry"


def test_macro_never_outranks_a_real_theme_membership(monkeypatch):
    """XLK is a macro trigger; if it ever GAINS a theme membership the theme wins."""
    _stub_orphan(monkeypatch)
    monkeypatch.setattr(groups, "resolve_primary_theme",
                        lambda s: {"theme_id": "software", "theme_name": "Software",
                                   "sub_theme_id": None})
    monkeypatch.setattr(groups, "_theme_holdings",
                        lambda tid: [{"sym": "MSFT", "tier": "core"}])
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"MSFT"})
    monkeypatch.setattr(groups, "_rs_map", lambda: {})
    monkeypatch.setattr(groups, "_themes_for_ticker", lambda s: [])
    out = groups.resolve_peers("XLK", 8)
    assert out["group_id"] == "software"


def test_macro_peers_returns_none_for_a_non_trigger():
    assert groups._macro_peers("NVDA", 8) is None


def test_macro_peers_respects_n(monkeypatch):
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    assert len(groups._macro_peers("SPY", 3)["peers"]) == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_groups_macro.py -v -k "macro_peers or fills_the_macro_board"`
Expected: FAIL — `AttributeError: module 'api.services.groups' has no attribute '_macro_peers'`

- [ ] **Step 3: Write the implementation**

3a. Add `_macro_peers` immediately after `_macro_top_n`:

```python
def _macro_peers(seed_hy: str, n: int) -> dict:
    """Peer-fill for a broad index / macro ETF, or None when the seed isn't one.

    Asks for n+1 names and drops the seed, so the caller always gets exactly n
    peers whether or not the seed is a roster member (VOO is a trigger but not a
    member; SPY is both)."""
    if seed_hy not in MACRO_TRIGGERS:
        return None
    peers = [s for s in macro_board(int(n) + 1, seed_hy) if s != seed_hy]
    return {
        "seed": seed_hy,
        "group_id": MACRO_GROUP_ID,
        "group_name": MACRO_GROUP_NAME,
        "peers": peers[: max(1, int(n))],
        "source": "macro",
    }
```

3b. In `resolve_peers`, add the macro branch AFTER the ETF-front branch and BEFORE the industry fallback:

```python
    row = resolve_primary_theme(sym)
    if not row:
        # The seed FRONTS a theme (it is the theme's ETF, not a holding).
        fronted = _etf_theme_map().get(seed_hy)
        if fronted:
            return _theme_peers_payload(fronted[0], fronted[1], seed_hy, None, sym, n)
        # A broad index / macro ETF: its Finviz industry is the catch-all
        # "Exchange Traded Fund", so the industry fallback below would refuse it
        # and the seed would sit alone. Check macro FIRST.
        macro = _macro_peers(seed_hy, n)
        if macro:
            return macro
        ind = _industry_peers(seed_hy, n)
        ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_groups_macro.py tests/test_groups.py tests/test_groups_gates.py -v`
Expected: PASS — all green

- [ ] **Step 5: Commit**

```bash
git add tests/test_groups_macro.py api/services/groups.py
git commit -m "Groups: route broad index/macro ETFs to the Index & Macro board"
```

---

### Task 7: Verify every roster member actually charts

`VIXY`, `UUP`, `RSP` and `IBIT` are NOT in `cap_universe.json`, and the macro
board deliberately bypasses `is_chartable`. That exemption is only safe if those
symbols really return bars — a permanently blank cell is worse than a shorter
roster. This task is the gate.

**Files:**
- Modify (only if a symbol fails): `api/services/groups.py` — `MACRO_REST`
- Modify (only if a symbol fails): `tests/test_groups_macro.py` — the roster-length assertions

- [ ] **Step 1: Probe production for every roster member**

Production `/api/bars/{ticker}` needs no auth, but **Cloudflare 1010-blocks raw
curl/python user-agents** — send a browser UA. Run from PowerShell:

```powershell
$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
foreach ($s in @("SPY","QQQ","IWM","DIA","VIXY","SMH","ARKK","IBIT","TLT","HYG","GLD","SLV","UUP","RSP","XLK","XLF")) {
  try {
    $r = Invoke-RestMethod -Uri "https://uctintelligence.com/api/bars/$s`?tf=D&bars=5" -Headers @{ "User-Agent" = $ua } -TimeoutSec 30
    $n = @($r.bars).Count
    $last = if ($n -gt 0) { @($r.bars)[-1].t } else { "-" }
    "{0,-6} bars={1,-4} last={2}" -f $s, $n, $last
  } catch { "{0,-6} FAILED: {1}" -f $s, $_.Exception.Message }
}
```

Expected: every row shows `bars=5` with a recent `last` date. Record the output.

- [ ] **Step 2: Act on any failure**

- If **all 16 pass** → no code change. Skip to Step 3.
- If a symbol returns `bars=0`, 404s, or errors → **remove it from `MACRO_REST`**
  in `api/services/groups.py`, and update the two roster-size assertions in
  `tests/test_groups_macro.py` (`len(groups.MACRO_ROSTER) == 16` → the new count,
  in `test_macro_roster_is_16_names_core_first`; `out[0]["total"] == 16` and
  `chartable == 16` in `test_list_groups_pins_macro_first`; `out["total"] == 16`
  in `test_top_n_serves_the_macro_board`), plus `test_macro_board_4x4_shows_all_16`
  if the roster drops below 16. Also fix the expected peer list in
  `test_typing_spy_fills_the_macro_board`. Do NOT remove a core-four name — if
  SPY/QQQ/IWM/DIA ever failed, that is a platform outage, not a roster problem;
  stop and report.
- A **trigger** that fails is fine and needs no change (triggers only route; they
  are charted as the seed cell, which the user typed deliberately).

- [ ] **Step 3: Run the suite + commit**

Run: `python -m pytest tests/test_groups_macro.py tests/test_groups.py -v`
Expected: PASS

```bash
git add api/services/groups.py tests/test_groups_macro.py
git commit -m "Groups: verify macro roster chartability against production bars"
```

(If nothing changed, skip the commit and note "all 16 verified chartable" in the task report.)

---

### Task 8: Full suite + ship

**Files:** none modified

- [ ] **Step 1: Run the full backend suite**

Run: `python -m pytest tests/ -q`
Expected: PASS. Known pre-existing failures in this repo: 7 failures in
`test_hist_stats` — those are unrelated to this change and were failing before it.
Any NEW failure must be fixed before shipping.

- [ ] **Step 2: Confirm the broker-sync merge invariant**

Run: `grep -c broker_sync api/main.py`
Expected: a number **≥ 7**. (This repo has a locked invariant that a master merge
can silently drop the broker_sync wiring; verify before every push.)

- [ ] **Step 3: Confirm the deploy window**

Run: `powershell -Command "[System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow,'Eastern Standard Time').ToString('yyyy-MM-dd HH:mm')"`

Web pushes are blocked Mon–Fri 09:15–16:20 ET by `.git/hooks/pre-push` (options
tape protection). If the current ET time is inside that window on a weekday,
**stop and report** — the work is committed and ready; the owner ships it after
16:20 ET. Do NOT set any push-override env var.

- [ ] **Step 4: Push**

Ravi co-edits master, so fetch/rebase/push must be ONE command to avoid racing:

```bash
git fetch origin && git rebase origin/master && git push origin feat/index-macro-group:master
```

- [ ] **Step 5: Verify the deploy**

After Railway finishes (~3-5 min), confirm the new group is live:

```powershell
$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
$g = Invoke-RestMethod -Uri "https://uctintelligence.com/api/groups" -Headers @{ "User-Agent" = $ua }
$g.groups[0] | Format-List id, name, total          # expect index_macro / Index & Macro / 16
Invoke-RestMethod -Uri "https://uctintelligence.com/api/groups/peers?sym=SPY&n=8" -Headers @{ "User-Agent" = $ua }
Invoke-RestMethod -Uri "https://uctintelligence.com/api/groups/peers?sym=SMH&n=8" -Headers @{ "User-Agent" = $ua }
```

Expected: `/api/groups` leads with the macro row; `sym=SPY` returns
`group_id: index_macro` with 8 peers; `sym=SMH` returns `group_id: semiconductors`
(NOT macro) with real semiconductor peers.

---

## Notes for the implementer

- `_today_map` is already hard-bounded (`_TODAY_TIMEOUT_S`, default 3s) and cached
  per sym-set (`_TODAY_CACHE_TTL`, default 20s). Do **not** add another timeout,
  cache, or thread pool around it.
- Tests that touch `_today_map` for real must clear `groups._TODAY_CACHE` first;
  every test in this plan monkeypatches `_today_map` wholesale instead, which is
  simpler and has no cache interaction.
- `_ETF_THEME_CACHE["map"] = None` must be reset at the start of any test that
  stubs `_get_all_themes`, or a map cached by an earlier test leaks in.
- The frontend needs no changes. If you find yourself editing anything under
  `app/src/pages/charts/grid/`, stop — something has gone wrong with the
  backend contract instead.
