"""Obsidian ingest schema. The staging table is the seam that lets a PUSH
transport reuse the PULL engine: the plugin writes here, the provider reads
here, and the engine never learns there was a difference."""
import base64
import hashlib
import hmac
import sqlite3
import time as _time

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import errors, obsidian_link
from api.services.journal_two import db as j2db

_OBSIDIAN_TABLES = (
    "j2_obsidian_devices",
    "j2_obsidian_staging",
    "j2_obsidian_manifest",
)


def _conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    return c


def test_the_three_tables_exist():
    c = _conn()
    names = {r[0] for r in c.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'j2_obsidian%'")}
    assert names == {"j2_obsidian_devices", "j2_obsidian_staging", "j2_obsidian_manifest"}


def test_a_device_token_is_unique_per_vault_and_user():
    c = _conn()
    args = ("dev1", "u1", "vault-abc", "enc-token", "My Vault", "2026-09-02T00:00:00Z")
    c.execute("INSERT INTO j2_obsidian_devices (id, user_id, vault_id, token_enc,"
              " label, created_at) VALUES (?,?,?,?,?,?)", args)
    c.commit()
    try:
        c.execute("INSERT INTO j2_obsidian_devices (id, user_id, vault_id, token_enc,"
                  " label, created_at) VALUES (?,?,?,?,?,?)",
                  ("dev2", "u1", "vault-abc", "enc2", "Dup", "2026-09-02T00:00:00Z"))
        raise AssertionError("a second device for the same (user, vault) was allowed")
    except sqlite3.IntegrityError:
        pass


def test_staging_rows_are_scoped_to_a_user_and_keyed_by_vault_path():
    c = _conn()
    c.execute("INSERT INTO j2_obsidian_staging (user_id, vault_id, vault_path,"
              " content_hash, body_md, updated_at, received_at)"
              " VALUES (?,?,?,?,?,?,?)",
              ("u1", "v1", "Notes/idea.md", "h1", "# Idea", "2026-09-02T00:00:00Z",
               "2026-09-02T00:00:01Z"))
    c.commit()
    row = c.execute("SELECT user_id, vault_path FROM j2_obsidian_staging").fetchone()
    assert (row["user_id"], row["vault_path"]) == ("u1", "Notes/idea.md")


# ─── Migration v6 path (review round 1) ──────────────────────────────────────
# Every production DB already exists, so it will take the MIGRATION path below,
# never the fresh-_J2_SCHEMA path the three tests above exercise. Mirrors
# test_note_connectors_db.py's v3 precedent (drop-and-reupgrade via
# ensure_schema() itself, plus a direct-call idempotency test) rather than
# inventing a new shape.

def _table_names(conn):
    return {
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }


def test_ensure_schema_upgrades_a_pre_v6_shaped_db_and_is_idempotent(tmp_path, monkeypatch):
    """THE load-bearing case.

    ⛔ Review-1 finding: the current `_J2_SCHEMA` (the module constant this
    test builds the "pre-v6" DB from) already defines all three Obsidian
    tables via `CREATE TABLE IF NOT EXISTS`, and `ensure_schema()`
    unconditionally executes the FULL current `_J2_SCHEMA` as its very first
    statement -- before `run_notebook_migration_v6` ever runs. So dropping
    the tables and calling `ensure_schema()` proved nothing about the
    migration: the fresh-schema step recreates them regardless of what the
    migration does. Measured, not assumed -- stubbing
    `run_notebook_migration_v6` to a no-op left the old version of this test
    GREEN.

    The fix: `_J2_SCHEMA` is patched, for this call only, to a version with
    the Obsidian block stripped out -- a state the REAL, current
    `_J2_SCHEMA` cannot reach on its own -- so `ensure_schema()`'s own
    fresh-schema step genuinely cannot create the three tables, and only
    `run_notebook_migration_v6` can. THAT is what makes a no-op stub of the
    migration go red here.
    """
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    c = sqlite3.connect(str(tmp_path / "pre_v6.db"))
    c.row_factory = sqlite3.Row
    c.executescript(j2db._J2_SCHEMA)
    for t in _OBSIDIAN_TABLES:
        c.execute(f"DROP TABLE IF EXISTS {t}")
    c.commit()
    assert not (_table_names(c) & set(_OBSIDIAN_TABLES))

    now = "2026-09-02T00:00:00Z"
    c.execute(
        "INSERT INTO j2_note_folders (id,user_id,name,parent_id,sort_order,created_at) "
        "VALUES ('f1','u1','Ideas','',0,?)",
        (now,),
    )
    c.commit()

    # Neuter the fresh-schema path for the ensure_schema() calls below: strip
    # the Obsidian block (3 CREATE TABLEs + 1 CREATE INDEX) out of the
    # `_J2_SCHEMA` string ensure_schema() executes first, so it genuinely
    # cannot recreate the three tables -- only run_notebook_migration_v6 can.
    start_marker = "-- ── Obsidian ingest (Wave 3a)"
    end_marker = "-- ── Notebook widget-embed sidecar (Journal Widgets)"
    start = j2db._J2_SCHEMA.index(start_marker)
    end = j2db._J2_SCHEMA.index(end_marker)
    assert start < end, "the Obsidian schema block markers moved — update this test"
    schema_without_obsidian = j2db._J2_SCHEMA[:start] + j2db._J2_SCHEMA[end:]
    for t in _OBSIDIAN_TABLES:
        assert t not in schema_without_obsidian, f"{t} DDL survived the strip"
    monkeypatch.setattr(j2db, "_J2_SCHEMA", schema_without_obsidian)

    j2db.ensure_schema(c)

    tables = _table_names(c)
    for t in _OBSIDIAN_TABLES:
        assert t in tables, f"{t} not created by ensure_schema() on a pre-v6-shaped DB"

    folder = c.execute("SELECT * FROM j2_note_folders WHERE id='f1'").fetchone()
    assert folder is not None and folder["name"] == "Ideas"

    # Idempotent second run — no crash, seeded row intact. Still under the
    # patched (Obsidian-stripped) schema, so this call also depends on the
    # migration's OWN idempotency (table-existence probe + CREATE TABLE IF
    # NOT EXISTS + the .notebook_migration_v6 flag), not on the schema script.
    j2db.ensure_schema(c)
    assert _table_names(c) >= set(_OBSIDIAN_TABLES)
    assert c.execute("SELECT COUNT(*) FROM j2_note_folders").fetchone()[0] == 1
    c.close()


def test_migration_v6_direct_call_is_idempotent(tmp_path, monkeypatch):
    """Direct coverage of run_notebook_migration_v6's flag, mirroring
    test_note_connectors_db.py's v3 direct-call test: build _J2_SCHEMA, call
    the migration directly, confirm the flag lands, then call it again and
    confirm the second call doesn't raise and the tables remain."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    c = sqlite3.connect(str(tmp_path / "flag.db"))
    c.row_factory = sqlite3.Row
    c.executescript(j2db._J2_SCHEMA)
    j2db.run_notebook_migration_v6(c)
    flag = tmp_path / ".notebook_migration_v6"
    assert flag.exists()

    # Second direct call must not raise even though the tables already exist.
    j2db.run_notebook_migration_v6(c)
    tables = _table_names(c)
    for t in _OBSIDIAN_TABLES:
        assert t in tables
    c.close()


def test_migration_v6_converges_after_a_partial_failure(tmp_path, monkeypatch):
    """Idempotent BY CONSTRUCTION, not merely by the flag. Simulates the
    scenario the migration's own docstring names as the reason its flag write
    is wrapped in try/except: table creation committed, but the flag never
    landed (interrupted boot, unwritable DATA_DIR, etc). Reproduced here by
    dropping two of the three tables and deleting the flag after a first
    successful run, then calling run_notebook_migration_v6 again — the
    table-existence probe + CREATE TABLE IF NOT EXISTS must fill in exactly
    the missing tables without disturbing the one left standing (and the data
    in it)."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    c = sqlite3.connect(str(tmp_path / "partial.db"))
    c.row_factory = sqlite3.Row
    c.executescript(j2db._J2_SCHEMA)
    j2db.run_notebook_migration_v6(c)
    flag = tmp_path / ".notebook_migration_v6"
    assert flag.exists()

    # Seed a row in the one table we'll leave standing.
    c.execute(
        "INSERT INTO j2_obsidian_devices (id, user_id, vault_id, token_enc,"
        " label, created_at) VALUES (?,?,?,?,?,?)",
        ("dev1", "u1", "vault-abc", "enc-token", "My Vault", "2026-09-02T00:00:00Z"),
    )
    c.commit()

    # Simulate a partial prior run: two of the three tables are missing and
    # the flag is gone.
    c.execute("DROP TABLE j2_obsidian_staging")
    c.execute("DROP TABLE j2_obsidian_manifest")
    c.commit()
    flag.unlink()
    assert (_table_names(c) & set(_OBSIDIAN_TABLES)) == {"j2_obsidian_devices"}

    j2db.run_notebook_migration_v6(c)

    tables = _table_names(c)
    for t in _OBSIDIAN_TABLES:
        assert t in tables, f"{t} not restored after partial failure"
    row = c.execute("SELECT id FROM j2_obsidian_devices WHERE id='dev1'").fetchone()
    assert row is not None, "pre-existing table's data was disturbed by the recovery"
    assert flag.exists()
    c.close()


# ─── Task 2: connect codes + device tokens (obsidian_link.py) ────────────────
# `auth_db.get_connection()` is what obsidian_link.py reads/writes through
# (same as note_connectors/connections.py), so these tests point AUTH_DB_PATH
# at a throwaway file rather than the raw-sqlite `_conn()` helper above —
# mirrors test_note_connectors_msgraph_oauth.py's `db` fixture.

@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("PUSH_SECRET", "test-push-secret")
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    yield


def test_a_connect_code_redeems_exactly_once(env):
    code = obsidian_link.mint_connect_code("user-a")
    device_id, token = obsidian_link.redeem_connect_code(code, "vault-1", "My Vault")
    assert device_id and token
    with pytest.raises(errors.NoteConnAuthError):
        obsidian_link.redeem_connect_code(code, "vault-1", "My Vault")


def test_an_expired_code_fails(env):
    # Hand-build a code carrying a timestamp well past the TTL, using the
    # module's OWN signing algorithm — mirrors
    # tests/test_note_sync_router.py::test_callback_expired_state_400 rather
    # than mutating the process-global `time` module.
    ts = str(int(_time.time()) - obsidian_link._CONNECT_CODE_TTL_SECONDS - 60)
    nonce = "expired-test-nonce"
    payload = f"user-a:{ts}:{nonce}"
    sig = hmac.new(
        obsidian_link._signing_secret(), payload.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    code = base64.urlsafe_b64encode(f"{payload}:{sig}".encode("utf-8")).decode("utf-8")
    with pytest.raises(errors.NoteConnAuthError):
        obsidian_link.redeem_connect_code(code, "vault-1", "My Vault")


def test_a_tampered_code_fails(env):
    code = obsidian_link.mint_connect_code("user-a")
    raw = base64.urlsafe_b64decode(code.encode("utf-8")).decode("utf-8")
    user_id, ts_str, nonce, sig = raw.split(":", 3)
    # Flip one hex character inside the SIGNATURE itself (not the payload) —
    # proves the signature check is what catches tampering.
    flipped = ("1" if sig[0] == "0" else "0") + sig[1:]
    tampered_raw = f"{user_id}:{ts_str}:{nonce}:{flipped}"
    tampered = base64.urlsafe_b64encode(tampered_raw.encode("utf-8")).decode("utf-8")
    with pytest.raises(errors.NoteConnAuthError):
        obsidian_link.redeem_connect_code(tampered, "vault-1", "My Vault")


def test_the_stored_value_is_not_the_raw_token(env):
    code = obsidian_link.mint_connect_code("user-a")
    device_id, token = obsidian_link.redeem_connect_code(code, "vault-1", "My Vault")
    conn = auth_db.get_connection()
    row = conn.execute(
        "SELECT * FROM j2_obsidian_devices WHERE id = ?", (device_id,)
    ).fetchone()
    conn.close()
    assert token not in tuple(row), "the raw token must never appear verbatim in the row"
    assert row["token_enc"] != token


def test_authenticate_device_returns_the_right_user_and_none_for_garbage(env):
    code = obsidian_link.mint_connect_code("user-a")
    device_id, token = obsidian_link.redeem_connect_code(code, "vault-1", "My Vault")

    result = obsidian_link.authenticate_device(token)
    assert result is not None
    assert result["user_id"] == "user-a"
    assert result["device_id"] == device_id
    assert result["vault_id"] == "vault-1"

    assert obsidian_link.authenticate_device("garbage") is None
    assert obsidian_link.authenticate_device("") is None
    assert obsidian_link.authenticate_device(f"{device_id}:wrong-secret") is None
    assert obsidian_link.authenticate_device("unknown-device:whatever") is None


def test_a_token_belonging_to_user_a_never_authenticates_as_user_b(env):
    code_a = obsidian_link.mint_connect_code("user-a")
    _, token_a = obsidian_link.redeem_connect_code(code_a, "vault-1", "A's Vault")
    code_b = obsidian_link.mint_connect_code("user-b")
    _, token_b = obsidian_link.redeem_connect_code(code_b, "vault-2", "B's Vault")

    result_a = obsidian_link.authenticate_device(token_a)
    result_b = obsidian_link.authenticate_device(token_b)
    assert result_a["user_id"] == "user-a"
    assert result_b["user_id"] == "user-b"

    # Cross-tenant forgery attempt: graft B's secret onto A's device_id
    # prefix. Must authenticate as NOBODY — A's stored (decrypted) secret
    # will not match B's secret.
    a_device_id = result_a["device_id"]
    b_secret = token_b.split(":", 1)[1]
    forged = f"{a_device_id}:{b_secret}"
    assert obsidian_link.authenticate_device(forged) is None


def test_reconnecting_the_same_vault_rotates_the_token_rather_than_refusing(env):
    code1 = obsidian_link.mint_connect_code("user-a")
    device_id1, token1 = obsidian_link.redeem_connect_code(code1, "vault-1", "My Vault")

    # A second connect-code redemption for the SAME (user, vault) — e.g. a
    # plugin reinstall — must not dead-end on the UNIQUE(user_id, vault_id)
    # constraint. It ROTATES the existing device row instead of refusing.
    code2 = obsidian_link.mint_connect_code("user-a")
    device_id2, token2 = obsidian_link.redeem_connect_code(code2, "vault-1", None)

    assert device_id2 == device_id1, "reconnect keeps the same device identity"
    assert token2 != token1

    # The OLD token must no longer authenticate — this is a ROTATION, not
    # an additional live credential.
    assert obsidian_link.authenticate_device(token1) is None

    result2 = obsidian_link.authenticate_device(token2)
    assert result2 is not None
    assert result2["user_id"] == "user-a"
    assert result2["label"] == "My Vault", "a None label on reconnect preserves the prior label"


def test_authenticate_device_fails_closed_on_a_non_ascii_secret_half(env):
    """`hmac.compare_digest` raises `TypeError` (never a `False` result) the
    moment either side is a `str` containing a non-ASCII character --
    confirmed directly above (not assumed): `hmac.compare_digest('short',
    b'\\xff'.decode('latin-1'))` raises. The Authorization header a real
    request carries is latin-1 decoded upstream
    (note_sync.py::_authenticate_obsidian_device), so a single raw byte
    >= 0x80 in the token's secret half reaches `authenticate_device` as a
    non-ASCII `str`. Before comparing BYTES, that TypeError propagated past
    this function's None-or-dict contract -- a malformed/malicious plugin
    push turned into a 500 on the live ingest auth path instead of the
    clean auth failure this test pins. Must fail (raise) against the
    unfixed code."""
    code = obsidian_link.mint_connect_code("user-a")
    device_id, _ = obsidian_link.redeem_connect_code(code, "vault-1", "My Vault")
    non_ascii_secret = b"\xff".decode("latin-1")
    forged = f"{device_id}:{non_ascii_secret}"
    assert obsidian_link.authenticate_device(forged) is None


def test_minting_fails_closed_with_no_signing_secret(env, monkeypatch):
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    monkeypatch.delenv("VOICE_ACTION_SECRET", raising=False)
    with pytest.raises(errors.NoteConnNotConfigured):
        obsidian_link.mint_connect_code("user-a")


def test_redeeming_fails_closed_with_no_encryption_key(env, monkeypatch):
    code = obsidian_link.mint_connect_code("user-a")
    monkeypatch.delenv("NOTE_ENCRYPTION_KEY", raising=False)
    with pytest.raises(errors.NoteConnNotConfigured):
        obsidian_link.redeem_connect_code(code, "vault-1", "My Vault")
