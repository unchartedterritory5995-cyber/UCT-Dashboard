"""The one home of the `Idempotency-Key` rule for saves that MAKE something (Notebook widgets
phase 2: the widget create key, rulings R-43, R-48, R-49; the routine and tracker Duplicate key,
Task 9.6b, ruling W9-R48).

A client sends `Idempotency-Key: <uuid4>` on a request that makes a new row. One key is one
request: a fresh key per new intent, the same key only to send that same unconfirmed request again
(a retry after a lost answer). The server remembers, per member, what the key made, for
`CREATE_KEY_TTL_S`:
  * the same key and the same request answers what it already made (never a second one);
  * the same key on a DIFFERENT request is refused (409 `conflict`): a key never lets one
    request return, or land on, another's row.

What lives here is only what every keyed door shares: the key's shape, the replay window and the
sweep. Each door keeps its own table and its own idea of "the same request".

⛔ ONE HOME (Task 9.6b brief: "one shared helper, never a copy"). `widget_definitions.py` on the
frontend lane's branch still carries its own `_CREATE_KEY_RE` / `clean_create_key` /
`CREATE_KEY_TTL_S` (added there in the wave 8 consolidation, after this branch forked). At the
9.20 merge it must import these instead; `tests/test_tool_create_keys.py::
test_the_uuid4_key_rule_has_one_home` goes red until it does.

⚠️ 24 h is a REPLAY window, not a retention promise (wave 8 consolidation round 2, M-5): expired
rows are deleted by the next keyed request (any member's) inside that request's own write
transaction, and every lookup runs after that delete, so an expired row is never answered. With
no keyed traffic they sit until then, or until the member's account purge removes them. A row
holds only ids and a timestamp, never member words.

This module imports nothing from the stores, so any of them can import it.
"""
from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timedelta
from typing import Any

CREATE_KEY_TTL_S = 24 * 60 * 60
_CREATE_KEY_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


def clean_create_key(raw: Any) -> str | None:
    """The key as a lowercase uuid4, or None for anything else. A malformed key is IGNORED, never
    refused: the request then behaves exactly as it did before keys existed."""
    if not isinstance(raw, str):
        return None
    key = raw.strip().lower()
    return key if _CREATE_KEY_RE.fullmatch(key) else None


def expire_keys(c: sqlite3.Connection, table: str, now_dt: datetime) -> None:
    """Inside the caller's write transaction: delete every member's key in `table` older than the
    replay window. Run it BEFORE the lookup, so an expired key is never answered. `table` is a
    module constant of the caller, never request input."""
    c.execute(f"DELETE FROM {table} WHERE created_at < ?",
              ((now_dt - timedelta(seconds=CREATE_KEY_TTL_S)).isoformat(),))
