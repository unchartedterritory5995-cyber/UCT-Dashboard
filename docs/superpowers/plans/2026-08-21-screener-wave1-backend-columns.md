# Screener Wave 1 — Backend Zero-Cost Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the screener snapshot from 65 to ~105 columns using only data the platform already stores (local bars, the RS cache, breadth/theme/index/ETF/IPO stores), expose every new and dark column through the filter registry and column defs, and ship it live behind the existing nightly build.

**Architecture:** Every new column gets exactly ONE writer, added inside the existing `snapshot_builder` pipeline: bar-derived fields extend `technicals.py`/`candles.py` plus a new `setup_score.py` (the scanner's 7-criteria candle score, promoted verbatim); classification fields come from a new `context_joins.py` (one read per build per source, never per-ticker network); `dollar_vol_30d` is a pure derivation in `build_row`. The registry (`filters.py`) gains three categories and the old FilterPanel renders them with zero frontend changes (tabs derive from `meta.categories` — verified `FilterPanel.jsx:11`). NO AST-scalar manifest changes in this wave (batched in Wave 6) — new columns are NOT formula scalars yet.

**Tech Stack:** Python/FastAPI, SQLite (screener.db), pytest; one JS file (`columnDefs.js`) + vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-screener-deep-work-design.md` (§2.1, §5.1, §5.4, §8, §10 Wave 1)

## Global Constraints

- One writer per column; `test_no_two_screener_sources_write_the_same_column` derives key sets by RUNNING sources — every new reader must be registered in that test's source enumeration (Task 10).
- Columns are added ONLY in `snapshot_db.COLUMNS` (`snapshot_db.py:12`); `_TEXT`/`_INT` updated per column; `populated` counts and sort-key validation extend automatically (both derive from `COLUMNS`).
- No new per-ticker network calls in the nightly loop. Every join source is one read per build.
- New numeric filters ship BARE (`_open_range`) unless the threshold has a published in-product source; scanner-gate thresholds (candle_score ≥70/≥55, vol_updown 1.1/0.85, close_cv 2.5/4.0, avg_body 0.30/0.40, vol_nweek_low 20/15/10) cite `scanner_candidates.py` in a comment (E-8 satisfied by the shipped scanner).
- `snapshot_date` honesty machinery (`describe_rows`) is untouched.
- Worktree: `C:\Users\Patrick\uct-worktrees\screener-deep-work`, branch `feat/screener-deep-work`. Never `git add -A`. Backend tests: `python -m pytest tests/<file> -v` from the worktree root. Frontend: `cd app && npx vitest run <file> --pool=threads`.
- Ship = fetch origin/master → merge → re-verify → `git push origin feat/screener-deep-work:master`. Never force. After every master merge: `grep -c broker_sync api/main.py` ≥ 7.

---

### Task 1: Schema — 38 new columns + column migration + manifest exclusion bookkeeping

**Files:**
- Modify: `api/services/screener/snapshot_db.py` (COLUMNS `:13-37`, `_TEXT`/`_INT` `:39-45`, `init_db` `:135-149`)
- Modify: `app/src/components/chart/engine/ast/closedTable.json` (`_scalars_excluded` list ONLY)
- Modify: `tests/test_ast_scalars.py:152-176` (the two pinned literals)
- Test: `tests/test_screener_wave1_schema.py` (new)

**Interfaces:**
- Produces: `snapshot_db.COLUMNS` extended with the 38 names below (later tasks write them); `init_db()` now ALTER-adds any missing column to an existing `screener_rows` table (prod DB predates these columns; `CREATE TABLE IF NOT EXISTS` alone would leave prod without them — verified no migration idiom exists in this package).
- Manifest bookkeeping: `tests/test_ast_scalars.py::test_the_scalar_section_PARTITIONS_snapshot_db_COLUMNS_exactly` pins `len(COLUMNS) == 65` and partition `(54, 11)`, and requires EVERY column to be a declared scalar in `closedTable.json` OR listed under its `_scalars_excluded` key. Wave 1 adds all 38 new names to `_scalars_excluded` (append to the existing JSON array, matching its formatting) and updates the pinned literals to `103` and `(54, 49)`. This is exclusion BOOKKEEPING, not a vocabulary change — no new scalar names, no corpus cases, no digest re-record (scalar promotion is Wave 6, spec §2.4). IPO date / age and country are NOT in this wave — they move to Wave 2's profile-bulk read (the verified `ticker_ipo` path is a per-ticker network call that never caches a miss: ~3,700 sequential HTTP calls on a cold build; recorded deviation from spec §2.1).

The 38 new columns, in COLUMNS order (insert each group where marked):

```python
    # after "dist_52w_high_pct", "dist_52w_low_pct", "above_50sma", "new_52w_high":
    # performance (Wave 1)
    "chg_pct_3m", "chg_pct_6m", "chg_pct_1y", "chg_pct_ytd",
    "chg_from_open_pct", "adr_pct_1w", "dist_20d_high_pct", "dist_20d_low_pct",
    "dist_ath_pct", "new_ath", "dollar_vol_30d",
    # momentum mechanics (Wave 1)
    "pole_pct", "vol_nweek_low", "vol_updown_ratio", "ema_touch_count",
    "ema10_rising", "ema20_rising", "ema_stack_intact", "candle_score",
    "atr_ext_sma50", "rs_line_trend",
    "prev_day_open", "prev_day_high", "prev_day_low", "prev_day_close",
    # after "nr7", "consecutive_up", "consecutive_down" (multi candle):
    "close_cv_pct", "avg_body_pct_5",
    # after "patterns", "pattern_conf_max" (context, Wave 1):
    "theme", "in_uct20", "index_sp500", "index_ndx", "index_dow", "index_r2k",
    "is_etf", "is_leveraged", "stage2", "stage4", "hvc_52w",
```

Set updates:

```python
_TEXT = {"ticker", "company", "sector", "industry", "exchange", "ma_stack",
         "candle_type", "patterns", "snapshot_date", "bars_asof",
         # Wave 1. `accdis` joins _TEXT here too: it has always held letter
         # grades in a REAL-declared column (latent since v1; SQLite dynamic
         # typing made it harmless). New DBs now declare it TEXT; existing DBs
         # keep the old declaration and keep working.
         "accdis", "rs_line_trend", "theme"}
_INT = {"uct_composite", "rs_rank", "inside_bar_run", "higher_lows_run",
        "consecutive_up", "consecutive_down", "built_at",
        # bools stored as 0/1
        "above_50sma", "new_52w_high", "wide_bar", "narrow_bar",
        "tight_consolidation", "nr7",
        # Wave 1 ints + bools
        "new_ath", "vol_nweek_low", "ema_touch_count", "candle_score",
        "ema10_rising", "ema20_rising", "ema_stack_intact", "in_uct20",
        "index_sp500", "index_ndx", "index_dow", "index_r2k",
        "is_etf", "is_leveraged", "stage2", "stage4", "hvc_52w"}
```

Migration, added to `init_db` after the `CREATE TABLE IF NOT EXISTS` and before the index loop (idiom mirrors `ai_search_log.py:123`):

```python
        # Columns added after a table already exists on disk (prod predates
        # Wave 1) — CREATE TABLE IF NOT EXISTS never widens, so diff the live
        # schema against COLUMNS and ALTER-add what is missing.
        have = {r[1] for r in conn.execute("PRAGMA table_info(screener_rows)")}
        for c in COLUMNS:
            if c not in have:
                conn.execute(f"ALTER TABLE screener_rows ADD COLUMN {_coldef(c)}")
```

- [ ] **Step 1: Write the failing tests**

```python
"""Wave 1 schema: new columns exist, and init_db widens a legacy table."""
import sqlite3


def _fresh(monkeypatch, tmp_path):
    db = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(db))
    return db


def test_wave1_columns_are_declared(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db
    for col in ("chg_pct_3m", "dollar_vol_30d", "pole_pct", "vol_nweek_low",
                "candle_score", "rs_line_trend", "prev_day_high", "close_cv_pct",
                "theme", "in_uct20", "is_leveraged", "stage2", "dist_ath_pct"):
        assert col in snapshot_db.COLUMNS


def test_init_db_widens_a_legacy_table(monkeypatch, tmp_path):
    db = _fresh(monkeypatch, tmp_path)
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE screener_rows (ticker TEXT PRIMARY KEY, price REAL)")
    conn.commit()
    conn.close()
    from api.services.screener import snapshot_db
    snapshot_db.init_db()
    with snapshot_db.connect() as c:
        have = {r[1] for r in c.execute("PRAGMA table_info(screener_rows)")}
    assert set(snapshot_db.COLUMNS) <= have
    # control: the widened table takes a row through the normal upsert
    snapshot_db.upsert_rows([{"ticker": "TEST", "candle_score": 75,
                              "rs_line_trend": "up"}])
    row = snapshot_db.get_row("TEST")
    assert row["candle_score"] == 75 and row["rs_line_trend"] == "up"


def test_every_column_has_exactly_one_type_class(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db
    overlap = snapshot_db._TEXT & snapshot_db._INT
    assert not overlap, f"columns in both _TEXT and _INT: {overlap}"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_screener_wave1_schema.py -v`
Expected: FAIL — `'chg_pct_3m' in snapshot_db.COLUMNS` assertion errors.

- [ ] **Step 3: Apply the COLUMNS/_TEXT/_INT edits and the init_db migration shown above**

- [ ] **Step 4: Manifest exclusion bookkeeping**

Open `app/src/components/chart/engine/ast/closedTable.json`, find the `_scalars_excluded` array (it currently holds 11 column names), and append all 38 new column names from Step 3, matching the file's existing formatting exactly. Then in `tests/test_ast_scalars.py::test_the_scalar_section_PARTITIONS_snapshot_db_COLUMNS_exactly` update the two pinned literals: `== 65` → `== 103` and `(54, 11)` → `(54, 49)`. Touch NOTHING else in either file — no scalar declarations, no `yields`, no version fields.

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/test_screener_wave1_schema.py tests/test_scalar_population_rail.py tests/test_ast_scalars.py -v`
Expected: all PASS — the partition test green at the new literals; the scalar-population rail still green (declared scalars unchanged).

- [ ] **Step 6: Commit**

```bash
git add api/services/screener/snapshot_db.py tests/test_screener_wave1_schema.py app/src/components/chart/engine/ast/closedTable.json tests/test_ast_scalars.py
git commit -m "screener: 38 Wave-1 columns + legacy-table migration + manifest exclusions"
```

---

### Task 2: technicals — performance + mechanics fields from the same 400 bars

**Files:**
- Modify: `api/services/screener/technicals.py`
- Test: `tests/test_screener_wave1_technicals.py` (new)

**Interfaces:**
- Consumes: existing `_pct`, `_sma`, `usable_bars`, `indicator_compute.compute_atr_raw`.
- Produces: `compute_technicals(bars)` now additionally returns `chg_pct_1y, chg_pct_ytd, chg_from_open_pct, adr_pct_1w, dist_20d_high_pct, dist_20d_low_pct, pole_pct, atr_ext_sma50, prev_day_open, prev_day_high, prev_day_low, prev_day_close` (all `None`-safe). Also module fns `_linear_slope(ys) -> float` and `rs_line_trend(closes, spy_closes) -> str|None` (Task 4 wires the SPY side).

Implementation — add the new keys to the `out` initializer tuple at `technicals.py:120-123`, then append after the 52-week block (`:197-202`):

```python
    # ── Wave 1: performance ──────────────────────────────────────────────
    if len(closes) >= 253:
        out["chg_pct_1y"] = _pct(price, closes[-253])
    out["chg_from_open_pct"] = _pct(price, bars[-1]["o"])
    # YTD = vs the last close of the PRIOR calendar year when the window holds
    # one; a name that listed this year has no YTD baseline and stays None.
    t_last = bars[-1].get("t")
    if t_last is not None and len(str(t_last)) >= 4:
        year = str(t_last)[:4]
        prior = [b for b in bars
                 if b.get("t") is not None and str(b["t"])[:4] < year]
        if prior:
            out["chg_pct_ytd"] = _pct(price, prior[-1]["c"])
    # 5-bar ADR — the range-based weekly volatility (same formula as adr_pct,
    # 5-session window). NOT a stdev; the parity matrix maps Finviz
    # "Volatility W" here and "Volatility M" to the existing adr_pct.
    w5 = [b for b in bars[-5:] if b["c"]]
    if w5:
        out["adr_pct_1w"] = round(
            sum((b["h"] - b["l"]) / b["c"] for b in w5) / len(w5) * 100, 2)
    w20 = bars[-20:]
    out["dist_20d_high_pct"] = _pct(price, max(b["h"] for b in w20))
    out["dist_20d_low_pct"] = _pct(price, min(b["l"] for b in w20))
    out["pole_pct"] = _pole_pct(closes)
    out["atr_ext_sma50"] = _atr_ext_sma50(bars, closes, s50)
    # prev-day OHLC — trigger levels; collapses Live Scan's SSE-fallback
    # second authority (spec §2.1)
    if len(bars) >= 2:
        p = bars[-2]
        out["prev_day_open"], out["prev_day_high"] = p["o"], p["h"]
        out["prev_day_low"], out["prev_day_close"] = p["l"], p["c"]
```

New module-level helpers (below `_pct`):

```python
def _pole_pct(closes):
    """Trough→peak % gain in the last 22 closes — the momentum 'pole'.

    Verbatim arithmetic port of uct-intelligence
    scripts/scanner_candidates.py::_compute_pole_pct (read 2026-08-21); the
    snapshot is now the single authority for this number (spec §8). One
    deliberate deviation: insufficient history is None (the snapshot's
    not-computable convention), while a peak with no prior trough is a true
    0.0 — the scanner returned 0.0 for both.
    """
    window = closes[-22:]
    if len(window) < 5:
        return None
    peak_val = max(window)
    peak_idx = window.index(peak_val)
    if peak_idx == 0:
        return 0.0
    trough = min(window[:peak_idx])
    if trough <= 0:
        return None
    return round((peak_val - trough) / trough * 100, 1)


def _atr_ext_sma50(bars, closes, s50):
    """Extension above the 50SMA in ATR units: (close − SMA50) / ATR(14).

    Same Wilder ATR chokepoint as `_atr_pct` — never a private copy.
    """
    from api.services import indicator_compute
    if s50 is None or len(bars) < 15:
        return None
    atr = indicator_compute.compute_atr_raw(bars, 14)[-1]
    if not atr:
        return None
    return round((closes[-1] - s50) / atr, 2)


def _linear_slope(ys):
    """Least-squares slope in units-per-bar. Verbatim port of
    scanner_candidates._linear_slope (single authority now here)."""
    n = len(ys)
    if n < 2:
        return 0.0
    x_mean = (n - 1) / 2.0
    y_mean = sum(ys) / n
    num = sum((i - x_mean) * (y - y_mean) for i, y in enumerate(ys))
    den = sum((i - x_mean) ** 2 for i in range(n))
    return num / den if den != 0 else 0.0


def rs_line_trend(closes, spy_closes):
    """'up' / 'flat' / 'down' — slope of the ticker/SPY ratio over 20 bars.

    Verbatim port of scanner_candidates._compute_rs_slope; the ONE behavioral
    RS definition (spec §8 names the three RS spellings; this is the only
    server-side authority for RS-line behavior). Deviation: insufficient data
    is None (not-computable), where the scanner said 'flat'.
    """
    if not closes or not spy_closes:
        return None
    n = min(len(closes), len(spy_closes), 20)
    if n < 5:
        return None
    tc, sc = closes[-n:], spy_closes[-n:]
    rs = [t / s for t, s in zip(tc, sc) if s > 0]
    if len(rs) < 5:
        return None
    slope = _linear_slope(rs)
    rs_mean = sum(rs) / len(rs)
    slope_pct = slope / rs_mean if rs_mean != 0 else 0.0
    if slope_pct > 0.0005:
        return "up"
    if slope_pct < -0.0005:
        return "down"
    return "flat"
```

Note: `s50` is already computed at `technicals.py:160` — thread it into the
`_atr_ext_sma50` call as shown (do not recompute).

- [ ] **Step 1: Write the failing tests**

```python
"""Wave 1 bar-derived fields — hand-computed expectations on synthetic bars."""
from api.services.screener import technicals


def bar(c, o=None, h=None, l=None, v=1000, t=None):
    o = c if o is None else o
    return {"o": o, "h": h if h is not None else max(o, c) + 0.5,
            "l": l if l is not None else min(o, c) - 0.5, "c": c, "v": v, "t": t}


def flat(n, price=100.0, start_t=20250102):
    # t values only need YYYY prefixes to be right for the YTD test
    return [bar(price, t=start_t + i) for i in range(n)]


def test_one_year_change_needs_253_closes():
    out = technicals.compute_technicals(flat(252))
    assert out["chg_pct_1y"] is None
    bars = flat(253)
    bars[0]["c"] = 80.0
    out = technicals.compute_technicals(bars)
    assert out["chg_pct_1y"] == 25.0  # 100 vs 80


def test_ytd_uses_last_close_of_prior_year():
    prior = [bar(90.0, t=20251230), bar(80.0, t=20251231)]
    this = [bar(100.0, t=20260102 + i) for i in range(30)]
    out = technicals.compute_technicals(prior + this)
    assert out["chg_pct_ytd"] == 25.0  # vs 80, the LAST prior-year close
    # a name listed this year has no baseline
    assert technicals.compute_technicals(this)["chg_pct_ytd"] is None


def test_change_from_open_and_prev_day_levels():
    bars = flat(30)
    bars[-2] = bar(102.0, o=101.0, h=103.0, l=100.5)
    bars[-1] = bar(105.0, o=100.0)
    out = technicals.compute_technicals(bars)
    assert out["chg_from_open_pct"] == 5.0
    assert out["prev_day_high"] == 103.0
    assert out["prev_day_low"] == 100.5
    assert out["prev_day_close"] == 102.0
    assert out["prev_day_open"] == 101.0


def test_adr_1w_and_20d_extremes():
    bars = flat(30)  # every bar h=c+0.5, l=c-0.5 → range 1.0 on close 100
    out = technicals.compute_technicals(bars)
    assert out["adr_pct_1w"] == 1.0
    assert out["dist_20d_high_pct"] == -0.5  # 100 vs high 100.5
    assert out["dist_20d_low_pct"] == 0.5


def test_pole_pct_trough_to_peak():
    closes = [100.0] * 10 + [80.0] + [120.0] + [110.0] * 10  # trough 80 → peak 120
    assert technicals._pole_pct(closes) == 50.0
    assert technicals._pole_pct([100.0] * 4) is None  # <5 → not computable
    assert technicals._pole_pct([120.0] + [100.0] * 10) == 0.0  # peak first → no pole


def test_rs_line_trend_port():
    spy = [100.0] * 20
    rising = [100.0 + i for i in range(20)]
    assert technicals.rs_line_trend(rising, spy) == "up"
    assert technicals.rs_line_trend(list(reversed(rising)), spy) == "down"
    assert technicals.rs_line_trend([100.0] * 20, spy) == "flat"
    assert technicals.rs_line_trend([100.0] * 4, spy) is None


def test_atr_ext_sma50_flat_tape_is_zero_extension():
    bars = flat(60)
    out = technicals.compute_technicals(bars)
    # price == SMA50 == 100, ATR == 1.0 → extension 0.0
    assert out["atr_ext_sma50"] == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_screener_wave1_technicals.py -v`
Expected: FAIL — KeyError/AttributeError (`chg_pct_1y` not in out; `_pole_pct` undefined).

- [ ] **Step 3: Implement as shown above** (add new keys to the `out` initializer; append the block; add the four helpers)

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_screener_wave1_technicals.py tests/ -k "technicals or screener" -v`
Expected: PASS, existing screener tests untouched.

- [ ] **Step 5: Commit**

```bash
git add api/services/screener/technicals.py tests/test_screener_wave1_technicals.py
git commit -m "screener: performance + momentum-mechanics fields from local bars"
```

---

### Task 3: All-time-high fields + deep-history bar read (with measurement gate)

**Files:**
- Modify: `api/services/screener/technicals.py` (add `ath_fields`), `api/services/screener/snapshot_builder.py` (`_read_daily_bars` `:116-126`, `build_row` `:66-111`)
- Create: `tools/screener_wave1_timing.py`
- Test: `tests/test_screener_wave1_ath.py` (new)

**Interfaces:**
- Produces: `technicals.ath_fields(all_bars) -> {"dist_ath_pct": float|None, "new_ath": bool}`; `_read_daily_bars(ticker)` now fetches `DEEP_BARS = 5000` daily bars; `build_row` slices `bars[-400:]` for every existing consumer (so every existing column's values are byte-identical to today) and hands the FULL series only to `ath_fields`.

`technicals.py`:

```python
def ath_fields(all_bars: list[dict]) -> dict:
    """Distance to the all-time high of the STORED history (bars.db holds
    since-inception dailies for the cap universe; a recent IPO's 'all-time'
    is its whole life — that is the honest reading, same as any provider)."""
    out = {"dist_ath_pct": None, "new_ath": False}
    bars = usable_bars(all_bars)
    if not bars:
        return out
    hi = max(b["h"] for b in bars)
    out["dist_ath_pct"] = _pct(bars[-1]["c"], hi)
    out["new_ath"] = bars[-1]["h"] >= hi
    return out
```

`snapshot_builder.py` — constant + reader:

```python
# One deep read per ticker: the tail 400 feed every existing consumer
# unchanged; only ath_fields sees the full depth. 5000 matches the bars
# API ceiling.
DEEP_BARS = 5000


def _read_daily_bars(ticker):
    from api.services import bars_sqlite
    rows = bars_sqlite.get_bars(ticker, "D", DEEP_BARS) or []
    ...  # unchanged tuple→dict body
```

`build_row` — replace the bars block:

```python
    bars_full = technicals.usable_bars(bars)
    bars = bars_full[-400:]
    if bars:
        row.update(technicals.compute_technicals(bars))
        row.update(technicals.ath_fields(bars_full))
        ...  # rest unchanged
```

`tools/screener_wave1_timing.py` — the §5.4 gate:

```python
"""Measure the deep-read cost before shipping Wave 1 (spec §5.4).

Times get_bars at 400 vs 5000 bars over a 200-ticker sample and projects the
delta across the universe. Run on the pod (railway ssh, /opt/venv/bin/python)
for the real number — network-attached /data is the slow case that matters.
"""
import json
import random
import sys
import time

sys.path.insert(0, ".")
from api.services import bars_sqlite  # noqa: E402

universe = [t for t in json.load(open("api/data/cap_universe.json"))
            if isinstance(t, str)]
sample = random.Random(20260821).sample(universe, 200)

for depth in (400, 5000):
    t0 = time.perf_counter()
    n = sum(1 for t in sample if bars_sqlite.get_bars(t, "D", depth))
    dt = time.perf_counter() - t0
    print(f"depth={depth}: {dt:.2f}s for {n}/200 tickers "
          f"-> universe projection {dt / 200 * len(universe):.0f}s")
```

- [ ] **Step 1: Write the failing test**

```python
from api.services.screener import technicals


def bar(c, h=None, l=None):
    return {"o": c, "h": h if h is not None else c + 0.5,
            "l": l if l is not None else c - 0.5, "c": c, "v": 1000}


def test_ath_distance_reads_full_history_not_the_400_tail():
    old_peak = [bar(200.0, h=210.0)]                    # ancient ATH
    recent = [bar(100.0) for _ in range(500)]
    out = technicals.ath_fields(old_peak + recent)
    assert out["dist_ath_pct"] == round((100.0 - 210.0) / 210.0 * 100, 2)
    assert out["new_ath"] is False


def test_new_ath_flag():
    bars = [bar(100.0) for _ in range(50)] + [bar(120.0, h=125.0)]
    out = technicals.ath_fields(bars)
    assert out["new_ath"] is True
    assert out["dist_ath_pct"] == round((120.0 - 125.0) / 125.0 * 100, 2)


def test_build_row_existing_columns_identical_under_deep_read():
    """The 400-slice keeps every pre-Wave-1 value byte-identical."""
    from api.services.screener import snapshot_builder
    deep = [bar(50.0) for _ in range(600)] + [bar(100.0) for _ in range(400)]
    row_deep = snapshot_builder.build_row("T", deep, None, None)
    row_400 = snapshot_builder.build_row("T", deep[-400:], None, None)
    for col in ("rsi14", "adr_pct", "atr_pct", "pct_vs_sma200",
                "dist_52w_high_pct", "chg_pct_1m"):
        assert row_deep[col] == row_400[col], col
    assert row_deep["dist_ath_pct"] != row_400["dist_ath_pct"]  # only ATH differs
```

- [ ] **Step 2: Run to verify failure** — `python -m pytest tests/test_screener_wave1_ath.py -v` → FAIL (`ath_fields` undefined).

- [ ] **Step 3: Implement** as shown (helper, DEEP_BARS, build_row slice).

- [ ] **Step 4: Run tests** — same command, expect PASS; plus `python -m pytest tests/ -k snapshot_builder -v`.

- [ ] **Step 5: Run the timing gate locally, record the numbers in the commit message**

Run: `python tools/screener_wave1_timing.py`
Expected: prints both projections. GATE: if the 5000-depth universe projection exceeds the 400-depth one by more than ~10 minutes, STOP — flag it in the task report; the fallback (spec §5.4) is a weekly ATH refresh instead of nightly, decided by the owner. (Re-run on the pod after ship; dev-box numbers are the optimistic case.)

- [ ] **Step 6: Commit**

```bash
git add api/services/screener/technicals.py api/services/screener/snapshot_builder.py tools/screener_wave1_timing.py tests/test_screener_wave1_ath.py
git commit -m "screener: all-time-high fields via one deep bar read (existing columns byte-identical)"
```

---

### Task 4: SPY-relative RS line trend in the builder

**Files:**
- Modify: `api/services/screener/snapshot_builder.py` (`build_row` signature, `run_build` `:290-376`)
- Test: `tests/test_screener_wave1_rs_line.py` (new)

**Interfaces:**
- Consumes: `technicals.rs_line_trend(closes, spy_closes)` from Task 2.
- Produces: `build_row(ticker, bars, ratings_row, fundamentals, rs_row=None, bulk_row=None, spy_closes=None)` — new optional kwarg; when given, writes `rs_line_trend`. `run_build` reads SPY once per build: `_read_spy_closes() -> list[float]`.

`snapshot_builder.py`:

```python
def _read_spy_closes():
    """The benchmark series for rs_line_trend — ONE read per build."""
    from api.services import bars_sqlite
    rows = bars_sqlite.get_bars("SPY", "D", 60) or []
    return [r[4] for r in rows if r[4] is not None]
```

In `build_row`, after the bars block (inside `if bars:`):

```python
        if spy_closes:
            closes = [b["c"] for b in bars]
            row["rs_line_trend"] = technicals.rs_line_trend(closes, spy_closes)
```

In `run_build`, beside `rs_map = _read_rs_map()`:

```python
    spy_closes = _read_spy_closes()
    if not spy_closes:
        sources.setdefault("spy_bars", {})["none"] = 1
```

…and thread `spy_closes=spy_closes` into the `build_row(...)` call at `:346`.

Alignment note (goes in the `_read_spy_closes` docstring): the trend zips the
positional tails of both series, exactly as the scanner did — a ticker with
recent halts pairs slightly offset sessions. Accepted deviation carried over
from the ported definition; date-alignment would be a definition CHANGE and
belongs to the owner.

- [ ] **Step 1: Write the failing test**

```python
from api.services.screener import snapshot_builder


def bar(c):
    return {"o": c, "h": c + 0.5, "l": c - 0.5, "c": c, "v": 1000}


def test_build_row_writes_rs_line_trend_when_spy_given():
    rising = [bar(100.0 + i) for i in range(30)]
    spy = [100.0] * 30
    row = snapshot_builder.build_row("T", rising, None, None, spy_closes=spy)
    assert row["rs_line_trend"] == "up"
    row = snapshot_builder.build_row("T", rising, None, None)
    assert row["rs_line_trend"] is None
```

- [ ] **Step 2: Run to verify failure** — `python -m pytest tests/test_screener_wave1_rs_line.py -v` → FAIL (unexpected kwarg).
- [ ] **Step 3: Implement as shown.**
- [ ] **Step 4: Run tests** — PASS, plus `python -m pytest tests/ -k "snapshot_builder or scalar_population" -v`.
- [ ] **Step 5: Commit**

```bash
git add api/services/screener/snapshot_builder.py tests/test_screener_wave1_rs_line.py
git commit -m "screener: rs_line_trend vs SPY, one benchmark read per build"
```

---

### Task 5: candles — numeric tightness (CV + 5-bar body), bool derived

**Files:**
- Modify: `api/services/screener/candles.py` (`multi_candle` `:68-122`)
- Test: `tests/test_screener_wave1_candles.py` (new)

**Interfaces:**
- Produces: `multi_candle(bars)` additionally returns `close_cv_pct` (REAL, percent, e.g. 1.8 == 1.8%) and `avg_body_pct_5` (REAL fraction, e.g. 0.28); `tight_consolidation` becomes a derivation of `close_cv_pct` (`< 2.5`) — same threshold, same result, one computation. The scanner's numeric (`close_cv_pct`, `avg_body_pct` — spec §8 promotion) now has the snapshot as single authority.

Replace the tight-consolidation block (`candles.py:87-94`) and extend the initializer:

```python
    out = {"inside_bar_run": 0, "tight_consolidation": False,
           "pullback_depth_pct": None, "higher_lows_run": 0, "nr7": False,
           "consecutive_up": 0, "consecutive_down": 0,
           "close_cv_pct": None, "avg_body_pct_5": None}
    ...
    # tightness: CV of last 10 closes, kept as the NUMBER (the scanner's
    # close_cv_pct); the bool is derived from it at the same 2.5% line so the
    # two can never disagree (previously the bool destroyed the number).
    if n >= 10:
        closes = [b["c"] for b in bars[-10:]]
        mean = sum(closes) / len(closes)
        if mean:
            var = sum((x - mean) ** 2 for x in closes) / len(closes)
            cv_pct = (var ** 0.5) / mean * 100
            out["close_cv_pct"] = round(cv_pct, 2)
            out["tight_consolidation"] = cv_pct < 2.5
    # 5-bar average body fraction (scanner's avg_body_pct, promoted)
    bodies = []
    for b in bars[-5:]:
        rng = b["h"] - b["l"]
        if rng > 0:
            bodies.append(abs(b["c"] - b["o"]) / rng)
    if bodies:
        out["avg_body_pct_5"] = round(sum(bodies) / len(bodies), 3)
```

- [ ] **Step 1: Write the failing tests**

```python
from api.services.screener import candles


def bar(o, h, l, c):
    return {"o": o, "h": h, "l": l, "c": c, "v": 1000}


def test_close_cv_numeric_and_bool_agree():
    tight = [bar(100, 101, 99, 100.0 + (i % 2) * 0.5) for i in range(12)]
    out = candles.multi_candle(tight)
    assert out["close_cv_pct"] is not None
    assert out["tight_consolidation"] == (out["close_cv_pct"] < 2.5)
    loose = [bar(100, 130, 90, 100.0 + i * 3) for i in range(12)]
    out = candles.multi_candle(loose)
    assert out["tight_consolidation"] is False
    assert out["close_cv_pct"] > 2.5


def test_avg_body_pct_5():
    # body 0.2 of a 1.0 range on every bar
    bars = [bar(100.0, 100.6, 99.6, 100.2) for _ in range(10)]
    out = candles.multi_candle(bars)
    assert out["avg_body_pct_5"] == 0.2


def test_short_history_stays_none():
    out = candles.multi_candle([bar(100, 101, 99, 100) for _ in range(3)])
    assert out["close_cv_pct"] is None
```

- [ ] **Step 2: Run to verify failure** — `python -m pytest tests/test_screener_wave1_candles.py -v` → FAIL (KeyError `close_cv_pct`).
- [ ] **Step 3: Implement as shown.**
- [ ] **Step 4: Run** — PASS + `python -m pytest tests/ -k candle -v` (existing candle tests still green — `tight_consolidation` semantics unchanged).
- [ ] **Step 5: Commit**

```bash
git add api/services/screener/candles.py tests/test_screener_wave1_candles.py
git commit -m "screener: numeric tightness (close CV, 5-bar body); bool now derived"
```

---

### Task 6: setup_score.py — the scanner's 7-criteria candle score, promoted

**Files:**
- Create: `api/services/screener/setup_score.py`
- Test: `tests/test_screener_wave1_setup_score.py` (new)

**Interfaces:**
- Consumes: `technicals._linear_slope` (Task 2).
- Produces: `setup_score.compute(bars, pole_pct=None) -> dict` with keys `candle_score` (int 0–110|None), `ema_touch_count` (int|None), `ema10_rising` (bool|None), `ema20_rising` (bool|None), `ema_stack_intact` (bool|None), `vol_nweek_low` (20|15|10|None), `vol_updown_ratio` (float|None). Key set is DISJOINT from technicals/candles (`avg_body_pct_5` and `close_cv_pct` are recomputed internally for scoring but NEVER emitted — candles owns them; `pct_vs_ema20` likewise stays technicals').

```python
"""The scanner's 7-criteria pullback score, promoted to the snapshot.

Verbatim arithmetic port of uct-intelligence
scripts/scanner_candidates.py::_score_candle_from_df (read 2026-08-21).
The snapshot is now the single authority for candle_score and the EMA/volume
mechanics beside it; the scanner keeps its own copy until pointed here
(named in spec §8's duplication ledger — never silently diverge, change the
scanner side deliberately or not at all).

Deliberate deviations, all shape-level (the POINTS ARITHMETIC is untouched):
  - bars are the screener's {o,h,l,c,v} dicts, already usable_bars-sanitized
  - insufficient data / zero-range last candle → all-None (the snapshot's
    not-computable convention), not a notes string
  - candle_notes is not emitted (a UI string, not a screenable fact)
  - vol_updown_ratio: the COLUMN is None when the 10-bar window has no up
    days or no down days (undefined ratio); the SCORE still uses the
    scanner's 1.0 sentinel internally so the points are identical
  - volume_ratio is recomputed nowhere here — the snapshot's vol_ratio
    (30-day) is the platform's one volume-ratio column (spec §8 item 4)

Threshold provenance (E-8): every scored threshold below is shipped, live,
in scanner_candidates.py — a published in-product source.
"""
from api.services.screener.technicals import _linear_slope

_NULL = {"candle_score": None, "ema_touch_count": None, "ema10_rising": None,
         "ema20_rising": None, "ema_stack_intact": None,
         "vol_nweek_low": None, "vol_updown_ratio": None}


def compute(bars, pole_pct=None):
    if not bars or len(bars) < 21:
        return dict(_NULL)
    closes = [b["c"] for b in bars]
    lows = [b["l"] for b in bars]
    vols = [b.get("v") or 0 for b in bars]

    # EMA20 full series (SMA-seeded, k=2/21 — scanner lines 622-630)
    k20 = 2.0 / 21
    ema = sum(closes[:20]) / 20
    ema20_series = [ema]
    for c in closes[20:]:
        ema = c * k20 + ema * (1 - k20)
        ema20_series.append(ema)
    ema20 = ema20_series[-1]
    if not ema20 or ema20 <= 0:
        return dict(_NULL)

    # EMA10 series (scanner lines 634-643)
    k10 = 2.0 / 11
    ema10_series = []
    if len(closes) >= 10:
        e10 = sum(closes[:10]) / 10
        ema10_series = [e10]
        for c in closes[10:]:
            e10 = c * k10 + e10 * (1 - k10)
            ema10_series.append(e10)
    ema10 = ema10_series[-1] if ema10_series else None

    ema20_rising = _linear_slope(ema20_series[-10:]) > 0
    ema10_rising = (_linear_slope(ema10_series[-5:]) > 0) \
        if len(ema10_series) >= 5 else None
    ema_stack_intact = bool(
        ema10 is not None and closes[-1] > ema10 and ema10 > ema20
        and ema20_rising and (ema10_rising is None or ema10_rising))

    ema_touch_count = 0
    check_len = min(15, len(lows))
    for i in range(-check_len, 0):
        idx = len(ema20_series) + i
        if 0 <= idx < len(ema20_series) and lows[i] <= ema20_series[idx] * 1.005:
            ema_touch_count += 1

    last = bars[-1]
    o, h, l, c = last["o"], last["h"], last["l"], last["c"]
    v = last.get("v") or 0.0
    rng = h - l
    if rng <= 0:
        return dict(_NULL)
    close_position = (c - l) / rng
    ema_distance_pct = (c - ema20) / ema20 * 100

    vol_nweek_low = None
    if len(vols) >= 10 and v > 0:
        if len(vols) >= 20 and v <= min(vols[-20:]):
            vol_nweek_low = 20
        elif len(vols) >= 15 and v <= min(vols[-15:]):
            vol_nweek_low = 15
        elif v <= min(vols[-10:]):
            vol_nweek_low = 10

    up_vols, down_vols = [], []
    c_list = closes[-11:]
    v_list = vols[-10:]
    for i in range(len(v_list)):
        if len(c_list) >= i + 2:
            (up_vols if c_list[i + 1] > c_list[i] else down_vols).append(v_list[i])
    ratio_defined = bool(up_vols and down_vols)
    vol_acc = ((sum(up_vols) / len(up_vols)) / (sum(down_vols) / len(down_vols))
               if ratio_defined else 1.0)

    # 5-bar avg body + 10-close CV, recomputed for SCORING only (candles owns
    # the columns) — scanner lines 740-779
    bodies = []
    for b in bars[-5:]:
        r = b["h"] - b["l"]
        if r > 0:
            bodies.append(abs(b["c"] - b["o"]) / r)
    avg_body = sum(bodies) / len(bodies) if bodies else abs(c - o) / rng
    close_cv = 10.0
    recent_c = closes[-10:] if len(closes) >= 10 else closes
    if len(recent_c) >= 3:
        m = sum(recent_c) / len(recent_c)
        if m > 0:
            close_cv = (sum((x - m) ** 2 for x in recent_c)
                        / len(recent_c)) ** 0.5 / m * 100

    pole = pole_pct or 0.0
    score = 0
    if l <= ema20 * 1.005:
        score += 25
    elif ema_distance_pct <= 2.0:
        score += 18
    elif ema_distance_pct <= 4.0:
        score += 10
    elif ema_distance_pct <= 6.0:
        score += 5
    if vol_nweek_low == 20:
        score += 20
    elif vol_nweek_low == 15:
        score += 13
    elif vol_nweek_low == 10:
        score += 8
    if avg_body < 0.30:
        score += 15
    elif avg_body < 0.40:
        score += 8
    if close_position > 0.60:
        score += 15
    elif close_position > 0.50:
        score += 8
    if close_cv < 2.5:
        score += 10
    elif close_cv < 4.0:
        score += 5
    if pole >= 40.0:
        score += 15
    elif pole >= 20.0:
        score += 10
    elif pole >= 10.0:
        score += 5
    if vol_acc > 1.1:
        score += 10
    elif vol_acc > 0.9:
        score += 5

    return {"candle_score": score, "ema_touch_count": ema_touch_count,
            "ema10_rising": ema10_rising, "ema20_rising": ema20_rising,
            "ema_stack_intact": ema_stack_intact,
            "vol_nweek_low": vol_nweek_low,
            "vol_updown_ratio": round(vol_acc, 2) if ratio_defined else None}
```

- [ ] **Step 1: Write the failing tests**

```python
"""Deterministic score fixture, hand-walked against the scanner rubric."""
from api.services.screener import setup_score


def bar(c, o=None, h=None, l=None, v=1000):
    o = c if o is None else o
    return {"o": o, "h": h if h is not None else max(o, c) + 0.5,
            "l": l if l is not None else min(o, c) - 0.5, "c": c, "v": v}


def test_flat_tape_score_hand_computed():
    """25 flat bars @100, equal volume, o==c, h/l ±0.5.
    EMA kiss (low 99.5 <= 100*1.005)      +25
    vol at 20-bar min (all equal)          +20
    avg body 0.0 < 0.30                    +15
    close_position 0.5 -> no points          0
    close CV 0 < 2.5                       +10
    pole 0                                   0
    vol_updown: no up days -> sentinel 1.0  +5
    total                                    75
    """
    bars = [bar(100.0) for _ in range(25)]
    out = setup_score.compute(bars, pole_pct=0.0)
    assert out["candle_score"] == 75
    assert out["vol_nweek_low"] == 20
    assert out["ema_touch_count"] == 15
    assert out["ema20_rising"] is False        # zero slope is not rising
    assert out["ema_stack_intact"] is False    # close == ema10, not above
    assert out["vol_updown_ratio"] is None     # no up days -> undefined COLUMN


def test_pole_points_ride_on_top():
    bars = [bar(100.0) for _ in range(25)]
    base = setup_score.compute(bars, pole_pct=0.0)["candle_score"]
    assert setup_score.compute(bars, pole_pct=45.0)["candle_score"] == base + 15
    assert setup_score.compute(bars, pole_pct=25.0)["candle_score"] == base + 10
    assert setup_score.compute(bars, pole_pct=12.0)["candle_score"] == base + 5


def test_insufficient_or_zero_range_is_all_none():
    assert setup_score.compute([bar(100.0)] * 20)["candle_score"] is None
    bars = [bar(100.0) for _ in range(24)] + [
        {"o": 100.0, "h": 100.0, "l": 100.0, "c": 100.0, "v": 1000}]
    assert setup_score.compute(bars)["candle_score"] is None


def test_emits_only_its_own_columns():
    out = setup_score.compute([bar(100.0) for _ in range(25)])
    assert "avg_body_pct_5" not in out and "close_cv_pct" not in out
    assert "pct_vs_ema20" not in out and "vol_ratio" not in out
```

- [ ] **Step 2: Run to verify failure** — `python -m pytest tests/test_screener_wave1_setup_score.py -v` → FAIL (module missing).
- [ ] **Step 3: Create the module as shown.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit**

```bash
git add api/services/screener/setup_score.py tests/test_screener_wave1_setup_score.py
git commit -m "screener: promote the scanner's 7-criteria candle score (verbatim points arithmetic)"
```

---

### Task 7: dollar_vol_30d derivation + chg_pct_3m/6m from the RS cache read

**Files:**
- Modify: `api/services/screener/snapshot_builder.py` (`rs_fields` `:41-63`, `build_row` `:66-111`)
- Test: extend `tests/test_screener_wave1_schema.py` (or a new `tests/test_screener_wave1_builder_fields.py`)

**Interfaces:**
- Consumes: `rs_ranking.cached_rank_map()` entries (already read once per build). The entry's period-returns dict is read for the 3m/6m values — SEE VERIFICATION NOTE below; key names must be read off `rs_ranking.py`'s entry-construction code at implementation time, not assumed.
- Produces: `rs_fields(rs_row)` additionally emits `chg_pct_3m` / `chg_pct_6m` (percent numbers, same unit as `chg_pct_1m`); `build_row` derives `dollar_vol_30d = price × avg_volume_30d` after the merge + bars block (single writer: the derivation itself).

`rs_fields` extension (after the `rs_return` block):

```python
    # Period returns ride in the SAME entry the rank came from — zero extra
    # cost, and the 3m/6m the member sees are the exact inputs their RS rank
    # was computed from (consistency by construction, like rs_return above).
    returns = rs_row.get("returns") or {}
    r3 = returns.get("3m")
    if r3 is not None:
        out["chg_pct_3m"] = round(float(r3), 2)
    r6 = returns.get("6m")
    if r6 is not None:
        out["chg_pct_6m"] = round(float(r6), 2)
```

⚠️ VERIFICATION NOTE (implementer): open `api/services/rs_ranking.py` and read the code that builds each rank-map entry. Confirm (a) the returns dict key is `returns`, (b) the period keys are `"3m"`/`"6m"`, and (c) the values are PERCENT numbers, not fractions — if they are fractions, multiply by 100 here and say so in the commit. Derive, never assume: this is exactly the two-authorities defect class.

`build_row`, after the bars block, before the meta stamps:

```python
    # Pure derivation — its factors are already columns; this is the ONE
    # writer for dollar_vol_30d (spec: this number exists nowhere else in the
    # platform).
    if row.get("price") is not None and row.get("avg_volume_30d") is not None:
        row["dollar_vol_30d"] = row["price"] * row["avg_volume_30d"]
```

- [ ] **Step 1: Write the failing tests**

```python
def test_rs_fields_carries_period_returns():
    from api.services.screener.snapshot_builder import rs_fields
    out = rs_fields({"rs_rank": 91, "rs_score": 44.2,
                     "returns": {"1w": 2.0, "1m": 8.0, "3m": 30.5, "6m": 55.1}})
    assert out["chg_pct_3m"] == 30.5
    assert out["chg_pct_6m"] == 55.1
    assert rs_fields({"rs_rank": 50}) .get("chg_pct_3m") is None


def test_dollar_vol_derivation():
    from api.services.screener import snapshot_builder
    bars = [{"o": 100, "h": 101, "l": 99, "c": 100, "v": 2_000_000}] * 40
    row = snapshot_builder.build_row("T", bars, None, None)
    assert row["dollar_vol_30d"] == row["price"] * row["avg_volume_30d"]
    row = snapshot_builder.build_row("T", [], None, None)
    assert row["dollar_vol_30d"] is None
```

- [ ] **Step 2: Run to verify failure**, **Step 3: implement**, **Step 4: run to green** (`python -m pytest tests/test_screener_wave1_builder_fields.py tests/ -k "rs_fields or scalar_population" -v`).
- [ ] **Step 5: Commit**

```bash
git add api/services/screener/snapshot_builder.py tests/test_screener_wave1_builder_fields.py
git commit -m "screener: dollar_vol_30d derivation + 3m/6m returns off the existing RS read"
```

---

### Task 8: context_joins.py — classification flags from stores already on the pod

**Files:**
- Create: `api/services/screener/context_joins.py`
- Modify: `api/services/screener/snapshot_builder.py` (`_read_fundamentals` `:129-177` — theme capture only)
- Test: `tests/test_screener_wave1_context_joins.py` (new)

**Interfaces:**
- Produces: four reader functions, each ONE read per build, each returning `{TICKER: {column: bool}}` for EVERY target when its source is healthy (absence from a healthy source is a real `False`) and `{}` when the source is dead/empty (columns stay None = not-computable — never a universe of confident zeros):
  - `read_breadth_flags(targets, failures=None)` → `stage2`, `stage4`, `hvc_52w`
  - `read_uct20(targets, failures=None)` → `in_uct20`
  - `read_index_flags(targets, failures=None)` → `index_sp500`, `index_ndx`, `index_dow`, `index_r2k`
  - `read_etf_flags(targets, failures=None)` → `is_etf`, `is_leveraged` (independently healthy — one dead sub-source drops only its own column)
- Also: `_read_fundamentals` gains `theme` (the meta dict it ALREADY fetches carries it; `get_ticker_meta`'s theme half runs on every call today, so this is zero additional cost).
- ⚠️ Scalar-population-rail shape: every reader emits **dict literals keyed by snapshot column names** (the rail derives writers by AST over `d["col"] = v` and `{"col": v}` shapes — a dynamically-built mapping is an invisible collector).

```python
"""Context joins — classification columns from stores the pod already holds.

ONE read per build per source, NEVER a per-ticker network call. Each reader's
key set is disjoint from every other snapshot source and is registered in
tests/test_screener_fundamentals_bulk.py::_source_key_sets (the rail RUNS
sources and diffs their key sets — Task 9 registers these).

The honesty rule every reader shares: a DEAD OR EMPTY source returns {}, so
its columns stay None (not-computable) on every row; a HEALTHY source answers
for the whole target list, so a ticker absent from its lists is a real False.
Collapsing those two states is how a snapshot lies (the 2026-08-09
all-NULL-market_cap lesson, in bool form).
"""


def _note(failures, source, outcome):
    if failures is None:
        return
    key = outcome if isinstance(outcome, str) else type(outcome).__name__
    failures.setdefault(source, {})
    failures[source][key] = failures[source].get(key, 0) + 1


def read_breadth_flags(targets, failures=None):
    """Weinstein stage + HVC flags off the LATEST breadth snapshot.

    Derived from the breadth store, never recomputed from bars.db — the
    collector's price basis is dividend-adjusted (spec §2.1). At 03:00 ET the
    latest snapshot is the prior session's 4:15 PM ET write: the right basis
    for a nightly artifact. get_universe_stocks() re-decodes the whole day
    blob per call — call it exactly once.
    """
    try:
        from api.services import breadth_monitor
        data = breadth_monitor.get_universe_stocks() or {}
    except Exception as e:
        _note(failures, "breadth_flags", e)
        return {}
    stocks = data.get("stocks") or []
    if not stocks:
        _note(failures, "breadth_flags", "empty")
        return {}
    listed = {}
    for s in stocks:
        t = (s.get("ticker") or "").upper()
        if t:
            tags = set(s.get("tags") or ())
            listed[t] = {"stage2": "s2" in tags, "stage4": "s4" in tags,
                         "hvc_52w": "hvc" in tags}
    absent = {"stage2": False, "stage4": False, "hvc_52w": False}
    return {t.upper(): listed.get(t.upper(), dict(absent)) for t in targets}


def read_uct20(targets, failures=None):
    """Leadership-20 membership. Rank is the LIST INDEX (no rank field —
    LeadershipTile renders #{i+1}); the ticker key is polymorphic across
    pushes, so coalesce ticker/sym/symbol like every other consumer."""
    try:
        from api.services import engine
        lead = engine.get_leadership() or []
    except Exception as e:
        _note(failures, "uct20", e)
        return {}
    syms = set()
    for it in lead:
        if isinstance(it, dict):
            s = (it.get("ticker") or it.get("sym") or it.get("symbol") or "")
            if s:
                syms.add(str(s).upper())
    if not syms:
        # an unpushed wire and a genuinely empty list are indistinguishable
        # here — both mean "cannot answer", never "nobody is in the 20"
        _note(failures, "uct20", "empty")
        return {}
    return {t.upper(): {"in_uct20": t.upper() in syms} for t in targets}


def read_index_flags(targets, failures=None):
    """S&P 500 / Nasdaq 100 / Dow / Russell 2000 membership from the prebuilt
    lists (committed baseline + the refresh overlay + delisted subtraction) —
    watchlist_prebuilt._load_lists() is the one-call bulk read; a failed FMP
    refresh keeps the prior overlay, so this never goes empty on a bad night.
    """
    name_to_col = {"s&p 500": "index_sp500", "nasdaq 100": "index_ndx",
                   "dow 30": "index_dow", "russell 2000": "index_r2k"}
    try:
        from api.services import watchlist_prebuilt
        lists = watchlist_prebuilt._load_lists() or []
    except Exception as e:
        _note(failures, "index_lists", e)
        return {}
    members = {}
    for row in lists:
        col = name_to_col.get(str(row.get("name", "")).lower())
        if col:
            members[col] = {str(t).upper() for t in (row.get("tickers") or ())}
    if len(members) < len(name_to_col):
        _note(failures, "index_lists",
              f"missing:{len(name_to_col) - len(members)}")
    if not members:
        return {}
    return {t.upper(): {col: t.upper() in tks for col, tks in members.items()}
            for t in targets}


def read_etf_flags(targets, failures=None):
    """is_etf from the industry map (Finviz whole-market classification);
    is_leveraged from the single-stock/leveraged ETF family table. Each
    sub-source stands alone: one dead leg drops only its own column.
    Direct table read on ssetf — lookup() has a self-heal side effect and a
    per-symbol cache; 3,700 calls is the wrong shape."""
    cols = {}
    try:
        from api.services import industry_map
        etfs = {str(t).upper() for t in
                (industry_map.tickers_in_industry("Exchange Traded Fund") or ())}
        if etfs:
            cols["is_etf"] = etfs
        else:
            _note(failures, "industry_map_etf", "empty")
    except Exception as e:
        _note(failures, "industry_map_etf", e)
    try:
        from api.services import single_stock_etfs
        with single_stock_etfs._connect() as conn:
            lev = {str(r[0]).upper() for r in
                   conn.execute("SELECT etf_ticker FROM etfs")}
        if lev:
            cols["is_leveraged"] = lev
        else:
            _note(failures, "ssetf", "empty")
    except Exception as e:
        _note(failures, "ssetf", e)
    if not cols:
        return {}
    return {t.upper(): {col: t.upper() in tks for col, tks in cols.items()}
            for t in targets}
```

`_read_fundamentals` edit — inside the existing `try` block, after the sector lines (`snapshot_builder.py:160-165`):

```python
        if meta.get("theme"):
            out["theme"] = meta["theme"]
        # no miss-note for theme: most of the universe is outside the UCT
        # taxonomy, so a None theme is the NORMAL case — counting it would
        # flood the census with noise that buries real provider misses
```

- [ ] **Step 1: Write the failing tests**

```python
"""Context joins: healthy source answers for everyone; dead source stays None."""
from api.services.screener import context_joins


def test_breadth_flags_healthy_and_absent(monkeypatch):
    from api.services import breadth_monitor
    monkeypatch.setattr(breadth_monitor, "get_universe_stocks", lambda: {
        "date": "2026-08-20", "universe_count": 2,
        "stocks": [{"ticker": "AAA", "tags": ["s2", "hvc"]},
                   {"ticker": "BBB", "tags": ["s4"]}]})
    out = context_joins.read_breadth_flags(["AAA", "BBB", "CCC"])
    assert out["AAA"] == {"stage2": True, "stage4": False, "hvc_52w": True}
    assert out["BBB"]["stage4"] is True
    assert out["CCC"] == {"stage2": False, "stage4": False, "hvc_52w": False}


def test_breadth_flags_dead_source_is_empty(monkeypatch):
    from api.services import breadth_monitor
    monkeypatch.setattr(breadth_monitor, "get_universe_stocks",
                        lambda: {"date": None, "stocks": []})
    fails = {}
    assert context_joins.read_breadth_flags(["AAA"], failures=fails) == {}
    assert fails["breadth_flags"]["empty"] == 1


def test_uct20_coalesces_ticker_spellings(monkeypatch):
    from api.services import engine
    monkeypatch.setattr(engine, "get_leadership", lambda: [
        {"ticker": "NVDA"}, {"sym": "MU"}, {"symbol": "AVGO"}])
    out = context_joins.read_uct20(["NVDA", "MU", "AVGO", "AAPL"])
    assert out["MU"]["in_uct20"] is True
    assert out["AAPL"]["in_uct20"] is False
    monkeypatch.setattr(engine, "get_leadership", lambda: [])
    assert context_joins.read_uct20(["NVDA"]) == {}


def test_index_flags(monkeypatch):
    from api.services import watchlist_prebuilt
    monkeypatch.setattr(watchlist_prebuilt, "_load_lists", lambda: [
        {"name": "S&P 500", "tickers": ["AAA"]},
        {"name": "Nasdaq 100", "tickers": ["AAA", "BBB"]},
        {"name": "Dow 30", "tickers": []},
        {"name": "Russell 2000", "tickers": ["CCC"]}])
    out = context_joins.read_index_flags(["AAA", "CCC"])
    assert out["AAA"] == {"index_sp500": True, "index_ndx": True,
                          "index_dow": False, "index_r2k": False}
    assert out["CCC"]["index_r2k"] is True


def test_etf_flags_one_leg_can_die_alone(monkeypatch):
    from api.services import industry_map, single_stock_etfs
    monkeypatch.setattr(industry_map, "tickers_in_industry",
                        lambda industry: ["SPY"])

    def boom():
        raise RuntimeError("no db")
    monkeypatch.setattr(single_stock_etfs, "_connect", boom)
    fails = {}
    out = context_joins.read_etf_flags(["SPY", "NVDA"], failures=fails)
    assert out["SPY"] == {"is_etf": True}          # no is_leveraged key at all
    assert out["NVDA"] == {"is_etf": False}
    assert "RuntimeError" in fails["ssetf"]


def test_theme_captured_by_read_fundamentals(monkeypatch):
    import api.services.ticker_meta as tm
    monkeypatch.setattr(tm, "get_ticker_meta", lambda t: {
        "name": "Nvidia", "sector": "Technology", "industry": "Semis",
        "exchange": "NASDAQ", "theme": "AI Infrastructure"})
    from api.services.screener import snapshot_builder
    out = snapshot_builder._read_fundamentals("NVDA")
    assert out["theme"] == "AI Infrastructure"
```

- [ ] **Step 2: Run to verify failure** — `python -m pytest tests/test_screener_wave1_context_joins.py -v` → FAIL (module missing).
- [ ] **Step 3: Create the module + the `_read_fundamentals` edit as shown.**
- [ ] **Step 4: Run to green** — same command + `python -m pytest tests/test_screener_builder.py -v`.
- [ ] **Step 5: Commit**

```bash
git add api/services/screener/context_joins.py api/services/screener/snapshot_builder.py tests/test_screener_wave1_context_joins.py
git commit -m "screener: context joins (stage/HVC, UCT20, index, ETF flags) + theme capture"
```

---

### Task 9: Builder wiring — setup_score + context maps + the extended rails

**Files:**
- Modify: `api/services/screener/snapshot_builder.py` (imports `:36`, `build_row` `:66-111`, `run_build` `:290-376`)
- Modify: `tests/test_screener_fundamentals_bulk.py` (`_source_key_sets` `:385-416`)
- Test: `tests/test_screener_wave1_wiring.py` (new)

**Interfaces:**
- Consumes: `setup_score.compute(bars, pole_pct)` (Task 6), the four `context_joins` readers (Task 8), `technicals.ath_fields` (Task 3), `rs_fields` with returns (Task 7).
- Produces: `build_row(ticker, bars, ratings_row, fundamentals, rs_row=None, bulk_row=None, spy_closes=None, context_row=None)`; `run_build` reads all four context maps once and passes the per-ticker merge.

`build_row` — the dict-source merge tuple grows (context BEFORE `rs_fields`, which stays last/authoritative; all key sets disjoint by the rail):

```python
    for src in (fundamentals or {}, bulk_row or {}, ratings_row or {},
                context_row or {}, rs_fields(rs_row)):
```

…and inside `if bars:`, after `candles.multi_candle(bars)`:

```python
        row.update(setup_score.compute(bars, pole_pct=row.get("pole_pct")))
```

(import at top: `from . import snapshot_db, candles, technicals, patterns, enrich, setup_score, context_joins`)

`run_build` — beside the existing one-per-build reads (`:317-320`):

```python
    breadth_map = context_joins.read_breadth_flags(targets, failures=sources)
    uct20_map = context_joins.read_uct20(targets, failures=sources)
    index_map = context_joins.read_index_flags(targets, failures=sources)
    etf_map = context_joins.read_etf_flags(targets, failures=sources)
```

…and in the per-ticker loop, before the `build_row` call:

```python
            T = t.upper()
            context_row = {**breadth_map.get(T, {}), **uct20_map.get(T, {}),
                           **index_map.get(T, {}), **etf_map.get(T, {})}
```

…threading `context_row=context_row` and `spy_closes=spy_closes` into `build_row(...)` at `:346`.

Rail registration — `tests/test_screener_fundamentals_bulk.py::_source_key_sets` gains four entries (same monkeypatch style; run each reader against one synthetic ticker) and the existing `ticker_meta.get_ticker_meta` monkeypatch dict gains `"theme": "AI"` so `_read_fundamentals`'s grown key set is exercised:

```python
    monkeypatch.setattr(breadth_monitor, "get_universe_stocks", lambda: {
        "stocks": [{"ticker": "AAA", "tags": ["s2", "s4", "hvc"]}]})
    monkeypatch.setattr(engine, "get_leadership", lambda: [{"ticker": "AAA"}])
    monkeypatch.setattr(watchlist_prebuilt, "_load_lists", lambda: [
        {"name": n, "tickers": ["AAA"]}
        for n in ("S&P 500", "Nasdaq 100", "Dow 30", "Russell 2000")])
    monkeypatch.setattr(industry_map, "tickers_in_industry", lambda i: ["AAA"])
    ...
    "context.breadth":  set(cj.read_breadth_flags(["AAA"])["AAA"]),
    "context.uct20":    set(cj.read_uct20(["AAA"])["AAA"]),
    "context.index":    set(cj.read_index_flags(["AAA"])["AAA"]),
    "context.etf":      set(cj.read_etf_flags(["AAA"])["AAA"]),
```

(`read_etf_flags`'s ssetf leg: monkeypatch `single_stock_etfs._connect` with an in-memory sqlite holding one `etfs(etf_ticker)` row — or let it raise and accept the one-key set; prefer the sqlite stub so BOTH keys are exercised.)

New bar-consumer disjointness rail (same spirit as the dict-source rail, new ground — the five bar consumers `update()` unconditionally, so an overlap is a silent clobber):

```python
def test_bar_consumers_write_disjoint_key_sets():
    bars = [{"o": 100.0, "h": 100.5, "l": 99.5, "c": 100.0, "v": 1000}] * 60
    from api.services.screener import technicals, candles, setup_score
    sets = {
        "compute_technicals": set(technicals.compute_technicals(bars)),
        "ath_fields": set(technicals.ath_fields(bars)),
        "single_candle": set(candles.single_candle(bars)),
        "multi_candle": set(candles.multi_candle(bars)),
        "setup_score": set(setup_score.compute(bars)),
    }
    names = sorted(sets)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            overlap = sets[a] & sets[b]
            assert not overlap, f"{a} and {b} both write {sorted(overlap)}"
```

- [ ] **Step 1: Write the failing tests** — the rail above plus:

```python
def test_build_row_merges_context_and_scores(monkeypatch):
    from api.services.screener import snapshot_builder
    bars = [{"o": 100.0, "h": 100.5, "l": 99.5, "c": 100.0, "v": 1000}] * 60
    row = snapshot_builder.build_row(
        "T", bars, None, None,
        context_row={"stage2": True, "in_uct20": False, "index_sp500": True})
    assert row["stage2"] is True and row["index_sp500"] is True
    assert row["candle_score"] is not None        # setup_score ran
    assert row["dist_ath_pct"] is not None        # ath_fields ran


def test_run_build_passes_context_through(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    from api.services.screener import snapshot_builder as sb, snapshot_db
    bars = [(20250101 + i, 100.0, 100.5, 99.5, 100.0, 1000) for i in range(60)]
    monkeypatch.setattr(sb, "_load_universe", lambda: ["AAA"])
    import api.services.bars_sqlite as bs
    monkeypatch.setattr(bs, "get_bars", lambda t, tf, n: bars)
    monkeypatch.setattr(sb, "_read_rs_map", lambda: {})
    monkeypatch.setattr(sb, "_read_bulk_fundamentals", lambda t, failures=None: {})
    monkeypatch.setattr(sb, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(sb, "_read_fundamentals",
                        lambda t, price=None, failures=None: {})
    monkeypatch.setattr(sb, "_read_spy_closes", lambda: [])
    from api.services.screener import context_joins as cj
    monkeypatch.setattr(cj, "read_breadth_flags",
                        lambda targets, failures=None: {"AAA": {"stage2": True}})
    for fn in ("read_uct20", "read_index_flags", "read_etf_flags"):
        monkeypatch.setattr(cj, fn, lambda targets, failures=None: {})
    out = sb.run_build(max_tickers=1)
    assert out["built"] == 1
    assert snapshot_db.get_row("AAA")["stage2"] == 1
```

- [ ] **Step 2: Run to verify failure** — `python -m pytest tests/test_screener_wave1_wiring.py -v` → FAIL (no `context_row` kwarg).
- [ ] **Step 3: Implement** build_row/run_build wiring + `_source_key_sets` registration.
- [ ] **Step 4: Run to green** — `python -m pytest tests/test_screener_wave1_wiring.py tests/test_screener_fundamentals_bulk.py tests/test_screener_builder.py tests/test_scalar_population_rail.py -v`.
- [ ] **Step 5: Commit**

```bash
git add api/services/screener/snapshot_builder.py tests/test_screener_wave1_wiring.py tests/test_screener_fundamentals_bulk.py
git commit -m "screener: wire setup score + context joins into the nightly build; extend the one-writer rails"
```

---

### Task 10: Registry — 3 new categories, ~40 new controls, 2 new views

**Files:**
- Modify: `api/services/screener/filters.py` (FILTERS `:90-269`, VIEWS `:282-301`, CATEGORIES `:303-310`)
- Test: extends `tests/test_screener_filters.py` coverage automatically (registry-shape tests derive from FILTERS); add nothing there unless red.

**Interfaces:**
- Produces: categories `performance`, `momentum`, `context` (CATEGORIES order: descriptive, fundamental, **performance**, technical, **momentum**, single_candle, multi_candle, pattern, **context**); the controls below; views `performance` and `momentum`. Old FilterPanel renders all of it with no frontend change (tabs derive from `meta.categories`).
- E-8 posture: ZERO new `factual_presets` (the exemption set in `test_only_the_reviewed_definitions_are_exempt` stays untouched). Scanner-published thresholds ship as plain `_range` presets with a source-citing comment — they are not bulk-filled columns, so `test_no_bulk_filled_column_gains_an_invented_threshold` does not reach them, and the citation is the E-8 grounding. Everything else ships `_open_range` (bare).

Add to `FILTERS` (each in its category block):

```python
    # ── performance (Wave 1 — all bare; return thresholds are the owner's) ──
    _open_range("chg_pct_1d", "Change Today", "performance", "chg_pct_1d", unit="%"),
    _open_range("chg_pct_1w", "Change 1W", "performance", "chg_pct_1w", unit="%"),
    _open_range("chg_pct_1m", "Change 1M", "performance", "chg_pct_1m", unit="%"),
    _open_range("chg_pct_3m", "Change 3M", "performance", "chg_pct_3m", unit="%"),
    _open_range("chg_pct_6m", "Change 6M", "performance", "chg_pct_6m", unit="%"),
    _open_range("chg_pct_1y", "Change 1Y", "performance", "chg_pct_1y", unit="%"),
    _open_range("chg_pct_ytd", "Change YTD", "performance", "chg_pct_ytd", unit="%"),
    _open_range("chg_from_open_pct", "Change from Open", "performance",
                "chg_from_open_pct", unit="%"),
    _open_range("dist_20d_high_pct", "Dist from 20D High", "performance",
                "dist_20d_high_pct", unit="%"),
    _open_range("dist_52w_low_pct", "Dist from 52W Low", "performance",
                "dist_52w_low_pct", unit="%"),
    _open_range("dist_ath_pct", "Dist from All-Time High", "performance",
                "dist_ath_pct", unit="%"),
    _bool("new_ath", "New All-Time High", "performance", "new_ath"),
    # ── momentum mechanics (Wave 1) ──
    # ⭐ preset thresholds below cite their published in-product source: the
    # live 7 AM scanner's gates and scoring rubric
    # (uct-intelligence scripts/scanner_candidates.py — READY>=70/WATCH>=55,
    #  vol_acc 1.1/0.85, close CV 2.5/4.0, avg body 0.30/0.40, N-week
    #  volume-low windows 20/15/10 bars). E-8: published, not invented here.
    _open_range("dollar_vol_30d", "Dollar Volume (30d)", "descriptive",
                "dollar_vol_30d", unit="$"),
    _open_range("pole_pct", "Prior Run (Pole %)", "momentum", "pole_pct", unit="%"),
    _range("vol_nweek_low", "Volume Dry-Up", "momentum", "vol_nweek_low",
           [{"label": "Any"},
            {"label": "4-week volume low", "op": "eq", "value": 20},
            {"label": "3-week low or drier", "op": "gte", "min": 15},
            {"label": "2-week low or drier", "op": "gte", "min": 10}]),
    _range("vol_updown_ratio", "Up/Down Volume", "momentum", "vol_updown_ratio",
           [{"label": "Any"},
            {"label": "Accumulating (>1.1)", "op": "gt", "min": 1.1},
            {"label": "Distributing (<0.85)", "op": "lt", "max": 0.85}], unit="×"),
    _range("close_cv_pct", "Close Tightness (CV)", "momentum", "close_cv_pct",
           [{"label": "Any"},
            {"label": "Clustered (<2.5%)", "op": "lt", "max": 2.5},
            {"label": "Tight band (<4%)", "op": "lt", "max": 4}], unit="%"),
    _range("avg_body_pct_5", "5-Bar Body Tightness", "momentum", "avg_body_pct_5",
           [{"label": "Any"},
            {"label": "Tight flag (<0.30)", "op": "lt", "max": 0.30},
            {"label": "Orderly (<0.40)", "op": "lt", "max": 0.40}]),
    _range("candle_score", "Setup Score", "momentum", "candle_score",
           [{"label": "Any"},
            {"label": "Ready-grade (70+)", "op": "gte", "min": 70},
            {"label": "Watch-grade (55+)", "op": "gte", "min": 55}]),
    _open_range("ema_touch_count", "EMA20 Touches (15 bars)", "momentum",
                "ema_touch_count"),
    _bool("ema20_rising", "EMA20 Rising", "momentum", "ema20_rising"),
    _bool("ema10_rising", "EMA10 Rising", "momentum", "ema10_rising"),
    _bool("ema_stack_intact", "EMA Stack Intact (10>20, rising)", "momentum",
          "ema_stack_intact"),
    _open_range("atr_ext_sma50", "ATR Extension vs 50SMA", "momentum",
                "atr_ext_sma50", unit="ATR"),
    _enum("rs_line_trend", "RS Line vs SPY", "momentum", "rs_line_trend",
          [{"label": "Any"},
           {"label": "Rising", "op": "eq", "value": "up"},
           {"label": "Flat", "op": "eq", "value": "flat"},
           {"label": "Falling", "op": "eq", "value": "down"}]),
    # ── technical: expose the dark columns (registry/UI only) ──
    _open_range("atr_pct", "ATR %", "technical", "atr_pct", unit="%"),
    _open_range("pct_vs_sma20", "SMA20 Distance", "technical", "pct_vs_sma20",
                unit="%"),
    _open_range("adr_pct_1w", "ADR % (5-day)", "technical", "adr_pct_1w",
                unit="%"),
    _range("consecutive_down", "Consecutive Down Days", "multi_candle",
           "consecutive_down",
           [{"label": "Any"}, {"label": "3+", "op": "gte", "min": 3}]),
    _open_range("inst_pct", "Institutional Ownership", "fundamental",
                "inst_pct", unit="%"),
    _open_range("rs_return", "RS Weighted Return", "technical", "rs_return",
                unit="%"),
    # options derive from the letter grades the column actually holds —
    # same dynamic mechanism as sector/exchange
    _enum("accdis", "Acc/Dis Grade", "fundamental",
          [{"label": "Any"}], options_column="accdis"),
    _open_range("body_pct", "Last-Bar Body", "single_candle", "body_pct"),
    _open_range("upper_wick_pct", "Upper Wick", "single_candle",
                "upper_wick_pct"),
    _open_range("lower_wick_pct", "Lower Wick", "single_candle",
                "lower_wick_pct"),
    _open_range("pattern_conf_max", "Pattern Confidence", "pattern",
                "pattern_conf_max"),
    _enum("industry", "Industry", "descriptive", "industry",
          [{"label": "Any"}], options_column="industry"),
    # ── context (Wave 1) ──
    _enum("theme", "UCT Theme", "context", "theme",
          [{"label": "Any"}], options_column="theme"),
    _bool("in_uct20", "In UCT 20", "context", "in_uct20"),
    _bool("index_sp500", "S&P 500", "context", "index_sp500"),
    _bool("index_ndx", "Nasdaq 100", "context", "index_ndx"),
    _bool("index_dow", "Dow 30", "context", "index_dow"),
    _bool("index_r2k", "Russell 2000", "context", "index_r2k"),
    _bool("is_etf", "ETF", "context", "is_etf"),
    _bool("is_leveraged", "Leveraged/Inverse ETF", "context", "is_leveraged"),
    _bool("stage2", "Weinstein Stage 2", "context", "stage2"),
    _bool("stage4", "Weinstein Stage 4", "context", "stage4"),
    _bool("hvc_52w", "High-Volume Close (52W)", "context", "hvc_52w"),
```

Also: the EXISTING `candle_type` enum (`filters.py:234-241`) gains the value
`candles.py` computes but never offered:
`{"label": "Spinning Top", "op": "eq", "value": "spinning-top"}`.

Add to `VIEWS`:

```python
    "performance": {"label": "Performance", "columns": [
        "ticker", "company", "chg_pct_1d", "chg_pct_1w", "chg_pct_1m",
        "chg_pct_3m", "chg_pct_6m", "chg_pct_1y", "chg_pct_ytd",
        "dist_52w_high_pct", "dist_ath_pct"]},
    "momentum": {"label": "Momentum", "columns": [
        "ticker", "company", "candle_score", "pct_vs_ema20", "close_cv_pct",
        "avg_body_pct_5", "pole_pct", "adr_pct", "vol_nweek_low",
        "vol_updown_ratio", "rs_line_trend", "chg_pct_1d"]},
```

`CATEGORIES` becomes:

```python
CATEGORIES = [
    {"key": "descriptive", "label": "Descriptive"},
    {"key": "fundamental", "label": "Fundamental"},
    {"key": "performance", "label": "Performance"},
    {"key": "technical", "label": "Technical"},
    {"key": "momentum", "label": "Momentum"},
    {"key": "single_candle", "label": "Single Candle"},
    {"key": "multi_candle", "label": "Multi-Candle"},
    {"key": "pattern", "label": "Patterns"},
    {"key": "context", "label": "Context"},
]
```

- [ ] **Step 1: Run the registry suite BEFORE editing** — `python -m pytest tests/test_screener_filters.py -v` → all green (baseline).
- [ ] **Step 2: Apply the FILTERS/VIEWS/CATEGORIES edits above.**
- [ ] **Step 3: Run the suite again** — `python -m pytest tests/test_screener_filters.py tests/test_screener_query.py tests/test_screener_api.py -v`.
Expected: PASS. If a dynamic-enum rail pins the set of `options_column` filters, extend it to include `theme`/`industry` the same way `sector`/`exchange` are covered (derived, not retyped). If any grounding rail unexpectedly reaches a scanner-cited preset, do NOT add factual exemptions — strip that preset to bare and note it in the commit for the Wave 6 owner pass.
- [ ] **Step 4: Manual smoke of meta shape** — `python -c "import sys; sys.path.insert(0,'.'); from api.services.screener import filters; m=filters.meta(); print(len(m['filters']), [c['key'] for c in m['categories']])"` → ~84 filters, 9 categories.
- [ ] **Step 5: Commit**

```bash
git add api/services/screener/filters.py
git commit -m "screener: performance/momentum/context categories — ~40 new controls, 2 new views"
```

---

### Task 11: columnDefs + the member-visibility rail

**Files:**
- Modify: `app/src/pages/screener/columnDefs.js`
- Test: `tests/test_screener_wave1_columndefs.py` (new, pytest — parses the JS so filters.py stays the single authority)

**Interfaces:**
- Produces: a COLUMN_DEF for every column any filter or view can surface. Closes the standing "filterable but undisplayable" gap class (beta, current_ratio, close_position were shipped without defs).

Additions to `COLUMN_DEFS` (formatters reuse the file's existing helpers; add two new ones):

```js
const bool = v => v == null ? '—' : v ? '✓' : '—'
const dollarVol = v => v == null ? '—'
  : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B`
  : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M`
  : `$${(v / 1e3).toFixed(0)}K`
```

```js
  // exposed-existing (previously filterable-but-undisplayable or dark)
  beta: { label: 'Beta', fmt: num(2) },
  current_ratio: { label: 'Curr Ratio', fmt: num(1) },
  close_position: { label: 'Close Pos', fmt: num(2) },
  atr_pct: { label: 'ATR%', fmt: num(1) },
  pct_vs_sma20: { label: 'vs20', fmt: pct, heat: heatPos },
  dist_52w_low_pct: { label: '52WL', fmt: pct },
  inst_pct: { label: 'Inst%', fmt: pctPlain(0) },
  industry: { label: 'Industry', fmt: v => v || '—' },
  pattern_conf_max: { label: 'Pat Conf', fmt: num(2) },
  consecutive_down: { label: 'Down Run', fmt: num(0) },
  body_pct: { label: 'Body', fmt: num(2) },
  upper_wick_pct: { label: 'U Wick', fmt: num(2) },
  lower_wick_pct: { label: 'L Wick', fmt: num(2) },
  chg_pct_1w: { label: '1W%', fmt: pct, heat: heatPos },
  chg_pct_1m: { label: '1M%', fmt: pct, heat: heatPos },
  // Wave 1 performance
  chg_pct_3m: { label: '3M%', fmt: pct, heat: heatPos },
  chg_pct_6m: { label: '6M%', fmt: pct, heat: heatPos },
  chg_pct_1y: { label: '1Y%', fmt: pct, heat: heatPos },
  chg_pct_ytd: { label: 'YTD%', fmt: pct, heat: heatPos },
  chg_from_open_pct: { label: 'FromOpen', fmt: pct, heat: heatPos },
  adr_pct_1w: { label: 'ADR 1W', fmt: num(1) },
  dist_20d_high_pct: { label: '20DH', fmt: pct },
  dist_20d_low_pct: { label: '20DL', fmt: pct },
  dist_ath_pct: { label: 'ATH', fmt: pct },
  new_ath: { label: 'New ATH', fmt: bool },
  dollar_vol_30d: { label: '$Vol 30d', fmt: dollarVol },
  // Wave 1 momentum mechanics
  pole_pct: { label: 'Pole%', fmt: pctPlain(0) },
  vol_nweek_low: { label: 'Vol Low', fmt: v => v === 20 ? '4w' : v === 15 ? '3w' : v === 10 ? '2w' : '—' },
  vol_updown_ratio: { label: 'U/D Vol', fmt: v => v == null ? '—' : `${v.toFixed(2)}×`,
    heat: v => v == null ? '' : v > 1.1 ? 'g' : v < 0.85 ? 'r' : '' },
  close_cv_pct: { label: 'CV%', fmt: num(1) },
  avg_body_pct_5: { label: 'Body5', fmt: num(2) },
  ema_touch_count: { label: 'EMA Touch', fmt: num(0) },
  ema10_rising: { label: 'E10↑', fmt: bool },
  ema20_rising: { label: 'E20↑', fmt: bool },
  ema_stack_intact: { label: 'Stack', fmt: bool },
  candle_score: { label: 'Score', fmt: num(0),
    heat: v => v == null ? '' : v >= 70 ? 'g' : v >= 55 ? 'g1' : '' },
  atr_ext_sma50: { label: 'ATR Ext', fmt: num(1) },
  rs_line_trend: { label: 'RS Line', fmt: v => v || '—' },
  prev_day_open: { label: 'PD O', fmt: usd },
  prev_day_high: { label: 'PDH', fmt: usd },
  prev_day_low: { label: 'PDL', fmt: usd },
  prev_day_close: { label: 'PDC', fmt: usd },
  // Wave 1 context
  theme: { label: 'Theme', fmt: v => v || '—' },
  in_uct20: { label: 'UCT20', fmt: bool },
  index_sp500: { label: 'SPX', fmt: bool },
  index_ndx: { label: 'NDX', fmt: bool },
  index_dow: { label: 'DOW', fmt: bool },
  index_r2k: { label: 'R2K', fmt: bool },
  is_etf: { label: 'ETF', fmt: bool },
  is_leveraged: { label: 'Lev', fmt: bool },
  stage2: { label: 'Stg2', fmt: bool },
  stage4: { label: 'Stg4', fmt: bool },
  hvc_52w: { label: 'HVC', fmt: bool },
```

The rail (pytest, so the expected set derives from `filters.py` — the JS is parsed, never the authority; precedent: `api/main.py::idb_cache_logic_version` parses a JS constant):

```python
"""Every column a member can filter on or see in a view has a display def.

beta/current_ratio/close_position shipped filterable-but-undisplayable — a
member could filter on them and never see the value. This pins the gap class.
"""
import re


def _column_def_keys():
    src = open("app/src/pages/screener/columnDefs.js", encoding="utf-8").read()
    body = src.split("export const COLUMN_DEFS = {", 1)[1]
    return set(re.findall(r"^  (\w+): \{", body, flags=re.M))


def test_the_parser_can_see_a_known_key_and_not_a_phantom():
    keys = _column_def_keys()
    assert "ticker" in keys            # non-vacuity control
    assert "definitely_not_a_column" not in keys


def test_every_filterable_and_viewed_column_has_a_def():
    from api.services.screener import filters
    keys = _column_def_keys()
    want = {f["column"] for f in filters.FILTERS.values()}
    for v in filters.VIEWS.values():
        want |= set(v["columns"])
    missing = sorted(want - keys)
    assert not missing, f"member-visible columns with no display def: {missing}"
```

- [ ] **Step 1: Write the rail first, run it** — `python -m pytest tests/test_screener_wave1_columndefs.py -v` → FAIL naming every missing def (after Task 10 this list is long — that is the point).
- [ ] **Step 2: Apply the columnDefs.js additions.**
- [ ] **Step 3: Run to green** + `cd app && npx vitest run src/pages/screener --pool=threads` (existing table tests).
- [ ] **Step 4: Commit**

```bash
git add app/src/pages/screener/columnDefs.js tests/test_screener_wave1_columndefs.py
git commit -m "screener: display defs for every member-visible column + the visibility rail"
```

---

### Task 12: Integration verification (read-only against real local stores)

**Files:**
- Create: `tools/screener_wave1_smoke.py`

A read-only smoke over real bars (dev box reads `C:\data\bars.db` read-only; NOTHING here writes — the screener DB is never opened):

```python
"""Wave 1 smoke: build_row over 20 real tickers, print the non-null census.

READ-ONLY: reads bars.db via bars_sqlite (read path), calls build_row in
memory, writes NOTHING anywhere. Run before ship; the real gate on prod is
the build receipt after deploy (Task 13).
"""
import json
import sys

sys.path.insert(0, ".")
from api.services.screener import snapshot_builder as sb  # noqa: E402

universe = [t for t in json.load(open("api/data/cap_universe.json"))
            if isinstance(t, str)][:20]
spy = sb._read_spy_closes()
census = {}
rows = 0
for t in universe:
    bars = sb._read_daily_bars(t)
    if not bars:
        continue
    row = sb.build_row(t, bars, None, None, spy_closes=spy)
    rows += 1
    for k, v in row.items():
        if v is not None:
            census[k] = census.get(k, 0) + 1

new_cols = ["chg_pct_1y", "chg_pct_ytd", "chg_from_open_pct", "adr_pct_1w",
            "dist_20d_high_pct", "dist_ath_pct", "new_ath", "pole_pct",
            "close_cv_pct", "avg_body_pct_5", "candle_score", "vol_updown_ratio",
            "ema_touch_count", "ema20_rising", "ema_stack_intact",
            "atr_ext_sma50", "rs_line_trend", "prev_day_high", "dollar_vol_30d"]
print(f"rows built: {rows}")
for c in new_cols:
    print(f"  {c}: {census.get(c, 0)}/{rows}")
missing = [c for c in new_cols if census.get(c, 0) == 0]
print("ALL BAR-DERIVED COLUMNS POPULATED" if not missing
      else f"EMPTY (investigate before ship): {missing}")
```

- [ ] **Step 1: Run the smoke** — `python tools/screener_wave1_smoke.py`. Expected: every bar-derived column ≥ rows−2 (chg_pct_1y/ytd may be lower for young listings; rs_line_trend 0/N only if local SPY bars missing — note but don't block, prod has SPY). Context columns are NOT in this smoke (their stores are prod-side).
- [ ] **Step 2: Full backend sweep (chunked)** — `python -m pytest tests/ -k "screener or scan_ or scalar or ast_scalars" -v` then `python -m pytest tests/ -k "not screener and not scan_" -q -x --ignore=tests/slow` in 2–3 chunks if load-bound.
- [ ] **Step 3: Frontend** — `cd app && npx vitest run src/pages/screener src/components/screener --pool=threads && npm run build`.
- [ ] **Step 4: Commit the smoke tool**

```bash
git add tools/screener_wave1_smoke.py
git commit -m "screener: wave-1 read-only smoke over real local bars"
```

---

### Task 13: Ship + verify by the artifact

- [ ] **Step 1: Sync with master** — `git fetch origin && git merge origin/master`; resolve; then `grep -c broker_sync api/main.py` (must be ≥ 7) and re-run `python -m pytest tests/ -k "screener or scalar or ast_scalars" -q`.
- [ ] **Step 2: Push** — `git push origin feat/screener-deep-work:master`. If the market-hours pre-push freeze blocks, `UCT_PUSH_OVERRIDE=1 git push origin feat/screener-deep-work:master` (standing owner decision: never hold a deploy).
- [ ] **Step 3: Deploy verify by the artifact** (browser User-Agent on all curls — Cloudflare 1010-blocks bare curl):
  1. `/api/health` — `uptime_seconds` reset.
  2. Admin `POST /api/screener/refresh?max_tickers=300` → wait ~3 min.
  3. `GET /api/screener/snapshot-status` — rows_on_snapshot_date moving.
  4. `POST /api/screener/scan` with `{"filters":[{"key":"candle_score","op":"gte","min":70}],"sort":{"key":"dollar_vol_30d","dir":"desc"},"view":"momentum","page":1,"page_size":25}` — expect a plausible non-zero total, non-null candle_score/dollar_vol_30d cells, momentum view columns present.
  5. `railway logs -n 5000` (from `C:\Users\Patrick\uct-dashboard`, PowerShell) — find the build-receipt line; `empty_columns` must NOT name any bar-derived Wave 1 column on the refreshed subset. Context columns may appear until the 03:00 full build; verify them the next morning against the nightly receipt.
  6. **Open the artifact**: load `/screener` in the browser as an admin — Performance/Momentum/Context tabs render, Momentum view shows real values, chips label correctly. Screenshot desktop + phone.
- [ ] **Step 4: Next-morning check** — after the 03:00 ET build: `snapshot-status` fresh; a scan filtered `stage2=Yes` + `in_uct20=Yes` returns plausible names; `empty_columns` in the nightly receipt empty (or explained + recorded).

## Execution notes

- Tasks 1→7 are strictly ordered (each consumes the prior's interface). Task 8 is independent of 2–7 (parallel-safe, different files). Task 9 needs 1–8. Tasks 10/11 need 1 only (registry validity checks columns exist) but read better after 9. Task 12–13 last.
- Wave 2 (new source jobs) and Wave 3 (UI shell) have their own plans; nothing here blocks them except Task 1's schema landing first for Wave 2.

