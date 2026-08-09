"""Tests for the FMP earnings-call transcript service (primary verbatim source)."""
import json
import pathlib

import api.services.fmp_transcripts as ft

_FIXTURES = json.loads(
    (pathlib.Path(__file__).parent / "fixtures" / "fmp_transcript_excerpts.json")
    .read_text(encoding="utf-8")
)


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


# ── Real-transcript segmentation rails ────────────────────────────────────────
#
# These fixtures are VERBATIM excerpts of live FMP transcripts, captured
# 2026-08-08, not hand-written strings. Both defects below were invisible to the
# synthetic single-line blobs above — which is exactly why they shipped: the
# synthetic case is the one the old regex was written against.


def test_a_speaker_name_containing_a_comma_still_opens_a_turn():
    """DIS Q&A is moderated by 'Benjamin Daniel Swinburne, C.F.A.'.

    The comma+credential is the whole point: the old boundary allowed only
    spaces between name words, so this speaker never matched, his turns merged
    into the PRECEDING executive's segment, and on the full FY26Q3 call that
    mis-attributed 22 of 46 turns. A verbatim quote under the wrong name is
    worse than no quote.
    """
    segs = ft._segment(_FIXTURES["DIS_2026Q3_qa_excerpt"])
    speakers = [s["speaker"] for s in segs]

    assert "Benjamin Daniel Swinburne, C.F.A." in speakers
    # …and he must open his OWN turn, not be swallowed into the operator's text.
    ben = next(s for s in segs if s["speaker"] == "Benjamin Daniel Swinburne, C.F.A.")
    assert ben["content"].startswith("Good morning, everyone")
    assert "Benjamin" not in segs[0]["content"], "operator turn absorbed the next speaker"
    assert speakers == ["Operator", "Benjamin Daniel Swinburne, C.F.A.", "Josh D’Amaro"]


def test_a_speaker_name_never_absorbs_the_previous_turns_trailing_words():
    """AAPL yielded speaker='Thanks.\\n\\nTim Cook' — one human, two identities.

    The old boundary could start mid-line (`(?<=[.?!])\\s+`) and its name class
    admitted `.`, so a preceding turn's last word glued onto the next name. That
    fragments speaker identity, which silently breaks any speaker filter or
    role map built on top of it.
    """
    segs = ft._segment(_FIXTURES["AAPL_2026Q3_hand_off_excerpt"])
    speakers = [s["speaker"] for s in segs]

    for sp in speakers:
        assert "\n" not in sp, f"speaker name spans a line break: {sp!r}"
        assert not sp.startswith("Thanks"), f"previous turn's words glued on: {sp!r}"
    # Tim Cook speaks three times in this excerpt — as ONE identity, not two.
    assert speakers.count("Tim Cook") == 3
    assert "Kevan Parekh" in speakers


def test_a_one_line_blob_still_segments_by_sentence_boundary():
    """The ladder's second rung. Some FMP rows arrive with no newlines at all;
    line-anchoring alone would return a single unsplit segment for those."""
    blob = ("Tim Cook: Revenue was a record. "
            "Kevan Parekh: Gross margin expanded. "
            "Operator: We will now take questions.")
    assert [s["speaker"] for s in ft._segment(blob)] == [
        "Tim Cook", "Kevan Parekh", "Operator",
    ]


def test_a_capitalised_label_is_not_mistaken_for_a_speaker():
    """`\\w` in a name class would admit digits, turning 'Q3:' into a speaker."""
    blob = ("Operator: Welcome to the call.\n"
            "Tim Cook: Here are the numbers.\n"
            "Q3: revenue grew. Segment: Services led.\n"
            "Kevan Parekh: That concludes our remarks.\n")
    speakers = [s["speaker"] for s in ft._segment(blob)]
    assert "Q3" not in speakers
    assert speakers == ["Operator", "Tim Cook", "Kevan Parekh"]


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
