"""CRUD service for chart indicator alerts — and the ARM / FIRE / RE-ARM machine.

Stores per-user (ticker, indicator, condition, threshold, timeframe) alerts
that the background evaluator checks every 60s. When a condition triggers,
delivery reuses the existing watchlist-alert infrastructure (bell + email +
Discord + browser notification + sound).

Schema and patterns mirror ``api/services/bar_quarantine.py`` — same DB,
same WAL + busy_timeout pragmas, same private ``_conn()`` helper.

🔴 THE DEFECT THIS MODULE CARRIED UNTIL PHASE C TASK 11. `record_trigger` bumped
`trigger_count`, stamped `triggered_at` and **never deactivated**, while
`above`/`below` are LEVEL conditions (`current > threshold`, no reference to
`prev`). So an armed alert re-delivered on **every 60-second poll for as long as
the condition stayed true** — bell + email + Discord each time. Task 6 priced it
on real tape: `above`/`below` are 373,748 of the 388,808 fires the closed-bar
cutover removes, 96.1 %. Nobody had been spammed only because prod's
`indicator_alerts` table has zero rows; the first member to arm one would have
been the first to find out.

⭐ WHAT REPLACES IT, IN ONE SENTENCE: **an alert delivers if and only if
`alert_fired_log.record_fire` lands a NEW row**, and the key that row is unique
on is the alert's ARMED EPISODE (level conditions) or its BAR (cross
conditions). The history and the fire-once guard are the same object, so a
history that says "one fire" and a member who got five is not a state this
system can be in.

⛔ `list_active()` DELIBERATELY STILL RETURNS A FIRED ALERT. Dropping it from
that list would be the obvious fire-once — and it makes re-arm impossible,
because an alert nobody evaluates can never be observed to have stopped being
true. It would also blind the Task 6 shadow lane, which reads the same
`list_active()` and must keep observing every armed alert for the soak. The
quiet happens at DELIVERY, not at LISTING.
"""
import json
import os
import sqlite3
import time
from typing import Any, Optional

from api.services import alert_fired_log

_DB_PATH = os.environ.get("AUTH_DB_PATH", "/data/auth.db")


# ─── the states ──────────────────────────────────────────────────────────────
#
# Declared as data because two consumers quote it: the router's snooze/re-arm
# endpoints and `tests/test_alert_fired_log.py`'s totality rail.
#
#   armed            — eligible to fire.
#   fired            — fired, and quiet until the condition is observed FALSE.
#                      This is the state `above` never had, and its absence is
#                      the whole defect.
#   snoozed          — the user asked for silence until `snooze_until`. Still
#                      evaluated, still recorded, never delivered.
#   needs_attention  — the evaluator produced NO VALUE and the diagnosis says
#                      the compute RAISED (or the address is unknown). The alert
#                      is silent and the user could not otherwise tell.
#   error            — an exception escaped the per-alert evaluation entirely.
ALERT_STATES: tuple[str, ...] = (
    "armed", "fired", "snoozed", "needs_attention", "error")

STATE_ARMED = "armed"
STATE_FIRED = "fired"
STATE_SNOOZED = "snoozed"
STATE_NEEDS_ATTENTION = "needs_attention"
STATE_ERROR = "error"

# A snooze is bounded: an unbounded one is indistinguishable from a deleted
# alert that still shows in the list, and 30 days is already far past any
# trading rationale.
SNOOZE_MAX_MINUTES = 60 * 24 * 30

# How often the silence sweep is allowed to pay for a diagnostic recompute per
# alert. A warming alert produces no value every cycle and its diagnosis does
# not change; re-deriving it every sweep would be a compute per alert per sweep
# for exactly no new information.
_DIAGNOSE_EVERY_SEC = 300

# How long an ACTIVE alert may produce nothing before that counts as silence
# rather than as a quiet market. Five evaluator cycles: one missed cycle is a
# transient (a bar fetch that failed, a redeploy), five in a row is a fault.
_SILENT_AFTER_SEC = 300


_SCHEMA = """
CREATE TABLE IF NOT EXISTS indicator_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  sym TEXT NOT NULL,
  indicator TEXT NOT NULL,
  condition TEXT NOT NULL,
  threshold REAL,
  tf TEXT NOT NULL,
  params_json TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  last_value REAL,
  last_evaluated_at INTEGER,
  triggered_at INTEGER,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_indicator_alerts_user ON indicator_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_indicator_alerts_active ON indicator_alerts(active);
CREATE INDEX IF NOT EXISTS idx_indicator_alerts_sym ON indicator_alerts(sym);
"""

# ⚠️ THE COLUMN IS `active`, NOT `is_active`. A prod probe read this table as
# empty against `is_active` and reached the right answer for the wrong reason.
#
# Added by ALTER rather than by editing `_SCHEMA` above, because `CREATE TABLE
# IF NOT EXISTS` is a no-op on every box that already has the table — which is
# every box. The migration is the only thing that reaches an existing row.
_MIGRATIONS: tuple[tuple[str, str], ...] = (
    ("state", "ALTER TABLE indicator_alerts ADD COLUMN state TEXT NOT NULL DEFAULT 'armed'"),
    ("state_detail", "ALTER TABLE indicator_alerts ADD COLUMN state_detail TEXT"),
    ("state_at", "ALTER TABLE indicator_alerts ADD COLUMN state_at INTEGER"),
    ("arm_epoch", "ALTER TABLE indicator_alerts ADD COLUMN arm_epoch INTEGER NOT NULL DEFAULT 0"),
    ("snooze_until", "ALTER TABLE indicator_alerts ADD COLUMN snooze_until INTEGER"),
    ("last_fire_key", "ALTER TABLE indicator_alerts ADD COLUMN last_fire_key TEXT"),
    # ⭐ PHASE C TASK 10 (spec §8): WHICH INSTANCE OF THE INDICATOR.
    # An alert has always named a DEFINITION and evaluated an INSTANCE — the
    # period lived in `params_json` on the ALERT, so the chart and the alert
    # could disagree about it with nothing to notice. This is the chart
    # instance's own opaque id, stored so the binding is nameable and so a
    # DELETED instance can be reported instead of silently drifting.
    ("instance_id", "ALTER TABLE indicator_alerts ADD COLUMN instance_id TEXT"),
    # ⭐ THE DELETION GUARD, AND IT IS DELIBERATELY **NOT** A `state`.
    #
    # 🔴 MEASURED, AND IT CHANGED THE DESIGN. The obvious home was
    # `state = 'needs_attention'`, which is what the brief specified. It cannot
    # be: `record_evaluation` clears that state the moment a value arrives
    # ("whatever was broken is not broken now"), and an orphaned alert KEEPS
    # PRODUCING VALUES — it evaluates from the `params_json` snapshot. So the
    # flag would have been cleared by the next 60-second cycle, i.e. it would
    # have been green in the test that set it and gone before any user saw it.
    #
    # An orphaned binding is orthogonal to the FIRING lifecycle
    # (armed/fired/snoozed/needs_attention/error): the alert is armed, correct,
    # and firing — it just names a chart instance that no longer exists. So it
    # gets its own durable column and the state machine keeps its meaning.
    ("instance_missing_at",
     "ALTER TABLE indicator_alerts ADD COLUMN instance_missing_at INTEGER"),
    # ⭐ PHASE C TASK 12 (spec §5): WHICH CHART THIS ALERT BELONGS TO.
    #
    # NULL = GLOBAL, and that is the whole migration. Every row that exists —
    # today, zero in production — is NULL, so a nullable column with no backfill
    # leaves every alert on every chart exactly where it was. A NOT NULL column
    # with a `'global'` default would have written a sentinel into every row to
    # mean what the row already meant.
    #
    # ⛔⛔ IT IS A DISPLAY DIMENSION AND `list_active()` MUST NEVER READ IT.
    # `list_active()` is what the evaluator, the Task 6 SHADOW lane and the Task
    # 11 soak matrix all read. A scope filter there would make the 30 soak rows —
    # or any user's scoped alert — invisible to the shadow lane, and Task 8's
    # cutover gate would then pass on an empty set: a gate that cannot fail. The
    # rail is `test_a_scoped_alert_is_still_visible_to_list_active`.
    ("scope", "ALTER TABLE indicator_alerts ADD COLUMN scope TEXT"),
    # ⭐ PHASE D TASK 12 (spec §12): WHO AUTHORED THE ARITHMETIC.
    #
    # NULL = BUILTIN, and that is the whole migration. Every row that exists —
    # including the 31 production soak rows — is NULL, so a nullable column with
    # no backfill leaves every alert meaning exactly what it already meant. A
    # NOT NULL column with a `'builtin'` default would have written a sentinel
    # into 31 live rows to say what they already say, on a table the cutover gate
    # is watching.
    #
    # ⛔ IT IS A PROVENANCE DIMENSION AND `list_active()` MUST NEVER READ IT —
    # the identical rule `scope` above carries, for the identical reason. The
    # evaluator, the Task 6 SHADOW lane and the Task 11 soak matrix all read
    # `list_active()`; a filter here would shrink what the shadow lane observes
    # and Task 8's cutover gate would pass on a smaller set. `test_the_soak_rows_
    # stay_visible_to_list_active_after_the_def_source_column` is the rail, and
    # it drives the REAL `alert_soak_matrix.verify()`.
    #
    # ⛔ AND IT DOES NOT DECIDE WHETHER A FIRE IS DELIVERED. What quiets an alert
    # is Task 11's fired log and the snooze; what refuses a RECEIPT is
    # `indicator_alert_evaluator.admit_alert_fire`, which reads this column as
    # one of its TWO signals (see `_is_user_authored` — the other is structural,
    # so a row that lost this column still cannot accrue one).
    ("def_source", "ALTER TABLE indicator_alerts ADD COLUMN def_source TEXT"),
)

#: The two provenances. `NULL` in the column reads as `DEF_SOURCE_BUILTIN`
#: everywhere above the store, so no consumer has to know that absence means
#: "UCT wrote this arithmetic".
DEF_SOURCE_BUILTIN = "builtin"
DEF_SOURCE_USER = "user"


def db_path() -> str:
    """The alert store's path — a function so the fired log can follow it.

    `alert_fired_log` resolves ITS database through this at call time rather
    than reading `AUTH_DB_PATH` a second time itself. A history in a different
    file from the rows it keys on is a history of nothing.
    """
    return _DB_PATH


def _conn():
    c = sqlite3.connect(_DB_PATH, timeout=10.0)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=2000")
    return c


def _migrate(db) -> None:
    have = {r[1] for r in db.execute("PRAGMA table_info(indicator_alerts)")}
    for col, ddl in _MIGRATIONS:
        if col not in have:
            db.execute(ddl)


def init_schema():
    with _conn() as db:
        db.executescript(_SCHEMA)
        _migrate(db)
    # Same database, same startup call — so nothing new has to be wired into
    # `main.py` for the history to exist wherever the alerts do.
    alert_fired_log.init_schema()


def _row_to_dict(row: tuple) -> dict:
    return {
        "id": row[0],
        "user_id": row[1],
        "sym": row[2],
        "indicator": row[3],
        "condition": row[4],
        "threshold": row[5],
        "tf": row[6],
        "params_json": row[7],
        "active": bool(row[8]),
        "last_value": row[9],
        "last_evaluated_at": row[10],
        "triggered_at": row[11],
        "trigger_count": row[12],
        "created_at": row[13],
        "state": row[14] or STATE_ARMED,
        "state_detail": row[15],
        "state_at": row[16],
        "arm_epoch": row[17] or 0,
        "snooze_until": row[18],
        "last_fire_key": row[19],
        "instance_id": row[20],
        "instance_missing_at": row[21],
        # A bool for every surface, so no caller has to know that NULL means
        # "bound, or never checked" and a number means "the chart lost it".
        "instance_missing": row[21] is not None,
        # ⭐ WHICH CHART. `None` is GLOBAL — served as JSON `null`, which the
        # frontend's `alertSetFor` reads as "on every chart" for exactly the
        # reason the column is nullable.
        "scope": row[22],
        # ⭐ WHO AUTHORED THE ARITHMETIC. `None` in the column is BUILTIN —
        # resolved here so no surface, and no gate, has to know that absence
        # means "UCT wrote it". Every existing row (all 31 soak rows included) is
        # NULL and therefore reads `"builtin"`, which is what they have always
        # been.
        "def_source": row[23] or DEF_SOURCE_BUILTIN,
    }


_COLS = (
    "id, user_id, sym, indicator, condition, threshold, tf, params_json, "
    "active, last_value, last_evaluated_at, triggered_at, trigger_count, created_at, "
    "state, state_detail, state_at, arm_epoch, snooze_until, last_fire_key, "
    "instance_id, instance_missing_at, scope, def_source"
)


def _clean_scope(scope: Optional[Any]) -> Optional[str]:
    """A chart id, or ``None`` for GLOBAL — with exactly one spelling of global.

    ⛔ ONE REPRESENTATION, DELIBERATELY. If ``''`` and ``None`` could both be
    stored, ``scope IS NULL`` would be a filter that misses half the global rows
    and ``scope = ?`` would be one that matches none of them — the alert set
    would depend on which client wrote the row. Blank in, NULL stored.
    """
    if scope is None:
        return None
    text = str(scope).strip()
    return text or None


def _now(now: Optional[float] = None) -> int:
    """The cycle's notion of now, injectable.

    ⛔ EVERY TIME COMPARISON IN THIS MODULE GOES THROUGH HERE. A snooze that
    reads `time.time()` at the comparison instead of the time it was handed
    cannot be tested at the boundary at all — the test would have to sleep, and
    a test that sleeps for a 15-minute window is a test nobody runs.
    """
    return int(time.time() if now is None else now)


def create(
    user_id: str,
    sym: str,
    indicator: str,
    condition: str,
    threshold: Optional[float],
    tf: str,
    params_json: Optional[Any] = None,
    instance_id: Optional[str] = None,
    scope: Optional[str] = None,
) -> int:
    """Create a new indicator alert. Returns the new alert ID.

    ⚠️ `scope` IS OPTIONAL AND OMITTING IT MEANS **GLOBAL**, not "unknown".
    An alert armed from a surface with no chart identity belongs to every chart,
    which is what every alert meant before this column existed. A caller that
    wants a per-chart alert says so.

    ⚠️ `instance_id` IS OPTIONAL AND `params_json` IS STILL THE TRUTH THE
    EVALUATOR READS. The id names the chart instance this alert was armed from;
    the params are the SNAPSHOT of that instance's inputs at the moment it was
    armed. Reading the live chart at evaluation time instead would mean an
    alert's meaning changed every time somebody dragged a period slider, and
    would make the alert lane depend on a preferences blob it cannot see from a
    background thread. So: the snapshot evaluates, and the id is what lets a
    DELETED instance be reported rather than quietly outlived.
    """
    if params_json is not None and not isinstance(params_json, str):
        params_json = json.dumps(params_json)

    # ⭐⭐ PHASE D TASK 12 — ARM TIME IS HERE, AND THE EQUALITY RUNS BEFORE THE
    # INSERT. `arm_for_alert` returns `None` for every builtin address, so this
    # line is a no-op for every alert that has ever been created and the path
    # above is byte-identical for them (`test_the_builtin_create_path_does_not_
    # change` drives it). For a user address it runs the three measured gates —
    # the stored repaint verdict, the budget AT THE VERSION BEING ARMED, and the
    # cross-lane 1e-9 equality on THIS symbol's real bars — and RAISES
    # `alert_user_series.AdmissionRefused` naming the gate.
    #
    # ⛔ IT RAISES RATHER THAN RETURNING FALSE, AND IT RAISES *BEFORE* THE INSERT.
    # A refusal after the row landed would leave an alert the user believes is
    # watching and which is refused every cycle — the silence this lane's create
    # path validation exists to end, reached one step later. A refusal before it
    # means there is nothing to go quiet.
    from api.services import alert_user_series
    admitted = alert_user_series.arm_for_alert(user_id, indicator, sym.upper(), tf)
    source = None if admitted is None else DEF_SOURCE_USER

    now = int(time.time())
    with _conn() as db:
        cur = db.execute(
            "INSERT INTO indicator_alerts "
            "(user_id, sym, indicator, condition, threshold, tf, params_json, "
            "active, trigger_count, created_at, state, state_at, arm_epoch, "
            "instance_id, scope, def_source) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, 0, ?, ?, ?)",
            (
                str(user_id),
                sym.upper(),
                indicator,
                condition,
                None if threshold is None else float(threshold),
                tf,
                params_json,
                now,
                STATE_ARMED,
                now,
                None if instance_id is None else str(instance_id),
                # An empty string is not a chart id — it is a client that had
                # nothing to send. Stored as NULL so there is exactly ONE
                # representation of "global" in the column.
                _clean_scope(scope),
                # NULL for a builtin — the same "absence means what it always
                # meant" rule the `scope` column above is built on.
                source,
            ),
        )
        return int(cur.lastrowid)


def get(alert_id: int) -> Optional[dict]:
    with _conn() as db:
        row = db.execute(
            f"SELECT {_COLS} FROM indicator_alerts WHERE id=?",
            (int(alert_id),),
        ).fetchone()
    return _row_to_dict(row) if row else None


def list_for_user(user_id: str, scope: Optional[str] = None) -> list[dict]:
    """This user's alerts, each NAMING THE INSTANCE it evaluates.

    ⭐ SPEC §8: *"instance named in alert rows ('RSI(7) crossed 70' vs
    'RSI(14)')"*. The label is computed by
    `indicator_alert_evaluator.instance_label` from the row's own `params_json`,
    so the name a user reads and the number the evaluator computes come from the
    SAME field. A label built in the frontend from a second table of parameter
    names is the twin this phase spent its whole budget retiring.

    ⭐ PHASE C TASK 12 — `scope` NARROWS THIS TO ONE CHART'S ALERT SET, and the
    set is *global + that chart*, never *that chart alone*. An alert armed before
    per-chart sets existed (all of them) is NULL-scoped and has always shown on
    every chart; a filter that dropped it would empty every user's alert list the
    day the column landed.

    Omitting `scope` returns EVERYTHING, which is what the alert manager wants
    and what this function did before — so no existing caller changes behaviour.
    """
    clean = _clean_scope(scope)
    where = "user_id=?"
    args: list[Any] = [str(user_id)]
    if clean is not None:
        where += " AND (scope IS NULL OR scope=?)"
        args.append(clean)
    with _conn() as db:
        rows = db.execute(
            f"SELECT {_COLS} FROM indicator_alerts WHERE {where} ORDER BY created_at DESC",
            tuple(args),
        ).fetchall()
    return [_with_instance_label(_row_to_dict(r)) for r in rows]


def _with_instance_label(row: dict) -> dict:
    """Add `instance_label` to a row. Never raises — a label is not worth a 500.

    ⚠️ NOT applied by `_row_to_dict`, and that is deliberate: `list_active()`
    feeds the evaluator and the Task 6 SHADOW lane, which compare rows and must
    not start carrying a derived display field that could differ between two
    processes running different code. Only the user-facing listing is decorated.
    """
    try:
        from api.services import indicator_alert_evaluator as ev
        address = ev.resolve_address(row.get("indicator"))
        row["instance_label"] = ev.instance_label(address, ev._parse_params(row))
    except Exception:  # noqa: BLE001 - a display label must not break a listing
        row["instance_label"] = row.get("indicator")
    return row


def list_active() -> list[dict]:
    """Every alert the user has switched ON — INCLUDING fired and snoozed ones.

    ⛔ DO NOT FILTER BY `state` HERE. See the module docstring: a fired alert
    that stops being evaluated can never be observed to have stopped being true,
    so it can never re-arm; and the Task 6 shadow lane reads this same function,
    so filtering would silently shrink what the soak observes. The quiet is at
    delivery.

    ⛔⛔ AND DO NOT FILTER BY `scope` EITHER — PHASE C TASK 12. `scope` says which
    CHART an alert is displayed on; it says nothing about whether the alert
    should be evaluated, and a chart nobody has open is not a reason to stop
    watching the market. Three readers make that concrete:

      · the evaluator (`_run_one_cycle`) — a scoped alert would silently stop
        firing whenever nobody had that chart open, which is never;
      · the Task 6 SHADOW lane (`alert_shadow_log.run_shadow_cycle`) — it
        observes exactly what this returns;
      · the Task 11 SOAK MATRIX — 30 rows armed then snoozed, whose entire
        purpose is to give Task 8's three-session gate something to observe.
        Production has ZERO armed alerts, so if a scope filter hid the matrix the
        gate would pass on an empty set. That is
        [[lesson_gate_that_cannot_fail]] in the one place this phase cannot
        afford it.

    `test_a_scoped_alert_is_still_visible_to_list_active` is the rail, and the
    soak-matrix half of it drives `tools/alert_soak_matrix.verify()` itself.
    """
    with _conn() as db:
        rows = db.execute(
            f"SELECT {_COLS} FROM indicator_alerts WHERE active=1 ORDER BY id"
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def set_active(alert_id: int, active: bool) -> None:
    with _conn() as db:
        db.execute(
            "UPDATE indicator_alerts SET active=? WHERE id=?",
            (1 if active else 0, int(alert_id)),
        )


def delete(alert_id: int) -> None:
    with _conn() as db:
        db.execute("DELETE FROM indicator_alerts WHERE id=?", (int(alert_id),))
    # ⚠️ SQLite REISSUES AUTOINCREMENT-LESS ROWIDS. Leaving the history behind
    # would let the next alert to take this id inherit its predecessor's fire
    # keys and start life already-fired — silent, and impossible to diagnose.
    alert_fired_log.delete_for_alert(alert_id)


# ─── the state machine ───────────────────────────────────────────────────────

def _touch_value(alert_id: int, last_value: float, now_i: int) -> None:
    """Write the observed value back. Runs on EVERY observation, always.

    ⚠️ LOAD-BEARING EVEN WHILE THE ALERT IS QUIET. Under
    `ALERT_EVAL_MODE == "forming"` this column IS the `prev` a crossing is
    measured against, so skipping it for a fired or snoozed alert would change
    what the alert decides when it comes back — a re-arm that silently moved
    the crossing it re-armed for.
    """
    with _conn() as db:
        db.execute(
            "UPDATE indicator_alerts SET last_value=?, last_evaluated_at=? WHERE id=?",
            (float(last_value), now_i, int(alert_id)),
        )


def _set_state(alert_id: int, state: str, now_i: int, *,
               detail: Optional[str] = None,
               bump_epoch: bool = False,
               clear_snooze: bool = False) -> None:
    if state not in ALERT_STATES:
        raise ValueError(f"unknown alert state {state!r} — legal: {ALERT_STATES}")
    sql = ["UPDATE indicator_alerts SET state=?, state_detail=?, state_at=?"]
    args: list = [state, detail, now_i]
    if bump_epoch:
        sql.append(", arm_epoch=arm_epoch+1")
    if clear_snooze:
        sql.append(", snooze_until=NULL")
    sql.append(" WHERE id=?")
    args.append(int(alert_id))
    with _conn() as db:
        db.execute("".join(sql), tuple(args))


def _rearm(alert_id: int, now_i: int, detail: Optional[str] = None) -> None:
    """Back to armed, and the EPISODE MOVES.

    ⭐ `arm_epoch+1` IS THE RE-ARM. The fired log is unique on
    `(alert_id, fire_key)` and a level condition's key is `ep:<arm_epoch>`, so
    without the bump the next fire would collide with the previous episode's row
    and the alert would stay quiet forever. A re-arm that does not move the key
    is not a re-arm, it is a permanent mute with an encouraging label.
    """
    _set_state(alert_id, STATE_ARMED, now_i, detail=detail,
               bump_epoch=True, clear_snooze=True)


def snooze_active(row: Optional[dict], now: Optional[float] = None) -> bool:
    """Is this alert INSIDE a snooze window right now? Read from the CLOCK.

    🔴 THE DEFECT THIS CLOSES, AND IT WAS LIVE. The snooze used to be enforced
    by `row["state"] == STATE_SNOOZED` — a mutable text column — and
    `snooze_until` was consulted only once that column already said "snoozed".
    So anything that rewrote the state cancelled the snooze silently:

        snooze 30 days  →  `sweep_silent_alerts` sees one cycle with no bars  →
        `mark_needs_attention` writes state='needs_attention' and leaves
        `snooze_until` 29 DAYS OUT  →  the next true reading DELIVERS.

    Measured on a real row: `record_trigger` returned **True** with the window
    still 29 days from closing, and `claim_delivery` agreed. That sweep runs
    unconditionally every 300 s from `api/main.py`, and all 31 production soak
    rows share one `(SPY, "5")` bar group — so ONE failed bars fetch un-muzzled
    all 31 at once.

    ⛔ THE ASYMMETRY THAT MADE IT POSSIBLE IS THE REAL LESSON. Fire-once is
    protected by `UNIQUE(alert_id, fire_key)` — a DATABASE invariant that
    survives any state drift. The snooze had no backstop and was exactly as
    durable as one text column that six code paths write. It is now derived from
    the TIMESTAMP, which no state transition rewrites, so every consumer asks the
    same question and no state can answer it for them.

    ⚠️ `_rearm` STILL CLEARS `snooze_until`, AND THAT IS THE CANCEL PATH. The
    manual re-arm button and an expired window both go through it, so "tell me
    again now" still cancels a snooze — deliberately, because that is the one
    place a human asked for it.
    """
    if not row:
        return False
    until = row.get("snooze_until")
    if until is None:
        return False
    try:
        return _now(now) < int(until)
    except (TypeError, ValueError):
        return False


def record_evaluation(alert_id: int, last_value: float, *,
                      now: Optional[float] = None) -> bool:
    """The alert was evaluated and did NOT trigger. Returns True iff it re-armed.

    ⭐ THIS IS THE RE-ARM SITE, AND IT IS THE HALF OF FIRE-ONCE PEOPLE FORGET.
    Fire-once without a re-arm is a one-shot alert; a re-arm on the next cycle
    is no fire-once at all. The rule here is the only one that is both: an alert
    that fired comes back **when the condition is observed false**, and not one
    cycle sooner.

    ⚠️ `last_value` IS STILL WRITTEN FOR EVERY STATE. Under
    `ALERT_EVAL_MODE == "forming"` this column is the `prev` a crossing is
    measured against — it is part of the alert's decision, not bookkeeping
    beside it. Under the closed lane (`"closed"`, dark today) `prev` comes from
    `series[i-1]` and this column is demoted to display and delivery-dedup.
    """
    now_i = _now(now)
    row = get(alert_id)
    if row is None:
        return False
    _touch_value(alert_id, last_value, now_i)

    state = row["state"]
    # ⭐ THE WINDOW, NOT THE LABEL — see `snooze_active`. Asking the clock rather
    # than the `state` column is what makes a snooze survive `mark_needs_
    # attention`, which rewrote the label and left the window open.
    if snooze_active(row, now_i):
        return False
    if row["snooze_until"] is not None:
        # ⭐ AN EXPIRED SNOOZE RE-ARMS, EPISODE AND ALL. "Quiet for 15 minutes"
        # means the alert speaks again afterwards if it is still true — so the
        # key has to move, or the very condition the user snoozed would be the
        # one thing that can never come back. `_rearm` clears `snooze_until`, so
        # this runs exactly once however the state drifted in the meantime.
        _rearm(alert_id, now_i, detail="the snooze window expired")
        return True
    if state == STATE_FIRED:
        _rearm(alert_id, now_i)
        return True
    if state in (STATE_NEEDS_ATTENTION, STATE_ERROR):
        # A value arrived, so whatever was broken is not broken now. This is NOT
        # a re-arm: nothing fired, so the episode must not move.
        _set_state(alert_id, STATE_ARMED, now_i)
        return False
    return False


def record_trigger(alert_id: int, last_value: float, *,
                   bar_time: Any = None,
                   now: Optional[float] = None) -> bool:
    """The condition is TRUE. **Returns True to DELIVER, False to STAY QUIET.**

    ⭐ THE RETURN VALUE IS THE FIRE-ONCE GUARD. `_run_one_cycle` calls
    `_dispatch_delivery` only when this returns True. The decision is not made
    here by an `if` anybody can drift — it is made by
    `alert_fired_log.record_fire`, whose `UNIQUE(alert_id, fire_key)` either
    lands a new row or does not. History and fire-once are the same object, so
    "the log says one fire and the member got five" is not a reachable state.

    The key is the ARMED EPISODE for a level condition and the BAR for a cross
    condition — `alert_fired_log.fire_key`, and its module docstring says why
    those must differ.

    ⚠️ A SNOOZED ALERT RETURNS FALSE **BEFORE THE LOG IS TOUCHED.** Recording a
    fire that was never delivered would consume that episode's key, and the
    alert would then be permanently mute the moment the snooze expired — the
    user asked for fifteen minutes of quiet and got silence forever.

    ⛔ AND "SNOOZED" IS NOW THE WINDOW, NOT THE `state` LABEL. It used to be the
    label, so `mark_needs_attention` — reached from a sweep that runs every
    300 s — cancelled a 30-day snooze by rewriting one text column. Measured:
    this returned **True** with the window still 29 days out. See
    `snooze_active`.

    ⚠️ `needs_attention` / `error` DO NOT SUPPRESS. A value arrived and the
    condition is true; whatever was wrong is over. Firing clears the state.
    """
    now_i = _now(now)
    row = get(alert_id)
    if row is None:
        return False
    _touch_value(alert_id, last_value, now_i)

    if snooze_active(row, now_i):
        return False
    if row["snooze_until"] is not None:
        _rearm(alert_id, now_i, detail="the snooze window expired")
        row = get(alert_id) or row

    key = alert_fired_log.fire_key(row["condition"], bar_time, row["arm_epoch"])
    landed = alert_fired_log.record_fire(
        alert_id=int(alert_id),
        user_id=str(row["user_id"]),
        sym=str(row["sym"]),
        indicator=str(row["indicator"]),
        condition=str(row["condition"] or ""),
        tf=str(row["tf"] or ""),
        key=key,
        value=float(last_value),
        bar_time=bar_time,
        threshold=row["threshold"],
        fired_at=float(now_i),
    )
    if not landed:
        return False

    with _conn() as db:
        db.execute(
            "UPDATE indicator_alerts SET state=?, state_detail=NULL, state_at=?, "
            "triggered_at=?, trigger_count=trigger_count+1, last_fire_key=? WHERE id=?",
            (STATE_FIRED, now_i, now_i, key, int(alert_id)),
        )
    return True


def snooze(alert_id: int, minutes: int, *, now: Optional[float] = None) -> dict:
    """Silence one alert for `minutes`, then let it speak again if still true.

    Refuses out-of-range windows with a ValueError rather than clamping: a
    silently clamped 90-day snooze is a user who believes an alert is off and a
    system that thinks it is on.
    """
    try:
        mins = int(minutes)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"minutes must be an int, got {minutes!r}") from exc
    if mins < 1 or mins > SNOOZE_MAX_MINUTES:
        raise ValueError(
            f"snooze minutes must be 1..{SNOOZE_MAX_MINUTES}, got {minutes!r}")
    now_i = _now(now)
    until = now_i + mins * 60
    with _conn() as db:
        db.execute(
            "UPDATE indicator_alerts SET state=?, state_detail=?, state_at=?, "
            "snooze_until=? WHERE id=?",
            (STATE_SNOOZED, f"snoozed for {mins} min", now_i, until,
             int(alert_id)),
        )
    return {"state": STATE_SNOOZED, "snooze_until": until}


def rearm(alert_id: int, *, now: Optional[float] = None) -> dict:
    """Manual re-arm — "tell me again next time it happens", from the UI."""
    now_i = _now(now)
    _rearm(alert_id, now_i, detail=None)
    row = get(alert_id)
    return {"state": (row or {}).get("state", STATE_ARMED),
            "arm_epoch": (row or {}).get("arm_epoch", 0)}


def mark_needs_attention(alert_id: int, detail: Any, *,
                         state: str = STATE_NEEDS_ATTENTION,
                         now: Optional[float] = None) -> None:
    """The alert is silent for a reason the user cannot otherwise see.

    ⭐ THE tzdata CASE, MADE VISIBLE. `compute_vwap` RAISES rather than falling
    back to UTC when the IANA tz database is missing — deliberate, and correct:
    a silent UTC fallback is the retired VWAP_SESSION_ANCHOR defect, measured at
    $14.45 at a session open. But the evaluator wraps every compute in
    try/except and logs, so on such a box EVERY VWAP ALERT GOES SILENT and no
    surface says so. **The raise is preserved. The silence is not.**

    Never raises into the caller: this runs inside a cycle whose job is to
    survive one bad row.
    """
    try:
        text = detail if isinstance(detail, str) else (
            f"{type(detail).__name__}: {detail}" if detail is not None else None)
        if text:
            text = text[:500]
        _set_state(int(alert_id), state, _now(now), detail=text)
    except Exception:  # noqa: BLE001 - a diagnostic must not break the cycle
        import logging
        logging.getLogger(__name__).exception(
            "[alert-state] failed to mark alert %s", alert_id)


def diagnose(alert: dict, bars: Optional[list]) -> tuple[bool, Optional[str]]:
    """WHY does this alert produce no value? ``(is_fault, detail)``.

    ⛔ IT CALLS THE EVALUATOR'S OWN `address_value`, NOT A COPY OF IT. A helper
    that re-implements the dispatch would diagnose a function nobody runs — the
    mutation-harness lesson, reached from the diagnostic side. `address_value`
    does not swallow, which is exactly why it is the one worth calling: the
    raising compute's own message comes back intact, verbatim.

    ⚠️ "NOT ENOUGH BARS YET" IS NOT A FAULT and is returned as `(False, text)`.
    It computes without raising and simply has no answer for this window; an
    alert that has not warmed up must not be reported to a user as broken. The
    distinction is the whole reason this returns a pair instead of a string.
    """
    from api.services import indicator_alert_evaluator as ev

    raw = alert.get("indicator")
    address = ev.resolve_address(raw)
    if ev.value_function(address) is None:
        return True, (f"{raw!r} is not an indicator this chart can evaluate — "
                      "this alert can never fire")
    if not bars:
        return True, ("no bars are stored for this symbol and timeframe yet, "
                      "so nothing can be computed")
    try:
        value = ev.address_value(address, bars, ev._parse_params(alert))
    except Exception as exc:  # noqa: BLE001 - the message IS the diagnosis
        return True, f"{type(exc).__name__}: {exc}"
    if value is None:
        return False, (f"{address} has no value on the bars stored for this "
                       "timeframe yet — not enough history")
    return False, None


# ─── WHAT THE CREATE PATH REFUSES, AND WHY EACH REFUSAL IS MODE-HONEST ───────
#
# ⭐ THE GAP THIS CLOSES. `diagnose` above answers *"why is this alert silent"*
# AFTER the alert has been armed, live, for as long as it takes somebody to
# notice. This answers the same question one step earlier — at creation, where
# the answer can still be a refusal instead of an explanation. The concrete case
# that surfaced it: a `vwap` alert on `tf="D"`. `bars_sqlite` keeps daily rows
# under a `YYYYMMDD` calendar key, `compute_vwap_raw` refuses a column whose `t`
# is not a clock instant (`indicator_compute.VWAP_MIN_INSTANT`, the fix for the
# 1970-anchored daily VWAP), and the chart has always declared VWAP intraday-only
# (`eligibility.VWAP_TIMEFRAMES`). So the alert was accepted, armed, active — and
# structurally mute forever, with nothing anywhere saying so.
#
# ⛔⛔ THE RULE, AND IT IS THE HARD PART: A COMBINATION IS REFUSED ONLY IF IT IS
# DEAD IN **BOTH** EVALUATION MODES. `ALERT_EVAL_MODE` is `"forming"` today and
# Task 8 alone flips it, so a validator that quietly judged the post-cutover
# world would delete working features from a live surface under the cover of a
# "fix".
#
#   ⚠️ THE NAMED CASE THAT PROVES THE RULE IS NOT THEORETICAL: `ichimoku.chikou`
#   fires TODAY and stops firing at the cutover. Its 26-bar trailing pad means
#   the CLOSED bar's `series[i]` is always `None`, so under `"closed"` it can
#   never fire — but under `"forming"` the value lane takes the last non-None
#   element and it fires normally. It is live in the production catalog with
#   armed rows behind it, and Task 6's declared diff prices it at 19,574 fires
#   lost / 0 gained. **It is deliberately NOT refused here.** What happens to it
#   at the flip is Task 8's decision, not a side effect of input validation.
#
# The distinction each gate below rests on is therefore mechanical rather than
# editorial: an ALL-None column is dead in both lanes; a TRAILING-None column is
# alive in one of them. `instant_only_addresses()` measures exactly that
# difference and `chikou` falls on the living side of it.

#: The three refusals, as data, because the tests quote them rather than retype
#: them and because disjointness has to be assertable.
#:
#: ⛔ THEY ARE DELIBERATELY DISJOINT AND THAT IS A SAFETY PROPERTY, NOT A STYLE
#: NOTE. Task 9 shipped two gates that shared a refusal phrase, and
#: `pytest.raises(match=…)` therefore still matched with the second safety
#: DELETED — a test that would have passed on a tree with the guard removed.
#: `test_the_three_refusals_are_disjoint` asserts each anchor matches its own
#: message and no other.
REFUSAL_UNJUDGEABLE_CONDITION = "is not a trigger rule this evaluator can judge"
REFUSAL_INTRADAY_ONLY = "is only defined on an intraday timeframe"
REFUSAL_NO_LEVEL = "compares against a level, and no level was given"

#: How many bars the classification probe below runs on. Ichimoku needs 52 + a
#: 26-bar displacement before it resolves at all, so a short probe would report
#: "no value on either encoding" for it and classify nothing — which is why
#: `test_the_probe_resolves_every_catalog_address` exists.
_PROBE_BARS = 260


def _probe_series() -> tuple[list[dict], list[dict]]:
    """Two bar lists, IDENTICAL in OHLCV and differing ONLY in the `t` encoding.

    The left one carries real unix seconds (what `bars_sqlite` stores for
    1/5/15/30/60); the right one carries `YYYYMMDD` ints for the same calendar
    days (what it stores for D/W/M). `_fetch_bars_for_alert` passes either
    through verbatim — deliberately, because `bar_close_epoch` and
    `closed_bar_index` READ the calendar encoding — so these two are exactly the
    two shapes an address can be handed in production.

    ⛔ THE OHLCV MUST MOVE. A flat series makes CCI's mean deviation zero and
    ADX's directional movement zero, so several addresses would report "no
    value" for a reason that has nothing to do with `t` and would be
    misclassified. The sine plus drift is what keeps every one of the 31
    resolvable — asserted, not assumed.
    """
    import datetime as _dt
    import math
    base = _dt.date(2024, 1, 2)
    instant: list[dict] = []
    calendar: list[dict] = []
    for i in range(_PROBE_BARS):
        day = base + _dt.timedelta(days=i)
        close = 100.0 + 10.0 * math.sin(i / 9.0) + i * 0.05
        ohlcv = {"o": close - 0.4, "h": close + 1.1, "l": close - 1.3,
                 "c": close, "v": 1_000_000 + i * 137}
        instant.append({"t": int(_dt.datetime(
            day.year, day.month, day.day, 14, 30,
            tzinfo=_dt.timezone.utc).timestamp()), **ohlcv})
        calendar.append({"t": int(day.strftime("%Y%m%d")), **ohlcv})
    return instant, calendar


_INSTANT_ONLY_CACHE: Optional[frozenset] = None


def instant_only_addresses() -> frozenset:
    """Addresses whose column is REFUSED WHOLE on a calendar-encoded timeframe.

    ⛔ MEASURED, NEVER LISTED. The obvious implementation is
    `{"vwap"}` — and that is a literal somebody has to remember to edit, which
    is the enumeration-site defect this programme has been retiring all phase.
    This runs every address's own column function over the two probe series and
    asks the only question that matters: does it produce a number on an instant
    and NOTHING AT ALL on a calendar date? Today the answer is `{"vwap"}` and
    `test_the_measured_instant_only_set_is_exactly_vwap_today` says so — but a
    future address with the same dependency is covered on the day it lands.

    ⛔ AN ADDRESS THAT RESOLVES ON NEITHER PROBE IS NOT CLASSIFIED. "No value on
    either encoding" means the probe could not tell, not that the address is
    calendar-hostile, and refusing on a measurement that did not happen is how a
    guard starts rejecting working alerts. `test_the_probe_resolves_every_
    catalog_address` asserts that set is EMPTY, so the safe branch is never
    silently doing the work.

    ⚠️ THE DIFFERENCE FROM `ichimoku.chikou` IS THE WHOLE DESIGN. `chikou`'s
    column has 209 values and 26 trailing `None`s on this same probe, so
    `any(...)` is True on BOTH encodings and it is never flagged. A trailing pad
    is a CLOSED-lane consequence; an empty column is a both-lanes fact.
    """
    global _INSTANT_ONLY_CACHE
    if _INSTANT_ONLY_CACHE is not None:
        return _INSTANT_ONLY_CACHE
    from api.services import alert_series
    from api.services import indicator_alert_evaluator as ev
    instant, calendar = _probe_series()
    flagged = set()
    for address in ev.all_addresses():
        column = alert_series.SERIES_FUNCS.get(address)
        if column is None:
            continue
        try:
            on_instant = column(instant, {})
            on_calendar = column(calendar, {})
        except Exception:  # noqa: BLE001 - a raising compute is `diagnose`'s job
            continue
        if any(v is not None for v in on_instant) and all(
                v is None for v in on_calendar):
            flagged.add(address)
    _INSTANT_ONLY_CACHE = frozenset(flagged)
    return _INSTANT_ONLY_CACHE


def evaluable_conditions() -> frozenset:
    """Every trigger rule the catalog offers, anywhere, for any address.

    ⚠️ THIS IS THE SET `check_condition` HANDLES, AND THE EQUALITY IS A TEST
    RATHER THAN A HOPE. `alert_conditions.check_condition` returns False for an
    unknown condition, so a rule outside its branches is armed and mute forever
    — in both lanes, since it is the sole decider of `triggered` in
    `_evaluate_one` AND `_evaluate_one_closed`. Refusing on the CATALOG union
    would over-refuse if `check_condition` ever grew a branch nobody offered, so
    `test_the_offered_rules_are_exactly_the_ones_check_condition_handles`
    derives its branches from its own AST and asserts set equality both ways.
    """
    from api.services import indicator_alert_evaluator as ev
    return frozenset(
        c["value"] for conditions in ev.ALERT_CONDITIONS.values()
        for c in conditions
    )


def conditions_needing_a_level() -> frozenset:
    """Rules that can never fire without a number on the right-hand side.

    ⛔ MEASURED AGAINST `check_condition` ITSELF, not read off a list. Every
    offered rule is asked, with `threshold=None`, whether ANY (current, prev)
    pair in a sign-covering probe makes it answer True. `cross_zero` does
    (`prev <= 0 < current`); the other six consult `threshold` and short-circuit
    on `None`. A hand-written `{"above", "below", …}` set is the same literal
    the retired dispatch dict was, and it would rot the first time a rule landed.

    ⚠️ IT IS NOT THE WHOLE REFUSAL. `THRESHOLD_OPERAND` DECLARES a right-hand
    side for four (address, condition) pairs — `bb`'s two band touches and the
    two `sar` events — and those are supplied by the evaluator rather than typed
    by the user. `refusal_for` subtracts them, and the result reproduces the
    catalog's hand-declared `needs_threshold` column exactly, which is what
    `test_the_derived_rule_reproduces_the_catalogs_needs_threshold_column`
    measures across every offered pair.
    """
    from api.services.alert_conditions import check_condition
    probe = (-2.0, -1.0, 0.0, 1.0, 2.0)
    return frozenset(
        condition for condition in evaluable_conditions()
        if not any(check_condition(condition, current, prev, None)
                   for current in probe for prev in probe)
    )


def refusal_for(indicator: Optional[str], condition: Optional[str],
                tf: Optional[str], threshold: Optional[float]) -> Optional[str]:
    """Why this alert could NEVER fire, or ``None`` if it could.

    Three gates, and every one of them is true under `ALERT_EVAL_MODE ==
    "forming"` AND under `"closed"` — see the section header for why that is the
    binding constraint rather than a nicety.

    ⚠️ IT DOES NOT DUPLICATE THE TWO REFUSALS THAT ALREADY SHIPPED. The router
    redirects the price ALIASES to the watchlist-alert lane and refuses an
    address with no value function before calling this; those are about the
    alert's NAME, these are about its SHAPE, and putting a second copy of the
    address check here would give one refusal two spellings.

    ⛔ `create()` IS DELIBERATELY NOT GATED. Thirty-one soak rows are armed on
    production and `tools/alert_soak_matrix.py --arm` must stay idempotent; a
    guard inside the writer would change what an internal tool and every
    existing row can do, when the gap being closed is the *API* surface. The
    router calls this; `create` still inserts what it is handed.
    """
    from api.services import indicator_alert_evaluator as ev

    address = ev.resolve_address((indicator or "").strip())
    rule = (condition or "").strip()
    code = str(tf or "").strip().upper()
    label = ev.ALERT_LABELS.get(address, address)

    if rule not in evaluable_conditions():
        offered = ", ".join(sorted(evaluable_conditions()))
        return (f"{condition!r} {REFUSAL_UNJUDGEABLE_CONDITION} — it matches no "
                f"branch of check_condition, which answers no for it on every "
                f"bar, before and after the closed-bar cutover alike. The rules "
                f"it can judge are: {offered}.")

    if address in instant_only_addresses() and code in ev._CALENDAR_TFS:
        intraday = ", ".join(sorted(ev._TF_MINUTES))
        return (f"{label} {REFUSAL_INTRADAY_ONLY}. A {code} bar is stored under a "
                f"calendar date where this series needs a clock instant, so its "
                f"whole column is withheld and no number is ever produced — on "
                f"the live lane and on the closed one. Arm it on one of "
                f"{intraday}.")

    if (threshold is None and rule in conditions_needing_a_level()
            and (address, rule) not in ev.THRESHOLD_OPERAND):
        return (f"{label} with {rule!r} {REFUSAL_NO_LEVEL}. Nothing declares a "
                f"right-hand side for this pair, so the comparison is skipped "
                f"every cycle and neither evaluation mode can deliver anything. "
                f"Send a threshold.")

    return None


# ─── SPEC §6/§8: THE DELETION GUARD, FROM THE OTHER SIDE ─────────────────────

_INSTANCE_BLOBS: tuple[str, ...] = ("charts_workspace_layout", "chart_settings",
                                    "multichart_state")


def _walk_instance_ids(node: Any, out: set) -> None:
    """Collect every `instanceId` string anywhere in a decoded preferences blob.

    ⛔ VOCABULARY-FREE, ON PURPOSE, AND THAT IS THE WHOLE DESIGN. The obvious
    implementation reads `settings.indicators` and maps each `defId` onto an
    alert address — and that map LIES for two of the fourteen: `williams_r` is
    `williamsR` in the engine, and `price_vs_ma` has NO chart definition at all
    (it is a spread this lane synthesises). It would also need a second bridge
    from input KEYS to param keys (`stdDev` vs `stddev`). An `instanceId` is an
    opaque string on both sides, so matching one against another needs neither
    bridge and cannot mis-map anything.

    ⚠️ IT WALKS THE WHOLE BLOB rather than a known path, because the user's real
    chart does not live at a known path: the global `chart_settings` is only a
    SEED, and the live instances sit under
    `charts_workspace_layout -> widgets[].opts.settings`. A path-based read
    would report every instance as deleted for every user with a workspace.
    """
    if isinstance(node, dict):
        value = node.get("instanceId")
        if isinstance(value, str) and value:
            out.add(value)
        for child in node.values():
            _walk_instance_ids(child, out)
    elif isinstance(node, list):
        for child in node:
            _walk_instance_ids(child, out)


def chart_instance_ids(user_id: str) -> Optional[set]:
    """Every chart-instance id this user's stored chart blobs still contain.

    ``None`` means "cannot tell" — no blob was readable, or the store raised.
    ⛔ THE THREE-STATE RETURN IS LOAD-BEARING. An empty set says "the user has a
    chart and it holds no instances", which orphans every alert they own; `None`
    says "do not conclude anything", which is the honest reading of a store that
    did not answer. Collapsing them would flag every alert on the box the first
    time `auth.db` was busy.
    """
    try:
        from api.services import auth_service
        prefs = auth_service.get_user_preferences(str(user_id)) or {}
    except Exception:  # noqa: BLE001 - a diagnostic may not break a sweep
        return None
    found: set = set()
    seen_any = False
    for key in _INSTANCE_BLOBS:
        raw = prefs.get(key)
        if raw is None:
            continue
        try:
            blob = json.loads(raw) if isinstance(raw, str) else raw
        except (TypeError, ValueError):
            continue
        seen_any = True
        _walk_instance_ids(blob, found)
    return found if seen_any else None


def sweep_orphaned_instances(*, now: Optional[float] = None) -> dict:
    """⭐ SPEC §8, THE HALF THAT IS NOT ABOUT FIRING: an alert whose INSTANCE is gone.

    Deleting `RSI(7)` from the chart used to leave its alert armed, firing, and
    describing itself as "RSI" — indistinguishable on every surface from an
    alert bound to the `RSI(14)` still on the chart. **The alert keeps
    evaluating** (from the `params_json` snapshot, which is exactly why the
    snapshot exists) and it says so, which is the opposite of the silence the
    rest of this module exists to end.

    ⚠️ IT ALSO UN-FLAGS. An instance that comes back — an undo, a template
    re-applied, a workspace restored — clears the mark, so this reports the
    CURRENT binding rather than accumulating a scar.

    ⛔ ONE PREFERENCES READ PER USER PER SWEEP, not one per alert. The blob is a
    workspace layout and can be large.
    """
    now_i = _now(now)
    out = {"considered": 0, "checked": 0, "orphaned": 0, "cleared": 0}
    by_user: dict = {}
    for alert in list_active():
        out["considered"] += 1
        instance_id = alert.get("instance_id")
        if not instance_id:
            # An alert that names no instance cannot have lost one. Every alert
            # created before this column existed is in this branch, which is why
            # the migration does not have to guess a value for them.
            continue
        user_id = alert["user_id"]
        if user_id not in by_user:
            by_user[user_id] = chart_instance_ids(user_id)
        alive = by_user[user_id]
        if alive is None:
            continue
        out["checked"] += 1
        missing = instance_id not in alive
        already = alert.get("instance_missing_at") is not None
        if missing and not already:
            _set_instance_missing(alert["id"], now_i)
            out["orphaned"] += 1
        elif already and not missing:
            _set_instance_missing(alert["id"], None)
            out["cleared"] += 1
    return out


def _set_instance_missing(alert_id: int, at: Optional[int]) -> None:
    with _conn() as db:
        db.execute(
            "UPDATE indicator_alerts SET instance_missing_at=? WHERE id=?",
            (at, int(alert_id)),
        )


def sweep_silent_alerts(*, now: Optional[float] = None,
                        silent_after_sec: int = None) -> dict:
    """⭐ THE tzdata CASE, MADE VISIBLE — an alert that is ON and says NOTHING.

    `compute_vwap` RAISES rather than falling back to UTC when the IANA tz
    database is missing. That raise is deliberate and correct: a silent UTC
    fallback is the retired VWAP_SESSION_ANCHOR defect, measured at $14.45 at a
    session open. But `_evaluate_one` wraps every compute in try/except and
    logs, and `_run_one_cycle` then `continue`s **without writing anything at
    all** — not even `last_evaluated_at`. So on such a box every VWAP alert goes
    silent and a broken alert is byte-identical, on every surface, to a healthy
    one that simply has not triggered. **The raise is preserved. The silence is
    not.**

    ⛔ ITS OWN SWEEP, NOT A WRITE FROM `list_active()`. Putting the detection in
    the listing would have made the Task 6 SHADOW lane — which reads the same
    `list_active()` — write to `indicator_alerts`, and "the observer must not
    change the observed" is that lane's founding invariant, asserted by a
    whole-table byte-identity dump.

    ⚠️ AND IT IS NOT THE HOOK THIS WANTS TO BE. The precise place is
    `_run_one_cycle`'s `value is None` branch, which is the one caller that
    knows an alert was skipped THIS cycle. That file is Task 8's / Task 10's and
    a parallel agent was editing that exact function; the hand-back is one line
    calling `mark_needs_attention` there, and this sweep is what makes the state
    real in the meantime. The sweep is strictly more general — it also catches a
    silence no exception ever caused (a symbol with no stored bars, an address
    that resolves to nothing) — and strictly slower to notice.
    """
    window = _SILENT_AFTER_SEC if silent_after_sec is None else int(silent_after_sec)
    now_i = _now(now)
    out = {"considered": 0, "silent": 0, "flagged": 0}
    for alert in list_active():
        out["considered"] += 1
        seen = alert["last_evaluated_at"] or alert["created_at"] or 0
        if now_i - int(seen) < window:
            continue
        out["silent"] += 1
        state_at = alert["state_at"]
        if (alert["state"] in (STATE_NEEDS_ATTENTION, STATE_ERROR)
                and state_at is not None
                and now_i - int(state_at) < _DIAGNOSE_EVERY_SEC):
            # Already flagged and recently diagnosed. A warming alert produces
            # no value every cycle and its diagnosis does not change; paying for
            # a recompute per alert per sweep buys no new information.
            continue
        try:
            from api.services import indicator_alert_evaluator as ev
            bars = ev._fetch_bars_for_alert(alert["sym"], alert["tf"], 200)
            is_fault, detail = diagnose(alert, bars)
        except Exception as exc:  # noqa: BLE001 - the sweep survives one bad row
            is_fault, detail = True, f"{type(exc).__name__}: {exc}"
        if is_fault and detail:
            mark_needs_attention(alert["id"], detail, now=now_i)
            out["flagged"] += 1
    # ⚠️ RIDES THE SAME JOB DELIBERATELY. `api/main.py`'s 5-minute job calls this
    # one function, and that hunk belongs to Task 11; a second scheduler entry
    # for a second sweep would be a second thing to forget to register. Its
    # counters are merged under their own keys so neither sweep can be read as
    # the other.
    out.update({f"instance_{k}": v for k, v in
                sweep_orphaned_instances(now=now_i).items()})
    return out


def claim_delivery(alert_id: Optional[Any]) -> bool:
    """⭐ THE GATE `watchlist_alert_service.deliver_alert_payload` CONSULTS.

    True iff this alert has a recorded fire nobody has delivered yet — i.e.
    exactly when `record_trigger` landed a new row on this cycle. The check is a
    compare-and-set inside SQLite, so "delivered once per recorded fire" is an
    invariant of the database rather than an agreement between two functions.

    ⛔ WHY THE GUARD IS AT THE DELIVERY BOUNDARY AND NOT AT THE CALL SITE.
    `indicator_alert_evaluator._run_one_cycle` calls `record_trigger` and then
    `_dispatch_delivery` unconditionally, and gating it there would be the
    obvious two-line fix — but that file is Task 8's / Task 10's and a parallel
    agent was editing that exact function while this shipped. The delivery
    boundary turns out to be the better place regardless: it is the last point
    before a member's inbox, every channel is downstream of it, and a second
    caller of this lane inherits the guard instead of having to remember it.

    🔴 AND IT NOW REFUSES DURING A SNOOZE, WHICH IT DID NOT. `_run_one_cycle`
    DISCARDS `record_trigger`'s return value and calls `_dispatch_delivery`
    unconditionally — measured: `invoked 4 times while record_trigger returned
    [True, False, False, False]`. So delivery was gated by *"is there an
    undelivered fire row"* and not by the snooze, and a fire recorded BEFORE the
    snooze began was delivered inside the window. Measured on a real row:
    `claim_delivery` returned **True while the alert was snoozed**. That also
    refutes `alert_fired_log`'s claim that an older undelivered row "stays NULL
    forever rather than being delivered late" — it does not, it is claimed by the
    next cycle that produces one.

    ⛔ THE CALL SITE IS STILL WRONG AND IS NOT FIXED HERE. `indicator_alert_
    evaluator.py` is Task 8's file; the one-line fix there is
    `if ias.record_trigger(...): _dispatch_delivery(alert, value)`. This gate
    closes the CONSEQUENCE at the boundary every channel is downstream of, so
    the hole is shut either way and shutting it twice is harmless.

    ⚠️ FAILS **OPEN**, DELIBERATELY, IN BOTH DIRECTIONS — EXCEPT FOR A SNOOZE,
    WHICH IS NOT A FAILURE. An unidentifiable payload (no `alert_id`) or an
    unreachable store returns True, so a member may see a duplicate; the other
    failure — suppressing an alert we could not identify — is the one nobody can
    see and nobody can report, and this whole task exists because silence is the
    expensive direction. A live snooze window is the opposite case: the silence
    is what the user ASKED FOR, so it is the one refusal that is safe to make.
    """
    if alert_id is None:
        return True
    try:
        if snooze_active(get(int(alert_id))):
            return False
        return alert_fired_log.claim_delivery(int(alert_id))
    except Exception:  # noqa: BLE001 - see FAILS OPEN above
        import logging
        logging.getLogger(__name__).exception(
            "[alert-state] delivery claim failed for alert %s", alert_id)
        return True


# ─── history ─────────────────────────────────────────────────────────────────

def list_fires(user_id: str, limit: int = 50) -> list[dict]:
    """One user's fired history, newest first. Read-through to the fired log."""
    return alert_fired_log.list_fires(user_id, limit)
