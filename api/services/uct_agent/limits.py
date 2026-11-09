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
One web instance is the supported scope: docs/agent/budget/SINGLE-REPLICA-SCOPE.md. Replicas are counted here only
among those sharing this file, so two on separate volumes each see one.
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
    # Dollars are already held by the ledger's reservations, so this protects the pod: each turn holds a worker
    # thread (anyio's 40 for the plain route) and a guard thread, and the rest of the site still has to answer.
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
#: How recently another replica of THIS deployment must have been seen to count as running beside this one.
REPLICA_WINDOW_S = 300.0
#: When this process began. A replica last seen before that may simply be the one this process replaced.
_STARTED_AT = time.time()
#: The refusals that mean the service cannot take a turn, not that this member sent too many: 503, not 429.
SERVICE_REASONS = ("store_unavailable", "multiple_replicas")


def lease_s() -> int:
    """The in-flight lease, never short enough to lapse between two of the guard's renewals."""
    return max(limit("UCT_AGENT_INFLIGHT_LEASE_S"), int(2 * RENEW_EVERY_S))


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
CREATE TABLE IF NOT EXISTS agent_replicas (
  deployment_id TEXT NOT NULL,
  replica_id    TEXT NOT NULL,
  seen_at       REAL NOT NULL,
  PRIMARY KEY (deployment_id, replica_id)
);
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


def _replicas_seen(c, now: float) -> int:
    """Records this replica, outside the admission transaction so a refusal cannot undo it, and counts the replicas
    of this DEPLOYMENT seen lately, and since this process started: a crash restart can bring a new id, and the dead
    replica's row must not refuse every turn for minutes. A deploy brings a new id too, so counting across deployments
    would do the same. A live replica shows up again the next time it admits a turn. 1 outside Railway.
    ⛔ Sees only replicas that share this file."""
    deployment, replica = os.environ.get("RAILWAY_DEPLOYMENT_ID"), os.environ.get("RAILWAY_REPLICA_ID")
    if not deployment or not replica:
        return 1
    c.execute("INSERT INTO agent_replicas (deployment_id, replica_id, seen_at) VALUES (?,?,?)"
              " ON CONFLICT(deployment_id, replica_id) DO UPDATE SET seen_at = excluded.seen_at", (deployment, replica, now))
    c.execute("DELETE FROM agent_replicas WHERE seen_at < ?", (now - 2 * REPLICA_WINDOW_S,))
    n = c.execute("SELECT COUNT(*) FROM agent_replicas WHERE deployment_id = ? AND seen_at >= ?",
                  (deployment, max(now - REPLICA_WINDOW_S, _STARTED_AT))).fetchone()[0]
    if n > 1:
        _alert_replicas(n)
    return int(n)


def _alert_replicas(n: int) -> None:
    """#breadth-alerts, on its own thread: admission never waits on Discord. breadth_alerts holds the cooldown."""
    def post() -> None:
        try:
            from api.services import breadth_alerts
            breadth_alerts.send("uct_agent_replicas", "UCT Agent refused paid turns: more than one web replica",
                                [f"{n} replicas of this deployment share the Agent store.",
                                 "Its limits are only supported on one replica: docs/agent/budget/SINGLE-REPLICA-SCOPE.md"])
        except Exception:  # noqa: BLE001
            log.exception("[uct-agent limits] could not post the replica alert")

    log.error("[uct-agent limits] %d web replicas share this store; paid turns are refused", n)
    threading.Thread(target=post, name="uct-agent-replica-alert", daemon=True).start()


def admit(user_id: Any, *, new_request: bool, now: float | None = None) -> str | None:
    """Admit one /turn: take the member's in-flight slot and, for a NEW member request, one place
    in each window. Returns the slot token (pass it to `done`), or raises Refused."""
    now = time.time() if now is None else now
    uid = str(user_id)
    try:
        with contextlib.closing(_connect()) as c:
            replicas = _replicas_seen(c, now)
            c.execute("BEGIN IMMEDIATE")
            try:
                if replicas > 1:
                    raise Refused("multiple_replicas", UNAVAILABLE, 60)
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
                          (token, uid, now + lease_s()))
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


def renew(user_id: Any, now: float | None = None, token: str | None = None) -> None:
    """A request still working keeps its slot: extends this member's lease. Never raises. Without this a turn slower
    than UCT_AGENT_INFLIGHT_LEASE_S (a v2 turn waiting on steps, research retrying) loses the slot while it still
    runs, and a second request is admitted beside it."""
    now = time.time() if now is None else now
    try:
        with contextlib.closing(_connect()) as c:
            if token:
                c.execute("UPDATE agent_inflight SET lease_until = ? WHERE token = ?", (now + lease_s(), token))
            else:
                c.execute("UPDATE agent_inflight SET lease_until = ? WHERE user_id = ?", (now + lease_s(), str(user_id)))
    except Exception:  # noqa: BLE001
        log.exception("[uct-agent limits] could not renew the in-flight lease")


_lingering = 0
_lingering_lock = threading.Lock()


def _count_lingering(delta: int) -> None:
    global _lingering
    with _lingering_lock:
        _lingering += delta


def lingering_workers() -> int:
    """Workers still blocked past their turn's deadline. Python cannot kill them; each ends at its capped read."""
    return _lingering


@contextlib.contextmanager
def guard(user_id: Any, token: str | None, clock):
    """Hold a turn's slot for as long as the turn runs, and no longer. A thread beside the turn renews the lease whatever the turn is doing, so a slow stage cannot lose the slot
    and let a 21st turn in. Past the deadline plus EXPIRE_GRACE_S it frees the slot and runs the clock's cleanups,
    even if the turn's own thread is stuck. A crashed process stops renewing, so its lease expires by itself. The
    cleanups run BEFORE the slot is freed, so nothing a following turn opens can be closed by this one's."""
    stop, lingered = threading.Event(), threading.Event()

    def watch() -> None:
        while not stop.wait(max(0.01, min(RENEW_EVERY_S, clock.left() + EXPIRE_GRACE_S))):
            if clock.left() + EXPIRE_GRACE_S <= 0:
                lingered.set()
                _count_lingering(1)
                log.warning("[uct-agent limits] a turn is stuck past its deadline; %d worker(s) lingering", lingering_workers())
                clock.expire(worker_stuck=True)
                done(token)
                return
            renew(user_id, token=token)

    threading.Thread(target=watch, name="uct-agent-guard", daemon=True).start()
    try:
        with call_deadline.until(clock.at):
            yield
    finally:
        stop.set()
        if clock.left() <= 0:                      # ended by the deadline, but it came back: it keeps its last word
            clock.expire()
        done(token)
        if lingered.is_set():
            _count_lingering(-1)


def _reset_for_test() -> None:
    global _lingering
    with _lingering_lock:
        _lingering = 0
    with contextlib.closing(_connect()) as c:
        c.execute("DELETE FROM agent_rate_events")
        c.execute("DELETE FROM agent_inflight")
