"""`fed_watch_held`: the READ ONLY Fed watch answer, its rates read only from the economics store's serving cache.

No network: the Board's and the New York Fed's pages are the invented ones `tests/test_fed_watch.py` stands in for, the
economics store's bucket reader is a counter, and every reader that could start work is replaced by one that fails the
test when reached. Every figure is invented. Pinned: with the economics feature off the answer is the service's own
`held_answer()` block for block; with it on, the rates are what the serving cache holds (put there by
`serving.series` itself), a series not in the cache is `not_held` and the bucket is never read, while the service's
own read-only answer reads the bucket in the same state (so the rail can fail).
"""
from __future__ import annotations

import threading
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import data_sync
from api.services import fed_watch as fw
from api.services import fed_watch_held as held
from api.services.econ import serving
from tests.test_fed_watch import ANSWERS

NY = ZoneInfo("America/New_York")
BODIES = {"USEFFR": {"symbol": "USEFFR", "points": [[1, 9.11, "2031-03-17", "2031-03-17", "U"], [2, 9.12, "2031-03-18", "2031-03-18", "U"]]},
          "USFEDFUNDSU": {"symbol": "USFEDFUNDSU", "points": [[1, 9.25, "2031-03-18", "2031-03-18", "U"]]}}


@pytest.fixture(autouse=True)
def web(tmp_path, monkeypatch):
    fw.reset_for_tests()
    serving.clear_cache()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv("ECON_ENABLED", raising=False)
    monkeypatch.setattr(fw, "now_et", lambda: datetime(2031, 3, 20, 11, 0, tzinfo=NY))
    monkeypatch.setattr(fw, "_pause", lambda s: None)
    monkeypatch.setattr(fw, "headlines_block", lambda: {"state": "off", "items": [], "source": fw.SOURCE_TX})
    monkeypatch.setattr(fw, "_calendar_payloads", lambda today: [])
    asked: list[str] = []

    def fake_get(url, accept, max_bytes):
        asked.append(url)
        hit = ANSWERS.get(url)
        return (404, "text/html", b"not here") if hit is None else (hit[0], "text/xml", hit[1])
    monkeypatch.setattr(fw, "_http_get", fake_get)
    bucket: list[str] = []
    monkeypatch.setattr(serving, "_read_key", lambda key: bucket.append(key))
    yield asked, bucket
    with fw._lock:
        done = fw._state["inflight"]
    if done is not None:
        done.wait(10)
    fw.reset_for_tests()
    serving.clear_cache()


def _hold(monkeypatch, bodies=BODIES):
    """The Board's pages read by the service's own build; the serving cache filled by `serving.series` itself."""
    fw.get_fed_watch(wait_s=10)
    with fw._lock:
        done = fw._state["inflight"]
    if done is not None:
        done.wait(10)
    monkeypatch.setenv("ECON_ENABLED", "1")
    monkeypatch.setattr(serving, "_from_artifacts", lambda sym, asof, start, end: bodies.get(sym))
    for sym in bodies:
        serving.series(sym)


@pytest.fixture
def work(monkeypatch):
    """Counts the work the held reader must never cause: a build, a page read, a series load, a bucket read, a thread."""
    hits = []

    def boom(name):
        def f(*a, **kw):
            hits.append(name)
            raise AssertionError(f"{name} was reached by a held read")
        return f
    for name in ("get_fed_watch", "build", "fetch", "_http_get", "_start_job", "rates_block", "_latest_point"):
        monkeypatch.setattr(fw, name, boom(f"fed_watch.{name}"))
    for name in ("series", "_read_key", "_from_artifacts", "_from_db", "_artifact"):
        monkeypatch.setattr(serving, name, boom(f"serving.{name}"))
    monkeypatch.setattr(data_sync, "get_bytes", boom("data_sync.get_bytes"))
    real_start = threading.Thread.start
    monkeypatch.setattr(threading.Thread, "start", lambda self: hits.append(f"thread {self.name}") or real_start(self))
    return hits


def test_with_the_economics_feature_off_the_answer_is_the_services_own_block_for_block(web):
    fw.get_fed_watch(wait_s=10)
    with fw._lock:
        done = fw._state["inflight"]
    if done is not None:
        done.wait(10)
    mine, how = held.held_answer()
    theirs, how2 = fw.held_answer()
    assert how == how2 == "held" and mine["rates"]["state"] == "off"
    assert {k: v for k, v in mine.items() if k != "built_at"} == {k: v for k, v in theirs.items() if k != "built_at"}


def test_the_rates_are_what_the_serving_cache_holds_and_a_series_not_there_is_not_held(web, monkeypatch):
    _hold(monkeypatch)
    _asked, bucket = web
    rates = held.held_rates()
    assert rates["state"] == "ok" and rates["source"] == fw.SOURCE_NYFED and rates["notice"] == fw.NYFED_RATE_NOTICE
    assert rates["effective"] == {"value": 9.12, "date": "2031-03-18", "reason": None}
    assert rates["upper"] == {"value": 9.25, "date": "2031-03-18", "reason": None}
    assert rates["lower"] == {"value": None, "date": None, "reason": "not_held"}        # never 0
    serving.clear_cache()
    assert held.held_rates()["state"] == "not_held"
    # a series the store answered with nothing is no data, not "not held"
    monkeypatch.setattr(serving, "_from_artifacts", lambda sym, asof, start, end: None)
    for _name, sym in held.RATE_SERIES:
        serving.series(sym)
    assert held.held_rates()["state"] == "no_data"


def test_the_held_reader_never_loads_a_series_reads_the_bucket_or_starts_a_thread(web, monkeypatch, work):
    monkeypatch.setenv("ECON_ENABLED", "1")
    answer, how = held.held_answer()                                   # nothing held anywhere
    assert how == "not_held" and answer["rates"]["state"] == "not_held" and work == []


def test_the_reader_says_read_only_and_the_services_own_answer_reads_the_bucket_in_the_same_state(web, monkeypatch):
    _asked, bucket = web
    monkeypatch.setenv("ECON_ENABLED", "1")
    assert held.held_answer.__doc__.startswith("READ ONLY") and held.held_rates.__doc__.startswith("READ ONLY")
    assert held.held_rates()["state"] == "not_held" and bucket == []   # the held read: no request
    fw.held_answer()                                                   # the service's own read-only answer
    assert bucket                                                      # reached the bucket reader
