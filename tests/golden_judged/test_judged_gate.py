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
WITHDRAWN = [(f["family"], c) for f in WITHDRAWN_FAMS for c in f["cases"] if "retired" not in c]

#: Judged cases the CURRENT master does not reproduce, each a finding with its measured cause. Kept RED-visible as
#: strict xfails: the gate still fails the moment any OTHER case regresses, and fails here too once one of these is
#: fixed (strict), so the entry has to be deleted rather than left to rot. Never add a case here to make a change
#: pass: a new red is a regression or a re-baseline (docs/patterns/JUDGED_GATE.md), not an exception.
KNOWN_RED: dict = {}
_PRECEDENCE = ("judged drawing never served on this chart: a member drawing that outranks it on the same base "
               "(member_base_precedence / member_inside_day_precedence / one-line-per-base) takes its place; "
               "already so at the drawing's release commit")
for _cid in ("base-a-011", "base-a-016", "base-a-018", "base-a-020", "base-a-025", "base-b-010", "base-b-013",
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
for _cid in ("double-bottom-a-010", "inside-day-b2-018",
             # textbook round 2 (2026-10-23): the same finding, measured at that round's release commit ffbeeffed1
             "textbook-r2b-19", "textbook-r2b-20"):
    KNOWN_RED[_cid] = ("a second member drawing (bull_flag / uct_pullback_ma_v5) is drawn on the judged base, "
                       "within 1 ATR of the judged line; the judges saw the drawing alone")


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
def test_a_withdrawn_drawing_still_draws_as_judged_when_its_round_is_set(family, case, monkeypatch):
    from api.services import auto_structures as AS
    fam = next(f for f in WITHDRAWN_FAMS if f["family"] == family)
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
    fam = next(f for f in WITHDRAWN_FAMS if f["family"] == "sr")
    case = next(c for c in fam["cases"] if c["expect"]["zones"])
    payload, _bars = MP.member_payload(monkeypatch, case)
    assert "levels_sr" not in payload
    monkeypatch.setattr(AS, "MEMBER_SR_ROUND", fam["judged_round"])     # control: the door is real
    payload, _bars = MP.member_payload(monkeypatch, case)
    assert payload.get("levels_sr", {}).get("zones")


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


def test_a_retired_drawing_coming_back_is_caught(monkeypatch):
    """Control: the absence check is not vacuous -- the retired case's own judged drawing, put back on its chart, is
    red, and a chart where the retiring rule no longer holds is red."""
    fam, case = next((f, c) for f, c in RETIRED if f == "shelf")
    payload, bars = MP.member_payload(monkeypatch, case)
    assert JG.retired_failures(case, payload, bars) == []
    p = JG._unscale(case, case["expect"]["price"])
    back = {"pattern_id": "draw:shelf-pivot", "start_t": MP.ymd(case, case["expect"]["start_t"]),
            "end_t": int(bars[-1]["t"]), "geometry": {"extras": {"draw_shelf": {
                "price": p, "start_t": MP.ymd(case, case["expect"]["start_t"]), "end_t": int(bars[-1]["t"])}}}}
    again = {**payload, "structures": list(payload.get("structures") or []) + [back]}
    assert any("back on the member chart" in m for m in JG.retired_failures(case, again, bars))
    up = [dict(b) for b in bars]
    up[-1]["c"] = max(b["c"] for b in bars) * 10   # the as-of close far above any 200-day average...
    for j in range(len(up) - 40, len(up) - 1):     # ...and that average rising
        up[j]["c"] = up[j]["c"] * 3
    assert any("no longer applies" in m for m in JG.retired_failures(case, payload, up))


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
    assert {"base", "double_bottom", "shelf", "cup", "inside_day", "textbook", "remount", "u_and_r"} <= fams, fams
    assert "sr" in fams | {f["family"] for f in WITHDRAWN_FAMS}
    assert any("line" in c["expect"] for f, c in RELEASED if f == "textbook"), "no textbook round-2 line case"


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
    from api.services.pattern_engine import cup_tier
    case = next(c for f, c in RELEASED if c["id"] == "cup-d1-001")   # a team-stale box (rim_broken), tier-drawn
    payload, _bars = MP.member_payload(monkeypatch, case)
    assert [r for r in payload["structures"] if r["pattern_id"] == "bc:cup-with-handle"]
    real = cup_tier.stamp
    for fake in (lambda b: {**real(b), "withheld": "handle_deep"}, lambda b: None):
        monkeypatch.setattr(cup_tier, "stamp", fake)
        payload, _bars = MP.member_payload(monkeypatch, case)
        assert not [r for r in payload["structures"] if r["pattern_id"] == "bc:cup-with-handle"]
