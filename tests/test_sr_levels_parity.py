"""Textbook support / resistance (drawing round r7): the ported layer reproduces the frozen lab generator EXACTLY.

Fixture tests/fixtures/sr_levels_parity.json.gz: 352 charts -- all 100 judged r7 packet charts (packets A-D, with the
member pattern prices the judges saw; expect computed on the FULL history and asserted identical on the stored 300
bars at generation), and every chart of the round-r2 fixture (the 50 r2 packet charts, 101 seeded DEV days
(< 2025-05-15), 98 seeded held-out days, 3 pinned controls) with its expect recomputed by the r7 generator. Half of the
random days carry pattern prices placed inside a drawn zone / at a drawn trendline, so the patterns-win suppression and
the next-candidate replacement are exercised. expect = lab recert/D_levels_candles/r7/sr6.py + the r7 serving rule
(fewer than MIN_LEVELS zones -> no layer, withheld "too_few_levels").

The rail must be able to fail: the controls at the bottom move ONE parameter and assert it goes red.
"""
import gzip
import json
import os

import pytest

from api.services.pattern_engine import sr_levels as S

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "sr_levels_parity.json.gz")
_CASES = []


def cases():
    if not _CASES:
        with gzip.open(FIXTURE, "rb") as fh:
            _CASES.extend(json.loads(fh.read().decode("utf-8"))["cases"])
    return _CASES


def _strip(d):
    """Everything except the round stamp (the lab stamps 'r6', the model it froze; the port 'r7')."""
    return None if d is None else {k: v for k, v in d.items() if k != "round"}


def _mismatches():
    bad = []
    for c in cases():
        got = S.draw(c["bars"], None, c["pattern_pivots"])
        if json.dumps(_strip(got), sort_keys=True) != json.dumps(_strip(c["expect"]), sort_keys=True):
            bad.append(c["id"])
    return bad


def test_the_fixture_is_what_it_says():
    cs = cases()
    ids = [c["id"] for c in cs]
    assert len(cs) == 352 and len(set(ids)) == 352
    for pk in "ABCD":
        assert sum(i.startswith("R7_%s/" % pk) for i in ids) == 25
    assert sum(c["origin"] == "packet" for c in cs) == 100
    assert sum(c["origin"] == "packet_r2" for c in cs) == 50
    assert sum(c["origin"] == "dev" for c in cs) == 101 and all(c["asof"] < 20250515 for c in cs if c["origin"] == "dev")
    assert sum(c["origin"] == "held" for c in cs) == 98 and all(c["asof"] >= 20250515 for c in cs if c["origin"] == "held")
    assert sum(c["origin"] == "pinned" for c in cs) == 3
    # non-vacuity: every branch the rules have is on the rail
    e = [c["expect"] for c in cs]
    assert sum(len(d["zones"]) for d in e) == 559
    assert sum(len(d["trendlines"]) for d in e) == 3
    assert sum(d["suppressed_by_pattern"]["zones"] + d["suppressed_by_pattern"]["trendlines"] for d in e) == 769
    assert sum(z["broken_retested"] for d in e for z in d["zones"]) == 121
    assert sum(z["state"] == "confirmed" for d in e for z in d["zones"]) == 121
    assert sum(z["state"] == "intact" for d in e for z in d["zones"]) == 438
    assert sum(d.get("withheld") == "pinned" for d in e) == 3
    assert sum(d.get("withheld") == "too_few_levels" for d in e) == 126
    # every judged chart is a SERVED chart (>= MIN_LEVELS zones), every other chart either serves >= 2 or nothing
    assert all(len(c["expect"]["zones"]) >= 2 for c in cs if c["origin"] == "packet")
    assert all(len(d["zones"]) == 0 or len(d["zones"]) >= 2 for d in e)
    assert {z["role"] for d in e for z in d["zones"]} == {"Support", "Resistance"}
    assert {t["side"] for d in e for t in d["trendlines"]} == {"support"}
    assert all(261 <= len(c["bars"]) <= 300 for c in cs) and sum(len(c["bars"]) == 300 for c in cs) > 300


def test_the_port_reproduces_every_case_exactly():
    """Same zones (bounds, role, touches, touch dates, retest state, label), same trendlines, same suppression,
    merge and crowding counts, same ATR -- on every case, the 50 judged charts included."""
    assert _mismatches() == []


def test_the_judged_packet_labels_are_on_the_rail():
    """The 100 judged r7 charts by label: the exact text a member reads."""
    labels = [z["label"] for c in cases() if c["origin"] == "packet" for z in S.draw(c["bars"], None, c["pattern_pivots"])["zones"]]
    want = [z["label"] for c in cases() if c["origin"] == "packet" for z in c["expect"]["zones"]]
    assert labels == want and len(labels) >= 200


def test_the_drawing_reads_only_bars_up_to_the_as_of_bar():
    """Lookahead: drawing at bar k from rows[:k+1], from rows[:k+1] + a violent fake future, and with i=k over the
    longer list are identical."""
    import random
    n = 0
    for c in cases()[::5]:
        bars = c["bars"]
        r = random.Random(c["id"])
        t, px = bars[-1][0], bars[-1][4]
        fut = []
        for j in range(30):
            o = px * (1 + r.uniform(-0.25, 0.25))
            px = max(0.5, o * (1 + r.uniform(-0.25, 0.25)))
            fut.append([t + j + 1, o, max(o, px) * 1.1, min(o, px) * 0.9, px, 1e7])
        a = S.draw(bars, None, c["pattern_pivots"])
        b = S.draw(bars + fut, len(bars) - 1, c["pattern_pivots"])
        assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True), c["id"]
        n += 1
    assert n >= 50


def test_a_short_history_draws_nothing():
    c = cases()[0]
    assert S.draw(c["bars"][-60:], None, ()) is None
    assert S.draw(c["bars"][-61:], None, ()) is not None


def test_bars_needed_covers_the_window():
    """A history of BARS_NEEDED bars draws exactly what the stored 300 bars draw (the serving layer reads more)."""
    for c in cases()[::7]:
        a = S.draw(c["bars"], None, c["pattern_pivots"])
        b = S.draw(c["bars"][-S.BARS_NEEDED:], None, c["pattern_pivots"])
        assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True), c["id"]


# ---------------------------------------------------------------- the rail can fail
@pytest.mark.parametrize("key,value", [
    ("ZONE_HALF", 0.30), ("MIN_TOUCH", 4), ("ZONE_GAP_ATR", 1.0), ("VIS_GAP", 0.10),
    ("ZONE_NEAR", 0.12), ("ZONE_NEAR_FALLBACK", 0.20), ("SNAP_ITERS", 1), ("RR_PRE_TOUCH", 3), ("MAX_PER_SIDE", 3),
    ("TL_TOL", 0.25), ("TL_MIN_MOVE", 1.0), ("TL_MAX_AGE", 90), ("PATTERN_ATR", 0.5), ("PINNED_ATR_PCT", 0.01),
    # round r7's own rules
    ("BRK_ATR", 1.5), ("BRK_PCT", 0.05), ("RETEST_MIN", 1), ("PAIR_GAP", 10), ("PAIR_GAP_SHORT", 7), ("CONG_K", 3),
    ("CONG_MIN", 4), ("GAP_ATR", 0.5), ("BEST_WIN", 3.0), ("MAX_ZONES", 4), ("MIN_LEVELS", 1),
])
def test_control_moving_one_parameter_goes_red(monkeypatch, key, value):
    monkeypatch.setattr(S, key, value)
    assert _mismatches(), "moving %s did not change any case: the rail cannot see it" % key
