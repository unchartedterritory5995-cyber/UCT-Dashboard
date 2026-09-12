"""S7's SECOND trigger type: `price-level` (PRD-S7 §6.1 row 1; SPEC-S7 §5.1/§11).

⛔ CHECKPOINT 1 ONLY — THIS MODULE REGISTERS A TYPE AND NOTHING ELSE.

It declares `TYPE_ID` and `PARAMS_SCHEMA` so the registry and predicates.py's
`is_registered` check will accept a `price-level` predicate. It has **no
evaluator, no cycle, no delivery, and it reads no table.** Nothing a member can
see changes because nothing here can fire.

That is not a promise, it is a checkable fact: `tests/test_alert_taxonomy_price_level_schema.py`
asserts this file does not import `delivery` and exposes no evaluation entry
point. ⭐ "We did not call delivery" is a claim about a run; "this file does not
import delivery" is a property of the file, and only the second one can be
railed (`lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run`).

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

The three honest options (decline; add `geometry_updated_at`; version the
geometry) are recorded in GATE-S7-PRICE-LEVEL §3. ⛔ Which one is right is a
product call and is NOT made here.
"""
from __future__ import annotations

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


def register() -> None:
    """Idempotent -- call at process start.

    ⛔ Deliberately NOT called anywhere yet. Checkpoint 1 declares the type; the
    wiring lands with the evaluator, under its own approval. A registration with
    no evaluator behind it would let a predicate be created that nothing ever
    evaluates -- an armed alert that silently never fires, which is worse than
    no alert at all.
    """
    _registry.register_trigger_type(TYPE_ID, PARAMS_SCHEMA, module=__name__)
