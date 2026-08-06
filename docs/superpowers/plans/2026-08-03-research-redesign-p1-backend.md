# Research Redesign P1-Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the in-house expected-move service (Massive options chains), the nightly implied-move + grade snapshot store, and the API endpoint the redesigned modal will consume — the time-critical, UI-independent half of Phase 1.

**Architecture:** A pure computation module (`implied_move.py`) over a fixed `polygon_options.get_chain` (pagination + symbol mapping + explicit expiry), fronted by ServeStale caching; a web-side SQLite store (`/data/implied_moves.db`, cot.db idiom) filled by a post-close APScheduler job bounded to symbols reporting within 14 days; a new auth-gated router exposing live + historical values. Everything flag-gated (`IMPLIED_STORE_ENABLED`), dark by default.

**Tech Stack:** FastAPI, httpx, SQLite (WAL), APScheduler (existing `_scheduler` + `_ET` in `api/main.py`), pytest. No new dependencies.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-03-research-calendar-redesign-design.md` §6 (rev 3). Worktree: `C:\Users\Patrick\uct-worktrees\research-redesign`, branch `feat/research-calendar-redesign`.
- Never cache or store a failed/empty fetch as a value. New caches use `ServeStale` (`api/services/serve_stale.py`, on master) beside `TTLCache` — never a bare TTL in front of a fan-out.
- Apply `massive.to_polygon_symbol` at the Massive REST boundary ONLY (BRK-B→BRK.B).
- Capture timing: post-close PRE-report (never morning-after — IV-crush poisons history). Store bounded to symbols reporting within 14 days.
- All datetimes ET-aware via `zoneinfo.ZoneInfo("America/New_York")`; tests inject `now`/dates (no weekend-only time bombs, no `date.today()` in logic paths).
- Any blocking external call has a timeout (launch-hardening rule). No per-request unthrottled DB writes.
- Do not touch partner-owned files (`live_massive_router.py`, `massive_ws_worker.py`, `massive_processor.py`, `schwab_router.py`, `OptionsFlow.jsx`). Do not modify `earnings_enrichment.get_implied_move` (calendar live path) in this plan — the enrichment cutover is P2, behind a flag.
- Commit after every task; never `git add -A` (shared-worktree rule).

## File Structure

- `api/services/polygon_options.py` — MODIFY: pagination + symbol mapping in `get_chain`; no interface break for existing voice callers.
- `api/services/implied_move.py` — CREATE: expiry selection + ATM straddle math + ServeStale-fronted `get_expected_move`.
- `api/services/implied_store.py` — CREATE: SQLite store (implied snapshots + grade snapshots) + `upcoming_reporters` + `run_nightly_capture`.
- `api/routers/expected_move.py` — CREATE: `GET /api/research/expected-move/{sym}` (auth-gated).
- `api/main.py` — MODIFY: router include + scheduler job (flag-gated).
- `tools/implied_backfill_probe.py` — CREATE: manual read-only coverage probe.
- Tests: `tests/test_implied_move.py`, `tests/test_implied_store.py`, `tests/test_expected_move_router.py`.

---

### Task 1: Fix `polygon_options.get_chain` — pagination + symbol mapping

**Files:**
- Modify: `api/services/polygon_options.py:130-201` (`get_chain`)
- Test: `tests/test_polygon_options_chain.py` (create)

**Interfaces:**
- Consumes: existing `_safe_get`, `_normalize_contract`, `_CACHE`; `massive.to_polygon_symbol` (`api/services/massive.py:39`).
- Produces: `get_chain(ticker, expiration="", strikes_around_spot=6)` — same signature and return shape (`{ticker, expiration, spot, calls, puts, source}`), now correct on dense chains and class shares. Later tasks rely on `calls[i]["bid"|"ask"|"strike"|"iv"|"expiration"]`.

- [ ] **Step 1: Write the failing tests** (fixture-driven; no network — monkeypatch `_safe_get`)

```python
# tests/test_polygon_options_chain.py
from unittest.mock import patch
from api.services import polygon_options as po

def _contract(strike, side, exp="2026-08-07", price=180.0):
    return {
        "details": {"ticker": f"O:TST{strike}{side[0].upper()}", "strike_price": strike,
                    "expiration_date": exp, "contract_type": side, "shares_per_contract": 100},
        "last_quote": {"bid": 1.0, "ask": 1.2}, "last_trade": {"price": 1.1},
        "day": {}, "greeks": {"delta": 0.5}, "implied_volatility": 0.45,
        "open_interest": 10, "underlying_asset": {"price": price, "ticker": "TST"},
        "break_even_price": strike + 1.1,
    }

def test_get_chain_follows_next_url_pagination():
    po._CACHE.clear()
    page1 = {"results": [_contract(100 + i, "call") for i in range(250)],
             "next_url": "https://api.massive.com/v3/snapshot/options/TST?cursor=abc"}
    page2 = {"results": [_contract(179, "call"), _contract(179, "put"),
                         _contract(181, "call"), _contract(181, "put")]}
    calls = []
    def fake_get(url, params=None):
        calls.append(url)
        return page2 if "cursor=abc" in url else page1
    with patch.object(po, "_safe_get", side_effect=fake_get):
        out = po.get_chain("TST", expiration="2026-08-07", strikes_around_spot=2)
    assert len(calls) == 2, "must follow next_url"
    strikes = [c["strike"] for c in out["calls"]]
    assert 179 in strikes and 181 in strikes, "ATM strikes live on page 2 — truncation loses them"

def test_get_chain_maps_class_share_symbol():
    po._CACHE.clear()
    seen = {}
    def fake_get(url, params=None):
        seen["url"] = url
        return {"results": [_contract(400, "call", price=410.0), _contract(400, "put", price=410.0)]}
    with patch.object(po, "_safe_get", side_effect=fake_get):
        out = po.get_chain("BRK-B", expiration="2026-08-07")
    assert "/v3/snapshot/options/BRK.B" in seen["url"]
    assert out["ticker"] == "BRK-B", "caller-facing ticker keeps hyphen form"

def test_get_chain_pagination_is_bounded():
    po._CACHE.clear()
    looping = {"results": [_contract(100, "call")],
               "next_url": "https://api.massive.com/v3/snapshot/options/TST?cursor=loop"}
    with patch.object(po, "_safe_get", return_value=looping):
        out = po.get_chain("TST", expiration="2026-08-07")
    assert "error" not in out, "bounded pagination must still return the collected pages"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/Users/Patrick/uct-worktrees/research-redesign && python -m pytest tests/test_polygon_options_chain.py -v`
Expected: FAIL — one `_safe_get` call only (no pagination), URL contains `BRK-B` not `BRK.B`.

- [ ] **Step 3: Implement pagination + mapping in `get_chain`**

In `api/services/polygon_options.py`: add import `from api.services.massive import to_polygon_symbol` and replace the fetch block (`:144-153`) with:

```python
    try:
        api_sym = to_polygon_symbol(sym)
        params: dict[str, Any] = {"limit": 250}
        if expiration:
            params["expiration_date"] = expiration
        results: list[dict] = []
        url = f"{_BASE}/v3/snapshot/options/{api_sym}"
        pages = 0
        while url and pages < 8:  # 8 × 250 = 2000 contracts — beyond any single-expiry chain
            data = _safe_get(url, params=params)
            results.extend(data.get("results") or [])
            url = data.get("next_url")
            params = None  # next_url embeds the cursor + original params
            pages += 1
    except RuntimeError as e:
        return {"error": str(e)}
    except httpx.HTTPError as e:
        _log.warning("polygon chain fetch failed for %s: %s", sym, e)
        return {"error": f"polygon request failed: {e}", "ticker": sym}

    if not results:
        return {"error": "no chain data", "ticker": sym}
```

and delete the now-duplicated `results = data.get("results") or []` / empty-check lines below.

**CORRECTION (task-review finding, verified vs pinned httpx 0.28.1):** `_safe_get`'s `params={"apiKey": ...}` REPLACES the query string already on `next_url` — it does not merge — so `params=None` + `_safe_get(next_url)` silently drops the cursor (and `limit`/`expiration_date`). For `next_url` pages, append the apiKey by string concatenation exactly as `api/services/massive.py:658-665` does for its own pagination (`sep = "&" if "?" in nxt else "?"`), bypassing `_safe_get`'s params path, and add a real-httpx-composition test (MockTransport on `po._http`) asserting page-2's outgoing URL preserves `cursor=` — a mocked `_safe_get` cannot see this bug class.

- [ ] **Step 4: Run the new tests + the existing suite slice**

Run: `python -m pytest tests/test_polygon_options_chain.py -v && python -m pytest tests -k "polygon or voice_tools" -q`
Expected: new tests PASS; no existing polygon/voice test regresses.

- [ ] **Step 5: Commit**

```bash
git add api/services/polygon_options.py tests/test_polygon_options_chain.py
git commit -m "fix(options): paginate chain snapshots + map class-share symbols

One 250-contract page silently truncated dense chains (TSLA/NVDA class),
producing plausible-but-wrong ATM straddles; BRK-B-style underliers
returned empty chains without to_polygon_symbol."
```

---

### Task 2: `implied_move.py` — expiry selection + ATM straddle computation

**Files:**
- Create: `api/services/implied_move.py`
- Test: `tests/test_implied_move.py`

**Interfaces:**
- Consumes: `polygon_options.list_expirations(ticker) -> {expirations: [iso...]}` and `polygon_options.get_chain(ticker, expiration=, strikes_around_spot=)` from Task 1.
- Produces:
  - `select_report_expiry(expirations: list[str], report_date: str) -> str | None` — first ISO expiry ≥ report_date (ports the yfinance logic from `earnings_enrichment.py:268-286`).
  - `compute_expected_move(sym: str, report_date: str | None) -> dict | None` — `{"pct": float, "dollar": float, "expiry": str, "strike": float, "spot": float, "call_mid": float, "put_mid": float, "iv_atm": float | None, "horizon": "through <expiry>", "asof": iso-ts, "source": "massive-chain"}` or `None` on any failure (never a partial dict).
  - `get_expected_move(sym: str, report_date: str | None) -> dict | None` — cached wrapper (Task 3 adds ServeStale; in this task it is a passthrough alias so the router task can bind to the final name).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_implied_move.py
from unittest.mock import patch
from api.services import implied_move as im

def test_select_report_expiry_picks_first_on_or_after():
    exps = ["2026-08-07", "2026-08-14", "2026-08-21"]
    assert im.select_report_expiry(exps, "2026-08-12") == "2026-08-14"
    assert im.select_report_expiry(exps, "2026-08-07") == "2026-08-07"
    assert im.select_report_expiry(exps, "2026-09-01") is None  # report beyond listed expiries
    assert im.select_report_expiry([], "2026-08-12") is None
    assert im.select_report_expiry(exps, None) == "2026-08-07"  # no report date → front expiry

def _chain(spot=184.22, strike=185.0, cb=6.1, ca=6.3, pb=6.0, pa=6.2, exp="2026-08-07"):
    return {"ticker": "TST", "expiration": exp, "spot": spot,
            "calls": [{"strike": strike, "bid": cb, "ask": ca, "iv": 0.62, "expiration": exp}],
            "puts":  [{"strike": strike, "bid": pb, "ask": pa, "iv": 0.60, "expiration": exp}],
            "source": "polygon (Massive Advanced)"}

def test_compute_expected_move_straddle_math():
    with patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": ["2026-08-07"]}), \
         patch.object(im.polygon_options, "get_chain", return_value=_chain()):
        out = im.compute_expected_move("TST", "2026-08-06")
    assert out is not None
    straddle = (6.1 + 6.3) / 2 + (6.0 + 6.2) / 2      # call mid + put mid = 12.30
    assert abs(out["dollar"] - straddle) < 1e-9
    assert abs(out["pct"] - (straddle / 184.22 * 100)) < 1e-6
    assert out["expiry"] == "2026-08-07" and out["horizon"] == "through 2026-08-07"

def test_compute_expected_move_returns_none_on_bad_quotes():
    bad = _chain(cb=0.0, ca=0.0, pb=0.0, pa=0.0)      # no NBBO → unusable
    with patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": ["2026-08-07"]}), \
         patch.object(im.polygon_options, "get_chain", return_value=bad):
        assert im.compute_expected_move("TST", "2026-08-06") is None

def test_compute_expected_move_returns_none_on_chain_error():
    with patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": ["2026-08-07"]}), \
         patch.object(im.polygon_options, "get_chain", return_value={"error": "no chain data"}):
        assert im.compute_expected_move("TST", "2026-08-06") is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_implied_move.py -v`
Expected: FAIL with "module has no attribute" / import error.

- [ ] **Step 3: Implement the module**

```python
# api/services/implied_move.py
"""In-house expected move from Massive options chains (ATM straddle).

Replaces the slow, delayed-quote yfinance straddle for the research/earnings
surfaces. Horizon-honest: expiry is the first on/after the report date and the
payload carries it ("through YYYY-MM-DD") so the UI can state the denominator.
"""
from __future__ import annotations

import datetime as _dt
import logging

from api.services import polygon_options

_log = logging.getLogger(__name__)


def select_report_expiry(expirations: list[str], report_date: str | None) -> str | None:
    """First expiry ≥ report_date; front expiry when no date; None when the
    report lies beyond every listed expiry (better no number than a wrong one)."""
    exps = sorted(e for e in (expirations or []) if e)
    if not exps:
        return None
    if not report_date:
        return exps[0]
    try:
        target = _dt.date.fromisoformat(report_date)
    except (TypeError, ValueError):
        return exps[0]
    for e in exps:
        try:
            if _dt.date.fromisoformat(e) >= target:
                return e
        except ValueError:
            continue
    return None


def _mid(row: dict) -> float | None:
    bid, ask = row.get("bid"), row.get("ask")
    try:
        bid, ask = float(bid), float(ask)
    except (TypeError, ValueError):
        return None
    if ask <= 0 or bid < 0 or ask < bid:
        return None
    return (bid + ask) / 2


def compute_expected_move(sym: str, report_date: str | None) -> dict | None:
    exps = polygon_options.list_expirations(sym)
    expiry = select_report_expiry(exps.get("expirations") or [], report_date)
    if not expiry:
        return None
    chain = polygon_options.get_chain(sym, expiration=expiry, strikes_around_spot=4)
    if "error" in chain:
        return None
    spot = chain.get("spot")
    if not spot or spot <= 0:
        return None

    def _atm(rows: list[dict]) -> dict | None:
        valid = [r for r in rows if r.get("strike") is not None]
        return min(valid, key=lambda r: abs(float(r["strike"]) - spot)) if valid else None

    call, put = _atm(chain.get("calls") or []), _atm(chain.get("puts") or [])
    if not call or not put or call["strike"] != put["strike"]:
        return None
    call_mid, put_mid = _mid(call), _mid(put)
    if call_mid is None or put_mid is None or (call_mid + put_mid) <= 0:
        return None
    dollar = call_mid + put_mid
    return {
        "pct": dollar / spot * 100,
        "dollar": dollar,
        "expiry": expiry,
        "strike": float(call["strike"]),
        "spot": float(spot),
        "call_mid": call_mid,
        "put_mid": put_mid,
        "iv_atm": call.get("iv"),
        "horizon": f"through {expiry}",
        "asof": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "source": "massive-chain",
    }


# Task 3 replaces this alias with the ServeStale-fronted version; the router
# and store bind to THIS name so their code never changes.
get_expected_move = compute_expected_move
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_implied_move.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add api/services/implied_move.py tests/test_implied_move.py
git commit -m "feat(research): in-house expected move from Massive chains

Expiry selected at/after the report date (ported from the yfinance
version), ATM straddle mid math, horizon-labeled payload, None on any
degraded input — never a partial number."
```

---

### Task 3: ServeStale + TTL caching for `get_expected_move`

**Files:**
- Modify: `api/services/implied_move.py`
- Test: extend `tests/test_implied_move.py`

**Interfaces:**
- Consumes: `api.services.cache.TTLCache`, `api.services.serve_stale.ServeStale` (constructor `ServeStale(name, max_age_seconds, max_keys=256)`; methods `remember(key, value)`, plus the get-or-build pattern used in `api/routers/calendar.py:26` — read that file's `_WEEKLY_STALE` usage before implementing and mirror it).
- Produces: `get_expected_move(sym, report_date=None) -> dict | None` — 15-min TTL, single-flight refresh, stale served ≤ 2h, failures never remembered.

- [ ] **Step 1: Write the failing tests**

```python
# append to tests/test_implied_move.py
def test_get_expected_move_caches_success(monkeypatch):
    im._MOVE_CACHE.clear()
    calls = {"n": 0}
    def fake_compute(sym, rd):
        calls["n"] += 1
        return {"pct": 5.0, "dollar": 9.2, "expiry": "2026-08-07", "strike": 185.0,
                "spot": 184.0, "call_mid": 4.7, "put_mid": 4.5, "iv_atm": 0.6,
                "horizon": "through 2026-08-07", "asof": "x", "source": "massive-chain"}
    monkeypatch.setattr(im, "compute_expected_move", fake_compute)
    a = im.get_expected_move("TST", "2026-08-06")
    b = im.get_expected_move("TST", "2026-08-06")
    assert a == b and calls["n"] == 1, "second call must be served from cache"

def test_get_expected_move_never_caches_failure(monkeypatch):
    im._MOVE_CACHE.clear()
    calls = {"n": 0}
    def fake_compute(sym, rd):
        calls["n"] += 1
        return None
    monkeypatch.setattr(im, "compute_expected_move", fake_compute)
    assert im.get_expected_move("TST", "2026-08-06") is None
    assert im.get_expected_move("TST", "2026-08-06") is None
    assert calls["n"] == 2, "a None result must never be remembered"
```

- [ ] **Step 2: Run to verify failure** — `python -m pytest tests/test_implied_move.py -v` → the two new tests FAIL (`_MOVE_CACHE` missing / single call not cached).

- [ ] **Step 3: Implement** — in `implied_move.py`, replace the alias with:

```python
from api.services.cache import TTLCache
from api.services.serve_stale import ServeStale

_MOVE_CACHE = TTLCache()
_MOVE_TTL = 900          # 15 min — IV moves, but not tick-by-tick
_MOVE_STALE = ServeStale("expected_move", max_age_seconds=7200)


def get_expected_move(sym: str, report_date: str | None = None) -> dict | None:
    key = f"expmove::{(sym or '').upper()}::{report_date or ''}"
    cached = _MOVE_CACHE.get(key)
    if cached is not None:
        return dict(cached)

    def _build():
        return compute_expected_move(sym, report_date)

    # Mirror the calendar router's ServeStale composition: fresh build wins,
    # last-good serves the gap, a failed build is never remembered.
    value = _build()
    if value is not None:
        _MOVE_CACHE.set(key, dict(value), _MOVE_TTL)
        _MOVE_STALE.remember(key, dict(value))
        return value
    stale = _MOVE_STALE.serve(key) if hasattr(_MOVE_STALE, "serve") else None
    return dict(stale) if stale else None
```

**Implementation note (read before coding):** open `api/services/serve_stale.py` and `api/routers/calendar.py:26` in full — if `ServeStale` exposes a `get_or_build(key, build, good)` style API, use it instead of the manual composition above (that API also gives single-flight). Keep the two tests green either way; add a third asserting single-flight only if the class exposes it synchronously.

- [ ] **Step 4: Run** — `python -m pytest tests/test_implied_move.py -v` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/implied_move.py tests/test_implied_move.py
git commit -m "feat(research): cache expected move — 15min TTL + serve-stale, failures never remembered"
```

---

### Task 4: `implied_store.py` — SQLite store + upcoming-reporters helper

**Files:**
- Create: `api/services/implied_store.py`
- Test: `tests/test_implied_store.py`

**Interfaces:**
- Consumes: `implied_move.get_expected_move` (Task 3 name); `FINNHUB_API_KEY` env; httpx.
- Produces:
  - `record_implied(sym, report_date, payload: dict, captured_at: str) -> None` — idempotent per (sym, report_date): first write wins (the T-1 pre-report snapshot must not be overwritten by a later, closer-to-print capture unless none exists).
  - `get_implied_history(sym, limit=8) -> list[dict]` — newest-first rows `{sym, report_date, pct, dollar, expiry, captured_at}`.
  - `record_grade(sym, date, surface, grade, inputs: dict) -> None` + `get_grade_history(sym, surface, limit=30)` — the §12 accountability record (P2 starts calling `record_grade`; the table exists from day one).
  - `upcoming_reporters(days=14, now=None) -> list[dict]` — `[{sym, report_date}]` from Finnhub `/calendar/earnings?from=&to=`, 6h-cached, empty list on any failure.
  - `run_nightly_capture(now=None) -> dict` — summary `{"captured": n, "skipped": n, "failed": n}`.
  - `DB_PATH` — `os.environ.get("IMPLIED_STORE_DB", os.path.join(DATA_DIR, "implied_moves.db"))` where `DATA_DIR` resolution copies the idiom used by `api/services/desk_session_jobs.py` (read it first).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_implied_store.py
import datetime as dt
from unittest.mock import patch

import pytest

@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("IMPLIED_STORE_DB", str(tmp_path / "implied.db"))
    import importlib
    from api.services import implied_store
    importlib.reload(implied_store)
    return implied_store

def _payload(pct=6.8):
    return {"pct": pct, "dollar": 12.5, "expiry": "2026-08-07", "strike": 185.0,
            "spot": 184.0, "call_mid": 6.3, "put_mid": 6.2, "iv_atm": 0.6,
            "horizon": "through 2026-08-07", "asof": "2026-08-03T21:00:00+00:00",
            "source": "massive-chain"}

def test_record_implied_first_write_wins(store):
    store.record_implied("TST", "2026-08-06", _payload(6.8), "2026-08-03T21:00:00")
    store.record_implied("TST", "2026-08-06", _payload(9.9), "2026-08-05T21:00:00")
    rows = store.get_implied_history("TST")
    assert len(rows) == 1 and abs(rows[0]["pct"] - 6.8) < 1e-9, \
        "the earliest (furthest-from-print) snapshot is the honest 'implied at the time'"

def test_get_implied_history_newest_report_first(store):
    store.record_implied("TST", "2026-05-06", _payload(4.0), "2026-05-05T21:00:00")
    store.record_implied("TST", "2026-08-06", _payload(6.8), "2026-08-03T21:00:00")
    rows = store.get_implied_history("TST", limit=8)
    assert [r["report_date"] for r in rows] == ["2026-08-06", "2026-05-06"]

def test_grade_snapshots_roundtrip(store):
    store.record_grade("TST", "2026-08-03", "setup", "A-",
                       {"streak": "7/8", "revisions": "21/3", "rs": 94, "iv": "rich"})
    rows = store.get_grade_history("TST", "setup")
    assert rows[0]["grade"] == "A-" and rows[0]["inputs"]["rs"] == 94

def test_run_nightly_capture_stores_only_successes(store):
    reporters = [{"sym": "GOOD", "report_date": "2026-08-06"},
                 {"sym": "BAD", "report_date": "2026-08-06"}]
    def fake_move(sym, report_date=None):
        return _payload() if sym == "GOOD" else None
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store.implied_move, "get_expected_move", side_effect=fake_move):
        summary = store.run_nightly_capture(now=dt.datetime(2026, 8, 3, 16, 40))
    assert summary["captured"] == 1 and summary["failed"] == 1
    assert store.get_implied_history("GOOD") and not store.get_implied_history("BAD"), \
        "a failed fetch must never be stored as a value"

def test_run_nightly_capture_noop_when_no_reporters(store):
    with patch.object(store, "upcoming_reporters", return_value=[]):
        summary = store.run_nightly_capture(now=dt.datetime(2026, 8, 3, 16, 40))
    assert summary == {"captured": 0, "skipped": 0, "failed": 0}
```

- [ ] **Step 2: Run to verify failure** — `python -m pytest tests/test_implied_store.py -v` → import error.

- [ ] **Step 3: Implement the module**

```python
# api/services/implied_store.py
"""Nightly implied-move + grade snapshot store (web-side, /data SQLite).

Why nightly & pre-report: 'implied at the time' history for the paired-bars
hero. A morning-after capture stores IV-crushed values and poisons the pair —
capture runs post-close (options quotes settle ~4:15 ET) for tonight's AMC
and all names reporting within the next 14 days.
First-write-wins per (sym, report_date): the earliest snapshot is the honest
pre-report implied; later recaptures never overwrite it.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import sqlite3
from contextlib import closing

import httpx

from api.services import implied_move
from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

_DATA_DIR = os.environ.get("DATA_DIR") or ("/data" if os.path.isdir("/data") else os.path.join(os.getcwd(), "data"))
DB_PATH = os.environ.get("IMPLIED_STORE_DB", os.path.join(_DATA_DIR, "implied_moves.db"))

_REPORTERS_CACHE = TTLCache()
_REPORTERS_TTL = 6 * 3600

_SCHEMA = """
CREATE TABLE IF NOT EXISTS implied_snapshots (
  sym TEXT NOT NULL, report_date TEXT NOT NULL, captured_at TEXT NOT NULL,
  pct REAL NOT NULL, dollar REAL NOT NULL, expiry TEXT, strike REAL, spot REAL,
  iv_atm REAL, source TEXT, PRIMARY KEY (sym, report_date)
);
CREATE TABLE IF NOT EXISTS grade_snapshots (
  sym TEXT NOT NULL, date TEXT NOT NULL, surface TEXT NOT NULL,
  grade TEXT NOT NULL, inputs_json TEXT NOT NULL,
  PRIMARY KEY (sym, date, surface)
);
"""


def _conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.executescript(_SCHEMA)
    return c


def record_implied(sym: str, report_date: str, payload: dict, captured_at: str) -> None:
    with closing(_conn()) as c, c:
        c.execute(
            "INSERT OR IGNORE INTO implied_snapshots "
            "(sym, report_date, captured_at, pct, dollar, expiry, strike, spot, iv_atm, source) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (sym.upper(), report_date, captured_at, payload["pct"], payload["dollar"],
             payload.get("expiry"), payload.get("strike"), payload.get("spot"),
             payload.get("iv_atm"), payload.get("source")),
        )


def get_implied_history(sym: str, limit: int = 8) -> list[dict]:
    with closing(_conn()) as c:
        rows = c.execute(
            "SELECT sym, report_date, captured_at, pct, dollar, expiry FROM implied_snapshots "
            "WHERE sym = ? ORDER BY report_date DESC LIMIT ?", (sym.upper(), int(limit)),
        ).fetchall()
    return [dict(r) for r in rows]


def record_grade(sym: str, date: str, surface: str, grade: str, inputs: dict) -> None:
    with closing(_conn()) as c, c:
        c.execute(
            "INSERT OR REPLACE INTO grade_snapshots (sym, date, surface, grade, inputs_json) "
            "VALUES (?,?,?,?,?)",
            (sym.upper(), date, surface, grade, json.dumps(inputs, separators=(",", ":"))),
        )


def get_grade_history(sym: str, surface: str, limit: int = 30) -> list[dict]:
    with closing(_conn()) as c:
        rows = c.execute(
            "SELECT sym, date, surface, grade, inputs_json FROM grade_snapshots "
            "WHERE sym = ? AND surface = ? ORDER BY date DESC LIMIT ?",
            (sym.upper(), surface, int(limit)),
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["inputs"] = json.loads(d.pop("inputs_json"))
        out.append(d)
    return out


def upcoming_reporters(days: int = 14, now: dt.datetime | None = None) -> list[dict]:
    """Symbols reporting within `days`, via Finnhub's calendar range.
    Empty list on ANY failure — the nightly job then no-ops (holiday-safe)."""
    key = f"impstore::reporters::{days}"
    cached = _REPORTERS_CACHE.get(key)
    if cached is not None:
        return list(cached)
    api_key = os.environ.get("FINNHUB_API_KEY", "").strip()
    if not api_key:
        return []
    today = (now or dt.datetime.now()).date()
    try:
        r = httpx.get(
            "https://finnhub.io/api/v1/calendar/earnings",
            params={"from": today.isoformat(),
                    "to": (today + dt.timedelta(days=days)).isoformat(),
                    "token": api_key},
            timeout=10,
        )
        r.raise_for_status()
        rows = (r.json() or {}).get("earningsCalendar") or []
    except Exception as e:  # noqa: BLE001 — any failure → empty, never cached
        _log.warning("upcoming_reporters fetch failed: %s", e)
        return []
    out = [{"sym": (row.get("symbol") or "").upper(), "report_date": row.get("date")}
           for row in rows if row.get("symbol") and row.get("date")]
    if out:
        _REPORTERS_CACHE.set(key, list(out), _REPORTERS_TTL)
    return out


def run_nightly_capture(now: dt.datetime | None = None) -> dict:
    """Post-close capture for every symbol reporting within 14 days.
    Never stores a failure; existing (sym, report_date) rows are kept (first-write-wins).
    CORRECTION (task-review finding): each reporter iteration MUST be wrapped in its own
    try/except (log + failed += 1 + continue) — without it one bad symbol aborts the whole
    nightly batch. Use a direct exists-query for the skip check, not get_implied_history."""
    reporters = upcoming_reporters(days=14, now=now)
    summary = {"captured": 0, "skipped": 0, "failed": 0}
    captured_at = (now or dt.datetime.now()).isoformat(timespec="seconds")
    for rep in reporters:
        if get_implied_history(rep["sym"], limit=1) and \
           get_implied_history(rep["sym"], limit=1)[0]["report_date"] == rep["report_date"]:
            summary["skipped"] += 1
            continue
        payload = implied_move.get_expected_move(rep["sym"], rep["report_date"])
        if payload is None:
            summary["failed"] += 1
            continue
        record_implied(rep["sym"], rep["report_date"], payload, captured_at)
        summary["captured"] += 1
    _log.info("[implied-store] nightly capture: %s", summary)
    return summary
```

- [ ] **Step 4: Run** — `python -m pytest tests/test_implied_store.py -v` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/implied_store.py tests/test_implied_store.py
git commit -m "feat(research): nightly implied-move + grade snapshot store

First-write-wins pre-report snapshots (IV-crush-safe), bounded to
reporters within 14 days, failures never stored, holiday-safe by
construction (no reporters -> no-op)."
```

---

### Task 5: Scheduler job + router endpoint + main.py wiring

**Files:**
- Create: `api/routers/expected_move.py`
- Modify: `api/main.py` (router include next to the other research includes; scheduler job next to the COT/catalyst blocks — find `_scheduler.add_job` cluster and the `_ET` timezone constant at the top)
- Test: `tests/test_expected_move_router.py`

**Interfaces:**
- Consumes: `implied_move.get_expected_move`, `implied_store.get_implied_history`, `implied_store.run_nightly_capture`; auth dependency `get_current_user` (import exactly as `api/routers/earnings_intel.py` does — read its imports first).
- Produces: `GET /api/research/expected-move/{sym}?report_date=YYYY-MM-DD` → `{"live": {...} | null, "history": [...], "history_since": "2026-08" | null}`. Env flag `IMPLIED_STORE_ENABLED=1` gates ONLY the scheduler job (the read endpoint is always safe).

- [ ] **Step 1: Write the failing router test**

```python
# tests/test_expected_move_router.py
from unittest.mock import patch
from fastapi.testclient import TestClient

def _client_with_auth():
    from api.main import app
    from api.routers import expected_move as em_router
    app.dependency_overrides[em_router.get_current_user] = lambda: {"id": "u1", "email": "t@t"}
    return TestClient(app), app, em_router

def test_expected_move_endpoint_shape():
    client, app, em_router = _client_with_auth()
    live = {"pct": 6.8, "dollar": 12.5, "expiry": "2026-08-07", "strike": 185.0,
            "spot": 184.0, "call_mid": 6.3, "put_mid": 6.2, "iv_atm": 0.6,
            "horizon": "through 2026-08-07", "asof": "x", "source": "massive-chain"}
    hist = [{"sym": "TST", "report_date": "2026-05-06", "captured_at": "c",
             "pct": 4.0, "dollar": 7.0, "expiry": "2026-05-08"}]
    with patch.object(em_router.implied_move, "get_expected_move", return_value=live), \
         patch.object(em_router.implied_store, "get_implied_history", return_value=hist):
        r = client.get("/api/research/expected-move/TST?report_date=2026-08-06")
    app.dependency_overrides.clear()
    assert r.status_code == 200
    body = r.json()
    assert body["live"]["pct"] == 6.8 and body["history"][0]["report_date"] == "2026-05-06"

def test_expected_move_endpoint_requires_auth():
    from api.main import app
    client = TestClient(app)
    r = client.get("/api/research/expected-move/TST")
    assert r.status_code in (401, 403)
```

- [ ] **Step 2: Run to verify failure** — `python -m pytest tests/test_expected_move_router.py -v` → 404 (router not mounted).

- [ ] **Step 3: Implement router + wiring**

```python
# api/routers/expected_move.py
from fastapi import APIRouter, Depends, Query

from api.services import implied_move, implied_store
# import get_current_user via the SAME path earnings_intel.py uses (verify before coding)
from api.services.auth_service import get_current_user

router = APIRouter(prefix="/api/research", tags=["research"])


@router.get("/expected-move/{sym}")
def expected_move(sym: str, report_date: str | None = Query(default=None),
                  user=Depends(get_current_user)):
    live = implied_move.get_expected_move(sym, report_date)
    # CORRECTION (task-review finding): the history read MUST degrade to [] on any
    # store error (unreadable/corrupt DB) — never 500 the endpoint; live still serves.
    history = implied_store.get_implied_history(sym, limit=8)
    return {
        "live": live,
        "history": history,
        "history_since": min((h["report_date"] for h in history), default=None),
    }
```

In `api/main.py`:
1. Next to the other router imports: `from api.routers import expected_move as expected_move_router` and `app.include_router(expected_move_router.router)`.
2. In the scheduler block (same pattern as the COT jobs, using the existing `_ET`):

```python
if os.environ.get("IMPLIED_STORE_ENABLED") == "1":
    from api.services import implied_store as _implied_store
    _scheduler.add_job(
        _implied_store.run_nightly_capture,
        CronTrigger(hour=16, minute=35, day_of_week="mon-fri", timezone=_ET),
        id="implied_move_nightly", max_instances=1, coalesce=True,
    )
```

(16:35 ET = post options settle ~16:15, pre any evening maintenance; weekday-only; a holiday yields zero reporters → natural no-op.)

- [ ] **Step 4: Run** — `python -m pytest tests/test_expected_move_router.py tests/test_implied_move.py tests/test_implied_store.py -v` → all PASS. Then the full backend suite: `python -m pytest tests -q` → no new failures vs the pre-existing baseline (record the baseline count first with `git stash`-free discipline: run once before your changes on a clean checkout if unsure).

- [ ] **Step 5: Commit**

```bash
git add api/routers/expected_move.py api/main.py tests/test_expected_move_router.py
git commit -m "feat(research): expected-move endpoint + flag-gated nightly capture job (16:35 ET, web-side)"
```

---

### Task 6: Backfill validation probe (manual tool)

**Files:**
- Create: `tools/implied_backfill_probe.py`

**Interfaces:**
- Consumes: `implied_store.upcoming_reporters`, `implied_move.get_expected_move`.
- Produces: a manual, read-only CLI report — NOT scheduled, NOT imported by the app.

- [ ] **Step 1: Implement (no unit test — a manual diagnostic; the guard is that it imports cleanly)**

```python
# tools/implied_backfill_probe.py
"""Manual probe: for the next-14-day reporters, how many symbols can the
in-house expected-move service price RIGHT NOW? Run before launch to size
the cold-start (spec §6 row 2). Read-only; makes live Massive calls.

Usage:  python tools/implied_backfill_probe.py [--limit 50]
"""
import argparse
import sys

sys.path.insert(0, ".")

from api.services import implied_move, implied_store  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=50)
    args = ap.parse_args()
    reporters = implied_store.upcoming_reporters(days=14)[: args.limit]
    if not reporters:
        print("no upcoming reporters (check FINNHUB_API_KEY)")
        return 1
    ok, fail = [], []
    for rep in reporters:
        payload = implied_move.get_expected_move(rep["sym"], rep["report_date"])
        (ok if payload else fail).append(rep["sym"])
        print(f"{rep['sym']:<6} {rep['report_date']}  "
              f"{'±%.1f%%' % payload['pct'] if payload else 'FAIL'}")
    print(f"\ncoverage: {len(ok)}/{len(reporters)} "
          f"({100 * len(ok) / max(1, len(reporters)):.0f}%)  failures: {', '.join(fail) or '-'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Verify it imports** — `python -c "import ast; ast.parse(open('tools/implied_backfill_probe.py').read())"` → no output. (Do NOT run it against live APIs in CI.)

- [ ] **Step 3: Commit**

```bash
git add tools/implied_backfill_probe.py
git commit -m "chore(research): manual coverage probe for expected-move cold start"
```

---

## Self-Review (run after writing, before execution)

1. **Spec coverage:** §6 row 1 (pagination/symbol/expiry/ServeStale) → Tasks 1-3. §6 row 2 (nightly store, web-side, post-close, bounded, first-write-wins, holiday guard, never-store-failure) → Tasks 4-5. §6 grade snapshots → Task 4 tables + `record_grade` (P2 calls it). §8 BE tests (dense-chain fixture, expiry selection, store bounding, snapshot persistence) → present in Tasks 1, 2, 4. Backfill validation → Task 6. NOT in this plan (deliberate): earnings-history endpoint (needs its own plan — session-source work), enrichment cutover (P2, flagged), FINRA (later phase).
2. **Placeholder scan:** none — every step has real code. Two "read the file first" notes (ServeStale API shape, get_current_user import path) are verification instructions with a concrete default, not gaps.
3. **Type consistency:** `get_expected_move(sym, report_date=None)` used identically in Tasks 3/4/5; `record_implied(sym, report_date, payload, captured_at)` matches between Task 4 impl and tests; router binds `implied_move` / `implied_store` module names as imported.

## Execution

Subagent-driven (fresh subagent per task, review between tasks) unless the owner prefers inline. Ship gate unchanged: this plan merges to the feature branch only; nothing deploys without explicit owner approval within deploy windows.
