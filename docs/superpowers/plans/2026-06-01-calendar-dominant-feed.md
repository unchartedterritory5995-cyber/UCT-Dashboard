# Calendar Dominant-Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/calendar` into a personalized, logo-forward, trader-grade earnings feed (Feed/Week/Month views) with options-implied expected move, 4-quarter surprise history, and customizable "My Stocks" personalization.

**Architecture:** Backend adds a proxy-and-cache **logo subsystem** (the only new data dependency), a **personalization set** helper, and a fast **enrichment overlay** endpoint that layers expected-move + beat-history onto the existing `/api/calendar` payload (which the frontend overlays just like live prices today). Frontend rebuilds `Calendar.jsx` into composable view/card components. All new fields degrade gracefully to null/monogram.

**Tech Stack:** FastAPI + SQLite + Pillow (logos) backend; React + Vite + SWR + CSS Modules (`@container`) frontend. Tests: pytest (backend), vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-06-01-calendar-dominant-feed-design.md`

**Reference patterns to mirror:**
- Prewarmer: `api/services/ticker_names_prewarm.py`
- Disk cache: `api/services/ticker_meta.py` (`_disk_path`/`_disk_get`/`_disk_put`)
- Existing data already built: `api/services/earnings_enrichment.py::get_implied_move(sym, earnings_date)` → `{pct,dollar,expiry,...}|None`; `api/services/earnings_estimates.py::get_earnings_intel(ticker)` → `{beat_history:[{period,actual,estimate,beat,surprise}], ...}|None`
- Router + prewarm registration: `api/main.py` (~line 977 prewarm start, ~line 1740 include_router)
- Prefs hook: `app/src/hooks/usePreferences.js` → `const {prefs, setPref} = usePreferences(); setPref('key', value)`

---

## Phase 1 — Backend: Logo subsystem

### Task 1: Logo cache + resolver service

**Files:**
- Create: `api/services/ticker_logos.py`
- Test: `tests/test_ticker_logos.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_ticker_logos.py
import os
from unittest import mock
from api.services import ticker_logos as tl


def test_get_logo_path_returns_none_when_absent(tmp_path):
    with mock.patch.object(tl, "_CACHE_DIR", str(tmp_path)):
        assert tl.get_logo_path("NVDA") is None


def test_get_logo_path_returns_file_when_present(tmp_path):
    with mock.patch.object(tl, "_CACHE_DIR", str(tmp_path)):
        p = os.path.join(str(tmp_path), "NVDA.png")
        with open(p, "wb") as fh:
            fh.write(b"\x89PNG\r\n")
        assert tl.get_logo_path("NVDA") == p


def test_resolve_and_cache_writes_png_from_first_working_source(tmp_path):
    png_bytes = b"\x89PNG\r\n\x1a\nrest"
    with mock.patch.object(tl, "_CACHE_DIR", str(tmp_path)), \
         mock.patch.object(tl, "_fetch_sources", return_value=png_bytes), \
         mock.patch.object(tl, "_normalize_png", return_value=png_bytes):
        out = tl.resolve_and_cache("NVDA")
    assert out is not None
    assert os.path.exists(os.path.join(str(tmp_path), "NVDA.png"))


def test_resolve_and_cache_writes_miss_sentinel_when_all_fail(tmp_path):
    with mock.patch.object(tl, "_CACHE_DIR", str(tmp_path)), \
         mock.patch.object(tl, "_fetch_sources", return_value=None):
        out = tl.resolve_and_cache("ZZZZ")
    assert out is None
    assert os.path.exists(os.path.join(str(tmp_path), "ZZZZ.miss"))


def test_resolve_skips_recent_miss(tmp_path):
    with mock.patch.object(tl, "_CACHE_DIR", str(tmp_path)):
        open(os.path.join(str(tmp_path), "ZZZZ.miss"), "w").close()
        with mock.patch.object(tl, "_fetch_sources") as fetch:
            out = tl.resolve_and_cache("ZZZZ")
        fetch.assert_not_called()
        assert out is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_ticker_logos.py -v`
Expected: FAIL (module `ticker_logos` not found).

- [ ] **Step 3: Write the implementation**

```python
# api/services/ticker_logos.py
"""Proxy-and-cache company logos on our own volume.

Resolves each ticker's logo ONCE from a multi-source chain, normalizes to
PNG, and stores under /data/logo_cache/{SYM}.png. Thereafter we serve from
our own disk (~10ms), immune to third-party outages. Misses write a
{SYM}.miss sentinel so we don't refetch every request (retried after 7d).
Mirrors the ticker_meta disk-cache + ticker_names prewarm patterns.
Never raises.
"""
import io
import logging
import os
import time

import requests

_logger = logging.getLogger(__name__)
_CACHE_DIR = os.path.join(os.environ.get("DATA_DIR", "/data"), "logo_cache")
_MISS_TTL = 7 * 86400  # retry a miss after 7 days
_HEADERS = {"User-Agent": "Mozilla/5.0"}
_TIMEOUT = 8


def _safe(sym: str) -> str:
    return os.path.basename((sym or "").upper().strip())


def _png_path(sym: str) -> str:
    return os.path.join(_CACHE_DIR, f"{_safe(sym)}.png")


def _miss_path(sym: str) -> str:
    return os.path.join(_CACHE_DIR, f"{_safe(sym)}.miss")


def get_logo_path(sym: str):
    """Return the cached PNG path if present on disk, else None."""
    p = _png_path(sym)
    return p if os.path.exists(p) else None


def _recent_miss(sym: str) -> bool:
    mp = _miss_path(sym)
    try:
        return os.path.exists(mp) and (time.time() - os.path.getmtime(mp) < _MISS_TTL)
    except OSError:
        return False


def _finnhub_logo_bytes(sym: str):
    key = os.environ.get("FINNHUB_API_KEY", "")
    if not key:
        return None
    try:
        j = requests.get("https://finnhub.io/api/v1/stock/profile2",
                         params={"symbol": sym, "token": key}, timeout=_TIMEOUT).json() or {}
        url = j.get("logo") or ""
        if url:
            r = requests.get(url, headers=_HEADERS, timeout=_TIMEOUT)
            if r.ok and r.content:
                return r.content
    except Exception:
        return None
    return None


def _url_bytes(url: str):
    try:
        r = requests.get(url, headers=_HEADERS, timeout=_TIMEOUT, allow_redirects=True)
        if r.ok and r.content and len(r.content) > 200:
            return r.content
    except Exception:
        return None
    return None


def _fetch_sources(sym: str):
    """Try each source in priority order; return raw image bytes or None."""
    s = _safe(sym)
    return (
        _finnhub_logo_bytes(s)
        or _url_bytes(f"https://assets.parqet.com/logos/symbol/{s}")
        or _url_bytes(f"https://financialmodelingprep.com/image-stock/{s}.png")
    )


def _normalize_png(raw: bytes):
    """Rasterize/convert any input (PNG/SVG/JPG) to a square-ish PNG via Pillow.
    SVGs aren't handled by Pillow directly — if Pillow can't open it, keep raw
    bytes only if they already look like PNG, else None."""
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(raw)).convert("RGBA")
        im.thumbnail((96, 96))
        out = io.BytesIO()
        im.save(out, format="PNG")
        return out.getvalue()
    except Exception:
        # Pillow can't read SVG; accept raw only if it's already a PNG.
        if raw[:8] == b"\x89PNG\r\n\x1a\n":
            return raw
        return None


def resolve_and_cache(sym: str):
    """Resolve+cache the logo. Returns the PNG path on success, else None."""
    s = _safe(sym)
    if not s:
        return None
    existing = get_logo_path(s)
    if existing:
        return existing
    if _recent_miss(s):
        return None

    raw = _fetch_sources(s)
    png = _normalize_png(raw) if raw else None

    os.makedirs(_CACHE_DIR, exist_ok=True)
    if not png:
        try:
            open(_miss_path(s), "w").close()
        except OSError:
            pass
        return None

    tmp = _png_path(s) + ".tmp"
    try:
        with open(tmp, "wb") as fh:
            fh.write(png)
        os.replace(tmp, _png_path(s))
    except OSError as e:
        _logger.warning("logo write failed for %s: %s", s, e)
        return None
    return _png_path(s)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_ticker_logos.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add api/services/ticker_logos.py tests/test_ticker_logos.py
git commit -m "feat(calendar): logo proxy-and-cache resolver service"
```

---

### Task 2: Logo HTTP endpoint

**Files:**
- Create: `api/routers/ticker_logos.py`
- Modify: `api/main.py` (imports near line 42-43; `include_router` near line 1741)
- Test: `tests/test_ticker_logos_router.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_ticker_logos_router.py
import os
from unittest import mock
from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)


def test_logo_served_when_cached(tmp_path):
    from api.services import ticker_logos as tl
    p = os.path.join(str(tmp_path), "NVDA.png")
    with open(p, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\ndata")
    with mock.patch.object(tl, "get_logo_path", return_value=p):
        r = client.get("/api/ticker-logo/NVDA")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert "max-age" in r.headers.get("cache-control", "")


def test_logo_miss_returns_transparent_and_schedules_resolve():
    from api.services import ticker_logos as tl
    with mock.patch.object(tl, "get_logo_path", return_value=None), \
         mock.patch.object(tl, "schedule_resolve") as sched:
        r = client.get("/api/ticker-logo/ZZZZ")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    sched.assert_called_once_with("ZZZZ")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_ticker_logos_router.py -v`
Expected: FAIL (404 — route not registered).

- [ ] **Step 3: Add `schedule_resolve` to the service**

Append to `api/services/ticker_logos.py`:

```python
# ── Bounded async resolver (politeness to third parties) ──────────────────────
import threading
from concurrent.futures import ThreadPoolExecutor

_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="logo-resolve")
_INFLIGHT: set = set()
_INFLIGHT_LOCK = threading.Lock()

# 1x1 transparent PNG returned on cold miss so the client never shows a broken img.
TRANSPARENT_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082"
)


def schedule_resolve(sym: str) -> None:
    s = _safe(sym)
    if not s:
        return
    with _INFLIGHT_LOCK:
        if s in _INFLIGHT or len(_INFLIGHT) >= 8:
            return
        _INFLIGHT.add(s)

    def _job():
        try:
            resolve_and_cache(s)
        finally:
            with _INFLIGHT_LOCK:
                _INFLIGHT.discard(s)

    _POOL.submit(_job)
```

- [ ] **Step 4: Write the router**

```python
# api/routers/ticker_logos.py
"""GET /api/ticker-logo/{sym} — serve cached company logo PNG.

Cache hit → stream the file with a long immutable cache header. Miss →
return a 1x1 transparent PNG immediately AND kick off a bounded background
resolve so the next request is warm. The frontend renders a monogram
fallback over the transparent pixel, so a logo is never a broken image.
"""
from fastapi import APIRouter, Response
from fastapi.responses import FileResponse
from api.services import ticker_logos as tl

router = APIRouter()
_HEADERS = {"Cache-Control": "public, max-age=604800, immutable"}


@router.get("/api/ticker-logo/{sym}")
def ticker_logo(sym: str):
    path = tl.get_logo_path(sym)
    if path:
        return FileResponse(path, media_type="image/png", headers=_HEADERS)
    tl.schedule_resolve(sym)
    return Response(content=tl.TRANSPARENT_PNG, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=300"})
```

- [ ] **Step 5: Register the router in `api/main.py`**

Add with the other router imports (near line 42-43):

```python
from api.routers import ticker_logos as ticker_logos_router
```

Add with the other `include_router` calls (near line 1741):

```python
app.include_router(ticker_logos_router.router)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `python -m pytest tests/test_ticker_logos_router.py -v`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add api/routers/ticker_logos.py api/services/ticker_logos.py api/main.py tests/test_ticker_logos_router.py
git commit -m "feat(calendar): /api/ticker-logo endpoint with transparent-miss fallback"
```

---

### Task 3: Logo prewarmer

**Files:**
- Create: `api/services/ticker_logos_prewarm.py`
- Modify: `api/main.py` (near the ticker-names prewarm start, ~line 977)
- Test: `tests/test_ticker_logos_prewarm.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_ticker_logos_prewarm.py
from unittest import mock
from api.services import ticker_logos_prewarm as pw


def test_run_pass_skips_warm_and_resolves_cold():
    with mock.patch.object(pw, "_load_universe", return_value=["AAA", "BBB"]), \
         mock.patch("api.services.ticker_logos.get_logo_path", side_effect=["/x/AAA.png", None]), \
         mock.patch("api.services.ticker_logos.resolve_and_cache") as res, \
         mock.patch.object(pw.time, "sleep"):
        pw._run_pass()
    res.assert_called_once_with("BBB")


def test_start_async_respects_disable_env(monkeypatch):
    monkeypatch.setenv("TICKER_LOGOS_PREWARM_DISABLED", "1")
    with mock.patch.object(pw.threading, "Thread") as t:
        pw.start_async()
    t.assert_not_called()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_ticker_logos_prewarm.py -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation** (mirrors `ticker_names_prewarm.py`)

```python
# api/services/ticker_logos_prewarm.py
"""Background prewarmer that fills the logo_cache for every cap_universe
ticker. Daemon thread on startup; idempotent across reboots (skips tickers
already cached). Polite sleep between live fetches. Never raises.
Disable via TICKER_LOGOS_PREWARM_DISABLED=1."""
import json
import logging
import os
import threading
import time

_logger = logging.getLogger(__name__)


def _resolve_universe_path() -> str:
    here = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
    return here if os.path.exists(here) else os.path.join("api", "data", "cap_universe.json")


def _load_universe():
    try:
        with open(_resolve_universe_path(), "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, list):
            return [str(t).upper() for t in data if t]
    except Exception as e:
        _logger.warning("[logo-prewarm] cap_universe load failed: %s", e)
    return []


def _run_pass():
    from api.services import ticker_logos as tl
    universe = _load_universe()
    if not universe:
        return
    warmed = skipped = failed = 0
    started = time.time()
    _logger.info("[logo-prewarm] starting pass over %d tickers", len(universe))
    for i, ticker in enumerate(universe, 1):
        if tl.get_logo_path(ticker):
            skipped += 1
            continue
        try:
            ok = tl.resolve_and_cache(ticker)
            warmed += 1 if ok else 0
            failed += 0 if ok else 1
        except Exception:
            failed += 1
        time.sleep(0.25)
        if i % 200 == 0:
            _logger.info("[logo-prewarm] %d/%d warmed=%d skipped=%d failed=%d",
                         i, len(universe), warmed, skipped, failed)
    _logger.info("[logo-prewarm] done in %.1fs warmed=%d skipped=%d failed=%d",
                 time.time() - started, warmed, skipped, failed)


def start_async() -> None:
    if os.environ.get("TICKER_LOGOS_PREWARM_DISABLED") == "1":
        _logger.info("[logo-prewarm] disabled via env")
        return

    def _runner():
        time.sleep(90)  # let bars/names prewarmers take their initial flurry first
        try:
            _run_pass()
        except Exception as e:
            _logger.warning("[logo-prewarm] aborted: %s", e)

    threading.Thread(target=_runner, daemon=True, name="logo-prewarm").start()
```

- [ ] **Step 4: Start it in `api/main.py`** (next to the ticker-names prewarm block ~line 977)

```python
    try:
        from api.services.ticker_logos_prewarm import start_async as _logos_start
        _logos_start()
        print("[startup] ticker-logos prewarm scheduled")
    except Exception as e:
        print(f"[startup] ticker-logos prewarm scheduling failed (non-fatal): {e}")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/test_ticker_logos_prewarm.py -v`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add api/services/ticker_logos_prewarm.py api/main.py tests/test_ticker_logos_prewarm.py
git commit -m "feat(calendar): background logo prewarmer over cap_universe"
```

---

## Phase 2 — Backend: Personalization + enrichment

### Task 4: Personalization set helper + endpoint

**Files:**
- Create: `api/services/calendar_personalization.py`
- Modify: `api/routers/calendar.py` (add endpoint + import)
- Test: `tests/test_calendar_personalization.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_calendar_personalization.py
from unittest import mock
from api.services import calendar_personalization as cp


def test_get_user_ticker_sets_unions_sources():
    with mock.patch.object(cp, "_watchlist_syms", return_value={"AAPL", "MSFT"}), \
         mock.patch.object(cp, "_flagged_syms", return_value={"NVDA"}), \
         mock.patch.object(cp, "_position_syms", return_value={"TSLA"}), \
         mock.patch.object(cp, "_uct20_syms", return_value={"AAPL", "AMD"}):
        out = cp.get_user_ticker_sets("user-1")
    assert out["watchlist"] == {"AAPL", "MSFT"}
    assert out["flagged"] == {"NVDA"}
    assert out["positions"] == {"TSLA"}
    assert out["uct20"] == {"AAPL", "AMD"}
    assert out["all_mine"] == {"AAPL", "MSFT", "NVDA", "TSLA", "AMD"}


def test_sets_are_json_serializable_lists_via_endpoint_shape():
    out = cp.to_payload({"watchlist": {"AAPL"}, "flagged": set(),
                         "positions": set(), "uct20": set(), "all_mine": {"AAPL"}})
    assert out["watchlist"] == ["AAPL"]
    assert isinstance(out["all_mine"], list)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_calendar_personalization.py -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```python
# api/services/calendar_personalization.py
"""Assemble the user's personalization ticker sets for the Calendar:
watchlists + flagged + J2 open positions + UCT20. Each source is wrapped in
try/except so one failing source never blocks the others. Never raises."""
import logging
import sqlite3
import os

_logger = logging.getLogger(__name__)


def _auth_db_path() -> str:
    return os.path.join(os.environ.get("DATA_DIR", "/data"), "auth.db")


def _watchlist_syms(user_id: str) -> set:
    try:
        conn = sqlite3.connect(_auth_db_path())
        try:
            rows = conn.execute(
                """SELECT wi.sym FROM watchlist_items wi
                   JOIN watchlists w ON w.id = wi.watchlist_id
                   WHERE w.user_id = ?""", (user_id,)).fetchall()
        finally:
            conn.close()
        return {r[0].upper() for r in rows if r and r[0]}
    except Exception as e:
        _logger.info("watchlist syms failed: %s", e)
        return set()


def _flagged_syms(user_id: str) -> set:
    # Flagged is a watchlist with is_flagged_list=1 — already covered by the
    # join above, but expose separately so the UI can slice "Flagged" alone.
    try:
        conn = sqlite3.connect(_auth_db_path())
        try:
            rows = conn.execute(
                """SELECT wi.sym FROM watchlist_items wi
                   JOIN watchlists w ON w.id = wi.watchlist_id
                   WHERE w.user_id = ? AND w.is_flagged_list = 1""", (user_id,)).fetchall()
        finally:
            conn.close()
        return {r[0].upper() for r in rows if r and r[0]}
    except Exception as e:
        _logger.info("flagged syms failed: %s", e)
        return set()


def _position_syms(user_id: str) -> set:
    try:
        from api.services.journal_two import db as j2db  # noqa
        conn = sqlite3.connect(os.path.join(os.environ.get("DATA_DIR", "/data"), "auth.db"))
        try:
            rows = conn.execute(
                "SELECT DISTINCT sym FROM j2_positions WHERE user_id = ? AND status = 'open'",
                (user_id,)).fetchall()
        finally:
            conn.close()
        return {r[0].upper() for r in rows if r and r[0]}
    except Exception as e:
        _logger.info("position syms failed: %s", e)
        return set()


def _uct20_syms(user_id: str) -> set:
    try:
        from api.services.engine import _load_wire_data
        wire = _load_wire_data() or {}
        lead = wire.get("leadership") or wire.get("uct20") or []
        out = set()
        for item in lead:
            sym = item.get("sym") or item.get("ticker") if isinstance(item, dict) else item
            if sym:
                out.add(str(sym).upper())
        return out
    except Exception as e:
        _logger.info("uct20 syms failed: %s", e)
        return set()


def get_user_ticker_sets(user_id: str) -> dict:
    watchlist = _watchlist_syms(user_id)
    flagged = _flagged_syms(user_id)
    positions = _position_syms(user_id)
    uct20 = _uct20_syms(user_id)
    return {
        "watchlist": watchlist,
        "flagged": flagged,
        "positions": positions,
        "uct20": uct20,
        "all_mine": watchlist | flagged | positions | uct20,
    }


def to_payload(sets: dict) -> dict:
    return {k: sorted(v) for k, v in sets.items()}
```

- [ ] **Step 4: Add the endpoint to `api/routers/calendar.py`**

At the top with other imports:

```python
from fastapi import Depends
from api.routers.auth import get_current_user
from api.services import calendar_personalization as _cp
```

At the end of the file:

```python
@router.get("/api/calendar/my-sets")
def calendar_my_sets(user=Depends(get_current_user)):
    """Return the logged-in user's personalization ticker sets for the calendar."""
    sets = _cp.get_user_ticker_sets(user["id"])
    return _cp.to_payload(sets)
```

> Note: confirm the exact `get_current_user` import path and the user-id key (`user["id"]` vs `user.id`) by matching an existing authed route in `api/routers/watchlists.py`. Adjust to match.

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/test_calendar_personalization.py -v`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add api/services/calendar_personalization.py api/routers/calendar.py tests/test_calendar_personalization.py
git commit -m "feat(calendar): personalization ticker-set helper + /api/calendar/my-sets"
```

---

### Task 5: Enrichment overlay endpoint (expected move + beat history)

**Files:**
- Modify: `api/routers/calendar.py`
- Test: `tests/test_calendar_enrichment.py`

**Why an overlay:** keeps the base `/api/calendar` first-paint fast; the heavier per-ticker options/Finnhub data fills in via a second call the frontend overlays (same pattern as live prices).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_calendar_enrichment.py
from unittest import mock
from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)


def test_enrichment_returns_per_sym_move_and_history():
    cal = {"days": {"2026-06-02": {
        "bmo": [{"sym": "CRWD"}], "amc": [{"sym": "HPE"}]}}}
    with mock.patch("api.routers.calendar.cache.get", return_value=cal), \
         mock.patch("api.services.earnings_enrichment.get_implied_move",
                    side_effect=lambda s, earnings_date=None: {"pct": 9.1} if s == "CRWD" else None), \
         mock.patch("api.services.earnings_estimates.get_earnings_intel",
                    side_effect=lambda s: {"beat_history": [{"beat": True}]} if s == "CRWD" else None):
        r = client.get("/api/calendar/enrichment?date=2026-06-02")
    assert r.status_code == 200
    body = r.json()
    assert body["CRWD"]["expected_move"]["pct"] == 9.1
    assert body["CRWD"]["beat_history"] == [{"beat": True}]
    assert body["HPE"]["expected_move"] is None


def test_enrichment_empty_when_no_calendar_cache():
    with mock.patch("api.routers.calendar.cache.get", return_value=None):
        r = client.get("/api/calendar/enrichment?date=2026-06-02")
    assert r.status_code == 200
    assert r.json() == {}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_calendar_enrichment.py -v`
Expected: FAIL (404).

- [ ] **Step 3: Add the endpoint to `api/routers/calendar.py`**

```python
_ENRICH_TTL = 300  # 5 min — options move is itself 60s-cached upstream


@router.get("/api/calendar/enrichment")
def get_enrichment(date: str | None = None):
    """Per-ticker expected move + 4-quarter beat history for a given day.

    Bounded + cached so the core /api/calendar paints instantly and this
    overlays on top. Empty dict if the calendar cache isn't warm yet.
    """
    import re as _re
    from concurrent.futures import ThreadPoolExecutor
    if date and not _re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        return {}
    target = date or _today_et().isoformat()

    ck = f"calendar_enrichment_{target}"
    hit = cache.get(ck)
    if hit is not None:
        return hit

    cal = cache.get("calendar_weekly")
    if not cal:
        return {}
    day = cal.get("days", {}).get(target, {})
    syms = [e["sym"] for e in (day.get("bmo", []) + day.get("amc", [])) if e.get("sym")]
    if not syms:
        cache.set(ck, {}, ttl=_ENRICH_TTL)
        return {}

    from api.services.earnings_enrichment import get_implied_move
    from api.services.earnings_estimates import get_earnings_intel

    def _one(sym):
        move = None
        hist = None
        try:
            move = get_implied_move(sym, earnings_date=target)
        except Exception:
            pass
        try:
            intel = get_earnings_intel(sym)
            hist = intel.get("beat_history") if intel else None
        except Exception:
            pass
        return sym, {"expected_move": move, "beat_history": hist}

    out: dict = {}
    with ThreadPoolExecutor(max_workers=6) as ex:
        for sym, data in ex.map(_one, syms):
            out[sym] = data

    cache.set(ck, out, ttl=_ENRICH_TTL)
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_calendar_enrichment.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add api/routers/calendar.py tests/test_calendar_enrichment.py
git commit -m "feat(calendar): /api/calendar/enrichment overlay (expected move + beat history)"
```

---

## Phase 3 — Frontend: primitives

### Task 6: CompanyLogo component

**Files:**
- Create: `app/src/components/CompanyLogo.jsx`
- Create: `app/src/components/CompanyLogo.module.css`
- Test: `app/src/components/CompanyLogo.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/components/CompanyLogo.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import CompanyLogo from './CompanyLogo'

describe('CompanyLogo', () => {
  it('renders an img pointing at the logo endpoint', () => {
    render(<CompanyLogo sym="NVDA" />)
    const img = screen.getByAltText('NVDA logo')
    expect(img.getAttribute('src')).toBe('/api/ticker-logo/NVDA')
  })

  it('falls back to a monogram on image error', () => {
    render(<CompanyLogo sym="ZZZZ" />)
    const img = screen.getByAltText('ZZZZ logo')
    fireEvent.error(img)
    expect(screen.getByText('Z')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/CompanyLogo.test.jsx`
Expected: FAIL (component not found).

- [ ] **Step 3: Write the component**

```jsx
// app/src/components/CompanyLogo.jsx
import { useState } from 'react'
import styles from './CompanyLogo.module.css'

// Deterministic pleasant background from the symbol (stable across renders).
function bgFor(sym) {
  let h = 0
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) % 360
  return `hsl(${h} 32% 26%)`
}

export default function CompanyLogo({ sym, size = 38 }) {
  const [failed, setFailed] = useState(false)
  const s = (sym || '').toUpperCase()
  const px = `${size}px`
  if (failed || !s) {
    return (
      <span className={styles.mono} aria-label={`${s} logo`}
            style={{ width: px, height: px, background: bgFor(s), fontSize: size * 0.4 }}>
        {s.slice(0, 1) || '?'}
      </span>
    )
  }
  return (
    <span className={styles.wrap} style={{ width: px, height: px }}>
      <img className={styles.img} src={`/api/ticker-logo/${s}`} alt={`${s} logo`}
           loading="lazy" onError={() => setFailed(true)} />
    </span>
  )
}
```

```css
/* app/src/components/CompanyLogo.module.css */
.wrap { position: relative; display: inline-flex; border-radius: 9px; overflow: hidden;
        background: #212733; flex: none; }
.img  { width: 100%; height: 100%; object-fit: cover; background: #fff; }
.mono { display: inline-flex; align-items: center; justify-content: center;
        border-radius: 9px; color: #cfd6e0; font-weight: 800; flex: none; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/components/CompanyLogo.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/components/CompanyLogo.jsx app/src/components/CompanyLogo.module.css app/src/components/CompanyLogo.test.jsx
git commit -m "feat(calendar): CompanyLogo component with monogram fallback"
```

---

### Task 7: Calendar data hooks

**Files:**
- Create: `app/src/pages/calendar/useCalendarData.js`
- Test: `app/src/pages/calendar/useCalendarData.test.js`

This module holds pure helpers (testable) + SWR hooks (thin).

- [ ] **Step 1: Write the failing test**

```js
// app/src/pages/calendar/useCalendarData.test.js
import { describe, it, expect } from 'vitest'
import { buildWeekDates, mergeEnrichment, isMine } from './useCalendarData'

describe('calendar helpers', () => {
  it('buildWeekDates returns 5 weekday ISO strings', () => {
    const out = buildWeekDates('2026-06-01')
    expect(out).toEqual(['2026-06-01','2026-06-02','2026-06-03','2026-06-04','2026-06-05'])
  })

  it('mergeEnrichment attaches move + history onto entries', () => {
    const entry = { sym: 'CRWD' }
    const enr = { CRWD: { expected_move: { pct: 9.1 }, beat_history: [{ beat: true }] } }
    const out = mergeEnrichment(entry, enr)
    expect(out.expected_move.pct).toBe(9.1)
    expect(out.beat_history).toHaveLength(1)
  })

  it('isMine respects selected sources', () => {
    const sets = { watchlist: ['AAPL'], flagged: ['NVDA'], positions: [], uct20: [] }
    expect(isMine('AAPL', sets, ['watchlist'])).toBe(true)
    expect(isMine('NVDA', sets, ['watchlist'])).toBe(false)
    expect(isMine('NVDA', sets, ['watchlist','flagged'])).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/calendar/useCalendarData.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the module**

```js
// app/src/pages/calendar/useCalendarData.js
import useMobileSWR from '../../hooks/useMobileSWR'

const fetcher = (url) => fetch(url).then(r => r.ok ? r.json() : null)

export function buildWeekDates(weekStart) {
  if (!weekStart) return []
  const out = []
  const start = new Date(weekStart + 'T00:00:00')
  for (let i = 0; i < 5; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

export function mergeEnrichment(entry, enrichment) {
  const e = enrichment?.[entry.sym]
  if (!e) return entry
  return { ...entry, expected_move: e.expected_move, beat_history: e.beat_history }
}

export function isMine(sym, sets, sources) {
  if (!sym || !sets) return false
  const S = sym.toUpperCase()
  return (sources || []).some(src => (sets[src] || []).includes(S))
}

export function useCalendar() {
  return useMobileSWR('/api/calendar', fetcher, {
    refreshInterval: 2 * 60 * 1000, revalidateOnFocus: false, marketHoursOnly: true,
  })
}

export function useCalendarMySets() {
  return useMobileSWR('/api/calendar/my-sets', fetcher, {
    refreshInterval: 5 * 60 * 1000, revalidateOnFocus: false,
  })
}

export function useEnrichment(activeDate) {
  return useMobileSWR(
    activeDate ? `/api/calendar/enrichment?date=${activeDate}` : null,
    fetcher,
    { refreshInterval: 5 * 60 * 1000, revalidateOnFocus: false, marketHoursOnly: true },
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/calendar/useCalendarData.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/calendar/useCalendarData.js app/src/pages/calendar/useCalendarData.test.js
git commit -m "feat(calendar): data hooks + pure helpers (week dates, enrichment merge, isMine)"
```

---

### Task 8: Filter/sort reducer

**Files:**
- Create: `app/src/pages/calendar/filterLogic.js`
- Test: `app/src/pages/calendar/filterLogic.test.js`

- [ ] **Step 1: Write the failing test**

```js
// app/src/pages/calendar/filterLogic.test.js
import { describe, it, expect } from 'vitest'
import { applyFilters, sortEntries, DEFAULT_FILTERS } from './filterLogic'

const rows = [
  { sym: 'AAA', mine: true,  mc_b: 5,  expected_move: { pct: 3 } },
  { sym: 'BBB', mine: false, mc_b: 50, expected_move: { pct: 9 } },
  { sym: 'CCC', mine: false, mc_b: 0.1, expected_move: null },
]

describe('filterLogic', () => {
  it('audience=mine keeps only mine', () => {
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, audience: 'mine' })
    expect(out.map(r => r.sym)).toEqual(['AAA'])
  })

  it('minMcap drops sub-threshold names', () => {
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, minMcap: 1 })
    expect(out.map(r => r.sym)).toEqual(['AAA', 'BBB'])
  })

  it('sort by expected move desc, nulls last', () => {
    const out = sortEntries(rows, 'move')
    expect(out.map(r => r.sym)).toEqual(['BBB', 'AAA', 'CCC'])
  })

  it('sort mine-first keeps mine ahead', () => {
    const out = sortEntries(rows, 'mine')
    expect(out[0].sym).toBe('AAA')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/calendar/filterLogic.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the module**

```js
// app/src/pages/calendar/filterLogic.js
export const DEFAULT_FILTERS = {
  audience: 'mine',   // 'mine' | 'watchlist' | 'positions' | 'uct20' | 'all'
  minMcap: 0,         // billions
  sort: 'mine',       // 'mine' | 'time' | 'mcap' | 'move'
}

export function applyFilters(rows, f) {
  let out = rows
  if (f.audience === 'mine') out = out.filter(r => r.mine)
  else if (f.audience !== 'all') out = out.filter(r => r._sources?.includes(f.audience))
  if (f.minMcap > 0) out = out.filter(r => (r.mc_b ?? Infinity) >= f.minMcap)
  return out
}

export function sortEntries(rows, sort) {
  const copy = [...rows]
  if (sort === 'mcap') copy.sort((a, b) => (b.mc_b ?? 0) - (a.mc_b ?? 0))
  else if (sort === 'move')
    copy.sort((a, b) => (b.expected_move?.pct ?? -1) - (a.expected_move?.pct ?? -1))
  else if (sort === 'mine')
    copy.sort((a, b) => (b.mine === true) - (a.mine === true))
  // 'time' = preserve incoming BMO/AMC order
  return copy
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/calendar/filterLogic.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/calendar/filterLogic.js app/src/pages/calendar/filterLogic.test.js
git commit -m "feat(calendar): filter + sort pure logic"
```

---

## Phase 4 — Frontend: presentational components

> These are visual components; verify in the browser (`cd app && npm run dev` → `/calendar`). Each commits independently. The page wiring in Task 13 makes them live.

### Task 9: EarningsCard (pending + reported states)

**Files:**
- Create: `app/src/pages/calendar/EarningsCard.jsx`
- Create: `app/src/pages/calendar/Calendar.module.css` (start the stylesheet here; later tasks append)

- [ ] **Step 1: Implement the card** (mirror the approved mockup `feed-polished.html`)

```jsx
// app/src/pages/calendar/EarningsCard.jsx
import CompanyLogo from '../../components/CompanyLogo'
import TickerActions from '../../components/TickerActions'
import styles from './Calendar.module.css'

function fmtEps(v) { return v == null ? '—' : `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}` }
function fmtRev(v) { if (v == null) return '—'; return v >= 1000 ? `$${(v/1000).toFixed(1)}B` : `$${Math.round(v)}M` }
function surprise(a, e) { if (a == null || e == null || e === 0) return null
  const p = ((a - e) / Math.abs(e)) * 100; return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%` }

export default function EarningsCard({ entry, timing, livePrice, reaction, onSelect }) {
  const reported = entry.eps_act != null
  const beats = (entry.beat_history || []).slice(0, 4).reverse()
  const beatCount = beats.filter(b => b.beat === true).length
  const em = entry.expected_move?.pct
  const px = livePrice != null ? `$${livePrice.toFixed(2)}` : '—'

  return (
    <TickerActions sym={entry.sym}>
      <div className={`${styles.card} ${entry.mine ? styles.cardMine : ''}`}
           onClick={() => onSelect(entry, timing)}>
        {entry.mine && <span className={styles.star}>★</span>}
        <div className={styles.cardTop}>
          <CompanyLogo sym={entry.sym} size={38} />
          <div>
            <div className={styles.sym}>
              {entry.sym}
              <span className={`${styles.tpill} ${timing === 'bmo' ? styles.bmo : styles.amc}`}>
                {timing.toUpperCase()}
              </span>
              {reported && <span className={styles.beatPill}>{
                surprise(entry.eps_act, entry.eps_est)?.startsWith('-') ? 'MISS' : 'BEAT'}</span>}
            </div>
            <div className={styles.nm}>{entry.name || ''}</div>
          </div>
        </div>

        {!reported ? (
          <>
            <div className={styles.met}><span className={styles.dim}>EPS est</span><span className={styles.mono}>{fmtEps(entry.eps_est)}</span></div>
            <div className={styles.met}><span className={styles.dim}>Rev est</span><span className={styles.mono}>{fmtRev(entry.rev_est)}</span></div>
            <div className={styles.met}><span className={styles.dim}>Price</span><span className={styles.mono}>{px}</span></div>
            {em != null && (
              <div className={styles.emv}><span className={styles.emvLbl}>Expected move</span><span className={styles.emvBig}>±{em}%</span></div>
            )}
            {beats.length > 0 && (
              <div className={styles.hist}>
                {beats.map((b, i) => (
                  <i key={i} className={b.beat ? styles.histPos : styles.histNeg}
                     style={{ height: `${40 + i * 12}%` }} />
                ))}
                <span className={styles.histLbl}>{beatCount}/{beats.length} beat</span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className={styles.met}><span className={styles.dim}>EPS</span>
              <span className={styles.mono}><span className={styles.dim}>{fmtEps(entry.eps_est)}→ </span>{fmtEps(entry.eps_act)}</span></div>
            <div className={styles.met}><span className={styles.dim}>Surprise</span>
              <span className={styles.mono}>{surprise(entry.eps_act, entry.eps_est) ?? '—'}</span></div>
            <div className={styles.met}><span className={styles.dim}>Revenue</span>
              <span className={styles.mono}>{fmtRev(entry.rev_act)} <span className={styles.dim}>/ {fmtRev(entry.rev_est)}</span></span></div>
            {reaction != null && (
              <div className={styles.react}><span className={styles.dim}>Post-print gap</span>
                <span className={reaction >= 0 ? styles.pos : styles.neg}>
                  {reaction >= 0 ? '▲ +' : '▼ '}{reaction.toFixed(1)}%</span></div>
            )}
          </>
        )}
      </div>
    </TickerActions>
  )
}
```

- [ ] **Step 2: Add the card + base CSS to `Calendar.module.css`**

Port the card-relevant classes from `.superpowers/brainstorm/690-1780360424/content/feed-polished.html` (`.card`, `.cardMine`, `.star`, `.cardTop`, `.sym`, `.nm`, `.tpill/.bmo/.amc`, `.met`, `.mono`, `.dim`, `.emv*`, `.hist*`, `.beatPill`, `.react`, `.pos`, `.neg`) into `app/src/pages/calendar/Calendar.module.css`, using the dashboard CSS variable tokens where they exist.

- [ ] **Step 3: Verify** the file compiles (no test — visual). `cd app && npm run build` must succeed.

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/calendar/EarningsCard.jsx app/src/pages/calendar/Calendar.module.css
git commit -m "feat(calendar): EarningsCard (pending + reported states) + base styles"
```

---

### Task 10: MacroBand + WeekSummary

**Files:**
- Create: `app/src/pages/calendar/MacroBand.jsx`
- Create: `app/src/pages/calendar/WeekSummary.jsx`
- Modify: `app/src/pages/calendar/Calendar.module.css` (append)

- [ ] **Step 1: Implement MacroBand** (renders a day's econ + fed arrays)

```jsx
// app/src/pages/calendar/MacroBand.jsx
import styles from './Calendar.module.css'

export default function MacroBand({ econ = [], fed = [] }) {
  if (!econ.length && !fed.length) return null
  return (
    <div className={styles.macroband}>
      {econ.map((ev, i) => (
        <span key={`e${i}`} className={styles.mtag}>
          <span className={styles.mtagTm}>{ev.time || '—'}</span>
          <span className={ev.is_key ? styles.mtagKey : ''}>{ev.is_key ? '★ ' : ''}{ev.event}</span>
          {ev.actual && <span className={styles.pos}> A:{ev.actual}</span>}
        </span>
      ))}
      {fed.map((ev, i) => (
        <span key={`f${i}`} className={styles.mtag}>
          <span className={styles.mtagTm}>{ev.time || '—'}</span>
          <span className={styles.mtagFed}>🎙 {ev.event}</span>
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Implement WeekSummary**

```jsx
// app/src/pages/calendar/WeekSummary.jsx
import styles from './Calendar.module.css'

export default function WeekSummary({ stats }) {
  if (!stats) return null
  const col = (lbl, val, cls = '') => (
    <div className={styles.scol}><span className={styles.scolLbl}>{lbl}</span>
      <b className={cls}>{val}</b></div>
  )
  return (
    <div className={styles.summary}>
      {col('Your reports this week', stats.mineCount, styles.gold)}
      {col('Total reporters', stats.total)}
      {col('Macro prints', stats.macroCount)}
      {stats.biggestMove && col('Biggest expected move', `${stats.biggestMove.sym} ±${stats.biggestMove.pct}%`, styles.gold)}
      {stats.next && col('Next of yours', stats.next, styles.blue)}
    </div>
  )
}
```

- [ ] **Step 3: Append the macroband + summary classes** to `Calendar.module.css` (port `.macroband`, `.mtag*`, `.summary`, `.scol*` from the mockup).

- [ ] **Step 4: Verify** `cd app && npm run build` succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/calendar/MacroBand.jsx app/src/pages/calendar/WeekSummary.jsx app/src/pages/calendar/Calendar.module.css
git commit -m "feat(calendar): MacroBand + WeekSummary components"
```

---

### Task 11: FeedView + DayGroup

**Files:**
- Create: `app/src/pages/calendar/FeedView.jsx`
- Modify: `app/src/pages/calendar/Calendar.module.css` (append day-group + grid classes, `@container`)

- [ ] **Step 1: Implement FeedView**

```jsx
// app/src/pages/calendar/FeedView.jsx
import { useMemo } from 'react'
import useRealtimePrices from '../../hooks/useRealtimePrices'
import EarningsCard from './EarningsCard'
import MacroBand from './MacroBand'
import { applyFilters, sortEntries } from './filterLogic'
import styles from './Calendar.module.css'

function DayGroup({ ds, day, filters, onSelect, reactions }) {
  const bmo = (day.bmo || []).map(e => ({ ...e, _timing: 'bmo' }))
  const amc = (day.amc || []).map(e => ({ ...e, _timing: 'amc' }))
  let entries = [...bmo, ...amc]
  entries = applyFilters(entries, filters)
  entries = sortEntries(entries, filters.sort)

  const syms = useMemo(() => entries.map(e => e.sym), [entries])
  const { prices } = useRealtimePrices(syms)
  if (!entries.length && !(day.econ?.length || day.fed?.length)) return null

  const mineN = entries.filter(e => e.mine).length
  return (
    <div className={styles.daygrp}>
      <div className={styles.dayhd}>
        <span className={styles.d1}>{(day.label || ds).toUpperCase()}</span>
        <span className={styles.d2}>{entries.length} reporters</span>
        <span className={styles.ln} />
        {mineN > 0 && <span className={styles.mineN}>{mineN} of yours</span>}
      </div>
      <MacroBand econ={day.econ} fed={day.fed} />
      <div className={styles.cards}>
        {entries.map(e => (
          <EarningsCard key={e.sym} entry={e} timing={e._timing}
            livePrice={prices[e.sym]?.price} reaction={reactions?.[e.sym]}
            onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

export default function FeedView({ weekDates, days, filters, onSelect, reactionsByDate }) {
  return (
    <div className={styles.feed}>
      {weekDates.map(ds => days[ds]
        ? <DayGroup key={ds} ds={ds} day={days[ds]} filters={filters}
            onSelect={onSelect} reactions={reactionsByDate?.[ds]} /> : null)}
    </div>
  )
}
```

- [ ] **Step 2: Append** `.feed`, `.daygrp`, `.dayhd`, `.d1`, `.d2`, `.ln`, `.mineN`, `.cards` to `Calendar.module.css`. The `.cards` grid uses `@container` (root `container-type: inline-size` on the page body) collapsing 3→2→1, mirroring the Charts V2 pattern.

- [ ] **Step 3: Verify** `cd app && npm run build` succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/calendar/FeedView.jsx app/src/pages/calendar/Calendar.module.css
git commit -m "feat(calendar): FeedView + DayGroup with live prices"
```

---

### Task 12: WeekView + MonthView + DayDetailDrawer

**Files:**
- Create: `app/src/pages/calendar/WeekView.jsx`
- Create: `app/src/pages/calendar/MonthView.jsx`
- Create: `app/src/pages/calendar/DayDetailDrawer.jsx`
- Modify: `app/src/pages/calendar/Calendar.module.css` (append)

- [ ] **Step 1: WeekView** — 5 columns, logo rows per reporter, BMO/AMC subgroups.

```jsx
// app/src/pages/calendar/WeekView.jsx
import CompanyLogo from '../../components/CompanyLogo'
import { applyFilters, sortEntries } from './filterLogic'
import styles from './Calendar.module.css'

export default function WeekView({ weekDates, days, filters, onSelect }) {
  return (
    <div className={styles.weekgrid}>
      {weekDates.map(ds => {
        const day = days[ds]; if (!day) return null
        const rows = sortEntries(applyFilters(
          [...(day.bmo||[]).map(e=>({...e,_timing:'bmo'})),
           ...(day.amc||[]).map(e=>({...e,_timing:'amc'}))], filters), filters.sort)
        return (
          <div key={ds} className={`${styles.wcol} ${day.is_today ? styles.wcolToday : ''}`}>
            <div className={styles.wd}>{day.label || ds}</div>
            {rows.map(e => (
              <div key={e.sym} className={styles.wrow} onClick={() => onSelect(e, e._timing)}>
                <CompanyLogo sym={e.sym} size={20} />
                <span className={`${styles.t} ${e.mine ? styles.gold : ''}`}>{e.sym}</span>
                <span className={styles.v}>{e._timing.toUpperCase()}</span>
              </div>
            ))}
            {!rows.length && <div className={styles.emptyBucket}>—</div>}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: MonthView** — logo-packed grid; clicking a day calls `onOpenDay(ds)`.

```jsx
// app/src/pages/calendar/MonthView.jsx
import CompanyLogo from '../../components/CompanyLogo'
import styles from './Calendar.module.css'

// monthDays: [{ ds, dayNum, inMonth, isToday, syms:[...], mineSyms:Set, hasMacro }]
export default function MonthView({ monthDays, onOpenDay }) {
  return (
    <>
      <div className={styles.mgridHd}>
        {['Mon','Tue','Wed','Thu','Fri'].map(d => <div key={d} className={styles.scolLbl}>{d}</div>)}
      </div>
      <div className={styles.mgrid}>
        {monthDays.map(c => (
          <div key={c.ds} className={`${styles.gcell} ${c.isToday ? styles.gcellToday : ''} ${c.inMonth ? '' : styles.gcellOff}`}
               onClick={() => onOpenDay(c.ds)}>
            <div className={styles.dn}>{c.dayNum}{c.hasMacro ? ' ★' : ''}</div>
            <div className={styles.glogos}>
              {c.syms.slice(0, 6).map(s => (
                <span key={s} className={c.mineSyms.has(s) ? styles.mineRing : ''}>
                  <CompanyLogo sym={s} size={18} />
                </span>
              ))}
              {c.syms.length > 6 && <span className={styles.gmore}>+{c.syms.length - 6}</span>}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
```

- [ ] **Step 3: DayDetailDrawer** — slide-out reusing a single DayGroup-style render.

```jsx
// app/src/pages/calendar/DayDetailDrawer.jsx
import { useEffect } from 'react'
import EarningsCard from './EarningsCard'
import MacroBand from './MacroBand'
import styles from './Calendar.module.css'

export default function DayDetailDrawer({ ds, day, onClose, onSelect }) {
  useEffect(() => {
    const h = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  if (!day) return null
  const rows = [...(day.bmo||[]).map(e=>({...e,_timing:'bmo'})),
               ...(day.amc||[]).map(e=>({...e,_timing:'amc'}))]
  return (
    <div className={styles.drawerBackdrop} onClick={onClose}>
      <div className={styles.drawer} onClick={e => e.stopPropagation()}>
        <div className={styles.drawerHd}>{day.label || ds}<button onClick={onClose}>✕</button></div>
        <MacroBand econ={day.econ} fed={day.fed} />
        <div className={styles.cards}>
          {rows.map(e => <EarningsCard key={e.sym} entry={e} timing={e._timing} onSelect={onSelect} />)}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Append** week/month/drawer classes to `Calendar.module.css` (port `.weekgrid`, `.wcol*`, `.wrow`, `.mgrid*`, `.gcell*`, `.glogos`, `.mineRing`, `.gmore`, `.drawer*`).

- [ ] **Step 5: Verify** `cd app && npm run build` succeeds.

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/calendar/WeekView.jsx app/src/pages/calendar/MonthView.jsx app/src/pages/calendar/DayDetailDrawer.jsx app/src/pages/calendar/Calendar.module.css
git commit -m "feat(calendar): Week, Month, and DayDetail drawer views"
```

---

## Phase 5 — Frontend: header, page wiring, polish

### Task 13: CalendarHeader + filters (view toggle, search, My Stocks ⚙)

**Files:**
- Create: `app/src/pages/calendar/CalendarHeader.jsx`
- Modify: `app/src/pages/calendar/Calendar.module.css` (append)

- [ ] **Step 1: Implement the header** (view toggle, ticker search via existing `SymbolSearch`, audience/sort chips, My-Stocks source customizer popover persisted via `usePreferences`).

```jsx
// app/src/pages/calendar/CalendarHeader.jsx
import { useState } from 'react'
import styles from './Calendar.module.css'

const AUDIENCE = [
  ['mine', '★ My Stocks'], ['watchlist', 'Watchlist'], ['positions', 'Positions'],
  ['uct20', 'UCT20'], ['all', 'All ($300M+)'],
]
const SORTS = [['mine', 'My stocks first'], ['time', 'Time'], ['mcap', 'Market cap'], ['move', 'Expected move']]
const SOURCES = [['watchlist','Watchlists'],['flagged','Flagged'],['positions','Positions'],['uct20','UCT20']]

export default function CalendarHeader({ view, setView, weekLabel, filters, setFilters,
                                         mySources, setMySources }) {
  const [gear, setGear] = useState(false)
  const set = (k, v) => setFilters({ ...filters, [k]: v })
  const toggleSource = s => setMySources(
    mySources.includes(s) ? mySources.filter(x => x !== s) : [...mySources, s])

  return (
    <div className={styles.header}>
      <div className={styles.hrow}>
        <span className={styles.ttl}>📅 Calendar</span>
        <span className={styles.view}>
          {['Feed','Week','Month'].map(v => (
            <span key={v} className={view === v.toLowerCase() ? styles.viewOn : ''}
                  onClick={() => setView(v.toLowerCase())}>{v}</span>
          ))}
        </span>
        <span className={styles.wk}>{weekLabel}</span>
        <span className={styles.gearWrap}>
          <button className={styles.mystk} onClick={() => setGear(g => !g)}>★ My Stocks ⚙</button>
          {gear && (
            <div className={styles.gearPop}>
              <div className={styles.scolLbl}>Count toward "My Stocks":</div>
              {SOURCES.map(([k, lbl]) => (
                <label key={k} className={styles.gearRow}>
                  <input type="checkbox" checked={mySources.includes(k)} onChange={() => toggleSource(k)} /> {lbl}
                </label>
              ))}
            </div>
          )}
        </span>
      </div>
      <div className={styles.fb}>
        {AUDIENCE.map(([k, lbl]) => (
          <span key={k} className={`${styles.chip} ${filters.audience === k ? styles.chipOn : ''}`}
                onClick={() => set('audience', k)}>{lbl}</span>
        ))}
        <span className={styles.sep} />
        <select className={styles.sel} value={filters.minMcap}
                onChange={e => set('minMcap', Number(e.target.value))}>
          <option value={0}>Any cap</option><option value={2}>$2B+</option>
          <option value={10}>$10B+</option><option value={50}>$50B+</option>
        </select>
        <select className={styles.sel} value={filters.sort} onChange={e => set('sort', e.target.value)}>
          {SORTS.map(([k, lbl]) => <option key={k} value={k}>Sort: {lbl}</option>)}
        </select>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Append** header/filter classes to `Calendar.module.css` (`.header`, `.hrow`, `.ttl`, `.view`, `.viewOn`, `.wk`, `.mystk`, `.gearWrap`, `.gearPop`, `.gearRow`, `.fb`, `.chip`, `.chipOn`, `.sep`, `.sel`).

- [ ] **Step 3: Verify** `cd app && npm run build` succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/calendar/CalendarHeader.jsx app/src/pages/calendar/Calendar.module.css
git commit -m "feat(calendar): CalendarHeader with view toggle, filters, My Stocks customizer"
```

---

### Task 14: Wire the page together

**Files:**
- Rewrite: `app/src/pages/Calendar.jsx` (the route entry — keep the path so routing/nav is unchanged)
- Reuse: existing `EarningsModal`, `ErrorBoundary`

- [ ] **Step 1: Implement the page** — compose header + views + modal; tag entries `mine`/`_sources`; overlay enrichment; build month grid + week summary; mobile (`<640px`) renders Feed only.

```jsx
// app/src/pages/Calendar.jsx
import { useState, useMemo } from 'react'
import ErrorBoundary from '../components/ErrorBoundary'
import EarningsModal from '../components/tiles/EarningsModal'
import usePreferences from '../hooks/usePreferences'
import useMobileSWR from '../hooks/useMobileSWR'
import { useCalendar, useCalendarMySets, buildWeekDates, mergeEnrichment, isMine } from './calendar/useCalendarData'
import { DEFAULT_FILTERS } from './calendar/filterLogic'
import CalendarHeader from './calendar/CalendarHeader'
import FeedView from './calendar/FeedView'
import WeekView from './calendar/WeekView'
import MonthView from './calendar/MonthView'
import DayDetailDrawer from './calendar/DayDetailDrawer'
import WeekSummary from './calendar/WeekSummary'
import styles from './calendar/Calendar.module.css'

const fetcher = u => fetch(u).then(r => r.ok ? r.json() : null)
const ALL_SOURCES = ['watchlist', 'flagged', 'positions', 'uct20']

export default function Calendar() {
  const { data, error } = useCalendar()
  const { data: mySets } = useCalendarMySets()
  const { prefs, setPref } = usePreferences()
  const [selected, setSelected] = useState(null)
  const [openDay, setOpenDay] = useState(null)

  const view = prefs.calendar_view || 'feed'
  const filters = { ...DEFAULT_FILTERS, ...(prefs.calendar_filters || {}) }
  const mySources = prefs.calendar_mystocks_sources || ALL_SOURCES
  const setView = v => setPref('calendar_view', v)
  const setFilters = f => setPref('calendar_filters', f)
  const setMySources = s => setPref('calendar_mystocks_sources', s)

  const weekDates = useMemo(() => data?.week_start
    ? buildWeekDates(data.week_start)
    : Object.keys(data?.days || {}).sort(), [data])

  // Enrichment overlay for all visible days (one call per day, deduped by SWR).
  const enrichment = {}
  weekDates.forEach(ds => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { data: e } = useMobileSWR(`/api/calendar/enrichment?date=${ds}`, fetcher,
      { refreshInterval: 300000, revalidateOnFocus: false, marketHoursOnly: true })
    if (e) enrichment[ds] = e
  })

  // Tag + enrich every entry.
  const days = useMemo(() => {
    const out = {}
    for (const ds of weekDates) {
      const d = data?.days?.[ds]; if (!d) continue
      const tag = list => (list || []).map(e => {
        const mine = isMine(e.sym, mySets, mySources)
        const sources = ALL_SOURCES.filter(s => (mySets?.[s] || []).includes(e.sym?.toUpperCase()))
        return { ...mergeEnrichment(e, enrichment[ds]), mine, _sources: sources }
      })
      out[ds] = { ...d, bmo: tag(d.bmo), amc: tag(d.amc) }
    }
    return out
  }, [data, weekDates, mySets, mySources, enrichment])

  const summary = useMemo(() => {
    let mineCount = 0, total = 0, macroCount = 0, biggest = null
    for (const ds of weekDates) {
      const d = days[ds]; if (!d) continue
      const all = [...(d.bmo||[]), ...(d.amc||[])]
      total += all.length
      mineCount += all.filter(e => e.mine).length
      macroCount += (d.econ?.filter(e => e.is_key).length || 0) + (d.fed?.length || 0)
      for (const e of all) {
        const pct = e.expected_move?.pct
        if (pct != null && (!biggest || pct > biggest.pct)) biggest = { sym: e.sym, pct }
      }
    }
    return { mineCount, total, macroCount, biggestMove: biggest }
  }, [days, weekDates])

  if (error) return <div className={styles.page}><div className={styles.error}>Failed to load calendar.</div></div>
  if (!data) return <div className={styles.page}><div className={styles.loading}>Loading calendar…</div></div>

  const weekLabel = data.week_start && data.week_end ? `${data.week_start} – ${data.week_end}` : ''
  const onSelect = (entry, timing) =>
    setSelected({ row: { sym: entry.sym, reported_eps: entry.eps_act, eps_estimate: entry.eps_est },
                  label: timing === 'bmo' ? 'BEFORE MARKET OPEN' : 'AFTER MARKET CLOSE' })

  return (
    <div className={styles.page}>
      <CalendarHeader view={view} setView={setView} weekLabel={weekLabel}
        filters={filters} setFilters={setFilters} mySources={mySources} setMySources={setMySources} />

      {view !== 'month' && <WeekSummary stats={summary} />}

      <div className={styles.body}>
        {view === 'feed'  && <FeedView weekDates={weekDates} days={days} filters={filters} onSelect={onSelect} />}
        {view === 'week'  && <WeekView weekDates={weekDates} days={days} filters={filters} onSelect={onSelect} />}
        {view === 'month' && <MonthView monthDays={buildMonthGrid(days, weekDates)} onOpenDay={setOpenDay} />}
      </div>

      {openDay && <DayDetailDrawer ds={openDay} day={days[openDay]}
        onClose={() => setOpenDay(null)} onSelect={onSelect} />}

      {selected && (
        <ErrorBoundary fallback={<div />} key={selected.row.sym}>
          <EarningsModal row={selected.row} label={selected.label} onClose={() => setSelected(null)} />
        </ErrorBoundary>
      )}
    </div>
  )
}

// Minimal month grid from the loaded week(s); full month fill can expand later.
function buildMonthGrid(days, weekDates) {
  return weekDates.map(ds => {
    const d = days[ds] || {}
    const syms = [...(d.bmo||[]), ...(d.amc||[])].map(e => e.sym)
    const mineSyms = new Set([...(d.bmo||[]), ...(d.amc||[])].filter(e => e.mine).map(e => e.sym))
    return { ds, dayNum: ds.slice(8), inMonth: true, isToday: !!d.is_today,
             syms, mineSyms, hasMacro: !!(d.econ?.some(e => e.is_key) || d.fed?.length) }
  })
}
```

> **EarningsModal row shape:** match the existing `toModalRow` mapping from the current `Calendar.jsx` (surprise_pct, rev fields, verdict) — reuse that exact helper rather than the trimmed inline version above so the modal renders identically.

- [ ] **Step 2: Verify build + dev**

Run: `cd app && npm run build`
Expected: build succeeds. Then `npm run dev`, open `/calendar`, confirm Feed renders with logos, filters work, view toggle switches, clicking a card opens EarningsModal.

- [ ] **Step 3: Commit**

```bash
git add app/src/pages/Calendar.jsx
git commit -m "feat(calendar): wire dominant-feed page (header + views + enrichment overlay + modal)"
```

---

### Task 15: Mobile + final verification + push

- [ ] **Step 1: Mobile fallback** — in `Calendar.module.css`, ensure `<640px` forces the Feed view single-column (`.cards` → 1 col) and hides the Week/Month toggle buttons gracefully (or lets them work but with the container-query single-column cards).

- [ ] **Step 2: Run the full relevant test suites**

Run: `python -m pytest tests/test_ticker_logos.py tests/test_ticker_logos_router.py tests/test_ticker_logos_prewarm.py tests/test_calendar_personalization.py tests/test_calendar_enrichment.py -v`
Expected: all PASS.

Run: `cd app && npx vitest run src/components/CompanyLogo.test.jsx src/pages/calendar/`
Expected: all PASS.

- [ ] **Step 3: Production build gate** (per `feedback_vite_manualchunks_object_form` — always build before pushing)

Run: `cd app && npm run build`
Expected: succeeds, no white-screen-risk chunking errors.

- [ ] **Step 4: Commit any final CSS + push to Railway**

```bash
git add -A
git commit -m "feat(calendar): mobile polish + final verification"
git push
```

---

## Self-review notes (coverage check vs spec)

- §4 Views (Feed/Week/Month) → Tasks 11, 12, 14 ✅
- §5 Card anatomy (expected move, history, reported flip, countdown*) → Task 9 ✅ (*countdown text can be derived from timing; add `entry.when` if a precise time field exists — optional polish)
- §6 Logo subsystem (service/endpoint/prewarm + fallback) → Tasks 1–3, 6 ✅
- §7 Personalization (sets + customizer) → Tasks 4, 13, 14 ✅
- §8 Filters & sort (audience, mcap, sort) → Tasks 8, 13 ✅ (avg-vol/price-range filters deferred to polish — `day-metrics` already provides them; wire later if wanted)
- §9 Enrichment overlay endpoint → Task 5 ✅
- §11 Invariants (bounded, cached, graceful null, polite prewarm) → Tasks 1–5 ✅
- §12 Phasing — IPO/dividends/alerts correctly NOT in these tasks ✅

**Known follow-ups (intentionally deferred, not blockers):** precise per-ticker report time for countdown; avg-vol/price-range filters; full 4-week month grid fill (Task 14 builds the loaded week(s) only — expand `buildMonthGrid` + a month data endpoint in Phase 2).
