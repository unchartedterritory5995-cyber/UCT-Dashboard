"""The declared-events SUPPLEMENT (tools/history_lake/split_supplement.json, 2026-11-21).

The vendor's split reference lacks events that happened. CX (Cemex) paid a 4% stock dividend every year from 2009 to
2017; the vendor files only 2015, 2016 and 2017. TradingView's own corporate-action data (request.splits, calibrated
on NVDA/AAPL/TSLA/GE ex-dates) lists the other six, and the vendor's bars divided by those six reproduce 17
TradingView closes to 0.0006%. The supplement adds them to the rebuild's split table:
- one reviewed file of public corporate-action facts (date, ratio and evidence; no prices);
- a row is refused unless it carries a capture id and price_verified: true;
- a row the vendor later files itself (the same event within factors.SAME_EVENT_DAYS / SAME_EVENT_TOL) is not
  applied twice.
TradingView's listed 2008-05-06 103:100 is NOT here: its prices imply 1.0363, so it is not price-verified."""
from __future__ import annotations

import json

import pytest

from tools.history_lake import daily_build as B
from tools.history_lake import factors as F
from tools.history_lake import split_supplement as S

CX_VERIFIED = ["2009-05-29", "2010-06-02", "2011-03-25", "2012-03-27", "2013-04-23", "2014-04-22"]
VENDOR_CX = [{"ticker": "CX", "execution_date": "2006-07-24", "split_from": 1, "split_to": 2},
             {"ticker": "CX", "execution_date": "2015-04-28", "split_from": 1, "split_to": 1.04},
             {"ticker": "CX", "execution_date": "2016-04-29", "split_from": 25, "split_to": 26},
             {"ticker": "CX", "execution_date": "2017-05-03", "split_from": 25, "split_to": 26}]


def _write(tmp_path, rows):
    p = tmp_path / "supp.json"
    p.write_text(json.dumps({"rows": rows}), encoding="utf-8")
    return p


def _row(**over):
    r = {"ticker": "ZZ", "execution_date": "2010-06-02", "split_from": 25, "split_to": 26,
         "evidence": {"capture": "R-D2 test capture", "price_verified": True, "check": "test"}}
    r.update(over)
    return r


def test_every_committed_row_carries_price_verified_evidence():
    rows = S.load()
    assert rows, "the supplement lost its rows"
    for r in rows:
        ev = r["evidence"]
        assert str(ev.get("capture") or "").strip(), r
        assert ev.get("price_verified") is True, r


def test_the_committed_rows_are_cx_s_six_verified_events_and_not_the_open_2008_one():
    rows = S.load()
    cx = sorted((r["execution_date"], F.split_ratio(r["split_from"], r["split_to"])) for r in rows if r["ticker"] == "CX")
    assert [d for d, _ in cx] == CX_VERIFIED
    assert all(r == pytest.approx(26 / 25) for _, r in cx)
    assert not any(r["ticker"] == "CX" and r["execution_date"] == "2008-05-06" for r in rows)


@pytest.mark.parametrize("bad", [
    {"evidence": None},
    {"evidence": {"capture": "", "price_verified": True}},
    {"evidence": {"capture": "R-D2", "price_verified": False}},
    {"evidence": {"capture": "R-D2"}},
    {"split_from": 0},
    {"execution_date": "2010-6-2"},
])
def test_a_row_without_evidence_or_well_formed_facts_is_refused(tmp_path, bad):
    with pytest.raises(S.SupplementError):
        S.load(_write(tmp_path, [_row(**bad)]))


def test_the_merged_table_carries_the_missing_events():
    table = F.build_factor_tables(S.merge(VENDOR_CX, S.load()), "2026-11-21")["CX"]
    dates = [d for d, _ in table]
    assert dates == ["2006-07-24"] + CX_VERIFIED + ["2015-04-28", "2016-04-29", "2017-05-03"]


def test_an_event_the_vendor_files_itself_is_not_applied_twice():
    """The vendor fixes its reference later, three days off our date: its row wins and ours is not added."""
    vendor = VENDOR_CX + [{"ticker": "CX", "execution_date": "2009-06-01", "split_from": 25, "split_to": 26}]
    merged = S.merge(vendor, S.load())
    table = F.build_factor_tables(merged, "2026-11-21")["CX"]
    in_2009 = [d for d, _ in table if d.startswith("2009")]
    assert in_2009 == ["2009-06-01"]


def test_a_different_ratio_on_a_nearby_date_is_not_the_same_event(tmp_path):
    vendor = [{"ticker": "ZZ", "execution_date": "2010-06-01", "split_from": 1, "split_to": 2}]
    merged = S.merge(vendor, S.load(_write(tmp_path, [_row()])))
    assert len([r for r in merged if r["ticker"] == "ZZ"]) == 2


def test_the_rebuild_reads_the_supplement_with_the_vendor_reference(tmp_path):
    (tmp_path / "ref").mkdir()
    (tmp_path / "ref" / "splits.json").write_text(json.dumps({"rows": VENDOR_CX}), encoding="utf-8")
    rows = B.load_split_rows(tmp_path)
    assert {(r["ticker"], r["execution_date"]) for r in rows} >= {("CX", d) for d in CX_VERIFIED}
    assert len([r for r in rows if r["ticker"] == "CX"]) == len(VENDOR_CX) + len(CX_VERIFIED)
