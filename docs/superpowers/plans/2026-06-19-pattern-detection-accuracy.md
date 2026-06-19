# Pattern Detection Accuracy (Opus-Vision Judge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chart-pattern detection trustworthy by adding an Opus 4.8 vision judge that confirms/rejects the rule engine's candidates from the actual rendered chart, surfacing confirmed-only detections with a rationale — and an evaluation harness that measures accuracy against the Model Book.

**Architecture:** The 88-detector rule engine becomes a high-recall *candidate generator* (scoped to ~14 focused swing setups). Each candidate's chart is rendered server-side (mplfinance) and judged by Opus 4.8 vision against a per-setup rubric; only confirmed verdicts reach users. Verdicts live in a new `/data/pattern_vision.db`. The Model Book (`modelbook_setups`) is ground-truth for a recall + false-positive eval. Cost-guarded, web-side, active-set + on-demand — like the catalyst engine.

**Tech Stack:** Python 3.12, FastAPI, SQLite (WAL), APScheduler, anthropic SDK (Opus 4.8 vision), mplfinance/matplotlib (already in requirements), pytest.

## Global Constraints

- **Branch:** work in worktree `.worktrees/pattern-vision` (branch `feat/pattern-vision-judge`, off `origin/master`). Ship via fast-forward push. NEVER `git add -A` (shared-tree hazard). After merge: `grep -c broker_sync api/main.py` ≥ 7.
- **Model:** Opus 4.8 (`claude-opus-4-8`) for the judge — vision base64 image block. No `thinking`/`temperature`/`budget_tokens` params (4.8 rejects sampling params; omit them). Client via `from api.services.engine import _get_anthropic_client`.
- **DB:** `/data/pattern_vision.db` (env `PATTERN_VISION_DB_PATH`; local dev → `./data/pattern_vision.db`). Own DB — leave the existing `pattern_detections` store untouched.
- **Focused setups (14 — exact registered ids):** `vcp, flat_base, high_tight_flag, cup_handle_uct, bull_flag, pullback_to_10ema, pullback_to_21ema, pullback_to_50sma, episodic_pivot, power_earnings_gap, u_and_r, remount, hammer, bullish_engulfing`. (`gap_support` is NOT registered — excluded.)
- **Confirmed-only surfaces** + rationale. **Cost-guarded** (daily soft/hard caps, skip-if-stable hash), **active-set + on-demand** — never judge all 3,685 nightly.
- **Existing signatures (verified):** `bars_sqlite.get_bars(ticker, tf, max_bars) -> list[tuple]` `(ts,o,h,l,c,v)` oldest-first (daily `ts` = YYYYMMDD int). `pattern_engine.detect_all(bars, context, pattern_ids=None) -> list[dict]` (keys incl. `pattern_id`, `confidence`, `detected_at`); `pattern_engine.primitives.context.build_context(bars, sym, regime_hint=None) -> dict`. `modelbook_service.get_stocks_for_year(year)`, `get_stock_detail(stock_id) -> {symbol, setups:[{setup_type,label_date,timeframe}]}`. Auth: `from api.middleware.auth_middleware import get_current_user, require_admin`.
- **Tests:** `pytest tests/test_pattern_vision_*.py`. NEVER call the live LLM in tests — inject a fake client. Build check for any FE: `cd app && npm run build`.

---

## Phase 1 — The trust fix (candidate → judge → confirmed)

New package `api/services/pattern_vision/`.

### Task 1: Verdict store + cost guard

**Files:**
- Create: `api/services/pattern_vision/__init__.py` (empty)
- Create: `api/services/pattern_vision/store.py`
- Test: `tests/test_pattern_vision_store.py`

**Interfaces:**
- Produces:
  - `get_db_path() -> str`, `connect() -> sqlite3.Connection` (WAL, Row), `init_db() -> None`
  - `put_verdict(v: dict) -> None` (INSERT OR REPLACE; PK `(ticker, tf, setup, asof_date)`)
  - `get_confirmed(ticker, tf="D") -> list[dict]` (confirmed=1, newest first)
  - `get_verdict(ticker, tf, setup, asof_date) -> dict | None`
  - `cost_today(day: str) -> float`, `log_cost(day, ticker, model, in_tok, out_tok, cost_usd) -> None`
  - `may_judge(day: str) -> bool` (False if spent ≥ `PATTERN_VISION_COST_HARD_CAP`, default 10.0)
  - `VERDICT_COLUMNS: list[str]`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pattern_vision_store.py
import importlib


def _fresh(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pv.db"))
    import api.services.pattern_vision.store as s
    importlib.reload(s)
    s.init_db()
    return s


def test_put_and_get_confirmed(tmp_path, monkeypatch):
    s = _fresh(tmp_path, monkeypatch)
    s.put_verdict({"ticker": "NVDA", "tf": "D", "setup": "vcp", "asof_date": "2026-06-19",
                   "confirmed": 1, "vision_confidence": 82.0, "rationale": "tight contractions",
                   "key_level": 184.0, "raw_confidence": 0.6, "model": "claude-opus-4-8",
                   "signals_hash": "abc", "judged_at": 1})
    s.put_verdict({"ticker": "NVDA", "tf": "D", "setup": "bull_flag", "asof_date": "2026-06-19",
                   "confirmed": 0, "vision_confidence": 20.0, "rationale": "no pole",
                   "signals_hash": "def", "judged_at": 1})
    conf = s.get_confirmed("NVDA")
    assert len(conf) == 1 and conf[0]["setup"] == "vcp"
    assert conf[0]["rationale"] == "tight contractions"


def test_cost_guard(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_COST_HARD_CAP", "1.00")
    s = _fresh(tmp_path, monkeypatch)
    assert s.may_judge("2026-06-19") is True
    s.log_cost("2026-06-19", "NVDA", "claude-opus-4-8", 1000, 200, 0.90)
    assert s.cost_today("2026-06-19") == 0.90
    assert s.may_judge("2026-06-19") is True
    s.log_cost("2026-06-19", "AAPL", "claude-opus-4-8", 1000, 200, 0.20)
    assert s.may_judge("2026-06-19") is False  # 1.10 >= 1.00
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_pattern_vision_store.py -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `store.py`**

```python
# api/services/pattern_vision/store.py
import os
import sqlite3
import threading

_WRITE_LOCK = threading.Lock()

VERDICT_COLUMNS = [
    "ticker", "tf", "setup", "asof_date", "confirmed", "vision_confidence",
    "rationale", "key_level", "raw_confidence", "model", "signals_hash", "judged_at",
]


def get_db_path() -> str:
    p = os.environ.get("PATTERN_VISION_DB_PATH")
    if p:
        return p
    if os.path.isdir("/data"):
        return "/data/pattern_vision.db"
    os.makedirs("./data", exist_ok=True)
    return "./data/pattern_vision.db"


def connect() -> sqlite3.Connection:
    c = sqlite3.connect(get_db_path(), timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=5000")
    return c


def init_db() -> None:
    with _WRITE_LOCK, connect() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS pattern_verdicts (
            ticker TEXT, tf TEXT, setup TEXT, asof_date TEXT,
            confirmed INTEGER, vision_confidence REAL, rationale TEXT, key_level REAL,
            raw_confidence REAL, model TEXT, signals_hash TEXT, judged_at INTEGER,
            PRIMARY KEY (ticker, tf, setup, asof_date))""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_pv_conf ON pattern_verdicts(ticker, tf, confirmed)")
        c.execute("""CREATE TABLE IF NOT EXISTS vision_cost_log (
            day TEXT, ticker TEXT, model TEXT, in_tok INTEGER, out_tok INTEGER,
            cost_usd REAL, logged_at INTEGER)""")
        c.commit()


def put_verdict(v: dict) -> None:
    ph = ", ".join("?" for _ in VERDICT_COLUMNS)
    with _WRITE_LOCK, connect() as c:
        c.execute(f"INSERT OR REPLACE INTO pattern_verdicts ({', '.join(VERDICT_COLUMNS)}) "
                  f"VALUES ({ph})", [v.get(k) for k in VERDICT_COLUMNS])
        c.commit()


def get_verdict(ticker, tf, setup, asof_date) -> dict | None:
    with connect() as c:
        r = c.execute("SELECT * FROM pattern_verdicts WHERE ticker=? AND tf=? AND setup=? "
                      "AND asof_date=?", (ticker.upper(), tf, setup, asof_date)).fetchone()
        return dict(r) if r else None


def get_confirmed(ticker, tf="D") -> list[dict]:
    with connect() as c:
        rows = c.execute("SELECT * FROM pattern_verdicts WHERE ticker=? AND tf=? AND confirmed=1 "
                         "ORDER BY judged_at DESC", (ticker.upper(), tf)).fetchall()
        return [dict(r) for r in rows]


def cost_today(day: str) -> float:
    with connect() as c:
        r = c.execute("SELECT COALESCE(SUM(cost_usd),0) FROM vision_cost_log WHERE day=?",
                      (day,)).fetchone()
        return float(r[0] or 0.0)


def log_cost(day, ticker, model, in_tok, out_tok, cost_usd) -> None:
    import time
    with _WRITE_LOCK, connect() as c:
        c.execute("INSERT INTO vision_cost_log (day,ticker,model,in_tok,out_tok,cost_usd,logged_at) "
                  "VALUES (?,?,?,?,?,?,?)", (day, ticker, model, in_tok, out_tok, cost_usd, int(time.time())))
        c.commit()


def may_judge(day: str) -> bool:
    hard = float(os.environ.get("PATTERN_VISION_COST_HARD_CAP", "10.0"))
    return cost_today(day) < hard
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_pattern_vision_store.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add api/services/pattern_vision/__init__.py api/services/pattern_vision/store.py tests/test_pattern_vision_store.py
git commit -m "feat(patterns): vision verdict store + cost guard"
```

### Task 2: Chart renderer (mplfinance)

**Files:**
- Create: `api/services/pattern_vision/chart_render.py`
- Test: `tests/test_pattern_vision_render.py`

**Interfaces:**
- Consumes: `bars` list of tuples `(ts,o,h,l,c,v)` oldest-first (daily ts = YYYYMMDD int).
- Produces: `render_chart(bars, *, window=120) -> bytes` (PNG bytes; candlestick + volume + 10/20/50 MAs; the last `window` bars; no title/label that leaks a setup name). Raises nothing on empty → returns `b""`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pattern_vision_render.py
from api.services.pattern_vision import chart_render


def _bars(n=130):
    return [(20260000 + i, float(i), i * 1.02, i * 0.98, float(i), 1_000_000 + i) for i in range(1, n)]


def test_render_returns_png_bytes():
    png = chart_render.render_chart(_bars(), window=120)
    assert isinstance(png, bytes) and len(png) > 1000
    assert png[:8] == b"\x89PNG\r\n\x1a\n"  # PNG magic


def test_render_empty_safe():
    assert chart_render.render_chart([], window=120) == b""
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_pattern_vision_render.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `chart_render.py`**

```python
# api/services/pattern_vision/chart_render.py
import io
import datetime


def _to_dt(ts):
    s = str(int(ts))
    if len(s) == 8:  # YYYYMMDD
        return datetime.datetime(int(s[:4]), int(s[4:6]), int(s[6:8]))
    return datetime.datetime.fromtimestamp(int(ts))


def render_chart(bars, *, window=120) -> bytes:
    if not bars:
        return b""
    import matplotlib
    matplotlib.use("Agg")  # headless
    import pandas as pd
    import mplfinance as mpf

    rows = bars[-window:]
    df = pd.DataFrame(
        [{"Date": _to_dt(t), "Open": o, "High": h, "Low": l, "Close": c, "Volume": v}
         for (t, o, h, l, c, v) in rows]
    ).set_index("Date")
    buf = io.BytesIO()
    mpf.plot(
        df, type="candle", volume=True, mav=(10, 20, 50),
        style="charles", figratio=(16, 9), figscale=1.1,
        axisoff=False, tight_layout=True, savefig=dict(fname=buf, dpi=110, format="png"),
    )
    buf.seek(0)
    return buf.read()
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_pattern_vision_render.py -v`
Expected: 2 passed. (If mplfinance import fails, confirm it's in requirements: `grep -i mplfinance requirements.txt`.)

- [ ] **Step 5: Commit**

```bash
git add api/services/pattern_vision/chart_render.py tests/test_pattern_vision_render.py
git commit -m "feat(patterns): server-side mplfinance chart renderer"
```

### Task 3: Per-setup rubrics

**Files:**
- Create: `api/services/pattern_vision/rubrics.py`
- Test: `tests/test_pattern_vision_rubrics.py`

**Interfaces:**
- Produces: `RUBRICS: dict[str, str]` (one per focused setup), `SETUP_LABEL: dict[str, str]` (human name), `FOCUSED_SETUPS: list[str]` (the 14 ids), `rubric_for(setup) -> str` (criteria text; generic fallback).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pattern_vision_rubrics.py
from api.services.pattern_vision import rubrics


def test_every_focused_setup_has_a_rubric():
    for s in rubrics.FOCUSED_SETUPS:
        assert s in rubrics.RUBRICS and len(rubrics.RUBRICS[s]) > 40


def test_rubric_for_fallback():
    assert "chart" in rubrics.rubric_for("unknown_setup").lower()
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_pattern_vision_rubrics.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `rubrics.py`**

```python
# api/services/pattern_vision/rubrics.py
FOCUSED_SETUPS = [
    "vcp", "flat_base", "high_tight_flag", "cup_handle_uct", "bull_flag",
    "pullback_to_10ema", "pullback_to_21ema", "pullback_to_50sma",
    "episodic_pivot", "power_earnings_gap", "u_and_r", "remount",
    "hammer", "bullish_engulfing",
]

SETUP_LABEL = {
    "vcp": "VCP", "flat_base": "Flat Base", "high_tight_flag": "High Tight Flag",
    "cup_handle_uct": "Cup with Handle", "bull_flag": "Bull Flag",
    "pullback_to_10ema": "Pullback to 10 EMA", "pullback_to_21ema": "Pullback to 21 EMA",
    "pullback_to_50sma": "Pullback to 50 SMA", "episodic_pivot": "Episodic Pivot",
    "power_earnings_gap": "Power Earnings Gap", "u_and_r": "Undercut & Rally",
    "remount": "Remount", "hammer": "Hammer", "bullish_engulfing": "Bullish Engulfing",
}

RUBRICS = {
    "vcp": "A VCP shows a prior uptrend, then a series of progressively tighter pullbacks "
           "(each contraction shallower than the last) on declining volume, coiling near the highs.",
    "flat_base": "A flat base is a shallow (<~15%) sideways consolidation lasting several weeks "
                 "after a prior advance, with the highs forming a roughly horizontal ceiling.",
    "high_tight_flag": "A high tight flag is a very strong, fast prior advance (often ~80%+ in weeks) "
                       "followed by a short, shallow, tight consolidation near the highs.",
    "cup_handle_uct": "A cup-with-handle shows a rounded U-shaped base, then a short downward-drifting "
                      "handle in the upper half of the cup on lighter volume.",
    "bull_flag": "A bull flag is a sharp upward pole, then a short tight parallel consolidation drifting "
                 "down/sideways (retracing only part of the pole) on contracting volume.",
    "pullback_to_10ema": "An orderly pullback in an uptrend where price pulls back to and holds the rising "
                         "10 EMA, then begins to turn up.",
    "pullback_to_21ema": "An orderly pullback in an uptrend where price pulls back to and holds the rising "
                         "21 EMA, then begins to turn up.",
    "pullback_to_50sma": "A pullback in an uptrend where price pulls back to the rising 50 SMA as support "
                         "and stabilizes there.",
    "episodic_pivot": "An episodic pivot is a large gap-up out of a quiet base on a huge volume surge, "
                      "starting a new trend.",
    "power_earnings_gap": "A power earnings gap is a strong gap-up after earnings on very high volume, "
                          "holding the gap and the prior range as support.",
    "u_and_r": "An undercut-and-rally undercuts a prior obvious support/low (shaking out holders) then "
               "rallies back above it within a few bars.",
    "remount": "A remount reclaims a key moving average or breakout level from below after briefly losing it.",
    "hammer": "A hammer is a single bar at a swing low / after a decline with a long lower wick (>=2x the body), "
              "a small body near the top, and little upper wick.",
    "bullish_engulfing": "A bullish engulfing is a down bar followed by an up bar whose body fully engulfs the "
                         "prior bar's body, ideally at support after a pullback.",
}


def rubric_for(setup: str) -> str:
    return RUBRICS.get(setup, "Judge whether this chart is a clean instance of the named setup.")
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_pattern_vision_rubrics.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add api/services/pattern_vision/rubrics.py tests/test_pattern_vision_rubrics.py
git commit -m "feat(patterns): per-setup vision rubrics for focused swing setups"
```

### Task 4: Vision judge (Opus 4.8, injectable client)

**Files:**
- Create: `api/services/pattern_vision/vision_judge.py`
- Test: `tests/test_pattern_vision_judge.py`

**Interfaces:**
- Consumes: `rubrics`, `store` (cost), a PNG (`bytes`).
- Produces:
  - `build_messages(setup, png_bytes) -> list[dict]` (one user msg: image block + rubric/JSON-instruction text).
  - `parse_verdict(text) -> dict` → `{confirmed: bool, confidence: int, reason: str, key_level: float|None}`; tolerant of prose around the JSON; safe-reject on garbage.
  - `judge(setup, png_bytes, *, client, model="claude-opus-4-8") -> dict` → verdict + `usage` (in/out tokens). Pure given an injected client (tests pass a fake).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pattern_vision_judge.py
from api.services.pattern_vision import vision_judge as vj


class _FakeBlock:
    def __init__(self, text): self.type = "text"; self.text = text


class _FakeUsage:
    input_tokens = 1200
    output_tokens = 150


class _FakeMsg:
    def __init__(self, text): self.content = [_FakeBlock(text)]; self.usage = _FakeUsage()


class _FakeClient:
    def __init__(self, text): self._text = text; self.calls = []
    class _M:
        def __init__(self, outer): self._outer = outer
        def create(self, **kw): self._outer.calls.append(kw); return _FakeMsg(self._outer._text)
    @property
    def messages(self): return _FakeClient._M(self)


def test_build_messages_has_image_and_text():
    msgs = vj.build_messages("vcp", b"\x89PNG_fake")
    block_types = [b["type"] for b in msgs[0]["content"]]
    assert "image" in block_types and "text" in block_types
    img = next(b for b in msgs[0]["content"] if b["type"] == "image")
    assert img["source"]["type"] == "base64" and img["source"]["media_type"] == "image/png"


def test_parse_verdict_extracts_json_amid_prose():
    v = vj.parse_verdict('Sure.\n{"confirmed": true, "confidence": 80, "reason": "tight", "key_level": 12.5}\nDone')
    assert v["confirmed"] is True and v["confidence"] == 80 and v["key_level"] == 12.5


def test_parse_verdict_safe_on_garbage():
    v = vj.parse_verdict("no json here")
    assert v["confirmed"] is False and v["confidence"] == 0


def test_judge_uses_client_and_returns_verdict():
    client = _FakeClient('{"confirmed": true, "confidence": 77, "reason": "clean flag", "key_level": null}')
    out = vj.judge("bull_flag", b"\x89PNGdata", client=client)
    assert out["confirmed"] is True and out["confidence"] == 77
    assert out["usage"]["input_tokens"] == 1200
    # Opus 4.8 vision: no sampling/thinking params sent
    sent = client.calls[0]
    assert sent["model"] == "claude-opus-4-8"
    assert "temperature" not in sent and "thinking" not in sent
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_pattern_vision_judge.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `vision_judge.py`**

```python
# api/services/pattern_vision/vision_judge.py
import base64
import json
import re

from .rubrics import rubric_for, SETUP_LABEL

_PROMPT = (
    "You are a professional swing trader judging a daily stock chart.\n"
    "Setup to evaluate: {label}.\n"
    "Definition: {rubric}\n\n"
    "Look ONLY at the chart image. Decide whether the most recent action is a CLEAN, "
    "textbook instance of this setup. Be strict — if it's ambiguous or messy, reject it.\n"
    "Respond with ONLY a JSON object, no prose:\n"
    '{{"confirmed": <true|false>, "confidence": <0-100>, "reason": "<one short sentence>", '
    '"key_level": <number or null>}}'
)


def build_messages(setup: str, png_bytes: bytes) -> list[dict]:
    b64 = base64.standard_b64encode(png_bytes).decode("utf-8")
    text = _PROMPT.format(label=SETUP_LABEL.get(setup, setup), rubric=rubric_for(setup))
    return [{
        "role": "user",
        "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
            {"type": "text", "text": text},
        ],
    }]


def parse_verdict(text: str) -> dict:
    m = re.search(r"\{.*\}", text or "", re.DOTALL)
    if not m:
        return {"confirmed": False, "confidence": 0, "reason": "unparseable", "key_level": None}
    try:
        d = json.loads(m.group(0))
    except (ValueError, TypeError):
        return {"confirmed": False, "confidence": 0, "reason": "unparseable", "key_level": None}
    conf = d.get("confidence")
    try:
        conf = int(round(float(conf)))
    except (TypeError, ValueError):
        conf = 0
    kl = d.get("key_level")
    try:
        kl = float(kl) if kl is not None else None
    except (TypeError, ValueError):
        kl = None
    return {"confirmed": bool(d.get("confirmed")), "confidence": max(0, min(100, conf)),
            "reason": str(d.get("reason") or "")[:240], "key_level": kl}


def judge(setup: str, png_bytes: bytes, *, client, model: str = "claude-opus-4-8") -> dict:
    msg = client.messages.create(model=model, max_tokens=600, messages=build_messages(setup, png_bytes))
    text = next((b.text for b in msg.content if getattr(b, "type", None) == "text"), "")
    verdict = parse_verdict(text)
    usage = getattr(msg, "usage", None)
    verdict["usage"] = {
        "input_tokens": getattr(usage, "input_tokens", 0),
        "output_tokens": getattr(usage, "output_tokens", 0),
    }
    verdict["model"] = model
    return verdict
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_pattern_vision_judge.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add api/services/pattern_vision/vision_judge.py tests/test_pattern_vision_judge.py
git commit -m "feat(patterns): Opus 4.8 vision judge (build/parse/judge, injectable client)"
```

### Task 5: Orchestrator (candidates → render → cost-gate → judge → store)

**Files:**
- Create: `api/services/pattern_vision/orchestrator.py`
- Test: `tests/test_pattern_vision_orchestrator.py`

**Interfaces:**
- Consumes: `store`, `chart_render`, `vision_judge`, `rubrics.FOCUSED_SETUPS`, the rule engine, bars reader.
- Produces:
  - `candidates_for(ticker, tf="D") -> list[dict]` — run focused detectors via `detect_all`, return `[{setup, raw_confidence, asof_date}]` (dedup to best per setup). Internal helpers `_read_bars`, `_signals_hash`.
  - `judge_ticker(ticker, tf="D", *, client=None, force=False) -> dict` — for each candidate: skip-if-stable (same `signals_hash` already stored) unless `force`; cost-gate via `store.may_judge`; render → judge → `store.put_verdict` + `store.log_cost`. Returns `{judged, confirmed, skipped, cost_capped}`.
  - Pricing: `_cost(model, in_tok, out_tok)` (Opus 4.8 = $5/$25 per Mtok).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pattern_vision_orchestrator.py
import importlib


def _setup(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pv.db"))
    import api.services.pattern_vision.store as s
    importlib.reload(s); s.init_db()
    import api.services.pattern_vision.orchestrator as orch
    importlib.reload(orch)
    return s, orch


def test_judge_ticker_confirms_and_stores(tmp_path, monkeypatch):
    s, orch = _setup(tmp_path, monkeypatch)
    # stub the moving parts: 1 candidate, a render, a confirming judge
    monkeypatch.setattr(orch, "candidates_for",
                        lambda t, tf="D": [{"setup": "vcp", "raw_confidence": 0.6, "asof_date": "2026-06-19"}])
    monkeypatch.setattr(orch, "_read_bars", lambda t, tf: [(20260101, 1, 1, 1, 1, 1)])
    monkeypatch.setattr(orch.chart_render, "render_chart", lambda bars, **k: b"\x89PNGx")
    monkeypatch.setattr(orch.vision_judge, "judge",
                        lambda setup, png, client=None: {"confirmed": True, "confidence": 80,
                        "reason": "tight", "key_level": 10.0, "model": "claude-opus-4-8",
                        "usage": {"input_tokens": 1000, "output_tokens": 100}})
    out = orch.judge_ticker("NVDA", client=object())
    assert out["judged"] == 1 and out["confirmed"] == 1
    assert s.get_confirmed("NVDA")[0]["setup"] == "vcp"
    # second run: skip-if-stable (same signals_hash) → no re-judge
    out2 = orch.judge_ticker("NVDA", client=object())
    assert out2["skipped"] == 1 and out2["judged"] == 0


def test_cost_cap_blocks_judging(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_COST_HARD_CAP", "0.00")
    s, orch = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(orch, "candidates_for",
                        lambda t, tf="D": [{"setup": "vcp", "raw_confidence": 0.6, "asof_date": "2026-06-19"}])
    out = orch.judge_ticker("NVDA", client=object())
    assert out["cost_capped"] is True and out["judged"] == 0
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_pattern_vision_orchestrator.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `orchestrator.py`**

```python
# api/services/pattern_vision/orchestrator.py
import datetime
import hashlib
import logging
import time

from . import store, chart_render, vision_judge
from .rubrics import FOCUSED_SETUPS

log = logging.getLogger(__name__)

_PRICE = {"claude-opus-4-8": (5.0, 25.0)}  # ($/Mtok in, out)


def _cost(model, in_tok, out_tok) -> float:
    pin, pout = _PRICE.get(model, (5.0, 25.0))
    return (in_tok / 1e6) * pin + (out_tok / 1e6) * pout


def _read_bars(ticker, tf):
    from api.services import bars_sqlite
    return bars_sqlite.get_bars(ticker, tf, 400) or []


def _signals_hash(ticker, setup, bars) -> str:
    tail = bars[-1] if bars else ()
    return hashlib.sha1(f"{ticker}|{setup}|{tail}".encode()).hexdigest()[:16]


def candidates_for(ticker, tf="D") -> list[dict]:
    bars = _read_bars(ticker, tf)
    if not bars:
        return []
    try:
        from api.services.pattern_engine import detect_all
        from api.services.pattern_engine.primitives.context import build_context
        ctx = build_context(bars, ticker)
        raw = detect_all(bars, ctx, pattern_ids=FOCUSED_SETUPS) or []
    except Exception as e:
        log.warning("[pv] candidates_for %s failed: %s", ticker, e)
        return []
    best = {}
    today = datetime.date.today().isoformat()
    for d in raw:
        sid = d.get("pattern_id")
        if sid not in FOCUSED_SETUPS:
            continue
        conf = float(d.get("confidence") or 0)
        if sid not in best or conf > best[sid]["raw_confidence"]:
            best[sid] = {"setup": sid, "raw_confidence": conf, "asof_date": today}
    return list(best.values())


def judge_ticker(ticker, tf="D", *, client=None, force=False) -> dict:
    store.init_db()
    if client is None:
        from api.services.engine import _get_anthropic_client
        client = _get_anthropic_client()
    day = datetime.date.today().isoformat()
    out = {"judged": 0, "confirmed": 0, "skipped": 0, "cost_capped": False}
    bars = _read_bars(ticker, tf)
    for cand in candidates_for(ticker, tf):
        setup = cand["setup"]
        sig = _signals_hash(ticker, setup, bars)
        if not force:
            prev = store.get_verdict(ticker, tf, setup, cand["asof_date"])
            if prev and prev.get("signals_hash") == sig:
                out["skipped"] += 1
                continue
        if not store.may_judge(day):
            out["cost_capped"] = True
            break
        png = chart_render.render_chart(bars)
        if not png:
            continue
        try:
            v = vision_judge.judge(setup, png, client=client)
        except Exception as e:
            log.warning("[pv] judge %s/%s failed: %s", ticker, setup, e)
            continue
        u = v.get("usage", {})
        cost = _cost(v.get("model", "claude-opus-4-8"), u.get("input_tokens", 0), u.get("output_tokens", 0))
        store.log_cost(day, ticker, v.get("model", "claude-opus-4-8"),
                       u.get("input_tokens", 0), u.get("output_tokens", 0), cost)
        store.put_verdict({
            "ticker": ticker.upper(), "tf": tf, "setup": setup, "asof_date": cand["asof_date"],
            "confirmed": 1 if v["confirmed"] else 0, "vision_confidence": float(v["confidence"]),
            "rationale": v["reason"], "key_level": v.get("key_level"),
            "raw_confidence": cand["raw_confidence"], "model": v.get("model", "claude-opus-4-8"),
            "signals_hash": sig, "judged_at": int(time.time()),
        })
        out["judged"] += 1
        if v["confirmed"]:
            out["confirmed"] += 1
    return out
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_pattern_vision_orchestrator.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add api/services/pattern_vision/orchestrator.py tests/test_pattern_vision_orchestrator.py
git commit -m "feat(patterns): vision judge orchestrator (skip-if-stable + cost gate)"
```

### Task 6: API endpoints + confirmed-only surface

**Files:**
- Modify: `api/routers/patterns.py` (add endpoints; default existing per-symbol read to confirmed)
- Test: `tests/test_pattern_vision_api.py`

**Interfaces:**
- `GET /api/patterns/confirmed/{sym}?tf=D` → `{verdicts: [...]}` (auth) — confirmed verdicts + rationale.
- `POST /api/patterns/judge/{sym}?tf=D` → `{started: true}` (admin) — background `judge_ticker`.
- `GET /api/admin/patterns/vision-stats` → cost + counts (admin).

- [ ] **Step 1: Write the failing test** — copy the auth `_login` helper + `client` fixture from `tests/test_voice_router.py`; seed a confirmed verdict via the store (with `PATTERN_VISION_DB_PATH` set), then:

```python
# tests/test_pattern_vision_api.py  (sketch — mirror tests/test_voice_router.py auth)
def test_confirmed_endpoint_returns_verdicts(client, monkeypatch, tmp_path):
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pv.db"))
    import importlib, api.services.pattern_vision.store as s
    importlib.reload(s); s.init_db()
    s.put_verdict({"ticker": "NVDA", "tf": "D", "setup": "vcp", "asof_date": "2026-06-19",
                   "confirmed": 1, "vision_confidence": 80, "rationale": "tight",
                   "signals_hash": "x", "judged_at": 1})
    _login(client)
    r = client.get("/api/patterns/confirmed/NVDA")
    assert r.status_code == 200
    assert r.json()["verdicts"][0]["setup"] == "vcp"


def test_judge_requires_admin(client):
    _login(client)  # member
    assert client.post("/api/patterns/judge/NVDA").status_code == 403
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_pattern_vision_api.py -v`
Expected: FAIL (routes 404 / auth).

- [ ] **Step 3: Implement endpoints in `api/routers/patterns.py`**

```python
# add near the top of api/routers/patterns.py
from api.middleware.auth_middleware import get_current_user, require_admin
from api.services.pattern_vision import store as pv_store, orchestrator as pv_orch

@router.get("/api/patterns/confirmed/{sym}")
def patterns_confirmed(sym: str, tf: str = "D", user=Depends(get_current_user)):
    pv_store.init_db()
    return {"verdicts": pv_store.get_confirmed(sym, tf)}

@router.post("/api/patterns/judge/{sym}")
def patterns_judge(sym: str, tf: str = "D", user=Depends(require_admin)):
    import threading
    threading.Thread(target=lambda: pv_orch.judge_ticker(sym, tf, force=True),
                     daemon=True, name=f"pv-judge-{sym}").start()
    return {"started": True}

@router.get("/api/admin/patterns/vision-stats")
def patterns_vision_stats(user=Depends(require_admin)):
    import datetime
    pv_store.init_db()
    day = datetime.date.today().isoformat()
    return {"cost_today": pv_store.cost_today(day), "may_judge": pv_store.may_judge(day)}
```

> If `api/routers/patterns.py` doesn't already import `Depends`, add it to the FastAPI import. The existing `GET /api/patterns/{sym}` stays; add a `confirmed_only: bool = True` query param to it that returns `pv_store.get_confirmed(sym, tf)` when true so existing UI flips to confirmed without a path change (verify the current handler signature first and thread the param through).

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_pattern_vision_api.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/routers/patterns.py tests/test_pattern_vision_api.py
git commit -m "feat(patterns): confirmed/judge/vision-stats API; confirmed-only read"
```

### Task 7: Active-set scheduler job + startup fingerprint

**Files:**
- Modify: `api/main.py` (module-level `register_pattern_vision_jobs(scheduler)` + call it in the scheduler block; startup fingerprint line)
- Test: `tests/test_pattern_vision_schedule.py`

**Interfaces:**
- Job id `pattern_vision_judge` (hourly, gated `PATTERN_VISION_ENABLED`, default "1"); body judges the **active set** (leaders + watchlists + UCT20 + screener-recent — reuse the same active-set resolver the pattern scan uses; if unavailable, judge the leader_universe list). Capped per run by `PATTERN_VISION_MAX_PER_RUN` (default 150).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pattern_vision_schedule.py
import api.main as m


class _Fake:
    def __init__(self): self.ids = []
    def add_job(self, *a, **k): self.ids.append(k.get("id"))


def test_pattern_vision_job_registered(monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_ENABLED", "1")
    f = _Fake()
    assert m.register_pattern_vision_jobs(f) is True
    assert "pattern_vision_judge" in f.ids


def test_disabled(monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_ENABLED", "0")
    f = _Fake()
    assert m.register_pattern_vision_jobs(f) is False
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_pattern_vision_schedule.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement in `api/main.py`** — module-level helper (mirror `register_screener_jobs` / `_register_screener_jobs` already in the file):

```python
def register_pattern_vision_jobs(scheduler):
    import os
    if os.environ.get("PATTERN_VISION_ENABLED", "1") != "1":
        return False
    from apscheduler.triggers.cron import CronTrigger
    from api.services.pattern_vision import orchestrator as pv_orch

    def _run():
        try:
            cap = int(os.environ.get("PATTERN_VISION_MAX_PER_RUN", "150"))
            tickers = _resolve_active_set_for_patterns()[:cap]  # reuse existing active-set; see note
            for t in tickers:
                pv_orch.judge_ticker(t)
        except Exception as e:
            print(f"[scheduler] pattern_vision job error: {e}")

    scheduler.add_job(_run, trigger=CronTrigger(minute=0),
                      id="pattern_vision_judge", max_instances=1, replace_existing=True)
    return True
```

Add `register_pattern_vision_jobs(_scheduler)` inside the scheduler-setup block (next to the other `register_*` calls), wrapped in try/except. Implement `_resolve_active_set_for_patterns()` by reusing the active-set logic already in `_run_patterns_universe_scan` (leader_universe + watchlists + UCT20 + candidates) — extract or call the same source; fall back to the leader_universe JSON. Add to the startup fingerprint print: `pattern_vision=on model=claude-opus-4-8 cost_hard_cap=$… active_set_only=on skip_if_stable=on`.

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_pattern_vision_schedule.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add api/main.py tests/test_pattern_vision_schedule.py
git commit -m "feat(patterns): hourly active-set vision-judge job + startup fingerprint"
```

---

## Phase 2 — Prove it (Model Book accuracy harness)

### Task 8: Eval harness (recall + false-positive vs Model Book)

**Files:**
- Create: `api/services/pattern_vision/eval.py`
- Test: `tests/test_pattern_vision_eval.py`

**Interfaces:**
- Produces:
  - `_modelbook_truth() -> list[dict]` — `[{symbol, setup, label_date, timeframe}]` from `modelbook_setups` joined to `modelbook_stocks`, normalized to focused setup ids (a `_NORMALIZE` map handles Model Book display names → engine ids; non-focused rows dropped).
  - `evaluate(*, judge_fn=None, max_rows=None) -> dict` — for each truth row: generate candidate on that ticker, judge (inject `judge_fn` in tests), record hit (confirmed for that setup) → recall; sample N random non-setup `(ticker, date)` points → false-positive rate. Returns `{per_setup: {setup: {truth, detected, confirmed, recall}}, false_positive_rate, n}`.

- [ ] **Step 1: Write the failing test** (judge + truth injected; no DB/LLM/network)

```python
# tests/test_pattern_vision_eval.py
from api.services.pattern_vision import eval as pv_eval


def test_evaluate_computes_recall(monkeypatch):
    truth = [
        {"symbol": "AAA", "setup": "vcp", "label_date": "2026-01-05", "timeframe": "D"},
        {"symbol": "BBB", "setup": "vcp", "label_date": "2026-02-05", "timeframe": "D"},
    ]
    monkeypatch.setattr(pv_eval, "_modelbook_truth", lambda: truth)
    # AAA confirms vcp, BBB does not
    def judge_fn(sym, setup, date):
        return {"confirmed": sym == "AAA" and setup == "vcp"}
    rep = pv_eval.evaluate(judge_fn=judge_fn)
    assert rep["per_setup"]["vcp"]["truth"] == 2
    assert rep["per_setup"]["vcp"]["confirmed"] == 1
    assert rep["per_setup"]["vcp"]["recall"] == 0.5
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_pattern_vision_eval.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `eval.py`**

```python
# api/services/pattern_vision/eval.py
import logging
from collections import defaultdict
from .rubrics import FOCUSED_SETUPS

log = logging.getLogger(__name__)

# Model Book setup_type display names -> engine pattern ids (normalize the known gaps).
_NORMALIZE = {
    "VCP": "vcp", "Flat Base Breakout": "flat_base", "Flat Base": "flat_base",
    "High Tight Flag (Powerplay)": "high_tight_flag", "High Tight Flag": "high_tight_flag",
    "Classic Flag/Pullback": "bull_flag", "Bull Flag": "bull_flag",
    "Power Earnings Gap": "power_earnings_gap", "Episodic Pivot": "episodic_pivot",
    "Classic U&R": "u_and_r", "U&R (Undercut & Rally)": "u_and_r", "Remount": "remount",
    "Cup w/ Handle": "cup_handle_uct", "Cup with Handle": "cup_handle_uct",
}


def _norm(setup_type: str) -> str | None:
    if setup_type in _NORMALIZE:
        return _NORMALIZE[setup_type]
    s = (setup_type or "").strip().lower().replace(" ", "_")
    return s if s in FOCUSED_SETUPS else None


def _modelbook_truth() -> list[dict]:
    out = []
    try:
        from api.services import modelbook_service as mb
        for yr in mb.list_years() if hasattr(mb, "list_years") else range(2015, 2027):
            for stk in (mb.get_stocks_for_year(yr) or []):
                detail = mb.get_stock_detail(stk["id"]) or {}
                sym = detail.get("symbol")
                for su in detail.get("setups", []):
                    sid = _norm(su.get("setup_type"))
                    if sid and sym:
                        out.append({"symbol": sym, "setup": sid,
                                    "label_date": su.get("label_date"),
                                    "timeframe": su.get("timeframe") or "D"})
    except Exception as e:
        log.warning("[pv-eval] truth load failed: %s", e)
    return out


def evaluate(*, judge_fn=None, max_rows=None) -> dict:
    if judge_fn is None:
        def judge_fn(sym, setup, date):
            from . import orchestrator as orch
            res = orch.judge_ticker(sym, force=True)
            from . import store
            v = store.get_verdict(sym, "D", setup, date) or {}
            return {"confirmed": bool(v.get("confirmed"))}
    truth = _modelbook_truth()
    if max_rows:
        truth = truth[:max_rows]
    per = defaultdict(lambda: {"truth": 0, "detected": 0, "confirmed": 0, "recall": 0.0})
    for row in truth:
        p = per[row["setup"]]
        p["truth"] += 1
        try:
            if judge_fn(row["symbol"], row["setup"], row["label_date"]).get("confirmed"):
                p["confirmed"] += 1
        except Exception as e:
            log.warning("[pv-eval] judge %s failed: %s", row, e)
    for sid, p in per.items():
        p["recall"] = round(p["confirmed"] / p["truth"], 3) if p["truth"] else 0.0
    return {"per_setup": dict(per), "false_positive_rate": None, "n": len(truth)}
```

> Verify `modelbook_service` has `list_years()` / `get_stocks_for_year()` / `get_stock_detail()` exactly; adjust `_modelbook_truth` to the real getters. The false-positive sampling (random non-setup points) is a follow-on refinement — leave `false_positive_rate: None` in v1 and fill it when a random-sampler is added; do NOT claim an FP number that isn't computed.

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_pattern_vision_eval.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/pattern_vision/eval.py tests/test_pattern_vision_eval.py
git commit -m "feat(patterns): Model Book recall eval harness"
```

### Task 9: Eval endpoint

**Files:**
- Modify: `api/routers/patterns.py`
- Test: extend `tests/test_pattern_vision_api.py`

**Interfaces:**
- `GET /api/admin/patterns/eval?max_rows=N` (admin) → runs `eval.evaluate(max_rows=N)` and returns the report. `max_rows` defaults small (e.g. 40) to bound cost; document that omitting it judges the full Model Book.

- [ ] **Step 1: Write the failing test**

```python
def test_eval_requires_admin(client):
    _login(client)
    assert client.get("/api/admin/patterns/eval").status_code == 403
```

- [ ] **Step 2: Run to verify fail** — `pytest tests/test_pattern_vision_api.py -v` (the new test FAILs / 404).

- [ ] **Step 3: Implement**

```python
@router.get("/api/admin/patterns/eval")
def patterns_eval(max_rows: int = 40, user=Depends(require_admin)):
    from api.services.pattern_vision import eval as pv_eval
    return pv_eval.evaluate(max_rows=max_rows)
```

- [ ] **Step 4: Run to verify pass** — `pytest tests/test_pattern_vision_api.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add api/routers/patterns.py tests/test_pattern_vision_api.py
git commit -m "feat(patterns): admin Model Book eval endpoint"
```

### Task 10: Full-suite verification + real-data smoke + ship

**Files:** none (verification)

- [ ] **Step 1: Backend suite** — `pytest tests/test_pattern_vision_*.py -v` → all pass.
- [ ] **Step 2: Verify-at-impl names resolve** — `grep -rn "def get_bars\|def detect_all\|def build_context\|def get_stock_detail\|def get_stocks_for_year\|def _get_anthropic_client" api/services/` ; fix any wrapper whose name differs.
- [ ] **Step 3: Real render smoke (no LLM)** — render a real ticker's chart from local bars and confirm a PNG:

```bash
python -c "from api.services import bars_sqlite as b; from api.services.pattern_vision import chart_render as r; png=r.render_chart(b.get_bars('AAPL','D',400)); print('png_bytes', len(png))"
```
Expected: a few KB of PNG bytes (skip if no local bars).

- [ ] **Step 4: Manual prod-or-local check** — with `ANTHROPIC_API_KEY` + admin: `POST /api/patterns/judge/AAPL`, then `GET /api/patterns/confirmed/AAPL` (verdicts + rationale), then `GET /api/admin/patterns/vision-stats` (cost logged). Spot-check that confirmed verdicts match what you'd judge by eye on the chart.
- [ ] **Step 5: Finalize** — `superpowers:finishing-a-development-branch`: rebase onto latest `origin/master`, FF-push to master, `grep -c broker_sync api/main.py` ≥ 7. Railway web env: `PATTERN_VISION_ENABLED=1`, `PATTERN_VISION_COST_HARD_CAP=10.00`, `PATTERN_VISION_MAX_PER_RUN=150`. Run `GET /api/admin/patterns/eval?max_rows=40` once to baseline recall.

---

## Phase 3 (separate plan, after P1/P2 land)

Feedback loop + admin review surface + calibration/pruning. Wire `POST /api/patterns/{id}/feedback` (already stores to `pattern_feedback`) into a consumer; build an admin review surface (confirmed verdicts on their charts → 👍/👎/relabel); periodically calibrate rubric thresholds + **prune** rule detectors that are mostly rejected (cuts nonsense at the source + Opus cost). Written as its own spec+plan once the trust fix is in users' hands.

---

## Self-Review notes (author)
- **Spec coverage:** candidate→judge→confirmed (T4/T5), confirmed-only surfaces + rationale (T6), mplfinance render (T2 — already a dependency, spec's "new dep" note corrected), `pattern_vision.db` verdict store (T1), cost-guard active-set + on-demand + skip-if-stable (T1/T5/T7), Model Book eval recall (T8/T9), focused setups (T3 — `gap_support` dropped as unregistered), Opus 4.8 vision per claude-api skill (T4). Phase 3 deferred to its own plan (spec §9 P3).
- **Naming consistency:** `judge_ticker`, `candidates_for`, `judge`, `parse_verdict`, `build_messages`, `put_verdict`, `get_confirmed`, `may_judge`, `evaluate`, `_modelbook_truth`, `register_pattern_vision_jobs` used consistently across tasks.
- **Verify-at-impl flags** (grep-confirm before coding the wrapper): `detect_all` return-dict key (`pattern_id` vs `id`) + `build_context` arg order; `modelbook_service.list_years/get_stocks_for_year/get_stock_detail`; `_get_anthropic_client`; the active-set resolver inside `_run_patterns_universe_scan`; `Depends` already imported in `patterns.py`; the existing `GET /api/patterns/{sym}` handler signature before adding `confirmed_only`. Each is called out inline.
- **No live LLM in tests** — every judge path takes an injected client/`judge_fn`.
