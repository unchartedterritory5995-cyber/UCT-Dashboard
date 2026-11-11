"""Pytest wrapper over `tools/flow_card_parity_audit.py`'s pure half, in the repo's W8 shape:
the instrument owns its `--self-check`; this makes the suite fail if that check ever stops
being able to fire. No network: `run()` is never called here."""
import importlib.util
import pathlib

_PATH = pathlib.Path(__file__).resolve().parents[1] / "tools" / "flow_card_parity_audit.py"
_spec = importlib.util.spec_from_file_location("flow_card_parity_audit", _PATH)
audit = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(audit)


def test_self_check_passes():
    assert audit.self_check() == 0


def test_an_empty_card_beside_a_live_page_is_a_problem():
    page = audit.page_summary([{"Dt": "9/24", "CP": "C", "K": 10, "E": "10/9", "P": 5, "D": "BULL"}])
    card = audit.card_summary({"contract_count": 0, "contracts": [], "net": {}})
    assert any("card EMPTY" in p for p in audit.compare(page, card)["problems"])


def test_a_direction_flip_is_a_problem_and_neutral_is_not():
    page = audit.page_summary([{"Dt": "9/24", "CP": "P", "K": 10, "E": "10/9", "P": 5, "D": "BEAR"}])
    flipped = audit.card_summary({"contract_count": 1, "net": {"dir": "BULL"},
                                  "contracts": [{"cp": "P", "strike": 10, "exp": "10/9/2026", "premium": 5}]})
    neutral = audit.card_summary({"contract_count": 1, "net": {"dir": "NEUTRAL"},
                                  "contracts": [{"cp": "P", "strike": 10, "exp": "10/9/2026", "premium": 5}]})
    assert any("direction" in p for p in audit.compare(page, flipped)["problems"])
    assert not any("direction" in p for p in audit.compare(page, neutral)["problems"])


def test_year_less_and_two_digit_expiries_key_the_same_contract():
    assert audit._contract_key("C", "535", "10/9/26") == audit._contract_key("c", 535.0, "10/9/2026")


def test_an_empty_page_beside_a_full_card_is_a_problem():
    """The MIRROR of the empty-card clause, missing until 2026-11-08.

    Planted from the run that exposed it: a pod-side probe read `all_directional` from the
    wrong nesting level, so the page side was [] for every symbol, and `compare` returned
    AGREE against cards carrying up to $35.7M (NVDA, session 11/6/2026). An instrument that
    cannot fail in one direction will eventually be cited as proof in that direction.
    """
    page = audit.page_summary([])
    card = audit.card_summary({"contract_count": 76,
                               "net": {"bull": 35_744_037, "bear": 12_006_018, "dir": "BULL"},
                               "contracts": [{"cp": "C", "strike": 185, "exp": "11/13/2026",
                                              "premium": 9, "direction": "Bull"}]})
    assert any("page EMPTY" in p for p in audit.compare(page, card)["problems"])


def test_a_symbol_quiet_on_both_sides_is_not_a_disagreement():
    """The control on the test above: without it the fix would red every thin name."""
    page = audit.page_summary([])
    card = audit.card_summary({"contract_count": 0, "contracts": [], "net": {}})
    assert audit.compare(page, card)["problems"] == []


def test_overlap_counts_the_whole_page_not_the_top_ten_display_slice():
    """`page_summary['top']` is ten rows for a human; `compare` must use `['keys']`.

    Fifteen page contracts in descending premium, and the card holds the SMALLEST one, so it
    falls outside `top`. Before the fix this reported 0/1 overlap AND claimed the page had
    left the contract side-less: two wrong answers from one truncation. Measured on the live
    11/6 tape, the artifact read AMD 0/40 and NVDA 5/40 -- which looks like two surfaces
    agreeing on nothing.
    """
    page = audit.page_summary([{"Dt": "9/24", "CP": "C", "K": 500 + i, "E": "10/9",
                                "P": 100 - i, "D": "BULL"} for i in range(15)])
    assert len(page["top"]) == 10 and len(page["keys"]) == 15, "the premise of this test"
    card = audit.card_summary({"contract_count": 1, "net": {"bull": 1, "bear": 0, "dir": "BULL"},
                               "contracts": [{"cp": "C", "strike": 514, "exp": "10/9/2026",
                                              "premium": 1, "direction": "Bull"}]})
    r = audit.compare(page, card)
    assert r["card_contracts_on_page"] == 1
    assert r["notes"] == []


def test_compare_survives_a_json_round_trip():
    """`keys` holds tuples in process and lists after json.dumps/loads (--json, a saved run).

    `compare` normalizes with tuple() for that reason; without it a reloaded run silently
    scores zero overlap, which is the truncation bug wearing a different hat.
    """
    import json
    page = audit.page_summary([{"Dt": "9/24", "CP": "C", "K": 535, "E": "10/9",
                                "P": 1_000_000, "D": "BULL"}])
    card = audit.card_summary({"contract_count": 1, "net": {"bull": 9, "bear": 0, "dir": "BULL"},
                               "contracts": [{"cp": "C", "strike": 535, "exp": "10/9/2026",
                                              "premium": 9, "direction": "Bull"}]})
    rehydrated = json.loads(json.dumps({"page": page, "card": card}))
    r = audit.compare(rehydrated["page"], rehydrated["card"])
    assert r["card_contracts_on_page"] == 1
    assert r["problems"] == []
