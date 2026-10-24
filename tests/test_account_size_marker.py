"""The member-set marker on j2_accounts (`account_size_set`), the one authority's durable half.

Before it, nothing stored could tell a member who typed exactly 100,000 from the migrated Default
row's 100,000 placeholder, so every reader treated both as unset. The marker records a member
edit; `accounts.member_set_account_size` reads it (marker set = the member's size, whatever the
value; marker absent = the old rule, the placeholder is unset)."""

import sqlite3

import pytest

_PAYLOAD = {
    "defaultStop": {"mode": "custom"},
    "positionClosing": "FIFO",
    "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
    "setups": [],
}


@pytest.fixture
def conn(tmp_path, monkeypatch):
    path = str(tmp_path / "auth.db")
    monkeypatch.setenv("AUTH_DB_PATH", path)
    import importlib
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    yield c
    c.close()


def _save_size(conn, user_id, account_id, size):
    from api.services.journal_two import accounts
    return accounts.upsert_account_settings(user_id, account_id, {**_PAYLOAD, "accountSize": size},
                                            conn=conn)


def test_typing_exactly_the_placeholder_counts_as_set(conn):
    from api.services.journal_two import accounts
    acc = accounts.get_or_migrate_default_account("u1", conn=conn)
    _save_size(conn, "u1", acc["id"], 50_000)
    _save_size(conn, "u1", acc["id"], 100_000)            # the member types exactly 100,000
    s = accounts.get_account_settings("u1", acc["id"], conn=conn)
    assert s["accountSize"] == 100_000.0
    assert accounts.account_size_of(s) == (100_000.0, False)
    assert accounts.own_account_size(s) == 100_000.0


def test_a_migrated_default_row_stays_unset(conn):
    from api.services.journal_two import accounts
    from api.services.voice_position_sizing import UNSET_ACCOUNT_SIZE
    acc = accounts.get_or_migrate_default_account("u2", conn=conn)
    s = accounts.get_account_settings("u2", acc["id"], conn=conn)
    assert s["accountSize"] == accounts._DEFAULT_ACCOUNT_SIZE
    assert accounts.own_account_size(s) is None
    assert accounts.account_size_of(s) == (UNSET_ACCOUNT_SIZE, True)


def test_a_save_that_leaves_the_placeholder_alone_keeps_it_unset(conn):
    """The settings modal PUTs the whole block on every save: saving a setup must not mark a size
    the member never touched."""
    from api.services.journal_two import accounts
    acc = accounts.get_or_migrate_default_account("u3", conn=conn)
    _save_size(conn, "u3", acc["id"], 100_000)
    s = accounts.get_account_settings("u3", acc["id"], conn=conn)
    assert accounts.own_account_size(s) is None


def test_a_set_marker_survives_a_later_save_of_the_same_size(conn):
    from api.services.journal_two import accounts
    acc = accounts.get_or_migrate_default_account("u4", conn=conn)
    _save_size(conn, "u4", acc["id"], 40_000)
    _save_size(conn, "u4", acc["id"], 100_000)
    _save_size(conn, "u4", acc["id"], 100_000)            # an unrelated save afterwards
    s = accounts.get_account_settings("u4", acc["id"], conn=conn)
    assert accounts.own_account_size(s) == 100_000.0


def test_a_new_account_copied_from_a_set_one_carries_the_marker(conn):
    from api.services.journal_two import accounts
    acc = accounts.get_or_migrate_default_account("u5", conn=conn)
    _save_size(conn, "u5", acc["id"], 60_000)
    _save_size(conn, "u5", acc["id"], 100_000)
    copy = accounts.create_account("u5", {"name": "Copy", "color": "teal", "startingBalance": 1000,
                                          "copySettingsFrom": acc["id"]}, conn=conn)
    fresh = accounts.create_account("u5", {"name": "Fresh", "color": "lime", "startingBalance": 1000},
                                    conn=conn)
    assert accounts.own_account_size(accounts.get_account_settings("u5", copy["id"], conn=conn)) == 100_000.0
    assert accounts.own_account_size(accounts.get_account_settings("u5", fresh["id"], conn=conn)) is None


def test_the_predicate_reads_the_marker():
    from api.services.journal_two import accounts
    assert accounts.member_set_account_size(100_000, True) == 100_000.0
    assert accounts.member_set_account_size(100_000) is None
    assert accounts.member_set_account_size(100_000, False) is None
    assert accounts.member_set_account_size(73_000) == 73_000.0
    # The marker never turns a missing or nonsense size into a set one.
    assert accounts.member_set_account_size(0, True) is None
    assert accounts.member_set_account_size(None, True) is None
    assert accounts.member_set_account_size(float("nan"), True) is None


def _legacy_db(path):
    """A j2_accounts table as production had it before the marker: no account_size_set column."""
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE j2_accounts (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL,
            broker TEXT, starting_balance REAL NOT NULL, account_size REAL NOT NULL,
            default_stop TEXT NOT NULL DEFAULT '{"mode":"custom"}',
            position_closing TEXT NOT NULL DEFAULT 'FIFO',
            breakeven_range TEXT NOT NULL DEFAULT '{"enabled":false,"unit":"$","value":0}',
            setups TEXT NOT NULL DEFAULT '[]', share_journal_data INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id, name));
        INSERT INTO j2_accounts (id, user_id, name, color, starting_balance, account_size,
                                 created_at, updated_at)
        VALUES ('placeholder', 'a', 'Default', 'blue', 100000, 100000, 't', 't'),
               ('member', 'b', 'Default', 'blue', 100000, 60000, 't', 't');
    """)
    c.commit()
    return c


def test_the_migration_backfills_and_is_idempotent_on_an_existing_db(tmp_path):
    from api.services.journal_two import db as j2_db
    c = _legacy_db(str(tmp_path / "legacy.db"))
    try:
        j2_db.ensure_schema(c)
        cols = {r[1] for r in c.execute("PRAGMA table_info(j2_accounts)")}
        assert "account_size_set" in cols
        marks = dict(c.execute("SELECT id, account_size_set FROM j2_accounts").fetchall())
        assert marks == {"placeholder": None, "member": 1}
        sizes = dict(c.execute("SELECT id, account_size FROM j2_accounts").fetchall())
        assert sizes == {"placeholder": 100000.0, "member": 60000.0}   # never destructive

        j2_db.ensure_schema(c)                                          # a second boot
        assert dict(c.execute("SELECT id, account_size_set FROM j2_accounts").fetchall()) == marks
    finally:
        c.close()


def test_a_broker_synced_size_is_marked_set(conn):
    """A broker's net-liq is a real size even when it is exactly 100,000."""
    from api.services.journal_two import accounts
    from api.services.journal_two.broker import balances
    acc = accounts.get_or_migrate_default_account("u6", conn=conn)
    assert accounts.own_account_size(accounts.get_account_settings("u6", acc["id"], conn=conn)) is None
    balances.write_balances("u6", {"id": "ba-1", "j2AccountId": acc["id"]}, [], [], conn=conn,
                            broker_total=100_000.0)
    s = accounts.get_account_settings("u6", acc["id"], conn=conn)
    assert accounts.account_size_of(s) == (100_000.0, False)


def test_the_legacy_settings_path_carries_the_marker_into_the_default_row(conn):
    """PUT /api/j2/settings (no account yet) then the Default-row migration: a member who typed
    exactly 100,000 there keeps it as their own size; one who never touched it stays unset."""
    from api.services.journal_two import accounts, settings as legacy
    legacy.upsert_settings("u7", {**_PAYLOAD, "accountSize": 50_000}, conn=conn)
    legacy.upsert_settings("u7", {**_PAYLOAD, "accountSize": 100_000}, conn=conn)
    acc = accounts.get_or_migrate_default_account("u7", conn=conn)
    assert accounts.own_account_size(accounts.get_account_settings("u7", acc["id"], conn=conn)) == 100_000.0

    legacy.upsert_settings("u8", {**_PAYLOAD, "accountSize": 100_000}, conn=conn)   # untouched seed
    acc8 = accounts.get_or_migrate_default_account("u8", conn=conn)
    assert accounts.own_account_size(accounts.get_account_settings("u8", acc8["id"], conn=conn)) is None


# ── Round B fix 1: the modal says when the member saved the size field ────────────────────────

def test_saving_the_size_field_marks_it_set_even_at_an_unchanged_value(conn):
    """The settings modal sends accountSizeTouched when the member saved the size field, so a member
    on the placeholder who types exactly 100,000 counts as set (was: a no-op, still unset)."""
    from api.services.journal_two import accounts
    acc = accounts.get_or_migrate_default_account("t1", conn=conn)
    out = accounts.upsert_account_settings(
        "t1", acc["id"], {**_PAYLOAD, "accountSize": 100_000, "accountSizeTouched": True}, conn=conn)
    assert out["accountSizeIsDefault"] is False
    assert accounts.own_account_size(accounts.get_account_settings("t1", acc["id"], conn=conn)) == 100_000.0


def test_an_untouched_save_leaves_the_placeholder_unset_and_says_so(conn):
    from api.services.journal_two import accounts
    from api.services.voice_position_sizing import UNSET_ACCOUNT_SIZE
    acc = accounts.get_or_migrate_default_account("t2", conn=conn)
    out = accounts.upsert_account_settings(
        "t2", acc["id"], {**_PAYLOAD, "accountSize": 100_000, "accountSizeTouched": False}, conn=conn)
    assert out["accountSizeIsDefault"] is True and out["defaultAccountSize"] == UNSET_ACCOUNT_SIZE
    # a non-boolean "touched" is not a member action
    out = accounts.upsert_account_settings(
        "t2", acc["id"], {**_PAYLOAD, "accountSize": 100_000, "accountSizeTouched": "yes"}, conn=conn)
    assert out["accountSizeIsDefault"] is True


def test_the_legacy_settings_put_honours_the_touched_flag(conn):
    from api.services.journal_two import accounts, settings as legacy
    legacy.upsert_settings("t3", {**_PAYLOAD, "accountSize": 100_000, "accountSizeTouched": True}, conn=conn)
    acc = accounts.get_or_migrate_default_account("t3", conn=conn)
    assert accounts.own_account_size(accounts.get_account_settings("t3", acc["id"], conn=conn)) == 100_000.0
