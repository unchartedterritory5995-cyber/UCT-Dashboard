from datetime import date, timedelta

from api.services.marketcap import ipo, reasons as R, textcover as T
from api.services.marketcap.identity import Ref, decide


def bdays(a, b):
    out, d = [], a
    while d <= b:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def test_arm_reuse_refused_by_massive_list_date():
    days = bdays(date(2003, 9, 10), date(2011, 3, 29)) + bdays(date(2023, 9, 14), date(2024, 1, 5))
    dec = decide("ARM", 1973239, days, Ref("ARM", cik=1973239, list_date=date(2023, 9, 14)), date(2023, 8, 21), foreign=True)
    assert dec.listing.start == date(2023, 9, 14) and dec.basis == "MASSIVE_LIST_DATE"
    assert dec.pre_reason == R.TICKER_REUSE and dec.listing.prior_other_issuer


def test_massive_record_of_another_cik_is_ignored_but_reuse_still_proven():
    days = bdays(date(2003, 9, 10), date(2006, 8, 3)) + bdays(date(2008, 3, 19), date(2008, 6, 1))
    dec = decide("V", 1403161, days, Ref("V", cik=999, list_date=date(1990, 1, 1)), date(2007, 10, 1))
    assert dec.listing.start == date(2008, 3, 19) and dec.basis == "SEGMENT_AFTER_REUSE"
    assert dec.pre_reason == R.TICKER_REUSE and any("ignored" in n for n in dec.notes)


def test_continuous_pre_listing_bars_are_not_yet_listed_not_reuse():
    days = bdays(date(2003, 9, 10), date(2006, 1, 1))
    dec = decide("MPT", 1287865, days, Ref("MPT", cik=1287865, list_date=date(2005, 7, 8)), date(2004, 4, 16))
    assert dec.listing.start == date(2005, 7, 8) and dec.pre_reason == R.NOT_YET_LISTED


def test_text_parser_shapes():
    fd = date(2005, 5, 6)
    t = "Indicate the number of shares outstanding of the registrant's common stock, $0.01 par value, as of May 2, 2005: 394,944,096. Table of Contents"
    r = T.parse(T.normalize(t), fd, "10-Q")
    assert r.status == "OK" and r.hits[0].count == 394944096 and r.hits[0].as_of == date(2005, 5, 2)
    t2 = ("Indicate the number of shares outstanding of each of the registrant's classes of common stock, as of the latest "
          "practicable date. 92,627,503 SHARES AS OF FEBRUARY 28, 1994. DOCUMENTS INCORPORATED BY REFERENCE")
    assert T.parse(T.normalize(t2), date(1994, 3, 7), "10-K").hits[0].count == 92627503


def test_text_parser_multi_class_never_a_total_and_refuses_float():
    t = ("State the aggregate market value of the voting stock held by non-affiliates of the Registrant - $76,272,000,000 "
         "Indicate number of shares outstanding of each of the Registrant's classes of common stock: March 19, 1999 -- "
         "Class A Common Stock, $5 par value....1,343,357 shares March 19, 1999 -- Class B Common Stock, $0.1667 par value"
         "....5,274,030 shares DOCUMENTS INCORPORATED BY REFERENCE")
    r = T.parse(T.normalize(t), date(1999, 3, 30), "10-K")
    assert r.status == "MULTI_CLASS" and r.complete
    assert {h.class_label: h.count for h in r.hits} == {"A": 1343357, "B": 5274030}
    t2 = ("As of November 12, 2008, there were 448,979,024 shares outstanding of the registrant's class A common stock, "
          "par value $0.0001 per share, 245,513,385 shares outstanding of the registrant's class B common stock, par value "
          "$0.0001 per share, and 151,596,308 shares outstanding of the registrant's class C common stock.")
    r2 = T.parse(T.normalize(t2), date(2008, 11, 21), "10-K")
    assert r2.status == "MULTI_CLASS"                       # never "OK" with class A alone


def test_text_parser_refuses_two_unlabelled_counts():
    t = ("Indicate the number of shares outstanding: as of May 2, 2005: 394,944,096. The number of shares outstanding "
         "as of May 3, 2005 was 395,000,000.")
    assert T.parse(T.normalize(t), date(2005, 5, 6), "10-Q").status == "AMBIGUOUS"


def test_ipo_parser():
    t = ("Ordinary shares to be outstanding upon completion of this offering 1,026,054,856 ordinary shares. "
         "American depositary shares Each ADS represents one ordinary share")
    assert ipo.parse(t).counts == {"COMMON": 1026054856.0}
    t2 = ("Class A common stock offered by us 5,000,000 shares Class A common stock to be outstanding after this offering "
          "98,682,548 shares (or 103,682,548 shares if the underwriters exercise their option) Class B common stock to be "
          "outstanding after this offering 489,565,703 shares Total Class A and Class B common stock to be outstanding "
          "after this offering 588,248,251 shares")
    r = ipo.parse(t2)
    assert r.status == "MULTI_CLASS" and r.counts["A"] == 98682548 and r.counts["B"] == 489565703
