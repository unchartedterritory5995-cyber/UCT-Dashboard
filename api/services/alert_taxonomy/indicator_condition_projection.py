"""S7 `indicator-condition` **CP3** — the dark projection over real member rows.

Signed 2026-09-13, GATE-S7-INDICATOR-CONDITION approval line 3 (the
dependency-discharge line), fingerprint **`4e8d3af5d`**. Its dependency —
PRD-D2 §9.5, signed as **GATE-D2 CP4** (`3257cc319`, merged `404b808c5`) — is
discharged.

⛔⛔ **THE DOMINANT FACT OF THIS CHECKPOINT, STATED FIRST BECAUSE EVERYTHING ELSE
FOLLOWS FROM IT: THIRTY OF THIRTY-ONE PREDICATES ARE NOT COMPARABLE, AND THAT IS
A MEASUREMENT, NOT A FAILURE.** F-S7-IC-1:

    legacy addresses  indicator_alert_evaluator.all_addresses()    31
    book metrics      api/data/canonical_address_book.json        142
    INTERSECTION                                                    0

The honest reading of that 0 is **ONE rename (`close` ↔ `ohlcv.c`) and THIRTY
genuine absences**. The two lanes do not disagree — **they never met.** Legacy
speaks indicator (`rsi`, `bb.upper`, `adx.adx`); the book speaks screener-row
(`adr_pct`, `above_50sma`). A comparison between them is not a close call; it is
undefined.

⭐ **SO `NOT_COMPARABLE` IS COMPUTED PER PREDICATE, BEFORE ANY VALUE IS READ, AND
IT IS NEVER AGREEMENT.** The alternative — letting a non-intersecting predicate
fall through to `observe()` — would classify it `LEGACY_ONLY` every time the
legacy side fired, which reads as *"the new lane is missing fires"*. It is not:
the new lane was never asked a question it could answer. **A comparison that
reports a disagreement between two vocabularies that share no terms is
manufacturing a finding**, and the four-outcome contract exists precisely so
*"we could not compute it"* survives beside yes and no.

⚠️ **AND THE NUMBER IS EXPECTED TO BE THIRTY, WHICH IS WHY THE CONTROL MATTERS.**
A harness whose every answer is `NOT_COMPARABLE` is indistinguishable from a
harness that has broken and calls everything incomparable. The non-vacuity
control is the **one renamed pair**: `close` MUST come back comparable, and
`tests/test_alert_taxonomy_indicator_condition_projection.py` fails if it does
not. Without that, the 30 proves nothing.

──────────────────────────────────────────────────────────────────────────────
WHY COMPARABILITY ASKS `declarations()` AND NOT `resolve()`
──────────────────────────────────────────────────────────────────────────────

D2 CP4 exposes both. `resolve()` binds parameters and returns a computation
descriptor; `declarations()` is the vocabulary itself. **Comparability is a
question about VOCABULARY, not about a value**, so it is asked of the vocabulary.

⛔ **AND `resolve()` IS FLAG-GATED, WHICH WOULD BE FATAL HERE.**
`CANONICAL_INDICATOR_AXIS_ENABLED` is dark and must stay dark — nothing reads the
axis for real yet. If comparability went through `resolve()`, then with the flag
OFF *every* predicate would answer `DISABLED`, the harness would record thirty-one
incomparables instead of thirty, and the one real signal in this checkpoint would
vanish **exactly when the flag is in its shipped state**. That is
`lesson_a_rails_important_half_can_be_opt_in` — a rail whose meaning depends on a
flag nobody has set. `test_comparability_does_not_depend_on_the_axis_flag` is the
rail on that, asserted in both flag states.

⭐ It is the same authority either way: `resolve()` is built ON `declarations()`.
This reads it one layer down, where the flag does not sit.

──────────────────────────────────────────────────────────────────────────────
WHAT THIS CHECKPOINT IS NOT
──────────────────────────────────────────────────────────────────────────────

⛔ **NO DELIVERY IMPORT.** Nothing here can reach a member. Railed by name.
⛔ **NO LEGACY CHANGE.** `indicator_alert_service` and `indicator_alert_evaluator`
   are READ. Not one byte of either is edited by this checkpoint.
⛔ **IT COMPUTES NO INDICATOR.** Values arrive from the caller (`value_map`),
   exactly as `price_level_projection` takes a `price_map`. A projection that
   computed its own indicator would be a second calculation engine beside the
   one the legacy lane already runs — the thing D2 exists to prevent.
⛔ **THE SWEEP IS OFF BY DEFAULT** behind its own flag, and this checkpoint does
   not arm it.
"""
from __future__ import annotations

import os
import time
from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services import indicator_alert_service as _legacy
from api.services import rollout
from api.services.alert_taxonomy import indicator_condition as _ic
from api.services.alert_taxonomy import indicator_condition_compare as _cmp
from api.services.canonical import address_book as _book
from api.services.canonical import indicator_axis as _axis

_ET = ZoneInfo("America/New_York")

FLAG = "ALERT_TAXONOMY_INDICATOR_CONDITION_DARK_ENABLED"

PROJECTED_PREFIX = "legacy:"

#: Why a predicate cannot be compared. Each is a DIFFERENT fact and they are
#: never collapsed — "the axis does not know this name" and "the axis knows it
#: but the book carries no form of it" send a reader to different places.
NOT_IN_AXIS = "not_in_axis"
NO_BOOK_FORM = "no_book_form"
COMPARABLE = "comparable"


def enabled() -> bool:
    """⛔ OFF unless explicitly set. Arming is the owner's flip, not CP3's."""
    return os.environ.get(FLAG, "").strip().lower() in ("1", "true", "yes")


def projected_predicate_id(legacy_id: Any) -> str:
    return f"{PROJECTED_PREFIX}{_ic.TYPE_ID}:{legacy_id}"


def cohort_user_ids() -> set[str]:
    """The `rollout:s7-dark` cohort — ⛔ NEVER a role check.

    `rollout.py:29-38` rules that an EMPTY cohort means NO MEMBERS and never a
    fallback to admins. An empty projection is the correct answer to an empty
    cohort, not a reason to widen it.
    """
    try:
        return rollout.cohort_user_ids(rollout.S7_DARK)
    except Exception:
        return set()


def projected_alerts() -> list[dict]:
    """Every active legacy alert belonging to the cohort.

    ⛔⛔ `list_active()` IS READ WHOLE — no filter on `state`, `scope` or
    `def_source`. `indicator_alert_service.py:153-158` and `:169-176` both record
    that filtering there shrinks what the shadow lane observes and makes a
    cutover gate pass on a smaller set. The ONLY narrowing is the cohort, which
    is this checkpoint's authorized scope.
    """
    cohort = cohort_user_ids()
    if not cohort:
        return []
    return [r for r in _legacy.list_active() if str(r.get("user_id")) in cohort]


def params_of(row: dict) -> dict[str, Any]:
    """The eight-key predicate params, from the legacy row's own columns.

    ⚠️ EIGHT KEYS, and the timeframe is its OWN key — SPEC-S7 §5.2 as amended
    2026-09-13 against the merged code. The canonical ADDRESS is assembled from
    `(indicator, tf)` one layer down, inside `indicator_condition`; it is not the
    shape a predicate is registered with, and F-S7-IC-2 records the eventual
    collapse into a single `address` param.
    """
    return {k: row.get(k) for k in _ic.PARAMS_SCHEMA}


def comparability(metric_name: str) -> tuple[str, Optional[str]]:
    """Can this legacy metric be compared against the canonical book at all?

    Returns `(verdict, book_target)`. Asked of D2 CP4's **axis**, which is the
    one authority on what a legacy indicator name means — never a table here.

    ⛔ NOT FLAG-GATED. See the module docstring: routing this through the
    flag-gated `resolve()` would make every predicate incomparable in the
    shipped (dark) state and delete the one real signal this checkpoint carries.
    """
    name = (metric_name or "").strip()
    decl = _axis.declarations().get(name)
    if decl is None:
        return NOT_IN_AXIS, None
    target = decl.get("renames_to")
    if target and _book.metric(target) is not None:
        return COMPARABLE, target
    return NO_BOOK_FORM, None


def comparability_census() -> dict[str, Any]:
    """The F-S7-IC-1 measurement, recomputed from source every call.

    ⭐ Its own non-vacuity control: `comparable` must be NON-EMPTY (the `close`
    rename) and `not_comparable` must be non-empty too. A census that is all of
    one kind is a census that has stopped measuring.
    """
    comparable, not_comparable = {}, {}
    for name in _axis.declarations():
        verdict, target = comparability(name)
        (comparable if verdict == COMPARABLE else not_comparable)[name] = target or verdict
    return {"comparable": comparable, "not_comparable": not_comparable,
            "n_comparable": len(comparable), "n_not_comparable": len(not_comparable)}


def run_projected_comparison(value_map: dict[Any, float] | None = None, *,
                             now: Optional[float] = None,
                             db_path: str | None = None) -> dict[str, Any]:
    """One forward tick over the projected cohort. One span per legacy alert.

    `value_map` maps a legacy alert id to the value observed for it THIS tick.
    ⛔ Supplied by the caller; this module computes no indicator (see the
    docstring). A predicate with no value this tick is observed as such rather
    than skipped silently — `no_value` is one of the four observations.
    """
    now = time.time() if now is None else now
    value_map = value_map or {}
    day = market_date(now)

    rows = projected_alerts()
    outcomes: dict[str, dict] = {}
    incomparable: dict[str, str] = {}
    observed = 0

    for row in rows:
        pid = projected_predicate_id(row.get("id"))
        params = params_of(row)
        sym = str(row.get("sym") or "")
        verdict, _target = comparability(str(row.get("indicator") or ""))

        if verdict != COMPARABLE:
            # ⛔⛔ RECORDED PER PREDICATE, BEFORE ANY VALUE IS READ, AND NEVER AS
            # AGREEMENT. This is the thirty. Letting it fall through to observe()
            # would report LEGACY_ONLY — "the new lane is missing fires" — for a
            # question the new lane was never able to be asked.
            incomparable[pid] = verdict
            _cmp.note_not_comparable(pid, params, verdict, day,
                                     now=now, db_path=db_path)
            continue

        value = value_map.get(row.get("id"))
        prev = row.get("last_value")
        observed += 1
        tally = _cmp.observe(
            pid, params, day,
            entity_ref=sym,
            value=None if value is None else float(value),
            prev_value=None if prev is None else float(prev),
            arm_epoch=int(row.get("arm_epoch") or 0),
            now=now, db_path=db_path)
        if tally.get("outcome"):
            outcomes[pid] = tally

    return {"members": len(cohort_user_ids()), "alerts": len(rows),
            "observed": observed, "not_comparable": len(incomparable),
            "not_comparable_by_predicate": incomparable,
            "outcomes": outcomes, "at": now, "market_date": day}


def run_dark_sweep(value_map: dict[Any, float] | None = None, *,
                   now: Optional[float] = None,
                   db_path: str | None = None) -> dict[str, Any]:
    """One forward tick of the DARK comparison — the sweep's entry point.

    ⛔ STILL DARK. Comparison spans only: no delivery import, and nothing here
    writes the legacy lane's own tables.
    """
    at = time.time() if now is None else now
    if not enabled():
        return {"skipped": "flag off", "at": at}
    out = run_projected_comparison(value_map, now=at, db_path=db_path)
    if not out["alerts"]:
        # ⛔⛔ BEAT ANYWAY. `observe()` and `note_not_comparable()` both carry the
        # heartbeat, and neither is reached when the cohort is empty — so without
        # this the liveness signal stops exactly when the sweep has nothing to
        # say, which is indistinguishable from the sweep being dead. A heartbeat
        # that only beats on success is a success detector.
        _cmp.beat(out["market_date"], now=at, db_path=db_path)
    return out


def market_date(now: Optional[float] = None) -> str:
    """The ET session date. ⛔ ET, never UTC and never the box's local zone — a
    sweep at 20:00 ET belongs to the session that just closed, and a UTC date
    would file it under tomorrow."""
    now = time.time() if now is None else now
    return datetime.fromtimestamp(now, _ET).strftime("%Y-%m-%d")
