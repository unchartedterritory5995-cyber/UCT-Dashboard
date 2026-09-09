"""Discriminating regression rail for the account-deletion Notebook/Journal 2.0 purge.

Proves the defect found in Phase One research (none of the j2_* tables carry
a foreign key to users(id), so `_cascade_delete_user`'s generic PRAGMA walk
never reaches any of them) and proves the fix
(`api/services/journal_two/account_purge.py`, wired into both account-deletion
endpoints in `api/routers/auth.py`).

Method: real, isolated auth.db (full real schema, same `ensure_schema()` path
production uses) + two synthetic users, populated with one representative row
in EVERY table `account_purge` touches (built generically off the live
schema, so this test can never silently drift from the manifest in
`docs/account-deletion-manifest.md` — a table added to `_DIRECT_USER_TABLES`
tomorrow is covered here automatically). Deletion goes through the ACTUAL
endpoint function (`admin_delete_user_by_id`), not just the purge module in
isolation, so a wiring mistake (call site missing, wrong order) would also
be caught.

Run this file's tests against a checkout BEFORE the fix (comment out the two
`account_purge` calls in `auth.py`) and every `test_every_manifest_table_*`
assertion goes red — that is the point: it is a discriminating rail, not a
tautology that would pass either way.
"""
from __future__ import annotations

import importlib
import os
import tempfile
import uuid

import pytest
from fastapi import HTTPException

# ── enum/CHECK-constrained columns the generic filler can't guess safely ──────
_ENUM_OVERRIDES: dict[str, dict[str, str]] = {
    "j2_positions": {"side": "Long"},
    "j2_trades": {"side": "Long", "result": "Win"},
    "j2_playbook_entries": {"status": "watching"},
    "j2_option_strategies": {"direction": "neutral", "status": "open"},
    "j2_coach_outputs": {"output_type": "chat_turn"},
    "j2_chat_messages": {"role": "user"},
    "j2_verdicts": {"label": "GO", "source": "llm"},
    "j2_interventions": {"severity": "info"},
    "j2_profile_suggestions": {"source_type": "chat", "status": "pending"},
    "j2_broker_accounts": {"status": "active"},
    "j2_broker_dup_flags": {"status": "pending"},
}


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


def _insert_minimal_row(conn, table: str, user_id: str, tag: str) -> None:
    """One syntactically-valid row for `table`, every `user_id` column set to
    `user_id`, every other NOT NULL/PK column filled with a cheap, tag-unique
    placeholder so two calls (target user, control user) never collide."""
    cols = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
    if not cols:
        raise AssertionError(
            f"{table} has no columns per PRAGMA table_info — the table doesn't "
            f"exist in this test's schema (some j2_* tables, e.g. "
            f"j2_weekly_email_log, are created lazily by their owning module, "
            f"not by journal_two.db.ensure_schema() — see _seed_full_manifest's "
            f"pre-creation step)"
        )
    overrides = _ENUM_OVERRIDES.get(table, {})
    pk_cols = [c[1] for c in cols if c[5]]
    solo_integer_pk = (
        len(pk_cols) == 1 and "INT" in (next(c for c in cols if c[5])[2] or "").upper()
    )
    values: dict[str, object] = {}
    for col in cols:
        name, coltype, notnull, pk = col[1], (col[2] or "").upper(), col[3], col[5]
        if name == "user_id":
            values[name] = user_id
            continue
        if name in overrides:
            values[name] = overrides[name]
            continue
        if pk and solo_integer_pk:
            # A LONE INTEGER PRIMARY KEY is SQLite's rowid alias (AUTOINCREMENT
            # in these schemas) — never assign it explicitly, or two rows both
            # asking for 0 collide on the implicit UNIQUE. A composite key that
            # merely INCLUDES an integer column (e.g. j2_note_embeds'
            # (note_id, position)) is NOT a rowid alias and must be filled.
            continue
        if not notnull and not pk:
            continue
        if "INT" in coltype:
            values[name] = 0
        elif "REAL" in coltype or "FLOA" in coltype or "DOUB" in coltype:
            values[name] = 0.0
        else:
            values[name] = f"{table}_{name}_{tag}"
    col_names = list(values.keys())
    sql = (
        f'INSERT INTO "{table}" ({",".join(col_names)}) '
        f'VALUES ({",".join("?" for _ in col_names)})'
    )
    conn.execute(sql, tuple(values[c] for c in col_names))


def _seed_user(conn, user_id: str, email: str) -> None:
    conn.execute(
        "INSERT INTO users (id, email, password_hash, display_name, role) "
        "VALUES (?, ?, 'x', 'Test', 'member')",
        (user_id, email),
    )


def _seed_full_manifest(conn, user_id: str, tag: str) -> dict[str, str]:
    """Populate one row per direct table, plus the two indirect-ownership
    tables wired to a real parent row. Returns the ids needed to assert
    against later (the option-strategy id and broker-account id)."""
    from api.services.journal_two import account_purge as ap
    from api.services.journal_two import coach_email_digest as ced

    # j2_weekly_email_log is created lazily by its own module, not by
    # journal_two.db.ensure_schema() — force it into existence before the
    # generic filler reaches it (production hits the same lazy-init path the
    # first time a weekly digest actually sends).
    ced._ensure_log_table(conn)

    for table in ap._DIRECT_USER_TABLES:
        _insert_minimal_row(conn, table, user_id, tag)

    strategy_id = conn.execute(
        "SELECT id FROM j2_option_strategies WHERE user_id = ?", (user_id,)
    ).fetchone()[0]
    conn.execute(
        "INSERT INTO j2_option_legs "
        "(id, strategy_id, leg_index, side, contract_type, strike, expiration, qty, entry_price) "
        "VALUES (?, ?, 0, 'buy', 'call', 100.0, '2026-12-18', 1, 1.0)",
        (f"leg_{tag}", strategy_id),
    )

    broker_account_id = conn.execute(
        "SELECT id FROM j2_broker_accounts WHERE user_id = ?", (user_id,)
    ).fetchone()[0]
    conn.execute(
        "INSERT INTO j2_broker_member_stale_notify (broker_account_id, notified_marker) "
        "VALUES (?, '2026-01-01T00:00:00')",
        (broker_account_id,),
    )
    conn.commit()
    return {"strategy_id": strategy_id, "broker_account_id": broker_account_id}


def _row_counts(conn, user_id: str) -> dict[str, int]:
    from api.services.journal_two import account_purge as ap

    counts = {}
    for table in ap._DIRECT_USER_TABLES:
        counts[table] = conn.execute(
            f'SELECT COUNT(*) FROM "{table}" WHERE user_id = ?', (user_id,)
        ).fetchone()[0]
    counts["j2_option_legs"] = conn.execute(
        "SELECT COUNT(*) FROM j2_option_legs WHERE strategy_id IN "
        "(SELECT id FROM j2_option_strategies WHERE user_id = ?)",
        (user_id,),
    ).fetchone()[0]
    counts["j2_broker_member_stale_notify"] = conn.execute(
        "SELECT COUNT(*) FROM j2_broker_member_stale_notify WHERE broker_account_id IN "
        "(SELECT id FROM j2_broker_accounts WHERE user_id = ?)",
        (user_id,),
    ).fetchone()[0]
    return counts


def test_every_manifest_table_is_purged_and_the_control_user_is_untouched(db_path, monkeypatch, tmp_path):
    from api.services.auth_db import get_connection
    from api.routers import auth as auth_router
    from api.services.journal_two import notes as notes_mod
    from api.services.journal_two.attachment_root import attachment_root

    target, control = f"u_target_{uuid.uuid4().hex[:8]}", f"u_control_{uuid.uuid4().hex[:8]}"
    conn = get_connection()
    try:
        _seed_user(conn, target, f"{target}@test.uct")
        _seed_user(conn, control, f"{control}@test.uct")
        conn.commit()
        _seed_full_manifest(conn, target, "tgt")
        _seed_full_manifest(conn, control, "ctl")

        control_before = _row_counts(conn, control)
        assert all(n > 0 for n in control_before.values()), "seeding itself is broken"
        target_before = _row_counts(conn, target)
        assert all(n > 0 for n in target_before.values()), "seeding itself is broken"

        # A real note, so the FTS mirror + notebook attachment root are exercised.
        # body_plain is DERIVED from bodyJson (extract_plain_text) — not a
        # separate payload field — so the searchable text must live in a real
        # TipTap doc, not a flat string.
        note = notes_mod.create_note(
            target,
            {
                "title": "target note",
                "bodyJson": {
                    "type": "doc",
                    "content": [
                        {"type": "paragraph", "content": [{"type": "text", "text": "delete me please"}]}
                    ],
                },
            },
            conn=conn,
        )
        conn.commit()

        # A real attachment file, exactly where notes.py's own upload path
        # would put one: attachment_root()/<user_id>/notes/<note_id>/inline/.
        att_dir = attachment_root() / target / "notes" / note["id"] / "inline"
        att_dir.mkdir(parents=True, exist_ok=True)
        att_file = att_dir / (uuid.uuid4().hex + ".png")
        att_file.write_bytes(b"not a real png, just proving deletion")
        assert att_file.exists()
        user_attachment_dir = attachment_root() / target
        assert user_attachment_dir.is_dir()

    finally:
        conn.close()

    # Delete through the ACTUAL endpoint function — real broker purge, real
    # journal_two purge, real generic cascade, in the real order.
    result = auth_router.admin_delete_user_by_id(
        user_id=target, user={"id": "admin_1", "role": "admin", "email": "admin@test"},
    )

    assert result["ok"] is True
    assert result["journal_two_purge"]["ok"] is True
    assert result["journal_two_purge"]["total_rows_deleted"] > 0

    conn3 = get_connection()
    try:
        target_after = _row_counts(conn3, target)
        for table, n in target_after.items():
            assert n == 0, f"{table} still has {n} row(s) for the deleted user — purge did not reach it"

        # FTS mirror: the deleted user's note content must not be findable.
        fts_hit = conn3.execute(
            "SELECT COUNT(*) FROM j2_notes_fts WHERE j2_notes_fts MATCH 'please' AND user_id = ?",
            (target,),
        ).fetchone()[0]
        assert fts_hit == 0, "FTS mirror still has the deleted user's note content"

        # users row itself is gone (the generic cascade's own job).
        assert conn3.execute("SELECT 1 FROM users WHERE id = ?", (target,)).fetchone() is None

        # Control user completely untouched, table by table.
        control_after = _row_counts(conn3, control)
        assert control_after == control_before, "an unrelated user's rows changed — cross-user isolation broken"
        assert conn3.execute("SELECT 1 FROM users WHERE id = ?", (control,)).fetchone() is not None
    finally:
        conn3.close()

    # Attachment directory physically gone.
    assert not user_attachment_dir.exists(), "the deleted user's attachment directory still exists on disk"


def test_purge_user_data_is_idempotent_on_a_second_call(db_path):
    from api.services.auth_db import get_connection
    from api.services.journal_two import account_purge as ap

    user_id = f"u_idem_{uuid.uuid4().hex[:8]}"
    conn = get_connection()
    try:
        _seed_user(conn, user_id, f"{user_id}@test.uct")
        conn.commit()
        _seed_full_manifest(conn, user_id, "idem")

        first = ap.purge_user_data(user_id, conn)
        assert first["ok"] is True
        assert first["total_rows_deleted"] > 0

        # Second call against the now-empty tables must not raise and must
        # report zero further rows deleted — not an error, not a re-delete.
        second = ap.purge_user_data(user_id, conn)
        assert second["ok"] is True
        assert second["total_rows_deleted"] == 0
        assert second["errors"] == []
    finally:
        conn.close()


def test_admin_delete_user_by_id_404s_for_an_unknown_user_without_raising_anything_else(db_path):
    from api.routers import auth as auth_router

    with pytest.raises(HTTPException) as exc:
        auth_router.admin_delete_user_by_id(
            user_id="no-such-user-ever",
            user={"id": "admin_1", "role": "admin", "email": "admin@test"},
        )
    assert exc.value.status_code == 404
