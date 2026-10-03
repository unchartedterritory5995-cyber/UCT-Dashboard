"""One global routing rule per member, with suspend (FT-036, Bloomberg MRUL).

A member says, once, where their S7 alerts go -- email on/off, push on/off,
webhook on/off -- and can SUSPEND every alert without losing a single
definition. This is the per-USER half of SPEC-S7 §5.5's routing design; the
per-trigger-type override table (`alert_routing_prefs`) stays deferred.

THE RULES.
  * ⛔ SUSPEND NEVER DELETES AND NEVER STOPS EVALUATION. Predicates keep their
    rows, sweeps keep running, and every fire is still RECORDED in
    `alert_fires` (the durable S7 record) -- suspend only withholds the
    notification, and the fire carries `{"routing": "suspended"}` as its
    delivery outcome so "it fired while you were suspended" stays answerable.
    Resume is one write; nothing has to be rebuilt.
  * The in-app record is not routable: it is the member's own copy of the
    alert, and `deliver_alert_payload` re-sends when zero channels report OK.
  * DARK: `ALERT_ROUTING_RULE_ENABLED` (default off, read per call). Off,
    `effective()` answers None and delivery is byte-identical to before --
    a stored rule is kept, never applied, never deleted.
  * A missing row is the default rule (everything on, not suspended).

Stored in `alert_taxonomy.db` beside the fires it governs.
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, asdict
from typing import Optional

from api.services.alert_taxonomy import db as _db

FLAG = "ALERT_ROUTING_RULE_ENABLED"
ROUTABLE = ("email", "push", "webhook")

_DDL = """
CREATE TABLE IF NOT EXISTS alert_routing_rule (
    user_id       TEXT PRIMARY KEY,
    email         INTEGER NOT NULL DEFAULT 1,
    push          INTEGER NOT NULL DEFAULT 1,
    webhook       INTEGER NOT NULL DEFAULT 1,
    suspended_at  REAL,
    updated_at    REAL NOT NULL
);
"""


def is_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip() == "1"


@dataclass
class Rule:
    email: bool = True
    push: bool = True
    webhook: bool = True
    suspended_at: Optional[float] = None

    @property
    def suspended(self) -> bool:
        return self.suspended_at is not None

    def channels_allowed(self) -> frozenset:
        return frozenset(c for c in ROUTABLE if getattr(self, c))

    def as_dict(self) -> dict:
        return {**asdict(self), "suspended": self.suspended}


def _conn(db_path: str | None):
    c = _db.connect(db_path)
    _db.init_db(c)
    c.executescript(_DDL)
    return c


def get(user_id: str, *, db_path: str | None = None) -> Rule:
    c = _conn(db_path)
    try:
        r = c.execute("SELECT * FROM alert_routing_rule WHERE user_id = ?", (str(user_id),)).fetchone()
    finally:
        c.close()
    if not r:
        return Rule()
    return Rule(bool(r["email"]), bool(r["push"]), bool(r["webhook"]), r["suspended_at"])


def _upsert(user_id: str, rule: Rule, db_path: str | None) -> Rule:
    c = _conn(db_path)
    try:
        c.execute(
            "INSERT INTO alert_routing_rule (user_id, email, push, webhook, suspended_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET"
            " email=excluded.email, push=excluded.push, webhook=excluded.webhook,"
            " suspended_at=excluded.suspended_at, updated_at=excluded.updated_at",
            (str(user_id), int(rule.email), int(rule.push), int(rule.webhook),
             rule.suspended_at, time.time()))
        c.commit()
    finally:
        c.close()
    return rule


def set_channels(user_id: str, *, email: bool | None = None, push: bool | None = None,
                 webhook: bool | None = None, db_path: str | None = None) -> Rule:
    rule = get(user_id, db_path=db_path)
    if email is not None:
        rule.email = bool(email)
    if push is not None:
        rule.push = bool(push)
    if webhook is not None:
        rule.webhook = bool(webhook)
    return _upsert(user_id, rule, db_path)


def suspend(user_id: str, *, db_path: str | None = None) -> Rule:
    rule = get(user_id, db_path=db_path)
    if rule.suspended_at is None:
        rule.suspended_at = time.time()
    return _upsert(user_id, rule, db_path)


def resume(user_id: str, *, db_path: str | None = None) -> Rule:
    rule = get(user_id, db_path=db_path)
    rule.suspended_at = None
    return _upsert(user_id, rule, db_path)


def effective(user_id: str, *, db_path: str | None = None) -> Optional[Rule]:
    """The rule delivery must honour, or None while the surface is dark (and
    on any store error -- a routing lookup that fails must not cost the member
    the alert, so it fails to the pre-routing behaviour)."""
    if not is_enabled() or not user_id:
        return None
    try:
        return get(user_id, db_path=db_path)
    except Exception:  # noqa: BLE001
        return None
