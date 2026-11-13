"""Phase 2 history (hist-builder) — weekly / monthly `bars.daily`, the `day_pct` event study, "the last N times", no
look-ahead, and ACCESS through the Agent's real doors. SYNTHETIC bars only (no network, no real store, no model).

(1) `bars.daily` tf=W|M: the SAME read-only daily store read, resampled by the product's OWN resamplers
    (bars_fetch._resample_weekly_iso: friday-close dating; _resample_monthly_iso: the month's 1st); a forming week / month
    is `partial` (reason `forming`), never a closed bar; a period missing a stored session is `missing_sessions`; rows
    before 2003-09-10 are labelled yfinance history.
(2) `history.eventStudy`: `day_pct` (close vs the previous close) and `last` (the most recent N events, by date alone).
(3) No look-ahead (the cotAnalogs rule: everything is computed as of the event; nothing after it is knowable): a study
    ending at T over the FULL history selects the same events with the same condition values as one over the history
    TRUNCATED at T — and as one whose post-T bars are wildly different.
(4) ACCESS: anonymous 401, free 402, paid non-admin 403 on every Agent door, and the bars store is never read.
"""
from __future__ import annotations

import math
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import bars_fetch, bars_sqlite
from api.services.market_intel import event_study as es
from api.services.market_intel import price_reads as pr
from api.services.uct_agent.marketdata import bars_daily as bd
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import history_event_study as hes
from api.services.uct_agent.marketdata import sessions
from tests import market_intel_event_fixtures as fx

DAYS = fx.trading_days("2023-11-01", "2025-01-31")
YMDS = [int(d.replace("-", "")) for d in DAYS]


def _c(i: int) -> float:
    return round(100.0 + 8.0 * math.sin(i / 6.0) + 0.05 * i, 4)


class _Store:
    def __init__(self, ymds, close=_c):
        self.rows = [(d, close(i) - 0.5, close(i) + 1.0, close(i) - 1.0, close(i), 1000 + i) for i, d in enumerate(ymds)]
        self.calls = []

    def get_bars_before(self, ticker, tf, max_bars, to_key):
        self.calls.append((ticker, tf, max_bars, to_key))
        return [r for r in self.rows if r[0] <= to_key][-max_bars:]


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, "bars.daily,history.eventStudy")
    gw._reset_for_test(None)
    boom = lambda *a, **k: (_ for _ in ()).throw(AssertionError("side effect"))  # noqa: E731
    for name in ("_get_bars_inner", "fetch_with_validation", "_fetch_daily", "_fetch_monthly", "_maybe_kick_deepfill",
                 "_kick_cold_fetch", "kick_snapshot_warm", "warm_bars_async"):
        monkeypatch.setattr(bars_fetch, name, boom, raising=False)
    yield
    gw._reset_for_test(None)


def _world(monkeypatch, latest: int, ymds=YMDS, close=_c):
    store = _Store(ymds, close)
    monkeypatch.setattr(bars_sqlite, "get_bars_before", store.get_bars_before)

    def last_closed(now=None):
        if now is None:
            return latest
        ymd = int(now.strftime("%Y%m%d"))
        return max(d for d in YMDS if d <= min(ymd, latest))
    monkeypatch.setattr(bars_fetch, "_last_closed_session_yyyymmdd", last_closed)
    monkeypatch.setattr(sessions, "last_completed_session", last_closed)
    return store


def _read(params, turn="t1"):
    return gw.read("bars.daily", params, user_id=1, turn_id=turn)


def _daily_dicts(upto: int):
    return [{"t": d, "o": _c(i) - 0.5, "h": _c(i) + 1.0, "l": _c(i) - 1.0, "c": _c(i), "v": 1000 + i}
            for i, d in enumerate(DAYS) if YMDS[i] <= upto]


# ── (1) weekly / monthly ───────────────────────────────────────────────────────────────────────────────

def test_weekly_is_the_product_resampler_over_the_daily_store_dated_by_friday(monkeypatch):
    store = _world(monkeypatch, latest=20250124)                        # a Friday: the newest week is closed
    seen = []
    real = bars_fetch._resample_weekly_iso
    monkeypatch.setattr(bars_fetch, "_resample_weekly_iso", lambda b, t=None: seen.append(t) or real(b, t))
    out = _read({"symbol": "AAPL", "tf": "W", "bars": 8})
    assert env.validate_envelope(out) == [] and out["status"] == "ok" and out["provider_calls"] == 0
    assert seen == ["AAPL"] and {c[1] for c in store.calls} == {"D"}    # ONE daily read, the product's resampler
    rows = out["data"]["bars"]
    assert len(rows) == 8 and all(datetime.strptime(r["date"], "%Y-%m-%d").weekday() == 4 for r in rows)
    expect = {w["t"]: w for w in real(_daily_dicts(20250124))}
    for r in rows:                                                     # exactly the resampler's candle
        w = expect[r["date"]]
        assert (r["open"], r["high"], r["low"], r["close"], r["volume"]) == (w["o"], w["h"], w["l"], w["c"], w["v"])
    keys = sorted(expect)
    for r in rows:                                                     # change vs the PREVIOUS week's close
        prev = expect[keys[keys.index(r["date"]) - 1]]["c"]
        assert r["change_pct"] == pytest.approx((r["close"] / prev - 1) * 100)
    assert rows[-1]["partial"] is False and out["data"]["current_period_partial"] is False
    assert bd.NOTE_RESAMPLED["W"] in out["notes"] and not any("still forming" in n for n in out["notes"])


def test_a_forming_week_is_partial_never_a_closed_bar(monkeypatch):
    _world(monkeypatch, latest=20250129)                                # Wednesday: Thu + Fri still to come
    out = _read({"symbol": "AAPL", "tf": "W", "bars": 3})
    last = out["data"]["bars"][-1]
    assert last["date"] == "2025-01-31" and last["last_session"] == "2025-01-29" and last["sessions"] == 3
    assert last["partial"] is True and last["partial_reason"] == "forming"
    assert out["data"]["current_period_partial"] is True
    assert bd.NOTE_FORMING.format(unit="week", d="2025-01-31") in out["notes"]
    assert all(r["partial"] is False for r in out["data"]["bars"][:-1])


def test_a_holiday_friday_week_is_closed_on_its_thursday(monkeypatch):
    _world(monkeypatch, latest=20250131)
    out = _read({"symbol": "AAPL", "tf": "W", "bars": 2, "to": "2024-03-28"})   # Good Friday 2024-03-29: no session
    last = out["data"]["bars"][-1]
    assert last["date"] == "2024-03-29" and last["last_session"] == "2024-03-28" and last["partial"] is False


def test_a_week_missing_a_stored_session_is_partial_missing_sessions_not_forming(monkeypatch):
    _world(monkeypatch, latest=20250131, ymds=[d for d in YMDS if d != 20240614])
    out = _read({"symbol": "AAPL", "tf": "W", "from": "2024-06-03", "to": "2024-06-28"})
    by = {r["date"]: r for r in out["data"]["bars"]}
    assert by["2024-06-14"]["partial"] is True and by["2024-06-14"]["partial_reason"] == "missing_sessions"
    assert by["2024-06-07"]["partial"] is False and out["data"]["current_period_partial"] is False


def test_monthly_returns_for_a_calendar_year(monkeypatch):
    _world(monkeypatch, latest=20250131)
    seen = []
    real = bars_fetch._resample_monthly_iso
    monkeypatch.setattr(bars_fetch, "_resample_monthly_iso", lambda b, t=None: seen.append(t) or real(b, t))
    out = _read({"symbol": "NVDA", "tf": "M", "from": "2024-01-01", "to": "2024-12-31"})
    assert out["status"] == "ok" and seen == ["NVDA"]
    rows = out["data"]["bars"]
    assert [r["date"] for r in rows] == [f"2024-{m:02d}-01" for m in range(1, 13)]
    dec23 = real(_daily_dicts(20231231))[-1]
    assert rows[0]["change_pct"] == pytest.approx((rows[0]["close"] / dec23["c"] - 1) * 100)   # Jan vs Dec 2023's close
    assert all(r["partial"] is False for r in rows) and rows[-1]["last_session"] == "2024-12-31"


def test_the_current_month_is_partial_forming(monkeypatch):
    _world(monkeypatch, latest=20250115)
    out = _read({"symbol": "NVDA", "tf": "M", "bars": 2})
    last = out["data"]["bars"][-1]
    assert last["date"] == "2025-01-01" and last["partial"] is True and last["partial_reason"] == "forming"
    assert bd.NOTE_FORMING.format(unit="month", d="2025-01-01") in out["notes"]


def test_rows_before_the_massive_floor_are_labelled_yfinance(monkeypatch):
    old = fx.trading_days("2003-07-01", "2003-11-28")
    ymds = [int(d.replace("-", "")) for d in old]
    store = _Store(ymds)
    monkeypatch.setattr(bars_sqlite, "get_bars_before", store.get_bars_before)
    monkeypatch.setattr(sessions, "last_completed_session", lambda now=None: 20031128 if now is None else
                        max(d for d in ymds if d <= int(now.strftime("%Y%m%d"))))
    out = _read({"symbol": "MSFT", "tf": "M", "bars": 4})
    flags = {r["date"]: bool(r.get("pre_vendor_floor")) for r in out["data"]["bars"]}
    assert flags == {"2003-08-01": True, "2003-09-01": True, "2003-10-01": False, "2003-11-01": False}
    assert bd.NOTE_PRE_FLOOR in out["notes"]
    d = _read({"symbol": "MSFT", "bars": 5, "to": "2003-09-12"}, turn="t2")
    assert [bool(b.get("pre_vendor_floor")) for b in d["data"]["bars"]] == [True, True, False, False, False]
    assert bd.NOTE_PRE_FLOOR in d["notes"]
    modern = _read({"symbol": "MSFT", "bars": 2}, turn="t3")
    assert bd.NOTE_PRE_FLOOR not in modern["notes"] and all("pre_vendor_floor" not in b for b in modern["data"]["bars"])


@pytest.mark.parametrize("params", [{"symbol": "AAPL", "tf": "Q"}, {"symbol": "AAPL", "tf": "W", "bars": 521},
                                    {"symbol": "AAPL", "tf": "M", "bars": 301}, {"symbol": "AAPL", "tf": 5}])
def test_bad_timeframe_requests_are_refused_before_any_read(monkeypatch, params):
    store = _world(monkeypatch, latest=20250131)
    assert _read(params)["status"] in ("refused", "unavailable") and store.calls == []


def test_a_symbol_the_store_does_not_hold_is_unavailable_never_fabricated(monkeypatch):
    _world(monkeypatch, latest=20250131, ymds=[])
    out = _read({"symbol": "ZZZZ", "tf": "W"})
    assert out["status"] == "unavailable" and out["data"] is None


def test_daily_reads_are_unchanged_by_tf(monkeypatch):
    _world(monkeypatch, latest=20250131)
    a = _read({"symbol": "AAPL", "bars": 5})
    b = _read({"symbol": "AAPL", "bars": 5, "tf": "D"}, turn="t2")
    assert a["data"] == b["data"] and "timeframe" not in a["data"]


# ── (2) day_pct + last N ───────────────────────────────────────────────────────────────────────────────

S = fx.S


def _drops(i: int) -> float:
    """A price path with hand-placed one-day drops of 4%+ on these sessions."""
    p = 100.0
    for k in range(1, i + 1):
        p *= 0.95 if k in DROPS else 1.004
    return p


DROPS = {20, 61, 95, 140, 177, 205}


def _tech(ind="day_pct", period=None):
    return {"kind": "technical", "symbol": "SPY", "indicator": ind, **({"period": period} if period else {})}


def test_day_pct_is_close_vs_the_previous_close(monkeypatch):
    fx.install(monkeypatch, bars=[{"t": d, "o": _drops(i), "h": 0, "l": 0, "c": _drops(i), "v": 0} for i, d in enumerate(S)])
    r = es.run({"condition": {"series": _tech(), "op": "below", "threshold": -3}, "symbol": "SPY",
                "horizons": [{"sessions": 1}, {"sessions": 5}]})
    assert r["status"] == "ok" and [e["event_date"] for e in r["events"]] == [S[k] for k in sorted(DROPS)]
    assert all(e["condition_value"] == pytest.approx(-5.0) for e in r["events"])
    assert r["series_label"].startswith("SPY one-day change")


def test_last_n_keeps_the_most_recent_events_and_says_so(monkeypatch):
    fx.install(monkeypatch, bars=[{"t": d, "o": _drops(i), "h": 0, "l": 0, "c": _drops(i), "v": 0} for i, d in enumerate(S)])
    base = {"condition": {"series": _tech(), "op": "below", "threshold": -3}, "symbol": "SPY", "horizons": [{"sessions": 5}]}
    r = es.run({**base, "last": 3})
    assert [e["event_date"] for e in r["events"]] == [S[k] for k in sorted(DROPS)][-3:]
    assert r["counts"]["events_used"] == 3 and r["counts"]["events_before_last"] == 3
    assert any("most recent 3" in n for n in r["notes"])
    assert "most recent 3 event(s)" in es.request_note({**base, "last": 3})
    assert es.validate({**base, "last": 0})[1]["reason"] == "bad_request"
    ok, _ = es.validate(base)
    assert "last" not in ok                                            # absent unless asked (the echo rail's key set)


def test_the_agent_kind_carries_day_pct_and_last_and_states_the_sample(monkeypatch):
    fx.install(monkeypatch, bars=[{"t": d, "o": _drops(i), "h": 0, "l": 0, "c": _drops(i), "v": 0} for i, d in enumerate(S)])
    monkeypatch.setattr(sessions, "last_completed_session", lambda now=None: int(S[-1].replace("-", "")))
    p = {"symbol": "SPY", "indicator": "day_pct", "period": None, "op": "below", "threshold": -3, "horizons": [1, 5], "last": 4}
    assert hes.validate(p) is None and hes.validate({**p, "period": 5}) and hes.validate({**p, "last": 61})
    out = gw.read(hes.KIND, p, user_id=1, turn_id="t-es")
    assert out["status"] == "ok" and out["data"]["summary"]["events_used"] == 4
    assert out["data"]["summary"]["last"] == 4 and out["data"]["summary"]["events_before_last"] == 2
    assert hes.NOTE_SAMPLE in out["notes"] and hes.NOTE_DESCRIPTIVE in out["notes"]
    s = out["data"]["summary"]
    assert not any(isinstance(v, float) for v in s.values())           # the value-free part carries no return


# ── (3) no look-ahead past each event's as-of date (the cotAnalogs rule) ───────────────────────────────

def _wavy(i: int) -> float:
    return 100.0 + 9.0 * math.sin(i / 4.0) + 3.0 * math.sin(i / 1.7) + 0.03 * i


CUT = 160                                                              # T = S[CUT]


@pytest.mark.parametrize("ind,period,op,thr", [
    ("day_pct", None, "below", -2.0), ("gap_pct", None, "above", 1.0), ("pct_from_high", 20, "cross_above", 0),
    ("pct_from_sma", 10, "cross_below", 0), ("rsi", 14, "cross_below", 40), ("bb_pct_b", 20, "below", 10),
    ("macd_hist", None, "cross_above", 0)])
@pytest.mark.parametrize("last", [None, 3])
def test_no_post_event_bar_reaches_an_events_conditioning_or_selection(monkeypatch, ind, period, op, thr, last):
    def bars(upto=None, poison=False):
        out = []
        for i, d in enumerate(S):
            if upto is not None and i > upto:
                break
            c = _wavy(i) * (3.0 if poison and i > CUT else 1.0)        # a wildly different future
            o = _wavy(i - 1) * (1.012 if i % 7 == 0 else 0.997) if i else c
            out.append({"t": d, "o": o * (3.0 if poison and i > CUT else 1.0), "h": 0, "l": 0, "c": c, "v": 0})
        return out

    def study(b, end=None):
        fx.install(monkeypatch, bars=b)
        req = {"condition": {"series": _tech(ind, period), "op": op, "threshold": thr}, "symbol": "SPY",
               "horizons": [{"sessions": 1}], "episodes": "all", **({"end": end} if end else {}), **({"last": last} if last else {})}
        r = es.run(req)
        assert r["status"] == "ok", r
        return [(e["event_date"], round(e["condition_value"], 9)) for e in r["events"]]

    full = study(bars(), end=S[CUT])
    truncated = study(bars(upto=CUT))
    poisoned = study(bars(poison=True), end=S[CUT])
    assert full, f"the fixture must produce {ind} events before T"
    assert all(d <= S[CUT] for d, _ in full)
    assert full == truncated == poisoned


def test_the_lookahead_rail_would_catch_a_leak(monkeypatch):
    """Mutation guard for the rail above: a condition series that peeks one session ahead differs under a poisoned future."""
    from api.services.market_intel import series_adapters as sa
    real = sa._tech_load

    def leaky(spec):
        r = real(spec)
        rows = r["rows"]
        return {**r, "rows": [(rows[k][0], rows[k + 1][1]) for k in range(len(rows) - 1)]}
    monkeypatch.setitem(sa.ADAPTERS, "technical", (sa.ADAPTERS["technical"][0], leaky))

    def study(b):
        fx.install(monkeypatch, bars=b)
        r = es.run({"condition": {"series": _tech(), "op": "below", "threshold": -2.0}, "symbol": "SPY",
                    "horizons": [{"sessions": 1}], "episodes": "all", "end": S[CUT]})
        return [(e["event_date"], round(e["condition_value"], 9)) for e in r["events"]]
    clean = [{"t": d, "o": _wavy(i), "h": 0, "l": 0, "c": _wavy(i), "v": 0} for i, d in enumerate(S)]
    poison = [{**b, "c": b["c"] * (0.5 if i == CUT + 1 else 1.0)} for i, b in enumerate(clean)]
    assert study(clean) != study(poison)


# ── (4) ACCESS: the Agent's real doors ─────────────────────────────────────────────────────────────────

def _app(user=None):
    from api.middleware.auth_middleware import get_current_user_with_plan
    from api.routers import uct_agent as rx
    app = FastAPI()
    app.include_router(rx.router)
    if user is not None:                       # identity only; the paid / admin gates stay the real dependencies
        app.dependency_overrides[get_current_user_with_plan] = lambda: user
    return TestClient(app)


READS = [("bars.daily", {"symbol": "AAPL", "tf": "W", "bars": 4}),
         ("history.eventStudy", {"symbol": "SPY", "indicator": "day_pct", "op": "below", "threshold": -3, "last": 5})]


@pytest.mark.parametrize("user,code", [(None, 401), ({"id": "u-free", "plan": "free", "role": "user"}, 402),
                                       ({"id": "u-paid", "plan": "pro", "role": "user"}, 403)])
def test_anonymous_unpaid_and_paid_non_admin_get_no_history_through_any_agent_door(monkeypatch, user, code):
    store = _world(monkeypatch, latest=20250131)
    state = fx.install(monkeypatch)
    c = _app(user)
    for kind, params in READS:
        r = c.post("/api/agent/data", json={"kind": kind, "params": params, "turn_id": "t-x"})
        assert r.status_code == code and '"bars"' not in r.text and "study" not in r.text, kind
    for path in ("/api/agent/turn", "/api/agent/turn/stream", "/api/agent/turn/resume"):
        r = c.post(path, json={"message": "monthly returns for NVDA in 2024", "context": {}, "capabilities": []})
        assert r.status_code == code, path
    assert store.calls == [] and state["price_calls"] == 0            # the store was never read


def test_an_admin_reads_weekly_bars_through_the_gateway(monkeypatch):
    store = _world(monkeypatch, latest=20250131)
    r = _app({"id": "u-admin", "plan": "pro", "role": "admin"}).post(
        "/api/agent/data", json={"kind": "bars.daily", "params": {"symbol": "AAPL", "tf": "W", "bars": 4}, "turn_id": "t-a"})
    assert r.status_code == 200 and r.json()["data"]["timeframe"] == "W" and store.calls


def test_dark_unless_the_kind_is_named(monkeypatch):
    store = _world(monkeypatch, latest=20250131)
    monkeypatch.setenv(gw.KINDS_ENV, "quote")
    assert _read({"symbol": "AAPL", "tf": "W"})["status"] == "refused"
    monkeypatch.delenv(gw.DATA_ENV)
    assert _read({"symbol": "AAPL", "tf": "W"}, turn="t2")["status"] == "refused"
    assert store.calls == []
