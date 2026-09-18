"""THE CORPORATE-ACTION BASIS REMEDIATION — F1, F2, F5, and the rails that keep them.

⛔⛔ THE BUG THIS FILE EXISTS FOR. The minute flat file is AS-TRADED; `bars.db` — and
therefore every level `build_levels` derives — is SPLIT-ADJUSTED TO THE CURRENT BASIS.
Comparing one against the other asks "is this as-traded price above an adjusted 50-day
average", which is a question about a corporate action rather than about breadth.
Measured on the real 2015-08-24 session: `new_52w_highs` read **184** against a
consistent-basis **2**, and `pct_above_50sma` **18.7** against **7.5**. The error decayed
to exactly 0.000 by 2026 — because no split has happened yet — which is what identified
it and is why `test_the_defect_does_not_decay_with_recency` below is not optional.

⚠️ SYNTHETIC ON PURPOSE. These rail the MATH PATH, so they build their own levels and
their own minute bars and need neither `bars.db` nor S3. The end-to-end proof against
real history is a separate targeted run; a unit test that needs a 27 GB database is a
unit test nobody runs.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np
import pytest

from api.services import breadth_live as bl
from api.services import breadth_metrics as bm
from api.services import breadth_session as bsess
from api.services import breadth_wick_recon as wr

#: 2024-05-01 09:30 ET — a real regular-session open, so `rth_bounds` sees a domain it
#: recognises instead of a bare epoch that lands after hours.
T0 = int(datetime(2024, 5, 1, 9, 30, tzinfo=ZoneInfo("America/New_York")).timestamp())


@pytest.fixture(autouse=True)
def _tiny_sessions_are_allowed(monkeypatch):
    """⚠️ `rth_bounds` refuses a session with fewer than 50 participating names — the
    right rule for real data and the wrong one for a two-ticker property test. These
    tests are about the BASIS, not about session detection, which has its own suite."""
    monkeypatch.setattr(bsess, "MIN_BUSY_NAMES", 1)


# ── helpers ──────────────────────────────────────────────────────────────────

def _levels(tickers, series, as_of=T0):
    """build_levels over an explicit (ticker x date) close matrix."""
    closes = np.asarray(series, dtype=float)
    vols = np.full_like(closes, 1_000_000.0)
    return bl.build_levels(list(tickers), closes, vols, as_of)


def _minutes(price_by_ticker, n=3, t0=T0):
    """A flat n-bucket session at one price per ticker."""
    return {tk: [{"t": t0 + 60 * i, "c": float(px)} for i in range(n)]
            for tk, px in price_by_ticker.items()}


# ── F2 + registry/filter consistency ─────────────────────────────────────────

def test_near_52w_high_is_NOT_treated_as_a_percentage():
    """⛔ THE F2 DEFECT. `near_52w_high` is a COUNT of securities. It sat in
    `_PCT_METRICS`, so `sane_wick` applied `h > 100` to it and deleted 99.2% of its
    history (137 of 17,298 rows; US kept zero; stored max was exactly 100.0)."""
    assert bm.METRICS["near_52w_high"]["unit"] == bm.UNIT_COUNT
    assert bm.METRICS["near_52w_high"]["domain"] == bm.DOMAIN_NONNEG
    assert "near_52w_high" not in wr._PCT_METRICS


def test_a_near_52w_high_count_above_100_SURVIVES_the_wick_gate():
    """The exact shape that was being thrown away: 874 names near their highs."""
    ok, reason = wr.sane_wick("near_52w_high", 800.0, 874.0, 790.0, 860.0)
    assert ok, reason
    # and a wide COUNT range is fine too - the 30-point rule is a percentage rule
    ok, reason = wr.sane_wick("near_52w_high", 100.0, 500.0, 90.0, 480.0)
    assert ok, reason


def test_the_percentage_rules_still_bite_on_real_percentages():
    """F2 must not have disarmed the anti-garbage guard it was hiding inside."""
    assert "pct_above_50sma" in wr._PCT_METRICS
    ok, _ = wr.sane_wick("pct_above_50sma", 50.0, 140.0, 40.0, 60.0)
    assert not ok, "a pct metric above 100 must still be refused"
    ok, _ = wr.sane_wick("pct_above_50sma", 50.0, 95.0, 5.0, 60.0)
    assert not ok, "a 90-point pct swing is the garbage-wick signature"


def test_PCT_METRICS_is_exactly_the_registry_pct_domain():
    """⭐ THE RAIL. The set is DERIVED; this proves it cannot drift back into a
    hand-maintained list that disagrees with the catalogue."""
    expect = {k for k, m in bm.METRICS.items() if m["domain"] == bm.DOMAIN_PCT}
    assert set(wr._PCT_METRICS) == expect
    # every pct_above_* belongs; no count or signed metric does
    assert {k for k in bm.METRICS if k.startswith("pct_above_")} <= set(wr._PCT_METRICS)
    for k in wr._PCT_METRICS:
        assert bm.METRICS[k]["unit"] != bm.UNIT_COUNT, k
        assert bm.METRICS[k]["domain"] != bm.DOMAIN_SIGNED, k


def test_a_signed_percent_is_not_swept_in_by_unit_based_selection():
    """`aaii_spread` is UNIT_PERCENT but DOMAIN_SIGNED — it crosses zero, so a
    [0,100] clamp would be wrong. Selecting on unit rather than domain would have
    silently caught it."""
    assert bm.METRICS["aaii_spread"]["unit"] == bm.UNIT_PERCENT
    assert bm.METRICS["aaii_spread"]["domain"] == bm.DOMAIN_SIGNED
    assert "aaii_spread" not in wr._PCT_METRICS


def test_every_hand_maintained_metric_list_names_real_registry_metrics():
    """Legacy lists may remain, but none may name a metric the catalogue does not."""
    from api.services import breadth_intraday as bi
    from api.services import breadth_pit_calibrate as bpc
    from api.services import breadth_history_recon as bhr
    from api.services import breadth_combined_pass as cp
    for label, names in (("PATH_METRICS", bi.PATH_METRICS),
                         ("pit_calibrate._PCT_METRICS", bpc._PCT_METRICS),
                         ("_NEVER_SWEEP_STORE", bhr._NEVER_SWEEP_STORE),
                         ("NOT_MEMBER_INDEPENDENT", cp.NOT_MEMBER_INDEPENDENT),
                         ("PIT_UNPRODUCIBLE", bm.PIT_UNPRODUCIBLE),
                         ("_VALIDATE_METRICS", wr._VALIDATE_METRICS)):
        unknown = [n for n in names if n not in bm.METRICS]
        assert not unknown, f"{label} names metrics absent from the registry: {unknown}"


def test_the_other_pct_list_does_not_contradict_the_registry():
    """`breadth_pit_calibrate` keeps its own tuple for a calibration report. It never
    reaches `sane_wick`, but it must not disagree about what a percentage is."""
    from api.services import breadth_pit_calibrate as bpc
    for k in bpc._PCT_METRICS:
        assert bm.METRICS[k]["domain"] == bm.DOMAIN_PCT, k


# ── F1: the basis lift ───────────────────────────────────────────────────────

def test_a_split_does_not_manufacture_a_new_52_week_high():
    """⛔⛔ THE CORPORATE-ACTION PROPERTY TEST, and the whole point of the phase.

    SPLITTER did a 10:1 split AFTER this session, so its adjusted history sits at ~10
    while it actually TRADED at ~100 that day. Un-lifted, the as-traded 100 towers over
    an adjusted 52-week high of ~10.5 and is counted a new high. It is not one: on its
    own basis it traded mid-range."""
    tickers = ["SPLITTER", "STEADY"]
    # 260 sessions; SPLITTER's adjusted series oscillates 9.5-10.5, STEADY 50-52
    hist = [[10.0 + 0.5 * ((i % 4) - 1.5) for i in range(260)],
            [51.0 + 0.5 * ((i % 4) - 1.5) for i in range(260)]]
    lv = _levels(tickers, hist)
    as_traded = {"SPLITTER": 100.0, "STEADY": 51.0}      # SPLITTER trades pre-split
    per = _minutes(as_traded)

    bad = wr.session_ohlc("2015-08-24", per, lv, 1, members=set(tickers))
    good = wr.session_ohlc("2015-08-24", per, lv, 1, members=set(tickers),
                           basis={"SPLITTER": 0.1, "STEADY": 1.0})
    assert bad and good
    assert bad["new_52w_highs"]["c"] == 1.0, "unlifted: the split fakes a new high"
    assert good["new_52w_highs"]["c"] == 0.0, "lifted: no new high, which is the truth"


def test_the_lift_does_not_change_a_name_already_on_the_right_basis():
    """A factor of 1.0 must be a no-op — the fix may not disturb names without actions."""
    tickers = ["STEADY"]
    hist = [[50.0 + 0.25 * ((i % 4) - 1.5) for i in range(260)]]
    lv = _levels(tickers, hist)
    per = _minutes({"STEADY": 50.0})
    a = wr.session_ohlc("2015-08-24", per, lv, 1, members={"STEADY"})
    b = wr.session_ohlc("2015-08-24", per, lv, 1, members={"STEADY"},
                        basis={"STEADY": 1.0})
    assert a and b
    for k in ("pct_above_50sma", "new_52w_highs", "advancing"):
        assert a[k]["c"] == b[k]["c"], k


def test_the_lift_is_scale_invariant_for_a_names_own_comparisons():
    """⭐ WHY THIS IS NORMALISATION AND NOT LOOK-AHEAD. Multiplying a name's price and
    leaving its levels alone is only meaningful because the two are then on ONE scale;
    applying the SAME factor to a name whose levels are already on that scale must not
    move its classification at all."""
    tickers = ["A"]
    hist = [[20.0] * 260]
    lv = _levels(tickers, hist)
    # price 25 on a 20 level -> above, whatever consistent scale both are expressed in
    out1 = wr.session_ohlc("2020-01-02", _minutes({"A": 25.0}), lv, 1, members={"A"},
                           basis={"A": 1.0})
    lv2 = _levels(tickers, [[2.0] * 260])
    out2 = wr.session_ohlc("2020-01-02", _minutes({"A": 25.0}), lv2, 1, members={"A"},
                           basis={"A": 0.1})           # 25 as-traded == 2.5 adjusted
    assert out1["pct_above_50sma"]["c"] == out2["pct_above_50sma"]["c"] == 100.0


def test_a_missing_basis_FAILS_CLOSED_for_a_name_the_levels_carry():
    """⛔ A name in the frame with no factor cannot be compared, so it is dropped
    rather than silently measured on the wrong scale."""
    tickers = ["A", "B"]
    lv = _levels(tickers, [[10.0] * 260, [10.0] * 260])
    per = _minutes({"A": 11.0, "B": 11.0})
    out = wr.session_ohlc("2020-01-02", per, lv, 1, members=set(tickers),
                          basis={"A": 1.0})            # B has no factor
    assert out["universe_count"]["c"] == 1.0, "B must not be counted"


def test_basis_None_is_the_UNLIFTED_path_not_an_empty_lift():
    """⚠️ The dangerous default. `basis=None` must mean 'no lift requested', never
    'lift by an empty map', which would drop every name and return an empty universe."""
    tickers = ["A", "B"]
    lv = _levels(tickers, [[10.0] * 260, [10.0] * 260])
    out = wr.session_ohlc("2020-01-02", _minutes({"A": 11.0, "B": 11.0}), lv, 1,
                          members=set(tickers), basis=None)
    assert out["universe_count"]["c"] == 2.0


def test_the_defect_does_not_decay_with_recency():
    """⭐ THE RECENCY PROPERTY. The old error shrank to zero near the present only
    because no corporate action had happened yet. After the fix, an OLD session with a
    heavy action must be as consistent as a RECENT one with none."""
    tickers = ["T"]
    lv = _levels(tickers, [[10.0] * 260])
    # 2011-style: a 20:1 action since, so the name traded at 200 on an adjusted-10 basis
    old = wr.session_ohlc("2011-01-03", _minutes({"T": 200.0}), lv, 1, members={"T"},
                          basis={"T": 0.05})
    # 2026-style: nothing has happened since, factor is 1
    new = wr.session_ohlc("2026-09-11", _minutes({"T": 10.0}), lv, 1, members={"T"},
                          basis={"T": 1.0})
    assert old["pct_above_50sma"]["c"] == new["pct_above_50sma"]["c"]
    assert old["new_52w_highs"]["c"] == new["new_52w_highs"]["c"]


def test_no_future_price_leaks_through_the_basis_factor():
    """The factor is a ratio of two closes of the SAME session. Two names with identical
    session prices and identical levels must classify identically regardless of what
    corporate action later befell either of them."""
    lv = _levels(["X", "Y"], [[10.0] * 260, [10.0] * 260])
    out = wr.session_ohlc("2012-06-01", _minutes({"X": 40.0, "Y": 10.0}), lv, 1,
                          members={"X", "Y"},
                          basis={"X": 0.25, "Y": 1.0})   # X split 4:1 later, Y never
    # both land on 10 adjusted -> both at their level, neither above it
    assert out["pct_above_50sma"]["c"] == 0.0
    assert out["universe_count"]["c"] == 2.0


# ── F5: the authoritative close ──────────────────────────────────────────────

def test_the_close_comes_from_the_authoritative_eod_price_not_the_last_minute():
    """⛔ F5. O/H/L are the minute path; C is the official EOD cross-section. The two
    differ whenever the closing auction differs from the 15:59 print."""
    tickers = ["A"]
    lv = _levels(tickers, [[10.0] * 260])
    # ⚠️ asserted on a COUNT, not a percentage: a synthetic 0 -> 100 pct swing is
    # exactly the garbage-wick signature `sane_wick` exists to reject, so a pct metric
    # would be (correctly) dropped and prove nothing about the close seam.
    # The minute path stays BELOW the prior close; the closing auction prints above it.
    per = {"A": [{"t": T0 + 60 * i, "c": 9.0} for i in range(5)]}
    out = wr.session_ohlc("2024-05-01", per, lv, 1, members={"A"},
                          basis={"A": 1.0}, eod_prices={"A": 12.0})
    assert out["advancing"]["c"] == 1.0, "Close must use the auction price"
    assert out["advancing"]["o"] == 0.0, "Open must remain the minute path"


def test_eod_prices_absent_preserves_the_old_close_behaviour():
    tickers = ["A"]
    lv = _levels(tickers, [[10.0] * 260])
    per = {"A": [{"t": T0 + 60 * i, "c": 9.0} for i in range(5)]}
    out = wr.session_ohlc("2024-05-01", per, lv, 1, members={"A"}, basis={"A": 1.0})
    assert out["advancing"]["c"] == 0.0


def test_the_authoritative_close_respects_universe_membership():
    """A whole-market EOD frame must be restricted to the cohort being measured, or the
    Close would silently be computed over a different population than O/H/L."""
    lv = _levels(["A", "B"], [[10.0] * 260, [10.0] * 260])
    per = _minutes({"A": 9.0, "B": 9.0})
    out = wr.session_ohlc("2024-05-01", per, lv, 1, members={"A"},
                          basis={"A": 1.0, "B": 1.0},
                          eod_prices={"A": 12.0, "B": 12.0})
    assert out["universe_count"]["c"] == 1.0, "only A is a member"


# ── things that PASSED validation and must not move ──────────────────────────

def test_NETHL_is_still_the_composites_own_path_not_component_extrema():
    """⛔ `max_t (NH(t) - NL(t)) != max_t NH(t) - min_t NL(t)`. Validation confirmed the
    per-bucket construction; the basis fix must not have collapsed it."""
    lv = _levels(["A", "B"], [[10.0] * 260, [10.0] * 260])
    t0 = T0
    # A peaks early, B bottoms late, so the component extrema never coincide
    per = {"A": [{"t": t0, "c": 30.0}, {"t": t0 + 60, "c": 10.0}],
           "B": [{"t": t0, "c": 10.0}, {"t": t0 + 60, "c": 1.0}]}
    out = wr.session_ohlc("2024-05-01", per, lv, 1, members={"A", "B"},
                          basis={"A": 1.0, "B": 1.0})
    nethl, nh, nl = out["net_new_high_low"], out["new_52w_highs"], out["new_52w_lows"]
    assert nethl["h"] <= nh["h"] - nl["l"] + 1e-9
    assert nethl["c"] == pytest.approx(nh["c"] - nl["c"])


def test_the_rth_session_shape_is_untouched_by_the_fix():
    """Bucket enumeration and the prior-close seed passed validation; the lift must only
    rescale values, never change which buckets exist or who is seeded."""
    lv = _levels(["A"], [[10.0] * 260])
    per = _minutes({"A": 10.0}, n=7)
    a = wr.session_ohlc("2024-05-01", per, lv, 1, members={"A"})
    b = wr.session_ohlc("2024-05-01", per, lv, 1, members={"A"}, basis={"A": 1.0})
    # ⚠️ NOT asserted as a literal count. `rth_bounds` treats the busiest late minute as
    # the CLOSING AUCTION and excludes it, so 7 stamped minutes are 6 regular-session
    # bars. That off-by-one is deliberate and already has its own suite; what this test
    # owns is that the basis lift does not move it.
    assert a["_session"]["buckets"] == b["_session"]["buckets"]
    assert a["_session"]["early_close"] == b["_session"]["early_close"]
    assert a["_session"]["open_min"] == b["_session"]["open_min"]
    assert a["_session"]["close_min"] == b["_session"]["close_min"]


def test_session_basis_is_a_ratio_of_two_closes_of_the_same_session(monkeypatch):
    """The seam itself: adjusted(D)/raw(D), and nothing from any other date."""
    import sqlite3
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INT, c REAL)")
    conn.executemany("INSERT INTO ohlcv VALUES (?,?,?,?)",
                     [("SPL", "D", 111, 10.0), ("STD", "D", 111, 50.0),
                      ("SPL", "D", 222, 99.0)])          # a DIFFERENT session
    from api.services import massive
    monkeypatch.setattr(massive, "get_grouped_daily_closes",
                        lambda d, adjusted=True: {"SPL": 100.0, "STD": 50.0})
    monkeypatch.setattr(bl, "_iso", lambda ts: "2015-08-24")
    out = wr.session_basis(conn, 111)
    assert out["SPL"] == pytest.approx(0.1)
    assert out["STD"] == pytest.approx(1.0)


def test_session_basis_returns_empty_when_raw_closes_are_unavailable(monkeypatch):
    """⛔ No basis must mean no session, not an unlifted one."""
    import sqlite3
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INT, c REAL)")
    conn.execute("INSERT INTO ohlcv VALUES ('A','D',111,10.0)")
    from api.services import massive

    def boom(*a, **k):
        raise RuntimeError("provider down")
    monkeypatch.setattr(massive, "get_grouped_daily_closes", boom)
    monkeypatch.setattr(bl, "_iso", lambda ts: "2015-08-24")
    assert wr.session_basis(conn, 111) == {}
