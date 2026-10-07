"""Remind (FT-035's second control), built on a per-channel read-state.

lifecycle.py named why remind could not ship: "a re-notification of an unread
fire needs a read-state the member can see on every channel; only in-app has
one today." This module adds the read-state for the other channels and the
reminder that reads it.

THE RULES (each one is a test in tests/test_alert_remind.py).
  * ONE AUTHORITY PER CHANNEL. In-app read-state stays `alert_fires.read_at`
    (the bell already writes it); push / email reads live in
    `alert_fire_channel_reads`. `read_state()` merges the two -- nothing is
    written twice.
  * A READ ON ANY CHANNEL MEANS SEEN. A reminder goes only to a fire unread
    on every channel it was delivered on.
  * AT MOST ONE REMINDER PER FIRE, claimed by INSERT before anything is sent
    (`alert_fire_reminders` PRIMARY KEY), so a retry or a second worker can
    never remind twice.
  * Never for a fire that was WITHHELD (routing suspended / queue capped) or
    never delivered, and never while the predicate is suspended. The FT-036
    rule applies to the reminder exactly as to the fire.
  * The reminder goes only to channels that delivered the original `ok`.
  * Remind is set PER ALERT (`alert_predicates.remind_after_s`, nullable);
    clearing it is a write of NULL, never a delete.

DARK: `ALERT_REMIND_ENABLED` (default off, read per call). Off: routes 404 and
`remind_due` sends nothing; stored settings and reads are kept.
"""
from __future__ import annotations

import json
import os
import time
from typing import Any, Optional

from api.services.alert_taxonomy import db as _db

FLAG = "ALERT_REMIND_ENABLED"
CHANNELS = ("in_app", "push", "email")
MIN_REMIND_S = 5 * 60
MAX_REMIND_S = 7 * 86400
#: How far back the sweep looks for a fire to remind about.
LOOKBACK_S = 8 * 86400

_DDL = """
CREATE TABLE IF NOT EXISTS alert_fire_channel_reads (
    fire_id   INTEGER NOT NULL,
    channel   TEXT    NOT NULL,
    read_at   REAL    NOT NULL,
    PRIMARY KEY (fire_id, channel)
);
CREATE TABLE IF NOT EXISTS alert_fire_reminders (
    fire_id      INTEGER PRIMARY KEY,
    reminded_at  REAL NOT NULL,
    outcome      TEXT
);
"""


class RemindError(ValueError):
    pass


def is_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip() == "1"


def _conn(db_path: str | None):
    c = _db.connect(db_path)
    _db.init_db(c)
    c.executescript(_DDL)
    return c


def set_remind(user_id: str, predicate_id: str, minutes: Optional[float], *,
               db_path: str | None = None) -> Optional[dict]:
    """Set (or clear, with None) one of the member's own alerts' reminder.
    None when the predicate is not theirs (a 404, never a 403)."""
    secs = None
    if minutes is not None:
        secs = float(minutes) * 60
        if not (MIN_REMIND_S <= secs <= MAX_REMIND_S):
            raise RemindError("A reminder must be between 5 minutes and 7 days after the alert.")
    c = _conn(db_path)
    try:
        cur = c.execute("UPDATE alert_predicates SET remind_after_s = ?, updated_at = ?"
                        " WHERE id = ? AND user_id = ?",
                        (secs, time.time(), predicate_id, str(user_id)))
        c.commit()
        if cur.rowcount == 0:
            return None
        r = c.execute("SELECT id, type_id, remind_after_s FROM alert_predicates WHERE id = ?",
                      (predicate_id,)).fetchone()
        return dict(r)
    finally:
        c.close()


def mark_read(fire_id: int, user_id: str, channel: str, *, now: float | None = None,
              db_path: str | None = None) -> bool:
    """Record that the member saw this fire on `channel`. False when the fire
    is not theirs."""
    if channel not in CHANNELS:
        raise RemindError(f"channel must be one of {', '.join(CHANNELS)}")
    now = time.time() if now is None else now
    if channel == "in_app":
        from api.services.alert_taxonomy import receipts
        return receipts.mark_fire_read(int(fire_id), str(user_id), read_at=now, db_path=db_path)
    c = _conn(db_path)
    try:
        own = c.execute("SELECT 1 FROM alert_fires WHERE id = ? AND user_id = ?",
                        (int(fire_id), str(user_id))).fetchone()
        if not own:
            return False
        c.execute("INSERT OR IGNORE INTO alert_fire_channel_reads (fire_id, channel, read_at)"
                  " VALUES (?,?,?)", (int(fire_id), channel, now))
        c.commit()
        return True
    finally:
        c.close()


def read_state(fire_id: int, user_id: str, *, db_path: str | None = None) -> Optional[dict]:
    c = _conn(db_path)
    try:
        f = c.execute("SELECT read_at, delivery_channels FROM alert_fires WHERE id = ? AND user_id = ?",
                      (int(fire_id), str(user_id))).fetchone()
        if not f:
            return None
        reads = {r["channel"]: r["read_at"] for r in c.execute(
            "SELECT channel, read_at FROM alert_fire_channel_reads WHERE fire_id = ?",
            (int(fire_id),)).fetchall()}
        rem = c.execute("SELECT reminded_at, outcome FROM alert_fire_reminders WHERE fire_id = ?",
                        (int(fire_id),)).fetchone()
    finally:
        c.close()
    if f["read_at"] is not None:
        reads["in_app"] = f["read_at"]
    return {"fire_id": int(fire_id), "reads": reads, "seen": bool(reads),
            "reminded_at": rem["reminded_at"] if rem else None,
            "reminder_outcome": rem["outcome"] if rem else None}


def _delivered_ok(raw: Optional[str]) -> list[str]:
    try:
        ch = json.loads(raw) if raw else {}
    except (TypeError, ValueError):
        return []
    if not isinstance(ch, dict) or "routing" in ch or "queue" in ch:
        return []
    return [k for k, v in ch.items() if v == "ok"]


def remind_due(*, now: float | None = None, deliver=None, routing=None,
               db_path: str | None = None) -> dict[str, Any]:
    receipt = {"enabled": is_enabled(), "due": 0, "sent": 0, "suspended": 0, "errors": 0}
    if not receipt["enabled"]:
        return receipt
    now = time.time() if now is None else now
    if deliver is None:
        from api.services.watchlist_alert_service import deliver_alert_payload as deliver
    if routing is None:
        from api.services.alert_taxonomy import routing_rule
        routing = routing_rule.effective
    c = _conn(db_path)
    try:
        rows = c.execute(
            "SELECT f.id, f.user_id, f.trigger_type, f.entity_ref, f.delivery_channels"
            " FROM alert_fires f JOIN alert_predicates p ON p.id = f.predicate_id"
            " WHERE p.remind_after_s IS NOT NULL AND p.suspended_at IS NULL"
            " AND f.user_id IS NOT NULL AND f.read_at IS NULL"
            " AND f.fired_at + p.remind_after_s <= ? AND f.fired_at >= ?"
            " AND NOT EXISTS (SELECT 1 FROM alert_fire_channel_reads r WHERE r.fire_id = f.id)"
            " AND NOT EXISTS (SELECT 1 FROM alert_fire_reminders m WHERE m.fire_id = f.id)",
            (now, now - LOOKBACK_S)).fetchall()
    finally:
        c.close()
    for r in rows:
        ok_channels = _delivered_ok(r["delivery_channels"])
        if not ok_channels:
            continue
        receipt["due"] += 1
        c = _conn(db_path)
        try:
            claimed = c.execute("INSERT OR IGNORE INTO alert_fire_reminders (fire_id, reminded_at,"
                                " outcome) VALUES (?,?,?)", (r["id"], now, "claimed")).rowcount == 1
            c.commit()
        finally:
            c.close()
        if not claimed:
            continue
        outcome = "sent"
        try:
            rule = routing(r["user_id"])
            if rule is not None and rule.suspended:
                outcome = "suspended"
                receipt["suspended"] += 1
            else:
                allowed = set(ok_channels) | {"in_app"}
                if rule is not None:
                    allowed &= set(rule.channels_allowed()) | {"in_app"}
                sym = r["entity_ref"] or ""
                deliver(user_id=str(r["user_id"]), sym=sym,
                        title=f"Reminder: {sym} alert still unread",
                        message=f"Your {r['trigger_type']} alert on {sym} has not been opened yet.",
                        source="alert_reminder",
                        extra_data={"fire_id": r["id"], "research_url": f"/research/{sym}"},
                        severity="info", channels_allowed=frozenset(allowed))
                receipt["sent"] += 1
        except Exception as e:  # noqa: BLE001 -- one reminder never stops the sweep
            outcome = f"error: {type(e).__name__}"
            receipt["errors"] += 1
        c = _conn(db_path)
        try:
            c.execute("UPDATE alert_fire_reminders SET outcome = ? WHERE fire_id = ?", (outcome, r["id"]))
            c.commit()
        finally:
            c.close()
    return receipt
