"""The quarter index — the thing that makes 81 quarters of history reachable."""
import api.services.fmp_transcripts as ft


class _FakeCache:
    def __init__(self): self.d = {}; self.ttls = {}
    def get(self, k): return self.d.get(k)
    def set(self, k, v, ttl=None): self.d[k] = v; self.ttls[k] = ttl


def _cache(monkeypatch):
    c = _FakeCache(); monkeypatch.setattr(ft, "cache", c); return c


def test_lists_quarters_newest_first(monkeypatch):
    _cache(monkeypatch)
    monkeypatch.setattr(ft.ee, "_fmp_get", lambda p, params, timeout=10: [
        {"fiscalYear": 2025, "quarter": 2}, {"fiscalYear": 2026, "quarter": 3},
        {"fiscalYear": 2026, "quarter": 1},
    ])
    out = ft.list_quarters("dis")
    assert [q["quarter"] for q in out] == ["2026Q3", "2026Q1", "2025Q2"]
    assert out[0] == {"quarter": "2026Q3", "year": 2026, "q": 3}


def test_the_index_is_cached_so_opening_the_dropdown_is_free(monkeypatch):
    c = _cache(monkeypatch)
    calls = []
    def fake(p, params, timeout=10):
        calls.append(p)
        return [{"fiscalYear": 2026, "quarter": 3}]
    monkeypatch.setattr(ft.ee, "_fmp_get", fake)
    ft.list_quarters("DIS"); ft.list_quarters("DIS")
    assert len(calls) == 1


def test_an_empty_index_is_cached_only_BRIEFLY(monkeypatch):
    # A ticker with no transcript today may have one tonight. Pinning the miss
    # for the full 6h would hide that first transcript until tomorrow.
    c = _cache(monkeypatch)
    monkeypatch.setattr(ft.ee, "_fmp_get", lambda p, params, timeout=10: [])
    assert ft.list_quarters("ZZZ") == []
    assert c.ttls["fmp_transcript_quarters_ZZZ"] == ft._TTL_QUARTERS_MISS
    assert ft._TTL_QUARTERS_MISS < ft._TTL_QUARTERS


def test_a_provider_failure_returns_empty_rather_than_raising(monkeypatch):
    _cache(monkeypatch)
    def boom(p, params, timeout=10): raise RuntimeError("FMP down")
    monkeypatch.setattr(ft.ee, "_fmp_get", boom)
    assert ft.list_quarters("DIS") == []


def test_no_ticker_never_calls_the_provider(monkeypatch):
    _cache(monkeypatch)
    called = []
    monkeypatch.setattr(ft.ee, "_fmp_get", lambda *a, **k: called.append(1) or [])
    assert ft.list_quarters("") == [] and ft.list_quarters(None) == []
    assert not called


def test_resolving_the_newest_quarter_reuses_the_CACHED_index(monkeypatch):
    """A transcript open with no explicit quarter used to make a live
    `earning-call-transcript-dates` call every single time before reaching the
    30-day-cached body — measured at ~1.5s per repeat open. It must consult the
    cached index instead."""
    _cache(monkeypatch)
    dates_calls, body_calls = [], []

    def fake(path, params, timeout=10):
        if path.endswith("transcript-dates"):
            dates_calls.append(1)
            return [{"fiscalYear": 2026, "quarter": 3}]
        body_calls.append(1)
        return [{"content": "Tim Cook: Hi.\nKevan Parekh: Margins.\nOperator: Questions."}]

    monkeypatch.setattr(ft.ee, "_fmp_get", fake)
    for _ in range(3):
        assert ft.get_transcript("DIS")["quarter"] == "2026Q3"
    assert len(dates_calls) == 1, f"index refetched {len(dates_calls)}x — the 1.5s is back"
    assert len(body_calls) == 1, "transcript body refetched despite its 30d cache"
