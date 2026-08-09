"""Timed transcripts + proxied call audio.

What these pin, in order of how much damage the failure does:
  1. the provider API key never reaches the browser
  2. word/time arrays stay aligned, or the turn is dropped
  3. an uncovered symbol degrades to "no audio", never to an error
"""
from __future__ import annotations

import importlib
from unittest.mock import patch

import pytest


@pytest.fixture
def ec(monkeypatch):
    monkeypatch.setenv("EARNINGS_TIMED_TRANSCRIPT", "1")
    monkeypatch.setenv("EARNINGS_AUDIO_API_KEY", "SECRET-KEY-123")
    import api.services.earningscall_timed as m
    importlib.reload(m)

    class _Cache:
        def __init__(self): self.d = {}
        def get(self, k): return self.d.get(k)
        def set(self, k, v, ttl=None): self.d[k] = v

    monkeypatch.setattr(m, "_cache", lambda: _Cache())
    return m


LEVEL3 = {
    "speaker_name_map_v2": {"1": {"name": "Tim Cook", "title": "CEO"}},
    "speakers": [
        {"speaker": 1, "words": ["Good", "afternoon"], "start_times": [0.0, 0.4]},
        {"speaker": 2, "words": ["Thanks"], "start_times": [9.2]},
    ],
}
EVENTS = {"company_name": "Apple Inc.",
          "events": [{"year": 2026, "quarter": 3, "is_published": True},
                     {"year": 2026, "quarter": 2, "is_published": True}]}


class TestTheKeyNeverLeaves:
    def test_the_audio_url_is_private_and_carries_the_key(self, ec):
        # The upstream URL puts the key in a QUERY STRING. Handing this to an
        # <audio src> would publish the subscription to every viewer, and it
        # would show up in browser history and any referrer log.
        url = ec._audio_url("AAPL", 2026, 3, "NASDAQ")
        assert "SECRET-KEY-123" in url, "sanity: this is the URL that must stay server-side"
        assert ec._audio_url.__name__.startswith("_"), \
            "the key-bearing accessor must stay private"

    def test_the_public_payload_contains_no_key(self, ec):
        with patch.object(ec, "_get", side_effect=[EVENTS, EVENTS, LEVEL3]):
            out = ec.get_timed_transcript("AAPL")
        assert out is not None
        import json
        blob = json.dumps(out)
        assert "SECRET-KEY-123" not in blob
        assert "apikey" not in blob


class TestWordTimeAlignment:
    def test_words_and_starts_come_back_paired(self, ec):
        with patch.object(ec, "_get", side_effect=[EVENTS, EVENTS, LEVEL3]):
            out = ec.get_timed_transcript("AAPL")
        seg = out["segments"][0]
        assert seg["words"] == ["Good", "afternoon"]
        assert seg["starts"] == [0.0, 0.4]
        assert seg["name"] == "Tim Cook" and seg["title"] == "CEO"

    def test_a_MISALIGNED_turn_is_dropped_not_zipped(self, ec):
        # Zipping to the shorter array would put later words on earlier
        # timestamps and the highlight would drift for the rest of the call —
        # a wrong answer that still looks like it is working.
        bad = {"speakers": [
            {"speaker": 1, "words": ["a", "b", "c"], "start_times": [0.0, 1.0]},
            {"speaker": 2, "words": ["ok"], "start_times": [5.0]},
        ]}
        with patch.object(ec, "_get", side_effect=[EVENTS, EVENTS, bad]):
            out = ec.get_timed_transcript("AAPL")
        assert [s["words"] for s in out["segments"]] == [["ok"]]

    def test_timestamps_are_floats_the_player_can_seek_to(self, ec):
        raw = {"speakers": [{"speaker": 1, "words": ["x"], "start_times": ["12"]}]}
        with patch.object(ec, "_get", side_effect=[EVENTS, EVENTS, raw]):
            out = ec.get_timed_transcript("AAPL")
        assert out["segments"][0]["starts"] == [12.0]
        assert isinstance(out["segments"][0]["starts"][0], float)


class TestUncoveredDegradesQuietly:
    def test_a_symbol_with_no_events_returns_None(self, ec):
        with patch.object(ec, "_get", return_value=None):
            assert ec.get_timed_transcript("ZZZZ") is None

    def test_a_raising_provider_does_not_escape(self, ec):
        with patch.object(ec, "_get", side_effect=RuntimeError("provider down")):
            assert ec.get_timed_transcript("AAPL") is None
            assert ec.latest_event("AAPL") is None

    def test_disabled_by_flag(self, ec, monkeypatch):
        monkeypatch.setenv("EARNINGS_TIMED_TRANSCRIPT", "0")
        assert ec.get_timed_transcript("AAPL") is None


class TestLatestEvent:
    def test_picks_the_newest_PUBLISHED_call_by_sorting_not_by_trusting_order(self, ec):
        # Serving a two-year-old call as "latest" is one provider reshuffle away
        # if the feed's ordering is taken on faith.
        shuffled = {"company_name": "X", "events": [
            {"year": 2024, "quarter": 1, "is_published": True},
            {"year": 2026, "quarter": 3, "is_published": True},
            {"year": 2026, "quarter": 4, "is_published": False},   # not out yet
        ]}
        with patch.object(ec, "_get", return_value=shuffled):
            ev = ec.latest_event("AAPL")
        assert (ev["year"], ev["quarter"]) == (2026, 3)
