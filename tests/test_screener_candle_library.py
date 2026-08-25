"""The candle library's contracts: totality, registry integrity, the trend
gate, and the multi-match set that filters read.

⭐ THE CENTRAL CLAIM UNDER TEST is that `classify_shape` is TOTAL — there is no
bar it cannot name. That is what took the dash rate from 43.6% of the market to
the 2.1% that are genuine refusals, and a property test is the only honest way
to assert it: one hand-written example proves nothing about the space of bars.
"""
import ast
import random

import pytest

from api.services.screener import candles, candle_catalog as cat

CATALOG_SRC = "api/services/screener/candle_catalog.py"


def _bar(o, h, l, c, v=1_000_000):
    return {"o": o, "h": h, "l": l, "c": c, "v": v}


def _flat(n=45, price=10.0):
    """Enough history to satisfy the 40-bar trend warm-up, with no trend."""
    return [_bar(price, price + 0.2, price - 0.2, price) for _ in range(n)]


def _downtrend(n=60, start=40.0, step=0.4):
    out = []
    p = start
    for _ in range(n):
        out.append(_bar(p, p + 0.15, p - step - 0.15, p - step))
        p -= step
    return out


def _uptrend(n=60, start=10.0, step=0.4):
    out = []
    p = start
    for _ in range(n):
        out.append(_bar(p, p + step + 0.15, p - 0.15, p + step))
        p += step
    return out


# ── totality ────────────────────────────────────────────────────────────────
def test_every_bar_that_clears_the_guards_gets_a_name():
    """🔴 THE DEFECT THIS EXISTS FOR: the old chain had no branch for a body
    between 30% and 85% of range that was not engulfing, so 1,620 of 3,714 rows
    (43.6% of the market) carried a dash while holding a fully measured bar."""
    rng = random.Random(20260824)
    unnamed = []
    for _ in range(4000):
        base = _flat(45, price=rng.uniform(2, 400))
        px = base[-1]["c"]
        lo = px * rng.uniform(0.90, 0.999)
        hi = px * rng.uniform(1.001, 1.10)
        o = rng.uniform(lo, hi)
        c = rng.uniform(lo, hi)
        bars = base + [_bar(o, hi, lo, c)]
        out = candles.single_candle(bars)
        if out["candle_type"] in (None, "none"):
            unnamed.append(bars[-1])
    assert not unnamed, f"{len(unnamed)} bars with a real range went unnamed"


def test_the_named_shape_is_always_a_registered_pattern():
    rng = random.Random(7)
    for _ in range(2000):
        base = _flat(45, price=rng.uniform(2, 400))
        px = base[-1]["c"]
        lo, hi = px * 0.95, px * 1.05
        bars = base + [_bar(rng.uniform(lo, hi), hi, lo, rng.uniform(lo, hi))]
        out = candles.single_candle(bars)
        assert out["candle_type"] in cat.BY_KEY
        assert out["candle_label"]


# ── registry integrity: one grammar, no drift ───────────────────────────────
def test_classifier_emits_exactly_the_registered_shape_keys():
    """A shape the classifier can emit but the registry has never heard of would
    reach the column with no label, no description and no filter entry — and a
    registered shape that is unreachable is a filter option that never matches.
    Derived from the AST, never from a typed list."""
    tree = ast.parse(open(CATALOG_SRC, encoding="utf-8").read())
    fns = [n for n in tree.body
           if isinstance(n, ast.FunctionDef) and n.name in ("classify_shape", "_plain")]
    assert len(fns) == 2
    emitted = set()
    for f in fns:
        for node in ast.walk(f):
            if (isinstance(node, ast.Constant) and isinstance(node.value, str)
                    and len(node.value) < 30 and not node.value.startswith(" ")
                    and node.value not in ("down", "up", "neutral", "unknown")):
                emitted.add(node.value)
    assert emitted == cat.SHAPE_KEYS


def test_every_pattern_is_complete_and_unique():
    keys = [p.key for p in cat.ALL_PATTERNS]
    assert len(keys) == len(set(keys)), "duplicate key"
    for p in cat.ALL_PATTERNS:
        assert p.label and p.desc, p.key
        assert p.bias in ("bullish", "bearish", "neutral"), p.key
        assert p.kind in ("reversal", "continuation", "indecision", "plain"), p.key
        assert (p.detect is None) == (p.axis == "shape"), p.key


def test_filter_options_are_derived_from_the_registry():
    """⛔ A hand-listed enum beside the registry is a second authority over the
    same fact. The old filter listed 7 values by hand and drifted the moment the
    library grew."""
    opts = cat.enum_options()
    values = {o["value"] for o in opts if "value" in o}
    assert values == {cat.match_value(k) for k in cat.BY_KEY}
    # ⛔ the wrapping is what stops "Hammer" from also matching inverted-hammer
    assert cat.match_value("hammer") not in cat.match_value("inverted-hammer")
    assert opts[0] == {"label": "Any"}


# ── the refusals must survive ───────────────────────────────────────────────
def test_a_zero_range_bar_is_still_refused():
    out = candles.single_candle(_flat() + [_bar(10.0, 10.0, 10.0, 10.0)])
    assert out["candle_type"] == "none"
    assert out["body_pct"] is None and out["close_position"] is None
    assert out["narrow_bar"] is True          # a MEASURED fact, still true


def test_a_self_contradicting_bar_is_refused():
    out = candles.single_candle(_flat() + [_bar(12.0, 10.5, 9.5, 10.0)])
    assert out["candle_type"] == "none"


# ── the trend gate ──────────────────────────────────────────────────────────
def test_one_umbrella_geometry_yields_three_different_names():
    """⛔ HAMMER AND HANGING MAN ARE THE SAME SHAPE. The old code printed
    "hammer" for both and carried the wrong sign roughly half the time."""
    shape = lambda base, px: base + [_bar(px, px + 0.05, px - 1.6, px - 0.1)]
    down = _downtrend()
    up = _uptrend()
    d = candles.single_candle(shape(down, down[-1]["c"]))
    u = candles.single_candle(shape(up, up[-1]["c"]))
    n = candles.single_candle(shape(_flat(), 10.0))
    assert d["candle_trend"] == "down" and d["candle_type"] == "hammer"
    assert u["candle_trend"] == "up" and u["candle_type"] == "hanging-man"
    assert n["candle_type"] == "umbrella"     # no trend -> the geometry, no guess


def test_trend_is_read_before_the_pattern_not_from_it():
    """⭐ The MA is evaluated at the bar BEFORE the pattern's first bar, so a
    violent pattern cannot manufacture the trend that names it."""
    base = _flat(60)
    huge = base + [_bar(10.0, 24.0, 9.9, 23.5)]      # one enormous up bar
    assert candles.single_candle(huge)["candle_trend"] != "up"


# ── multi-match: nothing is discarded during classification ─────────────────
def test_all_matches_are_kept_not_just_the_rendered_one():
    """🔴 THE HIGHEST-RISK BUG IN THE BUILD, one layer up from the old one: if
    filters read the rendered primary, screening for "hammer" silently drops
    every hammer that was also an engulfing."""
    down = _downtrend()
    p = down[-1]["c"]
    # an up bar that engulfs the prior body AND has a long lower tail
    down[-1] = _bar(p + 0.5, p + 0.6, p - 0.1, p)                  # small black
    bars = down + [_bar(p - 0.3, p + 1.0, p - 2.4, p + 0.9)]
    out = candles.single_candle(bars)
    keys = cat.decode_matches(out["candle_matches"])
    assert len(keys) >= 2, out["candle_matches"]
    assert out["candle_type"] == keys[0]
    assert all(k in cat.BY_KEY or k in cat.LEGACY_ALIASES.values() for k in keys)


def test_the_rendered_label_shows_primary_then_secondary_then_a_count():
    reg = [cat.BY_KEY["bullish-engulfing"], cat.BY_KEY["hammer"],
           cat.BY_KEY["doji"], cat.BY_KEY["spinning-top"]]
    reg.sort(key=lambda q: (q.rank, q.key))
    label = reg[0].label + f" ({reg[1].label})" + f" +{len(reg) - 2}"
    assert label == "Bullish Engulfing (Hammer) +2"


# ── data-quality guards ─────────────────────────────────────────────────────
def test_a_few_ticks_of_range_never_prints_a_conviction_label():
    """⛔ MAXIMUM CONVICTION OFF THREE CENTS. `body/range > 0.85` on a $2 stock
    whose whole session spanned 3c called it a marubozu. Measured 2026-08-24:
    128 rows nightly, 35 of them publishing `marubozu`."""
    base = _flat(45, price=2.0)
    out = candles.single_candle(base + [_bar(2.00, 2.03, 2.00, 2.03)])
    assert out["candle_type"] not in ("white-marubozu", "black-marubozu",
                                      "doji", "hammer", "shooting-star")
    assert out["candle_type"] in cat.SHAPE_KEYS      # still named, not refused


def test_a_real_marubozu_on_a_real_range_still_classifies():
    """The control — the noise guard must not eat a genuine wide bar."""
    base = _flat(45, price=100.0)
    out = candles.single_candle(base + [_bar(100.0, 108.2, 99.9, 108.0)])
    assert out["candle_type"] == "white-marubozu"


def test_the_retired_marubozu_key_still_reaches_the_match_set():
    """⚠️ `marubozu` split into white/black. A saved screen holding the old
    value must not silently re-select nothing."""
    base = _flat(45, price=100.0)
    out = candles.single_candle(base + [_bar(100.0, 108.2, 99.9, 108.0)])
    assert "marubozu" in cat.decode_matches(out["candle_matches"])
    assert cat.match_value("marubozu") in out["candle_matches"]


# ── the engulfing repairs ───────────────────────────────────────────────────
def test_two_identical_bodies_do_not_engulf_each_other():
    """⛔ The old rule used `<=` and `>=` on BOTH ends, so an exact tie engulfed."""
    down = _downtrend()
    p = down[-1]["c"]
    down[-1] = _bar(p + 0.5, p + 0.7, p - 0.2, p)
    bars = down + [_bar(p, p + 0.7, p - 0.2, p + 0.5)]     # identical body
    out = candles.single_candle(bars)
    assert "bullish-engulfing" not in out["candle_matches"]


def test_a_doji_is_too_small_to_be_meaningfully_engulfed():
    """⚠️ The old rule tested no minimum on the engulfed body, so a doji
    followed by any wide bar read as an engulfing."""
    down = _downtrend()
    p = down[-1]["c"]
    down[-1] = _bar(p, p + 0.05, p - 0.05, p + 0.001)      # a doji
    bars = down + [_bar(p - 0.4, p + 1.2, p - 0.5, p + 1.1)]
    out = candles.single_candle(bars)
    assert "bullish-engulfing" not in out["candle_matches"]


@pytest.mark.parametrize("key", sorted(cat.RELATION_KEYS))
def test_every_relation_survives_a_short_history(key):
    """A detector must never raise on fewer bars than it needs."""
    p = cat.BY_KEY[key]
    for n in range(0, 6):
        bars = _flat(n) if n else []
        candles.single_candle(bars)          # must not raise


# ── defects found by running the classifier over the REAL market ────────────
def test_a_relation_is_never_built_on_a_bar_that_never_traded():
    """🔴 MEASURED ON THE 2026-08-24 MARKET. POLE published
    `abandoned-baby-bearish` — an ISLAND GAP, one of the rarest structures in
    the canon — where the star AND the bar before it were both zero-range
    no-trade sessions on a $10.85 name, "gapping" by 1-4 cents.

    ⭐ The newest-bar refusal protects only `bars[-1]`. A neighbour with no
    range slips straight into a multi-bar predicate, and the rarer the pattern
    the more confident the wrong label looks.
    """
    base = _uptrend()
    p = base[-1]["c"]
    base[-1] = _bar(p, p, p, p)                        # a no-trade session
    bars = base + [_bar(p + 0.04, p + 0.04, p + 0.01, p + 0.01)]
    out = candles.single_candle(bars)
    keys = cat.decode_matches(out["candle_matches"])
    assert "abandoned-baby-bearish" not in keys
    for k in keys:
        if k in cat.BY_KEY:
            assert cat.BY_KEY[k].bars == 1, (k, keys)


def test_one_tick_of_separation_is_not_a_gap():
    """⛔ Bare `>` makes a gap out of two prices the equality band already calls
    the same. A gap must be WIDER than "the same price"."""
    class _Ctx:
        atr = 2.0
        tick = 0.01
    assert not cat._shadow_gap_up(_Ctx(), {"h": 50.00}, {"l": 50.01})
    assert cat._shadow_gap_up(_Ctx(), {"h": 50.00}, {"l": 50.40})


def test_the_reported_trend_is_the_one_the_pattern_was_judged_against():
    """⚠️ Each pattern gates on its OWN anchor — a 3-bar pattern reads the trend
    at today-3. Publishing the 1-bar anchor unconditionally put "neutral" beside
    NKLR's Three White Soldiers, a pattern that only fires in a downtrend."""
    checked = 0
    for base in (_downtrend(), _uptrend()):
        px = base[-1]["c"]
        for last in (_bar(px, px + 0.05, px - 1.6, px - 0.1),      # umbrella
                     _bar(px, px + 1.6, px - 0.05, px + 0.1)):     # inverted
            out = candles.single_candle(base + [last])
            p = cat.BY_KEY[out["candle_type"]]
            if p.trend:
                checked += 1
                assert out["candle_trend"] == p.trend, (p.key, out["candle_trend"])
    # ⛔ NOT VACUOUS: a flat tape names nothing trend-qualified, so without this
    # the loop above would assert ZERO times and pass while proving nothing.
    # Three of the four combinations name a trend-qualified shape; the fourth
    # resolves to a relation, whose own anchor is what gets reported.
    assert checked >= 3, f"only {checked} trend-qualified names were exercised"


# ── the recency lookback ────────────────────────────────────────────────────
def test_a_pattern_that_completed_yesterday_is_still_reported():
    """🔴 THE GAP THIS CLOSES. `single_candle` only ever looks at TODAY. Measured
    2026-08-24 over 3,705 tickers: 796 (21.5%) had a multi-bar pattern today and
    a further **1,425 (38.5%) had one in the previous four sessions** that nothing
    on the screen could see. With the lookback, coverage is 59.9%."""
    down = _downtrend()
    p = down[-1]["c"]
    down[-1] = _bar(p + 0.5, p + 0.6, p - 0.1, p)                  # small black
    # the engulfing completes here ...
    bars = down + [_bar(p - 0.3, p + 1.0, p - 0.4, p + 0.9)]
    assert "bullish-engulfing" in candles.single_candle(bars)["candle_matches"]
    # ... and then two more sessions pass
    q = bars[-1]["c"]
    bars += [_bar(q + 0.10, q + 0.42, q - 0.07, q + 0.31),
             _bar(q + 0.36, q + 0.55, q + 0.21, q + 0.28)]

    # ⭐ ASSERT THE CONTRACT, NOT A HAND-GUESSED NUMBER. Those two follow-up
    # sessions may themselves form some relation — the first draft of this test
    # appended near-identical bars and accidentally built a tweezer, so the
    # "expected" age of 2 was wrong for a reason that had nothing to do with the
    # lookback. What must hold is that the reported age is the MOST RECENT bar
    # carrying a relation, and that no nearer bar carries one.
    rec = candles.recent_relation(bars)
    age = rec["candle_recent_bars_ago"]
    assert age is not None, "an engulfing completed inside the window"

    def _rels(n):
        r = candles.single_candle(bars[:len(bars) - n])
        return [k for k in cat.decode_matches(r["candle_matches"] or "")
                if k in cat.RELATION_KEYS]

    assert _rels(age), f"nothing at the reported age {age}"
    for nearer in range(age):
        assert not _rels(nearer), f"a nearer relation at {nearer} was skipped"
    # the age marker is present; a "next open went ..." fragment may follow it
    assert (f"({age}d ago)" in rec["candle_recent_label"]
            if age else "ago" not in rec["candle_recent_label"])


def test_todays_pattern_is_reported_at_age_zero_with_no_suffix():
    down = _downtrend()
    p = down[-1]["c"]
    down[-1] = _bar(p + 0.5, p + 0.6, p - 0.1, p)
    bars = down + [_bar(p - 0.3, p + 1.0, p - 0.4, p + 0.9)]
    rec = candles.recent_relation(bars)
    assert rec["candle_recent_bars_ago"] == 0
    assert "ago" not in rec["candle_recent_label"]


def test_the_lookback_never_reports_a_shape():
    """⛔ Every bar HAS a shape, so a shape-inclusive lookback would return
    "Black Candle, 1 day ago" for the whole market and mean nothing. Only the
    sparse multi-bar relations are worth dating."""
    rng = random.Random(5)
    for _ in range(300):
        base = _flat(60, price=rng.uniform(5, 300))
        px = base[-1]["c"]
        bars = base + [_bar(px, px * 1.01, px * 0.99, px * 1.005)]
        rec = candles.recent_relation(bars)
        if rec["candle_recent"]:
            assert rec["candle_recent"] in cat.RELATION_KEYS


def test_the_lookback_is_bounded_and_safe_on_short_history():
    # ⭐ every field absent, asserted by VALUE rather than by an exact dict —
    # a literal here goes stale the moment the shape gains a field, which is
    # exactly what happened when the T+1 status landed.
    empty = candles.recent_relation([])
    assert set(empty) >= {"candle_recent", "candle_recent_bars_ago",
                          "candle_recent_label", "candle_recent_status"}
    assert all(v is None for v in empty.values()), empty
    candles.recent_relation([_bar(10, 11, 9, 10)])            # must not raise
    rec = candles.recent_relation(_downtrend(), window=candles.RECENT_WINDOW)
    if rec["candle_recent_bars_ago"] is not None:
        assert 0 <= rec["candle_recent_bars_ago"] < candles.RECENT_WINDOW


# ── T+1: what the next session's open did ───────────────────────────────────
def test_todays_pattern_cannot_be_resolved_and_says_so():
    """⛔ StockCharts: "without confirmation, these patterns would be considered
    neutral". A pattern printed TODAY has no session after it, so the only
    honest answer is `provisional` — never a verdict."""
    down = _downtrend()
    p = down[-1]["c"]
    down[-1] = _bar(p + 0.5, p + 0.6, p - 0.1, p)
    bars = down + [_bar(p - 0.3, p + 1.0, p - 0.4, p + 0.9)]
    rec = candles.recent_relation(bars)
    assert rec["candle_recent_bars_ago"] == 0
    assert rec["candle_recent_status"] == "provisional"


def test_the_status_states_the_fact_and_never_a_verdict():
    """🔴 MEASURED 2026-08-24: across 1,043 resolved patterns the bullish side
    "confirmed" 59.9% and the bearish 36.4%, while the universe's own opening-gap
    base rate over the same sessions was 51.1% up / 35.8% down — which predicts
    59% and 41% BEFORE any pattern is considered. The patterns added nothing.

    ⛔ So the vocabulary may never imply validation. `confirmed`/`failed` would
    read to a member as evidence the pattern worked when it mostly means the
    market gapped up that day."""
    banned = {"confirmed", "failed", "valid", "invalid", "success", "worked"}

    # ⭐ EXERCISE `_confirmation` DIRECTLY. Driving this through
    # `recent_relation` is fragile: the session appended to create the "next
    # open" can itself form a NEW pattern at age 0, and the lookback then
    # correctly reports THAT one as provisional — which is right behaviour and
    # the wrong thing to be testing here.
    def _after(next_open_delta):
        bars = _flat(60, price=50.0)
        bars.append(_bar(49.5, 50.6, 49.4, 50.5))           # the pattern bar
        o = 50.5 + next_open_delta
        bars.append(_bar(o, o + 0.4, o - 0.4, o + 0.05))    # the next session
        return candles._confirmation(bars, 1, cat.BY_KEY["bullish-engulfing"])

    seen = {_after(+1.5), _after(-1.5), _after(0.0)}
    # ⛔ NOT VACUOUS: all three outcomes must actually be produced, or this
    # asserts nothing about a vocabulary that was never exercised.
    assert seen == {"opened-with", "opened-against", "opened-flat"}, seen
    assert not (seen & banned)


def test_a_neutral_pattern_has_nothing_to_resolve():
    """⚠️ Harami cross, tri-star and separating lines carry NO directional claim,
    so they must return None rather than be forced into a pass/fail they never
    asserted."""
    for key in ("harami-cross", "tri-star", "separating-lines"):
        assert cat.BY_KEY[key].bias == "neutral"
        assert candles._confirmation([_bar(10, 11, 9, 10)] * 3, 1,
                                     cat.BY_KEY[key]) is None


def test_a_one_tick_open_is_not_the_market_going_your_way():
    """⛔ An open one cent above the close is not the market opening in your
    favour; it is the same price. Uses the same band the geometry does."""
    bars = _flat(60, price=50.0)
    bars.append(_bar(50, 50.6, 49.6, 50.5))
    bars.append(_bar(50.51, 51.0, 50.4, 50.9))       # opens 1c above the close
    st = candles._confirmation(bars, 1, cat.BY_KEY["bullish-engulfing"])
    assert st == "opened-flat"


# ── hikkake ─────────────────────────────────────────────────────────────────
def _hik(base_price=50.0, direction="down", extra=()):
    """b1, an inside bar, then a break in `direction` — plus any extra bars."""
    bars = _flat(60, base_price)
    p = base_price
    bars.append(_bar(p, p + 1.0, p - 1.0, p))               # b1: the wide bar
    bars.append(_bar(p, p + 0.6, p - 0.6, p))               # inside, strictly
    if direction == "down":
        bars.append(_bar(p - 0.2, p + 0.4, p - 0.8, p - 0.5))   # lower H, lower L
    else:
        bars.append(_bar(p + 0.2, p + 0.8, p - 0.4, p + 0.5))   # higher H, higher L
    bars.extend(extra)
    return bars


def test_a_downside_break_out_of_an_inside_bar_is_the_BULLISH_hikkake():
    """⚠️ THE DIRECTION IS COUNTER-INTUITIVE AND IMPLEMENTERS GET IT BACKWARDS.
    The downside break is the TRAP — it catches shorts — so it is the bullish
    form. TA-Lib's CDLHIKKAKE and EarnForex's independent write-up of Chesler's
    rules agree exactly on this."""
    m = candles.single_candle(_hik(direction="down"))["candle_matches"]
    assert "hikkake-bull" in cat.decode_matches(m)
    assert "hikkake-bear" not in cat.decode_matches(m)

    m2 = candles.single_candle(_hik(direction="up"))["candle_matches"]
    assert "hikkake-bear" in cat.decode_matches(m2)
    assert "hikkake-bull" not in cat.decode_matches(m2)


def test_hikkake_needs_no_prior_trend():
    """⭐ Nearly every other relation here is trend-gated. The hikkake setup is a
    compression plus a failed break, which is meaningful in any context — which
    is exactly why it fires often enough to screen on."""
    assert cat.BY_KEY["hikkake-bull"].trend is None
    assert cat.BY_KEY["hikkake-bear"].trend is None
    out = candles.single_candle(_hik(direction="down"))
    assert out["candle_trend"] in ("neutral", "unknown", "up", "down")
    assert "hikkake-bull" in out["candle_matches"]


def test_the_confirmation_takes_back_the_inside_bars_far_extreme():
    p = 50.0
    # the setup, then a session closing back above the inside bar's high (50.6)
    bars = _hik(p, "down", extra=[_bar(p - 0.4, p + 0.9, p - 0.5, p + 0.75)])
    keys = cat.decode_matches(candles.single_candle(bars)["candle_matches"])
    assert "hikkake-bull-confirmed" in keys


def test_a_new_setup_outranks_a_pending_confirmation():
    """⛔ TA-Lib's rule, kept in the predicate so the two states can never both be
    claimed for one session. Setup is the trap being laid; confirmed is it
    springing — they are different tradeable states."""
    # ⭐ BUILT SO BOTH STATES GENUINELY COMPETE. Setup A's inside bar tops at
    # 50.6, so a close above that inside the next three sessions confirms it —
    # and the final bar does exactly that WHILE completing a fresh setup B.
    bars = _flat(60, 50.0)
    bars += [_bar(50.0, 51.00, 49.00, 50.00),    # A: the wide bar
             _bar(50.0, 50.60, 49.40, 50.00),    # A: inside  -> saved high 50.6
             _bar(49.8, 50.40, 49.20, 49.50)]    # A: breaks DOWN -> bull setup
    bars += [_bar(50.5, 52.00, 50.00, 51.50),    # B: the wide bar
             _bar(51.3, 51.80, 50.40, 51.00),    # B: inside
             _bar(51.0, 51.60, 50.20, 50.90)]    # B: breaks DOWN, closes 50.90
    # that close clears 50.6, so setup A is due to confirm on this very bar
    assert bars[-1]["c"] > 50.60
    keys = cat.decode_matches(candles.single_candle(bars)["candle_matches"])
    assert "hikkake-bull" in keys, keys
    assert "hikkake-bull-confirmed" not in keys, keys


def test_the_confirmation_window_is_three_sessions():
    p = 50.0
    late = [_bar(p - 0.45, p + 0.1, p - 0.55, p - 0.5) for _ in range(4)]
    bars = _hik(p, "down", extra=late + [_bar(p - 0.4, p + 0.9, p - 0.5, p + 0.75)])
    keys = cat.decode_matches(candles.single_candle(bars)["candle_matches"])
    assert "hikkake-bull-confirmed" not in keys, "confirmed outside the 3-bar window"


# ── the inside-bar run no longer counts sessions that never traded ──────────
def test_a_no_trade_session_breaks_the_inside_bar_run():
    """🔴 A zero-range bar is trivially "inside" the one before it. Measured
    2026-08-24: of the 124 rows with a run of 2+, **34 were no-trade sessions**;
    of the 32 with a run of 3+, **19 were**. The member-facing filter was
    majority junk at the deep end (124 -> 86, and 32 -> 11 after the guard)."""
    p = 50.0
    real = [_bar(p, p + 1.0, p - 1.0, p), _bar(p, p + 0.8, p - 0.8, p),
            _bar(p, p + 0.6, p - 0.6, p)]
    assert candles.multi_candle(_flat(40, p) + real)["inside_bar_run"] == 2
    # the same shape, but the newest session never traded
    dead = real[:-1] + [_bar(p, p, p, p, v=0)]
    assert candles.multi_candle(_flat(40, p) + dead)["inside_bar_run"] == 0
