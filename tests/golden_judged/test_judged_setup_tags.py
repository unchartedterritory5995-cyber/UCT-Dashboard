"""The judged gate for the member setup / event TAGS on the chart (docs/patterns/JUDGED_GATE.md, "Labels").

Recertification C (2026-10-24) judged the member tags blind, placement on a 0-3 textbook rubric, two judges per
pre-registered packet of 25: round 0 (8 packets) passed only Highest Volume in a Year and Outside Bar; round 1 (a
textbook check per tag on the bar it names, 7 packets) passed episodic pivot, NR7, flag / HTF, kicker, oops reversal
and slingshot; round 2 (4 packets) passed capitulation, flat-top breakout, go signal, launch pad and MA reclaim, and
failed gap support (2.14) and trendline break (2.40, one half 2.29), which members are no longer served. The checks
that passed are api/services/pattern_engine/tag_textbook.py at TAGS_ROUND 2.

fixtures_labels/setup_tags.json.gz, stored symbol-free like the chart fixtures (tests/golden_judged/encode.py: no
ticker, day offsets instead of dates, prices times a recorded per-case scale), holds the 320 daily bars
setup_tags.compute_tags saw on every judged case, and:

  * `expect` -- on each case BOTH judges scored 3 in the round its tag passed: that tag on that session must still
    be served to members (compute_tags, then member_tags);
  * `parity` -- every checked tag the member path detected on any judged case, with the LAB's keep verdict
    (recert lab tags_gate.keep_r2, which produced the judged packets): tag_textbook.keep must agree on every one.
"""
from __future__ import annotations

import json
import os

import pytest

from tests.golden_judged import member_path as MP

DOC = MP.load_family(os.path.join(MP.HERE, "fixtures_labels", "setup_tags.json.gz"))
CASES = DOC["cases"]
GOLDEN = [c for c in CASES if "expect" in c]


def served(case):
    """(setup, YYYYMMDD) of every tag a member is served on the fixture's bars."""
    from api.services import setup_tags as st
    st._CACHE.clear()
    return {(t["setup"], int(t["asof_date"].replace("-", "")))
            for t in st.member_tags(st.compute_tags("TEST", MP.decode_bars(case)))}


@pytest.mark.parametrize("case", GOLDEN, ids=[c["id"] for c in GOLDEN])
def test_a_judged_tag_is_still_served_to_members(case):
    want = (case["expect"]["setup"], MP.ymd(case, case["expect"]["day"]))
    got = served(case)
    assert want in got, f"{case['id']} (judge scores {case['judge_scores']}): judged {want}, members now get {got}"


def test_the_textbook_checks_agree_with_the_lab_on_every_judged_detection():
    from api.services.pattern_engine import tag_textbook as TT
    bad = []
    for case in CASES:
        bars = MP.decode_bars(case)
        for p in case["parity"]:
            got = TT.keep(p["setup"], bars, MP.ymd(case, p["day"]))
            if got != p["keep"]:
                bad.append((case["id"], p["setup"], p["day"], p["keep"], got))
    assert not bad, bad[:10]


def test_a_detection_the_lab_dropped_is_not_served_to_members():
    """The checks are WIRED into the member path: every member-set detection the lab's check refused is absent from
    what compute_tags + member_tags serve (the parity rail alone would stay green with the filter unwired)."""
    from api.services.pattern_engine.detectors import registry as reg
    leaked = []
    for case in CASES:
        drop = {(p["setup"], MP.ymd(case, p["day"])) for p in case["parity"]
                if not p["keep"] and p["setup"] in reg.SETUP_TAG_MEMBER_SET}
        if drop:
            leaked += [(case["id"], *x) for x in drop & served(case)]
    assert not leaked, leaked[:10]


def test_the_tags_are_served_at_the_round_the_judges_scored():
    """Moving the tag rules (or the member literal) off the judged round is a re-baseline: new fixtures from a NEW
    passed blind round, never an edit here."""
    from api.services import auto_structures as AS
    from api.services import setup_tags as st
    assert DOC["status"] == "released"
    assert getattr(AS, DOC["member_literal"]) == DOC["judged_round"] == st.TAGS_ROUND


def test_the_fixtures_cover_every_member_tag_and_both_verdicts():
    """Non-vacuity: every tag members are served has judged-3 cases, and the parity set holds kept AND dropped
    detections for every check."""
    from api.services.pattern_engine import tag_textbook as TT
    from api.services.pattern_engine.detectors import registry as reg
    per = {}
    for c in GOLDEN:
        per[c["expect"]["setup"]] = per.get(c["expect"]["setup"], 0) + 1
    assert set(per) == set(reg.SETUP_TAG_MEMBER_SET), sorted(set(reg.SETUP_TAG_MEMBER_SET) ^ set(per))
    assert len(GOLDEN) >= 100 and min(per.values()) >= 4, per
    par = [(p["setup"], p["keep"]) for c in CASES for p in c["parity"]]
    assert {s for s, _ in par} == set(TT.CHECKS)
    assert sum(k for _, k in par) >= 300 and sum(not k for _, k in par) >= 300
    for pid in set(TT.CHECKS) - {"nr7"}:     # every judged NR7 was a true NR7: there is no dropped one to hold
        assert (pid, True) in par and (pid, False) in par, pid


def test_the_two_failed_tags_are_withheld_from_members():
    from api.services import setup_tags as st
    from api.services.pattern_engine.detectors import registry as reg
    withheld = {"uct_gap_support", "uct_trendline_break"}
    assert withheld <= set(reg.SETUP_TAG_TEAM_SET) and not withheld & set(reg.SETUP_TAG_MEMBER_SET)
    tags = [{"setup": pid, "setup_name": "x", "setup_definition": "x.", "asof_date": "2026-10-22", "kind": "setup",
             "direction": "bullish", "tag_round": st.TAGS_ROUND} for pid in sorted(withheld)]
    assert st.member_tags(tags) == []


# ---------------------------------------------------------------------------- the gate can fail
def test_a_check_that_refuses_everything_turns_its_cases_red(monkeypatch):
    from api.services.pattern_engine import tag_textbook as TT
    case = next(c for c in GOLDEN if c["expect"]["setup"] == "uct_go_signal")
    want = ("uct_go_signal", MP.ymd(case, case["expect"]["day"]))
    assert want in served(case)
    monkeypatch.setitem(TT.CHECKS, "uct_go_signal", lambda s, i: False)
    assert want not in served(case)


def test_no_textbook_filter_breaks_the_parity_rail(monkeypatch):
    from api.services.pattern_engine import tag_textbook as TT
    monkeypatch.setattr(TT, "CHECKS", {})
    case = next(c for c in CASES if any(not p["keep"] for p in c["parity"]))
    p = next(p for p in case["parity"] if not p["keep"])
    assert TT.keep(p["setup"], MP.decode_bars(case), MP.ymd(case, p["day"])) is True


def test_a_checked_tag_needs_a_year_of_history_and_fails_closed_without_it(monkeypatch):
    """The lab refused any checked tag with under MIN_INDEX bars before it (the 200-day line and the 50-day volume
    need them); a young listing therefore shows no checked tag, never one judged on a short window."""
    from api.services.pattern_engine import tag_textbook as TT
    case = next(c for c in CASES if any(p["keep"] for p in c["parity"]))
    p = next(p for p in case["parity"] if p["keep"])
    bars, t = MP.decode_bars(case), MP.ymd(case, p["day"])
    assert TT.keep(p["setup"], bars, t) is True
    i = next(k for k, b in enumerate(bars) if b["t"] == t)
    monkeypatch.setitem(TT.CHECKS, p["setup"], lambda s, j: True)     # isolate the history floor from the check
    floor = 260                      # the lab's floor (tags_gate.keep_r2), the one the packets were judged under
    assert TT.MIN_INDEX == floor
    assert TT.keep(p["setup"], bars[i - floor:], t) is True
    assert TT.keep(p["setup"], bars[i - (floor - 1):], t) is False
    assert TT.keep(p["setup"], bars, 19000101) is False          # a session it cannot find: fail closed


def test_a_wrong_judged_day_is_caught():
    case = json.loads(json.dumps(GOLDEN[0]))
    case["expect"]["day"] -= 1
    while MP.ymd(case, case["expect"]["day"]) in {t for _, t in served(case)}:
        case["expect"]["day"] -= 1
    assert (case["expect"]["setup"], MP.ymd(case, case["expect"]["day"])) not in served(case)
