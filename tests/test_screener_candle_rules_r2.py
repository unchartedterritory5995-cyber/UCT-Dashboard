"""Candle rules round 2: the textbook rules the blind audit added, and the rails
that keep them.

Round 2 of the textbook audit (2026-10-24) passed its blind packets. Each test
below pins ONE rule it added (the R2-Fn tags in candle_catalog.py) with a
positive fixture and a negative one, so a rule cannot be deleted while its
neighbours keep the suite green. Two more rails sit beside them:

* PARITY: a seeded synthetic tape is classified bar by bar and the full
  `candle_matches` stream is hashed. The digest was computed by the audit's lab
  copy of the engine (the code the blind judges passed), so this test fails the
  moment the shipped engine and the passed engine disagree on any bar.
* VOCABULARY: the candle layer is LABEL-ONLY. The same audit measured every
  label against random bars of the same date and trend context and found no
  usable edge, so no label or description may carry scoring or signal words.
"""
import hashlib
import math
import random
import re

import pytest

from api.services import auto_structures
from api.services.screener import candle_catalog as cat
from api.services.screener import candles


def _bar(o, h, l, c, v=1_000_000):
    return {"o": o, "h": h, "l": l, "c": c, "v": v}


def _downtrend(n=60, start=40.0, step=0.4):
    out, p = [], start
    for _ in range(n):
        out.append(_bar(p, p + 0.15, p - step - 0.15, p - step))
        p -= step
    return out


def _uptrend(n=60, start=10.0, step=0.4):
    out, p = [], start
    for _ in range(n):
        out.append(_bar(p, p + step + 0.15, p - 0.15, p + step))
        p += step
    return out


def _quiet(n=50, price=20.0, body=0.1):
    out = []
    for i in range(n):
        o, c = (price, price + body) if i % 2 else (price + body, price)
        out.append(_bar(o, max(o, c) + 0.15, min(o, c) - 0.15, c))
    return out


def _matches(bars):
    return cat.decode_matches(candles.single_candle(bars)["candle_matches"])


# ── R2-F9 / R2-F14: a reversal needs a REAL prior move and must sit at its extreme
def test_a_hammer_at_the_low_of_a_real_decline_is_a_hammer():
    d = _downtrend()
    p = d[-1]["c"]
    assert "hammer" in _matches(d + [_bar(p - 0.05, p + 0.02, p - 1.6, p)])


def test_a_hammer_above_the_recent_lows_is_only_an_umbrella():
    """R2-F9: same shape, same downtrend, but the bar is not at the low of the move."""
    d = _downtrend()
    p = d[-1]["c"]
    bars = d + [_bar(p + 0.55, p + 0.62, p + 0.3, p + 0.6)]
    got = candles.single_candle(bars)
    assert got["candle_trend"] == "down"          # the gate it fails is location, not trend
    assert "hammer" not in cat.decode_matches(got["candle_matches"])
    assert "umbrella" in cat.decode_matches(got["candle_matches"])


def test_a_hammer_after_a_drift_with_no_real_move_is_only_an_umbrella():
    """R2-F14: the EMA reads 'down' and the bar is at the low, but the 10-session
    move is a fraction of an ATR. A drift in a flat base is not a decline."""
    bars = _quiet()
    q = bars[-1]["c"]
    for _ in range(12):
        bars.append(_bar(q, q + 0.15, q - 0.18, q - 0.03))
        q -= 0.03
    bars.append(_bar(q - 0.02, q + 0.01, q - 0.9, q))
    got = candles.single_candle(bars)
    assert got["candle_trend"] == "down"
    ctx = candles._build_ctx(bars, 1, candles._atr(bars), False, False)
    assert cat._at_extreme(ctx, 1, True)          # location passes; only the move fails
    assert not cat._move_ok(ctx, 1, "down")
    assert "hammer" not in cat.decode_matches(got["candle_matches"])


# ── R2-F15: thrusting closes WELL into the body; barely into it is in-neck ──
def _thrust(depth):
    d = _downtrend()
    p = d[-1]["c"]
    blk = _bar(p, p + 0.05, p - 1.25, p - 1.2)
    c = (p - 1.2) + depth * 1.2
    return d + [blk, _bar(blk["l"] - 0.1, c + 0.02, blk["l"] - 0.15, c)]


def test_thrusting_needs_a_real_penetration():
    assert "thrusting" in _matches(_thrust(0.35))
    assert "thrusting" not in _matches(_thrust(0.08))


# ── R2-F2: the harami's second body is SMALL, not merely smaller ────────────
def _harami(frac):
    d = _downtrend()
    p = d[-1]["c"]
    blk = _bar(p, p + 0.05, p - 1.25, p - 1.2)
    mid, body = p - 0.6, 1.2 * frac
    return d + [blk, _bar(mid - body / 2, mid + body / 2 + 0.02, mid - body / 2 - 0.02, mid + body / 2)]


def test_a_harami_needs_a_small_second_body():
    assert "bullish-harami" in _matches(_harami(0.3))
    assert "bullish-harami" not in _matches(_harami(0.8))


# ── R2-F1: a marubozu is a LONG body ─────────────────────────────────────────
def test_a_short_shaven_bar_is_not_a_marubozu():
    base = _quiet(45, price=100.0, body=1.0)
    shaven = _bar(100.0, 100.62, 99.99, 100.6)     # body 0.6 against an average of 1.0
    assert not {"white-marubozu", "marubozu"} & set(_matches(base + [shaven]))


# ── R2-F4: separating lines' colour order agrees with the trend ─────────────
def test_separating_lines_follow_the_trend_colour_order():
    u = _uptrend()
    q = u[-1]["c"]
    black_then_white = [_bar(q, q + 0.05, q - 0.65, q - 0.6), _bar(q, q + 0.65, q - 0.05, q + 0.6)]
    white_then_black = [_bar(q, q + 0.65, q - 0.05, q + 0.6), _bar(q, q + 0.05, q - 0.65, q - 0.6)]
    assert "separating-lines" in _matches(u + black_then_white)
    assert "separating-lines" not in _matches(u + white_then_black)


# ── the member-round literal ─────────────────────────────────────────────────
def test_the_member_round_is_the_confirmed_rules_round():
    assert cat.CANDLE_RULES_ROUND == 2
    assert auto_structures.MEMBER_CANDLE_ROUND == 2
    assert auto_structures.member_candle_rules_ok() is True


@pytest.mark.parametrize("member", [1, 3, None, "2"])
def test_the_member_round_fails_closed_on_any_mismatch(monkeypatch, member):
    monkeypatch.setattr(auto_structures, "MEMBER_CANDLE_ROUND", member)
    assert auto_structures.member_candle_rules_ok() is False


# ── label-only: no scoring or signal language may reach a member ────────────
_SIGNAL_WORDS = re.compile(
    r"\b(signals?|probabilit\w*|odds|edge|win rate|reliab\w*|performance|scor(?:e|es|ed|ing)"
    r"|predict\w*|forecast\w*|outperform\w*|accuracy|acts? on|worth a look)\b",
    re.IGNORECASE)


def test_no_label_or_description_carries_signal_language():
    hits = [(p.key, m.group(0)) for p in cat.ALL_PATTERNS
            for m in [_SIGNAL_WORDS.search(p.label + " " + p.desc)] if m]
    assert hits == []


def test_the_vocabulary_check_can_fire():
    """Control: the regex must catch the phrasing the audit removed."""
    assert _SIGNAL_WORDS.search("the one pattern that measures strong on reliability, performance")
    assert _SIGNAL_WORDS.search("this is the state a hikkake trader acts on")
    assert not _SIGNAL_WORDS.search("sellers never got a single tick")


# ── PARITY with the engine the blind judges passed ──────────────────────────
#: sha256 of the candle_matches stream below, computed by the audit's lab engine
#: (round 2, 2026-10-24). A rule change here must change this digest.
LAB_PARITY_DIGEST = "2d4a3b30015f8b97e16ec134cd134177b23ab688865ea0df1c0fc782ccfb1bab"
LAB_PARITY_BARS = 4320


def _walk(seed, n=420):
    rnd = random.Random(seed)
    p, out = 50.0, []
    for i in range(n):
        drift = 0.6 * math.sin(i / 23.0)          # alternating trend regimes
        o = p * (1 + rnd.gauss(0, 0.004))
        c = o * (1 + rnd.gauss(drift * 0.004, 0.015))
        h = max(o, c) * (1 + abs(rnd.gauss(0, 0.006)))
        l = min(o, c) * (1 - abs(rnd.gauss(0, 0.006)))
        out.append(_bar(round(o, 2), round(h, 2), round(l, 2), round(c, 2)))
        p = c
    return out


def parity_stream(single_candle):
    lines = []
    for seed in range(12):
        bars = _walk(seed)
        for k in range(60, len(bars)):
            got = single_candle(bars[max(0, k - 259):k + 1])
            lines.append("%d:%d:%s" % (seed, k, got.get("candle_matches") or ""))
    return lines


def test_the_engine_matches_the_engine_the_blind_judges_passed():
    lines = parity_stream(candles.single_candle)
    assert len(lines) == LAB_PARITY_BARS
    digest = hashlib.sha256("\n".join(lines).encode()).hexdigest()
    assert digest == LAB_PARITY_DIGEST


def test_the_parity_tape_exercises_the_round_two_rules():
    """Non-vacuity: a tape on which no R2 rule ever fires would hash the same
    before and after a rule change."""
    keys = {k for line in parity_stream(candles.single_candle)
            for k in cat.decode_matches(line.split(":", 2)[2])}
    assert {"hammer", "umbrella", "bullish-harami", "bearish-engulfing"} <= keys
    assert len(keys & cat.RELATION_KEYS) >= 15
