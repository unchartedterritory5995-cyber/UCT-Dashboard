"""Tests for api/services/ticker_ipo.get_ipo_date — the chart IPO-badge date source."""
import importlib

import pytest


@pytest.fixture
def ipo_mod(tmp_path, monkeypatch):
    """Fresh ticker_ipo module with an isolated (temp) cache dir + empty mem cache."""
    import api.services.ticker_ipo as mod
    importlib.reload(mod)
    monkeypatch.setattr(mod, "_CACHE_DIR", str(tmp_path / "ipo_cache"))
    mod._mem.clear() if hasattr(mod._mem, "clear") else None
    # No test may reach the network: the background resolve is captured, never run,
    # unless a test installs its own seam and its own stubbed sources.
    mod._submitted = []
    monkeypatch.setattr(mod, "_submit_resolve", lambda fn: mod._submitted.append(fn))
    monkeypatch.setattr(mod, "_deep_daily_earliest", lambda s: (_ for _ in ()).throw(AssertionError("unstubbed deep read")))
    monkeypatch.setattr(mod, "_fmp_earliest", lambda s, ld: None)
    return mod


def _patch_details(monkeypatch, mod, result):
    from api.services import massive
    monkeypatch.setattr(massive, "get_ticker_details", lambda t: result)


def test_returns_valid_list_date(ipo_mod, monkeypatch):
    _patch_details(monkeypatch, ipo_mod, {"list_date": "2019-03-14", "name": "X"})
    out = ipo_mod.get_ipo_date("ABC")
    # list_date keeps its meaning; a cache miss answers NON-final at once.
    assert out == {"symbol": "ABC", "list_date": "2019-03-14",
                   "first_trade_date": "2019-03-14", "first_trade_final": False}


def test_missing_list_date_is_null(ipo_mod, monkeypatch):
    _patch_details(monkeypatch, ipo_mod, {"name": "X"})  # no list_date
    out = ipo_mod.get_ipo_date("NODATE")
    assert out["list_date"] is None


def test_malformed_list_date_rejected(ipo_mod, monkeypatch):
    _patch_details(monkeypatch, ipo_mod, {"list_date": "not-a-date"})
    assert ipo_mod.get_ipo_date("BADFMT")["list_date"] is None


def test_provider_error_returns_null_uncached(ipo_mod, monkeypatch):
    from api.services import massive
    def boom(_t):
        raise RuntimeError("provider down")
    monkeypatch.setattr(massive, "get_ticker_details", boom)
    assert ipo_mod.get_ipo_date("ERR")["list_date"] is None
    # A null miss must NOT be cached — a later good call resolves it.
    monkeypatch.setattr(massive, "get_ticker_details", lambda t: {"list_date": "2020-06-01"})
    assert ipo_mod.get_ipo_date("ERR")["list_date"] == "2020-06-01"


def test_blank_symbol(ipo_mod):
    assert ipo_mod.get_ipo_date("")["list_date"] is None


def test_valid_date_is_cached(ipo_mod, monkeypatch):
    calls = {"n": 0}
    def details(_t):
        calls["n"] += 1
        return {"list_date": "2021-01-04"}
    from api.services import massive
    monkeypatch.setattr(massive, "get_ticker_details", details)
    assert ipo_mod.get_ipo_date("CACHE")["list_date"] == "2021-01-04"
    assert ipo_mod.get_ipo_date("CACHE")["list_date"] == "2021-01-04"
    assert calls["n"] == 1  # second call served from mem cache


# ─── first_trade_date: the listing statement's reference date ─────────────────
# Measured production values (2026-10-04): SPY list_date 1993-01-22, deep daily
# history 8477 bars from 1993-01-29; QQQ list_date 1999-03-10, history from
# 2006-08-07; AAPL list_date == first bar == 1980-12-12.

DEEP = 12500


@pytest.mark.parametrize("why,args,want", [
    ("SPY: exhausted, after, within 14 days -> the first session",
     ("1993-01-22", "1993-01-29", 8477, DEEP, None), "1993-01-29"),
    ("QQQ: a 7-year gap is missing history, not a first week -> unchanged",
     ("1999-03-10", "2006-08-07", 5071, DEEP, None), "1999-03-10"),
    ("AAPL: first bar already equals list_date -> unchanged",
     ("1980-12-12", "1980-12-12", 11544, DEEP, None), "1980-12-12"),
    ("not exhausted: a full read could be truncated -> unchanged",
     ("1993-01-22", "1993-01-29", DEEP, DEEP, None), "1993-01-22"),
    ("gap of 15 days (> 14) -> unchanged",
     ("2000-05-01", "2000-05-16", 6000, DEEP, None), "2000-05-01"),
    ("gap of exactly 14 days -> accepted",
     ("2000-05-01", "2000-05-15", 6000, DEEP, None), "2000-05-15"),
    ("FMP disagrees -> refused",
     ("1993-01-22", "1993-01-29", 8477, DEEP, "1993-01-28"), "1993-01-22"),
    ("FMP agrees -> accepted",
     ("1993-01-22", "1993-01-29", 8477, DEEP, "1993-01-29"), "1993-01-29"),
    ("earliest BEFORE list_date -> unchanged",
     ("2024-03-21", "2024-03-20", 600, DEEP, None), "2024-03-21"),
])
def test_first_trade_decision(ipo_mod, why, args, want):
    assert ipo_mod.first_trade_decision(*args) == want, why


def test_spy_resolves_to_its_first_session_and_is_cached_final(ipo_mod, monkeypatch):
    _patch_details(monkeypatch, ipo_mod, {"list_date": "1993-01-22"})
    monkeypatch.setattr(ipo_mod, "_deep_daily_earliest", lambda s: ("1993-01-29", 8477))
    first = ipo_mod.get_ipo_date("SPY")
    assert first["first_trade_final"] is False and first["first_trade_date"] == "1993-01-22"
    assert len(ipo_mod._submitted) == 1
    ipo_mod._submitted.pop()()                      # run the background resolve here
    again = ipo_mod.get_ipo_date("SPY")
    assert again == {"symbol": "SPY", "list_date": "1993-01-22",
                     "first_trade_date": "1993-01-29", "first_trade_final": True}
    assert ipo_mod._disk_get("SPY") == again        # durable
    assert ipo_mod._submitted == []                 # a final answer kicks nothing


def test_qqq_is_refused_and_final(ipo_mod, monkeypatch):
    _patch_details(monkeypatch, ipo_mod, {"list_date": "1999-03-10"})
    monkeypatch.setattr(ipo_mod, "_deep_daily_earliest", lambda s: ("2006-08-07", 5071))
    ipo_mod.get_ipo_date("QQQ")
    ipo_mod._submitted.pop()()
    out = ipo_mod.get_ipo_date("QQQ")
    assert out["first_trade_final"] is True and out["first_trade_date"] == "1999-03-10"


def test_fmp_disagreement_refuses_through_the_resolve(ipo_mod, monkeypatch):
    _patch_details(monkeypatch, ipo_mod, {"list_date": "1993-01-22"})
    monkeypatch.setattr(ipo_mod, "_deep_daily_earliest", lambda s: ("1993-01-29", 8477))
    monkeypatch.setattr(ipo_mod, "_fmp_earliest", lambda s, ld: "1993-01-25")
    ipo_mod.get_ipo_date("SPY")
    ipo_mod._submitted.pop()()
    assert ipo_mod.get_ipo_date("SPY")["first_trade_date"] == "1993-01-22"


def test_a_failed_deep_read_stays_non_final_and_is_not_retried_at_once(ipo_mod, monkeypatch):
    _patch_details(monkeypatch, ipo_mod, {"list_date": "1993-01-22"})
    monkeypatch.setattr(ipo_mod, "_deep_daily_earliest", lambda s: (None, None))
    ipo_mod.get_ipo_date("SPY")
    ipo_mod._submitted.pop()()
    out = ipo_mod.get_ipo_date("SPY")
    assert out["first_trade_final"] is False and out["first_trade_date"] == "1993-01-22"
    assert ipo_mod._submitted == []                 # inside the retry cooldown


def test_a_cache_miss_returns_fast_without_touching_the_deep_path(ipo_mod, monkeypatch):
    # The fixture's deep-read stub RAISES; if the request thread reached it this fails.
    import time as _t
    _patch_details(monkeypatch, ipo_mod, {"list_date": "1993-01-22"})
    t0 = _t.perf_counter()
    out = ipo_mod.get_ipo_date("SPY")
    assert _t.perf_counter() - t0 < 0.5
    assert out["first_trade_final"] is False
    assert len(ipo_mod._submitted) == 1             # deferred, not run


def test_two_concurrent_misses_start_one_resolve(ipo_mod, monkeypatch):
    import threading
    _patch_details(monkeypatch, ipo_mod, {"list_date": "1993-01-22"})
    gate = threading.Barrier(8)
    def call():
        gate.wait()
        ipo_mod.get_ipo_date("SPY")
    ts = [threading.Thread(target=call) for _ in range(8)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert len(ipo_mod._submitted) == 1


def test_a_legacy_cache_entry_without_the_final_flag_is_re_resolved(ipo_mod, monkeypatch):
    ipo_mod._disk_put("SPY", {"symbol": "SPY", "list_date": "1993-01-22"})
    _patch_details(monkeypatch, ipo_mod, {"list_date": "WRONG"})   # must not be consulted
    out = ipo_mod.get_ipo_date("SPY")
    assert out["list_date"] == "1993-01-22" and out["first_trade_final"] is False
    assert len(ipo_mod._submitted) == 1
