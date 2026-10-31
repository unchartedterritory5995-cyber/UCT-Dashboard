"""Account deletion for the saved-indicator store (`user_definitions.db`).

⛔⛔ THE GAP THIS CLOSES. `journal_two.account_purge.purge_user_data` runs its SQL on the
auth.db connection it is handed. A member's saved indicators do not live there: they live in
`user_definitions.db` (`user_definitions._DB_PATH`), a second database, so naming its tables
in `_DIRECT_USER_TABLES` would have matched nothing and read as covered. Until this module a
deleted member kept every saved indicator, every version of each, their share links and their
public-library listings.

⭐ WHY THE DELETES LIVE HERE AND NOT IN `user_definitions.py`. That module's CONTENT is
append-only, and the claim is asserted by an AST walk over its own source
(`test_the_MODULE_ISSUES_NO_UPDATE_STATEMENT_and_the_scan_can_see_one`). An erasure is the one
place that rule must give way, so -- exactly as `user_definition_relint.py` does for its
measured re-lint -- the statements sit in their own file, where the exception can be read, and
the store's own connection settings, write lock and schema are IMPORTED, never re-declared.
`user_definitions.purge_user` is the door; it delegates here.

What one member's deletion does in this database:
  * DELETES every row of theirs in `MEMBER_TABLES` (the definitions with their whole version
    history -- versions are rows of `user_definitions`, there is no separate blob table --
    their share links, their library listings, and the re-lint audit rows about them).
  * KEEPS every copy another member installed from them. Those copies are separate rows under
    the INSTALLER'S user_id and belong to that member. Their `definition` JSON carries
    `origin.author_id` = the leaver's id, and that one value is SCRUBBED to `None`
    (`AUTHOR_SCRUBBED`). Nothing that computes reads `origin` -- `ast_hash`, `def_hash`,
    `result_identity` and the runtime handle are all functions of `compute` -- so the copy
    keeps drawing, evaluating and alerting exactly as before, and every key it is filed under
    is unmoved.

`purge_user_rows(user_id, conn)` is the DATABASE half and touches nothing else: it is what a
restore replays on a restored copy of this file (`account_tombstones.replay_on_user_definitions_db`).
`purge_user(user_id)` is the live half: it also drops the member's compiled alert series from
this process's memory (`alert_user_series.forget`).
"""
from __future__ import annotations

import contextlib
import json
import logging
import sqlite3
from typing import Any

log = logging.getLogger("user_definitions_erasure")

#: Every table in `user_definitions.db` that holds a member's rows, keyed by `user_id`. One
#: `DELETE ... WHERE user_id = ?` each. `tools/account_deletion_manifest.py` reads this tuple
#: by AST, and `tests/test_user_definitions_erasure.py` fails by name on a table in that
#: database with a `user_id` column that is not listed here.
MEMBER_TABLES = (
    # The definitions, and every version of each (a version is a row; a soft delete is a
    # tombstone row; there is no other store of a definition's bytes).
    "user_definitions",
    # The member's share links. A token whose author is gone must stop resolving.
    "definition_shares",
    # The member's public-library listings (the feed is read from this table).
    "definition_listings",
    # The re-lint pass's audit trail (`user_definition_relint.py`, self-ensured there): which of
    # the member's definitions it healed. Keyed by their user_id, so it leaves with them.
    "user_definition_relint_log",
)

# ⚠️ NOT IN THIS DATABASE, AND CORRECTLY NOT PURGED: `definition_evaluations` and the
# definition record are keyed by the AST HASH, with no member id -- a formula's measured
# history, shared by every member who runs the identical tree.

#: What `origin.author_id` reads on another member's copy once its author has deleted their
#: account. `None`, not a marker string: no reader treats the value as an id it can look up,
#: and a null cannot be mistaken for a member.
AUTHOR_SCRUBBED = None


def _canonical(doc: Any) -> str:
    """The exact serialisation `user_definitions.save` stores, so a scrubbed row is the bytes
    a fresh save of the same document would write (and a byte-identical re-save still appends
    nothing)."""
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def scrub_authors(user_ids, conn: sqlite3.Connection) -> int:
    """Set `origin.author_id` to `AUTHOR_SCRUBBED` on every row whose author is one of
    `user_ids`. ONE pass over the rows that carry an `author_id` at all (installed copies), so a
    sweep over every tombstone costs one scan, not one per id. Returns how many rows were
    rewritten. Raises on a database error (the caller reports it)."""
    ids = {str(u) for u in user_ids if u}
    if not ids:
        return 0
    rows = conn.execute(
        "SELECT id, definition FROM user_definitions WHERE instr(definition, '\"author_id\"') > 0"
    ).fetchall()
    scrubbed = 0
    for row_id, blob in rows:
        try:
            doc = json.loads(blob)
        except ValueError:
            continue                                       # unreadable: nothing we can place
        origin = doc.get("origin") if isinstance(doc, dict) else None
        if not isinstance(origin, dict) or origin.get("author_id") is None:
            continue
        if str(origin["author_id"]) not in ids:
            continue                                       # another author, or a mere mention
        origin["author_id"] = AUTHOR_SCRUBBED
        conn.execute("UPDATE user_definitions SET definition = ? WHERE id = ?",
                     (_canonical(doc), row_id))
        scrubbed += 1
    return scrubbed


def scrub_author(user_id: str, conn: sqlite3.Connection) -> int:
    """`scrub_authors` for one member."""
    return scrub_authors([user_id], conn)


def purge_users_rows(user_ids, conn: sqlite3.Connection) -> dict[str, Any]:
    """The DATABASE half for one or many members: delete their rows in `MEMBER_TABLES` and scrub
    their ids out of other members' copies, on `conn`, and commit. Nothing on disk, nothing in
    memory. Best effort per table -- one bad table never aborts the rest -- and every failure
    is in `errors`, never skipped silently. A table that does not exist is a counted no-op.
    Idempotent: what is already gone deletes nothing."""
    ids = sorted({str(u) for u in user_ids if u})
    errors: list[str] = []
    deleted: dict[str, int] = {t: 0 for t in MEMBER_TABLES}
    scrubbed = 0
    try:
        scrubbed = scrub_authors(ids, conn)
    except sqlite3.Error as e:
        if "no such table" not in str(e).lower():
            errors.append(f"user_definitions (author scrub): {e}")
            log.warning("user_definitions author scrub failed for %s: %s", ids, e)
    for table in MEMBER_TABLES:
        for uid in ids:
            try:
                cur = conn.execute(f"DELETE FROM {table} WHERE user_id = ?", (uid,))
                deleted[table] += cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
            except sqlite3.Error as e:
                if "no such table" in str(e).lower():
                    break
                errors.append(f"{table}: {e}")
                log.warning("user_definitions purge failed on %s for %s: %s", table, uid, e)
                break
    try:
        conn.commit()
    except sqlite3.Error as e:
        errors.append(f"commit: {e}")
    return {"ok": not errors, "rows_deleted": deleted, "authors_scrubbed": scrubbed, "errors": errors}


def purge_user_rows(user_id: str, conn: sqlite3.Connection) -> dict[str, Any]:
    """`purge_users_rows` for one member (what the live account deletion runs)."""
    return purge_users_rows([user_id], conn)


def members_in(conn: sqlite3.Connection) -> list[str]:
    """Every member id that owns a row in `MEMBER_TABLES` on `conn` (a restored copy's
    population, for a restore that could not verify it against the tombstones)."""
    out: set[str] = set()
    for table in MEMBER_TABLES:
        try:
            out.update(r[0] for r in conn.execute(f"SELECT DISTINCT user_id FROM {table}"))
        except sqlite3.Error:
            continue
    return sorted(str(u) for u in out)


#: Written beside a store that was put back WITHOUT a verified tombstone replay
#: (`tools/store_restore.py --restore ... --allow-unreplayed`, or a restore whose only tombstone
#: source was a local file or auth.db). `tombstone_sweep` reads it, replays the OFF-SITE
#: tombstones once they can be read, and retires it. Never deleted by hand.
PENDING_MARKER_SUFFIX = ".tombstone-replay-pending.json"


def purge_user(user_id: str) -> dict[str, Any]:
    """The live half: the store's own connection, under the store's own write lock, then the
    member's compiled alert series dropped from this process. Never raises; a failure is in
    `errors`."""
    from api.services import user_definitions as ud

    if not user_id:
        return {"ok": False, "rows_deleted": {}, "authors_scrubbed": 0, "user_funcs_dropped": 0,
                "errors": ["no user id"]}
    try:
        with ud._WRITE_LOCK, contextlib.closing(ud._connect()) as c:
            ud._ensure(c)
            report = purge_user_rows(str(user_id), c)
    except Exception as e:  # noqa: BLE001 -- reported to the account purge, never raised into it
        log.warning("user_definitions purge could not open its store for %s: %s", user_id, e)
        report = {"ok": False, "rows_deleted": {}, "authors_scrubbed": 0,
                  "errors": [f"{type(e).__name__}: {e}"]}
    # The alert lane's compiled closures CAPTURE the member's trees (`alert_user_series.USER_FUNCS`,
    # keyed `<user_id><sep><address>`). Memory, not a table -- but the member's formula all the same.
    dropped = 0
    try:
        from api.services import alert_user_series
        dropped = alert_user_series.forget(str(user_id))
    except Exception as e:  # noqa: BLE001
        report["errors"].append(f"alert series cache: {e}")
    report["user_funcs_dropped"] = dropped
    report["ok"] = not report["errors"]
    return report


def live_path() -> str:
    """The live store's path, as the store itself resolves it right now."""
    from api.services import user_definitions as ud
    return str(ud._DB_PATH)


@contextlib.contextmanager
def live_connection():
    """The LIVE store, through its own connection settings and under its own write lock (the
    tombstone sweep). The lock is held for the whole block: keep the block short."""
    from api.services import user_definitions as ud
    with ud._WRITE_LOCK, contextlib.closing(ud._connect()) as c:
        ud._ensure(c)
        yield c
