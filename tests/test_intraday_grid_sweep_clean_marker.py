"""The off-grid boot sweep is skipped on a store file a full sweep left clean (2026-11-19).

Every bars-api / web / worker boot swept the whole store (bars-api: 20,224 tickers, ~245 s on a
cold 20 GB file) and the last two bars-api boots repaired nothing; members' bar reads ran p90
350-810 ms for the first minutes after each boot. A full sweep that repaired nothing now leaves a
marker naming the store FILE (device + inode); a boot on that same file inside the TTL skips it.
"""
import json
import os

import pytest

from api.services import bars_sqlite, intraday_grid


@pytest.fixture()
def store(tmp_path, monkeypatch):
    db = tmp_path / "bars.db"
    db.write_bytes(b"x")
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(db))
    calls = []
    result = {"tickers": 3, "deleted": 0, "snapped": 0}

    def fake_sweep(tickers=None, days=None):
        calls.append(1)
        return dict(result)

    monkeypatch.setattr(intraday_grid, "sweep", fake_sweep)
    return {"db": db, "calls": calls, "result": result, "marker": tmp_path / intraday_grid._MARKER_NAME}


def test_a_clean_sweep_is_not_repeated_on_the_same_store_file(store):
    assert intraday_grid.sweep_once_unless_clean() == {"tickers": 3, "deleted": 0, "snapped": 0}
    assert store["marker"].exists()
    assert intraday_grid.sweep_once_unless_clean() is None          # the next boot: skipped
    assert len(store["calls"]) == 1


def test_a_sweep_that_repaired_anything_leaves_no_marker(store):
    store["result"]["deleted"] = 2
    intraday_grid.sweep_once_unless_clean()
    assert not store["marker"].exists()
    intraday_grid.sweep_once_unless_clean()                           # swept again next boot
    assert len(store["calls"]) == 2


def test_a_snapped_bucket_counts_as_a_repair(store):
    store["result"]["snapped"] = 1
    intraday_grid.sweep_once_unless_clean()
    assert not store["marker"].exists()


def test_a_replaced_store_file_is_swept_again(store):
    intraday_grid.sweep_once_unless_clean()
    # a snapshot install writes a new file and renames it over the old one: a new inode
    new = store["db"].with_name("bars.db.new")
    new.write_bytes(b"y")
    os.replace(new, store["db"])
    assert not intraday_grid.clean_marker_current()
    intraday_grid.sweep_once_unless_clean()
    assert len(store["calls"]) == 2


def test_the_marker_expires(store):
    intraday_grid.sweep_once_unless_clean()
    m = json.loads(store["marker"].read_text())
    assert intraday_grid.clean_marker_current(now=m["at"] + intraday_grid.SWEEP_CLEAN_TTL_S - 1)
    assert not intraday_grid.clean_marker_current(now=m["at"] + intraday_grid.SWEEP_CLEAN_TTL_S + 1)


def test_another_marker_version_or_a_broken_marker_sweeps(store):
    intraday_grid.sweep_once_unless_clean()
    m = json.loads(store["marker"].read_text())
    store["marker"].write_text(json.dumps({**m, "version": intraday_grid.SWEEP_MARKER_VERSION + 1}))
    assert not intraday_grid.clean_marker_current()
    store["marker"].write_text("{not json")
    assert not intraday_grid.clean_marker_current()


def test_a_later_repair_removes_an_earlier_marker(store):
    intraday_grid.sweep_once_unless_clean()
    assert store["marker"].exists()
    store["marker"].write_text(json.dumps({**json.loads(store["marker"].read_text()), "at": 0}))   # expired
    store["result"]["deleted"] = 5
    intraday_grid.sweep_once_unless_clean()
    assert not store["marker"].exists()


def test_no_store_file_never_skips(store):
    os.remove(store["db"])
    assert not intraday_grid.clean_marker_current()
