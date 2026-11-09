"""THE TRADE PLAN (api/services/study_trade.py): entry, stop and the 2R / 3R targets come from the setup's own detector
(its trigger and stop, the shared make_levels), the Kicker on the owner's rulings (a cent over the red day's high, the
Kicker's low or 3.5% under the entry, the closer); no invented trade for the Bear gap. Fake rules stand in for the
detectors so each branch is reachable on a small chart."""
from __future__ import annotations

import pytest

from api.services import study_hard as H
from api.services import study_trade as T


def _bars(n=40, last=None):
    out = [{"t": f"d{i}", "o": 10.0, "h": 10.3, "l": 9.8, "c": 10.1, "v": 1000} for i in range(n)]
    out[-2] = {"t": "red", "o": 10.6, "h": 10.7, "l": 10.0, "c": 10.05, "v": 1000}
    out[-1] = last or {"t": "k", "o": 10.2, "h": 11.2, "l": 10.5, "c": 11.1, "v": 3000}
    return out


@pytest.fixture()
def rules(monkeypatch):
    monkeypatch.setattr(T.U, "series", lambda bars: {})
    def kicker(bars, S, i):
        b, p = bars[i], bars[i - 1]
        return {"trigger": p["h"] if b["o"] <= p["h"] else b["o"], "stop": b["l"], "prior_high": p["h"]} if i == len(bars) - 1 else None
    def bear(bars, S, i):
        return {"gap": True} if i == len(bars) - 1 else None
    monkeypatch.setattr(H, "SETUP_RULES", {T.KICKER: (kicker,), T.BEAR_GAP: (bear,), "setup.family4.oops": (lambda *a: None,)})


def test_the_kicker_enters_a_cent_over_the_red_days_high_and_stops_at_the_closer_of_its_low_and_3_5_pct(rules):
    p = T.plan(T.KICKER, _bars())
    assert p["entry"] == 10.71                       # the red day's high 10.70, a cent over
    assert p["stop"] == 10.5                         # the Kicker's low, closer than 3.5% under the entry (10.34)
    assert p["direction"] == "bullish"
    risk = p["entry"] - p["stop"]
    assert p["t1"] == pytest.approx(round(p["entry"] + 2 * risk, 2), abs=0.011)
    assert p["t2"] == pytest.approx(round(p["entry"] + 3 * risk, 2), abs=0.011)
    assert p["enters_intraday"] is True and "red day's high" in p["entry_note"]


def test_the_stop_is_3_5_pct_under_the_entry_when_the_kickers_low_is_further(rules):
    p = T.plan(T.KICKER, _bars(last={"t": "k", "o": 10.2, "h": 11.2, "l": 10.0, "c": 11.1, "v": 3000}))
    assert p["stop"] == round(10.71 * (1 - 0.035), 2)


def test_the_bear_gap_has_no_invented_trade(rules):
    """The app defines no Bear gap trade; the lesson measures the fall instead (VRNS: the gap day's high sat 25% over)."""
    assert T.plan(T.BEAR_GAP, _bars(last={"t": "g", "o": 9.0, "h": 9.4, "l": 8.6, "c": 8.8, "v": 5000})) is None


def test_no_plan_when_the_setup_does_not_fire_or_is_unknown(rules):
    assert T.plan("setup.family4.oops", _bars()) is None
    assert T.plan("setup.nope", _bars()) is None


def test_the_replay_asks_only_what_the_plan_says(rules):
    """N033: the replay stops at 2R and 3R; the answers are the plan's own words (TRADE_PLANS.md: the course names the
    levels and does not invent a fraction), and the trail question exists only when the detector names a trail."""
    for skill, words in T.PLANS.items():
        checks = T.replay_checks(skill)
        assert checks[0]["at"] == "t1" and checks[0]["answer"] == 0 and "2R" in checks[0]["choices"][0]
        assert not any(ch.isdigit() and ch not in "23" for ch in "".join(checks[0]["choices"]))   # no invented fraction
        if words.get("trail"):
            assert checks[1]["at"] == "t2" and words["trail"] in checks[1]["choices"][checks[1]["answer"]]
            # no other setup's trail is offered as a wrong answer
            others = {w["trail"] for k, w in T.PLANS.items() if k != skill and w.get("trail")}
            assert not any(o in c for o in others for c in checks[1]["choices"][1:])
        else:
            assert len(checks) == 1
    assert T.replay_checks("setup.nope")[0]["at"] == "t1"
