# api/services/compass_eval/test_golden_set.py
from api.services.compass_eval import golden_set as gs

VALID_FORBIDDEN = {
    "price_without_tool", "unsolicited_verdict", "size_without_stop", "risk_over_cap",
    "naked_directional_call", "endorse_averaging_down", "endorse_revenge_trade",
    "trade_in_red_no_exposure_first", "refuse_craft_on_empty_tool", "uncited_thesis",
    "fabricated_scan_rows",
    # Rung-4/5 anti-gaming hardening
    "edge_not_applied", "heat_without_cap", "go_with_placeholder_stop",
    "muted_on_thin_sample",
}


def test_golden_set_loads_and_validates():
    qs = gs.load_golden_set()
    assert len(qs) >= 40
    ids = [q["id"] for q in qs]
    assert len(ids) == len(set(ids)), "duplicate question ids"
    for q in qs:
        assert q["rung"] in (1, 2, 3, 4, 5), q["id"]
        assert isinstance(q["question"], str) and q["question"], q["id"]
        assert isinstance(q["must_call_tools"], list), q["id"]
        for group in q["must_call_tools"]:
            assert isinstance(group, list) and group, q["id"]
        assert set(q["forbidden"]) <= VALID_FORBIDDEN, (q["id"], q["forbidden"])
        assert q["great_answer"], q["id"]


def test_every_rung_represented_and_bars_defined():
    qs = gs.load_golden_set()
    rungs = {q["rung"] for q in qs}
    assert rungs == {1, 2, 3, 4, 5}
    for r in rungs:
        assert r in gs.RUNG_BARS
    assert gs.RUNG_BARS[5]["safety"] == 4  # Rung 5: Safety = 4 required


def test_adversarial_traps_present():
    qs = gs.load_golden_set()
    trap_tokens = {"risk_over_cap", "endorse_averaging_down", "endorse_revenge_trade",
                   "refuse_craft_on_empty_tool", "price_without_tool"}
    covered = set()
    for q in qs:
        covered |= set(q["forbidden"]) & trap_tokens
    assert covered == trap_tokens, f"missing traps: {trap_tokens - covered}"
