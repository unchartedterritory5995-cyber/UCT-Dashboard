"""GATE-S7-POSITION-RISK Checkpoint 2 — the dark evaluator and the forward-only
harness, over HARNESS-ARMED predicates only.

⛔ No delivery. No projection of member rows. No legacy change. Never a replay.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import position_risk as pr
from api.services.alert_taxonomy import position_risk_compare as prc
from api.services.awareness import rules as _legacy_rules

_REPO = pathlib.Path(__file__).resolve().parents[1]
_MODULE = _REPO / "api" / "services" / "alert_taxonomy" / "position_risk.py"
_COMPARE = _REPO / "api" / "services" / "alert_taxonomy" / "position_risk_compare.py"
_LEGACY_RULES = _REPO / "api" / "services" / "awareness" / "rules.py"
_LEGACY_ENGINE = _REPO / "api" / "services" / "awareness" / "engine.py"

DAY = "2026-09-11"
DAY2 = "2026-09-12"

#: The row that actually happened — `placeholder_stop.py`'s own regression case.
ORCL_ENTRY, ORCL_STOP = 126.0049, 126.005


def _pos(symbol, side="Long", entry=100.0, stop=95.0, source="manual"):
    """`engine._bulk_load_user_contexts`'s own row shape."""
    return {"symbol": symbol, "side": side, "entry_price": entry,
            "stop_price": stop, "source": source}


HIT = {
    "severity": pr.SEV_STOP_HIT,
    "entity_ref": None,
    "threshold_pct": None,
    "side": None,
    "position_source": None,
    "price_source": pr.PRICE_SOURCE_LIVE_CACHE,
    "population": pr.POPULATION_OPEN_POSITIONS,
    "dedup_grain": pr.DEDUP_GRAIN,
}
PROX = dict(HIT, severity=pr.SEV_STOP_PROXIMITY)
HEAT = dict(HIT, severity=pr.SEV_AGGREGATE_HEAT)


@pytest.fixture()
def db(tmp_path):
    p = str(tmp_path / "at.db")
    _db.init_db(db_path=p)
    return p


def _code_only(path: pathlib.Path) -> str:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id in ("PARAMS_SCHEMA", "BLIND_SPOTS")
                for t in node.targets):
            node.value = ast.Constant(value="<prose>")
    return ast.unparse(ast.fix_missing_locations(tree))


# ═════════════════════════════════════════════════════════════════════════
# The dark evaluator
# ═════════════════════════════════════════════════════════════════════════

def test_stop_hit_fires_at_or_through_the_stop_and_not_before():
    rows = [_pos("NVDA")]                       # Long, entry 100, stop 95
    assert pr.would_fire(HIT, positions=rows, live_prices={"NVDA": 94.0}) == ["NVDA"]
    assert pr.would_fire(HIT, positions=rows, live_prices={"NVDA": 95.0}) == ["NVDA"]
    assert pr.would_fire(HIT, positions=rows, live_prices={"NVDA": 95.01}) == []


def test_a_SHORT_position_is_at_its_stop_from_the_other_side():
    rows = [_pos("NVDA", side="Short", entry=100.0, stop=105.0)]
    assert pr.would_fire(HIT, positions=rows, live_prices={"NVDA": 106.0}) == ["NVDA"]
    assert pr.would_fire(HIT, positions=rows, live_prices={"NVDA": 104.0}) == []


def test_stop_proximity_is_the_open_band_between_the_stop_and_the_threshold():
    """⛔ `0 < d <= band`, which is the legacy's own `if d <= 0 … elif d <=
    NEAR_STOP_PCT` structure. A closed lower bound would double-report a breach
    as BOTH a hit and a proximity warning."""
    rows = [_pos("NVDA")]
    assert pr.would_fire(PROX, positions=rows, live_prices={"NVDA": 97.0}) == ["NVDA"]
    assert pr.would_fire(PROX, positions=rows, live_prices={"NVDA": 100.0}) == []   # 5% away
    assert pr.would_fire(PROX, positions=rows, live_prices={"NVDA": 94.0}) == []    # through it


def test_would_fire_returns_a_LIST_not_a_boolean_and_the_legacy_forces_that():
    """⛔ One cycle emits one candidate PER POSITION. A boolean would collapse
    "three names at their stops" and "one name at its stop" into one outcome and
    make the comparison structurally unable to see an inbox multiply."""
    rows = [_pos("AAA"), _pos("BBB"), _pos("CCC")]
    got = pr.would_fire(HIT, positions=rows, live_prices={"AAA": 90.0, "BBB": 90.0, "CCC": 99.0})
    assert isinstance(got, list) and sorted(got) == ["AAA", "BBB"]


def test_a_symbol_held_twice_alerts_once():
    rows = [_pos("NVDA"), _pos("NVDA", entry=110.0, stop=99.0)]
    assert pr.would_fire(HIT, positions=rows, live_prices={"NVDA": 90.0}) == ["NVDA"]


def test_the_entity_and_side_filters_NARROW_and_default_to_the_legacy_scope():
    rows = [_pos("AAA"), _pos("BBB", side="Short", entry=100.0, stop=105.0)]
    prices = {"AAA": 90.0, "BBB": 110.0}
    assert sorted(pr.would_fire(HIT, positions=rows, live_prices=prices)) == ["AAA", "BBB"]
    assert pr.would_fire(dict(HIT, entity_ref="aaa"), positions=rows, live_prices=prices) == ["AAA"]
    assert pr.would_fire(dict(HIT, side="Short"), positions=rows, live_prices=prices) == ["BBB"]


def test_a_side_outside_the_legacy_membership_guard_is_skipped():
    rows = [_pos("NVDA", side="long")]  # lower-case is NOT in ('Long','Short')
    assert pr.would_fire(HIT, positions=rows, live_prices={"NVDA": 1.0}) == []


@pytest.mark.parametrize("row", [
    {"symbol": "", "side": "Long", "entry_price": 100.0, "stop_price": 95.0, "source": "manual"},
    {"symbol": "NVDA", "side": "Long", "entry_price": None, "stop_price": 95.0, "source": "manual"},
    {"symbol": "NVDA", "side": "Long", "entry_price": 100.0, "stop_price": None, "source": "manual"},
])
def test_the_legacy_row_guard_is_reproduced_exactly(row):
    assert pr.would_fire(HIT, positions=[row], live_prices={"NVDA": 1.0}) == []


# --- the ONE placeholder detector -------------------------------------------

def test_a_BROKER_placeholder_stop_is_skipped_and_the_ORCL_ROW_proves_which_detector():
    """⛔⛔ THE TRAP, F-S7-PR-1. A broker import stores `stop_price =
    entry_price` because the column is NOT NULL. Counting one as a real stop
    fires "at stop" on every broker position trading below its entry.

    ⭐ The ORCL row is what separates the detectors: entry 126.0049 against stop
    126.005, a drift of 1.0e-4. The retired absolute and relative `1e-9` rules
    BOTH called it a real stop; `is_placeholder_stop` does not, and this type
    inherits that answer rather than a fourth copy of the question.
    """
    exact = [_pos("AAA", entry=126.0049, stop=126.0049, source="broker")]
    drifted = [_pos("BBB", entry=ORCL_ENTRY, stop=ORCL_STOP, source="broker")]
    prices = {"AAA": 120.0, "BBB": 120.0}
    assert pr.would_fire(HIT, positions=exact, live_prices=prices) == []
    assert pr.would_fire(HIT, positions=drifted, live_prices=prices) == [], (
        "the drifted placeholder reached the distance test — that is the "
        "false stop_hit email H14 exists to prevent")
    # CONTROL: the two retired tolerances would BOTH have let it through.
    assert not (abs(ORCL_STOP - ORCL_ENTRY) < 1e-9)
    assert not (abs(ORCL_STOP - ORCL_ENTRY) <= abs(ORCL_ENTRY) * 1e-9)
    # …and a broker row with a REAL stop is still watched.
    real = [_pos("CCC", entry=100.0, stop=95.0, source="broker")]
    assert pr.would_fire(HIT, positions=real, live_prices={"CCC": 90.0}) == ["CCC"]


def test_a_MANUAL_position_whose_stop_equals_its_entry_is_NOT_skipped():
    """⛔ §5 ITEM 1, INHERITED DELIBERATELY. The legacy skip is gated on
    `source == 'broker'`; a MANUAL position a member saved with stop == entry
    fires immediately. That is arguably correct — the member typed it — and it
    is a decision nobody had recorded. Absorbing it silently would have made it
    permanent and invisible; reproducing it under a named test makes it a
    decision the flip can revisit."""
    rows = [_pos("NVDA", entry=100.0, stop=100.0, source="manual")]
    assert pr.would_fire(HIT, positions=rows, live_prices={"NVDA": 99.0}) == ["NVDA"]
    # …and the legacy rule really does the same thing, driven for real.
    assert prc.legacy_would_fire(HIT, positions=rows, live_prices={"NVDA": 99.0}) == ["NVDA"]


# --- the threshold ----------------------------------------------------------

def test_a_declared_threshold_of_ZERO_is_not_the_same_as_UNDECLARED():
    """⛔ `lesson_chosen_with_nullish_consumed_with_truthiness`. `0` means *the
    proximity band never fires*; `or` would silently promote it to the legacy
    3% and the predicate would do the opposite of what it declared."""
    assert pr.threshold_pct({"threshold_pct": None}) == pr.LEGACY_NEAR_STOP_PCT
    assert pr.threshold_pct({}) == pr.LEGACY_NEAR_STOP_PCT
    assert pr.threshold_pct({"threshold_pct": 0}) == 0.0
    rows = [_pos("NVDA")]
    assert pr.would_fire(dict(PROX, threshold_pct=0), positions=rows,
                         live_prices={"NVDA": 97.0}) == []
    assert pr.would_fire(PROX, positions=rows, live_prices={"NVDA": 97.0}) == ["NVDA"]


# --- the distance mirror, railed against the real legacy function ------------

def test_the_distance_function_matches_the_legacy_one():
    """⛔ A MIRROR IS ONLY HONEST WITH A RAIL ON IT. Driven against the REAL
    `rules._stop_distance_pct` over generated cases — the equivalence IS the
    absorption's core claim, and if the two disagree every downstream count
    measures the disagreement instead of the migration."""
    cases = 0
    for side in pr.SIDES:
        for price in (1.0, 12.34, 95.0, 100.0, 126.0049, 10_000.0):
            for stop in (0.5, 12.0, 95.0, 100.0, 126.005, 9_999.0):
                assert pr.stop_distance_pct(side, price, stop) == \
                    _legacy_rules._stop_distance_pct(side, price, stop), (side, price, stop)
                cases += 1
    assert cases >= 50, f"the generator produced only {cases} cases — it proves little"
    # ⛔ NON-VACUITY: the two sides are not both returning a constant, and the
    # SIDE really is consulted. ⚰️ The first version of this control used
    # Long(100,95) and Short(100,105) — both 0.05 — so it asserted three
    # distinct values over two, and went red for the right reason.
    vals = {pr.stop_distance_pct("Long", 100.0, 95.0),      # +0.05
            pr.stop_distance_pct("Long", 100.0, 99.0),      # +0.01
            pr.stop_distance_pct("Short", 100.0, 110.0)}    # +0.10
    assert len(vals) == 3, "the distance function returns the same number for everything"
    assert pr.stop_distance_pct("Long", 100.0, 105.0) < 0 < \
        pr.stop_distance_pct("Short", 100.0, 105.0), (
        "the side is not being consulted — a Long through its stop and a Short "
        "below its stop must have opposite signs")


# ═════════════════════════════════════════════════════════════════════════
# ⛔⛔ THE LEGACY SIDE — the REAL rule, driven, not restated
# ═════════════════════════════════════════════════════════════════════════

def test_legacy_would_fire_DRIVES_the_real_rule_stop_watch():
    """⭐ THERE IS NO MIRROR HERE, AND THAT IS THE POINT.

    The three types before this had to restate their legacy rule because the
    real one MUTATED and DELIVERED. `rule_stop_watch` does neither — it is a
    pure function of (scan_ctx, user_ctx) — so the harness calls it. A
    restatement that is not forced is a second authority over one value.

    Asserted from the source (the harness really does call it) AND behaviourally
    (the symbols it returns are the ones the real rule produced), with a
    non-vacuity control on both.
    """
    code = _code_only(_COMPARE)
    assert "_legacy_rules.rule_stop_watch(" in code, (
        "the harness stopped driving the real rule — if it now restates it, that "
        "restatement needs a mirror rail of its own")

    rows = [_pos("AAA"), _pos("BBB", entry=100.0, stop=95.0), _pos("CCC")]
    prices = {"AAA": 90.0, "BBB": 97.0, "CCC": 120.0}
    real = _legacy_rules.rule_stop_watch(
        {"live_prices": prices}, {"positions": rows, "watch_syms": set()})
    assert real, "the real rule fired on nothing — this rail proves nothing"
    by_kind: dict[str, set] = {}
    for c in real:
        by_kind.setdefault(c.kind, set()).add(c.symbol)
    assert by_kind == {"stop_hit": {"AAA"}, "stop_proximity": {"BBB"}}, by_kind

    assert set(prc.legacy_would_fire(HIT, positions=rows, live_prices=prices)) == {"AAA"}
    assert set(prc.legacy_would_fire(PROX, positions=rows, live_prices=prices)) == {"BBB"}


def test_the_legacy_side_returns_NOTHING_for_a_severity_with_no_incumbent():
    rows = [_pos("AAA")]
    assert prc.legacy_would_fire(HEAT, positions=rows, live_prices={"AAA": 90.0}) == []


def test_the_legacy_rule_reads_NO_environment_so_there_is_nothing_to_follow():
    """⛔ F-S7-5 cost this programme a wrong finding: `catalyst-match`'s mirror
    answered from a code CONSTANT while the legacy read an env var at call time.
    Measured here rather than assumed — `rules.py` does not import `os` and
    names no environment read, so this type's evaluator has nothing to follow
    and correctly reads none.

    ⛔ CONTROL: `awareness/engine.py` DOES read the environment, so the probe
    can see one when there is one.
    """
    rules_code = _code_only(_LEGACY_RULES)
    for needle in ("os.environ", "getenv", "environ"):
        assert needle not in rules_code, f"awareness/rules.py now reads {needle}"
    engine_code = _code_only(_LEGACY_ENGINE)
    assert "environ" in engine_code, "the env probe cannot see a real env read — it is broken"


# ═════════════════════════════════════════════════════════════════════════
# The forward-only harness — four outcomes, never a rate
# ═════════════════════════════════════════════════════════════════════════

def test_a_tick_where_both_agree_counts_agreed_and_nothing_else(db):
    rows = [_pos("NVDA")]
    t = prc.observe("p1", HIT, DAY, positions=rows, live_prices={"NVDA": 90.0}, db_path=db)
    assert t == {"agreed": 1, "new_only": 0, "legacy_only": 0, "not_comparable": 0}


def test_a_quiet_tick_records_NO_outcome_at_all(db):
    """⛔ Neither side firing is not an outcome. Counting quiet rows as `agreed`
    would drown every real disagreement and make the result a function of how
    many positions the member happens to hold."""
    rows = [_pos("NVDA")]
    t = prc.observe("p1", HIT, DAY, positions=rows, live_prices={"NVDA": 120.0}, db_path=db)
    assert t == {"agreed": 0, "new_only": 0, "legacy_only": 0, "not_comparable": 0}
    r = prc.report("p1", db_path=db)
    assert r["observed"] == 0 and r["status"] == "QUIET"


def test_a_NARROWER_threshold_shows_as_LEGACY_ONLY(db):
    """⭐ THE COLUMN THAT MATTERS. `legacy_only` is an alert a member LOSES at
    the flip — and for this type that alert is an email and a Discord push. It
    must never be collapsed into a pass rate."""
    rows = [_pos("NVDA")]                                    # 2.06% from its stop
    t = prc.observe("p1", dict(PROX, threshold_pct=0.01), DAY,
                    positions=rows, live_prices={"NVDA": 97.0}, db_path=db)
    assert t == {"agreed": 0, "new_only": 0, "legacy_only": 1, "not_comparable": 0}


def test_a_WIDER_threshold_shows_as_NEW_ONLY(db):
    """The other direction: at the flip this member starts getting an alert they
    do not get today."""
    rows = [_pos("NVDA")]                                    # 5% from its stop
    t = prc.observe("p1", dict(PROX, threshold_pct=0.10), DAY,
                    positions=rows, live_prices={"NVDA": 100.0}, db_path=db)
    assert t == {"agreed": 0, "new_only": 1, "legacy_only": 0, "not_comparable": 0}


def test_an_UNPRICED_symbol_is_NOT_COMPARABLE_and_never_agreement(db):
    """⛔⛔ §5 ITEM 7 — THE ONE THAT WOULD HAVE LIED.

    `rules.py` skips a symbol the shared cache did not hold with NO record, so
    to the legacy rule it is indistinguishable from "not at stop". Both sides
    return nothing and a naive harness reads `agreed`. **Neither side evaluated
    anything.** The quieter the cache, the cleaner that report would look.
    """
    rows = [_pos("NVDA")]
    t = prc.observe("p1", HIT, DAY, positions=rows, live_prices={}, db_path=db)
    assert t == {"agreed": 0, "new_only": 0, "legacy_only": 0, "not_comparable": 1}
    r = prc.report("p1", db_path=db)
    assert r["not_comparable_by_reason"]["unpriced"] == 1
    assert r["agreed"] == 0
    assert r["status"] == "OBSERVED", (
        "an unpriced tick is something the harness SAW; reporting it as QUIET "
        "would hide the blindness it exists to surface")


@pytest.mark.parametrize("price", [0, 0.0, -1.0, None])
def test_a_non_positive_price_is_the_same_blindness_as_a_missing_one(db, price):
    """`rules.py`'s own guard is `if not price or price <= 0`."""
    rows = [_pos("NVDA")]
    t = prc.observe(f"p-{price}", HIT, DAY, positions=rows,
                    live_prices={"NVDA": price}, db_path=db)
    assert t["not_comparable"] == 1 and t["agreed"] == 0


def test_a_placeholder_row_is_QUIET_not_UNPRICED(db):
    """⭐ The distinction is load-bearing: a placeholder stop is a row both sides
    deliberately skip (a genuinely quiet row), where an unpriced symbol is a row
    neither side could look at. Folding the first into `not_comparable` would
    inflate the blindness count with rows that are working exactly as intended."""
    rows = [_pos("NVDA", entry=100.0, stop=100.0, source="broker")]
    t = prc.observe("p1", HIT, DAY, positions=rows, live_prices={}, db_path=db)
    assert t == {"agreed": 0, "new_only": 0, "legacy_only": 0, "not_comparable": 0}


def test_AGGREGATE_HEAT_is_NOT_COMPARABLE_because_it_has_no_incumbent(db):
    """⛔⛔ `portfolio_heat()` is a request-time read at three call sites with no
    schedule and no delivery, so `legacy_only` cannot occur for this severity
    and calling a tick `agreed` would be inventing agreement between one rule
    and nothing at all."""
    rows = [_pos("NVDA")]
    t = prc.observe("p1", HEAT, DAY, positions=rows, live_prices={"NVDA": 90.0}, db_path=db)
    assert t == {"agreed": 0, "new_only": 0, "legacy_only": 0, "not_comparable": 1}
    r = prc.report("p1", db_path=db)
    assert r["not_comparable_by_reason"]["no_incumbent"] == 1
    assert r["not_comparable_by_reason"]["unpriced"] == 0
    assert r["agreed"] == 0


def test_the_three_not_comparable_reasons_are_counted_SEPARATELY(db):
    """⛔ *"we could not compute it"* comes in three flavours here and they are
    different facts: a cache miss, a predicate rewrite, and a severity with no
    incumbent. One number would make all three unactionable."""
    rows = [_pos("NVDA")]
    prc.observe("p1", HIT, DAY, positions=rows, live_prices={}, db_path=db)          # unpriced
    prc.observe("p1", HIT, DAY, positions=rows, live_prices={"NVDA": 90.0}, db_path=db)  # agreed
    prc.observe("p1", dict(HIT, threshold_pct=0.5), DAY2,
                positions=rows, live_prices={"NVDA": 90.0}, db_path=db)              # reset
    r = prc.report("p1", db_path=db)
    by = r["not_comparable_by_reason"]
    assert by["unpriced"] == 1
    assert by["params_change"] == 1, "the pre-change agreement must be DISCARDED, never carried"
    assert by["no_incumbent"] == 0
    assert r["not_comparable"] == 2
    assert set(by) == {"unpriced", "params_change", "no_incumbent"}


def test_the_four_outcomes_are_never_collapsed_into_a_rate(db):
    r = prc.report("nothing-observed", db_path=db)
    for k in ("agreed", "new_only", "legacy_only", "not_comparable"):
        assert k in r
    assert not any("rate" in k or "pct" in k for k in r), (
        "a pass rate answers a question nobody asked: legacy_only and new_only "
        "are different defects for different members")


def test_NO_DATA_and_QUIET_are_DIFFERENT_facts_and_the_report_LEADS_with_which(db):
    """⛔ An empty store prints four zeroes and reads exactly like perfect
    agreement. `status` and `observed` come FIRST in the report for that
    reason."""
    empty = prc.report("never-ticked", db_path=db)
    assert empty["status"] == "NO DATA" and empty["spans"] == 0

    prc.observe("quiet", HIT, DAY, positions=[_pos("NVDA")],
                live_prices={"NVDA": 120.0}, db_path=db)
    quiet = prc.report("quiet", db_path=db)
    assert quiet["status"] == "QUIET" and quiet["spans"] == 1

    # Same four zeroes, different fact — and the report says which, first.
    for r in (empty, quiet):
        assert (r["agreed"], r["new_only"], r["legacy_only"], r["not_comparable"]) == (0, 0, 0, 0)
    assert empty["status"] != quiet["status"]
    keys = list(quiet)
    assert keys.index("status") < keys.index("agreed")
    assert keys.index("observed") < keys.index("agreed")


def test_the_report_STATES_WHAT_IT_CANNOT_SEE_every_time(db):
    r = prc.report("p1", db_path=db)
    assert r["blind_spots"], "a report that names no blind spot has stopped looking"
    joined = " ".join(r["blind_spots"])
    assert "HARNESS-ARMED" in joined
    assert "MISSING PRICE" in joined
    assert "AGGREGATE HEAT" in joined
    assert "NOT OF THE DELIVERY" in joined


# --- span identity ----------------------------------------------------------

def test_a_parameter_change_RESETS_THE_CLOCK_into_not_comparable(db):
    rows = [_pos("NVDA")]
    prices = {"NVDA": 90.0}
    prc.observe("p1", HIT, DAY, positions=rows, live_prices=prices, db_path=db)
    prc.observe("p1", HIT, DAY2, positions=rows, live_prices=prices, db_path=db)
    before = prc.report("p1", db_path=db)
    assert before["agreed"] == 2 and before["not_comparable"] == 0

    prc.observe("p1", dict(HIT, entity_ref="NVDA"), DAY2,
                positions=rows, live_prices=prices, db_path=db)
    after = prc.report("p1", db_path=db)
    assert after["not_comparable"] == 2, "the pre-change ticks are DISCARDED, never carried"
    assert after["agreed"] == 1, "only the post-change tick counts as agreement"
    assert after["spans"] == 2


def test_the_fingerprint_carries_every_field_that_decides_firing():
    for changed in ({"severity": pr.SEV_STOP_PROXIMITY}, {"entity_ref": "NVDA"},
                    {"threshold_pct": 0.05}, {"side": "Long"}, {"position_source": "broker"}):
        assert pr.predicate_fingerprint(HIT) != pr.predicate_fingerprint(dict(HIT, **changed)), changed


def test_the_fingerprint_ignores_things_that_do_not_decide_firing():
    for same in ({"dedup_grain": "something-else"}, {"price_source": "somewhere-else"},
                 {"population": "everything"}):
        assert pr.predicate_fingerprint(HIT) == pr.predicate_fingerprint(dict(HIT, **same)), same


def test_entity_ref_case_does_not_reset_the_clock():
    assert pr.predicate_fingerprint(dict(HIT, entity_ref="nvda")) == \
           pr.predicate_fingerprint(dict(HIT, entity_ref="NVDA"))


def test_opening_a_span_is_idempotent_per_tick(db):
    rows = [_pos("NVDA")]
    for _ in range(4):
        prc.observe("p1", HIT, DAY, positions=rows, live_prices={"NVDA": 90.0}, db_path=db)
    assert prc.report("p1", db_path=db)["spans"] == 1


def test_sessions_are_counted_by_the_TICKS_market_date_not_wall_clock(db):
    rows = [_pos("NVDA")]
    for d in (DAY, DAY, DAY2):
        prc.observe("p1", HIT, d, positions=rows, live_prices={"NVDA": 90.0}, db_path=db)
    r = prc.report("p1", db_path=db)
    assert r["sessions_covered"] == [DAY, DAY2]
    assert r["verdict_ready"] is False
    assert r["min_sessions_for_verdict"] == 5


def test_verdict_ready_is_its_OWN_field_never_a_pass_fail(db):
    rows = [_pos("NVDA")]
    for i in range(5):
        prc.observe("p1", HIT, f"2026-09-{11 + i:02d}", positions=rows,
                    live_prices={"NVDA": 90.0}, db_path=db)
    r = prc.report("p1", db_path=db)
    assert r["verdict_ready"] is True and r["agreed"] == 5


# --- §2a item 4: the liveness stamp ------------------------------------------

def test_the_heartbeat_beats_on_a_QUIET_tick_too(db):
    """⛔ *A heartbeat that only beats on success is a success detector.* A dark
    run that died on its first morning is otherwise indistinguishable at the end
    of the week from one that ran every tick."""
    assert prc.heartbeat(db_path=db) is None
    prc.observe("p1", HIT, DAY, positions=[_pos("NVDA")],
                live_prices={"NVDA": 120.0}, db_path=db)
    hb = prc.heartbeat(db_path=db)
    assert hb["ticks"] == 1 and hb["last_market_date"] == DAY and hb["last_tick_at"] > 0


def test_the_heartbeat_beats_on_an_AGGREGATE_HEAT_tick_too(db):
    """The one tick that returns early. A heartbeat written after the early
    return would make a harness armed only on the unreachable severity look
    dead."""
    prc.observe("p1", HEAT, DAY, positions=[_pos("NVDA")],
                live_prices={"NVDA": 90.0}, db_path=db)
    assert prc.heartbeat(db_path=db)["ticks"] == 1


def test_the_heartbeat_counts_every_tick_and_the_report_carries_it(db):
    rows = [_pos("NVDA")]
    for d in (DAY, DAY, DAY2):
        prc.observe("p1", HIT, d, positions=rows, live_prices={"NVDA": 90.0}, db_path=db)
    r = prc.report("p1", db_path=db)
    assert r["heartbeat"]["ticks"] == 3 and r["heartbeat"]["last_market_date"] == DAY2


# ═════════════════════════════════════════════════════════════════════════
# §2a item 3 — what calls this evaluator
# ═════════════════════════════════════════════════════════════════════════

def test_the_harness_is_the_only_caller_of_would_fire():
    """⛔⛔ §2a ITEM 3 AT A CHECKPOINT WITH NO WIRE YET.

    `price-level` merged with the type registered, the harness built, eighteen
    tests green and **nothing calling the evaluator** — and a week of empty rows
    would have read exactly like five sessions of agreement. At CP1-CP2 the
    honest answer is *the harness calls it, directly, over predicates it arms
    itself*, and this rail is the form that answer takes: it fails if a second
    caller appears (a wire added without an approval line) AND if the harness
    stops calling it (the evaluator gone dark for real).
    """
    callers = []
    for p in (_REPO / "api").rglob("*.py"):
        if p.name == "position_risk.py":
            continue
        try:
            code = _code_only(p)
        except SyntaxError:
            continue
        if "position_risk.would_fire" in code or "_pr.would_fire" in code:
            callers.append(str(p.relative_to(_REPO)).replace("\\", "/"))
    assert callers == ["api/services/alert_taxonomy/position_risk_compare.py"], (
        f"expected the harness to be the ONLY caller; found {callers}")


def test_the_caller_rail_is_non_vacuous():
    """⛔ An empty result is a failed invocation until proven otherwise."""
    seen = list((_REPO / "api").rglob("*.py"))
    assert len(seen) > 100, f"the module walk found almost nothing ({len(seen)})"
    code = _code_only(_COMPARE)
    assert "_pr.would_fire" in code
    assert "_pr.unpriced_symbols" in code


def test_there_is_no_scheduler_entry_and_no_flag_for_this_type():
    """⛔ REGISTRATION IS NOT ACTIVATION, and putting a dark evaluator on a tick
    is not the FLIP. CP1-CP2 add neither."""
    main = _code_only(_REPO / "api" / "main.py")
    assert "position_risk" not in main
    assert "add_job" in main, "the main.py probe read nothing — it is broken"
    for path in (_MODULE, _COMPARE):
        code = _code_only(path)
        assert "add_job" not in code
        assert "CronTrigger" not in code
        assert "ENABLED" not in code, f"{path.name} reads an _ENABLED flag — CP1-CP2 have no gate"
        assert "os.environ" not in code and "getenv" not in code, (
            f"{path.name} reads an env var; the legacy rule reads none, so there "
            "is nothing for this type to follow and nothing for it to gate on")


def test_the_harness_imports_no_delivery_and_no_awareness_engine():
    code = _code_only(_COMPARE)
    for forbidden in ("deliver_alert_payload", "watchlist_alert_service",
                      "awareness.engine", "add_insight", "voice_proactive_service",
                      "receipts", "delivery", "j2_positions"):
        assert forbidden not in code, f"{forbidden} reached the harness's CODE"
    # CONTROL: it DOES import the pure rule module, so the absences above are a
    # distinction rather than a broken read.
    assert "from api.services.awareness import rules" in code
    assert "rule_stop_watch" in code


def test_the_harness_records_no_fire_and_writes_no_member_visible_row():
    """⛔ NO PROJECTION OF MEMBER ROWS. The harness's only tables are its own two
    comparison tables; it never calls `receipts.record_fire`."""
    code = _code_only(_COMPARE)
    assert "record_fire" not in code
    assert "alert_fires" not in code
    schema = prc._SCHEMA
    tables = {ln.split("IF NOT EXISTS", 1)[1].split("(", 1)[0].strip()
              for ln in schema.splitlines() if "CREATE TABLE IF NOT EXISTS" in ln}
    assert tables == {"position_risk_comparison_spans", "position_risk_heartbeat"}, tables
