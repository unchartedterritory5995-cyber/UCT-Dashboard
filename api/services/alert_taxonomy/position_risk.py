"""GATE-S7-POSITION-RISK — S7 trigger type 4, and it is HALF an absorption.

⛔ Approved for CHECKPOINTS 1-2 ONLY (owner, 2026-09-13). CP1 registers the type
and pins the schema. CP2 adds a dark evaluator and a forward-only harness over
HARNESS-ARMED predicates. **No delivery. No projection of member rows. No legacy
change.** CP3, CP4 and the flip each need a new line.

──────────────────────────────────────────────────────────────────────────────
⛔⛔ THE LEGACY SHAPES, MEASURED BEFORE THIS SCHEMA WAS PINNED
──────────────────────────────────────────────────────────────────────────────

Everything in this block was DERIVED BY AST from
`api/services/awareness/rules.py`, not read from the gate packet's prose. The
walk parsed the file, blanked every string-only `Expr` statement and re-emitted
with `ast.unparse` (which drops comments for free). **CONTROL:** a sentence that
exists only in a comment (`"nothing real to watch"`) and one that exists only in
the module docstring (`"Pure watch-rule functions"`) are both present in the raw
file and both absent from the stripped source, while `def rule_stop_watch` and
`is_placeholder_stop` are still visible. The stripper removes prose and still
sees code.

**What `rule_stop_watch` READS — five position fields and one context key:**

    pos['symbol']       upper-cased; a falsy symbol skips the row
    pos['side']         must be in ('Long', 'Short') — the membership guard
    pos['stop_price']   None skips the row
    pos['entry_price']  None skips the row
    pos['source']       consulted ONLY by the placeholder policy gate
    scan_ctx['live_prices']   {SYMBOL: price}; a miss skips the row silently
    user_ctx['positions']     the population

Calls it makes: `InsightCandidate`, `_stop_distance_pct`, `is_placeholder_stop`,
`float`, `upper`, `append`, `get`. **No DB, no network, no environment read** —
`rules.py` does not import `os` at all, so unlike `catalyst-match` there is no
call-time configuration for the mirror to follow and no F-S7-5 trap here.

**What it EMITS — exactly two `kind=` literals, with their scoring:**

    kind=stop_hit         base_signal 1.0          mult 1.3  urgency 2.0
                          dedup_key f'{sym}:stop_hit'
    kind=stop_proximity   base_signal computed     mult 1.2  urgency 1.3
                          dedup_key f'{sym}:stop_near'

**Module constant:** `NEAR_STOP_PCT = 0.03`. Mirrored below as
`LEGACY_NEAR_STOP_PCT` and RE-DERIVED by the rail
(`test_the_near_stop_threshold_is_the_legacy_constant_read_by_AST`), so a change
in `rules.py` goes red here rather than drifting.

**The distance function, verbatim:**

    def _stop_distance_pct(side, price, stop):
        if side == 'Long':
            return (price - stop) / price
        return (stop - price) / price

**The population** (`engine.py`, one query for every user):

    SELECT user_id, symbol, side, entry_price, stop_price, source
    FROM j2_positions WHERE closed_at IS NULL

**The away-delivery gate** (`engine.py`): `_DELIVER_IMPORTANCE_FLOOR = 8`, and
`stop_hit` always scores 10 with a symbol, so `_fire_candidate` calls
`deliver_alert_payload` — **every stop breach already emails and Discords the
member today.** ⛔ That is why `legacy_only` is the column that matters for this
type: it is not a missing in-app card, it is an email and a Discord push a
member stops receiving.

⚠️ DIVERGENCE FROM THE GATE PACKET, and it is small: the packet reports the
placeholder skip as `awareness/rules.py:74-75`'s absolute `1e-9`. On this tree
that line is GONE — H14 (`94209e962`) replaced it with
`is_placeholder_stop(stop, entry)` from `api/services/placeholder_stop.py`, with
the retired arithmetic kept as a ⚰️ comment. Everything else in §1a and §2.1
reproduces exactly. Nothing else in the packet's readings diverged.

──────────────────────────────────────────────────────────────────────────────
⛔⛔ TWO PACKETS WEARING ONE TYPE NAME — and only one of them is comparable
──────────────────────────────────────────────────────────────────────────────

SPEC-S7 §5.2 pins three severities. Measured, they are not the same kind of
thing:

| severity | legacy alert today? |
|---|---|
| `stop_hit`        | YES — `rule_stop_watch` → in-app + email + Discord |
| `stop_proximity`  | YES — the same function's second branch |
| `aggregate_heat`  | ⛔ NO. There is no alert, no schedule and no delivery |

**Measured, not assumed.** An anchored AST sweep over `api/**` (1,214 files
parsed, 0 unparsable, comments and docstrings stripped) finds `portfolio_heat(`
at exactly five places: `ai_search_personal.py`, `voice_tool_impls.py`,
`journal_two/coach_chat_tools.py` — all three REQUEST-TIME reads — plus the
module's own definition and its sibling test. `api/main.py` names it nowhere.
⚠️ A naive substring search adds a sixth, `api/routers/intelligence.py`; that is
`calculate_portfolio_heat`, a different function from the brain engine. The
anchored form is the honest one and it agrees with the packet.

⭐ So all three severities are PINNED (the F-S7-2 call — a schema that admits
only what exists teaches the next engineer the narrow shape is the whole shape),
and **`aggregate_heat` is recorded here as UNPOPULATED AND UNREACHABLE**. Its
evaluator returns nothing and the harness records its ticks as
`not_comparable` with reason `no_incumbent`: *"does the dark rule agree with the
legacy rule"* is not a question that exists for a severity with no incumbent,
and `legacy_only` cannot occur for it. It gets its own line and its own gate.

──────────────────────────────────────────────────────────────────────────────
⛔ §3's CONDITION — NO FIELD ENCODES A PLACEHOLDER VERDICT
──────────────────────────────────────────────────────────────────────────────

There is no `stop_is_real`, no `has_real_stop`, and `position_source` carries NO
default. A field naming the row's `source` is a FACT about the row; a field
naming whether its stop is REAL would be a verdict, and freezing one into a
predicate row would be a sixth placeholder detector wearing a schema.

The verdict is `api/services/placeholder_stop.is_placeholder_stop` — THE one
detector, imported below, never re-derived. `tests/test_placeholder_stop_is_one_definition.py`
fails by name if this module grows its own.

⛔ AND THE `source == 'broker'` HALF OF THE POLICY IS INHERITED DELIBERATELY.
A MANUAL position a member saved with its stop equal to its entry is **not**
skipped by the legacy rule and is not skipped here. That is arguably correct
(the member typed it) and it is a decision nobody had recorded; recording it is
what CP1 can do about it.

──────────────────────────────────────────────────────────────────────────────
⛔ NO `replay_fn` — the fourth distinct reason, and it is the hardest
──────────────────────────────────────────────────────────────────────────────

`price-level` refuses replay because a trendline has no past. `event-proximity`
refuses because a calendar date moves. `catalyst-match` refuses because the
candidate set is paid model output. This one refuses because **the legacy rule's
only price source is a LIVE CACHE THAT KEEPS NO HISTORY** — `engine.py` reads
`live_prices` `_px_cache` per cycle and stores nothing. *"Would it have fired on
Tuesday"* has no input at all, and a price the cache did not hold is **not a
"no"**. FORWARD-ONLY.
"""
from __future__ import annotations

from typing import Any, Iterable, Optional

from api.services.alert_taxonomy import registry as _registry
from api.services.placeholder_stop import is_placeholder_stop

TYPE_ID = "position-risk"

# ── the severities ───────────────────────────────────────────────────────────
#: ⛔ ONE vocabulary constant, deliberately. The three types before this one
#: carry a `MATCH_RULES` tuple beside a separate discriminator; for this type
#: SPEC-S7 §5.2's discriminator IS the severity, so a second name would be a
#: second authority over one value.
SEV_STOP_HIT = "stop_hit"
SEV_STOP_PROXIMITY = "stop_proximity"
SEV_AGGREGATE_HEAT = "aggregate_heat"
SEVERITIES = (SEV_STOP_HIT, SEV_STOP_PROXIMITY, SEV_AGGREGATE_HEAT)

#: The two that have an incumbent. Derived from `rule_stop_watch`'s own `kind=`
#: literals by `test_the_absorbed_severities_are_the_legacy_kind_literals` — a
#: fourth kind added there goes RED here.
ABSORBED_SEVERITIES = (SEV_STOP_HIT, SEV_STOP_PROXIMITY)

#: ⛔ PINNED AND UNREACHABLE. See the module docstring's measurement.
UNREACHABLE_SEVERITIES = (SEV_AGGREGATE_HEAT,)

# ── the position shapes the legacy guard admits ──────────────────────────────
SIDE_LONG = "Long"
SIDE_SHORT = "Short"
#: Read from `rule_stop_watch`'s own membership guard by the rail, never typed
#: from memory.
SIDES = (SIDE_LONG, SIDE_SHORT)

#: `rules.NEAR_STOP_PCT`. ⛔ RE-DERIVED BY THE RAIL, so this is a mirror with a
#: rail on it rather than a second authority.
LEGACY_NEAR_STOP_PCT = 0.03

# ── where the inputs come from, pinned so a later widening is visible ────────
#: `engine._build_market_scan_ctx` reads the shared `live_prices` cache and
#: NEVER fetches per position. Pinned as the only value because a predicate
#: naming a richer source would be measuring a different rule.
PRICE_SOURCE_LIVE_CACHE = "live_cache"
PRICE_SOURCES = (PRICE_SOURCE_LIVE_CACHE,)

#: `SELECT ... FROM j2_positions WHERE closed_at IS NULL`. Pinned so a
#: projection that read a different population is a declared change, not a
#: silent one.
POPULATION_OPEN_POSITIONS = "open_positions"
POPULATIONS = (POPULATION_OPEN_POSITIONS,)

#: The grain the legacy actually dedups on, and it is NOT the rule's own
#: `dedup_key`. `engine.py:220-224` records the move: `add_insight` namespaces
#: the cooldown by (symbol, kind) for 6h, which is what keeps a proximity
#: warning from swallowing the through-the-stop escalation. ⭐ §5 item 3 — that
#: guard must survive absorption intact, so it is a declared field rather than
#: an implementation detail somebody can quietly change.
DEDUP_GRAIN = "user_symbol_kind_6h"

PARAMS_SCHEMA = {
    "severity": "string -- 'stop_hit' | 'stop_proximity' | 'aggregate_heat'. "
                "⛔ ALL THREE ARE PINNED AND ONLY TWO ARE REACHABLE. "
                "'stop_hit' and 'stop_proximity' are the two kind= literals "
                "awareness/rules.py::rule_stop_watch emits and both already "
                "deliver in-app, by email and by Discord today. "
                "'aggregate_heat' has NO legacy alert, NO schedule and NO "
                "delivery -- portfolio_heat() is a request-time read at three "
                "call sites and nothing schedules it -- so it is UNPOPULATED "
                "AND UNREACHABLE, its evaluator returns nothing, and the "
                "comparison records its ticks as not_comparable/no_incumbent",

    "entity_ref": "string | null -- the position's symbol, upper-cased, for a "
                  "predicate that names one. NULL means every open position the "
                  "member holds, which is the legacy rule's own scope",

    "threshold_pct": "number | null -- the proximity band, as a FRACTION of "
                     "price (0.03 = 3%). NULL falls back to the legacy constant "
                     "rules.NEAR_STOP_PCT, which is re-derived by AST rather "
                     "than typed. ⛔ 0 is a MEANINGFUL value (a band of zero, "
                     "i.e. proximity never fires) and is NOT the same as NULL -- "
                     "chosen with `is None`, never with truthiness. Consulted "
                     "only by 'stop_proximity'; 'stop_hit' is a sign test",

    "side": "string | null -- 'Long' | 'Short', read from the legacy rule's own "
            "membership guard. NULL means both, which is the legacy scope. A "
            "predicate naming one side NARROWS, and the narrowing shows up in "
            "the comparison as legacy_only rather than hiding",

    "position_source": "string | null -- the j2_positions.source of the row "
                       "('broker' for an imported position). ⛔ A FACT ABOUT THE "
                       "ROW, NOT A VERDICT ABOUT ITS STOP, and it carries NO "
                       "DEFAULT: §3's condition is that no field may encode a "
                       "placeholder verdict, because pinning one would silently "
                       "choose a definition and make it this type's "
                       "specification. Whether a stop is real is answered by "
                       "api/services/placeholder_stop.py and by nothing else",

    "price_source": "string -- 'live_cache', and today that is the only value. "
                    "The legacy rule reads the SHARED live-price cache and never "
                    "fetches per position, so a symbol the cache did not hold "
                    "this cycle is skipped with no record. ⛔ That is a BLIND "
                    "SPOT, not a 'no' -- the harness classifies such a tick as "
                    "not_comparable and prints the count",

    "population": "string -- 'open_positions', i.e. j2_positions WHERE "
                  "closed_at IS NULL, read straight from auth.db by the legacy "
                  "engine rather than through a service. Pinned because a "
                  "projection reading a different population would be measuring "
                  "two populations and calling the difference a migration",

    "dedup_grain": "string -- 'user_symbol_kind_6h'. NOT the rule's own "
                   "dedup_key: the cooldown lives in add_insight and is keyed "
                   "(symbol, kind) for 6 hours, which is exactly what stops an "
                   "earlier nearing-stop warning swallowing the "
                   "through-the-stop escalation. Declared so that guard cannot "
                   "be dropped by accident during absorption",
}

# ⛔ NO `replay_fn`. See the module docstring — the legacy rule's only price
# source is a live cache that keeps no history, so replay has no input.


def register(*, db_path: str | None = None) -> None:
    """Idempotent — call at process start.

    ⛔ §2a ITEM 3 — *what calls this evaluator, on what trigger, and which test
    fails if that wire is cut?* At CP1-CP2 the honest answer is **the comparison
    harness does**, directly, over predicates the harness itself arms. There is
    no scheduler entry and no flag, deliberately.
    `position_risk_compare.observe` is the only caller and
    `test_the_harness_is_the_only_caller_of_would_fire` is the rail that fails
    if that stops being true — which is the form the question takes at a
    checkpoint with no wire yet. The scheduler wire and its rail arrive with CP3
    and need a new approval line.
    """
    _registry.register_trigger_type(TYPE_ID, PARAMS_SCHEMA, module=__name__, db_path=db_path)


# ─────────────────────────────────────────────────────────────────────────────
# CHECKPOINT 2 — the dark evaluator
# ─────────────────────────────────────────────────────────────────────────────

def stop_distance_pct(side: str, price: float, stop: float) -> float:
    """`rules._stop_distance_pct`, restated. Positive = the stop has not been
    reached; <= 0 means at or through it.

    ⛔ A MIRROR, AND IT IS RAILED. `test_the_distance_function_matches_the_legacy_one`
    drives the REAL `rules._stop_distance_pct` over generated cases and compares.
    The legacy function is pure and importable, so restating it is a choice —
    it is made for the same reason `price_level.level_at` restates
    `_alert_level_now`: the comparison must be between two implementations, and
    a harness that imports the thing it is comparing against measures nothing
    (`lesson_rail_the_mirror_not_just_the_lane`).

    ⛔ The non-Long fall-through is the legacy's own shape, kept deliberately.
    Callers guard `side in SIDES` first, exactly as the legacy does.
    """
    if side == SIDE_LONG:
        return (price - stop) / price
    return (stop - price) / price


def threshold_pct(params: dict[str, Any]) -> float:
    """The proximity band this predicate uses.

    ⛔ `is None`, NEVER truthiness. A declared band of `0` means *proximity
    never fires* and is a different instruction from *not declared*; `or` would
    silently promote it to the legacy 3%
    (`lesson_chosen_with_nullish_consumed_with_truthiness`).
    """
    raw = params.get("threshold_pct")
    if raw is None:
        return LEGACY_NEAR_STOP_PCT
    return float(raw)


def _admits(params: dict[str, Any], pos: dict[str, Any]) -> bool:
    """The predicate's own filters — the parts that narrow the legacy scope.

    Each one defaults to the legacy's own breadth, so a predicate that declares
    none of them is asking exactly the question the legacy rule asks.
    """
    ref = params.get("entity_ref")
    if ref and (pos.get("symbol") or "").upper() != str(ref).upper():
        return False
    want_side = params.get("side")
    if want_side and pos.get("side") != want_side:
        return False
    want_source = params.get("position_source")
    if want_source is not None and pos.get("source") != want_source:
        return False
    return True


def _legacy_admits(pos: dict[str, Any]) -> bool:
    """The legacy rule's OWN row guard, and nothing of this type's.

    `rule_stop_watch`'s first two statements: a falsy symbol, a side outside the
    membership guard, or a missing stop or entry skips the row; then a BROKER
    row whose stop is a placeholder skips too.

    ⛔ THE PLACEHOLDER VERDICT IS `is_placeholder_stop`'s AND NOBODY ELSE'S.
    This module defines no tolerance of its own — H14 unified five detectors
    onto one and `tests/test_placeholder_stop_is_one_definition.py` fails by
    name on the sixth.

    ⛔ THE SOURCE GATE IS PART OF THE POLICY AND IS INHERITED VERBATIM. A
    MANUAL position whose stop equals its entry is NOT skipped, by the legacy
    rule or by this one.
    """
    sym = (pos.get("symbol") or "").upper()
    side = pos.get("side")
    stop = pos.get("stop_price")
    entry = pos.get("entry_price")
    if not sym or side not in SIDES or stop is None or entry is None:
        return False
    if pos.get("source") == "broker" and is_placeholder_stop(stop, entry):
        return False
    return True


def _usable_price(live_prices: dict, sym: str) -> Optional[float]:
    """`rules.py`'s own price guard: a missing or non-positive price skips the
    row. Returned as `None` so the caller can tell "skipped" from "evaluated
    and quiet" — which the legacy rule itself cannot."""
    price = (live_prices or {}).get(sym)
    if not price or float(price) <= 0:
        return None
    return float(price)


def _candidates(params: dict[str, Any],
                positions: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rows that clear BOTH the legacy guard and this predicate's filters."""
    return [p for p in positions if _legacy_admits(p) and _admits(params, p)]


def would_fire(params: dict[str, Any], *,
               positions: Iterable[dict[str, Any]],
               live_prices: dict[str, float] | None = None) -> list[str]:
    """The DARK rule. Returns the symbols this predicate would alert on NOW.

    ⛔ DELIBERATELY THE LEGACY RULE, NOT AN IMPROVED ONE. CP1-CP2 measure the
    migration; a rule that fixes something while migrating measures the fix.

    ⭐ IT RETURNS A LIST, NOT A BOOLEAN, and the legacy shape forces that: one
    cycle emits one candidate PER POSITION, and the cooldown is per (symbol,
    kind) too. A boolean would collapse "three names at their stops" and "one
    name at its stop" into a single outcome and make the comparison structurally
    unable to see a member's inbox multiply.

    `positions` is `engine._bulk_load_user_contexts`'s own row shape:
    `{symbol, side, entry_price, stop_price, source}`. `live_prices` is the
    shared cache `engine._build_market_scan_ctx` builds — never a per-position
    fetch, here or there.
    """
    severity = params.get("severity")
    if severity not in ABSORBED_SEVERITIES:
        # ⛔ Pinned-but-unauthorized, the call F-S7-2 made: `aggregate_heat` and
        # anything unknown evaluate to NOTHING rather than raising. Raising
        # would make an unreachable severity break the harness that is supposed
        # to report it as unreachable.
        return []

    band = threshold_pct(params)
    prices = live_prices or {}
    out: list[str] = []
    for pos in _candidates(params, positions):
        sym = (pos.get("symbol") or "").upper()
        price = _usable_price(prices, sym)
        if price is None:
            continue  # a blind spot, not a "no" — see `unpriced_symbols`
        distance = stop_distance_pct(pos["side"], price, float(pos["stop_price"]))
        if severity == SEV_STOP_HIT:
            if distance <= 0:
                out.append(sym)
        elif distance > 0 and distance <= band:
            out.append(sym)

    seen: set[str] = set()
    result: list[str] = []
    for sym in out:
        if sym in seen:
            continue
        seen.add(sym)
        result.append(sym)
    return result


def unpriced_symbols(params: dict[str, Any], *,
                     positions: Iterable[dict[str, Any]],
                     live_prices: dict[str, float] | None = None) -> list[str]:
    """⛔⛔ §5 ITEM 7 — THE BLIND SPOT THAT WOULD CORRUPT THE COMPARISON.

    `rules.py`: `price = live_prices.get(sym)` … `if not price or price <= 0:
    continue`. A symbol the shared cache did not hold this cycle is skipped with
    NO record, and to the legacy rule that is indistinguishable from "not at
    stop". To a naive harness both sides would look like they agreed — when in
    fact **neither side evaluated anything.**

    So the symbols this returns are classified `not_comparable`, never
    agreement, and the count is printed. This is the NO DATA vs QUIET
    distinction one layer down.

    ⭐ It is deliberately computed for a row that has already cleared the legacy
    guard and the predicate's filters: a placeholder stop or a position the
    predicate does not name is a genuinely quiet row, not an unmeasured one.
    """
    prices = live_prices or {}
    out: list[str] = []
    for pos in _candidates(params, positions):
        sym = (pos.get("symbol") or "").upper()
        if _usable_price(prices, sym) is None and sym not in out:
            out.append(sym)
    return out


def predicate_fingerprint(params: dict[str, Any]) -> tuple:
    """What a change to the predicate's FIRING IDENTITY looks like.

    ⛔ When this tuple changes the open span CLOSES and its counts are discarded
    into `not_comparable` — never carried forward as agreement. A parameter
    rewrite makes the pre-change ticks un-attributable to the migration, exactly
    as a moved anchor does for `price-level` and a moved calendar date does for
    `event-proximity`.

    ⛔ `threshold_pct` is IN the tuple even though `stop_hit` never consults it.
    That is deliberately conservative: the cost is a reset nobody needed, and
    the cost of the other choice is a span that silently answered two different
    questions.

    `dedup_grain`, `price_source` and `population` are OUT — they describe the
    input and the delivery grain, not which rows fire.
    """
    ref = params.get("entity_ref")
    return (
        params.get("severity"),
        str(ref).upper() if ref else None,
        threshold_pct(params),
        params.get("side"),
        params.get("position_source"),
    )
