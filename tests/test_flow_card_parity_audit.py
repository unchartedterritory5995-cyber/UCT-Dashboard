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
