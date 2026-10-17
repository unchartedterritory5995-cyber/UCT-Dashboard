"""Display-only secondary geometry on the eight UCT trader-setup detectors.

Each uct_* detector's primary geometry is a `candle_mark` on the trigger
session. The detector's own computation also holds drawable structure (the
launch pad's range, the gap edge, the prior low, the moving-average level it
judged against). That structure is now emitted as `geometry.secondary`:

    [{"shape": "rectangle" | "horizontal_line",
      "anchors": [{"t": <bar t>, "price": float}, ...],
      "role": "<snake_case>", "label": "<short human label>"}, ...]

What this file proves, in order:

1. FIRING AND CONFIDENCE ARE BYTE-IDENTICAL TO BEFORE. `BASELINE` was captured
   by running every fixture of all eight detectors BEFORE the change, hashing
   the whole detection minus its volatile fields (id, detected_at,
   last_seen_at) and minus `geometry.secondary`. Every fixture must reproduce
   its pre-change (confidence, digest), and every fixture that did not fire
   must still not fire. Narrative, levels, extras, anchors and quality
   components are all inside the digest, so this is stronger than a confidence
   check.
2. THE PRICES ARE THE DETECTOR'S OWN NUMBERS, recomputed here independently
   from the bars (the indicator series are re-derived in this file, not read
   back from the detector's module).
3. EVERY ANCHOR TIME IS A REAL BAR `t`, never an index, and none is later than
   the signal bar (no lookahead). The one exception is uct_hve's level, which
   runs to the newest bar the detector itself already read to decide the
   setup was still intact; it is asserted separately.

Synthetic-bar fixtures only (tests/fixtures/uct_*).
"""
import hashlib
import importlib
import json

import pytest

from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures

IDS = (
    "uct_launch_pad", "uct_gap_support", "uct_capitulation", "uct_go_signal",
    "uct_kicker", "uct_oops_reversal", "uct_slingshot", "uct_hve",
)

#: Pre-change (confidence, digest) per fixture; None = the fixture did not fire.
#: Captured from the detectors at the commit this branch was cut from, before
#: `geometry.secondary` existed.
BASELINE = {
    'uct_capitulation/edge_close_within_1atr_of_band_AAPL_20230804.json': None,
    'uct_capitulation/edge_intact_trigger_2_sessions_back_AMZN_20260206.json': (77.3, 'cf7e038e777c10ab'),
    'uct_capitulation/edge_penny_scaled_AAPL_20230804.json': None,
    'uct_capitulation/edge_stopped_out_after_trigger_AAPL_20230804.json': None,
    'uct_capitulation/neg_no_cascade_GOOGL_20260723.json': None,
    'uct_capitulation/neg_no_cascade_NFLX_20240419.json': None,
    'uct_capitulation/neg_not_below_band_by_1atr_META_20240717.json': None,
    'uct_capitulation/neg_not_below_band_by_1atr_MSFT_20250407.json': None,
    'uct_capitulation/neg_quiet_session_AAPL_20230302.json': None,
    'uct_capitulation/neg_quiet_session_AMZN_20230302.json': None,
    'uct_capitulation/neg_quiet_session_MSFT_20230302.json': None,
    'uct_capitulation/neg_quiet_session_NVDA_20230302.json': None,
    'uct_capitulation/pos_1_AAPL_20230804.json': (72.75, '2299155d0dee91aa'),
    'uct_capitulation/pos_2_AMZN_20260206.json': (77.3, '2c3eb1d15d245b09'),
    'uct_capitulation/pos_3_NFLX_20240422.json': (63.92, 'c3e10cba7509ad9b'),
    'uct_capitulation/pos_4_INTC_20240802.json': (80.5, '6301573b6e62ac12'),
    'uct_capitulation/pos_5_MU_20250404.json': (71.53, '955483218a9fa2fa'),
    'uct_capitulation/pos_6_COIN_20260205.json': (80.5, 'ccce90d47b803967'),
    'uct_gap_support/edge_intact_trigger_2_sessions_back_AAPL_20240508.json': (65.5, '6529807434fd5906'),
    'uct_gap_support/edge_low_above_gap_AAPL_20240508.json': None,
    'uct_gap_support/edge_penny_scaled_AAPL_20240508.json': None,
    'uct_gap_support/edge_stopped_out_after_trigger_MSFT_20250818.json': None,
    'uct_gap_support/neg_gap_filled_MSFT_20231030.json': None,
    'uct_gap_support/neg_gap_filled_NVDA_20230601.json': None,
    'uct_gap_support/neg_no_touch_AAPL_20240507.json': None,
    'uct_gap_support/neg_no_touch_MSFT_20230524.json': None,
    'uct_gap_support/neg_open_only_touch_AMZN_20221117.json': None,
    'uct_gap_support/neg_open_only_touch_NVDA_20260909.json': None,
    'uct_gap_support/neg_quiet_session_AAPL_20221011.json': None,
    'uct_gap_support/neg_quiet_session_AMZN_20221011.json': None,
    'uct_gap_support/neg_quiet_session_MSFT_20221011.json': None,
    'uct_gap_support/neg_quiet_session_NVDA_20221011.json': None,
    'uct_gap_support/neg_small_gap_AAPL_20220829.json': None,
    'uct_gap_support/neg_small_gap_MSFT_20230217.json': None,
    'uct_gap_support/pos_1_AAPL_20240508.json': (65.5, 'b4b8c18f3fed19ea'),
    'uct_gap_support/pos_2_MSFT_20250804.json': (67.75, 'b34195e7fd12984c'),
    'uct_gap_support/pos_3_NVDA_20230302.json': (67.5, '48e6d395b207c5e6'),
    'uct_gap_support/pos_4_AMZN_20221118.json': (57.5, '8dd4e3edc6ab8c90'),
    'uct_gap_support/pos_5_META_20230224.json': (69.5, '55c7d31b40ad816b'),
    'uct_gap_support/pos_6_GOOGL_20230207.json': (73.33, '39467ba76de5776d'),
    'uct_go_signal/edge_close_mid_range_AAPL_20230217.json': None,
    'uct_go_signal/edge_intact_trigger_2_sessions_back_AAPL_20230524.json': (69.5, '4a3288cef860d58e'),
    'uct_go_signal/edge_penny_scaled_AAPL_20230217.json': None,
    'uct_go_signal/edge_stopped_out_after_trigger_AAPL_20230217.json': None,
    'uct_go_signal/neg_ema20_falling_AAPL_20220901.json': None,
    'uct_go_signal/neg_ema20_falling_MSFT_20220714.json': None,
    'uct_go_signal/neg_opened_above_AAPL_20220824.json': None,
    'uct_go_signal/neg_opened_above_MSFT_20221122.json': None,
    'uct_go_signal/neg_quiet_session_AAPL_20221011.json': None,
    'uct_go_signal/neg_quiet_session_AMZN_20221011.json': None,
    'uct_go_signal/neg_quiet_session_MSFT_20221011.json': None,
    'uct_go_signal/neg_quiet_session_NVDA_20221011.json': None,
    'uct_go_signal/neg_weak_close_AAPL_20221116.json': None,
    'uct_go_signal/neg_weak_close_MSFT_20221114.json': None,
    'uct_go_signal/pos_1_AAPL_20230217.json': (67.5, '12524fb512bf6125'),
    'uct_go_signal/pos_2_MSFT_20221117.json': (61.5, 'e856e854df4464cf'),
    'uct_go_signal/pos_3_NVDA_20220725.json': (65.5, 'cacb170329372b6e'),
    'uct_go_signal/pos_4_AMZN_20220818.json': (71.5, '29a591704347423c'),
    'uct_go_signal/pos_5_META_20220809.json': (65.5, '7e53fffee3678c5a'),
    'uct_go_signal/pos_6_GOOGL_20221116.json': (63.5, '4c76d66442dff51e'),
    'uct_hve/edge_intact_trigger_2_sessions_back_AAPL_20240611.json': (86.5, '47ffb8beb4ffc888'),
    'uct_hve/edge_penny_scaled_AAPL_20240229.json': None,
    'uct_hve/edge_volume_ties_prior_max_AAPL_20240229.json': None,
    'uct_hve/neg_only_26wk_high_AAPL_20250409.json': None,
    'uct_hve/neg_only_26wk_high_MSFT_20231215.json': None,
    'uct_hve/neg_quiet_session_AAPL_20230721.json': None,
    'uct_hve/neg_quiet_session_AMZN_20230721.json': None,
    'uct_hve/neg_quiet_session_MSFT_20230721.json': None,
    'uct_hve/neg_quiet_session_NVDA_20230721.json': None,
    'uct_hve/neg_second_highest_AMZN_20240802.json': None,
    'uct_hve/neg_second_highest_MSFT_20240920.json': None,
    'uct_hve/pos_1_AAPL_20240229.json': (76.75, '4e1cbcaf4afaefa6'),
    'uct_hve/pos_2_MSFT_20241220.json': (69.75, '347333424fee4d97'),
    'uct_hve/pos_3_NVDA_20230525.json': (88.5, 'd9603f63f0e10dc8'),
    'uct_hve/pos_4_AMZN_20251031.json': (86.5, '9242627486a4317f'),
    'uct_hve/pos_5_META_20251030.json': (82.5, 'fdc6269ba2dc3a75'),
    'uct_hve/pos_6_GOOGL_20250205.json': (69.92, '7310416a9c98dbf4'),
    'uct_kicker/edge_gap_just_under_a_tenth_of_range_AAPL_20220712.json': None,
    'uct_kicker/edge_intact_trigger_2_sessions_back_AAPL_20220727.json': (71.5, '93defff504721300'),
    'uct_kicker/edge_penny_scaled_AAPL_20220712.json': None,
    'uct_kicker/edge_stopped_out_after_trigger_AAPL_20220712.json': None,
    'uct_kicker/neg_gap_too_small_AAPL_20221122.json': None,
    'uct_kicker/neg_gap_too_small_MSFT_20221121.json': None,
    'uct_kicker/neg_no_break_of_prior_high_AAPL_20220628.json': None,
    'uct_kicker/neg_no_break_of_prior_high_MSFT_20220629.json': None,
    'uct_kicker/neg_no_gap_up_AAPL_20221013.json': None,
    'uct_kicker/neg_no_gap_up_MSFT_20220701.json': None,
    'uct_kicker/neg_quiet_session_AAPL_20221011.json': None,
    'uct_kicker/neg_quiet_session_AMZN_20221011.json': None,
    'uct_kicker/neg_quiet_session_MSFT_20221011.json': None,
    'uct_kicker/neg_quiet_session_NVDA_20221011.json': None,
    'uct_kicker/neg_red_prior_closed_high_AAPL_20230227.json': None,
    'uct_kicker/neg_red_prior_closed_high_MSFT_20230725.json': None,
    'uct_kicker/neg_strong_prior_close_AAPL_20220627.json': None,
    'uct_kicker/neg_strong_prior_close_MSFT_20220706.json': None,
    'uct_kicker/pos_1_AAPL_20220712.json': (63.5, '182b42e720281c1e'),
    'uct_kicker/pos_2_MSFT_20220718.json': (61.5, 'd64df510a8199653'),
    'uct_kicker/pos_3_NVDA_20220719.json': (73.3, '27d8241c96bacca6'),
    'uct_kicker/pos_4_AMZN_20220719.json': (71.5, '56f474c8eb5be607'),
    'uct_kicker/pos_5_META_20220715.json': (69.5, 'bbe61e8119ec4008'),
    'uct_kicker/pos_6_GOOGL_20220718.json': (62.4, 'a2a14ae4b818d638'),
    'uct_launch_pad/edge_extended_close_AAPL_20221123.json': None,
    'uct_launch_pad/edge_intact_trigger_2_sessions_back_AAPL_20230130.json': (57.5, '0c78b9e4efcb84ed'),
    'uct_launch_pad/edge_penny_scaled_AAPL_20221123.json': None,
    'uct_launch_pad/edge_stopped_out_after_trigger_AAPL_20221123.json': None,
    'uct_launch_pad/neg_extended_above_AAPL_20230126.json': None,
    'uct_launch_pad/neg_extended_above_MSFT_20221130.json': None,
    'uct_launch_pad/neg_not_converged_AAPL_20230206.json': None,
    'uct_launch_pad/neg_not_converged_MSFT_20221205.json': None,
    'uct_launch_pad/neg_quiet_session_AAPL_20230302.json': None,
    'uct_launch_pad/neg_quiet_session_AMZN_20230302.json': None,
    'uct_launch_pad/neg_quiet_session_MSFT_20230302.json': None,
    'uct_launch_pad/neg_quiet_session_NVDA_20230302.json': None,
    'uct_launch_pad/neg_sma50_falling_AAPL_20221111.json': None,
    'uct_launch_pad/neg_sma50_falling_MSFT_20221111.json': None,
    'uct_launch_pad/pos_1_AAPL_20221123.json': (63.5, 'c6e5514b07d5271e'),
    'uct_launch_pad/pos_2_MSFT_20230123.json': (62.25, 'bc1989f5653024ee'),
    'uct_launch_pad/pos_3_NVDA_20230110.json': (59.5, '03dc04e14c657342'),
    'uct_launch_pad/pos_4_AMZN_20230315.json': (57.5, 'c26e7e67e972134f'),
    'uct_launch_pad/pos_5_META_20230905.json': (63.5, 'e9c3bcc0b9719176'),
    'uct_launch_pad/pos_6_GOOGL_20221205.json': (63.5, '69e2c285a6f26389'),
    'uct_oops_reversal/edge_intact_trigger_2_sessions_back_AAPL_20220809.json': (67.5, 'ca1281bd098d918b'),
    'uct_oops_reversal/edge_low_equals_prior_low_AAPL_20220809.json': None,
    'uct_oops_reversal/edge_penny_scaled_AAPL_20220809.json': None,
    'uct_oops_reversal/edge_stopped_out_after_trigger_AAPL_20220901.json': None,
    'uct_oops_reversal/neg_closed_back_under_AAPL_20220713.json': None,
    'uct_oops_reversal/neg_closed_back_under_MSFT_20220628.json': None,
    'uct_oops_reversal/neg_no_undercut_v3_AAPL_20220701.json': None,
    'uct_oops_reversal/neg_no_undercut_v3_MSFT_20220701.json': None,
    'uct_oops_reversal/neg_opened_above_AAPL_20220629.json': None,
    'uct_oops_reversal/neg_opened_above_MSFT_20220629.json': None,
    'uct_oops_reversal/neg_quiet_session_AAPL_20230721.json': None,
    'uct_oops_reversal/neg_quiet_session_AMZN_20231207.json': None,
    'uct_oops_reversal/neg_quiet_session_MSFT_20221011.json': None,
    'uct_oops_reversal/neg_quiet_session_NVDA_20230721.json': None,
    'uct_oops_reversal/neg_reclaimed_low_not_close_AAPL_20220630.json': None,
    'uct_oops_reversal/neg_reclaimed_low_not_close_MSFT_20220630.json': None,
    'uct_oops_reversal/pos_1_AAPL_20220809.json': (67.5, 'db5c429d7031ff83'),
    'uct_oops_reversal/pos_2_MSFT_20220714.json': (71.5, '80087c718ff42825'),
    'uct_oops_reversal/pos_3_NVDA_20220705.json': (64.4, '651fe553c44ba781'),
    'uct_oops_reversal/pos_4_AMZN_20220629.json': (57.5, '440933dd28c6dd54'),
    'uct_oops_reversal/pos_5_META_20220713.json': (63.5, '79eaf2d3eadf5cbf'),
    'uct_oops_reversal/pos_6_GOOGL_20220705.json': (67.5, '1a2cdf51361b251f'),
    'uct_slingshot/edge_close_just_under_sma50_AAPL_20221130.json': None,
    'uct_slingshot/edge_intact_trigger_2_sessions_back_AAPL_20221130.json': (67.38, 'eaa12bd05d1c5c9c'),
    'uct_slingshot/edge_penny_scaled_AAPL_20221130.json': None,
    'uct_slingshot/edge_stopped_out_after_trigger_AAPL_20240503.json': None,
    'uct_slingshot/neg_below_sma50_AAPL_20220705.json': None,
    'uct_slingshot/neg_below_sma50_MSFT_20220705.json': None,
    'uct_slingshot/neg_no_strength_day_AAPL_20220714.json': None,
    'uct_slingshot/neg_no_strength_day_MSFT_20220720.json': None,
    'uct_slingshot/neg_pullback_too_short_AAPL_20220719.json': None,
    'uct_slingshot/neg_pullback_too_short_MSFT_20220803.json': None,
    'uct_slingshot/neg_quiet_session_AAPL_20221011.json': None,
    'uct_slingshot/neg_quiet_session_AMZN_20221011.json': None,
    'uct_slingshot/neg_quiet_session_MSFT_20221011.json': None,
    'uct_slingshot/neg_quiet_session_NVDA_20221011.json': None,
    'uct_slingshot/pos_1_AAPL_20221130.json': (65.38, '119b39df283dc78e'),
    'uct_slingshot/pos_2_MSFT_20220727.json': (72.0, '434226b24cde47a1'),
    'uct_slingshot/pos_3_NVDA_20220727.json': (67.72, 'f54b2d5c3d53ac9d'),
    'uct_slingshot/pos_4_AMZN_20220810.json': (73.5, '63db7442c5fe3d0b'),
    'uct_slingshot/pos_5_META_20220810.json': (69.5, '9c8a963fe7cbab6f'),
    'uct_slingshot/pos_6_GOOGL_20220727.json': (67.55, 'bbf5cf1e517c8e63'),
}


def _detect_fn(pid):
    mod = importlib.import_module(f"api.services.pattern_engine.detectors.uct.{pid}")
    return getattr(mod, "detect_" + pid)


def _ctx(f):
    return f.context if f.context is not None else build_context(f.bars, sym="TEST")


def _digest(d):
    d = json.loads(json.dumps(d))
    for k in ("id", "detected_at", "last_seen_at"):
        d.pop(k, None)
    d.get("geometry", {}).pop("secondary", None)
    return hashlib.sha256(json.dumps(d, sort_keys=True).encode()).hexdigest()[:16]


def _all_fixture_cases():
    return [(pid, f) for pid in IDS for f in load_all_fixtures(pid)]


# --------------------------------------------------------------------------
# 1. firing / confidence / everything-but-secondary unchanged
# --------------------------------------------------------------------------
def test_the_baseline_covers_every_fixture_and_is_not_vacuous():
    keys = {f"{pid}/{f.source_filename}" for pid, f in _all_fixture_cases()}
    assert keys == set(BASELINE), sorted(keys ^ set(BASELINE))
    fired = [k for k, v in BASELINE.items() if v]
    # non-vacuity: every one of the eight detectors fired on some fixture
    assert {k.split("/")[0] for k in fired} == set(IDS)
    assert len(fired) >= 40


@pytest.mark.parametrize("pid,fixture", _all_fixture_cases(),
                         ids=lambda x: getattr(x, "source_filename", x))
def test_detection_is_byte_identical_to_before_apart_from_secondary(pid, fixture):
    out = _detect_fn(pid)(fixture.bars, _ctx(fixture))
    want = BASELINE[f"{pid}/{fixture.source_filename}"]
    if want is None:
        assert out == []
        return
    assert out, "fired before the change, does not fire now"
    d = out[0]
    assert (d["confidence"], _digest(d)) == tuple(want)
    assert d["quality_components"]["historical_score"] == 50.0
    assert d["geometry"]["shape"] == "candle_mark"


# --------------------------------------------------------------------------
# 2/3. shape contract, real bar times, no lookahead (every firing fixture)
# --------------------------------------------------------------------------
def _fired_cases():
    out = []
    for pid, f in _all_fixture_cases():
        if BASELINE[f"{pid}/{f.source_filename}"]:
            out.append((pid, f))
    return out


@pytest.mark.parametrize("pid,fixture", _fired_cases(),
                         ids=lambda x: getattr(x, "source_filename", x))
def test_secondary_contract_holds_on_every_firing_fixture(pid, fixture):
    bars = fixture.bars
    d = _detect_fn(pid)(bars, _ctx(fixture))[0]
    sec = d["geometry"]["secondary"]
    assert sec, "every uct detector emits secondary geometry"
    ts = [int(b["t"]) for b in bars]
    tset = set(ts)
    i = len(bars) - 1 - d["geometry"]["extras"]["trigger_bars_ago"]
    sig_t = ts[i]
    for s in sec:
        assert set(s) == {"shape", "anchors", "role", "label"}
        assert s["shape"] in ("rectangle", "horizontal_line")
        assert len(s["anchors"]) == 2
        assert s["role"] and s["role"] == s["role"].lower() and " " not in s["role"]
        assert isinstance(s["label"], str) and s["label"].strip()
        t0, t1 = (a["t"] for a in s["anchors"])
        assert isinstance(t0, int) and isinstance(t1, int)
        assert t0 in tset and t1 in tset, "anchor t must be a real bar time, never an index"
        assert t0 <= t1
        for a in s["anchors"]:
            assert isinstance(a["price"], float) and a["price"] > 0
        if s["shape"] == "horizontal_line":
            assert s["anchors"][0]["price"] == s["anchors"][1]["price"]
        else:
            assert s["anchors"][0]["price"] >= s["anchors"][1]["price"], "rectangle is [top, floor]"
        if pid == "uct_hve":
            assert t0 == sig_t and t1 == ts[-1]
        else:
            assert t1 <= sig_t, "no lookahead past the signal bar"


# --------------------------------------------------------------------------
# independent indicator re-derivations (not imported from the detector)
# --------------------------------------------------------------------------
def _ema(xs, n):
    a, e, out = 2.0 / (n + 1), None, []
    for x in xs:
        e = x if e is None else e + a * (x - e)
        out.append(e)
    return out


def _sma_at(xs, n, k):
    return sum(xs[k - n + 1:k + 1]) / n


def _first_positive(pid):
    f = [f for f in load_all_fixtures(pid) if f.category == "positive"][0]
    d = _detect_fn(pid)(f.bars, _ctx(f))[0]
    i = len(f.bars) - 1 - d["geometry"]["extras"]["trigger_bars_ago"]
    by_role = {}
    for s in d["geometry"]["secondary"]:
        by_role.setdefault(s["role"], []).append(s)
    return f.bars, d, i, by_role


def _one(by_role, role):
    assert len(by_role[role]) == 1, (role, by_role.get(role))
    return by_role[role][0]


def _span(s):
    return s["anchors"][0]["t"], s["anchors"][1]["t"]


def _level(s):
    return s["anchors"][0]["price"]


def test_launch_pad_draws_its_pad_box_pivot_and_ma_cluster():
    bars, d, i, by = _first_positive("uct_launch_pad")
    seg = bars[i - 5:i + 1]
    pad = _one(by, "pad")
    assert pad["shape"] == "rectangle"
    assert _span(pad) == (bars[i - 5]["t"], bars[i]["t"])
    assert pad["anchors"][0]["price"] == max(b["h"] for b in seg)
    assert pad["anchors"][1]["price"] == min(b["l"] for b in seg)
    assert pad["label"] == "Pad 6 bars"
    piv = _one(by, "pivot")
    assert _level(piv) == max(b["h"] for b in seg)
    assert piv["label"] == f"Pad pivot {max(b['h'] for b in seg):.2f}"
    c = [b["c"] for b in bars]
    top = max(_ema(c, 8)[i], _ema(c, 21)[i], _sma_at(c, 50, i))
    assert _level(_one(by, "ma")) == pytest.approx(top, rel=1e-12)


def test_gap_support_draws_the_gap_edge_and_gap_day_low():
    bars, d, i, by = _first_positive("uct_gap_support")
    g = [k for k, b in enumerate(bars) if b["t"] == d["geometry"]["extras"]["gap_t"]][0]
    edge = _one(by, "gap_edge")
    assert _level(edge) == bars[g - 1]["h"]          # the gap top: prior day's high
    assert _span(edge) == (bars[g - 1]["t"], bars[i]["t"])
    low = _one(by, "gap_low")
    assert _level(low) == bars[g]["l"]
    assert bars[g]["l"] > bars[g - 1]["h"], "a true gap: the edge sits below the gap-day low"
    assert _span(low) == (bars[g]["t"], bars[i]["t"])


def test_capitulation_draws_the_flush_low_and_lower_band():
    bars, d, i, by = _first_positive("uct_capitulation")
    assert _level(_one(by, "flush_low")) == bars[i]["l"]
    w = [b["c"] for b in bars[i - 19:i + 1]]
    m = sum(w) / 20
    sd = (sum((x - m) ** 2 for x in w) / 20) ** 0.5
    band = _one(by, "band")
    assert _level(band) == pytest.approx(m - 2 * sd, rel=1e-12)
    assert _span(band) == (bars[i - 4]["t"], bars[i]["t"])


def test_go_signal_draws_the_prior_close_and_each_swept_level():
    bars, d, i, by = _first_positive("uct_go_signal")
    pc = _one(by, "prior_close")
    assert _level(pc) == bars[i - 1]["c"]
    assert _span(pc) == (bars[i - 1]["t"], bars[i]["t"])
    swept = d["geometry"]["extras"]["swept"]
    n_lines = len(by.get("swept_low", [])) + len(by.get("ma", []))
    assert n_lines == len(swept) >= 1
    lo = bars[i]["l"]
    c = [b["c"] for b in bars]
    expect = {"prior_low": bars[i - 1]["l"],
              "5bar_low": min(b["l"] for b in bars[i - 5:i]),
              "ema9": _ema(c, 9)[i], "ema20": _ema(c, 20)[i], "sma50": _sma_at(c, 50, i)}
    words = {"prior_low": "prior low", "5bar_low": "5-day low", "ema9": "9 EMA",
             "ema20": "20 EMA", "sma50": "50 SMA"}
    lines = by.get("swept_low", []) + by.get("ma", [])
    for name in swept:
        hit = [s for s in lines if f"Swept {words[name]} " in s["label"]]
        assert len(hit) == 1, name
        assert _level(hit[0]) == pytest.approx(expect[name], rel=1e-12)
        assert lo < _level(hit[0]), "the session traded below the level it swept"


def test_kicker_draws_the_weak_close_and_prior_high():
    bars, d, i, by = _first_positive("uct_kicker")
    assert _level(_one(by, "weak_close")) == bars[i - 1]["c"]
    assert _level(_one(by, "pivot")) == bars[i - 1]["h"]
    assert bars[i]["o"] > bars[i - 1]["c"], "the kicker gapped over the weak close"


def test_oops_draws_the_prior_low_and_the_reclaim_level():
    bars, d, i, by = _first_positive("uct_oops_reversal")
    prior_low = _one(by, "prior_low")
    assert _level(prior_low) == bars[i - 1]["l"]
    assert bars[i]["l"] < _level(prior_low), "the oops undercut the prior low"
    assert _level(_one(by, "pivot")) == bars[i - 1]["c"]


def test_slingshot_draws_the_pullback_box_and_the_4ema_of_highs():
    bars, d, i, by = _first_positive("uct_slingshot")
    pb = _one(by, "pullback")
    win = bars[i - 3:i]
    assert pb["anchors"][0]["price"] == max(b["h"] for b in win)
    assert pb["anchors"][1]["price"] == min(b["l"] for b in win)
    assert _span(pb) == (bars[i - 3]["t"], bars[i - 1]["t"])
    e4h = _ema([b["h"] for b in bars], 4)[i]
    assert _level(_one(by, "ma")) == pytest.approx(e4h, rel=1e-12)
    assert bars[i]["c"] > e4h


def test_hve_draws_the_high_volume_close_to_the_newest_bar():
    bars, d, i, by = _first_positive("uct_hve")
    line = _one(by, "hve_close")
    assert _level(line) == bars[i]["c"]
    assert _span(line) == (bars[i]["t"], bars[-1]["t"])
    # the detector reported the setup intact, so no later bar traded through its stop
    stop = d["levels"]["stop"]
    later = bars[i + 1:]
    if d["direction"] == "bullish":
        assert all(b["l"] >= stop for b in later)
    else:
        assert all(b["h"] <= stop for b in later)


def test_a_detection_without_secondary_is_still_built_unchanged():
    """build_detection's new kwarg is optional: omitted or empty adds no key."""
    from api.services.pattern_engine.detectors.uct import uct_setups_common as U
    bars = [{"t": 20240101 + k, "o": 10.0, "h": 11.0, "l": 9.0, "c": 10.5, "v": 1e6}
            for k in range(3)]
    kw = dict(pattern_id="x", pattern_name="X", direction="bullish", bars=bars, trig_idx=2,
              start_idx=0, anchors=[{"t": 20240103, "price": 10.5}], anchor_roles=["r"],
              extras={}, levels={}, context={}, narrative={}, geom=70.0, vol=40.0, ctx=50.0)
    assert "secondary" not in U.build_detection(**kw)["geometry"]
    assert "secondary" not in U.build_detection(secondary=[], **kw)["geometry"]
    line = U.hline(bars, 0, 2, 9.5, "r", "L")
    assert line == {"shape": "horizontal_line",
                    "anchors": [{"t": 20240101, "price": 9.5}, {"t": 20240103, "price": 9.5}],
                    "role": "r", "label": "L"}
    box = U.rect(bars, 0, 1, 11.0, 9.0, "b", "B")
    assert box["anchors"] == [{"t": 20240101, "price": 11.0}, {"t": 20240102, "price": 9.0}]
