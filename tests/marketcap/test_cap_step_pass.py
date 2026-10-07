"""2026-10-02 cap-step adjudication pass: the systemic evidence rules behind the 52 V1-specific >= 10x day-to-day cap
steps. No symbol is named in code; the cases in the docstrings are the measured motivating examples."""
from datetime import date, datetime, timezone

from api.services.marketcap import reasons as R
from api.services.fundamentals_pit.splits import Ledger
from api.services.marketcap.build import (LISTED_MINIMUM_SHARES, extreme_step_decisions, own_counts_continuous,
                                          reported_symbol_switch, split_in_trading_break, split_like_gaps)
from api.services.marketcap.state import Obs, validate


def ob(as_of, filed, v):
    return Obs(as_of, datetime(filed.year, filed.month, filed.day, 14, tzinfo=timezone.utc), v, R.COVER_XBRL,
               f"{as_of}-{filed}", "10-Q", "dei:EntityCommonStockSharesOutstanding")


def row(ck, as_of, norm, accn, form="10-Q", status="ACCEPTED"):
    r = [None] * 23
    r[1], r[3], r[4], r[8], r[13], r[14], r[18] = "cik:1", ck, as_of, norm, accn, form, status
    return tuple(r)


def closes(*ds):
    return {date.fromisoformat(d): 10.0 for d in ds}


def test_extreme_step_refuses_an_uncorroborated_state():
    """HR 2006: 15,200 shares (a non-traded REIT's sponsor stake) -> 227M; no other filing agrees with 15,200."""
    caps = {date(2007, 3, 1): 7600 * 10.0, date(2011, 8, 15): 113e6 * 10.0}
    runs = {("cik:1", "COMMON"): [("2006-11-09", "2007-03-02", 7600.0, "a1", "2006-11-08", "COVER_TEXT"),
                                  ("2011-08-15", "2011-11-11", 113e6, "a9", "2011-08-10", "COVER_XBRL")]}
    rows = [row("COMMON", "2006-11-08", 7600.0, "a1"), row("COMMON", "2011-08-10", 113e6, "a9"),
            row("COMMON", "2011-06-30", 113.2e6, "a8"),
            row("COMMON", "2007-02-28", 371700.0, "a2", status="REJECTED_SCALE_UNCORROBORATED")]
    dec = extreme_step_decisions(caps, closes("2007-03-01", "2011-08-15"), runs, rows, [], [])
    assert date(2007, 3, 1) in dec and date(2011, 8, 15) not in dec
    assert dec[date(2007, 3, 1)][0] == R.SCALE_UNRESOLVED


def test_corroborated_counts_with_an_offering_between_are_a_real_capital_change():
    """CPF 2011 recapitalization: 1.5M split-adjusted -> 39.6M, an S-1 between."""
    caps = {date(2011, 2, 25): 1.52e6 * 10.0, date(2011, 5, 13): 39.6e6 * 10.0}
    runs = {("cik:1", "COMMON"): [("2010-11-08", "2011-02-25", 1.52e6, "b1", "2010-11-02", "COVER_TEXT"),
                                  ("2011-05-13", "2011-06-17", 39.6e6, "b3", "2011-04-29", "COVER_TEXT")]}
    rows = [row("COMMON", "2010-11-02", 1.52e6, "b1"), row("COMMON", "2010-09-30", 1.52e6, "b0"),
            row("COMMON", "2011-04-29", 39.6e6, "b3"), row("COMMON", "2011-03-31", 39.6e6, "b2")]
    assert extreme_step_decisions(caps, closes("2011-02-25", "2011-05-13"), runs, rows, [("2011-02-18", "S-1")], []) == {}
    # the same counts, nothing bridging them and no capital-event filing between: unproven, the earlier state is held
    dec = extreme_step_decisions(caps, closes("2011-02-25", "2011-05-13"), runs, rows, [], [])
    assert date(2011, 2, 25) in dec and date(2011, 5, 13) not in dec


def test_a_split_like_extreme_step_without_a_ledger_split_is_a_split_gap():
    """CMCL: 487.9M ordinary (2007) against 19.2M (2023) across a consolidation the ledger lacks; here exactly 1/25."""
    caps = {date(2009, 3, 31): 25e6 * 10.0, date(2023, 5, 18): 1e6 * 10.0}
    runs = {("cik:1", "COMMON"): [("2008-05-09", "2009-03-31", 25e6, "c1", "2007-12-31", "COVER_TEXT"),
                                  ("2023-05-18", "2024-05-14", 1e6, "c3", "2023-05-16", "OFFERING_DOCUMENT_TEXT")]}
    rows = [row("COMMON", "2007-12-31", 25e6, "c1"), row("COMMON", "2008-06-30", 25e6, "c0"),
            row("COMMON", "2023-05-16", 1e6, "c3"), row("COMMON", "2022-12-31", 1e6, "c2")]
    dec = extreme_step_decisions(caps, closes("2009-03-31", "2023-05-18"), runs, rows, [], [])
    assert dec and all(d < date(2023, 5, 18) for d in dec) and next(iter(dec.values()))[0] == R.HIST_SPLIT_UNRESOLVED
    # with the split on file it is not a gap (the earlier state is then simply unproven -- no capital event either)
    dec2 = extreme_step_decisions(caps, closes("2009-03-31", "2023-05-18"), runs, rows, [], [date(2013, 6, 1)])
    assert dec2 and next(iter(dec2.values()))[0] == R.SCALE_UNRESOLVED
    # a capital event between does not explain a 25x FALL (issuance never shrinks a count)
    assert extreme_step_decisions(caps, closes("2009-03-31", "2023-05-18"), runs, rows, [("2015-01-01", "S-4")], [])


def test_dilution_bridged_by_issuer_counts_is_served():
    caps = {date(2024, 1, 2): 1e5 * 10.0, date(2024, 12, 2): 4e6 * 10.0}
    runs = {("cik:1", "COMMON"): [("2023-12-01", "2024-01-02", 1e5, "d1", "2023-11-30", "COVER_XBRL"),
                                  ("2024-12-02", "2024-12-31", 4e6, "d5", "2024-11-30", "COVER_XBRL")]}
    rows = [row("COMMON", "2023-11-30", 1e5, "d1"), row("COMMON", "2023-09-30", 1e5, "d0"),
            row("COMMON", "2024-03-31", 4e5, "d2"), row("COMMON", "2024-06-30", 1.5e6, "d3"),
            row("COMMON", "2024-09-30", 3.9e6, "d4"), row("COMMON", "2024-11-30", 4e6, "d5")]
    assert extreme_step_decisions(caps, closes("2024-01-02", "2024-12-02"), runs, rows, [], []) == {}


def test_a_shells_own_history_is_not_the_listed_security():
    """Linde plc: 25,000 shares on its 2017-2018 covers, 551M after the 2018-10-31 combination."""
    shell = [("COMMON", ob(date(2017, 9, 30), date(2017, 10, 31), 25_000), None),
             ("COMMON", ob(date(2018, 3, 23), date(2018, 3, 23), 25_000), None),
             ("COMMON", ob(date(2018, 9, 30), date(2018, 11, 10), 551e6), None),
             ("COMMON", ob(date(2018, 12, 31), date(2019, 3, 1), 547e6), None)]
    holdco = [("COMMON", ob(date(2018, 9, 30), date(2018, 11, 1), 195e6), None),
              ("COMMON", ob(date(2019, 1, 31), date(2019, 2, 20), 196e6), None)]
    assert not own_counts_continuous(shell, date(2018, 11, 2))
    assert own_counts_continuous(holdco, date(2019, 1, 2))


def test_the_issuer_reported_another_symbol_before_a_combination():
    """HTA reported "HTA" until 2022-05 and "HR" from 2022-08 (the Healthcare Realty merger, 229M -> 380M shares)."""
    reports = [("2022-05-09", {"HTA"}), ("2022-08-08", {"HR"}), ("2022-11-07", {"HR"})]
    counts = [(date(2022, 4, 29), 229e6), (date(2022, 7, 29), 380e6)]
    sw = reported_symbol_switch("HR", reports, ["HR"], ["HR"], counts)
    assert sw and sw[0] == date(2022, 8, 8)
    # a pure rename keeps the count: the stitched history stays
    assert reported_symbol_switch("HR", reports, ["HR"], ["HR"], [(date(2022, 4, 29), 229e6), (date(2022, 7, 29), 230e6)]) is None
    # a symbol in the issuer's own ticker history is a rename of this security
    assert reported_symbol_switch("HR", reports, ["HR"], ["HTA", "HR"], counts) is None
    # counts far from the switch prove nothing (AIM: HEB in 2019, AIM reported from 2021 -- two years of issuance)
    assert reported_symbol_switch("HR", [("2019-05-15", {"HTA"}), ("2021-08-16", {"HR"})], ["HR"], ["HR"],
                                  [(date(2019, 3, 31), 2e6), (date(2021, 8, 1), 48e6)]) is None


def test_a_ledger_split_inside_a_trading_break_cannot_be_verified():
    days = [date(2007, 7, 23), date(2007, 7, 24), date(2009, 11, 16), date(2009, 11, 17)]
    assert split_in_trading_break(days, date(2007, 7, 25))
    assert not split_in_trading_break(days, date(2009, 11, 17))


def test_a_count_below_the_listing_minimum_is_not_the_listed_securitys():
    """Viatris (Upjohn Inc.) reported "100 shares" on its 2020 covers (a 50,000-share count here, above the tiny-count rule) before the Mylan combination; those were priced for
    ten months at the stitched MYL bars. An unlisted class (a convertible class B) is not subject to it."""
    o = ob(date(2020, 6, 30), date(2020, 8, 12), 50_000)
    o2 = ob(date(2020, 3, 31), date(2020, 5, 13), 50_000)
    listed = validate([o, o2], Ledger([]), min_listed=LISTED_MINIMUM_SHARES)
    assert all(c.status == R.REJ_SUSPICIOUS and c.block for c in listed)
    unlisted = validate([o, o2], Ledger([]))
    assert any(c.usable for c in unlisted)


def test_a_split_like_step_between_served_states_is_a_split_gap():
    """AMGN: 510M (1999-06-30) -> 1,027M (2000-03-31) across a 2-for-1 the pre-2003 ledger lacks."""
    caps = {date(1999, 9, 1): 1.0, date(2000, 5, 1): 1.0}
    runs = {("cik:1", "COMMON"): [("1999-08-03", "2000-03-06", 509_955_945.0, "e1", "1999-06-30", "COVER_TEXT"),
                                  ("2000-04-27", "2000-07-31", 1_026_769_316.0, "e2", "2000-03-31", "COVER_TEXT")]}
    gaps = split_like_gaps(runs, caps, [], [], [], set())
    assert len(gaps) == 1 and gaps[0]["k"] == 2 and gaps[0]["date"] == date(2000, 4, 27)
    assert split_like_gaps(runs, caps, [], [], ["1999-11-22"], set()) == []                 # the split is on file
    assert split_like_gaps(runs, caps, [], ["1999-12-01"], [], set()) == []                 # an offering between
    mids = [row("COMMON", "1999-12-31", 760e6, "e9")]                                          # gradual through counts
    assert split_like_gaps(runs, caps, mids, [], [], set()) == []


def test_a_10x_fall_is_never_explained_by_issuance_and_old_events_explain_nothing():
    """RIME 2022: 36.6M -> 3.0M with an uplisting offering between (a 1-for-30 the ledger lacks); counts 15 years apart
    with 'some offering between' (CMCL) prove nothing."""
    caps = {date(2022, 5, 25): 1.2e6 * 10.0, date(2022, 7, 15): 1e5 * 10.0}
    runs = {("cik:1", "COMMON"): [("2022-02-14", "2022-05-25", 1.2e6, "f1", "2022-02-11", "COVER_XBRL"),
                                  ("2022-07-15", "2022-08-19", 1e5, "f2", "2022-03-31", "COVER_XBRL")]}
    rows = [row("COMMON", "2022-02-11", 1.2e6, "f1"), row("COMMON", "2021-12-31", 1.2e6, "f0"),
            row("COMMON", "2022-03-31", 1e5, "f2"), row("COMMON", "2022-06-30", 1e5, "f3")]
    dec = extreme_step_decisions(caps, closes("2022-05-25", "2022-07-15"), runs, rows, [("2022-03-01", "424B4")], [])
    assert dec and next(iter(dec.values()))[0] == R.HIST_SPLIT_UNRESOLVED
    caps2 = {date(2009, 3, 31): 1e6 * 10.0, date(2023, 5, 18): 30e6 * 10.0}
    runs2 = {("cik:1", "COMMON"): [("2008-05-09", "2009-03-31", 1e6, "g1", "2007-12-31", "COVER_TEXT"),
                                   ("2023-05-18", "2024-05-14", 30e6, "g2", "2023-05-16", "COVER_TEXT")]}
    rows2 = [row("COMMON", "2007-12-31", 1e6, "g1"), row("COMMON", "2008-06-30", 1e6, "g0"),
             row("COMMON", "2023-05-16", 30e6, "g2"), row("COMMON", "2022-12-31", 30e6, "g3")]
    dec2 = extreme_step_decisions(caps2, closes("2009-03-31", "2023-05-18"), runs2, rows2, [("2015-01-01", "S-3")], [])
    assert dec2 and all(d < date(2023, 5, 18) for d in dec2)
