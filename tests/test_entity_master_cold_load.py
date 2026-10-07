"""Entity Master: a request NEVER waits on the full alias-cache load.

2026-10-07 boot stall, measured from live logs: research estimates for TSM sat
>30 s in `store.rebuild_cache`'s full open-alias scan (boot warmers held the
/data volume at 10-25 MB/s), and every member request resolving a ticker
queued behind it. Now, while the cache is cold, `open_alias_candidates`
answers from one indexed read and the full load runs once, on a background
thread. These rails use a real tmp store and a scan made slow on purpose.
"""
from __future__ import annotations

import sqlite3
import threading
import time

import pytest

from api.services.entity_master import api as em_api
from api.services.entity_master import schema, store

SLOW_S = 1.5          # how long the simulated full scan takes
BOUND_S = 0.5         # a cold lookup must answer well inside that


def _seed(path):
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode=WAL")
    schema.init_db(conn=conn)
    now = "2026-01-01T00:00:00Z"
    rows = [("ent_tsm", "TSM", "1997-10-09", None),
            ("ent_fb", "FB", "2012-05-18", "2022-06-09"),
            ("ent_fb", "META", "2022-06-09", None),
            ("ent_a", "DUP", "2020-01-01", None),
            ("ent_b", "DUP", "2020-01-01", None)]
    for eid in {r[0] for r in rows}:
        conn.execute("INSERT INTO entities(entity_id, entity_type, created_at, updated_at) "
                     "VALUES (?, 'equity', ?, ?)", (eid, now, now))
    for eid, alias, vf, vt in rows:
        conn.execute("INSERT INTO entity_aliases(entity_id, alias, valid_from, valid_to, source, created_at) "
                     "VALUES (?, ?, ?, ?, 'test', ?)", (eid, alias, vf, vt, now))
    conn.commit()
    conn.close()


@pytest.fixture
def cold_store(tmp_path, monkeypatch):
    path = str(tmp_path / "entity_master.db")
    _seed(path)
    monkeypatch.setattr(schema, "DB_PATH", path)
    monkeypatch.setattr(store, "_local", threading.local())
    monkeypatch.setattr(store, "_ALIAS_CACHE", {})
    monkeypatch.setattr(store, "_CACHE_LOADED", False)
    monkeypatch.setattr(store, "_LOADER", None)

    scans = []
    real_scan = store._scan_open_aliases
    release = threading.Event()

    def slow_scan(db_path=None):
        scans.append(threading.current_thread().name)
        release.wait(SLOW_S)
        return real_scan(db_path)

    monkeypatch.setattr(store, "_scan_open_aliases", slow_scan)
    yield scans
    release.set()
    if store._LOADER is not None:
        store._LOADER.join(timeout=5)


def test_a_cold_lookup_answers_from_the_index_inside_the_bound_with_the_warm_answer(cold_store):
    t0 = time.monotonic()
    got = {a: store.open_alias_candidates(a) for a in ("TSM", "META", "FB", "DUP", "NOPE")}
    elapsed = time.monotonic() - t0
    assert elapsed < BOUND_S, f"a cold lookup waited {elapsed:.2f}s on the full load"
    assert store._CACHE_LOADED is False          # the slow scan is still running
    assert got == {"TSM": ["ent_tsm"], "META": ["ent_fb"], "FB": [], "DUP": ["ent_a", "ent_b"], "NOPE": []}
    # resolve() through the member API is just as fast while cold
    t0 = time.monotonic()
    assert em_api.resolve("TSM").status == "resolved"
    assert em_api.resolve("DUP").status == "ambiguous"
    assert time.monotonic() - t0 < BOUND_S

    # the background load lands, ONCE, and gives the identical answers
    store._LOADER.join(timeout=SLOW_S + 5)
    assert store._CACHE_LOADED is True
    assert cold_store == ["entity-master-cache-load"]
    warm = {a: store.open_alias_candidates(a) for a in got}
    assert warm == got


def test_concurrent_cold_lookups_start_one_background_scan(cold_store):
    n = 12
    start = threading.Barrier(n)
    answers = [None] * n

    def ask(i):
        start.wait()
        answers[i] = store.open_alias_candidates("TSM")

    threads = [threading.Thread(target=ask, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=BOUND_S + 2)
    assert not any(t.is_alive() for t in threads), "a request thread waited on the full load"
    assert answers == [["ent_tsm"]] * n
    store._LOADER.join(timeout=SLOW_S + 5)
    assert len(cold_store) == 1, f"the full scan ran {len(cold_store)} times"


def test_once_warm_the_cache_is_used_and_the_store_is_not_read(cold_store, monkeypatch):
    store.open_alias_candidates("TSM")
    store._LOADER.join(timeout=SLOW_S + 5)
    assert store._CACHE_LOADED is True

    def boom(*a, **k):
        raise AssertionError("a warm lookup read SQLite")

    monkeypatch.setattr(store, "_direct_open_candidates", boom)
    monkeypatch.setattr(store, "start_background_load", boom)
    assert store.open_alias_candidates("META") == ["ent_fb"]


def test_a_slow_load_never_overwrites_a_fresher_rebuild(cold_store):
    store.open_alias_candidates("TSM")             # starts the slow background scan
    with store._CACHE_LOCK:                        # a write path's rebuild lands meanwhile
        store._bump_and_commit({"TSM": ["ent_tsm"], "FRESH": ["ent_x"]})
    store._LOADER.join(timeout=SLOW_S + 5)
    assert store.open_alias_candidates("FRESH") == ["ent_x"], "the stale background scan won"


def test_the_cold_path_query_is_served_by_the_alias_index(cold_store):
    plan = store._conn().execute(
        "EXPLAIN QUERY PLAN SELECT entity_id FROM entity_aliases WHERE alias = ? AND valid_to IS NULL "
        "ORDER BY rowid", ("TSM",)).fetchall()
    text = " ".join(str(r[-1]) for r in plan)
    assert "idx_alias_lookup" in text, text
    assert "SCAN entity_aliases" not in text, text
