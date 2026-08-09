"""Append-only fired-alert history — and the FIRE-ONCE KEY ITSELF.

Invariants (enforced HERE, not in callers — `signature/ledger.py` precedent):

- A FIRE is INSERT-only: its key, its value and its time are written once and
  there is no path in this module that rewrites any of them.
- ``UNIQUE(alert_id, fire_key)`` — a cycle that runs five times over one bar
  records ONE fire. And the INSERT is not bookkeeping BESIDE the decision, it
  **IS** the decision: `indicator_alert_service.record_trigger` reports a
  delivery if and only if this insert landed a new row.
- ⭐ THE UPDATES ARE THE DELIVERY LEASE, not corrections to history.
  `claim_delivery` is a compare-and-set that moves `delivered_at` NULL → a
  timestamp, exactly once, atomically, in the database. That is what makes
  *"`deliver_alert_payload` reaches a member exactly once per recorded fire"* a
  fact SQLite enforces rather than a sentence two functions agree on. A history
  that records twice and delivers once is a reporting bug; a history that
  records once and delivers twice is the failure that reaches the user, and it
  is the one this column makes unreachable.
- 🔴 AND THE LEASE CAN NOW BE HANDED BACK, BECAUSE IT RUNS BEFORE THE CHANNELS.
  A one-way claim recorded a FAILED delivery as a delivery that happened —
  measured with every channel raising: **20 fires → 20/20 rows stamped
  `delivered_at`, zero retry, one log line**. `release_delivery` is the inverse
  compare-and-set, reachable only from the frame that won the claim and only
  when nothing was sent, bounded by `MAX_DELIVERY_ATTEMPTS`, and it records
  `delivery_failed_at` so the failure is VISIBLE whether or not it is retried.
  Moving the claim AFTER the channels would have been the smaller diff and it is
  wrong: it trades a silent drop for a silent duplicate.
- ``False`` means EXACTLY ONE thing: already recorded. Here that is stricter
  than in the signal ledger, not looser — False also means *do not deliver*, so
  a dropped write reported as a duplicate would not merely mis-report history,
  it would **silence the alert for the rest of its armed episode**. Every other
  integrity failure re-raises.
- Validation happens BEFORE anything touches the database, so a refused fire
  leaves no trace — not even a created file. Every refusal is a ``ValueError``.

⭐ WHY THIS MODULE EXISTS AT ALL — THE DEFECT IT CLOSES. `above`/`below` are
LEVEL conditions (`current > threshold`, with no reference to `prev`), and
`record_trigger` used to bump a counter and never deactivate. So an armed alert
re-delivered **every 60-second poll while the condition stayed true** — bell,
email and Discord each time. Task 6 priced it: `above`/`below` are 373,748 of
the 388,808 fires the closed-bar cutover removes, 96.1 %. It has never reached a
member because prod's `indicator_alerts` table has zero rows; it becomes live
the moment somebody arms one.

⛔ THE KEY IS NOT ALWAYS THE BAR, AND THAT IS DELIBERATE. Two condition families
need two different answers to "when may this fire again", and the difference is
a property OF THE CONDITION, not a preference:

  * a **level** condition (`above`, `below`, `touch_upper`, `touch_lower`) is
    true CONTINUOUSLY while the level holds. Firing once per bar would still be
    a stream of identical alerts. It fires once per ARMED EPISODE and re-arms
    when the condition is observed false — `ep:<arm_epoch>`.
  * a **cross** condition (`cross_above`, `cross_below`, `cross_zero`) is
    already an edge: it is true only at a transition. Keying it on the episode
    would swallow a real second crossing — `cross_zero` up on bar *i* and down
    on bar *i+1* is one `s[i] > 0` away from reachable, and there is no
    non-crossing bar in between to re-arm on. It fires once per BAR —
    `bar:<bar_time>` — which is exactly the "five cycles over one bar" dedup.

`CONDITION_KIND` is DATA, and `tests/test_alert_fired_log.py` derives the set of
conditions `alert_conditions.check_condition` actually handles from its own
source and asserts the table covers all of them. A table only checking what
somebody remembered to list is a LIST, not a rail — that is how the four `dpc`
constants rode uncovered for the entire life of the constants rule.

⚠️ `bar_time` IS ``None`` ON THE LIVE LANE TODAY. `ALERT_EVAL_MODE` is
`"forming"`, `_evaluate_one` returns `(value, triggered)` and there is no bar to
key on, so a cross condition falls back to the episode key. That is safe on that
lane and it is provable: with `prev = last_value`, `cross_above` cannot be true
on two consecutive polls (it needs `prev <= threshold < current`, and the poll
that fires writes `current` back as the next `prev`). It is pinned by
`test_a_cross_cannot_be_true_on_two_consecutive_forming_cycles`. The moment
Task 8 flips the lane, `_evaluate_one_closed` already returns `bar_index` and
the cycle should pass the bar's `t` here — the seam is the `bar_time` keyword
and it is the only change that lane needs from this module.
"""
from __future__ import annotations

import contextlib
import json
import math
import os
import sqlite3
import threading
import time
from typing import Any, Optional

# SQLite's INTEGER is signed 64-bit; past it the driver raises OverflowError.
_INT64_LIMIT = 2 ** 63

_WRITE_LOCK = threading.Lock()
_INIT_LOCK = threading.Lock()
# Keyed on the RESOLVED PATH, never a bare bool: the tests point the alert store
# at a fresh tmp file per test, and a process-wide "already initialised" flag
# would skip creating the table in every DB after the first.
_INITED: set[str] = set()


# ⭐ THE RE-ARM RULE, AS DATA. See the module docstring for why there are two.
CONDITION_KIND: dict[str, str] = {
    "above": "level",
    "below": "level",
    "touch_upper": "level",
    "touch_lower": "level",
    "cross_above": "edge",
    "cross_below": "edge",
    "cross_zero": "edge",
}

KIND_LEVEL = "level"
KIND_EDGE = "edge"


# ⭐ HOW MANY TIMES ONE RECORDED FIRE MAY BE ATTEMPTED BEFORE THE LANE GIVES UP
# LOUDLY. Bounded on purpose: an unbounded retry against a provider that is
# refusing us is the thing that keeps us refused, and a fire whose bar is an hour
# old is not worth sending anyway. At the ceiling the claim is NOT released, so
# the row can never be sent again — it just stops pretending it was.
MAX_DELIVERY_ATTEMPTS = 3

# ─── RETENTION ───────────────────────────────────────────────────────────────
# This table lives in **auth.db** — the universal request-path database, already
# 109.8 MB on prod — at 119.4 bytes/row measured. A level condition can fire at
# most once per two cycles, so the worst case is 30 rows/hour/alert ≈ 31 MB per
# alert per year, and there was no prune anywhere.
#
# ⛔ THE SWEEP MAY NOT TOUCH THE EVIDENCE THIS TASK EXISTS TO CREATE. It deletes
# only rows that are BOTH delivered AND carry no `delivery_failed_at`; a pending
# (undelivered, retryable) fire and a terminal failure are both kept forever,
# because a defect whose only record has been swept is a defect nobody can report.
FIRE_RETENTION_DAYS = 90
KEEP_FIRES_PER_ALERT = 50
_FIRE_PRUNE_EVERY_SEC = 6 * 3600
_last_fire_prune_at: float = 0.0
_PRUNE_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS indicator_alert_fires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  sym TEXT NOT NULL,
  indicator TEXT NOT NULL,
  condition TEXT NOT NULL,
  tf TEXT NOT NULL,
  fire_key TEXT NOT NULL,
  bar_time INTEGER,
  value REAL NOT NULL,
  threshold REAL,
  fired_at REAL NOT NULL,
  delivered_at REAL,
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  delivery_failed_at REAL,
  delivery_error TEXT,
  delivery_channels TEXT,
  channels_failed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(alert_id, fire_key)
);
CREATE INDEX IF NOT EXISTS idx_alert_fires_user ON indicator_alert_fires(user_id, fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_fires_alert ON indicator_alert_fires(alert_id, id DESC);
"""

# Added by ALTER as well as by CREATE, because `CREATE TABLE IF NOT EXISTS` is a
# no-op on a box that already has the table — which is every box after the first
# deploy that ran this module.
_MIGRATIONS: tuple[tuple[str, str], ...] = (
    ("delivered_at",
     "ALTER TABLE indicator_alert_fires ADD COLUMN delivered_at REAL"),
    ("delivery_attempts",
     "ALTER TABLE indicator_alert_fires ADD COLUMN delivery_attempts "
     "INTEGER NOT NULL DEFAULT 0"),
    ("delivery_failed_at",
     "ALTER TABLE indicator_alert_fires ADD COLUMN delivery_failed_at REAL"),
    ("delivery_error",
     "ALTER TABLE indicator_alert_fires ADD COLUMN delivery_error TEXT"),
    ("delivery_channels",
     "ALTER TABLE indicator_alert_fires ADD COLUMN delivery_channels TEXT"),
    ("channels_failed",
     "ALTER TABLE indicator_alert_fires ADD COLUMN channels_failed "
     "INTEGER NOT NULL DEFAULT 0"),
)

_COLS = ("id, alert_id, user_id, sym, indicator, condition, tf, fire_key, "
         "bar_time, value, threshold, fired_at, delivered_at, "
         "delivery_attempts, delivery_failed_at, delivery_error, "
         "delivery_channels, channels_failed")


def db_path() -> str:
    """The history lives in the SAME database as the alerts it keys on.

    Resolved through `indicator_alert_service` AT CALL TIME rather than from a
    second `os.environ` read at import. A fired log pointing at a different file
    than the alert rows is a history of nothing, and the two would drift apart
    the first time anything (a test, a runbook, a local dev box) moved one and
    not the other.
    """
    from api.services import indicator_alert_service as ias
    return ias.db_path()


def _connect() -> sqlite3.Connection:
    c = sqlite3.connect(db_path(), timeout=10.0)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=2000")
    return c


def init_schema() -> None:
    """Create the fires table. Idempotent; called by `ias.init_schema()`."""
    path = db_path()
    parent = os.path.dirname(os.path.abspath(path))
    if parent and not os.path.isdir(parent):
        os.makedirs(parent, exist_ok=True)
    with contextlib.closing(_connect()) as c:
        c.executescript(_SCHEMA)
        have = {r[1] for r in c.execute("PRAGMA table_info(indicator_alert_fires)")}
        for col, ddl in _MIGRATIONS:
            if col not in have:
                c.execute(ddl)
        c.commit()
    with _INIT_LOCK:
        _INITED.add(path)


def _ensure_init() -> None:
    """Lazy create-on-first-use, keyed on the resolved path.

    Lazy because the READ path is not gated by anything: a store whose schema is
    only created by a startup hook 500s every reader on a box where that hook
    has not run (wire/store.py, prod 2026-07-31).
    """
    path = db_path()
    if path in _INITED:
        return
    with _INIT_LOCK:
        if path in _INITED:
            return
    init_schema()


# ─── the key ─────────────────────────────────────────────────────────────────

def condition_kind(condition: Optional[str]) -> str:
    """`"level"` or `"edge"` for a condition.

    ⚠️ AN UNKNOWN CONDITION IS TREATED AS A LEVEL, WHICH IS THE QUIETEST ANSWER,
    and it is deliberately not a raise. This runs on the delivery path inside a
    cycle that must survive one bad row, and `check_condition` already returns
    False for a condition it does not know — so an unknown condition can never
    reach here from the evaluator at all. The totality rail in
    `tests/test_alert_fired_log.py` is what keeps that true as conditions are
    added; this branch is the behaviour if it ever is not.
    """
    return CONDITION_KIND.get(condition or "", KIND_LEVEL)


def fire_key(condition: Optional[str], bar_time: Any, arm_epoch: int) -> str:
    """The identity of ONE fire — the thing `UNIQUE(alert_id, fire_key)` dedups.

    `bar:<t>` for a cross condition that knows its bar; `ep:<n>` otherwise. See
    the module docstring: the two families genuinely need different answers, and
    a single answer is wrong for one of them in a direction a user cannot see.
    """
    if condition_kind(condition) == KIND_EDGE and bar_time is not None:
        return f"bar:{_norm_bar_time(bar_time)}"
    return f"ep:{int(arm_epoch or 0)}"


def _norm_bar_time(bar_time: Any) -> int:
    """One bar → one integer key.

    The bars store hands daily/weekly/monthly timestamps as YYYYMMDD ints and
    intraday ones as unix seconds; both are already unambiguous integers. An ISO
    string is reduced to YYYYMMDD, the same normalisation `signature/ledger.py`
    performs and for the same reason: a key that spells one session two ways
    breaks fire-once silently.
    """
    if isinstance(bar_time, str) and "-" in bar_time:
        head = bar_time.strip()[:10]
        parts = head.split("-")
        try:
            y, m, d = (int(p) for p in parts)
        except (ValueError, TypeError) as exc:
            raise ValueError(f"unparseable bar_time: {bar_time!r}") from exc
        return y * 10_000 + m * 100 + d
    try:
        n = int(float(bar_time))
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"unparseable bar_time: {bar_time!r}") from exc
    if not -_INT64_LIMIT <= n < _INT64_LIMIT:
        raise ValueError(f"bar_time out of range for INTEGER: {bar_time!r}")
    return n


# ─── the write ───────────────────────────────────────────────────────────────

_TEXT_FIELDS = ("user_id", "sym", "indicator", "condition", "tf", "fire_key")


def record_fire(alert_id: int, user_id: str, sym: str, indicator: str,
                condition: str, tf: str, key: str, value: float, *,
                bar_time: Any = None, threshold: Optional[float] = None,
                fired_at: Optional[float] = None) -> bool:
    """Record ONE fire. **True = a new fire (DELIVER). False = already recorded.**

    ⛔ ONLY the UNIQUE collision may become False. A NOT NULL failure swallowed
    as a duplicate is the one lie this store cannot survive, and it is worse here
    than in the signal ledger: the caller reads False as "stay quiet", so the
    lie would not merely lose a row, it would mute a member's alert for the rest
    of its armed episode and nothing anywhere would say so.
    """
    try:
        aid = int(alert_id)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"alert_id must be an int, got {alert_id!r}") from exc
    if aid <= 0:
        raise ValueError(f"alert_id must be a positive int, got {alert_id!r}")

    for name, val in zip(_TEXT_FIELDS,
                         (user_id, sym, indicator, condition, tf, key)):
        if not isinstance(val, str) or not val:
            raise ValueError(f"{name} must be a non-empty str, got {val!r}")

    try:
        v = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"unusable value: {value!r}") from exc
    if not math.isfinite(v):
        # A NaN cannot be corrected later (INSERT-only) and breaks
        # json.dumps(allow_nan=False) for every future read of the whole list.
        raise ValueError(f"non-finite value: {value!r}")

    thr: Optional[float] = None
    if threshold is not None:
        try:
            thr = float(threshold)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"unusable threshold: {threshold!r}") from exc
        if not math.isfinite(thr):
            raise ValueError(f"non-finite threshold: {threshold!r}")

    bt = None if bar_time is None else _norm_bar_time(bar_time)
    at = time.time() if fired_at is None else float(fired_at)
    if not math.isfinite(at):
        raise ValueError(f"non-finite fired_at: {fired_at!r}")

    _ensure_init()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        try:
            c.execute(
                "INSERT INTO indicator_alert_fires"
                " (alert_id, user_id, sym, indicator, condition, tf, fire_key,"
                "  bar_time, value, threshold, fired_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (aid, str(user_id), sym.upper(), indicator, condition, tf,
                 key, bt, v, thr, at),
            )
            c.commit()
            landed = True
        except sqlite3.IntegrityError as exc:
            if "UNIQUE constraint failed" not in str(exc):
                raise
            landed = False
    # Retention rides the write that causes the growth — outside `_WRITE_LOCK`,
    # throttled to once per 6 h, and structurally unable to raise into a fire.
    if landed:
        _maybe_prune_fires()
    return landed


# ─── the reads ───────────────────────────────────────────────────────────────

def pending_fire_id(alert_id: int) -> Optional[int]:
    """The id of the fire `claim_delivery` WOULD claim next, or None.

    Read BEFORE the claim by the dispatching frame, so that when the dispatch
    fails the frame can release **the exact row it caused to be claimed** rather
    than "whatever is newest now" — the difference between an inverse
    compare-and-set and a guess.
    """
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT id FROM indicator_alert_fires"
            " WHERE alert_id=? AND delivered_at IS NULL"
            " ORDER BY id DESC LIMIT 1",
            (int(alert_id),),
        ).fetchone()
    return None if row is None else int(row[0])


def claim_delivery(alert_id: int, *, delivered_at: Optional[float] = None) -> bool:
    """⭐ THE EXACTLY-ONCE DELIVERY LEASE. True iff THIS call owns a delivery.

    An atomic compare-and-set on the NEWEST fire of this alert that has not been
    delivered: one `UPDATE … WHERE delivered_at IS NULL`, and the winner is
    whoever SQLite says changed a row. Two callers cannot both win, a restart
    cannot lose the fact, and there is no in-process flag anywhere that a second
    web instance would duplicate (`CLAUDE.md`'s single-process warning names
    exactly that class of guard). **That property is unchanged and is the reason
    nothing here can double-send.**

    🔴 WHAT CHANGED, AND THE DEFECT IT CLOSES. The claim used to be ONE-WAY, and
    it runs BEFORE the channels — so a delivery that then failed was recorded as
    a delivery that happened. Measured with every channel raising: **20 fires →
    20/20 rows stamped `delivered_at`, zero retry, one `_logger.warning` line.**
    There is no rate limiter anywhere in this lane, so the first Resend or
    Discord 429 silently converts real alerts into "delivered" rows the member
    never received, and the alert then sits in state `fired` until the condition
    is observed false.

    ⛔ THE OBVIOUS FIX — MOVING THE CLAIM AFTER THE CHANNELS — IS WRONG AND WAS
    NOT TAKEN. It trades a silent drop for a silent DUPLICATE: two cycles (or two
    instances) would both find the row unclaimed and both send. The claim stays
    exactly where it is and exactly as atomic; what it gains is an INVERSE, which
    only the frame that won the claim may use, and only when nothing was sent.

    So `delivered_at` now means *"this fire is claimed, and absent a
    `delivery_failed_at` it was delivered"*, and there are exactly three states:

      * `delivered_at IS NULL`                       — pending / released, deliverable
      * `delivered_at` set, `delivery_failed_at` NULL — delivered
      * both set                                     — gave up after
                                                       `MAX_DELIVERY_ATTEMPTS`;
                                                       latched shut forever, and
                                                       VISIBLE as a failure

    `delivery_attempts` is bumped in the SAME atomic UPDATE as the claim, so an
    attempt is counted even if the process dies mid-delivery — the count is what
    bounds the retries and it cannot be lost by a crash. The claim also CLEARS
    any previous `delivery_failed_at`/`delivery_error`, so "both columns set" is
    unambiguously the terminal state and never the residue of a retry that
    later succeeded.

    ⚠️ `ORDER BY id DESC` — the NEWEST undelivered fire, which is the one
    `record_trigger` just recorded.

    Returns False when this alert has no undelivered fire — which is precisely
    the case where `record_trigger` refused to record one (a duplicate for the
    armed episode, or a snoozed alert).
    """
    _ensure_init()
    at = time.time() if delivered_at is None else float(delivered_at)
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(
            "UPDATE indicator_alert_fires"
            "   SET delivered_at=?,"
            "       delivery_attempts=delivery_attempts+1,"
            "       delivery_failed_at=NULL,"
            "       delivery_error=NULL"
            " WHERE id = ("
            "  SELECT id FROM indicator_alert_fires"
            "   WHERE alert_id=? AND delivered_at IS NULL"
            "   ORDER BY id DESC LIMIT 1)",
            (at, int(alert_id)),
        )
        c.commit()
        return cur.rowcount == 1


def release_delivery(fire_id: Optional[int], *, error: str = "",
                     failed_at: Optional[float] = None) -> dict:
    """⭐ THE INVERSE OF THE CLAIM. Hand back a lease whose delivery did NOT land.

    Returns ``{"released", "terminal", "attempts", "found"}``.

    ⛔ WHY THIS CANNOT DOUBLE-SEND — three independent reasons, in the order they
    apply:

    1. **It is reachable only from the frame that won the claim**, and only when
       that frame observed the dispatch NOT complete. A retry can therefore only
       re-send something that was never sent. `_dispatch_delivery` passes the
       `fire_id` it read BEFORE the claim, so it can only ever release the row
       its own dispatch caused to be claimed.
    2. **It is itself an atomic compare-and-set**, in the other direction:
       `WHERE id=? AND delivered_at IS NOT NULL`. A second caller finds the row
       already released and changes nothing (`released: False`), so two frames
       cannot manufacture two deliverable rows out of one fire.
    3. **It is bounded.** Past `MAX_DELIVERY_ATTEMPTS` the lease is NOT handed
       back: the row keeps `delivered_at` — so `claim_delivery` can never select
       it again — and gains `delivery_failed_at`, which is what makes the
       give-up visible instead of silent. A permanently-refusing provider
       therefore costs at most `MAX_DELIVERY_ATTEMPTS` attempts per fire, and
       never a duplicate.

    An `error` string is stored verbatim (truncated) because "it failed" without
    "how" is the same warning line this defect already had.
    """
    if fire_id is None:
        return {"released": False, "terminal": False, "attempts": 0, "found": False}
    _ensure_init()
    at = time.time() if failed_at is None else float(failed_at)
    msg = (str(error) or "delivery failed")[:500]
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT delivered_at, delivery_attempts FROM indicator_alert_fires"
            " WHERE id=?", (int(fire_id),)).fetchone()
        if row is None:
            c.commit()
            return {"released": False, "terminal": False, "attempts": 0,
                    "found": False}
        attempts = int(row[1] or 0)
        if row[0] is None:
            # Already released (or never claimed) — nothing to hand back, and
            # nothing was sent. Recording the reason is still worth doing.
            c.execute(
                "UPDATE indicator_alert_fires"
                "   SET delivery_failed_at=?, delivery_error=? WHERE id=?",
                (at, msg, int(fire_id)))
            c.commit()
            return {"released": False, "terminal": False, "attempts": attempts,
                    "found": True}
        terminal = attempts >= MAX_DELIVERY_ATTEMPTS
        if terminal:
            cur = c.execute(
                "UPDATE indicator_alert_fires"
                "   SET delivery_failed_at=?, delivery_error=?"
                " WHERE id=? AND delivered_at IS NOT NULL",
                (at, msg, int(fire_id)))
        else:
            cur = c.execute(
                "UPDATE indicator_alert_fires"
                "   SET delivered_at=NULL, delivery_failed_at=?, delivery_error=?"
                " WHERE id=? AND delivered_at IS NOT NULL",
                (at, msg, int(fire_id)))
        c.commit()
        changed = cur.rowcount == 1
    return {"released": bool(changed and not terminal), "terminal": terminal,
            "attempts": attempts, "found": True}


def record_delivery_channels(fire_id: Optional[int], channels: Any) -> bool:
    """⭐ WHICH CHANNELS REACHED THE MEMBER, ON THE ROW THAT CLAIMS THEY DID.

    `delivered_at` answers *"was this fire delivered"* with one bit, and one bit
    cannot hold the common case: in-app landed, the email bounced. Recorded that
    way, a partial failure is a delivery — which is the same lie as the total
    failure this module already closed, one size smaller and far more frequent.

    ⛔ ONE WRITER, TWO COLUMNS, AND THE INTEGER IS DERIVED FROM THE MAP HERE.
    There is deliberately no way to set `channels_failed` independently: a count
    a caller could pass would be a second authority over the same fact, and the
    reader would have no way to know which of the two lied. The column exists
    only so the failure READS (`delivery_failures`, `delivery_health`) can filter
    in SQL without depending on a JSON extension being compiled in.

    ⚠️ NOT PART OF THE FIRE-ONCE KEY, AND NOT A CORRECTION TO HISTORY. It is
    delivery bookkeeping, exactly like `delivered_at`/`delivery_attempts`, and it
    is written by the frame that owns the lease.

    Returns True iff a row was updated. `None`/unusable input is a no-op — this
    is bookkeeping and it may never be the thing that raises into a delivery.
    """
    if fire_id is None or not isinstance(channels, dict):
        return False
    failed = sum(1 for v in channels.values() if v == "failed")
    try:
        blob = json.dumps(channels, sort_keys=True)
    except (TypeError, ValueError):
        return False
    _ensure_init()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(
            "UPDATE indicator_alert_fires"
            "   SET delivery_channels=?, channels_failed=? WHERE id=?",
            (blob, int(failed), int(fire_id)))
        c.commit()
    return cur.rowcount == 1


# ⭐ WHAT "A DELIVERY WENT WRONG" MEANS, AS ONE SQL PREDICATE, IN ONE PLACE.
# Two different shapes of the same event: nothing landed at all
# (`delivery_failed_at`, written by the release path), or something landed and
# something did not (`channels_failed`, written by the channel record). A read
# that filtered on only the first would show a clean board while members were
# missing every email — which is the exact silence this task exists to end.
_TROUBLE_SQL = "(delivery_failed_at IS NOT NULL OR channels_failed > 0)"


def delivery_failures(limit: int = 50, alert_id: Optional[int] = None,
                      user_id: Optional[str] = None) -> list[dict]:
    """Every fire whose delivery is known to have gone wrong, newest first.

    ⭐ THE "VISIBLE" HALF. A releasable claim alone is not enough: a released row
    is indistinguishable from one that was never claimed, so the failure would be
    retried and — if it kept failing until the ceiling — end up latched shut with
    nothing anywhere saying a member missed an alert. This is the read that says
    so, and `delivery_health()` is its summary.

    ⚠️ `user_id` IS THE SCOPE THE MEMBER-FACING ROUTE NEEDS. Without it the only
    honest surface for this read would be an admin one, and the person who
    actually missed the alert is the member.

    ⚠️ ORDERED ON `id DESC` ALONE. It used to lead with `delivery_failed_at`,
    which is NULL on every partial failure — those rows would all sort together
    at one end regardless of when they happened.
    """
    _ensure_init()
    n = max(1, min(int(limit), 500))
    sql = f"SELECT {_COLS} FROM indicator_alert_fires WHERE {_TROUBLE_SQL}"
    args: list = []
    if alert_id is not None:
        sql += " AND alert_id=?"
        args.append(int(alert_id))
    if user_id is not None:
        sql += " AND user_id=?"
        args.append(str(user_id))
    sql += " ORDER BY id DESC LIMIT ?"
    with contextlib.closing(_connect()) as c:
        rows = c.execute(sql, tuple(args) + (n,)).fetchall()
    return [_row(r) for r in rows]


def delivery_health(alert_id: Optional[int] = None,
                    user_id: Optional[str] = None) -> dict:
    """Counts for the delivery states, including the PARTIAL one.

    ⚠️ `delivered` AND `partial` ARE DISJOINT, and `partial` is not a subset of
    `failed`. A partially-delivered fire keeps `delivered_at` (something DID
    reach the member, so re-sending it would duplicate) and carries no
    `delivery_failed_at` (the lease was never handed back) — so before this
    column existed it was counted, correctly by the old vocabulary and falsely by
    any human reading it, as a clean delivery.
    """
    _ensure_init()
    clauses: list[str] = []
    args: tuple = ()
    if alert_id is not None:
        clauses.append("alert_id=?")
        args += (int(alert_id),)
    if user_id is not None:
        clauses.append("user_id=?")
        args += (str(user_id),)
    with contextlib.closing(_connect()) as c:
        def one(extra: str) -> int:
            parts = clauses + ([extra] if extra else [])
            sql = "SELECT COUNT(*) FROM indicator_alert_fires"
            if parts:
                sql += " WHERE " + " AND ".join(parts)
            return int(c.execute(sql, args).fetchone()[0])
        return {
            "fires": one(""),
            "pending": one("delivered_at IS NULL"),
            "delivered": one("delivered_at IS NOT NULL AND delivery_failed_at IS NULL"
                             " AND channels_failed = 0"),
            "partial": one("delivered_at IS NOT NULL AND delivery_failed_at IS NULL"
                           " AND channels_failed > 0"),
            "failed": one("delivery_failed_at IS NOT NULL"),
            "gave_up": one("delivered_at IS NOT NULL AND delivery_failed_at IS NOT NULL"),
            "trouble": one(_TROUBLE_SQL),
            "max_attempts": MAX_DELIVERY_ATTEMPTS,
        }


def _row(r: tuple) -> dict:
    return {
        "id": r[0], "alert_id": r[1], "user_id": r[2], "sym": r[3],
        "indicator": r[4], "condition": r[5], "tf": r[6], "fire_key": r[7],
        "bar_time": r[8], "value": r[9], "threshold": r[10], "fired_at": r[11],
        "delivered_at": r[12], "delivery_attempts": r[13],
        "delivery_failed_at": r[14], "delivery_error": r[15],
        # ⭐ DECODED HERE, ONCE. Every reader — the route, the bell, a runbook —
        # gets the map; nobody re-parses the column and nobody has to know it is
        # stored as JSON. An unreadable value reads as "no report", never as an
        # empty (i.e. clean) delivery.
        "delivery_channels": _decode_channels(r[16]),
        "channels_failed": int(r[17] or 0),
    }


def _decode_channels(raw: Any) -> Optional[dict]:
    if not raw:
        return None
    try:
        out = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return out if isinstance(out, dict) else None


def list_fires(user_id: str, limit: int = 50) -> list[dict]:
    """One user's fired history, newest first.

    `id DESC` is a load-bearing tiebreak, not decoration: `time.time()` is coarse
    enough (notably on Windows) that a cycle recording several fires stamps them
    identically, and ordering on `fired_at` alone would let the list reshuffle
    itself between two reads of the same rows.
    """
    _ensure_init()
    n = max(1, min(int(limit), 500))
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            f"SELECT {_COLS} FROM indicator_alert_fires WHERE user_id=? "
            "ORDER BY fired_at DESC, id DESC LIMIT ?",
            (str(user_id), n),
        ).fetchall()
    return [_row(r) for r in rows]


def fires_for_alert(alert_id: int, limit: int = 50) -> list[dict]:
    _ensure_init()
    n = max(1, min(int(limit), 500))
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            f"SELECT {_COLS} FROM indicator_alert_fires WHERE alert_id=? "
            "ORDER BY id DESC LIMIT ?",
            (int(alert_id), n),
        ).fetchall()
    return [_row(r) for r in rows]


def latency_samples(limit: int = 500,
                    user_id: Optional[str] = None) -> list[dict]:
    """The raw material for an OBSERVED latency: `(tf, bar_time, fired_at)`.

    ⭐ BOTH HALVES HAVE BEEN STORED ON EVERY ROW SINCE `dd2da6f7` and nothing
    ever subtracted them. `GET /api/indicator-alerts/latency` asserted a bound
    derived from two constants, so the platform could not detect its own latency
    regression — a stated number that cannot be wrong is not a measurement.

    ⚠️ ROWS WITH NO `bar_time` ARE NOT RETURNED. There is nothing to measure
    from and inventing a zero is exactly the fabrication this endpoint had.
    """
    _ensure_init()
    n = max(1, min(int(limit), 5000))
    sql = ("SELECT tf, bar_time, fired_at FROM indicator_alert_fires "
           "WHERE bar_time IS NOT NULL")
    args: tuple = ()
    if user_id is not None:
        sql += " AND user_id=?"
        args = (str(user_id),)
    sql += " ORDER BY id DESC LIMIT ?"
    with contextlib.closing(_connect()) as c:
        rows = c.execute(sql, args + (n,)).fetchall()
    return [{"tf": r[0], "bar_time": r[1], "fired_at": r[2]} for r in rows]


def count_fires(alert_id: Optional[int] = None) -> int:
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        if alert_id is None:
            return int(c.execute(
                "SELECT COUNT(*) FROM indicator_alert_fires").fetchone()[0])
        return int(c.execute(
            "SELECT COUNT(*) FROM indicator_alert_fires WHERE alert_id=?",
            (int(alert_id),)).fetchone()[0])


def count_delivered(alert_id: Optional[int] = None) -> int:
    """How many recorded fires actually reached a member.

    ⚠️ `delivery_failed_at IS NULL` IS LOAD-BEARING, NOT TIDINESS. A fire that
    exhausted `MAX_DELIVERY_ATTEMPTS` keeps `delivered_at` set (that is what
    latches it shut so it can never be sent again) — counting it here would
    reproduce, in the metric, exactly the lie this task removed from the row.
    """
    _ensure_init()
    sql = ("SELECT COUNT(*) FROM indicator_alert_fires "
           "WHERE delivered_at IS NOT NULL AND delivery_failed_at IS NULL")
    args: tuple = ()
    if alert_id is not None:
        sql += " AND alert_id=?"
        args = (int(alert_id),)
    with contextlib.closing(_connect()) as c:
        return int(c.execute(sql, args).fetchone()[0])


def prune_fires(older_than_days: Optional[int] = None,
                keep_per_alert: Optional[int] = None,
                now: Optional[float] = None) -> dict:
    """Age out delivered history. Returns ``{"deleted", "cutoff", "days", "keep"}``.

    ⛔ FOUR THINGS THIS SWEEP MAY NOT DELETE, and each is a separate clause:

      * a fire NEWER than the window;
      * a fire that is **pending** (`delivered_at IS NULL`) — it is deliverable
        and deleting it would silence it;
      * a fire that carries a `delivery_failed_at` **or a failed channel** —
        that row IS the record that a member missed an alert (all of it, or the
        email half of it), and a defect whose only evidence has been swept is a
        defect nobody can report;
      * the newest `keep_per_alert` fires of EVERY alert, however old. A rarely
        firing alert would otherwise lose its entire history to a date window,
        and "my alert has never fired" and "my alert's history was pruned" look
        identical to the person reading it.
    """
    _ensure_init()
    days = FIRE_RETENTION_DAYS if older_than_days is None else int(older_than_days)
    keep = KEEP_FIRES_PER_ALERT if keep_per_alert is None else int(keep_per_alert)
    days = max(1, days)
    keep = max(1, keep)
    cutoff = (time.time() if now is None else float(now)) - days * 86400
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(
            "DELETE FROM indicator_alert_fires"
            " WHERE fired_at < ?"
            "   AND delivered_at IS NOT NULL"
            "   AND delivery_failed_at IS NULL"
            "   AND channels_failed = 0"
            "   AND id NOT IN ("
            "     SELECT id FROM (SELECT id, ROW_NUMBER() OVER ("
            "       PARTITION BY alert_id ORDER BY id DESC) AS rn"
            "       FROM indicator_alert_fires) WHERE rn <= ?)",
            (cutoff, keep),
        )
        deleted = int(cur.rowcount or 0)
        c.commit()
    if deleted:
        import logging
        logging.getLogger(__name__).info(
            "[alert-fires] pruned %d delivered fire(s) older than %d days "
            "(keeping the newest %d per alert)", deleted, days, keep)
    return {"deleted": deleted, "cutoff": cutoff, "days": days, "keep": keep}


def _maybe_prune_fires(now: Optional[float] = None) -> int:
    """Throttled sweep, run BY the write that causes the growth. Never raises.

    Wired here rather than in a scheduler this module does not own: growth only
    happens when a fire is recorded, so the write path is exactly where the
    sweep belongs, and a prune with no caller is the same shape as a ledger door
    nobody opened.
    """
    global _last_fire_prune_at
    t = time.time() if now is None else float(now)
    with _PRUNE_LOCK:
        if t - _last_fire_prune_at < _FIRE_PRUNE_EVERY_SEC:
            return 0
        _last_fire_prune_at = t
    try:
        return int(prune_fires(now=t)["deleted"])
    except Exception:
        import logging
        logging.getLogger(__name__).exception(
            "[alert-fires] retention sweep failed (non-fatal)")
        return 0


def delete_for_alert(alert_id: int) -> None:
    """Drop one alert's history — used ONLY when the alert row itself is deleted.

    ⚠️ NOT an UPDATE path and not a correction: an orphaned history keyed on an
    id SQLite will reissue is worse than no history, because the next alert to
    take that id would inherit its predecessor's fire keys and start life
    already-fired.
    """
    _ensure_init()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("DELETE FROM indicator_alert_fires WHERE alert_id=?",
                  (int(alert_id),))
        c.commit()
