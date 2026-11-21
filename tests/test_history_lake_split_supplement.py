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


def _with_dropped(vendor):
    """`vendor` plus the vendor rows the committed DROP rows name: a drop that matches no vendor row fails loudly,
    so a fixture reference must carry them (the real ref/splits.json does)."""
    return list(vendor) + [{"ticker": r["ticker"], **r["drop"]} for r in S.load() if "drop" in r]


def test_the_merged_table_carries_the_missing_events():
    table = F.build_factor_tables(S.merge(_with_dropped(VENDOR_CX), S.load()), "2026-11-21")["CX"]
    dates = [d for d, _ in table]
    assert dates == ["2006-07-24"] + CX_VERIFIED + ["2015-04-28", "2016-04-29", "2017-05-03"]


def test_an_event_the_vendor_files_itself_is_not_applied_twice():
    """The vendor fixes its reference later, three days off our date: its row wins and ours is not added."""
    vendor = VENDOR_CX + [{"ticker": "CX", "execution_date": "2009-06-01", "split_from": 25, "split_to": 26}]
    merged = S.merge(_with_dropped(vendor), S.load())
    table = F.build_factor_tables(merged, "2026-11-21")["CX"]
    in_2009 = [d for d, _ in table if d.startswith("2009")]
    assert in_2009 == ["2009-06-01"]


def test_a_different_ratio_on_a_nearby_date_is_not_the_same_event(tmp_path):
    vendor = [{"ticker": "ZZ", "execution_date": "2010-06-01", "split_from": 1, "split_to": 2}]
    merged = S.merge(vendor, S.load(_write(tmp_path, [_row()])))
    assert len([r for r in merged if r["ticker"] == "ZZ"]) == 2


def test_the_rebuild_reads_the_supplement_with_the_vendor_reference(tmp_path):
    (tmp_path / "ref").mkdir()
    (tmp_path / "ref" / "splits.json").write_text(json.dumps({"rows": _with_dropped(VENDOR_CX)}), encoding="utf-8")
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
    # Q-CLOSE-BASIS-4 and the J follow-up (2026-11-21)
    ("ATRO", "2013-10-08"): 1.249813, ("CAG", "2016-11-10"): 1.292178, ("CNX", "2017-11-29"): 1.198924,
    ("ADS", "2021-11-08"): 1.253683, ("J", "2025-05-16"): 1.010307,
}


def test_every_tradingview_verified_spin_off_lives_in_the_supplement_at_tradingview_s_factor():
    rows = {(r["ticker"], r["execution_date"]): F.split_ratio(r["split_from"], r["split_to"])
            for r in S.load() if "drop" not in r}       # a DROP row carries no ratio of its own
    for key, factor in TV_VERIFIED_SPINOFFS.items():
        assert key in rows, f"{key}: a TradingView-verified event left to the second vendor and the cliff test"
        assert rows[key] == pytest.approx(factor, rel=1e-6), key
    assert ("ATRO", "2018-10-10") not in rows and ("ATRO", "2018-10-11") not in rows, \
        "ATRO 2018 is the vendor's 1.15 (ruled); TradingView does not adjust it"


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


# ── DROP rows (2026-11-21, seam-61): a vendor row TradingView AND the raw day files both contradict ─────────────
# CHY 2007-09-20: the vendor files a 1:3 reverse split, but the raw day files and the second vendor run on (14.80 the day
# after 15.07). Applied, the table multiplies every earlier CHY bar by 3: a cliff that never traded. A DROP row removes
# exactly the vendor row it names. Ruled (patrick-2b): (a) it names the vendor row (date + ratio); (b) its evidence is
# TradingView's step across the date (no step) AND the raw day files continuous; (c) it fails loudly when no vendor row
# matches within the same-event +-3 days (never a silent no-op); (d) it never coexists with an add or a replace for its
# event.

PHANTOM = {"ticker": "ZZ", "execution_date": "2007-09-20", "split_from": 3, "split_to": 1}
OTHER = {"ticker": "ZZ", "execution_date": "2013-06-20", "split_from": 2, "split_to": 3}
ELSEWHERE = {"ticker": "YY", "execution_date": "2007-09-20", "split_from": 3, "split_to": 1}


def _drop(**over):
    r = {"ticker": "ZZ", "execution_date": "2007-09-20",
         "drop": {"execution_date": "2007-09-20", "split_from": 3, "split_to": 1},
         "evidence": {"capture": "Q-CLOSE-SEAM61 test capture", "price_verified": True, "tv_step": 1.0002,
                      "raw_move": 1.0182, "check": "test"}}
    r.update(over)
    return r


def _ev(**over):
    ev = dict(_drop()["evidence"])
    ev.update(over)
    return {k: v for k, v in ev.items() if v is not None}


def test_a_drop_row_removes_exactly_the_vendor_row_it_names_and_adds_nothing(tmp_path):
    """(a) The named row goes; the ticker's other rows and the same date under another ticker stay; nothing is added."""
    rows = S.load(_write(tmp_path, [_drop()]))
    merged = S.merge([PHANTOM, OTHER, ELSEWHERE], rows)
    assert merged == [OTHER, ELSEWHERE]
    with pytest.raises(S.SupplementError):    # the same date at ANOTHER ratio is not the row the drop names
        S.merge([{**PHANTOM, "split_from": 2}, OTHER], rows)


@pytest.mark.parametrize("ev", [
    _ev(tv_step=None),                 # no TradingView step recorded
    _ev(tv_step=1.01),                 # TradingView DOES step across the date
    _ev(tv_step="1.0"),                # not a number
    _ev(raw_move=None),                # no raw-continuity reading
    _ev(raw_move=3.0),                 # the raw day files show the event itself
    _ev(raw_move=1.18),                # a real move (AIG 2011): not continuous
    _ev(price_verified=False),
    _ev(capture=""),
])
def test_a_drop_row_without_no_step_and_continuity_evidence_is_refused(tmp_path, ev):
    """(b) TradingView's closes across the date show no step, AND the raw day files run on."""
    with pytest.raises(S.SupplementError, match="drop evidence"):
        S.load(_write(tmp_path, [_drop(evidence=ev)]))


def test_a_drop_that_matches_no_vendor_row_fails_loudly(tmp_path):
    """(c) A drop whose vendor row is gone (or never was) raises: the rebuild must not run on a stale belief."""
    rows = S.load(_write(tmp_path, [_drop()]))
    with pytest.raises(S.SupplementError, match="no vendor row"):
        S.merge([OTHER], rows)
    # the vendor re-files the same wrong row two days off: still that row, still dropped
    assert S.merge([{**PHANTOM, "execution_date": "2007-09-18"}, OTHER], rows) == [OTHER]
    with pytest.raises(S.SupplementError):    # four days off is not the same event
        S.merge([{**PHANTOM, "execution_date": "2007-09-24"}, OTHER], rows)
    with pytest.raises(S.SupplementError):    # two candidate rows: ambiguous, never a guess
        S.merge([PHANTOM, {**PHANTOM, "execution_date": "2007-09-21"}, OTHER], rows)


def test_a_drop_never_coexists_with_an_add_or_replace_for_its_event(tmp_path):
    """(d) One event, one answer: a drop beside an add, a replace or a second drop within +-3 days is refused."""
    add = _row(ticker="ZZ", execution_date="2007-09-21", split_from=1, split_to=1.05)
    rep = _row(ticker="ZZ", execution_date="2007-09-20", split_from=1, split_to=1.2,
               replaces={"execution_date": "2007-09-20", "split_from": 3, "split_to": 1})
    again = _drop(execution_date="2007-09-19", drop={"execution_date": "2007-09-19", "split_from": 3, "split_to": 1})
    for other in (add, rep, again):
        with pytest.raises(S.SupplementError, match="same event"):
            S.load(_write(tmp_path, [_drop(), other]))
    far = _row(ticker="ZZ", execution_date="2008-09-22", split_from=1, split_to=1.05)
    assert len(S.load(_write(tmp_path, [_drop(), far]))) == 2
    other_ticker = _row(ticker="YY", execution_date="2007-09-20", split_from=1, split_to=1.05)
    assert len(S.load(_write(tmp_path, [_drop(), other_ticker]))) == 2


@pytest.mark.parametrize("bad", [
    {"split_from": 3, "split_to": 1},                                                  # a drop carries no ratio
    {"replaces": {"execution_date": "2007-09-20", "split_from": 3, "split_to": 1}},     # nor a replaces
    {"drop": {"execution_date": "2007-9-20", "split_from": 3, "split_to": 1}},
    {"drop": {"execution_date": "2007-09-20", "split_from": 0, "split_to": 1}},
    {"drop": {"execution_date": "2007-09-21", "split_from": 3, "split_to": 1}},       # names another date than its row
    {"drop": "CHY"},
])
def test_a_malformed_drop_row_is_refused(tmp_path, bad):
    with pytest.raises(S.SupplementError, match="drop"):
        S.load(_write(tmp_path, [_drop(**bad)]))


def test_a_dropped_phantom_leaves_the_rebuilt_series_continuous(tmp_path):
    """End to end: raw closes run on across the vendor's phantom 1:3; without the drop the rebuild multiplies every earlier
    bar by 3, with it the series is the raw one."""
    import sqlite3
    days = [f"2007-{8 + i // 28:02d}-{1 + i % 28:02d}" for i in range(60)]
    con = sqlite3.connect(":memory:")
    con.execute("CREATE TABLE day (ticker TEXT, ymd INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL)")
    con.executemany("INSERT INTO day VALUES ('ZZ', ?, 15, 15, 15, 15, 1000)", [(int(d.replace("-", "")),) for d in days])
    phantom = {**PHANTOM, "execution_date": days[30]}
    lin = {"since": None, "segments": [], "cut": False}
    bad = B.build_one(con, "ZZ", lin, F.build_factor_tables([phantom], "2026-11-21"))
    assert {b[4] for b in bad["bars"][:30]} == {45.0}, "the fixture must draw the phantom cliff without the drop"
    drop = _drop(execution_date=days[30], drop={k: v for k, v in phantom.items() if k != "ticker"})
    merged = S.merge([phantom], S.load(_write(tmp_path, [drop])))
    good = B.build_one(con, "ZZ", lin, F.build_factor_tables(merged, "2026-11-21"))
    assert {b[4] for b in good["bars"]} == {15.0}


def test_a_small_drop_needs_a_raw_move_under_half_its_factor(tmp_path):
    """A phantom 3% stock dividend: a 2% raw move is an ordinary session, but it is too close to the dropped 1.03 to call
    the raw day files continuous across it; a 0.5% move is."""
    small = {"execution_date": "2007-09-20", "split_from": 100, "split_to": 103}
    with pytest.raises(S.SupplementError, match="drop evidence.raw_move"):
        S.load(_write(tmp_path, [_drop(drop=small, evidence=_ev(raw_move=1.02))]))
    assert S.load(_write(tmp_path, [_drop(drop=small, evidence=_ev(raw_move=1.005))]))[0]["drop"] == small



# R1 (ruled 2026-11-21): a SMALL-EVENT drop. Vendor dividend rows (BP scrip, PHG stock-dividend option, CM, PEO) that
# TradingView AND the second vendor both leave unadjusted. The raw close moves across them (the dividend plus the market),
# so the raw-continuity form cannot speak; evidence.form "small-event" asks instead that TradingView's step (its own closes
# at consecutive sessions) AND the second vendor's step are both within 0.05% of 1. HARD CAP: the dropped factor lies within
# DROP_SMALL_CAP (5%) of 1, so this form can never drop a real split.

SMALL_ROW = {"execution_date": "2007-09-20", "split_from": 69.543, "split_to": 70.543}


def _small_ev(**over):
    ev = {"capture": "Q-CLOSE-SEAM61 test capture", "price_verified": True, "form": "small-event", "tv_step": 1.0001,
          "second_vendor_step": 1.0, "raw_move": 1.03, "check": "test"}
    ev.update(over)
    return {k: v for k, v in ev.items() if v is not None}


def test_a_small_event_drop_needs_tradingview_and_the_second_vendor_to_take_no_step(tmp_path):
    ok = S.load(_write(tmp_path, [_drop(drop=SMALL_ROW, evidence=_small_ev())]))     # the raw moved 3%: allowed here
    assert ok[0]["drop"] == SMALL_ROW
    for ev in (_small_ev(second_vendor_step=None), _small_ev(second_vendor_step=1.01),   # TradingView's word alone
               _small_ev(tv_step=None), _small_ev(tv_step=1.01)):                         # the second vendor's alone
        with pytest.raises(S.SupplementError, match="drop evidence"):
            S.load(_write(tmp_path, [_drop(drop=SMALL_ROW, evidence=ev)]))


@pytest.mark.parametrize("big", [{"split_from": 100, "split_to": 106},   # a 6% factor
                                 {"split_from": 2, "split_to": 3},       # a real 3:2
                                 {"split_from": 3, "split_to": 1}])      # a real 1:3 reverse
def test_the_small_event_form_can_never_drop_a_real_split(tmp_path, big):
    with pytest.raises(S.SupplementError, match="small-event"):
        S.load(_write(tmp_path, [_drop(drop={"execution_date": "2007-09-20", **big}, evidence=_small_ev())]))
    edge = {"execution_date": "2007-09-20", "split_from": 20, "split_to": 21}           # exactly 5%: inside the cap
    assert S.load(_write(tmp_path, [_drop(drop=edge, evidence=_small_ev())]))[0]["drop"] == edge


def test_an_unknown_drop_evidence_form_is_refused(tmp_path):
    """Even with evidence the raw-continuity form would accept, an unknown form name is refused, never guessed."""
    with pytest.raises(S.SupplementError, match="drop evidence.form"):
        S.load(_write(tmp_path, [_drop(drop=SMALL_ROW, evidence=_small_ev(form="guess", raw_move=1.001))]))

# ── Seam-61 (2026-11-21, Q-CLOSE-SEAM61): the 2003-09-10 seam batch, sized from TradingView's own closes ──────────
# TradingView's request.splits lists splits and stock dividends only (never a spin-off) and prints each ratio TRUNCATED to
# 3 decimals (1.5 as 1499:1000, 3% as 1029:1000), so every size below is TradingView's step across the event against the
# RAW day files: (raw / TradingView on the session before) / (the same on the event session). A listed split or stock
# dividend takes the exact fraction those closes pin within 0.001% (21:20, 103:100, 11:10, 28:25, 5:2).

TV_VERIFIED_SEAM61 = {
    ("ONB", "2004-01-02"): 1.050000, ("MBWM", "2004-04-14"): 1.050000, ("CINF", "2004-04-28"): 1.050000,
    ("VLY", "2004-04-29"): 1.050000, ("ABT", "2004-05-03"): 1.064056, ("BOKF", "2004-05-06"): 1.030000,
    ("UNTY", "2004-06-14"): 1.050000, ("WTBA", "2004-07-22"): 1.050000, ("MYE", "2004-08-11"): 1.100000,
    ("PRK", "2004-11-29"): 1.050000, ("ONB", "2005-01-03"): 1.050000, ("CINF", "2005-04-04"): 1.050000,
    ("VLY", "2005-05-04"): 1.050000, ("UNTY", "2005-06-13"): 1.050000, ("MBWM", "2005-07-14"): 1.050000,
    ("AXP", "2005-10-03"): 1.131862, ("MBWM", "2006-04-20"): 1.050000, ("VLY", "2006-05-04"): 1.050000,
    ("UNTY", "2006-06-14"): 1.050000, ("WTBA", "2006-07-27"): 1.050000, ("VZ", "2006-11-20"): 1.035037,
    ("CENT", "2007-02-06"): 2.955956, ("ADP", "2007-04-02"): 1.113284, ("MBWM", "2007-04-19"): 1.050000,
    ("VLY", "2007-05-09"): 1.050000, ("UNTY", "2007-06-13"): 1.050000, ("VZ", "2008-04-01"): 0.980366,
    ("VLY", "2008-05-07"): 1.050000, ("GCO", "2008-06-06"): 1.105926, ("UNTY", "2008-06-11"): 1.050000,
    ("BFA", "2008-10-28"): 1.333166, ("VLY", "2009-05-06"): 1.050000, ("VLY", "2010-05-05"): 1.050000,
    ("VZ", "2010-07-02"): 1.070230, ("VSH", "2010-07-07"): 1.111637, ("WY", "2010-07-20"): 2.500000,
    ("DB", "2010-09-22"): 1.078074, ("AIG", "2011-01-20"): 1.130011, ("NOC", "2011-03-31"): 1.102322,
    ("VLY", "2011-05-04"): 1.050000, ("VLY", "2012-05-09"): 1.050000, ("NC", "2012-10-01"): 3.082614,
    ("ABT", "2013-01-02"): 2.090301, ("GFI", "2013-02-21"): 1.161690, ("MUR", "2013-09-03"): 1.161305,
    ("DB", "2014-06-06"): 1.048000, ("IP", "2014-07-02"): 1.014352, ("ADP", "2014-10-01"): 1.139904,
    ("OXY", "2014-12-01"): 1.042064, ("VNO", "2015-01-16"): 1.104101, ("SSP", "2015-04-01"): 1.083222,
    ("BHP", "2015-05-18"): 1.067067, ("PPL", "2015-06-02"): 1.077722, ("MAS", "2015-07-01"): 1.137405,
    ("APD", "2016-10-03"): 1.081661, ("DB", "2017-03-21"): 1.120000, ("MET", "2017-08-07"): 1.122151,
    ("NC", "2017-10-02"): 4.377555, ("BFA", "2018-03-01"): 1.186885, ("FMC", "2019-03-04"): 1.153946,
    ("VFC", "2019-05-23"): 1.062457, ("JEF", "2019-09-27"): 1.068293, ("PFE", "2020-11-17"): 1.054910,
    ("MRK", "2021-06-03"): 1.048740, ("DTE", "2021-07-01"): 1.175298, ("PUK", "2021-09-20"): 1.031832,
    ("IP", "2021-10-01"): 1.056091, ("BHP", "2022-06-02"): 1.121350, ("JEF", "2023-01-17"): 1.046534,
    ("BWA", "2023-07-05"): 1.136871, ("DHR", "2023-10-02"): 1.128158, ("CENT", "2024-02-09"): 1.277682,
    ("CMCSA", "2026-01-05"): 1.067428,
}

#: Vendor rows TradingView takes no step at and the raw day files run straight through (DROP rows).
TV_VERIFIED_DROPS = {
    ("FLO", "2003-11-25"): (1, 1.5), ("CHY", "2007-09-20"): (3, 1), ("CM", "2014-09-25"): (1, 1.0097529),
    ("BP", "2014-11-05"): (69.543, 70.543), ("CM", "2015-03-25"): (1, 1.01090263535),
    ("BP", "2015-05-06"): (71.083, 72.083), ("PHG", "2015-05-08"): (30.5329, 31.5329),
    ("PHG", "2016-05-13"): (28.9678, 29.9678), ("BP", "2016-11-08"): (55.033, 56.033),
    ("BP", "2017-02-15"): (55.883, 56.883), ("BP", "2017-05-10"): (60.003, 61.003),
    ("PHG", "2017-05-12"): (39.7547, 40.7547), ("BP", "2017-08-09"): (58.063, 59.063),
    ("BP", "2017-11-09"): (66.503, 67.503), ("BP", "2018-02-15"): (66.353, 67.353),
    ("PHG", "2018-05-07"): (44.2563, 45.2563), ("BP", "2018-05-10"): (77.223, 78.223),
    ("BP", "2018-08-09"): (69.34, 70.34), ("BP", "2018-11-08"): (66.208, 67.208),
    ("BP", "2019-02-14"): (68.189, 69.189), ("PHG", "2019-05-13"): (1, 1.024025005),
    ("BP", "2019-08-08"): (59.301, 60.301), ("PHG", "2021-05-10"): (1, 1.0185433116),
    ("PHG", "2022-05-12"): (1, 1.0366053648), ("PEO", "2024-11-22"): (1, 1.039467849),
    ("PHG", "2025-05-13"): (1, 1.0423095962), ("PHG", "2026-05-13"): (1, 1.037127656),
}

#: The identity-review six and ITGR (2026-11-21): no rows until their identity is reviewed (their lineage symbols too).
IDENTITY_REVIEW = {"DOC", "PEAK", "OKE", "TEVA", "TEVJ", "S941", "CRH", "CRHC", "UMC", "RBCAA", "RBCA", "ITGR"}


def test_every_seam61_event_lives_in_the_supplement_at_tradingview_s_factor():
    rows = {(r["ticker"], r["execution_date"]): F.split_ratio(r["split_from"], r["split_to"])
            for r in S.load() if "drop" not in r}
    for key, factor in TV_VERIFIED_SEAM61.items():
        assert key in rows, f"{key}: a TradingView-verified event left out of the supplement"
        assert rows[key] == pytest.approx(factor, rel=1e-6), key


def test_every_committed_drop_is_a_tradingview_verified_one_and_none_is_missing():
    drops = {(r["ticker"], r["execution_date"]): (r["drop"]["split_from"], r["drop"]["split_to"]) for r in S.load() if "drop" in r}
    assert drops == TV_VERIFIED_DROPS


def test_held_events_and_identity_review_tickers_carry_no_rows():
    """Stated, not served: CASS (the vendor's raw prints, not corporate actions), KMB (no TradingView capture yet), DB's
    unplaced 1.0582 (its three placed events are rows; nothing else for DB), and the identity-review tickers."""
    rows = S.load()
    assert not any(r["ticker"] in {"CASS", "KMB"} for r in rows)
    assert sorted(r["execution_date"] for r in rows if r["ticker"] == "DB") == ["2010-09-22", "2014-06-06", "2017-03-21"]
    assert not any(r["ticker"] in IDENTITY_REVIEW for r in rows)


def test_the_vz_2008_fairpoint_row_follows_tradingview_s_own_inverse_step():
    """Ruled: VZ 2008-04-01 follows the reference. TradingView's own step across FairPoint is 0.980366 (< 1, the inverse of a
    spin-off); the second vendor's 1.004652 is not used."""
    vz = [r for r in S.load() if r["ticker"] == "VZ" and r["execution_date"] == "2008-04-01"]
    assert len(vz) == 1 and F.split_ratio(vz[0]["split_from"], vz[0]["split_to"]) == pytest.approx(0.980366, rel=1e-6)


def test_every_small_event_drop_is_dividend_sized_and_names_both_references():
    small = [r for r in S.load() if "drop" in r and r["evidence"].get("form") == "small-event"]
    assert {r["ticker"] for r in small} == {"BP", "PHG", "CM", "PEO"} and len(small) == 25
    for r in small:
        f = F.split_ratio(r["drop"]["split_from"], r["drop"]["split_to"])
        assert abs(f - 1) <= S.DROP_SMALL_CAP and abs(r["evidence"]["second_vendor_step"] - 1) <= S.DROP_TV_TOL, r
