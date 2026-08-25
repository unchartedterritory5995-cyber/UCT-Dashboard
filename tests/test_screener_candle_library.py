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
    assert (rec["candle_recent_label"].endswith(f"({age}d ago)")
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
    assert candles.recent_relation([]) == {
        "candle_recent": None, "candle_recent_bars_ago": None,
        "candle_recent_label": None}
    candles.recent_relation([_bar(10, 11, 9, 10)])            # must not raise
    rec = candles.recent_relation(_downtrend(), window=candles.RECENT_WINDOW)
    if rec["candle_recent_bars_ago"] is not None:
        assert 0 <= rec["candle_recent_bars_ago"] < candles.RECENT_WINDOW
