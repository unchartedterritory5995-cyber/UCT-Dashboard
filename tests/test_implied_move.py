import threading
import time
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

def test_compute_expected_move_none_on_non_numeric_inputs():
    weird = _chain()
    weird["spot"] = "n/a"
    with patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": ["2026-08-07"]}), \
         patch.object(im.polygon_options, "get_chain", return_value=weird):
        assert im.compute_expected_move("TST", "2026-08-06") is None

def test_compute_expected_move_none_on_mismatched_atm_strikes():
    ch = _chain()
    ch["puts"][0]["strike"] = 190.0
    with patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": ["2026-08-07"]}), \
         patch.object(im.polygon_options, "get_chain", return_value=ch):
        assert im.compute_expected_move("TST", "2026-08-06") is None

def test_select_report_expiry_malformed_nonempty_date_returns_none():
    assert im.select_report_expiry(["2026-08-07"], "not-a-date") is None

# ── Task 3: TTL cache + serve-stale front for get_expected_move ────────────────
# Every test forgets the ServeStale slot for its key (not just the TTL cache):
# `_MOVE_STALE` is a module-level singleton, so a value another test remembered
# for the same (sym, report_date) key would otherwise leak in as a stale hit.

def test_get_expected_move_caches_success(monkeypatch):
    key = "expmove::TST::2026-08-06"
    im._MOVE_CACHE.clear()
    im._MOVE_STALE.forget(key)
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
    key = "expmove::TST::2026-08-06"
    im._MOVE_CACHE.clear()
    im._MOVE_STALE.forget(key)
    calls = {"n": 0}
    def fake_compute(sym, rd):
        calls["n"] += 1
        return None
    monkeypatch.setattr(im, "compute_expected_move", fake_compute)
    assert im.get_expected_move("TST", "2026-08-06") is None
    assert im.get_expected_move("TST", "2026-08-06") is None
    assert calls["n"] == 2, "a None result must never be remembered"

def test_get_expected_move_single_flight_collapses_concurrent_cold_calls(monkeypatch):
    """ServeStale's per-key build lock: N concurrent cold callers collapse onto
    exactly one `compute_expected_move` call, not N (the single-flight rule)."""
    key = "expmove::TST::2026-08-06"
    im._MOVE_CACHE.clear()
    im._MOVE_STALE.forget(key)
    calls = {"n": 0}
    calls_lock = threading.Lock()

    def fake_compute(sym, rd):
        with calls_lock:
            calls["n"] += 1
        time.sleep(0.1)  # hold the build long enough for the others to queue on the lock
        return {"pct": 5.0, "dollar": 9.2, "expiry": "2026-08-07", "strike": 185.0,
                "spot": 184.0, "call_mid": 4.7, "put_mid": 4.5, "iv_atm": 0.6,
                "horizon": "through 2026-08-07", "asof": "x", "source": "massive-chain"}

    monkeypatch.setattr(im, "compute_expected_move", fake_compute)

    n = 6
    barrier = threading.Barrier(n)
    results = [None] * n

    def worker(i):
        barrier.wait(timeout=2)
        results[i] = im.get_expected_move("TST", "2026-08-06")

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=3)

    assert calls["n"] == 1, "concurrent cold callers must collapse onto one build"
    assert all(r is not None for r in results), "every caller must still get a result"
