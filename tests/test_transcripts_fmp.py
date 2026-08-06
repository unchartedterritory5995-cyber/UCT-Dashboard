"""FMP migration for the EarningsModal transcript-summary service
(api/services/transcripts.py) — Finnhub /stock/transcripts* 403s permanently
on this plan (live-probed 2026-08-05); FMP stable/earning-call-transcript(-dates)
is now the primary leg, Finnhub kept as a fallback.
"""
import time

import pytest

import api.services.fmp_transcripts as ft
import api.services.transcripts as tr


class _FakeCache:
    def __init__(self):
        self.d = {}

    def get(self, k):
        return self.d.get(k)

    def set(self, k, v, ttl=None):
        self.d[k] = v

    def invalidate(self, k):
        self.d.pop(k, None)


@pytest.fixture(autouse=True)
def _reset_finnhub_state(monkeypatch):
    """Isolate from other tests' shared Finnhub token-bucket / 403-memo state."""
    from api.services import finnhub_client as fhc
    from api.services.cache import cache

    monkeypatch.setenv("FINNHUB_API_KEY", "test-fh-key")
    monkeypatch.setenv("FMP_API_KEY", "test-fmp-key")
    fhc._fh_cooldown_until = 0.0
    fhc._fh_bucket_tokens = fhc._FH_RATE_LIMIT_PER_MIN
    fhc._fh_bucket_updated = time.monotonic()
    for path in ("/stock/transcripts/list", "/stock/transcripts"):
        cache.invalidate(f"fh_forbidden_{path}")
    yield
    fhc._fh_cooldown_until = 0.0
    fhc._fh_bucket_tokens = fhc._FH_RATE_LIMIT_PER_MIN
    fhc._fh_bucket_updated = time.monotonic()
    for path in ("/stock/transcripts/list", "/stock/transcripts"):
        cache.invalidate(f"fh_forbidden_{path}")


# ── FMP leg: index -> detail happy path ──────────────────────────────────────

def test_fmp_leg_happy_path_index_then_detail(monkeypatch):
    monkeypatch.setattr(ft, "_available", lambda symbol: [(2026, 3), (2026, 2)])

    def fake_fetch(symbol, year, quarter):
        assert symbol == "AAPL" and year == 2026 and quarter == 3   # newest picked
        return {"symbol": "AAPL", "period": "Q3", "year": 2026, "date": "2026-07-30",
                "content": "Tim Cook: Strong quarter. Operator: Questions now."}

    monkeypatch.setattr(ft, "_fetch", fake_fetch)

    result = tr._fetch_latest_transcript_fmp("AAPL")
    assert result is not None
    assert result["quarter"] == 3
    assert result["year"] == 2026
    assert result["title"] == "AAPL Q3 2026"
    assert result["text"] == "Tim Cook: Strong quarter. Operator: Questions now."


def test_fmp_leg_builds_text_from_content_not_a_parts_list(monkeypatch):
    """The FMP shape has no speaker-`parts` list to concatenate (that was
    Finnhub's shape) — `text` must come straight from the single `content`
    string, unmodified (aside from truncation)."""
    monkeypatch.setattr(ft, "_available", lambda symbol: [(2025, 4)])
    raw = "Operator: Welcome. CEO: Revenue grew 12%. Analyst: Any color on margins?"
    monkeypatch.setattr(ft, "_fetch", lambda symbol, year, quarter: {"content": raw})

    result = tr._fetch_latest_transcript_fmp("MSFT")
    assert result["text"] == raw


# ── FMP leg: empty index / empty content -> None, never {} ─────────────────

def test_fmp_leg_empty_index_returns_none(monkeypatch):
    monkeypatch.setattr(ft, "_available", lambda symbol: [])

    def fail_fetch(*a, **k):
        raise AssertionError("_fetch must not be called when the index is empty")

    monkeypatch.setattr(ft, "_fetch", fail_fetch)
    assert tr._fetch_latest_transcript_fmp("ZZZQ") is None


def test_fmp_leg_empty_content_returns_none(monkeypatch):
    monkeypatch.setattr(ft, "_available", lambda symbol: [(2026, 1)])
    monkeypatch.setattr(ft, "_fetch", lambda symbol, year, quarter: {"content": ""})
    assert tr._fetch_latest_transcript_fmp("ZZZQ") is None


def test_fmp_leg_fetch_returns_none_row(monkeypatch):
    monkeypatch.setattr(ft, "_available", lambda symbol: [(2026, 1)])
    monkeypatch.setattr(ft, "_fetch", lambda symbol, year, quarter: None)
    assert tr._fetch_latest_transcript_fmp("ZZZQ") is None


# ── Truncation boundaries preserved (3K head / 4K tail) ─────────────────────

def test_smart_truncate_keeps_head_3k_and_tail_4k_boundaries():
    head = "H" * 3000
    middle = "M" * 20000
    tail = "T" * 4000
    full = head + middle + tail
    out = tr._smart_truncate(full)
    assert out.startswith(head)
    assert out.endswith(tail)
    assert "M" not in out                      # the whole middle was dropped
    assert f"{len(full):,} chars total" in out


def test_smart_truncate_leaves_short_text_untouched():
    short = "short transcript under the threshold"
    assert tr._smart_truncate(short) == short


def test_fmp_leg_applies_truncation_to_long_content(monkeypatch):
    long_content = ("A" * 3000) + ("B" * 20000) + ("C" * 4000)
    monkeypatch.setattr(ft, "_available", lambda symbol: [(2026, 1)])
    monkeypatch.setattr(ft, "_fetch", lambda symbol, year, quarter: {"content": long_content})

    result = tr._fetch_latest_transcript_fmp("AAPL")
    assert result["text"].startswith("A" * 3000)
    assert result["text"].endswith("C" * 4000)
    assert "B" not in result["text"]


# ── Finnhub fallback: used only when FMP yields nothing ─────────────────────

def test_finnhub_fallback_used_when_fmp_empty(monkeypatch):
    monkeypatch.setattr(ft, "_available", lambda symbol: [])

    from api.services import finnhub_client as fhc

    def fake_get(url, params=None, timeout=None):
        assert "finnhub.io" in url
        if "transcripts/list" in url:
            return _FhResp({"transcripts": [{"id": "t1", "quarter": 2, "year": 2026, "title": "AAPL Q2 2026"}]})
        if url.endswith("/stock/transcripts"):
            return _FhResp({"transcript": [{"name": "Tim Cook",
                                             "speech": [{"name": "Tim Cook", "speech": "Revenue grew."}]}]})
        raise AssertionError(url)

    monkeypatch.setattr("requests.get", fake_get)
    result = tr._fetch_latest_transcript("AAPL")
    assert result is not None
    assert result["quarter"] == 2 and result["year"] == 2026
    assert "Tim Cook: Revenue grew." in result["text"]


def test_finnhub_not_called_when_fmp_succeeds(monkeypatch):
    monkeypatch.setattr(ft, "_available", lambda symbol: [(2026, 3)])
    monkeypatch.setattr(ft, "_fetch", lambda symbol, year, quarter: {"content": "Full text here."})

    def fail(*a, **k):
        raise AssertionError("Finnhub should not be reached when FMP succeeds")

    monkeypatch.setattr("requests.get", fail)
    result = tr._fetch_latest_transcript("AAPL")
    assert result is not None and result["text"] == "Full text here."


def test_both_legs_empty_returns_none(monkeypatch):
    monkeypatch.setattr(ft, "_available", lambda symbol: [])
    monkeypatch.setattr("requests.get", lambda url, params=None, timeout=None: _FhResp({}))
    assert tr._fetch_latest_transcript("ZZZQ") is None


class _FhResp:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception(f"{self.status_code}")

    def json(self):
        return self._payload


# ── get_transcript_summary: negative cache never {} on total failure ───────

def test_get_transcript_summary_total_miss_caches_available_false(monkeypatch):
    fake_cache = _FakeCache()
    monkeypatch.setattr("api.services.cache.cache", fake_cache)
    monkeypatch.setattr(tr, "_fetch_latest_transcript", lambda symbol: None)

    result = tr.get_transcript_summary("ZZZQ")
    assert result == {"available": False, "symbol": "ZZZQ"}
    assert fake_cache.get("transcript_summary_ZZZQ") == {"available": False, "symbol": "ZZZQ"}
