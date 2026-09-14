"""Rails for the breadth numeric projection (§3).

The projection exists because the stored blob averages 636,834 bytes on production
of which 99.7 % is `*_list` ticker arrays that every history read parses and
immediately deletes. These tests are about the three ways a projection goes wrong:
it drifts from the source, it quietly stops being written, or it changes what a
member sees.
"""
from __future__ import annotations

import json

import pytest

from api.services import breadth_monitor as bm
from api.services import breadth_numeric_migration as mig


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    db = tmp_path / "breadth.db"
    monkeypatch.setattr(bm, "_db_path", lambda: str(db))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    class _NoCache:
        def get(self, *_a, **_k):
            return None

        def set(self, *_a, **_k):
            pass

        def delete_prefix(self, *_a, **_k):
            pass

    import api.services.cache as cache_mod
    monkeypatch.setattr(cache_mod, "cache", _NoCache())
    bm.init_db()
    yield db


def _metrics(score=50.0, tickers=3):
    """A snapshot shaped like production's: scalars, a string, a null, and lists."""
    return {
        "breadth_score": score,
        "pct_above_50sma": 41.2,
        "market_phase": "Distribution",      # a STRING the reader keeps
        "aaii_bulls": None,                  # a NULL the reader keeps
        "advancing": 1200,
        "declining": 800,
        "adv_decline": 400,
        "up_4pct_today_list": [{"t": f"TK{i}", "v": 1.0} for i in range(tickers)],
        "stage2_list": [f"S{i}" for i in range(tickers)],
    }


# ── the projection's definition ───────────────────────────────────────────────

def test_the_projection_keeps_every_non_list_key_including_strings_and_nulls():
    """⛔ THE TYPE-FILTER TRAP. "Numeric store" names the purpose, not a filter.
    The readers drop `*_list` and keep everything else; a projection that kept only
    int/float would be more numeric and less correct, and `market_phase` would go
    missing from the Monitor with nothing raising."""
    out = bm.numeric_of(_metrics())
    assert out["market_phase"] == "Distribution"
    assert "aaii_bulls" in out and out["aaii_bulls"] is None
    assert out["breadth_score"] == 50.0


def test_no_list_key_can_reach_the_projection():
    """The rail the ruling asks for by name."""
    out = bm.numeric_of(_metrics())
    assert not [k for k in out if k.endswith("_list")], out.keys()
    bm.store_snapshot("2026-01-05", _metrics())
    with bm._conn() as c:
        stored = json.loads(c.execute(
            "SELECT metrics FROM breadth_snapshot_numeric WHERE date='2026-01-05'").fetchone()[0])
    assert not [k for k in stored if k.endswith("_list")], stored.keys()
    # non-vacuity: the source row really did carry list keys to be dropped
    assert [k for k in bm.raw_row("2026-01-05") if k.endswith("_list")]


# ── the write paths, which are what keep it from drifting ─────────────────────

def test_a_snapshot_written_through_the_real_write_path_lands_in_both_tables():
    m = _metrics(score=77.0)
    assert bm.store_snapshot("2026-01-06", m)
    with bm._conn() as c:
        num = json.loads(c.execute(
            "SELECT metrics FROM breadth_snapshot_numeric WHERE date='2026-01-06'").fetchone()[0])
    assert num == bm.numeric_of(m), "key-for-key"


def test_patch_fields_updates_the_projection_in_the_same_transaction():
    bm.store_snapshot("2026-01-07", _metrics(score=10.0))
    assert bm.patch_fields("2026-01-07", {"breadth_score": 99.0, "advancing": 1})
    with bm._conn() as c:
        num = json.loads(c.execute(
            "SELECT metrics FROM breadth_snapshot_numeric WHERE date='2026-01-07'").fetchone()[0])
    assert num["breadth_score"] == 99.0 and num["advancing"] == 1, num
    assert mig.audit()["clean"], mig.audit()


def test_deleting_a_snapshot_removes_its_projection_too():
    bm.store_snapshot("2026-01-08", _metrics())
    assert bm.delete_snapshot("2026-01-08")
    with bm._conn() as c:
        assert c.execute(
            "SELECT COUNT(*) FROM breadth_snapshot_numeric WHERE date='2026-01-08'"
        ).fetchone()[0] == 0
    assert mig.audit()["extra_in_numeric"] == []


# ── the audit must be able to SEE drift, or it is decoration ──────────────────

def test_the_audit_names_a_drifted_row_rather_than_counting_it():
    bm.store_snapshot("2026-01-09", _metrics(score=5.0))
    assert mig.audit()["clean"]
    with bm._conn() as c:                       # plant drift behind the write path
        c.execute("UPDATE breadth_snapshot_numeric SET metrics=? WHERE date=?",
                  (json.dumps({"breadth_score": -1}), "2026-01-09"))
        c.commit()
    a = mig.audit()
    assert not a["clean"]
    assert a["mismatched"] and a["mismatched"][0]["date"] == "2026-01-09"
    assert a["mismatched"][0]["keys"], "a drift report with no key names is a count"


def test_the_audit_catches_a_list_key_that_leaked_in():
    bm.store_snapshot("2026-01-12", _metrics())
    with bm._conn() as c:
        m = bm.numeric_of(_metrics())
        m["stage2_list"] = ["X"]
        c.execute("UPDATE breadth_snapshot_numeric SET metrics=? WHERE date=?",
                  (json.dumps(m), "2026-01-12"))
        c.commit()
    a = mig.audit()
    assert a["list_keys_leaked"] and a["list_keys_leaked"][0]["keys"] == ["stage2_list"]


# ── the migration ─────────────────────────────────────────────────────────────

def _plant_blob_only(date_str, m):
    """A row as it exists before the backfill: blob written, no projection."""
    with bm._conn() as c:
        c.execute("INSERT OR REPLACE INTO breadth_snapshots (date, metrics) VALUES (?, ?)",
                  (date_str, json.dumps(m)))
        c.commit()


def test_backfill_populates_missing_rows_and_leaves_the_source_untouched():
    for i in range(3):
        _plant_blob_only(f"2026-02-0{i + 1}", _metrics(score=float(i)))
    out = mig.backfill(backup=False)
    assert out["ran"] and out["written"] == 3, out
    assert out["source_table_unchanged"] is True
    assert out["before"]["sha256"] == out["after"]["sha256"]
    assert mig.audit()["clean"]


def test_backfill_is_idempotent():
    _plant_blob_only("2026-02-10", _metrics())
    first = mig.backfill(backup=False)
    assert first["written"] == 1
    second = mig.backfill(backup=False)
    assert second["ran"] is False and second["skipped"] == "marker present"
    forced = mig.backfill(force=True, backup=False)
    assert forced["written"] == 0, "a forced re-run must find nothing left to do"
    assert mig.audit()["clean"]


def test_backfill_aborts_rather_than_running_without_a_backup(monkeypatch):
    """⛔ Uninsured is not an acceptable state for a migration that can be retried
    later. The reader still serves off the blobs until this runs."""
    _plant_blob_only("2026-02-11", _metrics())
    import shutil as _sh
    monkeypatch.setattr(mig.shutil, "disk_usage",
                        lambda _p: _sh._ntuple_diskusage(1, 1, 0))
    out = mig.backfill(backup=True)
    assert out["ran"] is False and "not enough room" in out["aborted"]
    with bm._conn() as c:
        assert c.execute("SELECT COUNT(*) FROM breadth_snapshot_numeric").fetchone()[0] == 0


# ── what a member gets must not change ────────────────────────────────────────

def test_the_reader_returns_the_same_row_with_and_without_a_projection():
    for i in range(1, 6):
        bm.store_snapshot(f"2026-03-0{i}", _metrics(score=float(i * 10)))
    with_proj = bm.get_history(5)
    with bm._conn() as c:                       # simulate a not-yet-backfilled store
        c.execute("DELETE FROM breadth_snapshot_numeric")
        c.commit()
    without = bm.get_history(5)
    assert with_proj == without, "the blob fallback must be indistinguishable"
    assert with_proj and len(with_proj[0]) > 5


def test_the_blob_fallback_is_counted_so_a_half_filled_store_is_visible(monkeypatch):
    """⚠️ An absence that costs 100x must never be silent."""
    for i in range(1, 4):
        bm.store_snapshot(f"2026-03-1{i}", _metrics())
    with bm._conn() as c:
        c.execute("DELETE FROM breadth_snapshot_numeric WHERE date='2026-03-11'")
        c.commit()
        got, fallbacks = bm._metrics_for_dates(c, ["2026-03-11", "2026-03-12", "2026-03-13"])
    assert fallbacks == 1, "one row lacked a projection and it must be reported"
    assert len(got) == 3, "all three dates still resolve"


def test_a_reconstructed_date_is_not_scored_as_a_missing_projection():
    """⛔ A deep window asks about thousands of dates that have no snapshot at all.
    Counting those as gaps would report ~4,529 phantom misses on a healthy store."""
    bm.store_snapshot("2026-03-20", _metrics())
    with bm._conn() as c:
        got, fallbacks = bm._metrics_for_dates(c, ["2026-03-20", "1994-01-03", "1994-01-04"])
    assert fallbacks == 0, "dates with no snapshot are not missing projections"
    assert set(got) == {"2026-03-20"}


def test_the_drill_path_still_reads_the_lists():
    """The projection must not reach the one consumer that WANTS the arrays."""
    bm.store_snapshot("2026-03-25", _metrics(tickers=4))
    lists = bm.get_snapshot_lists("2026-03-25")
    assert lists and "stage2_list" in lists
    assert len(lists["stage2_list"]) == 4
    assert bm.raw_row("2026-03-25")["up_4pct_today_list"], "raw_row keeps the blob intact"
