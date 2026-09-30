"""COT positioning as chartable market indicators.

The COT store (`cot_service` / `cot.db`) already exists and backs the Breadth page's COT
tab. These rails prove the chart lane READS it — same markets, same numbers, same dates —
and never carries, interpolates or shifts a weekly report.
"""
from __future__ import annotations

import os

import pytest

from api.services import cot_service
from api.services.market_indicators import discovery as disc
from api.services.market_indicators import registry as reg
from api.services.market_indicators import series as ms


def _grouped_markets():
    out = []
    for g, syms in cot_service.SYMBOL_GROUPS.items():
        if g == "MOST WATCHED":
            continue
        for s in syms:
            if s not in out:
                out.append(s)
    return out


# ── catalogue ────────────────────────────────────────────────────────────────

def test_the_cot_markets_are_exactly_the_ones_the_cot_tab_offers():
    assert reg.COT_MARKETS == _grouped_markets()
    assert "NQ" in reg.COT_MARKETS and "ES" in reg.COT_MARKETS


def test_every_market_is_one_product_of_three_ordered_components():
    for sym in reg.COT_MARKETS:
        p = reg.get_product(f"COT:{sym}")
        assert p is not None, sym
        assert p.components == (f"COT:{sym}:COMM", f"COT:{sym}:LARGE", f"COT:{sym}:SMALL")
        assert p.family == reg.FAM_POSITIONING
        assert p.pane_layout == "separate" and p.grouped is True
        assert p.display == f"{cot_service.SYMBOL_NAMES[sym]} COT"


def test_components_are_signed_histograms_that_can_never_be_candles():
    for code, column, name in reg.COT_COMPONENTS:
        row = reg.resolve(f"COT:NQ:{code}")
        assert row is not None
        assert row.presentation == reg.PRES_HISTOGRAM
        assert row.domain == reg.DOMAIN_SIGNED
        assert row.source_type == reg.SRC_COT and not row.ohlc_capable
        assert row.cot_stream == f"NQ:{column}"
        assert row.short == name


def test_the_product_row_says_how_to_lay_itself_out():
    row = disc.product_row(reg.get_product("COT:NQ"))
    assert row["kind"] == "product"
    assert row["family"] == "positioning" and row["family_label"] == "Positioning"
    assert row["source_type"] == reg.SRC_COT
    assert row["presentation"] == reg.PRES_HISTOGRAM
    assert row["pane_layout"] == "separate" and row["grouped"] is True
    comps = row["component_rows"]
    assert [c["short"] for c in comps] == ["Commercials", "Large Speculators",
                                           "Small Speculators"]
    assert [c["palette"] for c in comps] == ["cot.commercials", "cot.largeSpecs",
                                            "cot.smallSpecs"]
    assert all(c["presentation"] == "histogram" for c in comps)


def test_aaii_keeps_its_shared_pane_and_independent_components():
    row = disc.product_row(reg.get_product("AAII:SURVEY"))
    assert row["pane_layout"] == "shared" and row["grouped"] is False
    assert row["source_type"] == reg.SRC_SURVEY
    assert all("palette" not in c for c in row["component_rows"])


def test_a_bare_contract_code_never_resolves_to_a_positioning_report():
    for sym in ("NQ", "ES", "GC", "CL"):
        assert reg.resolve_product(sym) is None
        assert reg.resolve(sym) is None
    assert reg.resolve_product("NQ COT").id == "COT:NQ"
    assert reg.resolve_product("cot:nq").id == "COT:NQ"


def test_components_stay_out_of_the_browsable_list():
    cat = disc.catalogue(include_breadth=False)
    listed = {r["id"] for r in cat["rows"]}
    assert "COT:NQ" in listed
    assert not any(i.startswith("COT:") and i.count(":") == 2 for i in listed)


@pytest.mark.parametrize("q", ["COT", "Nasdaq", "Nasdaq-100", "E-mini", "Commercials",
                               "Positioning", "NQ COT", "commitments of traders"])
def test_search_finds_the_dataset_and_never_a_child(q):
    hits = disc.search(q, limit=200, include_breadth=False)
    ids = [h["id"] for h in hits]
    if q.lower() in ("commercials", "positioning", "cot", "commitments of traders"):
        assert "COT:ES" in ids and "COT:NQ" in ids
    elif q.lower() == "e-mini":
        assert "COT:ES" in ids and "COT:NQ" in ids
    else:
        assert "COT:NQ" in ids
    assert not any(i.count(":") == 2 and i.startswith("COT:") for i in ids)


# ── serving ──────────────────────────────────────────────────────────────────

ROWS = [
    # date (as-of Tuesday), large,  comm,   small
    ("2026-08-25", 52346, -62340, 9995),
    ("2026-09-01", 48000, -57000, 9000),
    ("2026-09-08", -1200, 3400, -2200),     # every sign flips
    ("2026-09-15", 30000, -41000, 11000),
]
COL = {"LARGE": 1, "COMM": 2, "SMALL": 3}


@pytest.fixture()
def cot_db(tmp_path, monkeypatch):
    path = str(tmp_path / "cot.db")
    monkeypatch.setattr(cot_service, "DB_PATH", path)
    cot_service.init_db()
    cot_service._upsert_records([
        {"symbol": "NQ", "date": d, "large_spec_net": ls, "commercial_net": c,
         "small_spec_net": ss, "open_interest": 1}
        for d, ls, c, ss in ROWS
    ])
    # Pin "today" so the carry's end is deterministic.
    real = ms.weekday_calendar
    monkeypatch.setattr(ms, "weekday_calendar",
                        lambda start, end=None: real(start, end or "2026-09-18"))
    return path


def _by_day(code, tf="D"):
    return {b["t"]: b["c"] for b in ms.build_bars(f"COT:NQ:{code}", tf)["bars"]}


def test_every_weekday_carries_the_latest_report_until_the_next(cot_db):
    for code, idx in COL.items():
        days = _by_day(code)
        # One bar per weekday, report date through "today" (2026-09-18).
        assert len(days) == 19
        assert days["2026-08-25"] == ROWS[0][idx]          # the report's own date
        assert days["2026-08-28"] == ROWS[0][idx]          # carried Wed-Fri
        assert days["2026-08-31"] == ROWS[0][idx]          # …and Monday
        assert days["2026-09-01"] == ROWS[1][idx]          # next report takes over
        assert days["2026-09-14"] == ROWS[2][idx]
        assert days["2026-09-18"] == ROWS[3][idx]          # latest, carried to today


def test_no_bar_on_a_weekend(cot_db):
    days = _by_day("COMM")
    assert "2026-08-29" not in days and "2026-08-30" not in days


def test_a_report_never_appears_before_its_own_date(cot_db):
    days = _by_day("COMM")
    assert min(days) == ROWS[0][0]
    assert days["2026-08-31"] != ROWS[1][2], "2026-09-01's report leaked into the day before"


def test_the_values_are_the_stores_exactly_never_interpolated(cot_db):
    api = cot_service.get_cot_data("NQ", 52)
    served = set(_by_day("COMM").values())
    assert served == {r["commercial_net"] for r in api}


def test_positive_and_negative_values_survive(cot_db):
    vals = list(_by_day("SMALL").values())
    assert any(v > 0 for v in vals) and any(v < 0 for v in vals)


def test_weekly_timeframe_is_the_report_in_force_each_friday(cot_db):
    bars = ms.build_bars("COT:NQ:COMM", "W")["bars"]
    assert [b["t"] for b in bars] == ["2026-08-28", "2026-09-04", "2026-09-11", "2026-09-18"]
    assert [b["c"] for b in bars] == [r[2] for r in ROWS]


def test_intraday_collapses_to_the_daily_answer(cot_db):
    assert ms.build_bars("COT:NQ:COMM", "5")["bars"] == ms.build_bars("COT:NQ:COMM", "D")["bars"]


def test_the_product_ticker_serves_its_first_component(cot_db):
    out = ms.build_bars("COT:NQ", "D")
    assert out["ticker"] == "COT:NQ"
    assert out["bars"] == ms.build_bars("COT:NQ:COMM", "D")["bars"]


def test_a_publication_gap_is_a_hole_not_a_flat_line(tmp_path, monkeypatch):
    path = str(tmp_path / "cot.db")
    monkeypatch.setattr(cot_service, "DB_PATH", path)
    cot_service.init_db()
    cot_service._upsert_records([
        {"symbol": "NQ", "date": d, "large_spec_net": 1, "commercial_net": v,
         "small_spec_net": 1, "open_interest": 1}
        for d, v in (("2026-01-06", 100), ("2026-02-17", 200))   # six weeks apart
    ])
    real = ms.weekday_calendar
    monkeypatch.setattr(ms, "weekday_calendar",
                        lambda start, end=None: real(start, end or "2026-02-20"))
    days = _by_day("COMM")
    assert "2026-01-16" in days and "2026-01-20" not in days    # 12-day cap
    assert days["2026-02-17"] == 200


def test_a_market_with_no_rows_serves_nothing(cot_db):
    assert ms.build_bars("COT:ES:COMM", "D")["bars"] == []


def test_a_missing_store_serves_nothing_and_creates_nothing(tmp_path, monkeypatch):
    path = str(tmp_path / "absent" / "cot.db")
    monkeypatch.setattr(cot_service, "DB_PATH", path)
    assert ms.build_bars("COT:NQ:COMM", "D")["bars"] == []
    assert not os.path.exists(path)


def test_weekday_calendar():
    assert ms.weekday_calendar("2026-09-25", "2026-09-29") ==         ["2026-09-25", "2026-09-28", "2026-09-29"]
    assert ms.weekday_calendar("not a date") == []
