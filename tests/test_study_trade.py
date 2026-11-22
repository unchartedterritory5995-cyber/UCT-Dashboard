"""THE TRADE PLAN (api/services/study_trade.py): entry and stop come from the setup's own detector (its trigger and stop,
the shared make_levels floors the stop); 3R and 5R are marks on the ruler, never fixed sells (the owner's D-013,
2026-11-12, superseding B19's "a third at 3R" and E51's "a third at 5R": the first sell is a judgment, usually day 3 or
later); the stop to breakeven at 3R, inside his 2R-5R window; the trails name the 9 and 20 EMA (D-021); the Kicker on the
owner's rulings (a cent over the red day's high, the Kicker's low or 3.5% under the entry, the closer); no invented trade
for the Bear gap. Fake rules stand in for the detectors so each branch is reachable on a small chart."""
from __future__ import annotations

import re

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
    assert p["t1"] == pytest.approx(round(p["entry"] + 3 * risk, 2), abs=0.011)
    assert p["t2"] == pytest.approx(round(p["entry"] + 5 * risk, 2), abs=0.011)
    # 3R and 5R are marks on the ruler; no fraction rides on the plan any more (D-013), and the stop goes to breakeven at 3R
    assert p["trim_r"] == [3.0, 5.0] and "trim_fraction" not in p and p["breakeven_at"] == "t1"
    assert p["enters_intraday"] is True and "red day's high" in p["entry_note"]
    assert p["trail"] == "under each higher low, or under the 9 EMA"


def test_the_stop_is_3_5_pct_under_the_entry_when_the_kickers_low_is_further(rules):
    p = T.plan(T.KICKER, _bars(last={"t": "k", "o": 10.2, "h": 11.2, "l": 10.0, "c": 11.1, "v": 3000}))
    assert p["stop"] == round(10.71 * (1 - 0.035), 2)


def test_the_bear_gap_has_no_invented_trade(rules):
    """The app defines no Bear gap trade; the lesson measures the fall instead (VRNS: the gap day's high sat 25% over)."""
    assert T.plan(T.BEAR_GAP, _bars(last={"t": "g", "o": 9.0, "h": 9.4, "l": 8.6, "c": 8.8, "v": 5000})) is None


def test_no_plan_when_the_setup_does_not_fire_or_is_unknown(rules):
    assert T.plan("setup.family4.oops", _bars()) is None
    assert T.plan("setup.nope", _bars()) is None


def test_the_trails_name_the_9_and_20_ema_never_the_10_or_21_day():
    """D-021: "9 and 20 EMA everywhere". E52's 10-day and 21-day read as the 9 EMA and the 20 EMA, the lines the Study
    charts draw (studyChartLook). Every trail a member reads says so."""
    trails = [w["trail"] for w in T.PLANS.values() if w.get("trail")]
    assert trails
    for t in trails:
        assert not re.search(r"10-day|21-day|10 day|21 day", t), t
    assert "9 EMA" in T.PLANS["setup.family4.slingshot"]["trail"]
    assert "20 EMA" in T.PLANS["setup.family1.launchpad"]["trail"]


def test_the_replay_keys_holding_at_3r_and_never_a_fixed_third(rules):
    """N033 on the owner's D-013: at 3R the plan holds (3R is a mark; the stop may move up to breakeven) and the old
    "sell a third: 3R is a fixed trim" is a WRONG choice whose why teaches the change; at 5R the plan sells some into
    strength if it is day 3 or later and trails the rest in the plan's own words. No keyed answer sells a third, and the
    trail question exists only when the detector names a trail."""
    for skill, words in T.PLANS.items():
        checks = T.replay_checks(skill)
        c1 = checks[0]
        right = c1["choices"][c1["answer"]]
        assert c1["at"] == "t1" and right.startswith("Hold") and "breakeven" in right
        assert "third" not in right.lower() and "sell" not in right.lower()
        old = [c for c in c1["choices"] if "third" in c.lower()]
        assert len(old) == 1 and "fixed" in old[0] and c1["choices"].index(old[0]) != c1["answer"]
        assert "not our rule" in c1["why"] and "day 3 at the earliest" in c1["why"] and "2R to 5R" in c1["why"]
        # the client adds the day: a note for day 1 or 2, and one for day 3 on
        assert "too early" in c1["early"] and "day 3" in c1["later"]
        if words.get("trail"):
            c2 = checks[1]
            right2 = c2["choices"][c2["answer"]]
            assert c2["at"] == "t2" and words["trail"] in right2 and "day 3 or later" in right2 and right2.startswith("Sell some")
            assert not any("third" in c.lower() for c in c2["choices"])
            assert "5 to 10R" in c2["why"] and words["trail"] in c2["why"]
            assert c2["early"] and c2["later"]
            # no other setup's trail is offered as a wrong answer
            others = {w["trail"] for k, w in T.PLANS.items() if k != skill and w.get("trail")}
            assert not any(o in c for o in others for c in c2["choices"][1:])
        else:
            assert len(checks) == 1
        # the house voice: no dashes, never the firm
        for c in checks:
            for text in [c["q"], c["why"], c["early"], c["later"], *c["choices"]]:
                assert not re.search(r"[—–]|\bfirm\b", text), text
    assert T.replay_checks("setup.nope")[0]["at"] == "t1"
