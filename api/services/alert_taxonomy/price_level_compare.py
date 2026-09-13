"""GATE-S7-PRICE-LEVEL Checkpoint 2 — the FORWARD-ONLY comparison harness.

The absorption default (s7-alerts-completion-plan §4a) runs the new trigger type
DARK and flips it in the same PR that switches the legacy path off. ⭐ **The dark
period is only worth having if the diff is designed before the evaluator ships**
— otherwise "it ran dark for a week" is a duration, not evidence. This module is
that diff.

──────────────────────────────────────────────────────────────────────────────
⛔ FORWARD-ONLY. NO REPLAY. (Owner ruling, F-S7-3, 2026-09-12)
──────────────────────────────────────────────────────────────────────────────

Both sides are evaluated **live, on the same tick, from the moment the dark
predicate arms**. There is no backfill over historical bars — not for a fixed
level, not for a trendline, not ever.

⚰️ SPEC-S7 §5.6 invited exactly that backfill ("replays the predicate against
the already-cached historical bars"), naming `price-level` specifically. It is
sound for a CONSTANT level and unsound for a line that MOVED:
`resync_bound_alerts` rewrites a bound trendline's anchors in place, and
`watchlist_alerts` has no `updated_at`, so a replay would run today's line over
last month's bars as though it had always been in force — undetectably. ⭐ A
number is *more* convincing than a blank, which is what makes that the dangerous
failure rather than the obvious one.

⭐ **Forward-only dissolves the question rather than answering it.** "Decline
when the line moved" still requires knowing whether it moved — a fact the legacy
row does not carry. Comparing only things that were both live at the same
instant never needs the geometry's history at all.

──────────────────────────────────────────────────────────────────────────────
THE FOUR OUTCOMES — and why NOT COMPARABLE is load-bearing
──────────────────────────────────────────────────────────────────────────────

  agreed         both sides fired on the same tick
  new_only       the dark side fired, the legacy twin did not   → an EXTRA
                 member alert on flip
  legacy_only    the legacy twin fired, the dark side did not   → a LOST
                 member alert on flip
  not_comparable no honest comparison existed for that span

⛔ **`not_comparable` must never be folded into `agreed`.** A span whose geometry
was re-pointed mid-flight, or a predicate armed before its twin, has no honest
answer — and counting either as agreement inflates the pass rate in the
flattering direction, which is precisely how a dark period ends up certifying
nothing. This is the `CoverageLine` idiom: *"we could not compare"* and *"they
agreed"* are different facts to the person deciding whether to flip.

⛔ **TRENDLINE SPANS ARE REPORTED SEPARATELY, BY NAME.** A trendline's level
moves between ticks by construction, so a small numeric difference is expected
rather than a defect. Folding them in with fixed levels would either mask a real
disagreement or cry wolf on every one.

──────────────────────────────────────────────────────────────────────────────
⛔ CP2 SCOPE — HARNESS-ARMED PREDICATES ONLY
──────────────────────────────────────────────────────────────────────────────

⚰️ **CP2 said: "the legacy twin here is a harness-owned descriptor, not a row in
`watchlist_alerts` … shadowing real member rows is CP3 and needs its own
approval line."** CP3 was approved on 2026-09-12 and that sentence is now half
false, so it is corrected rather than left to rot.

**What is still true, and is the half that matters:** this module reads no
member data and writes nothing outside the alert-taxonomy store. It is handed a
twin dict; it never opens `watchlist_alerts` itself.
`test_the_harness_never_touches_watchlist_alerts` still holds on this file.

**What changed:** under CP3 that dict may be a READ-ONLY PROJECTION of a real
member row, produced by `price_level_projection.py` — which owns the single
`SELECT` and the admin-role gate.
"""
from __future__ import annotations

import json
import time
from typing import Any, Optional

from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import price_level as _pl

# A verdict needs five full trading sessions of forward data (owner ruling).
MIN_SESSIONS_FOR_VERDICT = 5

AGREED = "agreed"
NEW_ONLY = "new_only"
LEGACY_ONLY = "legacy_only"
NOT_COMPARABLE = "not_comparable"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS price_level_comparison_spans (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    predicate_id    TEXT NOT NULL,
    anchor_version  INTEGER NOT NULL,
    opened_at       REAL NOT NULL,
    closed_at       REAL,
    close_reason    TEXT,
    twin            TEXT NOT NULL,
    prev_new        REAL,
    prev_legacy     REAL,
    agreed          INTEGER NOT NULL DEFAULT 0,
    new_only        INTEGER NOT NULL DEFAULT 0,
    legacy_only     INTEGER NOT NULL DEFAULT 0,
    not_comparable  INTEGER NOT NULL DEFAULT 0,
    sessions        TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_plcs_pred ON price_level_comparison_spans(predicate_id);
"""


def _conn(db_path: str | None = None):
    conn = _db.connect(db_path)
    conn.executescript(_SCHEMA)
    conn.commit()
    return conn


def _session_key(ts: float) -> str:
    """The trading day a tick belongs to, as a plain UTC date string.

    ⚠️ Deliberately coarse and deliberately NOT an ET session-boundary
    calculation. The verdict gate asks "have five distinct sessions elapsed",
    and a day key answers that. Inventing a session calendar here would put a
    SECOND authority on market hours beside the one the rest of the app already
    owns, for a counter that does not need the precision.
    """
    return time.strftime("%Y-%m-%d", time.gmtime(ts))


def open_span(predicate_id: str, twin: dict[str, Any], *, anchor_version: int = 0,
              now: Optional[float] = None, db_path: str | None = None) -> int:
    """Open a comparison span. `twin` is the harness-owned legacy descriptor:
    {level_kind, target_price, direction, anchor_t1, anchor_p1, anchor_t2, anchor_p2}.

    ⛔ NOT a `watchlist_alerts` row and never read from one (CP2 scope).
    """
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        cur = conn.execute(
            "INSERT INTO price_level_comparison_spans "
            "(predicate_id, anchor_version, opened_at, twin) VALUES (?,?,?,?)",
            (predicate_id, int(anchor_version), now, json.dumps(twin)))
        conn.commit()
        return int(cur.lastrowid)
    finally:
        conn.close()


def open_span_if_absent(predicate_id: str, twin: dict, *, now=None,
                        db_path: str | None = None) -> dict:
    """The open span for `predicate_id`, opening one if none is open.

    ⛔ CP3's projection calls this every tick, so it must be idempotent — a
    second span opened per tick would make every count meaningless while every
    test still passed.
    """
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT * FROM price_level_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        if row is not None:
            return dict(row)
        conn.execute(
            "INSERT INTO price_level_comparison_spans "
            "(predicate_id, anchor_version, opened_at, twin) VALUES (?,?,?,?)",
            (predicate_id, 0, now, json.dumps(twin)))
        conn.commit()
        row = conn.execute(
            "SELECT * FROM price_level_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def record_outcome(predicate_id: str, dark_fired: bool, legacy_fired: bool,
                   price: float, *, now=None, db_path: str | None = None):
    """Record one tick's outcome on the open span, and carry the baseline.

    ⛔ Neither side firing is NOT an outcome — it is an ordinary tick. Counting
    quiet ticks as `agreed` would drown every real disagreement in noise and
    make the pass rate a function of how often we sample rather than of whether
    the two paths behave alike.
    """
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT * FROM price_level_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        if row is None:
            return None
        if dark_fired and legacy_fired:
            outcome = AGREED
        elif dark_fired:
            outcome = NEW_ONLY
        elif legacy_fired:
            outcome = LEGACY_ONLY
        else:
            conn.execute(
                "UPDATE price_level_comparison_spans SET prev_legacy=?, sessions=? WHERE id=?",
                (price, _merged_sessions(row["sessions"], now), int(row["id"])))
            conn.commit()
            return None
        conn.execute(
            "UPDATE price_level_comparison_spans SET %s=%s+1, prev_legacy=?, sessions=? "
            "WHERE id=?" % (outcome, outcome),
            (price, _merged_sessions(row["sessions"], now), int(row["id"])))
        conn.commit()
        return outcome
    finally:
        conn.close()


def note_anchor_move(predicate_id: str, new_twin: dict[str, Any], *,
                     now: Optional[float] = None, db_path: str | None = None) -> dict[str, int]:
    """An anchor rewrite RESETS the comparison clock.

    ⛔ The open span is closed and its accumulated counts are **discarded into
    `not_comparable`** — not kept, not carried forward. The member moved the
    line; what the two sides did against the OLD geometry can no longer be
    attributed to the migration, and keeping those ticks as "agreed" would be
    the flattering error this whole design exists to avoid.

    A fresh span opens at the new geometry with a bumped `anchor_version`, and
    both prev-price baselines start empty — so the first tick after a move is
    never a cross (`_crossed` returns False on `prev is None`).
    """
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT id, anchor_version, agreed, new_only, legacy_only, not_comparable "
            "FROM price_level_comparison_spans WHERE predicate_id=? AND closed_at IS NULL "
            "ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        discarded = 0
        version = 0
        if row is not None:
            discarded = int(row["agreed"]) + int(row["new_only"]) + int(row["legacy_only"])
            version = int(row["anchor_version"])
            conn.execute(
                "UPDATE price_level_comparison_spans SET closed_at=?, close_reason=?, "
                "agreed=0, new_only=0, legacy_only=0, not_comparable=not_comparable+? "
                "WHERE id=?",
                (now, "anchor_move", discarded, int(row["id"])))
        conn.execute(
            "INSERT INTO price_level_comparison_spans "
            "(predicate_id, anchor_version, opened_at, twin) VALUES (?,?,?,?)",
            (predicate_id, version + 1, now, json.dumps(new_twin)))
        conn.commit()
        return {"discarded_to_not_comparable": discarded, "new_anchor_version": version + 1}
    finally:
        conn.close()


def observe(predicate_id: str, price: float, *, now: Optional[float] = None,
            db_path: str | None = None) -> Optional[str]:
    """One forward tick. Evaluates BOTH sides at the same instant and records the
    outcome on the open span. Returns the outcome, or None if no span is open.

    ⛔ The dark side is the REAL evaluator (`price_level.evaluate`) rather than a
    reimplementation of it — a harness that re-derives the thing it is measuring
    proves only that the harness agrees with itself.
    """
    now = time.time() if now is None else now
    conn = _conn(db_path)
    try:
        row = conn.execute(
            "SELECT * FROM price_level_comparison_spans WHERE predicate_id=? "
            "AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (predicate_id,)).fetchone()
        if row is None:
            return None
        twin = json.loads(row["twin"])

        # --- legacy twin, forward only -------------------------------------
        legacy_level = _pl.level_at(twin, now)
        legacy_fired = (legacy_level is not None and _pl._crossed(
            twin.get("direction", "above"), row["prev_legacy"], price, float(legacy_level)))

        # --- dark side: the real evaluator ---------------------------------
        fires = _pl.evaluate({_twin_symbol(twin): price}, now=now,
                             predicate_ids=[predicate_id], db_path=db_path)
        new_fired = bool(fires)

        if new_fired and legacy_fired:
            outcome = AGREED
        elif new_fired:
            outcome = NEW_ONLY
        elif legacy_fired:
            outcome = LEGACY_ONLY
        else:
            conn.execute(
                "UPDATE price_level_comparison_spans SET prev_legacy=?, sessions=? WHERE id=?",
                (price, _merged_sessions(row["sessions"], now), int(row["id"])))
            conn.commit()
            return None  # neither side fired: not an event, not an outcome

        conn.execute(
            "UPDATE price_level_comparison_spans SET %s=%s+1, prev_legacy=?, sessions=? "
            "WHERE id=?" % (outcome, outcome),
            (price, _merged_sessions(row["sessions"], now), int(row["id"])))
        conn.commit()
        return outcome
    finally:
        conn.close()


def _twin_symbol(twin: dict[str, Any]) -> str:
    return twin.get("symbol") or twin.get("sym") or ""


def _merged_sessions(raw: str, ts: float) -> str:
    seen = set(json.loads(raw or "[]"))
    seen.add(_session_key(ts))
    return json.dumps(sorted(seen))


def report(predicate_id: str, *, db_path: str | None = None) -> dict[str, Any]:
    """The report the owner sees at flip time: per predicate, the four counts,
    the sessions covered, and whether a verdict may be shown at all.

    ⛔ `verdict_ready` is False until five distinct sessions of forward data
    exist (owner ruling). It is returned as its own field rather than baked into
    a pass/fail, because "not enough data yet" and "they disagree" are different
    answers and collapsing them is how a gate stops meaning anything.
    """
    conn = _conn(db_path)
    try:
        rows = conn.execute(
            "SELECT * FROM price_level_comparison_spans WHERE predicate_id=? ORDER BY id",
            (predicate_id,)).fetchall()
    finally:
        conn.close()

    totals = {AGREED: 0, NEW_ONLY: 0, LEGACY_ONLY: 0, NOT_COMPARABLE: 0}
    sessions: set = set()
    kinds: set = set()
    for r in rows:
        for k in totals:
            totals[k] += int(r[k])
        sessions |= set(json.loads(r["sessions"] or "[]"))
        kinds.add((json.loads(r["twin"]) or {}).get("level_kind"))

    return {
        "predicate_id": predicate_id,
        **totals,
        "spans": len(rows),
        "sessions_covered": sorted(sessions),
        "level_kinds": sorted(k for k in kinds if k),
        # Reported separately, by name — a trendline's level moves between ticks
        # by construction, so its disagreements are not the same fact as a fixed
        # level's.
        "is_trendline": _pl.TRENDLINE in kinds,
        "verdict_ready": len(sessions) >= MIN_SESSIONS_FOR_VERDICT,
        "min_sessions_for_verdict": MIN_SESSIONS_FOR_VERDICT,
    }
