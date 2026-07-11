"""Orphaned-annotation scan + reattach (Journal A+ P3, Task B7).

Uses the `:memory:` + `ensure_schema(conn)` fixture pattern (mirrors
test_trade_refs.py / test_excursions_store.py) so every test stays off the real
auth.db. Annotations key on the STABLE trade_ref (`ext:<external_id>` broker /
`id:<row id>` manual); an orphan is a ref present in an annotation table
(j2_trade_attachments / j2_trade_excursions) that no longer resolves to a live
trade. Orphans are PARKED (surfaced, never deleted); reattach re-points them.
"""
import importlib
import io
import sqlite3
from types import SimpleNamespace

import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two.excursions_store import get_excursion, upsert_excursion
from api.services.journal_two.trade_refs import (
    OrphanReattachError,
    reattach_orphan,
    scan_orphans,
)


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    return conn


def _add_trade(conn, tid, user="u1", source=None, ext=None, symbol="NVDA"):
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,"
        " entry_price, entry_date, exit_price, exit_date, original_stop,"
        " pnl_dollar, pnl_percent, hold_days, result, context_at_entry, created_at,"
        " source, external_id) VALUES"
        " (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            tid, user, "p_" + tid, symbol, "Long", 10, 100, "2026-01-02", 110,
            "2026-01-03", 95, 100, 10, 1, "Win", "{}", "2026-01-01", source, ext,
        ),
    )
    conn.commit()


def _add_attachment(conn, user, trade_ref, n=1):
    for i in range(n):
        conn.execute(
            "INSERT INTO j2_trade_attachments "
            "(id, user_id, trade_ref, filename, label, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (
                f"att_{trade_ref}_{i}".replace(":", "_"),
                user, trade_ref, f"c{i}.png", "chart", "2026-01-01",
            ),
        )
    conn.commit()


_EXC = {
    "symbol": "NVDA", "mfe_price": 115.0, "mae_price": 96.0, "mfe_r": 3.0,
    "mae_r": -0.8, "mfe_ts": 2000, "mae_ts": 3000, "exit_efficiency": 0.6,
    "missed_r": 1.0, "bar_resolution": "5m", "data_quality": "intraday_5m",
}


# ── scan_orphans ────────────────────────────────────────────────────────────

def test_scan_surfaces_orphan_after_trade_deleted():
    conn = _conn()
    _add_trade(conn, "m1")
    _add_attachment(conn, "u1", "id:m1", n=2)
    upsert_excursion("u1", "id:m1", _EXC, conn)
    # Underlying trade hard-deleted → id:m1 no longer resolves.
    conn.execute("DELETE FROM j2_trades WHERE id='m1'")
    conn.commit()

    orphans = scan_orphans("u1", conn)
    assert len(orphans) == 1
    o = orphans[0]
    assert o["tradeRef"] == "id:m1"
    assert o["kind"] == "attachment+excursion"
    assert "2 screenshots" in o["summary"]
    assert "excursion data" in o["summary"]


def test_live_ref_not_surfaced():
    conn = _conn()
    _add_trade(conn, "m1")
    _add_attachment(conn, "u1", "id:m1", n=1)
    upsert_excursion("u1", "id:m1", _EXC, conn)
    # Trade still present → ref resolves → NOT an orphan.
    assert scan_orphans("u1", conn) == []


def test_scan_kinds_and_summary_counts():
    conn = _conn()
    _add_attachment(conn, "u1", "id:gone_a", n=1)          # attachment-only orphan
    upsert_excursion("u1", "id:gone_e", _EXC, conn)         # excursion-only orphan
    by_ref = {o["tradeRef"]: o for o in scan_orphans("u1", conn)}

    assert by_ref["id:gone_a"]["kind"] == "attachment"
    assert by_ref["id:gone_a"]["summary"] == "1 screenshot"
    assert by_ref["id:gone_e"]["kind"] == "excursion"
    assert by_ref["id:gone_e"]["summary"] == "excursion data"


def test_scan_broker_ext_ref_orphan():
    conn = _conn()
    # Broker fingerprint shifted (FIFO re-slice) → the ext: ref no longer resolves.
    _add_attachment(conn, "u1", "ext:bk:GONE", n=3)
    orphans = scan_orphans("u1", conn)
    assert len(orphans) == 1
    assert orphans[0]["tradeRef"] == "ext:bk:GONE"
    assert "3 screenshots" in orphans[0]["summary"]


def test_scan_user_scoped():
    conn = _conn()
    _add_attachment(conn, "u1", "id:gone", n=1)
    _add_attachment(conn, "u2", "id:other", n=1)
    refs = {o["tradeRef"] for o in scan_orphans("u1", conn)}
    assert refs == {"id:gone"}


# ── reattach_orphan ─────────────────────────────────────────────────────────

def test_reattach_moves_annotations_to_target():
    conn = _conn()
    _add_attachment(conn, "u1", "id:old", n=2)
    upsert_excursion("u1", "id:old", _EXC, conn)
    _add_trade(conn, "t2")  # live target trade

    result = reattach_orphan("u1", "id:old", "t2", conn)
    assert result["newRef"] == "id:t2"
    assert result["moved"] == 3            # 2 attachments + 1 excursion
    assert result["attachmentsMoved"] == 2
    assert result["excursionsMoved"] == 1
    assert result["excursionConflict"] is False

    # Annotations now resolve to the target; nothing left orphaned.
    assert scan_orphans("u1", conn) == []
    assert get_excursion("u1", "id:t2", conn) is not None
    assert get_excursion("u1", "id:old", conn) is None
    n_new = conn.execute(
        "SELECT COUNT(*) FROM j2_trade_attachments WHERE user_id='u1' AND trade_ref='id:t2'"
    ).fetchone()[0]
    assert n_new == 2
    n_old = conn.execute(
        "SELECT COUNT(*) FROM j2_trade_attachments WHERE trade_ref='id:old'"
    ).fetchone()[0]
    assert n_old == 0


def test_reattach_target_broker_ref_computed():
    conn = _conn()
    _add_attachment(conn, "u1", "id:old", n=1)
    _add_trade(conn, "b2", source="broker", ext="bk:xyz")
    result = reattach_orphan("u1", "id:old", "b2", conn)
    assert result["newRef"] == "ext:bk:xyz"
    assert result["moved"] == 1


def test_reattach_missing_target_raises_no_mutation():
    conn = _conn()
    _add_attachment(conn, "u1", "id:old", n=1)
    with pytest.raises(OrphanReattachError) as exc:
        reattach_orphan("u1", "id:old", "does_not_exist", conn)
    assert exc.value.status == 404
    # No mutation — the orphan is still parked under its original ref.
    assert conn.execute(
        "SELECT COUNT(*) FROM j2_trade_attachments WHERE trade_ref='id:old'"
    ).fetchone()[0] == 1


def test_reattach_foreign_target_raises():
    conn = _conn()
    _add_attachment(conn, "u1", "id:old", n=1)
    _add_trade(conn, "t2", user="u2")  # target belongs to another user
    with pytest.raises(OrphanReattachError) as exc:
        reattach_orphan("u1", "id:old", "t2", conn)
    assert exc.value.status == 404


def test_reattach_live_ref_rejected():
    conn = _conn()
    _add_trade(conn, "m1")  # live trade → id:m1 resolves
    _add_attachment(conn, "u1", "id:m1", n=1)
    _add_trade(conn, "t2")  # a valid target
    with pytest.raises(OrphanReattachError) as exc:
        reattach_orphan("u1", "id:m1", "t2", conn)
    assert exc.value.status == 409
    # No mutation.
    assert conn.execute(
        "SELECT COUNT(*) FROM j2_trade_attachments WHERE trade_ref='id:m1'"
    ).fetchone()[0] == 1


def test_reattach_excursion_collision_parks_excursion():
    conn = _conn()
    upsert_excursion("u1", "id:old", dict(_EXC, symbol="OLD"), conn)
    _add_attachment(conn, "u1", "id:old", n=1)
    _add_trade(conn, "t2")
    # Target ALREADY holds an excursion under its own ref → moving would collide.
    upsert_excursion("u1", "id:t2", dict(_EXC, symbol="TARGET"), conn)

    result = reattach_orphan("u1", "id:old", "t2", conn)
    assert result["excursionConflict"] is True
    assert result["excursionsMoved"] == 0
    assert result["attachmentsMoved"] == 1
    assert result["moved"] == 1
    # Target excursion preserved (never overwritten); orphan excursion left parked.
    assert get_excursion("u1", "id:t2", conn)["symbol"] == "TARGET"
    assert get_excursion("u1", "id:old", conn)["symbol"] == "OLD"
    # Attachment DID move (no unique key on trade_ref).
    assert conn.execute(
        "SELECT COUNT(*) FROM j2_trade_attachments WHERE trade_ref='id:t2'"
    ).fetchone()[0] == 1


def test_reattach_missing_args_raises_400():
    conn = _conn()
    with pytest.raises(OrphanReattachError) as exc:
        reattach_orphan("u1", "", "t2", conn)
    assert exc.value.status == 400
    with pytest.raises(OrphanReattachError) as exc2:
        reattach_orphan("u1", "id:old", "", conn)
    assert exc2.value.status == 400


# ── reattach relocates screenshot FILES on disk (Task B7 fix) ────────────────
#
# The above `:memory:` tests prove the DB rows re-point. But the screenshot
# FILES live under a directory NAMED from the ref (`_ref_dir`), and both
# `list_trade_attachments` + the serve path reconstruct that dir purely from the
# CURRENT ref. Without moving the files, a reattached screenshot 404s. This test
# uses the real-auth.db + on-disk-attachment-root harness (mirrors
# test_trade_attachments.py) so the whole move is exercised end to end.


class _FakeUpload:
    def __init__(self, data: bytes, filename: str, content_type: str):
        self._buf = io.BytesIO(data)
        self.filename = filename
        self.content_type = content_type

    async def read(self) -> bytes:
        return self._buf.read()


_PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


@pytest.fixture()
def filestore(tmp_path, monkeypatch):
    """Point the attachment root + auth DB at tmp, reload the modules that read
    them at import time, and init the schema (mirrors test_trade_attachments.py)."""
    monkeypatch.setenv("J2_ATTACHMENT_ROOT", str(tmp_path / "att"))
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    from api.services import auth_db
    importlib.reload(auth_db)
    # calendar defines _ATTACHMENT_ROOT at import — reload so it reads our env.
    from api.services.journal_two import calendar as cal
    importlib.reload(cal)
    # trade_attachments binds calendar._ATTACHMENT_ROOT at import — reload after.
    from api.services.journal_two import trade_attachments as ta
    importlib.reload(ta)
    from api.services.journal_two import db as _db
    importlib.reload(_db)
    from api.services.journal_two import trade_refs as tr
    importlib.reload(tr)
    conn = auth_db.get_connection()
    _db.ensure_schema(conn)
    conn.commit()
    conn.close()
    return SimpleNamespace(ta=ta, tr=tr, cal=cal, auth_db=auth_db)


async def test_reattach_relocates_screenshot_files(filestore):
    ta = filestore.ta
    tr = filestore.tr

    # Seed the orphan-to-be trade + a live reattach target in the real DB.
    conn = filestore.auth_db.get_connection()
    try:
        _add_trade(conn, "old1")   # will be hard-deleted → id:old1 orphans
        _add_trade(conn, "new1")   # live reattach target
    finally:
        conn.close()

    # Write a REAL screenshot file under the orphan's ref via the service.
    out = await ta.save_trade_attachment(
        "u1", "id:old1", _FakeUpload(_PNG, "chart.png", "image/png"),
    )
    root = filestore.cal._ATTACHMENT_ROOT
    old_file = root / "u1" / "trades" / ta._ref_dir("id:old1") / f"{out['id']}.png"
    assert old_file.exists()

    # Underlying trade hard-deleted → id:old1 no longer resolves (orphaned).
    conn = filestore.auth_db.get_connection()
    try:
        conn.execute("DELETE FROM j2_trades WHERE id='old1'")
        conn.commit()
    finally:
        conn.close()

    # Reattach onto the live target (conn=None → uses the real DB).
    result = tr.reattach_orphan("u1", "id:old1", "new1")
    assert result["newRef"] == "id:new1"
    assert result["attachmentsMoved"] == 1

    # File physically MOVED to the new ref's dir, GONE from the old ref's dir.
    new_file = root / "u1" / "trades" / ta._ref_dir("id:new1") / f"{out['id']}.png"
    assert new_file.exists()
    assert not old_file.exists()

    # The reattached screenshot is VIEWABLE (the exact B7 regression guard):
    # list returns it under the new ref, and its URL's serve path RESOLVES to
    # the moved file.
    listed = ta.list_trade_attachments("u1", "id:new1")
    assert len(listed) == 1 and listed[0]["id"] == out["id"]
    assert ta.list_trade_attachments("u1", "id:old1") == []
    parts = listed[0]["url"].split("/")
    served = ta.serve_trade_attachment_path("u1", parts[-2], parts[-1])
    assert served is not None
    assert served.resolve() == new_file.resolve()
