"""FT-072 Spread Book (lane/o-options-remainders): a member's saved spreads.

A saved spread is a RECORD OF WHAT WAS SEEN -- its legs, the screen's session and the prices that
screen showed, a label -- never an order, never a position of record. Nothing here places, stages
or sends a trade, and nothing re-prices a saved spread as if it were held.

⛔ Table `options_spread_book` in auth.db, self-ensured here (never db.py). It has a `user_id`
   column and is in `api/services/journal_two/account_purge.py`'s direct-user tables, so it leaves
   with the account (docs/account-deletion-manifest.md is generated from that list).
⛔ At most MAX_PER_MEMBER rows per member; a save past it is refused in a sentence.
⛔ Plain blocking SQLite: callers are plain `def` routes.
"""
from __future__ import annotations

import json
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Optional

MAX_PER_MEMBER = 200
MAX_LEGS = 4
_SYM = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SCHEMA = """
CREATE TABLE IF NOT EXISTS options_spread_book (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  label TEXT NOT NULL,
  underlying TEXT NOT NULL,
  strategy TEXT NOT NULL,
  legs_json TEXT NOT NULL,
  entry_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_options_spread_book_user ON options_spread_book(user_id, created_at);
"""


class BadSpread(ValueError):
    """A save the book refuses, in a sentence."""


class Full(RuntimeError):
    pass


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(_SCHEMA)


def _conn(conn: Optional[sqlite3.Connection]):
    if conn is not None:
        return conn, False
    from api.services.auth_db import get_connection
    return get_connection(), True


def _num(v, name: str) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise BadSpread(f"{name} must be a number.") from None
    if f != f or f in (float("inf"), float("-inf")):
        raise BadSpread(f"{name} must be a number.")
    return f


def normalize(body: dict) -> dict:
    if not isinstance(body, dict):
        raise BadSpread("Send the spread as an object.")
    und = str(body.get("underlying") or "").upper().strip()
    if not _SYM.match(und):
        raise BadSpread("Name the underlying ticker.")
    strategy = str(body.get("strategy") or "").strip()[:40]
    if not strategy:
        raise BadSpread("Name the strategy.")
    label = str(body.get("label") or "").strip()[:80] or f"{und} {strategy}"
    legs_in = body.get("legs")
    if not isinstance(legs_in, list) or not 1 <= len(legs_in) <= MAX_LEGS:
        raise BadSpread(f"A spread has 1 to {MAX_LEGS} legs.")
    legs = []
    for leg in legs_in:
        if not isinstance(leg, dict):
            raise BadSpread("Each leg is an object.")
        typ = str(leg.get("type") or "").lower()
        if typ not in ("call", "put"):
            raise BadSpread("Each leg is a call or a put.")
        side = leg.get("side")
        if side not in (-2, -1, 1, 2):
            raise BadSpread("Each leg is bought (1, 2) or sold (-1, -2).")
        strike = _num(leg.get("strike"), "A strike")
        if strike <= 0:
            raise BadSpread("A strike must be above 0.")
        exp = str(leg.get("expiration") or "")
        if not _DATE.match(exp):
            raise BadSpread("Each leg needs its expiration (YYYY-MM-DD).")
        price = leg.get("price")
        legs.append({"type": typ, "side": side, "strike": strike, "expiration": exp,
                     "price": None if price is None else round(_num(price, "A leg price"), 4)})
    entry_in = body.get("entry") or {}
    if not isinstance(entry_in, dict):
        raise BadSpread("The entry is an object.")
    net = entry_in.get("net")
    session = entry_in.get("session")
    if session is not None and not _DATE.match(str(session)):
        raise BadSpread("The session is a date (YYYY-MM-DD).")
    entry = {"net": None if net is None else round(_num(net, "The net price"), 4),
             "kind": "credit" if (net is not None and float(net) < 0) else "debit",
             "session": session, "source": str(entry_in.get("source") or "")[:40] or None,
             "basis": str(entry_in.get("basis") or "")[:200] or None}
    return {"underlying": und, "strategy": strategy, "label": label, "legs": legs, "entry": entry}


def _out(row) -> dict:
    return {"id": row[0], "created_at": row[1], "label": row[2], "underlying": row[3],
            "strategy": row[4], "legs": json.loads(row[5]), "entry": json.loads(row[6])}


def list_for(user_id: str, *, conn: Optional[sqlite3.Connection] = None) -> dict:
    c, owned = _conn(conn)
    try:
        ensure_schema(c)
        rows = c.execute("SELECT id, created_at, label, underlying, strategy, legs_json, entry_json "
                         "FROM options_spread_book WHERE user_id = ? ORDER BY created_at DESC, id",
                         (str(user_id),)).fetchall()
    finally:
        if owned:
            c.close()
    return {"spreads": [_out(tuple(r)) for r in rows], "count": len(rows), "max": MAX_PER_MEMBER,
            "basis": ("A record of the spreads you saved, with the session and prices the screen showed "
                      "when you saved them. Not an order and not a position; nothing here re-prices them.")}


def save(user_id: str, body: dict, *, conn: Optional[sqlite3.Connection] = None) -> dict:
    s = normalize(body)
    c, owned = _conn(conn)
    try:
        ensure_schema(c)
        n = c.execute("SELECT COUNT(*) FROM options_spread_book WHERE user_id = ?", (str(user_id),)).fetchone()[0]
        if n >= MAX_PER_MEMBER:
            raise Full(f"The Spread Book holds at most {MAX_PER_MEMBER} spreads. Delete one to save another.")
        sid = uuid.uuid4().hex
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        c.execute("INSERT INTO options_spread_book (id, user_id, created_at, label, underlying, strategy, "
                  "legs_json, entry_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                  (sid, str(user_id), now, s["label"], s["underlying"], s["strategy"],
                   json.dumps(s["legs"]), json.dumps(s["entry"])))
        c.commit()
    finally:
        if owned:
            c.close()
    return {"id": sid, "created_at": now, **s}


def delete(user_id: str, sid: str, *, conn: Optional[sqlite3.Connection] = None) -> bool:
    """True when the caller's own spread was deleted. Not-there and not-yours read the same."""
    c, owned = _conn(conn)
    try:
        ensure_schema(c)
        cur = c.execute("DELETE FROM options_spread_book WHERE id = ? AND user_id = ?", (str(sid), str(user_id)))
        c.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            c.close()
