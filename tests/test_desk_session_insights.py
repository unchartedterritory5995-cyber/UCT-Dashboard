"""Tests for the pure (no-network) bits of desk_session_insights: VTT parsing,
Zoom-native summary parsing, and the LLM-output cleaners — plus orchestration
tests (Zoom-first vs LLM-fallback, ticker best-effort, ticker backfill) against
a temp education.db with a stubbed Zoom client."""
import json
import os
import tempfile

import pytest

from api.services import desk_session_insights as si
from api.services import education_service as edu


def test_parse_vtt_basic():
    vtt = """WEBVTT

1
00:00:01.000 --> 00:00:04.000
Good morning everyone.

2
00:01:30.500 --> 00:01:34.000
Let's look at <c>NVDA</c> here.
"""
    cues = si.parse_vtt(vtt)
    assert len(cues) == 2
    assert cues[0] == {"t": 1, "text": "Good morning everyone."}
    assert cues[1]["t"] == 90
    assert cues[1]["text"] == "Let's look at NVDA here."  # inline tags stripped


def test_parse_vtt_hours_and_wrapped_lines():
    vtt = """WEBVTT

01:02:03.000 --> 01:02:10.000
This is a long sentence
that wraps two lines.
"""
    cues = si.parse_vtt(vtt)
    assert len(cues) == 1
    assert cues[0]["t"] == 3723  # 1h2m3s
    assert cues[0]["text"] == "This is a long sentence that wraps two lines."


def test_parse_vtt_empty_and_junk():
    assert si.parse_vtt("") == []
    assert si.parse_vtt("not a transcript at all") == []


def test_hhmmss():
    assert si._hhmmss(0) == "0:00"
    assert si._hhmmss(90) == "1:30"
    assert si._hhmmss(3723) == "1:02:03"


def test_transcript_plain():
    cues = [{"t": 0, "text": "a"}, {"t": 5, "text": "b"}]
    assert si.transcript_plain(cues) == "a\nb"


def test_timestamped_block_caps():
    cues = [{"t": i, "text": "x" * 100} for i in range(1000)]
    block = si._timestamped_block(cues, max_chars=500)
    assert len(block) <= 600  # roughly bounded; not the full 1000 lines
    assert block.startswith("[0:00]")


def test_find_transcript_file():
    rec = {"recording_files": [
        {"file_type": "MP4", "download_url": "http://x/mp4"},
        {"file_type": "TRANSCRIPT", "recording_type": "audio_transcript",
         "status": "completed", "download_url": "http://x/vtt"},
    ]}
    f = si._find_transcript_file(rec)
    assert f and f["download_url"] == "http://x/vtt"
    assert si._find_transcript_file({"recording_files": [{"file_type": "MP4"}]}) is None
    assert si._find_transcript_file({}) is None


def test_strip_json_fenced():
    assert si._strip_json('```json\n{"a":1}\n```') == '{"a":1}'
    assert si._strip_json('chatter {"a":1} trailing') == '{"a":1}'


def test_generate_insights_overrides_short_shared_client_timeout(monkeypatch):
    """The shared engine client is capped at 60s to protect the request path;
    the insights call MUST override it or every real transcript times out
    (regression 2026-07-02: launch-hardening silently broke chapter generation)."""
    from api.services import engine

    captured = {}

    class _Block:
        text = ('{"headline": "h", "summary": ["s"], '
                '"chapters": [{"t": 5, "title": "Open"}], "ticker_moments": []}')

    class _Msg:
        content = [_Block()]

    class _Messages:
        @staticmethod
        def create(**kw):
            return _Msg()

    class _Client:
        messages = _Messages()

        def with_options(self, **kw):
            captured.update(kw)
            return self

    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: _Client())
    out = si.generate_insights("Title", [{"t": 5, "text": "hello"}])
    assert captured.get("timeout", 0) >= 120
    assert out["chapters"] == [{"t": 5, "title": "Open"}]


def test_model_defaults_to_haiku():
    assert si._MODEL == "claude-haiku-4-5"


# ── _hms_to_secs ─────────────────────────────────────────────────────────────────

def test_hms_to_secs():
    assert si._hms_to_secs("00:00:00.000") == 0
    assert si._hms_to_secs("00:09:13.190") == 553
    assert si._hms_to_secs("01:02:03.000") == 3723
    assert si._hms_to_secs("junk") is None
    assert si._hms_to_secs("") is None
    assert si._hms_to_secs(None) is None


# ── parse_zoom_summary ───────────────────────────────────────────────────────────

def test_parse_zoom_summary_happy():
    raw = json.dumps({
        "overall_summary": "Joe and Patrick conducted a trading education session about momentum flags.",
        "items": [
            {"label": "Trading Strategies and Momentum Flags", "start_time": "00:00:00.000",
             "end_time": "00:09:13.190",
             "summary": "Joe discussed the importance of momentum flags.", "short_summary": ""},
            {"label": "Q&A", "start_time": "00:09:13.190", "end_time": "00:15:00.000",
             "summary": "Audience questions.", "short_summary": ""},
        ],
    })
    out = si.parse_zoom_summary(raw)
    assert out["headline"] == ("Joe and Patrick conducted a trading education "
                               "session about momentum flags.")
    assert out["chapters"] == [
        {"t": 0, "title": "Trading Strategies and Momentum Flags"},
        {"t": 553, "title": "Q&A"},
    ]
    assert out["summary"] == ["Joe discussed the importance of momentum flags.",
                              "Audience questions."]


def test_parse_zoom_summary_malformed_json():
    assert si.parse_zoom_summary("not json {") == {"headline": "", "summary": [], "chapters": []}
    assert si.parse_zoom_summary("") == {"headline": "", "summary": [], "chapters": []}


def test_parse_zoom_summary_missing_items():
    out = si.parse_zoom_summary(json.dumps({"overall_summary": "Recap only."}))
    assert out["chapters"] == []
    assert out["summary"] == []
    assert out["headline"] == "Recap only."


def test_parse_zoom_summary_skips_items_missing_label_or_start_time():
    raw = json.dumps({
        "overall_summary": "x",
        "items": [
            {"label": "", "start_time": "00:00:00.000", "summary": "a"},   # no label
            {"label": "Has label", "start_time": "", "summary": "b"},      # no start_time
            {"label": "Good", "start_time": "00:01:00.000", "summary": "c"},
        ],
    })
    out = si.parse_zoom_summary(raw)
    assert out["chapters"] == [{"t": 60, "title": "Good"}]


def test_parse_zoom_summary_sorts_chapters_and_caps_summary_at_6():
    items = [
        {"label": f"Segment {i}", "start_time": f"00:{(7 - i):02d}:00.000", "summary": f"point {i}"}
        for i in range(8)  # descending start_times -> out of order in the raw JSON
    ]
    out = si.parse_zoom_summary(json.dumps({"overall_summary": "o", "items": items}))
    ts = [c["t"] for c in out["chapters"]]
    assert ts == sorted(ts)
    assert len(out["chapters"]) == 8          # all 8 kept (only summary is capped)
    assert len(out["summary"]) == 6
    assert out["summary"][0] == "point 0"     # first item in raw order, not sorted by t


def test_parse_zoom_summary_trims_headline_summary_and_chapter_title():
    raw = json.dumps({
        "overall_summary": "x" * 250,
        "items": [{"label": "z" * 100, "start_time": "00:00:00.000", "summary": "y" * 400}],
    })
    out = si.parse_zoom_summary(raw)
    assert len(out["headline"]) == 200
    assert len(out["summary"][0]) == 300
    assert len(out["chapters"][0]["title"]) == 80


# ── _find_summary_file ───────────────────────────────────────────────────────────

def test_find_summary_file_picks_summary_ignores_next_steps():
    rec = {"recording_files": [
        {"file_type": "MP4", "download_url": "http://x/mp4"},
        {"file_type": "SUMMARY", "recording_type": "summary_next_steps", "download_url": "http://x/next"},
        {"file_type": "SUMMARY", "recording_type": "summary", "download_url": "http://x/summary"},
    ]}
    f = si._find_summary_file(rec)
    assert f and f["download_url"] == "http://x/summary"


def test_find_summary_file_none_when_absent():
    assert si._find_summary_file({"recording_files": [{"file_type": "MP4"}]}) is None
    assert si._find_summary_file({}) is None


# ── Orchestration (temp education.db + stubbed Zoom) ─────────────────────────────

_SUMMARY_JSON = json.dumps({
    "overall_summary": "Traders reviewed NVDA momentum and the broader tape.",
    "items": [
        {"label": "Open & Game Plan", "start_time": "00:00:00.000", "end_time": "00:05:00.000",
         "summary": "Opening remarks and the day's watchlist.", "short_summary": ""},
        {"label": "NVDA Setup", "start_time": "00:05:00.000", "end_time": "00:10:00.000",
         "summary": "NVDA breakout discussion.", "short_summary": ""},
    ],
})
_VTT = ("WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n"
        "Good morning, let's talk NVDA today.\n")


class _FakeZoom:
    """Stubbed Zoom client: get_recording_files/download_text/delete_recording
    mirror ZoomClient's public surface, driven off a fixed rec + url->text map."""
    def __init__(self, rec, downloads):
        self._rec = rec
        self._downloads = downloads
        self.deleted = []

    def get_recording_files(self, uuid):
        return self._rec

    def download_text(self, url):
        return self._downloads.get(url, "")

    def delete_recording(self, uuid):
        self.deleted.append(uuid)


@pytest.fixture
def edu_db(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(edu, "_DB_PATH", os.path.join(d, "education.db"))
        # Recap-poster rendering writes a PNG to disk; isolate it from the real
        # /data/desk_recaps so orchestration tests don't leave files behind.
        monkeypatch.setenv("DESK_RECAP_DIR", os.path.join(d, "desk_recaps"))
        edu._init_db()
        yield edu


@pytest.fixture(autouse=False)
def chapters_enabled(monkeypatch):
    monkeypatch.setenv("DESK_SESSION_CHAPTERS_ENABLED", "1")


def _seed_session_video(title="Live Trading Session — June 24, 2026", meeting_uuid="UUID1"):
    v = edu.create_video({"youtube_id": f"Y-{meeting_uuid}", "title": title,
                          "category": "Live Trading Sessions", "sort_order": 0})
    edu.set_meeting_uuid(v["id"], meeting_uuid)
    return v


def test_zoom_summary_path_stores_chapters_without_touching_llm_client(edu_db, chapters_enabled, monkeypatch):
    """Summary file present -> chapters/headline/summary come straight from Zoom
    with ZERO Anthropic client construction. The tickers attempt is a separate,
    independently-stubbed call (proving it's the ONLY thing that may touch an LLM)."""
    from api.services import engine

    def _boom():
        raise AssertionError("the Zoom-first chapters path must not touch the Anthropic client")
    monkeypatch.setattr(engine, "_get_anthropic_client", _boom)
    monkeypatch.setattr(si, "generate_ticker_moments",
                        lambda title, cues: [{"ticker": "NVDA", "t": 1, "note": ""}])

    v = _seed_session_video()
    rec = {"recording_files": [
        {"file_type": "SUMMARY", "recording_type": "summary", "download_url": "http://x/summary"},
        {"file_type": "SUMMARY", "recording_type": "summary_next_steps", "download_url": "http://x/next"},
        {"file_type": "TRANSCRIPT", "recording_type": "audio_transcript", "status": "completed",
         "download_url": "http://x/vtt"},
    ]}
    zoom = _FakeZoom(rec, {"http://x/summary": _SUMMARY_JSON, "http://x/vtt": _VTT})

    out = si.process_pending_session_insights(zoom=zoom)

    assert any(r.get("action") == "generated" and r.get("source") == "zoom" for r in out)
    row = edu.get_video(v["id"])
    chapters = json.loads(row["chapters"])
    assert chapters == [
        {"t": 0, "title": "Open & Game Plan"},
        {"t": 300, "title": "NVDA Setup"},
    ]
    assert row["headline"] == "Traders reviewed NVDA momentum and the broader tape."
    assert json.loads(row["ticker_moments"]) == [{"ticker": "NVDA", "t": 1, "note": ""}]
    assert zoom.deleted == ["UUID1"]  # trashed once chapters landed


def test_no_summary_file_falls_back_to_generate_insights(edu_db, chapters_enabled, monkeypatch):
    calls = []

    def _fake_generate_insights(title, cues):
        calls.append((title, len(cues)))
        return {"headline": "H", "summary": ["s1"],
                "chapters": [{"t": 0, "title": "Open"}],
                "ticker_moments": [{"ticker": "AAPL", "t": 1, "note": ""}]}
    monkeypatch.setattr(si, "generate_insights", _fake_generate_insights)

    v = _seed_session_video(title="Live Trading Session — June 25, 2026", meeting_uuid="UUID2")
    rec = {"recording_files": [
        {"file_type": "TRANSCRIPT", "recording_type": "audio_transcript", "status": "completed",
         "download_url": "http://x/vtt"},
    ]}
    zoom = _FakeZoom(rec, {"http://x/vtt": _VTT})

    si.process_pending_session_insights(zoom=zoom)

    assert calls and calls[0][0] == "Live Trading Session — June 25, 2026"
    row = edu.get_video(v["id"])
    assert json.loads(row["chapters"]) == [{"t": 0, "title": "Open"}]
    assert json.loads(row["ticker_moments"]) == [{"ticker": "AAPL", "t": 1, "note": ""}]


def test_tickers_best_effort_failure_does_not_block_chapters(edu_db, chapters_enabled, monkeypatch):
    """Tickers best-effort: LLM raises -> insights still stored, empty tickers."""
    def _boom(title, cues):
        raise RuntimeError("billing boom")
    monkeypatch.setattr(si, "generate_ticker_moments", _boom)

    v = _seed_session_video(title="Live Trading Session — June 26, 2026", meeting_uuid="UUID3")
    rec = {"recording_files": [
        {"file_type": "SUMMARY", "recording_type": "summary", "download_url": "http://x/summary"},
        {"file_type": "TRANSCRIPT", "recording_type": "audio_transcript", "status": "completed",
         "download_url": "http://x/vtt"},
    ]}
    zoom = _FakeZoom(rec, {"http://x/summary": _SUMMARY_JSON, "http://x/vtt": _VTT})

    si.process_pending_session_insights(zoom=zoom)

    row = edu.get_video(v["id"])
    assert len(json.loads(row["chapters"])) == 2
    assert json.loads(row["ticker_moments"]) == []
    assert zoom.deleted == ["UUID3"]


def test_find_summary_file_only_no_chapters_falls_back_to_llm(edu_db, chapters_enabled, monkeypatch):
    """A summary file with zero usable chapters (e.g. every item missing a
    label) must not be treated as a Zoom-first success — falls through to the
    LLM path instead of storing empty chapters."""
    calls = []
    monkeypatch.setattr(si, "generate_insights",
                        lambda title, cues: calls.append(1) or
                        {"headline": "H", "summary": [], "chapters": [{"t": 0, "title": "Open"}],
                         "ticker_moments": []})
    empty_summary = json.dumps({"overall_summary": "o",
                                "items": [{"label": "", "start_time": "00:00:00.000", "summary": "x"}]})
    v = _seed_session_video(title="Live Trading Session — June 27, 2026", meeting_uuid="UUID4")
    rec = {"recording_files": [
        {"file_type": "SUMMARY", "recording_type": "summary", "download_url": "http://x/summary"},
        {"file_type": "TRANSCRIPT", "recording_type": "audio_transcript", "status": "completed",
         "download_url": "http://x/vtt"},
    ]}
    zoom = _FakeZoom(rec, {"http://x/summary": empty_summary, "http://x/vtt": _VTT})

    si.process_pending_session_insights(zoom=zoom)

    assert calls == [1]
    row = edu.get_video(v["id"])
    assert json.loads(row["chapters"]) == [{"t": 0, "title": "Open"}]


# ── Ticker backfill loop ─────────────────────────────────────────────────────────

def test_ticker_backfill_populates_from_stored_transcript_no_zoom(edu_db, chapters_enabled, monkeypatch):
    monkeypatch.setattr(si, "generate_ticker_moments",
                        lambda title, cues: [{"ticker": "TSLA", "t": 10, "note": ""}])

    v = _seed_session_video(title="Live Trading Session — June 28, 2026", meeting_uuid="UUID5")
    edu.set_video_insights(v["id"], transcript="[0:10] Talking about TSLA today.",
                           chapters=[{"t": 0, "title": "Open"}], ticker_moments=[])
    edu.mark_zoom_cleaned(v["id"])  # excluded from the main pending list already

    class _NoZoomAllowed:
        def get_recording_files(self, uuid):
            raise AssertionError("ticker backfill must not call Zoom")

    out = si.process_pending_session_insights(zoom=_NoZoomAllowed())

    assert any(r.get("action") == "ticker_backfill" for r in out)
    row = edu.get_video(v["id"])
    assert json.loads(row["ticker_moments"]) == [{"ticker": "TSLA", "t": 10, "note": ""}]


def test_ticker_backfill_bounded_to_3_per_pass(edu_db, chapters_enabled, monkeypatch):
    calls = []
    monkeypatch.setattr(si, "generate_ticker_moments",
                        lambda title, cues: calls.append(title) or [{"ticker": "AAPL", "t": 1, "note": ""}])
    for i in range(5):
        v = _seed_session_video(title=f"Live Trading Session — day {i}", meeting_uuid=f"UUIDB{i}")
        edu.set_video_insights(v["id"], transcript="[0:01] hello",
                               chapters=[{"t": 0, "title": "Open"}], ticker_moments=[])
        edu.mark_zoom_cleaned(v["id"])

    si.process_pending_session_insights(zoom=None)

    assert len(calls) == 3  # bounded — not all 5 in one pass


def test_ticker_backfill_failure_does_not_poison_for_next_pass(edu_db, chapters_enabled, monkeypatch):
    v = _seed_session_video(title="Live Trading Session — June 29, 2026", meeting_uuid="UUID6")
    edu.set_video_insights(v["id"], transcript="[0:05] hello there.",
                           chapters=[{"t": 0, "title": "Open"}], ticker_moments=[])
    edu.mark_zoom_cleaned(v["id"])

    monkeypatch.setattr(si, "generate_ticker_moments",
                        lambda title, cues: (_ for _ in ()).throw(RuntimeError("boom")))
    si.process_pending_session_insights(zoom=None)
    row = edu.get_video(v["id"])
    assert json.loads(row["ticker_moments"] or "[]") == []  # not poisoned to a truthy sentinel

    # Next pass: LLM works now -> the video is still eligible (wasn't stamped away).
    monkeypatch.setattr(si, "generate_ticker_moments",
                        lambda title, cues: [{"ticker": "MSFT", "t": 5, "note": ""}])
    si.process_pending_session_insights(zoom=None)
    row = edu.get_video(v["id"])
    assert json.loads(row["ticker_moments"]) == [{"ticker": "MSFT", "t": 5, "note": ""}]


def test_ticker_backfill_skippable_via_env(edu_db, chapters_enabled, monkeypatch):
    monkeypatch.setenv("DESK_CHAPTERS_TICKER_BACKFILL", "0")
    calls = []
    monkeypatch.setattr(si, "generate_ticker_moments", lambda title, cues: calls.append(1) or [])

    v = _seed_session_video(title="Live Trading Session — June 30, 2026", meeting_uuid="UUID7")
    edu.set_video_insights(v["id"], transcript="[0:05] hi",
                           chapters=[{"t": 0, "title": "Open"}], ticker_moments=[])
    edu.mark_zoom_cleaned(v["id"])

    si.process_pending_session_insights(zoom=None)

    assert calls == []


def test_videos_missing_ticker_moments_query(edu_db):
    v1 = _seed_session_video(title="A", meeting_uuid="Q1")
    edu.set_video_insights(v1["id"], transcript="[0:00] a", chapters=[{"t": 0, "title": "Open"}],
                           ticker_moments=[])
    v2 = _seed_session_video(title="B", meeting_uuid="Q2")
    edu.set_video_insights(v2["id"], transcript="[0:00] b", chapters=[{"t": 0, "title": "Open"}],
                           ticker_moments=[{"ticker": "AAPL", "t": 0, "note": ""}])
    v3 = _seed_session_video(title="C", meeting_uuid="Q3")  # no chapters yet at all

    rows = edu.videos_missing_ticker_moments(7 * 86400, 10)
    ids = {r["id"] for r in rows}
    assert v1["id"] in ids
    assert v2["id"] not in ids   # already has ticker_moments
    assert v3["id"] not in ids   # no chapters yet
