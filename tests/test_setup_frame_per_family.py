"""Each setup family is drawn on the population its passed blind round sampled (owner decision 2026-10-24).

The frame per family is auto_structures.SETUP_FRAME_BY_ID. Round-3 batch b3 (AMENDMENT S2) and rectangle_v2 round 2
sampled close > $5 and a 20-day average dollar volume >= $5M; release_g4, setups_r2 and setups_r3 batches b1 and b2
sampled close > $5 and an as-of close x volume >= $20M. tests/golden_judged replays the judged charts; this file pins
the table itself and the two frames' arithmetic.
"""
from __future__ import annotations

from api.services import auto_structures as AS

#: The families whose certified round sampled the 20-day $5M rule (lab PREREGs, read 2026-10-24).
ADV20_CERTIFIED = {"draw:descending-triangle", "draw:inverse-head-shoulders", "draw:bear-flag",
                   "draw:bollinger-squeeze", "draw:rectangle",
                   # setups_r3 batches b2r and b4 (their AMENDMENTs: the same recert supply rule)
                   "draw:rsi-bearish-divergence", "draw:symmetrical-triangle", "draw:rising-wedge",
                   "draw:avwap-reclaim", "draw:nr7", "draw:head-shoulders", "draw:triple-top",
                   "draw:triple-bottom", "draw:wyckoff-spring",
                   "draw:ascending-triangle"}


def _bars(n=AS.SETUP_MIN_BARS, close=10.0, vol=1_000_000.0, last_vol=None):
    out = [{"t": 20000101 + i, "o": close, "h": close, "l": close, "c": close, "v": vol} for i in range(n)]
    if last_vol is not None:
        out[-1] = {**out[-1], "v": last_vol}
    return out


def test_every_setup_drawing_id_has_a_frame_and_only_the_certified_ones_are_adv20():
    assert set(AS.SETUP_FRAME_BY_ID) == set(AS.SETUP_DRAW_IDS)
    adv = {pid for pid, f in AS.SETUP_FRAME_BY_ID.items() if f == AS.SETUP_FRAME_ADV20}
    assert adv == ADV20_CERTIFIED
    assert {f for pid, f in AS.SETUP_FRAME_BY_ID.items() if pid not in adv} == {AS.SETUP_FRAME_DAY}


def test_adv20_frame_is_the_mean_of_the_last_20_sessions_not_the_as_of_day():
    # $10 x 1M = $10M a day for 20 days: ADV $10M (>= $5M), the as-of day $10M (< $20M)
    b = _bars()
    assert AS.setup_in_frame(b, AS.SETUP_FRAME_ADV20)
    assert not AS.setup_in_frame(b, AS.SETUP_FRAME_DAY)
    assert AS.setup_frames_held(b) == {AS.SETUP_FRAME_ADV20}
    # a thin as-of day inside a liquid 20 days stays in the ADV frame
    assert AS.setup_in_frame(_bars(last_vol=1.0), AS.SETUP_FRAME_ADV20)
    # ADV exactly at the floor is in (>=); a cent under is out
    at = AS.SETUP_MIN_ADV_DOLLAR_VOLUME / 10.0
    assert AS.setup_in_frame(_bars(vol=at), AS.SETUP_FRAME_ADV20)
    assert not AS.setup_in_frame(_bars(vol=at * 0.999), AS.SETUP_FRAME_ADV20)


def test_both_frames_need_close_over_5_and_the_bar_count():
    assert not AS.setup_in_frame(_bars(close=5.0, vol=1e8), AS.SETUP_FRAME_ADV20)
    assert not AS.setup_in_frame(_bars(close=5.0, vol=1e8), AS.SETUP_FRAME_DAY)
    assert not AS.setup_in_frame(_bars(n=AS.SETUP_MIN_BARS - 1, vol=1e8), AS.SETUP_FRAME_ADV20)
    assert AS.setup_frames_held(_bars(vol=3e6)) == {AS.SETUP_FRAME_DAY, AS.SETUP_FRAME_ADV20}
    assert not AS.setup_in_frame(_bars(vol=1e8), "unknown")


def test_a_day_frame_family_is_not_drawn_on_an_adv_only_chart(monkeypatch):
    """setup_draw_rows filters each row by its family's frame: on a chart inside the ADV frame only, a day-frame row
    is dropped and an ADV-frame row is kept."""
    b = _bars()
    fake = lambda pid: {"id": pid, "pattern_id": pid}  # noqa: E731
    monkeypatch.setattr(AS, "_setup_draw_r2_rows", lambda sym, bb: [fake("draw:channel")])
    monkeypatch.setattr(AS, "_setup_draw_r3_rows",
                        lambda sym, bb: [fake("draw:outside-bar"), fake("draw:bear-flag")])
    monkeypatch.setattr(AS, "_setup_draw_rect_rows", lambda sym, bb: [fake("draw:rectangle")])
    got = {r["pattern_id"] for r in AS.setup_draw_rows("X", b)}
    assert got == {"draw:bear-flag", "draw:rectangle"}
    # control: in both frames every family's row is kept
    got = {r["pattern_id"] for r in AS.setup_draw_rows("X", _bars(vol=3e6))}
    assert {"draw:channel", "draw:outside-bar", "draw:bear-flag", "draw:rectangle"} <= got
