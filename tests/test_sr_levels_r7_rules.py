"""Textbook support / resistance round r7: the round's own rules on SYNTHETIC charts (the parity rail pins the port to
the lab generator; these pin what the rules MEAN, each on a chart built for it).

The base chart is a sideways range: a smooth zigzag between 100 and 110 (a turn every 10 sessions), so a support
band sits at ~99 (the reaction lows) and a resistance band at ~111 (the reaction highs).
"""
import math

import pytest

from api.services.pattern_engine import sr_levels as S


def _range(n=280, lo=100.0, hi=110.0, period=20, t0=20240101):
    out = []
    for k in range(n):
        ph = (k % period) / period
        c = lo + (hi - lo) * (1 - math.cos(2 * math.pi * ph)) / 2
        out.append([t0 + k, c, c + 0.8, c - 0.8, c, 1e7])
    return out


def _then(b, closes):
    b = [list(r) for r in b]
    t = b[-1][0]
    for j, c in enumerate(closes):
        b.append([t + j + 1, c, c + 0.8, c - 0.8, c, 1e7])
    return b


BROKEN = [98, 95, 92] + [90] * 15                 # a significant close through the ~99 support, then no retest
RETESTED = [93, 96, 98.5, 97, 94, 92, 91]         # ... then back up into the band from below, and held under it
FAILED = [93, 96, 99.5, 101, 102, 103, 104]       # ... then back up THROUGH the band: the break failed


def _zones(b):
    return [(z["role"], round(z["bot"]), z["state"]) for z in S.draw(b, None, ())["zones"]]


def test_the_round_is_r7():
    assert S.SR_ROUND == "r7" and S.MIN_LEVELS == 2


def test_a_range_serves_its_floor_and_its_ceiling():
    d = S.draw(_range(), None, ())
    assert d.get("withheld") is None
    assert [(z["role"], z["state"]) for z in d["zones"]] == [("Resistance", "intact"), ("Support", "intact")]
    assert all(z["touches"] >= 3 for z in d["zones"])


def test_a_chart_with_fewer_than_two_levels_gets_no_layer():
    """The r7 serving rule: after the breakdown only ONE level qualifies, so nothing at all is served (no zone, no
    trendline), named "too_few_levels"."""
    d = S.draw(_then(_range(), BROKEN), None, ())
    assert d["withheld"] == "too_few_levels" and d["zones"] == [] and d["trendlines"] == []


def test_a_broken_level_is_not_drawn_until_a_held_retest(monkeypatch):
    monkeypatch.setattr(S, "MIN_LEVELS", 1)                  # look at the levels themselves
    zs = _zones(_then(_range(), BROKEN))
    assert zs and all(b > 105 for _r, b, _s in zs)                                   # the broken floor: absent
    assert ("Resistance", 99, "confirmed") not in zs
    assert ("Resistance", 99, "confirmed") in _zones(_then(_range(), BROKEN + RETESTED))  # retested: flipped
    z = [z for z in S.draw(_then(_range(), BROKEN + RETESTED), None, ())["zones"] if round(z["bot"]) == 99]
    assert z and z[0]["broken_retested"] is True


def test_a_failed_break_reverts_to_the_old_role(monkeypatch):
    monkeypatch.setattr(S, "MIN_LEVELS", 1)
    assert ("Support", 99, "intact") in _zones(_then(_range(), BROKEN + FAILED))


def test_a_shallow_close_through_is_not_a_break(monkeypatch):
    """A close below the band by less than max(1 ATR, 3%) is no break: the level stays intact (its role is read off
    the close), never "confirmed"."""
    monkeypatch.setattr(S, "MIN_LEVELS", 1)
    zs = _zones(_then(_range(), [98, 97.5, 97.2] + [97] * 10))
    assert ("Resistance", 99, "intact") in zs and all(s != "confirmed" for _r, _b, s in zs)


@pytest.mark.parametrize("closes", [BROKEN, BROKEN + RETESTED, BROKEN + FAILED])
def test_no_level_is_ever_served_alone(closes):
    d = S.draw(_then(_range(), closes), None, ())
    assert len(d["zones"]) == 0 or len(d["zones"]) >= 2
