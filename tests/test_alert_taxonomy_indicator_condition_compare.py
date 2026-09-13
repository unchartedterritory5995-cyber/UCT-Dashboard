"""GATE-S7-INDICATOR-CONDITION Checkpoint 2 — the FORWARD-ONLY comparison.

⛔ FOUR OUTCOMES, NEVER A PASS RATE, and `legacy_only` is an alert a member GETS
TODAY and would LOSE at the flip.

⛔ AND FOUR OBSERVATIONS THAT ARE NOT OUTCOMES. A refused predicate, an absent
value and a quiet bar are three different facts; folding any of them into
`agreed` would reproduce the §2b defect inside the instrument built to measure
it.

⛔ NO REPLAY. Both sides are driven at the same instant on the same value.
"""
from __future__ import annotations

import ast
import pathlib

from api.services import alert_fired_log as _fires
from api.services.alert_taxonomy import indicator_condition as ic
from api.services.alert_taxonomy import indicator_condition_compare as cmp_
from api.services.canonical import address_book as _book

_REPO = pathlib.Path(__file__).resolve().parents[1]
_HARNESS = _REPO / "api" / "services" / "alert_taxonomy" / "indicator_condition_compare.py"

_PROSE_CONSTANTS = ("BLIND_SPOTS", "_SCHEMA")


def _code_only(path: pathlib.Path) -> str:
    """⛔ CODE, NEVER PROSE. This harness explains at length which mutating
    legacy functions it must never call; a naive substring search matches the
    explanation and every absence assertion below goes red on the documentation
    that exists to prevent the thing being asserted."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id in _PROSE_CONSTANTS for t in node.targets):
            node.value = ast.Constant(value="<prose>")
    return ast.unparse(ast.fix_missing_locations(tree))


def test_the_stripper_sees_code_and_not_prose():
    """⛔ THE CONTROL FOR EVERY ABSENCE ASSERTION BELOW."""
    code = _code_only(_HARNESS)
    raw = _HARNESS.read_text(encoding="utf-8")
    assert "_evaluate_one" in raw and "deliver_alert_payload" in raw
    assert "_evaluate_one" not in code and "deliver_alert_payload" not in code
    assert "def observe" in code and "def classify" in code and "def report" in code
    assert len(code) > 500


# ══════════════════════════════════════════════════════════════════════════
# FIXTURES — a metric the gate ADMITS and one it does not
# ══════════════════════════════════════════════════════════════════════════

def _admitted_metric() -> str:
    """A `cadence: nightly` screener scalar — the one shape the gate admits."""
    metrics = _book.book().get("metrics") or {}
    for name in sorted(metrics):
        m = metrics[name]
        if m.get("store") == "screener_rows" and m.get("cadence") == "nightly":
            return name
    raise AssertionError("the book declares no nightly screener metric — the fixture is gone")


def _legacy_address() -> str:
    """An address the LEGACY lane knows and the book does not — the F-S7-IC-1
    case, and the one that produces a `legacy_only`."""
    from api.services import indicator_alert_evaluator as ev
    assert "rsi" in ev.all_addresses()
    return "rsi"


def _agreeing_params():
    return {"indicator": _admitted_metric(), "condition": "above",
            "threshold": 10.0, "tf": "D"}


def _legacy_only_params():
    return {"indicator": _legacy_address(), "condition": "above",
            "threshold": 10.0, "tf": "D"}


def _db(tmp_path):
    return str(tmp_path / "at.db")


# ══════════════════════════════════════════════════════════════════════════
# THE CLASSIFIER'S OWN TRUTH TABLE
# ══════════════════════════════════════════════════════════════════════════

def _side(outcome, fire_key=None):
    return {"outcome": outcome, "refusal": None, "triggered": None, "fire_key": fire_key}


def test_the_classifier_produces_each_of_the_four_outcomes():
    fired = lambda k="ep:1": _side(ic.OUTCOME_FIRED, k)                 # noqa: E731
    quiet = _side(ic.OUTCOME_QUIET)
    assert cmp_.classify(fired(), fired())[0] == cmp_.AGREED
    assert cmp_.classify(fired(), quiet)[0] == cmp_.NEW_ONLY
    assert cmp_.classify(quiet, fired())[0] == cmp_.LEGACY_ONLY
    assert cmp_.classify(fired("ep:1"), fired("bar:5"))[0] == cmp_.NOT_COMPARABLE


def test_two_fires_on_different_keys_are_NOT_agreement():
    """⛔ The fire key IS the identity the legacy lane dedups on. Two sides
    firing on different keys are two KEY FUNCTIONS, not two rules."""
    outcome, _ = cmp_.classify(_side(ic.OUTCOME_FIRED, "ep:1"),
                               _side(ic.OUTCOME_FIRED, "ep:2"))
    assert outcome == cmp_.NOT_COMPARABLE


def test_neither_side_firing_is_NOT_an_outcome():
    outcome, obs = cmp_.classify(_side(ic.OUTCOME_QUIET), _side(ic.OUTCOME_QUIET))
    assert outcome is None
    assert obs == [cmp_.QUIET_BOTH]


def test_a_refusal_is_recorded_as_an_OBSERVATION_and_never_as_agreement():
    """⛔⛔ THIS CHECKPOINT'S THESIS, at the classifier. Two refused sides look
    exactly like two quiet sides to a boolean, and they are not the same fact."""
    outcome, obs = cmp_.classify(_side(ic.OUTCOME_REFUSED), _side(ic.OUTCOME_REFUSED))
    assert outcome is None
    assert cmp_.DARK_REFUSED in obs and cmp_.LEGACY_REFUSED in obs
    assert cmp_.QUIET_BOTH not in obs, "a refusal was collapsed into a quiet bar"


def test_an_absent_value_is_its_own_observation():
    outcome, obs = cmp_.classify(_side(ic.OUTCOME_NO_VALUE), _side(ic.OUTCOME_NO_VALUE))
    assert outcome is None and cmp_.NO_VALUE in obs and cmp_.QUIET_BOTH not in obs


def test_the_outcome_and_observation_columns_do_not_overlap():
    assert not (set(cmp_.OUTCOME_COLUMNS) & set(cmp_.OBSERVATION_COLUMNS))
    assert len(cmp_.OUTCOME_COLUMNS) == 4


# ══════════════════════════════════════════════════════════════════════════
# END TO END — both sides driven through the REAL deciding functions
# ══════════════════════════════════════════════════════════════════════════

def test_both_sides_derive_the_fire_key_from_the_SAME_real_function():
    """⛔ GATE §1a: *"if the dark evaluator computes a different `fire_key` the
    comparison is measuring two key functions, not two rules."* Neither side
    restates it — both call `alert_fired_log.fire_key`."""
    params = _agreeing_params()
    dark = ic.would_fire(params, entity_ref="AAPL", value=99.0,
                         bar_time=20260912, arm_epoch=4)
    legacy = cmp_.legacy_would_fire(params, value=99.0, bar_time=20260912, arm_epoch=4)
    assert dark["fire_key"] == legacy["fire_key"] == _fires.fire_key("above", 20260912, 4)
    code = _code_only(_HARNESS)
    assert "fire_key" in code and "_fires.fire_key" in code


def test_an_agreeing_tick_is_recorded_as_agreed(tmp_path):
    p = _db(tmp_path)
    out = cmp_.observe("pred-agree", _agreeing_params(), "2026-09-12",
                       entity_ref="AAPL", value=99.0, bar_time=20260912,
                       arm_epoch=1, db_path=p)
    assert out["outcome"] == cmp_.AGREED, out
    rep = cmp_.report("pred-agree", db_path=p)
    assert rep["status"] == "OBSERVED"
    assert rep[cmp_.AGREED] == 1 and rep[cmp_.LEGACY_ONLY] == 0


def test_the_cadence_gate_COSTS_a_member_an_alert_and_it_is_called_legacy_only(tmp_path):
    """⛔⛔ THE HEADLINE OF THIS CHECKPOINT. `rsi` is an address the legacy lane
    fires on today and the book does not declare, so the dark side refuses it at
    registration. That is not a pass — it is an alert a member LOSES at the flip,
    and the column that says so must be the one that lights up."""
    p = _db(tmp_path)
    out = cmp_.observe("pred-loss", _legacy_only_params(), "2026-09-12",
                       entity_ref="AAPL", value=99.0, bar_time=20260912,
                       arm_epoch=1, db_path=p)
    assert out["dark"]["outcome"] == ic.OUTCOME_REFUSED
    assert ic.REFUSAL_ADDRESS_UNRESOLVED in out["dark"]["refusal"]
    assert out["legacy"]["outcome"] == ic.OUTCOME_FIRED
    assert out["outcome"] == cmp_.LEGACY_ONLY, out

    rep = cmp_.report("pred-loss", db_path=p)
    assert rep[cmp_.LEGACY_ONLY] == 1
    assert rep["observations"][cmp_.DARK_REFUSED] == 1
    assert "LOSE" in rep["legacy_only_means"]


def test_new_only_is_reachable_in_the_classifier_and_unreachable_end_to_end():
    """⚠️ MEASURED, AND RECORDED AS A BLIND SPOT RATHER THAN LEFT AS A ZERO.

    For the dark side to fire, the metric must be in the book. For the legacy
    side to refuse, `refusal_for` must hit one of its three gates — two of which
    are subsets of the LEGACY vocabulary the book does not intersect, and the
    third also makes `check_condition` answer False for the dark side. So a zero
    in `new_only` proves nothing today, and this test is what makes the day it
    becomes reachable visible.
    """
    assert cmp_.classify(_side(ic.OUTCOME_FIRED, "ep:1"),
                         _side(ic.OUTCOME_QUIET))[0] == cmp_.NEW_ONLY
    metric = _admitted_metric()
    from api.services import indicator_alert_service as svc
    for condition in sorted(svc.evaluable_conditions()):
        for threshold in (None, 10.0):
            params = {"indicator": metric, "condition": condition,
                      "threshold": threshold, "tf": "D"}
            dark = ic.would_fire(params, entity_ref="AAPL", value=99.0, prev_value=-1.0,
                                 bar_time=20260912, arm_epoch=1)
            legacy = cmp_.legacy_would_fire(params, value=99.0, prev_value=-1.0,
                                            bar_time=20260912, arm_epoch=1)
            outcome, _ = cmp_.classify(dark, legacy)
            assert outcome != cmp_.NEW_ONLY, (
                f"new_only became reachable on {condition!r}/{threshold!r} — the "
                f"blind spot is stale and must be re-measured")
    assert any("new_only" in s for s in cmp_.BLIND_SPOTS)


def test_a_quiet_tick_records_no_outcome_but_still_counts(tmp_path):
    p = _db(tmp_path)
    out = cmp_.observe("pred-quiet", _agreeing_params(), "2026-09-12",
                       entity_ref="AAPL", value=1.0, db_path=p)
    assert out["outcome"] is None and cmp_.QUIET_BOTH in out["observations"]
    rep = cmp_.report("pred-quiet", db_path=p)
    assert rep["status"] == "QUIET"
    assert rep["ticks"] == 1 and rep["observed"] == 0
    assert rep["observations"][cmp_.QUIET_BOTH] == 1


def test_an_absent_value_is_not_a_quiet_market(tmp_path):
    p = _db(tmp_path)
    out = cmp_.observe("pred-nodata", _agreeing_params(), "2026-09-12",
                       entity_ref="AAPL", value=None, db_path=p)
    assert cmp_.NO_VALUE in out["observations"]
    assert cmp_.QUIET_BOTH not in out["observations"]
    rep = cmp_.report("pred-nodata", db_path=p)
    assert rep["observations"][cmp_.NO_VALUE] == 1
    assert rep["observations"][cmp_.QUIET_BOTH] == 0


# ══════════════════════════════════════════════════════════════════════════
# NO DATA vs QUIET — report() leads with what it observed
# ══════════════════════════════════════════════════════════════════════════

def test_report_distinguishes_NO_DATA_from_QUIET(tmp_path):
    """⛔ An empty comparison store prints four zeroes and reads exactly like
    perfect agreement. *A dark run that never ran and a dark run that found no
    disagreement are different facts.*"""
    p = _db(tmp_path)
    empty = cmp_.report("never-ran", db_path=p)
    assert empty["status"] == "NO DATA"
    assert empty["observed"] == 0 and empty["ticks"] == 0 and empty["spans"] == 0

    cmp_.open_span_if_absent("armed-but-idle", _agreeing_params(), "closed", db_path=p)
    idle = cmp_.report("armed-but-idle", db_path=p)
    assert idle["status"] == "NO TICKS", idle
    assert idle["spans"] == 1 and idle["ticks"] == 0

    cmp_.observe("ran-quiet", _agreeing_params(), "2026-09-12",
                 entity_ref="AAPL", value=1.0, db_path=p)
    assert cmp_.report("ran-quiet", db_path=p)["status"] == "QUIET"


def test_the_report_leads_with_what_it_observed():
    """The first three keys are the observation, not the score."""
    keys = list(cmp_.report("nothing-here").keys())
    assert keys[:3] == ["status", "observed", "ticks"]


def test_the_report_publishes_no_pass_rate():
    """⛔ `legacy_only` is a count of occasions a member loses an alert. Dividing
    it by anything is how that stops being legible."""
    rep = cmp_.report("nothing-here")
    for key in rep:
        assert not any(w in key.lower() for w in ("rate", "pct", "percent", "ratio", "score")), key
    assert all(isinstance(rep[k], int) for k in cmp_.OUTCOME_COLUMNS)
    code = _code_only(_HARNESS)
    assert "/ " not in code.replace("db_path", ""), "the harness computes a ratio somewhere"


def test_the_report_states_what_it_cannot_see_every_time():
    rep = cmp_.report("nothing-here")
    assert rep["blind_spots"] is cmp_.BLIND_SPOTS
    assert len(cmp_.BLIND_SPOTS) >= 5
    joined = " ".join(cmp_.BLIND_SPOTS)
    assert "ZERO METRIC NAMES" in joined
    assert "indicator_alerts" in joined and "harness-armed" in joined.lower()


# ══════════════════════════════════════════════════════════════════════════
# THE ANCHOR — the predicate's identity AND the evaluation lane
# ══════════════════════════════════════════════════════════════════════════

def test_a_params_change_discards_the_accumulated_counts(tmp_path):
    p = _db(tmp_path)
    params = _agreeing_params()
    cmp_.observe("pred-anchor", params, "2026-09-12", entity_ref="AAPL",
                 value=99.0, bar_time=20260912, arm_epoch=1, db_path=p)
    assert cmp_.report("pred-anchor", db_path=p)[cmp_.AGREED] == 1

    moved = dict(params, threshold=50.0)
    cmp_.observe("pred-anchor", moved, "2026-09-12", entity_ref="AAPL",
                 value=99.0, bar_time=20260912, arm_epoch=1, db_path=p)
    rep = cmp_.report("pred-anchor", db_path=p)
    assert rep[cmp_.AGREED] == 1, "the pre-change agreement was carried forward"
    assert rep[cmp_.NOT_COMPARABLE] == 1
    assert rep["spans"] == 2


def test_an_eval_mode_change_closes_the_span_and_names_the_reason(tmp_path, monkeypatch):
    """⛔ §1b: a dark comparison whose two sides straddle a mode change is
    measuring the MODE. `eval_mode()` moves with NO DEPLOY."""
    from api.services import indicator_alert_evaluator as ev
    p = _db(tmp_path)
    params = _agreeing_params()
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "closed")
    cmp_.observe("pred-mode", params, "2026-09-12", entity_ref="AAPL",
                 value=99.0, bar_time=20260912, arm_epoch=1, db_path=p)
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "forming")
    cmp_.observe("pred-mode", params, "2026-09-12", entity_ref="AAPL",
                 value=99.0, bar_time=20260912, arm_epoch=1, db_path=p)

    rep = cmp_.report("pred-mode", db_path=p)
    assert rep[cmp_.NOT_COMPARABLE] == 1, rep
    assert sorted(rep["eval_modes_seen"]) == ["closed", "forming"]

    conn = cmp_._conn(p)
    try:
        reasons = [r["close_reason"] for r in conn.execute(
            "SELECT close_reason FROM indicator_condition_comparison_spans "
            "WHERE predicate_id=? AND closed_at IS NOT NULL", ("pred-mode",)).fetchall()]
    finally:
        conn.close()
    assert reasons == ["eval_mode_change"], reasons


def test_eval_mode_is_read_at_CALL_time_not_bound_at_import(monkeypatch):
    """⛔ A module-level capture would make the no-deploy rollback a fiction and
    every span after the first stamp a lane that is no longer running."""
    from api.services import indicator_alert_evaluator as ev
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "forming")
    assert cmp_.legacy_eval_mode() == "forming"
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "closed")
    assert cmp_.legacy_eval_mode() == "closed"
    code = _code_only(_HARNESS)
    assert "def legacy_eval_mode" in code
    assert "eval_mode()" in code


def test_open_span_is_idempotent(tmp_path):
    p = _db(tmp_path)
    a = cmp_.open_span_if_absent("pred-idem", _agreeing_params(), "closed", db_path=p)
    b = cmp_.open_span_if_absent("pred-idem", _agreeing_params(), "closed", db_path=p)
    assert a["id"] == b["id"]
    assert cmp_.report("pred-idem", db_path=p)["spans"] == 1


# ══════════════════════════════════════════════════════════════════════════
# LIVENESS — a heartbeat that only beats on success is a success detector
# ══════════════════════════════════════════════════════════════════════════

def test_the_heartbeat_beats_on_quiet_and_on_refused_ticks(tmp_path):
    p = _db(tmp_path)
    cmp_.observe("hb", _agreeing_params(), "2026-09-11", entity_ref="AAPL",
                 value=1.0, db_path=p)                       # quiet
    cmp_.observe("hb", _legacy_only_params(), "2026-09-12", entity_ref="AAPL",
                 value=None, db_path=p)                      # refused + no value
    hb = cmp_.heartbeat(db_path=p)
    assert hb["ticks"] == 2, hb
    assert hb["last_market_date"] == "2026-09-12"


def test_sessions_are_counted_by_the_TICKS_market_date_not_the_wall_clock(tmp_path):
    p = _db(tmp_path)
    for day in ("2026-09-10", "2026-09-11", "2026-09-11"):
        cmp_.observe("sess", _agreeing_params(), day, entity_ref="AAPL",
                     value=1.0, now=1_757_000_000.0, db_path=p)
    rep = cmp_.report("sess", db_path=p)
    assert rep["sessions_covered"] == ["2026-09-10", "2026-09-11"]
    assert rep["ticks"] == 3
    assert rep["verdict_ready"] is False
    assert rep["min_sessions_for_verdict"] == cmp_.MIN_SESSIONS_FOR_VERDICT


# ══════════════════════════════════════════════════════════════════════════
# DARK BY CONSTRUCTION
# ══════════════════════════════════════════════════════════════════════════

def test_the_harness_calls_no_mutating_or_delivering_legacy_function():
    code = _code_only(_HARNESS)
    for forbidden in ("_evaluate_one", "record_fire", "record_evaluation",
                      "deliver_alert_payload", "watchlist_alert_service",
                      "list_active", "indicator_alerts"):
        assert forbidden not in code, f"{forbidden} reached the harness's CODE"


def test_the_harness_imports_no_delivery_and_no_receipts():
    code = _code_only(_HARNESS)
    assert "delivery" not in code and "receipts" not in code


def test_the_harness_drives_the_REAL_refusal_for():
    """⛔ Not a mirror. `indicator_alert_service.refusal_for` is pure — it reads
    no database and delivers nothing — so there is no reason to restate it and
    every reason not to."""
    code = _code_only(_HARNESS)
    assert "refusal_for" in code
    from api.services import indicator_alert_service as svc
    params = {"indicator": "rsi", "condition": "not_a_rule", "threshold": None, "tf": "D"}
    out = cmp_.legacy_would_fire(params, value=50.0)
    assert out["outcome"] == ic.OUTCOME_REFUSED
    assert svc.REFUSAL_UNJUDGEABLE_CONDITION in out["refusal"]
