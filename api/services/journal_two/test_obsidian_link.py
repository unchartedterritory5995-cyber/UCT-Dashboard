"""Obsidian ingest schema. The staging table is the seam that lets a PUSH
transport reuse the PULL engine: the plugin writes here, the provider reads
here, and the engine never learns there was a difference."""
import sqlite3
from api.services.journal_two.db import ensure_schema


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
