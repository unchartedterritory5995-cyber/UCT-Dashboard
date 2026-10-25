"""The routine and tracker Duplicate, made idempotent by the client's key (Notebook widgets
phase 2, Task 9.6b, ruling W9-R48; the design is the widget create key's, rulings R-43, R-48,
R-52, through `create_keys`).

`POST /api/j2/routines/{rid}/duplicate` and `POST /api/j2/trackers/{tid}/duplicate` read an
`Idempotency-Key: <uuid4>` header. The table `j2_tool_create_keys` remembers, per member and key,
which kind and source the request copied and which copy it made:

  * no usable key (missing or malformed): exactly the store's `duplicate`;
  * a key this member used in the last `create_keys.CREATE_KEY_TTL_S` on the SAME kind and source,
    whose copy still exists (archived counts): that copy as it reads now, plus `replayed: True`.
    Nothing is written and the count cap is not asked: no copy is made;
  * the same key on a different source or kind: `KeyReused` (409 `conflict`), nothing written;
  * a key whose copy has since been deleted: forgotten, and a new copy is made under it;
  * a refused duplicate (a foreign, unknown or built-in source, the count cap) remembers nothing.

A duplicate request has no body, so "the same request" is (kind, source id), stored as columns
rather than as a payload hash.

Two sends of one key racing: `_write` takes BEGIN IMMEDIATE before the first read, so the second
waits for the first's commit and then replays it; the (user_id, key) primary key is the backstop.
Expired keys (every member's) go in the same transaction, swept by `create_keys.expire_keys`. The
table is purged with the account (`account_purge._DIRECT_USER_TABLES`).
"""
from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any

from api.services.journal_two import create_keys
from api.services.journal_two import routines as rstore
from api.services.journal_two import trackers as tstore
from api.services.journal_two.tool_errors import ToolError
from api.services.journal_two.widget_definitions import _now, _write

_KEYS = "j2_tool_create_keys"
_STORES = {"routine": rstore, "tracker": tstore}
S_KEY_REUSED = "That copy was already asked for from another tool. Press Duplicate again."


class KeyReused(ToolError):
    """The same Idempotency-Key on a different source or kind: 409 `conflict` (as R-48)."""

    status = 409
    code = "conflict"

    def __init__(self, sentence: str = S_KEY_REUSED):
        super().__init__(sentence)


def duplicate_with_key(user_id: str, kind: str, source_id: str, *, key: Any,
                       now: datetime | None = None,
                       conn: sqlite3.Connection | None = None) -> dict:
    """The store's `duplicate` for `kind` ('routine' or 'tracker'), idempotent under `key`.
    `now` is a test seam, passed through to the store unchanged."""
    store = _STORES.get(kind)
    if store is None:
        raise ValueError(f"unknown tool kind: {kind!r}")
    k = create_keys.clean_create_key(key)
    if k is None:
        return store.duplicate(user_id, source_id, now=now, conn=conn)
    now_dt = _now(now)
    with _write(conn) as c:
        create_keys.expire_keys(c, _KEYS, now_dt)
        row = c.execute(
            f"SELECT kind, source_id, new_id FROM {_KEYS} WHERE user_id = ? AND key = ?",
            (user_id, k),
        ).fetchone()
        if row is not None:
            if row[0] != kind or row[1] != source_id:
                raise KeyReused()
            made = store.get(user_id, row[2], now=now, conn=c)
            if made is not None:
                return {**made, "replayed": True}
            c.execute(f"DELETE FROM {_KEYS} WHERE user_id = ? AND key = ?", (user_id, k))
        made = store.duplicate(user_id, source_id, now=now, conn=c)     # joins this transaction
        c.execute(
            f"INSERT INTO {_KEYS} (user_id, key, kind, source_id, new_id, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, k, kind, source_id, made["id"], now_dt.isoformat()),
        )
        return made
