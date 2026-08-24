"""CUTOVER WATCH -- the instrument that decides the ALERT_EVAL_MODE flip.

Run this ON THE PRODUCTION POD, repeatedly, during the session in which the
owner intends to flip `ALERT_EVAL_MODE` from "forming" to "closed". It answers
five questions in one call and it EXITS NON-ZERO when the answer is NO-GO, so a
runbook step can gate on it.

    1. Is the shadow lane actually OBSERVING DURING RTH?
    2. Per address, how do the two lanes DISAGREE today, on live tape -- and is
       every live disagreement already DECLARED in fire_diff_declared.json?
    3. Which ARMED alerts would change if the flip happened right now?
    4. Is anything ABOUT TO DELIVER?
    5. GO or NO-GO, with the reason, and the exit code follows.

--------------------------------------------------------------------------
WHY EVERY NUMBER IS PRINTED WITH ITS DENOMINATOR
--------------------------------------------------------------------------
This programme has shipped three instruments that stayed green while what they
watched was broken, and every one of them reported a ZERO that could not be told
apart from "nothing was measured":

  * `alert_soak_matrix --verify` read `deliverable_now` off the STATE STRING, so
    it printed 0 right up to the cycle that would have sent the emails. The
    snooze lives in `snooze_until`; the state column is a proxy six code paths
    rewrite.
  * the soak looked well-exercised at 8,130 rows -- and every one of them was
    recorded after 16:52 ET, so the lane had never once seen a forming bar.
  * `diagnose()` calls the FORMING resolver regardless of `eval_mode()`, so
    after the flip it reports `ichimoku.chikou` healthy while it is permanently
    silent (measured: forming 219.0 / closed None / diagnose -> (False, None)).

So: this tool NEVER prints a shadow-row total without the RTH count beside it,
and the verdict reads ONLY the RTH count; it never prints a disagreement count
without the number of alerts actually evaluated on BOTH lanes; and it never
prints "0 deliverable" without the number of armed rows that produced that zero.

--------------------------------------------------------------------------
WHAT IT READS, AND HOW IT KNOWS THE NAMES
--------------------------------------------------------------------------
READ-ONLY, ALWAYS. Both stores are opened through `file:...?mode=ro` URIs plus
`PRAGMA query_only=1`, so a mistake in this file cannot write the table the live
evaluator is reading. It calls no writer in `indicator_alert_service`, no
`record_*`, no delivery hook.

NO IDENTIFIER IN THIS FILE IS TYPED FROM MEMORY. Five false alarms in one
session came from typed names (`alert_shadow_log` for the table
`alert_shadow_fires`; `is_active` for `active`; `?sym=` for a path param;
`cols=ticker` for `CreatedDate`). So:

  * table names are parsed out of each MODULE'S OWN `_SCHEMA` and then asserted
    present in `sqlite_master`;
  * the alert column list is `indicator_alert_service._COLS` and rows are shaped
    by `indicator_alert_service._row_to_dict` -- the same two objects
    `list_active()` uses, so "what this tool calls an armed alert" is what the
    evaluator calls one by construction, not by agreement. The test asserts the
    two return EQUAL lists;
  * addresses come from `indicator_alert_evaluator.all_addresses()`, the one
    enumeration, which spans all three partitions.

--------------------------------------------------------------------------
WHICH RESOLVERS IT USES, AND WHY NOT `diagnose()`
--------------------------------------------------------------------------
`indicator_alert_service.diagnose()` IS MODE-BLIND -- it calls
`indicator_alert_evaluator.address_value` (the FORMING resolver) with no `mode`
parameter and no `eval_mode()` consult. Nothing here reads it.

This tool drives BOTH SHIPPED LANES EXPLICITLY, on the same bars, at the same
instant:

    forming :  indicator_alert_evaluator._evaluate_one(alert, bars,
                                                       mode="forming")
               -> value_function(address) -> alert_series (last NON-None)
    closed  :  indicator_alert_evaluator._evaluate_one_closed(alert, bars)
               -> alert_series.series_for(...)[closed_bar_index] (last ELEMENT)

`mode=` is passed explicitly on the forming side on purpose: this tool must
report the same two lanes BEFORE and AFTER the flip, and a call that asked
`eval_mode()` would silently start reporting closed-vs-closed the moment the
constant moved -- a diff that reads 0 for the same reason a broken instrument
does.

--------------------------------------------------------------------------
USAGE
--------------------------------------------------------------------------
    /opt/venv/bin/python /app/tools/cutover_watch.py            # human report
    /opt/venv/bin/python /app/tools/cutover_watch.py --json     # machine
    /opt/venv/bin/python /app/tools/cutover_watch.py --self-test

Exit code: 0 = GO, 1 = NO-GO, 2 = the tool could not run at all.
Runbook (pod command + what each number means + the rollback):
`docs/runbooks/cutover-watch.md`.
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timedelta
from typing import Any, Callable, Optional
from urllib.request import pathname2url


def _repo_root() -> str:
    """The tree that holds `api/services`, however this file was invoked.

    It is NOT always `dirname(dirname(__file__))`: before the branch merges the
    operator copies this single file onto the pod and runs it from `/tmp`; after
    the merge it lives at `/app/tools/`. Both must work, so the root is SEARCHED
    for rather than computed, with an env override on top.
    """
    override = os.environ.get("UCT_APP_ROOT")
    if override and os.path.isdir(os.path.join(override, "api", "services")):
        return override
    here = os.path.dirname(os.path.abspath(__file__))
    for cand in (os.path.dirname(here), here, os.getcwd(), "/app"):
        if cand and os.path.isdir(os.path.join(cand, "api", "services")):
            return cand
    return os.path.dirname(here)


sys.path.insert(0, _repo_root())

from api.services import alert_series                        # noqa: E402
from api.services import alert_shadow_log as shadow          # noqa: E402
from api.services import indicator_alert_evaluator as ev     # noqa: E402
from api.services import indicator_alert_service as ias      # noqa: E402
from api.services import indicator_compute as ic             # noqa: E402


# ─── the window ──────────────────────────────────────────────────────────────
#
# 09:30-16:00 ET, AS MINUTES PAST ET MIDNIGHT, RESOLVED PER INSTANT. The zone
# comes from `indicator_compute._et_zone()` -- the same IANA lookup the VWAP
# anchor uses, never a module-load offset -- so a row recorded in EST and one
# recorded in EDT are each classified against their own day's offset.
#
# HALF DAYS ARE A KNOWN, NAMED BOUND. The US market closes 13:00 ET on a handful
# of days a year; this window would count 13:00-16:00 rows on such a day as RTH.
# That is the GENEROUS direction (it can only make the RTH count too high, never
# too low), it is visible in the per-session-day table, and 2026-08-07 -- the
# cutover day -- is a full session.
RTH_OPEN_MINUTE = 9 * 60 + 30
RTH_CLOSE_MINUTE = 16 * 60

SESSION_BUCKETS: tuple[str, ...] = ("rth", "pre", "post", "weekend")

# How old the newest shadow row may be before the lane counts as stopped. The
# cron is `IntervalTrigger(seconds=60)`; five cycles is the same "one missed
# cycle is a transient, five in a row is a fault" rule `_SILENT_AFTER_SEC` uses.
STALE_SHADOW_SEC = 300

# The smallest number of RTH rows that answers "the lane has observed a forming
# bar during regular hours". One distinguishes OBSERVED from NEVER, which is the
# question; `--min-rth-rows` raises it.
MIN_RTH_ROWS = 1

# Two lane values are "the same number" below this. Anything larger means the
# member would be told a different figure after the flip.
VALUE_EPS = 1e-9

# `alert_soak_matrix.EXPIRY_WARN_DAYS`, same horizon, so the two tools cannot
# disagree about when the muzzle is running out.
MUZZLE_WARN_DAYS = 7


# ─── the accounted-for casualty ──────────────────────────────────────────────
#
# `ichimoku.chikou` IS EXPECTED TO BE CLOSED-LANE SILENT AND IT IS NOT A DEFECT.
# `indicator_compute` writes bar i's close to index i-26
# (`chikou[i - displacement] = bars[i]["c"]`), so the newest 26 elements of the
# column are None forever. The forming lane reads the last NON-None element and
# finds a number 26 bars back; the closed lane reads the element AT the judged
# bar and finds None. Confirmed four independent ways:
#
#   1. Task 5's closed-bar analysis -- the 26-bar trailing pad, pinned in
#      `tests/test_indicator_golden.py` as TRAILING_PAD;
#   2. Task 6's declared diff -- lost 19,574 / gained 0, every one `vanished`;
#   3. the LIVE production shadow lane -- 31 armed, 30 distinct alert_ids
#      observed, and the absentee is exactly `id 29 SPY 5 ichimoku.chikou`;
#   4. this tool's own shape probe, which finds it is the ONLY address in
#      `all_addresses()` whose column carries a trailing pad at all.
#
# The owner was shown this consequence explicitly and accepted it (2026-08-06):
# those alerts stop firing permanently at the flip.
#
# THE ENTRY IS KEYED ON (ADDRESS, SHAPE), NEVER ON THE ADDRESS ALONE. A row that
# forgave `ichimoku.chikou` for ANY reason would forgive a future defect that
# happened to land on the same address. `trailing_pad` is the mechanism above;
# `warmup_boundary` -- silent because the judged bar sits inside the indicator's
# warm-up while a LATER bar has a value -- is a different fault with a different
# remedy, and chikou appearing under it is a NO-GO.
ACCOUNTED_CLOSED_LANE_SILENCE: dict[str, dict] = {
    "ichimoku.chikou": {
        "shape": "trailing_pad",
        "expected_pad": 26,
        "reason": (
            "the Chikou span plots bar i's close 26 bars BACK, so the newest 26 "
            "elements of the column are None by construction and the closed "
            "lane has no value at the bar it judges. Owner-accepted 2026-08-06: "
            "these alerts stop firing permanently at the flip."),
    },
}


# ─── the verdict vocabulary ──────────────────────────────────────────────────
#
# DECLARED AS DATA SO THE SELF-TEST CAN ASSERT TOTALITY. `--self-test` forces
# each of these and asserts the exit code follows; it then compares the set it
# forced against THIS TUPLE and fails if a branch was added without a case. A
# gate whose coverage is a list somebody remembered to extend is a list, not a
# rail -- which is exactly how four `dpc` constants rode uncovered for the whole
# lifetime of the rule they belonged to.
NOGO_REASONS: tuple[str, ...] = (
    "pod-code-too-old",
    "cannot-read-store",
    "no-armed-alerts",
    "no-rth-shadow-rows",
    "shadow-lane-stale",
    "no-live-evaluation",
    "lanes-compared-off-a-closed-bar",
    "undeclared-disagreement",
    "unexpected-closed-lane-silence",
    "deliverable-now",
    "soak-muzzle-expiring",
    "eval-mode-lever-misconfigured",
)


# ─── plumbing ────────────────────────────────────────────────────────────────

def _ascii(text: str) -> str:
    """Every printed line, sanitised.

    cp1252 HAS KILLED A HARNESS'S OWN STDOUT MID-RUN ON THIS PROJECT twice, and
    once it left a mutation applied on disk. An instrument whose output can raise
    is an instrument that can report nothing while everything is fine.
    """
    return str(text).encode("ascii", "replace").decode("ascii")


def _say(text: str = "") -> None:
    sys.stdout.write(_ascii(text) + "\n")


def ro_connect(path: str) -> sqlite3.Connection:
    """A `mode=ro` URI connection. It cannot write, whatever this file does."""
    uri = "file:{}?mode=ro".format(pathname2url(os.path.abspath(path)))
    conn = sqlite3.connect(uri, uri=True, timeout=10.0)
    conn.execute("PRAGMA query_only=1")
    return conn


_CREATE_TABLE_RE = re.compile(
    r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\"'`\[]?(\w+)", re.IGNORECASE)


def table_from_module_schema(schema_sql: str) -> str:
    """The table name a module DECLARES, read out of its own `_SCHEMA`.

    Never typed here. `alert_shadow_log`'s table is `alert_shadow_fires` while
    the MODULE is `alert_shadow_log`; probing production for the module name got
    "no such table", which reads exactly like the soak being dead.
    """
    m = _CREATE_TABLE_RE.search(schema_sql or "")
    if not m:
        raise ValueError("no CREATE TABLE in the module schema")
    return m.group(1)


def sqlite_master_tables(conn: sqlite3.Connection) -> set:
    return {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}


def live_columns(conn: sqlite3.Connection, table: str) -> list:
    return [r[1] for r in conn.execute(
        "PRAGMA table_info({})".format(table)).fetchall()]


def module_alert_columns() -> list:
    """`indicator_alert_service._COLS`, split -- the module's own select list."""
    return [c.strip() for c in ias._COLS.split(",") if c.strip()]


SHADOW_FIELDS: tuple[str, ...] = (
    "alert_id", "bar_index", "value", "triggered", "recorded_at")


class StoreError(RuntimeError):
    """The store could not be read in the shape its own module declares."""


# ─── preflight: is the POD running the code this instrument measures? ────────
#
# THIS FIRED FOR REAL ON THE FIRST PRODUCTION RUN. The pod did not have
# `indicator_alert_service.snooze_active` -- the durable snooze had not shipped
# yet -- and without this check the tool crashed with an AttributeError, which
# reads like a broken instrument rather than like a stale deployment.
#
# It matters far more than a crash: `deliverable_now` on a pod without
# `snooze_active` can ONLY be computed from the state string, which is the exact
# proxy that reported 0 right up to the emails. So the honest answer is to
# REFUSE, name the missing accessor and exit non-zero -- never to quietly fall
# back to the number that was wrong.
#
# Every name below is one this tool actually calls; adding a call without adding
# its name here means the crash comes back, which is why the test derives the
# list from the source rather than trusting it.
REQUIRED_ACCESSORS: tuple = (
    ("indicator_alert_service", "_SCHEMA"),
    ("indicator_alert_service", "_COLS"),
    ("indicator_alert_service", "_row_to_dict"),
    ("indicator_alert_service", "snooze_active"),
    ("indicator_alert_service", "STATE_SNOOZED"),
    ("indicator_alert_service", "db_path"),
    ("indicator_alert_evaluator", "ALERT_EVAL_MODE"),
    ("indicator_alert_evaluator", "eval_mode"),
    ("indicator_alert_evaluator", "eval_mode_report"),
    ("indicator_alert_evaluator", "all_addresses"),
    ("indicator_alert_evaluator", "resolve_address"),
    ("indicator_alert_evaluator", "_parse_params"),
    ("indicator_alert_evaluator", "_evaluate_one"),
    ("indicator_alert_evaluator", "_evaluate_one_closed"),
    ("indicator_alert_evaluator", "closed_bar_index"),
    ("indicator_alert_evaluator", "_fetch_bars_for_alert"),
    ("alert_shadow_log", "_SCHEMA"),
    ("alert_shadow_log", "db_path"),
    ("alert_shadow_log", "DECLARED_DIFF_PATH"),
    ("alert_shadow_log", "declared_diff"),
    ("alert_shadow_log", "declared_covers"),
    ("alert_shadow_log", "declaration_index"),
    ("alert_series", "series_for"),
    ("indicator_compute", "_et_zone"),
)

#: The alias each module is imported under, so a rail can walk this file's own
#: AST and prove the list above is COMPLETE rather than merely plausible.
MODULE_ALIASES: dict = {"ias": "indicator_alert_service",
                        "ev": "indicator_alert_evaluator",
                        "shadow": "alert_shadow_log",
                        "alert_series": "alert_series",
                        "ic": "indicator_compute"}

_MODULES = {"indicator_alert_service": ias,
            "indicator_alert_evaluator": ev,
            "alert_shadow_log": shadow,
            "alert_series": alert_series,
            "indicator_compute": ic}

#: The functions that produce a REPORT (as opposed to the self-test fixture,
#: which legitimately calls writers like `ias.create`). Named, so the rail walks
#: `FunctionDef`s BY NAME -- `inspect.getsource` returned the wrong slice on this
#: repo once because a co-worker inserted 180 lines above the function.
REPORT_PATH_FUNCTIONS: tuple = (
    "build_report", "read_active_alerts", "read_shadow_rows", "shadow_report",
    "session_bucket", "lane_report", "_lane_pair", "declaration_check",
    "silence_shape", "silence_report", "delivery_report", "verdict", "render",
    "module_alert_columns", "missing_accessors", "lever_report", "main",
)


def missing_accessors() -> list:
    """Names this tool calls that the DEPLOYED modules do not have."""
    return ["{}.{}".format(mod, attr) for mod, attr in REQUIRED_ACCESSORS
            if not hasattr(_MODULES[mod], attr)]


def lever_report() -> dict:
    """The ROLLBACK LEVER's state: is an environment override deciding the lane?

    `ALERT_EVAL_MODE` can be overridden from the Railway dashboard without a
    deploy. That was the only mitigation available inside the 09:15-16:20 ET push
    freeze (removed 2026-08-24), and it is still the only one that skips a
    ~10-minute build. That makes "the constant" and "the lane that is running" two
    different questions, so this tool has to report BOTH and say which one an
    operator is looking at.

    ⚠️ IT ASKS THE EVALUATOR, IT DOES NOT RE-DERIVE THE ANSWER. A tool that read
    the environment itself and applied its own rules would report the lane it
    THINKS is running -- and on a pod whose code predates the lever that answer
    would be confidently wrong. `eval_mode_report()["effective"]` IS
    `eval_mode()`, the same call the evaluator makes.

    Read through `getattr` (like `ALERT_EVAL_MODE` above) so a pod running code
    older than this instrument produces `lever_known: False` and a
    `pod-code-too-old` refusal, rather than an AttributeError that reads like a
    broken instrument.
    """
    fn = getattr(ev, "eval_mode_report", None)
    if fn is None:
        return {"lever_known": False,
                "note": ("this deployment predates the environment override, so "
                         "the lane is the committed constant and there is no "
                         "no-deploy rollback on this pod")}
    out = dict(fn())
    out["lever_known"] = True
    return out


def read_active_alerts(auth_db: str) -> list:
    """`list_active()`, read-only, off a `mode=ro` connection.

    Deliberately the SAME `_COLS` string, the SAME `active=1 ORDER BY id`, and
    the SAME `_row_to_dict` mapper the service uses, so this cannot drift into a
    second answer to "what is armed".
    """
    table = table_from_module_schema(ias._SCHEMA)
    with contextlib.closing(ro_connect(auth_db)) as conn:
        if table not in sqlite_master_tables(conn):
            raise StoreError(
                "{}: sqlite_master has no table {!r} (the module declares it)"
                .format(auth_db, table))
        have = set(live_columns(conn, table))
        missing = [c for c in module_alert_columns() if c not in have]
        if missing:
            raise StoreError(
                "{}.{}: the module selects columns this database does not have: "
                "{} -- refusing to guess a narrower row".format(
                    auth_db, table, ", ".join(missing)))
        rows = conn.execute(
            "SELECT {} FROM {} WHERE active=1 ORDER BY id".format(
                ias._COLS, table)).fetchall()
    return [ias._row_to_dict(r) for r in rows]


def read_shadow_rows(shadow_db: str) -> list:
    """Every shadow observation, oldest first. Read-only."""
    table = table_from_module_schema(shadow._SCHEMA)
    with contextlib.closing(ro_connect(shadow_db)) as conn:
        if table not in sqlite_master_tables(conn):
            raise StoreError(
                "{}: sqlite_master has no table {!r} (the module declares it)"
                .format(shadow_db, table))
        have = live_columns(conn, table)
        missing = [c for c in SHADOW_FIELDS if c not in have]
        if missing:
            raise StoreError("{}.{}: missing column(s) {}".format(
                shadow_db, table, ", ".join(missing)))
        rows = conn.execute("SELECT {} FROM {} ORDER BY recorded_at".format(
            ", ".join(SHADOW_FIELDS), table)).fetchall()
    return [dict(zip(SHADOW_FIELDS, r)) for r in rows]


# ─── 1. the shadow lane, inside RTH specifically ─────────────────────────────

def session_bucket(recorded_at: Any, zone) -> str:
    """One row -> `rth` | `pre` | `post` | `weekend`, on the ET calendar.

    THIS FUNCTION IS THE WHOLE POINT OF SECTION 1 AND IT HAS A MUTATION AIMED AT
    IT. Today's 8,130 shadow rows were ALL recorded after 16:52 ET, and a naive
    total made the soak look well-exercised when it had never observed a forming
    bar. If this ever counts an after-hours row as RTH,
    `test_after_hours_only_rows_are_never_counted_as_rth` fails and the
    `no-rth-shadow-rows` self-test case stops firing.
    """
    dt = datetime.fromtimestamp(int(recorded_at), tz=zone)
    if dt.weekday() >= 5:
        return "weekend"
    minute = dt.hour * 60 + dt.minute
    if minute < RTH_OPEN_MINUTE:
        return "pre"
    if minute >= RTH_CLOSE_MINUTE:
        return "post"
    return "rth"


def shadow_report(rows: list, zone, now: float) -> dict:
    """The shadow lane, with the RTH count as a SEPARATE, first-class number."""
    counts = {b: 0 for b in SESSION_BUCKETS}
    per_day: dict = {}
    rth_alerts, all_alerts = set(), set()
    rth_triggered = 0
    for r in rows:
        bucket = session_bucket(r["recorded_at"], zone)
        counts[bucket] += 1
        day = datetime.fromtimestamp(
            int(r["recorded_at"]), tz=zone).strftime("%Y-%m-%d")
        d = per_day.get(day)
        if d is None:
            d = {b: 0 for b in SESSION_BUCKETS}
            d.update({"total": 0, "alerts": set()})
            per_day[day] = d
        d[bucket] += 1
        d["total"] += 1
        all_alerts.add(r["alert_id"])
        if bucket == "rth":
            rth_alerts.add(r["alert_id"])
            d["alerts"].add(r["alert_id"])
            if r.get("triggered"):
                rth_triggered += 1

    total = len(rows)
    newest = max((int(r["recorded_at"]) for r in rows), default=None)
    oldest = min((int(r["recorded_at"]) for r in rows), default=None)
    today = datetime.fromtimestamp(now, tz=zone).strftime("%Y-%m-%d")

    # THE PARTITION IS ASSERTED, NOT ASSUMED. rth+pre+post+weekend must equal the
    # total; if it does not, the classifier has a hole and every number under it
    # is unsafe to read. A silently dropped bucket is how a filter becomes a
    # sieve.
    partition_ok = sum(counts.values()) == total

    return {
        "db_path": shadow.db_path(),
        "enabled_env": os.environ.get("ALERT_SHADOW_ENABLED", "0") == "1",
        "total_rows": total,
        "rth_rows": counts["rth"],
        "pre_rows": counts["pre"],
        "post_rows": counts["post"],
        "weekend_rows": counts["weekend"],
        "partition_holds": partition_ok,
        "rth_rows_today": per_day.get(today, {}).get("rth", 0),
        "rth_distinct_alerts": len(rth_alerts),
        "rth_triggered_rows": rth_triggered,
        "distinct_alerts_any_time": len(all_alerts),
        "rth_session_days": sorted(d for d, v in per_day.items() if v["rth"] > 0),
        "newest_recorded_at": newest,
        "newest_age_sec": None if newest is None else int(now - newest),
        "oldest_recorded_at": oldest,
        "per_day": {
            d: {"total": v["total"], "rth": v["rth"], "pre": v["pre"],
                "post": v["post"], "weekend": v["weekend"],
                "rth_distinct_alerts": len(v["alerts"])}
            for d, v in sorted(per_day.items())},
    }


# ─── 2 + 3. the two lanes, on live tape, per address ─────────────────────────

#: The real bar fetch, as a module attribute so a test can assert BY IDENTITY
#: that the default is the shipped one. `lesson_injected_dependency_hides_the_
#: fetch`: 996 green tests once shipped a feature that made zero real fetches
#: because every one of them injected a stub. The PRODUCTION RUN recorded in the
#: report is what exercises this for real; the identity assertion is what stops
#: the default quietly becoming something else.
BARS_PROVIDER: Callable[..., list] = ev._fetch_bars_for_alert

LANE_KINDS: tuple[str, ...] = (
    "gained", "lost", "shifted", "quiet-but-different", "identical",
    "closed-silent", "forming-silent", "no-closed-bar", "silent-both", "error")

#: The kinds where the alert's OUTCOME changes at the flip, as opposed to the
#: number moving while the alert stays quiet either way.
CHANGING_KINDS: tuple[str, ...] = ("gained", "lost", "shifted", "closed-silent")


def _lane_pair(alert: dict, bars: list, now_epoch: float) -> dict:
    """Both shipped lanes, same bars, same instant. Never `diagnose()`."""
    out: dict = {"id": alert.get("id"), "sym": alert.get("sym"),
                 "tf": alert.get("tf"),
                 "address": ev.resolve_address(alert.get("indicator")),
                 "condition": alert.get("condition"), "error": None}
    try:
        f_value, f_trig = ev._evaluate_one(alert, bars=bars, mode="forming")
    except Exception as exc:                                  # noqa: BLE001
        out["error"] = "forming: {}: {}".format(type(exc).__name__, exc)
        out["kind"] = "error"
        return out
    try:
        c_value, c_trig, c_index = ev._evaluate_one_closed(
            alert, bars=bars, now_epoch=now_epoch)
    except Exception as exc:                                  # noqa: BLE001
        out["error"] = "closed: {}: {}".format(type(exc).__name__, exc)
        out["kind"] = "error"
        return out

    out.update({"forming_value": f_value, "forming_triggered": bool(f_trig),
                "closed_value": c_value, "closed_triggered": bool(c_trig),
                "closed_bar_index": c_index})

    if f_value is None and c_value is None:
        # TWO DIFFERENT SILENCES, AND ONLY ONE IS ABOUT THE ADDRESS.
        # `closed_bar_index is None` means the lane never reached the column (no
        # closed bar in the window, or an unknown address); a number means it
        # judged a bar and the column had nothing there.
        out["kind"] = "silent-both"
    elif f_value is not None and c_value is None:
        out["kind"] = "closed-silent" if c_index is not None else "no-closed-bar"
    elif f_value is None and c_value is not None:
        out["kind"] = "forming-silent"
    elif f_trig and not c_trig:
        out["kind"] = "lost"
    elif c_trig and not f_trig:
        out["kind"] = "gained"
    elif abs(float(f_value) - float(c_value)) > VALUE_EPS:
        out["kind"] = "shifted" if f_trig else "quiet-but-different"
    else:
        out["kind"] = "identical"
    return out


def lane_report(alerts: list, now_epoch: float,
                bars_provider: Optional[Callable] = None) -> dict:
    """Drive both lanes for every armed alert, grouped by (sym, tf).

    The grouping is the evaluator's own -- one bar fetch per (sym, tf) -- which
    is why 31 armed alerts cost ONE fetch and not 31. The bars are returned so
    the silence classifier reuses them instead of paying for a second fetch.
    """
    provider = bars_provider or BARS_PROVIDER
    groups: dict = {}
    for a in alerts:
        groups.setdefault((a["sym"], a["tf"]), []).append(a)

    per_alert: list = []
    fetch_errors: list = []
    group_bars: dict = {}
    bars_by_alert: dict = {}
    group_state: dict = {}
    for key in sorted(groups):
        sym, tf = key
        try:
            bars = provider(sym, tf, 200) or []
        except Exception as exc:                              # noqa: BLE001
            fetch_errors.append("{}/{}: {}: {}".format(
                sym, tf, type(exc).__name__, exc))
            bars = []
        group_bars[key] = bars
        # ⭐⭐ THE DENOMINATOR FOR SECTIONS 2 AND 3, AND IT IS EASY TO MISS.
        # If the newest bar has already CLOSED, `closed_bar_index` IS the newest
        # index, so the closed lane and the forming lane read the SAME element
        # and every disagreement count is structurally zero. Outside RTH that is
        # always the case -- the first production run of this tool reported
        # "identical 30, would change 1" at 22:00 ET and none of those thirty
        # zeros meant the lanes agree. A comparison taken with no forming bar in
        # the window is a comparison of a thing with itself.
        judged = (ev.closed_bar_index(bars, tf, now_epoch) if bars else -1)
        group_state[key] = {
            "bars": len(bars), "judged_index": judged,
            "newest_index": len(bars) - 1,
            "newest_bar_is_open": bool(bars) and judged < len(bars) - 1,
        }
        for alert in groups[key]:
            bars_by_alert[alert["id"]] = bars
            row = _lane_pair(alert, bars, now_epoch)
            row["bars"] = len(bars)
            per_alert.append(row)

    kinds = {k: 0 for k in LANE_KINDS}
    for r in per_alert:
        kinds[r["kind"]] += 1

    per_address: dict = {}
    for r in per_alert:
        a = per_address.get(r["address"])
        if a is None:
            a = {"alerts": 0, "forming_valued": 0, "closed_valued": 0,
                 "gained": 0, "lost": 0, "shifted": 0, "closed_silent": 0,
                 "identical": 0, "errors": 0}
            per_address[r["address"]] = a
        a["alerts"] += 1
        if r["kind"] == "error":
            a["errors"] += 1
            continue
        if r.get("forming_value") is not None:
            a["forming_valued"] += 1
        if r.get("closed_value") is not None:
            a["closed_valued"] += 1
        if r["kind"] in ("gained", "lost", "shifted"):
            a[r["kind"]] += 1
        elif r["kind"] == "closed-silent":
            a["closed_silent"] += 1
        elif r["kind"] == "identical":
            a["identical"] += 1

    return {
        "armed": len(alerts),
        "groups": len(groups),
        "bars_fetched": {"{}/{}".format(s, t): len(b)
                         for (s, t), b in sorted(group_bars.items())},
        "group_state": {"{}/{}".format(s, t): v
                        for (s, t), v in sorted(group_state.items())},
        # If this is 0 the two lanes judged the SAME bar everywhere, so every
        # disagreement count below is a zero that could not have been anything
        # else.
        "groups_with_an_open_bar": sum(
            1 for v in group_state.values() if v["newest_bar_is_open"]),
        "fetch_errors": fetch_errors,
        # THE DENOMINATORS. "0 disagreements" is only meaningful beside the
        # number of alerts that produced a value on BOTH lanes -- without it, a
        # dead bar fetch and two lanes in perfect agreement print the same 0.
        "evaluated_forming": sum(
            1 for r in per_alert if r.get("forming_value") is not None),
        "evaluated_closed": sum(
            1 for r in per_alert if r.get("closed_value") is not None),
        "evaluated_both": sum(
            1 for r in per_alert
            if r.get("forming_value") is not None
            and r.get("closed_value") is not None),
        "kinds": kinds,
        "would_change": sum(kinds[k] for k in CHANGING_KINDS),
        "per_address": per_address,
        "per_alert": per_alert,
        "_bars_by_alert": bars_by_alert,
    }


def declaration_check(lanes: dict) -> dict:
    """Every live (address, direction) against Task 6's declared diff.

    `gained` = the closed lane fires where forming does not; `lost` = the forming
    lane fires where closed does not -- the declaration's own vocabulary, read
    through `alert_shadow_log.declared_covers` so there is ONE implementation of
    "is this covered" and its negative control
    (`test_declared_covers_REFUSES_an_address_it_has_never_heard_of`) is a
    control over this question too.

    `closed-silent` IS REPORTED AS `lost`. An alert whose closed lane has no
    value stops firing, which is what a member experiences as a lost fire, and
    Task 6 declared `ichimoku.chikou` under exactly that direction (lost 19,574
    / gained 0, all `vanished`).
    """
    try:
        declared = shadow.declared_diff()
    except Exception as exc:                                  # noqa: BLE001
        return {"available": False,
                "error": "{}: {}".format(type(exc).__name__, exc),
                "observed_groups": 0, "undeclared": [], "declared_rows": 0}

    observed: dict = {}
    for address, a in lanes["per_address"].items():
        for direction, n in (("gained", a["gained"]),
                             ("lost", a["lost"] + a["closed_silent"])):
            if n:
                observed[(address, direction)] = n

    undeclared = []
    for key in sorted(observed):
        address, direction = key
        if not shadow.declared_covers(declared, address, direction):
            undeclared.append({
                "address": address, "direction": direction,
                "count": observed[key],
                "message": (
                    "{} live {} disagreement(s) on {!r} that "
                    "fire_diff_declared.json has never heard of".format(
                        observed[key], direction, address))})

    index = shadow.declaration_index(declared)
    return {
        "available": True,
        "path": shadow.DECLARED_DIFF_PATH,
        "declared_rows": len(index),
        "declared_addresses": len({a for a, _ in index}),
        "observed_groups": len(observed),
        "observed": {"{}|{}".format(a, d): n
                     for (a, d), n in sorted(observed.items())},
        "undeclared": undeclared,
    }


# ─── the closed-lane silence classifier ──────────────────────────────────────

def silence_shape(address: str, bars: list, params: dict,
                  judged_index: Optional[int]) -> dict:
    """WHY this address had no value at the judged bar. Measured, not assumed.

    Two mechanisms, and they are not the same fault:

      `trailing_pad`    -- the column's newest N elements are None for good
                           (`ichimoku.chikou`, N=26). Permanent: the alert can
                           never fire closed-bar.
      `warmup_boundary` -- the judged bar sits inside the indicator's warm-up
                           while a LATER bar already has a value. Transient, and
                           it means the bar window is too short for that
                           indicator on that symbol -- a different remedy.

    `all_none` cannot reach here (this is only called for alerts whose FORMING
    lane produced a value) but is classified anyway rather than assumed away.
    """
    out: dict = {"address": address, "shape": "unknown", "trailing_pad": None,
                 "series_len": None, "non_none": None,
                 "judged_index": judged_index}
    try:
        series = alert_series.series_for(address, bars, params)
    except Exception as exc:                                  # noqa: BLE001
        out["shape"] = "compute-raised"
        out["error"] = "{}: {}".format(type(exc).__name__, exc)
        return out
    out["series_len"] = len(series)
    non_none = [i for i, v in enumerate(series) if v is not None]
    out["non_none"] = len(non_none)
    if not non_none:
        out["shape"] = "all_none"
        return out
    pad = len(series) - 1 - non_none[-1]
    out["trailing_pad"] = pad
    out["first_value_index"] = non_none[0]
    if pad > 0:
        out["shape"] = "trailing_pad"
    elif judged_index is not None and 0 <= judged_index < len(series) \
            and series[judged_index] is not None:
        # Not silent at all -- reported honestly rather than forced into one of
        # the fault shapes, so a caller cannot read a fault out of a healthy
        # column.
        out["shape"] = "value_present_at_judged_bar"
    elif judged_index is not None and judged_index < non_none[0]:
        out["shape"] = "warmup_boundary"
    else:
        out["shape"] = "gap_at_judged_bar"
    return out


def silence_report(lanes: dict, alerts: list, accounted: dict) -> dict:
    """Which addresses go silent on the closed lane, and is each one accounted?

    THE ACCOUNTED SET IS MATCHED ON (ADDRESS, SHAPE). `ichimoku.chikou` with a
    26-element trailing pad is the owner-accepted casualty. The SAME address
    silent for a DIFFERENT reason is not covered by that acceptance, and neither
    is any other address going silent for any reason at all.
    """
    by_id = {a["id"]: a for a in alerts}
    bars_by_alert = lanes.get("_bars_by_alert") or {}
    seen: dict = {}
    for r in lanes["per_alert"]:
        if r["kind"] != "closed-silent":
            continue
        alert = by_id.get(r["id"]) or {}
        shape = silence_shape(r["address"], bars_by_alert.get(r["id"], []),
                              ev._parse_params(alert), r.get("closed_bar_index"))
        entry = seen.get(r["address"])
        if entry is None:
            entry = {"address": r["address"], "alerts": 0, "shapes": {},
                     "example_alert_id": r["id"]}
            seen[r["address"]] = entry
        entry["alerts"] += 1
        entry["shapes"][shape["shape"]] = shape

    accounted_rows, unexpected = [], []
    for address in sorted(seen):
        entry = seen[address]
        spec = accounted.get(address)
        shapes = sorted(entry["shapes"])
        if spec and shapes == [spec["shape"]]:
            pad = entry["shapes"][spec["shape"]].get("trailing_pad")
            entry["accounted"] = True
            entry["expected_shape"] = spec["shape"]
            entry["observed_pad"] = pad
            entry["expected_pad"] = spec.get("expected_pad")
            entry["reason"] = spec["reason"]
            entry["pad_matches"] = (spec.get("expected_pad") is None
                                    or pad == spec.get("expected_pad"))
            accounted_rows.append(entry)
            if not entry["pad_matches"]:
                unexpected.append({
                    "address": address,
                    "message": (
                        "{!r} is closed-lane silent with a trailing pad of {} but "
                        "the accounted-for casualty is a pad of {} -- the "
                        "mechanism changed, so the acceptance does not cover it"
                        .format(address, pad, spec.get("expected_pad")))})
        else:
            entry["accounted"] = False
            unexpected.append({
                "address": address,
                "message": (
                    "{!r} is CLOSED-LANE SILENT on live tape ({} armed alert(s), "
                    "shape {}) and is NOT an accounted-for casualty. Only {} is. "
                    "At the flip these alerts stop firing and nobody has decided "
                    "that.".format(
                        address, entry["alerts"], ", ".join(shapes) or "unknown",
                        ", ".join(sorted(accounted)) or "(nothing)"))})

    return {
        "accounted_for": sorted(accounted),
        "silent_addresses": len(seen),
        "accounted_rows": accounted_rows,
        "unexpected": unexpected,
        # THE DENOMINATOR AGAIN: "0 unexpected silences" out of how many
        # addresses actually driven? Zero driven addresses also prints 0.
        "addresses_driven": len(lanes["per_address"]),
        "addresses_in_catalog": len(ev.all_addresses()),
    }


# ─── 4. is anything about to deliver ─────────────────────────────────────────

def delivery_report(alerts: list, now: float) -> dict:
    """`deliverable_now`, derived from `snooze_active` -- never from `state`.

    THE PROXY THAT MADE THIS NECESSARY WAS LIVE. `alert_soak_matrix --verify`
    computed `deliverable_now` as `state != 'snoozed'` and never read
    `snooze_until` at all, so it printed 0 right up to the cycle that would send
    the emails. `mark_needs_attention` rewrites `state` unconditionally every
    300 s from `api/main.py`, and all 31 production soak rows share ONE (SPY,"5")
    bar group -- so ONE failed bars fetch rewrote every state.

    Both numbers here come from `indicator_alert_service.snooze_active`, the
    predicate the SERVICE enforces with, so the tool and the system cannot hold
    two answers to one question. The state column is reported ALONGSIDE and the
    disagreement between the two is printed -- that difference is the evidence
    the proxy was wrong, not a footnote about it.
    """
    if not hasattr(ias, "snooze_active"):
        # ⛔ NO SILENT FALLBACK TO `state`. That proxy is the whole defect: it
        # reported 0 deliverable right up to the cycle that would have sent the
        # emails. An answer this tool cannot derive honestly is reported as
        # UNKNOWN and refused by `pod-code-too-old`, never guessed.
        return {
            "armed": len(alerts), "deliverable_now": None,
            "deliverable_ids": [], "muzzled_by_clock": None,
            "muzzled_by_state_string": sum(
                1 for a in alerts if a.get("state") == "snoozed"),
            "clock_vs_state_disagreements": None, "disagreeing_ids": [],
            "expiring_within_days": MUZZLE_WARN_DAYS, "expiring_soon": None,
            "muzzle_expires_at": None, "muzzle_expires_in_days": None,
            "derived_from": ("UNAVAILABLE -- indicator_alert_service."
                             "snooze_active is not on this deployment, and the "
                             "state column is the proxy that was wrong"),
        }
    deliverable = [a for a in alerts if not ias.snooze_active(a, now)]
    by_clock = [a for a in alerts if ias.snooze_active(a, now)]
    by_state = [a for a in alerts if a.get("state") == ias.STATE_SNOOZED]
    horizon = now + MUZZLE_WARN_DAYS * 86400
    expiring = [a for a in alerts
                if ias.snooze_active(a, now) and not ias.snooze_active(a, horizon)]
    untils = [int(a["snooze_until"]) for a in alerts
              if a.get("snooze_until") is not None]
    disagree = [a["id"] for a in alerts
                if ias.snooze_active(a, now)
                != (a.get("state") == ias.STATE_SNOOZED)]
    return {
        "armed": len(alerts),
        "deliverable_now": len(deliverable),
        "deliverable_ids": [a["id"] for a in deliverable][:50],
        "muzzled_by_clock": len(by_clock),
        "muzzled_by_state_string": len(by_state),
        "clock_vs_state_disagreements": len(disagree),
        "disagreeing_ids": disagree[:50],
        "expiring_within_days": MUZZLE_WARN_DAYS,
        "expiring_soon": len(expiring),
        "muzzle_expires_at": min(untils) if untils else None,
        "muzzle_expires_in_days": (
            round((min(untils) - now) / 86400, 2) if untils else None),
        "derived_from": ("indicator_alert_service.snooze_active(row) -> "
                         "snooze_until vs the clock"),
    }


# ─── 5. the verdict ──────────────────────────────────────────────────────────

def verdict(report: dict, *, min_rth_rows: int = MIN_RTH_ROWS,
            stale_sec: int = STALE_SHADOW_SEC) -> list:
    """Every reason to refuse, COLLECTED -- not the first one found.

    Collected deliberately. A first-match verdict cannot be self-tested branch by
    branch: forcing branch 6 would require branches 1-5 to pass, which on this
    instrument means a real session and real bars. Collecting makes each branch
    independently forceable, which is what `--self-test` needs in order to prove
    the gate can actually say NO.

    AND IT MUST BE ABLE TO SAY NO. A verdict function that has never returned
    NO-GO is decoration. `--self-test` forces every code in `NOGO_REASONS` and
    asserts the process exit code follows each time, plus two GREEN controls so a
    tool that returned 1 unconditionally would not pass.
    """
    reasons: list = []

    def add(code: str, message: str) -> None:
        if code not in NOGO_REASONS:
            raise AssertionError(
                "verdict emitted {!r}, which is not in NOGO_REASONS -- the "
                "self-test's totality check would never have forced it"
                .format(code))
        reasons.append({"code": code, "message": message})

    for name in report.get("preflight", {}).get("missing") or []:
        add("pod-code-too-old",
            "this deployment has no {} -- the instrument calls it, so the "
            "reading it produces would be a guess. `deliverable_now` in "
            "particular can then only come from the `state` column, which is "
            "the proxy that printed 0 right up to the cycle that sends the "
            "emails. Deploy the branch that carries it before reading a "
            "verdict here.".format(name))

    for err in report.get("store_errors") or []:
        add("cannot-read-store", err)

    sh = report["shadow"]
    lanes = report["lanes"]
    delivery = report["delivery"]

    if not sh.get("partition_holds", True):
        add("cannot-read-store",
            "the shadow rows do not partition into {} -- {} classified out of "
            "{} total. Every count under it is unsafe to read.".format(
                "/".join(SESSION_BUCKETS),
                sh["rth_rows"] + sh["pre_rows"] + sh["post_rows"]
                + sh["weekend_rows"], sh["total_rows"]))

    if lanes["armed"] == 0:
        add("no-armed-alerts",
            "0 armed alerts. Every per-address zero below is vacuous: an "
            "instrument pointed at an empty room reports the same clean sheet as "
            "one pointed at a healthy system. Arm the soak matrix "
            "(tools/alert_soak_matrix.py --arm) before reading anything else.")

    if sh["rth_rows"] < min_rth_rows:
        add("no-rth-shadow-rows",
            "the shadow lane has recorded {} row(s) inside 09:30-16:00 ET "
            "(minimum {}) and {} outside it -- pre {} / post {} / weekend {} -- "
            "out of {} total. A soak that has never seen a FORMING bar has not "
            "tested the thing the cutover changes: 8,130 rows once looked "
            "well-exercised and every one of them was after 16:52 ET.".format(
                sh["rth_rows"], min_rth_rows, sh["total_rows"] - sh["rth_rows"],
                sh["pre_rows"], sh["post_rows"], sh["weekend_rows"],
                sh["total_rows"]))

    age = sh.get("newest_age_sec")
    if age is None:
        add("shadow-lane-stale",
            "the shadow store holds no rows at all, so there is no newest row to "
            "age. ALERT_SHADOW_ENABLED reads {} in this process.".format(
                "1" if sh["enabled_env"] else "0"))
    elif age > stale_sec:
        add("shadow-lane-stale",
            "the newest shadow row is {} s old (limit {} s = five cycles of a "
            "60 s job). The lane has stopped observing, so whatever the counts "
            "below say, they are history and not a live reading.".format(
                age, stale_sec))

    if lanes["armed"] and lanes["evaluated_both"] == 0:
        add("no-live-evaluation",
            "{} alert(s) are armed but {} produced a value on BOTH lanes "
            "(forming {} / closed {}) across {} bar group(s) {}. With no "
            "denominator, a '0 disagreements' below would mean 'nothing was "
            "compared'.".format(
                lanes["armed"], lanes["evaluated_both"],
                lanes["evaluated_forming"], lanes["evaluated_closed"],
                lanes["groups"], lanes["bars_fetched"]))

    if (lanes["armed"] and lanes["evaluated_both"]
            and not lanes["groups_with_an_open_bar"]):
        add("lanes-compared-off-a-closed-bar",
            "the newest bar has already CLOSED in all {} bar group(s) {}, so "
            "`closed_bar_index` IS the newest index and both lanes read the "
            "same element. Every gained/lost/shifted count above is therefore a "
            "structural zero, not a measurement -- run this again while a bar "
            "is forming (i.e. during the session) before reading the diff."
            .format(lanes["groups"], lanes["group_state"]))

    for row in report["declaration"].get("undeclared") or []:
        add("undeclared-disagreement",
            row["message"] + ". The declaration carries {} row(s) over {} "
            "address(es); a live behaviour outside them is a change nobody "
            "priced.".format(report["declaration"].get("declared_rows"),
                             report["declaration"].get("declared_addresses")))

    for row in report["silence"].get("unexpected") or []:
        add("unexpected-closed-lane-silence", row["message"])

    if delivery["deliverable_now"]:   # None (unknown) is refused above, not here
        add("deliverable-now",
            "{} of {} armed alert(s) are OUTSIDE their snooze window right now "
            "(ids {}), so the next evaluator cycle can deliver an AlertBell, a "
            "Resend email and a post to the admin Discord. Derived from "
            "snooze_active(row), not from the state column -- {} row(s) disagree "
            "between the two.".format(
                delivery["deliverable_now"], delivery["armed"],
                delivery["deliverable_ids"],
                delivery["clock_vs_state_disagreements"]))

    # ─── the rollback lever, and the three ways it makes the flip a lie ──────
    #
    # THE FLIP THIS TOOL GATES IS A CHANGE TO A CONSTANT. An environment
    # override sits ABOVE that constant, so every state below means the flip
    # would not do what the person taking it believes it does.
    mode = report.get("mode") or {}
    if mode.get("override_refused"):
        add("eval-mode-lever-misconfigured",
            "the environment sets {}={!r}, which names no lane ({}), so it was "
            "REFUSED and the committed default is still running (eval_mode() = "
            "{!r}). IF THAT VARIABLE WAS A ROLLBACK, IT HAS NOT TAKEN -- fix "
            "the value and let Railway redeploy; {} call(s) have been refused so "
            "far.".format(
                mode.get("env_var"), mode.get("env_value"),
                "|".join(mode.get("modes") or []), mode.get("eval_mode()"),
                mode.get("refusals")))
    elif mode.get("override_applied"):
        add("eval-mode-lever-misconfigured",
            "an environment override is IN PLAY: {}={!r} pins the lane to {!r}, "
            "above the committed constant {!r}. Flipping the constant while this "
            "is set changes nothing a member can see -- clear the variable first "
            "if you mean to take the cutover, and leave it exactly where it is "
            "if it is holding a rollback.".format(
                mode.get("env_var"), mode.get("env_value"),
                mode.get("eval_mode()"), mode.get("ALERT_EVAL_MODE")))
    elif (mode.get("lever_known")
            and mode.get("ALERT_EVAL_MODE") is not None
            and mode.get("ALERT_EVAL_MODE") != mode.get("eval_mode()")):
        add("eval-mode-lever-misconfigured",
            "unexplained: the constant reads {!r} while eval_mode() returns "
            "{!r}, and no environment override accounts for it. Something has "
            "HARD-CODED the lane -- the tombstone class this phase mutates for "
            "-- and the flip is not what it appears to be.".format(
                mode.get("ALERT_EVAL_MODE"), mode.get("eval_mode()")))

    if delivery["expiring_soon"]:
        add("soak-muzzle-expiring",
            "{} armed alert(s) lose their muzzle in {} day(s) -- the window "
            "closes at epoch {} -- inside the {}-day horizon. Re-run "
            "tools/alert_soak_matrix.py --arm (it is idempotent) or --disarm."
            .format(delivery["expiring_soon"],
                    delivery["muzzle_expires_in_days"],
                    delivery["muzzle_expires_at"], MUZZLE_WARN_DAYS))

    return reasons


# ─── assembly ────────────────────────────────────────────────────────────────

def build_report(auth_db: str, shadow_db: str, *, now: Optional[float] = None,
                 bars_provider: Optional[Callable] = None,
                 accounted: Optional[dict] = None,
                 min_rth_rows: int = MIN_RTH_ROWS,
                 stale_sec: int = STALE_SHADOW_SEC) -> dict:
    now = time.time() if now is None else float(now)
    zone = ic._et_zone()
    store_errors: list = []
    missing = missing_accessors()

    try:
        alerts = read_active_alerts(auth_db)
    except (StoreError, sqlite3.Error, ValueError) as exc:
        store_errors.append("armed alerts: {}".format(exc))
        alerts = []
    try:
        rows = read_shadow_rows(shadow_db)
    except (StoreError, sqlite3.Error, ValueError) as exc:
        store_errors.append("shadow rows: {}".format(exc))
        rows = []

    sh = shadow_report(rows, zone, now)
    lanes = lane_report(alerts, now, bars_provider=bars_provider)

    report: dict = {
        "generated_at": int(now),
        "generated_at_et": datetime.fromtimestamp(now, tz=zone).strftime(
            "%Y-%m-%d %H:%M:%S %Z"),
        "store_errors": store_errors,
        "preflight": {"required": len(REQUIRED_ACCESSORS), "missing": missing,
                      "present": len(REQUIRED_ACCESSORS) - len(missing)},
        "mode": {
            "ALERT_EVAL_MODE": getattr(ev, "ALERT_EVAL_MODE", None),
            "eval_mode()": ev.eval_mode(),
            "flip_has_happened": ev.eval_mode() == "closed",
            # ⭐ THE EFFECTIVE LANE, AND WHY IT IS WHAT IT IS. `eval_mode()` above
            # already answers "which lane runs" -- these fields answer "and what
            # decided that", which is a question the constant alone stopped being
            # able to answer the moment the environment could override it.
            **lever_report(),
            "forming_resolver": (
                "indicator_alert_evaluator._evaluate_one(mode='forming') -> "
                "value_function -> alert_series (last NON-None element)"),
            "closed_resolver": (
                "indicator_alert_evaluator._evaluate_one_closed -> "
                "alert_series.series_for()[closed_bar_index] (that ELEMENT)"),
            "diagnose_used": False,
            "diagnose_note": (
                "indicator_alert_service.diagnose() is MODE-BLIND -- it calls the "
                "forming resolver with no eval_mode() consult and would report a "
                "closed-lane-silent address healthy after the flip. Not read."),
        },
        "stores": {
            "auth_db": os.path.abspath(auth_db),
            "shadow_db": os.path.abspath(shadow_db),
            "alerts_table": table_from_module_schema(ias._SCHEMA),
            "shadow_table": table_from_module_schema(shadow._SCHEMA),
            "opened": "read-only (file:...?mode=ro + PRAGMA query_only=1)",
        },
        "shadow": sh,
        "lanes": lanes,
        "delivery": delivery_report(alerts, now),
    }
    report["declaration"] = declaration_check(lanes)
    report["silence"] = silence_report(
        lanes, alerts,
        ACCOUNTED_CLOSED_LANE_SILENCE if accounted is None else accounted)

    reasons = verdict(report, min_rth_rows=min_rth_rows, stale_sec=stale_sec)
    report["verdict"] = {
        "go": not reasons,
        "reasons": reasons,
        "codes": sorted({r["code"] for r in reasons}),
        "exit_code": 0 if not reasons else 1,
    }
    lanes.pop("_bars_by_alert", None)
    return report


# ─── rendering ───────────────────────────────────────────────────────────────

def _pct(n: int, d: int) -> str:
    return "  --" if not d else "{:4.0f}%".format(100.0 * n / d)


def _fmt(x: Any) -> str:
    if x is None:
        return "None"
    try:
        return "{:.4f}".format(float(x))
    except (TypeError, ValueError):
        return str(x)


def _wrap(text: str, width: int) -> list:
    words, line, out = str(text).split(), "", []
    for word in words:
        if line and len(line) + 1 + len(word) > width:
            out.append(line)
            line = word
        else:
            line = (line + " " + word).strip()
    if line:
        out.append(line)
    return out


def render(report: dict, *, limit: int = 12) -> str:
    out: list = []
    w = out.append
    v = report["verdict"]
    sh = report["shadow"]
    lanes = report["lanes"]
    dec = report["declaration"]
    sil = report["silence"]
    d = report["delivery"]

    w("=" * 78)
    w("CUTOVER WATCH   {}".format(report["generated_at_et"]))
    w("  ALERT_EVAL_MODE = {!r}   eval_mode() = {!r}{}".format(
        report["mode"]["ALERT_EVAL_MODE"], report["mode"]["eval_mode()"],
        "   *** THE FLIP HAS ALREADY HAPPENED ***"
        if report["mode"]["flip_has_happened"] else ""))
    # The lever, printed on EVERY run: the constant and the running lane are two
    # questions now, and an operator who has just pulled the Railway variable
    # reads the answer here rather than inferring it from an alert that did or
    # did not arrive.
    md = report["mode"]
    if not md.get("lever_known"):
        w("  lever  : UNAVAILABLE on this pod -- no environment override, so a "
          "rollback here is a code change plus a deploy")
    elif md.get("override_refused"):
        w("  lever  : {}={!r} REFUSED (names no lane) -- EFFECTIVE LANE {!r}. A "
          "rollback set this way HAS NOT TAKEN.".format(
              md.get("env_var"), md.get("env_value"), md.get("effective")))
    elif md.get("override_applied"):
        w("  lever  : {}={!r} APPLIED -- EFFECTIVE LANE {!r}, overriding the "
          "constant {!r}.".format(
              md.get("env_var"), md.get("env_value"), md.get("effective"),
              md.get("ALERT_EVAL_MODE")))
    else:
        w("  lever  : {} unset -- EFFECTIVE LANE {!r} is the committed constant. "
          "Rollback = railway variables --set {}=forming".format(
              md.get("env_var"), md.get("effective"), md.get("env_var")))
    w("  auth   : {}  (table {})".format(
        report["stores"]["auth_db"], report["stores"]["alerts_table"]))
    w("  shadow : {}  (table {})".format(
        report["stores"]["shadow_db"], report["stores"]["shadow_table"]))
    w("  opened : {}".format(report["stores"]["opened"]))
    w("  lanes  : forming = {}".format(report["mode"]["forming_resolver"]))
    w("           closed  = {}".format(report["mode"]["closed_resolver"]))
    pf = report.get("preflight") or {}
    w("  deploy : {} of {} required accessor(s) present on this pod".format(
        pf.get("present"), pf.get("required")))
    w("=" * 78)

    for name in pf.get("missing") or []:
        w("  !! DEPLOY: this pod has no {}".format(name))
    for err in report.get("store_errors") or []:
        w("  !! STORE: {}".format(err))

    w("")
    w("1. SHADOW LANE -- IS IT OBSERVING DURING RTH (09:30-16:00 ET)?")
    w("   rth rows ............ {:>8}   <-- the ONLY row count the verdict reads"
      .format(sh["rth_rows"]))
    w("   ...out of a total of  {:>8}   (pre {} / post {} / weekend {})".format(
        sh["total_rows"], sh["pre_rows"], sh["post_rows"], sh["weekend_rows"]))
    w("   partition holds ..... {:>8}   rth+pre+post+weekend == total".format(
        str(sh["partition_holds"])))
    w("   rth rows TODAY ...... {:>8}".format(sh["rth_rows_today"]))
    w("   rth distinct alerts   {:>8}   of {} armed  (triggered rth rows {})"
      .format(sh["rth_distinct_alerts"], lanes["armed"],
              sh["rth_triggered_rows"]))
    w("   newest row age ...... {:>8}s  ALERT_SHADOW_ENABLED={}".format(
        "n/a" if sh["newest_age_sec"] is None else sh["newest_age_sec"],
        "1" if sh["enabled_env"] else "0"))
    w("   rth session days .... {}".format(
        ", ".join(sh["rth_session_days"]) or "(none)"))
    if sh["per_day"]:
        w("   {:<12} {:>7} {:>7} {:>7} {:>7} {:>7}  {}".format(
            "et date", "total", "rth", "pre", "post", "wknd", "rth alerts"))
        for day in list(sh["per_day"])[-limit:]:
            r = sh["per_day"][day]
            w("   {:<12} {:>7} {:>7} {:>7} {:>7} {:>7}  {}".format(
                day, r["total"], r["rth"], r["pre"], r["post"], r["weekend"],
                r["rth_distinct_alerts"]))

    w("")
    w("2. THE TWO LANES ON LIVE TAPE -- PER ADDRESS")
    w("   armed {} in {} bar group(s); bars {}".format(
        lanes["armed"], lanes["groups"], lanes["bars_fetched"]))
    w("   evaluated: forming {} / closed {} / BOTH {}   <-- the denominator"
      .format(lanes["evaluated_forming"], lanes["evaluated_closed"],
              lanes["evaluated_both"]))
    w("   groups with a FORMING (open) newest bar: {} of {}   <-- without one, "
      "both lanes read the same element".format(
          lanes["groups_with_an_open_bar"], lanes["groups"]))
    for name, gs in lanes["group_state"].items():
        w("     {:<12} bars {:>4}  judged index {:>4} of {:>4}  newest open: {}"
          .format(name, gs["bars"], gs["judged_index"], gs["newest_index"],
                  gs["newest_bar_is_open"]))
    for e in lanes["fetch_errors"]:
        w("   !! bars: {}".format(e))
    if lanes["per_address"]:
        w("   {:<24} {:>4} {:>5} {:>5} {:>6} {:>5} {:>7} {:>6}".format(
            "address", "n", "fVal", "cVal", "gained", "lost", "shifted",
            "silent"))
        for addr in sorted(lanes["per_address"]):
            a = lanes["per_address"][addr]
            w("   {:<24} {:>4} {:>5} {:>5} {:>6} {:>5} {:>7} {:>6}".format(
                addr, a["alerts"], a["forming_valued"], a["closed_valued"],
                a["gained"], a["lost"], a["shifted"], a["closed_silent"]))
    if dec.get("available"):
        w("   declaration: {} row(s) / {} address(es)  ({})".format(
            dec["declared_rows"], dec["declared_addresses"], dec["path"]))
        w("   live (address,direction) groups observed: {}".format(
            dec["observed_groups"]))
        if dec["undeclared"]:
            for u in dec["undeclared"]:
                w("   !! UNDECLARED: {}".format(u["message"]))
        else:
            w("   undeclared: 0  of {} observed group(s)".format(
                dec["observed_groups"]))
    else:
        w("   !! declaration unreadable: {}".format(dec.get("error")))

    w("")
    w("3. WHICH ARMED ALERTS WOULD CHANGE IF THE FLIP HAPPENED RIGHT NOW")
    w("   would change ........ {:>5}  of {} armed  {}".format(
        lanes["would_change"], lanes["armed"],
        _pct(lanes["would_change"], lanes["armed"])))
    for k in LANE_KINDS:
        w("     {:<22} {:>5}".format(k, lanes["kinds"][k]))
    changed = [r for r in lanes["per_alert"] if r["kind"] in CHANGING_KINDS]
    for r in changed[:limit]:
        w("     #{:<5} {:<6} {:<4} {:<22} {:<14} forming={} trig={} | "
          "closed={} trig={}".format(
              r["id"], r["sym"], r["tf"], r["address"], r["kind"],
              _fmt(r.get("forming_value")), r.get("forming_triggered"),
              _fmt(r.get("closed_value")), r.get("closed_triggered")))
    if len(changed) > limit:
        w("     ... {} more".format(len(changed) - limit))

    w("")
    w("   CLOSED-LANE SILENCE: {} address(es) of {} driven ({} in the catalog)"
      .format(sil["silent_addresses"], sil["addresses_driven"],
              sil["addresses_in_catalog"]))
    for row in sil["accounted_rows"]:
        w("     OK  {} -- ACCOUNTED FOR: shape {}, pad {} (expected {}), "
          "{} alert(s)".format(row["address"], row["expected_shape"],
                               row["observed_pad"], row["expected_pad"],
                               row["alerts"]))
    for row in sil["unexpected"]:
        w("     !! {}".format(row["message"]))
    if not sil["unexpected"]:
        w("     unexpected: 0   (accounted-for set: {})".format(
            ", ".join(sil["accounted_for"]) or "(empty)"))

    w("")
    w("4. IS ANYTHING ABOUT TO DELIVER?")
    w("   deliverable_now ..... {:>5}  of {} armed".format(
        str(d["deliverable_now"]), d["armed"]))
    w("   derived from ........ {}".format(d["derived_from"]))
    w("   muzzled by clock .... {:>5}   by the state string: {}   disagreeing: {}"
      .format(str(d["muzzled_by_clock"]), d["muzzled_by_state_string"],
              d["clock_vs_state_disagreements"]))
    w("   muzzle expires ...... {}  (in {} day(s); warn at {})".format(
        d["muzzle_expires_at"], d["muzzle_expires_in_days"],
        d["expiring_within_days"]))
    if d["deliverable_ids"]:
        w("   deliverable ids ..... {}".format(d["deliverable_ids"]))

    w("")
    w("=" * 78)
    w("VERDICT: {}".format("GO" if v["go"] else "NO-GO"))
    for r in v["reasons"]:
        w("  [{}]".format(r["code"]))
        for line in _wrap(r["message"], 72):
            w("      " + line)
    if v["go"]:
        w("  every check passed, and each one had a non-zero denominator:")
        w("    rth rows {} > 0 | armed {} > 0 | evaluated on both lanes {} > 0"
          .format(sh["rth_rows"], lanes["armed"], lanes["evaluated_both"]))
        w("    {} live disagreement group(s), all declared | {} silent "
          "address(es), all accounted".format(
              dec.get("observed_groups"), sil["silent_addresses"]))
    w("exit {}".format(v["exit_code"]))
    w("=" * 78)
    return "\n".join(out)


# ─── the self-test ───────────────────────────────────────────────────────────
#
# A VERDICT FUNCTION THAT HAS NEVER RETURNED NO-GO IS DECORATION. This forces
# every code in `NOGO_REASONS`, runs the REAL `main()` each time, and reads the
# REAL returned exit code. It then compares the set of codes it forced against
# `NOGO_REASONS` and FAILS if one was never forced -- so a branch added without a
# case cannot ride uncovered. Two GREEN controls sit alongside, because nine
# cases that all expect exit 1 are also passed by a tool that returns 1 always.

def synthetic_bars(n: int, *, last_bar_open: bool = True,
                   spike: Optional[float] = None) -> list:
    """`n` 5-minute bars ending at the current 5-minute boundary.

    `last_bar_open` puts the newest bar's close in the FUTURE, so
    `closed_bar_index` lands on `n-2` and the two lanes genuinely judge DIFFERENT
    bars. That is the only way a self-test can produce a real `gained`/`lost`
    rather than a stub asserting itself.
    """
    import math
    base = (int(time.time()) // 300) * 300
    t0 = base - (n - 1) * 300 + (0 if last_bar_open else -600)
    bars, p = [], 100.0
    for i in range(n):
        p += math.sin(i / 7.0) * 0.8
        c = p + 0.4
        if spike is not None and i == n - 1:
            c = p + spike
        bars.append({"t": t0 + i * 300, "o": p, "h": max(p + 1.2, c),
                     "l": min(p - 1.1, c), "c": c, "v": 1000 + (i % 13) * 50})
    return bars


def _provider(bars: list) -> Callable:
    return lambda sym, tf, n=200: bars


class Fixture:
    """A throwaway auth.db + alert_shadow.db built by the MODULES' OWN writers.

    THE MODULE PATHS ARE RESTORED IN A `finally`, AND ONLY IF WE STILL OWN THEM
    (`lesson_cleanup_must_verify_ownership`): a teardown that clobbers shared
    state it no longer owns is how a test suite starts writing /data.
    """

    #: 20 days: comfortably past `MUZZLE_WARN_DAYS`, comfortably under
    #: `ias.SNOOZE_MAX_MINUTES`. A default of 1 day would make every case trip
    #: `soak-muzzle-expiring` and the controls could never be green.
    DEFAULT_SNOOZE_MINUTES = 20 * 24 * 60

    def __init__(self, tmpdir: str):
        self.dir = tmpdir
        self.auth = os.path.join(tmpdir, "auth.db")
        self.shadow = os.path.join(tmpdir, "alert_shadow.db")
        self._prev_auth = None
        self._prev_shadow = None

    def __enter__(self):
        self._prev_auth = ias._DB_PATH
        self._prev_shadow = shadow._DB_PATH
        ias._DB_PATH = self.auth
        shadow._DB_PATH = self.shadow
        ias.init_schema()
        shadow.init_schema()
        return self

    def __exit__(self, *exc):
        if ias._DB_PATH == self.auth:
            ias._DB_PATH = self._prev_auth
        if shadow._DB_PATH == self.shadow:
            shadow._DB_PATH = self._prev_shadow
        shadow._INITED.discard(self.shadow)
        return False

    def arm(self, address: str, condition: str = "above",
            threshold: Optional[float] = 0.0, sym: str = "SPY", tf: str = "5",
            snooze_minutes: Optional[int] = -1) -> int:
        alert_id = ias.create(user_id="selftest", sym=sym, indicator=address,
                              condition=condition, threshold=threshold, tf=tf,
                              params_json={"_selftest": True})
        mins = (self.DEFAULT_SNOOZE_MINUTES if snooze_minutes == -1
                else snooze_minutes)
        if mins:
            ias.snooze(alert_id, mins)
        return alert_id

    def shadow_rows(self, count: int, *, when: float, alert_id: int = 1,
                    step: int = 60) -> None:
        shadow.shadow_record_many([
            shadow._row_tuple(alert_id, 100, 1.0, False, int(when) - i * step)
            for i in range(count)])


def et_instant(zone, *, days_ago: int, hour: int, minute: int) -> float:
    """A real ET wall-clock instant N days back, on a WEEKDAY, via the IANA zone."""
    day = datetime.now(tz=zone) - timedelta(days=days_ago)
    while day.weekday() >= 5:
        day = day - timedelta(days=1)
    return day.replace(hour=hour, minute=minute, second=0,
                       microsecond=0).timestamp()


def selftest_cases() -> list:
    """(name, expected NO-GO code or None, builder). One case per branch."""
    zone = ic._et_zone()
    default_bars = synthetic_bars(300)

    def healthy(fx):
        """The parts a case is NOT trying to break."""
        aid = fx.arm("rsi", "above", -1e9)
        fx.shadow_rows(5, when=et_instant(zone, days_ago=1, hour=10, minute=30),
                       alert_id=aid)
        fx.shadow_rows(1, when=time.time() - 30, alert_id=aid)
        return aid

    def case_pod_code_too_old(fx):
        # FORCED BY REMOVING THE ACCESSOR, WHICH IS WHAT A STALE POD IS. This
        # branch was not invented for completeness: the first production run of
        # this tool crashed with `AttributeError: ... has no attribute
        # 'snooze_active'` because the durable snooze had not been deployed yet.
        healthy(fx)
        return {"drop_accessor": (ias, "snooze_active")}

    def case_cannot_read(fx):
        # The store is not where the caller said it was. A `mode=ro` connection
        # to a missing file RAISES rather than creating one, which is exactly
        # the property that makes read-only the right default: a typo'd path
        # cannot silently become an empty database that reports a clean zero.
        healthy(fx)
        return {"shadow_db": os.path.join(fx.dir, "not-the-store.db")}

    def case_no_armed(fx):
        fx.shadow_rows(3, when=et_instant(zone, days_ago=1, hour=11, minute=0))
        fx.shadow_rows(1, when=time.time() - 30)
        return {}

    def case_no_rth(fx):
        aid = fx.arm("rsi", "above", -1e9)
        # THE MUTATION TARGET: every row is AFTER the close, exactly like the
        # 8,130 rows that made the soak look exercised. If the RTH filter stops
        # filtering, these count and this case stops firing.
        fx.shadow_rows(40, when=et_instant(zone, days_ago=1, hour=18, minute=5),
                       alert_id=aid)
        # ⏰ NO "NOW" ROW HERE, AND THAT IS THE FIX, NOT AN OMISSION. This case
        # used to seed `fx.shadow_rows(1, when=time.time() - 30)` to keep the
        # lane looking live -- a row stamped at the ambient clock, which lands in
        # whichever session bucket the OPERATOR happened to run in. Run at 09:47
        # on a Monday it landed inside RTH, `rth_rows` read 1, this branch went
        # silent, and `--self-test` exited 1: the cutover watch's own gate read
        # red at the one instant the cutover is taken. (Measured: exit 1 at
        # 09:47 ET, exit 0 at 07:15 / Sunday / 21:30.)
        #
        # The row cannot simply be MOVED to a stated off-hours instant either,
        # because it has to be younger than STALE_SHADOW_SEC to count as live --
        # so it is always in the CURRENT bucket. And that is the real point:
        # "the lane is live AND has zero RTH rows" is a CONTRADICTION during
        # RTH. A lane recording every 60 s inside 09:30-16:00 necessarily has
        # RTH rows. So the only coherent fixture for this branch is a lane that
        # has stopped, and this case now also fires `shadow-lane-stale` -- which
        # is honest, costs nothing (the case asserts `expected in codes`), and
        # leaves the branch under test exactly as forceable as before: mutate
        # `session_bucket` to stop filtering and `rth_rows` becomes 40, this
        # case stops firing, and the self-test goes red. `case_stale` remains
        # the dedicated, independent case for the staleness branch.
        return {}

    def case_stale(fx):
        aid = fx.arm("rsi", "above", -1e9)
        fx.shadow_rows(10, when=et_instant(zone, days_ago=1, hour=10, minute=0),
                       alert_id=aid)
        return {}

    def case_no_eval(fx):
        healthy(fx)
        return {"bars": []}

    def case_undeclared(fx):
        healthy(fx)
        # A REAL `lost`: the newest bar spikes 40 points, so the FORMING lane
        # (which reads bars[-1]) clears the threshold and the CLOSED lane (which
        # judges bars[-2]) does not. Handed a declaration that has never heard of
        # anything, that is exactly an undeclared live behaviour.
        bars = synthetic_bars(300, spike=40.0)
        fx.arm("close", "above", bars[-2]["c"] + 5.0)
        return {"bars": bars, "empty_declaration": True}

    def case_unexpected_silence(fx):
        healthy(fx)
        fx.arm("price_vs_ma", "above", -1e9)
        # A GENUINE SECOND SILENT ADDRESS, FROM DATA, NOT FROM CONFIG. With
        # exactly 50 bars a 50-period MA has a value at the LAST index and None
        # at index 48 -- the bar the closed lane judges while the newest bar is
        # open. Forming reads the last non-None and gets a number; closed reads
        # index 48 and gets nothing. Shape `warmup_boundary`, a different
        # mechanism from chikou's trailing pad, so the accounted-for entry
        # cannot cover it.
        return {"bars": synthetic_bars(50)}

    def case_closed_bar_only(fx):
        # THE VACUITY THE FIRST PRODUCTION RUN EXPOSED. At 22:00 ET the newest
        # SPY 5m bar had long since closed, so both lanes read the same element
        # and the tool printed `identical 30` -- thirty zeros that could not
        # have been anything else. `last_bar_open=False` reproduces it.
        healthy(fx)
        return {"bars": synthetic_bars(300, last_bar_open=False)}

    def case_deliverable(fx):
        healthy(fx)
        fx.arm("rsi", "above", -1e9, snooze_minutes=None)     # never muzzled
        return {}

    def case_expiring(fx):
        healthy(fx)
        fx.arm("rsi", "below", 1e9, snooze_minutes=60)        # 1h < 7d horizon
        return {}

    def case_eval_mode_lever(fx):
        # FORCED BY THE REAL VARIABLE, THROUGH THE REAL EVALUATOR. `closd` is
        # the typo the whole refusal policy exists for: it names no lane, the
        # committed default keeps running, and an operator who set it during a
        # rollback would otherwise have no way to learn that nothing changed.
        healthy(fx)
        return {"env": {ev.ALERT_EVAL_MODE_ENV: "closd"}}

    def case_control_go(fx):
        """CONTROL: same shape as the cases above, but GREEN.

        Without this, nine cases that all expect exit 1 are also passed by a tool
        that returns 1 unconditionally. This is what makes the exit code a
        measurement rather than a constant.
        """
        healthy(fx)
        return {}

    def case_control_chikou(fx):
        """CONTROL: `ichimoku.chikou` IS closed-lane silent and must still GO.

        The owner-accepted casualty must not be able to refuse the cutover, while
        `case_unexpected_silence` proves a DIFFERENT silent address can. The
        second armed alert supplies the both-lanes denominator, because chikou
        alone would (correctly) trip `no-live-evaluation`.
        """
        healthy(fx)
        fx.arm("ichimoku.chikou", "above", -1e9)
        return {}

    return [
        ("pod-code-too-old", "pod-code-too-old", case_pod_code_too_old),
        ("cannot-read-store", "cannot-read-store", case_cannot_read),
        ("no-armed-alerts", "no-armed-alerts", case_no_armed),
        ("no-rth-shadow-rows", "no-rth-shadow-rows", case_no_rth),
        ("shadow-lane-stale", "shadow-lane-stale", case_stale),
        ("no-live-evaluation", "no-live-evaluation", case_no_eval),
        ("lanes-compared-off-a-closed-bar", "lanes-compared-off-a-closed-bar",
         case_closed_bar_only),
        ("undeclared-disagreement", "undeclared-disagreement", case_undeclared),
        ("unexpected-closed-lane-silence", "unexpected-closed-lane-silence",
         case_unexpected_silence),
        ("deliverable-now", "deliverable-now", case_deliverable),
        ("soak-muzzle-expiring", "soak-muzzle-expiring", case_expiring),
        ("eval-mode-lever-misconfigured", "eval-mode-lever-misconfigured",
         case_eval_mode_lever),
        ("CONTROL green", None, case_control_go),
        ("CONTROL chikou-accounted", None, case_control_chikou),
    ], default_bars


def run_self_test() -> list:
    """Force every NO-GO branch through the REAL `main()`; one row per case."""
    import tempfile
    cases, default_bars = selftest_cases()
    results: list = []
    for name, expected, builder in cases:
        # ⚠️ `ignore_cleanup_errors` IS NOT COSMETIC ON WINDOWS. `_conn()` uses
        # `with sqlite3.connect(...)` which COMMITS but never CLOSES, so the WAL
        # file stays open until GC and rmtree raises WinError 32 — a teardown
        # crash that would read exactly like a failing gate.
        with tempfile.TemporaryDirectory(prefix="cutwatch_",
                                         ignore_cleanup_errors=True) as tmp:
            with Fixture(tmp) as fx:
                opts = builder(fx)
                bars = opts["bars"] if "bars" in opts else default_bars
                argv = ["--auth-db", opts.get("auth_db") or fx.auth,
                        "--shadow-db", opts.get("shadow_db") or fx.shadow,
                        "--json"]
                buf = io.StringIO()
                prev_decl = shadow.DECLARED_DIFF_PATH
                if opts.get("empty_declaration"):
                    empty_path = os.path.join(tmp, "empty_declared.json")
                    with open(empty_path, "w", encoding="utf-8") as fh:
                        json.dump({"rows": []}, fh)
                    shadow.DECLARED_DIFF_PATH = empty_path
                dropped = opts.get("drop_accessor")
                saved = (getattr(dropped[0], dropped[1]) if dropped else None)
                if dropped:
                    delattr(dropped[0], dropped[1])
                # ⚠️ THE LEVER IS CONTROLLED FOR EVERY CASE, NOT ONLY THE ONE
                # THAT USES IT. `ALERT_EVAL_MODE` exported in the operator's
                # shell would otherwise put all fourteen cases -- INCLUDING BOTH
                # GREEN CONTROLS -- into an override state, and a control that
                # goes red for an environmental reason proves nothing about the
                # gate.
                env_name = ev.ALERT_EVAL_MODE_ENV
                prev_env = os.environ.get(env_name)
                wanted_env = (opts.get("env") or {}).get(env_name)
                os.environ.pop(env_name, None)
                if wanted_env is not None:
                    os.environ[env_name] = wanted_env
                try:
                    with contextlib.redirect_stdout(buf):
                        rc = main(argv, bars_provider=_provider(bars))
                finally:
                    # RESTORED ONLY IF WE STILL OWN THE SLOT
                    # (`lesson_cleanup_must_verify_ownership`): a `finally` that
                    # writes back unconditionally can clobber a value somebody
                    # else set while this ran.
                    if dropped and not hasattr(dropped[0], dropped[1]):
                        setattr(dropped[0], dropped[1], saved)
                    if shadow.DECLARED_DIFF_PATH != prev_decl:
                        shadow.DECLARED_DIFF_PATH = prev_decl
                    # RESTORED ONLY IF THE SLOT STILL HOLDS WHAT WE PUT THERE.
                    if os.environ.get(env_name) == wanted_env:
                        if prev_env is None:
                            os.environ.pop(env_name, None)
                        else:
                            os.environ[env_name] = prev_env
                try:
                    report = json.loads(buf.getvalue())
                    codes = report["verdict"]["codes"]
                    messages = {r["code"]: r["message"]
                                for r in report["verdict"]["reasons"]}
                except Exception:                             # noqa: BLE001
                    codes, messages = [], {}
                results.append({
                    "case": name, "expected": expected, "exit": rc,
                    "codes": codes, "messages": messages,
                    "fired": expected is None or expected in codes,
                    "exit_follows": (rc == 0) if expected is None else (rc == 1),
                })
    return results


def self_test_summary(results: list) -> dict:
    """Verdict over the self-test itself: totality + disjointness + controls."""
    forced = {r["expected"] for r in results if r["expected"]}
    missing = sorted(set(NOGO_REASONS) - forced)
    messages: dict = {}
    for r in results:
        for code, msg in (r.get("messages") or {}).items():
            messages.setdefault(code, set()).add(msg[:70])
    # DISJOINT BY THE OPENING WORDS, not by the whole string: two refusals that
    # start identically are two refusals a reader cannot tell apart, which is
    # how a `pytest.raises(match=...)` once matched a gate that had been deleted.
    heads = [sorted(v)[0] for v in messages.values()]
    return {
        "cases": len(results),
        "branches": len(NOGO_REASONS),
        "forced": len(forced),
        "never_forced": missing,
        "all_fired": all(r["fired"] for r in results),
        "all_exit_codes_follow": all(r["exit_follows"] for r in results),
        "controls_green": all(r["exit"] == 0 for r in results
                              if r["expected"] is None),
        "messages_disjoint": len(set(heads)) == len(heads),
        "ok": (not missing
               and all(r["fired"] for r in results)
               and all(r["exit_follows"] for r in results)
               and len(set(heads)) == len(heads)),
    }


def _self_test_main() -> int:
    results = run_self_test()
    summary = self_test_summary(results)
    _say("SELF-TEST: forcing every NO-GO branch through the real main()")
    _say("{:<32} {:>4} {:<6} {:<8} {}".format(
        "case", "exit", "fired", "follows", "codes"))
    for r in results:
        _say("{:<32} {:>4} {:<6} {:<8} {}".format(
            r["case"], r["exit"], str(r["fired"]), str(r["exit_follows"]),
            ",".join(r["codes"]) or "(none)"))
    _say("")
    _say("branches in NOGO_REASONS  : {}".format(summary["branches"]))
    _say("branches forced by a case : {}".format(summary["forced"]))
    if summary["never_forced"]:
        _say("NEVER FORCED: {}  <-- a branch with no case is not a gate".format(
            ", ".join(summary["never_forced"])))
    _say("controls green            : {}".format(summary["controls_green"]))
    _say("refusal messages disjoint : {}".format(summary["messages_disjoint"]))
    _say("SELF-TEST {}".format("PASSED" if summary["ok"] else "FAILED"))
    return 0 if summary["ok"] else 1


# ─── entry point ─────────────────────────────────────────────────────────────

def main(argv: Optional[list] = None, *,
         bars_provider: Optional[Callable] = None) -> int:
    p = argparse.ArgumentParser(
        description="GO / NO-GO for the ALERT_EVAL_MODE cutover.")
    p.add_argument("--auth-db", default=None,
                   help="default: indicator_alert_service.db_path()")
    p.add_argument("--shadow-db", default=None,
                   help="default: alert_shadow_log.db_path()")
    p.add_argument("--json", action="store_true")
    p.add_argument("--limit", type=int, default=12)
    p.add_argument("--min-rth-rows", type=int, default=MIN_RTH_ROWS)
    p.add_argument("--stale-sec", type=int, default=STALE_SHADOW_SEC)
    p.add_argument("--accounted-silent", default=None,
                   help="comma list of addresses whose closed-lane silence is "
                        "accepted; default is the built-in "
                        "ACCOUNTED_CLOSED_LANE_SILENCE table")
    p.add_argument("--self-test", action="store_true",
                   help="force every NO-GO branch and prove the exit code follows")
    args = p.parse_args(argv)

    if args.self_test:
        return _self_test_main()

    accounted = None
    if args.accounted_silent is not None:
        wanted = {a.strip() for a in args.accounted_silent.split(",") if a.strip()}
        accounted = {k: v for k, v in ACCOUNTED_CLOSED_LANE_SILENCE.items()
                     if k in wanted}

    try:
        report = build_report(
            args.auth_db or ias.db_path(), args.shadow_db or shadow.db_path(),
            bars_provider=bars_provider, accounted=accounted,
            min_rth_rows=args.min_rth_rows, stale_sec=args.stale_sec)
    except Exception as exc:                                  # noqa: BLE001
        _say("cutover_watch could not run: {}: {}".format(
            type(exc).__name__, exc))
        return 2

    if args.json:
        _say(json.dumps(report, indent=1, default=str))
    else:
        _say(render(report, limit=args.limit))
    return report["verdict"]["exit_code"]


if __name__ == "__main__":
    raise SystemExit(main())
