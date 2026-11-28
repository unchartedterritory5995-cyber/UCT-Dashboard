"""ONE serialization per /api/bars answer (S1 of the bars serve speedup, 2026-11-27).

Synthetic stores only; every price is an invented number. Contracts guarded here:

  S1  GOLDEN: every scenario served the legacy way (`bars_payload.LEGACY_REPARSE`: render at
      construction, every router step re-parses the bytes) and the new way answers the SAME
      BYTES, the same status and the same headers (Server-Timing compared by metric name;
      `ser` is new). Scenarios: deep daily (SQLite tier, then the memory tier) with and
      without today's developing bar, intraday full / `since=` / `to=`, the ETH 60m derived
      from 15m, and a cold warming 503.
  S2  The memory-cache entry is never mutated by the fields an answer adds
      (`test_the_cached_payload_is_never_mutated`).
  S3  An answer is serialized ONCE and never re-parsed on its way out (an ETH 60m answer:
      once, the 15m input never); `ser` rides Server-Timing.
  S4  An answer nobody rendered still goes out with the right Content-Length (ASGI send).
"""
from __future__ import annotations

import asyncio
import copy
import datetime as _dt
import random
from zoneinfo import ZoneInfo

import orjson
import pytest

from api.routers import bars as bars_router
from api.services import bars_fetch, bars_payload, bars_sqlite, massive
from api.services.cache import cache

ET = ZoneInfo("America/New_York")


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    monkeypatch.setattr(bars_fetch, "_inflight", {})
    # The store decides alone: fresh, no provider, no live feed, a fixed re-poll hint.
    monkeypatch.setattr(bars_fetch, "_needs_fresh", lambda *a, **k: False)
    monkeypatch.setattr(bars_fetch, "_live_derive_on_read", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_is_cold_stale_intraday", lambda *a, **k: False)
    monkeypatch.setattr(bars_fetch, "_kick_cold_fetch", lambda *a, **k: None)
    monkeypatch.setattr(bars_router, "_tail_retry_after_s", lambda: 3)
    monkeypatch.setattr(bars_router, "_is_carried", lambda t: True)
    monkeypatch.setattr(massive, "todays_daily_bar", lambda tk: None)
    cache.clear()
    yield
    cache.clear()
    bars_sqlite.bump_db_epoch()


def _days(start: _dt.date, n: int):
    out, d = [], start
    while len(out) < n:
        if bars_fetch._is_trading_day_ymd(d):
            out.append(d)
        d += _dt.timedelta(days=1)
    return out


def _px(rng, p):
    return round(p * (1 + rng.uniform(-0.01, 0.01)), 2)


def _seed_daily(ticker, n=6000, seed=1):
    rng, p, rows = random.Random(seed), 40.0, []
    for d in _days(_dt.date(2003, 1, 2), n):
        o = p
        p = max(1.0, _px(rng, p))
        rows.append({"t": d.isoformat(), "o": o, "h": round(max(o, p) * 1.004, 2),
                     "l": round(min(o, p) * 0.996, 2), "c": p, "v": rng.randint(10_000, 9_000_000)})
    bars_sqlite.put_bars(ticker, "D", rows, date_tf=True)
    return rows


def _seed_intraday(ticker, tf, sessions, end=_dt.date(2026, 11, 25), seed=2, ext=True):
    """`sessions` trading days ending at `end`, extended hours (04:00-20:00) when `ext`."""
    rng, p, rows = random.Random(seed), 100.0, []
    step = int(tf) * 60
    start_d = end - _dt.timedelta(days=int(sessions * 1.6) + 10)
    days = [d for d in _days(start_d, sessions * 2) if d <= end][-sessions:]
    for d in days:
        lo = _dt.datetime(d.year, d.month, d.day, 4 if ext else 9, 0 if ext else 30, tzinfo=ET)
        hi = _dt.datetime(d.year, d.month, d.day, 20 if ext else 16, 0, tzinfo=ET)
        t = int(lo.timestamp())
        while t < int(hi.timestamp()):
            o = p
            p = max(1.0, _px(rng, p))
            rows.append({"t": t, "o": o, "h": round(max(o, p) * 1.002, 2),
                         "l": round(min(o, p) * 0.998, 2), "c": p, "v": rng.randint(100, 90_000)})
            t += step
    bars_sqlite.put_bars(ticker, tf, rows, date_tf=False)
    return rows


def _st_names(resp) -> list[str]:
    st = resp.headers.get("server-timing") or ""
    return [part.split(";")[0].strip() for part in st.split(",") if part.strip()]


def _snapshot(resp):
    body = bytes(resp.body)
    hdrs = {k: v for k, v in resp.headers.items() if k not in ("server-timing",)}
    return resp.status_code, body, hdrs, [n for n in _st_names(resp) if n != "ser"]


def _serve_both_ways(monkeypatch, calls):
    """Run `calls` (a list of zero-arg serves) from a cold memory cache, legacy then new."""
    out = {}
    for legacy in (True, False):
        monkeypatch.setattr(bars_payload, "LEGACY_REPARSE", legacy)
        cache.clear()
        monkeypatch.setattr(bars_fetch, "_inflight", {})
        out[legacy] = [_snapshot(c()) for c in calls]
    monkeypatch.setattr(bars_payload, "LEGACY_REPARSE", False)
    return out[True], out[False]


_TODAY = {"t": "2026-11-27", "o": 50.0, "h": 51.25, "l": 49.5, "c": 50.75, "v": 1234567}


# ── S1: golden, both ways ─────────────────────────────────────────────────────

@pytest.mark.parametrize("with_today", [False, True])
def test_golden_deep_daily_sqlite_then_memory_tier(store, monkeypatch, with_today):
    _seed_daily("GOLDD")
    if with_today:
        monkeypatch.setattr(massive, "todays_daily_bar", lambda tk: dict(_TODAY))
    serve = lambda: bars_router.serve_bars("GOLDD", "D", 5000, "", "", 0)   # noqa: E731
    legacy, new = _serve_both_ways(monkeypatch, [serve, serve])
    assert legacy == new
    body = orjson.loads(new[0][1])
    assert len(body["bars"]) == 5000 + (1 if with_today else 0)
    assert (body["bars"][-1] == _TODAY) is with_today
    assert "contract" in body or "series_rev" in body                      # the contract rode it


@pytest.mark.parametrize("tf,n", [("5", 600), ("15", 5000)])
def test_golden_intraday_full_then_memory_tier(store, monkeypatch, tf, n):
    _seed_intraday("GOLDI", tf, 40)
    serve = lambda: bars_router.serve_bars("GOLDI", tf, n, "", "", 0)       # noqa: E731
    legacy, new = _serve_both_ways(monkeypatch, [serve, serve])
    assert legacy == new
    assert orjson.loads(new[0][1]).get("tail_status") is not None


def test_golden_intraday_since_delta(store, monkeypatch):
    rows = _seed_intraday("GOLDS", "5", 5)
    since = str(rows[-30]["t"])
    legacy, new = _serve_both_ways(
        monkeypatch, [lambda: bars_router.serve_bars("GOLDS", "5", 600, since, "", 0)])
    assert legacy == new
    assert orjson.loads(new[0][1]).get("delta") is True


def test_golden_intraday_to_window(store, monkeypatch):
    _seed_intraday("GOLDT", "15", 30, end=_dt.date(2025, 6, 30))
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range",
                        lambda *a, **k: pytest.fail("a covered window never fetches"))
    legacy, new = _serve_both_ways(
        monkeypatch, [lambda: bars_router.serve_bars("GOLDT", "15", 500, "", "2025-06-30", 0)])
    assert legacy == new
    assert len(orjson.loads(new[0][1])["bars"]) == 500


def test_golden_eth_hourly_from_15m(store, monkeypatch):
    _seed_intraday("GOLDE", "15", 20)
    serve = lambda: bars_router.serve_bars("GOLDE", "60", 200, "", "", 0, "eth")   # noqa: E731
    legacy, new = _serve_both_ways(monkeypatch, [serve, serve])
    assert legacy == new
    body = orjson.loads(new[0][1])
    assert body["tf"] == "60" and body["session"] == "eth" and body["bars"]


def test_golden_cold_warming_503(store, monkeypatch):
    legacy, new = _serve_both_ways(
        monkeypatch, [lambda: bars_router.serve_bars("COLDX", "D", 600, "", "", 0)])
    assert legacy == new
    assert new[0][0] == 503 and orjson.loads(new[0][1]).get("error") == "warming"


# ── S2: the memory-cache entry is never mutated ───────────────────────────────

def test_the_cached_payload_is_never_mutated(store, monkeypatch):
    """Daily with today's bar appended + the contract + newest_bar_is_forming, and intraday
    with tail_status + the contract: the stored memory entry is byte-for-byte what was cached."""
    _seed_daily("MUTD")
    _seed_intraday("MUTI", "5", 10)
    for tk, tf, n in (("MUTD", "D", 5000), ("MUTI", "5", 600)):
        monkeypatch.setattr(massive, "todays_daily_bar", lambda tk: None)
        bars_router.serve_bars(tk, tf, n, "", "", 0)                       # fills the memory tier
        key = f"bars_{tk}_{tf}_{n}"
        entry = cache.get(key)
        assert entry is not None, "fixture: the answer must be memory-cached"
        before = copy.deepcopy(entry)
        # the session opens: memory-tier answers now append today's bar (daily) on top of
        # the contract / tail_status / newest_bar_is_forming fields
        monkeypatch.setattr(massive, "todays_daily_bar", lambda tk: dict(_TODAY))
        for _ in range(2):
            r = bars_router.serve_bars(tk, tf, n, "", "", 0)
            body = orjson.loads(r.body)
            assert set(body) > set(before)                                 # fields were added...
            if tf == "D":
                assert body["bars"][-1] == _TODAY
        assert cache.get(key) is entry and entry == before                 # ...never to the entry


# ── S3: one serialization, no re-parse ────────────────────────────────────────

@pytest.fixture
def counted(monkeypatch):
    n = {"render": 0, "loads": 0}
    real_render = bars_payload.PayloadResponse.render
    real_loads = orjson.loads

    def render(self, content):
        n["render"] += 1
        return real_render(self, content)

    def loads(b):
        n["loads"] += 1
        return real_loads(b)
    monkeypatch.setattr(bars_payload.PayloadResponse, "render", render)
    monkeypatch.setattr(bars_payload.orjson, "loads", loads)
    return n


@pytest.mark.parametrize("tier", ["sqlite", "mem"])
def test_a_daily_answer_with_every_augment_renders_once(store, monkeypatch, counted, tier):
    _seed_daily("ZZONCE")
    monkeypatch.setattr(massive, "todays_daily_bar", lambda tk: dict(_TODAY))
    if tier == "mem":
        bars_router.serve_bars("ZZONCE", "D", 5000, "", "", 0)
    counted.update(render=0, loads=0)
    r = bars_router.serve_bars("ZZONCE", "D", 5000, "", "", 0)
    assert counted == {"render": 1, "loads": 0}
    assert "ser" in _st_names(r) and orjson.loads(r.body)["bars"][-1] == _TODAY


def test_an_eth_hourly_answer_renders_once_and_never_its_15m_input(store, counted):
    _seed_intraday("ONCEE", "15", 10)
    r = bars_router.serve_bars("ONCEE", "60", 100, "", "", 0, "eth")
    assert counted == {"render": 1, "loads": 0}
    assert _st_names(r).count("ser") == 1


def test_the_legacy_switch_is_the_old_cost(store, monkeypatch, counted):
    """CONTROL: the golden rails' legacy side really is the old path (renders per step)."""
    _seed_daily("LEG")
    monkeypatch.setattr(massive, "todays_daily_bar", lambda tk: dict(_TODAY))
    monkeypatch.setattr(bars_payload, "LEGACY_REPARSE", True)
    bars_router.serve_bars("LEG", "D", 5000, "", "", 0)
    assert counted["render"] >= 3 and counted["loads"] >= 2


def test_an_in_process_caller_still_reads_bytes(store):
    _seed_daily("BYTES", n=50)
    r = bars_fetch._get_bars_inner("BYTES", "D", 50)
    assert isinstance(r, bars_payload.PayloadResponse) and not r.rendered
    assert len(orjson.loads(r.body)["bars"]) == 50
    assert r.headers["content-length"] == str(len(r.body))


# ── S4: an unrendered answer goes out whole ───────────────────────────────────

def test_an_unrendered_answer_sends_the_right_content_length():
    payload = {"ticker": "X", "tf": "D", "bars": [{"t": "2026-01-02", "c": 1.5}] * 3}
    r = bars_payload.PayloadResponse(content=payload, headers={"Cache-Control": "no-store"})
    assert not r.rendered
    sent = []

    async def send(msg):
        sent.append(copy.deepcopy(msg))    # a server writes the headers at THIS send

    async def receive():
        return {"type": "http.request"}
    asyncio.run(r({"type": "http", "method": "GET", "headers": []}, receive, send))
    start = dict((k.decode(), v.decode()) for k, v in sent[0]["headers"])
    body = b"".join(m.get("body", b"") for m in sent[1:])
    assert body == orjson.dumps(payload) and start["content-length"] == str(len(body))
    assert start["cache-control"] == "no-store" and start["content-type"] == "application/json"
