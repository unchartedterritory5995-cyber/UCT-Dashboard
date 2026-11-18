"""Tests for the Custom-Period Sort scan (api/services/scan_period.py)."""
from datetime import date

from api.services import scan_period as sp
from api.services.cache import cache


def _reset():
    cache.delete_prefix("scan_period_")
    sp._period_done.clear()          # the module's own held answers (see _period_remember)
    sp._period_old.clear()           # and the past answers it may still serve
    sp._period_last.clear()


def test_rejects_inverted_range():
    out = sp.get_period_change(20260601, 20260601)
    assert out["status"] == "error"


def test_ranks_common_stock_by_period_change(monkeypatch):
    _reset()
    # start closes vs end closes → % change per ticker.
    start = {"AAA": 100.0, "BBB": 50.0, "SPXL": 10.0, "GONE": 20.0, "WARR": 5.0}
    end = {"AAA": 150.0, "BBB": 40.0, "SPXL": 30.0, "GONE": 40.0, "WARR": 9.0}

    def _grouped(day_iso, adjusted=True):
        # Every date resolves; start date is earlier, end date later — pick by which is asked.
        return start if day_iso <= "2026-04-01" else end

    monkeypatch.setattr(sp.massive, "get_grouped_daily_closes", _grouped)
    monkeypatch.setattr(sp, "_common_stock_symbols", lambda: {"AAA", "BBB", "GONE"})  # SPXL/WARR not CS
    monkeypatch.setattr(sp, "_etf_symbols", lambda: {"SPXL"})

    snap = {"AAA": {"last_price": 150.0}, "BBB": {"last_price": 40.0}}  # GONE delisted → absent

    class _Client:
        def get_full_market_snapshot(self):
            return snap

    monkeypatch.setattr(sp.massive, "_get_client", lambda: _Client())

    out = sp.get_period_change(20260401, 20260601)
    assert out["status"] == "ok"
    # AAA +50%, BBB -20%. SPXL (ETF) + WARR (not CS) + GONE (delisted) excluded.
    assert [r["sym"] for r in out["results"]] == ["AAA", "BBB"]
    assert out["results"][0]["period_change"] == 50.0
    assert out["results"][1]["period_change"] == -20.0
    assert out["results"][0]["net_change"] == 50.0
    _reset()


def test_snaps_holiday_start_date_back_to_a_trading_day(monkeypatch):
    _reset()
    seen = []

    def _grouped(day_iso, adjusted=True):
        seen.append(day_iso)
        # 2026-04-01 is "closed" (empty); step back to 2026-03-31.
        if day_iso == "2026-04-01":
            return {}
        return {"AAA": 100.0} if day_iso <= "2026-03-31" else {"AAA": 120.0}

    monkeypatch.setattr(sp.massive, "get_grouped_daily_closes", _grouped)
    monkeypatch.setattr(sp, "_common_stock_symbols", lambda: {"AAA"})
    monkeypatch.setattr(sp, "_etf_symbols", lambda: set())

    class _Client:
        def get_full_market_snapshot(self):
            return {"AAA": {"last_price": 120.0}}

    monkeypatch.setattr(sp.massive, "_get_client", lambda: _Client())

    out = sp.get_period_change(20260401, 20260601)
    assert out["status"] == "ok"
    assert out["start"] == 20260331          # snapped back off the "holiday"
    assert "2026-04-01" in seen and "2026-03-31" in seen
    _reset()


_STOCK_CHG = {
    "status": "ok",
    "results": [
        {"sym": "AAA", "period_change": 10.0},
        {"sym": "BBB", "period_change": 20.0},
        {"sym": "CCC", "period_change": -5.0},
    ],
    "start": 20260401, "end": 20260601, "as_of": "x",
}


def test_group_by_theme_ranks_by_owner_mean(monkeypatch):
    monkeypatch.setattr(sp, "get_period_change", lambda a, b: _STOCK_CHG)
    monkeypatch.setattr("api.services.theme_db.get_all_themes", lambda: {"themes": [
        {"name": "Growth", "holdings": [{"sym": "AAA", "source": "owner"}, {"sym": "BBB", "source": "owner"}]},
        {"name": "Value", "holdings": [{"sym": "CCC", "source": "owner"}, {"sym": "ENG", "source": "engine"}]},
    ]})
    out = sp.get_period_change_groups(20260401, 20260601, "theme")
    assert out["status"] == "ok" and out["group"] == "theme"
    # Growth = mean(10,20)=15 leads; Value = -5 (the engine-overlay member is excluded).
    assert [r["name"] for r in out["results"]] == ["Growth", "Value"]
    assert out["results"][0]["period_change"] == 15.0 and out["results"][0]["members"] == ["AAA", "BBB"]
    assert out["results"][1]["period_change"] == -5.0


def test_group_by_sector_ranks_and_carries_members(monkeypatch):
    monkeypatch.setattr(sp, "get_period_change", lambda a, b: _STOCK_CHG)
    monkeypatch.setattr(sp, "_sector_industry_map", lambda: {
        "AAA": {"sector": "Tech", "industry": "Software"},
        "BBB": {"sector": "Tech", "industry": "Semis"},
        "CCC": {"sector": "Energy", "industry": "Oil"},
    })
    out = sp.get_period_change_groups(20260401, 20260601, "sector")
    assert out["status"] == "ok"
    assert [r["name"] for r in out["results"]] == ["Tech", "Energy"]   # Tech mean 15 > Energy -5
    assert out["results"][0]["count"] == 2 and set(out["results"][0]["members"]) == {"AAA", "BBB"}


def test_group_rejects_bad_group():
    out = sp.get_period_change_groups(20260401, 20260601, "bogus")
    assert out["status"] == "error"


def test_assemble_drops_ticker_that_did_not_trade_at_start(monkeypatch):
    # QH-style artifact: bars.db has it near the END but NOT at the start (listed after) →
    # its grouped start close is bogus (+3941%) → dropped. A real moonshot present at BOTH
    # ends (CVNA) is kept.
    from api.services import bars_sqlite as bs
    sc = {"QH": 0.11, "CVNA": 10.0, "AAPL": 100.0}
    ec = {"QH": 4.38, "CVNA": 271.0, "AAPL": 110.0}

    def _cnd(hi, lo):
        return ({"CVNA": 10.0, "AAPL": 100.0} if hi < 20260500      # start window: no QH
                else {"QH": 4.4, "CVNA": 271.0, "AAPL": 110.0})     # end window: QH present
    monkeypatch.setattr(bs, "daily_bydate_index_ready", lambda: True)
    monkeypatch.setattr(bs, "closes_near_date", _cnd)
    monkeypatch.setattr(sp, "_common_stock_symbols", lambda: {"QH", "CVNA", "AAPL"})
    monkeypatch.setattr(sp, "_etf_symbols", lambda: set())
    monkeypatch.setattr(sp.massive, "_get_client",
                        lambda: type("C", (), {"get_full_market_snapshot": staticmethod(lambda: {})})())
    out = sp._assemble(sc, ec, date(2026, 3, 30), date(2026, 6, 3), False, 20260330)
    syms = [r["sym"] for r in out["results"]]
    assert "QH" not in syms and "CVNA" in syms and "AAPL" in syms


def test_robust_group_pct_neutralizes_a_single_moonshot():
    # Auto & Truck Dealerships style: one CVNA-like +2641% outlier must NOT define the group.
    outlier = [8, 12, -3, 2641, 15, 5, -8, 20]
    assert sum(outlier) / len(outlier) > 300          # raw mean is dominated by the outlier
    assert sp._robust_group_pct(outlier) < 15          # winsorized: reflects the real members
    # A genuinely broad-strength group is barely touched (magnitude preserved).
    strong = [50, 45, 40, 35, 60, 55]
    assert abs(sp._robust_group_pct(strong) - sum(strong) / len(strong)) < 2
    # Tiny groups: a 2-name moonshot collapses to the non-moonshot; a normal pair is unchanged.
    assert sp._robust_group_pct([10, 2000]) == 10
    assert sp._robust_group_pct([10, 20]) == 15.0
    assert sp._robust_group_pct([-5]) == -5.0
    assert sp._robust_group_pct([]) == 0.0


def test_group_ranking_uses_robust_not_raw_mean(monkeypatch):
    # A group carried by one outlier must rank BELOW a broadly-strong group.
    chg = {"status": "ok", "results": [
        {"sym": "OUT1", "period_change": 5.0}, {"sym": "OUT2", "period_change": 8.0},
        {"sym": "MOON", "period_change": 3000.0},
        {"sym": "BRD1", "period_change": 60.0}, {"sym": "BRD2", "period_change": 70.0},
        {"sym": "BRD3", "period_change": 55.0},
    ]}
    monkeypatch.setattr(sp, "get_period_change", lambda a, b: chg)
    monkeypatch.setattr(sp, "_sector_industry_map", lambda: {
        "OUT1": {"sector": "Outlierland", "industry": "x"},
        "OUT2": {"sector": "Outlierland", "industry": "x"},
        "MOON": {"sector": "Outlierland", "industry": "x"},
        "BRD1": {"sector": "Broad", "industry": "y"},
        "BRD2": {"sector": "Broad", "industry": "y"},
        "BRD3": {"sector": "Broad", "industry": "y"},
    })
    out = sp.get_period_change_groups(20260401, 20260601, "sector")
    assert [r["name"] for r in out["results"]] == ["Broad", "Outlierland"]  # raw mean would flip this


# ── The build never runs on the request (2026-11-17) ─────────────────────────
# Measured on production, mid-session: a range nobody had asked for yet did not answer
# within 40 seconds, and three concurrent requests for it ran three builds. One background
# build per range, a short wait, then "computing"; both readers already re-ask on that.

def _slow_market(monkeypatch, gate, calls):
    """A provider that blocks on `gate` and counts its whole-market reads."""
    start = {"AAA": 100.0, "BBB": 50.0}
    end = {"AAA": 150.0, "BBB": 40.0}

    def _grouped(day_iso, adjusted=True):
        calls.append(day_iso)
        gate.wait(5)
        return start if day_iso <= "2026-04-01" else end

    class _Client:
        def get_full_market_snapshot(self):
            return {"AAA": {"last_price": 150.0}, "BBB": {"last_price": 40.0}}

    monkeypatch.setattr(sp.massive, "get_grouped_daily_closes", _grouped)
    monkeypatch.setattr(sp.massive, "_get_client", lambda: _Client())
    monkeypatch.setattr(sp, "_common_stock_symbols", lambda: {"AAA", "BBB"})
    monkeypatch.setattr(sp, "_etf_symbols", lambda: set())


def _until(pred, seconds=5.0):
    import time
    end = time.time() + seconds
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.01)
    return False


def test_a_slow_build_answers_computing_quickly_and_runs_once(monkeypatch):
    import threading
    import time
    _reset()
    gate, calls = threading.Event(), []
    _slow_market(monkeypatch, gate, calls)
    monkeypatch.setattr(sp, "_PERIOD_WAIT_S", 0.05)

    t0 = time.time()
    first = sp.get_period_change(20260401, 20260601)
    assert time.time() - t0 < 2.0, "the request waited for the whole build"
    assert first == {"status": "computing", "results": [], "count": 0, "as_of": None}
    # more callers while it builds: still "computing", and still ONE build (two reads: start, end)
    assert sp.get_period_change(20260401, 20260601)["status"] == "computing"
    assert sp.get_period_change(20260401, 20260601)["status"] == "computing"
    assert _until(lambda: len(calls) == 2)
    time.sleep(0.1)
    assert sorted(calls) == ["2026-04-01", "2026-06-01"], calls

    gate.set()
    assert _until(lambda: "scan_period_20260401_20260601" not in sp._period_inflight)
    done = sp.get_period_change(20260401, 20260601)
    assert done["status"] == "ok"
    assert [r["sym"] for r in done["results"]] == ["AAA", "BBB"]
    assert sorted(calls) == ["2026-04-01", "2026-06-01"], "a cached range built again"
    _reset()


def test_a_fast_build_still_answers_on_the_first_request(monkeypatch):
    import threading
    _reset()
    gate, calls = threading.Event(), []
    gate.set()                                   # the provider answers at once
    _slow_market(monkeypatch, gate, calls)
    out = sp.get_period_change(20260401, 20260601)
    assert out["status"] == "ok" and out["count"] == 2
    _reset()


def test_a_failed_build_says_so_instead_of_computing_for_ever(monkeypatch):
    _reset()
    # _grouped_near swallows a provider error into "no data", so break the assembly itself
    monkeypatch.setattr(sp.massive, "get_grouped_daily_closes", lambda day_iso, adjusted=True: {"AAA": 1.0})
    monkeypatch.setattr(sp.massive, "_get_client", lambda: type("C", (), {"get_full_market_snapshot": lambda self: {}})())
    monkeypatch.setattr(sp, "_assemble", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("assembly broke")))
    out = sp.get_period_change(20260401, 20260601)
    assert out["status"] == "error"
    assert "Couldn't load" in out["error"]
    assert "scan_period_20260401_20260601" not in sp._period_inflight
    _reset()


def test_no_second_build_while_the_deep_history_fallback_is_working(monkeypatch):
    _reset()
    calls = []
    monkeypatch.setattr(sp.massive, "get_grouped_daily_closes", lambda day_iso, adjusted=True: calls.append(day_iso) or {})
    ck = "scan_period_19950103_19960102"
    with sp._partial_lock:
        sp._partial_inflight.add(ck)
    try:
        out = sp.get_period_change(19950103, 19960102)
        assert out["status"] == "computing"
        assert calls == [], "the provider was read again while the fallback was already running"
        assert ck not in sp._period_inflight
    finally:
        with sp._partial_lock:
            sp._partial_inflight.discard(ck)
    _reset()


# ── The finished answer does not depend on the shared cache (2026-11-17) ─────
# Measured on production ten minutes after a restart: a fresh range answered "computing" for
# seven minutes and its key was never in the shared cache, a 1,000-entry LRU that bars reads
# write to constantly. The answer is now also held in the module.

def test_the_answer_survives_the_shared_cache_losing_it(monkeypatch):
    import threading
    _reset()
    gate, calls = threading.Event(), []
    gate.set()
    _slow_market(monkeypatch, gate, calls)
    first = sp.get_period_change(20260401, 20260601)
    assert first["status"] == "ok"
    built = len(calls)
    cache.delete_prefix("scan_period_")          # what a busy LRU does to the key
    again = sp.get_period_change(20260401, 20260601)
    assert again["status"] == "ok"
    assert [r["sym"] for r in again["results"]] == ["AAA", "BBB"]
    assert len(calls) == built, "the range was built again although its answer was held"
    _reset()


def test_a_held_answer_expires_and_the_holder_stays_small(monkeypatch):
    _reset()
    now = [1000.0]
    monkeypatch.setattr(sp._time, "time", lambda: now[0])
    sp._period_remember("scan_period_1_2", {"status": "ok", "results": [1], "count": 1}, 300)
    cache.delete_prefix("scan_period_")
    assert sp._period_answer("scan_period_1_2")["status"] == "ok"
    now[0] += 301
    assert sp._period_answer("scan_period_1_2") is None, "an answer was served past its expiry"
    assert "scan_period_1_2" not in sp._period_done
    for i in range(sp._PERIOD_KEEP + 5):
        sp._period_remember(f"scan_period_k{i}", {"status": "ok", "results": [], "count": 0}, 300 + i)
    assert len(sp._period_done) == sp._PERIOD_KEEP
    assert f"scan_period_k{sp._PERIOD_KEEP + 4}" in sp._period_done      # the longest-lived are kept
    assert "scan_period_k0" not in sp._period_done
    _reset()


def test_the_last_build_is_recorded_for_the_diagnostic(monkeypatch):
    import threading
    _reset()
    gate, calls = threading.Event(), []
    gate.set()
    _slow_market(monkeypatch, gate, calls)
    assert sp.get_period_change(20260401, 20260601)["status"] == "ok"
    ck = "scan_period_20260401_20260601"
    assert _until(lambda: (sp._period_last.get(ck) or {}).get("finished") is not None)
    note = sp._period_last[ck]
    assert note["outcome"] == "ok" and note["count"] == 2
    assert isinstance(note["seconds"], float) and note["seconds"] >= 0
    # a failed build names the failure's type, never its text
    monkeypatch.setattr(sp, "_assemble", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("secret detail")))
    assert sp.get_period_change(20260402, 20260601)["status"] == "error"
    bad = sp._period_last["scan_period_20260402_20260601"]
    assert bad["outcome"] == "failed: RuntimeError"
    assert "secret detail" not in str(bad)
    _reset()
