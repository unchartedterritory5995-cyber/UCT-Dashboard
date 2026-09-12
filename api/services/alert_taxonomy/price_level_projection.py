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
import os
import time
from typing import Any, Optional

from api.services import auth_db as _auth_db
from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import price_level as _pl
from api.services.alert_taxonomy import price_level_compare as _cmp
from api.services.alert_taxonomy import receipts as _receipts

# The synthetic predicate id for a projected row. ⛔ Namespaced so a projected
# fire can never be confused with a harness-armed predicate's, and so the
# comparison bookkeeping is keyed by the LEGACY ROW ID as ruled.
PROJECTED_PREFIX = "legacy:"

ADMIN_ROLE = "admin"

#: ⛔ CP4 — THE ALL-MEMBERS COHORT, BEHIND ITS OWN FLAG, DEFAULT OFF.
#:
#: CP3 is approved for admin accounts only. CP4 widens the projection to every
#: member and **needs its own owner approval line after five sessions of
#: admin-cohort data** — so this flag exists, defaults OFF, and changes nothing
#: while unset.
#:
#: ⭐ A SECOND FLAG, NOT A WIDENED FIRST ONE. `ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED`
#: arms the sweep; this one decides WHO it reads. Collapsing them into one
#: variable would mean the only way to test the wider cohort is to also arm the
#: run, and the only way to narrow the cohort back is to stop the run — two
#: decisions the owner must be able to make separately.
#:
#: ⛔ The failure direction is NARROW. Unset, malformed, or any value other than
#: the accepted truthy set leaves the admin gate exactly as CP3 shipped it.
CP4_ALL_MEMBERS_FLAG = "ALERT_TAXONOMY_PRICE_LEVEL_DARK_ALL_MEMBERS"


def all_members_enabled() -> bool:
    """⛔ Read at CALL TIME, never captured at import.

    A module-level capture would make the flag a deploy-time decision and turn
    the owner's "unset it to narrow the cohort" into a fiction — the same defect
    `test_the_flag_is_read_per_request` exists to prevent on HUB_PREVIEW_ENABLED.
    """
    raw = (os.environ.get(CP4_ALL_MEMBERS_FLAG) or "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def projected_predicate_id(legacy_row_id: str) -> str:
    return f"{PROJECTED_PREFIX}{legacy_row_id}"


def project_admin_alerts() -> list[dict[str, Any]]:
    """Every ACTIVE `watchlist_alerts` row belonging to an ADMIN-role account,
    shaped as a price-level predicate. **One SELECT. Nothing else.**

    ⛔ `is_active = 1` is part of the projection, not an afterthought: once the
    legacy path fires it sets `is_active = 0`, and a projection that ignored
    that would keep comparing against a row the member no longer has armed.
    """
    all_members = all_members_enabled()
    conn = _auth_db.get_connection()
    try:
        if all_members:
            # ⛔ CP4 COHORT. Still joined to `users` rather than reading
            # `watchlist_alerts` alone: the join is what guarantees every
            # projected row belongs to a real account, and dropping it would
            # also project ORPHANED rows whose user was deleted.
            rows = conn.execute(
                "SELECT wa.* FROM watchlist_alerts wa "
                "JOIN users u ON u.id = wa.user_id "
                "WHERE wa.is_active = 1",
            ).fetchall()
        else:
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


# ─────────────────────────────────────────────────────────────────────────────
# THE TICK. Without this the whole checkpoint is inert.
# ─────────────────────────────────────────────────────────────────────────────

def _prices_for(symbols: list[str]) -> tuple[dict[str, float], list[str]]:
    """Resolve a price for each symbol: the SHARED live-price cache first, one
    bounded batch fetch for the misses.

    ⭐ Cache-first is not an optimisation, it is the load argument. `live_px1_*`
    is already populated by `/api/live-prices` on the 15 s poll, so on a weekday
    with an admin watching the dashboard this sweep costs ZERO network calls —
    the same read the awareness engine makes.

    ⛔ The fallback is bounded and never raises. A provider hiccup must cost this
    sweep a tick, never the scheduler thread, and never a member request.

    Returns `(prices, missing)`. ⭐ `missing` is returned rather than swallowed:
    a comparison that quietly saw no price for half the cohort would report
    "they agree" about ticks that never happened.
    """
    prices: dict[str, float] = {}
    missing: list[str] = []

    try:
        from api.routers.live_prices import cache as _px_cache, _px_key
    except Exception:
        _px_cache = _px_key = None

    for sym in symbols:
        px = None
        if _px_cache is not None:
            try:
                hit = _px_cache.get(_px_key(sym))
                px = (hit or {}).get("price") if hit else None
            except Exception:
                px = None
        if px:
            prices[sym] = float(px)
        else:
            missing.append(sym)

    if missing:
        try:
            from api.services import massive as _massive
            rich = _massive._get_client().get_batch_rich_snapshots(missing) or {}
            # ⛔ The provider keys its answer by CANONICAL UPPERCASE ticker, and
            # the projection hands back `watchlist_alerts.sym` verbatim. Looking
            # the answer up under the original spelling would silently miss every
            # lowercase row -- and a miss here is indistinguishable from a quiet
            # market unless it is mapped back and reported.
            still = []
            for sym in missing:
                row = rich.get(sym) or rich.get(sym.upper()) or {}
                px = row.get("price")
                if px:
                    prices[sym] = float(px)
                else:
                    still.append(sym)
            missing = still
        except Exception:
            pass          # bounded: the misses stay missing and are REPORTED

    return prices, missing


def run_dark_sweep(*, now: Optional[float] = None,
                   db_path: str | None = None) -> dict[str, Any]:
    """One forward tick of the DARK comparison over the admin cohort.

    ⛔ THIS IS THE ONLY THING THAT MAKES CHECKPOINT 3 MORE THAN A LIBRARY. The
    evaluator, the projection and the harness were all built, tested and green
    before anything called them — which is this repo's most-repeated defect
    (`lesson_built_tested_green_and_unreachable`), and it very nearly shipped
    again here: CP1 and CP2 were correctly "registration only, no scheduler
    entry", and that invariant was carried into CP3 **by habit** after the owner
    had explicitly approved a harness that "runs against the projected
    predicates". A dark run that never runs produces five sessions of nothing and
    reads, next weekend, exactly like five sessions of agreement.

    ⛔ STILL DARK. This writes `alert_fires` + receipts and comparison rows. It
    imports no delivery path, and the rails assert that from the source.
    """
    at = time.time() if now is None else now
    symbols = sorted({p["symbol"] for p in project_admin_alerts() if p.get("symbol")})
    if not symbols:
        out = {"projected": 0, "evaluated": 0, "outcomes": {},
               "anchor_moves": 0, "priced": 0, "no_price": []}
        _beat(at, out, db_path=db_path)
        return out

    prices, missing = _prices_for(symbols)
    out = run_projected_comparison(prices, now=now, db_path=db_path)
    out["priced"] = len(prices)
    out["no_price"] = missing
    _beat(at, out, db_path=db_path)
    return out


_BEAT_DDL = """
CREATE TABLE IF NOT EXISTS price_level_sweep_heartbeat (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    last_tick   REAL NOT NULL,
    ticks       INTEGER NOT NULL DEFAULT 0,
    projected   INTEGER NOT NULL DEFAULT 0,
    priced      INTEGER NOT NULL DEFAULT 0,
    no_price    TEXT    NOT NULL DEFAULT '[]'
);
"""


def _beat_conn(db_path: str | None = None):
    """The heartbeat's OWN connector.

    ⭐ It is a separate seam for one reason: "a heartbeat failure never takes the
    comparison down" is only a testable claim if the heartbeat can be broken
    ALONE. Patching the shared `_db.connect` breaks the comparison too, so the
    test would have been asserting a property of a system that had already
    failed -- green for a reason unrelated to the guard
    (`lesson_a_guard_that_tests_the_adjacent_thing`).
    """
    return _db.connect(db_path)


def _beat(at: float, out: dict, *, db_path: str | None = None) -> None:
    """Stamp one tick. ⭐ THE ONLY THING THAT CAN ANSWER "IS IT STILL TICKING".

    ⛔ The comparison spans cannot answer it and it is worth saying why: a span
    OPENS once per predicate and thereafter only its counters move, with no
    timestamp on them. So a store holding spans proves the sweep ran AT LEAST
    ONCE and nothing more — a sweep that died at 09:01 looks identical at 15:00
    to one that has been running all day. ⭐ A monotonic tick count plus a
    wall-clock stamp is the smallest thing that distinguishes them, and *"it
    stopped hours ago"* is precisely the failure this dark run cannot afford to
    discover next weekend.

    ⛔ It is stamped on EVERY tick, including the ones that found no cohort and
    the ones that priced nothing. A heartbeat that only beats on success is a
    success detector, not a liveness one.

    Best-effort: a heartbeat that raised would take the comparison down with it,
    which inverts the whole point.
    """
    try:
        conn = _beat_conn(db_path)
        try:
            conn.executescript(_BEAT_DDL)
            conn.execute(
                "INSERT INTO price_level_sweep_heartbeat "
                "(id, last_tick, ticks, projected, priced, no_price) "
                "VALUES (1, ?, 1, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET last_tick=excluded.last_tick, "
                "ticks = price_level_sweep_heartbeat.ticks + 1, "
                "projected=excluded.projected, priced=excluded.priced, "
                "no_price=excluded.no_price",
                (at, int(out.get("projected") or 0), int(out.get("priced") or 0),
                 json.dumps(out.get("no_price") or [])))
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass
