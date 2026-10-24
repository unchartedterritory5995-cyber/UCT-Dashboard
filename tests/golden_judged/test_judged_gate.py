"""The judged regression gate: no code change may silently make a member-visible drawing worse than what blind
judges approved. docs/patterns/JUDGED_GATE.md says what it guards and how it is re-baselined.

Every fixture in tests/golden_judged/fixtures/ is a chart a blind judge scored 3 on a drawing round that passed
its pre-registered packets and is released to members. The chart's bars are stored symbol-free (no ticker, day
offsets instead of dates, prices scaled by a recorded per-case factor). Each case is run through the CURRENT
member route (tests/golden_judged/member_path.py) and must still (1) draw, (2) draw the judged geometry within
tolerance and (3) draw no other member drawing on the same base (tests/golden_judged/judged.py).
"""
from __future__ import annotations

import gzip
import json
import os
import re

import pytest

from tests.golden_judged import judged as JG
from tests.golden_judged import member_path as MP

FAMILIES = MP.families()
RELEASED = [(f["family"], c) for f in FAMILIES if f["status"] == "released" for c in f["cases"]
            if "retired" not in c]
#: Judged cases a NEWER passed blind round retired (each carries `retired`: the rule and the round): the judged
#: drawing must now be ABSENT from the member chart, and the rule must still hold there (judged.retired_failures).
RETIRED = [(f["family"], c) for f in FAMILIES if f["status"] == "released" for c in f["cases"] if "retired" in c]
PENDING = [f for f in FAMILIES if f["status"] == "pending_port"]
#: Families WITHDRAWN from members after a recertification failed them (member literal None, admins keep the layer).
#: Their judged cases are still replayed, with the member literal set back to the judged round, so the code stays
#: guarded for the day a new passed round re-releases it; and the literal itself must stay None.
WITHDRAWN_FAMS = [f for f in FAMILIES if f["status"] == "withdrawn"]
#: Families SUPERSEDED by a newer passed round of the same drawing (the member literal moved on to that round). Their
#: judged cases are replayed exactly like a withdrawn family's -- the literal set back to the judged round -- because
#: setting it back is the rollback lever; only the "literal is None" assertion does not apply to them.
SUPERSEDED_FAMS = [f for f in FAMILIES if f["status"] == "superseded"]
REPLAYED_FAMS = WITHDRAWN_FAMS + SUPERSEDED_FAMS
WITHDRAWN = [(f["family"], c) for f in REPLAYED_FAMS for c in f["cases"] if "retired" not in c]

#: Judged cases the CURRENT master does not reproduce, each a finding with its measured cause. Kept RED-visible as
#: strict xfails: the gate still fails the moment any OTHER case regresses, and fails here too once one of these is
#: fixed (strict), so the entry has to be deleted rather than left to rot. Never add a case here to make a change
#: pass: a new red is a regression or a re-baseline (docs/patterns/JUDGED_GATE.md), not an exception.
KNOWN_RED: dict = {}
_PRECEDENCE = ("judged drawing never served on this chart: a member drawing that outranks it on the same base "
               "(member_base_precedence / member_inside_day_precedence / one-line-per-base) takes its place; "
               "already so at the drawing's release commit")
# base-a-011 and base-b-013 left KNOWN_RED 2026-10-24: the drawing that outranked them was a flat base, and every
# flat base was withheld from members that day (recert A; MEMBER_FLAT_BASE_ROUND / MEMBER_BC_FLAT_BASE_ROUND None).
for _cid in ("base-a-016", "base-a-018", "base-a-020", "base-a-025", "base-b-010",
             "inside-day-a2-004", "textbook-g1-01", "textbook-g1-12"):
    KNOWN_RED[_cid] = _PRECEDENCE
# inside-day-b2-012 left KNOWN_RED 2026-10-24: the member drawing that outranked it was the round-9 confirmed
# bull_flag, and every bull flag was withheld from members that day (recert E; MEMBER_BULL_FLAG_ROUND = None).
for _cid in ("double-bottom-a-001", "double-bottom-b-018"):
    KNOWN_RED[_cid] = ("judged double bottom never served: withheld on the member chart (the release's stale-"
                       "breakout condition, auto_structures._db_breakout_stale); already so at the release commit")
# Seven cases left KNOWN_RED 2026-10-24 (cup-d1-015, textbook-g1-10, textbook-r2b-07/-09/-16, inside-day-b2-025,
# shelf-b-020): the member drawing that sat on (or outranked) the judged one was a "flagging"-tier bull_flag. The
# flagging tier was withheld from members that day (blind textbook score 1.28), so they reproduce now.
# textbook-r2b-19 and -20 left KNOWN_RED 2026-10-24 (recert C): the second member drawing on their judged base was
# the MA pullback v5, withheld from members that day (MEMBER_PULLBACK_MA_V5_ROUND = None), so they reproduce now.
for _cid in ("double-bottom-a-010", "inside-day-b2-018"):
    KNOWN_RED[_cid] = ("a second member drawing (bull_flag / uct_pullback_ma_v5) is drawn on the judged base, "
                       "within 1 ATR of the judged line; the judges saw the drawing alone")
# 72 setup-line cases left KNOWN_RED 2026-10-24 (descending-triangle 21, bollinger-squeeze 16, rectangle 14,
# bear-flag 13, inverse-head-shoulders 8): their rounds sampled on the recert rule (close > $5 and a 20-day average
# dollar volume >= $5M), and the member frame was a one-day $20M floor. Each family is now served on the frame it was
# certified on (auto_structures.SETUP_FRAME_BY_ID), so they reproduce.


def _ids(items):
    return [c["id"] for _f, c in items]


@pytest.mark.parametrize("family,case", RELEASED, ids=_ids(RELEASED))
def test_a_judged_drawing_is_still_drawn_as_the_judges_saw_it(family, case, monkeypatch, request):
    if case["id"] in KNOWN_RED:
        request.applymarker(pytest.mark.xfail(strict=True, reason=KNOWN_RED[case["id"]]))
    payload, bars = MP.member_payload(monkeypatch, case)
    bad = JG.failures(case, payload, bars)
    assert not bad, f"{case['id']} (judge scores {case['judge_scores']}):\n  " + "\n  ".join(bad)


@pytest.mark.parametrize("family,case", WITHDRAWN, ids=_ids(WITHDRAWN))
def test_a_withdrawn_drawing_still_draws_as_judged_when_its_round_is_set(family, case, monkeypatch, request):
    if case["id"] in KNOWN_RED:
        request.applymarker(pytest.mark.xfail(strict=True, reason=KNOWN_RED[case["id"]]))
    from api.services import auto_structures as AS
    fam = next(f for f in REPLAYED_FAMS if f["family"] == family and case in f["cases"])
    monkeypatch.setattr(AS, fam["member_literal"], fam["judged_round"])
    payload, bars = MP.member_payload(monkeypatch, case)
    bad = JG.failures(case, payload, bars)
    assert not bad, f"{case['id']} (judge scores {case['judge_scores']}):\n  " + "\n  ".join(bad)


def test_a_withdrawn_drawing_is_not_served_to_members(monkeypatch):
    """A withdrawn family's member literal stays None (re-release = a new passed blind round), and with it None the
    member chart carries none of that layer even though the same chart draws it when the round is set."""
    from api.services import auto_structures as AS
    assert WITHDRAWN_FAMS, "no withdrawn family: delete this test with the last one"
    for f in WITHDRAWN_FAMS:
        assert getattr(AS, f["member_literal"]) is None, (f["family"], getattr(AS, f["member_literal"]))
    # the door is real: a withdrawn case that draws as judged with its round set is red with the literal None
    for f in WITHDRAWN_FAMS:
        for c in f["cases"]:
            if "retired" in c or c["id"] in KNOWN_RED:
                continue
            monkeypatch.setattr(AS, f["member_literal"], f["judged_round"])
            payload, bars = MP.member_payload(monkeypatch, c)
            if JG.failures(c, payload, bars):
                continue
            monkeypatch.setattr(AS, f["member_literal"], None)
            payload, bars = MP.member_payload(monkeypatch, c)
            assert JG.failures(c, payload, bars), (f["family"], c["id"])
            return
    raise AssertionError("no withdrawn case draws as judged with its round set: the control cannot run")


def _cups(payload):
    return [r for r in payload.get("structures", []) if r["pattern_id"] == "bc:cup-with-handle"]


def test_the_withdrawn_cup_is_not_served_to_members_and_comes_back_with_its_round(monkeypatch):
    """Owner decision 4 (2026-10-24): the cup is withdrawn from members (strict blind 1.98 on n = 20 is not
    certifiable). With MEMBER_CUP_TIER_ROUND None a judged cup chart serves the member no cup; the re-enable control
    (the literal back to the judged round, which is what a passed n >= 60 packet would ship) serves it again."""
    from api.services import auto_structures as AS
    fam = next(f for f in WITHDRAWN_FAMS if f["family"] == "cup")
    assert fam["member_literal"] == "MEMBER_CUP_TIER_ROUND" and AS.MEMBER_CUP_TIER_ROUND is None
    case = next(c for c in fam["cases"] if c["id"] == "cup-d1-001")
    payload, _bars = MP.member_payload(monkeypatch, case)
    assert not _cups(payload)
    monkeypatch.setattr(AS, "MEMBER_CUP_TIER_ROUND", fam["judged_round"])     # re-enable control
    payload, _bars = MP.member_payload(monkeypatch, case)
    assert _cups(payload)


def _darvas(payload):
    return [r for r in payload.get("setup_draws") or [] if r.get("pattern_id") == "draw:darvas-box"]


def test_the_withdrawn_darvas_box_is_not_served_to_members_and_comes_back_with_its_round(monkeypatch):
    """Outcome replay 2026-10-24: win8 lift -5.1pp [-6.7,-3.4] vs matched breakout (NEGATIVE), so the darvas box is
    withdrawn from members. With MEMBER_DARVAS_BOX_ROUND None a judged darvas chart serves the member no darvas box;
    the re-enable control (the literal back to the judged round) serves it again."""
    from api.services import auto_structures as AS
    fam = next(f for f in WITHDRAWN_FAMS if f["family"] == "darvas_box")
    assert fam["member_literal"] == "MEMBER_DARVAS_BOX_ROUND" and AS.MEMBER_DARVAS_BOX_ROUND is None
    for case in fam["cases"]:
        monkeypatch.setattr(AS, "MEMBER_DARVAS_BOX_ROUND", fam["judged_round"])     # re-enable control
        payload, bars = MP.member_payload(monkeypatch, case)
        if not _darvas(payload) or JG.failures(case, payload, bars):
            continue
        monkeypatch.setattr(AS, "MEMBER_DARVAS_BOX_ROUND", None)
        payload, _bars = MP.member_payload(monkeypatch, case)
        assert not _darvas(payload), case["id"]
        return
    raise AssertionError("no darvas case draws with the round set: the control cannot run")


@pytest.mark.parametrize("family,case", RETIRED, ids=_ids(RETIRED))
def test_a_retired_judged_drawing_stays_off_the_member_chart(family, case, monkeypatch):
    payload, bars = MP.member_payload(monkeypatch, case)
    bad = JG.retired_failures(case, payload, bars)
    assert not bad, f"{case['id']} (retired: {case['retired']['rule']}):\n  " + "\n  ".join(bad)


# ---------------------------------------------------------------------------- the gate can fail
def _first_green(fam, monkeypatch, need=lambda c: True):
    """The first case of `fam` the current code reproduces (a control needs a chart that starts green). A withdrawn
    family is replayed with its member literal set to the judged round."""
    from api.services import auto_structures as AS
    for wf in WITHDRAWN_FAMS:
        if wf["family"] == fam:
            monkeypatch.setattr(AS, wf["member_literal"], wf["judged_round"])
    for wf in SUPERSEDED_FAMS:
        if wf["family"] == fam and not any(r["family"] == fam and r["status"] == "released" for r in FAMILIES):
            monkeypatch.setattr(AS, wf["member_literal"], wf["judged_round"])
    for f, c in RELEASED + WITHDRAWN:
        if f == fam and c["id"] not in KNOWN_RED and need(c):
            payload, bars = MP.member_payload(monkeypatch, c)
            if JG.failures(c, payload, bars) == []:
                return json.loads(json.dumps(c)), payload, bars
    raise AssertionError(f"no green {fam} case to run the control on")


@pytest.mark.parametrize("fam,key", [("base", "pivot"), ("double_bottom", "low"), ("shelf", "price"),
                                     ("cup", "handle_top"), ("inside_day", "stop"), ("textbook", "buy_point"),
                                     ("remount", "level"), ("u_and_r", "level")])
def test_a_judged_price_moved_by_one_ATR_is_caught(fam, key, monkeypatch):
    """Control: the comparator is not vacuous -- the same chart against a judged price one ATR away is red."""
    case, payload, bars = _first_green(fam, monkeypatch)
    case["expect"][key] = float(case["expect"][key]) + MP.atr14(bars) * float(case["bars"]["scale"])
    assert any(key.split("_")[-1] in m or "price" in m for m in JG.failures(case, payload, bars))


@pytest.mark.parametrize("fam", sorted(JG.SETUP_LINE_FAMILIES))
def test_a_judged_setup_anchor_moved_by_one_ATR_is_caught(fam, monkeypatch):
    """Control for the setup lens: the same chart against a judged anchor one ATR away is red (every setup-line
    family), and so is the judged row moved off `setup_draws` onto another key, or removed."""
    case, payload, bars = _first_green(fam, monkeypatch)
    moved = json.loads(json.dumps(case))
    det = moved["expect"]["dets"][-1]
    det["anchors"][-1]["price"] = float(det["anchors"][-1]["price"]) + MP.atr14(bars) * float(case["bars"]["scale"])
    assert any("price" in m for m in JG.failures(moved, payload, bars)), fam
    pid = JG.SETUP_LINE_FAMILIES[fam]
    mine = [r for r in payload["setup_draws"] if r["pattern_id"] == pid]
    rest = [r for r in payload["setup_draws"] if r["pattern_id"] != pid]
    elsewhere = {**payload, "setup_draws": rest, "structures": list(payload.get("structures") or []) + mine}
    assert any(m.startswith("(1)") for m in JG.failures(case, elsewhere, bars)), fam
    gone = {k: v for k, v in payload.items() if k != "setup_draws"}
    assert any(m.startswith("(1)") and "ABSENT" in m for m in JG.failures(case, gone, bars)), fam


def test_a_rectangle_sharing_its_top_with_a_higher_priority_line_is_caught(monkeypatch):
    """Control for (3) on the rectangle (the one setup-line drawing the one-line-per-base pass settles): a drawn line
    ranked ahead of it within 1 ATR of the box top over the box span is red, two ATR away it is not; and the
    one_line_per_base retire rule reads the same distance over the box's own span."""
    case, payload, bars = _first_green("rectangle", monkeypatch)
    top, atr = JG._want_key("rectangle", case), MP.atr14(bars)
    s0, s1 = MP.ymd(case, case["expect"]["dets"][0]["start"]), MP.ymd(case, case["expect"]["dets"][0]["end"])

    def ceiling(p):
        return {"pattern_id": "uct_flat_top_breakout", "start_t": s0, "end_t": s1,
                "geometry": {"extras": {"draw_flat_top": {"price": p, "start_t": s0, "end_t": s1}}}}
    near = {**payload, "detections": list(payload.get("detections") or []) + [ceiling(top + 0.5 * atr)]}
    far = {**payload, "detections": list(payload.get("detections") or []) + [ceiling(top + 2.0 * atr)]}
    assert any(m.startswith("(3)") for m in JG.failures(case, near, bars))
    assert not any(m.startswith("(3)") for m in JG.failures(case, far, bars))
    assert JG.RETIRE_RULES["one_line_per_base"](case, near, bars)
    assert not JG.RETIRE_RULES["one_line_per_base"](case, far, bars)


def test_an_SR_zone_moved_by_one_ATR_is_caught(monkeypatch):
    case, payload, bars = _first_green("sr", monkeypatch, need=lambda c: bool(c["expect"]["zones"]))
    shift = MP.atr14(bars) * float(case["bars"]["scale"])
    case["expect"]["zones"][0]["bot"] += shift
    case["expect"]["zones"][0]["top"] += shift
    assert any("not on the chart" in m for m in JG.failures(case, payload, bars))


def test_a_missing_drawing_and_an_extra_drawing_on_the_base_are_caught(monkeypatch):
    case, payload, bars = _first_green("base", monkeypatch)
    mine = next(r for r in payload["structures"] if r["pattern_id"] == "bc:base")
    gone = {**payload, "structures": [r for r in payload["structures"] if r is not mine]}
    assert any(m.startswith("(1)") for m in JG.failures(case, gone, bars))
    extra = json.loads(json.dumps(mine))
    extra["pattern_id"] = "bc:flat-base"
    extra["geometry"]["extras"] = {"draw_pivot": {"price": mine["geometry"]["extras"]["draw_base"]["pivot"],
                                                  "start_t": mine["geometry"]["extras"]["draw_base"]["start_t"],
                                                  "end_t": mine["geometry"]["extras"]["draw_base"]["end_t"]}}
    dup = {**payload, "structures": list(payload["structures"]) + [extra]}
    assert any("same base" in m for m in JG.failures(case, dup, bars))


def test_an_extra_base_drawing_is_judged_by_the_line_members_see(monkeypatch):
    """Control for the (3) lens on a bc:base row: it reads the DRAWN top line (metrics_textbook.line), not the body
    pivot. A base whose drawn line sits on the judged line is red even with its body pivot 3 ATR away; the same base
    without the textbook line (drawn at the far body pivot) is not."""
    case, payload, bars = _first_green("donchian_breakout", monkeypatch)
    key = JG._want_key("donchian_breakout", case)
    atr = MP.atr14(bars)
    s0, s1 = int(bars[0]["t"]), int(bars[-1]["t"])
    base = {"id": "extra-base", "pattern_id": "bc:base", "start_t": s0, "end_t": s1,
            "geometry": {"shape": "base_draw", "anchors": [], "extras": {
                "draw_base": {"pivot": key + 3 * atr, "low": key * 0.7, "start_t": s0, "end_t": s1, "atr": atr},
                "metrics_textbook": {"line": key, "buy_point": round(key + 0.10, 2)}}}}
    drawn_on = {**payload, "structures": list(payload.get("structures") or []) + [base]}
    assert any("same base" in m for m in JG.failures(case, drawn_on, bars))
    body_only = json.loads(json.dumps(base))
    del body_only["geometry"]["extras"]["metrics_textbook"]
    far = {**payload, "structures": list(payload.get("structures") or []) + [body_only]}
    assert not any("same base" in m for m in JG.failures(case, far, bars))


def test_a_donchian_line_retired_by_one_line_per_base_is_held_to_its_rule(monkeypatch):
    """Control for the one_line_per_base retirement (precedence round e): on each retired donchian chart the line
    stays off AND a drawn base-family line still sits within 1 ATR. Putting the channel line back is red; taking the
    base line away is red (its absence would then be unexplained). The donchian is withdrawn (recert B), so the
    control re-arms its member literal at the judged round: with it None the line would be absent trivially."""
    from api.services import auto_structures as AS
    fam = next(f for f in FAMILIES if f["family"] == "donchian_breakout")
    monkeypatch.setattr(AS, fam["member_literal"], fam["judged_round"])
    cases = [c for c in fam["cases"] if "retired" in c]
    assert cases and all(c["retired"]["rule"] == "one_line_per_base" for c in cases)
    case = cases[0]
    payload, bars = MP.member_payload(monkeypatch, case)
    assert JG.retired_failures(case, payload, bars) == []
    lvl = JG._want_key("donchian_breakout", case)
    back = {"pattern_id": "draw:donchian_breakout", "start_t": int(bars[-30]["t"]), "end_t": int(bars[-1]["t"]),
            "geometry": {"shape": "horizontal_line", "anchors": [{"t": int(bars[-30]["t"]), "price": lvl},
                                                                 {"t": int(bars[-1]["t"]), "price": lvl}],
                         "extras": {"draw_round": 1, "draw_setup": {"level": lvl}}},
            "levels": {"entry": lvl}}
    again = {**payload, "setup_draws": list(payload.get("setup_draws") or []) + [back]}
    assert any("back on the member chart" in m for m in JG.retired_failures(case, again, bars))
    ahead = set(AS.ONE_LINE_PER_BASE_PRIORITY[:AS.ONE_LINE_PER_BASE_PRIORITY.index("draw:donchian_breakout")])
    bare = {k: ([r for r in v if r.get("pattern_id") not in ahead] if isinstance(v, list) else v)
            for k, v in payload.items()}
    assert any("no longer applies" in m for m in JG.retired_failures(case, bare, bars))
    # the rule's distance is the 1-ATR one-line test: a drawn ceiling half an ATR off holds it, two ATR off does not
    atr = MP.atr14(bars)
    s0, s1 = int(bars[-40]["t"]), int(bars[-1]["t"])

    def ceiling(p):
        return {"detections": [{"pattern_id": "uct_flat_top_breakout", "start_t": s0, "end_t": s1, "geometry": {
            "extras": {"draw_flat_top": {"price": p, "start_t": s0, "end_t": s1}}}}]}
    assert JG.RETIRE_RULES["one_line_per_base"](case, ceiling(lvl + 0.5 * atr), bars)
    assert not JG.RETIRE_RULES["one_line_per_base"](case, ceiling(lvl + 2.0 * atr), bars)


def test_a_retired_drawing_coming_back_is_caught(monkeypatch):
    """Control: the absence check is not vacuous -- the retired case's own judged drawing, put back on its chart, is
    red, and a chart where the retiring rule no longer holds is red."""
    fam, case = next((f, c) for f, c in RETIRED if f == "double_bottom" and c["retired"]["rule"] == "trend_gate")
    payload, bars = MP.member_payload(monkeypatch, case)
    assert JG.retired_failures(case, payload, bars) == []
    p = JG._unscale(case, case["expect"]["pivot"])
    s0 = int(bars[-int(case["expect"]["len"])]["t"])
    back = {"pattern_id": "draw:double-bottom", "start_t": s0, "end_t": int(bars[-1]["t"]),
            "geometry": {"extras": {"draw_shape": {"pivot": p, "start_t": s0, "end_t": int(bars[-1]["t"])}}}}
    again = {**payload, "structures": list(payload.get("structures") or []) + [back]}
    assert any("back on the member chart" in m for m in JG.retired_failures(case, again, bars))
    up = [dict(b) for b in bars]
    up[-1]["c"] = max(b["c"] for b in bars) * 10   # the as-of close far above any 200-day average...
    for j in range(len(up) - 40, len(up) - 1):     # ...and that average rising
        up[j]["c"] = up[j]["c"] * 3
    assert any("no longer applies" in m for m in JG.retired_failures(case, payload, up))


def test_a_pivot_textbook_retirement_is_held_to_the_gate(monkeypatch):
    """Control for the interim pivot gate's retire rule: a shelf / double bottom retired under textbook_gate is green
    while the gate still fails its ungated row, and red the moment the gate would pass it (the absence is then
    unexplained) -- and the replay that explains it really runs the member route with the gate off."""
    from api.services.pattern_engine import textbook_gate as TG
    for fam in ("double_bottom",):        # the shelf is withdrawn (recert B); its retired cases are kept as written
        case = next(c for f, c in RETIRED if f == fam and c["retired"]["rule"] == "textbook_gate")
        payload, bars = MP.member_payload(monkeypatch, case)
        assert JG.retired_failures(case, payload, bars) == [], case["id"]
        with monkeypatch.context() as m:
            m.setattr(TG, "pivot_fails", lambda b, r: [])
            assert any("no longer applies" in x for x in JG.retired_failures(case, payload, bars)), case["id"]


def test_a_textbook_line_off_the_buy_point_is_caught(monkeypatch):
    """Control: round 2's line check -- a drawn line that is not buy point - $0.10 is red."""
    case, payload, bars = _first_green("textbook", monkeypatch, need=lambda c: "line" in c["expect"])
    bp = JG._unscale(case, case["expect"]["buy_point"])
    rows = [r for r in payload["structures"] if isinstance(JG._ex(r).get("metrics_textbook"), dict)]
    mine = min(rows, key=lambda r: abs(float(JG._ex(r)["metrics_textbook"]["buy_point"]) - bp))
    moved = json.loads(json.dumps(payload))
    for r in moved["structures"]:
        if r.get("id") == mine.get("id"):
            r["geometry"]["extras"]["metrics_textbook"]["line"] = round(bp - 0.05, 2)
    assert any("not buy point" in m for m in JG.failures(case, moved, bars))


def test_the_replay_reaches_every_layer():
    """Non-vacuity: the fixtures exercise every released family, and the replayed route serves rows at all."""
    fams = {f for f, _c in RELEASED}
    every = fams | {f["family"] for f in REPLAYED_FAMS}    # a withdrawn or superseded family still replays
    assert {"base", "double_bottom", "inside_day"} <= fams, fams
    # shelf and donchian: withdrawn 2026-10-24 when their recert B textbook fix round failed
    # textbook: withdrawn 2026-10-24 with the stateless base its numbers print on (recert A); sr: withdrawn at r2 and
    # re-released at r7 the same day (recert D)
    # cup: withdrawn 2026-10-24 (owner decision 4: strict blind 1.98 on n = 20; re-ships on an n >= 60 packet)
    assert {"sr", "remount", "u_and_r", "textbook", "shelf", "donchian_breakout", "cup",
            "darvas_box"} <= every, every
    assert "sr" in fams, "sr is released at r7"
    assert any("line" in c["expect"] for f, c in RELEASED + WITHDRAWN if f == "textbook"), "no textbook round-2 line case"
    # every setup-line family is a fixture (released, or withdrawn and replayed with its round set: the darvas box,
    # withdrawn 2026-10-24 on its NEGATIVE outcome verdict), and each one reproduces at least one judged case today
    assert set(JG.SETUP_LINE_FAMILIES) <= every, set(JG.SETUP_LINE_FAMILIES) - every
    for fam in JG.SETUP_LINE_FAMILIES:
        assert any(f == fam and c["id"] not in KNOWN_RED for f, c in RELEASED + WITHDRAWN), f"every {fam} case is KNOWN_RED"


# ---------------------------------------------------------------------------- the baseline is the judged round
def test_each_released_family_is_still_served_at_the_round_the_judges_scored():
    """A member literal moving off the judged round is a re-baseline: it ships only with fixtures from a NEW passed
    blind round of that drawing (docs/patterns/JUDGED_GATE.md), never by editing this file."""
    from api.services import auto_structures as AS
    for f in FAMILIES:
        if f["status"] != "released":
            continue
        got = getattr(AS, f["member_literal"])
        assert got == f["judged_round"], (f["family"], f["member_literal"], got, f["judged_round"])


def test_a_superseded_family_is_one_a_released_family_replaced():
    """A superseded fixture is the judged round a NEWER passed round of the same drawing replaced: its member literal
    has moved off the judged round, onto the round a released fixture of the same literal records."""
    from api.services import auto_structures as AS
    for f in SUPERSEDED_FAMS:
        got = getattr(AS, f["member_literal"])
        assert got != f["judged_round"], (f["family"], got)
        assert any(r["status"] == "released" and r["member_literal"] == f["member_literal"] and r["judged_round"] == got
                   for r in FAMILIES), (f["family"], f["member_literal"], got)


def test_a_pending_drawing_is_still_not_released_to_members():
    """Passed-but-unreleased drawings are carried as fixtures so the gate covers them the day they ship. Once a
    pending family's member literal is set, flip its fixture file's status to "released" so the gate checks it."""
    from api.services import auto_structures as AS
    for f in PENDING:
        got = getattr(AS, f["member_literal"], None)
        assert got is None, (f"{f['family']} is released to members ({f['member_literal']} = {got!r}): set its "
                             f"fixture status to released so the gate checks it")


# ---------------------------------------------------------------------------- public-repo hygiene
_FORBIDDEN_KEYS = {"ticker", "sym", "symbol", "ts", "date", "trader", "author", "user", "path"}


def _walk_keys(o, out):
    if isinstance(o, dict):
        for k, v in o.items():
            out.add(k)
            _walk_keys(v, out)
    elif isinstance(o, list):
        for v in o:
            _walk_keys(v, out)


def test_the_fixtures_are_symbol_free_and_small():
    total = 0
    for name in sorted(os.listdir(MP.FIXTURES)):
        p = os.path.join(MP.FIXTURES, name)
        raw = open(p, "rb").read()
        total += len(raw)   # bytes on disk: a .json.gz fixture counts compressed, and is scanned decompressed
        text = (gzip.decompress(raw) if name.endswith(".gz") else raw).decode("utf-8")
        assert not re.search(r"[A-Za-z]:[\\/]|Desktop|lab[\\/]|\.png|\.db\b", text), name
        doc = json.loads(text)
        keys: set = set()
        _walk_keys(doc, keys)
        assert not keys & _FORBIDDEN_KEYS, (name, keys & _FORBIDDEN_KEYS)
        for c in doc["cases"]:
            # dates exist only as day offsets: the bars carry a step string, the judged geometry small ints, so no
            # value outside the bars may look like a real YYYYMMDD
            assert set(c["bars"]) == {"scale", "q", "dp", "wd0", "vu", "d", "c", "o", "h", "l", "v"}, c["id"]
            assert set(c["bars"]["d"]) <= set("0123456789()"), (name, c["id"])
            meta = json.dumps({k: v for k, v in c.items() if k != "bars"})
            assert not re.search(r"\b(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b", meta), (name, c["id"])
    assert total < 5_000_000, total


def test_decoding_then_re_encoding_a_fixture_gives_it_back_exactly():
    """The encoding is exact: the replay sees the judged chart's source prices, not a perturbed copy (several
    drawings choose among near-tied candidates; a one-tick perturbation once flipped two cases)."""
    from tests.golden_judged import encode as EN
    for _f, c in RELEASED[::5]:
        d = MP.decode_bars(c)
        rows = [(b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in d]
        again = EN.encode_bars(rows, c["bars"]["scale"])
        for k in ("c", "o", "h", "l", "v", "dp", "q", "d"):
            assert again[k] == c["bars"][k], (c["id"], k)


def test_a_stale_cup_box_is_served_only_when_the_cup_tier_draws_it(monkeypatch):
    """lab cup_served: a cup box the team display rounds mark stale is served (in the tier's form) only when the
    round-4 cup tier DRAWS it. The same judged chart with the tier's stamp withheld, or with no stamp, serves no cup."""
    from api.services import auto_structures as AS
    from api.services.pattern_engine import cup_tier
    # the cup is withdrawn from members (owner decision 4): replayed with its member literal at the judged round
    fam = next(f for f in WITHDRAWN_FAMS if f["family"] == "cup")
    monkeypatch.setattr(AS, fam["member_literal"], fam["judged_round"])
    case = next(c for f, c in WITHDRAWN if c["id"] == "cup-d1-001")   # a team-stale box (rim_broken), tier-drawn
    payload, _bars = MP.member_payload(monkeypatch, case)
    assert [r for r in payload["structures"] if r["pattern_id"] == "bc:cup-with-handle"]
    real = cup_tier.stamp
    for fake in (lambda b: {**real(b), "withheld": "handle_deep"}, lambda b: None):
        monkeypatch.setattr(cup_tier, "stamp", fake)
        payload, _bars = MP.member_payload(monkeypatch, case)
        # no structures at all is "no cup" too (the key is absent when nothing is drawn)
        assert not [r for r in payload.get("structures", []) if r["pattern_id"] == "bc:cup-with-handle"]
