"""The CAUTION layer, server half (owner decision 7, chart pattern product decisions, 2026-10-24).

Bearish setup drawings keep being SENT to members and are marked `direction: "bearish"`, so the client's UCT
Intelligence "Caution" sub-toggle (off by default) decides what is drawn. `auto_structures.CAUTION_SETUP_IDS` is
the one authority. Rails: the set is exactly the setup drawings the registry block documents as bearish (derived
from the source, never retyped); every one is still released to members; setup_draw_rows stamps the direction on
every row it returns; a non-caution setup row stamped bearish by its drawing code is served neutral; bullish rows
pass unchanged.
"""
from __future__ import annotations

import re

from api.services import auto_structures as AS
from api.services.pattern_engine.detectors import registry


def _documented_bearish_ids():
    """The setup keys the member-round comment block marks `(bearish`, mapped to their row ids."""
    src = open(AS.__file__, encoding="utf-8").read()
    keys = set(re.findall(r"^#:\s+([a-z_]+)\s+A \d\.\d+ .*\(bearish", src, re.M))
    by_key = {k: pid for k, pid, _n, _s in AS._SETUP_DRAW_R2_FUNCS + AS._SETUP_DRAW_R3_FUNCS}
    assert keys, "the documented-bearish scan matched nothing: the probe is broken, not the set"
    return {by_key[k] for k in keys}


def test_the_caution_set_is_exactly_the_documented_bearish_setups():
    assert set(AS.CAUTION_SETUP_IDS) == _documented_bearish_ids()
    assert {"draw:wyckoff-upthrust", "draw:double-top", "draw:death-cross", "draw:bear-flag"} <= AS.CAUTION_SETUP_IDS


def test_every_caution_setup_is_still_sent_to_members():
    """Decision 7 keeps the rows on the wire (the client controls display): member set + a released round."""
    for pid in AS.CAUTION_SETUP_IDS:
        assert pid in registry.DISPLAY_MEMBER_SET, pid
        assert type(AS._member_setup_round(pid)) is int, pid


def test_caution_direction_marks_caution_rows_and_neutralises_other_bearish_setups():
    assert AS.caution_direction({"pattern_id": "draw:double-top", "direction": "neutral"})["direction"] == "bearish"
    assert AS.caution_direction({"pattern_id": "draw:death-cross", "direction": "bearish"})["direction"] == "bearish"
    tl = AS.caution_direction({"pattern_id": "draw:major-trendline", "direction": "bearish"})
    assert tl["direction"] == "neutral"
    bull = {"pattern_id": "draw:falling-wedge", "direction": "bullish"}
    assert AS.caution_direction(bull) is bull
    other = {"pattern_id": "flat_base", "direction": "bearish"}       # not a setup drawing: untouched
    assert AS.caution_direction(other) is other


def test_setup_draw_rows_stamps_every_row(monkeypatch):
    rows = [{"pattern_id": "draw:double-top", "direction": "bearish"},
            {"pattern_id": "draw:wyckoff-upthrust", "direction": "neutral"},
            {"pattern_id": "draw:major-trendline", "direction": "bearish"},
            {"pattern_id": "draw:channel", "direction": "neutral"}]
    monkeypatch.setattr(AS, "setup_in_frame", lambda b: True)
    monkeypatch.setattr(AS, "_SETUP_DRAW_FUNCS", ())
    monkeypatch.setattr(AS, "_setup_draw_r2_rows", lambda s, b: [dict(r) for r in rows[:2]])
    monkeypatch.setattr(AS, "_setup_draw_r3_rows", lambda s, b: [dict(r) for r in rows[2:]])
    monkeypatch.setattr(AS, "_setup_draw_rect_rows", lambda s, b: [])
    out = AS.setup_draw_rows("ZZZ", [{"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])
    assert [r["direction"] for r in out] == ["bearish", "bearish", "neutral", "neutral"]
