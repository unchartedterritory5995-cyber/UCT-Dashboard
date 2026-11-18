"""A walkthrough that narrates a real trade shows its chart (REVIEW_LEARNINGS rule 32; the owner on the 2026-11-17
localhost review of SET.07 w1: "WHY DO I NOT SEE THE CHART of any of these. I couldnt even give proper answers.").
The lesson's walkthrough carries `chart` {sym, asof, window, forward}; the bank item then asks the server for those
daily bars (with the averages' warm-up) and the player draws them, ticker shown, since the title names it."""
import copy

from scripts.study import courses_lib as cl

DOC = {
    "unit": "SET.99", "track": "SET", "title": "A test lesson", "skills": [{"id": "setup.flat_base"}],
    "sources": [{"id": "s1", "tier": 1, "publisher": "P", "title": "T", "url": "https://example.com", "accessed": "2026-11-17"}],
    "facts": [{"id": "f1", "source": "s1", "quote": "It broke out at 90.01 on 2013-09-09.", "claim": "A breakout."}],
    "teaches": "A test lesson.", "as_of": "2026-11-17",
    "questions": [{"key": "q01", "skill": "setup.flat_base", "rung": 1, "format": "tf", "q": "A flat base can break out.",
                   "answer": "True", "why": "True. It can.", "facts": ["f1"]}],
    "walkthroughs": [{"key": "w1", "title": "NUS, September 2013: the shelf",
                      "steps": ["NUS rested six weeks under 90.", "It traded through 90.01 on the buy day."],
                      "facts": ["f1"], "chart": {"sym": "NUS", "asof": "2013-09-09", "window": 120, "forward": 0}}],
    "verify": {"w1": {"status": "pass"}},
}


def test_a_charted_walkthrough_asks_for_its_daily_bars_with_the_warm_up():
    it = next(i for i in cl.build_items(DOC) if i["type"] == "walkthrough")
    assert it["bars"] == {"sym": "NUS", "tf": "D", "asof": "2013-09-09", "window": 120 + cl.WARMUP_BARS, "forward": 0}
    assert it["prompt_json"]["chart"] == {"window_bars": 120 + cl.WARMUP_BARS, "visible_bars": 120, "tf": "D",
                                          "forward_bars": 0, "hide_ticker": False}
    assert it["sym"] == "NUS" and it["asof"] == "2013-09-09"


def test_a_walkthrough_without_a_chart_stays_as_it_was():
    doc = copy.deepcopy(DOC)
    del doc["walkthroughs"][0]["chart"]
    it = next(i for i in cl.build_items(doc) if i["type"] == "walkthrough")
    assert "bars" not in it and "chart" not in it["prompt_json"]


def test_the_validator_refuses_a_bad_walkthrough_chart():
    for bad, words in (({"sym": "nus"}, "upper-case"), ({"asof": "Sept 9"}, "YYYY-MM-DD"), ({"tf": "60"}, "daily"),
                       ({"window": 5}, "20-400")):
        doc = copy.deepcopy(DOC)
        doc["walkthroughs"][0]["chart"].update(bad)
        probs = [p for p in cl.unit_problems(doc) if p.startswith("walkthrough w1:") and "chart" in p]
        assert any(words in p for p in probs), (bad, probs)
    assert not [p for p in cl.unit_problems(copy.deepcopy(DOC)) if p.startswith("walkthrough w1:") and "chart" in p]
