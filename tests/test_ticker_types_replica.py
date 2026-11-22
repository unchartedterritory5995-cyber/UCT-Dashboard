"""Rails on the ROUTING-classification replication (owner decision 2026-11-08).

⛔ WHY THIS FILE IS STRICTER THAN IT LOOKS. The table it installs, `ticker_types`, decides
via `massive_processor.is_index_source()` whether a live OPRA trade is stored with
source='stocks' or 'indexes'. A bad install does not throw; it mis-files the tape, and the
error surfaces days later as an odd under-post. Every refusal below is therefore tested
WITH a positive control, so none of them can pass by refusing everything.

Context the tests encode: flow-worker's `ticker_types` froze at 2026-07-14 and stayed
frozen until a manual sync on 2026-11-08 (~117 days, ~1,300 names classification-blind),
for the same reason the TOP-10 replica froze for 55 days before 2026-09-07 -- nothing
reported age, so nothing could notice.
"""
from __future__ import annotations

import os
import sqlite3
import tempfile

os.environ.setdefault("RAILWAY_VOLUME_MOUNT_PATH", tempfile.mkdtemp(prefix="ttr_"))

import pytest  # noqa: E402

from api import ticker_types as tt  # noqa: E402
from api import ticker_types_replica as ttr  # noqa: E402
from api.services.etf_generation import generation_from_pairs  # noqa: E402

LS_OLD = "2026-07-14T05:30:00.000000"
LS_NEW = "2026-11-08T10:30:03.887106"


def _seed(path, pairs, last_synced=LS_OLD, with_meta=True):
    conn = sqlite3.connect(path)
    try:
        tt.ensure_schema(conn)
        conn.executemany(
            "INSERT OR REPLACE INTO ticker_types"
            "(ticker, asset_type, raw_type, name, primary_exchange, market, active, last_synced)"
            " VALUES (?,?,?,?,?,?,1,?)",
            [(t, a, "CS" if a == "STOCK" else "ETF",
              ("%s Inc" % t) if with_meta else None,
              "XNAS" if with_meta else None, "stocks", last_synced) for t, a in pairs])
        conn.commit()
    finally:
        conn.close()


def _pairs(n_stock=1200, n_etf=600):
    return ([("S%04d" % i, "STOCK") for i in range(n_stock)]
            + [("E%04d" % i, "ETF") for i in range(n_etf)])


def _payload(pairs, last_synced=LS_NEW):
    p = sorted((str(t), str(a)) for t, a in pairs)
    return {"generation": generation_from_pairs(p), "last_synced": last_synced,
            "rows": [list(x) for x in p]}


@pytest.fixture(autouse=True)
def _db(tmp_path, monkeypatch):
    """Point BOTH modules at one temp flow.db. They each read DB_PATH at import."""
    path = str(tmp_path / "flow.db")
    monkeypatch.setattr(tt, "DB_PATH", path)
    monkeypatch.setattr(ttr, "DB_PATH", path)
    monkeypatch.setenv("TICKER_TYPES_REPLICA_RECEIVE_ENABLED", "1")
    # The class sets are TTL-cached in module state; a stale cache would leak between tests.
    tt._CLS_CACHE.update(etf_index=frozenset(), stock=frozenset(), loaded_at=0.0)
    return path


# ── the gate ────────────────────────────────────────────────────────────────────────

def test_receive_is_off_by_default(monkeypatch):
    monkeypatch.delenv("TICKER_TYPES_REPLICA_RECEIVE_ENABLED", raising=False)
    assert ttr.receive_enabled() is False, "a routing-table writer must ship dark"


def test_the_two_flags_are_independent(monkeypatch):
    """Arming the sender must not be able to start writing this pod by itself."""
    from api.services import ticker_types_push as push
    monkeypatch.delenv("TICKER_TYPES_REPLICA_PUSH_ENABLED", raising=False)
    assert push.push_enabled() is False
    monkeypatch.setenv("TICKER_TYPES_REPLICA_PUSH_ENABLED", "1")
    monkeypatch.delenv("TICKER_TYPES_REPLICA_RECEIVE_ENABLED", raising=False)
    assert push.push_enabled() is True and ttr.receive_enabled() is False


# ── the happy path, which is the control for every refusal below ────────────────────

def test_a_valid_snapshot_installs_and_the_generations_converge(_db):
    _seed(_db, _pairs(), last_synced=LS_OLD)
    before = ttr.local_classification()
    canonical = _pairs(1250, 620)                      # grew, as a real sync does
    out = ttr.install_pushed_classification(_payload(canonical))
    assert out["status"] == "accepted", out
    after = ttr.local_classification()
    assert after["generation"] == generation_from_pairs(canonical)
    assert after["generation"] != before["generation"]
    assert after["count"] == len(canonical)
    assert after["last_synced"] == LS_NEW


def test_install_refreshes_the_in_memory_class_sets(_db):
    """⚰️ The table being fresh is NOT the routing decision.

    `classify()` answers from `_CLS_CACHE`, a 6h TTL cache. Without the post-install
    refresh the install looks applied while `is_index_source` keeps using the OLD sets for
    up to a TTL -- fresh table, stale routing, and nothing to see.
    """
    _seed(_db, _pairs(), last_synced=LS_OLD)
    tt.refresh_class_sets()
    assert tt.classify("E9999") == "UNKNOWN", "premise: the new ETF is not known yet"
    canonical = _pairs() + [("E9999", "ETF")]
    assert ttr.install_pushed_classification(_payload(canonical))["status"] == "accepted"
    assert tt.classify("E9999") == "ETF", "the class sets must be refreshed by the install"


def test_already_current_transfers_nothing(_db):
    _seed(_db, _pairs(), last_synced=LS_NEW)
    out = ttr.install_pushed_classification(_payload(_pairs(), last_synced=LS_NEW))
    assert out["status"] == "already-current", out


def test_other_columns_survive_an_install(_db):
    """The payload carries two fields; it must not blank `name`/`primary_exchange` on 27k rows."""
    _seed(_db, _pairs(), last_synced=LS_OLD, with_meta=True)
    # The payload must DIFFER, or the generations match and `already-current` short-circuits
    # before any write -- which would make this test pass without ever installing anything.
    canonical = _pairs() + [("E9999", "ETF")]
    assert ttr.install_pushed_classification(_payload(canonical))["status"] == "accepted"
    conn = sqlite3.connect(_db)
    try:
        row = conn.execute("SELECT name, primary_exchange FROM ticker_types "
                           "WHERE ticker='S0001'").fetchone()
    finally:
        conn.close()
    assert row == ("S0001 Inc", "XNAS"), "metadata was clobbered by the classification push"


def test_a_delisted_ticker_is_removed_so_the_digest_can_converge(_db):
    """Authoritative, not merge-only: a merge that keeps extra rows can never converge,
    which turns `already-current` off forever and re-pushes the snapshot every day."""
    _seed(_db, _pairs() + [("GONE", "STOCK")], last_synced=LS_OLD)
    canonical = _pairs()
    assert ttr.install_pushed_classification(_payload(canonical))["status"] == "accepted"
    assert ttr.local_classification()["generation"] == generation_from_pairs(canonical)
    conn = sqlite3.connect(_db)
    try:
        assert conn.execute("SELECT 1 FROM ticker_types WHERE ticker='GONE'").fetchone() is None
    finally:
        conn.close()


# ── the refusals ────────────────────────────────────────────────────────────────────

def test_a_tampered_or_truncated_body_is_rejected(_db):
    _seed(_db, _pairs(), last_synced=LS_OLD)
    p = _payload(_pairs())
    p["rows"] = p["rows"][:-50]                        # truncated after the stamp
    out = ttr.install_pushed_classification(p)
    assert out["status"] == "rejected" and "digest" in out["reason"]
    assert ttr.local_classification()["count"] == len(_pairs()), "nothing may be written"


def test_an_empty_classification_is_rejected(_db):
    _seed(_db, _pairs(), last_synced=LS_OLD)
    out = ttr.install_pushed_classification({"generation": "x", "rows": [], "last_synced": LS_NEW})
    assert out["status"] == "rejected"


def test_a_snapshot_below_the_absolute_floor_is_rejected(_db):
    _seed(_db, _pairs(), last_synced=LS_OLD)
    tiny = [("S0000", "STOCK"), ("E0000", "ETF")]
    out = ttr.install_pushed_classification(_payload(tiny))
    assert out["status"] == "rejected" and "floor" in out["reason"]


def test_the_shrink_guard_refuses_a_partial_canonical_read(_db):
    """A half-fetched canonical snapshot would de-classify thousands of names at once.

    1,800 installed -> a 1,200-row payload clears the absolute floor but is only 67% of
    what is installed, so only the shrink guard can catch it.
    """
    _seed(_db, _pairs(), last_synced=LS_OLD)                 # 1,800 rows
    partial = _pairs(900, 300)                               # 1,200 rows, 67%
    out = ttr.install_pushed_classification(_payload(partial))
    assert out["status"] == "rejected" and "shrink" in out["reason"].lower()
    assert ttr.local_classification()["count"] == 1800, "the local set must be untouched"


def test_the_shrink_guard_still_allows_an_ordinary_delisting_pass(_db):
    """The control. A guard tuned so tight that a normal sync trips it would be disarmed
    within a week, and then it protects nothing."""
    _seed(_db, _pairs(), last_synced=LS_OLD)                 # 1,800
    ordinary = _pairs(1180, 600)                             # 1,780 — 20 names delisted
    assert ttr.install_pushed_classification(_payload(ordinary))["status"] == "accepted"


def test_a_late_retry_may_not_roll_the_classification_backwards(_db):
    _seed(_db, _pairs(), last_synced=LS_NEW)
    out = ttr.install_pushed_classification(_payload(_pairs(1210, 610), last_synced=LS_OLD))
    assert out["status"] == "rejected" and "older" in out["reason"]


def test_a_malformed_row_is_rejected(_db):
    _seed(_db, _pairs(), last_synced=LS_OLD)
    for bad in ([["S0000"]], [["S0000", 7]], [[None, "STOCK"]], [["", "STOCK"]], ["S0000"]):
        rows = [list(x) for x in sorted(_pairs())] + list(bad)
        out = ttr.install_pushed_classification(
            {"generation": generation_from_pairs(_pairs()), "rows": rows, "last_synced": LS_NEW})
        assert out["status"] == "rejected", bad


# ── the sender's own refusal, which no receiver check can substitute for ─────────────

def test_the_sender_refuses_to_replicate_a_half_set(monkeypatch):
    """⚰️ THE SPCX TRAP. `classify()` needs the STOCK set to override a stale
    INDEX_SYMBOLS entry; that positive STOCK answer is the whole reason SPCX routes to
    stocks. An ETF-only snapshot is perfectly well-formed and would pass every receiver
    check, so the refusal has to live on the sender where the classes are known.
    """
    from api.services import ticker_types_push as push
    monkeypatch.setenv("TICKER_TYPES_REPLICA_PUSH_ENABLED", "1")
    monkeypatch.setattr(push, "WORKER_INTERNAL_URL", "http://flow-worker.internal")
    monkeypatch.setenv("PUSH_SECRET", "test-secret")
    monkeypatch.setattr(tt, "classification_snapshot",
                        lambda *a, **k: {"rows": [("E1", "ETF")], "generation": "g",
                                         "last_synced": LS_NEW, "count": 1,
                                         "counts_by_class": {"ETF": 1}})
    out = push.reconcile()
    assert out["ok"] is False and "class" in out["reason"]


def test_the_sender_sends_when_both_classes_are_present(monkeypatch):
    """The control for the test above: it must not refuse a healthy snapshot."""
    from api.services import ticker_types_push as push
    monkeypatch.setenv("TICKER_TYPES_REPLICA_PUSH_ENABLED", "1")
    monkeypatch.setattr(push, "WORKER_INTERNAL_URL", "http://flow-worker.internal")
    monkeypatch.setenv("PUSH_SECRET", "test-secret")
    monkeypatch.setattr(tt, "classification_snapshot",
                        lambda *a, **k: {"rows": [("E1", "ETF"), ("S1", "STOCK")],
                                         "generation": "g", "last_synced": LS_NEW,
                                         "count": 2,
                                         "counts_by_class": {"ETF": 1, "STOCK": 1}})
    out = push.reconcile()
    # It gets past every local refusal and fails only at the wire, which is the proof.
    assert out["ok"] is False and "push failed" in out["reason"]


# ── telemetry, the thing whose absence made both freezes invisible ──────────────────

def test_status_reports_age_so_the_next_freeze_is_visible(_db):
    _seed(_db, _pairs(), last_synced=LS_OLD)
    st = ttr.status()
    assert st["count"] == 1800
    assert st["counts_by_class"] == {"STOCK": 1200, "ETF": 600}
    assert st["age_seconds"] is not None and st["age_seconds"] > 0, (
        "age is the whole point: the 07-14 freeze was invisible because nothing reported it")
    assert st["local_generation"] == generation_from_pairs(_pairs())
