"""GET /api/live/massive/cream never computes on the request.

Measured on production 2026-11-17, mid-session: a cold Cream of the Crop build did not answer
within 120 seconds (it is one whole-day tape scan per tier, queued behind the tape's own scans),
so the caller got the edge's 502 and never a list. The route now answers what it holds and lets
ONE background build do the work. These tests hold the three answers and the single build.
"""
import threading
import time

import pytest

from api import live_massive_router as lmr

TODAY = "11/16/2026"
LIST = {"date": TODAY, "bull": [{"sym": "AAA"}], "bear": [], "net": {"bull": 1.0, "bear": 0.0}}


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr(lmr, "_cream_cache", {})
    monkeypatch.setattr(lmr, "_cream_building", set())
    monkeypatch.setattr(lmr, "_resolve_date", lambda d: d or TODAY)
    monkeypatch.setattr(lmr, "_today_mdyyyy", lambda: TODAY)
    yield


def _wait(pred, seconds=5.0):
    end = time.time() + seconds
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.01)
    return False


def test_cold_request_answers_computing_at_once_and_one_build_fills_the_cache(monkeypatch):
    release = threading.Event()
    calls = []

    def slow_build(day):
        calls.append(day)
        release.wait(5)
        return dict(LIST)

    monkeypatch.setattr(lmr, "compute_cream", slow_build)

    started = time.time()
    first = lmr.cream_preview(target_date=None)
    assert time.time() - started < 1.0, "the request waited for the build"
    assert first == {"status": "computing", "date": TODAY}
    assert "bull" not in first and "bear" not in first      # never readable as an empty day

    # more callers while it builds: the same answer, and still one build
    assert lmr.cream_preview(target_date=None) == {"status": "computing", "date": TODAY}
    assert lmr.cream_preview(target_date=None) == {"status": "computing", "date": TODAY}
    assert _wait(lambda: len(calls) == 1)
    time.sleep(0.05)
    assert calls == [TODAY]

    release.set()
    assert _wait(lambda: TODAY in lmr._cream_cache)
    assert _wait(lambda: TODAY not in lmr._cream_building)

    held = lmr.cream_preview(target_date=None)
    assert held["bull"] == [{"sym": "AAA"}]
    assert isinstance(held["built_at"], int) and held["built_at"] > 0
    assert "stale" not in held and "status" not in held
    assert calls == [TODAY]                                  # a fresh list starts no build


def test_a_list_past_its_ttl_is_served_stale_while_one_background_build_refreshes_it(monkeypatch):
    built_at = time.time() - lmr._CREAM_TODAY_TTL - 5
    lmr._cream_cache[TODAY] = (built_at, dict(LIST))
    release = threading.Event()
    calls = []

    def slow_build(day):
        calls.append(day)
        release.wait(5)
        return {**LIST, "bull": [{"sym": "NEW"}]}

    monkeypatch.setattr(lmr, "compute_cream", slow_build)

    started = time.time()
    out = lmr.cream_preview(target_date=None)
    assert time.time() - started < 1.0
    assert out["stale"] is True
    assert out["bull"] == [{"sym": "AAA"}]
    assert out["built_at"] == int(built_at)
    assert lmr._cream_cache[TODAY][1] == LIST                # the held list itself is not marked
    assert lmr.cream_preview(target_date=None)["stale"] is True
    assert _wait(lambda: len(calls) == 1)

    release.set()
    assert _wait(lambda: lmr._cream_cache[TODAY][1]["bull"] == [{"sym": "NEW"}])
    assert _wait(lambda: TODAY not in lmr._cream_building)
    fresh = lmr.cream_preview(target_date=None)
    assert fresh["bull"] == [{"sym": "NEW"}] and "stale" not in fresh
    assert calls == [TODAY]


def test_a_failed_build_fills_nothing_and_the_next_request_starts_another(monkeypatch):
    calls = []

    def broken(day):
        calls.append(day)
        raise RuntimeError("flow.db is busy")

    monkeypatch.setattr(lmr, "compute_cream", broken)
    assert lmr.cream_preview(target_date=None) == {"status": "computing", "date": TODAY}
    assert _wait(lambda: len(calls) == 1 and TODAY not in lmr._cream_building)
    assert TODAY not in lmr._cream_cache
    assert lmr.cream_preview(target_date=None) == {"status": "computing", "date": TODAY}
    assert _wait(lambda: len(calls) == 2)


def test_a_past_date_keeps_the_long_ttl_and_today_keeps_its_own(monkeypatch):
    monkeypatch.setattr(lmr, "compute_cream", lambda day: pytest.fail("a held list inside its TTL must not rebuild"))
    past = "10/09/2026"
    age = lmr._CREAM_TODAY_TTL + 60                          # older than today's TTL, younger than the historical one
    assert age < lmr._HISTORICAL_TTL
    lmr._cream_cache[past] = (time.time() - age, {**LIST, "date": past})
    out = lmr.cream_preview(target_date=past)
    assert out["date"] == past and "stale" not in out
    assert past not in lmr._cream_building
