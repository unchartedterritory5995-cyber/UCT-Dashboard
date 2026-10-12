"""ALERT COVERAGE (2026-10-11) — the alert lane's `requirements` gate is PER PLOT where it can be attributed.

Found by `tests/test_alert_coverage_audit.py` over every committed saved-indicator shape: the committed Pine
corpus's `mcclellan-indicators` member-pane document is stamped `window_dependent` because 2 of its 16 plots
call `cum`, and the whole-definition refusal kept its 14 plain plots from alerting (the class UIE Phase 6
fixed for `hlines`). Now a tagged plot is refused for ITSELF; the whole definition is refused, unchanged,
only when no data plot is clean or the stamp cannot be attributed.

Real save path (`user_definitions.save`, which stamps `requirements`), real admission on the real 579-bar
parity tape, real arm, and the single-address value door (`user_value_function`).
"""
from __future__ import annotations

import json
import pathlib

import pytest

from api.services import alert_user_series as aus
from api.services import user_definitions
from tests.test_alert_user_admission import USER_A, defn, defs_db, real_bars, save  # noqa: F401

CLOSE = {"type": "series", "name": "close"}
EMA = {"type": "call", "name": "ema", "args": [CLOSE, {"type": "num", "value": 19}]}
CUM = {"type": "call", "name": "cum", "args": [EMA]}                       # window_dependent
FRAG = aus.REFUSAL_FRAGMENTS["requirements"]
FIX = pathlib.Path(__file__).parent / "fixtures" / "alert_coverage" / "mcclellan_member_pane_doc.json"


def v2(def_id, trees, sources, scan):
    d = defn(def_id=def_id, ast_tree=trees[scan], plot_key=scan)
    d["plots"] = [{"key": k, "style": "line"} for k in trees]
    d["compute"] = {**d["compute"], "ast": trees[scan], "source": sources[scan], "trees": trees,
                    "sources": sources, "treesHash": user_definitions.trees_hash(trees), "scanPlot": scan}
    return d


def store(def_id, d):
    """The member's door — it stamps `requirements` itself."""
    user_definitions.save(USER_A, def_id, d)
    return user_definitions.get(USER_A, def_id)


OSC_SUM = lambda def_id="u_00000000d001": v2(def_id, {"osc": EMA, "sum": CUM},   # noqa: E731
                                              {"osc": "ema(close, 19)", "sum": "cum(ema(close, 19))"}, "osc")


def test_the_member_door_stamps_the_definition_window_dependent(defs_db):
    row = store("u_00000000d001", OSC_SUM())
    assert row["requirements"] == ["window_dependent"]


def test_the_clean_plot_ARMS_and_the_cumulative_plot_is_refused_for_ITSELF(defs_db, real_bars):
    store("u_00000000d001", OSC_SUM())
    admitted = aus.admit_user_definition(USER_A, "u_00000000d001", bars=real_bars)
    assert admitted["addresses"] == ["u_00000000d001.osc"]
    refused = admitted["withheld"]["u_00000000d001.sum"]
    assert refused.gate == "requirements" and FRAG in str(refused)
    assert "this plot's own formula needs it" in str(refused)
    assert aus.arm_for_alert(USER_A, "u_00000000d001.osc", "SPY", "5", bars=real_bars)["addresses"] == ["u_00000000d001.osc"]
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus.arm_for_alert(USER_A, "u_00000000d001.sum", "SPY", "5", bars=real_bars)
    assert exc.value.gate == "requirements"
    assert aus.scoped_key(USER_A, "u_00000000d001.sum") not in aus.USER_FUNCS


def test_the_single_address_value_door_follows_the_same_rule(defs_db, real_bars):
    store("u_00000000d001", OSC_SUM())
    aus.forget()
    fn = aus.user_value_function(USER_A, "u_00000000d001.osc")
    assert fn is not None and fn(real_bars, {}) is not None
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus.user_value_function(USER_A, "u_00000000d001.sum")
    assert exc.value.gate == "requirements"


def test_UNCHANGED_every_plot_tagged_refuses_the_whole_definition_as_before(defs_db, real_bars):
    d = v2("u_00000000d002", {"a": CUM, "b": {"type": "call", "name": "cum", "args": [CLOSE]}},
           {"a": "cum(ema(close, 19))", "b": "cum(close)"}, "a")
    store("u_00000000d002", d)
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus.admit_user_definition(USER_A, "u_00000000d002", bars=real_bars)
    assert exc.value.gate == "requirements"
    assert "this plot's own formula" not in str(exc.value)          # the definition-level sentence, as it was


def test_UNCHANGED_a_single_tree_window_dependent_document_is_refused_whole(defs_db, real_bars):
    store("u_00000000d003", defn(def_id="u_00000000d003", ast_tree=CUM))
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus.admit_user_definition(USER_A, "u_00000000d003", bars=real_bars)
    assert exc.value.gate == "requirements"


def test_SAFE_DIRECTION_a_stamp_no_tree_explains_refuses_the_whole_definition(defs_db, real_bars):
    """A stored tag the per-plot walk cannot reproduce (another build's stamp) stays the authority."""
    clean = v2("u_00000000d004", {"osc": EMA, "close": CLOSE}, {"osc": "ema(close, 19)", "close": "close"}, "osc")
    save(USER_A, clean, requirements=["window_dependent"])
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus.admit_user_definition(USER_A, "u_00000000d004", bars=real_bars)
    assert exc.value.gate == "requirements"


def test_a_definition_with_no_requirements_admits_exactly_as_before(defs_db, real_bars):
    clean = v2("u_00000000d005", {"osc": EMA, "close": CLOSE}, {"osc": "ema(close, 19)", "close": "close"}, "osc")
    store("u_00000000d005", clean)
    admitted = aus.admit_user_definition(USER_A, "u_00000000d005", bars=real_bars)
    assert sorted(admitted["addresses"]) == ["u_00000000d005.close", "u_00000000d005.osc"]
    assert "withheld" not in admitted


def test_the_REAL_corpus_document_mcclellan_indicators(defs_db, real_bars):
    """The committed Pine corpus's member-pane document (fixture): 14 of 16 plots carry no tag. Before:
    refused whole (`requirements`). After: every plot that is refused is refused for its OWN reason."""
    doc = json.loads(FIX.read_text(encoding="utf-8"))["definition"]
    doc = json.loads(json.dumps(doc))
    doc["id"] = "u_00000000d0c1"
    row = store("u_00000000d0c1", doc)
    assert row["requirements"] == ["window_dependent"]
    admitted = aus.admit_user_definition(USER_A, "u_00000000d0c1", bars=real_bars)
    armed = {a.split(".", 1)[1] for a in admitted["addresses"]}
    withheld = {a.split(".", 1)[1]: e.gate for a, e in (admitted.get("withheld") or {}).items()}
    assert len(armed) == 12, armed
    assert set(withheld) == {"value", "out14", "out15", "out16"}
    # out15/out16 are the cumulative plots; whatever door refuses them first, they never arm
    assert {"out15", "out16"}.isdisjoint(armed)
    for key in doc["compute"]["trees"]:
        tags = user_definitions.requirement_tags({"compute": {"kind": "ast", "ast": doc["compute"]["trees"][key]}})
        if key in armed:
            assert not tags, f"{key} armed while its own tree carries {tags}"
