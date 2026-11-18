"""The one-click period rankings are instant (owner request 2026-11-17).

Two halves in api/services/scan_period.py:
  * the last good answer for a range is served at once, marked `refreshing`, while ONE
    background build replaces it (a range is never cold twice);
  * the Terminal's seven one-click ranges are kept built by a loop on the web service.

The range dates are ONE fact in two files (preset_ranges here, rangeDates in
periodChangeModel.js). Both are pinned to the table in periodPresets.fixture.json, which
periodChangeModel.test.js reads too.
"""
import json
import threading
import time
from datetime import date
from pathlib import Path

import pytest

from api.services import scan_period as sp
from api.services.cache import cache

FIXTURE = (Path(__file__).resolve().parents[1] / "app" / "src" / "pages" / "terminal" / "panels"
           / "periodPresets.fixture.json")
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))
KEYS = ("mtd", "qtd", "ytd", "m1", "m3", "m6", "y1")


def _reset():
    cache.delete_prefix("scan_period_")
    sp._period_done.clear()
    sp._period_old.clear()
    sp._period_last.clear()
    sp._period_inflight.clear()
    sp._preset_warm_last.clear()
    sp._preset_warm_started.clear()


@pytest.fixture(autouse=True)
def _clean():
    _reset()
    yield
    _reset()


def _until(pred, seconds=5.0):
    end = time.time() + seconds
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.01)
    return False


def _market(monkeypatch, calls, gate=None, closes=None):
    """A provider with two stocks. `calls` records each whole-market read; `gate` holds them."""
    book = closes or {"start": {"AAA": 10.0, "BBB": 20.0}, "end": {"AAA": 20.0, "BBB": 22.0}}

    def grouped(day_iso, adjusted=True):
        calls.append(day_iso)
        if gate is not None:
            gate.wait(10)
        return dict(book["end"] if day_iso == book.get("end_day", max(calls)) else book["start"])

    class _Client:
        def get_full_market_snapshot(self):
            return {"AAA": {"last_price": 20.0, "today_vol": 1}, "BBB": {"last_price": 22.0, "today_vol": 2}}

    monkeypatch.setattr(sp.massive, "get_grouped_daily_closes", grouped)
    monkeypatch.setattr(sp.massive, "_get_client", lambda: _Client())
    monkeypatch.setattr(sp, "_common_stock_symbols", lambda: {"AAA", "BBB"})
    monkeypatch.setattr(sp, "_etf_symbols", lambda: set())
    monkeypatch.setattr(sp, "_kick_period_daily_warm", lambda *a, **k: None)


# ── the dates ────────────────────────────────────────────────────────────────

def test_the_fixture_is_not_empty_and_covers_every_range():
    assert len(CASES) >= 5
    for case in CASES:
        assert set(case) == {"today", *KEYS}


@pytest.mark.parametrize("case", CASES, ids=[c["today"] for c in CASES])
def test_preset_ranges_match_the_table_the_panel_is_pinned_to(case):
    got = sp.preset_ranges(date.fromisoformat(case["today"]))
    assert tuple(got) == KEYS
    assert {k: v.isoformat() for k, v in got.items()} == {k: case[k] for k in KEYS}


def test_every_range_starts_before_today():
    d = date(2024, 1, 1)
    for _ in range(800):                       # two years of days, leap day included
        for key, start in sp.preset_ranges(d).items():
            assert start < d, (key, d, start)
        d = date.fromordinal(d.toordinal() + 1)


# ── the last good answer is served while a new one builds ───────────────────

def test_a_past_answer_is_served_at_once_and_one_build_replaces_it(monkeypatch):
    calls, now = [], [1000.0]
    _market(monkeypatch, calls)
    first = sp.get_period_change(20260401, 20260601)
    assert first["status"] == "ok" and "refreshing" not in first
    built = len(calls)

    # six minutes later the answer is no longer fresh, and the provider is now slow
    gate = threading.Event()
    _market(monkeypatch, calls, gate=gate)
    real = time.time
    monkeypatch.setattr(sp._time, "time", lambda: real() + 360)
    cache.delete_prefix("scan_period_")
    t0 = real()
    old = sp.get_period_change(20260401, 20260601)
    assert real() - t0 < 1.0, "the request waited for the rebuild"
    assert old["status"] == "ok" and old["refreshing"] is True
    assert [r["sym"] for r in old["results"]] == [r["sym"] for r in first["results"]]
    assert old["as_of"] == first["as_of"], "a past answer must keep the time it was built"
    again = sp.get_period_change(20260401, 20260601)
    assert again["refreshing"] is True
    assert _until(lambda: len(calls) == built + 2)
    time.sleep(0.1)
    assert len(calls) == built + 2, "two requests for a stale range started two builds"

    gate.set()
    assert _until(lambda: "scan_period_20260401_20260601" not in sp._period_inflight)
    fresh = sp.get_period_change(20260401, 20260601)
    assert fresh["status"] == "ok" and "refreshing" not in fresh
    assert "refreshing" not in sp._period_old["scan_period_20260401_20260601"][1], "the mark leaked into the held answer"


def test_a_past_answer_is_not_served_for_ever(monkeypatch):
    calls = []
    _market(monkeypatch, calls)
    assert sp.get_period_change(20260401, 20260601)["status"] == "ok"
    gate = threading.Event()                    # the rebuild never finishes in this test
    _market(monkeypatch, calls, gate=gate)
    monkeypatch.setattr(sp, "_PERIOD_WAIT_S", 0.05)
    real = time.time
    monkeypatch.setattr(sp._time, "time", lambda: real() + sp._TTL + sp._PERIOD_STALE_S + 5)
    cache.delete_prefix("scan_period_")
    out = sp.get_period_change(20260401, 20260601)
    assert out == {"status": "computing", "results": [], "count": 0, "as_of": None}
    assert "scan_period_20260401_20260601" not in sp._period_old
    gate.set()


def test_only_a_good_answer_with_rows_is_kept(monkeypatch):
    sp._period_remember("scan_period_1_2", {"status": "error", "results": [], "count": 0}, 15)
    sp._period_remember("scan_period_3_4", {"status": "ok", "results": [], "count": 0}, 15)
    sp._period_remember("scan_period_5_6", {"status": "unavailable", "results": [], "count": 0}, 3600)
    assert sp._period_old == {}
    sp._period_remember("scan_period_7_8", {"status": "ok", "results": [{"sym": "AAA"}], "count": 1}, 300)
    assert list(sp._period_old) == ["scan_period_7_8"]


def test_a_failed_rebuild_does_not_hide_the_last_good_answer(monkeypatch):
    calls = []
    _market(monkeypatch, calls)
    first = sp.get_period_change(20260401, 20260601)
    assert first["status"] == "ok"
    ck = "scan_period_20260401_20260601"
    cache.delete_prefix("scan_period_")
    sp._period_done.pop(ck)
    sp._period_remember(ck, {"status": "error", "results": [], "count": 0, "error": "Couldn't load data for this period.", "as_of": None}, 15)
    out = sp.get_period_change(20260401, 20260601)
    assert out["status"] == "ok" and out["refreshing"] is True


def test_the_holder_of_past_answers_stays_small():
    for i in range(sp._PERIOD_OLD_KEEP + 6):
        sp._period_remember(f"scan_period_k{i}", {"status": "ok", "results": [1], "count": 1}, 300 + i)
    assert len(sp._period_old) == sp._PERIOD_OLD_KEEP
    assert f"scan_period_k{sp._PERIOD_OLD_KEEP + 5}" in sp._period_old
    assert "scan_period_k0" not in sp._period_old


def test_serving_past_answers_can_be_switched_off(monkeypatch):
    monkeypatch.setattr(sp, "_PERIOD_STALE_S", 0.0)
    sp._period_remember("scan_period_7_8", {"status": "ok", "results": [{"sym": "AAA"}], "count": 1}, 300)
    assert sp._period_old == {}


# ── the seven ranges are kept built ─────────────────────────────────────────

def test_warm_presets_builds_each_of_todays_ranges_once(monkeypatch):
    calls = []
    _market(monkeypatch, calls)
    today = date(2026, 11, 17)
    said = sp.warm_presets(today)
    assert tuple(said) == KEYS
    assert set(said.values()) == {"ok"}, said
    for key, start in sp.preset_ranges(today).items():
        ck = f"scan_period_{start.strftime('%Y%m%d')}_20261117"
        held = sp._period_answer(ck)
        assert held and held["status"] == "ok", key
    # a member's request for one of them reads the held answer: no provider read
    n = len(calls)
    out = sp.get_period_change(20251231, 20261117)
    assert out["status"] == "ok" and "refreshing" not in out
    assert len(calls) == n
    assert sp._preset_warm_last["day"] == "2026-11-17"
    assert sp.debug_period(20251231, 20261117)["preset_warm"]["last"]["ranges"]["ytd"] == "ok"


def test_warm_presets_waits_for_a_build_a_member_started_and_never_builds_it_twice(monkeypatch):
    calls, gate = [], threading.Event()
    _market(monkeypatch, calls, gate=gate)
    monkeypatch.setattr(sp, "_PERIOD_WAIT_S", 0.05)
    monkeypatch.setattr(sp, "preset_ranges", lambda today: {"ytd": date(2025, 12, 31)})
    assert sp.get_period_change(20251231, 20261117)["status"] == "computing"   # a member's build is running
    assert _until(lambda: len(calls) == 2)
    done = {}
    t = threading.Thread(target=lambda: done.update(sp.warm_presets(date(2026, 11, 17))))
    t.start()
    time.sleep(0.2)
    assert t.is_alive(), "the warm did not wait for the running build"
    assert len(calls) == 2, "the warm started a second build of a range already building"
    gate.set()
    t.join(5)
    assert done == {"ytd": "ok"}
    assert len(calls) == 2


def test_one_failing_range_does_not_stop_the_others(monkeypatch):
    calls = []
    _market(monkeypatch, calls)
    real = sp._build_period_change

    def flaky(ck, s, e):
        if ck.startswith("scan_period_20251231_"):
            raise RuntimeError("secret detail")
        return real(ck, s, e)

    monkeypatch.setattr(sp, "_build_period_change", flaky)
    said = sp.warm_presets(date(2026, 11, 17))
    assert said["ytd"] == "failed: RuntimeError"
    assert "secret detail" not in str(said)
    assert said["mtd"] == "ok" and said["y1"] == "ok"


def test_the_loop_starts_once_and_only_on_the_web_service(monkeypatch):
    started = []

    class _Thread:
        def __init__(self, target=None, daemon=None, name=None):
            started.append(name)

        def start(self):
            pass

    monkeypatch.setattr(sp.threading, "Thread", _Thread)
    monkeypatch.delenv("RAILWAY_SERVICE_NAME", raising=False)
    assert sp.start_preset_warmer() is False                 # a laptop
    monkeypatch.setenv("RAILWAY_SERVICE_NAME", "flow-worker")
    assert sp.start_preset_warmer() is False
    assert started == []
    monkeypatch.setenv("RAILWAY_SERVICE_NAME", "web")
    assert sp.start_preset_warmer() is True
    assert sp.start_preset_warmer() is False                 # once
    assert started == ["period-presets"]


def test_the_loop_can_be_switched_off(monkeypatch):
    monkeypatch.setattr(sp, "_PRESET_WARM_S", 0.0)
    monkeypatch.setenv("RAILWAY_SERVICE_NAME", "web")
    assert sp.start_preset_warmer() is False
    assert not sp._preset_warm_started.is_set()


def test_main_starts_the_loop_behind_the_light_mode_guard():
    src = (Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    assert 'if not _light_skip("period-preset-warm"):' in src
    assert src.count("_scan_period.start_preset_warmer()") == 1
