"""Methodology M3 (owner decisions 2026-10-05): offering projections of an ALREADY-PUBLIC security.

Rule 1: a preliminary (assumed-terms) projection is usable only once the offering's pricing is public, timed by the ONE
existing clock (acceptance authority -> Obs.known_from: public by 16:00 ET -> that day's close).
Rule 2: a priced prospectus that counts pre-funded warrants as shares outstanding leaves no common-share projection.
Traditional IPOs and listings whose pricing is unobservable in V1's inputs keep the existing behaviour.
Every build test runs the REAL build (build.main) on a tiny data dir."""
from __future__ import annotations

import os
import sqlite3
from datetime import date, datetime, timezone

import pytest

from api.services.marketcap import offering_status as OS, reasons as R
from api.services.marketcap.acceptance import Authority
from api.services.marketcap.state import Obs

from .identity_fixtures import Fixture, build, rows, valued

CIK = 701
LIST = date(2020, 5, 1)                       # first bar (Friday); covers before it are pre-listing


def _data(tmp, *, market=("PUBLIC",), final_public=None, prefunded=False, final_projection=None, cut_after=None, name="d"):
    """An uplisting-shaped issuer: quarterly covers (the 2020-06-30 cover, filed 2020-08-04, is the first post-listing
    actual), a preliminary S-1/A projection (filed 2020-04-20) and optionally a final 424B4 public at `final_public`."""
    fx = Fixture(str(tmp), {CIK: {"name": "UPLISTER", "shares": 2.76e6, "span": (date(2019, 1, 1), date(2020, 9, 30)),
                                  "bars": {"UPL": (LIST, date(2020, 10, 30), 7.66)}}})
    d = fx.write({CIK: ["UPL"]}, name)
    inp, acc = sqlite3.connect(os.path.join(d, "inputs.db")), sqlite3.connect(os.path.join(d, "acceptance.db"))
    docs = [("P1", "S-1/A", "2020-04-20", "2020-04-20T12:14:28+00:00")]
    if final_public:
        docs.append(("F1", "424B4", final_public[:10], final_public))
    for accn, form, fd, pub in docs:
        inp.execute("INSERT INTO filing VALUES (?,?,?,?,?,?,?,?,?,?)", (CIK, accn, form, fd, None, pub, pub, accn + ".htm", 0, 0))
        acc.execute("INSERT INTO acceptance VALUES (?,?,?,?)", (accn, pub, "EDGAR_HEADER", None))
    if cut_after:                                # an evidence PREFIX: nothing filed after the cut exists yet
        inp.execute("DELETE FROM filing WHERE filing_date > ?", (cut_after,))
        inp.execute("DELETE FROM fact WHERE filed > ?", (cut_after,))
    inp.commit()
    acc.commit()
    ipo = sqlite3.connect(os.path.join(d, "ipo.db"))
    ipo.execute("CREATE TABLE ipo_obs(cik INTEGER, accn TEXT, form TEXT, filing_date TEXT, listing_start TEXT, status TEXT, class TEXT, "
                "count REAL, snippet TEXT, note TEXT)")
    ipo.execute("INSERT INTO ipo_obs VALUES (?,?,?,?,?,?,?,?,?,?)", (CIK, "P1", "S-1/A", "2020-04-20", LIST.isoformat(), "OK", "COMMON",
                                                                   1765080.0, "to be outstanding after this offering 1,765,080", ""))
    if final_public and final_projection:
        ipo.execute("INSERT INTO ipo_obs VALUES (?,?,?,?,?,?,?,?,?,?)", (CIK, "F1", "424B4", final_public[:10], LIST.isoformat(), "OK",
                                                                       "COMMON", final_projection, "", ""))
    ipo.commit()
    ipo.close()
    off = sqlite3.connect(os.path.join(d, "offering.db"))
    off.executescript(OS.DDL)
    for i, st in enumerate(market):
        off.execute("INSERT INTO market VALUES (?,?,?,?,?,?)", (CIK, LIST.isoformat(), "P1" if i == 0 else f"P{i + 1}", "S-1/A", st, None))
    if final_public and (not cut_after or final_public[:10] <= cut_after):
        for proj in ("P1", "F1") if final_projection else ("P1",):
            off.execute("INSERT INTO priced VALUES (?,?,?,?,?,?,?)", (CIK, LIST.isoformat(), proj, "F1", "424B4", int(prefunded), None))
    off.commit()
    off.close()
    return d


def _days(b):
    return sorted(valued(b, CIK))


def _reason(b, d):
    r = rows(b, "SELECT reason FROM gap_run WHERE cik=? AND start<=? AND end>=?", CIK, d, d)
    return r[0][0] if r else None


# ── the one clock ─────────────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("public_utc, known", [
    (datetime(2020, 5, 4, 11, 0, tzinfo=timezone.utc), date(2020, 5, 4)),     # 07:00 ET, before the open -> that close
    (datetime(2020, 5, 4, 17, 19, tzinfo=timezone.utc), date(2020, 5, 4)),    # 13:19 ET, intraday -> that close
    (datetime(2020, 5, 4, 20, 0, tzinfo=timezone.utc), date(2020, 5, 4)),     # 16:00 ET exactly -> that close
    (datetime(2020, 5, 4, 21, 24, tzinfo=timezone.utc), date(2020, 5, 5)),    # 17:24 ET, after the close -> next day
])
def test_v1_clock_is_public_by_16_00_et_for_that_close(public_utc, known):
    assert Obs(date(2020, 5, 1), public_utc, 1, R.COVER_XBRL, "x", "424B4").known_from == known


def test_acceptance_authority_conservative_reading_moves_an_ambiguous_evening_filing_later(tmp_path):
    # no acceptance record: the submissions clock digits may be Eastern labelled UTC -> the LATER reading
    a = Authority(None)
    pa, src = a.resolve("none", "2020-05-04T21:24:31+00:00", "2020-05-04")
    assert src == "CONSERVATIVE" and pa == datetime(2020, 5, 5, 1, 24, 31, tzinfo=timezone.utc)


# ── evidence classification ───────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("sentence", [
    "Our common stock is quoted on the OTCQB marketplace under the symbol “DCTH.”",
    "Our common shares are traded on the Norwegian OTC List, an over-the-counter market administered by the NSDA.",
    "Currently, our common stock is quoted on the OTCQB under the symbol “CBRA”.",
    "Our common shares are listed on the Toronto Stock Exchange under the symbol TOC.",
])
def test_already_public_statements(sentence):
    assert OS.market_status(sentence)[0] == "PUBLIC"


def test_traditional_ipo_and_ambiguous_statements():
    assert OS.market_status("Prior to this offering, there has been no public market for our common stock.")[0] == "NO_MARKET"
    both = ("Our ordinary shares are quoted on the OTC Markets Pink tier under the symbol GRDAF. "
            "Prior to this offering, there has been no public market for our ordinary shares or warrants.")
    assert OS.market_status(both)[0] == "AMBIGUOUS"
    assert OS.market_status("If our common stock is delisted, our common stock may be eligible to trade on the OTCQB.")[0] == "NONE"


def test_prefunded_basis_detection():
    t = ("Common stock to be outstanding after this offering 2,272,773 shares (1) ... (1) assuming the exercise in full of the "
         "pre-funded warrants.")
    assert OS.prefunded_basis(t)
    assert OS.prefunded_basis("There is no established public trading market for the pre-funded warrants.") is None


# ── Rule 1: pre-pricing ───────────────────────────────────────────────────────────────────────────────────────────────
def test_rule1_after_close_pricing_holds_two_sessions(tmp_path):
    b = build(_data(tmp_path, final_public="2020-05-04T21:24:31+00:00"), str(tmp_path / "o"))
    v = _days(b)
    assert v[0] == 20200505                                       # 05-01 (Fri) and 05-04 (Mon) held
    assert _reason(b, 20200501) == R.IPO_UNRESOLVED and _reason(b, 20200504) == R.IPO_UNRESOLVED


def test_rule1_intraday_pricing_is_usable_for_that_close(tmp_path):
    b = build(_data(tmp_path, final_public="2020-05-04T17:19:08+00:00"), str(tmp_path / "o"))
    assert _days(b)[0] == 20200504                                # only 05-01 held (BLNK / PPSI / CABR shape)
    assert _reason(b, 20200501) == R.IPO_UNRESOLVED


def test_rule1_value_after_pricing_is_the_unchanged_v1_projection(tmp_path):
    b = build(_data(tmp_path, final_public="2020-05-04T17:19:08+00:00"), str(tmp_path / "o"))
    assert abs(valued(b, CIK)[20200504] / (1765080 * 7.66) - 1) < 1e-9
    assert rows(b, "SELECT tag FROM observation WHERE accession='P1' AND validation_status='ACCEPTED'")[0][0].endswith(
        ";eligible_from_pricing:F1")


# ── Rule 2: priced composition ────────────────────────────────────────────────────────────────────────────────────────
def test_rule2_prefunded_basis_leaves_no_common_projection(tmp_path):
    b = build(_data(tmp_path, final_public="2020-05-04T21:24:31+00:00", prefunded=True, final_projection=2272773.0),
              str(tmp_path / "o"))
    v = _days(b)
    assert v[0] == 20200804                                       # first post-listing actual (06-30 cover, filed 08-04)
    assert _reason(b, 20200505) == R.IPO_UNRESOLVED
    refused = rows(b, "SELECT accession FROM observation WHERE validation_status=?", R.REJ_PROJECTION_NOT_COMMON)
    assert sorted(a for (a,) in refused) == ["F1", "P1"]


# ── unchanged behaviour ───────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("kw", [dict(market=("NO_MARKET",)), dict(market=("PUBLIC", "NO_MARKET")), dict(market=("AMBIGUOUS",)),
                                dict(market=("NONE",))])
def test_traditional_ipo_and_unclear_market_keep_v1(tmp_path, kw):
    b = build(_data(tmp_path, final_public="2020-05-04T21:24:31+00:00", **kw), str(tmp_path / "o"))
    assert _days(b)[0] == 20200501


def test_pricing_unobservable_keeps_v1(tmp_path):
    b = build(_data(tmp_path, final_public=None), str(tmp_path / "o"))
    assert _days(b)[0] == 20200501


def test_without_offering_evidence_the_build_is_m2(tmp_path):
    d = _data(tmp_path, final_public="2020-05-04T21:24:31+00:00", prefunded=True, final_projection=2272773.0)
    os.remove(os.path.join(d, "offering.db"))
    assert _days(build(d, str(tmp_path / "o")))[0] == 20200501


# ── no lookahead ──────────────────────────────────────────────────────────────────────────────────────────────────────
def test_later_filings_never_change_earlier_decisions(tmp_path):
    full = build(_data(tmp_path, final_public="2020-05-04T21:24:31+00:00", prefunded=True, final_projection=2272773.0, name="a"),
                 str(tmp_path / "oa"))
    pre = build(_data(tmp_path, final_public="2020-05-04T21:24:31+00:00", prefunded=True, final_projection=2272773.0,
                      cut_after="2020-05-05", name="b"), str(tmp_path / "ob"))
    # DECISIONS (value or hold) before the cut are identical with and without the later evidence. The hold's LABEL is
    # V1's existing IPO-window refinement (build.py: pre-first days within 200 days of listing are relabelled
    # IPO_CAPITALIZATION_UNRESOLVED only once a later value exists) -- pre-existing V1 labelling, never a value.
    early = lambda b: [(d, valued(b, CIK).get(d), _reason(b, d) is not None) for d in (20200501, 20200504, 20200505)]
    assert early(full) == early(pre) == [(20200501, None, True), (20200504, None, True), (20200505, None, True)]
    assert {_reason(pre, d) for d in (20200501, 20200504, 20200505)} == {R.PRE_FIRST}
    assert {_reason(full, d) for d in (20200501, 20200504, 20200505)} == {R.IPO_UNRESOLVED}


def test_pricing_ends_the_hold_and_the_fallback_is_coverage_not_lookahead(tmp_path):
    # Rule 1's hold rests only on PIT facts (already public + assumed terms); the pricing time ENDS it. The approved
    # coverage fallback is the one place that looks at whether pricing is EVER observed (within listing + 30 days):
    # with no final prospectus in the inputs at all, V1's projection stays in force from the listing day.
    priced = build(_data(tmp_path, final_public="2020-05-04T21:24:31+00:00", name="a"), str(tmp_path / "oa"))
    never = build(_data(tmp_path, final_public=None, name="b"), str(tmp_path / "ob"))
    assert _days(priced)[0] == 20200505 and _days(never)[0] == 20200501
