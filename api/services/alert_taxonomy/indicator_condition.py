"""GATE-S7-INDICATOR-CONDITION — S7 trigger type 4, and the LARGEST absorption.

⛔ Approved for CHECKPOINTS 1-2 ONLY (owner, 2026-09-13). CP1 registers the type,
pins the schema and ships **the cadence gate** — clause 3 of the completion
plan's §2b three-clause gate. CP2 adds a dark evaluator and a forward-only
harness over HARNESS-ARMED predicates. **No delivery. No projection of member
rows. No read of `indicator_alerts`. No legacy change. No scheduler entry.**
CP3 needs a new approval line.

──────────────────────────────────────────────────────────────────────────────
1. THE LEGACY SHAPES, REPORTED BEFORE THE SCHEMA IS PINNED
──────────────────────────────────────────────────────────────────────────────

⛔ Every column below was DERIVED BY AST from the legacy DDL — the `_SCHEMA`
string constant plus the `_MIGRATIONS` tuple in each owning module — never
retyped from a document. `test_the_docstring_reports_the_legacy_columns_as_
derived_by_AST` re-derives them on every run and fails if this block drifts.

**`indicator_alert_fires`** — `api/services/alert_fired_log.py`, EIGHTEEN
columns (`_SCHEMA` CREATE, plus six `_MIGRATIONS` ALTERs that re-add columns the
CREATE already names on a fresh box):

    id · alert_id · user_id · sym · indicator · condition · tf · fire_key ·
    bar_time · value · threshold · fired_at · delivered_at ·
    delivery_attempts · delivery_failed_at · delivery_error ·
    delivery_channels · channels_failed

plus the table constraint `UNIQUE(alert_id, fire_key)`, which is not a column
and is the fire-once guard AND the history at the same time.

**`indicator_alerts`** — `api/services/indicator_alert_service.py`,
TWENTY-FOUR columns (14 in the CREATE, 10 added by ALTER):

    CREATE: id · user_id · sym · indicator · condition · threshold · tf ·
            params_json · active · last_value · last_evaluated_at ·
            triggered_at · trigger_count · created_at
    ALTER:  state · state_detail · state_at · arm_epoch · snooze_until ·
            last_fire_key · instance_id · instance_missing_at · scope ·
            def_source

⚠️ THREE DIVERGENCES FROM THE PACKET, RECORDED RATHER THAN SILENTLY RESOLVED:

  (a) The build packet asks for *"the eight `indicator_alert_fires` columns"*.
      Measured, that table has **eighteen** columns, and only FOUR of the eight
      the schema pins (`indicator`, `condition`, `threshold`, `tf`) appear in
      it. **The eight are `indicator_alerts` columns** — the ALERT ROW's shape,
      which is what a member declares — not fire-ledger columns.
  (b) GATE §1 says `indicator_alerts` carries *"9 ALTER migrations"*. Measured,
      there are **ten**.
  (c) GATE §7 CP1 item 2 names the set
      `{indicator, condition, threshold, tf, params_json, instance_id, scope,
      def_source}` and then cites four line numbers (`:128`, `:143`, `:159`,
      `:182`) for *"the other four"* — those lines are `instance_id`,
      **`instance_missing_at`**, `scope`, `def_source`. `params_json` is in the
      CREATE (`:96`), not an ALTER. The set and its citations disagree by one
      member. **The SET is followed** (`params_json` is a member's declaration;
      `instance_missing_at` is written by the deletion guard and no member ever
      sends one), and `instance_missing_at` is recorded below instead of pinned.

⛔ `sym` and `user_id` are NOT in `PARAMS_SCHEMA` and that is not an omission:
`alert_predicates` (`db.py:73-92`) carries `user_id` and `entity_scope` as
COLUMNS ON THE PREDICATE ROW. Pinning them in `params` too would be a second
authority over one value.

──────────────────────────────────────────────────────────────────────────────
2. ⛔⛔ CLAUSE 3 — `cadence` GATES THE PREDICATE AT REGISTRATION
──────────────────────────────────────────────────────────────────────────────

The completion plan's §2b names the member-facing defect in its own words:

    "A predicate asking a `cadence: nightly` metric to answer an intraday
     condition registers cleanly, evaluates cleanly, and NEVER FIRES — and
     nothing distinguishes it from a condition that simply has not been met. An
     alert that cannot fire and an alert that has not fired look identical to a
     member, and the member is the one holding the position."

⭐⭐ AND CADENCE IS A PROPERTY OF THE (METRIC, TIMEFRAME) PAIR, NOT OF THE
METRIC. `ohlcv.c` on a 5-minute bar and `ohlcv.c` on a daily bar update at rates
two orders of magnitude apart, and the alert row carries `tf` NOT NULL. So
`cadence_for` resolves an **ADDRESS** —
`uct://<metric>@<entity>/<timeframe>?as_of=<instant>` — through D2's book, never
a bare metric name.

⛔ AN UNDECLARED CADENCE REFUSES, NAMING THE AXIS. Not "assume intraday" (that
admits a predicate which can never fire, with reassurance attached — the §2b
defect reached one step later). Not "assume nightly" (that asserts something
false about a continuously-written store, in the very field
`scan_evaluator.cadence_ceiling` reasons about). Refusal is the only branch that
keeps *"we could not compute it"* distinct from *"it has not been met"*, and it
matches the accessor's own contract — `canonical/address_book.py:15`:
**"THIS MODULE ANSWERS OR SAYS IT CANNOT. It never defaults."**

⚠️ **ACCEPTED CONSEQUENCE, STATED WITHOUT SOFTENING: at CP1 every `ohlcv.*`
predicate REFUSES.** The bars store declares no cadence (D2's F-D2-2 — it varies
by timeframe and is declared nowhere, re-derived inline seven times in
`bars_fetch.py`), and the declaration CANNOT ship here: `bars_sqlite.py` is
reachable-but-unwatched by flow-worker, which is exactly why D2 CP2 refused the
same edit. **That is the correct dark state, not a gap.** The repair is a
DECLARATION at the source the builder derives from — never a fallback at this
layer, which would be a second authority over a metric's cadence and is the
`pct_above_50ma` defect committed prospectively.

──────────────────────────────────────────────────────────────────────────────
2b. ⛔⛔ F-S7-IC-1 — THE CONSEQUENCE IS LARGER THAN THE PACKET STATES, MEASURED
──────────────────────────────────────────────────────────────────────────────

**The legacy alert lane and D2's address book share ZERO metric names.**

    indicator_alert_evaluator.all_addresses()   31 addresses
        close · rsi · macd · macd.signal · macd.histogram · bb · bb.upper ·
        bb.middle · bb.lower · stoch · stoch.d · adx.adx · adx.plusDI ·
        adx.minusDI · atr · cci · mfi · obv · vwap · williams_r ·
        price_vs_ma · sar.priceCrossedSar · sar.trendFlipped ·
        donchian.upper/middle/lower · ichimoku.tenkan/kijun/spanA/spanB/chikou

    canonical_address_book.json                142 metrics
        137 screener_rows scalars (cadence nightly) + ohlcv.o/h/l/c/v

    intersection                               ∅

So the packet's accepted consequence — *"at CP1 every `ohlcv.*` predicate
refuses"* — understates it in one direction and overstates it in another. At
CP1 **every predicate the legacy lane can express refuses**, and for all 31 the
anchor is `REFUSAL_ADDRESS_UNRESOLVED`, not `REFUSAL_CADENCE_UNDECLARED`: the
lane cannot even NAME an `ohlcv.*` metric. `close` and `ohlcv.c` are the same
quantity under two names and NOTHING joins them.

⛔ **THE JOIN IS NOT BUILT HERE, AND THAT IS THE RULING BEING FOLLOWED, NOT AN
OMISSION.** An alias map from the alert lane's 31 addresses to the book's
metrics would be a SECOND AUTHORITY over metric identity — precisely the
`_LEDGER_TIMEFRAME` / `pct_above_50ma` shape that owner ruling D2-C killed, and
precisely why this type was sequenced behind D2 at all. It is reported so the
next checkpoint can be sized against it. The comparison harness's `legacy_only`
column is what makes the cost visible per predicate.

──────────────────────────────────────────────────────────────────────────────
3. ⛔ WHERE THE GATE LIVES, AND WHAT DOES NOT CALL IT YET
──────────────────────────────────────────────────────────────────────────────

The precedent is `indicator_alert_service.refusal_for` — *"Why this alert could
NEVER fire, or `None` if it could."* Two of its properties are copied and one is
deliberately NOT:

  1. ✅ COPIED — it gates the ROUTER path, never `create()`. Thirty-one soak rows
     are armed on production and `tools/alert_soak_matrix.py --arm` must stay
     idempotent; a guard inside the writer would change what an internal tool and
     every existing row can do.
  2. ✅ COPIED — every refusal fragment is PAIRWISE DISTINCT. Two gates once
     shared the phrase *"forming-bar fires are not ledger-grade"*, so a
     `pytest.raises(match=…)` still matched with the mode lock DELETED. The four
     fragments below are distinct from each other and from all four of the
     legacy module's, asserted rather than reviewed.
  3. ⛔ NOT COPIED — the gate does NOT live in `indicator_alert_service.py`. That
     file is an INERT STRAND: flow-worker RUNS it and does not WATCH it, so
     flow-worker would run a stale copy of any guard added there.

⛔⛔ AND NOTHING CALLS `registration_refusal` FROM THE PRODUCT YET. The router is
NOT wired to it at CP1, deliberately: wiring it (or wiring `register()`) pulls
this module into flow-worker's import closure through `alerts.py` / `registry.py`
and strands the substrate, which GATE §6 item 3 assigns to CP3. At CP1-CP2 the
only caller of `would_fire` and `registration_refusal` is this type's own
comparison harness, and `test_the_harness_is_the_only_caller_of_would_fire` is
the rail that fails when that stops being true.

⛔ NO `replay_fn`, and this type's reason is the seventh distinct one the
programme has met and the strongest: **the legacy lane's fire identity is
`UNIQUE(alert_id, fire_key)` over an ARMED EPISODE**, and an episode is a live
state machine, not a function of history. Re-running today's evaluator over
cached bars would MANUFACTURE episodes that never existed. FORWARD-ONLY.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services import alert_fired_log as _fires
from api.services.alert_conditions import check_condition as _check_condition
from api.services.alert_taxonomy import registry as _registry
from api.services.canonical import address_book as _book

TYPE_ID = "indicator-condition"

# ─────────────────────────────────────────────────────────────────────────────
# The address grammar (D2's own, `axes` in the book)
# ─────────────────────────────────────────────────────────────────────────────

ADDRESS_SCHEME = "uct://"

#: The label the address book writes for an axis a store does not declare.
#: ⛔ Read from the book's own `axis_report`, and NEVER treated as a cadence.
UNDECLARED_LABEL = "(undeclared)"

#: The two classes a timeframe code can fall into. DERIVED from the book's
#: `axes.timeframe.code_to_label` (see `timeframe_class`) — never a fourth
#: hand-typed copy of the `("D","W","M")` split that already exists three times
#: in this repo (`bars_fetch.py` inline ×7, `indicator_alert_evaluator.
#: _CALENDAR_TFS`, and the `_LEDGER_TIMEFRAME` map PRD-D2 §9.2 indicts).
TF_INTRADAY = "intraday"
TF_CALENDAR = "calendar"

#: Slowest-last. A bar class can be answered by a cadence whose own class is at
#: or below it in this order.
_TF_CLASS_ORDER = (TF_INTRADAY, TF_CALENDAR)

CADENCE_NIGHTLY = "nightly"

#: ⛔ THE RULING, AS DATA: the SLOWEST bar class a cadence can honestly answer.
#: A `nightly` refresh changes at most once per calendar day, so it can answer a
#: bar that closes at most once per calendar day (`D`/`W`/`M`) and cannot answer
#: one that closes many times a session.
#:
#: ⛔ IT IS NOT A DEFAULT AND IT IS NOT EXHAUSTIVE BY ASSUMPTION.
#: `test_the_book_declares_no_cadence_this_gate_has_no_ruling_for` derives the
#: book's live cadence vocabulary and fails if D2 adds one that is not here —
#: forcing a ruling instead of letting an unknown cadence fall through a branch.
CADENCE_MIN_BAR_CLASS: dict[str, str] = {CADENCE_NIGHTLY: TF_CALENDAR}

# ─────────────────────────────────────────────────────────────────────────────
# The five alert states (GATE §7 CP1 item 3)
# ─────────────────────────────────────────────────────────────────────────────

#: ⛔ A MIRROR, AND IT IS RAILED. `test_the_five_states_are_the_legacy_tuple`
#: asserts equality against `indicator_alert_service.ALERT_STATES` itself, so
#: this cannot become a second authority over the state machine
#: (`lesson_rail_the_mirror_not_just_the_lane`). It is pinned here rather than
#: imported so that the type module does not put a 1,614-line INERT STRAND into
#: the import closure of everything that imports the taxonomy package.
ALERT_STATES: tuple[str, ...] = (
    "armed", "fired", "snoozed", "needs_attention", "error")

# ─────────────────────────────────────────────────────────────────────────────
# The refusal anchors — pairwise distinct, and distinct from the legacy four
# ─────────────────────────────────────────────────────────────────────────────

#: The address names a metric, or a timeframe, that D2's book does not declare.
#: ⛔ A DIFFERENT FACT from "declared, but with no cadence" — collapsing the two
#: would print a sentence about a store this gate never found.
REFUSAL_ADDRESS_UNRESOLVED = "names no metric the canonical address book declares"

#: The address resolves and the store says outright that it declares no cadence.
#: This is the `ohlcv.*` case, and it is the whole of §4.2's ruling.
REFUSAL_CADENCE_UNDECLARED = "resolves to a store that declares no cadence for it"

#: The book grew a cadence this gate has no ruling for. Refusing is the only
#: honest branch: a cadence nobody has reasoned about is not a cadence that has
#: been cleared.
REFUSAL_CADENCE_UNJUDGEABLE = "declares a cadence this gate has no ruling for"

#: The §2b defect proper — the metric refreshes less often than the bar the
#: predicate would be judged on, so it registers cleanly and never fires.
REFUSAL_CADENCE_SLOWER_THAN_BAR = "refreshes less often than the bar it would be judged on"

#: Every anchor this module owns. Used by the distinctness rail; the legacy four
#: are read from `indicator_alert_service` by the test, never copied here.
REFUSAL_ANCHORS: tuple[str, ...] = (
    REFUSAL_ADDRESS_UNRESOLVED,
    REFUSAL_CADENCE_UNDECLARED,
    REFUSAL_CADENCE_UNJUDGEABLE,
    REFUSAL_CADENCE_SLOWER_THAN_BAR,
)

# ─────────────────────────────────────────────────────────────────────────────
# CP2 outcomes — a refusal and a quiet predicate are DIFFERENT FACTS
# ─────────────────────────────────────────────────────────────────────────────

OUTCOME_REFUSED = "refused"      # the gate says this predicate can NEVER fire
OUTCOME_NO_VALUE = "no_value"    # the evaluator produced nothing to compare
OUTCOME_QUIET = "quiet"          # compared, and the condition is not met
OUTCOME_FIRED = "fired"          # compared, and the condition is met
OUTCOMES: tuple[str, ...] = (
    OUTCOME_REFUSED, OUTCOME_NO_VALUE, OUTCOME_QUIET, OUTCOME_FIRED)

PARAMS_SCHEMA = {
    "indicator": "string -- the metric the predicate names, resolved through "
                 "D2's canonical address book. ⛔ THE CADENCE GATE RESOLVES THE "
                 "(indicator, tf) PAIR AS AN ADDRESS, never the metric alone: "
                 "for bars_sqlite the cadence differs by timeframe, and the book "
                 "stores cadence on the metric where it cannot express that. At "
                 "CP1 every ohlcv.* value REFUSES because the bars store declares "
                 "no cadence (D2 F-D2-2) -- the correct dark state, not a gap",

    "condition": "string -- the trigger rule. Judged by "
                 "`alert_conditions.check_condition`, which returns False for "
                 "anything it has no branch for, so a rule outside its branches "
                 "is armed and mute forever. NOT re-declared as an enum here: "
                 "`indicator_alert_service.evaluable_conditions()` derives the "
                 "offered set from the catalog and asserts set equality with "
                 "check_condition's own AST, and a second copy would drift",

    "threshold": "number | null -- the right-hand side. NULL is meaningful and "
                 "is correct for `cross_zero` and for the four (address, "
                 "condition) pairs `THRESHOLD_OPERAND` declares an operand for "
                 "(bb's two band touches, sar's two events). For every other "
                 "level rule a NULL threshold is a refusal the legacy path "
                 "already makes (REFUSAL_NO_LEVEL) -- NOT re-made here, because "
                 "one refusal with two spellings is the defect §3 item 2 names",

    "tf": "string -- the bars-store timeframe CODE ('D', not '1D'), NOT NULL on "
          "the legacy row. ⛔ IT IS HALF THE CADENCE QUESTION: the same metric "
          "on '5' and on 'D' are different addresses with different cadences, "
          "and the gate refuses the pairing rather than the metric",

    "params_json": "string | null -- the indicator instance's parameter "
                   "snapshot, as the legacy column stores it. It is IN the "
                   "firing fingerprint because it decides the number that gets "
                   "compared: an alert armed on a 20-period average and one on a "
                   "50-period average are different predicates wearing one name",

    "instance_id": "string | null -- WHICH CHART INSTANCE. NULL means the alert "
                   "outlived nothing. ⚠️ Its sibling column `instance_missing_at` "
                   "is deliberately NOT pinned here: it is written by the "
                   "deletion guard, never sent by a member, and it is "
                   "deliberately NOT a `state` because `record_evaluation` clears "
                   "needs_attention the moment a value arrives and an ORPHANED "
                   "ALERT KEEPS PRODUCING VALUES",

    "scope": "string | null -- WHICH CHART this alert belongs to. NULL = GLOBAL. "
             "⛔⛔ IT IS A DISPLAY DIMENSION AND `list_active()` MUST NEVER READ "
             "IT: the evaluator, the shadow lane and the soak matrix all read "
             "list_active(), so a scope filter there would shrink what the "
             "shadow lane observes and make a cutover gate pass on a smaller set",

    "def_source": "string | null -- WHO AUTHORED THE ARITHMETIC. NULL = builtin, "
                  "'user' = an account wrote it. It gates LEDGER ADMISSION "
                  "(`indicator_alert_evaluator._is_user_authored`), not firing, "
                  "and like `scope` it is a dimension `list_active()` must never "
                  "read. Pinned so the provenance is declarable rather than lost",
}

# ⛔ NO `replay_fn`. See the module docstring: the fire identity is an ARMED
# EPISODE, and an episode is a live state machine rather than a function of
# history. FORWARD-ONLY.


def register(*, db_path: str | None = None) -> None:
    """Idempotent — call at process start.

    ⛔ §2a ITEM 3 — *what calls this evaluator, on what trigger, and which test
    fails if that wire is cut?* At CP1-CP2 the honest answer is **the comparison
    harness does**, directly, over predicates the harness itself arms. There is
    no scheduler entry and no flag, deliberately: wiring `register()` puts this
    module into flow-worker's import closure through `alerts.py` / `registry.py`
    and strands the substrate, which is CP3's line to ask for.
    `indicator_condition_compare.observe` is the only caller of `would_fire`,
    and `test_the_harness_is_the_only_caller_of_would_fire` is the rail.
    """
    _registry.register_trigger_type(TYPE_ID, PARAMS_SCHEMA, module=__name__, db_path=db_path)


# ─────────────────────────────────────────────────────────────────────────────
# CHECKPOINT 1 — the address, and the cadence gate
# ─────────────────────────────────────────────────────────────────────────────

def build_address(metric: str, entity: str, timeframe: str, *,
                  as_of: Optional[str] = None,
                  provider: Optional[str] = None) -> str:
    """`uct://<metric>@<entity>/<timeframe>?as_of=<instant>[&provider=<vendor>]`.

    The grammar is the book's own (`address_grammar`), spelled once here so the
    gate has an ADDRESS to resolve rather than a metric name.
    """
    out = f"{ADDRESS_SCHEME}{metric}@{entity}/{timeframe}"
    query = []
    if as_of:
        query.append(f"as_of={as_of}")
    if provider:
        query.append(f"provider={provider}")
    if query:
        out += "?" + "&".join(query)
    return out


def parse_address(address: str) -> Optional[dict[str, Optional[str]]]:
    """The address split into its axes, or `None` if it is not one.

    ⛔ `None`, never a partial dict with empty strings. A caller that receives
    `{"metric": ""}` will look the empty metric up, miss, and be told the store
    declares no cadence for it — a sentence about a store nobody found.
    """
    if not isinstance(address, str) or not address.startswith(ADDRESS_SCHEME):
        return None
    rest = address[len(ADDRESS_SCHEME):]
    head, _, query = rest.partition("?")
    authority, sep, path = head.partition("/")
    if not sep or not path:
        return None
    metric, at, entity = authority.partition("@")
    if not at or not metric or not entity:
        return None
    params: dict[str, str] = {}
    for part in query.split("&"):
        if "=" in part:
            k, _, v = part.partition("=")
            params[k] = v
    return {
        "metric": metric,
        "entity": entity,
        "timeframe": path,
        "as_of": params.get("as_of"),
        "provider": params.get("provider"),
    }


def timeframe_labels() -> dict[str, str]:
    """The book's timeframe axis: bars-store CODE -> product LABEL.

    ⛔ READ FROM THE BOOK, which sources it from
    `signature/ledger.py::_BARS_STORE_TF_KEYS`. `{}` when the book cannot be
    read, and every caller turns that into `None` rather than a default.
    """
    axes = _book.book().get("axes") or {}
    tf = axes.get("timeframe") or {}
    labels = tf.get("code_to_label")
    return dict(labels) if isinstance(labels, dict) else {}


def timeframe_class(code: str) -> Optional[str]:
    """`intraday` / `calendar` for a declared timeframe code, else `None`.

    ⛔ DERIVED FROM THE LABEL'S UNIT, CASE-SENSITIVELY, so `1m` (minutes) and
    `1M` (months) cannot be confused — which is the entire hazard in a
    single-letter timeframe vocabulary. A code the book does not declare returns
    `None`; it is not guessed into either class.
    """
    label = timeframe_labels().get(code)
    if not isinstance(label, str) or not label:
        return None
    unit = label[-1]
    if unit in ("m", "h"):
        return TF_INTRADAY
    if unit in ("D", "W", "M"):
        return TF_CALENDAR
    return None


def declared_cadences() -> frozenset:
    """Every cadence value the book's metrics actually carry.

    ⛔ Derived from the metric declarations, not read out of `axis_report` —
    `test_the_two_derivations_of_the_cadence_vocabulary_agree` cross-checks the
    two so a summary that drifted from its own population is caught.
    """
    metrics = _book.book().get("metrics") or {}
    return frozenset(
        m.get("cadence") for m in metrics.values()
        if isinstance(m, dict) and m.get("cadence"))


def cadence_for(address: str) -> Optional[str]:
    """The cadence of ONE ADDRESS, or `None` when it is not declared.

    ⛔⛔ IT NEVER DEFAULTS. `None` is returned for four genuinely different
    situations — an unparseable address, a metric the book does not declare, a
    timeframe the book does not declare, and a store that declares no cadence —
    and `registration_refusal` below is what tells them apart in the message.
    Returning `"nightly"` or `"intraday"` for any of them would be a SECOND
    AUTHORITY over a metric's cadence at the alert layer, which is exactly the
    `pct_above_50ma` defect committed prospectively.

    ⭐ THE RESOLUTION ORDER IS THE RULING. A per-(metric, timeframe) declaration
    wins if the book ever grows one; failing that, a store that says outright it
    declares no cadence answers `None` REGARDLESS of the timeframe; and only
    then may the metric's single cadence answer — and only because that store
    declares one that does not vary by timeframe, which is true for all 137
    `screener_rows` scalars and false for all 5 `bars_sqlite` ones.
    """
    parsed = parse_address(address)
    if parsed is None:
        return None
    metric = _book.metric(parsed["metric"] or "")
    if not metric:
        return None
    code = parsed["timeframe"] or ""
    if timeframe_class(code) is None:
        return None
    store = _book.store(metric.get("store") or "")
    if not store:
        return None

    per_tf = metric.get("cadence_by_timeframe")
    if isinstance(per_tf, dict):
        # The shape D2 owes for bars. When it lands, THIS branch answers and the
        # store-level refusal below stops firing for the timeframes it covers.
        value = per_tf.get(code)
        return value if value else None

    if "cadence" in (store.get("undeclared_by_this_store") or ()):
        return None

    return metric.get("cadence") or None


def cadence_can_answer(cadence: str, timeframe: str) -> Optional[bool]:
    """Can a metric refreshing at `cadence` answer a condition on this bar?

    Returns `None` — never `False` — when there is no ruling for the cadence or
    the timeframe is not declared. *"We have no ruling"* and *"no"* are different
    facts and the caller refuses with different words.
    """
    required = CADENCE_MIN_BAR_CLASS.get(cadence)
    if required is None:
        return None
    actual = timeframe_class(timeframe)
    if actual is None:
        return None
    return _TF_CLASS_ORDER.index(actual) >= _TF_CLASS_ORDER.index(required)


def registration_refusal(params: dict[str, Any], *, entity_ref: str) -> Optional[str]:
    """Why this predicate could NEVER fire, or `None` if it could.

    Clause 3 of the §2b gate, and the shape is `indicator_alert_service.
    refusal_for`'s deliberately: one function, one sentence per gate, each
    sentence anchored on a fragment no other gate uses.

    ⛔ THIS IS A REGISTRATION GATE, NOT AN EVALUATION RESULT. A refusal says the
    predicate is structurally dead; it never says the condition has not been
    met. `would_fire` keeps the two apart and so does the harness's report.
    """
    metric_name = str(params.get("indicator") or "").strip()
    code = str(params.get("tf") or "").strip()
    address = build_address(metric_name, str(entity_ref or "").strip(), code)

    parsed = parse_address(address)
    declaration = _book.metric(parsed["metric"]) if parsed else None
    if parsed is None or not declaration or timeframe_class(code) is None:
        known = ", ".join(sorted(timeframe_labels())) or "none — the book is unreadable"
        builder = _book.book().get("generated_by") or "the book's builder"
        # ⛔ THE BUILDER IS NAMED FROM THE MANIFEST'S OWN `generated_by` FIELD,
        # never spelled here. `tests/test_canonical_address_book.py` fails any
        # module under `api/` whose STRIPPED CODE carries the manifest's file
        # name — a rail that (correctly) does not care that the mention was
        # inside a helpful error message.
        return (f"{address} {REFUSAL_ADDRESS_UNRESOLVED}, or names a timeframe "
                f"outside its axis. The metric axis is derived by {builder}; the "
                f"timeframe axis is {known}. Nothing about a cadence can be said "
                f"until the address resolves, and guessing one here would invent "
                f"a fact.")

    store_id = declaration.get("store") or "?"
    cadence = cadence_for(address)
    if cadence is None:
        store = _book.store(store_id) or {}
        missing = ", ".join(store.get("undeclared_by_this_store") or ()) or "cadence"
        return (f"{metric_name} on {code} {REFUSAL_CADENCE_UNDECLARED}. "
                f"stores.{store_id}.undeclared_by_this_store lists [{missing}], "
                f"so this pairing has no refresh rate to compare against the bar "
                f"and the answer is 'we could not compute it', which is not the "
                f"same answer as 'it has not been met'. THE REPAIR IS A "
                f"DECLARATION at the source the builder derives from — never a "
                f"fallback at the alert layer, which would be a second authority "
                f"over this metric's refresh rate.")

    verdict = cadence_can_answer(cadence, code)
    if verdict is None:
        rulings = ", ".join(sorted(CADENCE_MIN_BAR_CLASS)) or "none"
        return (f"{metric_name} on {code} {REFUSAL_CADENCE_UNJUDGEABLE} "
                f"({cadence!r}). The rulings this gate holds cover: {rulings}. A "
                f"refresh rate nobody has reasoned about has not been cleared, "
                f"and admitting it would arm a predicate on an assumption.")

    if verdict is False:
        return (f"{metric_name} on {code} {REFUSAL_CADENCE_SLOWER_THAN_BAR} "
                f"({cadence!r}, against a bar that closes many times a session). "
                f"It would register cleanly, evaluate cleanly and stay silent "
                f"forever, which a member cannot tell apart from a condition that "
                f"has simply not been met. Arm it on a bar this rate can answer.")

    return None


# ─────────────────────────────────────────────────────────────────────────────
# CHECKPOINT 2 — the dark evaluator
# ─────────────────────────────────────────────────────────────────────────────

def would_fire(params: dict[str, Any], *, entity_ref: str,
               value: Optional[float], prev_value: Optional[float] = None,
               bar_time: Any = None, arm_epoch: int = 0) -> dict[str, Any]:
    """The DARK rule. FOUR outcomes, and three of them are not "it fired".

    ⛔⛔ IT DOES NOT RETURN A BOOLEAN, AND THAT IS THIS CHECKPOINT'S THESIS. A
    refused predicate, a predicate the evaluator produced no value for, and a
    predicate whose condition is simply not met are THREE DIFFERENT FACTS. A
    boolean collapses all three into `False`, which is precisely the state §2b
    says a member cannot tell apart — reproduced inside the instrument built to
    measure it.

    ⛔ DELIBERATELY THE LEGACY RULE, NOT AN IMPROVED ONE, in every respect except
    the cadence gate: `check_condition` is DRIVEN, not mirrored, and so is
    `alert_fired_log.fire_key`. A mirror of either would be a second authority,
    and the comparison would then be measuring two implementations rather than
    two rules.

    ⚠️ An unparseable `bar_time` RAISES out of here rather than being swallowed
    into an outcome. A fixture that cannot name its bar is a broken fixture, and
    a swallowed error becomes a confident finding.
    """
    refusal = registration_refusal(params, entity_ref=entity_ref)
    if refusal is not None:
        return {"outcome": OUTCOME_REFUSED, "refusal": refusal,
                "triggered": None, "fire_key": None}

    if value is None:
        # The legacy lane's `needs_attention` fact: the compute produced NOTHING.
        # Not a quiet market — an absent number.
        return {"outcome": OUTCOME_NO_VALUE, "refusal": None,
                "triggered": None, "fire_key": None}

    condition = str(params.get("condition") or "")
    triggered = bool(_check_condition(condition, value, prev_value,
                                      params.get("threshold")))
    if not triggered:
        return {"outcome": OUTCOME_QUIET, "refusal": None,
                "triggered": False, "fire_key": None}

    return {"outcome": OUTCOME_FIRED, "refusal": None, "triggered": True,
            "fire_key": _fires.fire_key(condition, bar_time, arm_epoch)}


def predicate_fingerprint(params: dict[str, Any]) -> tuple:
    """What a change to the predicate's FIRING IDENTITY looks like.

    ⛔ A parameter rewrite makes the pre-change ticks un-attributable to the
    migration. When this tuple changes the open span CLOSES and its counts are
    discarded into `not_comparable` — never carried forward as agreement.

    ⛔ `instance_id`, `scope` and `def_source` are DELIBERATELY EXCLUDED, and the
    reasons differ. `scope` is a display dimension `list_active()` must never
    read. `def_source` gates LEDGER ADMISSION, not firing. `instance_id` names a
    chart instance, but the number the evaluator compares comes from the
    `params_json` snapshot on the alert row — which IS in the tuple. Including a
    field that does not change firing would close spans for nothing and quietly
    convert real observations into `not_comparable`.
    """
    threshold = params.get("threshold")
    return (
        str(params.get("indicator") or "").strip(),
        str(params.get("condition") or "").strip(),
        None if threshold is None else float(threshold),
        str(params.get("tf") or "").strip(),
        params.get("params_json") or None,
    )
