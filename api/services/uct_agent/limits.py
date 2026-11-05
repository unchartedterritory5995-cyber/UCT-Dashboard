"""UCT Agent rate limits for MODEL requests (Phase 0B, owner-approved provisional values 2026-10-13).

WHAT IS COUNTED (the accounting semantics, stated once):
  * A MEMBER REQUEST is one message the member sends to the model path: one POST
    /api/agent/turn (or /turn/stream) WITHOUT `reroute`. Its reroute -- the browser asking
    again with more action groups -- is the same request: not counted again here, but its
    calls count against the request's call ceiling (budget.py, 2 calls).
  * The per-member windows (20 a minute, 300 an hour) and the global window (120 a minute)
    count member requests. They are sliding windows over the request's admission time.
  * One model request IN FLIGHT per member covers every /turn, reroutes included: a second
    one while the first runs is refused with a sentence, never queued.
  * Deterministic work is never counted: fast-path chart commands, /record, breadth lookups,
    conversations and History never reach this module.

Durable and atomic: the events and the in-flight lease live in the Agent store, written in one
`BEGIN IMMEDIATE`, so two requests racing for the last slot get exactly one, and a restart does
not forget the hour. A lease left behind by a crash expires after UCT_AGENT_INFLIGHT_LEASE_S.
All values are environment-configurable (blank, 0 or garbage = the default, never "unlimited").

THE GLOBAL IN-FLIGHT LIMIT holds across every process that shares this store: the count and the insert are one
`BEGIN IMMEDIATE`. It is a real limit, so admission FAILS CLOSED on a store error: admitting without a slot
would let a busy disk run past it. This costs no availability, because the ledger (budget.py) lives in the same
store and refuses every paid call when it fails, and deterministic work never comes here.

SQLite's locking needs one local file: it does not hold across instances on separate volumes or a network share.
"""
from __future__ import annotations

import contextlib
import logging
import os
import secrets
import threading
import time
from typing import Any

from api.services import call_deadline

log = logging.getLogger(__name__)

DEFAULTS = {
    "UCT_AGENT_RATE_MEMBER_MINUTE": 20,
    "UCT_AGENT_RATE_MEMBER_HOUR": 300,
    "UCT_AGENT_RATE_GLOBAL_MINUTE": 120,
    "UCT_AGENT_INFLIGHT_PER_MEMBER": 1,
    # Half of anyio's 40 worker threads, each blocking for a turn: dollars are already held by the ledger's
    # reservations, so this protects the pod, and the threads left over keep the rest of the site answering.
    "UCT_AGENT_INFLIGHT_GLOBAL": 20,
    "UCT_AGENT_INFLIGHT_LEASE_S": 150,
}

MEMBER_RATE = "You're sending requests faster than UCT Agent can take them. Please wait a moment and try again."
GLOBAL_RATE = "UCT Agent is very busy right now. Please try again in a moment."
IN_FLIGHT = "UCT Agent is still working on your last request. Wait for it to finish, then try again."
UNAVAILABLE = "UCT Agent can't take requests right now. Nothing was sent. Please try again in a moment."

#: How often a running turn renews its lease: well inside UCT_AGENT_INFLIGHT_LEASE_S, whatever the turn is doing.
RENEW_EVERY_S = 30.0
#: How long past its deadline a turn gets to end itself, with its own sentence, before the guard cleans up for it.
EXPIRE_GRACE_S = 5.0


def limit(name: str) -> int:
    try:
        v = int(float(os.environ.get(name, "")))
    except ValueError:
        return DEFAULTS[name]
    return v if v > 0 else DEFAULTS[name]


_SCHEMA = """
CREATE TABLE IF NOT EXISTS agent_rate_events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  TEXT NOT NULL,
  at       REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_rate_at ON agent_rate_events(at);
CREATE INDEX IF NOT EXISTS idx_agent_rate_user ON agent_rate_events(user_id, at);
CREATE TABLE IF NOT EXISTS agent_inflight (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  lease_until REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_inflight_user ON agent_inflight(user_id);
"""
_READY_FOR: str | None = None


def _connect():
    global _READY_FOR
    from api.services.uct_agent import store
    conn = store._connect()
    conn.isolation_level = None
    if _READY_FOR != store._DB_PATH:
        conn.executescript(_SCHEMA)
        _READY_FOR = store._DB_PATH
    return conn


class Refused(Exception):
    def __init__(self, reason: str, sentence: str, retry_after: int):
        super().__init__(reason)
        self.reason, self.sentence, self.retry_after = reason, sentence, retry_after


def admit(user_id: Any, *, new_request: bool, now: float | None = None) -> str | None:
    """Admit one /turn: take the member's in-flight slot and, for a NEW member request, one place
    in each window. Returns the slot token (pass it to `done`), or raises Refused."""
    now = time.time() if now is None else now
    uid = str(user_id)
    try:
        with contextlib.closing(_connect()) as c:
            c.execute("BEGIN IMMEDIATE")
            try:
                c.execute("DELETE FROM agent_inflight WHERE lease_until < ?", (now,))
                busy = c.execute("SELECT COUNT(*) FROM agent_inflight WHERE user_id = ?", (uid,)).fetchone()[0]
                if busy >= limit("UCT_AGENT_INFLIGHT_PER_MEMBER"):
                    raise Refused("in_flight", IN_FLIGHT, 5)
                if c.execute("SELECT COUNT(*) FROM agent_inflight").fetchone()[0] >= limit("UCT_AGENT_INFLIGHT_GLOBAL"):
                    raise Refused("global_in_flight", GLOBAL_RATE, 10)
                if new_request:
                    c.execute("DELETE FROM agent_rate_events WHERE at < ?", (now - 3600,))
                    g = c.execute("SELECT COUNT(*) FROM agent_rate_events WHERE at >= ?", (now - 60,)).fetchone()[0]
                    if g >= limit("UCT_AGENT_RATE_GLOBAL_MINUTE"):
                        raise Refused("global_minute", GLOBAL_RATE, 10)
                    m = c.execute("SELECT COUNT(*) FROM agent_rate_events WHERE user_id = ? AND at >= ?",
                                  (uid, now - 60)).fetchone()[0]
                    if m >= limit("UCT_AGENT_RATE_MEMBER_MINUTE"):
                        oldest = c.execute("SELECT MIN(at) FROM agent_rate_events WHERE user_id = ? AND at >= ?",
                                           (uid, now - 60)).fetchone()[0]
                        raise Refused("member_minute", MEMBER_RATE, max(1, int(oldest + 60 - now) + 1))
                    h = c.execute("SELECT COUNT(*) FROM agent_rate_events WHERE user_id = ? AND at >= ?",
                                  (uid, now - 3600)).fetchone()[0]
                    if h >= limit("UCT_AGENT_RATE_MEMBER_HOUR"):
                        oldest = c.execute("SELECT MIN(at) FROM agent_rate_events WHERE user_id = ? AND at >= ?",
                                           (uid, now - 3600)).fetchone()[0]
                        raise Refused("member_hour", MEMBER_RATE, max(1, int(oldest + 3600 - now) + 1))
                    c.execute("INSERT INTO agent_rate_events (user_id, at) VALUES (?,?)", (uid, now))
                token = secrets.token_hex(8)
                c.execute("INSERT INTO agent_inflight (token, user_id, lease_until) VALUES (?,?,?)",
                          (token, uid, now + limit("UCT_AGENT_INFLIGHT_LEASE_S")))
                c.execute("COMMIT")
                return token
            except Exception:
                c.execute("ROLLBACK")
                raise
    except Refused:
        raise
    except Exception:  # noqa: BLE001 -- fail closed: see the module docstring
        log.exception("[uct-agent limits] store unavailable; request refused")
        raise Refused("store_unavailable", UNAVAILABLE, 5)


def give_back(user_id: Any, now_at: float | None = None) -> None:
    """A request refused AFTER admission for a reason that is not the member's (the daily count,
    the population cap) does not use a place in the windows: the newest event is removed."""
    try:
        with contextlib.closing(_connect()) as c:
            c.execute("DELETE FROM agent_rate_events WHERE id = (SELECT MAX(id) FROM agent_rate_events WHERE user_id = ?)",
                      (str(user_id),))
    except Exception:  # noqa: BLE001
        log.exception("[uct-agent limits] give_back failed")


def done(token: str | None) -> None:
    """Free the in-flight slot. Never raises (the lease expires by itself)."""
    if not token:
        return
    try:
        with contextlib.closing(_connect()) as c:
            c.execute("DELETE FROM agent_inflight WHERE token = ?", (token,))
    except Exception:  # noqa: BLE001
        log.exception("[uct-agent limits] could not free the in-flight slot; its lease will expire")


def renew(user_id: Any, now: float | None = None) -> None:
    """A request still working keeps its slot: extends this member's lease. Never raises. Without this a turn slower
    than UCT_AGENT_INFLIGHT_LEASE_S (a v2 turn waiting on steps, research retrying) loses the slot while it still
    runs, and a second request is admitted beside it."""
    now = time.time() if now is None else now
    try:
        with contextlib.closing(_connect()) as c:
            c.execute("UPDATE agent_inflight SET lease_until = ? WHERE user_id = ?",
                      (now + limit("UCT_AGENT_INFLIGHT_LEASE_S"), str(user_id)))
    except Exception:  # noqa: BLE001
        log.exception("[uct-agent limits] could not renew the in-flight lease")


@contextlib.contextmanager
def guard(user_id: Any, token: str | None, clock):
    """Hold a turn's slot for as long as the turn runs, and no longer. A thread beside the turn renews the lease whatever the turn is doing, so a slow stage cannot lose the slot
    and let a 21st turn in. Past the deadline plus EXPIRE_GRACE_S it frees the slot and runs the clock's cleanups,
    even if the turn's own thread is stuck. A crashed process stops renewing, so its lease expires by itself."""
    stop = threading.Event()

    def watch() -> None:
        while not stop.wait(max(0.01, min(RENEW_EVERY_S, clock.left() + EXPIRE_GRACE_S))):
            if clock.left() + EXPIRE_GRACE_S <= 0:
                log.warning("[uct-agent limits] a turn passed its deadline; cleaning up after it")
                done(token)
                clock.expire()
                return
            renew(user_id)

    threading.Thread(target=watch, name="uct-agent-guard", daemon=True).start()
    try:
        with call_deadline.until(clock.at):
            yield
    finally:
        stop.set()
        done(token)


def _reset_for_test() -> None:
    with contextlib.closing(_connect()) as c:
        c.execute("DELETE FROM agent_rate_events")
        c.execute("DELETE FROM agent_inflight")
