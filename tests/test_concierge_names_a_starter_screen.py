"""A shipped starter screen's own name, said on its own, is NAMED by the concierge (`plan`).

2026-11-15: the 2026-09-20 screener rebuild renamed the firm's starters and five of the new names
anchored nothing, so a member typing the firm's own screen name reached the model as bare English.
"""
from __future__ import annotations

from api.services import definition_concierge as dc
from api.services.screener import saved_screens


def _blind(got):
    return not (got["concepts"] or got["terms"] or got["not_understood"] or got["unavailable"])


def test_a_starter_name_that_anchored_nothing_is_named_as_that_screen():
    for name, sid in (("Three weeks tight", "starter_three_weeks_tight"),
                      ("Pocket pivots", "starter_base_pocket_pivot")):
        got = dc.plan(name, "scan")
        assert [u["name"] for u in got["unavailable"]] == [f"starter_screen:{sid}"], got
        assert name in got["unavailable"][0]["reason"]


def test_the_match_is_on_the_whole_name_and_ignores_case_and_punctuation():
    assert dc.plan("three-weeks TIGHT", "scan")["unavailable"][0]["name"] \
        == "starter_screen:starter_three_weeks_tight"
    # inside a longer request the words are ordinary English, not a screen name
    assert not any(u["name"].startswith("starter_screen:")
                   for u in dc.plan("show me three weeks tight bases on high volume", "scan")["unavailable"])
    # ...including one that anchors nothing else, where only the whole-name rule stands between
    # the words and a wrong screen
    got = dc.plan("i really like pocket pivots", "scan")
    assert _blind(got), got


def test_a_request_that_already_anchored_keeps_exactly_its_outcome(monkeypatch):
    """The rule only fills silence: a starter name the door already understood is untouched."""
    calls = []
    real = dc._starter_named
    monkeypatch.setattr(dc, "_starter_named", lambda t: calls.append(t) or real(t))
    got = dc.plan("Gap Movers", "scan")
    assert not _blind(got) and calls == []
    assert not any(u["name"].startswith("starter_screen:") for u in got["unavailable"])


def test_prose_that_names_no_screen_stays_blind():
    assert _blind(dc.plan("please make me some money", "scan"))


def test_every_shipped_starter_name_anchors_something():
    blind = [s["name"] for s in saved_screens.starters() if _blind(dc.plan(s["name"], "scan"))]
    assert blind == []
