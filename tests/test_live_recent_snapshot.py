"""L11 (2026-10-08): Live Flow right after a flow-worker restart.

`/api/live/massive/recent` keeps its snapshots in process memory, so a restart empties them and
every load gets the `warming` stub (`alerts: []`) until the warmer's first curated scan lands.
`api/live_recent_snapshot` saves the canonical keys' last-good tape to disk and seeds it back on
boot; the router's existing cold path then serves it marked `warming`. These tests drive the REAL
route (`recent_massive_alerts`) with only the heavy scan and its side effects stubbed.
"""
from __future__ import annotations

import ast
import gzip
import json
import os
import pathlib
import time

import pytest

from api import live_massive_router as lmr
from api import live_recent_snapshot as snap

TODAY = "10/8/2026"
CANON = (TODAY, 10000, "D", "recent", None, True)       # the curated key LiveFlowMassive loads
ALL_FLOW = (TODAY, 10000, "D", "recent", None, False)
PAYLOAD = {"status": {"connected": True, "returned": 2},
           "alerts": [{"id": 9, "symbol": "NVDA"}, {"id": 8, "symbol": "AMD"}]}


@pytest.fixture
def router(monkeypatch, tmp_path):
    """The router with empty caches, today pinned, and no real fill / worker-status read."""
    monkeypatch.setattr(lmr, "_recent_cache", {})
    monkeypatch.setattr(lmr, "_recent_last_good", {})
    monkeypatch.setattr(lmr, "_recent_cache_locks", {})
    monkeypatch.setattr(lmr, "_recent_fill_started", {})
    monkeypatch.setattr(lmr, "_today_mdyyyy", lambda: TODAY)
    monkeypatch.setattr(lmr, "_log_startup_if_new", lambda: None)
    monkeypatch.setattr(lmr, "_get_worker_status", lambda: {"connected": True})
    spawned = []
    monkeypatch.setattr(lmr, "_spawn_recent_fill",
                        lambda ck, *a, **k: spawned.append(ck) or a[-1].release())
    monkeypatch.setenv("LIVE_RECENT_SNAPSHOT_DIR", str(tmp_path))
    monkeypatch.setattr(snap, "_last_save", 0.0)
    return spawned


def _load(curated=True):
    return lmr.recent_massive_alerts(limit=10000, min_grade="D", target_date=None,
                                     sort_by="recent", tier=None, curated=curated,
                                     symbol=None, lookback_days=1)


def test_control_a_cold_worker_answers_an_empty_warming_stub(router):
    out = _load()
    assert out["warming"] is True and out["alerts"] == []
    assert router == [CANON]                       # a fill was kicked


def test_after_a_restart_the_saved_tape_is_served_labelled(router, tmp_path):
    lmr._recent_last_good[CANON] = PAYLOAD
    assert snap.save([CANON, ALL_FLOW]) == 1        # ALL FLOW has no payload: not written
    lmr._recent_last_good.clear()                   # ── the restart ──
    assert _load()["alerts"] == []                  # cold, nothing seeded yet

    assert snap.seed() == 1
    out = _load()
    assert out["warming"] is True                   # still says it is warming
    assert [a["id"] for a in out["alerts"]] == [9, 8]
    assert out["status"]["restored_from_disk"] is True
    assert out["status"]["snapshot_saved_at"]
    assert router.count(CANON) == 2                 # the fresh fill still runs behind it
    assert _load(curated=False)["alerts"] == []     # a key never saved stays an honest stub


def test_the_first_real_fill_replaces_the_restored_tape(router):
    lmr._recent_last_good[CANON] = PAYLOAD
    snap.save([CANON])
    lmr._recent_last_good.clear()
    snap.seed()
    lmr._recent_cache[CANON] = (time.time(), {"status": {}, "alerts": [{"id": 10}]})
    assert [a["id"] for a in _load()["alerts"]] == [10]


def test_another_sessions_tape_is_never_seeded(router, monkeypatch):
    lmr._recent_last_good[CANON] = PAYLOAD
    snap.save([CANON])
    lmr._recent_last_good.clear()
    monkeypatch.setattr(lmr, "_today_mdyyyy", lambda: "10/9/2026")
    assert snap.seed() == 0
    assert lmr._recent_last_good == {}


def test_an_old_file_is_not_seeded(router, monkeypatch):
    lmr._recent_last_good[CANON] = PAYLOAD
    snap.save([CANON])
    lmr._recent_last_good.clear()
    monkeypatch.setattr(snap, "MAX_AGE_S", -1.0)
    assert snap.seed() == 0


def test_seed_never_overwrites_a_fill_that_landed_first(router):
    lmr._recent_last_good[CANON] = PAYLOAD
    snap.save([CANON])
    fresh = {"status": {}, "alerts": [{"id": 11}]}
    lmr._recent_last_good[CANON] = fresh
    assert snap.seed() == 0
    assert lmr._recent_last_good[CANON] is fresh


def test_an_empty_tape_is_never_written_over_a_real_one(router, tmp_path):
    lmr._recent_last_good[CANON] = PAYLOAD
    snap.save([CANON])
    before = (tmp_path / snap.FILE_NAME).read_bytes()
    lmr._recent_last_good[CANON] = {"status": {}, "alerts": []}
    assert snap.save([CANON]) == 0
    assert (tmp_path / snap.FILE_NAME).read_bytes() == before


def test_a_torn_file_is_skipped_not_fatal(router, tmp_path):
    (tmp_path / snap.FILE_NAME).write_bytes(b"not gzip")
    assert snap.seed() == 0


def test_save_due_is_throttled_and_never_raises(router, monkeypatch):
    lmr._recent_last_good[CANON] = PAYLOAD
    assert snap.save_due([CANON], now=1000.0) == 1
    assert snap.save_due([CANON], now=1000.0 + snap.SAVE_EVERY_S - 1) == 0
    assert snap.save_due([CANON], now=1000.0 + snap.SAVE_EVERY_S + 1) == 1
    monkeypatch.setattr(snap, "save", lambda *a, **k: 1 / 0)
    assert snap.save_due([CANON], now=1e9) == 0


def test_the_kill_switch_stops_both_halves(router, monkeypatch):
    lmr._recent_last_good[CANON] = PAYLOAD
    snap.save([CANON])
    lmr._recent_last_good.clear()
    monkeypatch.setenv(snap.ENABLED_ENV, "0")
    assert snap.save_due([CANON], now=1e9) == 0
    assert snap.seed() == 0


def test_the_file_is_counts_and_alerts_only_gzipped_json(router, tmp_path):
    lmr._recent_last_good[CANON] = PAYLOAD
    snap.save([CANON])
    with gzip.open(tmp_path / snap.FILE_NAME, "rt", encoding="utf-8") as f:
        body = json.load(f)
    assert body["session"] == TODAY and body["entries"][0]["key"] == list(CANON)
    assert not list(tmp_path.glob("*.tmp-*"))       # atomic replace left no temp file


# ── wiring: the flow-worker warmer must actually call both halves ──────────────

def _warmer_calls():
    src = pathlib.Path(__file__).resolve().parents[1] / "api" / "flow_worker_main.py"
    tree = ast.parse(src.read_text(encoding="utf-8"))
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "_start_recent_cache_warmer")
    return {(c.func.value.id, c.func.attr) for c in ast.walk(fn)
            if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute)
            and isinstance(c.func.value, ast.Name)}


def test_the_flow_worker_warmer_seeds_on_boot_and_saves_each_pass():
    calls = _warmer_calls()
    assert ("lmr", "warm_recent") in calls              # control: the probe sees real calls
    assert ("live_recent_snapshot", "seed") in calls
    assert ("live_recent_snapshot", "save_due") in calls
