"""Setup tags served from the scan's store (api/services/setup_tags.py, speed pass 2026-10-23).

What is proved here:

1. PARITY. For every fixture, the tags a request serves from the store are IDENTICAL to the tags
   the live computation returns for the same completed bars. While the store is being read the
   live computation is replaced by one that raises, so a pass cannot come from quietly computing.
2. A STORED ROW IS SERVED ONLY FOR ITS OWN INPUT AND CODE. A revised bar, a newly completed
   session or a different code fingerprint falls back to the live computation.
3. THE STORE PASS: off with the flag, records every symbol once, then skips unchanged ones.
4. LATENCY. A store hit never waits on the detectors; a live run that overruns its budget serves
   no tags at once and fills the cache when it finishes.
5. WIRING. The universe scan and the hourly leaders scan both call the store pass.
"""
import ast
import pathlib
import random
import threading
import time

import pytest

from api.services import setup_tags as st
from tests.test_setup_tags import _days, _ep, _flat, _hve, _kicker, _oops, _outside, _pad_after, \
    _slingshot


def _walk(n, seed):
    """n bars of a seeded random walk with volume spikes: varied enough that the trendline,
    gap, reclaim and range detectors all get something to say."""
    rnd = random.Random(seed)
    ts = _days(n)
    out, c = [], 40.0 + seed
    for i in range(n):
        o = c * (1 + rnd.gauss(0, 0.004))
        c = max(1.0, o * (1 + rnd.gauss(0.0006, 0.022)))
        hi = max(o, c) * (1 + abs(rnd.gauss(0, 0.009)))
        lo = min(o, c) * (1 - abs(rnd.gauss(0, 0.009)))
        v = 1_000_000.0 * (1 + abs(rnd.gauss(0, 0.4))) * (4.0 if rnd.random() < 0.03 else 1.0)
        out.append({"t": ts[i], "o": round(o, 4), "h": round(hi, 4), "l": round(lo, 4),
                    "c": round(c, 4), "v": round(v)})
    return out


def _fixtures() -> dict:
    fx = {
        "KICK": _pad_after(_kicker(), 1),
        "OOPS": _oops(),
        "HVE": _hve(320),
        "OUTB": _pad_after(_outside(), 2),
        "OUTS": _outside(up=False),
        "EPIV": _ep(),
        "SLNG": _slingshot(),
        "FLAT": _flat(320),
    }
    for k in range(16):
        fx[f"RW{k:02d}"] = _walk(320, seed=k)
    return fx


@pytest.fixture
def store(monkeypatch, tmp_path):
    """Flags on, an isolated patterns.db, bars served from the fixtures, caches empty."""
    monkeypatch.setenv("AUTO_STRUCTURES_ENABLED", "1")
    monkeypatch.setenv("AUTO_STRUCTURES_SETUP_TAGS_ENABLED", "1")
    monkeypatch.setenv("PATTERN_DB_PATH", str(tmp_path / "patterns.db"))
    bars = _fixtures()
    monkeypatch.setattr(st, "_completed_daily_bars", lambda sym: [dict(b) for b in bars.get(sym, [])])
    st._CACHE.clear()
    st._INFLIGHT.clear()
    yield bars
    st._CACHE.clear()


def _forbid_live(monkeypatch):
    def _boom(*a, **k):
        raise AssertionError("served by the live computation, not the store")
    monkeypatch.setattr(st, "compute_tags", _boom)


# -- 1. parity ---------------------------------------------------------------------------------

def test_stored_tags_are_IDENTICAL_to_the_live_tags_for_every_fixture(store, monkeypatch):
    live = {sym: st.compute_tags(sym, bars) for sym, bars in store.items()}
    # non-vacuity: the fixtures must produce real, varied tags or equality proves nothing
    assert sum(len(v) for v in live.values()) >= 12
    assert len({t["setup"] for v in live.values() for t in v}) >= 5
    res = st.record_store(list(store))
    assert res["recorded"] == len(store) and res["failed"] == 0
    _forbid_live(monkeypatch)
    for sym in store:
        assert st._team_tags_cached(sym) == live[sym], sym


def test_the_route_answer_is_identical_for_admin_and_member(store, monkeypatch):
    live_team = {sym: st.compute_tags(sym, bars) for sym, bars in store.items()}
    st.record_store(list(store))
    _forbid_live(monkeypatch)
    for sym in store:
        assert st.tags_for(sym, member=False) == live_team[sym]
        assert st.tags_for(sym, member=True) == st.member_tags(live_team[sym])


# -- 2. a stored row is served only for its own input and code ----------------------------------

def _live_calls(monkeypatch):
    calls = []
    real = st.compute_tags

    def _spy(sym, bars):
        calls.append(sym)
        return real(sym, bars)
    monkeypatch.setattr(st, "compute_tags", _spy)
    return calls


def test_a_revised_bar_is_not_served_from_the_store(store, monkeypatch):
    st.record_store(["KICK"])
    bars = store["KICK"]
    bars[-30] = {**bars[-30], "c": bars[-30]["c"] + 0.01}       # same newest session, revised history
    assert st.stored_tags("KICK", bars) is None
    calls = _live_calls(monkeypatch)
    assert st._team_tags_cached("KICK") == st.compute_tags("KICK", bars)
    assert "KICK" in calls


def test_a_newly_completed_session_is_not_served_from_the_store(store):
    st.record_store(["KICK"])
    store["KICK"] = _pad_after(store["KICK"], 1)
    assert st.stored_tags("KICK", store["KICK"]) is None


def test_a_row_from_different_code_is_not_served(store, monkeypatch):
    st.record_store(["KICK"])
    assert st.stored_tags("KICK", store["KICK"]) is not None, "control: the row matches as stored"
    monkeypatch.setattr(st, "_CODE_FP", ["another-build"])
    assert st.stored_tags("KICK", store["KICK"]) is None


def test_the_code_fingerprint_covers_the_detectors_and_this_module():
    st._CODE_FP.clear()
    fp = st.code_fingerprint()
    assert len(fp) == 64 and st.code_fingerprint() == fp


# -- 3. the store pass ---------------------------------------------------------------------------

def test_the_store_pass_is_a_no_op_with_the_flag_off(store, monkeypatch):
    monkeypatch.delenv("AUTO_STRUCTURES_SETUP_TAGS_ENABLED", raising=False)
    calls = _live_calls(monkeypatch)
    res = st.record_store(list(store))
    assert res.get("skipped") == "flag off" and calls == []


def test_the_store_pass_skips_symbols_whose_row_already_matches(store, monkeypatch):
    first = st.record_store(list(store) + ["NOBARS"])
    assert first["recorded"] == len(store) and first["no_bars"] == 1
    calls = _live_calls(monkeypatch)
    second = st.record_store(list(store))
    assert second["recorded"] == 0 and second["unchanged"] == len(store) and calls == []


def test_one_failing_symbol_never_stops_the_pass(store, monkeypatch):
    real = st.compute_tags

    def _flaky(sym, bars):
        if sym == "OOPS":
            raise RuntimeError("detector missing")
        return real(sym, bars)
    monkeypatch.setattr(st, "compute_tags", _flaky)
    res = st.record_store(list(store))
    assert res["failed"] == 1 and res["recorded"] == len(store) - 1


# -- 4. latency -----------------------------------------------------------------------------------

def _slow(monkeypatch, seconds):
    real = st.compute_tags
    calls = []

    def _sleepy(sym, bars):
        calls.append(sym)
        time.sleep(seconds)
        return real(sym, bars)
    monkeypatch.setattr(st, "compute_tags", _sleepy)
    return calls


def test_a_store_hit_never_waits_on_the_detectors(store, monkeypatch):
    st.record_store(["KICK"])
    calls = _slow(monkeypatch, 3.0)
    t0 = time.perf_counter()
    tags = st.tags_for("KICK", member=False)
    elapsed = time.perf_counter() - t0
    assert tags and calls == []
    assert elapsed < 0.5, f"store hit took {elapsed:.3f}s"


def test_a_live_run_over_budget_serves_no_tags_now_and_fills_the_cache(store, monkeypatch):
    monkeypatch.setenv("SETUP_TAGS_LIVE_TIMEOUT_S", "0.2")
    expected = st.compute_tags("KICK", store["KICK"])
    assert expected, "control: the fixture has tags"
    calls = _slow(monkeypatch, 1.0)
    t0 = time.perf_counter()
    assert st.tags_for("KICK", member=False) == []
    assert time.perf_counter() - t0 < 0.8
    deadline = time.time() + 5
    while st._INFLIGHT and time.time() < deadline:
        time.sleep(0.05)
    assert st.tags_for("KICK", member=False) == expected
    assert calls == ["KICK"], "the cached answer is served; the detectors ran once"


def test_concurrent_misses_share_one_live_run(store, monkeypatch):
    calls = _slow(monkeypatch, 0.3)
    out = []
    threads = [threading.Thread(target=lambda: out.append(st.tags_for("KICK", member=False)))
               for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(out) == 4 and all(o == out[0] for o in out) and out[0]
    assert calls == ["KICK"]


# -- 5. wiring ------------------------------------------------------------------------------------

def _calls_in(fn_name):
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("api", "main.py").read_text(
        encoding="utf-8")
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == fn_name:
            return {c.func.id for c in ast.walk(node)
                    if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)}
    raise AssertionError(f"{fn_name} not found in api/main.py")


def test_the_universe_store_pass_runs_after_the_run_lease_is_released():
    """Inside the lease the minutes-long pass beats no heartbeat, so a catch-up could read the live
    run as stale and start a second one. The call must sit outside every try (after end_run)."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("api", "main.py").read_text(
        encoding="utf-8")
    fn = next(n for n in ast.walk(ast.parse(src))
              if isinstance(n, ast.FunctionDef) and n.name == "_execute_patterns_universe_run")
    in_try = {c.func.id for t in ast.walk(fn) if isinstance(t, ast.Try) for c in ast.walk(t)
              if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)}
    assert "end_run" in {c.func.attr for c in ast.walk(fn)
                         if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute)}
    assert "_record_rare_preview" in in_try, "control: the probe sees calls inside the try"
    assert "_record_setup_tags" not in in_try


def test_a_second_concurrent_store_pass_is_skipped(store):
    assert st._STORE_PASS_LOCK.acquire(blocking=False)
    try:
        res = st.record_store(list(store))
        assert res.get("skipped") == "a pass is already running" and res["recorded"] == 0
    finally:
        st._STORE_PASS_LOCK.release()
    assert st.record_store(["KICK"])["recorded"] == 1, "control: free again, it records"


def test_both_scan_passes_record_the_store():
    universe = _calls_in("_execute_patterns_universe_run")
    leaders = _calls_in("_run_patterns_leaders_scan")
    assert "_record_rare_preview" in universe, "control: the probe sees a sibling call"
    assert "_scan_patterns_daily" in leaders, "control: the probe sees a sibling call"
    assert "_record_setup_tags" in universe
    assert "_record_setup_tags" in leaders
