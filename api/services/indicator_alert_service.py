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
)


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
    }


_COLS = (
    "id, user_id, sym, indicator, condition, threshold, tf, params_json, "
    "active, last_value, last_evaluated_at, triggered_at, trigger_count, created_at, "
    "state, state_detail, state_at, arm_epoch, snooze_until, last_fire_key, "
    "instance_id, instance_missing_at"
)


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
) -> int:
    """Create a new indicator alert. Returns the new alert ID.

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
    now = int(time.time())
    with _conn() as db:
        cur = db.execute(
            "INSERT INTO indicator_alerts "
            "(user_id, sym, indicator, condition, threshold, tf, params_json, "
            "active, trigger_count, created_at, state, state_at, arm_epoch, "
            "instance_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, 0, ?)",
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


def list_for_user(user_id: str) -> list[dict]:
    """This user's alerts, each NAMING THE INSTANCE it evaluates.

    ⭐ SPEC §8: *"instance named in alert rows ('RSI(7) crossed 70' vs
    'RSI(14)')"*. The label is computed by
    `indicator_alert_evaluator.instance_label` from the row's own `params_json`,
    so the name a user reads and the number the evaluator computes come from the
    SAME field. A label built in the frontend from a second table of parameter
    names is the twin this phase spent its whole budget retiring.
    """
    with _conn() as db:
        rows = db.execute(
            f"SELECT {_COLS} FROM indicator_alerts WHERE user_id=? ORDER BY created_at DESC",
            (str(user_id),),
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
    if state == STATE_SNOOZED:
        until = row["snooze_until"]
        if until is not None and now_i < int(until):
            return False
        # ⭐ AN EXPIRED SNOOZE RE-ARMS, EPISODE AND ALL. "Quiet for 15 minutes"
        # means the alert speaks again afterwards if it is still true — so the
        # key has to move, or the very condition the user snoozed would be the
        # one thing that can never come back.
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

    ⚠️ `needs_attention` / `error` DO NOT SUPPRESS. A value arrived and the
    condition is true; whatever was wrong is over. Firing clears the state.
    """
    now_i = _now(now)
    row = get(alert_id)
    if row is None:
        return False
    _touch_value(alert_id, last_value, now_i)

    if row["state"] == STATE_SNOOZED:
        until = row["snooze_until"]
        if until is not None and now_i < int(until):
            return False
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

    ⚠️ FAILS **OPEN**, DELIBERATELY, IN BOTH DIRECTIONS. An unidentifiable
    payload (no `alert_id`) or an unreachable store returns True, so a member
    may see a duplicate. The other failure — suppressing an alert we could not
    identify — is the one nobody can see and nobody can report, and this whole
    task exists because silence is the expensive direction.
    """
    if alert_id is None:
        return True
    try:
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
