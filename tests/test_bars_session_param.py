"""`/api/bars?session=rth|eth` — the chart's session is a first-class input.

(1) tf=60 & session=eth serves TradingView's EXTENDED-hours 60m grid (ET clock
    hours 04:00 … 19:00, the 09:00 bar spanning the open), derived on read from the
    15m serve. The stored tf=60 series stays the RTH grid (09:30, 10:30 …) and is what
    every request without `session=eth` keeps getting.
(2) tail_status is judged against the REQUESTED session's frontier (review #1051 F2):
    an RTH-only chart of a thin name with no post-market prints is `current` at its
    close, not `unverified` + fast polls all evening.
Absent `session` = byte-for-byte the old behaviour (old clients, edge caching).
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo

import orjson
import pytest

from api.routers import bars as bars_router
from api.services import bars_fetch

_ET = ZoneInfo("America/New_York")


def et(y, m, d, hh, mm, ss=0) -> int:
    return int(datetime(y, m, d, hh, mm, ss, tzinfo=_ET).timestamp())


def _st(tf, tail, now, session=None):
    return bars_fetch.intraday_tail_status("THIN", tf, tail, now=now, session=session)["tail_status"]


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr(bars_fetch, "_tail_verified", {})
    bars_fetch.set_request_interactive(False)
    yield
    bars_fetch.set_request_interactive(False)


# ── normalize_session ────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,want", [
    ("rth", "rth"), ("RTH", "rth"), ("eth", "eth"), ("extended", "eth"), (" ext ", "eth"),
    ("", None), (None, None), ("bogus", None), ("clock", None),
])
def test_normalize_session(raw, want):
    assert bars_fetch.normalize_session(raw) == want


# ── F2: tail judged against the chart's own session ──────────────────────────

TUE = (2026, 11, 10)


def test_F2_rth_chart_thin_name_after_close_is_current_not_unverified():
    now = et(*TUE, 18, 0)
    tail = et(*TUE, 15, 55)                       # last RTH 5m bar, no post-market prints
    assert _st("5", tail, now) == "unverified", "legacy/extended judgment (unchanged)"
    assert _st("5", tail, now, "eth") == "unverified"
    assert _st("5", tail, now, "rth") == "current"


def test_F2_rth_chart_after_2000_and_overnight():
    assert _st("5", et(*TUE, 15, 55), et(*TUE, 21, 30), "rth") == "current"
    assert _st("1", et(*TUE, 15, 59), et(2026, 11, 11, 2, 0), "rth") == "current"
    assert _st("60", et(*TUE, 15, 30), et(*TUE, 19, 0), "rth") == "current"


def test_rth_pre_market_judges_the_previous_close():
    now = et(*TUE, 8, 0)
    assert _st("5", et(2026, 11, 9, 15, 55), now, "rth") == "current"
    assert _st("5", et(2026, 11, 9, 15, 55), now) == "unverified"


def test_rth_does_not_excuse_a_truly_behind_tail():
    # mid-session: a tail an hour behind is behind on either session
    now = et(*TUE, 11, 33)
    assert _st("5", et(*TUE, 10, 30), now, "rth") == "unverified"
    assert _st("5", et(*TUE, 11, 25), now, "rth") == "current"
    # after the close, a tail that stopped at 14:00 is still missing the close
    assert _st("5", et(*TUE, 14, 0), et(*TUE, 18, 0), "rth") == "unverified"
    # Monday's close on Tuesday afternoon is a whole session behind
    assert _st("5", et(2026, 11, 9, 15, 55), et(*TUE, 15, 0), "rth") == "unverified"


def test_rth_early_close_day():
    now = et(2026, 11, 27, 15, 0)                 # Black Friday, 13:00 close
    assert _st("5", et(2026, 11, 27, 12, 55), now, "rth") == "current"
    assert _st("5", et(2026, 11, 27, 12, 55), now) == "unverified"


def test_rth_verified_needs_proof_after_the_rth_frontier():
    now = et(*TUE, 18, 0)
    tail = et(*TUE, 14, 0)
    bars_fetch._mark_tail_verified("THIN", "5", et(*TUE, 16, 1))
    assert _st("5", tail, now, "rth") == "verified"
    assert _st("5", tail, now) == "unverified", "extended frontier is 17:55: not proven"


def test_expected_completed_rth_bucket_falls_back_to_previous_session():
    mon_close_5 = et(2026, 11, 9, 15, 55)
    assert bars_fetch.expected_completed_rth_bucket("5", et(*TUE, 8, 0)) == mon_close_5
    assert bars_fetch.expected_completed_rth_bucket("5", et(*TUE, 9, 32)) == mon_close_5
    assert bars_fetch.expected_completed_rth_bucket("5", et(*TUE, 9, 36)) == et(*TUE, 9, 30)
    # Saturday → Friday's close
    assert bars_fetch.expected_completed_rth_bucket("5", et(2026, 11, 14, 12, 0)) == et(2026, 11, 13, 15, 55)
    assert bars_fetch.expected_completed_rth_bucket("D", et(*TUE, 12, 0)) is None


# ── The serve path through the router ────────────────────────────────────────

class _TfStore:
    def __init__(self, by_tf):
        self.by_tf = {k: sorted(v) for k, v in by_tf.items()}

    def _r(self, tf):
        return self.by_tf.get(tf, [])

    def get_last_ts(self, s, tf):
        r = self._r(tf)
        return r[-1][0] if r else None

    def get_bars(self, s, tf, n):
        return self._r(tf)[-n:]

    def get_bars_since(self, s, tf, since):
        return [r for r in self._r(tf) if r[0] > since]

    def put_bars(self, s, tf, new, date_tf=False):
        raise AssertionError("no provider/store write expected in these tests")


def _fmt(rows, tf, ticker=None):
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]


def _rows15_tue():
    """Synthetic 15m bars 04:00 → 19:45 ET Tuesday (64 bars). Values are made up;
    each bar's o/h/l/c encode its index so aggregation is checkable."""
    out = []
    t0 = et(*TUE, 4, 0)
    for i in range(64):
        out.append((t0 + 900 * i, 100.0 + i, 100.5 + i, 99.5 + i, 100.25 + i, 10 + i))
    return out


def _body(resp):
    return orjson.loads(resp.body)


@pytest.fixture
def store(monkeypatch):
    rows15 = _rows15_tue()
    rows60 = [(b["t"], b["o"], b["h"], b["l"], b["c"], b["v"])
              for b in bars_fetch._session_resample_hourly(_fmt(rows15, "15"))]
    st = _TfStore({"15": rows15, "60": rows60,
                   "5": [(et(*TUE, 9, 30) + 300 * i, 1.0, 1.1, 0.9, 1.05, 5) for i in range(78)]})
    for name in ("get_last_ts", "get_bars", "get_bars_since", "put_bars"):
        monkeypatch.setattr(bars_fetch._sqlite, name, getattr(st, name))
    mem = {}
    monkeypatch.setattr(bars_fetch.cache, "get", lambda k: mem.get(k))
    monkeypatch.setattr(bars_fetch.cache, "set", lambda k, v, ttl=None: mem.__setitem__(k, v))
    monkeypatch.setattr(bars_fetch.cache, "invalidate", lambda k: mem.pop(k, None))
    monkeypatch.setattr(bars_fetch, "_fmt_sqlite_bars", _fmt)
    monkeypatch.setattr(bars_fetch, "_maybe_kick_deepfill", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_record_intraday_request", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_history_complete", lambda s, tf: True)
    monkeypatch.setattr(bars_fetch, "_needs_fresh", lambda *a, **k: False)
    monkeypatch.setattr(bars_router, "_is_carried", lambda t: True)
    now = {"t": et(*TUE, 20, 30)}
    real = bars_fetch.intraday_tail_status
    monkeypatch.setattr(bars_fetch, "intraday_tail_status",
                        lambda t, tf, tail, now_=None, **kw: real(t, tf, tail, now=now["t"], **kw))
    return {"store": st, "now": now, "mem": mem}


def _is_clock_hour(t):
    return datetime.fromtimestamp(t, _ET).minute == 0


def test_default_60m_is_still_the_rth_grid(store):
    body = _body(bars_router.serve_bars("THIN", "60", 50))
    ts = [b["t"] for b in body["bars"]]
    assert et(*TUE, 9, 30) in ts and et(*TUE, 10, 30) in ts
    assert et(*TUE, 10, 0) not in ts
    assert "session" not in body
    # explicit rth is the same series
    assert [b["t"] for b in _body(bars_router.serve_bars("THIN", "60", 50, session="rth"))["bars"]] == ts


def test_eth_60m_is_the_clock_hour_grid_from_15m(store):
    resp = bars_router.serve_bars("THIN", "60", 50, session="eth")
    body = _body(resp)
    assert resp.status_code == 200
    assert body["tf"] == "60" and body["session"] == "eth"
    ts = [b["t"] for b in body["bars"]]
    assert ts == [et(*TUE, 4, 0) + 3600 * i for i in range(16)], "04:00 … 19:00 clock hours"
    assert all(_is_clock_hour(t) for t in ts)
    nine = next(b for b in body["bars"] if b["t"] == et(*TUE, 9, 0))
    # 09:00 spans the open: 15m bars #20..#23 (09:00, 09:15, 09:30, 09:45)
    assert nine["o"] == 120.0 and nine["c"] == 123.25
    assert nine["h"] == 123.5 and nine["l"] == 119.5
    assert nine["v"] == sum(10 + i for i in range(20, 24))
    assert body["tail_status"] == "current"
    assert "newest_bar_is_forming" in body


def test_eth_60m_bars_count_trims_to_the_newest(store):
    body = _body(bars_router.serve_bars("THIN", "60", 5, session="eth"))
    assert [b["t"] for b in body["bars"]] == [et(*TUE, 15, 0) + 3600 * i for i in range(5)]


def test_eth_60m_since_delta_reaggregates_the_whole_bucket(store):
    body = _body(bars_router.serve_bars("THIN", "60", 600, since=str(et(*TUE, 18, 0) - 1), session="eth"))
    assert body["delta"] is True
    assert [b["t"] for b in body["bars"]] == [et(*TUE, 18, 0), et(*TUE, 19, 0)]
    nineteen = body["bars"][-1]
    assert nineteen["v"] == sum(10 + i for i in range(60, 64)), "all four 15m bars, not a fragment"
    # a since in ms is normalized too
    body_ms = _body(bars_router.serve_bars("THIN", "60", 600, since=str((et(*TUE, 19, 0) - 1) * 1000),
                                           session="eth"))
    assert [b["t"] for b in body_ms["bars"]] == [et(*TUE, 19, 0)]


def test_eth_60m_tail_status_is_judged_on_the_extended_frontier(store):
    store["now"]["t"] = et(2026, 11, 11, 10, 0)     # Wednesday mid-morning: Tuesday's tail is stale
    resp = bars_router.serve_bars("THIN", "60", 50, session="eth")
    assert _body(resp)["tail_status"] == "unverified"
    assert resp.headers.get("Retry-After") == "3"


def test_F2_end_to_end_rth_chart_is_not_told_to_fast_poll(store):
    store["now"]["t"] = et(*TUE, 18, 0)
    legacy = bars_router.serve_bars("THIN", "5", 50)
    assert _body(legacy)["tail_status"] == "unverified"
    assert legacy.headers.get("Retry-After") == "3"
    rth = bars_router.serve_bars("THIN", "5", 50, session="rth")
    assert _body(rth)["tail_status"] == "current"
    assert "Retry-After" not in rth.headers
    # the bars themselves are identical: session never changes non-60 data
    assert _body(rth)["bars"] == _body(legacy)["bars"]


def test_session_is_ignored_on_daily(store, monkeypatch):
    seen = {}

    def _impl(ticker, tf, bars=200, since="", to="", warm=0, session=None):
        seen["session"] = session
        return bars_router.JSONResponse(content={"ticker": ticker, "tf": tf, "bars": []})
    monkeypatch.setattr(bars_router, "_serve_bars_impl", _impl)
    bars_router.serve_bars("THIN", "D", 50, session="eth")
    assert seen["session"] is None


def test_eth_source_count_never_crosses_the_deep_threshold_on_a_first_paint():
    thr = bars_fetch._DEEP_REQUEST_THRESHOLD
    assert bars_router._eth_src_count(600) == thr - 1
    assert bars_router._eth_src_count(100) == 400
    assert bars_router._eth_src_count(thr - 1) == thr - 1
    assert bars_router._eth_src_count(3000) == 12000


def test_eth_warming_503_passes_through_with_tf_60(monkeypatch):
    def _impl(ticker, tf, bars=200, since="", to="", warm=0, session=None):
        assert tf == "15" and session == "eth"
        r = bars_router.JSONResponse(status_code=503, content={"ticker": ticker, "tf": tf, "bars": [],
                                                                "warming": True})
        r.headers["Retry-After"] = "4"
        r.headers["X-Bars-Shed"] = "warm-shed"
        return r
    monkeypatch.setattr(bars_router, "_serve_bars_impl", _impl)
    resp = bars_router.serve_bars("THIN", "60", 600, warm=1, session="eth")
    assert resp.status_code == 503
    assert resp.headers.get("Retry-After") == "4"
    assert resp.headers.get("X-Bars-Shed") == "warm-shed"
    assert _body(resp)["tf"] == "60" and _body(resp)["warming"] is True


# ── Plumbing: web → tier proxy, tier route, HTTP route ───────────────────────

def test_proxy_forwards_session_to_the_tier(monkeypatch):
    seen = {}

    class _R:
        status_code = 200
        content = b'{"bars":[]}'
        headers = {"content-type": "application/json"}

    class _C:
        async def get(self, url, params=None, headers=None):
            seen["params"] = dict(params)
            return _R()
    monkeypatch.setattr(bars_router, "_bars_proxy_client", _C())
    monkeypatch.setattr(bars_router, "bars_service_headers", lambda: {})
    asyncio.run(bars_router._proxy_bars_to_tier("THIN", "60", 600, "", "", 0, "http://tier", "eth"))
    assert seen["params"]["session"] == "eth"
    asyncio.run(bars_router._proxy_bars_to_tier("THIN", "60", 600, "", "", 0, "http://tier"))
    assert "session" not in seen["params"], "absent stays absent (old tier, same URL)"


def test_http_route_and_tier_route_pass_session(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.bars_auth import require_bars_access
    seen = []

    def _http(ticker, tf, bars=200, since="", to="", warm=0, session=""):
        seen.append(session)
        return bars_router.JSONResponse(content={"bars": []})
    monkeypatch.setattr(bars_router, "serve_bars_http", _http)
    monkeypatch.delenv("BARS_ORIGIN_URL", raising=False)
    app = FastAPI()
    app.include_router(bars_router.router)
    app.dependency_overrides[require_bars_access] = lambda: {"id": 1, "plan": "pro"}
    c = TestClient(app)
    c.get("/api/bars/THIN?tf=60&session=eth")
    c.get("/api/bars/THIN?tf=60")
    assert seen == ["eth", ""]  # "" = default arg: legacy call shape

    import api.bars_api_main as bam
    tier = bam._build_app()
    fn = next(r.endpoint for r in tier.routes if getattr(r, "path", None) == "/api/bars/{ticker}")
    import inspect
    assert "session" in inspect.signature(fn).parameters


# ── review #1061 fixes ───────────────────────────────────────────────────────

def test_F1_a_count_cut_source_never_yields_a_partial_oldest_hour(store, monkeypatch):
    # 18 rows of 15m from the end = 15:30 … 19:45: the 15:00 hour has only 2 of 4
    monkeypatch.setattr(bars_router, "_eth_src_count", lambda bars: 18)
    body = _body(bars_router.serve_bars("THIN", "60", 600, session="eth"))
    ts = [b["t"] for b in body["bars"]]
    assert ts[0] == et(*TUE, 16, 0), "the partial 15:00 hour is dropped"
    assert ts == [et(*TUE, 16, 0) + 3600 * i for i in range(4)]
    for b in body["bars"]:
        assert b["v"] == sum(10 + i for i in range((b["t"] - et(*TUE, 4, 0)) // 900,
                                                   (b["t"] - et(*TUE, 4, 0)) // 900 + 4))


def test_F1_an_hour_aligned_cut_keeps_its_oldest_hour(store, monkeypatch):
    monkeypatch.setattr(bars_router, "_eth_src_count", lambda bars: 20)   # 15:00 … 19:45
    body = _body(bars_router.serve_bars("THIN", "60", 600, session="eth"))
    assert body["bars"][0]["t"] == et(*TUE, 15, 0)


def test_F1_an_uncut_source_keeps_everything(store):
    # 64 rows exist, 1199 asked: nothing was cut, so the first hour is the real first hour
    body = _body(bars_router.serve_bars("THIN", "60", 600, session="eth"))
    assert body["bars"][0]["t"] == et(*TUE, 4, 0) and len(body["bars"]) == 16


def test_F2_deep_eth_source_is_capped_at_the_15m_deep_target():
    assert bars_router._eth_src_count(32000) == 30000
    assert bars_router._eth_src_count(7500) == 30000
    assert bars_router._eth_src_count(5000) == 20000
