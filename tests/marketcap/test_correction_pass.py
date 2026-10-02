"""2026-10-02 correction pass: the rules that removed the 63-security order-of-magnitude blocker cohort."""
from datetime import date, datetime, timedelta, timezone

from api.services.fundamentals_pit.splits import Ledger, Split
from api.services.marketcap import adr as A, classecon, lineage as LIN, prospectus as PR, reasons as R, splitev as SE
from api.services.marketcap.build import split_ledger_gaps, unlisted_split_events
from api.services.marketcap.state import Obs, timeline, validate
from api.services.marketcap.structure import class_key, filing_keys, invalid_member, resolve


def pub(d, hh=14):
    return datetime(d.year, d.month, d.day, hh, 0, tzinfo=timezone.utc)


def ob(as_of, filed, v, src=R.COVER_XBRL, form="10-Q", accn=None, tag="dei:EntityCommonStockSharesOutstanding"):
    return Obs(as_of, pub(filed), v, src, accn or f"{as_of}-{src}-{filed}", form, tag)


# ── split semantics ───────────────────────────────────────────────────────────────────────────────────────
def test_count_dated_after_the_split_is_never_adjusted_for_it_again():
    led = Ledger([Split(date(2024, 6, 10), 10.0)])
    ch = validate([ob(date(2024, 7, 20), date(2024, 8, 1), 24.5e9)], led)
    assert ch[0].normalized == 24.5e9


def test_pre_split_count_carried_across_a_forward_split_is_transformed():
    led = Ledger([Split(date(2024, 6, 10), 10.0)])
    tl = timeline(validate([ob(date(2024, 5, 17), date(2024, 5, 29), 2.45e9)], led), [date(2024, 6, 7), date(2024, 6, 10)])
    assert tl[0].value == tl[1].value == 24.5e9


def test_split_effective_time_boundary():
    led = Ledger([Split(date(2024, 6, 10), 10.0)])
    on = validate([ob(date(2024, 6, 10), date(2024, 6, 20), 24.5e9)], led)[0]          # as-of ON the ex-date: post-split
    before = validate([ob(date(2024, 6, 7), date(2024, 6, 8), 2.45e9)], led)[0]        # the trading day before
    assert on.normalized == 24.5e9 and before.normalized == 24.5e9


def test_split_between_as_of_and_publication_decided_by_filing_text_else_refused_and_blocking():
    """PAVS: '78,732 ... as of March 31, 2026 (retroactively adjusted to reflect the 1-for-100 reverse split effective
    on June 29, 2026)', published 2026-08-14. Without a state in force, nothing may guess the basis."""
    led = Ledger([Split(date(2026, 6, 29), 0.01)])
    o = ob(date(2026, 3, 31), date(2026, 8, 14), 78_732, form="20-F", accn="pavs")
    refused = validate([o], led)[0]
    assert refused.status == R.REJ_BASIS_AMBIGUOUS and refused.block[2] == R.SPLIT_BASIS_UNRESOLVED
    decided = validate([o], led, basis_evidence={"pavs": "PUBLIC"})[0]
    assert decided.status == R.ACCEPTED_RESTATED_BASIS and decided.normalized == 78_732


def test_count_dated_before_a_reverse_split_is_not_carried_across_it():
    led = Ledger([Split(date(2026, 4, 6), 1 / 16)])
    ch = validate([ob(date(2025, 12, 31), date(2026, 3, 7), 6_400_000, form="20-F")], led)
    ev = [(date(2026, 4, 6), R.REVERSE_SPLIT_RECOUNT)]
    tl = timeline(ch, [date(2026, 4, 3), date(2026, 4, 6), date(2026, 9, 1)], events=ev)
    assert tl[0].value == 400_000 and tl[1].reason == tl[2].reason == R.REVERSE_SPLIT_RECOUNT
    tl2 = timeline(ch + validate([ob(date(2026, 5, 1), date(2026, 5, 5), 900_000)], led),
                   [date(2026, 5, 4), date(2026, 5, 5)], events=ev)
    assert tl2[0].reason == R.REVERSE_SPLIT_RECOUNT and tl2[1].value == 900_000        # a post-split recount releases it


def test_unlisted_split_like_price_step_is_detected_never_inferred():
    d = [date(2025, 9, 1) + timedelta(days=i) for i in range(5)]
    closes = {d[0]: 1.0, d[1]: 1.01, d[2]: 20.2, d[3]: 20.0, d[4]: 19.9}            # x20 step, no ledger split
    assert unlisted_split_events(d, closes, []) == [(d[2], R.UNLISTED_SPLIT_SUSPECTED)]
    assert unlisted_split_events(d, closes, [Split(d[2], 0.05)]) == []                # explained by the ledger
    # ⭐ a price step is an event only when the authoritative counts on either side CONFIRM it (glitches are common)
    assert unlisted_split_events(d, closes, [], [(date(2025, 6, 30), 2e6), (date(2025, 9, 30), 2e6)]) == []
    assert unlisted_split_events(d, closes, [], [(date(2025, 6, 30), 2e6), (date(2025, 9, 30), 1e5)]) == [(d[2], R.UNLISTED_SPLIT_SUSPECTED)]
    closes[d[2]] = 2.6                                                                # a 2.57x move: not a clean factor
    assert unlisted_split_events(d, closes, []) == []


# ── historical split evidence ─────────────────────────────────────────────────────────────────────────────
def test_historical_split_text_statements_parse():
    got = SE.parse_splits("On May 15, 1998 the Company effected a two-for-one stock split in the form of a 100% stock dividend.")
    assert {round(r, 4) for r, *_ in got} == {2.0}
    got = SE.parse_splits("On October 5, 2016, Arconic effected a 1-for-3 reverse stock split of its common stock.")
    assert round(got[0][0], 4) == 0.3333 and got[0][3] == [date(2016, 10, 5)]


def test_historical_split_confirmed_only_by_same_factor_inside_the_window():
    ev = [("2016-10-05", 0.3333, "XBRL:StockholdersEquityNoteStockSplitConversionRatio1", "a", "x")]
    c = SE.confirm(ev, 3, "REVERSE", date(2016, 7, 20), date(2016, 10, 20))
    assert c and c[0] == date(2016, 10, 5) and abs(c[1] - 1 / 3) < 1e-3
    assert SE.confirm(ev, 3, "REVERSE", date(2017, 1, 20), date(2017, 4, 20)) is None   # outside the transition
    assert SE.confirm(ev, 2, "REVERSE", date(2016, 7, 20), date(2016, 10, 20)) is None  # a different factor


def test_false_split_candidate_contradicted_by_a_dated_statement_of_another_factor():
    ev = [("2013-05-06", 0.1, "XBRL:StockholdersEquityNoteStockSplitConversionRatio1", "a", "1-for-10")]
    assert SE.contradicted(ev, 2, "FORWARD", date(2013, 3, 5), date(2013, 5, 10))
    assert SE.confirm(ev, 2, "FORWARD", date(2013, 3, 5), date(2013, 5, 10)) is None


def test_split_ledger_gap_detection_reports_every_transition():
    d = [date(2013, 5, 1) + timedelta(days=i) for i in range(10)]
    pclose = {x: 25.0 for x in d}
    runs = {("i", "COMMON"): [("2013-05-01", "2013-05-05", 29_266_514, "a", "2013-03-05", "COVER_XBRL"),
                              ("2013-05-06", "2013-05-10", 2_926_651, "b", "2013-05-06", "COVER_XBRL")]}
    caps = {x: (29_266_514 if x < date(2013, 5, 6) else 2_926_651) * 25.0 for x in d}
    g = split_ledger_gaps(runs, pclose, caps)
    assert len(g) == 1 and g[0]["k"] == 10 and g[0]["direction"] == "REVERSE" and g[0]["date"] == date(2013, 5, 6)


# ── invalid units, suspicious and scale ───────────────────────────────────────────────────────────────────
def test_invalid_units_and_adr_member_rows_are_never_share_counts():
    assert invalid_member("col:$ / shares", None)
    assert invalid_member("ifrs-full_ClassesOfShareCapital=dei_AdrMember", None)
    assert invalid_member("sqns_AmericanDepositarySharesMember", None)
    assert not invalid_member("us-gaap_CommonClassAMember", "Common Class A [Member]")


def test_suspicious_tiny_count_refused_unless_another_channel_corroborates():
    hq = validate([ob(date(2025, 12, 31), date(2026, 4, 1), 1.0, form="20-F")], Ledger())[0]
    assert hq.status == R.REJ_SUSPICIOUS and hq.block[2] == R.SUSPICIOUS_SHARE_COUNT
    same_channel_repeat = validate([ob(date(2025, 12, 31), date(2026, 4, 1), 1.0, accn="a"),
                                    ob(date(2026, 3, 31), date(2026, 5, 1), 1.0, accn="b")], Ledger())
    assert not any(c.usable for c in same_channel_repeat)                      # a repeated placeholder is not evidence
    real = validate([ob(date(2025, 12, 31), date(2026, 4, 1), 5_000, accn="a"),
                     ob(date(2025, 12, 31), date(2026, 4, 1), 5_000, R.BALANCE_SHEET_XBRL, accn="a",
                        tag="us-gaap:CommonStockSharesOutstanding")], Ledger())
    assert any(c.usable for c in real)


def test_scale_error_first_observation_contradicted_inside_its_own_filing_is_refused():
    """BNTX 2021: the 20-F cover said 241,521,065,000 while its balance sheet said ~241M."""
    bad = ob(date(2021, 3, 30), date(2021, 3, 30), 241_521_065_000, form="20-F", accn="f")
    good = ob(date(2020, 12, 31), date(2021, 3, 30), 241_000_000, R.BALANCE_SHEET_XBRL, form="20-F", accn="f",
              tag="ifrs-full:NumberOfSharesOutstanding")
    ipo = ob(date(2019, 10, 10), date(2019, 10, 9), 226_000_000, R.IPO_PROSPECTUS, form="424B4", accn="ipo")
    st = {c.obs.value: c for c in validate([bad, good, ipo], Ledger())}
    assert st[241_521_065_000].status == R.REJ_SCALE_UNRESOLVED
    assert st[241_000_000].usable


def test_scale_error_never_anchors_later_correct_counts():
    """CLBK/TTAM: one x1000 value used to make EVERY later correct count 'bad scale'."""
    obs = [ob(date(2018, 6, 30), date(2018, 8, 1), 254_956_185_000, R.BALANCE_SHEET_XBRL, tag="us-gaap:CommonStockSharesOutstanding"),
           ob(date(2019, 3, 31), date(2019, 5, 1), 254_000_000, accn="q1"),
           ob(date(2019, 3, 31), date(2019, 5, 1), 254_100_000, R.BALANCE_SHEET_XBRL, accn="q1", tag="us-gaap:CommonStockSharesOutstanding"),
           ob(date(2019, 6, 30), date(2019, 8, 1), 254_200_000, accn="q2")]
    ch = validate(obs, Ledger())
    tl = timeline(ch, [date(2018, 8, 2), date(2019, 5, 1), date(2019, 8, 1)])
    # an exact x1000 gap: at 2019-05-01 nobody can tell which side is the unit error -> withheld; a SECOND filing
    # at the 254M level settles it (from its own publication) and the x1000 value is withheld retroactively
    assert tl[0].value is None and tl[0].reason == R.SCALE_UNRESOLVED
    assert tl[1].value is None and tl[1].reason == R.SCALE_UNRESOLVED
    assert tl[2].value == 254_200_000


# ── classes ───────────────────────────────────────────────────────────────────────────────────────────────
def test_dimensional_generic_common_beside_a_class_is_its_own_class():
    keys = filing_keys([("us-gaap_CommonClassAMember", "Common Class A [Member]"), ("us-gaap_CommonStockMember", "Common Stock [Member]")])
    assert keys[("us-gaap_CommonStockMember", "Common Stock [Member]")] == "CS"                     # GTN
    assert class_key("us-gaap_NonvotingCommonStockMember", "Nonvoting Common Stock [Member]").startswith("OTHER:")  # UHAL.B


def test_two_listed_classes_priced_by_one_ticker_is_refused():
    res = resolve({"A": 10.0, "B": 5.0}, {"A": "HOV", "B": "HOV"}, None)
    assert res.structure.kind == "UNRESOLVED" and res.structure.reason == R.MULTI_CLASS


def test_listed_other_class_priced_by_its_own_ticker():
    res = resolve({"A": 19e6, "OTHER:us-gaap_NonvotingCommonStockMember": 175e6},
                  {"A": "UHAL", "OTHER:us-gaap_NonvotingCommonStockMember": "UHAL.B"}, None)
    assert res.structure.kind == "MULTI_LISTED"
    assert sorted(c.price_ticker for c in res.structure.components) == ["UHAL", "UHAL.B"]


def test_conversion_ratio_is_a_per_share_term_never_a_transaction_count():
    e = classecon.extract("During November 2025, the CEO transferred 1,000,000 shares of Class B common stock, which "
                          "automatically converted into 1,000,000 shares of Class A common stock upon the transfer.")
    assert not e.conversions                                                                       # VTIX x1,000,000
    e = classecon.extract("Each share of Class B common stock is convertible into one share of Class A common stock.")
    assert e.conversions["B"][:2] == ("A", 1.0)
    e = classecon.extract("each of our Class B Common Share may be converted into one Class A Common Share and one Conversion Share.")
    assert not e.conversions                                                                       # JBS compound


# ── ADR / ADS ─────────────────────────────────────────────────────────────────────────────────────────────
def test_inverse_ads_ratio():
    assert A.parse_ratio("American Depositary Shares, or ADSs, each twenty (20) ADSs representing one (1) Common Share")[:2] == (0.05, "OK")


def test_dated_ratio_never_applied_far_backward_and_breaks_at_an_ordinary_basis_change():
    s24 = A.RatioStatement(date(2024, 5, 16), 480.0, "a", "")
    assert A.ratio_at(date(2023, 12, 31), [s24], Ledger()) == s24                       # next annual report: OK
    assert A.ratio_at(date(2021, 12, 31), [s24], Ledger()) is None                      # > 400 days backward
    pts = [(date(2023, 12, 31), 0.94e9), (date(2025, 12, 31), 93.7e9)]                 # DXF ordinary subdivision
    assert A.ratio_at(date(2025, 12, 31), [s24], Ledger(), 93.7e9, pts) is None


def test_stale_ratio_title_across_ads_events_is_dropped():
    """SQNS: 2020 'each representing four', ADS events 2024 (x0.4) and 2025 (x0.1), 2026 title still 'four' while the
    ordinary count did not move by those factors."""
    led = Ledger([Split(date(2024, 10, 9), 0.4), Split(date(2025, 9, 17), 0.1)])
    st = [A.RatioStatement(date(2020, 3, 30), 4.0, "a", ""), A.RatioStatement(date(2026, 3, 1), 4.0, "b", "")]
    pts = [(date(2023, 12, 31), 1.0e9), (date(2025, 12, 31), 1.6e9)]
    assert [x.accn for x in A.valid_statements(st, led, pts)] == ["a"]


def test_ads_listing_follows_the_filings_titles():
    f = A.ads_listed_fn([(date(2019, 11, 19), True), (date(2020, 8, 1), False)], fallback=True)   # RCEL redomicile
    assert f(date(2018, 1, 1)) and f(date(2020, 1, 1)) and not f(date(2021, 1, 1))
    assert not A.ads_title("Depositary Shares representing a 1/20th Interest in a Share of Series B Mandatory Convertible Preferred Stock")
    assert A.ads_title("American Depository Shares, each representing 10 ordinary shares")


# ── successor lineage ─────────────────────────────────────────────────────────────────────────────────────
PURE = ("On October 2, 2015, Google implemented a holding company reorganization pursuant to the Agreement and Plan of "
        "Merger. Each share of each class of Google stock issued and outstanding immediately prior to the Alphabet Merger "
        "automatically converted into an equivalent corresponding share of Alphabet stock. The Alphabet Merger was "
        "conducted pursuant to Section 251(g) of the DGCL. Alphabet has, on a consolidated basis, the same assets, "
        "businesses and operations as Google had immediately prior to the consummation of the Alphabet Merger. "
        "Google (Commission File No. 001-36380).")
MERGE = ("On March 20, 2019, the Company completed the previously announced acquisition of Twenty-First Century Fox. Each "
         "share of Fox common stock was converted into the right to receive $38.00 in cash or 0.4517 shares of Disney "
         "common stock, subject to the exchange ratio.")


def test_lineage_pure_reorganization_vs_merger_boundary_vs_unresolved():
    p = LIN.classify(PURE)
    assert p["kind"] == "PURE_REORGANIZATION" and p["effective"] == date(2015, 10, 2) and "001-36380" in p["file_numbers"]
    assert LIN.classify(MERGE)["kind"] == "MERGER"
    assert LIN.classify("Pursuant to Rule 12g-3(a), the Company is the successor issuer.")["kind"] == "AMBIGUOUS"
    # a holding company reorganization WITHOUT a same-assets / same-ownership statement is not proven
    assert LIN.classify(PURE.replace("the same assets, businesses and operations", "certain assets"))["kind"] == "AMBIGUOUS"


def test_lineage_file_numbers_normalize_for_the_sec_registry():
    assert "001-02256" in LIN._norm_fileno("1-2256") and "1-2256" in LIN._norm_fileno("001-02256")
    assert not LIN._norm_fileno("1-2256") & LIN._norm_fileno("1-22560")


# ── offering documents ────────────────────────────────────────────────────────────────────────────────────
def test_offering_document_actual_counts_only_recent_and_never_pro_forma():
    t = ("Class A Ordinary Shares to be outstanding after this offering 90,985,063 Class A Ordinary Shares (assuming full "
         "exercise of the Warrants). Unless otherwise indicated, the number of Class A Ordinary Shares outstanding prior to "
         "and after this Offering is based on 40,985,063 Class A Ordinary Shares outstanding as of June 15, 2026. The above "
         "discussion is based on 667,247 Class A Ordinary Shares outstanding as of September 30, 2025.")
    r = PR.parse(t, date(2026, 6, 16))
    assert r.status == "MULTI_CLASS" and [(h.class_label, h.count) for h in r.hits] == [("A", 40_985_063)]
    assert PR.parse("Total Ordinary Shares outstanding before this offering 31,834,487 Ordinary Shares Total Ordinary Shares "
                    "outstanding immediately after this offering 43,619,999 Ordinary Shares, assuming sale of 11,673,152",
                    date(2026, 7, 24)).hits[0].count == 31_834_487
    assert PR.parse("based on 1,000,000 American Depositary Shares outstanding as of June 1, 2026", date(2026, 6, 16)).status == "NOT_FOUND"


def test_unit_error_filed_in_thousands_in_both_channels_is_withheld_never_rescaled():
    """HNRG 2012: the 10-K cover AND balance sheet said 28,309 (thousands) between filings that said ~28.3M."""
    bs = "us-gaap:CommonStockSharesOutstanding"
    obs = [ob(date(2011, 9, 30), date(2011, 11, 5), 28_300_000, accn="q3"),
           ob(date(2012, 2, 20), date(2012, 3, 5), 28_309, accn="k"),
           ob(date(2011, 12, 31), date(2012, 3, 5), 28_309, R.BALANCE_SHEET_XBRL, accn="k", tag=bs),
           ob(date(2012, 4, 30), date(2012, 5, 4), 28_350_000, accn="q1")]
    tl = timeline(validate(obs, Ledger()), [date(2011, 11, 7), date(2012, 3, 6), date(2012, 5, 4)])
    assert tl[0].value == 28_300_000
    assert tl[1].value is None and tl[1].reason == R.SCALE_UNRESOLVED       # never 28,309, never 28.3M carried
    assert tl[2].value == 28_350_000


def test_reverse_split_recount_only_when_issuance_was_registered_after_the_count():
    """GE 2021 1-for-8 with a current count carries across; a count followed by an offering does not (PAVS / INLF)."""
    led = Ledger([Split(date(2021, 8, 2), 1 / 8)])
    ch = validate([ob(date(2021, 7, 20), date(2021, 7, 27), 8.78e9)], led)
    days_ = [date(2021, 8, 2), date(2021, 9, 1)]
    no_offer = timeline(ch, days_, events=[])                                                   # no offering filed
    assert all(abs(t.value - 8.78e9 / 8) < 1 for t in no_offer)
    offer_after_count = [(date(2021, 8, 2), R.REVERSE_SPLIT_RECOUNT, date(2021, 7, 25))]       # 424B5 on 07-25
    assert [t.reason for t in timeline(ch, days_, events=offer_after_count)] == [R.REVERSE_SPLIT_RECOUNT] * 2
    offer_before_count = [(date(2021, 8, 2), R.REVERSE_SPLIT_RECOUNT, date(2021, 7, 1))]       # count already reflects it
    assert all(t.value for t in timeline(ch, days_, events=offer_before_count))


def test_registered_quantity_is_evidence_of_issuance_never_a_count():
    """ZBAO F-1 2026-08-31: 'resale ... of up to an aggregate of 414,275,709 Class A Ordinary Shares' (state: 16.2M)."""
    h = PR.parse_registered("This prospectus relates to the offer and resale by the investors listed in the table under "
                            "Selling Shareholders of up to an aggregate of 414,275,709 Class A Ordinary Shares (including ...)")
    assert h.class_label == "A" and h.count == 414_275_709 and h.as_of is None
    assert PR.parse_registered("This prospectus relates to 1,000,000 American Depositary Shares") is None
    # the timeline event it produces withholds the superseded count (and never values anything)
    ch = validate([ob(date(2025, 9, 9), date(2025, 9, 10), 16_245_132, R.OFFERING_TEXT, form="F-1")], Ledger())
    tl = timeline(ch, [date(2026, 8, 31), date(2026, 9, 1)], events=[(date(2026, 9, 1), R.ISSUANCE_EXCEEDS_STATE, date(2026, 9, 1))])
    assert tl[0].value == 16_245_132 and tl[1].reason == R.ISSUANCE_EXCEEDS_STATE
