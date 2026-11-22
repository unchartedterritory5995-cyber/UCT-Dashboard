"""Cash-index intraday hole repair from a second real vendor (`api/index_bars.py`, 2026-11-18).

Measured on production 2026-11-18/19: /api/bars/SPX?tf=60 (Yahoo ^GSPC 60m) had no bar from
2026-01-30 11:30 to 2026-02-02 12:30 ET and no 12:30 bar on any 13:00 half-day, and the bars at the
hole's edges were partial (01-30 10:30 at about 8% of an hour's volume; 02-02 13:30 opening about 70
points above the session's open). Yahoo answers the same hole however it is asked. Every price below is SYNTHETIC; the
FMP rows follow the shape of `/stable/historical-chart/{interval}` (newest first; `date` = the bar's
START as ET wall-clock text; `volume` may be null), the shape `bars_fetch._fetch_intraday_fmp`
already parses on the same endpoint.

The rules railed here:
  R1 FMP covers the session -> the WHOLE Yahoo day is replaced, its partial edge bars included;
  R2 a bucket FMP does not cover completely stays out and is named in `holes`; nothing else moves;
  R3 a 13:00 half-day expects (and fills) its 12:30 bucket; a holiday is never asked;
  R4 the sidecar: a complete session is never asked again; an empty one after 24 h; a failed call
     after 1 h;
  R5 the ETF proxy is never repaired and never a source;
  R6 no vendor call on a request thread; the ask is kicked to the background;
  R7 a series on another grid (Yahoo's ^VIX clock hours) is left exactly as it is;
  R8 the memoized buckets equal `intraday_gap_audit.expected_rth_buckets`, session by session;
  R9 the answer carries `repaired` / `holes` / `history_rev`, and the router keeps that history_rev;
  R10 the typed FMP function sends the documented request and its rows parse as ET bar starts.
"""
import datetime as dt
import json
import os
import time
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from api import index_bars
from api.services import fmp_client, yf_util
from api.services import intraday_gap_audit as gap

ET = ZoneInfo("America/New_York")
NOW = dt.datetime(2026, 11, 18, 12, 0, tzinfo=ET).timestamp()     # every session below has settled
JAN29, JAN30, FEB2, FEB3 = (dt.date(2026, 1, 29), dt.date(2026, 1, 30),
                            dt.date(2026, 2, 2), dt.date(2026, 2, 3))
NOV26, NOV27, NOV28, DEC1 = (dt.date(2025, 11, 26), dt.date(2025, 11, 27),
                             dt.date(2025, 11, 28), dt.date(2025, 12, 1))

#: The shape FMP answers on /stable/historical-chart/5min (synthetic values): newest first, `date`
#: the bar's START in ET wall clock, field order as FMP prints it, a null volume, plus three rows
#: that are not usable bars (another session, a low above the high, no close).
FMP_SHAPE_FIXTURE = [
    {"date": "2026-02-02 09:40:00", "open": 6000.25, "low": 5999.5, "high": 6001.0, "close": 6000.75, "volume": 1200},
    {"date": "2026-02-02 09:35:00", "open": 6000.0, "low": 5998.0, "high": 6002.5, "close": 6000.25, "volume": None},
    {"date": "2026-02-02 09:30:00", "open": 5990.0, "low": 5989.0, "high": 6001.123, "close": 6000.0, "volume": 3000},
    {"date": "2026-01-30 15:55:00", "open": 1.0, "low": 1.0, "high": 1.0, "close": 1.0, "volume": 1},
    {"date": "2026-02-02 09:45:00", "open": 6000.0, "low": 6005.0, "high": 6001.0, "close": 6000.0, "volume": 1},
    {"date": "2026-02-02 09:50:00", "open": 6000.0, "low": 5999.0, "high": 6001.0, "volume": 1},
]


def _et(d, hm):
    h, m = (int(x) for x in hm.split(":"))
    return int(dt.datetime(d.year, d.month, d.day, h, m, tzinfo=ET).timestamp())


def _hm(t):
    return dt.datetime.fromtimestamp(t, ET).strftime("%H:%M")


def _yahoo(d, price, skip=(), edit=None):
    """Yahoo-shaped 60m bars of session `d` on the authority's grid, minus `skip`."""
    out = []
    for t in gap.expected_rth_buckets("60", d):
        if _hm(t) in skip:
            continue
        b = {"t": t, "o": price, "h": price + 1.0, "l": price - 1.0, "c": price + 0.5, "v": 1000}
        b.update((edit or {}).get(_hm(t), {}))
        out.append(b)
    return out


def _fmp_rows(d, close="16:00", base=5000.0, drop=()):
    """FMP-shaped 5-minute rows of session `d` (newest first), synthetic prices rising 1 a bar."""
    rows, i = [], 0
    t = dt.datetime(d.year, d.month, d.day, 9, 30, tzinfo=ET)
    end = dt.datetime(d.year, d.month, d.day, *(int(x) for x in close.split(":")), tzinfo=ET)
    while t < end:
        if t.strftime("%H:%M") not in drop:
            rows.append({"date": t.strftime("%Y-%m-%d %H:%M:%S"), "open": base + i, "low": base + i - 0.5,
                         "high": base + i + 0.75, "close": base + i + 0.25, "volume": 100})
        t += dt.timedelta(minutes=5)
        i += 1
    return list(reversed(rows))


def _rollup(rows, d, start_hm, end_hm):
    """The bucket [start, end) built by hand from FMP rows: what the repair must serve."""
    lo, hi = _et(d, start_hm), _et(d, end_hm)
    parts = sorted((r for r in rows if lo <= _et(d, r["date"][11:16]) < hi), key=lambda r: r["date"])
    return {"t": lo, "o": parts[0]["open"], "h": max(r["high"] for r in parts),
            "l": min(r["low"] for r in parts), "c": parts[-1]["close"], "v": 100 * len(parts)}


def _day(series, d):
    return {_hm(b["t"]): b for b in series if dt.datetime.fromtimestamp(b["t"], ET).date() == d}


@pytest.fixture(autouse=True)
def sandbox(monkeypatch, tmp_path):
    """No live vendor, and the sidecar in a tmp dir. index_bars swallows vendor errors, so the
    tripwires RECORD and are asserted at teardown (tests/test_index_bars_fmp_primary.py)."""
    from tests.market_intel_breadth_fixtures import install_loopback_only_guard
    refused = install_loopback_only_guard(monkeypatch)
    yf_reads = []
    monkeypatch.setattr(yf_util, "bounded_call",
                        lambda fn, default, *a, **k: yf_reads.append(repr(fn)) or default)
    monkeypatch.setattr(index_bars, "_DISK_DIR", str(tmp_path / "index_bars_cache"))
    yield
    assert yf_reads == [], f"a test reached yfinance: {yf_reads}"
    assert refused == [], f"a test opened a network connection: {refused}"


@pytest.fixture
def fmp(monkeypatch):
    """A fake `fmp_client.get_index_intraday`: `answers[iso]` is the rows FMP gives for that session
    (missing/empty = FMP's not-found), or an exception to raise."""
    rec = {"calls": [], "answers": {}}

    def fake(sym, interval, from_date, to_date, *, timeout=None):
        rec["calls"].append((sym, interval, from_date, to_date, timeout))
        ans = rec["answers"].get(from_date)
        if isinstance(ans, Exception):
            raise ans
        if not ans:
            raise fmp_client._ERR.not_found("FMP: no data for this request")   # as `_fetch` raises it
        return SimpleNamespace(value=ans, degraded=None)

    monkeypatch.setattr(fmp_client, "get_index_intraday", fake)
    return rec


def _hole_series():
    """Yahoo's 2026-01-29 .. 02-03 as measured: the hole and its two partial edge bars."""
    return (_yahoo(JAN29, 6900.0)
            + _yahoo(JAN30, 6940.0, skip=("11:30", "12:30", "13:30", "14:30", "15:30"),
                     edit={"10:30": {"v": 37}})
            + _yahoo(FEB2, 6980.0, skip=("09:30", "10:30", "11:30", "12:30"),
                     edit={"13:30": {"o": 6999.0, "l": 6998.5, "v": 1321}})
            + _yahoo(FEB3, 6950.0))


# ── R1 ───────────────────────────────────────────────────────────────────────────────────────
def test_a_session_fmp_covers_replaces_the_whole_yahoo_day_edge_bars_included(fmp):
    fmp["answers"] = {"2026-01-30": _fmp_rows(JAN30, base=5100.0), "2026-02-02": _fmp_rows(FEB2)}
    series = _hole_series()
    out, rep = index_bars.repair_rth_holes("SPX", "60", series, now=NOW)

    feb2 = _day(out, FEB2)
    assert sorted(feb2) == ["09:30", "10:30", "11:30", "12:30", "13:30", "14:30", "15:30"]
    rows = fmp["answers"]["2026-02-02"]
    assert feb2["13:30"] == _rollup(rows, FEB2, "13:30", "14:30")      # the partial edge bar is gone
    assert feb2["15:30"] == _rollup(rows, FEB2, "15:30", "16:00")      # the 30-minute last bucket
    assert _day(out, JAN30)["10:30"]["v"] == 1200                       # 01-30's partial edge bar too
    assert _day(out, JAN29) == _day(series, JAN29) and _day(out, FEB3) == _day(series, FEB3)
    assert len(out) == 4 * 7 and [b["t"] for b in out] == sorted(b["t"] for b in out)
    assert rep["repaired"] == [{"d": "2026-01-30", "src": "fmp", "buckets": 7, "whole_day": True},
                               {"d": "2026-02-02", "src": "fmp", "buckets": 7, "whole_day": True}]
    assert rep["holes"] == [] and rep["pending"] == 0 and rep["history_rev"] == int(NOW * 1000)
    assert sorted(fmp["calls"]) == [("^GSPC", "5min", "2026-01-30", "2026-01-30", index_bars.REPAIR_FMP_TIMEOUT_S),
                                    ("^GSPC", "5min", "2026-02-02", "2026-02-02", index_bars.REPAIR_FMP_TIMEOUT_S)]


def test_the_divisor_applies_to_repaired_bars(fmp):
    fmp["answers"] = {"2026-02-02": _fmp_rows(FEB2)}
    series = [dict(b, o=b["o"] / 10, h=b["h"] / 10, l=b["l"] / 10, c=b["c"] / 10)
              for b in _yahoo(JAN30, 6940.0) + _yahoo(FEB2, 6980.0, skip=("09:30",))]
    out, _rep = index_bars.repair_rth_holes("XSP", "60", series, now=NOW)
    want = _rollup(fmp["answers"]["2026-02-02"], FEB2, "09:30", "10:30")
    assert _day(out, FEB2)["09:30"]["o"] == pytest.approx(want["o"] / 10)
    assert fmp["calls"][0][0] == "^GSPC"


# ── R2 ───────────────────────────────────────────────────────────────────────────────────────
def test_a_bucket_fmp_does_not_cover_completely_stays_a_named_hole(fmp):
    fmp["answers"] = {"2026-02-02": _fmp_rows(FEB2, drop=("10:40",))}    # one 5-minute bar short
    series = _yahoo(JAN30, 6940.0) + _yahoo(FEB2, 6980.0, skip=("09:30", "10:30", "11:30", "12:30"),
                                            edit={"13:30": {"o": 6999.0, "v": 1321}})
    out, rep = index_bars.repair_rth_holes("SPX", "60", series, now=NOW)
    feb2 = _day(out, FEB2)
    assert "10:30" not in feb2                                          # never a partial hour
    assert sorted(feb2) == ["09:30", "11:30", "12:30", "13:30", "14:30", "15:30"]
    assert feb2["13:30"]["o"] == 6999.0                                # not whole-day: Yahoo's stays
    assert rep["holes"] == [_et(FEB2, "10:30")]
    assert rep["repaired"] == [{"d": "2026-02-02", "src": "fmp", "buckets": 3, "whole_day": False}]


def test_a_session_fmp_does_not_have_stays_as_it_was(fmp):
    series = _yahoo(JAN30, 6940.0) + _yahoo(FEB2, 6980.0, skip=("09:30",))
    out, rep = index_bars.repair_rth_holes("SPX", "60", series, now=NOW)
    assert [b["t"] for b in out] == [b["t"] for b in series]
    assert rep["holes"] == [_et(FEB2, "09:30")] and rep["repaired"] == []
    assert rep["history_rev"] is None                                   # nothing held, nothing moved


# ── R3 ───────────────────────────────────────────────────────────────────────────────────────
def test_a_half_day_expects_and_fills_its_1230_bucket_and_a_holiday_is_never_asked(fmp):
    fmp["answers"] = {"2025-11-28": _fmp_rows(NOV28, close="13:00")}
    series = _yahoo(NOV26, 6700.0) + _yahoo(NOV28, 6800.0, skip=("12:30",)) + _yahoo(DEC1, 6750.0)
    out, rep = index_bars.repair_rth_holes("SPX", "60", series, now=NOW)
    nov28 = _day(out, NOV28)
    assert sorted(nov28) == ["09:30", "10:30", "11:30", "12:30"]
    assert nov28["12:30"] == _rollup(fmp["answers"]["2025-11-28"], NOV28, "12:30", "13:00")
    assert nov28["12:30"]["v"] == 600                                   # six 5-minute bars, to 13:00
    assert [c[2] for c in fmp["calls"]] == ["2025-11-28"]               # 11-27 is Thanksgiving
    assert rep["holes"] == []


# ── R4 ───────────────────────────────────────────────────────────────────────────────────────
def test_a_complete_session_is_never_asked_again(fmp):
    fmp["answers"] = {"2026-02-02": _fmp_rows(FEB2)}
    series = _yahoo(JAN30, 6940.0) + _yahoo(FEB2, 6980.0, skip=("09:30", "10:30"))
    first, rep1 = index_bars.repair_rth_holes("SPX", "60", series, now=NOW)
    fmp["answers"] = {}                                                 # FMP would now say nothing
    again, rep2 = index_bars.repair_rth_holes("SPX", "60", series, now=NOW + 7 * 86400)
    assert len(fmp["calls"]) == 1
    assert again == first and rep2["history_rev"] == rep1["history_rev"]
    side = json.load(open(index_bars._repair_path("^GSPC", "60"), encoding="utf-8"))
    assert side["days"]["2026-02-02"]["state"] == "complete"


def test_an_empty_answer_is_asked_again_after_a_day_and_a_failed_call_after_an_hour(fmp):
    series = _yahoo(JAN30, 6940.0) + _yahoo(FEB2, 6980.0, skip=("09:30",))
    index_bars.repair_rth_holes("SPX", "60", series, now=NOW)            # FMP: not found
    index_bars.repair_rth_holes("SPX", "60", series, now=NOW + index_bars.REPAIR_NEGATIVE_TTL_S - 1)
    assert len(fmp["calls"]) == 1
    fmp["answers"] = {"2026-02-02": RuntimeError("FMP 503 (stub)")}
    index_bars.repair_rth_holes("SPX", "60", series, now=NOW + index_bars.REPAIR_NEGATIVE_TTL_S)
    assert len(fmp["calls"]) == 2
    t_err = NOW + index_bars.REPAIR_NEGATIVE_TTL_S
    index_bars.repair_rth_holes("SPX", "60", series, now=t_err + index_bars.REPAIR_ERROR_RETRY_S - 1)
    assert len(fmp["calls"]) == 2
    fmp["answers"] = {"2026-02-02": _fmp_rows(FEB2)}
    out, rep = index_bars.repair_rth_holes("SPX", "60", series, now=t_err + index_bars.REPAIR_ERROR_RETRY_S)
    assert len(fmp["calls"]) == 3 and rep["holes"] == [] and "09:30" in _day(out, FEB2)


def test_one_refresh_asks_at_most_the_cap_newest_first(fmp, monkeypatch):
    monkeypatch.setattr(index_bars, "REPAIR_MAX_FETCHES", 1)
    series = _hole_series()
    _out, rep = index_bars.repair_rth_holes("SPX", "60", series, now=NOW)
    assert [c[2] for c in fmp["calls"]] == ["2026-02-02"] and rep["pending"] == 1


# ── R5 ───────────────────────────────────────────────────────────────────────────────────────
def test_the_etf_proxy_series_is_never_repaired(fmp, monkeypatch):
    spy = [dict(b) for b in _yahoo(JAN30, 694.0) + _yahoo(FEB2, 698.0, skip=("09:30",)) + _yahoo(FEB3, 695.0)]
    monkeypatch.setattr(index_bars, "_fetch_yf", lambda sym, interval, period, div:
                        spy if sym == "SPY" else _yahoo(FEB3, 6950.0)[:2])
    monkeypatch.setattr(index_bars, "_proxy_ratio", lambda a, b: 10.0)
    info = {}
    out = index_bars._fetch_full_series("SPX", "60", info)
    assert info["proxy"] is True and "repair" not in info
    assert out == spy and fmp["calls"] == []


# ── R6 ───────────────────────────────────────────────────────────────────────────────────────
def test_a_request_thread_asks_no_vendor_and_kicks_the_ask_to_the_background(fmp, monkeypatch):
    from api.services.cache import cache
    fmp["answers"] = {"2026-02-02": _fmp_rows(FEB2)}
    series = _yahoo(JAN30, 6940.0) + _yahoo(FEB2, 6980.0, skip=("09:30",)) + _yahoo(FEB3, 6950.0)
    monkeypatch.setattr(index_bars, "_fetch_yf", lambda *a: [dict(b) for b in series])
    kicked = []
    monkeypatch.setattr(index_bars, "_kick_bg_refresh", lambda s, tf: kicked.append((s, tf)))
    cache.set("idxbars_SPX_60", {"saved_at": time.time() - 2 * index_bars.COLD_STALE_S,
                                 "series": series[:3], "proxy": False}, ttl=600)
    try:
        info = {}
        got, tier = index_bars._cached_series("SPX", "60", info)        # in-request refresh
        assert tier == "index-yf" and fmp["calls"] == []
        assert info["repair"]["pending"] == 1 and info["repair"]["holes"] == [_et(FEB2, "09:30")]
        assert kicked == [("SPX", "60")]
        index_bars._refresh("SPX", "60")                                 # the background refresh
        assert len(fmp["calls"]) == 1
        assert "09:30" in _day((cache.get("idxbars_SPX_60") or {})["series"], FEB2)
    finally:
        cache.invalidate("idxbars_SPX_60")


# ── R7 ───────────────────────────────────────────────────────────────────────────────────────
def test_a_series_on_another_grid_is_left_exactly_as_it_is(fmp):
    clock = [{"t": _et(FEB2, f"{h:02d}:00"), "o": 17.0, "h": 17.5, "l": 16.5, "c": 17.2, "v": 0}
             for h in range(3, 17)]                                     # ^VIX: clock hours 03-16
    out, rep = index_bars.repair_rth_holes("VIX", "60", clock, now=NOW)
    assert out is clock and rep is None and fmp["calls"] == []


# ── R8 ───────────────────────────────────────────────────────────────────────────────────────
def test_the_memoized_buckets_equal_the_authority_session_by_session(monkeypatch):
    monkeypatch.setattr(index_bars, "_expected_shapes", {})
    d, seen = dt.date(2025, 6, 2), 0                    # half-days 07-03, 11-28, 12-24; both DSTs
    while d <= dt.date(2026, 4, 30):
        for tf in ("60", "30", "5"):
            assert index_bars._expected(tf, d) == gap.expected_rth_buckets(tf, d), (tf, d)
        seen += bool(gap.expected_rth_buckets("60", d))
        d += dt.timedelta(days=1)
    assert seen > 200


# ── R9 ───────────────────────────────────────────────────────────────────────────────────────
def test_the_answer_carries_the_repair_cut_to_its_window(monkeypatch):
    from api.services.cache import cache
    series = _yahoo(FEB2, 6980.0) + _yahoo(FEB3, 6950.0, skip=("09:30",))
    rep = {"src": "fmp", "repaired": [{"d": "2026-02-02", "src": "fmp", "buckets": 7, "whole_day": True}],
           "holes": [_et(FEB3, "09:30")], "pending": 0, "history_rev": 1770000000123}
    cache.set("idxbars_SPX_60", {"saved_at": time.time(), "series": series, "proxy": False,
                                 "repair": rep}, ttl=600)
    try:
        full = index_bars.fetch_index_bars("SPX", "60", bars=5000)
        assert full["repaired"] == rep["repaired"] and full["holes"] == rep["holes"]
        assert full["history_rev"] == 1770000000123
        delta = index_bars.fetch_index_bars("SPX", "60", bars=5000, since=_et(FEB3, "12:30"))
        # cut to the sessions the delta spans: 02-03 only (its 09:30 hole is named, 02-02 is not)
        assert delta["repaired"] == [] and delta["holes"] == [_et(FEB3, "09:30")]
        assert delta["history_rev"] == 1770000000123
    finally:
        cache.invalidate("idxbars_SPX_60")


def test_the_router_keeps_an_index_answers_own_history_rev():
    import orjson
    from fastapi.responses import JSONResponse
    from api.routers import bars as bars_router
    body = {"ticker": "SPX", "tf": "60", "bars": [{"t": _et(FEB2, "09:30"), "o": 1, "h": 1, "l": 1, "c": 1, "v": 0}],
            "history_rev": 1770000000123, "holes": []}
    kept = bars_router._augment_with_contract(JSONResponse(content=body), "SPX", "60", None,
                                              store_backed=False, tail_status=False, own_history_rev=True)
    assert orjson.loads(kept.body)["history_rev"] == 1770000000123
    other = bars_router._augment_with_contract(JSONResponse(content=body), "SPX", "60", None,
                                               store_backed=False, tail_status=False)
    assert orjson.loads(other.body)["history_rev"] is None              # every other branch: as before


# ── R10 ──────────────────────────────────────────────────────────────────────────────────────
def test_the_typed_function_sends_the_documented_request_and_parses_as_et_bar_starts(monkeypatch):
    from unittest.mock import MagicMock
    from api.services import fmp_response_cache
    resp = MagicMock(status_code=200)
    resp.json.return_value = FMP_SHAPE_FIXTURE
    get = MagicMock(return_value=resp)
    monkeypatch.setattr(fmp_client._session, "get", get)
    monkeypatch.setenv("FMP_API_KEY", "test-key")
    monkeypatch.setattr(fmp_response_cache, "get", lambda *a, **k: None)
    monkeypatch.setattr(fmp_response_cache, "put", lambda *a, **k: None)
    monkeypatch.setattr(fmp_client, "_take_token", lambda: True)
    from api.services.cache import cache
    cache.invalidate("fmp_forbidden_/stable/historical-chart/5min")

    res = fmp_client.get_index_intraday("^GSPC", "5min", "2026-02-02", "2026-02-02", timeout=10)
    url, kw = get.call_args[0][0], get.call_args[1]
    assert url == fmp_client._BASE_URL + "/stable/historical-chart/5min"
    assert {k: kw["params"][k] for k in ("symbol", "from", "to")} == {
        "symbol": "^GSPC", "from": "2026-02-02", "to": "2026-02-02"}
    assert kw["timeout"] == 10 and res.licensing_class == "LA"     # T-40 DDLA column (restated 2026-11-19)

    bars = index_bars._parse_fmp_intraday(res.value, FEB2)
    assert sorted(bars) == [1770042600, 1770042900, 1770043200]          # 09:30 / 09:35 / 09:40 EST
    assert bars[1770042600] == {"t": 1770042600, "o": 5990.0, "h": 6001.12, "l": 5989.0, "c": 6000.0, "v": 3000}
    assert bars[1770042900]["v"] == 0                                    # a null volume


def test_the_licensing_row_names_the_intraday_endpoint():
    from api.services import provider_licensing_class as plc
    e = plc.entry_for("fmp", "indices")
    assert e.licensing_class == "LA" and "historical-chart" in e.note and "T-40" in e.register_row
