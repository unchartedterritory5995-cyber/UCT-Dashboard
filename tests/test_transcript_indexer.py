"""The sweep that fills the search corpus."""
from __future__ import annotations

import pytest


class _Store:
    MAX_PAGES = 5

    def __init__(self):
        self.rows = {}

    def init_db(self): pass

    def has(self, s, y, q): return (s, y, q) in self.rows

    def put(self, s, y, q, d, content): self.rows[(s, y, q)] = content

    def stats(self): return {"transcripts": len(self.rows)}


def _feed(pages):
    """fmp_get double: page N of the feed, then per-symbol content."""
    def fmp_get(path, params, timeout=None):
        if path.endswith("transcript-latest"):
            return pages[params["page"]] if params["page"] < len(pages) else []
        return [{"content": f"body of {params['symbol']} "
                            f"{params['year']}Q{params['quarter']}"}]
    return fmp_get


@pytest.fixture(autouse=True)
def _universe(monkeypatch):
    import api.services.transcript_indexer as m
    monkeypatch.setattr(m, "_tradeable", lambda s: "." not in s and len(s) <= 5)


def test_indexes_a_page_of_the_feed():
    from api.services import transcript_indexer as ixr
    store = _Store()
    out = ixr.run_index_sweep(
        max_pages=1, store=store,
        fmp_get=_feed([[{"symbol": "AAPL", "fiscalYear": 2026, "period": "Q3",
                         "date": "2026-08-01"}]]), sleep=lambda _: None)
    assert out["indexed"] == 1
    assert store.rows[("AAPL", 2026, 3)].startswith("body of AAPL")


def test_SKIPS_a_call_already_held_before_paying_for_content():
    # The sweep is resumable by design: a re-run over 2,000 held calls must
    # cost one cheap feed page per 100, not 2,000 content fetches.
    from api.services import transcript_indexer as ixr
    store = _Store()
    store.put("AAPL", 2026, 3, "", "already here")
    fetched = []

    def fmp_get(path, params, timeout=None):
        if path.endswith("transcript-latest"):
            return [{"symbol": "AAPL", "fiscalYear": 2026, "period": "Q3"}] \
                if params["page"] == 0 else []
        fetched.append(params["symbol"])
        return [{"content": "x"}]

    out = ixr.run_index_sweep(max_pages=2, store=store, fmp_get=fmp_get,
                              sleep=lambda _: None)
    assert out["already"] == 1 and out["indexed"] == 0
    assert fetched == [], "content was fetched for a call already indexed"


def test_off_universe_symbols_are_not_indexed():
    # DTRUY and DTG.DE are ONE earnings call under two tickers; unfiltered,
    # both matched every search with identical text.
    from api.services import transcript_indexer as ixr
    store = _Store()
    out = ixr.run_index_sweep(
        max_pages=1, store=store,
        fmp_get=_feed([[{"symbol": "TILE", "fiscalYear": 2026, "period": "Q2"},
                        {"symbol": "DTG.DE", "fiscalYear": 2026, "period": "Q2"},
                        {"symbol": "SGR-UN.TO", "fiscalYear": 2026, "period": "Q2"}]]),
        sleep=lambda _: None)
    assert out["indexed"] == 1
    assert out["off_universe"] == 2
    assert list(store.rows) == [("TILE", 2026, 2)]


@pytest.mark.parametrize("period,expected", [
    ("Q3", 3), ("q3", 3), (3, 3), ("3", 3), ("Q5", None), ("FY", None), (None, None),
])
def test_period_parsing(period, expected):
    from api.services.transcript_indexer import _period_to_quarter
    assert _period_to_quarter(period) == expected


def test_a_row_with_no_usable_quarter_is_counted_not_crashed():
    from api.services import transcript_indexer as ixr
    store = _Store()
    out = ixr.run_index_sweep(
        max_pages=1, store=store,
        fmp_get=_feed([[{"symbol": "AAPL", "fiscalYear": 2026, "period": "FY"},
                        {"symbol": "", "fiscalYear": 2026, "period": "Q1"}]]),
        sleep=lambda _: None)
    assert out["bad_row"] == 2 and out["indexed"] == 0


def test_a_page_that_fails_stops_the_walk_without_raising():
    from api.services import transcript_indexer as ixr
    store = _Store()

    def fmp_get(path, params, timeout=None):
        raise RuntimeError("provider down")

    out = ixr.run_index_sweep(max_pages=3, store=store, fmp_get=fmp_get,
                              sleep=lambda _: None)
    assert out["pages"] == 0 and out["indexed"] == 0


def test_the_clock_stops_the_sweep():
    from api.services import transcript_indexer as ixr
    store = _Store()
    ticks = iter([0, 0, 5000, 5000, 5000, 5000])
    out = ixr.run_index_sweep(
        max_pages=3, store=store,
        fmp_get=_feed([[{"symbol": "AAPL", "fiscalYear": 2026, "period": "Q3"}]] * 3),
        now=lambda: next(ticks), sleep=lambda _: None, max_seconds=100)
    assert out.get("timed_out") == 1
