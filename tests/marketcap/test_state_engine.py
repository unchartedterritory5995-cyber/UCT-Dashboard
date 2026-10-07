from datetime import date, datetime, timedelta, timezone

from api.services.fundamentals_pit.splits import Ledger, Split
from api.services.marketcap import reasons as R
from api.services.marketcap.engine import Component, Listing, Structure, company_cap
from api.services.marketcap.state import Obs, timeline, validate


def pub(d, hh=12):  # hh in UTC
    return datetime(d.year, d.month, d.day, hh, 0, tzinfo=timezone.utc)


def ob(as_of, filed, v, src=R.COVER_XBRL, form="10-Q", accn=None):
    return Obs(as_of=as_of, public_at=pub(filed), value=v, source=src, form=form, accn=accn or f"a-{as_of}-{src}-{filed}")


def days(a, b):
    out, d = [], a
    while d <= b:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def test_state_persists_beyond_200_days_and_stops_at_bound():
    # ARM class: one count, no newer evidence for 300 days -> still valid (the 200-day lapse is gone)
    ch = validate([ob(date(2024, 1, 1), date(2024, 1, 10), 1.0e9)], Ledger())
    tl = timeline(ch, [date(2024, 1, 9), date(2024, 1, 10), date(2024, 10, 28), date(2025, 4, 1), date(2025, 4, 2)])
    assert tl[0].reason == R.PRE_FIRST
    assert tl[1].value == 1.0e9
    assert tl[2].value == 1.0e9          # 301 days
    assert tl[3].value == 1.0e9          # 456 days
    assert tl[4].reason == R.STALE       # 457 days: safety ceiling


def test_newer_as_of_supersedes_only_when_public():
    ch = validate([ob(date(2024, 3, 31), date(2024, 5, 10), 110e6, R.BALANCE_SHEET_XBRL),
                   ob(date(2024, 1, 20), date(2024, 2, 1), 100e6)], Ledger())
    tl = timeline(ch, [date(2024, 5, 9), date(2024, 5, 10)])
    assert tl[0].value == 100e6          # March 31 count invisible before May 10
    assert tl[1].value == 110e6


def test_after_close_filing_is_known_next_day():
    o = Obs(date(2024, 1, 1), datetime(2024, 1, 10, 21, 30, tzinfo=timezone.utc), 5e6, R.COVER_XBRL, "x", "10-K")
    assert o.known_from == date(2024, 1, 11)   # 16:30 ET


def test_split_normalized_both_sides_no_discontinuity():
    # NVDA-like 10:1 on 2024-06-10: pre-split count x10 == post-split count
    led = Ledger([Split(date(2024, 6, 10), 10.0)])
    ch = validate([ob(date(2024, 5, 17), date(2024, 5, 29), 2.46e9), ob(date(2024, 8, 16), date(2024, 8, 28), 24.5e9)], led)
    tl = timeline(ch, [date(2024, 6, 7), date(2024, 6, 10), date(2024, 8, 28)])
    assert tl[0].value == tl[1].value == 24.6e9
    assert abs(tl[2].value / tl[1].value - 1) < 0.01


def test_restated_basis_detected():
    # balance-sheet count as of 2024-04-28 (pre-split) but published AFTER the split on the post-split basis
    led = Ledger([Split(date(2024, 6, 10), 10.0)])
    ch = validate([ob(date(2024, 2, 16), date(2024, 2, 21), 2.46e9),
                   ob(date(2024, 4, 28), date(2024, 8, 28), 24.6e9, R.BALANCE_SHEET_XBRL)], led)
    c = [x for x in ch if x.obs.as_of == date(2024, 4, 28)][0]
    assert c.status == R.ACCEPTED_RESTATED_BASIS and c.normalized == 24.6e9


def test_scale_error_rejected_and_outlier_rejected():
    obs = [ob(date(2020, 1, 1), date(2020, 1, 5), 500e6), ob(date(2020, 4, 1), date(2020, 4, 5), 500e3),
           ob(date(2020, 7, 1), date(2020, 7, 5), 505e6), ob(date(2020, 10, 1), date(2020, 10, 5), 2.1e9),
           ob(date(2021, 1, 1), date(2021, 1, 5), 510e6)]
    ch = validate(obs, Ledger())
    st = {c.obs.as_of: c.status for c in ch}
    assert st[date(2020, 4, 1)] == R.REJ_SCALE_UNRESOLVED          # 1000x down, nothing independent agrees
    assert st[date(2020, 10, 1)] == R.REJ_SCALE_UNRESOLVED         # 4x up, decided WITHOUT the reverting next report
    assert st[date(2021, 1, 1)] == R.ACCEPTED
    tl = timeline(ch, [date(2020, 4, 6), date(2020, 7, 6), date(2020, 10, 6), date(2021, 1, 5)])
    assert [t.reason for t in tl] == [R.SCALE_UNRESOLVED, None, R.SCALE_UNRESOLVED, None]
    assert tl[1].value == 505e6 and tl[3].value == 510e6


def test_same_as_of_conflict_refuses_both():
    obs = [ob(date(2020, 1, 1), date(2020, 1, 5), 100e6), ob(date(2020, 1, 1), date(2020, 1, 6), 150e6, R.BALANCE_SHEET_XBRL)]
    ch = validate(obs, Ledger())
    # PIT: the cover count is fine until the contradicting balance sheet is public; from then on, withheld
    assert {c.status for c in ch if c.obs.source == R.BALANCE_SHEET_XBRL} == {R.REJ_CONFLICT}
    tl = timeline(ch, [date(2020, 1, 5), date(2020, 1, 6)])
    assert tl[0].value == 100e6 and tl[1].reason == R.SOURCE_CONFLICT


def test_amendment_supersedes_from_its_publication():
    obs = [ob(date(2020, 1, 1), date(2020, 1, 5), 100e6, accn="o"),
           ob(date(2020, 1, 1), date(2020, 2, 5), 104e6, form="10-Q/A", accn="a")]
    tl = timeline(validate(obs, Ledger()), [date(2020, 1, 6), date(2020, 2, 5)])
    assert tl[0].value == 100e6 and tl[1].value == 104e6


def test_pre_edgar_reason():
    tl = timeline([], [date(1990, 1, 2), date(1997, 1, 2)])
    assert [t.reason for t in tl] == [R.PRE_EDGAR, R.PRE_FIRST]


def _st(v, d):
    from api.services.marketcap.state import DayState
    return DayState(v, None if v else R.STALE, ob(d, d, 1.0) if v else None)


def test_multi_listed_no_double_count_and_ticker_reuse():
    d0, d1 = date(2014, 3, 31), date(2014, 4, 3)
    s = Structure("MULTI_LISTED", [Component("CLASS_A", "GOOGL"), Component("CLASS_B", "GOOGL"),
                                   Component("CLASS_C", "GOOG", start=d1)])
    states = {"CLASS_A": {d0: _st(290e6, d0), d1: _st(290e6, d1)}, "CLASS_B": {d0: _st(50e6, d0), d1: _st(50e6, d1)},
              "CLASS_C": {d1: _st(340e6, d1)}}
    closes = {"GOOGL": {d0: 560.0, d1: 570.0}, "GOOG": {d1: 565.0}}
    lst = {"GOOGL": Listing("GOOGL", date(2004, 8, 19)), "GOOG": Listing("GOOG", d1)}
    a, b = company_cap([d0, d1], s, states, closes, lst)
    assert a.value == 340e6 * 560.0
    assert b.value == 340e6 * 570.0 + 340e6 * 565.0
    arm = company_cap([date(2010, 1, 4)], Structure("SINGLE", [Component("COMMON", "ARM")]), {}, {},
                      {"ARM": Listing("ARM", date(2023, 9, 14), prior_other_issuer=True)})
    assert arm[0].reason == R.TICKER_REUSE


def test_adr_uses_ads_ratio_never_ads_price_times_ordinary():
    d = date(2024, 1, 2)
    s = Structure("ADR", [Component("COMMON", "TSM", multipliers=((None, None, 1 / 5),), evidence="20-F cover")])
    cap = company_cap([d], s, {"COMMON": {d: _st(25.9e9, d)}}, {"TSM": {d: 100.0}}, {"TSM": Listing("TSM", date(1997, 10, 9))})
    assert abs(cap[0].value - 25.9e9 / 5 * 100.0) < 1


def test_unresolved_structure_reason():
    cap = company_cap([date(2020, 1, 2)], Structure("UNRESOLVED", reason=R.COMPLEX), {}, {}, {})
    assert cap[0].reason == R.COMPLEX


def test_primary_listing_reason_precedes_unresolved_structure():
    lst = {"ARM": Listing("ARM", date(2023, 9, 14), prior_other_issuer=True)}
    out = company_cap([date(2010, 1, 4), date(2024, 1, 2)], Structure("UNRESOLVED", reason=R.ADR_RATIO), {}, {}, lst, "ARM")
    assert [c.reason for c in out] == [R.TICKER_REUSE, R.ADR_RATIO]


def test_one_filing_with_several_values_for_one_as_of_refuses_all_never_picks_the_smallest():
    """AEP 2011: a combined filing's cover listed the parent and six subsidiaries for the same date."""
    from datetime import datetime, timezone
    from api.services.marketcap import state as ST
    t = datetime(2011, 8, 5, 20, tzinfo=timezone.utc)
    obs = [ST.Obs(date(2011, 7, 29), t, v, R.COVER_XBRL, "0000004904-11-000110", "10-Q")
           for v in (482_273_829, 1_400_000, 13_499_500)]
    out = ST.validate(obs, ST.Ledger())
    assert all(c.status == R.REJ_CONFLICT for c in out) and not any(c.usable for c in out)


def test_split_ledger_gap_withholds_every_earlier_day_and_never_infers_a_factor():
    """BXMT 2013: a 1:10 reverse split the ledger lacks -- adjusted price continuous, state /10, cap /10."""
    from api.services.marketcap.build import split_ledger_gap_hold
    d = [date(2013, 5, 1) + timedelta(days=i) for i in range(10)]
    pclose = {x: 25.0 for x in d}
    runs = {("i", "COMMON"): [("2013-05-01", "2013-05-05", 29_266_514, "a", "2013-03-05", "COVER_XBRL"),
                              ("2013-05-06", "2013-05-10", 2_926_651, "b", "2013-05-06", "COVER_XBRL")]}
    caps = {x: (29_266_514 if x < date(2013, 5, 6) else 2_926_651) * 25.0 for x in d}
    assert split_ledger_gap_hold(runs, pclose, caps) == date(2013, 5, 6)
    # a genuine split the ledger HAS is already normalized: no split-like state ratio -> no hold
    runs_ok = {("i", "COMMON"): [("2013-05-01", "2013-05-05", 2_926_651, "a", "2013-03-05", "COVER_XBRL"),
                                 ("2013-05-06", "2013-05-10", 2_930_000, "b", "2013-05-06", "COVER_XBRL")]}
    assert split_ledger_gap_hold(runs_ok, pclose, {x: 2_926_651 * 25.0 for x in d}) is None
    # a split the PRICE also shows (unadjusted bars) keeps the cap continuous -> no hold
    pc2 = {x: (25.0 if x < date(2013, 5, 6) else 250.0) for x in d}
    caps2 = {x: (29_266_514 * 25.0 if x < date(2013, 5, 6) else 2_926_651 * 250.0) for x in d}
    assert split_ledger_gap_hold(runs, pc2, caps2) is None
