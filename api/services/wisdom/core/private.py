"""The owner-private store (D16a; docs/wisdom/CONTRACTS.md §0 row 7, §6.2).

WHAT LIVES HERE, AND ONLY THIS: private facts stated in the CONTENT streams —
share counts, position sizes and stated entry prices on OPEN positions (W1 §0.4d).
Nothing read from the Journal, J2, the Notebook or broker sync, ever (W1 Part 10).

THE RULES THIS MODULE HOLDS
1. A SEPARATE SQLite file, never wisdom.db: WISDOM_PRIVATE_DB_PATH (default
   /data/wisdom_private.db), resolved on every call so the conftest census pins it
   and a test's setenv reaches it. A path that resolves to wisdom.db is refused.
2. Every value is Fernet-encrypted by CryptoBox("WISDOM_PRIVATE_KEY") (retired-key
   env WISDOM_PRIVATE_KEYS_V1). With the key unset put_private returns False and
   writes NOTHING: no file, no table, no row, and never a plaintext fallback.
3. Importable only from this module, extract/writer.py and api/routers/wisdom_core.py
   (core/bans.py, rail private_store). Read back only through require_owner routes.
4. Values are never logged. A log line names the record and field, not the value.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
from typing import Any

from api.services.crypto_box import CryptoBox, CryptoBoxError
from api.services.wisdom.core import store, timeutil

log = logging.getLogger(__name__)

PrivateBox = CryptoBox("WISDOM_PRIVATE_KEY")

#: The only fields this store accepts (W1 §0.4d). A typo is an error, not a silent drop.
PRIVATE_FIELDS = frozenset({"size_shares", "position_size", "open_entry"})

#: journal-exclusion guard (ban-check): a locator into Journal/J2/Notebook/broker data is refused.
_REFUSED_LOCATOR_PREFIXES = ("j2", "journal", "notebook", "broker")  # journal-exclusion guard

_TABLE = "wisdom_private_positions"
_DDL = (
    "CREATE TABLE IF NOT EXISTS wisdom_private_positions ("
    " record_id TEXT NOT NULL,"
    " field TEXT NOT NULL,"
    " value_enc TEXT NOT NULL,"
    " source_locator TEXT NOT NULL,"
    " created_at TEXT NOT NULL,"
    " PRIMARY KEY (record_id, field))"
)

_WRITE_LOCK = threading.Lock()


def private_db_path() -> str:
    return os.environ.get("WISDOM_PRIVATE_DB_PATH", "/data/wisdom_private.db")


def is_configured() -> bool:
    """True when the encryption key is set. Nothing is stored while this is False."""
    return PrivateBox.is_configured()


def _same_file(a: str, b: str) -> bool:
    return os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


def _connect(path: str, *, for_request: bool = False) -> sqlite3.Connection:
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(path, timeout=5.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute(f"PRAGMA busy_timeout={2000 if for_request else 5000}")
    return conn


def put_private(record_id: str, field: str, value: Any, source_locator: str) -> bool:
    """Encrypt and store one private value. Returns True only when a row was written.

    Raises ValueError for a contract violation (unknown field, blank record_id or
    locator), because a mistyped field silently dropping private data is worse than a
    loud failure. Returns False, storing nothing, when the key is unset, the value is
    empty, the locator points into excluded data, or the write fails."""
    if field not in PRIVATE_FIELDS:
        raise ValueError(f"unknown private field {field!r}; allowed: {sorted(PRIVATE_FIELDS)}")
    if not isinstance(record_id, str) or not record_id.strip():
        raise ValueError("record_id must be a non-empty string")
    if not isinstance(source_locator, str) or not source_locator.strip():
        raise ValueError("source_locator must be a non-empty string")
    if source_locator.strip().lower().startswith(_REFUSED_LOCATOR_PREFIXES):
        log.error("[wisdom-private] refused %s/%s: the locator points into excluded data (W1 Part 10)",
                  record_id, field)
        return False
    if value is None or (isinstance(value, str) and not value.strip()):
        log.warning("[wisdom-private] %s/%s has no value; nothing stored", record_id, field)
        return False
    if not PrivateBox.is_configured():
        log.warning("[wisdom-private] WISDOM_PRIVATE_KEY is unset; %s/%s NOT stored (never plaintext)",
                    record_id, field)
        return False
    path = private_db_path()
    if _same_file(path, store.db_path()):
        log.error("[wisdom-private] WISDOM_PRIVATE_DB_PATH resolves to wisdom.db; %s/%s NOT stored",
                  record_id, field)
        return False
    try:
        blob = PrivateBox.encrypt(json.dumps(value, ensure_ascii=False))
    except (CryptoBoxError, TypeError, ValueError) as exc:
        log.error("[wisdom-private] could not encrypt %s/%s (%s); nothing stored",
                  record_id, field, type(exc).__name__)
        return False
    now = timeutil.iso_et(timeutil.now_et())
    with _WRITE_LOCK:
        try:
            conn = _connect(path)
        except (OSError, sqlite3.Error) as exc:
            log.error("[wisdom-private] cannot open the private store (%s); %s/%s NOT stored",
                      type(exc).__name__, record_id, field)
            return False
        try:
            conn.execute(_DDL)
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                "INSERT INTO wisdom_private_positions(record_id, field, value_enc, source_locator, created_at) "
                "VALUES (?, ?, ?, ?, ?) ON CONFLICT(record_id, field) DO UPDATE SET "
                "value_enc = excluded.value_enc, source_locator = excluded.source_locator",
                (record_id, field, blob, source_locator.strip(), now),
            )
            conn.commit()
        except sqlite3.Error as exc:
            conn.rollback()
            log.error("[wisdom-private] write failed for %s/%s (%s)", record_id, field, type(exc).__name__)
            return False
        finally:
            conn.close()
    return True


def get_private(record_id: str, *, for_request: bool = False) -> list[dict]:
    """Every private field stored for one record, decrypted.

    A row that cannot be decrypted (key unset, wrong or rotated key) comes back with
    value None and an `error`, never with its ciphertext. A store that does not exist
    yet reads as empty and is NOT created by a read."""
    path = private_db_path()
    if not os.path.exists(path):
        return []
    conn = _connect(path, for_request=for_request)
    try:
        try:
            rows = conn.execute(
                "SELECT record_id, field, value_enc, source_locator, created_at "
                "FROM wisdom_private_positions WHERE record_id = ? ORDER BY field",
                (record_id,),
            ).fetchall()
        except sqlite3.OperationalError as exc:
            if "no such table" in str(exc):
                return []
            raise
    finally:
        conn.close()
    out: list[dict] = []
    for row in rows:
        item = {
            "record_id": row["record_id"],
            "field": row["field"],
            "value": None,
            "source_locator": row["source_locator"],
            "created_at": row["created_at"],
        }
        try:
            item["value"] = json.loads(PrivateBox.decrypt(row["value_enc"]))
        except (CryptoBoxError, ValueError):
            item["error"] = "undecryptable: WISDOM_PRIVATE_KEY is unset or does not match"
        out.append(item)
    return out
