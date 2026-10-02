"""Acceptance authority (no lookahead from mislabelled SEC times), the production BEFORE baseline, new text shapes."""
import gzip
import json
import sqlite3
from datetime import date, datetime, timezone

from api.services.marketcap import acceptance as A, baseline as B, textcover as T
from api.services.marketcap.state import Obs
from api.services.marketcap import reasons as R

UTC = timezone.utc


# ── acceptance authority ───────────────────────────────────────────────────────────────────────────────────
def test_edgar_eastern_record_to_utc_edt_est_and_dst():
    assert A.eastern_to_utc("20260930163038") == datetime(2026, 9, 30, 20, 30, 38, tzinfo=UTC)      # EDT +4
    assert A.eastern_to_utc("20260115163038") == datetime(2026, 1, 15, 21, 30, 38, tzinfo=UTC)      # EST +5
    assert A.eastern_to_utc("20261101013000") == datetime(2026, 11, 1, 6, 30, tzinfo=UTC)           # fold: LATER


def test_conservative_reading_is_never_earlier_than_either_interpretation():
    # SEC served "16:30:38Z" for a filing accepted 16:30:38 ET: the UTC reading is 4 h early
    c = A.conservative("2026-09-30T16:30:38+00:00")
    assert c == datetime(2026, 9, 30, 20, 30, 38, tzinfo=UTC)
    # a correctly served true-UTC value is only ever made LATER, never earlier
    c2 = A.conservative("2026-09-30T20:30:38+00:00")
    assert c2 >= datetime(2026, 9, 30, 20, 30, 38, tzinfo=UTC)


def test_hierarchy_v5_corrected_then_edgar_record_then_conservative(tmp_path):
    exp = tmp_path / "v5.csv.gz"
    ts = int(datetime(2026, 9, 30, 20, 30, 38, tzinfo=UTC).timestamp())
    with gzip.open(exp, "wt") as f:
        f.write(f"A-1,1,10-Q,20260930,{ts},{ts},0,1\nD-4,1,10-K,20260302,{ts},{ts},0,1\n")
    hdr = tmp_path / "hdr"
    hdr.mkdir()
    (hdr / "B-2.txt").write_text("20261001153318")
    (hdr / "A-1.txt").write_text("20260930163038")
    A.build(str(tmp_path / "acc.db"), str(exp), str(hdr))
    au = A.Authority(str(tmp_path / "acc.db"))
    pa, src = au.resolve("A-1", "2026-09-30T16:30:38+00:00", "2026-09-30")
    assert pa == datetime(2026, 9, 30, 20, 30, 38, tzinfo=UTC) and src == "EDGAR_HEADER"
    pb, srcb = au.resolve("B-2", "2026-10-01T15:33:18+00:00", "2026-10-01")
    assert pb == datetime(2026, 10, 1, 19, 33, 18, tzinfo=UTC)
    pc, srcc = au.resolve("C-3", "2026-10-01T15:00:00+00:00", "2026-10-01")
    assert srcc == "CONSERVATIVE" and pc == datetime(2026, 10, 1, 19, 0, tzinfo=UTC)


def test_after_close_filing_misread_as_utc_would_leak_into_the_same_close():
    """The defect the authority removes: accepted 16:30 ET, served '16:30Z' (= 12:30 ET) -> known for the 16:00 close."""
    misread = Obs(date(2026, 8, 30), datetime(2026, 9, 30, 16, 30, 38, tzinfo=UTC), 1e6, R.COVER_XBRL, "x", "10-Q")
    true = Obs(date(2026, 8, 30), A.public_at(A.eastern_to_utc("20260930163038"), date(2026, 9, 30)), 1e6,
               R.COVER_XBRL, "x", "10-Q")
    assert misread.known_from == date(2026, 9, 30)          # would set the 09-30 close: lookahead
    assert true.known_from == date(2026, 10, 1)             # the market could first use it at the 10-01 close


def test_build_refuses_without_the_acceptance_authority(tmp_path):
    from api.services.marketcap import build
    for n in ("inputs.db", "prices.db"):
        sqlite3.connect(tmp_path / n).close()
    assert build.main(["--data", str(tmp_path), "--out", str(tmp_path / "out")]) == 2


# ── BEFORE baseline: production semantics ─────────────────────────────────────────────────────────────────
def _t(y, m, d, h=20):
    return int(datetime(y, m, d, h, tzinfo=UTC).timestamp())


def test_baseline_reproduces_the_200_day_period_age_blank():
    pts = [[_t(2024, 5, 1), 1000.0, "2024-03-31", "instant"]]
    days = [20240430, 20240501, 20241016, 20241017, 20241018]
    got = B.project(pts, days)
    assert got[0] == (None, "no_point")                   # before the point is public
    assert got[1][1] == "ok"                              # 16:00 ET close after a 20:00Z (16:00 ET) publication
    assert got[2][1] == "ok"                              # 199 days after 2024-03-31
    assert got[4] == (None, "stale")                      # > 200 days: production goes BLANK


def test_baseline_gap_point_blanks():
    pts = [[_t(2024, 5, 1), 1000.0, "2024-03-31", "instant"], [_t(2024, 8, 1), None, "2024-06-30", "gap"]]
    assert B.project(pts, [20240805])[0] == (None, "gap_point")


# ── text shapes added for 1990s-2000s covers (INTC) ───────────────────────────────────────────────────────
def test_intc_table_in_millions_and_annual_millions_statement():
    q = ("Shares outstanding of the Registrant's common stock: Class Outstanding at April 24, 1999 Common Stock, "
         "$.001 par value 3,318 million PART I - FINANCIAL INFORMATION")
    r = T.parse(T.normalize(q), date(1999, 5, 10), "10-Q")
    assert r.status == "OK" and r.hits[0].count == 3_318_000_000 and r.hits[0].as_of == date(1999, 4, 24)
    k = ("Aggregate market value of voting stock held by non-affiliates of the registrant as of February 22, 2002 "
         "$197.9 billion 6,703 million shares of common stock outstanding as of February 22, 2002 DOCUMENTS INCORPORATED")
    r = T.parse(T.normalize(k), date(2002, 3, 13), "10-K")
    assert r.status == "OK" and r.hits[0].count == 6_703_000_000            # never the $197.9 billion float


def test_million_shape_refuses_dollar_amounts():
    t = ("Shares outstanding of the Registrant's common stock: Class Outstanding at April 24, 1999 aggregate market "
         "value $3,318 million PART I")
    r = T.parse(T.normalize(t), date(1999, 5, 10), "10-Q")
    assert r.status != "OK"


def test_preferred_depositary_shares_are_never_a_common_equity_class():
    """GOOGN: Massive types it CS; it is a depositary share of Series B Mandatory Convertible PREFERRED stock."""
    from api.services.marketcap.build import NOT_COMMON_EQUITY as N
    assert N.search("Alphabet Inc. Depositary Shares representing a 1/20th Interest in a Share of Series B "
                    "Mandatory Convertible Preferred Stock")
    for name in ("Alphabet Inc. Class C Capital Stock", "Berkshire Hathaway Inc. Class B", "Unity Software Inc.",
                 "United Rentals Inc", "Seniortronics", "Brookdale Senior Living, Inc.", "Our Bond, Inc. Common Stock",
                 "Energy Transfer LP Common Units representing limited partner interests",
                 "America Movil S.A.B de C.V American Depositary Shares (each representing the right to receive twenty "
                 "(20) Series B Shares)",
                 "Braskem S.A. American Depositary Shares (Each representing Two Class A  Preferred Shares)"):
        assert not N.search(name), name
    for name in ("Diversified Healthcare Trust 5.625% Senior Notes due 2042",
                 "Entergy Mississippi, LLC First Mortgage Bonds, 4.90% Series due October 1, 2066",
                 "AGNC Investment Corp. Depositary Shares, each representing a 1/1,000th interest in a share of 6.875% "
                 "Series D Fixed-to-Floating Cumulative Redeemable Preferred Stock",
                 "Acme Acquisition Corp. Units, each consisting of one share and one-half of one warrant",
                 "Acme Acquisition Corp. Warrants"):
        assert N.search(name), name
