"""ALERT COVERAGE (2026-10-11) — the alert lane's `repaint` gate is PER PLOT.

Found by `tests/test_alert_coverage_audit.py`: the committed Pine corpus's `cpr-with-mas-super-trend-vwap`
member-pane document saves through the member's door (its 14 `preview-repaints` plots acknowledged at save),
and then NONE of its 53 plots could alert — the gate refused the whole definition on the first unclean
plot, and the alert-arm acknowledgement (`meta.repaintAck`) has no surface that writes it
(`user_definition_relint`). 39 clean plots were refused for 14 siblings — the class UIE Phase 6 fixed for
`hlines`. Now an unclean plot is refused for ITSELF; the whole definition is refused, unchanged, only when
no data plot is clean.
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
SMA = {"type": "call", "name": "sma", "args": [CLOSE, {"type": "num", "value": 9}]}
FIX = pathlib.Path(__file__).parent / "fixtures" / "alert_coverage" / "cpr_member_pane_doc.json"


def two(def_id, meta=None):
    trees = {"line": EMA, "pivot": SMA}
    d = defn(def_id=def_id, ast_tree=EMA, plot_key="line")
    d["plots"] = [{"key": "line", "style": "line"}, {"key": "pivot", "style": "line"}]
    d["compute"] = {**d["compute"], "ast": EMA, "source": "ema(close, 19)", "trees": trees,
                    "sources": {"line": "ema(close, 19)", "pivot": "sma(close, 9)"},
                    "treesHash": user_definitions.trees_hash(trees), "scanPlot": "line"}
    if meta:
        d["meta"] = {**d.get("meta", {}), **meta}
    return d


@pytest.mark.parametrize("mode", ["preview-repaints", "repaints"])
def test_the_clean_plot_ARMS_and_the_unclean_plot_is_refused_for_ITSELF(defs_db, real_bars, mode):
    save(USER_A, two("u_00000000e001"), repaint={"line": "non-repainting", "pivot": mode})
    admitted = aus.admit_user_definition(USER_A, "u_00000000e001", bars=real_bars)
    assert admitted["addresses"] == ["u_00000000e001.line"]
    refused = admitted["withheld"]["u_00000000e001.pivot"]
    assert refused.gate == "repaint" and "the definition's other plots can still alert" in str(refused)
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus.arm_for_alert(USER_A, "u_00000000e001.pivot", "SPY", "5", bars=real_bars)
    assert exc.value.gate == "repaint"
    assert aus.arm_for_alert(USER_A, "u_00000000e001.line", "SPY", "5", bars=real_bars)["addresses"] == ["u_00000000e001.line"]


def test_the_catalog_offers_the_clean_plot_and_not_the_unclean_one(defs_db):
    save(USER_A, two("u_00000000e002"), repaint={"line": "non-repainting", "pivot": "preview-repaints"})
    offered = {p["value"] for e in aus.user_catalog(USER_A) for p in (e.get("plots") or [])}
    assert "u_00000000e002.line" in offered and "u_00000000e002.pivot" not in offered


def test_the_single_address_value_door_follows_the_same_rule(defs_db, real_bars):
    save(USER_A, two("u_00000000e003"), repaint={"line": "non-repainting", "pivot": "preview-repaints"})
    aus.forget()
    assert aus.user_value_function(USER_A, "u_00000000e003.line") is not None
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus.user_value_function(USER_A, "u_00000000e003.pivot")
    assert exc.value.gate == "repaint"


def test_UNCHANGED_every_plot_unclean_refuses_the_whole_definition_with_the_old_sentence(defs_db, real_bars):
    save(USER_A, two("u_00000000e004"), repaint={"line": "preview-repaints", "pivot": "preview-repaints"})
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus.admit_user_definition(USER_A, "u_00000000e004", bars=real_bars)
    assert exc.value.gate == "repaint" and "other plots can still alert" not in str(exc.value)


def test_UNCHANGED_a_recorded_alert_acknowledgement_still_admits_every_plot(defs_db, real_bars):
    save(USER_A, two("u_00000000e005", meta={"repaintAck": True}), repaint={"line": "non-repainting", "pivot": "preview-repaints"})
    admitted = aus.admit_user_definition(USER_A, "u_00000000e005", bars=real_bars)
    assert sorted(admitted["addresses"]) == ["u_00000000e005.line", "u_00000000e005.pivot"]


def test_the_REAL_corpus_document_cpr_through_the_members_door(defs_db, real_bars):
    """The document the save hook POSTS (a shared graph), saved through `user_definitions.save` with the
    save-time acknowledgement a member gives. Before: refused whole (`repaint`). After: the 39 clean plots
    arm, the 14 `preview-repaints` plots are refused for themselves."""
    doc = json.loads(FIX.read_text(encoding="utf-8"))["definition"]
    doc["id"] = "u_00000000e0c1"
    user_definitions.save(USER_A, "u_00000000e0c1", doc, repaint_acknowledged=True)
    row = user_definitions.get(USER_A, "u_00000000e0c1")
    unclean = {k for k, v in (row["repaint"] or {}).items() if v != "non-repainting"}
    assert len(unclean) == 14
    admitted = aus.admit_user_definition(USER_A, "u_00000000e0c1", bars=real_bars)
    armed = {a.split(".", 1)[1] for a in admitted["addresses"]}
    withheld = {a.split(".", 1)[1]: e.gate for a, e in (admitted.get("withheld") or {}).items()}
    assert len(armed) == 39 and armed.isdisjoint(unclean)
    assert all(withheld[k] == "repaint" for k in unclean)
