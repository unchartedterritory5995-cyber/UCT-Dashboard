"""Batch enrichment endpoint — one request for a whole week (2026-07-01 scale pass)."""

from api.services.cache import cache
from api.routers.calendar import get_enrichment_batch, _compute_enrichment_for_date


def test_batch_returns_map_keyed_by_date():
    # Pre-warm one date's per-day cache; the other stays cold.
    cache.set("calendar_enrichment_2026-07-02", {"AAPL": {"expected_move": 3.1}}, ttl=60)
    # ensure the cold date has no weekly calendar → yields {}
    cache.set("calendar_weekly", None, ttl=1)

    out = get_enrichment_batch(dates="2026-07-02,2026-07-03")
    assert set(out.keys()) == {"2026-07-02", "2026-07-03"}
    assert out["2026-07-02"] == {"AAPL": {"expected_move": 3.1}}
    assert out["2026-07-03"] == {}  # cold / no calendar → empty overlay


def test_batch_skips_malformed_dates():
    out = get_enrichment_batch(dates="not-a-date,2026-07-02,,13-13-13")
    assert list(out.keys()) == ["2026-07-02"]


def test_batch_empty_input():
    assert get_enrichment_batch(dates=None) == {}
    assert get_enrichment_batch(dates="") == {}


def test_single_date_helper_uses_cache():
    cache.set("calendar_enrichment_2026-07-04", {"MSFT": {"beat_history": None}}, ttl=60)
    assert _compute_enrichment_for_date("2026-07-04") == {"MSFT": {"beat_history": None}}
