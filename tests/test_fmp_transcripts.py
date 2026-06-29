"""Tests for the FMP earnings-call transcript service (primary verbatim source)."""
import api.services.fmp_transcripts as ft


class _FakeCache:
    def __init__(self):
        self.d = {}

    def get(self, k):
        return self.d.get(k)

    def set(self, k, v, ttl=None):
        self.d[k] = v


def _patch_cache(monkeypatch):
    fake = _FakeCache()
    monkeypatch.setattr(ft, "cache", fake)
    return fake


def test_parse_quarter():
    assert ft._parse_quarter("2025Q1") == (2025, 1)
    assert ft._parse_quarter("2025q2") == (2025, 2)
    assert ft._parse_quarter("2025-Q3") == (2025, 3)
    assert ft._parse_quarter(None) == (None, None)
    assert ft._parse_quarter("garbage") == (None, None)


def test_segment_splits_speakers():
    blob = ("Suhasini Chandramouli: Good afternoon and welcome. Speaking first is Tim Cook. "
            "Tim Cook: Thank you Suhasini. Revenue was a record. "
            "Kevan Parekh: Thanks Tim. Gross margin expanded. "
            "Operator: We will now take questions.")
    segs = ft._segment(blob)
    speakers = [s["speaker"] for s in segs]
    assert speakers == ["Suhasini Chandramouli", "Tim Cook", "Kevan Parekh", "Operator"]
    assert segs[1]["content"].startswith("Thank you Suhasini")
    assert all(s["sentiment"] is None and s["title"] == "" for s in segs)


def test_segment_falls_back_to_single_when_unstructured():
    blob = "This is a plain paragraph with no speaker labels at all, just prose about the quarter."
    segs = ft._segment(blob)
    assert len(segs) == 1
    assert segs[0]["speaker"] == "" and segs[0]["content"] == blob


def test_get_transcript_explicit_quarter(monkeypatch):
    _patch_cache(monkeypatch)

    def fake_fmp(path, params, timeout=10):
        assert path == "/stable/earning-call-transcript"
        assert params["year"] == 2025 and params["quarter"] == 2
        return [{"symbol": "AAPL", "period": "Q2", "year": 2025, "date": "2025-05-01",
                 "content": "Tim Cook: Hello. Revenue grew. Kevan Parekh: Margins up. Operator: Questions."}]

    monkeypatch.setattr(ft.ee, "_fmp_get", fake_fmp)
    res = ft.get_transcript("aapl", quarter="2025Q2")
    assert res["symbol"] == "AAPL"
    assert res["quarter"] == "2025Q2"
    assert res["resolved"] is False
    assert [s["speaker"] for s in res["segments"]] == ["Tim Cook", "Kevan Parekh", "Operator"]


def test_get_transcript_auto_resolves_newest(monkeypatch):
    _patch_cache(monkeypatch)

    def fake_fmp(path, params, timeout=10):
        if path.endswith("transcript-dates"):
            return [{"fiscalYear": 2024, "quarter": 4, "date": "2025-01-30"},
                    {"fiscalYear": 2025, "quarter": 3, "date": "2025-07-31"},   # newest
                    {"fiscalYear": 2025, "quarter": 2, "date": "2025-05-01"}]
        assert params["year"] == 2025 and params["quarter"] == 3   # picks the newest
        return [{"content": "Operator: Welcome. Tim Cook: Strong quarter. Kevan Parekh: Details follow."}]

    monkeypatch.setattr(ft.ee, "_fmp_get", fake_fmp)
    res = ft.get_transcript("AAPL")
    assert res["quarter"] == "2025Q3"
    assert res["resolved"] is True
    assert len(res["segments"]) == 3


def test_get_transcript_miss_returns_none_and_caches(monkeypatch):
    fake = _patch_cache(monkeypatch)
    monkeypatch.setattr(ft.ee, "_fmp_get", lambda path, params, timeout=10: [])
    assert ft.get_transcript("ZZZ", quarter="2025Q1") is None
    # the miss is short-cached so a repeat doesn't re-hit FMP
    assert fake.get("fmp_transcript_ZZZ_2025_1") == {"_miss": True}
