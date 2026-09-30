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
        assert p.grouped is True
        assert p.group_title == f"{cot_service.SYMBOL_NAMES[sym]} · COT"
        assert p.group_note == "Net Contracts"
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
    assert "pane_layout" not in row          # one shared pane, like every product
    assert row["grouped"] is True
    assert row["group_title"] == "Nasdaq-100 E-Mini · COT" and row["group_note"] == "Net Contracts"
    comps = row["component_rows"]
    assert [c["short"] for c in comps] == ["Commercials", "Large Speculators",
                                           "Small Speculators"]
    assert [c["palette"] for c in comps] == ["cot.commercials", "cot.largeSpecs",
                                            "cot.smallSpecs"]
    assert all(c["presentation"] == "histogram" for c in comps)


def test_aaii_keeps_its_shared_pane_and_independent_components():
    row = disc.product_row(reg.get_product("AAII:SURVEY"))
    assert row["grouped"] is False and row["group_note"] == ""
    assert row["source_type"] == reg.SRC_SURVEY
    assert all("palette" not in c for c in row["component_rows"])


def test_a_bare_contract_code_never_resolves_to_a_positioning_report():
    for sym in ("NQ", "ES", "GC", "CL"):
        assert reg.resolve_product(sym) is None
        assert reg.resolve(sym) is None
    assert reg.resolve_product("NQ COT").id == "COT:NQ"
    assert reg.resolve_product("cot:nq").id == "COT:NQ"


def test_the_catalogue_lists_ONE_cot_row_and_no_market_or_component():
    cat = disc.catalogue(include_breadth=False)
    listed = [r["id"] for r in cat["rows"] if r["family"] == reg.FAM_POSITIONING]
    assert listed == ["COT"]
    assert not any(r["id"].startswith("COT:") for r in cat["rows"])


def test_the_per_market_products_still_resolve_and_classify():
    # A saved chart, a primary `COT:NQ` and every component keep working.
    assert reg.resolve_product("COT:NQ").id == "COT:NQ"
    comps = {c["id"] for c in disc.catalogue(include_breadth=False)["components"]}
    assert {"COT:NQ:COMM", "COT:GC:SMALL", "COT:LE:LARGE"} <= comps


def test_the_follow_row_is_a_grouped_cot_product_naming_no_market():
    row = next(r for r in disc.catalogue(include_breadth=False)["rows"] if r["id"] == "COT")
    assert row["display"] == "COT (Commitment of Traders)"
    assert row["kind"] == "product" and row["grouped"] is True
    assert row["group_note"] == "Net Contracts"
    assert row["components"] == ["COT:AUTO:COMM", "COT:AUTO:LARGE", "COT:AUTO:SMALL"]
    assert [c["palette"] for c in row["component_rows"]] == ["cot.commercials",
                                                            "cot.largeSpecs", "cot.smallSpecs"]
    assert row["source_type"] == reg.SRC_COT and row["presentation"] == reg.PRES_HISTOGRAM


def test_the_follow_components_classify_but_never_serve(cot_db):
    comps = {c["id"]: c for c in disc.catalogue(include_breadth=False)["components"]}
    auto = comps["COT:AUTO:COMM"]
    assert auto["unit"] == "contracts" and auto["ohlc_capable"] is False
    assert auto["presentation"] == "histogram"
    assert reg.resolve("COT:AUTO:COMM") is None
    assert not ms.daily_bars("COT:AUTO:COMM")


@pytest.mark.parametrize("q", ["COT", "Commitment of Traders", "commitments of traders",
                               "Positioning", "CFTC", "Commercials"])
def test_search_finds_the_ONE_cot_indicator(q):
    ids = [h["id"] for h in disc.search(q, limit=200, include_breadth=False)]
    assert "COT" in ids
    assert not any(i.startswith("COT:") for i in ids)


def test_a_retired_market_search_finds_no_market_row():
    for q in ("NQ COT", "COT:NQ", "Nasdaq-100 E-Mini COT", "Gold COT"):
        ids = [h["id"] for h in disc.search(q, limit=200, include_breadth=False)]
        assert not any(i.startswith("COT:") for i in ids), (q, ids)


# ── the chart-symbol map ─────────────────────────────────────────────────────

@pytest.mark.parametrize("sym,market", [
    ("QQQ", "NQ"), ("NDX", "NQ"), ("SPY", "ES"), ("SPX", "ES"), ("VOO", "ES"),
    ("SPYM", "ES"), ("GLD", "GC"), ("TLT", "ZB"), ("IWM", "QR"), ("RUT", "QR"), ("DIA", "YM"),
    ("DJX", "YM"), ("VIX", "VI"), ("SLV", "SI"), ("USO", "CL"), ("UNG", "NG"),
    ("IBIT", "BTC"), ("ETHA", "ETH"), ("UUP", "DX"), ("FXE", "E6"), ("qqq", "NQ"),
])
def test_a_related_symbol_maps_to_its_market(sym, market):
    assert reg.cot_market_for(sym) == market


@pytest.mark.parametrize("sym", ["AAPL", "NVDA", "TQQQ", "SQQQ", "SPXL", "UVXY", "NUGT",
                                 "BOIL", "TMF", "SPLG", "", None, "COT:NQ"])
def test_an_unrelated_or_levered_symbol_maps_to_nothing(sym):
    assert reg.cot_market_for(sym) is None


def test_every_mapped_market_is_one_the_cot_store_serves():
    assert set(reg.COT_SYMBOL_MAP.values()) <= set(reg.COT_MARKETS)
    payload = disc.catalogue(include_breadth=False)["cot_symbols"]
    assert payload["QQQ"] == {"market": "NQ", "name": "Nasdaq-100 E-Mini"}
    assert payload["GLD"] == {"market": "GC", "name": "Gold"}
    assert "AAPL" not in payload


# ── serving ──────────────────────────────────────────────────────────────────

ROWS = [
    # as-of Tuesday, large,  comm,   small       public: the following Friday
    ("2026-08-25", 52346, -62340, 9995),     # → 2026-08-28
    ("2026-09-01", 48000, -57000, 9000),     # → 2026-09-04
    ("2026-09-08", -1200, 3400, -2200),      # → 2026-09-11   (every sign flips)
    ("2026-09-15", 30000, -41000, 11000),    # → 2026-09-18
]
PUBLIC = ["2026-08-28", "2026-09-04", "2026-09-11", "2026-09-18"]
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
                        lambda start, end=None: real(start, end or "2026-09-25"))
    return path


def _by_day(code, tf="D"):
    return {b["t"]: b["c"] for b in ms.build_bars(f"COT:NQ:{code}", tf)["bars"]}


def test_nothing_is_served_before_the_first_report_was_public(cot_db):
    days = _by_day("COMM")
    for d in ("2026-08-25", "2026-08-26", "2026-08-27"):     # as-of Tue, Wed, Thu
        assert d not in days
    assert min(days) == "2026-08-28"


def test_each_report_starts_on_its_public_friday_and_carries(cot_db):
    for code, idx in COL.items():
        days = _by_day(code)
        # Report B (as-of Tue 09-01) is unknown Tue-Thu: report A still stands.
        for d in ("2026-08-28", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03"):
            assert days[d] == ROWS[0][idx], (code, d)
        assert days["2026-09-04"] == ROWS[1][idx]          # published Friday → supersedes
        assert days["2026-09-07"] == ROWS[1][idx]          # carried (Labor Day: no bar drawn)
        assert days["2026-09-10"] == ROWS[1][idx]          # C not yet public
        assert days["2026-09-11"] == ROWS[2][idx]
        assert days["2026-09-17"] == ROWS[2][idx]
        assert days["2026-09-18"] == ROWS[3][idx]
        assert days["2026-09-25"] == ROWS[3][idx]          # latest, carried to today


def test_no_bar_on_a_weekend(cot_db):
    days = _by_day("COMM")
    assert "2026-08-29" not in days and "2026-08-30" not in days


def test_no_value_ever_precedes_its_public_date(cot_db):
    days = _by_day("COMM")
    for (asof, _l, comm, _s), pub in zip(ROWS, PUBLIC):
        assert all(day >= pub for day, v in days.items() if v == comm), asof


def test_the_values_are_the_stores_exactly_never_interpolated(cot_db):
    api = cot_service.get_cot_data("NQ", 52)
    assert set(_by_day("COMM").values()) == {r["commercial_net"] for r in api}


def test_the_cot_tab_still_labels_reports_by_as_of(cot_db):
    assert [r["date"] for r in cot_service.get_cot_data("NQ", 52)] == [r[0] for r in ROWS]


def test_positive_and_negative_values_survive(cot_db):
    vals = list(_by_day("SMALL").values())
    assert any(v > 0 for v in vals) and any(v < 0 for v in vals)


def test_weekly_bar_is_the_week_the_report_became_public(cot_db):
    bars = ms.build_bars("COT:NQ:COMM", "W")["bars"]
    # Each report lands in the week of its Friday publication — its own week here,
    # never the week before.
    assert [b["t"] for b in bars] == PUBLIC + ["2026-09-25"]
    assert [b["c"] for b in bars] == [r[2] for r in ROWS] + [ROWS[3][2]]


def test_a_holiday_week_report_lands_in_the_following_week(tmp_path, monkeypatch):
    path = str(tmp_path / "cot.db")
    monkeypatch.setattr(cot_service, "DB_PATH", path)
    cot_service.init_db()
    cot_service._upsert_records([
        {"symbol": "NQ", "date": d, "large_spec_net": 1, "commercial_net": v,
         "small_spec_net": 1, "open_interest": 1}
        for d, v in (("2026-11-17", 100), ("2026-11-24", 200))   # Thanksgiving week
    ])
    real = ms.weekday_calendar
    monkeypatch.setattr(ms, "weekday_calendar",
                        lambda start, end=None: real(start, end or "2026-12-04"))
    days = _by_day("COMM")
    assert days["2026-11-27"] == 100 and days["2026-11-30"] == 200   # released Monday
    weeks = {b["t"]: b["c"] for b in ms.build_bars("COT:NQ:COMM", "W")["bars"]}
    assert weeks["2026-11-27"] == 100 and weeks["2026-12-04"] == 200


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
    # 2026-01-06 → public Fri 01-09; carried 12 days to 01-21, then a hole.
    assert days["2026-01-09"] == 100 and "2026-01-21" in days and "2026-01-22" not in days
    assert "2026-02-17" not in days and days["2026-02-20"] == 200   # public Fri 02-20


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
