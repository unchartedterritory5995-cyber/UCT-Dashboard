"""F-S7-3 forward-only comparison for `position-risk` (CP2).

⛔ NO REPLAY, EVER. Both rules are evaluated at the SAME instant against the
SAME positions and the SAME price snapshot, and only forward. This type's reason
is the fourth distinct one the programme has met and it is the hardest: **the
legacy rule's only price source is a live cache that keeps no history**
(`engine._build_market_scan_ctx` reads `live_prices._px_cache` per cycle and
stores nothing). *"Would this have fired on Tuesday"* has no input at all.

⛔ FOUR OUTCOMES, NEVER A PASS RATE.
  agreed          -- both rules alert on the same symbol at the same tick
  new_only        -- the dark rule alerts and the legacy one does not.
                     At the flip this member starts getting an alert they do
                     not get today.
  legacy_only     -- the legacy rule alerts and the dark one does not.
                     ⛔ At the flip this member **LOSES** an alert they get
                     today, and for this type that alert is an email and a
                     Discord push about a stop being hit.
  not_comparable  -- no honest comparison existed. THREE reasons, counted
                     separately and never folded into agreement:
                       unpriced       the shared price cache did not hold the
                                      symbol this cycle, so NEITHER side
                                      evaluated anything (§5 item 7)
                       params_change  the predicate's firing identity moved, so
                                      the accumulated ticks can no longer be
                                      attributed to the migration
                       no_incumbent   the predicate names `aggregate_heat`,
                                      which has no legacy alert at all --
                                      `legacy_only` is undefined for it

⛔⛔ `unpriced` IS THE ONE THAT WOULD HAVE LIED. `rules.py` skips a symbol the
cache missed with no record, so to the legacy rule it is indistinguishable from
"not at stop". A harness that counted those ticks as agreement would report a
clean migration for positions **neither side ever looked at**, and the quieter
the cache the cleaner the report would look.

⛔ THE GRAIN IS PER SYMBOL, NOT PER TICK. One cycle emits one candidate per
position and the cooldown is keyed (symbol, kind), so a tick where the two sides
alert on `{A,B}` and `{A}` is ONE `agreed` and ONE `legacy_only` — not one
"disagreement". Collapsing it to a per-tick boolean would make an inbox that
doubles look identical to one that does not.

⛔ §2a ITEM 4 — A LIVENESS STAMP, NOT JUST A RESULT STORE. `observe` writes a
heartbeat on EVERY call, quiet ones included. A heartbeat that only beats on
success is a success detector, and a dark run that died on its first morning is
otherwise indistinguishable at the end of the week from one that ran every tick.

⭐ AND THERE IS NO RESTATED LEGACY RULE IN THIS FILE. `rule_stop_watch` is a
PURE function — no DB, no network, no delivery, no environment — so
`legacy_would_fire` DRIVES THE REAL ONE instead of mirroring it. The three types
before this had to restate their legacy because it mutated and delivered; a
restatement that is not forced is a second authority over one value. What is
mirrored here is the DARK side (`position_risk.stop_distance_pct`), and that
mirror has its own rail.
"""
from __future__ import annotations

import json
import sqlite3
import time
from typing import Any, Iterable, Optional

from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import position_risk as _pr

# ⛔ THE PURE RULE MODULE ONLY. `awareness.engine` reads auth.db and calls
# `deliver_alert_payload`; `awareness.rules` imports nothing but dataclasses,
# `date` and the shared placeholder detector. The rail
# `test_the_harness_imports_no_delivery_and_no_awareness_engine` keeps that
# distinction from eroding.
from api.services.awareness import rules as _legacy_rules

MIN_SESSIONS_FOR_VERDICT = 5

AGREED = "agreed"
NEW_ONLY = "new_only"
LEGACY_ONLY = "legacy_only"
NOT_COMPARABLE = "not_comparable"

#: The reasons a tick can be `not_comparable`, counted separately so the report
#: can say WHICH blindness it hit. ⛔ Never summed away into `agreed`.
NC_UNPRICED = "unpriced"
NC_PARAMS_CHANGE = "params_change"
NC_NO_INCUMBENT = "no_incumbent"
NC_REASONS = (NC_UNPRICED, NC_PARAMS_CHANGE, NC_NO_INCUMBENT)

HEARTBEAT_KEY = "position_risk_sweep_heartbeat"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS position_risk_comparison_spans (
    id                INTEGER PRIMARY KEY,
    predicate_id      TEXT NOT NULL,
    params_version    INTEGER NOT NULL DEFAULT 0,
    opened_at         REAL NOT NULL,
    closed_at         REAL,
    close_reason      TEXT,
    twin              TEXT NOT NULL DEFAULT '{}',
    sessions          TEXT NOT NULL DEFAULT '[]',
    agreed            INTEGER NOT NULL DEFAULT 0,
    new_only          INTEGER NOT NULL DEFAULT 0,
    legacy_only       INTEGER NOT NULL DEFAULT 0,
    nc_unpriced       INTEGER NOT NULL DEFAULT 0,
    nc_params_change  INTEGER NOT NULL DEFAULT 0,
    nc_no_incumbent   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pr_spans_pred
    ON position_risk_comparison_spans(predicate_id);

CREATE TABLE IF NOT EXISTS position_risk_heartbeat (
    key              TEXT PRIMARY KEY,
    ticks            INTEGER NOT NULL DEFAULT 0,
    last_tick_at     REAL,
    last_market_date TEXT
);
"""


def _conn(db_path: str | None = None) -> sqlite3.Connection:
    conn = _db.connect(db_path)
    conn.executescript(_SCHEMA)
    conn.commit()
    return conn


def _merged_sessions(raw: str, day: str) -> str:
    """⭐ Sessions are counted by the TICK'S OWN market date, never
    `date.today()`. A harness stamping wall-clock days would report five
    sessions after five wall-clock days regardless of how many ticks actually
    happened — the same defect as a heartbeat that only beats on success."""
    try:
        seen = set(json.loads(raw or "[]"))
    except ValueError:
        seen = set()
    seen.add(day)
    return json.dumps(sorted(seen))


def beat(market_date: str, *, now: Optional[float] = None,
         db_path: str | None = None) -> dict[str, Any]:
    """§2a item 4. Written on every tick, quiet ones included."""
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        conn.execute(
            "INSERT INTO position_risk_heartbeat (key, ticks, last_tick_at, last_market_date) "
            "VALUES (?, 1, ?, ?) ON CONFLICT(key) DO UPDATE SET "
            "ticks = ticks + 1, last_tick_at = excluded.last_tick_at, "
            "last_market_date = excluded.last_market_date",
            (HEARTBEAT_KEY, now, market_date))
        conn.commit()
        row = conn.execute(
            "SELECT ticks, last_tick_at, last_market_date FROM position_risk_heartbeat "
            "WHERE key = ?", (HEARTBEAT_KEY,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def heartbeat(*, db_path: str | None = None) -> Optional[dict[str, Any]]:
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT ticks, last_tick_at, last_market_date FROM position_risk_heartbeat "
            "WHERE key = ?", (HEARTBEAT_KEY,)).fetchone()
        return dict(row) if row is not None else None
    finally:
        conn.close()


def legacy_would_fire(params: dict[str, Any], *,
                      positions: Iterable[dict[str, Any]],
                      live_prices: dict[str, float] | None = None) -> list[str]:
    """The LEGACY rule — **the real one**, driven read-only.

    ⛔ NOT A RESTATEMENT. `rule_stop_watch(scan_ctx, user_ctx)` is pure: it
    touches no database, opens no socket, reads no environment variable and
    delivers nothing. `engine.py` owns every side effect, and `engine.py` is not
    imported here. Running the real rule is therefore both safe and strictly
    more honest than a mirror — there is no second authority to keep in sync and
    no `lesson_rail_the_mirror_not_just_the_lane` debt.

    ⛔ THE PREDICATE'S NARROWING FILTERS ARE **NOT** APPLIED HERE, and that is
    the point. `entity_ref`, `side`, `position_source` and `threshold_pct` are
    this type's own; the legacy rule has none of them. A predicate that narrows
    therefore shows up as `legacy_only`, which is exactly the column that means
    *a member loses an alert at the flip*. Only `severity` is applied, because
    it selects WHICH legacy branch is being compared rather than narrowing it —
    the same call `catalyst-match` made for `match_rule`.

    ⛔ `aggregate_heat` returns nothing: there is no incumbent to drive.
    """
    severity = params.get("severity")
    if severity not in _pr.ABSORBED_SEVERITIES:
        return []

    scan_ctx = {"live_prices": dict(live_prices or {})}
    user_ctx = {"positions": list(positions), "watch_syms": set()}
    candidates = _legacy_rules.rule_stop_watch(scan_ctx, user_ctx)

    seen: set[str] = set()
    out: list[str] = []
    for c in candidates:
        if c.kind != severity:
            continue
        sym = (c.symbol or "").upper()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        out.append(sym)
    return out


def open_span_if_absent(predicate_id: str, twin: dict, *, now: Optional[float] = None,
                        db_path: str | None = None) -> dict:
    """⛔ Idempotent. The caller runs this every tick; a second span per tick
    would make every count meaningless while every test still passed."""
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT * FROM position_risk_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        if row is not None:
            return dict(row)
        conn.execute(
            "INSERT INTO position_risk_comparison_spans "
            "(predicate_id, params_version, opened_at, twin) VALUES (?,?,?,?)",
            (predicate_id, 0, now, json.dumps(twin)))
        conn.commit()
        row = conn.execute(
            "SELECT * FROM position_risk_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def note_params_change(predicate_id: str, new_twin: dict[str, Any], *,
                       now: Optional[float] = None,
                       db_path: str | None = None) -> dict[str, int]:
    """The predicate's firing identity changed — the clock RESETS.

    ⛔ The open span closes and its accumulated counts are **discarded into
    `not_comparable` (reason `params_change`)**, never carried. What the two
    sides did under the OLD parameters cannot be attributed to the migration,
    and keeping those ticks as `agreed` would be the flattering error this whole
    design exists to avoid.
    """
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT id, params_version, agreed, new_only, legacy_only "
            "FROM position_risk_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        discarded, version = 0, 0
        if row is not None:
            discarded = int(row["agreed"]) + int(row["new_only"]) + int(row["legacy_only"])
            version = int(row["params_version"])
            conn.execute(
                "UPDATE position_risk_comparison_spans SET closed_at=?, close_reason=?, "
                "agreed=0, new_only=0, legacy_only=0, "
                "nc_params_change=nc_params_change+? WHERE id=?",
                (now, NC_PARAMS_CHANGE, discarded, int(row["id"])))
        conn.execute(
            "INSERT INTO position_risk_comparison_spans "
            "(predicate_id, params_version, opened_at, twin) VALUES (?,?,?,?)",
            (predicate_id, version + 1, now, json.dumps(new_twin)))
        conn.commit()
        return {"discarded_to_not_comparable": discarded, "new_params_version": version + 1}
    finally:
        conn.close()


def observe(predicate_id: str, params: dict[str, Any], market_date: str, *,
            positions: Iterable[dict[str, Any]],
            live_prices: dict[str, float] | None = None,
            now: Optional[float] = None,
            db_path: str | None = None) -> dict[str, int]:
    """One forward tick. Both rules evaluated at the SAME instant on the SAME
    positions and the SAME price snapshot, then the per-symbol outcomes
    recorded.

    ⛔ Neither side firing on a position is NOT an outcome — it is an ordinary
    quiet row. Counting quiet rows as `agreed` would drown every real
    disagreement and make the result a function of how many positions the member
    happens to hold.

    ⛔ A position whose symbol the price cache did not hold is `not_comparable`,
    never `agreed`. §5 item 7.

    Returns the per-tick tally, so a caller can see a tick that recorded nothing
    as a tick that recorded nothing.
    """
    now = time.time() if now is None else now
    rows = list(positions)
    prices = dict(live_prices or {})

    span = open_span_if_absent(predicate_id, params, now=now, db_path=db_path)
    try:
        twin = json.loads(span["twin"]) or {}
    except (ValueError, TypeError):
        twin = {}
    if _pr.predicate_fingerprint(twin) != _pr.predicate_fingerprint(params):
        note_params_change(predicate_id, params, now=now, db_path=db_path)
        span = open_span_if_absent(predicate_id, params, now=now, db_path=db_path)

    # ⛔ THE HEARTBEAT IS WRITTEN BEFORE ANY EARLY RETURN. A quiet tick — and an
    # `aggregate_heat` tick — is exactly the tick a success-detector would miss.
    beat(market_date, now=now, db_path=db_path)

    severity = params.get("severity")
    if severity == _pr.SEV_AGGREGATE_HEAT:
        # ⛔⛔ NO INCUMBENT, SO NO COMPARISON EXISTS. `portfolio_heat()` is a
        # request-time read at three call sites; nothing schedules it and
        # nothing delivers from it, so `legacy_only` cannot occur and calling
        # the tick `agreed` would be inventing agreement between one rule and
        # nothing at all. One `not_comparable` per tick, reason `no_incumbent`.
        counts = {AGREED: 0, NEW_ONLY: 0, LEGACY_ONLY: 0,
                  NC_UNPRICED: 0, NC_NO_INCUMBENT: 1}
    else:
        dark = set(_pr.would_fire(params, positions=rows, live_prices=prices))
        legacy = set(legacy_would_fire(params, positions=rows, live_prices=prices))
        blind = set(_pr.unpriced_symbols(params, positions=rows, live_prices=prices))
        counts = {AGREED: len(dark & legacy),
                  NEW_ONLY: len(dark - legacy),
                  LEGACY_ONLY: len(legacy - dark),
                  NC_UNPRICED: len(blind),
                  NC_NO_INCUMBENT: 0}

    conn = _conn(db_path)
    try:
        conn.execute(
            "UPDATE position_risk_comparison_spans SET "
            "agreed = agreed + ?, new_only = new_only + ?, legacy_only = legacy_only + ?, "
            "nc_unpriced = nc_unpriced + ?, nc_no_incumbent = nc_no_incumbent + ?, "
            "sessions = ? WHERE id = ?",
            (counts[AGREED], counts[NEW_ONLY], counts[LEGACY_ONLY],
             counts[NC_UNPRICED], counts[NC_NO_INCUMBENT],
             _merged_sessions(span["sessions"], market_date), int(span["id"])))
        conn.commit()
    finally:
        conn.close()

    return {AGREED: counts[AGREED], NEW_ONLY: counts[NEW_ONLY],
            LEGACY_ONLY: counts[LEGACY_ONLY],
            NOT_COMPARABLE: counts[NC_UNPRICED] + counts[NC_NO_INCUMBENT]}


def report(predicate_id: str, *, db_path: str | None = None) -> dict[str, Any]:
    """What was observed, then the four counts, then what this cannot see.

    ⛔ `status` and `observed` LEAD. An empty comparison store prints four
    zeroes and reads exactly like perfect agreement — *a dark run that never ran
    and a dark run that found no disagreement are different facts*, and this
    type adds a third: a dark run whose price cache was empty, which looks like
    both.

    ⛔ `verdict_ready` is its own field, never baked into a pass/fail: *"not
    enough data yet"* and *"they disagree"* are different answers, and
    collapsing them is how a gate stops meaning anything.
    """
    conn = _conn(db_path)
    try:
        rows = conn.execute(
            "SELECT * FROM position_risk_comparison_spans WHERE predicate_id=? ORDER BY id",
            (predicate_id,)).fetchall()
    finally:
        conn.close()

    counts = {AGREED: 0, NEW_ONLY: 0, LEGACY_ONLY: 0}
    by_reason = {NC_UNPRICED: 0, NC_PARAMS_CHANGE: 0, NC_NO_INCUMBENT: 0}
    sessions: set = set()
    severities: set = set()
    for r in rows:
        for k in counts:
            counts[k] += int(r[k])
        by_reason[NC_UNPRICED] += int(r["nc_unpriced"])
        by_reason[NC_PARAMS_CHANGE] += int(r["nc_params_change"])
        by_reason[NC_NO_INCUMBENT] += int(r["nc_no_incumbent"])
        sessions |= set(json.loads(r["sessions"] or "[]"))
        severities.add((json.loads(r["twin"]) or {}).get("severity"))

    not_comparable = sum(by_reason.values())
    observed = sum(counts.values()) + not_comparable

    return {
        "predicate_id": predicate_id,
        # ⛔ what was observed, FIRST.
        "status": "NO DATA" if not rows else ("QUIET" if observed == 0 else "OBSERVED"),
        "observed": observed,
        "spans": len(rows),
        "sessions_covered": sorted(sessions),
        # …then the four outcomes.
        **counts,
        NOT_COMPARABLE: not_comparable,
        "not_comparable_by_reason": dict(by_reason),
        "severities": sorted(s for s in severities if s),
        "verdict_ready": len(sessions) >= MIN_SESSIONS_FOR_VERDICT,
        "min_sessions_for_verdict": MIN_SESSIONS_FOR_VERDICT,
        "heartbeat": heartbeat(db_path=db_path),
        "blind_spots": BLIND_SPOTS,
    }


#: ⛔ §2a item 2's last clause — the report STATES WHAT IT CANNOT SEE, every
#: time, so nobody sizes the next checkpoint against a blind spot.
BLIND_SPOTS = (
    "A MISSING PRICE IS NOT A 'NO'. The legacy rule reads the SHARED live-price "
    "cache and skips a symbol it did not hold with no record, so to that rule a "
    "cache miss is indistinguishable from 'not at stop'. Those symbols are "
    "counted as not_comparable/unpriced here, never as agreement -- but HOW "
    "OFTEN the cache misses a held symbol was NOT measured, and it decides "
    "whether this comparison has enough comparable ticks to say anything at all.",

    "NO MEMBER ROW IS PROJECTED AT CP1-CP2. Every predicate here is "
    "HARNESS-ARMED, so these counts describe the RULE, not the population. A "
    "zero in any column is a fact about the fixtures until CP3 projects real "
    "cohort rows under a new approval line.",

    "STRUCTURAL AGREEMENT IS EXPECTED AND IS NOT EVIDENCE. This is an "
    "ABSORPTION: on a predicate that declares none of its own filters the dark "
    "rule and the legacy rule are asking the same question, so `agreed` is what "
    "a correct migration looks like and proves only that nothing regressed. The "
    "informative ticks are the ones where a predicate declares a threshold_pct "
    "other than the legacy constant, narrows by side/source/entity, or meets an "
    "unpriced symbol.",

    "A NARROW PREDICATE IS COMPARED AGAINST THE WHOLE LEGACY RULE. The legacy "
    "rule has no per-predicate filters, so a predicate naming one symbol counts "
    "every OTHER position the legacy would alert on as legacy_only. That is the "
    "honest reading for THIS predicate and it is NOT the member's total loss at "
    "the flip, which depends on how many predicates the projection gives them "
    "-- a CP3 question.",

    "THE COMPARISON IS OF THE RULE, NOT OF THE DELIVERY. The legacy scan only "
    "runs when COMPASS_AUTOMATION_ENABLED and AWARENESS_ENGINE_ENABLED are both "
    "set on `web`, and neither was read live during this checkpoint. If the "
    "scan is off in production then a legacy_only tick describes an alert the "
    "member is not receiving today either, and the flip's blast radius is "
    "smaller than these counts imply. One `railway variables --kv` settles it "
    "and it was not run.",

    "THE 8/DAY INSIGHT CAP AND THE 6h COOLDOWN ARE INVISIBLE HERE. Both live in "
    "`add_insight`, downstream of the rule, so a legacy candidate this harness "
    "counts may never have reached the member at all. `dedup_grain` is pinned "
    "in the schema so the guard survives absorption, but this comparison cannot "
    "measure it.",

    "AGGREGATE HEAT IS NOT BEING COMPARED. It has no incumbent -- "
    "`portfolio_heat()` is a request-time read at three call sites with no "
    "schedule and no delivery -- so its ticks are recorded as "
    "not_comparable/no_incumbent. Any future claim that the dark rule 'agrees' "
    "for that severity is a claim about nothing.",
)
