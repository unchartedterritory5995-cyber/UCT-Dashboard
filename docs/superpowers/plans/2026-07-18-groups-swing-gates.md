# Live Swing Gates for Groups — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bias Groups' existing `rank_holdings` ordering toward swing-tradable names (liquid, high-RS, good range, real price) at query time — never dropping a name, never raising, default-OFF — so the taxonomy map never needs pruning for strength.

**Architecture:** A new `api/services/groups_gates.py` computes, per name, a 3-tier **liquidity band** (confirmed-liquid / unconfirmed / confirmed-illiquid — a hard prefilter) plus an **RS+ADR momentum sub-score** (0–2, within each liquidity tier). These bands are *prepended* to `rank_holdings`'s existing sort key when the flag is on; when off, the sort key is byte-identical to today. Data is cheap and already in the pod: RS from the `rs_ranking` cache, price/$-vol/ADR from the nightly `screener.db` (batched + cached), price made live via the intraday move `rank_holdings` already fetches.

**Tech Stack:** Python 3.12, FastAPI, SQLite (`screener.db`), pytest.

## Global Constraints

- **Never drop a name; never raise.** The gate only re-orders. Any error / missing data degrades gracefully (name lands in the unconfirmed band), it never removes a holding or throws.
- **Default-OFF.** `GROUPS_SWING_GATES_ENABLED` defaults to `"0"`. When off, `swing_metrics` is **not called** and `rank_holdings`'s ordering is **byte-identical** to today.
- **`rs_rank` comes ONLY from the `rs_ranking` cache** (the `rs` dict passed into `swing_metrics`) — NEVER the screener row's own `rs_rank` column (a different metric from `research_ratings.db`).
- **Live price for the price/$-vol gates:** `current_price = screener_close × (1 + today_pct/100)` (the `theme_performance._apply_live_returns` idiom). ADR uses the screener's EOD figure.
- **Thresholds are env-tunable, defensively parsed** (a malformed value → default + one warning, never a 500): `GROUPS_GATE_RS_MIN=70`, `GROUPS_GATE_DOLLARVOL_MIN=20000000`, `GROUPS_GATE_ADR_MIN=4.0`, `GROUPS_GATE_PRICE_MIN=5.0`.
- **Canonical symbol form is hyphen+upper** (`normalize_sym`); `screener.db` tickers are hyphen+upper (built from cap_universe). Match directly.
- Backend tests: `python -m pytest <file> -q` from the repo root `C:/Users/Patrick/uct-worktrees/multichart-grid`.
- Shared worktree: commit with **explicit file paths only, NEVER `git add -A`**.

## File Structure

- **Create `api/services/groups_gates.py`** — all gate logic: defensive thresholds, `gates_enabled`, pure `gate_bands`/`gate_score`, and the data-assembly `swing_metrics` (batched+cached screener read, live-price derive, staleness guard).
- **Modify `api/services/screener/snapshot_db.py`** — add `get_rows(tickers)` batch reader (one connection, `IN`-clause).
- **Modify `api/services/groups.py`** — `rank_holdings` gains `seed_sub`/`scores_out` params + the gate bands; `resolve_peers` folds its sub-theme float into `rank_holdings`; `top_n` surfaces `gate_score`.
- **Create `tests/test_groups_gates.py`**, **`tests/test_snapshot_db_getrows.py`**; extend **`tests/test_groups.py`**.

---

## Task 1: `groups_gates.py` — thresholds, flag, and the pure band logic

**Files:**
- Create: `api/services/groups_gates.py`
- Test: `tests/test_groups_gates.py`

**Interfaces:**
- Produces: `gates_enabled() -> bool`; `gate_bands(m: dict|None) -> (liq_band:int, momentum:int)` where `liq_band∈{0,1,2}` (0 confirmed-liquid, 1 unconfirmed, 2 confirmed-illiquid) and `momentum∈{0,1,2}`; `gate_score(m: dict|None) -> int` (0–4 composite for observability); `pass_rates(metrics_map: dict) -> {rs,dvol,adr,px,n}` (per-gate pass counts for logging); module constants `RS_MIN, DVOL_MIN, ADR_MIN, PX_MIN` and helper `_env_float(name, default)`. `m` shape: `{rs_rank, dollar_vol, adr_pct, price}` (any value may be `None`).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_groups_gates.py
import importlib
from api.services import groups_gates as g


def test_env_float_defaults_on_bad_value(monkeypatch):
    monkeypatch.setenv("X_BAD", "not-a-number")
    assert g._env_float("X_BAD", 4.0) == 4.0
    monkeypatch.setenv("X_OK", "12.5")
    assert g._env_float("X_OK", 4.0) == 12.5
    monkeypatch.delenv("X_MISSING", raising=False)
    assert g._env_float("X_MISSING", 7.0) == 7.0


def test_gates_enabled_default_off(monkeypatch):
    monkeypatch.delenv("GROUPS_SWING_GATES_ENABLED", raising=False)
    assert g.gates_enabled() is False
    monkeypatch.setenv("GROUPS_SWING_GATES_ENABLED", "1")
    assert g.gates_enabled() is True
    monkeypatch.setenv("GROUPS_SWING_GATES_ENABLED", "0")
    assert g.gates_enabled() is False


def test_gate_bands_liquidity_tiers(monkeypatch):
    monkeypatch.setattr(g, "PX_MIN", 5.0)
    monkeypatch.setattr(g, "DVOL_MIN", 20_000_000.0)
    monkeypatch.setattr(g, "RS_MIN", 70.0)
    monkeypatch.setattr(g, "ADR_MIN", 4.0)
    # confirmed liquid + full momentum
    assert g.gate_bands({"price": 50, "dollar_vol": 5e8, "rs_rank": 88, "adr_pct": 6}) == (0, 2)
    # confirmed liquid, no momentum
    assert g.gate_bands({"price": 50, "dollar_vol": 5e8, "rs_rank": 30, "adr_pct": 2}) == (0, 0)
    # missing price -> unconfirmed (band 1), even with great momentum (IPO case)
    assert g.gate_bands({"price": None, "dollar_vol": None, "rs_rank": 90, "adr_pct": 7}) == (1, 2)
    # confirmed illiquid: real data below floors -> band 2, momentum still computed
    assert g.gate_bands({"price": 2.0, "dollar_vol": 1e6, "rs_rank": 88, "adr_pct": 6}) == (2, 2)
    # missing momentum inputs count 0, not failure
    assert g.gate_bands({"price": 50, "dollar_vol": 5e8, "rs_rank": None, "adr_pct": None}) == (0, 0)
    # None / empty metrics -> unconfirmed, zero momentum
    assert g.gate_bands(None) == (1, 0)


def test_gate_score_composite(monkeypatch):
    monkeypatch.setattr(g, "PX_MIN", 5.0)
    monkeypatch.setattr(g, "DVOL_MIN", 20_000_000.0)
    monkeypatch.setattr(g, "RS_MIN", 70.0)
    monkeypatch.setattr(g, "ADR_MIN", 4.0)
    assert g.gate_score({"price": 50, "dollar_vol": 5e8, "rs_rank": 88, "adr_pct": 6}) == 4  # liq2 + mom2
    assert g.gate_score({"price": 2.0, "dollar_vol": 1e6, "rs_rank": 88, "adr_pct": 6}) == 2  # liq0 + mom2
    assert g.gate_score(None) == 1  # unconfirmed liq(1) + mom0


def test_pass_rates_counts_each_gate(monkeypatch):
    monkeypatch.setattr(g, "PX_MIN", 5.0)
    monkeypatch.setattr(g, "DVOL_MIN", 20_000_000.0)
    monkeypatch.setattr(g, "RS_MIN", 70.0)
    monkeypatch.setattr(g, "ADR_MIN", 4.0)
    pr = g.pass_rates({
        "A": {"price": 50, "dollar_vol": 5e8, "rs_rank": 88, "adr_pct": 6},   # all four pass
        "B": {"price": 2, "dollar_vol": 1e6, "rs_rank": 30, "adr_pct": 2},    # none pass
    })
    assert pr == {"rs": 1, "dvol": 1, "adr": 1, "px": 1, "n": 2}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_groups_gates.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.services.groups_gates'`.

- [ ] **Step 3: Implement**

Create `api/services/groups_gates.py`:

```python
"""Live swing-trade quality gates for Groups ranking.

Biases rank_holdings toward tradable names (liquid, high-RS, good range, real
price) at query time, so the taxonomy map never needs pruning for strength.
NEVER drops a name and NEVER raises — it only re-orders. Default OFF (dark).

rs_rank comes ONLY from the rs_ranking cache (passed in as `rs`), NOT the
screener's own rs_rank column (a different metric). price/$-vol are LIVE
(derived from the intraday move); ADR is the screener's EOD figure.
"""
import logging
import os
import time

from api.services.screener import snapshot_db

_logger = logging.getLogger(__name__)


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        _logger.warning("groups_gates: bad %s=%r, using default %s",
                        name, os.environ.get(name), default)
        return default


RS_MIN = _env_float("GROUPS_GATE_RS_MIN", 70.0)
DVOL_MIN = _env_float("GROUPS_GATE_DOLLARVOL_MIN", 20_000_000.0)
ADR_MIN = _env_float("GROUPS_GATE_ADR_MIN", 4.0)
PX_MIN = _env_float("GROUPS_GATE_PRICE_MIN", 5.0)
_STALE_SECS = _env_float("GROUPS_GATE_STALE_SECS", 4 * 86400.0)

# Screener rows change once/night — cache the batched read briefly.
_ROWS_CACHE = {}          # {frozenset(syms): (monotonic_at, {sym: row})}
_ROWS_TTL = 3600.0


def gates_enabled() -> bool:
    return os.environ.get("GROUPS_SWING_GATES_ENABLED", "0") == "1"


def _num(v):
    """float(v) or None — guards NULLs and stray bad types from SQLite."""
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def gate_bands(m: dict | None) -> tuple:
    """(liq_band, momentum) for {rs_rank, dollar_vol, adr_pct, price}.

    liq_band: 0 confirmed-liquid (price & $-vol present and >= floors),
              1 unconfirmed (price or $-vol missing — can't tell),
              2 confirmed-illiquid (present but below a floor).
    momentum: (rs_rank>=RS_MIN) + (adr_pct>=ADR_MIN), missing counts 0.
    Higher momentum is better; the caller negates it in the sort key.
    """
    m = m or {}
    price = _num(m.get("price"))
    dvol = _num(m.get("dollar_vol"))
    if price is None or dvol is None:
        liq = 1
    elif price >= PX_MIN and dvol >= DVOL_MIN:
        liq = 0
    else:
        liq = 2
    rs = _num(m.get("rs_rank"))
    adr = _num(m.get("adr_pct"))
    momentum = (1 if (rs is not None and rs >= RS_MIN) else 0) \
        + (1 if (adr is not None and adr >= ADR_MIN) else 0)
    return (liq, momentum)


def gate_score(m: dict | None) -> int:
    """Compact 0-4 for observability ('why did X rank here'):
    confirmed-liquid=2 / unconfirmed=1 / confirmed-illiquid=0, plus momentum."""
    liq, momentum = gate_bands(m)
    return {0: 2, 1: 1, 2: 0}[liq] + momentum


def pass_rates(metrics_map: dict) -> dict:
    """Per-gate pass counts across a fill's metrics, for spotting ADR/$-vol
    co-collapse in quiet tape (RS is a 1-99 percentile — it can't collapse
    market-wide, so watch the absolute gates)."""
    out = {"rs": 0, "dvol": 0, "adr": 0, "px": 0, "n": 0}
    for m in (metrics_map or {}).values():
        m = m or {}
        out["n"] += 1
        rs, adr = _num(m.get("rs_rank")), _num(m.get("adr_pct"))
        px, dv = _num(m.get("price")), _num(m.get("dollar_vol"))
        if rs is not None and rs >= RS_MIN:
            out["rs"] += 1
        if adr is not None and adr >= ADR_MIN:
            out["adr"] += 1
        if px is not None and px >= PX_MIN:
            out["px"] += 1
        if dv is not None and dv >= DVOL_MIN:
            out["dvol"] += 1
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_groups_gates.py -q`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add api/services/groups_gates.py tests/test_groups_gates.py
git commit -m "feat(groups): swing-gate band logic (liquidity prefilter + RS/ADR momentum), default off"
```

---

## Task 2: `snapshot_db.get_rows` — batched screener read

**Files:**
- Modify: `api/services/screener/snapshot_db.py` (add `get_rows` after `get_row`, ~line 112)
- Test: `tests/test_snapshot_db_getrows.py`

**Interfaces:**
- Produces: `snapshot_db.get_rows(tickers: list) -> dict[str, dict]` — `{ticker: row-dict}` for the tickers present, one connection, `IN`-clause. Tickers uppercased to match the stored PK. Empty/no-match → `{}`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_snapshot_db_getrows.py
from api.services.screener import snapshot_db


def test_get_rows_batches_and_matches_pk(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()
    snapshot_db.upsert_rows([
        {"ticker": "RKLB", "price": 24.0, "avg_volume_30d": 9_000_000, "adr_pct": 6.1, "built_at": 111},
        {"ticker": "ASTS", "price": 40.0, "avg_volume_30d": 3_000_000, "adr_pct": 8.0, "built_at": 111},
    ])
    out = snapshot_db.get_rows(["rklb", "ASTS", "ZZZZ"])   # lower-case + a miss
    assert set(out.keys()) == {"RKLB", "ASTS"}             # matched, PK-cased; miss absent
    assert out["RKLB"]["price"] == 24.0
    assert out["ASTS"]["adr_pct"] == 8.0
    assert snapshot_db.get_rows([]) == {}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_snapshot_db_getrows.py -q`
Expected: FAIL — `AttributeError: module ... has no attribute 'get_rows'`.

- [ ] **Step 3: Implement**

In `api/services/screener/snapshot_db.py`, add immediately after `get_row` (after line 111):

```python
def get_rows(tickers: list) -> dict:
    """Batch fetch: {ticker: row-dict} for the given tickers, one connection.
    Tickers are uppercased to match the stored PK; misses are simply absent."""
    tks = [t.upper() for t in tickers if t]
    if not tks:
        return {}
    out = {}
    with connect() as conn:
        # SQLite's variable limit is 999; theme fill-sets are <=50, chunk to be safe.
        for i in range(0, len(tks), 900):
            chunk = tks[i:i + 900]
            ph = ", ".join("?" for _ in chunk)
            for r in conn.execute(
                    f"SELECT * FROM screener_rows WHERE ticker IN ({ph})", chunk):
                out[r["ticker"]] = dict(r)
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_snapshot_db_getrows.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/screener/snapshot_db.py tests/test_snapshot_db_getrows.py
git commit -m "feat(screener): batched get_rows(tickers) reader for gate metrics"
```

---

## Task 3: `swing_metrics` — live-price + cached batch assembly

**Files:**
- Modify: `api/services/groups_gates.py` (add `_get_rows_cached` + `swing_metrics` below `gate_score`)
- Test: `tests/test_groups_gates.py` (append)

**Interfaces:**
- Consumes: `snapshot_db.get_rows` (Task 2); the `rs` dict `{sym: {"rs_rank": int|None, "returns": {...}}}` and `today` dict `{sym: pct}` that `rank_holdings` already builds.
- Produces: `swing_metrics(syms: list, rs: dict, today: dict) -> {sym: {rs_rank, dollar_vol, adr_pct, price}}`. `price` is live (`screener_close × (1+pct/100)`, falls back to close when no live pct); `dollar_vol = price × avg_volume_30d`; `rs_rank` from `rs` only; a screener row older than `_STALE_SECS` (built_at epoch seconds) is treated as missing. Never raises.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_groups_gates.py  (append)
def test_swing_metrics_live_price_and_rs_source(monkeypatch):
    # get_rows returns EOD close + avg vol + adr + a fresh built_at; screener's
    # own rs_rank must be IGNORED (rs comes from the rs_ranking cache dict).
    import time as _t
    fresh = int(_t.time())
    monkeypatch.setattr(g.snapshot_db, "get_rows", lambda tks: {
        "RKLB": {"price": 20.0, "avg_volume_30d": 10_000_000, "adr_pct": 6.0,
                 "rs_rank": 5, "built_at": fresh},   # screener rs_rank 5 = trap, must be ignored
    })
    g._ROWS_CACHE.clear()
    rs = {"RKLB": {"rs_rank": 88, "returns": {"1m": 3.0}}}
    today = {"RKLB": 10.0}                            # +10% intraday
    m = g.swing_metrics(["RKLB"], rs, today)["RKLB"]
    assert m["price"] == 22.0                         # 20 * 1.10 live
    assert m["dollar_vol"] == 22.0 * 10_000_000       # live price * avg vol
    assert m["adr_pct"] == 6.0
    assert m["rs_rank"] == 88                          # from rs dict, NOT screener's 5


def test_swing_metrics_missing_row_and_stale(monkeypatch):
    import time as _t
    old = int(_t.time()) - int(g._STALE_SECS) - 100
    monkeypatch.setattr(g.snapshot_db, "get_rows", lambda tks: {
        "STALE": {"price": 9.0, "avg_volume_30d": 1e6, "adr_pct": 5.0, "built_at": old},
    })
    g._ROWS_CACHE.clear()
    out = g.swing_metrics(["STALE", "NOROW"], rs={}, today={})
    # stale row -> all price/vol/adr None (treated as missing)
    assert out["STALE"] == {"rs_rank": None, "dollar_vol": None, "adr_pct": None, "price": None}
    # no row at all -> same
    assert out["NOROW"] == {"rs_rank": None, "dollar_vol": None, "adr_pct": None, "price": None}


def test_swing_metrics_never_raises_on_getrows_error(monkeypatch):
    def boom(tks):
        raise RuntimeError("db locked")
    monkeypatch.setattr(g.snapshot_db, "get_rows", boom)
    g._ROWS_CACHE.clear()
    out = g.swing_metrics(["AAA"], rs={"AAA": {"rs_rank": 90}}, today={})
    assert out["AAA"]["price"] is None and out["AAA"]["rs_rank"] == 90
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_groups_gates.py -q`
Expected: FAIL — `AttributeError: module ... has no attribute 'swing_metrics'`.

- [ ] **Step 3: Implement**

In `api/services/groups_gates.py`, append after `gate_score`:

```python
def _get_rows_cached(syms: tuple) -> dict:
    key = frozenset(syms)
    now = time.monotonic()
    hit = _ROWS_CACHE.get(key)
    if hit and (now - hit[0]) < _ROWS_TTL:
        return hit[1]
    try:
        rows = snapshot_db.get_rows(list(syms))
    except Exception:
        rows = {}
    _ROWS_CACHE[key] = (now, rows)
    if len(_ROWS_CACHE) > 256:          # keep the cache tiny; fill-sets repeat
        _ROWS_CACHE.clear()
        _ROWS_CACHE[key] = (now, rows)
    return rows


def swing_metrics(syms: list, rs: dict, today: dict) -> dict:
    """{sym: {rs_rank, dollar_vol, adr_pct, price}} for gating. Never raises.

    price/$-vol are LIVE: current = screener_close * (1 + today_pct/100), with a
    fallback to the close when there is no live pct. rs_rank comes from `rs`
    (the rs_ranking cache) ONLY. A screener row older than _STALE_SECS is
    treated as missing (guards a silently-stalled nightly build).
    """
    syms = [s for s in syms if s]
    if not syms:
        return {}
    rows = _get_rows_cached(tuple(sorted(syms)))
    now = time.time()
    out = {}
    for hy in syms:
        row = rows.get(hy)
        stale = bool(row) and row.get("built_at") is not None \
            and (now - float(row["built_at"])) > _STALE_SECS
        usable = row if (row and not stale) else None
        prev_close = _num(usable.get("price")) if usable else None
        avg_vol = _num(usable.get("avg_volume_30d")) if usable else None
        adr = _num(usable.get("adr_pct")) if usable else None
        pct = _num((today or {}).get(hy))
        cur_price = (prev_close * (1 + pct / 100.0)) if (prev_close is not None and pct is not None) else prev_close
        dvol = (cur_price * avg_vol) if (cur_price is not None and avg_vol is not None) else None
        out[hy] = {
            "rs_rank": ((rs or {}).get(hy) or {}).get("rs_rank"),
            "dollar_vol": dvol,
            "adr_pct": adr,
            "price": cur_price,
        }
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_groups_gates.py -q`
Expected: PASS (all Task 1 + Task 3 tests).

- [ ] **Step 5: Commit**

```bash
git add api/services/groups_gates.py tests/test_groups_gates.py
git commit -m "feat(groups): swing_metrics — live price + cached batch + rs-cache source + staleness guard"
```

---

## Task 4: Gate `rank_holdings` (bands + `seed_sub`/`scores_out`, flag-off identical)

**Files:**
- Modify: `api/services/groups.py` (`rank_holdings`, lines 171-209)
- Test: `tests/test_groups.py` (append)

**Interfaces:**
- Consumes: `groups_gates.gates_enabled`, `swing_metrics`, `gate_bands`, `gate_score` (Tasks 1/3).
- Produces: `rank_holdings(holdings, by="today", seed=None, seed_sub=None, scores_out=None) -> list[str]`. New optional params: `seed_sub` (taxonomy sub_theme_id of the seed → inserts a sub-theme relevance band, gated position per spec §4); `scores_out` (a dict the caller passes to receive `{sym: gate_score}`, populated only when gates are on). When gates off, ordering is byte-identical to the current implementation.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_groups.py  (append)
from api.services import groups_gates


def _mock_gate_env(monkeypatch, enabled, metrics):
    monkeypatch.setattr(groups_gates, "gates_enabled", lambda: enabled)
    monkeypatch.setattr(groups_gates, "swing_metrics", lambda syms, rs, today: metrics)


def test_rank_holdings_flag_off_is_byte_identical(monkeypatch):
    # Same fixture as test_rank_holdings_today_then_fallbacks — gates OFF must
    # produce the identical order, and must NOT call swing_metrics.
    holdings = [
        {"sym": "AAA", "tier": "core"}, {"sym": "BBB", "tier": "core"},
        {"sym": "CCC", "tier": "relevant"}, {"sym": "DDD", "tier": "peripheral"},
    ]
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"AAA", "BBB", "CCC", "DDD"})
    monkeypatch.setattr(groups, "_today_map", lambda syms: {"AAA": 5.0})
    monkeypatch.setattr(groups, "_rs_map", lambda: {"BBB": {"rs_rank": 80, "returns": {"1m": 3.0}},
                                                    "CCC": {"rs_rank": None, "returns": {"1m": 12.0}}})
    def _boom(*a, **k):
        raise AssertionError("swing_metrics must not run when gates are off")
    monkeypatch.setattr(groups_gates, "gates_enabled", lambda: False)
    monkeypatch.setattr(groups_gates, "swing_metrics", _boom)
    assert groups.rank_holdings(holdings, by="today") == ["AAA", "BBB", "CCC", "DDD"]


def test_rank_holdings_gated_liquidity_leads_and_fills(monkeypatch):
    # LIQUID (band0) leads; ILLIQUID (band2) sinks to backfill; UNCONFIRMED
    # (band1, e.g. fresh IPO) sits between. All names still present.
    holdings = [
        {"sym": "PENNY", "tier": "core"},   # confirmed illiquid, high today move
        {"sym": "IPO", "tier": "core"},     # unconfirmed (no screener row)
        {"sym": "LEAD", "tier": "core"},    # confirmed liquid + momentum
    ]
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"PENNY", "IPO", "LEAD"})
    monkeypatch.setattr(groups, "_today_map", lambda syms: {"PENNY": 9.0, "LEAD": 1.0})
    monkeypatch.setattr(groups, "_rs_map", lambda: {})
    _mock_gate_env(monkeypatch, True, {
        "LEAD":  {"price": 50, "dollar_vol": 5e8, "rs_rank": 88, "adr_pct": 6},   # band0 mom2
        "PENNY": {"price": 2.0, "dollar_vol": 1e6, "rs_rank": 90, "adr_pct": 9},  # band2
        "IPO":   {"price": None, "dollar_vol": None, "rs_rank": None, "adr_pct": None},  # band1
    })
    assert groups.rank_holdings(holdings, by="today") == ["LEAD", "IPO", "PENNY"]


def test_rank_holdings_scores_out_populated_only_when_on(monkeypatch):
    holdings = [{"sym": "LEAD", "tier": "core"}]
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"LEAD"})
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    monkeypatch.setattr(groups, "_rs_map", lambda: {})
    _mock_gate_env(monkeypatch, True, {"LEAD": {"price": 50, "dollar_vol": 5e8, "rs_rank": 88, "adr_pct": 6}})
    scores = {}
    groups.rank_holdings(holdings, by="today", scores_out=scores)
    assert scores["LEAD"] == 4      # liq2 + mom2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_groups.py -q`
Expected: FAIL — `rank_holdings` has no `scores_out`/`seed_sub` params (TypeError) and no gating.

- [ ] **Step 3: Implement**

Replace the body of `rank_holdings` in `api/services/groups.py` (lines 171-209). Keep the `bands` closure **verbatim**; only the signature, the gating block, and the sort key change:

```python
def rank_holdings(holdings: list, by: str = "today", seed: str = None,
                  seed_sub: str = None, scores_out: dict = None) -> list:
    """Rank taxonomy holdings; return chartable hyphen syms best-first.

    holdings: [{sym, tier, sub_theme_id?}] in taxonomy (dot) form.
    Excludes the seed and non-chartable names. No-data names sort last.

    When GROUPS_SWING_GATES_ENABLED, prepends swing-quality bands (a hard
    liquidity prefilter + an RS/ADR momentum sub-score) to the existing order;
    when off, the ordering is byte-identical to the pre-gate implementation.
    seed_sub (peer-fill) floats same-sub-theme names within the liquid tier.
    scores_out, if a dict, receives {sym: gate_score} for observability.
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
        return (len(order), tier)

    from api.services import groups_gates
    on = groups_gates.gates_enabled()
    metrics = groups_gates.swing_metrics([hy for _, hy, _ in cands], rs, today) if on else {}
    if on:
        _logger.debug("groups swing-gate pass-rates: %s", groups_gates.pass_rates(metrics))
        if scores_out is not None:
            for _, hy, _ in cands:
                scores_out[hy] = groups_gates.gate_score(metrics.get(hy))

    def sort_key(c):
        idx, hy, h = c
        existing = bands(hy, h)
        sub_band = 0 if (seed_sub and h.get("sub_theme_id") == seed_sub) else 1
        if on:
            liq, mom = groups_gates.gate_bands(metrics.get(hy))
            if seed_sub is not None:
                return (liq, sub_band, -mom, existing, idx)
            return (liq, -mom, existing, idx)
        if seed_sub is not None:
            return (sub_band, existing, idx)
        return (existing, idx)

    cands.sort(key=sort_key)
    return [hy for _, hy, _ in cands]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_groups.py -q`
Expected: PASS — the new gated tests plus the existing `test_rank_holdings_today_then_fallbacks` (unchanged behavior with gates off).

- [ ] **Step 5: Commit**

```bash
git add api/services/groups.py tests/test_groups.py
git commit -m "feat(groups): gate rank_holdings (liquidity prefilter + momentum), seed_sub + scores_out; flag-off identical"
```

---

## Task 5: `resolve_peers` folds sub-theme into the ranker; `top_n` surfaces `gate_score`

**Files:**
- Modify: `api/services/groups.py` (`resolve_peers` lines 380-394; `top_n` lines 239-258)
- Test: `tests/test_groups.py` (update two existing tests + append one)

**Interfaces:**
- Consumes: `rank_holdings(..., seed_sub=, scores_out=)` (Task 4).
- Produces: `resolve_peers` no longer post-sorts (sub-theme float now lives in `rank_holdings` via `seed_sub`); `top_n`'s `rows[]` entries gain a `gate_score` key (`None` when gates off).

- [ ] **Step 1: Update the two existing tests + add the peer × gate test**

In `tests/test_groups.py`, update `test_top_n_returns_rows_with_tier_and_rationale` — the mocked `rank_holdings` lambda must accept the new params, and `rows[0]` now carries `gate_score`:

```python
def test_top_n_returns_rows_with_tier_and_rationale(monkeypatch):
    monkeypatch.setattr(groups, "_theme_holdings",
                        lambda tid: [{"sym": "RKLB", "tier": "core", "rationale": "Launch"},
                                     {"sym": "ASTS", "tier": "core", "rationale": "Sats"}])
    import api.services.theme_db as tdb
    monkeypatch.setattr(tdb, "get_theme_holdings", groups._theme_holdings)
    monkeypatch.setattr(groups, "rank_holdings",
                        lambda h, by="today", seed=None, seed_sub=None, scores_out=None: ["RKLB", "ASTS"])
    out = groups.top_n("space", 2, by="today")
    assert out["syms"] == ["RKLB", "ASTS"]
    assert out["rows"][0] == {"sym": "RKLB", "tier": "core", "rationale": "Launch", "gate_score": None}
```

Append a peer × gate interaction test (`test_resolve_peers_sub_theme_first_then_widen` stays as-is — it runs gates-off by default and must remain green):

```python
def test_resolve_peers_liquidity_floor_beats_sub_theme_when_gated(monkeypatch):
    # Gated: a confirmed-liquid DIFFERENT-sub-theme peer outranks an illiquid
    # SAME-sub-theme peer (liquidity floor is the hard prefilter); within the
    # liquid tier, same-sub-theme still leads.
    seed_row = {"theme_id": "space", "theme_name": "Space", "tier": "core", "sub_theme_id": "launch"}
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: seed_row)
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"RKLB", "SAMEILLIQ", "DIFFLIQ", "SAMELIQ"})
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    monkeypatch.setattr(groups, "_rs_map", lambda: {})
    holdings = [
        {"sym": "RKLB", "tier": "core", "sub_theme_id": "launch"},          # seed (excluded)
        {"sym": "SAMEILLIQ", "tier": "core", "sub_theme_id": "launch"},     # same sub, illiquid
        {"sym": "DIFFLIQ", "tier": "core", "sub_theme_id": "satellites"},   # diff sub, liquid
        {"sym": "SAMELIQ", "tier": "core", "sub_theme_id": "launch"},       # same sub, liquid
    ]
    monkeypatch.setattr(groups, "_theme_holdings", lambda tid: holdings)
    _mock_gate_env(monkeypatch, True, {
        "SAMEILLIQ": {"price": 2.0, "dollar_vol": 1e6, "rs_rank": 90, "adr_pct": 9},   # band2
        "DIFFLIQ":   {"price": 40, "dollar_vol": 5e8, "rs_rank": 80, "adr_pct": 6},    # band0
        "SAMELIQ":   {"price": 30, "dollar_vol": 5e8, "rs_rank": 80, "adr_pct": 6},    # band0
    })
    peers = groups.resolve_peers("RKLB", 3)["peers"]
    assert peers[0] == "SAMELIQ"     # liquid + same sub-theme -> top
    assert peers[1] == "DIFFLIQ"     # liquid, different sub-theme
    assert peers[2] == "SAMEILLIQ"   # same sub-theme but illiquid -> backfill last
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_groups.py -q`
Expected: FAIL — `top_n` rows lack `gate_score`; `resolve_peers` still post-sorts by sub-theme alone (ignores the liquidity floor), so `SAMEILLIQ` floats to the top.

- [ ] **Step 3: Implement**

In `api/services/groups.py`, change `resolve_peers` — replace lines 382-387 (the `rank_holdings` call, the `sub_by_sym` map, and the `.sort()`) with a single gated call:

```python
    theme_id = row.get("theme_id")
    seed_sub = row.get("sub_theme_id")
    holdings = _theme_holdings(theme_id)
    # sub-theme float now lives in rank_holdings (seed_sub) so it composes with
    # the swing gate in one pass — liquidity floor first, then sub-theme, then momentum.
    ranked = rank_holdings(holdings, by="today", seed=seed_hy, seed_sub=seed_sub)
```

(The `return {...}` block below it is unchanged.)

Then update `top_n` (lines 240-249) to thread `scores_out` and add `gate_score` to each row:

```python
def top_n(theme_id: str, n: int, by: str = "today") -> dict:
    holdings = _theme_holdings(theme_id)
    scores = {}
    ranked = rank_holdings(holdings, by=by, scores_out=scores)
    top = ranked[: max(1, int(n))]
    # Per-sym tier + rationale + gate score for the cell badges / observability.
    meta = {normalize_sym(h.get("sym", "")): h for h in holdings}
    rows = [{
        "sym": s,
        "tier": (meta.get(s) or {}).get("tier"),
        "rationale": (meta.get(s) or {}).get("rationale") or "",
        "gate_score": scores.get(s),
    } for s in top]
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_groups.py -q`
Expected: PASS — including the unchanged `test_resolve_peers_sub_theme_first_then_widen` (gates-off float preserved) and the new gated peer test.

- [ ] **Step 5: Commit**

```bash
git add api/services/groups.py tests/test_groups.py
git commit -m "feat(groups): peer-fill folds sub-theme into the gated ranker; top_n surfaces gate_score"
```

---

## Final verification (after all tasks)

- `python -m pytest tests/test_groups_gates.py tests/test_snapshot_db_getrows.py tests/test_groups.py -q` — all green.
- Confirm default-OFF: with `GROUPS_SWING_GATES_ENABLED` unset, `rank_holdings` order and `resolve_peers` peers match pre-feature behavior (the unchanged existing tests prove this).
- Manual (optional, gates on): set `GROUPS_SWING_GATES_ENABLED=1` locally, hit `/api/groups/{id}/top` on a mixed theme and confirm liquid names lead + `rows[].gate_score` is populated.

## Self-review notes (traceability to spec)

- Spec §4 model → Tasks 1 (`gate_bands`) + 4 (sort key composition, both `top_n` and peer keys).
- §5 components → Task 1 (`groups_gates` core), 2 (`get_rows`), 3 (`swing_metrics` live-price/rs-source/staleness/cache), 4/5 (`rank_holdings`/`resolve_peers`/`top_n`).
- §7 edge cases → Task 1 tests (IPO/penny/missing/None), Task 3 tests (stale/missing/never-raise), Task 4 tests (liquidity-leads-and-fills, flag-off identical), Task 5 test (peer × gate).
- §8 flag/thresholds → Task 1 (`_env_float`, `gates_enabled`).
- §9 observability → Task 1 (`gate_score`, `pass_rates`) + Task 4 (per-gate pass-rate debug log) + Task 5 (`top_n` rows carry `gate_score`).
- §10 tests → covered across tasks; the flag-off byte-equality and peer-sub-theme×gate interaction are explicit.
- §11 non-goals honored: no JSON/frontend/ETF-pin/Undo/chartability change; no name-dropping; buyout-exclusion absent.
