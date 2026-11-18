"""An explanation may show a calc's in-between numbers (his "show the steps"; REVIEW_LEARNINGS rules 3 and 29). Before
2026-11-17 the grounding check rejected "$500 at risk / 2.22 a share" because neither number is in the question or the
calc's result, so the checkers had to describe the steps without the numbers."""
from scripts.study import courses_lib as cl

CALC = {"fn": "shares_from_risk", "args": {"account": 50000, "risk_pct": 1, "entry": 48.62, "stop": 46.40}, "round": 0}


def _doc(why):
    q = {"key": "q01", "skill": "setup.x", "rung": 1, "format": "mcq", "q": "How many shares?",
         "choices": ["225 shares", "450 shares", "22 shares", "2,250 shares"], "answer": "225 shares",
         "calc": CALC, "why": why, "simple": "Divide the dollar risk by the risk per share, then round down."}
    return {"unit": "T.01", "track": "T", "title": "t", "skills": [{"id": "setup.x"}], "facts": [], "sources": [],
            "questions": [q], "verify": {"q01": {"status": "pass"}}}


WHY = "225 shares. 1% of 50,000 is $500 at risk. 48.62 minus 46.40 is 2.22 a share. 500 over 2.22 is 225.2, round down."


def test_steps_are_the_calcs_own_arithmetic():
    s = cl.calc_steps(CALC)
    assert s["risk_dollars"] == 500 and s["risk_per_share"] == 2.22 and s["raw_shares"] == 225.23


def test_an_explanation_that_shows_the_steps_grounds():
    item = [it for it in cl.build_items(_doc(WHY)) if it.get("_key") == "q01"][0]
    assert cl.strict_grounding(item) == []


def test_without_the_steps_it_would_not(monkeypatch):
    monkeypatch.setattr(cl, "calc_steps", lambda calc: {})
    item = [it for it in cl.build_items(_doc(WHY)) if it.get("_key") == "q01"][0]
    assert any("500" in p or "2.22" in p for p in cl.strict_grounding(item))


def test_plain_arithmetic_shows_every_part():
    # SET.22 q16: how far under the gap-up low (53.03) did the test day dip (52.45)? The steps are 0.58 and 1.09%.
    steps = cl.calc_steps({"fn": "arith", "args": {"expr": "(a - b) / a * 100", "a": 53.03, "b": 52.45}, "round": 2})
    assert 0.58 in steps.values() and 1.09 in steps.values()


def test_options_calcs_show_their_steps():
    # F6.03 q23: a 105 call with the stock at 112.40 is 7.40 in the money; the rest of the premium is time
    s = cl.calc_steps({"fn": "extrinsic", "args": {"kind": "call", "strike": 105, "underlying": 112.40, "premium": 9.10}})
    assert s["intrinsic"] == 7.4
    v = cl.calc_steps({"fn": "vertical_payoff", "args": {"kind": "call", "long_strike": 50, "short_strike": 55,
                                                         "net_debit": 2.0, "underlying": 57}})
    assert v["width"] == 5 and v["per_share"] == 3
