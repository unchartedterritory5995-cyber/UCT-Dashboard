"""The live tier's anchor read is cached between sweeps (2026-10-13).

Re-reading ~11,000 anchor rows every minute cost ~30 s of a ~41 s sweep on the
web pod. The rows only change when the nightly build rewrites `screener_rows`,
so a one-row fingerprint decides whether a full read is needed.
"""
import pytest

from api.services.screener import live_tier, snapshot_db


@pytest.fixture
def live_db(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.delenv("SCREENER_LIVE_ANCHOR_CACHE", raising=False)
    live_tier._ANCHOR_CACHE.clear()
    snapshot_db.init_db()
    yield snapshot_db.get_db_path()
    live_tier._ANCHOR_CACHE.clear()


def _row(ticker, built_at="2026-10-13T03:00:00", atr=1.0):
    return {"ticker": ticker, "built_at": built_at, "bars_asof": "2026-10-12",
            "atr_pct": atr}


def _count_full_reads(monkeypatch):
    calls = []
    real = snapshot_db.connect

    class _Conn:
        def __init__(self, conn):
            self._c = conn

        def __enter__(self):
            self._c.__enter__()
            return self

        def __exit__(self, *a):
            return self._c.__exit__(*a)

        def execute(self, sql, *a):
            if sql.startswith("SELECT ") and "COUNT(*)" not in sql:
                calls.append(sql)
            return self._c.execute(sql, *a)

    monkeypatch.setattr(snapshot_db, "connect", lambda **kw: _Conn(real(**kw)))
    return calls


def test_a_second_sweep_reuses_the_rows_without_a_full_read(live_db, monkeypatch):
    snapshot_db.upsert_rows([_row("AAA"), _row("BBB")])
    calls = _count_full_reads(monkeypatch)
    first = live_tier._read_anchor_rows()
    second = live_tier._read_anchor_rows()
    assert sorted(r["ticker"] for r in first) == ["AAA", "BBB"]
    assert second is first
    assert len(calls) == 1


def test_a_rebuild_with_the_same_count_and_built_at_is_still_seen(live_db):
    snapshot_db.upsert_rows([_row("AAA", atr=1.0)])
    assert live_tier._read_anchor_rows()[0]["atr_pct"] == 1.0
    # Same ticker, same count, same built_at: only the rowid moves.
    snapshot_db.upsert_rows([_row("AAA", atr=5.5)])
    assert live_tier._read_anchor_rows()[0]["atr_pct"] == 5.5


def test_a_new_build_replaces_the_cached_rows(live_db):
    snapshot_db.upsert_rows([_row("AAA")])
    assert len(live_tier._read_anchor_rows()) == 1
    snapshot_db.upsert_rows([_row("AAA", "2026-10-14T03:00:00"),
                             _row("CCC", "2026-10-14T03:00:00")])
    assert sorted(r["ticker"] for r in live_tier._read_anchor_rows()) == ["AAA", "CCC"]


def test_the_kill_switch_reads_every_time(live_db, monkeypatch):
    snapshot_db.upsert_rows([_row("AAA")])
    monkeypatch.setenv("SCREENER_LIVE_ANCHOR_CACHE", "0")
    calls = _count_full_reads(monkeypatch)
    a = live_tier._read_anchor_rows()
    b = live_tier._read_anchor_rows()
    assert a == b and a is not b
    assert len(calls) == 2
    assert live_tier._ANCHOR_CACHE == []


def test_an_empty_table_is_not_cached_as_stale(live_db):
    assert live_tier._read_anchor_rows() == []
    snapshot_db.upsert_rows([_row("AAA")])
    assert [r["ticker"] for r in live_tier._read_anchor_rows()] == ["AAA"]


# -- the disk tier: a restart loads the last full read instead of re-reading -------

def _restart():
    """What a new process sees: no memory cache, the files on the volume intact."""
    live_tier._ANCHOR_CACHE.clear()
    live_tier._LAST_ANCHOR_SOURCE.clear()


def test_a_restart_loads_the_anchors_from_disk_not_screener_rows(live_db, monkeypatch):
    snapshot_db.upsert_rows([_row("AAA"), _row("BBB")])
    calls = _count_full_reads(monkeypatch)
    first = live_tier._read_anchor_rows()
    _restart()
    second = live_tier._read_anchor_rows()
    assert len(calls) == 1, "the restart re-read every row"
    assert live_tier._LAST_ANCHOR_SOURCE == ["disk"]
    assert second == first


def test_a_rebuild_makes_the_disk_copy_stale(live_db, monkeypatch):
    snapshot_db.upsert_rows([_row("AAA")])
    live_tier._read_anchor_rows()
    snapshot_db.upsert_rows([_row("AAA", built_at="2026-10-14T03:00:00", atr=2.0)])
    _restart()
    calls = _count_full_reads(monkeypatch)
    got = live_tier._read_anchor_rows()
    assert len(calls) == 1 and live_tier._LAST_ANCHOR_SOURCE == ["read"]
    assert got[0]["atr_pct"] == 2.0


def test_CONTROL_the_disk_kill_switch_reads_every_row(live_db, monkeypatch):
    monkeypatch.setenv("SCREENER_LIVE_ANCHOR_DISK", "0")
    snapshot_db.upsert_rows([_row("AAA")])
    live_tier._read_anchor_rows()
    _restart()
    calls = _count_full_reads(monkeypatch)
    live_tier._read_anchor_rows()
    assert len(calls) == 1 and live_tier._LAST_ANCHOR_SOURCE == ["read"]


def test_a_process_started_mid_build_holds_the_disk_anchors(live_db):
    """A deploy during a daytime build: memory is empty, the lock is the builder's;
    the held anchors come from disk without touching screener_rows."""
    snapshot_db.upsert_rows([_row("AAA")])
    live_tier._read_anchor_rows()
    _restart()
    held = live_tier.held_anchors_for_build()
    assert held is not None and [r["ticker"] for r in held] == ["AAA"]


def test_an_unreadable_disk_copy_falls_back_to_the_full_read(live_db, monkeypatch):
    snapshot_db.upsert_rows([_row("AAA")])
    live_tier._read_anchor_rows()
    with open(live_tier._anchor_disk_path(), "wb") as f:
        f.write(b"not a pickle")
    _restart()
    calls = _count_full_reads(monkeypatch)
    assert [r["ticker"] for r in live_tier._read_anchor_rows()] == ["AAA"]
    assert len(calls) == 1
