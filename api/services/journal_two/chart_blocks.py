"""The index of chart blocks in notes, and their frozen fingerprints (wave 13, lane 13I-1).

Two self-ensured tables in auth.db, both purged with the account
(`account_purge._DIRECT_USER_TABLES`):

  j2_chart_blocks        ONE ROW PER CHART BLOCK in a member's notes: symbol, timeframe,
                         the block's day, its setup tag and, when the note carries one, the
                         fingerprint frozen INTO the note (`ta.fingerprint`). A PROJECTION:
                         rebuilt from the note, never written into it.
  j2_chart_fingerprints  THE FREEZE LEDGER: a fingerprint computed ONCE for a block and a day
                         and never recomputed. INSERT OR IGNORE is the only write.

13I-2's visual playbook and 13J's find-similar read `list_blocks`; the routes are
`api/routers/notebook_fingerprint.py`.

⛔⛔ NOT IN THE SAVE PATH, AND NEVER A SECOND WRITER INTO NOTES (plan section 3.4, R-12).
The note's save path already maintains `j2_note_embeds` (`notes._sync_note_sidecars`), which
says which notes hold a `chart` embed. `catch_up` reads that sidecar plus each note's
`updated_at` and re-projects exactly the notes that changed since they were last projected
(the per-note watermark is `j2_chart_blocks.note_updated_at`), deletes the rows of notes
that no longer hold a chart, and freezes a bounded number of new blocks. It runs when a
member reads the index (so the index is read-your-writes) and may be run by a job; it
never runs while the flag is off, because only the gated routes call it.

⛔⛔ THE FREEZE. A block's fingerprint is computed once, from bars as of the block's day,
by `tech_fingerprint.compute`, and stored under (member, note, block, symbol, day). Nothing
updates that row: a re-projection, a re-save, a later nightly or a changed formula leaves
it as it was. A block whose symbol or day is changed is a different chart and gets its own
freeze; its old one stays in the ledger (so an undo brings the same values back). A
fingerprint that carries a READ FAILURE (`tech_fingerprint.TRANSIENT_MISSING`) is never
frozen -- it is retried -- so a transient outage cannot become a permanent "missing".
When the note itself carries `ta.fingerprint` (lane 13H-1's attr, written by the client
from the freeze), that copy travels with the note and is the one served.

Trash: a trashed note keeps its rows (the `j2_note_embeds` precedent: Restore needs no
re-projection); every read joins `j2_notes` and serves live notes only. A hard-deleted
note loses its rows and its ledger rows at the next catch-up.
"""
from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone
from typing import Any, Callable

from api.services.journal_two import tech_fingerprint
from api.services.journal_two.timeutil import ET, compute_trading_day_et

log = logging.getLogger(__name__)

#: New blocks frozen per catch-up. Each freeze is two indexed bar reads and the
#: screener functions; a member opening the index after importing a hundred old
#: charts sees the rest as `pending` and gets them over the next reads.
FREEZE_BUDGET = 10

#: Rows one list read returns at most.
LIST_LIMIT = 200

#: The widget id of a chart embed (`widgets/registry.js` `chart`; /mtf and
#: /compare insert the same widget).
CHART_WIDGET = "chart"

_DDL = (
    """CREATE TABLE IF NOT EXISTS j2_chart_blocks (
        user_id          TEXT NOT NULL,
        note_id          TEXT NOT NULL,
        embed_key        TEXT NOT NULL,
        position         INTEGER NOT NULL,
        embed_id         TEXT,
        symbol           TEXT,
        timeframe        TEXT,
        as_of            TEXT,
        setup_tag        TEXT,
        mode             TEXT,
        note_fingerprint TEXT,
        note_updated_at  TEXT NOT NULL,
        projected_at     TEXT NOT NULL,
        PRIMARY KEY (user_id, note_id, embed_key)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_j2_chart_blocks_user_symbol ON j2_chart_blocks(user_id, symbol)",
    "CREATE INDEX IF NOT EXISTS idx_j2_chart_blocks_user_tag ON j2_chart_blocks(user_id, setup_tag)",
    """CREATE TABLE IF NOT EXISTS j2_chart_fingerprints (
        user_id     TEXT NOT NULL,
        note_id     TEXT NOT NULL,
        embed_key   TEXT NOT NULL,
        symbol      TEXT NOT NULL,
        as_of       TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        version     INTEGER NOT NULL,
        frozen_at   TEXT NOT NULL,
        PRIMARY KEY (user_id, note_id, embed_key, symbol, as_of)
    )""",
)


def ensure_schema(conn: sqlite3.Connection) -> None:
    for stmt in _DDL:
        conn.execute(stmt)


def _connect() -> sqlite3.Connection:
    from api.services.auth_db import get_connection
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    return conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── reading a note: the pure part ─────────────────────────────────────────────

def _block_day(params: dict, attrs: dict) -> str | None:
    """The block's day, ET: the chart's anchor `params.to` (unix seconds -- the
    frozen right edge, `widgetEmbedCore.buildWidgetEmbedAttrs`), else the
    insert moment `capturedAt` (a rolling chart, `to: null`)."""
    to = params.get("to")
    if isinstance(to, (int, float)) and not isinstance(to, bool) and to > 0:
        secs = to / 1000.0 if to > 1e12 else float(to)
        try:
            return datetime.fromtimestamp(secs, tz=ET).date().isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    cap = attrs.get("capturedAt")
    return compute_trading_day_et(cap) if isinstance(cap, str) and cap else None


def parse_body(body_json: Any) -> Any:
    """A stored note body as a document, or None when it cannot be read. A body nested too
    deeply for the JSON parser raises RecursionError, which is not a ValueError: it is caught
    here so such a note reads as "no charts" for its owner, never as a 500 (security review
    M-4)."""
    if not isinstance(body_json, (str, bytes)):
        return body_json
    try:
        return json.loads(body_json)
    except (ValueError, RecursionError):
        return None


def iter_chart_attrs(body_json: Any) -> list[dict]:
    """The attrs of every chart `widgetEmbed` in a note body, in document order.

    ⛔ A LOOP, NEVER A RECURSION (security review M-4). The walk used to call itself once per
    level of nesting, so a very deeply nested body raised RecursionError and answered 500 for
    its owner. Children are pushed in reverse so they come off the stack in document order.
    `extract_blocks` and `visual_playbook._chart_nodes` both read THIS, so a block's
    `position` indexes the same list in both."""
    found: list[dict] = []
    stack: list[Any] = [body_json]
    while stack:
        node = stack.pop()
        if not isinstance(node, dict):
            continue
        if node.get("type") == "widgetEmbed":
            attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
            if attrs.get("widgetId") == CHART_WIDGET:
                found.append(attrs)
        children = node.get("content")
        if isinstance(children, list):
            stack.extend(reversed(children))
    return found


def extract_blocks(body_json: Any) -> list[dict]:
    """Every chart block of a note body, in document order. Pure."""
    found: list[dict] = []
    for attrs in iter_chart_attrs(body_json):
        params = attrs.get("params") if isinstance(attrs.get("params"), dict) else {}
        try:
            symbol = tech_fingerprint.normalize_symbol(params.get("symbol"))
        except tech_fingerprint.FingerprintRequestError:
            symbol = None
        ta = attrs.get("ta") if isinstance(attrs.get("ta"), dict) else {}
        tag = ta.get("setupTag")
        fp = ta.get("fingerprint")
        embed_id = attrs.get("embedId") if isinstance(attrs.get("embedId"), str) else None
        tf = params.get("tf")
        found.append({
            "embed_id": embed_id or None,
            # The legacy identity, the one citations already use for an embed
            # stored before embedId existed (widgetEmbedNode.jsx).
            "legacy_key": f"{CHART_WIDGET}|{attrs.get('capturedAt') or ''}",
            "symbol": symbol,
            "timeframe": str(tf) if tf is not None else "D",
            "as_of": _block_day(params, attrs),
            "setup_tag": tag.strip()[:80] if isinstance(tag, str) and tag.strip() else None,
            "mode": attrs.get("mode") if isinstance(attrs.get("mode"), str) else None,
            # ⛔ The note is the member's own data, so its fingerprint is CHECKED before it
            # is trusted (security review M-3). One that is not the shape `compute` writes
            # is no fingerprint: the block is then frozen from bars like any other.
            "note_fingerprint": fp if tech_fingerprint.well_formed(fp) else None,
        })
    seen: set[str] = set()
    for i, b in enumerate(found):
        key = b["embed_id"] or b["legacy_key"]
        if key in seen:                          # a pasted copy shares its source's id
            key = f"{key}#{i}"
        seen.add(key)
        b["embed_key"] = key
        b["position"] = i
    return found


# ── the projection ────────────────────────────────────────────────────────────

def project_note(conn: sqlite3.Connection, user_id: str, note_id: str,
                 body_json: Any, note_updated_at: str) -> int:
    """Rebuild one note's rows (delete, then insert) inside the caller's
    transaction. Returns the number of rows written. The body is parsed BEFORE
    the first write statement, so the write lock is never held across a parse."""
    blocks = extract_blocks(parse_body(body_json))
    conn.execute("DELETE FROM j2_chart_blocks WHERE user_id = ? AND note_id = ?", (user_id, note_id))
    now = _now()
    conn.executemany(
        "INSERT INTO j2_chart_blocks (user_id, note_id, embed_key, position, embed_id, symbol,"
        " timeframe, as_of, setup_tag, mode, note_fingerprint, note_updated_at, projected_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [(user_id, note_id, b["embed_key"], b["position"], b["embed_id"], b["symbol"],
          b["timeframe"], b["as_of"], b["setup_tag"], b["mode"],
          json.dumps(b["note_fingerprint"], separators=(",", ":")) if b["note_fingerprint"] else None,
          note_updated_at, now)
         for b in blocks])
    return len(blocks)


def _chart_notes(conn: sqlite3.Connection, user_id: str, note_id: str | None) -> dict[str, str]:
    """{note_id: updated_at} of the member's notes that hold a chart embed, per
    the save path's own sidecar."""
    sql = ("SELECT n.id AS id, n.updated_at AS updated_at FROM j2_notes n"
           " WHERE n.user_id = ? AND n.id IN (SELECT e.note_id FROM j2_note_embeds e"
           "   WHERE e.user_id = ? AND e.widget_id = ?)")
    params: list[Any] = [user_id, user_id, CHART_WIDGET]
    if note_id is not None:
        sql += " AND n.id = ?"
        params.append(note_id)
    return {r["id"]: r["updated_at"] for r in conn.execute(sql, params)}


def catch_up(user_id: str, conn: sqlite3.Connection | None = None, *,
             note_id: str | None = None, freeze_budget: int = FREEZE_BUDGET,
             compute: Callable[[str, str], dict] | None = None) -> dict:
    """Bring the member's index up to their notes (or one note), then freeze up
    to `freeze_budget` blocks that have no fingerprint yet."""
    owned = conn is None
    conn = conn or _connect()
    try:
        ensure_schema(conn)
        current = _chart_notes(conn, user_id, note_id)
        psql = ("SELECT note_id, MAX(note_updated_at) AS u FROM j2_chart_blocks WHERE user_id = ?"
                + (" AND note_id = ?" if note_id is not None else "") + " GROUP BY note_id")
        projected = {r["note_id"]: r["u"] for r in conn.execute(
            psql, (user_id, note_id) if note_id is not None else (user_id,))}
        gone = [n for n in projected if n not in current]
        stale = [n for n, u in current.items() if projected.get(n) != u]
        # ⛔ A READ WITH NOTHING STALE WRITES NOTHING, AND NO WRITE LOCK IS HELD ACROSS A
        # PARSE (security review I-3). This runs on every fingerprint and visual-playbook
        # read, on the session database, whose connections wait three seconds for a lock.
        # It used to run an unconditional DELETE and a commit on every call, and to hold
        # one transaction across every stale note. Now: each removal batch and each note
        # is its own short transaction, and each write is preceded by a read that says
        # there is something to write.
        if gone:
            for n in gone:
                conn.execute("DELETE FROM j2_chart_blocks WHERE user_id = ? AND note_id = ?", (user_id, n))
            conn.commit()
        written = 0
        for n in stale:
            r = conn.execute("SELECT body_json, updated_at FROM j2_notes WHERE id = ? AND user_id = ?",
                             (n, user_id)).fetchone()
            if r is not None:
                written += project_note(conn, user_id, n, r["body_json"], r["updated_at"])
                conn.commit()
        # The ledger of a note that no longer exists at all (hard-deleted).
        orphaned = conn.execute(
            "SELECT 1 FROM j2_chart_fingerprints WHERE user_id = ? AND note_id NOT IN"
            " (SELECT id FROM j2_notes WHERE user_id = ?) LIMIT 1", (user_id, user_id)).fetchone()
        if orphaned is not None:
            conn.execute(
                "DELETE FROM j2_chart_fingerprints WHERE user_id = ? AND note_id NOT IN"
                " (SELECT id FROM j2_notes WHERE user_id = ?)", (user_id, user_id))
            conn.commit()
        frozen = freeze_pending(user_id, conn, limit=freeze_budget, note_id=note_id, compute=compute)
        pending = _count_pending(conn, user_id, note_id)
        return {"notes_projected": len(stale), "notes_removed": len(gone), "rows_written": written,
                "frozen": frozen, "pending": pending}
    finally:
        if owned:
            conn.close()


# ── the freeze ────────────────────────────────────────────────────────────────

_PENDING_SQL = (
    " FROM j2_chart_blocks b"
    " WHERE b.user_id = ? AND b.symbol IS NOT NULL AND b.as_of IS NOT NULL"
    "   AND b.note_fingerprint IS NULL"
    "   AND NOT EXISTS (SELECT 1 FROM j2_chart_fingerprints f WHERE f.user_id = b.user_id"
    "     AND f.note_id = b.note_id AND f.embed_key = b.embed_key"
    "     AND f.symbol = b.symbol AND f.as_of = b.as_of)")


def _count_pending(conn: sqlite3.Connection, user_id: str, note_id: str | None) -> int:
    sql = "SELECT COUNT(*)" + _PENDING_SQL + (" AND b.note_id = ?" if note_id is not None else "")
    return int(conn.execute(sql, (user_id, note_id) if note_id is not None else (user_id,)).fetchone()[0])


def freeze(conn: sqlite3.Connection, user_id: str, note_id: str, embed_key: str,
           symbol: str, as_of: str, *,
           compute: Callable[[str, str], dict] | None = None) -> dict | None:
    """The frozen fingerprint for one block and day: the stored one if it exists
    (NEVER recomputed), else computed once now and stored. None when it cannot be
    frozen yet (a store could not be read); the caller retries later."""
    row = conn.execute(
        "SELECT fingerprint, frozen_at FROM j2_chart_fingerprints WHERE user_id = ? AND note_id = ?"
        " AND embed_key = ? AND symbol = ? AND as_of = ?",
        (user_id, note_id, embed_key, symbol, as_of)).fetchone()
    if row is not None:
        return {"fingerprint": json.loads(row["fingerprint"]), "frozen_at": row["frozen_at"]}
    try:
        fp = (compute or tech_fingerprint.compute)(symbol, as_of)
    except Exception:                                   # noqa: BLE001 -- retried at the next catch-up
        log.warning("[chart_blocks] fingerprint not computable for %s %s", symbol, as_of, exc_info=True)
        return None
    if tech_fingerprint.has_transient_gap(fp):
        return None
    now = _now()
    conn.execute(
        "INSERT OR IGNORE INTO j2_chart_fingerprints (user_id, note_id, embed_key, symbol, as_of,"
        " fingerprint, version, frozen_at) VALUES (?,?,?,?,?,?,?,?)",
        (user_id, note_id, embed_key, symbol, as_of, json.dumps(fp, separators=(",", ":")),
         int(fp.get("v") or tech_fingerprint.FINGERPRINT_VERSION), now))
    conn.commit()
    # Re-read: a concurrent freeze of the same block won, and ITS row is the frozen one.
    row = conn.execute(
        "SELECT fingerprint, frozen_at FROM j2_chart_fingerprints WHERE user_id = ? AND note_id = ?"
        " AND embed_key = ? AND symbol = ? AND as_of = ?",
        (user_id, note_id, embed_key, symbol, as_of)).fetchone()
    return {"fingerprint": json.loads(row["fingerprint"]), "frozen_at": row["frozen_at"]}


def freeze_pending(user_id: str, conn: sqlite3.Connection, *, limit: int = FREEZE_BUDGET,
                   note_id: str | None = None,
                   compute: Callable[[str, str], dict] | None = None) -> int:
    if limit <= 0:
        return 0
    sql = ("SELECT b.note_id, b.embed_key, b.symbol, b.as_of" + _PENDING_SQL
           + (" AND b.note_id = ?" if note_id is not None else "")
           + " ORDER BY b.projected_at, b.note_id, b.position LIMIT ?")
    params = (user_id, note_id, limit) if note_id is not None else (user_id, limit)
    done = 0
    for r in conn.execute(sql, params).fetchall():
        if freeze(conn, user_id, r["note_id"], r["embed_key"], r["symbol"], r["as_of"],
                  compute=compute) is not None:
            done += 1
    return done


# ── reads ─────────────────────────────────────────────────────────────────────

def _stored_fp(raw: Any) -> dict | None:
    """A fingerprint column as a dict, or None when it is empty, unreadable or not a dict."""
    if not raw:
        return None
    try:
        fp = json.loads(raw)
    except (ValueError, RecursionError):
        return None
    return fp if isinstance(fp, dict) else None


def _shape(r: sqlite3.Row) -> dict:
    note_fp = _stored_fp(r["note_fingerprint"])
    ledger_fp = _stored_fp(r["ledger_fingerprint"])
    if note_fp is not None:
        fp, source, frozen_at = note_fp, "note", None
    elif ledger_fp is not None:
        fp, source, frozen_at = ledger_fp, "ledger", r["frozen_at"]
    else:
        fp, source, frozen_at = None, None, None
    return {
        "noteId": r["note_id"],
        "noteTitle": r["title"],
        "embedKey": r["embed_key"],
        "embedId": r["embed_id"],
        "position": r["position"],
        "symbol": r["symbol"],
        "timeframe": r["timeframe"],
        "asOf": r["as_of"],
        "setupTag": r["setup_tag"],
        "mode": r["mode"],
        "fingerprint": fp,
        "fingerprintSource": source,
        "frozenAt": frozen_at,
        "values": tech_fingerprint.summary_values(fp) if fp else None,
    }


_LIST_SQL = (
    "SELECT b.*, n.title AS title, f.fingerprint AS ledger_fingerprint, f.frozen_at AS frozen_at"
    " FROM j2_chart_blocks b"
    " JOIN j2_notes n ON n.id = b.note_id AND n.user_id = b.user_id AND n.deleted_at IS NULL"
    " LEFT JOIN j2_chart_fingerprints f ON f.user_id = b.user_id AND f.note_id = b.note_id"
    "   AND f.embed_key = b.embed_key AND f.symbol = b.symbol AND f.as_of = b.as_of"
    " WHERE b.user_id = ?")


def list_blocks(user_id: str, conn: sqlite3.Connection | None = None, *,
                symbol: str | None = None, setup_tag: str | None = None,
                note_id: str | None = None, limit: int = LIST_LIMIT) -> list[dict]:
    """The member's live chart blocks, newest day first."""
    owned = conn is None
    conn = conn or _connect()
    try:
        ensure_schema(conn)
        sql, params = _LIST_SQL, [user_id]
        if symbol:
            sql += " AND b.symbol = ?"
            params.append(tech_fingerprint.normalize_symbol(symbol))
        if setup_tag:
            sql += " AND b.setup_tag = ?"
            params.append(setup_tag)
        if note_id:
            sql += " AND b.note_id = ?"
            params.append(note_id)
        sql += " ORDER BY b.as_of DESC, b.note_id, b.position LIMIT ?"
        params.append(max(1, min(int(limit), LIST_LIMIT)))
        return [_shape(r) for r in conn.execute(sql, params)]
    finally:
        if owned:
            conn.close()


def get_block(user_id: str, note_id: str, embed_key: str,
              conn: sqlite3.Connection | None = None) -> dict | None:
    owned = conn is None
    conn = conn or _connect()
    try:
        ensure_schema(conn)
        r = conn.execute(_LIST_SQL + " AND b.note_id = ? AND b.embed_key = ?",
                         (user_id, note_id, embed_key)).fetchone()
        return _shape(r) if r is not None else None
    finally:
        if owned:
            conn.close()
