"""The point-in-time frame: eligibility, no-look-ahead, and the coverage census.

No network — the grouped-daily frame and the reference map are supplied directly,
which is exactly how the real builder consumes them.
"""
import pytest

from api.services import breadth_pit_frame as bpf
from api.services import breadth_universes as bu


def _row(c, v):
    return {"o": c, "h": c, "l": c, "c": c, "v": v}


#: One day of "market". MSFT/AAPL are Nasdaq, GE/JNJ NYSE, SPY an ETF on Arca,
#: PENNY too cheap, THIN too illiquid, GHOST has no reference record at all.
DAY = {
    "MSFT": _row(30.0, 50_000_000),
    "AAPL": _row(25.0, 40_000_000),
    "GE": _row(35.0, 30_000_000),
    "JNJ": _row(60.0, 20_000_000),
    "SPY": _row(140.0, 90_000_000),
    "PENNY": _row(1.25, 9_000_000),
    "THIN": _row(40.0, 100),
    "GHOST": _row(12.0, 5_000_000),
    "DEADCO": _row(8.0, 3_000_000),
}

REF = {
    "MSFT": [{"type": "CS", "primary_exchange": "XNAS", "list_date": None, "delisted_utc": None}],
    "AAPL": [{"type": "CS", "primary_exchange": "XNGS", "list_date": None, "delisted_utc": None}],
    "GE": [{"type": "CS", "primary_exchange": "XNYS", "list_date": None, "delisted_utc": None}],
    "JNJ": [{"type": "CS", "primary_exchange": "XNYS", "list_date": None, "delisted_utc": None}],
    "SPY": [{"type": "ETF", "primary_exchange": "ARCX", "list_date": None, "delisted_utc": None}],
    "PENNY": [{"type": "CS", "primary_exchange": "XNAS", "list_date": None, "delisted_utc": None}],
    "THIN": [{"type": "CS", "primary_exchange": "XNYS", "list_date": None, "delisted_utc": None}],
    # GHOST: deliberately absent from REF
    "DEADCO": [{"type": "CS", "primary_exchange": "XNYS",
                "list_date": None, "delisted_utc": "2009-06-30"}],
}


def test_us_selects_common_stock_on_a_major_venue_above_the_floors():
    got, cov = bpf.eligible_on("us", "2008-03-10", DAY, REF)
    assert got == {"MSFT", "AAPL", "GE", "JNJ", "DEADCO"}
    assert cov["frame"] == 9
    assert cov["not_common"] == 1          # SPY (ETF)
    assert cov["fail_price"] == 1          # PENNY
    assert cov["fail_liquidity"] == 1      # THIN
    assert cov["unresolved"] == 1          # GHOST


def test_the_exchange_universes_partition_and_never_include_arca():
    nas, _ = bpf.eligible_on("nasdaq", "2011-03-10", DAY, REF)
    nys, _ = bpf.eligible_on("nyse", "2011-03-10", DAY, REF)
    assert nas == {"MSFT", "AAPL"}         # XNAS + XNGS both count
    # DEADCO is absent because it delisted in 2009, not because of its venue —
    # the 2008 case below is what proves it counts while it was alive.
    assert nys == {"GE", "JNJ"}
    assert not (nas & nys)
    us, _ = bpf.eligible_on("us", "2011-03-10", DAY, REF)
    assert nas | nys <= us                 # US is a superset, never a rival definition


def test_a_delisted_name_is_IN_before_its_delisting_and_OUT_after():
    # ⭐ This is survivorship-freedom in one assertion: DEADCO died in 2009 and must
    # still count in 2008.
    before, _ = bpf.eligible_on("us", "2008-03-10", DAY, REF)
    after, _ = bpf.eligible_on("us", "2010-03-10", DAY, REF)
    assert "DEADCO" in before
    assert "DEADCO" not in after


def test_no_look_ahead_a_name_absent_from_the_days_frame_cannot_be_added():
    # ⛔ The guarantee is structural: reference metadata may only REMOVE. A 2020 IPO
    # is simply not in a 2010 frame, so it cannot appear however rich its record is.
    ref = dict(REF)
    ref["IPO2020"] = [{"type": "CS", "primary_exchange": "XNAS",
                       "list_date": "2020-06-01", "delisted_utc": None}]
    got, _ = bpf.eligible_on("us", "2010-03-10", DAY, ref)
    assert "IPO2020" not in got


def test_an_unresolved_name_is_excluded_and_COUNTED_never_guessed():
    got, cov = bpf.eligible_on("us", "2008-03-10", {"GHOST": _row(12.0, 5_000_000)}, REF)
    assert got == set()
    assert cov["unresolved"] == 1 and cov["resolved"] == 0
    assert cov["coverage_ratio"] == 0.0


def test_coverage_ratio_reports_what_was_classified():
    _, cov = bpf.eligible_on("us", "2008-03-10", DAY, REF)
    assert cov["resolved"] == 8 and cov["frame"] == 9
    assert cov["coverage_ratio"] == pytest.approx(8 / 9, abs=1e-4)
    assert cov["eligible"] == 5


def test_a_blank_venue_is_excluded_rather_than_treated_as_us():
    # The pre-2011 Nasdaq defect looks EXACTLY like this; it must never fall through.
    ref = dict(REF)
    ref["NOVENUE"] = [{"type": "CS", "primary_exchange": "", "list_date": None,
                       "delisted_utc": None}]
    day = dict(DAY, NOVENUE=_row(20.0, 10_000_000))
    got, cov = bpf.eligible_on("us", "2008-03-10", day, ref)
    assert "NOVENUE" not in got
    assert cov["no_venue"] == 1


def test_the_trailing_dollar_volume_overrides_the_days_own_turnover():
    # A single news-spiked session must not add a member the trailing median rejects.
    day = {"SPIKE": _row(10.0, 100_000_000)}
    ref = {"SPIKE": [{"type": "CS", "primary_exchange": "XNAS",
                      "list_date": None, "delisted_utc": None}]}
    loose, _ = bpf.eligible_on("us", "2015-03-10", day, ref)
    assert loose == {"SPIKE"}
    tight, _ = bpf.eligible_on("us", "2015-03-10", day, ref, dollarvol={"SPIKE": 500.0})
    assert tight == set()


def test_uct_cannot_be_built_from_a_pit_frame():
    # Its membership is the collector's stored universe_list, not a venue filter.
    with pytest.raises(bu.UnknownUniverse):
        bpf.eligible_on("uct", "2015-03-10", DAY, REF)


def test_resolve_picks_the_era_that_contains_the_date_for_a_reused_symbol():
    recs = [
        {"type": "CS", "primary_exchange": "XNYS", "list_date": "1998-01-01",
         "delisted_utc": "2009-01-02"},                      # the dead company
        {"type": "ETF", "primary_exchange": "ARCX", "list_date": "2015-01-01",
         "delisted_utc": None},                              # the reassigned symbol
    ]
    assert bpf.resolve(recs, "2008-03-10")["type"] == "CS"
    assert bpf.resolve(recs, "2020-03-10")["type"] == "ETF"
    assert bpf.resolve([], "2020-03-10") is None


def test_build_frame_refuses_a_pit_universe_below_its_floor_before_fetching():
    # The floor check must precede any provider work.
    with pytest.raises(bu.BelowHistoryFloor):
        bpf.build_frame("nasdaq", "2009-01-05", "2009-01-09")


def test_a_sweep_date_with_no_RAW_frame_refuses_the_whole_chunk(monkeypatch):
    """⚰️ MEASURED IN A CONTROL SWEEP, not theorised.

    `massive.get_grouped_daily_ohlcv` swallows every exception and returns `{}`, so a
    FAILED raw fetch arrives looking exactly like a quiet day. Eligibility over `{}`
    yields zero members, every metric is then None, nothing is written — and the
    sweep reports SUCCESS over a window with a hole in it. A control asked for 48
    sessions, held raw frames for 5, and silently produced 5.
    """
    from api.services import massive

    sessions = ["2015-03-09", "2015-03-10", "2015-03-11"]
    adj = {t: {"o": 10.0, "h": 11.0, "l": 9.0, "c": 10.0, "v": 5_000_000}
           for t in ("AAA", "BBB")}

    def _grouped(day_iso, adjusted=False):
        if day_iso not in sessions:
            return {}                      # a real non-trading day
        if adjusted:
            return adj                     # the market DID trade
        # the RAW fetch fails on the middle session only
        return {} if day_iso == "2015-03-10" else adj

    monkeypatch.setattr(massive, "get_grouped_daily_ohlcv", _grouped)
    monkeypatch.setattr(bpf, "reference_map", lambda force=False: {})

    out = bpf.build_frame("us", "2015-03-09", "2015-03-11", warmup_days=3)
    assert out["ok"] is False
    assert out["missing_raw"] == ["2015-03-10"]
    # ⛔ and it names what happened, so a grind's log says "fetch failed" rather than
    # leaving a reader to infer it from a gap months later
    assert "raw grouped-daily frame" in out["reason"]
    assert "silent gap" in out["reason"]
