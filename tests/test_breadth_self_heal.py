"""Self-healing breadth: the degradation detector, and heal-from-bars that fixes a
failed collection while preserving the good index/sentiment fields."""
import json
import sqlite3

import pytest


# ── the detector is a pure function ───────────────────────────────────────────

def test_degradation_detector_flags_a_failed_universe_pull():
    from api.services import breadth_monitor as bm
    # The real 2026-08-31 shape: full universe reported, but the whole-market
    # measurements collapsed (Stage-2=2, no movers, no highs/lows).
    degraded = {"universe_count": 2581, "stage2_count": 2, "up_4pct_today": 0,
                "down_4pct_today": 0, "new_52w_highs": 0, "new_52w_lows": 1,
                "new_20d_highs": 0, "new_20d_lows": 1}
    assert bm.snapshot_looks_degraded(degraded) is True


def test_detector_passes_a_normal_session():
    from api.services import breadth_monitor as bm
    normal = {"universe_count": 2606, "stage2_count": 539, "up_4pct_today": 42,
              "down_4pct_today": 342, "new_52w_highs": 35, "new_52w_lows": 28,
              "new_20d_highs": 144, "new_20d_lows": 420}
    assert bm.snapshot_looks_degraded(normal) is False


def test_detector_does_not_judge_a_small_or_missing_universe():
    from api.services import breadth_monitor as bm
    assert bm.snapshot_looks_degraded({"universe_count": 40, "stage2_count": 0}) is False
    assert bm.snapshot_looks_degraded({}) is False
    assert bm.snapshot_looks_degraded(None) is False


def test_detector_passes_a_genuinely_quiet_but_covered_day():
    from api.services import breadth_monitor as bm
    # Few movers, but Stage-2 shows the universe was actually measured → not degraded.
    quiet = {"universe_count": 2600, "stage2_count": 700, "up_4pct_today": 3,
             "down_4pct_today": 2, "new_52w_highs": 1, "new_52w_lows": 2,
             "new_20d_highs": 1, "new_20d_lows": 1}
    assert bm.snapshot_looks_degraded(quiet) is False


# ── heal flow ─────────────────────────────────────────────────────────────────

@pytest.fixture
def _iso(tmp_path, monkeypatch):
    from api.services import breadth_monitor as bm
    monkeypatch.setattr(bm, "_db_path", lambda: str(tmp_path / "b.db"))

    class _NoCache:
        def get(self, *a, **k): return None
        def set(self, *a, **k): pass
        def delete_prefix(self, *a, **k): pass
    import api.services.cache as cache_mod
    monkeypatch.setattr(cache_mod, "cache", _NoCache())
    bm.init_db()

    # Stub the reconstruction + the SPY-bar timestamp lookup so we exercise the heal
    # WIRING (store, NOT_LIVE preservation, guards) without needing a real bars.db.
    import api.services.breadth_history_recon as recon
    import api.services.breadth_live as bl

    class _FakeCur:
        def fetchall(self): return [(1_700_000_000,)]
    class _FakeConn:
        def execute(self, *a, **k): return _FakeCur()
    monkeypatch.setattr(bl, "_bars_conn", lambda: _FakeConn(), raising=False)
    # every fake SPY ts maps to the one date under test (single-date heals in these tests)
    monkeypatch.setattr(bl, "_iso", lambda ts: "2026-08-31", raising=False)
    # deterministic expected-universe (~2,600) for the coverage floor
    monkeypatch.setattr(bl, "universe", lambda *a, **k: ([f"T{i}" for i in range(2600)], None),
                        raising=False)
    return {"bm": bm, "recon": recon, "monkeypatch": monkeypatch}


def _put(bm, date, m):
    with sqlite3.connect(bm._db_path()) as c:
        c.execute("INSERT OR REPLACE INTO breadth_snapshots(date, metrics) VALUES (?,?)",
                  (date, json.dumps(m)))
        c.commit()


DEGRADED = {"universe_count": 2581, "stage2_count": 2, "up_4pct_today": 0,
            "down_4pct_today": 0, "new_52w_highs": 0, "new_52w_lows": 1,
            "new_20d_highs": 0, "new_20d_lows": 1,
            "sp500_close": 7686.14, "vix": 14.91, "aaii_bulls": 32.9,
            "cnn_fear_greed": 0}
GOOD_RECON = {"universe_count": 2560, "stage2_count": 610, "up_4pct_today": 120,
              "down_4pct_today": 90, "new_52w_highs": 140, "new_52w_lows": 30,
              "new_20d_highs": 200, "new_20d_lows": 40, "pct_above_50sma": 55.2}


def test_heal_replaces_a_degraded_day_and_preserves_index_and_sentiment(_iso):
    bm, recon, mp = _iso["bm"], _iso["recon"], _iso["monkeypatch"]
    # a prior GOOD day to carry sentiment from
    _put(bm, "2026-08-28", {"universe_count": 2606, "stage2_count": 539,
                            "up_4pct_today": 42, "down_4pct_today": 342,
                            "cnn_fear_greed": 54, "naaim": 102.66})
    _put(bm, "2026-08-31", DEGRADED)
    mp.setattr(recon, "recompute_close", lambda ts, tickers=None: dict(GOOD_RECON))

    from api.services import breadth_self_heal as heal
    res = heal.heal_date("2026-08-31")
    assert res["ok"] and res["healed"]

    stored = bm.raw_row("2026-08-31")
    # breadth counts came from the recompute …
    assert stored["stage2_count"] == 610
    assert stored["up_4pct_today"] == 120
    assert not bm.snapshot_looks_degraded(stored)
    # … index close + AAII the collector DID get are preserved …
    assert stored["sp500_close"] == 7686.14
    assert stored["aaii_bulls"] == 32.9
    # … and CNN F&G=0 (the missing sentinel) was carried from the prior good day.
    assert stored["cnn_fear_greed"] == 54
    assert stored["_healed"] is True


def test_heal_skips_a_day_that_is_already_accurate(_iso):
    bm, recon, mp = _iso["bm"], _iso["recon"], _iso["monkeypatch"]
    good = {"universe_count": 2600, "stage2_count": 600, "up_4pct_today": 50,
            "down_4pct_today": 40, "new_52w_highs": 30, "new_52w_lows": 10,
            "new_20d_highs": 80, "new_20d_lows": 20}
    _put(bm, "2026-08-31", good)
    called = {"n": 0}
    def _rc(ts, tickers=None):
        called["n"] += 1
        return dict(GOOD_RECON)
    mp.setattr(recon, "recompute_close", _rc)

    from api.services import breadth_self_heal as heal
    res = heal.heal_date("2026-08-31")
    assert res.get("skipped") == "already accurate"
    assert called["n"] == 0, "a good day must not trigger a recompute"


def test_heal_refuses_to_overwrite_when_the_recompute_is_also_degraded(_iso):
    bm, recon, mp = _iso["bm"], _iso["recon"], _iso["monkeypatch"]
    _put(bm, "2026-08-31", DEGRADED)
    mp.setattr(recon, "recompute_close",
               lambda ts, tickers=None: dict(DEGRADED))   # our bars couldn't price it either
    from api.services import breadth_self_heal as heal
    res = heal.heal_date("2026-08-31")
    assert not res["ok"] and "degraded" in res["reason"]
    # the original row is untouched (no worse), not replaced by a second bad one.
    assert bm.raw_row("2026-08-31")["stage2_count"] == 2


def test_heal_refuses_a_low_coverage_recompute(_iso):
    # Today's daily bars aren't all ingested → recompute prices only 156/2600.
    bm, recon, mp = _iso["bm"], _iso["recon"], _iso["monkeypatch"]
    _put(bm, "2026-08-31", DEGRADED)
    mp.setattr(recon, "recompute_close",
               lambda ts, tickers=None: {"universe_count": 156, "stage2_count": 50,
                                          "up_4pct_today": 8, "down_4pct_today": 11,
                                          "new_52w_highs": 8, "new_52w_lows": 3,
                                          "new_20d_highs": 20, "new_20d_lows": 5})
    from api.services import breadth_self_heal as heal
    res = heal.heal_date("2026-08-31")
    assert not res["ok"] and "coverage too low" in res["reason"]
    assert bm.raw_row("2026-08-31")["stage2_count"] == 2, "the bad-coverage row is NOT stored"


def test_a_stale_low_coverage_heal_is_re_healed_when_bars_arrive(_iso):
    # A row WE healed earlier off few bars must be picked up again by the loop.
    bm, recon, mp = _iso["bm"], _iso["recon"], _iso["monkeypatch"]
    _put(bm, "2026-08-31", {"universe_count": 156, "stage2_count": 50,
                            "up_4pct_today": 8, "_healed": True})
    mp.setattr(recon, "recompute_close", lambda ts, tickers=None: dict(GOOD_RECON))
    from api.services import breadth_self_heal as heal
    res = heal.heal_recent(10)
    assert [h["date"] for h in res["healed"]] == ["2026-08-31"]
    assert bm.raw_row("2026-08-31")["universe_count"] == 2560


def test_universe_falls_back_past_a_row_with_no_list(tmp_path, monkeypatch):
    # 🔴 REGRESSION: the newest snapshot (8/31) had its universe_list stripped, so a
    # hard read of it returned [] → reference_levels empty → all live breadth 503'd.
    # universe() must fall back to the most recent snapshot that has a real list.
    from api.services import breadth_monitor as bm
    from api.services import breadth_live as bl
    monkeypatch.setattr(bm, "_db_path", lambda: str(tmp_path / "b.db"))

    class _NoCache:
        def get(self, *a, **k): return None
        def set(self, *a, **k): pass
        def delete_prefix(self, *a, **k): pass
    import api.services.cache as cache_mod
    monkeypatch.setattr(cache_mod, "cache", _NoCache())
    bm.init_db()

    good = [{"t": f"T{i}"} for i in range(2600)]
    _put(bm, "2026-08-28", {"universe_count": 2606, "universe_list": good})
    _put(bm, "2026-08-31", {"universe_count": 156, "_healed": True})   # NO universe_list

    tickers, d = bl.universe()
    assert len(tickers) == 2600 and d == "2026-08-28", "fell back to the good day's list"


def test_heal_preserves_universe_list_the_live_path_reads(_iso):
    # 🔴 REGRESSION: a heal that stripped universe_list off the newest row collapsed
    # the whole live-breadth path (bl.universe() reads it). A heal must keep it.
    bm, recon, mp = _iso["bm"], _iso["recon"], _iso["monkeypatch"]
    uni = [{"t": f"T{i}"} for i in range(2600)]
    _put(bm, "2026-08-31", {**DEGRADED, "universe_list": uni})
    mp.setattr(recon, "recompute_close", lambda ts, tickers=None: dict(GOOD_RECON))
    from api.services import breadth_self_heal as heal
    assert heal.heal_date("2026-08-31")["healed"]
    kept = bm.raw_row("2026-08-31").get("universe_list")
    assert kept and len(kept) == 2600, "universe_list must survive a heal"


def test_repair_restores_a_stripped_universe_list_even_when_bars_arent_ready(_iso):
    # The exact broken state from prod: an earlier heal left 8/31 with no
    # universe_list AND low coverage, and today's bars aren't in yet. The live path
    # must still be repaired (universe_list carried from a good day) without waiting.
    bm, recon, mp = _iso["bm"], _iso["recon"], _iso["monkeypatch"]
    good_uni = [{"t": f"T{i}"} for i in range(2600)]
    _put(bm, "2026-08-28", {"universe_count": 2606, "stage2_count": 539,
                            "up_4pct_today": 42, "universe_list": good_uni})
    _put(bm, "2026-08-31", {"universe_count": 156, "stage2_count": 50,
                            "up_4pct_today": 8, "_healed": True})   # no universe_list!
    # recompute stays low-coverage (bars not ready) → metric heal is refused …
    mp.setattr(recon, "recompute_close",
               lambda ts, tickers=None: {"universe_count": 156, "stage2_count": 50,
                                          "up_4pct_today": 8, "down_4pct_today": 5,
                                          "new_52w_highs": 4, "new_52w_lows": 2,
                                          "new_20d_highs": 10, "new_20d_lows": 3})
    from api.services import breadth_self_heal as heal
    res = heal.heal_date("2026-08-31")
    assert not res["ok"] and res["ul_repaired"] is True   # metrics not stored, but live path fixed
    restored = bm.raw_row("2026-08-31").get("universe_list")
    assert restored and len(restored) == 2600, "universe_list restored from the good day"


def test_heal_recent_only_touches_degraded_rows(_iso):
    bm, recon, mp = _iso["bm"], _iso["recon"], _iso["monkeypatch"]
    _put(bm, "2026-08-28", {"universe_count": 2606, "stage2_count": 539,
                            "up_4pct_today": 42, "down_4pct_today": 342})
    _put(bm, "2026-08-31", DEGRADED)
    mp.setattr(recon, "recompute_close", lambda ts, tickers=None: dict(GOOD_RECON))
    from api.services import breadth_self_heal as heal
    res = heal.heal_recent(10)
    healed_dates = [h["date"] for h in res["healed"]]
    assert healed_dates == ["2026-08-31"], "only the degraded day is healed"
