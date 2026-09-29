"""TERM-081 / FB-S9-04 — `entitlements.toolkit_for` reads `user["toolkit"]`, and
until this ticket NO DDL defined that column and `validate_session` never
projected it. The lookup was real in `entitlements.py` and unreachable from
every request: it could only ever answer `DEFAULT_TOOLKIT`.

Two gaps, and closing one without the other changes nothing:
  1. the SCHEMA — `auth_db.init_db` adds `users.toolkit` (additive, idempotent);
  2. the PROJECTION — `auth_service.validate_session` builds its dict key by key,
     so a column it does not name never reaches `toolkit_for`.

⛔ NOTHING A MEMBER SEES MAY MOVE. The column's default is NULL — "no toolkit
assigned" — and the default toolkit's NAME stays spelled once, in
`entitlements.DEFAULT_TOOLKIT`. `validate_session` carries the key ONLY when the
column is set, so the `/api/auth/me` payload of every existing row is unchanged.

⛔ The "old schema" below is FROZEN on purpose: it is the `users`/`sessions` shape
that `init_db` produced before this ticket. Deriving it from `auth_db._SCHEMA`
would let a later edit that put `toolkit` into `_SCHEMA` turn this into a
fixture that no longer contains an old database.

Scoped runs only on this box:

    python -m pytest tests/test_entitlements_toolkit_column.py -q
"""
from __future__ import annotations

import dataclasses
import sqlite3
from datetime import datetime, timedelta, timezone
from types import MappingProxyType

import pytest

from api.services import auth_db, auth_service
from api.services import entitlements as ent


#: `users` and `sessions` exactly as `init_db` left them before TERM-081 —
#: `_SCHEMA`'s CREATE plus the four `users` and three `sessions` migrations.
_OLD_USERS_AND_SESSIONS = """
CREATE TABLE users (
    id              TEXT PRIMARY KEY,
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    display_name    TEXT,
    role            TEXT DEFAULT 'member',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP;
ALTER TABLE users ADD COLUMN referral_code TEXT;
ALTER TABLE users ADD COLUMN full_name TEXT;
CREATE TABLE sessions (
    token       TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    expires_at  TIMESTAMP NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE sessions ADD COLUMN user_agent TEXT;
ALTER TABLE sessions ADD COLUMN ip_address TEXT;
ALTER TABLE sessions ADD COLUMN last_seen_at TIMESTAMP;
"""

#: Varied on purpose — NULLs, an admin, verified and not, a referral code — so a
#: migration that rewrote any column of an existing row has something to move.
_MEMBERS = [
    # id,     email,               display, role,     verified, last_login,            referral, full_name
    ("u-one", "one@t.internal",    "One",   "member", 1, "2026-09-01 10:00:00", "REF1", "Member One"),
    ("u-two", "two@t.internal",    None,    "admin",  0, None,                  None,   None),
    ("u-three", "three@t.internal", "Three", "member", 0, "2026-08-15 08:30:00", None,   "Member Three"),
]


@pytest.fixture
def old_db(tmp_path, monkeypatch):
    """An auth.db in the PRE-TERM-081 shape, with members and live sessions.

    Returns ``{user_id: session_token}``. `get_connection` reads the module
    global at call time, so pointing `_DB_PATH` here routes `init_db` AND
    `validate_session` at the scratch file and nowhere else.
    """
    path = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(path))
    conn = sqlite3.connect(str(path))
    try:
        conn.executescript(_OLD_USERS_AND_SESSIONS)
        expires = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        tokens = {}
        for i, (uid, email, display, role, ver, last, ref, full) in enumerate(_MEMBERS):
            conn.execute(
                "INSERT INTO users (id, email, password_hash, display_name, role, "
                "created_at, email_verified, last_login_at, referral_code, full_name) "
                "VALUES (?, ?, 'x', ?, ?, ?, ?, ?, ?, ?)",
                (uid, email, display, role, f"2026-0{i + 1}-01 00:00:00.000000",
                 ver, last, ref, full))
            tok = f"tok-{uid}"
            conn.execute("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
                         (tok, uid, expires))
            tokens[uid] = tok
        conn.commit()
    finally:
        conn.close()
    return tokens


def _raw(sql, params=()):
    conn = sqlite3.connect(auth_db._DB_PATH)
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def _user_cols():
    return [r[1] for r in _raw("PRAGMA table_info(users)")]


def _snapshot():
    """Everything the migration could touch: every table's DDL, `users`' column
    list, and every `users` row — as `repr` strings, so equality is BYTE equality."""
    return (
        repr(_raw("SELECT name, sql FROM sqlite_master ORDER BY type, name")),
        repr(_raw("PRAGMA table_info(users)")),
        repr(_raw("SELECT * FROM users ORDER BY id")),
    )


def _set_toolkit(uid, value):
    conn = sqlite3.connect(auth_db._DB_PATH)
    try:
        conn.execute("UPDATE users SET toolkit = ? WHERE id = ?", (value, uid))
        conn.commit()
    finally:
        conn.close()


# ─── 1. the migration: additive, and a second run is a no-op ─────────────────

def test_the_migration_ADDS_toolkit_to_an_OLD_database_and_a_SECOND_run_is_a_NO_OP(old_db):
    # the control — the fixture really is the old shape
    assert "toolkit" not in _user_cols()

    auth_db.init_db()
    assert "toolkit" in _user_cols()
    once = _snapshot()

    auth_db.init_db()                       # must neither raise nor move a byte
    assert _snapshot() == once


def test_a_FRESH_database_gets_the_column_too(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "fresh.db"))
    auth_db.init_db()
    assert "toolkit" in _user_cols()


# ─── 2. every existing row reads exactly as it did before ────────────────────

def test_every_EXISTING_row_reads_BYTE_IDENTICALLY_after_the_migration(old_db):
    old_cols = _user_cols()
    col_list = ", ".join(old_cols)
    rows_before = repr(_raw(f"SELECT {col_list} FROM users ORDER BY id"))

    # TODAY'S lookup, on today's data: the account as the database holds it.
    conn = sqlite3.connect(auth_db._DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        accounts = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM users")}
    finally:
        conn.close()
    today = {uid: (ent.toolkit_for(a), repr(ent.limits_for(a))) for uid, a in accounts.items()}
    assert set(today) == {m[0] for m in _MEMBERS}

    auth_db.init_db()

    # the rows: every pre-existing column, byte for byte — and the new one NULL
    assert repr(_raw(f"SELECT {col_list} FROM users ORDER BY id")) == rows_before
    assert _raw("SELECT DISTINCT toolkit FROM users") == [(None,)]

    # the lookup, through the REAL request path
    for uid, tok in old_db.items():
        user = auth_service.validate_session(tok)
        assert user is not None and user["id"] == uid
        # ⛔ `/api/auth/me` returns this dict verbatim — an unset column adds NO key
        assert "toolkit" not in user, user
        assert (ent.toolkit_for(user), repr(ent.limits_for(user))) == today[uid]
        assert ent.limits_for(user) == ent.TOOLKITS[ent.DEFAULT_TOOLKIT]


# ─── 3. a set column is READ — the lookup is load-bearing ─────────────────────

@pytest.fixture
def two_toolkits(monkeypatch):
    """A second toolkit. ⛔ A TEST FIXTURE, NOT A SHIPPED ONE — `ent.TOOLKITS`
    ships exactly one entry. Without a second, "the lookup read the column" and
    "the lookup returned the default" give the same answer and no test can tell
    them apart."""
    narrow = dataclasses.replace(ent.TOOLKITS[ent.DEFAULT_TOOLKIT],
                                 toolkit="narrow", max_symbols=5)
    assert narrow != ent.TOOLKITS[ent.DEFAULT_TOOLKIT]       # the fixture can distinguish
    monkeypatch.setattr(ent, "TOOLKITS", MappingProxyType(
        {ent.DEFAULT_TOOLKIT: ent.TOOLKITS[ent.DEFAULT_TOOLKIT], "narrow": narrow}))
    return narrow


def test_a_row_with_the_column_SET_resolves_to_THAT_toolkit(old_db, two_toolkits):
    auth_db.init_db()
    _set_toolkit("u-one", "narrow")

    one = auth_service.validate_session(old_db["u-one"])
    assert one["toolkit"] == "narrow"
    assert ent.toolkit_for(one) == "narrow"
    assert ent.limits_for(one) is two_toolkits

    # …and a neighbour on the same database is untouched, so a lookup that
    # answered "narrow" for everybody fails here rather than passing above
    two = auth_service.validate_session(old_db["u-two"])
    assert "toolkit" not in two
    assert ent.limits_for(two) == ent.TOOLKITS[ent.DEFAULT_TOOLKIT]


# ─── 4. an unknown name is still refused ─────────────────────────────────────

@pytest.mark.parametrize("stored", ["platinum", "ALL", "   ", ""])
def test_the_lookup_still_REFUSES_a_toolkit_name_it_does_not_ship(old_db, two_toolkits, stored):
    """A value in the column is a CLAIM, not a grant. A name `TOOLKITS` does not
    carry resolves to the default — never to itself, and never to a KeyError that
    would turn a bad row into a 500 on every scan route."""
    auth_db.init_db()
    _set_toolkit("u-three", stored)

    user = auth_service.validate_session(old_db["u-three"])
    assert ent.toolkit_for(user) == ent.DEFAULT_TOOLKIT
    assert ent.limits_for(user) == ent.TOOLKITS[ent.DEFAULT_TOOLKIT]
