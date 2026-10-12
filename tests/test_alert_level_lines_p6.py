"""UIE Phase 6 — "RSI with level lines" can carry an alert (docs/indicators/OPEN-FINDINGS-2026-10.md §1).

Production, 10-08: "Build me an RSI indicator with a moving average" then "Alert me when the RSI crosses
above 70" was refused — the 70/30 `hlines` guide has no formula tree, the lane raised `plot` for it, and
`plot` refused the WHOLE definition. Now the guide is refused for ITSELF (gate `presentation`, per plot),
the RSI line arms, and arming on the guide says what it is.

Real save path (`user_definitions.save`, which validates the v2 document), real admission on the real
579-bar parity tape, real arm call.
"""
from __future__ import annotations

import pytest

from api.services import alert_user_series as aus
from api.services import user_definitions
from tests.test_alert_user_admission import (  # noqa: F401 — fixtures used by name
    USER_A, defn, defs_db, real_bars, save,
)

RSI = {"type": "call", "name": "rsi", "args": [{"type": "series", "name": "close"}, {"type": "num", "value": 14}]}
RSI_MA = {"type": "call", "name": "sma", "args": [RSI, {"type": "num", "value": 9}]}
DEF = "u_0000000000c1"


def rsi_with_levels(def_id: str = DEF) -> dict:
    """The production request's shape: RSI + its moving average + the 70/30 guide (a v2 document)."""
    d = defn(def_id=def_id, ast_tree=RSI, plot_key="rsi")
    d["plots"] = [{"key": "rsi", "style": "line"}, {"key": "ma", "style": "line"},
                  {"key": "levels", "style": "hlines", "levels": [70, 30]}]
    trees = {"rsi": RSI, "ma": RSI_MA}
    d["compute"] = {**d["compute"], "ast": RSI, "source": "rsi(close, 14)", "trees": trees,
                    "sources": {"rsi": "rsi(close, 14)", "ma": "sma(rsi(close, 14), 9)"},
                    "treesHash": user_definitions.trees_hash(trees), "scanPlot": "rsi"}
    return d


def test_the_saved_RSI_with_level_lines_admits_its_RSI_line_and_refuses_only_the_guide(defs_db, real_bars):
    save(USER_A, rsi_with_levels())
    admitted = aus.admit_user_definition(USER_A, DEF, bars=real_bars)
    withheld = admitted.get("withheld") or {}
    assert f"{DEF}.levels" in withheld and withheld[f"{DEF}.levels"].gate == "presentation"
    assert f"{DEF}.rsi" not in withheld


def test_an_alert_ARMS_on_the_RSI_line(defs_db, real_bars):
    save(USER_A, rsi_with_levels())
    out = aus.arm_for_alert(USER_A, f"{DEF}.rsi", "SPY", "5", bars=real_bars)
    assert out is not None


def test_an_alert_on_the_GUIDE_is_refused_by_name_and_says_what_it_is(defs_db, real_bars):
    save(USER_A, rsi_with_levels())
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus.arm_for_alert(USER_A, f"{DEF}.levels", "SPY", "5", bars=real_bars)
    assert exc.value.gate == "presentation"
    assert aus.REFUSAL_FRAGMENTS["presentation"] in str(exc.value)
    assert "its line, not its guides" in str(exc.value)


def test_the_RSI_line_value_is_the_RSI_not_the_guide(defs_db, real_bars):
    """The admitted value function computes the RSI tree (0..100), never a level constant."""
    save(USER_A, rsi_with_levels())
    admissible, withheld = aus.plot_admissions(DEF, rsi_with_levels())
    fns = dict(admissible)
    fn = fns[f"{DEF}.rsi"]
    v = fn(real_bars, {})
    assert v is not None and 0.0 <= v <= 100.0 and v not in (70.0, 30.0)
    assert sorted(fns) == sorted([f"{DEF}.rsi", f"{DEF}.ma"])


def test_a_real_refusal_still_refuses_the_whole_definition(defs_db, real_bars):
    """Unchanged: a v2 document short a tree for a DATA plot is still refused whole (gate `plot`)."""
    d = rsi_with_levels()
    d["plots"].append({"key": "signal", "style": "line"})          # a data plot with no tree
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus.plot_admissions(DEF, d)
    assert exc.value.gate == "plot"


def test_a_v1_documents_guide_no_longer_arms_on_the_scan_trees_number(defs_db, real_bars):
    """Before: a single-tree document's `levels` plot fell back to `compute.ast`, so an alert on the
    GUIDE armed on the formula's own number under the guide's name. Now it is refused for itself."""
    d = defn(def_id="u_0000000000c2", ast_tree=RSI, plot_key="value")
    d["plots"] = [{"key": "value", "style": "line"}, {"key": "levels", "style": "hlines", "levels": [70, 30]}]
    admissible, withheld = aus.plot_admissions("u_0000000000c2", d)
    assert [a for a, _ in admissible] == ["u_0000000000c2.value"]
    assert withheld["u_0000000000c2.levels"].gate == "presentation"
