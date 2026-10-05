"""L6 (terminal live audit, 2026-10-05): inside one match rank, the busier symbol leads.

Measured on production: "NV" answered NVA NVC NVD NVG NVO NVR and NVDA came 16th,
because the only tie-break inside a rank was type, then symbol length, then A-Z.
The search index now breaks ties by 20-session average dollar volume from bars.db,
computed off the request path; until that map exists the old order stands.
"""
from api.services import ticker_search_index as tsi


def _row(sym, name="", typ="stock"):
    return {"sym": sym, "name": name, "name_lc": name.lower(), "type": typ,
            "exch": "", "entity_id": None}


NV = [_row(s) for s in ("NVA", "NVC", "NVD", "NVG", "NVO", "NVR", "NVS", "NVDA", "NVDL")]


def _with(monkeypatch, rows, liq):
    monkeypatch.setattr(tsi, "_INDEX", rows)
    monkeypatch.setattr(tsi, "_LIQ", liq)


def test_a_busy_prefix_match_leads_its_rank(monkeypatch):
    _with(monkeypatch, NV, {"NVDA": 3.0e10, "NVO": 1.2e9, "NVDL": 4.0e8, "NVA": 1.0e5})
    syms = [r["ticker"] for r in tsi.search("NV", limit=6)]
    assert syms[:3] == ["NVDA", "NVO", "NVDL"]
    assert len(syms) == 6


def test_an_exact_symbol_still_beats_a_busier_prefix_match(monkeypatch):
    _with(monkeypatch, NV, {"NVDA": 3.0e10})
    assert tsi.search("NVD", limit=3)[0]["ticker"] == "NVD"


def test_without_a_liquidity_map_the_order_is_the_old_one(monkeypatch):
    _with(monkeypatch, NV, {})
    syms = [r["ticker"] for r in tsi.search("NV", limit=9)]
    # type, then length, then A-Z -- exactly what shipped before
    assert syms == ["NVA", "NVC", "NVD", "NVG", "NVO", "NVR", "NVS", "NVDA", "NVDL"]


def test_a_symbol_match_still_beats_a_busier_name_match(monkeypatch):
    rows = [_row("ZZQ", "Nvidia lookalike"), _row("NVZ")]
    _with(monkeypatch, rows, {"ZZQ": 9e12})
    assert [r["ticker"] for r in tsi.search("NV", limit=5)] == ["NVZ", "ZZQ"]


def test_refresh_liquidity_reads_bars_and_survives_a_failure(monkeypatch):
    from api.services import bars_sqlite
    monkeypatch.setattr(tsi, "_LIQ", {"OLD": 1.0})
    monkeypatch.setattr(bars_sqlite, "avg_dollar_volume_bulk", lambda *a: {"nvda": 5.0})
    assert tsi.refresh_liquidity() == 1
    assert tsi._LIQ == {"NVDA": 5.0}

    def boom(*a):
        raise RuntimeError("bars.db locked")
    monkeypatch.setattr(bars_sqlite, "avg_dollar_volume_bulk", boom)
    assert tsi.refresh_liquidity() == 0
    assert tsi._LIQ == {"NVDA": 5.0}          # the previous map is kept


def test_the_kill_switch_leaves_the_map_alone(monkeypatch):
    monkeypatch.setenv("TICKER_SEARCH_RANK_BY_DOLLAR_VOLUME", "0")
    monkeypatch.setattr(tsi, "_LIQ", {})
    assert tsi.refresh_liquidity() == 0
    assert tsi._LIQ == {}
