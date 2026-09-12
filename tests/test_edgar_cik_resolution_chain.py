"""Ticker -> CIK: fast and complete, in that order.

⚰️ MEASURED 2026-09-12, and both halves were wrong at once.

SEC's bulk ticker files are INCOMPLETE. `company_tickers.json` AND
`company_tickers_exchange.json` both return exactly 10,426 entries and both
lack MMC, BK, HOLX and EXAS — all real filers. So `/api/filings/MMC` answered
`{"error": "ticker 'MMC' not found in SEC CIK map"}` in production.

`browse-edgar` resolves them, but it is a legacy CGI that READ-TIMED OUT at 10s
on a live call. That is disqualifying twice over: it cannot sit on a member
request path, and it made the fundamentals monitor's staleness oracle FAIL QUIET
exactly when it mattered — an earlier validation run had happened to get through,
which is how a 10s-flaky dependency looks when you only try it once.

FMP's profile carries `cik` and answers in ~0.15s, on a plan we already pay for,
and `data.sec.gov/submissions` answers in ~0.1s. Measured CIKs agree with
browse-edgar exactly (MMC 0000062709, HOLX 0000859737, EXAS 0001124140).

Chain: free bulk map -> FMP profile -> browse-edgar last. Fast tiers first so a
slow one is never reached for a ticker the quick ones can answer.
"""
import importlib

import pytest


@pytest.fixture()
def ed(monkeypatch):
    import api.services.edgar as m
    importlib.reload(m)
    return m


def _stub(monkeypatch, ed, *, bulk=None, fmp_cik=None, browse_cik=None, browse_raises=False):
    order = []

    def _bulk():
        order.append("bulk")
        return bulk or {}

    def _fmp(path, params, timeout=10):
        order.append("fmp")
        return [{"cik": fmp_cik}] if fmp_cik else []

    class _R:
        text = f"CIK={browse_cik}" if browse_cik else "no match here"

        def raise_for_status(self):
            pass

    def _get(url, **kw):
        order.append("browse")
        if browse_raises:
            raise RuntimeError("read timeout")
        return _R()

    monkeypatch.setattr(ed, "_ticker_to_cik_bulk", _bulk)
    monkeypatch.setattr(ed, "_fmp_cik", _fmp)
    monkeypatch.setattr(ed._requests, "get", _get)
    return order


def test_the_bulk_map_answers_without_any_paid_or_slow_call(monkeypatch, ed):
    order = _stub(monkeypatch, ed, bulk={"AAPL": "0000320193"})
    assert ed.resolve_cik("AAPL") == "0000320193"
    assert order == ["bulk"], f"went past the free tier: {order}"


def test_fmp_answers_what_the_partial_map_misses(monkeypatch, ed):
    # The real MMC case: absent from both SEC bulk files, present in FMP.
    order = _stub(monkeypatch, ed, bulk={"AAPL": "0000320193"}, fmp_cik="62709")
    assert ed.resolve_cik("MMC") == "0000062709", "FMP's cik must be zero-padded to 10"
    assert order == ["bulk", "fmp"], f"reached the slow CGI unnecessarily: {order}"


def test_browse_edgar_is_the_last_resort_only(monkeypatch, ed):
    order = _stub(monkeypatch, ed, bulk={}, fmp_cik=None, browse_cik="0000859737")
    assert ed.resolve_cik("HOLX") == "0000859737"
    assert order == ["bulk", "fmp", "browse"], f"wrong order: {order}"


def test_a_slow_browse_edgar_cannot_raise_out(monkeypatch, ed):
    """It read-timed out on a live call; the caller must get None, not an
    exception — `recent_filings` promises it never raises and the monitor's
    cycle must not die."""
    _stub(monkeypatch, ed, bulk={}, fmp_cik=None, browse_raises=True)
    assert ed.resolve_cik("MMC") is None


def test_an_unresolvable_ticker_is_none(monkeypatch, ed):
    _stub(monkeypatch, ed, bulk={}, fmp_cik=None, browse_cik=None)
    assert ed.resolve_cik("ZZZZ") is None


def test_blank_input_touches_nothing(monkeypatch, ed):
    order = _stub(monkeypatch, ed, bulk={"AAPL": "0000320193"})
    assert ed.resolve_cik("") is None and ed.resolve_cik(None) is None
    assert order == []


def test_the_result_is_cached_so_a_miss_is_not_re_paid(monkeypatch, ed):
    order = _stub(monkeypatch, ed, bulk={}, fmp_cik="62709")
    ed.resolve_cik("MMC")
    n = len(order)
    ed.resolve_cik("MMC")
    assert len(order) == n, f"re-resolved a known ticker: {order}"


# ── the bulk map itself, NOT stubbed ─────────────────────────────────────────
def test_the_bulk_map_is_keyed_by_ticker_and_pads_the_CIK(monkeypatch, ed):
    """⚰️ Every test above stubs `_ticker_to_cik_bulk`, so none of them could see
    that its first implementation was inverted AND padded the wrong side —
    it returned {'320193': '000000AAPL'}. A rail that stubs the function it
    should verify proves nothing about it.

    This one stubs only the HTTP fetch and exercises the real transform against
    SEC's actual payload shape ({cik_str: ticker})."""
    monkeypatch.setattr(ed, "_fetch_cik_ticker_map",
                        lambda: {"320193": "AAPL", "1045810": "NVDA"})
    m = ed._ticker_to_cik_bulk()
    assert m == {"AAPL": "0000320193", "NVDA": "0001045810"}


def test_resolve_cik_finds_a_mapped_ticker_through_the_real_transform(monkeypatch, ed):
    monkeypatch.setattr(ed, "_fetch_cik_ticker_map", lambda: {"320193": "AAPL"})
    monkeypatch.setattr(ed, "_fmp_cik", lambda *a, **k: pytest.fail("paid tier reached"))
    assert ed.resolve_cik("AAPL") == "0000320193"
