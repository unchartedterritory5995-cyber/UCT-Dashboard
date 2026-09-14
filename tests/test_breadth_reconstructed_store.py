"""Rails for the materialised reconstructed side (Session 3).

A deep window used to assemble 174,187 OHLC rows into 4,529 rows on every cold
request. Those rows are now built once and read. These tests cover the four ways
a derived table goes wrong: it drifts from its inputs, it is quietly rebuilt at
member expense, it loses to the wrong source on a contested date, or it changes
what a member sees.
"""
from __future__ import annotations

import json

import pytest

from api.services import breadth_daily_ohlc as ohlc
from api.services import breadth_monitor as bm
from api.services import breadth_numeric_migration as mig
from api.services import breadth_sentiment_history as sent


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(bm, "_db_path", lambda: str(tmp_path / "monitor.db"))
    monkeypatch.setattr(ohlc, "_db_path", lambda: str(tmp_path / "ohlc.db"))
    monkeypatch.setattr(sent, "_db_path", lambda: str(tmp_path / "sent.db"))
    monkeypatch.setattr(ohlc, "_INIT_DONE", False)
    monkeypatch.setattr(sent, "_INIT_DONE", False)
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
    ohlc._ensure_init()
    yield tmp_path


def _seed_ohlc(dates, metrics=("pct_above_50sma", "pct_above_200sma", "adv_decline")):
    rows = []
    for i, d in enumerate(dates):
        for j, m in enumerate(metrics):
            v = float(10 + i + j)
            rows.append((d, m, v, v, v, v))
    return ohlc.write_bulk(rows, source="close_recon")


DATES = ["2015-06-15", "2015-06-16", "2015-06-17", "2015-06-18"]


# ── it is built by the writers, not by the readers ────────────────────────────

def test_write_bulk_materialises_the_dates_it_touched_in_the_same_transaction():
    assert _seed_ohlc(DATES) > 0
    rows, misses = ohlc.reconstructed_for_dates(DATES)
    assert misses == 0
    assert set(rows) == set(DATES), rows.keys()
    assert rows["2015-06-15"]["_reconstructed"] is True
    assert rows["2015-06-15"]["pct_above_50sma"] == 10.0


def test_set_ohlc_rebuilds_only_for_a_TRUSTED_source():
    """⚠️ `set_ohlc` defaults to source='reconstruct', which `_TRUSTED_SOURCES`
    excludes — the reader cannot see it, so rebuilding on it would be work for a
    write that changes nothing."""
    ohlc.set_ohlc("2015-07-01", "pct_above_50sma", 1, 1, 1, 1)          # untrusted default
    rows, _ = ohlc.reconstructed_for_dates(["2015-07-01"])
    assert rows == {}, "an untrusted write must not materialise a row"
    ohlc.set_ohlc("2015-07-02", "pct_above_50sma", 2, 2, 2, 2, source="close_recon")
    rows, _ = ohlc.reconstructed_for_dates(["2015-07-02"])
    assert "2015-07-02" in rows, "a trusted write must materialise one"


def test_update_intraday_materialises_the_session_it_wrote():
    ohlc.update_intraday("2015-08-03", {"pct_above_50sma": 55.0})
    rows, _ = ohlc.reconstructed_for_dates(["2015-08-03"])
    assert "2015-08-03" in rows and rows["2015-08-03"]["pct_above_50sma"] == 55.0


# ── the watermark, which is what makes drift DETECTABLE ───────────────────────

def test_a_later_ohlc_write_marks_the_row_stale_and_rebuild_repairs_it():
    _seed_ohlc(DATES)
    assert ohlc.stale_reconstructed_dates() == []
    # write behind the hooks, exactly as an out-of-process writer would
    with ohlc._conn() as c:
        c.execute("UPDATE breadth_daily_ohlc SET c = 999, updated_at = '2099-01-01 00:00:00' "
                  "WHERE date = ? AND metric = 'pct_above_50sma'", ("2015-06-16",))
        c.commit()
    assert ohlc.stale_reconstructed_dates() == ["2015-06-16"]
    assert ohlc.rebuild_stale()["built"] == 1
    assert ohlc.stale_reconstructed_dates() == []
    rows, _ = ohlc.reconstructed_for_dates(["2015-06-16"])
    assert rows["2015-06-16"]["pct_above_50sma"] == 999


def test_a_sentiment_write_marks_every_row_stale_because_values_asof_forward_fills():
    """⛔ THE HOLE AN EXISTING RAIL FOUND. The first version watermarked only the
    OHLC side; sentiment is the SECOND input, and one reading is carried forward by
    every later session, so a per-date watermark would have marked one row stale and
    left the rest silently wrong."""
    _seed_ohlc(DATES)
    assert ohlc.stale_reconstructed_dates() == []
    sent.upsert_many([("2015-06-15", "aaii_bulls", 41.0)])
    # the writer hook rebuilds promptly; the watermark is what made it knowable
    assert ohlc.stale_reconstructed_dates() == []
    rows, _ = ohlc.reconstructed_for_dates(["2015-06-17"])
    assert rows["2015-06-17"].get("aaii_bulls") == 41.0, "the overlay must reach later sessions"


def test_the_sentiment_watermark_is_global_not_per_date():
    _seed_ohlc(DATES)
    with ohlc._conn() as c:
        marks = {r[0]: r[1] for r in c.execute(
            "SELECT date, sentiment_watermark FROM breadth_reconstructed_daily")}
    assert len(set(marks.values())) == 1, marks


# ── the request path must never derive ────────────────────────────────────────

def test_the_request_path_never_derives(monkeypatch):
    """⛔ THE RAIL THE RULING ASKS FOR BY NAME. The derivation is the BUILDER and
    the audit's reference; if a member request can reach it, the materialisation is
    a cache with a slow path rather than a fix."""
    _seed_collector_and_recon()
    calls = []
    real = ohlc.derive_reconstructed
    monkeypatch.setattr(ohlc, "derive_reconstructed",
                        lambda *a, **k: (calls.append(1), real(*a, **k))[1])
    rows = bm.get_history_deep(400)
    assert rows, "non-vacuity: the read must actually have returned rows"
    assert calls == [], f"the request path derived {len(calls)} time(s)"


def test_the_control_proves_that_spy_can_fire(monkeypatch):
    """If the spy could never fire, the test above passes for the wrong reason."""
    _seed_ohlc(DATES)
    calls = []
    real = ohlc.derive_reconstructed
    monkeypatch.setattr(ohlc, "derive_reconstructed",
                        lambda *a, **k: (calls.append(1), real(*a, **k))[1])
    ohlc.build_reconstructed(DATES)
    assert calls, "the builder must go through the derivation"


# ── precedence ────────────────────────────────────────────────────────────────

def _seed_collector_and_recon():
    _seed_ohlc(DATES)
    for d in DATES:
        bm.store_snapshot(d, {"pct_above_50sma": -1.0, "collector_only": True,
                              "up_4pct_today_list": [{"t": "X"}]})
    # a collector date plus reconstructed dates far below it
    older = ["2014-0%d-15" % i for i in range(1, 5)]
    _seed_ohlc(older)
    return older


def test_a_collector_row_beats_a_reconstructed_row_for_the_same_date():
    """Today's `_TRUSTED_SOURCES` behaviour, now asserted rather than implied."""
    _seed_collector_and_recon()
    rows = bm.get_history_deep(400)
    by_date = {r["date"]: r for r in rows}
    for d in DATES:
        assert by_date[d]["pct_above_50sma"] == -1.0, "the collector value must win"
        assert by_date[d].get("collector_only") is True
        assert not by_date[d].get("_reconstructed"), "a collector row is not reconstructed"


def test_a_date_with_only_a_reconstructed_row_is_marked_reconstructed():
    older = _seed_collector_and_recon()
    by_date = {r["date"]: r for r in bm.get_history_deep(400)}
    assert by_date[older[0]]["_reconstructed"] is True


# ── the migration ─────────────────────────────────────────────────────────────

def test_the_migration_is_idempotent_and_leaves_its_input_untouched():
    _seed_ohlc(DATES)
    with ohlc._conn() as c:                     # clear so the migration has work
        c.execute("DELETE FROM breadth_reconstructed_daily")
        c.commit()
    first = mig.backfill_reconstructed(backup=False)
    assert first["ran"] and first["built"] == len(DATES), first
    assert first["source_table_unchanged"] is True
    assert first["before"]["sha256"] == first["after"]["sha256"]
    assert first["stale_after"] == 0
    second = mig.backfill_reconstructed(backup=False)
    assert second["ran"] is False and second["skipped"] == "marker present"


def test_the_migration_aborts_rather_than_running_without_a_backup(monkeypatch):
    _seed_ohlc(DATES)
    import shutil as _sh
    monkeypatch.setattr(mig.shutil, "disk_usage", lambda _p: _sh._ntuple_diskusage(1, 1, 0))
    out = mig.backfill_reconstructed(backup=True)
    assert out["ran"] is False and "not enough room" in out["aborted"]


def test_the_sampled_audit_names_a_drifted_row():
    _seed_ohlc(DATES)
    assert mig.audit_reconstructed()["clean"]
    with ohlc._conn() as c:
        c.execute("UPDATE breadth_reconstructed_daily SET metrics=? WHERE date=?",
                  (json.dumps({"pct_above_50sma": -42.0}), "2015-06-17"))
        c.commit()
    a = mig.audit_reconstructed()
    assert not a["clean"]
    assert a["mismatched"][0]["date"] == "2015-06-17"
    assert a["mismatched"][0]["keys"], "a drift report with no key names is a count"


# ── what a member gets ────────────────────────────────────────────────────────

def test_drills_are_untouched():
    _seed_collector_and_recon()
    lists = bm.get_snapshot_lists(DATES[0])
    assert lists and lists.get("up_4pct_today_list")
