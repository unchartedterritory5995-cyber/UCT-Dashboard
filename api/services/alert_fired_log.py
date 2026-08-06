"""Append-only fired-alert history — and the FIRE-ONCE KEY ITSELF.

Invariants (enforced HERE, not in callers — `signature/ledger.py` precedent):

- A FIRE is INSERT-only: its key, its value and its time are written once and
  there is no path in this module that rewrites any of them.
- ``UNIQUE(alert_id, fire_key)`` — a cycle that runs five times over one bar
  records ONE fire. And the INSERT is not bookkeeping BESIDE the decision, it
  **IS** the decision: `indicator_alert_service.record_trigger` reports a
  delivery if and only if this insert landed a new row.
- ⭐ THE ONE UPDATE IS `delivered_at`, AND IT IS THE FIRE-ONCE GUARD ITSELF, not
  a correction to history. `claim_delivery` is a compare-and-set that can only
  ever move NULL → a timestamp, exactly once, atomically, in the database. That
  is what makes *"`deliver_alert_payload` reaches a member exactly once per
  recorded fire"* a fact SQLite enforces rather than a sentence two functions
  agree on. A history that records twice and delivers once is a reporting bug;
  a history that records once and delivers twice is the failure that reaches
  the user, and it is the one this column makes unreachable.
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
)

_COLS = ("id, alert_id, user_id, sym, indicator, condition, tf, fire_key, "
         "bar_time, value, threshold, fired_at, delivered_at")


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
            return True
        except sqlite3.IntegrityError as exc:
            if "UNIQUE constraint failed" not in str(exc):
                raise
            return False


# ─── the reads ───────────────────────────────────────────────────────────────

def claim_delivery(alert_id: int, *, delivered_at: Optional[float] = None) -> bool:
    """⭐ THE EXACTLY-ONCE DELIVERY LATCH. True iff THIS call owns a delivery.

    An atomic compare-and-set on the NEWEST fire of this alert that has not been
    delivered: one `UPDATE … WHERE delivered_at IS NULL`, and the winner is
    whoever SQLite says changed a row. Two callers cannot both win, a restart
    cannot lose the fact, and there is no in-process flag anywhere that a second
    web instance would duplicate (`CLAUDE.md`'s single-process warning names
    exactly that class of guard).

    ⚠️ `ORDER BY id DESC` — the NEWEST undelivered fire, which is the one
    `record_trigger` just recorded. An older undelivered row is a fire that was
    recorded and whose delivery then failed or crashed; it stays `NULL` forever
    rather than being delivered late, because an alert that arrives an hour after
    its bar is worse than one that never arrives, and the row remains visible in
    the history as exactly what it is.

    Returns False when this alert has no undelivered fire — which is precisely
    the case where `record_trigger` refused to record one (a duplicate for the
    armed episode, or a snoozed alert).
    """
    _ensure_init()
    at = time.time() if delivered_at is None else float(delivered_at)
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(
            "UPDATE indicator_alert_fires SET delivered_at=? WHERE id = ("
            "  SELECT id FROM indicator_alert_fires"
            "   WHERE alert_id=? AND delivered_at IS NULL"
            "   ORDER BY id DESC LIMIT 1)",
            (at, int(alert_id)),
        )
        c.commit()
        return cur.rowcount == 1


def _row(r: tuple) -> dict:
    return {
        "id": r[0], "alert_id": r[1], "user_id": r[2], "sym": r[3],
        "indicator": r[4], "condition": r[5], "tf": r[6], "fire_key": r[7],
        "bar_time": r[8], "value": r[9], "threshold": r[10], "fired_at": r[11],
        "delivered_at": r[12],
    }


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
    """How many recorded fires actually reached a member."""
    _ensure_init()
    sql = "SELECT COUNT(*) FROM indicator_alert_fires WHERE delivered_at IS NOT NULL"
    args: tuple = ()
    if alert_id is not None:
        sql += " AND alert_id=?"
        args = (int(alert_id),)
    with contextlib.closing(_connect()) as c:
        return int(c.execute(sql, args).fetchone()[0])


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
