"""SHADOW MODE — both lanes run, one lane delivers — and the DECLARED diff.

⭐ WHAT THIS MODULE IS FOR, IN ONE SENTENCE: Task 5 proved the closed lane is
internally consistent (0 keyed / 0 identity repaint disagreement at every k while
firing 2,012,025 times); this is the evidence for the OTHER question, the one a
repaint oracle structurally cannot answer — **what changes for a real armed
alert, per address, and why**.

🔴 THE REPAINT ORACLE IS NECESSARY AND NOT SUFFICIENT, AND THAT WAS MEASURED, NOT
ARGUED. Task 5's mutation M1 restored the defect itself (`prev = last_value`) and
M4 shifted a whole column by one bar; **both repaint ZERO and both are wrong**,
because `replay` writes `last_value` back after every sample and a closed value is
identical at every sample of a bar. So nothing in this file is built on "0
repaints" as a proxy for correctness. It is built on a SET DIFFERENCE between the
two lanes, keyed with the value inside the key.

⛔ THE SHADOW LANE MAY NOT WRITE `indicator_alerts`. It shares the rows it reads
with the LIVE lane, and `last_value` on those rows is not bookkeeping — under
`ALERT_EVAL_MODE == "forming"` it IS the `prev` a crossing is measured against. A
shadow write there would change what the LIVE lane fires: the observer changing
the observed, on production, silently. So this module takes its own connection to
its own database, calls neither `record_trigger` nor `record_evaluation` nor any
delivery hook, and `tests/test_alert_shadow.py` dumps `indicator_alerts` before
and after a full shadow cycle and compares it AS A WHOLE.

⛔ AND IT IS ITS OWN SCHEDULER JOB, NOT A BRANCH INSIDE `_run_one_cycle`. Two jobs
can be disabled independently; a branch cannot. `ALERT_SHADOW_ENABLED=1` is what
registers it (default off), and turning it off can never take delivery with it.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
from typing import Any, Iterable, Optional

_logger = logging.getLogger(__name__)

# ⚠️ ITS OWN FILE, NOT `auth.db`. `indicator_alert_service._DB_PATH` defaults to
# `/data/auth.db`; this deliberately does not, so "the shadow lane cannot write
# the live table" is a property of the CONNECTION and not only of the SQL nobody
# wrote. Overridable for tests / local runs the same way every other store here is.
_DB_PATH = os.environ.get("ALERT_SHADOW_DB_PATH", "/data/alert_shadow.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS alert_shadow_fires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER NOT NULL,
  bar_index INTEGER,
  value REAL,
  triggered INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alert_shadow_alert ON alert_shadow_fires(alert_id);
CREATE INDEX IF NOT EXISTS idx_alert_shadow_at ON alert_shadow_fires(recorded_at);
"""


def db_path() -> str:
    """The shadow store's path. A function so a test can move it and see it move."""
    return _DB_PATH


def shadow_enabled() -> bool:
    """`ALERT_SHADOW_ENABLED=1`. Default OFF — read per call, never at import.

    Read at call time on purpose: the value is also consulted by the scheduler at
    registration, and a module-level snapshot would make the two disagree after a
    test (or a runbook step) changed the environment.
    """
    return os.environ.get("ALERT_SHADOW_ENABLED", "0") == "1"


def _conn():
    c = sqlite3.connect(_DB_PATH, timeout=10.0)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=2000")
    return c


def init_schema() -> None:
    parent = os.path.dirname(os.path.abspath(_DB_PATH))
    if parent and not os.path.isdir(parent):
        os.makedirs(parent, exist_ok=True)
    with _conn() as db:
        db.executescript(_SCHEMA)


def shadow_record(alert_id: int, bar_index: Optional[int], value: Optional[float],
                  triggered: bool) -> None:
    """Write ONE closed-lane observation to the shadow store. Nothing else.

    ⛔ NOT `record_evaluation`, NOT `record_trigger`, NOT `deliver_alert_payload`.
    This is the whole delivery surface of the shadow lane and it is one INSERT
    into a table the live lane has never heard of.
    """
    init_schema()
    with _conn() as db:
        db.execute(
            "INSERT INTO alert_shadow_fires "
            "(alert_id, bar_index, value, triggered, recorded_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (int(alert_id),
             None if bar_index is None else int(bar_index),
             None if value is None else float(value),
             1 if triggered else 0,
             int(time.time())),
        )


def shadow_rows(alert_id: Optional[int] = None, limit: int = 500) -> list[dict]:
    """Read back what the shadow lane WOULD have fired. Diagnostics only."""
    init_schema()
    sql = ("SELECT id, alert_id, bar_index, value, triggered, recorded_at "
           "FROM alert_shadow_fires")
    params: tuple = ()
    if alert_id is not None:
        sql += " WHERE alert_id=?"
        params = (int(alert_id),)
    sql += " ORDER BY id DESC LIMIT ?"
    params = params + (int(limit),)
    with _conn() as db:
        rows = db.execute(sql, params).fetchall()
    return [{"id": r[0], "alert_id": r[1], "bar_index": r[2], "value": r[3],
             "triggered": bool(r[4]), "recorded_at": r[5]} for r in rows]


# ─── THE SHADOW CYCLE ────────────────────────────────────────────────────────

def run_shadow_cycle() -> dict[str, Any]:
    """Evaluate every active alert on the CLOSED lane and record what it WOULD do.

    Structurally a mirror of `indicator_alert_evaluator._run_one_cycle` with the
    entire right-hand side removed: same `list_active`, same (sym, tf) grouping,
    same bar fetch — and then `_evaluate_one_closed` instead of `_evaluate_one`,
    and `shadow_record` instead of `record_trigger` / `record_evaluation` /
    `_dispatch_delivery`.

    ⚠️ IT SELF-GATES AS WELL AS BEING GATED AT REGISTRATION. The scheduler only
    registers the job when `ALERT_SHADOW_ENABLED=1`, so this second check is not
    what keeps it dark — it is what makes a manual call from a REPL or a runbook
    obey the same switch as the scheduled one.
    """
    summary = {"considered": 0, "evaluated": 0, "would_trigger": 0,
               "errors": 0, "skipped": False}
    if not shadow_enabled():
        summary["skipped"] = True
        return summary

    from api.services import indicator_alert_evaluator as ev
    from api.services import indicator_alert_service as ias

    try:
        alerts = ias.list_active()
    except Exception:
        _logger.exception("[alert-shadow] failed to list active alerts")
        summary["errors"] += 1
        return summary

    summary["considered"] = len(alerts)
    if not alerts:
        return summary

    groups: dict[tuple[str, str], list[dict]] = {}
    for a in alerts:
        groups.setdefault((a["sym"], a["tf"]), []).append(a)

    for (sym, tf), alerts_in_group in groups.items():
        try:
            bars = ev._fetch_bars_for_alert(sym, tf, 200)
        except Exception:
            _logger.exception("[alert-shadow] fetch failed for %s/%s", sym, tf)
            summary["errors"] += 1
            continue
        for alert in alerts_in_group:
            try:
                value, triggered, bar_index = ev._evaluate_one_closed(
                    alert, bars=bars)
                if value is None:
                    continue
                summary["evaluated"] += 1
                if triggered:
                    summary["would_trigger"] += 1
                shadow_record(alert["id"], bar_index, value, triggered)
            except Exception:
                _logger.exception(
                    "[alert-shadow] eval failed for alert %s", alert.get("id"))
                summary["errors"] += 1
    return summary


# ─── THE DECLARED DIFF ───────────────────────────────────────────────────────
#
# ⭐ THIS IS B5's GEOMETRY/PROVENANCE SPLIT APPLIED TO FIRES. An UNDECLARED
# difference is a failure, always, in either direction. A DECLARED difference that
# does not occur in a given configuration is REPORTED, never failed — B5's
# `provenance_unmet` ruling, because the same fixtures run in several
# configurations and gating an absent-but-declared difference turns every
# configuration but one red.
#
# ⭐ AND A DECLARATION IS BOUNDED. B5's MR2b found that widening the declarable
# field set by ONE field was invisible to every pre-existing rail. So a row names
# an ADDRESS (never a wildcard) and a DIRECTION and a COUNT, the counts are
# checked against an independently recorded total, and a count larger than what
# was recorded is refused HERE rather than at the cutover.

# ⚠️ THE DECLARATION LIVES UNDER `tests/fixtures/` AND IS READ FROM `api/services/`,
# WHICH IS DELIBERATE AND WORTH ONE SENTENCE. It is a committed OBSERVATION of what
# the cutover changes, in the same family as `fire_log_forming.json` and
# `replay_bars.json` — all three are read by the replay tool, by pytest, and (this
# one) by the lane that soaks the change on live tape. Splitting it into a second
# copy under `api/` so the import direction looked tidier would create exactly the
# twin this programme retires. Nothing on a request path reads it.
DECLARED_DIFF_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "tests", "fixtures", "alerts", "fire_diff_declared.json",
)

DIRECTIONS: tuple[str, str] = ("gained", "lost")

# The minimum a reason has to be. A reason exists so the person reading a changed
# inbox on cutover day knows WHY; "n/a" or "expected" is a row with no reason
# wearing one, which is the shape this programme has corrected before.
_MIN_REASON_CHARS = 60


def declared_diff(path: Optional[str] = None) -> dict:
    """The committed declaration: every per-address difference, with its reason.

    Raises `FileNotFoundError` when it is absent — an empty declaration read as
    "nothing is declared" and a missing file read as "nothing changed" are the
    same green, and only one of them is honest.
    """
    p = path or DECLARED_DIFF_PATH
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)


def declaration_index(declared: dict) -> dict[tuple[str, str], dict]:
    """`(address, direction) -> row`, for the rows that are WELL FORMED.

    A malformed row (wildcard address, missing count) is deliberately absent from
    the index, so it cannot cover anything; `validate_declaration` is what reports
    it. Two rails, one for each half of "a declaration that waves everything
    through".
    """
    out: dict[tuple[str, str], dict] = {}
    for row in declared.get("rows") or []:
        address = row.get("address")
        direction = row.get("direction")
        count = row.get("count")
        if not isinstance(address, str) or "*" in address or not address:
            continue
        if direction not in DIRECTIONS:
            continue
        if not isinstance(count, int) or isinstance(count, bool) or count < 1:
            continue
        out[(address, direction)] = row
    return out


def _address_of_fire(fire: Any) -> Optional[str]:
    """The address inside a fire — a `fire_key` tuple, an `alert_key`, or a dict.

    `alert_key` is `"<fixture>|<address>|<condition>|<threshold!r>"`.
    """
    if isinstance(fire, dict):
        key = fire.get("alert_key") or fire.get("address")
    elif isinstance(fire, (tuple, list)):
        key = fire[0] if fire else None
    else:
        key = fire
    if not isinstance(key, str):
        return None
    parts = key.split("|")
    return parts[1] if len(parts) >= 2 else key


def declared_covers(declared: dict, fire: Any, direction: str) -> bool:
    """Is this fire's ADDRESS declared to change in this DIRECTION?

    ⛔ THE NEGATIVE HALF IS THE POINT AND IT HAS ITS OWN TEST. A
    `declared_covers` that returns True unconditionally makes the whole gate
    accept everything (B5's MR4), and no positive case can see that — only a fire
    the declaration has NEVER heard of can. `test_declared_covers_REFUSES_an_
    address_it_has_never_heard_of` is that case.
    """
    if direction not in DIRECTIONS:
        return False
    address = _address_of_fire(fire)
    if not address:
        return False
    return (address, direction) in declaration_index(declared)


def observed_index(observed: Any) -> dict[tuple[str, str], int]:
    """`(address, direction) -> count` out of a `lane_diff` result or a mapping."""
    if isinstance(observed, dict) and "per_address" in observed:
        out: dict[tuple[str, str], int] = {}
        for address, counts in observed["per_address"].items():
            for direction in DIRECTIONS:
                n = int(counts.get(direction) or 0)
                if n:
                    out[(address, direction)] = n
        return out
    if isinstance(observed, dict):
        return {tuple(k): int(v) for k, v in observed.items() if int(v)}  # type: ignore[misc]
    out2: dict[tuple[str, str], int] = {}
    for row in observed:
        out2[(row["address"], row["direction"])] = int(row["count"])
    return out2


def validate_declaration(declared: dict, addresses: Optional[Iterable[str]] = None) -> list[str]:
    """Everything wrong with the declaration ITSELF, before any replay runs.

    Pure and fast, and it carries the bound: **the row counts must sum to the
    independently recorded totals**. That is what refuses a count larger than the
    recorded one — an unbounded declaration is a wildcard wearing a number, and it
    is refused here rather than on cutover day.
    """
    problems: list[str] = []
    rows = declared.get("rows")
    if not rows:
        return ["the declaration has no rows at all — nothing is declared"]

    measured = declared.get("measured") or {}
    for field in ("k", "fixtures", "gained", "lost", "addresses_covered",
                  "forming_fires", "closed_fires"):
        if field not in measured:
            problems.append(f"declaration.measured is missing {field!r} — the "
                            "recorded measurement is what bounds the rows")

    if addresses is None:
        from api.services import indicator_alert_evaluator as ev
        # ⚠️ ALL THREE PARTITIONS. Phase C Task 10 put `close` in a THIRD
        # dict (`PRICE_FUNCS`) so that making price a LEFT operand could not grow
        # `INDICATOR_FUNCS` and destroy the frozen replay grid. A two-partition
        # `known` set here would call the one address Task 15 added to the diff
        # 'not in the catalog' — i.e. it would refuse the declaration that closes
        # the last coverage hole, which is the opposite of what this check is for.
        addresses = (list(ev.INDICATOR_FUNCS) + list(ev.EVENT_FUNCS)
                     + list(ev.PRICE_FUNCS))
    known = set(addresses)

    seen: set[tuple[str, str]] = set()
    sums = {"gained": 0, "lost": 0}
    for i, row in enumerate(rows):
        where = f"rows[{i}]"
        address = row.get("address")
        direction = row.get("direction")
        count = row.get("count")
        reason = row.get("reason")
        if not isinstance(address, str) or not address:
            problems.append(f"{where}: no address")
            continue
        if "*" in address:
            problems.append(
                f"{where}: {address!r} is a WILDCARD. A declaration names one "
                "address; a pattern waves through every address that matches it, "
                "including ones nobody has looked at yet.")
            continue
        if address not in known:
            problems.append(f"{where}: {address!r} is not an address in the "
                            "catalog — a declaration for a plot that cannot be "
                            "alerted on covers nothing and hides a typo")
            continue
        if direction not in DIRECTIONS:
            problems.append(f"{where} ({address}): direction {direction!r} is not "
                            f"one of {DIRECTIONS}")
            continue
        if isinstance(count, bool) or not isinstance(count, int):
            problems.append(f"{where} ({address} {direction}): the count is "
                            f"{count!r}. A MISSING count is an unbounded "
                            "declaration, which is a wildcard.")
            continue
        if count < 1:
            problems.append(f"{where} ({address} {direction}): count {count} — a "
                            "declared difference of zero declares nothing")
            continue
        if not isinstance(reason, str) or len(reason.strip()) < _MIN_REASON_CHARS:
            problems.append(
                f"{where} ({address} {direction}): the reason is "
                f"{len(reason.strip()) if isinstance(reason, str) else 0} chars. "
                f"A row needs at least {_MIN_REASON_CHARS} — the reason is the "
                "whole artifact; a row without one is an unexplained delta.")
            continue
        if (address, direction) in seen:
            problems.append(f"{where}: ({address}, {direction}) is declared twice "
                            "— two budgets for one group is no budget")
            continue
        seen.add((address, direction))
        sums[direction] += count

    for direction in DIRECTIONS:
        recorded = measured.get(direction)
        if isinstance(recorded, int) and sums[direction] != recorded:
            problems.append(
                f"the {direction} rows sum to {sums[direction]} but the recorded "
                f"measurement is {recorded}. A row whose count exceeds what was "
                "recorded is an unbounded declaration; a row that falls short "
                "leaves part of the diff undeclared. The sum is an EQUALITY.")
    return problems


def diff_report(observed: Any, declared: dict) -> dict:
    """Compare a measured diff against the declaration. The gate, as data.

    - `undeclared`  — a difference with no declaration. **FAILS**, in either
                      direction: a MISSING fire is the failure a user cannot see
                      and cannot report, so `lost` is checked exactly as hard as
                      `gained`.
    - `over_budget` — more differences than the row declared. **FAILS.**
    - `unmet`       — declared, but fewer (or none) observed in THIS
                      configuration. **REPORTED, never failed** (B5's
                      `provenance_unmet` ruling): the same declaration is checked
                      against a one-fixture run and a four-fixture run, and gating
                      an absent-but-declared difference turns every configuration
                      but one red.
    """
    obs = observed_index(observed)
    index = declaration_index(declared)

    undeclared: list[str] = []
    over_budget: list[str] = []
    for (address, direction), n in sorted(obs.items()):
        # ⛔ THROUGH `declared_covers`, NOT THROUGH THE INDEX DIRECTLY. The coverage
        # question has exactly one implementation, so the negative control that
        # proves it can REFUSE (`test_declared_covers_REFUSES_an_address_it_has_
        # never_heard_of`) is a control over the gate itself rather than over a
        # decorative helper nothing calls.
        if not declared_covers(declared, address, direction):
            undeclared.append(
                f"{n} {direction} fire(s) on {address!r} with NO declaration. "
                f"Add a row to fire_diff_declared.json naming the ADDRESS, the "
                f"DIRECTION and the REASON.")
            continue
        row = index.get((address, direction))
        if row is None:      # only reachable if `declared_covers` lied
            continue
        if n > int(row["count"]):
            over_budget.append(
                f"{address} {direction}: {n} observed but only {row['count']} "
                f"declared — the declaration under-counts by {n - int(row['count'])}.")

    unmet = []
    for (address, direction), row in sorted(index.items()):
        n = obs.get((address, direction), 0)
        if n < int(row["count"]):
            unmet.append({"address": address, "direction": direction,
                          "declared": int(row["count"]), "observed": n})

    return {"undeclared": undeclared, "over_budget": over_budget, "unmet": unmet,
            "observed_groups": len(obs), "declared_groups": len(index)}
