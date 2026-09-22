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
from api.services import breadth_symbols
from api.services import rollout as _rollout
from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import price_level as _pl
from api.services.alert_taxonomy import price_level_compare as _cmp
from api.services.alert_taxonomy import receipts as _receipts

# The synthetic predicate id for a projected row. ⛔ Namespaced so a projected
# fire can never be confused with a harness-armed predicate's, and so the
# comparison bookkeeping is keyed by the LEGACY ROW ID as ruled.
PROJECTED_PREFIX = "legacy:"

# ─────────────────────────────────────────────────────────────────────────────
# D3 CP4 (GATE-D3-CP4-PRICE-LEVEL-CONSUMER, signed 2026-09-21, fingerprint
# 657002015) — S7 price-level becomes D3's first real consumer. See §2 of the
# proposal for the exact authorization; every DEFER item it names (retiring the
# poll path, any delivery, the upstream-load set-difference, massive chunking,
# G1) is out of scope here and NOT touched.
# ─────────────────────────────────────────────────────────────────────────────

# The owner tag `bar_stream.subscribe_symbols`/`bar_broadcaster.add_interest`
# refcount this arm's interest under — distinct from "bars" (the chart feed)
# and "nhnl" so releasing this arm's interest can never touch either.
_D3_OWNER = "s7_price_level_dark"

# SHOULD-BUILD (§2, §6): closes GATE-D3-REALTIME-STREAMING §7 gap 2 —
# `add_interest` has no length check of its own, and this is its first caller
# that can hand it a caller-controlled (member-armed) list. Sized conservatively
# per §6's own resolution (the owner declined a live-DB cohort-size read this
# pass): the S7 dark cohort is role-seeded to ADMINS ONLY during this dark
# period (`rollout.S7_DARK`), not the member base, so a low-hundreds ceiling is
# generous headroom rather than a guess at a real member-scale number. Tune here
# — no schema change — if a future cohort read says otherwise.
D3_COHORT_CAP = 200

# The reconciliation state for this arm's D3 subscriptions/interest. Module
# state, not a class, because the scheduler job that owns this arm runs with
# `max_instances=1` (api/main.py's `alert_taxonomy_price_level_dark` job) — one
# writer, ever, in production. Reconciled (not merely additive) every tick: a
# symbol whose alert left the cohort has its interest released the SAME tick, or
# the developing-bar partial `add_interest` holds alive for it would never be
# torn down (bar_broadcaster.py's own `remove_interest` docstring).
_d3_interest_syms: set[str] = set()


def _reset_d3_interest_for_tests() -> None:
    """Test-only: `_d3_interest_syms` is process-lifetime module state, and a
    test that seeds it and never clears it leaks into the next one — the same
    failure this repo's `auth`/`dbp` fixtures exist to prevent for the DBs."""
    global _d3_interest_syms
    _d3_interest_syms = set()


def _d3_prices_for(symbols: list[str]) -> tuple[dict[str, float], list[str]]:
    """The D3-SOURCED price arm — run BESIDE `_prices_for()` below, never
    replacing it this checkpoint (§2 MUST). Reads the same developing-bar
    partial the live chart feed reads, via `bar_broadcaster.get_last_price` —
    never a second provider call, never a fallback to Massive. A miss here
    means "D3 has no price for this symbol yet," which is itself part of what
    this comparison measures; it is reported, exactly like `_prices_for`'s own
    `missing`, never silently backfilled from the poll path.

    ⛔ CAPPED at `D3_COHORT_CAP` — a symbol past the cap never gets a D3
    subscription attempt at all this tick and is reported missing, the same as
    any other unpriced symbol.

    ⛔ RECONCILED: an empty `symbols` list (the empty-cohort tick) releases
    every previously-held interest, so a cohort that empties out cannot leak a
    subscription forever.

    Bounded and never raises, matching `_prices_for`'s own contract — a D3
    primitive failing costs this arm's tick, never the sweep, never a member
    request.
    """
    global _d3_interest_syms
    cohort = sorted(set(symbols))[:D3_COHORT_CAP]
    over_cap = sorted(set(symbols) - set(cohort))
    wanted = set(cohort)

    added = wanted - _d3_interest_syms
    removed = _d3_interest_syms - wanted
    if added:
        try:
            from api.services import bar_stream as _bar_stream
            _bar_stream.subscribe_symbols(added, owner=_D3_OWNER)
        except Exception:
            pass   # bounded: a subscribe failure costs this tick's D3 price, never the sweep
        try:
            from api.services.bar_broadcaster import get_broadcaster as _get_bb
            _get_bb().add_interest(added)
        except Exception:
            pass
    if removed:
        try:
            from api.services import bar_stream as _bar_stream
            _bar_stream.unsubscribe_symbols(removed, owner=_D3_OWNER)
        except Exception:
            pass
        try:
            from api.services.bar_broadcaster import get_broadcaster as _get_bb
            _get_bb().remove_interest(removed)
        except Exception:
            pass
    _d3_interest_syms = wanted

    prices: dict[str, float] = {}
    missing: list[str] = list(over_cap)
    try:
        from api.services.bar_broadcaster import get_broadcaster as _get_bb
        bb = _get_bb()
    except Exception:
        bb = None
    for sym in cohort:
        px = None
        if bb is not None:
            try:
                hit = bb.get_last_price(sym)
                px = (hit or {}).get("price")
            except Exception:
                px = None
        if px:
            prices[sym] = float(px)
        else:
            missing.append(sym)
    return prices, sorted(missing)

# ⚰️ S12'S SECOND MIGRATION DELETED ONE DECLARATION HERE. Retired verbatim:
#
#     ADMIN_ROLE = "admin"
#
# The first migration took the role out of the QUERY (the ⚰️ block in
# `project_admin_alerts` quotes it) and left it in the constant, referenced by
# nothing but that quotation. Two modules each declaring their own `"admin"` is
# the second-authority shape S12 exists to remove; `rollout.LEGACY_S7_ROLE` is
# the one authority now, and it seeds rather than decides.


def projected_predicate_id(legacy_row_id: str) -> str:
    return f"{PROJECTED_PREFIX}{legacy_row_id}"


def project_admin_alerts() -> list[dict[str, Any]]:
    """Every ACTIVE `watchlist_alerts` row belonging to a member of the
    `rollout:s7-dark` cohort, shaped as a price-level predicate.
    **One SELECT. Nothing else.**

    ⛔ `is_active = 1` is part of the projection, not an afterthought: once the
    legacy path fires it sets `is_active = 0`, and a projection that ignored
    that would keep comparing against a row the member no longer has armed.

    ⚰️ THE COHORT USED TO BE A ROLE CHECK, INLINED IN THIS JOIN — S12's first
    migration. The retired predicate, verbatim:

        "SELECT wa.* FROM watchlist_alerts wa "
        "JOIN users u ON u.id = wa.user_id "
        "WHERE wa.is_active = 1 AND u.role = ?",
        (ADMIN_ROLE,),

    ⭐ It was the same decision `event_proximity_projection._cohort_user_ids()`
    was making with different SQL, in a different module — one rollout gate, two
    authorities, with a third copy already scheduled for `catalyst-match` CP3.
    Both now resolve through `rollout.cohort_user_ids(S7_DARK)`, so the two dark
    runs can never describe different populations.

    ⛔⛔ AN EMPTY COHORT MEANS NO MEMBERS — no fallback to admins, ever (owner
    ruling, 2026-09-12). The swap is a no-op only because `main.py` seeds the tag
    from the role at boot.
    """
    cohort = _rollout.cohort_user_ids(_rollout.S7_DARK)
    if not cohort:
        # ⛔ RETURN EARLY RATHER THAN BUILD AN `IN ()`. SQLite accepts an empty
        # `IN ()` as "match nothing", which is the right answer — but going
        # through the query would make an empty cohort and a query that found no
        # active alerts indistinguishable in the logs, and those are different
        # facts about a dark run.
        return []

    conn = _auth_db.get_connection()
    try:
        placeholders = ",".join("?" * len(cohort))
        rows = conn.execute(
            "SELECT wa.* FROM watchlist_alerts wa "
            "JOIN users u ON u.id = wa.user_id "
            f"WHERE wa.is_active = 1 AND wa.user_id IN ({placeholders})",
            tuple(sorted(cohort)),
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


def run_projected_comparison(price_map: dict[str, float], d3_price_map: Optional[dict[str, float]] = None, *,
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

    `d3_price_map` (D3 CP4, §2 MUST) is a SECOND, OPTIONAL price source, run
    BESIDE `price_map` — never in its place. ⛔ **Opt-in per call, by omission,
    on purpose:** every existing caller of this function (this module's own
    pre-CP4 tests; the six OTHER trigger types have their own, separately
    defined `run_projected_comparison` — this is per-module) never passes it,
    so `d3_price_map is None` skips the source-agreement block outright rather
    than recording a `not_comparable` for a caller that never asked for this
    feature. Passing `d3_price_map={}` (the arm ran, this tick just had no D3
    prices) is a DIFFERENT, deliberate case — see `_cmp.record_source_outcome`.
    """
    now = time.time() if now is None else now
    projected = project_admin_alerts()
    seen, outcomes, moves, source_outcomes = [], {}, [], {}

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
        level = _pl.level_at(p, now)
        direction = p.get("direction", "above")
        dark_fires = level is not None and _pl._crossed(direction, prev, price, float(level))
        legacy_fires = legacy_would_fire(p, price, now)

        if dark_fires:
            _receipts.record_fire(
                predicate_id=pid, trigger_type=_pl.TYPE_ID, user_id=p["user_id"],
                entity_ref=sym, fire_key=f"proj:{p['legacy_id']}:{int(now)}",
                triggering_value=price,
                detail={"symbol": sym, "level": level,
                        "direction": p.get("direction"), "level_kind": p.get("level_kind"),
                        "projected": True, "dark": True},
                source_data_class="quote", freshness_class="real_time",
                as_of=now, db_path=db_path)

        outcome = _cmp.record_outcome(pid, dark_fires, legacy_fires, price,
                                      now=now, db_path=db_path)
        if outcome:
            outcomes[pid] = outcome

        # D3 CP4 — the SOURCE-agreement axis, against the SAME `prev` baseline
        # the dark-vs-legacy axis above just used. `prev_price` stays exactly
        # where it is (§2): nothing here reads or writes `prev_legacy` itself —
        # that already happened inside `record_outcome`, for the poll price,
        # unchanged. The D3 price only ever supplies a SECOND `crossed` verdict
        # against the SAME baseline the poll price was just tested against.
        if d3_price_map is not None:
            d3_price = d3_price_map.get(sym)
            d3_crossed = (
                None if d3_price is None or level is None
                else _pl._crossed(direction, prev, float(d3_price), float(level)))
            src_outcome = _cmp.record_source_outcome(
                pid, dark_fires, d3_crossed, now=now, db_path=db_path)
            if src_outcome:
                source_outcomes[pid] = src_outcome

    out = {"projected": len(projected), "evaluated": len(seen),
           "outcomes": outcomes, "anchor_moves": len(moves), "at": now}
    if d3_price_map is not None:
        out["source_outcomes"] = source_outcomes
    return out


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

    # ⛔⛔ S7 dark-read investigation, 2026-09-18 — UCT breadth pseudo-tickers (e.g.
    # UCTA5, "% of Stocks Above 5-Day MA") have no Massive quote at all, so the
    # fallback below always missed them. The REAL legacy path (live_prices.py)
    # resolves these via `breadth_symbols.latest_quotes` before it ever reaches
    # Massive; this sweep's independent resolver did not, so any predicate on a
    # breadth pseudo-ticker was silently NEVER-EVALUATED — invisible in the
    # comparison report, not merely a zero-count row.
    if missing:
        breadth_hits = [s for s in missing if breadth_symbols.is_breadth_symbol(s)]
        if breadth_hits:
            try:
                quotes = breadth_symbols.latest_quotes(breadth_hits) or {}
                for sym in breadth_hits:
                    px = (quotes.get(sym.strip().upper()) or {}).get("price")
                    if px:
                        prices[sym] = float(px)
                        missing.remove(sym)
            except Exception:
                pass          # bounded, same as the Massive fallback below

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

    D3 CP4 (§2 MUST): the D3-sourced price arm (`_d3_prices_for`) runs on every
    tick BESIDE the poll arm above — including the empty-cohort tick, so that
    an emptied cohort releases any D3 interest it was holding rather than
    leaking it.
    """
    at = time.time() if now is None else now
    symbols = sorted({p["symbol"] for p in project_admin_alerts() if p.get("symbol")})
    if not symbols:
        _d3_prices_for([])   # release any interest a now-empty cohort was holding
        out = {"projected": 0, "evaluated": 0, "outcomes": {},
               "anchor_moves": 0, "priced": 0, "no_price": [],
               "d3_priced": 0, "d3_no_price": [], "source_outcomes": {}}
        _beat(at, out, db_path=db_path)
        return out

    prices, missing = _prices_for(symbols)
    d3_prices, d3_missing = _d3_prices_for(symbols)
    out = run_projected_comparison(prices, d3_prices, now=now, db_path=db_path)
    out["priced"] = len(prices)
    out["no_price"] = missing
    out["d3_priced"] = len(d3_prices)
    out["d3_no_price"] = d3_missing
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


# D3 CP4 (§2 MUST): "a heartbeat on every tick... stamped with which source
# served each tick" -- two columns, same idempotent PRAGMA table_info + guarded
# ALTER idiom `price_level_compare.py` uses (this table predates CP4, so
# `_BEAT_DDL`'s own `CREATE TABLE IF NOT EXISTS` only ever reaches a brand-new
# store). Without these the ONE stamp this table carries answers "is the sweep
# alive" and nothing about whether the D3 arm specifically is -- a D3-only
# failure (get_last_price returning nothing for the whole cohort while the poll
# arm keeps working) would otherwise read identically to full health.
_D3_BEAT_COLUMNS = ("d3_priced", "d3_no_price")


def _ensure_d3_beat_columns(conn) -> None:
    have = {r[1] for r in conn.execute(
        "PRAGMA table_info(price_level_sweep_heartbeat)").fetchall()}
    if "d3_priced" not in have:
        conn.execute(
            "ALTER TABLE price_level_sweep_heartbeat ADD COLUMN d3_priced "
            "INTEGER NOT NULL DEFAULT 0")
    if "d3_no_price" not in have:
        conn.execute(
            "ALTER TABLE price_level_sweep_heartbeat ADD COLUMN d3_no_price "
            "TEXT NOT NULL DEFAULT '[]'")


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

    D3 CP4: `d3_priced`/`d3_no_price` mirror `priced`/`no_price` for the D3 arm,
    stamped on the SAME row at the SAME tick — so the two liveness answers can
    be read side by side rather than folded into one.

    Best-effort: a heartbeat that raised would take the comparison down with it,
    which inverts the whole point.
    """
    try:
        conn = _beat_conn(db_path)
        try:
            conn.executescript(_BEAT_DDL)
            _ensure_d3_beat_columns(conn)
            conn.execute(
                "INSERT INTO price_level_sweep_heartbeat "
                "(id, last_tick, ticks, projected, priced, no_price, d3_priced, d3_no_price) "
                "VALUES (1, ?, 1, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET last_tick=excluded.last_tick, "
                "ticks = price_level_sweep_heartbeat.ticks + 1, "
                "projected=excluded.projected, priced=excluded.priced, "
                "no_price=excluded.no_price, d3_priced=excluded.d3_priced, "
                "d3_no_price=excluded.d3_no_price",
                (at, int(out.get("projected") or 0), int(out.get("priced") or 0),
                 json.dumps(out.get("no_price") or []),
                 int(out.get("d3_priced") or 0),
                 json.dumps(out.get("d3_no_price") or [])))
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass
