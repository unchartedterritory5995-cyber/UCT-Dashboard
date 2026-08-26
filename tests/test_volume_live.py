"""Volume Surge accumulator — the time-of-day RVOL metric + gates.

Drives `volume_live._tick_once` with synthetic snapshot sequences (no live feed).
RVOL is the TC2000-style relative volume: today's cumulative volume / what the name
TYPICALLY trades by this time of day (prev_vol × the intraday cumulative curve). The
tests fix the clock at 13:00 ET (curve = 0.52) and shrink the price/dollar windows so
a handful of samples spans them.
"""
from datetime import datetime

import pytest

from api.services import volume_live


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    volume_live._state = {
        "session_key": None, "window": "closed", "date": None,
        "syms": {}, "asof": None, "ticks": 0, "last_error": None,
    }
    volume_live._top_set = None
    volume_live._top_built = 0.0
    volume_live._custom_registry.clear()
    monkeypatch.setattr(volume_live, "_universe_map",
                        lambda: {"AAA": "AAA", "BBB": "BBB", "CHEAP": "CHEAP", "THIN": "THIN"})
    monkeypatch.setattr(volume_live, "_etf_set", lambda: set())
    monkeypatch.setattr(volume_live, "_PRICE_SECS", 10.0)
    monkeypatch.setattr(volume_live, "_NOW_DOLLAR_SECS", 10.0)
    monkeypatch.setattr(volume_live, "_MIN_SAMPLE_GAP", 1.0)
    yield


_NOW = datetime(2026, 8, 25, 13, 0, 0)   # 13:00 ET → cumulative curve = 0.52


def test_cumfrac_curve_is_monotone_and_time_of_day_aware():
    f = volume_live._cumfrac
    assert f(datetime(2026, 8, 25, 4, 0)) == 0.0        # pre-market open
    assert 0.0 < f(datetime(2026, 8, 25, 8, 0)) < 0.05  # thin pre-market
    assert f(datetime(2026, 8, 25, 9, 30)) == pytest.approx(0.05, abs=1e-6)   # RTH open
    assert 0.9 < f(datetime(2026, 8, 25, 16, 0)) <= 0.96                       # RTH close
    assert f(datetime(2026, 8, 25, 20, 0)) == 1.0
    # Strictly rising through the day.
    pts = [f(datetime(2026, 8, 25, h, 0)) for h in (5, 8, 10, 12, 14, 16, 18, 20)]
    assert all(b >= a for a, b in zip(pts, pts[1:]))


def _feed(rows_by_t):
    for t in sorted(rows_by_t):
        snap = {app: dict(r) for app, r in rows_by_t[t].items()}
        volume_live._tick_once(snap, "rth", "2026-08-25", _NOW, float(t))


def _row(rows, sym):
    return next((r for r in rows if r["sym"] == sym), None)


def test_unusual_cumulative_volume_with_a_move_is_lit_and_tiered():
    # AAA has traded ~2.7M shares by 13:00 vs a typical 1M-share day → expected by
    # now = 1M × 0.52 = 520k → RVOL ≈ 5.2. Plus a real price move in the last window.
    seq = {}
    for t in range(0, 46):
        cv = 60_000 * t                                    # 2.7M by t=45
        px = 10.0 if t <= 36 else 10.0 + 0.15 * (t - 36)   # ramps up in the last window
        seq[t] = {"AAA": {"min_av": cv, "last_price": px, "prev_close": 10.0, "prev_vol": 1_000_000}}
    _feed(seq)
    aaa = _row(volume_live.get_live(min_dollar=0)["rows"], "AAA")
    assert aaa is not None and aaa["lit"] is True
    assert 4.5 <= aaa["rvol"] <= 6                          # cumulative ~5.2×
    assert aaa["tier"] >= 3 and aaa["burst"] > 0           # High or bolder (a fresh burst + a real move)
    assert aaa["move"] > 1 and aaa["dir"] == "up"


def test_a_fresh_pickup_without_a_real_fast_move_does_not_light():
    # A quiet name with a fresh volume pickup but only a SMALL move (below the instant-surge
    # move bar). Volume without a real fast move is not actionable — it must NOT light, and
    # must not flicker.
    seq = {}
    for t in range(0, 46):
        cv = 200_000 if t <= 35 else 200_000 + 150 * (t - 35)   # flat, then a fresh pickup
        px = 50.0 if t <= 35 else 50.0 + 0.025 * (t - 35)       # only +0.5% (below the surge bar)
        seq[t] = {"AAA": {"min_av": cv, "last_price": px, "prev_close": 50.0, "prev_vol": 1_000_000}}
    _feed(seq)
    r = _row(volume_live.get_live(show_all=True, min_dollar=0)["rows"], "AAA")
    assert r is not None and r["rvol"] < 2       # low sustained level…
    assert abs(r["move"]) < 1                     # …and no real fast move
    assert r["lit"] is False and r["igniting"] is False
    assert volume_live.get_live(min_dollar=0)["rows"] == []


def test_high_priced_megacap_on_news_is_surfaced_not_price_capped():
    # A META-class name (~$590) making a fast pre-market news move. The old $250 cap
    # silently hid EVERY megacap — the exact liquid names this scanner exists to catch.
    seq = {}
    for t in range(0, 46):
        cv = 300_000 if t <= 35 else 300_000 + 3_500 * (t - 35)   # quiet, then a BIG instant surge
        px = 590.0 if t <= 35 else 590.0 + 0.9 * (t - 35)         # a fast +1.5% pop
        seq[t] = {"AAA": {"min_av": cv, "last_price": px, "prev_close": 590.0, "prev_vol": 15_000_000}}
    _feed(seq)
    r = _row(volume_live.get_live(min_dollar=0)["rows"], "AAA")
    assert r is not None and r["lit"] is True            # surfaced + lit (not price-capped)
    assert r["price"] > 250                              # a megacap the old cap excluded
    assert r["burst_intraday"] >= 5 and r["igniting"] is True   # a big INSTANT surge (CRCL-style)
    # The price band is still a real filter: an explicit low cap still excludes it.
    assert _row(volume_live.get_live(max_price=250, min_dollar=0)["rows"], "AAA") is None


def test_a_fresh_volume_spike_with_a_move_lights_bold_and_rings(monkeypatch):
    # The core signal: a name trading quietly on its OWN recent baseline, then a sudden HEAVY
    # volume spike + a real move — a breaking-news pop. The intraday SPIKE (recent volume vs its
    # OWN recent norm) lights it BOLD + rings, regardless of RVOL-vs-previous-days.
    monkeypatch.setattr(volume_live, "_PRICE_SECS", 120.0)
    monkeypatch.setattr(volume_live, "_NOW_DOLLAR_SECS", 60.0)
    prev_vol = 2_000_000
    cf = volume_live._cumfrac(_NOW)
    cv = prev_vol * cf * 0.5
    seq = {}
    for t in range(0, 721, 3):            # ~12 min so vspike (its own trailing rate) is measured
        if t < 630:
            cv += (3000 / 60.0) * 3       # ~3K/min quiet baseline
            px = 100.0
        else:
            cv += (30000 / 60.0) * 3      # ~30K/min spike (10×) in the last 90s
            px = 100.0 + 1.5 * ((t - 630) / 90.0)   # a +1.5% pop
        seq[t] = {"AAA": {"min_av": cv, "last_price": px, "prev_close": 100.0, "prev_vol": prev_vol}}
    _feed(seq)
    r = _row(volume_live.get_live(min_dollar=0)["rows"], "AAA")
    assert r is not None and r["lit"] is True
    assert r["vspike"] >= 4           # recent volume ≥4× its OWN recent norm (the real spike)
    assert r["tier"] >= 4             # → bold (Very High / Extreme)
    assert r["igniting"] is True      # a live spike + move → the gold ring


def test_normal_activity_reads_below_1x_and_is_not_lit():
    # QUIET trades ~300k by 13:00 vs 520k expected → RVOL ≈ 0.58 (below normal).
    seq = {}
    for t in range(0, 46):
        seq[t] = {"AAA": {"min_av": 6_666 * t, "last_price": 50.0, "prev_close": 50.0, "prev_vol": 1_000_000}}
    _feed(seq)
    lit = _row(volume_live.get_live(show_all=True, min_dollar=0)["rows"], "AAA")
    assert lit is not None and lit["lit"] is False and lit["rvol"] < 1
    assert volume_live.get_live(show_all=False, min_dollar=0)["rows"] == []


def test_a_name_dead_now_is_not_lit_no_matter_how_much_it_traded_earlier(monkeypatch):
    # A name that traded heavily EARLIER but is dead NOW: no CURRENT volume spike, so it is NOT a
    # signal — regardless of how high its cumulative/RVOL-vs-a-normal-day is. This is the core of
    # the new model: only abnormal activity RIGHT NOW counts.
    monkeypatch.setattr(volume_live, "_universe_map", lambda: {"DEAD": "DEAD"})
    seq = {}
    for t in range(0, 46):
        cv = 150_000 * t if t <= 20 else 3_000_000          # surged EARLY, then FLAT (dead now)
        px = 14.0 if t <= 35 else 14.0 + 0.01 * (t - 35)
        seq[t] = {"DEAD": {"min_av": cv, "last_price": px, "prev_close": 14.0, "prev_vol": 1_000_000}}
    _feed(seq)
    r = _row(volume_live.get_live(show_all=True, min_dollar=0)["rows"], "DEAD")
    assert r is not None and r["lit"] is False              # no CURRENT spike → not lit
    assert volume_live.get_live(min_dollar=0)["rows"] == []


def test_tradability_floor_excludes_cheap_and_illiquid_names():
    seq = {}
    for t in range(0, 46):
        cv = 60_000 * t
        seq[t] = {
            "CHEAP": {"min_av": cv, "last_price": 0.50, "prev_close": 0.50, "prev_vol": 5_000_000},
            "THIN":  {"min_av": cv, "last_price": 14.0, "prev_close": 14.0, "prev_vol": 1_000},
        }
    _feed(seq)
    rows = volume_live.get_live(min_dollar=0, show_all=True)["rows"]
    assert _row(rows, "CHEAP") is None      # sub-$1
    assert _row(rows, "THIN") is None       # below the 100k liquidity floor


def test_show_all_lists_the_whole_universe_lit_first_then_by_rvol(monkeypatch):
    monkeypatch.setattr(volume_live, "_universe_map", lambda: {"HOT": "HOT", "NOISE": "NOISE"})
    seq = {}
    for t in range(0, 46):
        # HOT: high cumulative + a price move (lit). NOISE: EVEN higher cumulative
        # RVOL but flat price (unlit via the move gate) — must sink below HOT.
        hot_px = 10.0 if t <= 36 else 10.0 + 0.15 * (t - 36)
        seq[t] = {
            "HOT":   {"min_av": 60_000 * t, "last_price": hot_px, "prev_close": 10.0, "prev_vol": 1_000_000},
            "NOISE": {"min_av": 90_000 * t, "last_price": 50.0,   "prev_close": 50.0, "prev_vol": 1_000_000},
        }
    _feed(seq)
    rows = volume_live.get_live(show_all=True, min_dollar=0)["rows"]
    syms = [r["sym"] for r in rows]
    assert "HOT" in syms and "NOISE" in syms
    assert _row(rows, "HOT")["lit"] is True
    assert _row(rows, "NOISE")["lit"] is False
    assert _row(rows, "NOISE")["rvol"] > _row(rows, "HOT")["rvol"]   # NOISE reads higher…
    assert syms.index("HOT") < syms.index("NOISE")                   # …yet the lit name ranks above
    assert volume_live.get_live(show_all=True, min_dollar=0)["total"] == 1


def test_scans_only_the_top_liquid_names(monkeypatch):
    monkeypatch.setenv("VOLUME_UNIVERSE_TOP", "1")
    monkeypatch.setattr(volume_live, "_universe_map", lambda: {"BIG": "BIG", "SMALL": "SMALL"})
    seq = {}
    for t in range(0, 46):
        px = 10.0 if t <= 36 else 10.0 + 0.15 * (t - 36)
        seq[t] = {
            "BIG":   {"min_av": 60_000 * t, "last_price": px, "prev_close": 100.0, "prev_vol": 5_000_000},
            "SMALL": {"min_av": 60_000 * t, "last_price": px, "prev_close": 2.0,   "prev_vol": 60_000},
        }
    _feed(seq)
    assert "SMALL" not in volume_live._state["syms"]
    rows = volume_live.get_live(min_dollar=0, show_all=True)["rows"]
    assert _row(rows, "BIG") is not None
    assert _row(rows, "SMALL") is None


def test_a_volume_spike_without_a_move_does_not_light():
    # SIZE + MOVE together. A fresh volume spike with NO price move (absorption / a print) is not a
    # breaking-news signal — the scanner wants an abnormal MOVE with the abnormal volume.
    seq = {}
    for t in range(0, 46):
        cv = 60_000 * t if t <= 35 else 60_000 * 35 + 400_000 * (t - 35)   # a fresh volume spike…
        seq[t] = {"AAA": {"min_av": cv, "last_price": 50.0, "prev_close": 50.0, "prev_vol": 1_000_000}}
    _feed(seq)                                                              # …but the price is FLAT
    r = _row(volume_live.get_live(show_all=True, min_dollar=0)["rows"], "AAA")
    assert r is not None and r["lit"] is False


def test_custom_list_scans_only_requested_and_bypasses_the_liquidity_floor():
    # A sub-$1 name is hidden from the default top-N (tradable floor). But a user who puts
    # it on their OWN list sees it — the list scans ONLY those names and bypasses the floor.
    seq = {}
    for t in range(0, 46):
        px = 0.50 if t <= 36 else 0.50 + 0.02 * (t - 36)
        seq[t] = {
            "CHEAP": {"min_av": 60_000 * t, "last_price": px, "prev_close": 0.50, "prev_vol": 5_000_000},
            "AAA":   {"min_av": 60_000 * t, "last_price": 50.0, "prev_close": 50.0, "prev_vol": 1_000_000},
        }
    _feed(seq)
    assert _row(volume_live.get_live(show_all=True, min_dollar=0)["rows"], "CHEAP") is None  # default hides it
    out = volume_live.get_live(show_all=True, min_dollar=0, syms=["cheap"])  # case-insensitive
    assert _row(out["rows"], "CHEAP") is not None      # shown despite the floor
    assert _row(out["rows"], "AAA") is None            # AAA is not on the list


def test_price_sharpness_tells_a_sudden_expansion_from_a_smooth_grind():
    # The ATR-style range-expansion read off the close series: a steady trend (every minute
    # moves about the same) reads ~1; a sudden blow-out reads high. This is what separates
    # a genuinely SHARP move from a smooth 45° grind at the same volume.
    t_now = 660.0
    # Smooth grind: +~0.1%/min, every minute alike → recent ≈ typical → ~1.
    smooth = [(float(t), 0, 100.0 * (1 + 0.001 * (t / 60.0))) for t in range(0, 661, 15)]
    s_smooth = volume_live._price_sharpness(smooth, t_now)
    assert s_smooth is not None and s_smooth < 1.8

    # Sharp expansion: flat for ~9 min, then a fast pop in the last minute.
    sharp = [(float(t), 0, (100.0 if t <= 600 else 100.0 + 0.05 * (t - 600))) for t in range(0, 661, 15)]
    s_sharp = volume_live._price_sharpness(sharp, t_now)
    assert s_sharp is not None and s_sharp >= volume_live._SHARP_MIN
    assert s_sharp > s_smooth * 2                      # unmistakably sharper


def test_a_steady_volume_grind_is_not_a_spike_and_does_not_light(monkeypatch):
    # A smooth ~45° trend on STEADY (even elevated) volume — recent volume ≈ its own trailing rate,
    # so vspike ~1: NO current spike. It must NOT light, no matter that it's up on the day and
    # trading well above a normal day. The scanner is for sudden spikes, not steady trends — this
    # is the BHVN / ANF elevated-flat class.
    monkeypatch.setattr(volume_live, "_PRICE_SECS", 120.0)
    monkeypatch.setattr(volume_live, "_NOW_DOLLAR_SECS", 60.0)
    prev_vol = 3_000_000
    cf = volume_live._cumfrac(_NOW)
    cv = prev_vol * cf
    seq = {}
    for t in range(0, 721, 3):
        cv += (20000 / 60.0) * 3            # a STEADY ~20K/min all along (elevated but constant)
        px = 100.0 + 3.0 * (t / 720.0)      # a smooth climb +3%
        seq[t] = {"AAA": {"min_av": cv, "last_price": px, "prev_close": 100.0, "prev_vol": prev_vol}}
    _feed(seq)
    r = _row(volume_live.get_live(show_all=True, min_dollar=0)["rows"], "AAA")
    assert r is not None
    assert r["vspike"] is not None and r["vspike"] < 2   # recent ≈ its own trailing → NOT a spike
    assert r["lit"] is False                              # steady grind → not lit


def test_a_sharp_move_on_big_volume_flashes_white():
    # CRCL: quiet, then a SUDDEN sharp move on a big volume burst — the flash case.
    seq = {}
    for t in range(0, 201):
        cv = (20 * t if t <= 180 else 20 * 180 + 4_000 * (t - 180))   # quiet, then a burst
        px = (100.0 if t <= 180 else 100.0 + 0.35 * (t - 180))        # flat, then a fast pop
        seq[t] = {"AAA": {"min_av": cv, "last_price": px, "prev_close": 100.0, "prev_vol": 1_000_000}}
    _feed(seq)
    r = _row(volume_live.get_live(min_dollar=0)["rows"], "AAA")
    assert r is not None and r["lit"] is True
    assert r["sharpness"] is not None and r["sharpness"] >= volume_live._SHARP_MIN
    assert r["flash"] is True                 # big volume + a SUDDEN sharp move → white flash


def test_custom_list_tracks_an_etf_outside_the_universe_map(monkeypatch):
    # USO / SOXL / UVXY class: a liquid ETF that is NOT in the breadth universe map and is
    # flagged as an ETF (so the stocks-only gate would drop it). Putting it on a custom list
    # must still give it a reading — the tick loop otherwise only visits the universe map,
    # so these names stayed stuck on "…" forever.
    monkeypatch.setattr(volume_live, "_etf_set", lambda: {"USO"})
    volume_live.register_custom_syms({"USO"})
    seq = {}
    for t in range(0, 46):
        px = 80.0 if t <= 36 else 80.0 + 0.2 * (t - 36)
        seq[t] = {"USO": {"min_av": 60_000 * t, "last_price": px, "prev_close": 80.0, "prev_vol": 5_000_000}}
    _feed(seq)
    out = volume_live.get_live(show_all=True, min_dollar=0, syms=["USO"])
    r = _row(out["rows"], "USO")
    assert r is not None and r["rvol"] is not None    # got a real reading (not stuck pending)
    assert r["rvol"] == pytest.approx(1.04, abs=0.1)   # ~2.7M traded vs ~2.6M expected by 13:00


def test_an_earnings_name_heavy_but_flat_all_day_does_not_scream_very_high():
    # ANF shape: heavy volume ALL day from earnings — RVOL vs a NORMAL day reads ~8× — but it's
    # FLAT: recent pace ≈ its own day pace (surge_intraday ~1), nothing unusual intraday. It must
    # NOT read "Very High" / light bold for hours on stale earnings volume; the bold tiers weight
    # the intraday ACCELERATION, so elevated-and-flat is capped.
    prev_vol = 5_000_000
    B = 1112.0
    A = 8 * prev_vol * 0.52 - 600 * B     # big morning offset → rvol_day ~8, elevated ALL day
    seq = {}
    for t in range(0, 601, 3):
        px = 40.0 + 0.5 * (t / 600.0)     # a mild drift (+1.25% on the day), nothing sharp
        seq[t] = {"AAA": {"min_av": A + B * t, "last_price": px, "prev_close": 40.0, "prev_vol": prev_vol}}
    _feed(seq)
    r = _row(volume_live.get_live(show_all=True, min_dollar=0)["rows"], "AAA")
    assert r is not None
    assert r["rvol"] >= 6                 # its raw RVOL vs a normal day IS high (earnings)…
    assert r["surge_intraday"] <= 1.2     # …but it's FLAT — not accelerating vs its own day
    assert r["tier"] <= 2                 # → capped (Elevated at most), never a bold "Very High"
    assert r["lit"] is False              # and not lit — nothing unusual is happening right now


def test_a_breakout_spike_fires_even_on_a_name_already_elevated_all_day(monkeypatch):
    # NET shape: ELEVATED but STEADY volume all day + grinding up, then a fresh candle that is its
    # biggest volume of the day + a real move — a breakout NOW. The spike vs its OWN (already-
    # elevated) recent baseline still fires: being active all day doesn't hide the fresh spike.
    monkeypatch.setattr(volume_live, "_PRICE_SECS", 120.0)
    monkeypatch.setattr(volume_live, "_NOW_DOLLAR_SECS", 60.0)
    prev_vol = 4_000_000
    cf = volume_live._cumfrac(_NOW)
    cv = prev_vol * cf
    seq = {}
    for t in range(0, 721, 3):
        if t < 630:
            cv += (10000 / 60.0) * 3          # ~10K/min ELEVATED but steady baseline all day
            px = 277.0 + 10.0 * (t / 630.0)   # steady climb
        else:
            cv += (60000 / 60.0) * 3          # ~60K/min — the highest-volume candle (6× its baseline)
            px = 287.0 + 2.0 * ((t - 630) / 90.0)   # a fast pop (the breakout)
        seq[t] = {"AAA": {"min_av": cv, "last_price": px, "prev_close": 277.0, "prev_vol": prev_vol}}
    _feed(seq)
    r = _row(volume_live.get_live(min_dollar=0)["rows"], "AAA")
    assert r is not None and r["lit"] is True
    assert r["vspike"] >= 3               # a spike vs its OWN already-elevated recent baseline
    assert r["move"] >= 0.6               # …with a real fast move
    assert r["tier"] >= 3 and r["igniting"] is True


def test_a_megacap_volume_spike_vs_its_own_norm_is_caught_even_when_the_normal_day_burst_is_diluted(monkeypatch):
    # ARM shape: a MEGACAP whose spike reads only ~2× vs a NORMAL day (its huge baseline dilutes
    # both burst and burst_intraday, so those gates miss it) — but whose recent volume is ~4× its
    # OWN trailing intraday rate (6-8K/min → 30K/min), with a real move. The scanner must catch it
    # the way a trader eyeballs the spike: recent volume vs the stock's OWN recent norm (vspike).
    monkeypatch.setattr(volume_live, "_PRICE_SECS", 120.0)
    monkeypatch.setattr(volume_live, "_NOW_DOLLAR_SECS", 60.0)
    prev_vol = 8_000_000
    cf = volume_live._cumfrac(_NOW)
    cv = prev_vol * cf                            # midday cumulative → rvol_day ~1 (normal-ish day)
    seq = {}
    for t in range(0, 721, 3):                    # ~12 min
        if t < 630:
            cv += (7000 / 60.0) * 3               # ~7K/min trailing baseline
            px = 248.0
        else:
            cv += (30000 / 60.0) * 3              # ~30K/min spike in the last 90s
            px = 248.0 + 2.0 * ((t - 630) / 90.0)  # a +0.8% pop
        seq[t] = {"AAA": {"min_av": cv, "last_price": px, "prev_close": 248.0, "prev_vol": prev_vol}}
    _feed(seq)
    r = _row(volume_live.get_live(min_dollar=0)["rows"], "AAA")
    assert r is not None and r["lit"] is True
    assert r["burst"] < 3                  # the normal-day burst is DILUTED (megacap) — the old gates miss it…
    assert r["vspike"] >= 3                 # …but recent volume is ≥3× its OWN trailing rate (the real spike)
    assert r["move"] >= 0.6                 # …with a real fast move
    assert r["tier"] >= 3 and r["igniting"] is True   # → lit BOLD + igniting, near the top


def test_a_dead_morning_name_trading_normally_now_is_not_boosted():
    # The boost's guard: a name whose morning was DEAD (rvol_day very low) but is merely trading
    # NORMALLY now has a high surge_intraday ratio — yet its recent rate is NOT elevated vs a
    # normal day, so it must NOT be inflated into a fake surge.
    prev_vol = 40_000_000
    base = prev_vol * 0.52 * 0.3         # a dead morning → rvol_day ~0.3
    recent_add = 700_000                 # recent rate only ~normal (rvol ~1)
    cv0 = base - recent_add
    seq = {}
    for t in range(0, 601, 3):
        cv = cv0 + recent_add * (t / 600.0)
        seq[t] = {"AAA": {"min_av": cv, "last_price": 87.0, "prev_close": 87.0, "prev_vol": prev_vol}}
    _feed(seq)
    r = _row(volume_live.get_live(show_all=True, min_dollar=0)["rows"], "AAA")
    assert r is not None
    assert r["surge_intraday"] >= 2.5     # the RATIO is high (dead morning)…
    assert r["rvol"] < 2                   # …but the recent rate is not elevated
    assert r["tier"] == 1 and r["lit"] is False   # not boosted, not lit


def test_top_set_promotes_a_name_surging_today_over_one_liquid_only_yesterday():
    # NTNX shape: a name whose PRIOR-day $-vol ranks it below the cutoff, but which is trading
    # HEAVY today, must be PROMOTED into the tracked top-N (ranked by max(prev, today) $-vol) —
    # otherwise the scanner never sees today's surge until tomorrow.
    snap = {
        "BIG":    {"prev_close": 100.0, "prev_vol": 50_000_000, "last_price": 100.0, "min_av": 1_000_000},  # $5B yesterday
        "MIDLIQ": {"prev_close": 40.0,  "prev_vol": 2_000_000,  "last_price": 40.0,  "min_av": 100_000},    # $80M yday, quiet today
        "NTNX":   {"prev_close": 66.0,  "prev_vol": 500_000,    "last_price": 65.0,  "min_av": 3_000_000},  # $33M yday, $195M TODAY
    }
    prov_map = {k: k for k in snap}
    top = volume_live._rebuild_top_set(snap, prov_map, set(), 2)   # top-2 only
    assert "BIG" in top
    assert "NTNX" in top        # promoted by TODAY's heavy $-vol ($195M) over MIDLIQ's $80M yday
    assert "MIDLIQ" not in top


def test_a_flagged_name_holds_then_eases_down_through_the_tiers_then_drops():
    # DAVE-shape follow-through: once a name is FLAGGED (a genuine volume+move spike → bold), it
    # LINGERS on the scanner and its tier eases DOWN (T4→T3→T2→…) as the volume normalizes, so a
    # 1-second pop stays visible for ~1-2 min — instead of blinking out. Then it drops.
    st = {}
    spike = {"move": 2.0, "pct": 2.0, "burst": 8.0, "vspike": 6.0, "sharpness": 5.0, "dvol": 500_000}
    volume_live._apply_hold(st, spike, 0.0)          # the spike: bold + latched
    peak = spike["eff"]
    assert spike["held"] is True
    assert volume_live._rvol_tier(peak) >= 4         # T4/T5 — bold

    # the live surge FADES (volume + fast move gone), but the hold lingers and DECAYS
    quiet = {"move": 0.0, "pct": 2.0, "burst": 1.0, "vspike": 1.0, "sharpness": 0.0, "dvol": 500_000}
    q1 = dict(quiet)
    volume_live._apply_hold(st, q1, 45.0)            # ~45s later
    assert q1["held"] is True                         # still on the scanner…
    assert q1["eff"] < peak                           # …but eased down
    assert volume_live._rvol_tier(q1["eff"]) < volume_live._rvol_tier(peak)

    # well past the hold window → no longer held (decayed below the floor / past _HOLD_SECS)
    q2 = dict(quiet)
    volume_live._apply_hold(st, q2, 200.0)
    assert q2["held"] is False


def test_a_name_that_never_flagged_is_not_held():
    # The hold only latches a GENUINE signal. A quiet name (no catch, not accelerating) is never
    # flagged, so it is never held on the scanner.
    st = {}
    m = {"move": 0.1, "pct": 0.2, "burst": 1.2, "vspike": 1.1, "sharpness": 0.0,
         "surge_intraday": 1.0, "rvol": 1.5, "burst_intraday": 1.0}
    volume_live._apply_hold(st, m, 0.0)
    assert m["held"] is False


def test_register_custom_syms_keeps_them_active():
    volume_live.register_custom_syms({"NVDA", "TSLA"})
    active = volume_live._custom_active()
    assert "NVDA" in active and "TSLA" in active


def test_closed_window_serves_no_rows():
    volume_live._tick_once({}, "closed", "2026-08-25", _NOW, 0.0)
    assert volume_live.get_live()["rows"] == []


def test_push_aggregate_refreshes_a_tracked_symbol(monkeypatch):
    # The instant A.* push refreshes ONE tracked symbol's volume + price in ~1s, between
    # the slower REST polls. Gated by VOLUME_PUSH_ENABLED; inert when off.
    monkeypatch.setenv("VOLUME_PUSH_ENABLED", "1")
    monkeypatch.setattr(volume_live, "_now_et", lambda: _NOW)
    monkeypatch.setattr(volume_live, "_active_window", lambda now=None: "rth")

    class _FT:
        def time(self):
            return 46.0
    monkeypatch.setattr(volume_live, "_time", _FT())

    # The REST poll tracks AAA + sets its prev-day baseline (cv ~2.7M by 13:00).
    seq = {t: {"AAA": {"min_av": 60_000 * t, "last_price": 10.0,
                       "prev_close": 10.0, "prev_vol": 1_000_000}} for t in range(0, 46)}
    _feed(seq)
    before = _row(volume_live.get_live(show_all=True, min_dollar=0)["rows"], "AAA")
    assert before is not None

    # A per-second A push: accumulated volume jumps + price ticks up. bar_stream delivers
    # the bar dict directly as the payload (av = accumulated day volume, c = last price).
    volume_live.on_aggregate("AAA", {"av": 5_000_000, "c": 10.5, "v": 100_000}, "A")
    after = _row(volume_live.get_live(show_all=True, min_dollar=0)["rows"], "AAA")
    assert after is not None
    assert after["price"] == pytest.approx(10.5)      # price refreshed by the push
    assert after["rvol"] > before["rvol"]             # accumulated volume jumped → RVOL rose

    # Flag OFF → the push is inert (no refresh).
    monkeypatch.setenv("VOLUME_PUSH_ENABLED", "0")
    volume_live.on_aggregate("AAA", {"av": 9_000_000, "c": 12.0, "v": 1}, "A")
    still = _row(volume_live.get_live(show_all=True, min_dollar=0)["rows"], "AAA")
    assert still["price"] == pytest.approx(10.5)      # unchanged with the push off
