"""Per-tour seen state, merged ON THE SERVER (wave 14, lane W14-C2).

The client keeps every registered tour's `{v, state, step}` row in ONE preference,
`notebook_tours` (app/src/pages/journal-2-0/components/notebook/onboarding/tourSeenState.js).
`POST /api/auth/preferences` replaces a preference's WHOLE value, and the client's own
read-modify-write (`setPrefMerged`) merges against THIS TAB's cache. Two tabs that each
record a different tour in the same moment therefore each post a map that lacks the
other's row, and whichever arrives last erases the other (risk R8, across tabs).

This module closes that by upserting ONE row inside ONE SQL statement:

    INSERT ... ON CONFLICT(user_id, pref_key) DO UPDATE
        SET pref_value = json_set(<stored map or {}>, '$."<tour id>"', json(<row>))

SQLite runs that statement under its write lock, so the read of the stored map and the
write of the merged one cannot interleave with another request's: two concurrent rows
both survive. A stored value that is not a JSON object (never written by the shipped
client, but the column is TEXT) is treated as `{}` -- the same rule the client's
`readToursPref` applies, so the two sides agree on what an unreadable map means.

Size cap: at most `MAX_TOURS` rows. The cap is enforced in the same statement (the
`WHERE` on the update), so it cannot be raced either; a new row past the cap changes
nothing and the caller answers 413. Rewriting an existing row is always allowed.

No work at import (the 10/02 boot lesson): no connection, no query, nothing cached.
"""
from __future__ import annotations

import json
import re
import uuid

from api.services.auth_db import get_connection

PREF_KEY = "notebook_tours"
STATES = ("started", "done", "dismissed")
#: The registry's id contract is "a unique string"; every id and step id shipped or
#: planned is kebab-case. This pattern is also what makes the JSON path below safe to
#: build: no quote, no backslash, no dot-path syntax can reach it.
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
MAX_TOURS = 64


class TooManyTours(Exception):
    """The map already holds MAX_TOURS rows and this would add one more."""


def valid_id(value) -> bool:
    return isinstance(value, str) and bool(ID_RE.match(value))


_UPSERT = """
INSERT INTO user_preferences (id, user_id, pref_key, pref_value)
VALUES (?, ?, ?, json_object(?, json(?)))
ON CONFLICT(user_id, pref_key) DO UPDATE SET pref_value = json_set(
    CASE WHEN json_valid(user_preferences.pref_value)
              AND json_type(user_preferences.pref_value) = 'object'
         THEN user_preferences.pref_value ELSE '{}' END,
    ?, json(?))
WHERE NOT (json_valid(user_preferences.pref_value)
           AND json_type(user_preferences.pref_value) = 'object')
   OR json_type(user_preferences.pref_value, ?) IS NOT NULL
   OR (SELECT count(*) FROM json_each(user_preferences.pref_value)) < ?
"""


def record(user_id: str, tour_id: str, state: str, step) -> dict:
    """Upsert one tour's row and return the WHOLE merged map as stored afterwards.

    The caller validates `tour_id`, `state` and `step` (the router answers 400); this
    function re-checks them, because the JSON path is built from `tour_id`.
    """
    if not valid_id(tour_id) or state not in STATES or not (step is None or valid_id(step)):
        raise ValueError("invalid tour row")
    row = json.dumps({"v": 1, "state": state, "step": step}, separators=(",", ":"))
    path = f'$."{tour_id}"'
    conn = get_connection()
    try:
        cur = conn.execute(_UPSERT, (str(uuid.uuid4()), user_id, PREF_KEY, tour_id, row, path, row, path, MAX_TOURS))
        changed = cur.rowcount
        conn.commit()
        stored = conn.execute(
            "SELECT pref_value FROM user_preferences WHERE user_id = ? AND pref_key = ?",
            (user_id, PREF_KEY),
        ).fetchone()
    finally:
        conn.close()
    if not changed:
        raise TooManyTours()
    try:
        value = json.loads(stored["pref_value"]) if stored else {}
    except (TypeError, ValueError):
        value = {}
    return value if isinstance(value, dict) else {}
