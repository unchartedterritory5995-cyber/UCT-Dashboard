"""S7's SECOND trigger type: `price-level` (PRD-S7 §6.1 row 1; SPEC-S7 §5.1/§11).

⛔ CHECKPOINT 2 — A DARK EVALUATOR. IT FIRES, AND IT CANNOT REACH A MEMBER.

⚰️ CP1's header said "no evaluator, no cycle, no delivery, and it reads no
table." Two of those four are now false, and the sentence is corrected here
rather than left to rot: this module HAS an evaluator and DOES read the
predicate table. **No cycle and no delivery remain true, and they are the two
that matter.**

`evaluate()` writes `alert_fires` rows and receipts. It **never imports or calls
`delivery`**, so no member is told. That is not a promise — it is a checkable
fact: `tests/test_alert_taxonomy_price_level_schema.py` asserts this file has no
`delivery` import and that nothing schedules `evaluate()`. ⭐ "We did not call
delivery" is a claim about a run; "this file does not import delivery" is a
property of the file, and only the second one can be railed
(`lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run`).

⛔ **CP2 EVALUATES ONLY PREDICATES THE HARNESS ARMED.** It does not read,
mirror or shadow a single real member `watchlist_alerts` row. That is CP3 and
needs its own approval line.

──────────────────────────────────────────────────────────────────────────────
WHY THE SCHEMA HAS TWO SHAPES — F-S7-2, and it is the whole reason this module
is a checkpoint rather than a one-liner
──────────────────────────────────────────────────────────────────────────────

SPEC-S7 describes `price-level` as a level comparison. **The shipped path is not
only that.** `api/services/watchlist_alert_service.py::_alert_level_now` (`:94`)
returns a level that depends on WHEN you ask:

    if (alert.get("alert_type") == "trendline"):
        ... return p1 + (p2 - p1) * ((now_sec - t1) / (t2 - t1))
    return alert["target_price"]

So a shipped price alert is one of exactly two shapes:

  * `"price"`     — a fixed horizontal level (`target_price`). The column
                    default in `auth_db.py`'s `watchlist_alerts` DDL.
  * `"trendline"` — two anchors, `(anchor_t1, anchor_p1)` and
                    `(anchor_t2, anchor_p2)`, linearly INTERPOLATED between
                    them and EXTRAPOLATED beyond them, evaluated per cycle.

⛔ A `params_schema` of `{symbol, target_price, direction}` cannot represent the
second shape, and an absorption built on it would silently stop arming every
trendline alert a member has drawn. That is member-visible — an armed alert
quietly ceasing to be armed — so it would be a separate PR under S7 ruling 2b,
never a migration detail. The schema below therefore carries the geometry.

⚠️ THE EXTRAPOLATION IS DELIBERATE AND HAS A CONSEQUENCE. Past `t2` the line
continues indefinitely at the same slope, which is correct for a trendline
drawing — and it means a `price-level` predicate has **no natural expiry**. The
obvious "is this level in the past?" cleanup sweep would be wrong here.

──────────────────────────────────────────────────────────────────────────────
⛔ F-S7-3 — WHAT THIS TYPE CANNOT HONESTLY OFFER YET
──────────────────────────────────────────────────────────────────────────────

SPEC-S7 §5.6 lets a type register a `replay_fn` — "would have fired N times."
**This module deliberately registers none, and that is a finding, not an
omission.**

`watchlist_alert_service.resync_bound_alerts` (`:130`) re-points a bound alert's
anchors IN PLACE when the member moves the drawing. The existing code protects
the half that matters most — the `UPDATE` is scoped `WHERE is_active = 1`, so a
TRIGGERED alert's geometry is never rewritten ("moving the line on Thursday must
not rewrite what Tuesday said"). ⭐ That guard is correct and must survive
absorption intact.

But for an ACTIVE, not-yet-fired alert the geometry IS overwritten, and
`watchlist_alerts` has **no `updated_at` column** (`auth_db.py:599`). So the
geometry's age is unrecoverable: a replay would compute against today's line as
though it had always been in force, and nothing in the row could detect that the
member moved it yesterday. A number like "would have fired 4 times" would be a
fabricated receipt — and MORE convincing than a blank, because it carries a
figure.

⛔ **RULED 2026-09-12 (owner): NO REPLAY, EVER. THE COMPARISON IS FORWARD-ONLY.**
The three options CP1 recorded are superseded. The dark predicate and its legacy
twin are evaluated live against the same ticks from the moment the dark predicate
arms; there is no backfill over historical bars at all. ⭐ That is stronger than
"decline when the line moved", because deciding *whether* it moved needs a fact
the legacy row does not carry — forward-only never needs the geometry's history,
since it only ever compares two things that were both live at the same instant.

An anchor rewrite **resets the comparison clock** and the pre-move span is
**NOT COMPARABLE** — never agreement, never disagreement. `note_anchor_write()`
below stamps `anchors_set_at` + a monotonic `anchor_version` on the NEW store's
predicate so the dark side is auditable. ⛔ `watchlist_alerts` gains no columns.
"""
from __future__ import annotations

import time
from typing import Any, Optional

from api.services.alert_taxonomy import predicates as _predicates
from api.services.alert_taxonomy import receipts as _receipts
from api.services.alert_taxonomy import registry as _registry

TYPE_ID = "price-level"

PARAMS_SCHEMA = {
    # Which of the two shipped shapes this predicate is. See the module
    # docstring: both are live today, and the set is derived from the legacy
    # module by the rail rather than trusted from this comment.
    "level_kind": "string -- 'price' (fixed level) or 'trendline' (two anchors, "
                  "interpolated and extrapolated at evaluation time)",
    "direction": "string -- 'above' | 'below'; which side of the level arms the fire",

    # --- shape 1: fixed level -------------------------------------------------
    "target_price": "number | null -- the fixed level. REQUIRED when level_kind "
                    "== 'price'. For a trendline this is the legacy row's "
                    "last-computed level and is NOT the authority -- the anchors are.",

    # --- shape 2: trendline ---------------------------------------------------
    "anchor_t1": "integer | null -- first anchor's epoch seconds. REQUIRED when "
                 "level_kind == 'trendline'",
    "anchor_p1": "number | null -- first anchor's price. REQUIRED when level_kind == 'trendline'",
    "anchor_t2": "integer | null -- second anchor's epoch seconds. REQUIRED when "
                 "level_kind == 'trendline'; must differ from anchor_t1 (the legacy "
                 "path guards `t2 != t1` and falls back to the fixed level otherwise)",
    "anchor_p2": "number | null -- second anchor's price. REQUIRED when level_kind == 'trendline'",

    # --- provenance of the level ---------------------------------------------
    "drawing_id": "string | null -- the chart drawing this level is bound to, when it "
                  "is bound. ⛔ Its presence is what makes F-S7-3 (the unreplayable "
                  "moved-line case) possible; it is carried so the condition is "
                  "DETECTABLE rather than invisible, not because this module acts on it",
}

# ⛔ NO `replay_fn`. See F-S7-3 in the module docstring -- registering one today
# would mean emitting a number we cannot stand behind for any bound trendline.


def register(*, db_path: str | None = None) -> None:
    """Idempotent -- call at process start.

    ⛔ Deliberately NOT called anywhere yet. Checkpoint 1 declares the type; the
    wiring lands with the evaluator, under its own approval. A registration with
    no evaluator behind it would let a predicate be created that nothing ever
    evaluates -- an armed alert that silently never fires, which is worse than
    no alert at all.
    """
    _registry.register_trigger_type(TYPE_ID, PARAMS_SCHEMA, module=__name__, db_path=db_path)


# ─────────────────────────────────────────────────────────────────────────────
# CHECKPOINT 2 — the dark evaluator
# ─────────────────────────────────────────────────────────────────────────────

FIXED = "price"
TRENDLINE = "trendline"


def level_at(params: dict[str, Any], now_sec: float) -> Optional[float]:
    """The predicate's level at `now_sec`.

    ⛔ THIS MUST AGREE WITH `watchlist_alert_service._alert_level_now`, and the
    agreement is RAILED rather than asserted in prose:
    `test_level_at_matches_the_legacy_level_function` drives both over generated
    cases and compares. ⭐ That equivalence IS the absorption's core claim — if
    the two level functions disagree, every downstream comparison measures the
    disagreement rather than the migration.

    The legacy function is deliberately NOT imported here: it pulls in
    `email_service` and `alerts`, and a module whose whole contract is "cannot
    reach a member" must not import the module that delivers to one. The test
    does the cross-import; the product code does not.
    """
    if params.get("level_kind") == TRENDLINE:
        t1, p1 = params.get("anchor_t1"), params.get("anchor_p1")
        t2, p2 = params.get("anchor_t2"), params.get("anchor_p2")
        if None not in (t1, p1, t2, p2) and t2 != t1:
            return p1 + (p2 - p1) * ((now_sec - t1) / (t2 - t1))
        # Legacy falls back to the fixed level when the geometry is unusable
        # (its own `t2 != t1` guard). Mirrored deliberately — diverging here
        # would make the comparison disagree for a reason that is not the
        # migration.
    return params.get("target_price")


def _crossed(direction: str, prev: Optional[float], now: float, level: float) -> bool:
    """A CROSS, not a level test.

    ⛔ `price >= level` alone re-fires on every tick while price sits above the
    line. The predicate's `fire_key` dedup would swallow the repeats, which is
    exactly what makes the level test the dangerous version: the comparison
    would look clean while the two sides disagreed about WHEN the event
    happened. Requiring a transition makes the fire's identity the crossing
    rather than the sampling.

    ⛔ `prev is None` — the first observation after arming — is NOT a cross. A
    predicate armed while price is already through its level must not fire on
    arming. Forward-only means "from now", and reporting an already-true
    condition as a new event is the replay this ruling forbids, in miniature.
    """
    if prev is None:
        return False
    if direction == "above":
        return prev < level <= now
    if direction == "below":
        return prev > level >= now
    return False


def note_anchor_write(predicate_id: str, anchors: dict[str, Any], *,
                      now: Optional[float] = None,
                      db_path: str | None = None) -> dict[str, Any]:
    """Stamp an anchor write on the NEW store: `anchors_set_at` + a monotonic
    `anchor_version`.

    ⛔ This exists because the LEGACY row cannot answer "when did this geometry
    take effect" — `watchlist_alerts` has no `updated_at` (F-S7-3). The new
    store records what the old one cannot, and ⛔ `watchlist_alerts` is NOT
    altered to match: the legacy path stays byte-identical (owner ruling).

    The version counter is monotonic per predicate and never reused, so a
    comparison span can be keyed to the exact geometry it observed.
    """
    now = time.time() if now is None else now
    pred = _predicates.get_predicate(predicate_id, db_path=db_path) or {}
    state = pred.get("last_seen_state") or {}
    version = int(state.get("anchor_version", 0)) + 1
    new_state = dict(state)
    new_state.update({
        "anchor_version": version,
        "anchors_set_at": now,
        "anchors": dict(anchors),
    })
    # ⛔ THE PRICE BASELINE DIES WITH THE OLD GEOMETRY. Found by
    # `test_the_first_tick_after_a_move_is_never_a_cross`, and it is a real
    # defect rather than a test detail: a cross is `prev < level <= now`, so
    # keeping `prev_price` across an anchor rewrite reports a crossing that
    # never happened -- the price did not move through the new line, THE LINE
    # MOVED UNDER THE PRICE. Clearing it makes the next tick a baseline
    # (`_crossed` returns False on `prev is None`), which is what "the
    # comparison clock resets" actually means on this side.
    new_state.pop("prev_price", None)
    _predicates.update_last_seen_state(predicate_id, new_state, db_path=db_path)
    return new_state


def evaluate(price_map: dict[str, float], *, now: Optional[float] = None,
             predicate_ids: Optional[list] = None,
             db_path: str | None = None) -> list:
    """DARK evaluation over `price_map` ({SYM: price}). Returns the fires written.

    ⛔ NO DELIVERY. Writes `alert_fires` + receipts and stops. A member is never
    told, by construction: this module does not import `delivery`.

    ⛔ `predicate_ids` SCOPES the sweep, and CP2's callers always pass it — the
    harness evaluates only predicates it armed itself. Passing None evaluates
    every active `price-level` predicate, which is correct for CP3 and is NOT
    what CP2 does.

    The previous price per predicate lives in `last_seen_state.prev_price`, so a
    cross is measured against the last tick THIS predicate saw rather than a
    global last tick — two predicates armed at different moments must not share
    a baseline.
    """
    now = time.time() if now is None else now
    active = _predicates.list_predicates(type_id=TYPE_ID, active_only=True, db_path=db_path)
    if predicate_ids is not None:
        wanted = set(predicate_ids)
        active = [p for p in active if p["id"] in wanted]

    fires = []
    for pred in active:
        sym = (pred.get("entity_scope") or {}).get("symbol")
        if not sym or sym not in price_map:
            continue
        price = float(price_map[sym])
        params = pred.get("params") or {}
        level = level_at(params, now)
        if level is None:
            continue
        state = pred.get("last_seen_state") or {}
        prev = state.get("prev_price")
        direction = params.get("direction", "above")

        if _crossed(direction, prev, price, float(level)):
            # The fire_key carries the anchor version: a line that MOVED and
            # crossed again is a DIFFERENT event, not a duplicate of the old
            # one. Without the version, dedup would silently swallow the second
            # crossing of a re-pointed line.
            version = int(state.get("anchor_version", 0))
            fire_key = "cross:%s:%d:%d" % (direction, version, int(now))
            fire_id = _receipts.record_fire(
                predicate_id=pred["id"],
                trigger_type=TYPE_ID,
                user_id=pred.get("user_id"),
                entity_ref=sym,
                fire_key=fire_key,
                triggering_value=price,
                detail={"symbol": sym, "level": level, "direction": direction,
                        "level_kind": params.get("level_kind"),
                        "anchor_version": version, "dark": True},
                source_data_class="quote",
                freshness_class="real_time",
                as_of=now,
                db_path=db_path,
            )
            if fire_id is not None:
                fires.append({"fire_id": fire_id, "predicate_id": pred["id"],
                              "symbol": sym, "level": level, "price": price,
                              "at": now})

        new_state = dict(state)
        new_state["prev_price"] = price
        _predicates.update_last_seen_state(pred["id"], new_state, db_path=db_path)

    return fires
