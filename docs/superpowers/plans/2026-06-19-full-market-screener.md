# Full-Market Screener Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/screener` into a Finviz-grade custom screener that filters the full ~3,685-ticker cap universe server-side across descriptive/fundamental/technical/single-candle/multi-candle/pattern criteria, returning sub-second results.

**Architecture:** A nightly builder writes one precomputed row per ticker into `/data/screener.db` (technicals + candle structure from local daily bars, fundamentals/RS from `research_ratings.db` + a light yfinance pass, cheap patterns from the pattern engine). A server-side query engine turns a JSON filter spec into parametrized SQL over that table. A new React page (`ScannerPro`) renders the filter panel + swappable-view results table, overlaying live prices for display only.

**Tech Stack:** Python 3.12, FastAPI, SQLite (WAL), APScheduler; React 18 + Vite, SWR, CSS Modules; Lightweight Charts v5; pytest + vitest.

## Global Constraints

- **Branch from `origin/master`** (has the merged research/ratings DB code) in an **isolated worktree** under `.worktrees/`; ship via fast-forward push. NEVER `git add -A` (shared-tree hazard).
- **Universe:** full cap universe from `api/data/cap_universe.json` (~3,685 tickers).
- **Snapshot DB path:** `/data/screener.db` (env override `SCREENER_DB_PATH`); local dev falls back to a repo-relative `./data/screener.db`.
- **Filtering uses snapshot (EOD) values; live prices are display-only.** Never filter on live data.
- **API speaks filter `key`s, never raw SQL column names.** All SQL parametrized.
- **Paid feature** — `/screener` stays OUT of `FREE_PAGES`; new endpoints require auth.
- **Models:** any LLM use is Opus 4.8 (`claude-opus-4-8`). (None expected in this feature.)
- **Pattern coverage is tiered** (cheap universe-wide + active-set join). UI must not overstate it.
- **Tests:** backend `pytest`, frontend `cd app && npx vitest run`. Build check: `cd app && npm run build`.
- Reuse existing infra: local bars reader, `research_ratings.db`, `pattern_detections`, `useLivePrices`, `TickerPopup`, `TickerActions`, `components/ui/` form primitives, `pages/breadth/grouping/`, `prefetchBars`.

---

## Phase 0 — Worktree & baseline

### Task 0: Create the implementation worktree off master

**Files:** none (git only)

- [ ] **Step 1: Fetch and create worktree from master**

```bash
cd C:/Users/Patrick/uct-dashboard
git fetch origin
git worktree add -b feat/full-market-screener .worktrees/screener origin/master
cd .worktrees/screener
```

- [ ] **Step 2: Confirm baseline has the ratings DB code**

Run: `ls api/services/research/ratings_universe.py api/services/research/ratings_db.py`
Expected: both paths exist (confirms correct base). If missing, STOP — wrong base branch.

- [ ] **Step 3: Move the spec + this plan into the worktree and commit**

```bash
# copy the two docs from the stale tree if not present on master
git add docs/superpowers/specs/2026-06-19-full-market-screener-design.md docs/superpowers/plans/2026-06-19-full-market-screener.md
git commit -m "docs(screener): full-market screener spec + plan"
```

Expected: clean commit, only the two docs staged.

---

## Phase 1 — Snapshot foundation

New package `api/services/screener/`. All compute reads **local daily bars** (zero network) + `research_ratings.db`; a light yfinance pass fills remaining fundamentals.

### Task 1: Snapshot DB schema + open/upsert/read

**Files:**
- Create: `api/services/screener/__init__.py` (empty)
- Create: `api/services/screener/snapshot_db.py`
- Test: `tests/test_screener_snapshot_db.py`

**Interfaces:**
- Produces:
  - `get_db_path() -> str`
  - `connect() -> sqlite3.Connection` (WAL, row_factory=Row, `foreign_keys` off)
  - `init_db() -> None` (creates `screener_rows` + indices, idempotent)
  - `upsert_rows(rows: list[dict]) -> int` (INSERT OR REPLACE, returns count)
  - `get_row(ticker: str) -> dict | None`
  - `count_rows() -> int`
  - `status() -> dict` (`{rows, latest_built_at, latest_snapshot_date}`)
  - Module constant `COLUMNS: list[str]` — canonical ordered column names.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_screener_snapshot_db.py
import os, importlib

def _fresh(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    import api.services.screener.snapshot_db as db
    importlib.reload(db)
    db.init_db()
    return db

def test_init_upsert_and_read(tmp_path, monkeypatch):
    db = _fresh(tmp_path, monkeypatch)
    assert db.count_rows() == 0
    n = db.upsert_rows([
        {"ticker": "NVDA", "company": "NVIDIA", "sector": "Technology",
         "price": 184.0, "market_cap": 4.5e12, "rsi14": 61.0,
         "uct_composite": 97, "snapshot_date": "2026-06-19",
         "built_at": 1718800000},
    ])
    assert n == 1
    row = db.get_row("NVDA")
    assert row["company"] == "NVIDIA"
    assert row["rsi14"] == 61.0
    # upsert is replace-by-ticker
    db.upsert_rows([{"ticker": "NVDA", "price": 190.0, "snapshot_date": "2026-06-20", "built_at": 1718900000}])
    assert db.count_rows() == 1
    assert db.get_row("NVDA")["price"] == 190.0

def test_status_reports_freshness(tmp_path, monkeypatch):
    db = _fresh(tmp_path, monkeypatch)
    db.upsert_rows([{"ticker": "AAA", "snapshot_date": "2026-06-19", "built_at": 123}])
    st = db.status()
    assert st["rows"] == 1
    assert st["latest_snapshot_date"] == "2026-06-19"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_screener_snapshot_db.py -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `snapshot_db.py`**

```python
# api/services/screener/snapshot_db.py
import os, sqlite3, threading

_WRITE_LOCK = threading.Lock()

# Canonical column set. Add columns here ONLY (builder + query read this).
COLUMNS = [
    "ticker", "company", "sector", "industry", "exchange",
    "market_cap", "price", "avg_volume_30d", "dividend_yield",
    # fundamentals
    "pe_ttm", "pe_fwd", "peg", "ps", "pb", "eps_growth", "rev_growth",
    "op_margin", "gross_margin", "net_margin", "roe", "roa",
    "debt_to_equity", "current_ratio", "beta", "inst_pct",
    # uct ratings
    "uct_composite", "rs_rank", "rs_return", "accdis",
    # technical
    "chg_pct_1d", "chg_pct_1w", "chg_pct_1m", "rsi14",
    "pct_vs_sma20", "pct_vs_sma50", "pct_vs_sma200", "pct_vs_ema20",
    "ma_stack", "adr_pct", "atr_pct", "vol_ratio", "gap_pct",
    "dist_52w_high_pct", "dist_52w_low_pct", "above_50sma", "new_52w_high",
    # single candle
    "candle_type", "body_pct", "upper_wick_pct", "lower_wick_pct",
    "close_position", "wide_bar", "narrow_bar",
    # multi candle
    "inside_bar_run", "tight_consolidation", "pullback_depth_pct",
    "higher_lows_run", "nr7", "consecutive_up", "consecutive_down",
    # patterns
    "patterns", "pattern_conf_max",
    # meta
    "snapshot_date", "bars_asof", "built_at",
]

_INT_BOOL = {"above_50sma", "new_52w_high", "wide_bar", "narrow_bar",
             "tight_consolidation", "nr7"}

def get_db_path() -> str:
    p = os.environ.get("SCREENER_DB_PATH")
    if p:
        return p
    if os.path.isdir("/data"):
        return "/data/screener.db"
    os.makedirs("./data", exist_ok=True)
    return "./data/screener.db"

def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(get_db_path(), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn

def _coldef(name: str) -> str:
    if name == "ticker":
        return "ticker TEXT PRIMARY KEY"
    if name in ("company", "sector", "industry", "exchange", "ma_stack",
                "candle_type", "patterns", "snapshot_date", "bars_asof"):
        return f"{name} TEXT"
    if name in _INT_BOOL or name in ("uct_composite", "rs_rank",
                                     "inside_bar_run", "higher_lows_run",
                                     "consecutive_up", "consecutive_down",
                                     "built_at"):
        return f"{name} INTEGER"
    return f"{name} REAL"

def init_db() -> None:
    with _WRITE_LOCK, connect() as conn:
        cols = ", ".join(_coldef(c) for c in COLUMNS)
        conn.execute(f"CREATE TABLE IF NOT EXISTS screener_rows ({cols})")
        for idx in ("sector", "market_cap", "uct_composite", "rs_rank",
                    "above_50sma", "chg_pct_1d", "candle_type"):
            conn.execute(
                f"CREATE INDEX IF NOT EXISTS idx_sr_{idx} ON screener_rows({idx})")
        conn.commit()

def upsert_rows(rows: list[dict]) -> int:
    if not rows:
        return 0
    placeholders = ", ".join("?" for _ in COLUMNS)
    sql = f"INSERT OR REPLACE INTO screener_rows ({', '.join(COLUMNS)}) VALUES ({placeholders})"
    with _WRITE_LOCK, connect() as conn:
        conn.executemany(sql, [[r.get(c) for c in COLUMNS] for r in rows])
        conn.commit()
    return len(rows)

def get_row(ticker: str) -> dict | None:
    with connect() as conn:
        r = conn.execute("SELECT * FROM screener_rows WHERE ticker=?",
                         (ticker.upper(),)).fetchone()
        return dict(r) if r else None

def count_rows() -> int:
    with connect() as conn:
        return conn.execute("SELECT COUNT(*) FROM screener_rows").fetchone()[0]

def status() -> dict:
    with connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) n, MAX(built_at) b, MAX(snapshot_date) d "
            "FROM screener_rows").fetchone()
    return {"rows": row["n"] or 0, "latest_built_at": row["b"],
            "latest_snapshot_date": row["d"]}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pytest tests/test_screener_snapshot_db.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add api/services/screener/__init__.py api/services/screener/snapshot_db.py tests/test_screener_snapshot_db.py
git commit -m "feat(screener): snapshot DB schema + upsert/read"
```

### Task 2: Candle structure computation (single + multi)

**Files:**
- Create: `api/services/screener/candles.py`
- Test: `tests/test_screener_candles.py`

**Interfaces:**
- Consumes: a `bars` list of dicts `{"o","h","l","c","v"}` oldest→newest (daily).
- Produces:
  - `single_candle(bars: list[dict]) -> dict` → keys: `candle_type, body_pct, upper_wick_pct, lower_wick_pct, close_position, wide_bar, narrow_bar` (uses last bar; `wide/narrow_bar` vs ATR14).
  - `multi_candle(bars: list[dict]) -> dict` → keys: `inside_bar_run, tight_consolidation, pullback_depth_pct, higher_lows_run, nr7, consecutive_up, consecutive_down`.

- [ ] **Step 1: Write failing test**

```python
# tests/test_screener_candles.py
from api.services.screener import candles

def _bar(o,h,l,c,v=1_000_000): return {"o":o,"h":h,"l":l,"c":c,"v":v}

def test_hammer_detected():
    bars = [_bar(10,10.2,9.9,10.0) for _ in range(20)]
    # long lower wick, small body near top
    bars.append(_bar(10.0, 10.1, 9.0, 9.95))
    out = candles.single_candle(bars)
    assert out["candle_type"] == "hammer"
    assert out["lower_wick_pct"] > out["body_pct"]
    assert 0.0 <= out["close_position"] <= 1.0

def test_doji_detected():
    bars = [_bar(10,10.2,9.8,10.0) for _ in range(20)]
    bars.append(_bar(10.0, 10.5, 9.5, 10.01))  # tiny body, big range
    out = candles.single_candle(bars)
    assert out["candle_type"] == "doji"

def test_inside_bar_run_and_nr7():
    bars = [_bar(10,12,8,10) for _ in range(10)]
    bars.append(_bar(10,11,9,10))   # inside prior
    bars.append(_bar(10,10.5,9.5,10))  # inside again
    out = candles.multi_candle(bars)
    assert out["inside_bar_run"] >= 2
    assert out["nr7"] in (True, False)

def test_consecutive_up():
    bars = [_bar(10,10,10,10)]
    for c in (10.5, 11.0, 11.5):
        bars.append(_bar(c-0.1, c+0.1, c-0.2, c))
    out = candles.multi_candle(bars)
    assert out["consecutive_up"] >= 3
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_screener_candles.py -v`
Expected: FAIL (module/functions missing).

- [ ] **Step 3: Implement `candles.py`**

```python
# api/services/screener/candles.py
def _atr(bars, n=14):
    if len(bars) < 2:
        return 0.0
    trs = []
    for i in range(1, len(bars)):
        h, l, pc = bars[i]["h"], bars[i]["l"], bars[i-1]["c"]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    window = trs[-n:] if len(trs) >= n else trs
    return sum(window) / len(window) if window else 0.0

def single_candle(bars: list[dict]) -> dict:
    if not bars:
        return {"candle_type": "none", "body_pct": None, "upper_wick_pct": None,
                "lower_wick_pct": None, "close_position": None,
                "wide_bar": False, "narrow_bar": False}
    b = bars[-1]
    o, h, l, c = b["o"], b["h"], b["l"], b["c"]
    rng = max(h - l, 1e-9)
    body = abs(c - o)
    upper = h - max(o, c)
    lower = min(o, c) - l
    body_pct = body / rng
    upper_pct = upper / rng
    lower_pct = lower / rng
    close_pos = (c - l) / rng
    atr = _atr(bars)
    wide = rng > 1.5 * atr if atr else False
    narrow = rng < 0.5 * atr if atr else False

    ctype = "none"
    if body_pct < 0.1:
        ctype = "doji"
    elif lower_pct > 0.5 and body_pct < 0.35 and upper_pct < 0.15:
        ctype = "hammer"
    elif upper_pct > 0.5 and body_pct < 0.35 and lower_pct < 0.15:
        ctype = "shooting-star"
    elif body_pct > 0.85:
        ctype = "marubozu"
    elif len(bars) >= 2:
        p = bars[-2]
        pbody_lo, pbody_hi = min(p["o"], p["c"]), max(p["o"], p["c"])
        if c > o and o <= pbody_lo and c >= pbody_hi:
            ctype = "bullish-engulfing"
        elif c < o and o >= pbody_hi and c <= pbody_lo:
            ctype = "bearish-engulfing"
        elif body_pct < 0.3:
            ctype = "spinning-top"
    return {"candle_type": ctype, "body_pct": round(body_pct, 4),
            "upper_wick_pct": round(upper_pct, 4), "lower_wick_pct": round(lower_pct, 4),
            "close_position": round(close_pos, 4), "wide_bar": wide, "narrow_bar": narrow}

def multi_candle(bars: list[dict]) -> dict:
    out = {"inside_bar_run": 0, "tight_consolidation": False,
           "pullback_depth_pct": None, "higher_lows_run": 0, "nr7": False,
           "consecutive_up": 0, "consecutive_down": 0}
    n = len(bars)
    if n < 2:
        return out
    # inside-bar run (most recent backward)
    run = 0
    for i in range(n - 1, 0, -1):
        if bars[i]["h"] <= bars[i-1]["h"] and bars[i]["l"] >= bars[i-1]["l"]:
            run += 1
        else:
            break
    out["inside_bar_run"] = run
    # NR7: current range is the narrowest of last 7
    if n >= 7:
        ranges = [bars[i]["h"] - bars[i]["l"] for i in range(n - 7, n)]
        out["nr7"] = ranges[-1] <= min(ranges)
    # tight consolidation: CV of last 10 closes < 2.5%
    if n >= 10:
        closes = [b["c"] for b in bars[-10:]]
        mean = sum(closes) / len(closes)
        if mean:
            var = sum((x - mean) ** 2 for x in closes) / len(closes)
            cv = (var ** 0.5) / mean
            out["tight_consolidation"] = cv < 0.025
    # higher-lows run
    hl = 0
    for i in range(n - 1, 0, -1):
        if bars[i]["l"] > bars[i-1]["l"]:
            hl += 1
        else:
            break
    out["higher_lows_run"] = hl
    # pullback depth from recent 20-bar high to last close
    window = bars[-20:] if n >= 20 else bars
    hi = max(b["h"] for b in window)
    if hi:
        out["pullback_depth_pct"] = round((hi - bars[-1]["c"]) / hi * 100, 2)
    # consecutive up/down closes
    up = down = 0
    for i in range(n - 1, 0, -1):
        if bars[i]["c"] > bars[i-1]["c"]:
            if down: break
            up += 1
        elif bars[i]["c"] < bars[i-1]["c"]:
            if up: break
            down += 1
        else:
            break
    out["consecutive_up"], out["consecutive_down"] = up, down
    return out
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_screener_candles.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add api/services/screener/candles.py tests/test_screener_candles.py
git commit -m "feat(screener): single + multi candle structure computation"
```

### Task 3: Technical indicators from bars

**Files:**
- Create: `api/services/screener/technicals.py`
- Test: `tests/test_screener_technicals.py`

**Interfaces:**
- Consumes: `bars` oldest→newest daily dicts `{"o","h","l","c","v"}`.
- Produces: `compute_technicals(bars: list[dict]) -> dict` → keys: `chg_pct_1d, chg_pct_1w, chg_pct_1m, rsi14, pct_vs_sma20, pct_vs_sma50, pct_vs_sma200, pct_vs_ema20, ma_stack, adr_pct, atr_pct, vol_ratio, gap_pct, dist_52w_high_pct, dist_52w_low_pct, above_50sma, new_52w_high, price`.

- [ ] **Step 1: Write failing test**

```python
# tests/test_screener_technicals.py
from api.services.screener import technicals

def _series(closes):
    return [{"o": c, "h": c * 1.01, "l": c * 0.99, "c": c, "v": 1_000_000}
            for c in closes]

def test_uptrend_above_mas_and_stack():
    bars = _series([float(i) for i in range(1, 260)])  # steadily rising
    out = technicals.compute_technicals(bars)
    assert out["above_50sma"] is True
    assert out["pct_vs_sma50"] > 0
    assert out["ma_stack"] == "full-bull"
    assert out["new_52w_high"] is True
    assert out["rsi14"] > 60

def test_change_pcts():
    bars = _series([100.0] * 25 + [110.0])
    out = technicals.compute_technicals(bars)
    assert round(out["chg_pct_1d"], 1) == 10.0
    assert out["price"] == 110.0
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_screener_technicals.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `technicals.py`**

```python
# api/services/screener/technicals.py
def _sma(vals, n):
    return sum(vals[-n:]) / n if len(vals) >= n else None

def _ema(vals, n):
    if len(vals) < n:
        return None
    k = 2 / (n + 1)
    ema = sum(vals[:n]) / n
    for v in vals[n:]:
        ema = v * k + ema * (1 - k)
    return ema

def _rsi(closes, n=14):
    if len(closes) < n + 1:
        return None
    gains = losses = 0.0
    for i in range(len(closes) - n, len(closes)):
        d = closes[i] - closes[i-1]
        gains += max(d, 0); losses += max(-d, 0)
    avg_g, avg_l = gains / n, losses / n
    if avg_l == 0:
        return 100.0
    rs = avg_g / avg_l
    return 100 - (100 / (1 + rs))

def _pct(a, b):
    return round((a - b) / b * 100, 2) if b else None

def compute_technicals(bars: list[dict]) -> dict:
    out = {k: None for k in (
        "chg_pct_1d","chg_pct_1w","chg_pct_1m","rsi14","pct_vs_sma20",
        "pct_vs_sma50","pct_vs_sma200","pct_vs_ema20","adr_pct","atr_pct",
        "vol_ratio","gap_pct","dist_52w_high_pct","dist_52w_low_pct","price")}
    out["ma_stack"] = None; out["above_50sma"] = None; out["new_52w_high"] = False
    if not bars:
        return out
    closes = [b["c"] for b in bars]
    price = closes[-1]
    out["price"] = price
    if len(closes) >= 2:
        out["chg_pct_1d"] = _pct(price, closes[-2])
        out["gap_pct"] = _pct(bars[-1]["o"], closes[-2])
    if len(closes) >= 6:
        out["chg_pct_1w"] = _pct(price, closes[-6])
    if len(closes) >= 22:
        out["chg_pct_1m"] = _pct(price, closes[-22])
    out["rsi14"] = round(_rsi(closes), 2) if _rsi(closes) is not None else None
    s20, s50, s200 = _sma(closes, 20), _sma(closes, 50), _sma(closes, 200)
    e20 = _ema(closes, 20)
    out["pct_vs_sma20"] = _pct(price, s20) if s20 else None
    out["pct_vs_sma50"] = _pct(price, s50) if s50 else None
    out["pct_vs_sma200"] = _pct(price, s200) if s200 else None
    out["pct_vs_ema20"] = _pct(price, e20) if e20 else None
    out["above_50sma"] = (price > s50) if s50 else None
    # MA stack: full-bull = price>s20>s50>s200
    if s20 and s50 and s200:
        if price > s20 > s50 > s200:
            out["ma_stack"] = "full-bull"
        elif price < s20 < s50 < s200:
            out["ma_stack"] = "bear"
        else:
            out["ma_stack"] = "partial"
    # ADR% (avg daily range over last 21), ATR%
    window = bars[-21:] if len(bars) >= 21 else bars
    if window:
        adr = sum((b["h"] - b["l"]) / b["c"] for b in window if b["c"]) / len(window)
        out["adr_pct"] = round(adr * 100, 2)
        out["atr_pct"] = out["adr_pct"]
    # Volume ratio: today vs 30-day avg
    vols = [b["v"] for b in bars if b.get("v")]
    if len(vols) >= 2:
        avg = sum(vols[-31:-1]) / max(len(vols[-31:-1]), 1)
        out["vol_ratio"] = round(vols[-1] / avg, 2) if avg else None
    # 52w high/low distance
    yr = bars[-252:] if len(bars) >= 252 else bars
    hi = max(b["h"] for b in yr); lo = min(b["l"] for b in yr)
    out["dist_52w_high_pct"] = _pct(price, hi)
    out["dist_52w_low_pct"] = _pct(price, lo)
    out["new_52w_high"] = price >= hi
    return out
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_screener_technicals.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add api/services/screener/technicals.py tests/test_screener_technicals.py
git commit -m "feat(screener): technical indicators from local bars"
```

### Task 4: Nightly snapshot builder

**Files:**
- Create: `api/services/screener/snapshot_builder.py`
- Test: `tests/test_screener_builder.py`

**Interfaces:**
- Consumes: `snapshot_db`, `candles`, `technicals`; the local bars reader and ratings DB (injected for tests).
- Produces:
  - `build_row(ticker, bars, ratings_row, fundamentals) -> dict` (pure; merges all field groups into one snapshot row).
  - `run_build(max_tickers: int | None = None) -> dict` (orchestrator: pick stalest tickers, read bars + ratings + fundamentals, upsert; returns `{built, skipped, errors}`).
- Reads helpers (resolve at impl, keep importable for monkeypatch):
  - bars: reuse the local daily-bars reader used by `ratings_universe` (find via `grep -rn "def .*bars" api/services/research/ratings_universe.py`); wrap as `_read_daily_bars(ticker) -> list[dict]`.
  - ratings: `from api.services.research import ratings_db` → per-ticker metrics + composite/rs_rank.
  - fundamentals: reuse `api/services/catalyst/ticker_metadata.py` (sector/market_cap/avg_vol) + `api/services/fundamentals.py` for pe/margins/etc., wrapped as `_read_fundamentals(ticker) -> dict` (best-effort, cached).

- [ ] **Step 1: Write failing test (pure `build_row`)**

```python
# tests/test_screener_builder.py
import importlib

def test_build_row_merges_all_groups(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    import api.services.screener.snapshot_builder as b
    importlib.reload(b)
    bars = [{"o": float(i), "h": i*1.01, "l": i*0.99, "c": float(i),
             "v": 1_000_000} for i in range(1, 260)]
    ratings = {"uct_composite": 95, "rs_rank": 92, "rs_return": 0.4,
               "accdis": 1.2, "pe_fwd": 30.0, "eps_growth": 0.5,
               "op_margin": 0.4, "roe": 0.3}
    funda = {"company": "NVIDIA", "sector": "Technology", "industry": "Semis",
             "market_cap": 4.5e12, "avg_volume_30d": 2e8, "pe_ttm": 41.0,
             "dividend_yield": 0.0, "beta": 1.6}
    row = b.build_row("NVDA", bars, ratings, funda)
    assert row["ticker"] == "NVDA"
    assert row["company"] == "NVIDIA"
    assert row["uct_composite"] == 95
    assert row["pe_fwd"] == 30.0
    assert row["above_50sma"] is True
    assert row["candle_type"] is not None
    assert row["ma_stack"] == "full-bull"
    assert "snapshot_date" in row and "built_at" in row

def test_build_row_survives_empty_bars():
    import api.services.screener.snapshot_builder as b
    row = b.build_row("AAA", [], {}, {"company": "A"})
    assert row["ticker"] == "AAA"
    assert row["price"] is None
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_screener_builder.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `snapshot_builder.py`**

```python
# api/services/screener/snapshot_builder.py
import time, datetime, logging
from . import snapshot_db, candles, technicals

log = logging.getLogger(__name__)

# --- field mapping from ratings DB row -> snapshot columns ---
_RATINGS_MAP = {
    "uct_composite": "uct_composite", "rs_rank": "rs_rank",
    "rs_return": "rs_return", "accdis": "accdis", "pe_fwd": "pe_fwd",
    "peg": "peg", "eps_growth": "eps_growth", "rev_growth": "rev_growth",
    "op_margin": "op_margin", "roe": "roe", "inst_pct": "inst_pct",
}
_FUNDA_KEYS = ("company", "sector", "industry", "exchange", "market_cap",
               "avg_volume_30d", "dividend_yield", "pe_ttm", "ps", "pb",
               "gross_margin", "net_margin", "roa", "debt_to_equity",
               "current_ratio", "beta")

def build_row(ticker, bars, ratings_row, fundamentals) -> dict:
    ticker = ticker.upper()
    row = {c: None for c in snapshot_db.COLUMNS}
    row["ticker"] = ticker
    f = fundamentals or {}
    for k in _FUNDA_KEYS:
        if f.get(k) is not None:
            row[k] = f[k]
    r = ratings_row or {}
    for src, dst in _RATINGS_MAP.items():
        if r.get(src) is not None:
            row[dst] = r[src]
    if bars:
        row.update(technicals.compute_technicals(bars))
        row.update(candles.single_candle(bars))
        row.update(candles.multi_candle(bars))
        last_t = bars[-1].get("t")
        row["bars_asof"] = str(last_t) if last_t is not None else None
    row["patterns"] = None          # filled in Phase 5
    row["pattern_conf_max"] = None
    row["snapshot_date"] = datetime.date.today().isoformat()
    row["built_at"] = int(time.time())
    return row

# --- orchestration (network/disk; thin, exercised via integration not unit) ---
def _read_daily_bars(ticker):
    # reuse research ratings' local-bars reader; resolve at implementation
    from api.services.research import ratings_universe as ru
    return ru.read_local_daily_bars(ticker)  # returns oldest->newest dicts

def _read_ratings(ticker):
    from api.services.research import ratings_db
    try:
        return ratings_db.get_ticker_metrics(ticker) or {}
    except Exception:
        return {}

def _read_fundamentals(ticker):
    out = {}
    try:
        from api.services.catalyst import ticker_metadata as tm
        meta = tm.get_metadata(ticker) or {}
        out.update({k: meta.get(k) for k in
                    ("sector", "market_cap", "avg_volume_30d")})
    except Exception:
        pass
    try:
        from api.services import fundamentals as fnd
        fd = fnd.get_fundamentals(ticker) or {}
        for k in ("company", "industry", "exchange", "pe_ttm", "ps", "pb",
                  "gross_margin", "net_margin", "roa", "debt_to_equity",
                  "current_ratio", "beta", "dividend_yield"):
            if fd.get(k) is not None:
                out[k] = fd[k]
    except Exception:
        pass
    return out

def _load_universe():
    import json, os
    for p in ("api/data/cap_universe.json",
              os.path.join(os.path.dirname(__file__), "..", "..", "data", "cap_universe.json")):
        if os.path.exists(p):
            with open(p) as fh:
                return json.load(fh)
    return []

def _stalest(tickers, limit):
    """Return up to `limit` tickers ordered by stalest built_at (NULL first)."""
    with snapshot_db.connect() as conn:
        rows = {r["ticker"]: r["built_at"] for r in
                conn.execute("SELECT ticker, built_at FROM screener_rows")}
    ordered = sorted(tickers, key=lambda t: (rows.get(t.upper()) is not None,
                                             rows.get(t.upper()) or 0))
    return ordered[:limit] if limit else ordered

def run_build(max_tickers=None) -> dict:
    import os
    snapshot_db.init_db()
    universe = _load_universe()
    cap = max_tickers or int(os.environ.get("SCREENER_SNAPSHOT_MAX_PER_RUN", "4000"))
    targets = _stalest(universe, cap)
    built = skipped = errors = 0
    batch = []
    for t in targets:
        try:
            bars = _read_daily_bars(t)
            if not bars:
                skipped += 1
                continue
            row = build_row(t, bars, _read_ratings(t), _read_fundamentals(t))
            batch.append(row)
            built += 1
            if len(batch) >= 200:
                snapshot_db.upsert_rows(batch); batch = []
        except Exception as e:
            errors += 1
            log.warning("[screener] build %s failed: %s", t, e)
    if batch:
        snapshot_db.upsert_rows(batch)
    log.info("[screener] build done built=%s skipped=%s errors=%s", built, skipped, errors)
    return {"built": built, "skipped": skipped, "errors": errors}
```

> Note: `read_local_daily_bars`, `ratings_db.get_ticker_metrics`, `fundamentals.get_fundamentals`, `ticker_metadata.get_metadata` are existing-codebase calls — verify exact names at implementation via grep and adjust the thin wrappers. `build_row` (the tested unit) takes them as plain args and is independent of those names.

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_screener_builder.py -v`
Expected: 2 passed.

- [ ] **Step 5: Verify wrapper names resolve**

Run: `grep -rn "def read_local_daily_bars\|def get_ticker_metrics\|def get_fundamentals\|def get_metadata" api/services/`
Expected: each exists; if a name differs, fix the wrapper in `snapshot_builder.py` (does not affect tests).

- [ ] **Step 6: Commit**

```bash
git add api/services/screener/snapshot_builder.py tests/test_screener_builder.py
git commit -m "feat(screener): nightly snapshot builder (build_row + run_build)"
```

### Task 5: Schedule the nightly build + status

**Files:**
- Modify: `api/main.py` (scheduler block, near the ratings/bars nightly jobs ~line 1700)
- Test: `tests/test_screener_schedule.py`

**Interfaces:**
- Produces: APScheduler job id `screener_snapshot_nightly` at 03:00 ET (after ratings 02:30). Gated `SCREENER_SNAPSHOT_ENABLED` (default "1"). Runs on worker pod if `WORKER_ENABLED`, else inline-capped on web.

- [ ] **Step 1: Write failing test**

```python
# tests/test_screener_schedule.py
import api.main as m

def test_screener_job_registered(monkeypatch):
    ids = []
    class FakeSched:
        def add_job(self, *a, **k): ids.append(k.get("id"))
    monkeypatch.setattr(m, "_scheduler", FakeSched(), raising=False)
    m._register_screener_jobs()  # extracted helper
    assert "screener_snapshot_nightly" in ids
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_screener_schedule.py -v`
Expected: FAIL (`_register_screener_jobs` missing).

- [ ] **Step 3: Implement the helper + call it**

Add near the other nightly jobs in `api/main.py`:

```python
def _register_screener_jobs():
    import os
    if os.environ.get("SCREENER_SNAPSHOT_ENABLED", "1") != "1":
        return
    from api.services.screener import snapshot_builder
    def _run():
        try:
            snapshot_builder.run_build()
        except Exception as e:
            logging.getLogger(__name__).warning("[screener] nightly build failed: %s", e)
    _scheduler.add_job(_run, trigger=CronTrigger(hour=3, minute=0),
                       id="screener_snapshot_nightly", max_instances=1,
                       replace_existing=True)
```

And in the scheduler-setup section (where other `_scheduler.add_job` run), add:

```python
        _register_screener_jobs()
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_screener_schedule.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/main.py tests/test_screener_schedule.py
git commit -m "feat(screener): schedule nightly snapshot build (03:00 ET)"
```

---

## Phase 2 — Query engine + filter registry + API

### Task 6: Filter registry + views

**Files:**
- Create: `api/services/screener/filters.py`
- Test: `tests/test_screener_filters.py`

**Interfaces:**
- Produces:
  - `FILTERS: dict[str, dict]` — `{key: {label, category, type, column, presets, allow_custom, unit}}`.
  - `VIEWS: dict[str, dict]` — `{key: {label, columns: [colKey…]}}`.
  - `meta() -> dict` → `{filters: [...], views: [...], categories: [...]}` (frontend-ready, NO raw column names exposed beyond view column keys which map to display).
  - `column_for(key) -> str | None`, `is_valid_op(key, op) -> bool`.
- Categories: `descriptive, fundamental, technical, single_candle, multi_candle, pattern`.

- [ ] **Step 1: Write failing test**

```python
# tests/test_screener_filters.py
from api.services.screener import filters

def test_every_filter_column_exists_in_schema():
    from api.services.screener import snapshot_db
    for key, f in filters.FILTERS.items():
        assert f["column"] in snapshot_db.COLUMNS, f"{key} -> {f['column']}"

def test_every_view_column_is_known():
    from api.services.screener import snapshot_db
    known = set(snapshot_db.COLUMNS)
    for vkey, v in filters.VIEWS.items():
        for c in v["columns"]:
            assert c in known, f"{vkey} -> {c}"

def test_meta_shape_hides_nothing_sensitive():
    m = filters.meta()
    assert {"filters", "views", "categories"} <= set(m)
    assert any(f["key"] == "sector" for f in m["filters"])

def test_op_validation():
    assert filters.is_valid_op("rsi14", "range")
    assert not filters.is_valid_op("rsi14", "in")
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_screener_filters.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `filters.py`**

```python
# api/services/screener/filters.py
# type: enum (presets w/ op 'eq'|'in'|'gte'|'lte'|'between'), range (numeric min/max),
#       bool (true/false). allow_custom only for range.

def _range(key, label, category, column, presets, unit=None):
    return key, {"label": label, "category": category, "type": "range",
                 "column": column, "presets": presets, "allow_custom": True,
                 "unit": unit}

def _enum(key, label, category, column, presets):
    return key, {"label": label, "category": category, "type": "enum",
                 "column": column, "presets": presets, "allow_custom": False,
                 "unit": None}

def _bool(key, label, category, column):
    return key, {"label": label, "category": category, "type": "bool",
                 "column": column, "presets": [
                     {"label": "Any"}, {"label": "Yes", "op": "eq", "value": 1},
                     {"label": "No", "op": "eq", "value": 0}],
                 "allow_custom": False, "unit": None}

FILTERS = dict([
    # descriptive
    _enum("sector", "Sector", "descriptive", "sector",
          [{"label": "Any"}]),  # options injected dynamically by meta()
    _range("market_cap", "Market Cap", "descriptive", "market_cap",
           [{"label": "Any"},
            {"label": "Mega (>$200B)", "op": "gte", "min": 2e11},
            {"label": "Large (>$10B)", "op": "gte", "min": 1e10},
            {"label": "Mid+ (>$2B)", "op": "gte", "min": 2e9},
            {"label": "Small+ (>$300M)", "op": "gte", "min": 3e8}], unit="$"),
    _range("price", "Price", "descriptive", "price",
           [{"label": "Any"},
            {"label": "Over $10", "op": "gte", "min": 10},
            {"label": "Over $50", "op": "gte", "min": 50},
            {"label": "Under $20", "op": "lte", "max": 20}], unit="$"),
    _range("dividend_yield", "Dividend Yield", "descriptive", "dividend_yield",
           [{"label": "Any"}, {"label": "Pays (>0%)", "op": "gte", "min": 0.0001},
            {"label": "Over 2%", "op": "gte", "min": 0.02}], unit="%"),
    # fundamental
    _range("pe_ttm", "P/E (TTM)", "fundamental", "pe_ttm",
           [{"label": "Any"}, {"label": "Under 15", "op": "lte", "max": 15},
            {"label": "Under 30", "op": "lte", "max": 30},
            {"label": "Over 50", "op": "gte", "min": 50}]),
    _range("peg", "PEG", "fundamental", "peg",
           [{"label": "Any"}, {"label": "Under 1", "op": "lte", "max": 1},
            {"label": "Under 2", "op": "lte", "max": 2}]),
    _range("eps_growth", "EPS Growth", "fundamental", "eps_growth",
           [{"label": "Any"}, {"label": "Over 25%", "op": "gte", "min": 0.25},
            {"label": "Over 50%", "op": "gte", "min": 0.50}], unit="%"),
    _range("rev_growth", "Revenue Growth", "fundamental", "rev_growth",
           [{"label": "Any"}, {"label": "Over 20%", "op": "gte", "min": 0.20}], unit="%"),
    _range("op_margin", "Operating Margin", "fundamental", "op_margin",
           [{"label": "Any"}, {"label": "Over 20%", "op": "gte", "min": 0.20}], unit="%"),
    _range("roe", "ROE", "fundamental", "roe",
           [{"label": "Any"}, {"label": "Over 15%", "op": "gte", "min": 0.15}], unit="%"),
    _range("debt_to_equity", "Debt/Equity", "fundamental", "debt_to_equity",
           [{"label": "Any"}, {"label": "Under 1", "op": "lte", "max": 1}]),
    # uct ratings (fundamental tab)
    _range("uct_composite", "UCT Composite", "fundamental", "uct_composite",
           [{"label": "Any"}, {"label": "Over 80", "op": "gte", "min": 80},
            {"label": "Over 90", "op": "gte", "min": 90}]),
    _range("rs_rank", "RS Rank", "technical", "rs_rank",
           [{"label": "Any"}, {"label": "Over 70", "op": "gte", "min": 70},
            {"label": "Over 80", "op": "gte", "min": 80},
            {"label": "Over 90", "op": "gte", "min": 90}]),
    # technical
    _bool("above_50sma", "Above 50 SMA", "technical", "above_50sma"),
    _enum("ma_stack", "MA Stack", "technical", "ma_stack",
          [{"label": "Any"},
           {"label": "Full bull", "op": "eq", "value": "full-bull"},
           {"label": "Partial", "op": "eq", "value": "partial"},
           {"label": "Bear", "op": "eq", "value": "bear"}]),
    _range("rsi14", "RSI (14)", "technical", "rsi14",
           [{"label": "Any"}, {"label": "Oversold (<30)", "op": "lte", "max": 30},
            {"label": "40–60", "op": "between", "min": 40, "max": 60},
            {"label": "Overbought (>70)", "op": "gte", "min": 70}]),
    _range("vol_ratio", "Volume Ratio", "technical", "vol_ratio",
           [{"label": "Any"}, {"label": "Over 1.5×", "op": "gte", "min": 1.5},
            {"label": "Over 2×", "op": "gte", "min": 2}], unit="×"),
    _range("adr_pct", "ADR %", "technical", "adr_pct",
           [{"label": "Any"}, {"label": "Over 4%", "op": "gte", "min": 4},
            {"label": "Over 8%", "op": "gte", "min": 8}], unit="%"),
    _range("gap_pct", "Gap %", "technical", "gap_pct",
           [{"label": "Any"}, {"label": "Up >3%", "op": "gte", "min": 3},
            {"label": "Down >3%", "op": "lte", "max": -3}], unit="%"),
    _range("dist_52w_high_pct", "Dist from 52W High", "technical", "dist_52w_high_pct",
           [{"label": "Any"}, {"label": "Within 5%", "op": "gte", "min": -5}], unit="%"),
    _bool("new_52w_high", "New 52W High", "technical", "new_52w_high"),
    _range("pct_vs_ema20", "EMA20 Distance", "technical", "pct_vs_ema20",
           [{"label": "Any"}, {"label": "Within 2%", "op": "between", "min": -2, "max": 2}], unit="%"),
    # single candle
    _enum("candle_type", "Candle Type", "single_candle", "candle_type",
          [{"label": "Any"},
           {"label": "Hammer", "op": "eq", "value": "hammer"},
           {"label": "Doji", "op": "eq", "value": "doji"},
           {"label": "Bullish Engulfing", "op": "eq", "value": "bullish-engulfing"},
           {"label": "Bearish Engulfing", "op": "eq", "value": "bearish-engulfing"},
           {"label": "Shooting Star", "op": "eq", "value": "shooting-star"},
           {"label": "Marubozu", "op": "eq", "value": "marubozu"}]),
    _bool("wide_bar", "Wide Bar (>1.5 ATR)", "single_candle", "wide_bar"),
    _bool("narrow_bar", "Narrow Bar (<0.5 ATR)", "single_candle", "narrow_bar"),
    _range("close_position", "Close Position in Range", "single_candle", "close_position",
           [{"label": "Any"}, {"label": "Top third (>0.66)", "op": "gte", "min": 0.66},
            {"label": "Bottom third (<0.33)", "op": "lte", "max": 0.33}]),
    # multi candle
    _bool("tight_consolidation", "Tight Consolidation", "multi_candle", "tight_consolidation"),
    _bool("nr7", "NR7 (narrowest of 7)", "multi_candle", "nr7"),
    _range("inside_bar_run", "Inside-Bar Run", "multi_candle", "inside_bar_run",
           [{"label": "Any"}, {"label": "2+", "op": "gte", "min": 2}]),
    _range("higher_lows_run", "Higher-Lows Run", "multi_candle", "higher_lows_run",
           [{"label": "Any"}, {"label": "3+", "op": "gte", "min": 3}]),
    _range("pullback_depth_pct", "Pullback Depth", "multi_candle", "pullback_depth_pct",
           [{"label": "Any"}, {"label": "Shallow (<10%)", "op": "lte", "max": 10},
            {"label": "Deep (>20%)", "op": "gte", "min": 20}], unit="%"),
    _range("consecutive_up", "Consecutive Up Days", "multi_candle", "consecutive_up",
           [{"label": "Any"}, {"label": "3+", "op": "gte", "min": 3}]),
    # pattern (column filled Phase 5; filter present now, matches via LIKE)
    _enum("pattern", "Chart Pattern", "pattern", "patterns",
          [{"label": "Any"},
           {"label": "VCP", "op": "contains", "value": "vcp"},
           {"label": "Flat Base", "op": "contains", "value": "flat_base"},
           {"label": "Bull Flag", "op": "contains", "value": "bull_flag"},
           {"label": "Cup w/ Handle", "op": "contains", "value": "cup_handle"},
           {"label": "52W Breakout", "op": "contains", "value": "breakout_52w"},
           {"label": "Golden Cross", "op": "contains", "value": "golden_cross"}]),
])

_VALID_OPS = {
    "range": {"gte", "lte", "between"},
    "enum": {"eq", "in", "contains"},
    "bool": {"eq"},
}

VIEWS = {
    "overview": {"label": "Overview", "columns": [
        "ticker", "company", "sector", "market_cap", "price", "chg_pct_1d",
        "vol_ratio", "rs_rank", "patterns"]},
    "valuation": {"label": "Valuation", "columns": [
        "ticker", "market_cap", "pe_ttm", "pe_fwd", "peg", "ps", "pb",
        "dividend_yield", "price"]},
    "financial": {"label": "Financial", "columns": [
        "ticker", "eps_growth", "rev_growth", "op_margin", "gross_margin",
        "net_margin", "roe", "roa", "debt_to_equity"]},
    "technical": {"label": "Technical", "columns": [
        "ticker", "rsi14", "pct_vs_sma50", "pct_vs_sma200", "adr_pct",
        "dist_52w_high_pct", "vol_ratio", "gap_pct", "pct_vs_ema20",
        "candle_type"]},
    "uct_ratings": {"label": "UCT Ratings", "columns": [
        "ticker", "uct_composite", "rs_rank", "rs_return", "accdis",
        "eps_growth", "op_margin", "roe"]},
    "charts": {"label": "Charts", "columns": [
        "ticker", "company", "chg_pct_1d", "price"]},
}

CATEGORIES = [
    {"key": "descriptive", "label": "Descriptive"},
    {"key": "fundamental", "label": "Fundamental"},
    {"key": "technical", "label": "Technical"},
    {"key": "single_candle", "label": "Single Candle"},
    {"key": "multi_candle", "label": "Multi-Candle"},
    {"key": "pattern", "label": "Patterns"},
]

def column_for(key):
    f = FILTERS.get(key)
    return f["column"] if f else None

def is_valid_op(key, op):
    f = FILTERS.get(key)
    if not f:
        return False
    return op in _VALID_OPS.get(f["type"], set())

def _sector_options():
    try:
        from api.services.screener import snapshot_db
        with snapshot_db.connect() as conn:
            rows = conn.execute(
                "SELECT DISTINCT sector FROM screener_rows "
                "WHERE sector IS NOT NULL ORDER BY sector").fetchall()
        opts = [{"label": "Any"}]
        opts += [{"label": r["sector"], "op": "eq", "value": r["sector"]} for r in rows]
        return opts
    except Exception:
        return [{"label": "Any"}]

def meta() -> dict:
    out_filters = []
    for key, f in FILTERS.items():
        presets = _sector_options() if key == "sector" else f["presets"]
        out_filters.append({"key": key, "label": f["label"],
                            "category": f["category"], "type": f["type"],
                            "presets": presets, "allow_custom": f["allow_custom"],
                            "unit": f["unit"]})
    return {"filters": out_filters,
            "views": [{"key": k, **v} for k, v in VIEWS.items()],
            "categories": CATEGORIES}
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_screener_filters.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add api/services/screener/filters.py tests/test_screener_filters.py
git commit -m "feat(screener): filter registry + result views + meta"
```

### Task 7: Query engine (filter spec → parametrized SQL)

**Files:**
- Create: `api/services/screener/query.py`
- Test: `tests/test_screener_query.py`

**Interfaces:**
- Consumes: `filters` registry + `snapshot_db`.
- Produces:
  - `build_where(filter_specs: list[dict]) -> tuple[str, list]` (SQL fragment + params; raises `ValueError` on unknown key/op).
  - `run_scan(spec: dict) -> dict` → `{total, rows, view, view_columns, snapshot_date, page, page_size}`.
- `spec` shape: `{filters:[{key,op,value|min|max|values}], sort:{key,dir}, view, page, page_size}`.

- [ ] **Step 1: Write failing test**

```python
# tests/test_screener_query.py
import importlib
from api.services.screener import query

def test_build_where_range_and_enum():
    sql, params = query.build_where([
        {"key": "rsi14", "op": "between", "min": 40, "max": 60},
        {"key": "sector", "op": "eq", "value": "Technology"},
        {"key": "above_50sma", "op": "eq", "value": 1},
    ])
    assert "rsi14 >= ?" in sql and "rsi14 <= ?" in sql
    assert "sector = ?" in sql
    assert params == [40, 60, "Technology", 1]

def test_build_where_rejects_unknown_key():
    import pytest
    with pytest.raises(ValueError):
        query.build_where([{"key": "drop_table", "op": "eq", "value": 1}])

def test_build_where_rejects_bad_op():
    import pytest
    with pytest.raises(ValueError):
        query.build_where([{"key": "rsi14", "op": "in", "values": [1]}])

def test_run_scan_filters_and_paginates(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    import api.services.screener.snapshot_db as db
    importlib.reload(db); db.init_db()
    db.upsert_rows([
        {"ticker": "AAA", "rsi14": 50, "sector": "Tech", "uct_composite": 90,
         "snapshot_date": "2026-06-19", "built_at": 1},
        {"ticker": "BBB", "rsi14": 80, "sector": "Tech", "uct_composite": 70,
         "snapshot_date": "2026-06-19", "built_at": 1},
    ])
    importlib.reload(query)
    res = query.run_scan({"filters": [{"key": "rsi14", "op": "lte", "max": 60}],
                          "view": "overview", "page": 1, "page_size": 10})
    assert res["total"] == 1
    assert res["rows"][0]["ticker"] == "AAA"
    assert "rsi14" not in res["view_columns"] or "ticker" in res["view_columns"]
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_screener_query.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `query.py`**

```python
# api/services/screener/query.py
from . import filters, snapshot_db

_SORTABLE = set(snapshot_db.COLUMNS)
_MAX_PAGE = 500

def build_where(filter_specs):
    clauses, params = [], []
    for f in filter_specs or []:
        key, op = f.get("key"), f.get("op")
        col = filters.column_for(key)
        if not col:
            raise ValueError(f"unknown filter key: {key}")
        if not filters.is_valid_op(key, op):
            raise ValueError(f"bad op {op} for {key}")
        if op == "gte":
            clauses.append(f"{col} >= ?"); params.append(f["min"])
        elif op == "lte":
            clauses.append(f"{col} <= ?"); params.append(f["max"])
        elif op == "between":
            clauses.append(f"{col} >= ?"); params.append(f["min"])
            clauses.append(f"{col} <= ?"); params.append(f["max"])
        elif op == "eq":
            clauses.append(f"{col} = ?"); params.append(f["value"])
        elif op == "in":
            vals = f.get("values") or []
            if vals:
                clauses.append(f"{col} IN ({','.join('?' for _ in vals)})")
                params.extend(vals)
        elif op == "contains":
            clauses.append(f"{col} LIKE ?"); params.append(f"%{f['value']}%")
        else:
            raise ValueError(f"unhandled op {op}")
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    return where, params

def run_scan(spec):
    spec = spec or {}
    where, params = build_where(spec.get("filters"))
    view_key = spec.get("view") or "overview"
    view = filters.VIEWS.get(view_key, filters.VIEWS["overview"])
    view_cols = view["columns"]
    sort = spec.get("sort") or {}
    sort_key = sort.get("key") if sort.get("key") in _SORTABLE else "uct_composite"
    sort_dir = "ASC" if (sort.get("dir") == "asc") else "DESC"
    page = max(int(spec.get("page", 1)), 1)
    page_size = min(max(int(spec.get("page_size", 50)), 1), _MAX_PAGE)
    offset = (page - 1) * page_size

    with snapshot_db.connect() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM screener_rows{where}", params).fetchone()[0]
        # always select all columns so view-switching client-side is free,
        # but tell client which to show.
        rows = conn.execute(
            f"SELECT * FROM screener_rows{where} "
            f"ORDER BY {sort_key} {sort_dir} NULLS LAST "
            f"LIMIT ? OFFSET ?", [*params, page_size, offset]).fetchall()
        snap = conn.execute(
            "SELECT MAX(snapshot_date) d FROM screener_rows").fetchone()["d"]
    return {"total": total, "rows": [dict(r) for r in rows], "view": view_key,
            "view_columns": view_cols, "snapshot_date": snap,
            "page": page, "page_size": page_size}
```

> SQLite supports `NULLS LAST` from 3.30+. If the bundled SQLite is older, replace the ORDER BY with `ORDER BY ({sort_key} IS NULL), {sort_key} {sort_dir}`. Verify with `python -c "import sqlite3;print(sqlite3.sqlite_version)"`.

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_screener_query.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add api/services/screener/query.py tests/test_screener_query.py
git commit -m "feat(screener): query engine (filter spec -> parametrized SQL)"
```

### Task 8: Saved screens service

**Files:**
- Create: `api/services/screener/saved_screens.py`
- Test: `tests/test_screener_saved.py`

**Interfaces:**
- Produces (table `screener_saved_screens` in the auth DB — reuse `api/services/auth_db.py` connection so it lives with user data):
  - `init() -> None`, `create(user_id, name, spec, is_public=False) -> dict`,
    `list_for(user_id) -> list[dict]`, `get(screen_id, user_id) -> dict | None`,
    `update(screen_id, user_id, **fields) -> dict | None`,
    `delete(screen_id, user_id) -> bool`, `get_public(share_token) -> dict | None`,
    `starters() -> list[dict]` (built-in read-only screens).

- [ ] **Step 1: Write failing test**

```python
# tests/test_screener_saved.py
import importlib

def _svc(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    import api.services.auth_db as adb; importlib.reload(adb); adb.init_db()
    import api.services.screener.saved_screens as ss; importlib.reload(ss); ss.init()
    return ss

def test_create_list_get_delete(tmp_path, monkeypatch):
    ss = _svc(tmp_path, monkeypatch)
    spec = {"filters": [{"key": "rsi14", "op": "lte", "max": 30}], "view": "overview"}
    rec = ss.create(user_id=7, name="Oversold", spec=spec)
    assert rec["id"] and rec["name"] == "Oversold"
    assert ss.list_for(7)[0]["name"] == "Oversold"
    assert ss.get(rec["id"], 7)["spec"]["view"] == "overview"
    assert ss.get(rec["id"], 999) is None       # not owner
    assert ss.delete(rec["id"], 7) is True

def test_starters_present(tmp_path, monkeypatch):
    ss = _svc(tmp_path, monkeypatch)
    assert len(ss.starters()) >= 3
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_screener_saved.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `saved_screens.py`**

```python
# api/services/screener/saved_screens.py
import json, time, secrets
from api.services import auth_db

def _conn():
    return auth_db.get_connection()  # verify helper name; else sqlite3.connect(auth_db path)

def init():
    with _conn() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS screener_saved_screens (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
            name TEXT NOT NULL, spec_json TEXT NOT NULL, is_public INTEGER DEFAULT 0,
            share_token TEXT, created_at INTEGER, updated_at INTEGER)""")
        c.commit()

def _row(r):
    return {"id": r["id"], "name": r["name"], "spec": json.loads(r["spec_json"]),
            "is_public": bool(r["is_public"]), "share_token": r["share_token"],
            "created_at": r["created_at"], "updated_at": r["updated_at"]}

def create(user_id, name, spec, is_public=False):
    now = int(time.time())
    tok = secrets.token_urlsafe(8) if is_public else None
    with _conn() as c:
        cur = c.execute(
            "INSERT INTO screener_saved_screens "
            "(user_id,name,spec_json,is_public,share_token,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (user_id, name, json.dumps(spec), 1 if is_public else 0, tok, now, now))
        c.commit()
        return get(cur.lastrowid, user_id)

def list_for(user_id):
    with _conn() as c:
        rows = c.execute("SELECT * FROM screener_saved_screens WHERE user_id=? "
                         "ORDER BY updated_at DESC", (user_id,)).fetchall()
    return [_row(r) for r in rows]

def get(screen_id, user_id):
    with _conn() as c:
        r = c.execute("SELECT * FROM screener_saved_screens WHERE id=? AND user_id=?",
                      (screen_id, user_id)).fetchone()
    return _row(r) if r else None

def update(screen_id, user_id, **fields):
    cur = get(screen_id, user_id)
    if not cur:
        return None
    name = fields.get("name", cur["name"])
    spec = fields.get("spec", cur["spec"])
    is_public = fields.get("is_public", cur["is_public"])
    tok = cur["share_token"] or (secrets.token_urlsafe(8) if is_public else None)
    with _conn() as c:
        c.execute("UPDATE screener_saved_screens SET name=?,spec_json=?,is_public=?,"
                  "share_token=?,updated_at=? WHERE id=? AND user_id=?",
                  (name, json.dumps(spec), 1 if is_public else 0, tok,
                   int(time.time()), screen_id, user_id))
        c.commit()
    return get(screen_id, user_id)

def delete(screen_id, user_id):
    with _conn() as c:
        cur = c.execute("DELETE FROM screener_saved_screens WHERE id=? AND user_id=?",
                        (screen_id, user_id))
        c.commit()
        return cur.rowcount > 0

def get_public(share_token):
    with _conn() as c:
        r = c.execute("SELECT * FROM screener_saved_screens WHERE share_token=? "
                      "AND is_public=1", (share_token,)).fetchone()
    return _row(r) if r else None

def starters():
    return [
        {"id": "starter_leaders_pullback", "name": "Leaders pulling back to 20EMA",
         "spec": {"filters": [
             {"key": "rs_rank", "op": "gte", "min": 80},
             {"key": "above_50sma", "op": "eq", "value": 1},
             {"key": "pct_vs_ema20", "op": "between", "min": -2, "max": 2}],
          "view": "technical", "sort": {"key": "rs_rank", "dir": "desc"}}},
        {"id": "starter_high_rs_bases", "name": "High-RS tight bases",
         "spec": {"filters": [
             {"key": "rs_rank", "op": "gte", "min": 80},
             {"key": "tight_consolidation", "op": "eq", "value": 1}],
          "view": "overview", "sort": {"key": "uct_composite", "dir": "desc"}}},
        {"id": "starter_earnings_gappers", "name": "Gappers holding gains",
         "spec": {"filters": [
             {"key": "gap_pct", "op": "gte", "min": 3},
             {"key": "above_50sma", "op": "eq", "value": 1}],
          "view": "overview", "sort": {"key": "gap_pct", "dir": "desc"}}},
        {"id": "starter_value_quality", "name": "Cheap quality compounders",
         "spec": {"filters": [
             {"key": "pe_ttm", "op": "lte", "max": 20},
             {"key": "roe", "op": "gte", "min": 0.15},
             {"key": "eps_growth", "op": "gte", "min": 0.15}],
          "view": "valuation", "sort": {"key": "uct_composite", "dir": "desc"}}},
    ]
```

> Verify `auth_db.get_connection` (or equivalent) name + that `auth_db` migrations list can include this CREATE; if the project registers tables in `auth_db.init_db()`, call `init()` from there instead and drop the standalone CREATE timing concern.

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_screener_saved.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add api/services/screener/saved_screens.py tests/test_screener_saved.py
git commit -m "feat(screener): saved screens service + starter presets"
```

### Task 9: API endpoints

**Files:**
- Modify: `api/routers/screener.py`
- Test: `tests/test_screener_api.py`

**Interfaces:**
- Adds routes (auth required via the project's `get_current_user` dependency — match how other paid routers import it):
  - `GET  /api/screener/meta`
  - `POST /api/screener/scan` (body = spec)
  - `GET  /api/screener/snapshot-status`
  - `GET  /api/screener/saved-screens`, `POST /api/screener/saved-screens`,
    `PUT /api/screener/saved-screens/{id}`, `DELETE /api/screener/saved-screens/{id}`
  - `GET  /api/screener/shared/{share_token}` (public read)

- [ ] **Step 1: Write failing test**

```python
# tests/test_screener_api.py
from fastapi.testclient import TestClient
import importlib, api.main as m

def test_meta_and_scan_smoke(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    import api.services.screener.snapshot_db as db; importlib.reload(db); db.init_db()
    db.upsert_rows([{"ticker": "AAA", "rsi14": 25, "uct_composite": 80,
                     "snapshot_date": "2026-06-19", "built_at": 1}])
    importlib.reload(m)
    client = TestClient(m.app)
    # NOTE: if endpoints are auth-gated, this test uses the project's existing
    # auth-bypass/test-login fixture (see tests/conftest.py). Mirror an existing
    # paid-router test's auth setup.
    r = client.get("/api/screener/meta")
    assert r.status_code in (200, 401)  # 200 once auth fixture applied
```

> Before implementing, open an existing auth-gated router test (e.g. `tests/test_voice_router.py`) and copy its auth fixture so the scan/meta tests assert 200 with a logged-in client. Replace the `in (200,401)` shim with a real `== 200` + body assertions once wired.

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_screener_api.py -v`
Expected: FAIL (routes 404).

- [ ] **Step 3: Implement endpoints in `api/routers/screener.py`**

```python
# add to api/routers/screener.py
from fastapi import Body, Depends
from pydantic import BaseModel
from api.services.screener import query as scr_query, filters as scr_filters, \
    snapshot_db as scr_db, saved_screens as scr_saved
# match the project's auth dependency import used by other paid routers:
from api.routers._deps import get_current_user  # VERIFY actual path

class ScanSpec(BaseModel):
    filters: list[dict] = []
    sort: dict | None = None
    view: str = "overview"
    page: int = 1
    page_size: int = 50

@router.get("/api/screener/meta")
def screener_meta(user=Depends(get_current_user)):
    return scr_filters.meta()

@router.post("/api/screener/scan")
def screener_scan(spec: ScanSpec, user=Depends(get_current_user)):
    try:
        return scr_query.run_scan(spec.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/api/screener/snapshot-status")
def screener_snapshot_status(user=Depends(get_current_user)):
    return scr_db.status()

@router.get("/api/screener/saved-screens")
def screener_saved_list(user=Depends(get_current_user)):
    scr_saved.init()
    return {"saved": scr_saved.list_for(user["id"]), "starters": scr_saved.starters()}

@router.post("/api/screener/saved-screens")
def screener_saved_create(payload: dict = Body(...), user=Depends(get_current_user)):
    scr_saved.init()
    return scr_saved.create(user["id"], payload["name"], payload["spec"],
                            bool(payload.get("is_public")))

@router.put("/api/screener/saved-screens/{sid}")
def screener_saved_update(sid: int, payload: dict = Body(...), user=Depends(get_current_user)):
    rec = scr_saved.update(sid, user["id"], **payload)
    if not rec:
        raise HTTPException(status_code=404, detail="not found")
    return rec

@router.delete("/api/screener/saved-screens/{sid}")
def screener_saved_delete(sid: int, user=Depends(get_current_user)):
    return {"deleted": scr_saved.delete(sid, user["id"])}

@router.get("/api/screener/shared/{share_token}")
def screener_shared(share_token: str):
    rec = scr_saved.get_public(share_token)
    if not rec:
        raise HTTPException(status_code=404, detail="not found")
    return rec
```

> `get_current_user` import path + the `user["id"]` access pattern must match the existing codebase (check another paid router, e.g. `api/routers/watchlists.py`). Adjust import + user-id access accordingly.

- [ ] **Step 4: Run to verify pass (with real auth fixture)**

Run: `pytest tests/test_screener_api.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/routers/screener.py tests/test_screener_api.py
git commit -m "feat(screener): scan/meta/status/saved-screens API"
```

### Task 10: Backend integration smoke (one real ticker end-to-end)

**Files:**
- Test: `tests/test_screener_integration.py` (marked slow; network-tolerant)

- [ ] **Step 1: Write the integration test**

```python
# tests/test_screener_integration.py
import importlib, pytest

@pytest.mark.slow
def test_build_one_ticker_then_scan(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    import api.services.screener.snapshot_builder as b; importlib.reload(b)
    # build just NVDA via the real readers (skips gracefully if bars unavailable)
    try:
        bars = b._read_daily_bars("NVDA")
    except Exception:
        pytest.skip("local bars unavailable in this env")
    if not bars:
        pytest.skip("no bars for NVDA")
    row = b.build_row("NVDA", bars, b._read_ratings("NVDA"), b._read_fundamentals("NVDA"))
    import api.services.screener.snapshot_db as db; importlib.reload(db); db.init_db()
    db.upsert_rows([row])
    import api.services.screener.query as q; importlib.reload(q)
    res = q.run_scan({"filters": [{"key": "price", "op": "gte", "min": 1}],
                      "view": "technical"})
    assert res["total"] == 1
    assert res["rows"][0]["ticker"] == "NVDA"
```

- [ ] **Step 2: Run**

Run: `pytest tests/test_screener_integration.py -v -m slow`
Expected: PASS or SKIP (never error). Fix wrapper names if it errors.

- [ ] **Step 3: Commit**

```bash
git add tests/test_screener_integration.py
git commit -m "test(screener): end-to-end build+scan integration smoke"
```

---

## Phase 3 — Frontend core (page, filters, results)

New package `app/src/pages/screener/`. Follow `CustomScan.jsx` patterns for live prices, flagging, prefetch, grouping, mobile sheet.

### Task 11: Data hooks

**Files:**
- Create: `app/src/pages/screener/hooks/useScreenerMeta.js`
- Create: `app/src/pages/screener/hooks/useScreenerScan.js`
- Create: `app/src/pages/screener/hooks/useSavedScreens.js`
- Test: `app/src/pages/screener/hooks/useScreenerScan.test.jsx`

**Interfaces:**
- `useScreenerMeta()` → `{ meta, isLoading }` (SWR GET `/api/screener/meta`, dedupe long).
- `useScreenerScan(spec)` → `{ result, isLoading, error }` (debounced POST `/api/screener/scan`; `spec` is the filter/sort/view object; null spec → no fetch).
- `useSavedScreens()` → `{ saved, starters, create, update, remove, refresh }`.

- [ ] **Step 1: Write failing test**

```jsx
// useScreenerScan.test.jsx
import { renderHook, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import useScreenerScan from './useScreenerScan'

global.fetch = vi.fn(() => Promise.resolve({
  ok: true, json: () => Promise.resolve({ total: 1, rows: [{ ticker: 'AAA' }],
    view_columns: ['ticker'], snapshot_date: '2026-06-19' }) }))

test('posts spec and returns result', async () => {
  const { result } = renderHook(() => useScreenerScan({ filters: [], view: 'overview' }))
  await waitFor(() => expect(result.current.result?.total).toBe(1))
  expect(global.fetch).toHaveBeenCalledWith('/api/screener/scan', expect.objectContaining({ method: 'POST' }))
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd app && npx vitest run src/pages/screener/hooks/useScreenerScan.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement the three hooks**

```js
// app/src/pages/screener/hooks/useScreenerMeta.js
import useSWR from 'swr'
const fetcher = url => fetch(url).then(r => r.json())
export default function useScreenerMeta() {
  const { data, isLoading } = useSWR('/api/screener/meta', fetcher,
    { revalidateOnFocus: false, dedupingInterval: 6 * 3600 * 1000 })
  return { meta: data, isLoading }
}
```

```js
// app/src/pages/screener/hooks/useScreenerScan.js
import { useEffect, useRef, useState } from 'react'
export default function useScreenerScan(spec, { debounce = 300 } = {}) {
  const [result, setResult] = useState(null)
  const [isLoading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const timer = useRef()
  const key = JSON.stringify(spec)
  useEffect(() => {
    if (!spec) return
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setLoading(true); setError(null)
      try {
        const r = await fetch('/api/screener/scan', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(spec) })
        if (!r.ok) throw new Error(`scan ${r.status}`)
        setResult(await r.json())
      } catch (e) { setError(e) } finally { setLoading(false) }
    }, debounce)
    return () => clearTimeout(timer.current)
  }, [key])  // eslint-disable-line
  return { result, isLoading, error }
}
```

```js
// app/src/pages/screener/hooks/useSavedScreens.js
import useSWR from 'swr'
const fetcher = url => fetch(url).then(r => r.json())
export default function useSavedScreens() {
  const { data, mutate } = useSWR('/api/screener/saved-screens', fetcher)
  const create = async (name, spec, is_public = false) => {
    await fetch('/api/screener/saved-screens', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, spec, is_public }) })
    mutate()
  }
  const update = async (id, fields) => {
    await fetch(`/api/screener/saved-screens/${id}`, { method: 'PUT',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) })
    mutate()
  }
  const remove = async id => {
    await fetch(`/api/screener/saved-screens/${id}`, { method: 'DELETE' }); mutate()
  }
  return { saved: data?.saved ?? [], starters: data?.starters ?? [],
           create, update, remove, refresh: mutate }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/pages/screener/hooks/useScreenerScan.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/screener/hooks
git commit -m "feat(screener): data hooks (meta, scan, saved screens)"
```

### Task 12: FilterPanel component

**Files:**
- Create: `app/src/pages/screener/FilterPanel.jsx`
- Create: `app/src/pages/screener/ScannerPro.module.css` (shared styles; start here)
- Test: `app/src/pages/screener/FilterPanel.test.jsx`

**Interfaces:**
- Consumes: `useScreenerMeta` output.
- Props: `{ meta, activeFilters, onChange(key, specOrNull), activeTab, setActiveTab }`.
- `activeFilters` shape: `{ [key]: {op, value|min|max} }`. Renders category tabs (with per-tab active-count badges), a grid of preset `<select>`s; numeric filters with `allow_custom` show a "Custom…" option that reveals min/max number inputs. Selecting a non-"Any" preset calls `onChange(key, {op, value|min|max})`; "Any" calls `onChange(key, null)`.

- [ ] **Step 1: Write failing test**

```jsx
// FilterPanel.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import FilterPanel from './FilterPanel'

const meta = { categories: [{ key: 'technical', label: 'Technical' }],
  filters: [{ key: 'rsi14', label: 'RSI (14)', category: 'technical', type: 'range',
    allow_custom: true, unit: '', presets: [{ label: 'Any' },
      { label: 'Oversold (<30)', op: 'lte', max: 30 }] }] }

test('selecting a preset emits a spec', () => {
  const onChange = vi.fn()
  render(<FilterPanel meta={meta} activeFilters={{}} onChange={onChange}
    activeTab="technical" setActiveTab={() => {}} />)
  fireEvent.change(screen.getByLabelText('RSI (14)'),
    { target: { value: 'Oversold (<30)' } })
  expect(onChange).toHaveBeenCalledWith('rsi14', { op: 'lte', max: 30 })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd app && npx vitest run src/pages/screener/FilterPanel.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement `FilterPanel.jsx`** (concrete; wire custom-range reveal)

```jsx
// app/src/pages/screener/FilterPanel.jsx
import { useState } from 'react'
import styles from './ScannerPro.module.css'

export default function FilterPanel({ meta, activeFilters, onChange, activeTab, setActiveTab }) {
  const [customOpen, setCustomOpen] = useState({})
  if (!meta) return null
  const cats = [...meta.categories, { key: 'all', label: 'All' }]
  const visible = activeTab === 'all'
    ? meta.filters : meta.filters.filter(f => f.category === activeTab)

  const countFor = catKey => meta.filters.filter(f =>
    (catKey === 'all' || f.category === catKey) && activeFilters[f.key]).length

  const handleSelect = (f, label) => {
    if (label === 'Custom…') { setCustomOpen(s => ({ ...s, [f.key]: true })); return }
    setCustomOpen(s => ({ ...s, [f.key]: false }))
    const p = f.presets.find(o => o.label === label)
    if (!p || label === 'Any') { onChange(f.key, null); return }
    const { op, value, min, max } = p
    const spec = { op }
    if (value !== undefined) spec.value = value
    if (min !== undefined) spec.min = min
    if (max !== undefined) spec.max = max
    onChange(f.key, spec)
  }

  const applyCustom = (f, minV, maxV) => {
    const hasMin = minV !== '' && minV != null
    const hasMax = maxV !== '' && maxV != null
    if (!hasMin && !hasMax) { onChange(f.key, null); return }
    if (hasMin && hasMax) onChange(f.key, { op: 'between', min: +minV, max: +maxV })
    else if (hasMin) onChange(f.key, { op: 'gte', min: +minV })
    else onChange(f.key, { op: 'lte', max: +maxV })
  }

  const currentLabel = f => {
    if (customOpen[f.key]) return 'Custom…'
    const af = activeFilters[f.key]
    if (!af) return 'Any'
    const match = f.presets.find(o =>
      o.op === af.op && o.value === af.value && o.min === af.min && o.max === af.max)
    return match ? match.label : 'Custom…'
  }

  return (
    <div className={styles.filterPanel}>
      <div className={styles.catTabs}>
        {cats.map(c => (
          <button key={c.key}
            className={`${styles.catTab} ${activeTab === c.key ? styles.catTabOn : ''}`}
            onClick={() => setActiveTab(c.key)}>
            {c.label}{countFor(c.key) > 0 && <span className={styles.catBadge}>{countFor(c.key)}</span>}
          </button>
        ))}
      </div>
      <div className={styles.filterGrid}>
        {visible.map(f => {
          const options = [...f.presets.map(p => p.label)]
          if (f.allow_custom && !options.includes('Custom…')) options.push('Custom…')
          const af = activeFilters[f.key]
          return (
            <div key={f.key} className={styles.filterCell}>
              <label className={styles.filterLabel} htmlFor={`f_${f.key}`}>{f.label}</label>
              <select id={`f_${f.key}`} aria-label={f.label}
                className={`${styles.filterSelect} ${af ? styles.filterSelectActive : ''}`}
                value={currentLabel(f)} onChange={e => handleSelect(f, e.target.value)}>
                {options.map(o => <option key={o}>{o}</option>)}
              </select>
              {customOpen[f.key] && (
                <div className={styles.customRange}>
                  <input type="number" placeholder="min" defaultValue={af?.min ?? ''}
                    onBlur={e => applyCustom(f, e.target.value,
                      document.getElementById(`max_${f.key}`)?.value)} />
                  <input id={`max_${f.key}`} type="number" placeholder="max"
                    defaultValue={af?.max ?? ''}
                    onBlur={e => applyCustom(f,
                      document.getElementById(`min_${f.key}`)?.value, e.target.value)} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

> Add minimal CSS classes (`filterPanel, catTabs, catTab, catTabOn, catBadge, filterGrid, filterCell, filterLabel, filterSelect, filterSelectActive, customRange`) to `ScannerPro.module.css`, mirroring the gold/dark tokens used in `CustomScan.module.css`. Copy variable usage from there.

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/pages/screener/FilterPanel.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/screener/FilterPanel.jsx app/src/pages/screener/ScannerPro.module.css app/src/pages/screener/FilterPanel.test.jsx
git commit -m "feat(screener): FilterPanel (category tabs + preset/custom controls)"
```

### Task 13: ResultsTable with swappable views

**Files:**
- Create: `app/src/pages/screener/ResultsTable.jsx`
- Create: `app/src/pages/screener/columnDefs.js` (label + formatter + heat fn per column)
- Test: `app/src/pages/screener/ResultsTable.test.jsx`

**Interfaces:**
- Props: `{ result, view, setView, views, sort, setSort, livePrices, onRowClick }`.
- `columnDefs.js` exports `COLUMN_DEFS: { [colKey]: {label, fmt(v,row), heat(v)} }`.
- Renders view tabs (from `views`), a sortable table of `result.view_columns`, heat-map shading via `heat`, live price/Chg overlay for `price`/`chg_pct_1d`, row click → `onRowClick(ticker)`.

- [ ] **Step 1: Write failing test**

```jsx
// ResultsTable.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import ResultsTable from './ResultsTable'

const views = [{ key: 'overview', label: 'Overview' }, { key: 'technical', label: 'Technical' }]
const result = { total: 1, view: 'overview',
  view_columns: ['ticker', 'company', 'price', 'chg_pct_1d'],
  rows: [{ ticker: 'AAA', company: 'Alpha', price: 10, chg_pct_1d: 2.5 }],
  snapshot_date: '2026-06-19' }

test('renders rows and swaps view', () => {
  const setView = vi.fn()
  render(<ResultsTable result={result} view="overview" setView={setView}
    views={views} sort={{}} setSort={() => {}} livePrices={{}} onRowClick={() => {}} />)
  expect(screen.getByText('AAA')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Technical'))
  expect(setView).toHaveBeenCalledWith('technical')
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd app && npx vitest run src/pages/screener/ResultsTable.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement `columnDefs.js` + `ResultsTable.jsx`**

```js
// app/src/pages/screener/columnDefs.js
const pct = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
const usd = v => v == null ? '—' : `$${v.toFixed(2)}`
const cap = v => v == null ? '—' : v >= 1e12 ? `$${(v/1e12).toFixed(1)}T`
  : v >= 1e9 ? `$${(v/1e9).toFixed(0)}B` : `$${(v/1e6).toFixed(0)}M`
const num = (d=1) => v => v == null ? '—' : v.toFixed(d)
const heatPos = v => v == null ? '' : v > 2 ? 'g' : v < -2 ? 'r' : ''
const heatRs = v => v == null ? '' : v >= 80 ? 'g' : v >= 60 ? 'g1' : ''

export const COLUMN_DEFS = {
  ticker: { label: 'Ticker', fmt: v => v },
  company: { label: 'Company', fmt: v => (v || '').slice(0, 24) },
  sector: { label: 'Sector', fmt: v => v || '—' },
  market_cap: { label: 'Mkt Cap', fmt: cap },
  price: { label: 'Price', fmt: usd },
  chg_pct_1d: { label: 'Chg%', fmt: pct, heat: heatPos },
  vol_ratio: { label: 'Vol×', fmt: v => v == null ? '—' : `${v.toFixed(1)}×` },
  rs_rank: { label: 'RS', fmt: num(0), heat: heatRs },
  uct_composite: { label: 'UCT', fmt: num(0), heat: heatRs },
  rs_return: { label: 'RS Ret', fmt: pct },
  accdis: { label: 'A/D', fmt: num(2) },
  pe_ttm: { label: 'P/E', fmt: num(1) }, pe_fwd: { label: 'Fwd P/E', fmt: num(1) },
  peg: { label: 'PEG', fmt: num(2) }, ps: { label: 'P/S', fmt: num(1) },
  pb: { label: 'P/B', fmt: num(1) }, dividend_yield: { label: 'Div', fmt: v => v==null?'—':`${(v*100).toFixed(1)}%` },
  eps_growth: { label: 'EPS Gr', fmt: v => v==null?'—':`${(v*100).toFixed(0)}%`, heat: v=>v>0?'g':'r' },
  rev_growth: { label: 'Rev Gr', fmt: v => v==null?'—':`${(v*100).toFixed(0)}%` },
  op_margin: { label: 'Op Mgn', fmt: v => v==null?'—':`${(v*100).toFixed(0)}%` },
  gross_margin: { label: 'Gr Mgn', fmt: v => v==null?'—':`${(v*100).toFixed(0)}%` },
  net_margin: { label: 'Net Mgn', fmt: v => v==null?'—':`${(v*100).toFixed(0)}%` },
  roe: { label: 'ROE', fmt: v => v==null?'—':`${(v*100).toFixed(0)}%` },
  roa: { label: 'ROA', fmt: v => v==null?'—':`${(v*100).toFixed(0)}%` },
  debt_to_equity: { label: 'D/E', fmt: num(2) },
  rsi14: { label: 'RSI', fmt: num(0) },
  pct_vs_sma50: { label: 'vs50', fmt: pct, heat: heatPos },
  pct_vs_sma200: { label: 'vs200', fmt: pct, heat: heatPos },
  pct_vs_ema20: { label: 'EMA20', fmt: pct },
  adr_pct: { label: 'ADR%', fmt: num(1) },
  gap_pct: { label: 'Gap%', fmt: pct, heat: heatPos },
  dist_52w_high_pct: { label: '52WH', fmt: pct },
  candle_type: { label: 'Candle', fmt: v => v && v !== 'none' ? v : '—' },
  patterns: { label: 'Pattern', fmt: v => v ? v.split(',')[0] : '—' },
}
```

```jsx
// app/src/pages/screener/ResultsTable.jsx
import styles from './ScannerPro.module.css'
import { COLUMN_DEFS } from './columnDefs'

export default function ResultsTable({ result, view, setView, views, sort, setSort, livePrices, onRowClick }) {
  if (!result) return null
  const cols = result.view_columns
  const toggleSort = key =>
    setSort(s => s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' })
  const arrow = key => sort?.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''

  const cellValue = (row, key) => {
    const lp = livePrices?.[row.ticker]
    if (key === 'price' && lp?.price != null) return lp.price
    if (key === 'chg_pct_1d' && lp?.change_pct != null) return lp.change_pct
    return row[key]
  }

  return (
    <div className={styles.resultsWrap}>
      <div className={styles.viewBar}>
        {views.map(v => (
          <button key={v.key}
            className={`${styles.viewTab} ${view === v.key ? styles.viewTabOn : ''}`}
            onClick={() => setView(v.key)}>{v.label}</button>
        ))}
        <span className={styles.resultMeta}>
          {result.total} results · snapshot {result.snapshot_date || '—'}
        </span>
      </div>
      <table className={styles.table}>
        <thead><tr>{cols.map(c => (
          <th key={c} className={styles.sortable} onClick={() => toggleSort(c)}>
            {(COLUMN_DEFS[c]?.label) || c}{arrow(c)}
          </th>))}</tr></thead>
        <tbody>
          {result.rows.map(row => (
            <tr key={row.ticker} className={styles.row} onClick={() => onRowClick(row.ticker)}>
              {cols.map(c => {
                const def = COLUMN_DEFS[c] || { fmt: v => v ?? '—' }
                const val = cellValue(row, c)
                const heat = def.heat ? def.heat(val) : ''
                const cls = c === 'ticker' ? styles.symCell
                  : heat === 'g' ? styles.heatG : heat === 'g1' ? styles.heatG1
                  : heat === 'r' ? styles.heatR : ''
                return <td key={c} className={cls}>{def.fmt(val, row)}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

> Add the referenced CSS classes (`resultsWrap, viewBar, viewTab, viewTabOn, resultMeta, table, sortable, row, symCell, heatG, heatG1, heatR`) to `ScannerPro.module.css`, reusing breadth heat-map tints (`bgG1`/`bgR1` analogues) and the gold sym color.

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/pages/screener/ResultsTable.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/screener/ResultsTable.jsx app/src/pages/screener/columnDefs.js app/src/pages/screener/ResultsTable.test.jsx app/src/pages/screener/ScannerPro.module.css
git commit -m "feat(screener): ResultsTable + column defs + swappable views"
```

### Task 14: ScannerPro orchestrator + wire into Screener tabs

**Files:**
- Create: `app/src/pages/screener/ScannerPro.jsx`
- Modify: `app/src/pages/Screener.jsx` (tabs: rename old Scanner → Candidate Board; add ScannerPro as default; remove `custom` tab)
- Test: `app/src/pages/screener/ScannerPro.test.jsx`

**Interfaces:**
- `ScannerPro({ embedded })` composes FilterPanel + ResultsTable; owns `activeFilters`, `view`, `sort`, `activeTab`; builds `spec` and feeds `useScreenerScan`; overlays `useRealtimePrices` on the current page tickers; row click → opens `TickerPopup` (reuse existing modal pattern). Sticky control bar with sort, ticker text search, Save Screen entry (Phase 4 wires the modal; here just a stub button).

- [ ] **Step 1: Write failing test**

```jsx
// ScannerPro.test.jsx
import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import ScannerPro from './ScannerPro'

vi.mock('./hooks/useScreenerMeta', () => ({ default: () => ({ meta: {
  categories: [{ key: 'technical', label: 'Technical' }],
  filters: [{ key: 'rsi14', label: 'RSI (14)', category: 'technical', type: 'range',
    allow_custom: true, presets: [{ label: 'Any' }] }],
  views: [{ key: 'overview', label: 'Overview', columns: ['ticker', 'price'] }] } }) }))
vi.mock('./hooks/useScreenerScan', () => ({ default: () => ({ result: {
  total: 1, view: 'overview', view_columns: ['ticker', 'price'],
  rows: [{ ticker: 'AAA', price: 10 }], snapshot_date: '2026-06-19' }, isLoading: false }) }))
vi.mock('../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))

test('renders filter panel and results', async () => {
  render(<ScannerPro />)
  await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument())
  expect(screen.getByText('RSI (14)')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd app && npx vitest run src/pages/screener/ScannerPro.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement `ScannerPro.jsx`**

```jsx
// app/src/pages/screener/ScannerPro.jsx
import { useMemo, useState, useEffect } from 'react'
import useRealtimePrices from '../../hooks/useRealtimePrices'
import TickerPopup from '../../components/TickerPopup'
import { prefetchBars } from '../../utils/prefetchBars'
import useScreenerMeta from './hooks/useScreenerMeta'
import useScreenerScan from './hooks/useScreenerScan'
import FilterPanel from './FilterPanel'
import ResultsTable from './ResultsTable'
import styles from './ScannerPro.module.css'

export default function ScannerPro({ embedded = false }) {
  const { meta } = useScreenerMeta()
  const [activeFilters, setActiveFilters] = useState({})
  const [activeTab, setActiveTab] = useState('technical')
  const [view, setView] = useState('overview')
  const [sort, setSort] = useState({ key: 'uct_composite', dir: 'desc' })
  const [popupSym, setPopupSym] = useState(null)
  const [showFilters, setShowFilters] = useState(true)

  const spec = useMemo(() => ({
    filters: Object.entries(activeFilters)
      .filter(([, v]) => v)
      .map(([key, v]) => ({ key, ...v })),
    sort, view, page: 1, page_size: 200,
  }), [activeFilters, sort, view])

  const { result, isLoading } = useScreenerScan(spec)

  const tickers = useMemo(() => (result?.rows ?? []).map(r => r.ticker), [result])
  const { prices } = useRealtimePrices(tickers)
  useEffect(() => { if (tickers.length) prefetchBars(tickers.slice(0, 30), 'D') }, [tickers])

  const onChange = (key, s) =>
    setActiveFilters(prev => { const n = { ...prev }; if (s) n[key] = s; else delete n[key]; return n })

  const views = meta?.views ?? []

  return (
    <div className={`${styles.wrap} ${embedded ? styles.embedded : ''}`}>
      <div className={styles.controlBar}>
        {!embedded && <h1 className={styles.heading}>Scanner</h1>}
        <button className={styles.filterToggle} onClick={() => setShowFilters(v => !v)}>
          Filters {Object.keys(activeFilters).length ? `· ${Object.keys(activeFilters).length}` : ''}
        </button>
        <button className={styles.resetBtn} onClick={() => setActiveFilters({})}>Reset</button>
        <span className={styles.statusLine}>{isLoading ? 'Scanning…' : `${result?.total ?? 0} matches`}</span>
      </div>
      {showFilters && (
        <FilterPanel meta={meta} activeFilters={activeFilters} onChange={onChange}
          activeTab={activeTab} setActiveTab={setActiveTab} />
      )}
      <ResultsTable result={result} view={view} setView={setView} views={views}
        sort={sort} setSort={setSort} livePrices={prices} onRowClick={setPopupSym} />
      {popupSym && <TickerPopup sym={popupSym} open onClose={() => setPopupSym(null)} />}
    </div>
  )
}
```

> `TickerPopup` invocation must match its real API (it may be a wrapper that opens on click rather than controlled by `open`/`onClose`). Check `app/src/components/TickerPopup.jsx` and adapt — if it renders children as the trigger, instead make table rows wrap the ticker in `<TickerPopup sym=…>`. Keep the click→chart behavior either way.

- [ ] **Step 4: Wire into `Screener.jsx`**

In `app/src/pages/Screener.jsx`: import `ScannerPro`; change `PAGE_TABS` to:

```jsx
const PAGE_TABS = [
  { key: 'scanner', label: 'Scanner' },          // NEW full-market ScannerPro
  { key: 'board',   label: 'Candidate Board' },   // the old 3-column board
  { key: 'live',    label: '⚡ Live Scan' },
]
```

Default `pageTab` stays `'scanner'`. Render `pageTab === 'scanner'` → `<ScannerPro embedded={embedded} />`; `pageTab === 'board'` → the existing 3-column board JSX (move today's `scanner`-branch markup under `'board'`); `pageTab === 'live'` → `<LiveScanTab .../>`. Remove the `custom` tab and the `CustomScan` import/branch.

- [ ] **Step 5: Run tests + build**

Run: `cd app && npx vitest run src/pages/screener/ScannerPro.test.jsx && npm run build`
Expected: test PASS, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/screener/ScannerPro.jsx app/src/pages/screener/ScannerPro.test.jsx app/src/pages/Screener.jsx
git commit -m "feat(screener): ScannerPro page + wire into Screener tabs (retire Custom Scan)"
```

---

## Phase 4 — Saved screens UI + CSV export + row actions

### Task 15: SaveScreenBar + starter/saved dropdown

**Files:**
- Create: `app/src/pages/screener/SaveScreenBar.jsx`
- Modify: `app/src/pages/screener/ScannerPro.jsx` (mount it; apply selected screen's spec)
- Test: `app/src/pages/screener/SaveScreenBar.test.jsx`

**Interfaces:**
- Props: `{ currentSpec, onApply(spec) }`. Uses `useSavedScreens`. Dropdown lists starters + saved; selecting applies its spec via `onApply`. "Save current…" prompts a name and calls `create`. Rename/delete on saved entries.

- [ ] **Step 1: Write failing test**

```jsx
// SaveScreenBar.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import SaveScreenBar from './SaveScreenBar'

vi.mock('./hooks/useSavedScreens', () => ({ default: () => ({
  saved: [], starters: [{ id: 's1', name: 'Oversold', spec: { view: 'overview' } }],
  create: vi.fn(), update: vi.fn(), remove: vi.fn() }) }))

test('applies a starter spec on select', () => {
  const onApply = vi.fn()
  render(<SaveScreenBar currentSpec={{}} onApply={onApply} />)
  fireEvent.change(screen.getByLabelText('Saved screens'), { target: { value: 's1' } })
  expect(onApply).toHaveBeenCalledWith({ view: 'overview' })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd app && npx vitest run src/pages/screener/SaveScreenBar.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement `SaveScreenBar.jsx`**

```jsx
// app/src/pages/screener/SaveScreenBar.jsx
import useSavedScreens from './hooks/useSavedScreens'
import styles from './ScannerPro.module.css'

export default function SaveScreenBar({ currentSpec, onApply }) {
  const { saved, starters, create, remove } = useSavedScreens()
  const all = [...starters, ...saved]
  const onSelect = id => {
    const s = all.find(x => String(x.id) === String(id))
    if (s) onApply(s.spec)
  }
  const onSave = async () => {
    const name = window.prompt('Name this screen:')
    if (name) await create(name, currentSpec)
  }
  return (
    <div className={styles.saveBar}>
      <select aria-label="Saved screens" className={styles.presetSelect}
        defaultValue="" onChange={e => onSelect(e.target.value)}>
        <option value="" disabled>Saved screens…</option>
        <optgroup label="Starters">
          {starters.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </optgroup>
        {saved.length > 0 && <optgroup label="My screens">
          {saved.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </optgroup>}
      </select>
      <button className={styles.saveBtn} onClick={onSave}>Save current…</button>
      {saved.length > 0 && (
        <button className={styles.linkBtn}
          onClick={() => { const id = window.prompt('Delete saved screen id:'); if (id) remove(id) }}>
          Manage
        </button>
      )}
    </div>
  )
}
```

> Mount `<SaveScreenBar currentSpec={spec} onApply={applySpec} />` in `ScannerPro` control bar. `applySpec` sets `view`, `sort`, and rebuilds `activeFilters` from `spec.filters` (`Object.fromEntries(spec.filters.map(({key,...r}) => [key, r]))`).

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/pages/screener/SaveScreenBar.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/screener/SaveScreenBar.jsx app/src/pages/screener/SaveScreenBar.test.jsx app/src/pages/screener/ScannerPro.jsx
git commit -m "feat(screener): saved/starter screens UI + apply"
```

### Task 16: CSV export + per-row TickerActions

**Files:**
- Modify: `app/src/pages/screener/ResultsTable.jsx` (CSV button + right-click `TickerActions`)
- Create: `app/src/pages/screener/exportCsv.js`
- Test: `app/src/pages/screener/exportCsv.test.js`

**Interfaces:**
- `toCsv(rows, columns, columnLabels) -> string`. Wire an "Export CSV" button in the view bar that builds a blob and triggers download. Wrap each row's ticker cell in the existing `TickerActions` (reuse `app/src/components/TickerActions.jsx`) for flag/tag/watchlist/alert.

- [ ] **Step 1: Write failing test**

```js
// exportCsv.test.js
import { toCsv } from './exportCsv'
test('builds csv with header and rows', () => {
  const csv = toCsv([{ ticker: 'AAA', price: 10 }], ['ticker', 'price'],
    { ticker: 'Ticker', price: 'Price' })
  expect(csv.split('\n')[0]).toBe('Ticker,Price')
  expect(csv.split('\n')[1]).toBe('AAA,10')
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd app && npx vitest run src/pages/screener/exportCsv.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `exportCsv.js` + wire button**

```js
// app/src/pages/screener/exportCsv.js
export function toCsv(rows, columns, labels = {}) {
  const esc = v => {
    if (v == null) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = columns.map(c => esc(labels[c] || c)).join(',')
  const body = rows.map(r => columns.map(c => esc(r[c])).join(',')).join('\n')
  return `${header}\n${body}`
}

export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
```

In `ResultsTable.jsx` view bar, add:

```jsx
<button className={styles.csvBtn} onClick={() => {
  const labels = Object.fromEntries(cols.map(c => [c, COLUMN_DEFS[c]?.label || c]))
  downloadCsv(`screen_${result.snapshot_date || 'export'}.csv`, toCsv(result.rows, cols, labels))
}}>Export CSV</button>
```

(import `{ toCsv, downloadCsv }`). Wrap the ticker `<td>` content in `<TickerActions sym={row.ticker}>…</TickerActions>` per its existing usage in `CustomScan`/`OptionsFlow`.

- [ ] **Step 4: Run tests + build**

Run: `cd app && npx vitest run src/pages/screener/exportCsv.test.js && npm run build`
Expected: PASS + build OK.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/screener/exportCsv.js app/src/pages/screener/exportCsv.test.js app/src/pages/screener/ResultsTable.jsx
git commit -m "feat(screener): CSV export + per-row ticker actions"
```

---

## Phase 5 — Patterns + Charts gallery

### Task 17: Cheap universe-wide patterns in builder + pattern filter

**Files:**
- Create: `api/services/screener/patterns.py`
- Modify: `api/services/screener/snapshot_builder.py` (call it; fill `patterns`, `pattern_conf_max`)
- Test: `tests/test_screener_patterns.py`

**Interfaces:**
- `detect_patterns(bars: list[dict]) -> tuple[str, float]` → comma-joined detector keys + max confidence (0-1). Cheap detectors: `breakout_52w`, `golden_cross`, `death_cross`, `flat_base`, `bull_flag`, `vcp` (contraction heuristic), `cup_handle` (approx). Reuse `pattern_engine` detectors where a single-series call is cheap; otherwise implement the heuristic inline.

- [ ] **Step 1: Write failing test**

```python
# tests/test_screener_patterns.py
from api.services.screener import patterns

def _s(closes):
    return [{"o": c, "h": c*1.01, "l": c*0.99, "c": c, "v": 1_000_000} for c in closes]

def test_breakout_52w_flagged():
    bars = _s([float(i) for i in range(1, 260)])  # makes a new high today
    keys, conf = patterns.detect_patterns(bars)
    assert "breakout_52w" in keys
    assert 0 <= conf <= 1

def test_golden_cross_flagged():
    # 200 flat then strong ramp so 50sma crosses above 200sma
    bars = _s([100.0]*210 + [100 + i for i in range(1, 60)])
    keys, _ = patterns.detect_patterns(bars)
    assert "golden_cross" in keys

def test_empty_bars_safe():
    assert patterns.detect_patterns([]) == ("", 0.0)
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_screener_patterns.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `patterns.py`**

```python
# api/services/screener/patterns.py
from .technicals import _sma

def detect_patterns(bars):
    if not bars or len(bars) < 30:
        return ("", 0.0)
    closes = [b["c"] for b in bars]
    price = closes[-1]
    found = {}

    yr = bars[-252:] if len(bars) >= 252 else bars
    hi = max(b["h"] for b in yr)
    if price >= hi:
        found["breakout_52w"] = 0.8

    s50, s200 = _sma(closes, 50), _sma(closes, 200)
    p50 = _sma(closes[:-1], 50); p200 = _sma(closes[:-1], 200)
    if s50 and s200 and p50 and p200:
        if p50 <= p200 and s50 > s200:
            found["golden_cross"] = 0.7
        if p50 >= p200 and s50 < s200:
            found["death_cross"] = 0.7

    # flat base: last 20 closes within a 8% band, near highs
    win = closes[-20:]
    if len(win) == 20:
        lo, hh = min(win), max(win)
        if hh and (hh - lo) / hh < 0.08 and price >= 0.95 * hh:
            found["flat_base"] = 0.6

    # VCP-ish: each of last 3 ~10-bar swings contracts in range
    if len(bars) >= 30:
        def rng(seg): return max(b["h"] for b in seg) - min(b["l"] for b in seg)
        a, b2, c = rng(bars[-30:-20]), rng(bars[-20:-10]), rng(bars[-10:])
        if a > b2 > c > 0:
            found["vcp"] = 0.6

    # bull flag: strong run then shallow pullback on lighter range
    if len(bars) >= 25:
        run = (closes[-10] - closes[-25]) / closes[-25] if closes[-25] else 0
        pull = (closes[-10] - price) / closes[-10] if closes[-10] else 0
        if run > 0.2 and 0 < pull < 0.1:
            found["bull_flag"] = 0.55

    if not found:
        return ("", 0.0)
    return (",".join(found.keys()), max(found.values()))
```

In `snapshot_builder.build_row`, after the candle/technical updates:

```python
    if bars:
        from . import patterns as scr_patterns
        keys, conf = scr_patterns.detect_patterns(bars)
        row["patterns"] = keys or None
        row["pattern_conf_max"] = conf or None
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_screener_patterns.py tests/test_screener_builder.py -v`
Expected: all pass (builder test still green; patterns now populated).

- [ ] **Step 5: Commit**

```bash
git add api/services/screener/patterns.py api/services/screener/snapshot_builder.py tests/test_screener_patterns.py
git commit -m "feat(screener): universe-wide cheap pattern detection in builder"
```

### Task 18: Charts gallery view

**Files:**
- Create: `app/src/pages/screener/ChartsGallery.jsx`
- Modify: `app/src/pages/screener/ScannerPro.jsx` (render gallery when `view === 'charts'`)
- Test: `app/src/pages/screener/ChartsGallery.test.jsx`

**Interfaces:**
- Props: `{ rows, livePrices, onRowClick }`. Renders a paged grid (e.g. 24/page) of mini `StockChart` (tf="D", `liveUpdates={false}`, compact). Windowed so we never mount hundreds at once.

- [ ] **Step 1: Write failing test**

```jsx
// ChartsGallery.test.jsx
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import ChartsGallery from './ChartsGallery'
vi.mock('../../components/StockChart', () => ({ default: ({ sym }) => <div>chart-{sym}</div> }))

test('renders a card per row (first page)', () => {
  render(<ChartsGallery rows={[{ ticker: 'AAA', chg_pct_1d: 1 }, { ticker: 'BBB', chg_pct_1d: -1 }]}
    livePrices={{}} onRowClick={() => {}} />)
  expect(screen.getByText('chart-AAA')).toBeInTheDocument()
  expect(screen.getByText('chart-BBB')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd app && npx vitest run src/pages/screener/ChartsGallery.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement `ChartsGallery.jsx`**

```jsx
// app/src/pages/screener/ChartsGallery.jsx
import { useState } from 'react'
import StockChart from '../../components/StockChart'
import styles from './ScannerPro.module.css'

const PAGE = 24

export default function ChartsGallery({ rows, livePrices, onRowClick }) {
  const [page, setPage] = useState(0)
  const slice = rows.slice(page * PAGE, page * PAGE + PAGE)
  const pages = Math.ceil(rows.length / PAGE)
  return (
    <div>
      <div className={styles.gallery}>
        {slice.map(r => {
          const lp = livePrices?.[r.ticker]
          const chg = lp?.change_pct ?? r.chg_pct_1d
          return (
            <div key={r.ticker} className={styles.galleryCard} onClick={() => onRowClick(r.ticker)}>
              <div className={styles.galleryHead}>
                <span className={styles.symCell}>{r.ticker}</span>
                <span className={chg >= 0 ? styles.heatG : styles.heatR}>
                  {chg == null ? '—' : `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%`}
                </span>
              </div>
              <div className={styles.galleryChart}>
                <StockChart sym={r.ticker} tf="D" liveUpdates={false} compact />
              </div>
            </div>
          )
        })}
      </div>
      {pages > 1 && (
        <div className={styles.galleryPager}>
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
          <span>{page + 1} / {pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>Next ›</button>
        </div>
      )}
    </div>
  )
}
```

In `ScannerPro.jsx`: when `view === 'charts'`, render `<ChartsGallery rows={result?.rows ?? []} livePrices={prices} onRowClick={setPopupSym} />` instead of `ResultsTable`'s body (keep the view bar for switching). `StockChart`'s `compact` prop may not exist — pass only props it supports (verify; minimally `sym` + `tf` + `liveUpdates`).

- [ ] **Step 4: Run tests + build**

Run: `cd app && npx vitest run src/pages/screener/ChartsGallery.test.jsx && npm run build`
Expected: PASS + build OK.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/screener/ChartsGallery.jsx app/src/pages/screener/ScannerPro.jsx app/src/pages/screener/ChartsGallery.test.jsx
git commit -m "feat(screener): charts gallery view (paged mini charts)"
```

---

## Phase 6 — Polish

### Task 19: Mobile filters sheet + empty/loading states + snapshot freshness

**Files:**
- Modify: `app/src/pages/screener/ScannerPro.jsx` (phone → `FiltersSheet`; empty/loading states; "snapshot as of" line; coverage note)
- Modify: `app/src/pages/screener/ScannerPro.module.css`
- Test: `app/src/pages/screener/ScannerPro.mobile.test.jsx`

**Interfaces:**
- On phone (`useIsPhone`), filters render inside `FiltersSheet` (reuse `components/mobile`); results become card-friendly. Empty state when `result.total === 0`. A line shows `snapshot_date` + a tooltip noting filters use the nightly snapshot and pattern coverage is tiered.

- [ ] **Step 1: Write failing test**

```jsx
// ScannerPro.mobile.test.jsx
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
vi.mock('../../hooks/useBreakpoint', () => ({ useIsPhone: () => true }))
vi.mock('./hooks/useScreenerMeta', () => ({ default: () => ({ meta: {
  categories: [], filters: [], views: [{ key: 'overview', label: 'Overview', columns: ['ticker'] }] } }) }))
vi.mock('./hooks/useScreenerScan', () => ({ default: () => ({ result: {
  total: 0, view: 'overview', view_columns: ['ticker'], rows: [], snapshot_date: '2026-06-19' }, isLoading: false }) }))
vi.mock('../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
import ScannerPro from './ScannerPro'

test('shows empty state on phone', () => {
  render(<ScannerPro />)
  expect(screen.getByText(/no stocks match/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd app && npx vitest run src/pages/screener/ScannerPro.mobile.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement** the empty state (`{result && result.total === 0 && <div className={styles.empty}>No stocks match the current filters</div>}`), loading skeleton, phone `FiltersSheet` branch (mirror `CustomScan.jsx` lines ~587-621), and the snapshot/coverage line. Keep `ResultsTable`/`ChartsGallery` hidden when empty.

- [ ] **Step 4: Run tests + build**

Run: `cd app && npx vitest run src/pages/screener && npm run build`
Expected: all screener tests PASS + build OK.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/screener tests
git commit -m "feat(screener): mobile sheet + empty/loading states + snapshot freshness"
```

### Task 20: Full-suite verification + warm snapshot + manual QA

**Files:** none (verification)

- [ ] **Step 1: Backend suite**

Run: `pytest tests/test_screener_*.py -v`
Expected: all pass (integration may SKIP).

- [ ] **Step 2: Frontend suite + build**

Run: `cd app && npx vitest run src/pages/screener && npm run build`
Expected: all pass + build OK.

- [ ] **Step 3: Warm a local snapshot + manual scan via curl** (admin/local backend)

```bash
# start local backend per CLAUDE.md mobile-audit recipe (worker off, bars prewarm off)
python -c "from api.services.screener import snapshot_builder as b; print(b.run_build(max_tickers=150))"
curl -s -X POST localhost:8077/api/screener/scan -H 'Content-Type: application/json' \
  -d '{"filters":[{"key":"above_50sma","op":"eq","value":1}],"view":"technical","page_size":10}' | head -c 600
```

Expected: JSON with `total`, `rows`, `view_columns`.

- [ ] **Step 4: Manual browser QA checklist**

Verify on `/screener` (Scanner tab): category tabs + count badges; preset + custom range; view switching changes columns; sort; heat-map; live price overlay; CSV export; save/apply a screen; charts gallery; row click → chart popup; Candidate Board + Live Scan tabs still work; mobile sheet.

- [ ] **Step 5: Finalize**

Use `superpowers:finishing-a-development-branch` to push `feat/full-market-screener` and integrate (fast-forward push to master per the shared-tree lesson). Set Railway env on web: `SCREENER_SNAPSHOT_ENABLED=1`, `SCREENER_SNAPSHOT_MAX_PER_RUN=4000`. Confirm the nightly job warms the universe over the next night(s); check `GET /api/screener/snapshot-status`.

---

## Self-Review notes (author)
- **Spec coverage:** universe snapshot (T1-5), all 6 filter categories (T6 registry; candles T2, technicals T3, patterns T17), query engine (T7), 6 views + gallery (T6/T13/T18), saved/shareable screens (T8/T9/T15), paid gate (T9 auth dep), live overlay display-only (T13/T14), CSV + row actions (T16), mobile + freshness + honest coverage (T19), layout = Finviz-classic with chart-via-popup (T14). Candidate Board + Live Scan preserved (T14).
- **Tiered pattern coverage** is honored: universe-wide cheap set in T17; the active-set `pattern_detections` LEFT JOIN is a documented future enhancement (the `pattern` filter already works against the snapshot `patterns` column via `contains`). If full active-set join is wanted in v1, add a small task after T17 to LEFT JOIN `pattern_detections` in `query.run_scan`.
- **Naming consistency:** `run_scan`, `build_where`, `build_row`, `run_build`, `meta`, `COLUMNS`, `FILTERS`, `VIEWS` used consistently across tasks. Hook names `useScreenerMeta/useScreenerScan/useSavedScreens` consistent.
- **Verify-at-impl flags** (existing-codebase names that MUST be grep-confirmed): local bars reader (`read_local_daily_bars`), `ratings_db.get_ticker_metrics`, `fundamentals.get_fundamentals`, `ticker_metadata.get_metadata`, `auth_db.get_connection`, `get_current_user` import path + `user["id"]`, `TickerPopup` API, `StockChart` `compact` prop, SQLite `NULLS LAST` support. Each is called out inline in its task.
