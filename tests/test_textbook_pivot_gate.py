"""The INTERIM strict textbook gate on the flat top, the shelf pivot and the double bottom (recert B, 2026-10-24).

Each failed the strict blind round 1 as served; with this gate the report-only blind packet E scored flat top 2.46,
shelf 2.52, double bottom 2.55 (two fresh judges). It is removal-only: a row that fails is withheld, nothing is drawn
differently. Three kinds of rail:
  * PARITY: the lab rule the packets were judged under (lab recert B tools/gate_r2.py), frozen as verdicts on real
    served rows of all three types (tests/fixtures/textbook_gate_pivot_parity.json.gz, written by the lab, symbol
    free), must equal pattern_engine.textbook_gate.pivot_fails on the same charts, failure names in order;
  * PERTURBATION: a lab-passing chart of each type passes, and each rule, broken alone on it, fails by its own name;
  * WIRING: the member gate withholds a failing row and keeps a passing one, judges each row at its own end_t, a
    wrong literal withholds every row of the three ids (fail closed), None turns the gate off, unreadable bars
    withhold.
"""
import copy
import gzip
import json
import os

import pytest

from api.services.pattern_engine import textbook_gate as TG
from tests.golden_judged import member_path as MP

HERE = os.path.dirname(os.path.abspath(__file__))
PARITY = os.path.join(HERE, "fixtures", "textbook_gate_pivot_parity.json.gz")
KEY = {"uct_flat_top_breakout": "draw_flat_top", "draw:shelf-pivot": "draw_shelf", "draw:double-bottom": "draw_shape"}


def _cases():
    with gzip.open(PARITY, "rt", encoding="utf-8") as f:
        return json.load(f)["cases"]


CASES = _cases()


def _decode(case):
    """(bars, row) on the decoded chart: prices back in real units, day offsets back to the chart's dates."""
    bars = MP.decode_bars(case)
    s = float(case["bars"]["scale"])
    row = copy.deepcopy(case["row"])
    pid = row["pattern_id"]
    d = row["geometry"]["extras"][KEY[pid]]
    for k in ("price", "pivot", "low"):
        if k in d:
            d[k] = d[k] / s
    for k in ("start_t", "end_t"):
        d[k] = MP.ymd(case, d[k])
    for m in d.get("touches") or []:
        m["t"], m["price"] = MP.ymd(case, m["t"]), m["price"] / s
    for m in d.get("marks") or []:
        m["t"], m["price"] = MP.ymd(case, m["t"]), m["price"] / s
    return bars, row


def _passing(pid):
    for c in CASES:
        if c["row"]["pattern_id"] == pid and not c["lab"]:
            return _decode(c)
    raise AssertionError(pid)


# ---------------------------------------------------------------- parity

def test_the_parity_file_covers_every_type_and_both_outcomes():
    for pid in KEY:
        mine = [c for c in CASES if c["row"]["pattern_id"] == pid]
        ok = [c for c in mine if not c["lab"]]
        bad = [c for c in mine if c["lab"]]
        assert len(ok) >= 15 and len(bad) >= 15, (pid, len(ok), len(bad))       # non-vacuity, both directions


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["id"])
def test_the_gate_matches_the_lab_rule_on_every_parity_chart(case):
    bars, row = _decode(case)
    assert TG.end_of(row) == bars[-1]["t"]
    assert TG.pivot_fails(bars, row) == case["lab"]


# ---------------------------------------------------------------- perturbation: each rule by its own name

def test_a_lab_passing_chart_of_each_type_passes():
    for pid in KEY:
        bars, row = _passing(pid)
        assert TG.pivot_fails(bars, row) == [], pid


def _break(pid, edit):
    bars, row = _passing(pid)
    edit(bars, row["geometry"]["extras"], row["geometry"]["extras"][KEY[pid]])
    return TG.pivot_fails(bars, row)


def test_each_flat_top_rule_fails_by_its_own_name():
    pid = "uct_flat_top_breakout"
    assert "F4_depth" in _break(pid, lambda b, ex, d: ex.update(base_depth=0.5))
    assert "F4_depth" in _break(pid, lambda b, ex, d: ex.pop("base_depth"))
    assert "F2_cluster" in _break(pid, lambda b, ex, d: d.update(touches=d["touches"][:2]))
    assert "F5_dist" in _break(pid, lambda b, ex, d: d.update(price=b[-1]["c"] / 1.10))


def test_each_shelf_rule_fails_by_its_own_name():
    pid = "draw:shelf-pivot"
    assert "S2_loose" in _break(pid, lambda b, ex, d: d.update(touch_groups=2))
    assert "S5_dist" in _break(pid, lambda b, ex, d: d.update(price=b[-1]["c"] / 1.08))


def test_each_double_bottom_rule_fails_by_its_own_name():
    pid = "draw:double-bottom"
    assert "D3_depth_len" in _break(pid, lambda b, ex, d: d.update(depth=0.5))
    assert "D3_depth_len" in _break(pid, lambda b, ex, d: d.update(len=20))
    assert "D6_dist" in _break(pid, lambda b, ex, d: d.update(pivot=b[-1]["c"] / 1.10))
    fails = _break(pid, lambda b, ex, d: d.update(marks=[m for m in d["marks"] if m["kind"] != "low2"]))
    assert "D2_undercut" in fails and "D5_not_extremes" in fails


def test_a_collapsed_chart_fails_the_trend_template():
    for pid in KEY:
        def crash(b, ex, d):
            for x in b[-30:]:
                for k in ("o", "h", "l", "c"):
                    x[k] *= 0.4
        assert "close<=sma200" in _break(pid, crash), pid


def test_the_double_bottom_trend_template_is_the_loose_one():
    """A double bottom is a base, not a pivot near highs: it is held to close within 35% of the 252-day high and
    not to the 50-day rising; the flat top and the shelf to 15% and the 50-day rising."""
    f = {"tt_close_over_200": True, "tt_200_rising": True, "tt_200_rising_3m": True, "sma200_slope_3m": 0.05,
         "tt_50_over_200": True, "tt_50_rising": False}
    assert TG.trend_fails(dict(f, off_high=0.34), strict=False) == []
    assert TG.trend_fails(dict(f, off_high=0.36), strict=False) == ["off_high>35%"]
    assert TG.trend_fails(dict(f, off_high=0.14), strict=True) == ["sma50_falling"]
    assert TG.trend_fails(dict(f, off_high=0.16, tt_50_rising=True), strict=True) == ["off_high>15%"]


def test_a_short_history_or_a_malformed_row_fails_closed():
    for pid in KEY:
        bars, row = _passing(pid)
        assert TG.pivot_fails(bars[-200:], row) == ["short_history"]
        assert TG.pivot_fails(bars, {"pattern_id": pid}) == ["unreadable"]
        assert TG.pivot_fails(bars, {"pattern_id": "bc:base", "geometry": row["geometry"]}) == ["unreadable"]


# ---------------------------------------------------------------- wiring

def _member(monkeypatch, bars):
    from api.services import auto_structures as AS
    monkeypatch.setattr(AS, "_daily_bars", lambda sym: bars)
    monkeypatch.setattr(AS, "last_bar_forming", lambda t, now=None: False)
    return AS


def _bad(pid):
    bars, row = _passing(pid)
    bad = copy.deepcopy(row)
    d = bad["geometry"]["extras"][KEY[pid]]
    if pid == "uct_flat_top_breakout":
        bad["geometry"]["extras"]["base_depth"] = 0.5
    elif pid == "draw:shelf-pivot":
        d["touch_groups"] = 2
    else:
        d["depth"] = 0.5
    assert TG.pivot_fails(bars, bad)
    return bars, row, bad


@pytest.mark.parametrize("pid", sorted(KEY))
def test_the_member_gate_withholds_a_failing_row_and_keeps_a_passing_one(pid, monkeypatch):
    bars, good, bad = _bad(pid)
    AS = _member(monkeypatch, bars)
    other = {"pattern_id": "bc:base"}
    det, st = AS.member_textbook_gate("X", [bad, other], [good, bad, other])
    assert det == [other] and st == [good, other]


@pytest.mark.parametrize("pid", sorted(KEY))
def test_each_row_is_judged_on_the_bars_ending_at_its_own_end_t(pid, monkeypatch):
    bars, good, _bad_row = _bad(pid)
    later = [dict(x) for x in bars] + [dict(bars[-1], t=bars[-1]["t"] + 1, c=bars[-1]["c"] * 0.5,
                                            l=bars[-1]["c"] * 0.5, o=bars[-1]["c"] * 0.5)]
    assert TG.pivot_fails(later, good)                     # judged on the crash bar it would fail ...
    AS = _member(monkeypatch, later)
    assert AS.member_textbook_gate("X", [], [good])[1] == [good]   # ... the gate reads its own as-of bar


def test_a_wrong_gate_literal_withholds_every_pivot_row_and_only_those(monkeypatch):
    rows = [_passing(pid)[1] for pid in sorted(KEY)]
    bars = _passing("draw:shelf-pivot")[0]
    AS = _member(monkeypatch, bars)
    monkeypatch.setattr(AS, "MEMBER_PIVOT_GATE_ROUND", TG.PIVOT_GATE_ROUND + 1)
    monkeypatch.setattr(AS, "MEMBER_INSIDE_DAY_GATE_ROUND", None)
    other = {"pattern_id": "bc:base"}
    assert AS.member_textbook_gate("X", rows + [other], rows + [other]) == ([other], [other])


def test_a_none_literal_turns_the_pivot_gate_off(monkeypatch):
    for pid in sorted(KEY):
        bars, good, bad = _bad(pid)
        AS = _member(monkeypatch, bars)
        monkeypatch.setattr(AS, "MEMBER_PIVOT_GATE_ROUND", None)
        assert AS.member_textbook_gate("X", [], [good, bad])[1] == [good, bad], pid


def test_unreadable_bars_withhold_every_pivot_row(monkeypatch):
    from api.services import auto_structures as AS
    rows = [_passing(pid)[1] for pid in sorted(KEY)]

    def boom(sym):
        raise RuntimeError("store down")
    monkeypatch.setattr(AS, "_daily_bars", boom)
    other = {"pattern_id": "bc:base"}
    assert AS.member_textbook_gate("X", [], rows + [other])[1] == [other]


def test_the_gate_literals_are_released_at_the_module_rounds():
    from api.services import auto_structures as AS
    assert AS.MEMBER_PIVOT_GATE_ROUND == TG.PIVOT_GATE_ROUND == 1
    assert TG.PIVOT_GATE_IDS == frozenset(KEY)
    assert set(KEY) <= AS._TEXTBOOK_GATED_IDS
