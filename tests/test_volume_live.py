"""Volume Surge accumulator — the relative-volume scanner's metric + gates.

Drives `volume_live._tick_once` with synthetic snapshot sequences (no live feed)
and asserts the served leaderboard: a sustained volume surge WITH a price move
ranks and tiers; a volume surge with NO price move (dark-pool-ish) is dropped; the
tradability floors (price band + liquidity) exclude junk; and the compact baseline
persistence round-trips. Windows are shrunk via monkeypatch so a test builds a few
seconds of history instead of minutes.
"""
import json
from datetime import datetime

import pytest

from api.services import volume_live


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    # Fresh module state per test + a tiny universe, no ETFs.
    volume_live._state = {
        "session_key": None, "window": "closed", "date": None,
        "syms": {}, "asof": None, "ticks": 0, "last_error": None,
    }
    volume_live._top_set = None
    volume_live._top_built = 0.0
    monkeypatch.setattr(volume_live, "_universe_map",
                        lambda: {"AAA": "AAA", "BBB": "BBB", "CHEAP": "CHEAP", "THIN": "THIN"})
    monkeypatch.setattr(volume_live, "_etf_set", lambda: set())
    # Shrink the windows so a handful of samples spans a full baseline+now window.
    monkeypatch.setattr(volume_live, "_NOW_SECS", 10.0)
    monkeypatch.setattr(volume_live, "_BASE_SECS", 20.0)
    monkeypatch.setattr(volume_live, "_MIN_BASE_SPAN", 10.0)
    monkeypatch.setattr(volume_live, "_PRICE_SECS", 10.0)
    monkeypatch.setattr(volume_live, "_MIN_SAMPLE_GAP", 1.0)
    yield


_NOW = datetime(2026, 8, 25, 13, 0, 0)


def _feed(rows_by_t):
    """rows_by_t: {sample_t: {app: {min_av, last_price, prev_close, prev_vol}}}."""
    for t in sorted(rows_by_t):
        snap = {app: dict(r) for app, r in rows_by_t[t].items()}
        volume_live._tick_once(snap, "rth", "2026-08-25", _NOW, float(t))


def _row(rows, sym):
    return next((r for r in rows if r["sym"] == sym), None)


def test_sustained_surge_with_move_ranks_and_tiers():
    seq = {}
    for t in range(0, 46):
        # AAA: quiet baseline (100 sh/s, flat $10) → a surge in the last ~10s
        # (1000 sh/s, price ramps up). BBB: SAME volume surge, price FLAT (a
        # dark-pool-style print that moves size but not the tape).
        if t <= 36:
            aaa_cv, aaa_px = 100 * t, 10.0
        else:
            aaa_cv, aaa_px = 3600 + 1000 * (t - 36), 10.0 + 0.15 * (t - 36)
        bbb_cv = aaa_cv
        seq[t] = {
            "AAA": {"min_av": aaa_cv, "last_price": aaa_px, "prev_close": 10.0, "prev_vol": 1_000_000},
            "BBB": {"min_av": bbb_cv, "last_price": 20.0, "prev_close": 20.0, "prev_vol": 1_000_000},
        }
    _feed(seq)

    out = volume_live.get_live()
    rows = out["rows"]
    aaa = _row(rows, "AAA")
    assert aaa is not None, "a sustained surge WITH a price move must rank"
    assert aaa["rvol"] >= 2.0
    assert aaa["move"] > 1.0 and aaa["dir"] == "up"
    assert aaa["tier"] >= 1
    # The non-mover (volume surge, flat price) is excluded by the move gate.
    assert _row(rows, "BBB") is None
    assert out["total"] == 1


def test_a_faded_spike_decays_out_of_the_now_window():
    # A one-off blip early, then volume goes quiet again: by the time the now-window
    # has rolled past the blip, the name should no longer qualify.
    seq = {}
    cv = 0
    for t in range(0, 60):
        rate = 3000 if 20 <= t <= 24 else 100      # a 5s blip at t=20..24
        cv += rate
        px = 10.0 + (0.5 if 20 <= t <= 24 else 0.0)
        seq[t] = {"AAA": {"min_av": cv, "last_price": px, "prev_close": 10.0, "prev_vol": 1_000_000},
                  "BBB": {"min_av": t * 100, "last_price": 20.0, "prev_close": 20.0, "prev_vol": 1_000_000}}
    _feed(seq)
    # now-window (last 10s: t=50..59) is all baseline → AAA no longer surging.
    assert _row(volume_live.get_live()["rows"], "AAA") is None


def test_tradability_floor_excludes_cheap_and_illiquid_names():
    seq = {}
    for t in range(0, 46):
        cv = 100 * t if t <= 36 else 3600 + 1000 * (t - 36)
        px = 10.0 if t <= 36 else 10.0 + 0.15 * (t - 36)
        seq[t] = {
            # sub-$1 price → excluded even while surging
            "CHEAP": {"min_av": cv, "last_price": 0.50, "prev_close": 0.50, "prev_vol": 5_000_000},
            # prev-day volume below the 100k liquidity floor → excluded
            "THIN": {"min_av": cv, "last_price": px, "prev_close": 10.0, "prev_vol": 1_000},
        }
    _feed(seq)
    rows = volume_live.get_live()["rows"]
    assert _row(rows, "CHEAP") is None
    assert _row(rows, "THIN") is None


def test_min_rvol_and_min_move_filters_are_honored():
    seq = {}
    for t in range(0, 46):
        cv = 100 * t if t <= 36 else 3600 + 1000 * (t - 36)
        px = 10.0 if t <= 36 else 10.0 + 0.15 * (t - 36)
        seq[t] = {"AAA": {"min_av": cv, "last_price": px, "prev_close": 10.0, "prev_vol": 1_000_000}}
    _feed(seq)
    # An absurd RVOL floor excludes everything; a modest one keeps AAA.
    assert volume_live.get_live(min_rvol=999)["rows"] == []
    assert _row(volume_live.get_live(min_rvol=2)["rows"], "AAA") is not None
    # An absurd move floor excludes everything.
    assert volume_live.get_live(min_move=999)["rows"] == []


def test_baseline_persistence_round_trips(tmp_path, monkeypatch):
    monkeypatch.setenv("VOLUME_STATE_PATH", str(tmp_path / "volume_state.json"))
    monkeypatch.setattr(volume_live, "_now_et", lambda: _NOW)
    monkeypatch.setattr(volume_live, "_active_window", lambda now=None: "rth")

    seq = {}
    for t in range(0, 46):
        cv = 100 * t if t <= 36 else 3600 + 1000 * (t - 36)
        px = 10.0 if t <= 36 else 10.0 + 0.15 * (t - 36)
        seq[t] = {"AAA": {"min_av": cv, "last_price": px, "prev_close": 10.0, "prev_vol": 1_000_000}}
    _feed(seq)
    assert volume_live._state["syms"]["AAA"]["m"] is not None

    volume_live._persist_state()
    saved = json.loads((tmp_path / "volume_state.json").read_text())
    assert saved["session_key"] == "2026-08-25:rth"
    assert saved["seeds"].get("AAA", 0) > 0

    # Simulate a deploy: wipe state, reload → the baseline seed is restored so the
    # name is rate-able again within one now-window instead of blind for minutes.
    volume_live._state["syms"] = {}
    volume_live._state["session_key"] = None
    volume_live._load_state()
    assert "AAA" in volume_live._state["syms"]
    assert volume_live._state["syms"]["AAA"]["seed_base"] > 0


def test_illiquid_now_window_is_filtered_by_the_dollar_floor(monkeypatch):
    # The CSIQ case: a liquid-by-history name (passes the prev-vol floor) that is
    # trading almost nothing RIGHT NOW — a tiny burst vs a dead baseline reads as a
    # big RVOL, but only a few thousand $ actually traded, so it must be dropped.
    monkeypatch.setattr(volume_live, "_universe_map", lambda: {"DEAD": "DEAD"})
    seq = {}
    for t in range(0, 46):
        cv = 5 * t if t <= 36 else 180 + 30 * (t - 36)   # ~$4k of shares in the burst
        px = 14.00 if t <= 36 else 14.00 + 0.007 * (t - 36)
        seq[t] = {"DEAD": {"min_av": cv, "last_price": px, "prev_close": 14.00, "prev_vol": 150_000}}
    _feed(seq)
    # It clears the RVOL + move gates (a real spike vs its dead baseline)…
    lit = _row(volume_live.get_live(min_dollar=0)["rows"], "DEAD")
    assert lit is not None and lit["rvol"] >= 2 and abs(lit["move"]) >= 0.25
    assert lit["dvol"] < 15_000                         # …but traded only a few $k
    # …so the default (and any real) dollar-volume floor drops it.
    assert _row(volume_live.get_live()["rows"], "DEAD") is None
    assert _row(volume_live.get_live(min_dollar=100_000)["rows"], "DEAD") is None


def test_scans_only_the_top_liquid_names(monkeypatch):
    monkeypatch.setenv("VOLUME_UNIVERSE_TOP", "1")
    monkeypatch.setattr(volume_live, "_universe_map", lambda: {"BIG": "BIG", "SMALL": "SMALL"})
    seq = {}
    for t in range(0, 46):
        cv = 100 * t if t <= 36 else 3600 + 1000 * (t - 36)
        px = 10.0 if t <= 36 else 10.0 + 0.15 * (t - 36)
        seq[t] = {
            "BIG":   {"min_av": cv, "last_price": px, "prev_close": 100.0, "prev_vol": 5_000_000},  # huge $-vol
            "SMALL": {"min_av": cv, "last_price": px, "prev_close": 2.0,   "prev_vol": 60_000},      # tiny $-vol
        }
    _feed(seq)
    # Only the single most-liquid name is even tracked; SMALL is outside the top-N.
    assert "SMALL" not in volume_live._state["syms"]
    rows = volume_live.get_live(min_dollar=0)["rows"]
    assert _row(rows, "BIG") is not None
    assert _row(rows, "SMALL") is None


def test_show_all_lists_the_whole_universe_lit_first_then_by_rvol(monkeypatch):
    monkeypatch.setattr(volume_live, "_universe_map", lambda: {"HOT": "HOT", "NOISE": "NOISE"})
    seq = {}
    for t in range(0, 46):
        # HOT: a moderate surge WITH a price move (lit, rvol ~9). NOISE: a BIGGER
        # volume surge but FLAT price (unlit via the move gate, rvol ~20) — the CSIQ
        # case. Even though NOISE has the higher RVOL, lit-first must sink it below HOT.
        if t <= 36:
            hot_cv, hot_px = 100 * t, 10.0
            noise_cv = 100 * t
        else:
            hot_cv, hot_px = 3600 + 1000 * (t - 36), 10.0 + 0.15 * (t - 36)
            noise_cv = 3600 + 2000 * (t - 36)
        seq[t] = {
            "HOT":   {"min_av": hot_cv,   "last_price": hot_px, "prev_close": 10.0, "prev_vol": 1_000_000},
            "NOISE": {"min_av": noise_cv, "last_price": 50.0,   "prev_close": 50.0, "prev_vol": 1_000_000},
        }
    _feed(seq)

    out = volume_live.get_live(show_all=True, min_dollar=0)
    rows = out["rows"]
    syms = [r["sym"] for r in rows]
    assert "HOT" in syms and "NOISE" in syms           # the WHOLE universe is shown
    assert _row(rows, "HOT")["lit"] is True            # meets the criteria → coloured
    assert _row(rows, "NOISE")["lit"] is False         # flat price → shown grey, not lit
    assert _row(rows, "NOISE")["rvol"] > _row(rows, "HOT")["rvol"]   # NOISE has the higher RVOL…
    assert syms.index("HOT") < syms.index("NOISE")     # …yet the lit name ranks ABOVE it
    assert out["total"] == 1                           # header counts only the lit names
    # show_all=False keeps the tight list — only the lit name comes back.
    tight = [r["sym"] for r in volume_live.get_live(show_all=False, min_dollar=0)["rows"]]
    assert tight == ["HOT"]


def test_closed_window_serves_no_rows():
    volume_live._tick_once({}, "closed", "2026-08-25", _NOW, 0.0)
    out = volume_live.get_live()
    assert out["rows"] == []
    assert out["window"] in ("closed", "rth", "pre", "post")  # get_live reads the live clock
