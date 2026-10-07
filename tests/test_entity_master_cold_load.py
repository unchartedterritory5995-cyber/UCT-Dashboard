"""Entity Master's alias cache loads ONCE when many threads ask cold.

`store.open_alias_candidates` lazy-loads the open-alias cache on first use.
Right after a boot several request threads ask at once (research estimates,
financials, ticker search); each used to run its own full scan. The cold load
is now single-flighted: one thread scans, the rest wait for it and read its
answer. A warm cache never takes the load lock at all.
"""
from __future__ import annotations

import threading
import time

import pytest

from api.services.entity_master import store


@pytest.fixture
def cold(monkeypatch):
    monkeypatch.setattr(store, "_CACHE_LOADED", False)
    calls = []

    def fake_rebuild(db_path=None):
        calls.append(threading.get_ident())
        time.sleep(0.15)                     # a slow scan: every waiter arrives meanwhile
        with store._CACHE_LOCK:
            store._ALIAS_CACHE.clear()
            store._ALIAS_CACHE["ZZCOLD"] = ["ent_cold"]
        store._CACHE_LOADED = True
        return 1

    monkeypatch.setattr(store, "rebuild_cache", fake_rebuild)
    yield calls
    with store._CACHE_LOCK:
        store._ALIAS_CACHE.pop("ZZCOLD", None)


def test_concurrent_cold_lookups_scan_once_and_all_get_the_answer(cold):
    n = 12
    start = threading.Barrier(n)
    answers = [None] * n

    def ask(i):
        start.wait()
        answers[i] = store.open_alias_candidates("ZZCOLD")

    threads = [threading.Thread(target=ask, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)
    assert not any(t.is_alive() for t in threads)
    assert len(cold) == 1, f"the cold cache was scanned {len(cold)} times"
    assert answers == [["ent_cold"]] * n


def test_a_warm_cache_never_scans_and_never_takes_the_load_lock(cold, monkeypatch):
    store._ensure_cache_loaded()
    assert len(cold) == 1

    class Exploding:
        def __enter__(self):
            raise AssertionError("a warm lookup took the load lock")

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(store, "_LOAD_LOCK", Exploding())
    assert store.open_alias_candidates("ZZCOLD") == ["ent_cold"]
    assert len(cold) == 1
