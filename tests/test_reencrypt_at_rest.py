"""tools/reencrypt_at_rest.py -- the at-rest key-rotation re-encrypt tool.

Rows are written by the PRODUCT writers where they accept a connection/path
(save_broker_user, upsert_connector, outbound_webhooks.create) into DBs built
from the PRODUCT DDL (_J2_SCHEMA, totp _SCHEMA, alert_taxonomy init_db), so the
inventory is tested against the tables the app really writes -- not a copy.
"""

from __future__ import annotations

import hashlib
import pathlib
import re
import sqlite3

import pytest
from cryptography.fernet import Fernet

from api.services import crypto_box
from tools import reencrypt_at_rest as tool

REPO = pathlib.Path(__file__).resolve().parents[1]

ENV = ("BROKER_ENCRYPTION_KEY", "BROKER_ENCRYPTION_KEYS_V1", "BROKER_ENCRYPTION_KEYS_V2",
       "BROKER_ENCRYPTION_ACTIVE_VERSION", "NOTE_ENCRYPTION_KEY", "NOTE_ENCRYPTION_KEYS_V1",
       "NOTE_ENCRYPTION_KEYS_V2", "NOTE_ENCRYPTION_ACTIVE_VERSION")


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for n in ENV:
        monkeypatch.delenv(n, raising=False)


# ── fixtures: real schema, real writers ─────────────────────────────────────

def _build_auth_db(path: pathlib.Path) -> None:
    from api.services import totp_service
    from api.services.journal_two import db as j2db
    c = sqlite3.connect(path)
    c.executescript(j2db._J2_SCHEMA)
    c.executescript(totp_service._SCHEMA)
    c.commit()
    c.close()


def _row_conn(path):
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    return c


SECRETS = {
    "broker": [f"snaptrade-secret-{i}" for i in range(3)],
    "totp": [f"JBSWY3DPEHPK3PX{i}" for i in range(2)],
    "webhook": None,  # minted by the product writer
    "note": [{"graphToken": f"roam-{i}", "graphName": "g"} for i in range(2)],
    "obsidian": [f"obs-secret-{i}" for i in range(2)],
}


@pytest.fixture
def world(tmp_path, monkeypatch):
    """auth.db + alert_taxonomy.db populated under the OLD keys (v1)."""
    from api.services.alert_taxonomy import db as atdb
    from api.services.alert_taxonomy import outbound_webhooks as owh
    from api.services.journal_two.broker import connections as bconn
    from api.services.journal_two.note_connectors import connections as nconn

    old_b, old_n = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    new_b, new_n = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", old_b)
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", old_n)

    auth = tmp_path / "auth.db"
    _build_auth_db(auth)
    c = _row_conn(auth)
    for i, s in enumerate(SECRETS["broker"]):
        bconn.save_broker_user(f"u{i}", f"snap-{i}", s, conn=c)
    for i, s in enumerate(SECRETS["totp"]):
        c.execute("INSERT INTO user_totp (user_id, secret_encrypted, enabled, last_used_step, "
                  "created_at) VALUES (?, ?, 1, 0, 'x')", (f"u{i}", crypto_box.encrypt(s)))
    for i, tok in enumerate(SECRETS["note"]):
        nconn.upsert_connector(f"u{i}", "roam", tok, conn=c)
    for i, s in enumerate(SECRETS["obsidian"]):
        c.execute("INSERT INTO j2_obsidian_devices (id, user_id, vault_id, token_enc, label, "
                  "created_at) VALUES (?, ?, ?, ?, NULL, 'x')",
                  (f"dev{i}", f"u{i}", f"vault{i}", crypto_box.NoteBox.encrypt(s)))
    c.commit()
    c.close()

    at = tmp_path / "alert_taxonomy.db"
    atdb.init_db(db_path=str(at)).close()
    minted = [owh.create(f"u{i}", "https://hooks.example.com/x", db_path=str(at),
                         resolver=lambda h: ["93.184.216.34"])["secret"] for i in range(2)]

    return {"auth": str(auth), "at": str(at), "old_b": old_b, "old_n": old_n,
            "new_b": new_b, "new_n": new_n, "webhook_secrets": minted}


def _rotate(monkeypatch, w, family):
    if family == "broker":
        monkeypatch.setenv("BROKER_ENCRYPTION_KEYS_V1", w["old_b"])
        monkeypatch.setenv("BROKER_ENCRYPTION_KEY", w["new_b"])
        monkeypatch.setenv("BROKER_ENCRYPTION_ACTIVE_VERSION", "v2")
    else:
        monkeypatch.setenv("NOTE_ENCRYPTION_KEYS_V1", w["old_n"])
        monkeypatch.setenv("NOTE_ENCRYPTION_KEY", w["new_n"])
        monkeypatch.setenv("NOTE_ENCRYPTION_ACTIVE_VERSION", "v2")


def _digest(*paths) -> str:
    """Hash of every row of every table: proves 'nothing changed'."""
    h = hashlib.sha256()
    for p in paths:
        c = sqlite3.connect(p)
        for (t,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
            h.update(t.encode())
            for row in sorted(repr(r) for r in c.execute(f'SELECT * FROM "{t}"')):
                h.update(row.encode())
        c.close()
    return h.hexdigest()


def _values(path, table, col):
    c = sqlite3.connect(path)
    try:
        return [r[0] for r in c.execute(f'SELECT "{col}" FROM "{table}" ORDER BY rowid')]
    finally:
        c.close()


def _broker_args(w, *extra):
    return ["--family", "broker", "--db", w["auth"], "--db", w["at"], *extra]


def _note_args(w, *extra):
    return ["--family", "note", "--db", w["auth"], *extra]


# ── dry run ─────────────────────────────────────────────────────────────────

def test_dry_run_is_default_and_changes_nothing(world, monkeypatch, capsys):
    _rotate(monkeypatch, world, "broker")
    before = _digest(world["auth"], world["at"])
    assert tool.main(_broker_args(world)) == 0
    out = capsys.readouterr().out
    assert _digest(world["auth"], world["at"]) == before
    assert "dry run: nothing written" in out
    assert "to-convert=7 failures=0 unknown-columns=0" in out   # 3 broker + 2 totp + 2 webhooks


def test_dry_run_never_prints_secrets_or_keys(world, monkeypatch, capsys):
    _rotate(monkeypatch, world, "broker")
    tool.main(_broker_args(world))
    tool.main(_broker_args(world, "--apply"))
    out = capsys.readouterr().out
    for s in SECRETS["broker"] + SECRETS["totp"] + world["webhook_secrets"]:
        assert s not in out
    for k in (world["old_b"], world["new_b"]):
        assert k not in out
    assert "gAAAAA" not in out


# ── apply ───────────────────────────────────────────────────────────────────

def test_apply_converts_everything_and_values_roundtrip(world, monkeypatch, capsys):
    from api.services.journal_two.broker import connections as bconn
    _rotate(monkeypatch, world, "broker")
    note_before = _values(world["auth"], "j2_note_connectors", "token_enc")

    assert tool.main(_broker_args(world, "--apply")) == 0
    out = capsys.readouterr().out
    assert "post-apply: rewritten=7 still-to-convert=0 active-failures=0" in out

    for table, col in (("j2_broker_users", "user_secret_enc"), ("user_totp", "secret_encrypted")):
        assert all(v.startswith("v2:") for v in _values(world["auth"], table, col))
    assert all(v.startswith("v2:") for v in _values(world["at"], "alert_webhooks", "secret_enc"))

    # The product readers get the identical plaintext back...
    c = _row_conn(world["auth"])
    assert [bconn.get_broker_user(f"u{i}", conn=c)["userSecret"] for i in range(3)] == SECRETS["broker"]
    c.close()
    assert [crypto_box.decrypt(v) for v in _values(world["auth"], "user_totp", "secret_encrypted")] \
        == SECRETS["totp"]
    assert [crypto_box.decrypt(v) for v in _values(world["at"], "alert_webhooks", "secret_enc")] \
        == world["webhook_secrets"]
    # ...even once the OLD key is gone (the point of re-encrypting).
    monkeypatch.delenv("BROKER_ENCRYPTION_KEYS_V1")
    assert [crypto_box.decrypt(v) for v in _values(world["auth"], "j2_broker_users",
                                                    "user_secret_enc")] == SECRETS["broker"]
    # The other family was not touched.
    assert _values(world["auth"], "j2_note_connectors", "token_enc") == note_before


def test_note_family_apply(world, monkeypatch):
    from api.services.journal_two.note_connectors import connections as nconn
    from api.services.journal_two.note_connectors import obsidian_link  # noqa: F401
    _rotate(monkeypatch, world, "note")
    broker_before = _values(world["auth"], "j2_broker_users", "user_secret_enc")
    assert tool.main(_note_args(world, "--apply")) == 0
    monkeypatch.delenv("NOTE_ENCRYPTION_KEYS_V1")
    c = _row_conn(world["auth"])
    assert [nconn.get_token(f"u{i}", "roam", conn=c) for i in range(2)] == SECRETS["note"]
    c.close()
    assert [crypto_box.NoteBox.decrypt(v) for v in
            _values(world["auth"], "j2_obsidian_devices", "token_enc")] == SECRETS["obsidian"]
    assert _values(world["auth"], "j2_broker_users", "user_secret_enc") == broker_before


def test_apply_is_idempotent(world, monkeypatch, capsys):
    _rotate(monkeypatch, world, "broker")
    assert tool.main(_broker_args(world, "--apply")) == 0
    after_first = _digest(world["auth"], world["at"])
    capsys.readouterr()
    assert tool.main(_broker_args(world, "--apply")) == 0
    assert "nothing to convert (already on the active version): no-op" in capsys.readouterr().out
    assert _digest(world["auth"], world["at"]) == after_first


# ── refusals ────────────────────────────────────────────────────────────────

def test_abort_on_undecryptable_row_with_zero_writes(world, monkeypatch, capsys):
    _rotate(monkeypatch, world, "broker")
    # One v1 row minted under a key nobody has (the LAST table scanned, so a
    # tool that wrote as it scanned would already have written the others).
    stray = "v1:" + Fernet(Fernet.generate_key()).encrypt(b"lost").decode()
    c = sqlite3.connect(world["at"])
    c.execute("UPDATE alert_webhooks SET secret_enc = ? WHERE rowid = 2", (stray,))
    c.commit()
    c.close()
    before = _digest(world["auth"], world["at"])

    code = tool.main(_broker_args(world, "--apply"))
    # Zero writes FIRST: this is the property; the messages are secondary.
    assert _digest(world["auth"], world["at"]) == before, "rows were written before the abort"
    assert all(v.startswith("v1:") for v in _values(world["auth"], "j2_broker_users",
                                                    "user_secret_enc"))
    assert code == 3
    out = capsys.readouterr().out
    assert "FAIL rowid=2: decrypt failed" in out
    assert "nothing was written" in out


def test_abort_when_v1_key_missing(world, monkeypatch, capsys):
    _rotate(monkeypatch, world, "broker")
    monkeypatch.delenv("BROKER_ENCRYPTION_KEYS_V1")
    before = _digest(world["auth"], world["at"])
    assert tool.main(_broker_args(world, "--apply")) == 3
    assert "no key configured for v1" in capsys.readouterr().out
    assert _digest(world["auth"], world["at"]) == before


def test_refuses_when_new_key_equals_old_key(world, monkeypatch, capsys):
    monkeypatch.setenv("BROKER_ENCRYPTION_KEYS_V1", world["old_b"])
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", world["old_b"])          # "rotated" to the leaked key
    monkeypatch.setenv("BROKER_ENCRYPTION_ACTIVE_VERSION", "v2")
    before = _digest(world["auth"], world["at"])
    assert tool.main(_broker_args(world, "--apply")) == 2
    assert "SAME key" in capsys.readouterr().out
    assert _digest(world["auth"], world["at"]) == before


def test_refuses_apply_when_rotation_not_configured(world, monkeypatch, capsys):
    monkeypatch.setenv("BROKER_ENCRYPTION_KEYS_V1", world["old_b"])
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", world["new_b"])          # ACTIVE_VERSION forgotten
    before = _digest(world["auth"], world["at"])
    assert tool.main(_broker_args(world, "--apply")) == 2
    assert "rotation is not configured" in capsys.readouterr().out
    assert _digest(world["auth"], world["at"]) == before


def test_census_flags_uninventoried_ciphertext_column(world, monkeypatch, capsys):
    _rotate(monkeypatch, world, "broker")
    c = sqlite3.connect(world["auth"])
    c.execute("CREATE TABLE mystery (x TEXT)")
    c.execute("INSERT INTO mystery VALUES (?)", (crypto_box.encrypt("hidden"),))
    c.commit()
    c.close()
    before = _digest(world["auth"], world["at"])
    assert tool.main(_broker_args(world, "--apply")) == 4
    assert "mystery.x holds 1" in capsys.readouterr().out
    assert _digest(world["auth"], world["at"]) == before


def test_census_is_clean_on_the_real_schema(world):
    """No false positives on the product schema: only inventoried columns hold tokens."""
    assert tool.census([world["auth"], world["at"]]) == []


def test_apply_refuses_when_an_inventoried_table_is_in_no_db(world, monkeypatch, capsys):
    """Pointing at only auth.db for the broker family would silently skip the
    webhook secrets -- refuse instead."""
    _rotate(monkeypatch, world, "broker")
    before = _digest(world["auth"], world["at"])
    assert tool.main(["--family", "broker", "--db", world["auth"], "--apply"]) == 5
    assert "alert_webhooks.secret_enc was not found in ANY" in capsys.readouterr().out
    assert _digest(world["auth"], world["at"]) == before
    assert tool.main(["--family", "broker", "--db", world["auth"], "--apply",
                      "--allow-missing-tables"]) == 0


def test_missing_db_is_an_error_and_is_not_created(tmp_path, monkeypatch):
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    p = tmp_path / "nope.db"
    assert tool.main(["--family", "broker", "--db", str(p)]) == 5
    assert not p.exists()


# ── the inventory is complete ───────────────────────────────────────────────

# Every place in product code that calls encrypt on a crypto_box family.
_ENCRYPT_CALL = re.compile(r"\b(crypto_box|NoteBox|PrivateBox|BrokerBox)\.encrypt\(")
# Call sites that do NOT persist (round-trip self-tests). Anything else must
# be in tool.INVENTORY.
_NON_PERSISTING = {"tools/snaptrade_smoke_test.py"}


def test_every_encrypt_call_site_is_in_the_inventory():
    found: set[str] = set()
    for p in list((REPO / "api").rglob("*.py")) + list((REPO / "tools").glob("*.py")) \
            + list((REPO / "scripts").rglob("*.py")):
        rel = p.relative_to(REPO).as_posix()
        if "/test_" in "/" + rel or rel.startswith("tests/") or p.name.startswith("test_"):
            continue
        if rel in ("api/services/crypto_box.py", "tools/reencrypt_at_rest.py"):
            continue
        for i, line in enumerate(p.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if _ENCRYPT_CALL.search(line) and not line.lstrip().startswith("#"):
                found.add(f"{rel}:{i}")
    inventoried = {c.written_by.split(" ")[0] for c in tool.INVENTORY}
    missing = {f for f in found if f not in inventoried and f.split(":")[0] not in _NON_PERSISTING}
    assert not missing, f"encrypt call sites not in tools/reencrypt_at_rest.INVENTORY: {missing}"
    stale = {i for i in inventoried if i not in found}
    assert not stale, f"INVENTORY points at lines that no longer encrypt: {stale}"


def test_no_other_cryptobox_family_exists():
    found = []
    for p in (REPO / "api").rglob("*.py"):
        if p.name.startswith("test_"):
            continue
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.search(r'CryptoBox\(\s*(["\'])?([A-Z_]+)?', line)
            if m and not line.lstrip().startswith(("#", "class ")) and "`" not in line:
                found.append(m.group(2) or "_ACTIVE_ENV")
    assert sorted(set(found)) == ["NOTE_ENCRYPTION_KEY", "WISDOM_PRIVATE_KEY", "_ACTIVE_ENV"]
    assert {c.family for c in tool.INVENTORY} == set(tool.FAMILIES)


def test_inventory_columns_exist_in_product_ddl(world):
    from api.services import wisdom  # noqa: F401
    from api.services.wisdom.core import private
    c = sqlite3.connect(":memory:")
    c.execute(private._DDL)
    dbs = {"auth": world["auth"], "alert_taxonomy": world["at"]}
    for col in tool.INVENTORY:
        conn = sqlite3.connect(dbs[col.db]) if col.db in dbs else c
        cols = [r[1] for r in conn.execute(f'PRAGMA table_info("{col.table}")')]
        assert col.column in cols, f"{col.table}.{col.column} not in product DDL"
