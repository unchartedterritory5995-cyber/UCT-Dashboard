"""GATE-S7-PRICE-LEVEL Checkpoint 3 — the READ-ONLY PROJECTION of real member
`watchlist_alerts` rows, ADMIN-ROLE COHORT ONLY, still fully dark.

──────────────────────────────────────────────────────────────────────────────
⛔ PROJECTION, NOT MIRROR (owner ruling, 2026-09-12)
──────────────────────────────────────────────────────────────────────────────

Predicates are derived from `watchlist_alerts` **read-only, at evaluation
time**. ⛔ No second table of member alerts. No sync job. The new store holds
only harness-armed predicates and the **comparison bookkeeping**
(`anchor_version`, `anchors_set_at`, spans) **keyed by the legacy row id**.

⭐ If `watchlist_alerts` changes under it, the projection sees it next tick —
that is the point. A mirror would put a second authority on a member's armed
alerts, and the drift between the two would stay invisible until it produced a
wrong alert. **A projection cannot drift because it holds nothing to drift.**

Every statement this module makes about the legacy table is a `SELECT`.
`test_the_projection_only_ever_reads` is the rail.

──────────────────────────────────────────────────────────────────────────────
⛔ THE ADMIN GATE IS THE EXISTING ROLE CHECK
──────────────────────────────────────────────────────────────────────────────

`users.role = 'admin'` — the same column `ADMIN_EMAILS` promotion writes at
login (`auth.py:253`) and every `is_admin` read in the app already uses. ⛔ NOT
a hardcoded user list: a typed list is a second authority over who is an admin
and goes stale **silently** the day someone's role changes, in the direction
that quietly widens a cohort. Mutation-proved in
`test_MUTATION_dropping_the_role_gate_lets_a_member_row_through`.

──────────────────────────────────────────────────────────────────────────────
⛔ THE TWO SEMANTIC DIVERGENCES THIS COMPARISON EXISTS TO MEASURE
──────────────────────────────────────────────────────────────────────────────

Both sides read the SAME row, so the row is not what differs — **the rules
are**, and they differ in two ways already visible from the source:

1. **LEVEL TEST vs CROSS.** `check_alerts_against_prices` fires on
   `current_price >= target` (or `<=`). The dark evaluator fires on a
   *transition*. ⇒ An alert armed while price is ALREADY through its level
   fires immediately on the legacy path and **not at all** on the dark one.
   Expect `legacy_only` for that class.

2. **ONE-SHOT vs PERSISTENT.** `_trigger_alert` sets `is_active = 0`, so a
   legacy alert fires at most once and then disarms. The dark predicate stays
   armed and can cross again. ⇒ Expect `new_only` on any second crossing.

⚠️ **Neither is a harness bug, and neither is silently resolved here.** They are
the substantive findings the dark period is for, and which way each should be
settled is a product call — the flip is a separate approval line precisely so
that call can be made on evidence.

⭐ Divergence 2 is self-limiting in a useful way: once legacy disarms the row,
`is_active = 1` stops matching and the projection stops seeing it, so the span
closes on its own rather than accumulating one-sided noise forever.
"""
from __future__ import annotations

import json
import time
from typing import Any, Optional

from api.services import auth_db as _auth_db
from api.services.alert_taxonomy import price_level as _pl
from api.services.alert_taxonomy import price_level_compare as _cmp
from api.services.alert_taxonomy import receipts as _receipts

# The synthetic predicate id for a projected row. ⛔ Namespaced so a projected
# fire can never be confused with a harness-armed predicate's, and so the
# comparison bookkeeping is keyed by the LEGACY ROW ID as ruled.
PROJECTED_PREFIX = "legacy:"

ADMIN_ROLE = "admin"


def projected_predicate_id(legacy_row_id: str) -> str:
    return f"{PROJECTED_PREFIX}{legacy_row_id}"


def project_admin_alerts() -> list[dict[str, Any]]:
    """Every ACTIVE `watchlist_alerts` row belonging to an ADMIN-role account,
    shaped as a price-level predicate. **One SELECT. Nothing else.**

    ⛔ `is_active = 1` is part of the projection, not an afterthought: once the
    legacy path fires it sets `is_active = 0`, and a projection that ignored
    that would keep comparing against a row the member no longer has armed.
    """
    conn = _auth_db.get_connection()
    try:
        rows = conn.execute(
            "SELECT wa.* FROM watchlist_alerts wa "
            "JOIN users u ON u.id = wa.user_id "
            "WHERE wa.is_active = 1 AND u.role = ?",
            (ADMIN_ROLE,),
        ).fetchall()
    finally:
        conn.close()

    out: list[dict[str, Any]] = []
    for r in rows:
        row = dict(r)
        out.append({
            "legacy_id": str(row["id"]),
            "user_id": row["user_id"],
            "symbol": row["sym"],
            # `alert_type` is the legacy column; `level_kind` is the schema's
            # name for the same fact (F-S7-2). Mapped here, at the boundary,
            # rather than teaching the evaluator two vocabularies.
            "level_kind": row.get("alert_type") or _pl.FIXED,
            "target_price": row["target_price"],
            "direction": row["direction"],
            "anchor_t1": row.get("anchor_t1"), "anchor_p1": row.get("anchor_p1"),
            "anchor_t2": row.get("anchor_t2"), "anchor_p2": row.get("anchor_p2"),
            "drawing_id": row.get("drawing_id"),
        })
    return out


def legacy_would_fire(projected: dict[str, Any], price: float, now: float) -> bool:
    """The LEGACY rule, applied read-only.

    Mirrors `check_alerts_against_prices`'s condition exactly:

        if direction == "above" and current_price >= target: fire
        elif direction == "below" and current_price <= target: fire

    ⛔ The real function is NOT called: it mutates (`_trigger_alert` sets
    `is_active = 0`) and it DELIVERS. Running it to find out what it would do
    would tell a member about a dark comparison — the one outcome this whole
    checkpoint is built to prevent.

    ⭐ So this is a MIRROR, and a mirror is only honest with a rail on it:
    `test_legacy_would_fire_matches_the_real_legacy_function` drives the REAL
    `check_alerts_against_prices` against a seeded throwaway DB with delivery
    patched out, and asserts the two agree row for row
    (`lesson_rail_the_mirror_not_just_the_lane`).
    """
    target = _pl.level_at(projected, now)
    if target is None:
        return False
    if projected.get("direction") == "above":
        return price >= target
    if projected.get("direction") == "below":
        return price <= target
    return False


def _anchor_fingerprint(p: dict[str, Any]) -> tuple:
    return (p.get("level_kind"), p.get("target_price"), p.get("direction"),
            p.get("anchor_t1"), p.get("anchor_p1"), p.get("anchor_t2"), p.get("anchor_p2"))


def run_projected_comparison(price_map: dict[str, float], *,
                             now: Optional[float] = None,
                             db_path: str | None = None) -> dict[str, Any]:
    """One forward tick over the projected admin cohort.

    Per projected row:
      1. open a span if this is the first time we have seen it;
      2. **detect an anchor rewrite BY OBSERVATION** — if the geometry the
         projection reads now differs from what the span recorded, the member
         moved the line, and the clock resets;
      3. evaluate the dark rule and the legacy rule at the SAME instant;
      4. record one of the four outcomes.

    ⭐ Step 2 detects `resync_bound_alerts` **without instrumenting it.** The
    legacy path stays byte-identical — we are not allowed to add a hook, and we
    do not need one: the projection re-reads the geometry every tick, so a
    rewrite is visible as a changed fingerprint. ⛔ An instrumented legacy path
    would also only catch rewrites that went through that one function; an
    observed fingerprint catches a hand-edited row too.
    """
    now = time.time() if now is None else now
    projected = project_admin_alerts()
    seen, outcomes, moves = [], {}, []

    for p in projected:
        pid = projected_predicate_id(p["legacy_id"])
        seen.append(pid)
        sym = p["symbol"]
        if sym not in price_map:
            continue
        price = float(price_map[sym])

        span = _cmp.open_span_if_absent(pid, p, now=now, db_path=db_path)
        if _anchor_fingerprint(json.loads(span["twin"])) != _anchor_fingerprint(p):
            moves.append(_cmp.note_anchor_move(pid, p, now=now, db_path=db_path))
            span = _cmp.open_span_if_absent(pid, p, now=now, db_path=db_path)

        prev = span["prev_legacy"]
        dark_fires = _pl.level_at(p, now) is not None and _pl._crossed(
            p.get("direction", "above"), prev, price, float(_pl.level_at(p, now)))
        legacy_fires = legacy_would_fire(p, price, now)

        if dark_fires:
            _receipts.record_fire(
                predicate_id=pid, trigger_type=_pl.TYPE_ID, user_id=p["user_id"],
                entity_ref=sym, fire_key=f"proj:{p['legacy_id']}:{int(now)}",
                triggering_value=price,
                detail={"symbol": sym, "level": _pl.level_at(p, now),
                        "direction": p.get("direction"), "level_kind": p.get("level_kind"),
                        "projected": True, "dark": True},
                source_data_class="quote", freshness_class="real_time",
                as_of=now, db_path=db_path)

        outcome = _cmp.record_outcome(pid, dark_fires, legacy_fires, price,
                                      now=now, db_path=db_path)
        if outcome:
            outcomes[pid] = outcome

    return {"projected": len(projected), "evaluated": len(seen),
            "outcomes": outcomes, "anchor_moves": len(moves), "at": now}
