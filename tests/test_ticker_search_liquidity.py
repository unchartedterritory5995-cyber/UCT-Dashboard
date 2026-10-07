"""L6 (terminal live audit, 2026-10-05): inside one match rank, the busier symbol leads.

Measured on production: "NV" answered NVA NVC NVD NVG NVO NVR and NVDA came 16th,
because the only tie-break inside a rank was type, then symbol length, then A-Z.
The search index now breaks ties by 20-session average dollar volume from bars.db,
computed off the request path; until that map exists the old order stands.
"""
import pytest

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


_REAL_GROUPED = tsi._grouped_dollar_volume   # captured before any test stubs it


@pytest.fixture(autouse=True)
def _no_grouped(monkeypatch):
    """The grouped whole-market read is a network call; every test here stubs it."""
    monkeypatch.setattr(tsi, "_grouped_dollar_volume", lambda today, **k: {})


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


def test_an_empty_boot_read_is_retried_soon_then_refreshed_rarely(monkeypatch):
    """On the web pod bars.db arrives from the R2 pull AFTER the index thread starts,
    so the first read finds nothing. Measured live 2026-10-05: search stayed A-Z for
    30+ minutes because that empty boot read was not retried for a day."""
    answers = iter([0, 0, 412])
    monkeypatch.setattr(tsi, "refresh_liquidity", lambda: next(answers))
    slept = []

    class _Stop(Exception):
        pass

    def fake_sleep(s):
        slept.append(s)
        if len(slept) == 3:
            raise _Stop

    try:
        tsi._liquidity_loop(sleep=fake_sleep)
    except _Stop:
        pass
    assert slept == [tsi._LIQ_RETRY_EMPTY_S, tsi._LIQ_RETRY_EMPTY_S, tsi._LIQ_REFRESH_S]
    assert tsi._LIQ_RETRY_EMPTY_S <= 600


def test_status_reports_the_liquidity_map(monkeypatch):
    monkeypatch.setattr(tsi, "_LIQ", {"NVDA": 1.0, "AAPL": 2.0})
    assert tsi.status()["liquidity_symbols"] == 2



def test_grouped_volume_fills_only_what_bars_lacks(monkeypatch):
    """Live check 2026-10-05: NVO / TSM had no dollar volume (not in bars.db) and sorted
    behind NVA / TSI. The whole-market grouped bars fill the gap; bars.db keeps the say."""
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "avg_dollar_volume_bulk", lambda *a: {"NVDA": 5.0})
    monkeypatch.setattr(tsi, "_grouped_dollar_volume", lambda today, **k: {"NVDA": 999.0, "NVO": 3.0})
    monkeypatch.setattr(tsi, "_LIQ", {})
    assert tsi.refresh_liquidity() == 2
    assert tsi._LIQ == {"NVDA": 5.0, "NVO": 3.0}


def test_grouped_volume_averages_settled_sessions_and_skips_holidays():
    import datetime as dt
    days = {"2026-10-02": {"NVO": {"c": 10, "v": 100}}, "2026-10-01": {"NVO": {"c": 20, "v": 100}},
            "2026-09-30": {}}                                   # a holiday / missing day
    asked = []

    def fetch(d):
        asked.append(d)
        return days.get(d, {"NVO": {"c": 30, "v": 100}})

    out = _REAL_GROUPED(dt.date(2026, 10, 5), sessions=3, fetch=fetch)
    assert asked[0] == "2026-10-02" and "2026-10-03" not in asked and "2026-10-04" not in asked
    assert out["NVO"] == pytest.approx((1000 + 2000 + 3000) / 3)


def test_bars_failing_still_leaves_the_grouped_map(monkeypatch):
    from api.services import bars_sqlite

    def boom(*a):
        raise RuntimeError("bars.db not downloaded yet")
    monkeypatch.setattr(bars_sqlite, "avg_dollar_volume_bulk", boom)
    monkeypatch.setattr(tsi, "_grouped_dollar_volume", lambda today, **k: {"TSM": 7.0})
    monkeypatch.setattr(tsi, "_LIQ", {})
    assert tsi.refresh_liquidity() == 1 and tsi._LIQ == {"TSM": 7.0}
