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


# ── Spin-offs (2026-11-21, Q-CLOSE-BASIS-3): every verified event lives in the supplement ─────────────

#: TradingView's step across each event: (vendor close / TradingView close the session before) / (the same on
#: the event day). The second vendor's split-list ratio was off by more than 0.05% (12), or F3b' declines the
#: raw event-day step so the cliff test alone would drop it (IRWD, TRN).
TV_VERIFIED_SPINOFFS = {
    ("TKC", "2006-06-26"): 1.186057, ("WMB", "2012-01-03"): 1.260367, ("COP", "2012-05-01"): 1.297185,
    ("TKR", "2014-07-01"): 1.416230, ("DOV", "2018-05-09"): 1.238964, ("TRN", "2018-11-01"): 1.389294,
    ("NTGR", "2019-01-02"): 1.609536, ("IRWD", "2019-04-02"): 1.194000, ("FTI", "2021-02-16"): 1.221564,
    ("T", "2022-04-11"): 1.324896, ("EHC", "2022-07-01"): 1.257713, ("FLEX", "2024-01-03"): 1.374763,
    ("J", "2024-09-30"): 1.197675, ("FDX", "2026-06-01"): 1.241838,
}


def test_every_tradingview_verified_spin_off_lives_in_the_supplement_at_tradingview_s_factor():
    rows = {(r["ticker"], r["execution_date"]): F.split_ratio(r["split_from"], r["split_to"]) for r in S.load()}
    for key, factor in TV_VERIFIED_SPINOFFS.items():
        assert key in rows, f"{key}: a TradingView-verified event left to the second vendor and the cliff test"
        assert rows[key] == pytest.approx(factor, rel=1e-6), key
    assert not any(t == "ATRO" for t, _d in rows), "ATRO 2018 is the vendor's 1.15 (ruled); TradingView does not adjust"


def test_a_verified_event_is_applied_by_the_split_table_never_by_the_cliff_test(tmp_path):
    """A spin-off whose event day also rallied: raw 40 -> 30 (a 1.333 step) against TradingView's 1.5. F3b' declines
    that step (it is not 1.5-sized), so the cliff test would never apply it, and the second vendor's nearby ratio
    must not be applied on top either. The supplement row puts it in the table: the bars before are 40 / 1.5."""
    import sqlite3
    from api.services import bars_sanitize as SAN
    from tools.history_lake import daily_join as J
    days = [f"2004-{1 + i // 28:02d}-{1 + i % 28:02d}" for i in range(60)]
    closes = [40.0] * 30 + [30.0] * 30
    declined: list = []
    assert SAN.unadjusted_splits([{"t": d, "c": c} for d, c in zip(days, closes)], [(days[30], 1.5)],
                                 declined=declined) == [] and declined, "the fixture must be one F3b' declines"
    con = sqlite3.connect(":memory:")
    con.execute("CREATE TABLE day (ticker TEXT, ymd INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL)")
    con.executemany("INSERT INTO day VALUES ('ZZ', ?, ?, ?, ?, ?, 1000)",
                    [(int(d.replace("-", "")), c, c, c, c) for d, c in zip(days, closes)])
    row = _row(execution_date=days[30], split_from=1, split_to=1.5)
    by_sym = F.build_factor_tables(S.merge([], S.load(_write(tmp_path, [row]))), "2026-11-21")
    rec = B.build_one(con, "ZZ", {"since": None, "segments": [], "cut": False}, by_sym)
    assert {b[4] for b in rec["bars"][:30]} == {round(40.0 / 1.5, 4)} and {b[4] for b in rec["bars"][30:]} == {30.0}
    out = J.heal_splits(dict(rec), [[days[31], 1.36]])     # the second vendor, a day off, at its own ratio
    assert out["healed_splits"] == [] and out["bars"] == rec["bars"]


def test_a_row_can_replace_the_vendor_s_own_wrong_event_and_nothing_else(tmp_path):
    """TKC 2006-06-26: the vendor files 100:102.78 on the date and the second vendor 1.1861. TradingView's step
    against the RAW day files is 1.186057: the vendor's own row is wrong, and applied beside a supplement row it
    double-counts. A row that names it in `replaces` drops exactly that vendor row; any other vendor row stays."""
    vendor = [{"ticker": "ZZ", "execution_date": "2006-06-26", "split_from": 100, "split_to": 102.78},
              {"ticker": "ZZ", "execution_date": "2014-06-20", "split_from": 1, "split_to": 2}]
    row = _row(execution_date="2006-06-26", split_from=1, split_to=1.186057,
               replaces={"execution_date": "2006-06-26", "split_from": 100, "split_to": 102.78})
    merged = S.merge(vendor, S.load(_write(tmp_path, [row])))
    assert not any(r["execution_date"] == "2006-06-26" and r["split_to"] == 102.78 for r in merged), \
        "the replaced vendor row must be gone, not merely outranked by build_factor_tables' same-date order"
    assert len(merged) == 2
    table = F.build_factor_tables(merged, "2026-11-21")["ZZ"]
    assert [(d, round(r, 6)) for d, r in table] == [("2006-06-26", 1.186057), ("2014-06-20", 2.0)]
    other = _row(execution_date="2006-06-26", split_from=1, split_to=1.186057,
                 replaces={"execution_date": "2006-06-26", "split_from": 100, "split_to": 103})
    assert len(S.merge(vendor, S.load(_write(tmp_path, [other])))) == 3, "a replaces naming no vendor row drops nothing"


@pytest.mark.parametrize("bad", [{"execution_date": "2006-6-26", "split_from": 100, "split_to": 102.78},
                                 {"execution_date": "2006-06-26", "split_from": 0, "split_to": 102.78}, "TKC"])
def test_a_malformed_replaces_is_refused(tmp_path, bad):
    with pytest.raises(S.SupplementError):
        S.load(_write(tmp_path, [_row(replaces=bad)]))
