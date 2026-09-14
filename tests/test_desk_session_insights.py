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


class _FakeR2Bucket:
    """In-memory stand-in for the wisdom/ R2 writer (api.services.wisdom.core.r2)."""

    def __init__(self):
        self.objects: dict = {}

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            from botocore.exceptions import ClientError

            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {"Metadata": {"sha256": self.objects[Key][1]}}

    def put_object(self, Bucket, Key, Body, ContentType, Metadata):
        assert Key not in self.objects, "overwrite attempted"
        self.objects[Key] = (Body, Metadata["sha256"])


@pytest.fixture(autouse=True)
def fake_r2(monkeypatch):
    """⛔ HERMETIC R2, for EVERY test in this module.

    The trash path archives raw VTTs to R2 before deleting a Zoom recording. This
    box carries real DATA_SYNC_* credentials in its environment, so without this
    fixture an orchestration test that reaches the trash writes fixture objects
    into the REAL bucket (measured 2026-09-13 — that is how this fixture came to
    exist). The credentials are removed AND the client is replaced, so a code path
    that bypasses core.r2 still finds no client."""
    for var in ("DATA_SYNC_ENDPOINT_URL", "DATA_SYNC_ACCESS_KEY", "DATA_SYNC_SECRET_KEY", "DATA_SYNC_BUCKET"):
        monkeypatch.delenv(var, raising=False)
    from api.services.wisdom.core import r2

    bucket = _FakeR2Bucket()
    monkeypatch.setattr(r2, "_client_and_bucket", lambda: (bucket, "fake-bucket"))
    monkeypatch.setattr(si, "_COVERAGE_ALERTED", set())
    return bucket


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


# ── _clean_chapter_title (2026-08-27: never cut a chapter title mid-word) ────────

def test_clean_chapter_title_short_text_unchanged():
    assert si._clean_chapter_title("MU holds the 21 EMA") == "MU holds the 21 EMA"


def test_clean_chapter_title_truncates_at_word_boundary_with_ellipsis():
    title = si._clean_chapter_title(
        "Marvell earnings tonight concern; worst-case semi gap-down cascade and software")
    assert title.endswith("…")
    assert " " not in title[-2:-1]        # the char before the ellipsis isn't a stray space
    long = "Marvell earnings tonight concern; worst-case semi gap-down cascade and software"
    assert long.startswith(title[:-1])
    assert long[len(title) - 1:len(title)] in (" ", "")


def test_clean_chapter_title_respects_custom_max_len():
    assert len(si._clean_chapter_title("a " * 40, max_len=20)) <= 21


def test_clean_chapter_title_hard_cuts_a_single_long_word():
    word = "x" * 100
    out = si._clean_chapter_title(word, max_len=60)
    assert out == "x" * 60 + "…"


def test_clean_chapter_title_empty_input():
    assert si._clean_chapter_title("") == ""
    assert si._clean_chapter_title(None) == ""


# ── _clean_chapters (LLM fallback path reuses the same word-safe cleaner) ────────

def test_clean_chapters_truncates_long_titles_at_word_boundary():
    long_title = "Position management, progressive exposure debate, account risk per trade discipline"
    out = si._clean_chapters([{"t": 0, "title": long_title}])
    assert out[0]["title"].endswith("…")
    assert long_title.startswith(out[0]["title"][:-1])


def test_clean_chapters_short_titles_pass_through_unchanged():
    out = si._clean_chapters([{"t": 5, "title": "Open"}])
    assert out == [{"t": 5, "title": "Open"}]


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
    long_prose = ("They discussed market conditions in detail. " * 20).strip()  # ~880 chars
    raw = json.dumps({
        "overall_summary": long_prose,
        "items": [{"label": "z" * 100, "start_time": "00:00:00.000", "summary": long_prose}],
    })
    out = si.parse_zoom_summary(raw)
    # Sentence-safe bounds: never a mid-sentence hard slice.
    assert len(out["headline"]) <= 400 and out["headline"].endswith(".")
    assert len(out["summary"][0]) <= 600 and out["summary"][0].endswith(".")
    # Word-safe chapter title bound (single 100-char run of "z" has no space,
    # so the hard-cut-with-ellipsis fallback applies).
    assert len(out["chapters"][0]["title"]) <= 61  # 60 + the ellipsis mark
    assert out["chapters"][0]["title"] == "z" * 60 + "…"


def test_parse_zoom_summary_truncates_a_long_label_at_a_word_boundary():
    label = "Semiconductor watch-list review and intraday decision points across the desk"
    raw = json.dumps({"overall_summary": "o",
                      "items": [{"label": label, "start_time": "00:00:00.000", "summary": ""}]})
    out = si.parse_zoom_summary(raw)
    title = out["chapters"][0]["title"]
    assert title.endswith("…")
    stripped = title[:-1]                 # drop the ellipsis mark
    assert label.startswith(stripped)     # kept text is an exact prefix of the real label
    # The character right after the kept prefix is a space (or the prefix IS
    # the whole label) — i.e. the cut landed exactly at a word boundary, never
    # mid-word.
    assert label[len(stripped):len(stripped) + 1] in (" ", "")


# ── _sentence_trim ───────────────────────────────────────────────────────────────

def test_sentence_trim_short_text_untouched():
    assert si._sentence_trim("NVDA held the 50-day.", 300) == "NVDA held the 50-day."


def test_sentence_trim_cuts_at_sentence_boundary():
    t = "First point here. Second point follows. " + "x" * 400
    out = si._sentence_trim(t, 100)
    assert out == "First point here. Second point follows."


def test_sentence_trim_no_sentence_end_falls_back_to_word_ellipsis():
    t = "alpha bravo charlie delta echo foxtrot golf hotel india juliet"
    out = si._sentence_trim(t, 30)
    assert out.endswith("…")
    assert " " not in out[-2]          # ellipsis follows a full word, not a space
    assert t.startswith(out[:-1])      # word-boundary prefix, no mid-word cut


def test_sentence_trim_ignores_too_early_sentence_end():
    t = "Hi. " + "word " * 100
    out = si._sentence_trim(t, 200)
    assert out != "Hi."                # a 2%-of-window sentence must not win
    assert out.endswith("…")


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

# ⛔⛔ CONTRACTS §8a.6a + reviewer R2 (2026-09-13). The trash gate refuses a recording
# whose coverage it CANNOT MEASURE, so a fixture that wants to reach the trash has to
# carry a real published-MP4 window and a transcript that actually covers it.
#
# ⚰️ Why this fixture exists at all: before R2 these tests reached the trash precisely
# BECAUSE they were unmeasurable — `coverage is None` short-circuited the guard and read
# as a pass. Five green tests were therefore asserting the very delete §8a.6a forbids,
# while the new rail beside them
# (test_expired_wait_with_no_transcript_keeps_a_measurable_recording) asserted the
# opposite for a measurable one. Both passed; the invariant was split by a `None`.
_MP4_HOUR = {"file_type": "MP4", "id": "mp4-hour", "file_size": 9,
             "recording_start": "2026-06-24T13:30:00Z", "recording_end": "2026-06-24T14:30:00Z",
             "download_url": "http://x/mp4"}
_VTT_FULL = _VTT + "\n2\n00:59:00.000 --> 00:59:04.000\nThat's the close, see you tomorrow.\n"


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
    # Keep orchestration tests hermetic: the recap polish is a real LLM call
    # (default ON in prod). Polish-specific tests re-enable + stub it.
    monkeypatch.setenv("DESK_RECAP_POLISH", "0")


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
        _MP4_HOUR,
        {"file_type": "TRANSCRIPT", "recording_type": "audio_transcript", "status": "completed",
         "download_url": "http://x/vtt"},
    ]}
    zoom = _FakeZoom(rec, {"http://x/summary": _SUMMARY_JSON, "http://x/vtt": _VTT_FULL})

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


# ---------------------------------------------------------------------------
# 2026-08-28 — DESK_TICKER_MOMENTS_ENABLED: lets the main Zoom-path ticker call
# be turned off (e.g. once a local subscription-backed script takes over
# ticker-moments + polish, to stop the Railway pod's own Anthropic spend).
# Default ON — existing behavior unchanged until an operator opts out.
# ---------------------------------------------------------------------------

def test_ticker_moments_enabled_default_on(monkeypatch):
    monkeypatch.delenv("DESK_TICKER_MOMENTS_ENABLED", raising=False)
    assert si._ticker_moments_enabled()
    monkeypatch.setenv("DESK_TICKER_MOMENTS_ENABLED", "0")
    assert not si._ticker_moments_enabled()


def test_ticker_moments_disabled_flag_skips_the_call(edu_db, chapters_enabled, monkeypatch):
    # generate_ticker_moments's call site already swallows ANY exception
    # (best-effort ticker moments), so a raiser would pass whether or not the
    # flag actually gated the call -- must use a call-counting spy instead to
    # prove the function was never invoked (lesson_mutation_harness_needs_a_control).
    #
    # Also must disable the ticker-BACKFILL stage (DESK_CHAPTERS_TICKER_BACKFILL)
    # in the same pass -- it runs after the main path in the same
    # process_pending_session_insights() call and treats "chapters exist but
    # ticker_moments is empty" (exactly what this flag now produces) as its
    # own work to do, immediately re-calling generate_ticker_moments via the
    # SAME Anthropic path this flag exists to turn off. A real deployment
    # MUST flip both flags together or the backfill silently undoes this one.
    monkeypatch.setenv("DESK_TICKER_MOMENTS_ENABLED", "0")
    monkeypatch.setenv("DESK_CHAPTERS_TICKER_BACKFILL", "0")

    calls = []
    def spy(title, cues):
        calls.append(1)
        return [{"ticker": "NVDA", "t": 1, "note": ""}]
    monkeypatch.setattr(si, "generate_ticker_moments", spy)

    v = _seed_session_video()
    rec = {"recording_files": [
        {"file_type": "SUMMARY", "recording_type": "summary", "download_url": "http://x/summary"},
        _MP4_HOUR,
        {"file_type": "TRANSCRIPT", "recording_type": "audio_transcript", "status": "completed",
         "download_url": "http://x/vtt"},
    ]}
    zoom = _FakeZoom(rec, {"http://x/summary": _SUMMARY_JSON, "http://x/vtt": _VTT_FULL})

    out = si.process_pending_session_insights(zoom=zoom)

    assert calls == []   # the actual proof: never invoked
    # Chapters/headline still land free from Zoom -- only the ticker call is skipped.
    assert any(r.get("action") == "generated" and r.get("source") == "zoom" for r in out)
    row = edu.get_video(v["id"])
    assert json.loads(row["ticker_moments"] or "[]") == []
    assert json.loads(row["chapters"]) == [
        {"t": 0, "title": "Open & Game Plan"},
        {"t": 300, "title": "NVDA Setup"},
    ]


def test_ticker_moments_off_without_backfill_off_still_calls_the_api(
        edu_db, chapters_enabled, monkeypatch):
    """The trap itself, pinned as a regression guard: DESK_TICKER_MOMENTS_ENABLED=0
    ALONE does not stop Anthropic spend -- the ticker-backfill stage (default
    ON) picks up the now-empty ticker_moments in the SAME pass and calls
    generate_ticker_moments anyway. Both flags must be set together."""
    monkeypatch.setenv("DESK_TICKER_MOMENTS_ENABLED", "0")
    monkeypatch.delenv("DESK_CHAPTERS_TICKER_BACKFILL", raising=False)  # stays default ON

    calls = []
    def spy(title, cues):
        calls.append(1)
        return [{"ticker": "NVDA", "t": 1, "note": ""}]
    monkeypatch.setattr(si, "generate_ticker_moments", spy)

    v = _seed_session_video()
    rec = {"recording_files": [
        {"file_type": "SUMMARY", "recording_type": "summary", "download_url": "http://x/summary"},
        _MP4_HOUR,
        {"file_type": "TRANSCRIPT", "recording_type": "audio_transcript", "status": "completed",
         "download_url": "http://x/vtt"},
    ]}
    zoom = _FakeZoom(rec, {"http://x/summary": _SUMMARY_JSON, "http://x/vtt": _VTT_FULL})

    si.process_pending_session_insights(zoom=zoom)

    assert calls == [1]   # the backfill stage called it anyway -- the trap


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
        _MP4_HOUR,
        {"file_type": "TRANSCRIPT", "recording_type": "audio_transcript", "status": "completed",
         "download_url": "http://x/vtt"},
    ]}
    zoom = _FakeZoom(rec, {"http://x/summary": _SUMMARY_JSON, "http://x/vtt": _VTT_FULL})

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


def test_summary_only_young_video_waits_for_transcript_no_trash(edu_db, chapters_enabled, monkeypatch):
    """Summary file has usable chapters but the transcript VTT hasn't landed
    yet (Zoom generates it asynchronously) and the video is still young —
    must NOT store insights, trash the recording, or stamp zoom_cleaned/
    insights_at. Regression guard for the bug where a transcript-less
    Zoom-summary insight got stored + the recording trashed immediately,
    permanently losing the transcript (zoom_cleaned=1 blocks re-entry into
    videos_pending_insights; transcript IS NULL blocks the ticker-backfill)."""
    v = _seed_session_video(title="Live Trading Session — July 1, 2026", meeting_uuid="UUIDW1")
    rec = {"recording_files": [
        {"file_type": "SUMMARY", "recording_type": "summary", "download_url": "http://x/summary"},
        # NO transcript file yet.
    ]}
    zoom = _FakeZoom(rec, {"http://x/summary": _SUMMARY_JSON})

    out = si.process_pending_session_insights(zoom=zoom)

    matches = [r for r in out if r.get("id") == v["id"]]
    assert len(matches) == 1
    assert matches[0]["action"] == "waiting_transcript_have_summary"

    row = edu.get_video(v["id"])
    assert (row["chapters"] or "").strip() in ("", "[]")
    assert row["insights_at"] is None
    assert not row["zoom_cleaned"]
    assert zoom.deleted == []  # recording NOT trashed


def test_summary_only_expired_wait_stores_zoom_insights_and_keeps_the_recording(
        edu_db, chapters_enabled, monkeypatch, pages):
    """Same shape (summary chapters, transcript still absent) with the video past
    DESK_SESSION_TRANSCRIPT_MAX_WAIT_HRS: the Zoom-derived insights are stored, but
    the recording is KEPT.

    ⚰️ This test used to assert `zoom.deleted == ["UUIDW2"]` and `zoom_cleaned == 1` —
    a delete of the only copy of a session with NO transcript at all. CONTRACTS §8a.6a
    (owner, 2026-09-13) replaced the expiry backstop: "deletion is blocked only until
    store-and-verify succeeds", and an expiry is not a verification. It survived S-C's
    new guard only because its fixture had no media duration, so coverage came back
    `None` and the guard short-circuited (reviewer R2). The fixture now carries the
    published MP4, the guard can measure, and the assertion is the ruling's."""
    monkeypatch.setenv("DESK_SESSION_TRANSCRIPT_MAX_WAIT_HRS", "0")  # max_wait=0 -> already expired

    v = _seed_session_video(title="Live Trading Session — July 2, 2026", meeting_uuid="UUIDW2")
    rec = {"recording_files": [
        {"file_type": "SUMMARY", "recording_type": "summary", "download_url": "http://x/summary"},
        _MP4_HOUR,
        # still no transcript file.
    ]}
    zoom = _FakeZoom(rec, {"http://x/summary": _SUMMARY_JSON})

    out = si.process_pending_session_insights(zoom=zoom)

    assert any(r.get("id") == v["id"] and r.get("action") == "generated" and r.get("source") == "zoom"
               for r in out)
    row = edu.get_video(v["id"])
    chapters = json.loads(row["chapters"])
    assert chapters == [
        {"t": 0, "title": "Open & Game Plan"},
        {"t": 300, "title": "NVDA Setup"},
    ]
    assert row["transcript"] is None
    assert json.loads(row["ticker_moments"]) == []
    # ⛔ The ruling's half: insights stored, recording KEPT, owner paged.
    assert zoom.deleted == []
    assert not row["zoom_cleaned"]
    assert any(r.get("id") == v["id"] and r.get("action") == "trash_refused" for r in out)
    assert pages == [(f"desk_transcript_coverage:{v['id']}", "critical")]


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


def test_salvage_truncated_json_recovers_leading_objects():
    raw = ('{"ticker_moments": [{"t": 1, "ticker": "AAPL"}, '
           '{"t": 50, "ticker": "NVDA"}, {"t": 99, "tic')
    import json as _json
    data = _json.loads(si._salvage_truncated_json(raw))
    assert data["ticker_moments"] == [
        {"t": 1, "ticker": "AAPL"}, {"t": 50, "ticker": "NVDA"}]


# ── Recap polish ─────────────────────────────────────────────────────────────────

def test_recap_polish_enabled_default_on(monkeypatch):
    monkeypatch.delenv("DESK_RECAP_POLISH", raising=False)
    assert si._recap_polish_enabled()
    monkeypatch.setenv("DESK_RECAP_POLISH", "0")
    assert not si._recap_polish_enabled()


def test_recap_model_defaults_to_opus():
    assert "opus" in si._RECAP_MODEL


# ── _merge_chapter_titles (2026-08-27: polish-pass chapter-title rewrites) ───────
#
# Zoom's own AI Companion writes the raw chapter titles on the common (free)
# path, and they're often generic/verbose — the polish pass can punch them up,
# but ORDER and TIMESTAMPS must always come from the ORIGINAL chapters. An
# override only ever replaces a title; it can never add, drop, reorder, or
# retime a chapter.

def test_merge_chapter_titles_applies_a_valid_override():
    original = [{"t": 0, "title": "Open & Game Plan"}]
    merged = si._merge_chapter_titles(original, [{"t": 0, "title": "MU: game plan"}])
    assert merged == [{"t": 0, "title": "MU: game plan"}]


def test_merge_chapter_titles_ignores_an_override_with_no_matching_original_timestamp():
    original = [{"t": 0, "title": "Open & Game Plan"}]
    # t=999 was never in the original chapters — an invented/shifted timestamp.
    merged = si._merge_chapter_titles(original, [{"t": 999, "title": "Invented"}])
    assert merged == original


def test_merge_chapter_titles_keeps_original_when_overrides_is_none_or_empty():
    original = [{"t": 0, "title": "Open"}, {"t": 60, "title": "NVDA Setup"}]
    assert si._merge_chapter_titles(original, None) == original
    assert si._merge_chapter_titles(original, []) == original


def test_merge_chapter_titles_never_reorders_or_drops_originals():
    original = [{"t": 0, "title": "A"}, {"t": 60, "title": "B"}, {"t": 120, "title": "C"}]
    # Only override the middle one; A and C must survive untouched, in order.
    merged = si._merge_chapter_titles(original, [{"t": 60, "title": "B2"}])
    assert [c["t"] for c in merged] == [0, 60, 120]
    assert merged[0]["title"] == "A"
    assert merged[1]["title"] == "B2"
    assert merged[2]["title"] == "C"


def test_merge_chapter_titles_dedupes_multiple_overrides_for_the_same_timestamp():
    original = [{"t": 0, "title": "Open"}]
    merged = si._merge_chapter_titles(
        original, [{"t": 0, "title": "First"}, {"t": 0, "title": "Second"}])
    assert merged == [{"t": 0, "title": "First"}]


def test_merge_chapter_titles_ignores_a_blank_override_title():
    original = [{"t": 0, "title": "Open"}]
    merged = si._merge_chapter_titles(original, [{"t": 0, "title": "   "}])
    assert merged == original


# ── polish_recap chapter-title rewrites ───────────────────────────────────────────

def _polish_client(monkeypatch, response_json):
    from api.services import engine

    class _Block:
        text = response_json

    class _Msg:
        content = [_Block()]

    class _Messages:
        @staticmethod
        def create(**kw):
            return _Msg()

    class _Client:
        messages = _Messages()

        def with_options(self, **kw):
            return self

    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: _Client())


def test_polish_recap_includes_validated_chapter_overrides(monkeypatch):
    _polish_client(monkeypatch, json.dumps({
        "headline": "h", "summary": ["s1.", "s2.", "s3."],
        "chapters": [{"t": 0, "title": "MU: game plan"}],
    }))
    out = si.polish_recap("T", "old headline", ["old"], [{"t": 0, "title": "Open"}], [])
    assert out["chapters"] == [{"t": 0, "title": "MU: game plan"}]


def test_polish_recap_drops_a_chapter_override_with_an_invented_timestamp(monkeypatch):
    _polish_client(monkeypatch, json.dumps({
        "headline": "h", "summary": ["s1.", "s2.", "s3."],
        "chapters": [{"t": 999, "title": "Invented"}],
    }))
    out = si.polish_recap("T", "old headline", ["old"], [{"t": 0, "title": "Open"}], [])
    assert out["chapters"] == []


def test_polish_recap_chapters_defaults_to_empty_list_when_model_omits_it(monkeypatch):
    _polish_client(monkeypatch, json.dumps({"headline": "h", "summary": ["s1.", "s2.", "s3."]}))
    out = si.polish_recap("T", "old headline", ["old"], [{"t": 0, "title": "Open"}], [])
    assert out["chapters"] == []


def test_polish_recap_chapter_overrides_are_length_cleaned(monkeypatch):
    long_title = "Marvell earnings tonight concern worst-case semi gap-down cascade and software risk"
    _polish_client(monkeypatch, json.dumps({
        "headline": "h", "summary": ["s1.", "s2.", "s3."],
        "chapters": [{"t": 0, "title": long_title}],
    }))
    out = si.polish_recap("T", "old headline", ["old"], [{"t": 0, "title": "Open"}], [])
    assert out["chapters"][0]["title"].endswith("…")
    assert long_title.startswith(out["chapters"][0]["title"][:-1])


def test_sampled_excerpt_bounded_and_spans_session():
    cues = [{"t": i * 30, "text": f"minute {i} " + "talk " * 20} for i in range(500)]
    out = si._sampled_excerpt(cues, max_chars=5_000)
    assert 0 < len(out) <= 5_000
    lines = out.split("\n")
    # Spans the session, not just the head: last sampled cue is deep in.
    assert lines[0].startswith("[0:00]")
    parts = [int(p) for p in lines[-1].split("]")[0].lstrip("[").split(":")]
    last_t = (parts[0] * 3600 + parts[1] * 60 + parts[2]) if len(parts) == 3 \
        else (parts[0] * 60 + parts[1])
    assert last_t > 500 * 30 * 0.5


def test_zoom_path_applies_polish_when_enabled(edu_db, chapters_enabled, monkeypatch):
    monkeypatch.setenv("DESK_RECAP_POLISH", "1")
    monkeypatch.setattr(si, "generate_ticker_moments", lambda title, cues: [])
    monkeypatch.setattr(si, "polish_recap",
                        lambda title, headline, summary, chapters, cues: {
                            "headline": "NVDA led a broad-tape reversal.",
                            "summary": ["b1.", "b2.", "b3."]})

    v = _seed_session_video(title="Live Trading Session — July 7, 2026", meeting_uuid="UUIDP1")
    rec = {"recording_files": [
        {"file_type": "SUMMARY", "recording_type": "summary", "download_url": "http://x/summary"},
        _MP4_HOUR,
        {"file_type": "TRANSCRIPT", "recording_type": "audio_transcript", "status": "completed",
         "download_url": "http://x/vtt"},
    ]}
    zoom = _FakeZoom(rec, {"http://x/summary": _SUMMARY_JSON, "http://x/vtt": _VTT_FULL})

    out = si.process_pending_session_insights(zoom=zoom)

    assert any(r.get("action") == "generated" and r.get("source") == "zoom+polish" for r in out)
    row = edu.get_video(v["id"])
    assert row["headline"] == "NVDA led a broad-tape reversal."
    assert json.loads(row["summary"]) == ["b1.", "b2.", "b3."]
    # This mock's polish_recap doesn't return a "chapters" key at all — same
    # shape as an older polish response — so Zoom's chapters pass through
    # completely untouched (regression guard: omitting the key must never
    # KeyError, and must never accidentally drop/reorder chapters).
    assert len(json.loads(row["chapters"])) == 2
    assert zoom.deleted == ["UUIDP1"]


def test_zoom_path_polish_rewrites_chapter_titles_when_provided(edu_db, chapters_enabled, monkeypatch):
    monkeypatch.setenv("DESK_RECAP_POLISH", "1")
    monkeypatch.setattr(si, "generate_ticker_moments", lambda title, cues: [])
    monkeypatch.setattr(si, "polish_recap",
                        lambda title, headline, summary, chapters, cues: {
                            "headline": "NVDA led a broad-tape reversal.",
                            "summary": ["b1.", "b2.", "b3."],
                            # Only the FIRST of Zoom's 2 real chapters gets an
                            # override — the second must survive untouched.
                            "chapters": [{"t": 0, "title": "Open: game plan"}]})

    v = _seed_session_video(title="Live Trading Session — July 9, 2026", meeting_uuid="UUIDP3")
    rec = {"recording_files": [
        {"file_type": "SUMMARY", "recording_type": "summary", "download_url": "http://x/summary"},
        _MP4_HOUR,
        {"file_type": "TRANSCRIPT", "recording_type": "audio_transcript", "status": "completed",
         "download_url": "http://x/vtt"},
    ]}
    zoom = _FakeZoom(rec, {"http://x/summary": _SUMMARY_JSON, "http://x/vtt": _VTT_FULL})

    si.process_pending_session_insights(zoom=zoom)

    row = edu.get_video(v["id"])
    chapters = json.loads(row["chapters"])
    assert chapters == [
        {"t": 0, "title": "Open: game plan"},   # polished
        {"t": 300, "title": "NVDA Setup"},      # Zoom's original, untouched
    ]


def test_zoom_path_polish_failure_keeps_zoom_text(edu_db, chapters_enabled, monkeypatch):
    monkeypatch.setenv("DESK_RECAP_POLISH", "1")
    monkeypatch.setattr(si, "generate_ticker_moments", lambda title, cues: [])
    monkeypatch.setattr(si, "polish_recap",
                        lambda *a: (_ for _ in ()).throw(RuntimeError("billing boom")))

    v = _seed_session_video(title="Live Trading Session — July 8, 2026", meeting_uuid="UUIDP2")
    rec = {"recording_files": [
        {"file_type": "SUMMARY", "recording_type": "summary", "download_url": "http://x/summary"},
        _MP4_HOUR,
        {"file_type": "TRANSCRIPT", "recording_type": "audio_transcript", "status": "completed",
         "download_url": "http://x/vtt"},
    ]}
    zoom = _FakeZoom(rec, {"http://x/summary": _SUMMARY_JSON, "http://x/vtt": _VTT_FULL})

    out = si.process_pending_session_insights(zoom=zoom)

    assert any(r.get("action") == "generated" and r.get("source") == "zoom" for r in out)
    row = edu.get_video(v["id"])
    assert row["headline"] == "Traders reviewed NVDA momentum and the broader tape."
    assert zoom.deleted == ["UUIDP2"]  # polish failure never blocks publish/trash


def test_repolish_video_updates_recap_and_poster(edu_db, monkeypatch):
    monkeypatch.setattr(si, "polish_recap",
                        lambda title, headline, summary, chapters, cues: {
                            "headline": "Polished headline.",
                            "summary": ["p1.", "p2.", "p3.", "p4."]})
    v = _seed_session_video(title="Live Trading Session — July 7, 2026", meeting_uuid="UUIDR1")
    edu.set_video_insights(
        v["id"], transcript="[0:05] MBIS holding support here.",
        chapters=[{"t": 0, "title": "Open"}],
        ticker_moments=[{"ticker": "MBIS", "t": 5, "note": ""}],
        headline="Patrick and Uncharted discussed stock market performa",
        summary=["Truncated old bullet abou"])

    out = si.repolish_video(v["id"])

    assert out["headline"] == "Polished headline."
    row = edu.get_video(v["id"])
    assert row["headline"] == "Polished headline."
    assert json.loads(row["summary"]) == ["p1.", "p2.", "p3.", "p4."]
    from api.services import desk_recap_poster
    assert os.path.exists(desk_recap_poster.poster_path(v["id"]))
    assert row["poster"] == 1


def test_repolish_video_also_updates_chapter_titles_when_provided(edu_db, monkeypatch):
    # repolish_video is the admin re-run tool for ALREADY-PUBLISHED videos
    # (the Zoom recording is long gone) — it must be able to fix a past
    # session's generic Zoom chapter titles too, not just headline/summary.
    monkeypatch.setattr(si, "polish_recap",
                        lambda title, headline, summary, chapters, cues: {
                            "headline": "Polished headline.",
                            "summary": ["p1.", "p2.", "p3.", "p4."],
                            "chapters": [{"t": 0, "title": "MU: game plan"}]})
    v = _seed_session_video(title="Live Trading Session — July 7, 2026", meeting_uuid="UUIDR3")
    edu.set_video_insights(
        v["id"], transcript="[0:05] MBIS holding support here.",
        chapters=[{"t": 0, "title": "Open & Game Plan Discussion Segment"},
                  {"t": 60, "title": "Q&A"}],
        ticker_moments=[{"ticker": "MBIS", "t": 5, "note": ""}],
        headline="Patrick and Uncharted discussed stock market performa",
        summary=["Truncated old bullet abou"])

    si.repolish_video(v["id"])

    row = edu.get_video(v["id"])
    chapters = json.loads(row["chapters"])
    assert chapters == [{"t": 0, "title": "MU: game plan"}, {"t": 60, "title": "Q&A"}]


def test_repolish_video_unknown_or_empty_raises(edu_db, monkeypatch):
    with pytest.raises(ValueError):
        si.repolish_video(999999)
    v = _seed_session_video(title="Live Trading Session — July 6, 2026", meeting_uuid="UUIDR2")
    with pytest.raises(ValueError):
        si.repolish_video(v["id"])  # nothing stored to polish yet


def test_salvage_truncated_json_nothing_usable():
    assert si._salvage_truncated_json('{"ticker_moments": [{"t": 1, "tick') == ""


# ── Observability: recent-passes ring buffer + per-video fail streaks ───────────

class _AlwaysRaiseZoom:
    """Every call to get_recording_files raises — simulates a video whose pass
    keeps failing (e.g. a Zoom auth/network hiccup) so the fail-streak counter
    climbs on every call to process_pending_session_insights."""
    def get_recording_files(self, uuid):
        raise RuntimeError("zoom boom")


@pytest.fixture
def clean_observability_state():
    si._RECENT_PASSES.clear()
    si._FAIL_STREAKS.clear()
    yield
    si._RECENT_PASSES.clear()
    si._FAIL_STREAKS.clear()


def test_recent_passes_ring_buffer_bounded_at_12(edu_db, chapters_enabled, clean_observability_state):
    # No pending videos at all -> each pass is a cheap no-op, purely exercising
    # the ring buffer's maxlen.
    for _ in range(15):
        si.process_pending_session_insights(zoom=None)
    assert len(si._RECENT_PASSES) == 12
    last = si._RECENT_PASSES[-1]
    assert set(last.keys()) == {"ts", "results", "errors"}


def test_pass_records_per_video_error(edu_db, chapters_enabled, clean_observability_state):
    v = _seed_session_video(title="Live Trading Session — Err Day", meeting_uuid="ERR1")
    si.process_pending_session_insights(zoom=_AlwaysRaiseZoom())
    assert len(si._RECENT_PASSES) == 1
    errors = si._RECENT_PASSES[-1]["errors"]
    assert len(errors) == 1
    assert errors[0]["id"] == v["id"]
    assert "zoom boom" in errors[0]["error"]


def test_fail_streak_alert_fires_exactly_once_at_4(edu_db, chapters_enabled,
                                                    clean_observability_state, monkeypatch):
    from api.services import discord_notify
    calls = []
    monkeypatch.setattr(discord_notify, "_send_webhook", lambda embed: calls.append(embed))

    v = _seed_session_video(title="Live Trading Session — Streak Day", meeting_uuid="ERR2")
    zoom = _AlwaysRaiseZoom()

    for _ in range(3):
        si.process_pending_session_insights(zoom=zoom)
    assert calls == []  # not yet at the threshold
    assert si._FAIL_STREAKS[v["id"]] == 3

    si.process_pending_session_insights(zoom=zoom)  # 4th consecutive failure
    assert len(calls) == 1
    assert "failing repeatedly" in calls[0]["title"]

    si.process_pending_session_insights(zoom=zoom)  # 5th — must NOT re-fire
    assert len(calls) == 1


def test_fail_streak_resets_on_success_skip_path(edu_db, chapters_enabled,
                                                  clean_observability_state, monkeypatch):
    """Consecutive-failure semantics: a video that fails twice, then succeeds
    (recording_gone is a legitimate skip path, not a failure), must have its
    streak cleared — so two MORE failures afterward do not trip the alert."""
    from api.services import discord_notify
    calls = []
    monkeypatch.setattr(discord_notify, "_send_webhook", lambda embed: calls.append(embed))

    v = _seed_session_video(title="Live Trading Session — Reset Day", meeting_uuid="ERR3")

    for _ in range(2):
        si.process_pending_session_insights(zoom=_AlwaysRaiseZoom())
    assert si._FAIL_STREAKS[v["id"]] == 2

    class _GoneZoom:
        def get_recording_files(self, uuid):
            return None  # recording already gone -> success/skip path

    si.process_pending_session_insights(zoom=_GoneZoom())
    assert v["id"] not in si._FAIL_STREAKS

    # Re-seed a fresh pending video (the prior one is now zoom_cleaned) and
    # fail it twice more — still below threshold since the streak reset.
    v2 = _seed_session_video(title="Live Trading Session — Reset Day 2", meeting_uuid="ERR4")
    for _ in range(2):
        si.process_pending_session_insights(zoom=_AlwaysRaiseZoom())
    assert calls == []
    assert si._FAIL_STREAKS[v2["id"]] == 2


def test_get_insights_status_shape(edu_db, chapters_enabled, clean_observability_state):
    v = _seed_session_video(title="Live Trading Session — Status Day", meeting_uuid="STAT1")
    si.process_pending_session_insights(zoom=_AlwaysRaiseZoom())

    status = si.get_insights_status()
    assert set(status.keys()) == {"pending", "recent_passes", "fail_streaks"}
    assert status["pending"] == [{"id": v["id"], "title": v["title"]}]
    assert len(status["recent_passes"]) == 1
    assert status["fail_streaks"] == {v["id"]: 1}


def test_generate_ticker_moments_budget_and_salvage(monkeypatch):
    """Regression 2026-07-02: max_tokens=800 truncated long sessions mid-JSON,
    silently killing every big video's chips. Pin the bigger budget AND the
    salvage path for any residual truncation."""
    from api.services import engine

    captured = {}

    class _Block:
        text = ('{"ticker_moments": [{"t": 5, "ticker": "SPY"}, '
                '{"t": 60, "ticker": "QQQ"}, {"t": 90, "tic')

    class _Msg:
        content = [_Block()]

    class _Messages:
        @staticmethod
        def create(**kw):
            captured.update(kw)
            return _Msg()

    class _Client:
        messages = _Messages()

        def with_options(self, **kw):
            return self

    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: _Client())
    out = si.generate_ticker_moments("Title", [{"t": 5, "text": "hello"}])
    assert captured.get("max_tokens", 0) >= 2000
    # Regression 2026-07-02 #2: Sonnet 5 defaults to adaptive thinking when the
    # field is omitted; on long transcripts thinking consumed the ENTIRE
    # max_tokens budget (stop_reason=max_tokens, zero text). Pin it disabled.
    assert captured.get("thinking") == {"type": "disabled"}
    assert [m["ticker"] for m in out] == ["SPY", "QQQ"]


def test_ticker_backfill_failures_feed_observability(monkeypatch):
    """A silently-failing backfill looked identical to an idle one — its
    exceptions must land in the pass errors + fail streaks like the main pass."""
    monkeypatch.setattr(
        si.education_service, "videos_missing_ticker_moments",
        lambda window, limit: [{"id": 42, "title": "Big Session",
                                "transcript": "[0:00:05] hello"}],
    )
    monkeypatch.setattr(
        si, "generate_ticker_moments",
        lambda title, cues: (_ for _ in ()).throw(RuntimeError("llm exploded")),
    )
    si._FAIL_STREAKS.clear()
    results, errors = [], []
    si._run_ticker_backfill(results, errors)
    assert results == []
    assert errors and errors[0]["id"] == 42
    assert "ticker_backfill" in errors[0]["error"]
    assert si._FAIL_STREAKS.get(42) == 1


# ── Ticker-chip quality guard: range filter, dedup, model override ──────────────

def _stub_ticker_client(monkeypatch, moments, captured=None):
    from api.services import engine
    captured = captured if captured is not None else {}

    class _Block:
        text = json.dumps({"ticker_moments": moments})

    class _Msg:
        content = [_Block()]

    class _Messages:
        @staticmethod
        def create(**kw):
            captured.update(kw)
            return _Msg()

    class _Client:
        messages = _Messages()

        def with_options(self, **kw):
            return self

    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: _Client())
    return captured


def test_ticker_model_defaults_to_sonnet():
    assert si._TICKER_MODEL == "claude-sonnet-5"
    assert si._TICKER_MODEL != si._MODEL  # chapters-fallback stays haiku, independent knob


def test_generate_ticker_moments_uses_ticker_model(monkeypatch):
    captured = _stub_ticker_client(monkeypatch, [{"t": 1, "ticker": "AAPL"}])
    monkeypatch.setattr(si, "_TICKER_MODEL", "claude-sonnet-custom")
    si.generate_ticker_moments("Title", [{"t": 5, "text": "hello"}])
    assert captured.get("model") == "claude-sonnet-custom"


def test_generate_ticker_moments_filters_timestamps_beyond_video_end(monkeypatch):
    """Audit evidence: chips appeared at timestamps BEYOND the video's end
    (extrapolated by the model). Anything past the last transcript marker
    (+60s grace for a mention right at the tail) must be dropped."""
    cues = [{"t": 0, "text": "open"}, {"t": 100, "text": "close"}]  # max_t = 100
    _stub_ticker_client(monkeypatch, [
        {"t": 50, "ticker": "AAPL"},    # in range
        {"t": 150, "ticker": "NVDA"},   # in the +60s grace window (<=160)
        {"t": 400, "ticker": "TSLA"},   # way beyond the end -> dropped
    ])
    out = si.generate_ticker_moments("Title", cues)
    assert [m["ticker"] for m in out] == ["AAPL", "NVDA"]


def test_generate_ticker_moments_dedups_exact_t_and_ticker(monkeypatch):
    cues = [{"t": 0, "text": "open"}, {"t": 200, "text": "close"}]
    _stub_ticker_client(monkeypatch, [
        {"t": 30, "ticker": "AAPL"},
        {"t": 30, "ticker": "AAPL"},   # exact duplicate -> dropped
        {"t": 30, "ticker": "MSFT"},   # same t, different ticker -> kept
    ])
    out = si.generate_ticker_moments("Title", cues)
    pairs = [(m["t"], m["ticker"]) for m in out]
    assert pairs == [(30, "AAPL"), (30, "MSFT")]


def test_generate_ticker_moments_max_t_verifies_order_not_just_last_cue():
    """Cues are DOCUMENTED as time-ordered — don't blindly trust cues[-1]['t'];
    verify the ordering and fall back to max() when it's violated."""
    unordered = [{"t": 500, "text": "a"}, {"t": 10, "text": "b"}]  # last element is NOT the max
    assert si._max_cue_t(unordered) == 500
    ordered = [{"t": 10, "text": "a"}, {"t": 500, "text": "b"}]
    assert si._max_cue_t(ordered) == 500
    assert si._max_cue_t([]) == 0


# ── Phase 4D-4C.3: durable media-time provenance ─────────────────────────────────

from api.services.zoom_client import select_largest_mp4  # noqa: E402


def test_select_largest_mp4_prefers_biggest_file_size():
    files = [
        {"file_type": "MP4", "download_url": "http://a", "file_size": 100, "id": "small"},
        {"file_type": "MP4", "download_url": "http://b", "file_size": 9999, "id": "big"},
        {"file_type": "TRANSCRIPT", "download_url": "http://c", "file_size": 50000},
    ]
    assert select_largest_mp4(files)["id"] == "big"


def test_select_largest_mp4_none_when_no_mp4():
    assert select_largest_mp4([{"file_type": "TRANSCRIPT", "download_url": "http://x"}]) is None
    assert select_largest_mp4(None) is None
    assert select_largest_mp4([]) is None


def test_capture_media_provenance_best_tier_uses_recording_file_start(edu_db):
    v = _seed_session_video()
    rec = {
        "start_time": "2026-06-24T13:30:00Z",  # meeting-level — must NOT win when file-level exists
        "recording_files": [
            {"file_type": "MP4", "download_url": "http://x/mp4", "file_size": 100,
             "id": "file-abc", "recording_start": "2026-06-24T13:30:07Z"},
        ],
    }
    si._capture_media_provenance(v["id"], "UUID1", rec)
    row = edu.get_video(v["id"])
    assert row["media_started_at"] == "2026-06-24T13:30:07Z"
    assert row["media_started_at_source"] == "zoom_recording_file"
    assert row["source_recording_file_id"] == "file-abc"


def test_capture_media_provenance_fallback_tier_uses_meeting_start(edu_db):
    v = _seed_session_video()
    rec = {
        "start_time": "2026-06-24T13:30:00Z",
        "recording_files": [
            # MP4 present but with NO recording_start of its own (a real gap Zoom can return)
            {"file_type": "MP4", "download_url": "http://x/mp4", "file_size": 100, "id": "file-abc"},
        ],
    }
    si._capture_media_provenance(v["id"], "UUID1", rec)
    row = edu.get_video(v["id"])
    assert row["media_started_at"] == "2026-06-24T13:30:00Z"
    assert row["media_started_at_source"] == "zoom_meeting_start"
    assert row["source_recording_file_id"] is None


def test_capture_media_provenance_recovered_tier_when_recording_already_gone(edu_db, monkeypatch, tmp_path):
    from api.services import desk_session_jobs as jobs
    monkeypatch.setattr(jobs, "_DB_PATH", str(tmp_path / "jobs.db"))
    jobs._init_db()
    jobs.enqueue("UUID1", "Live Trading", "2026-06-24T13:30:00Z", "http://dl", "tok")

    v = _seed_session_video()
    si._capture_media_provenance(v["id"], "UUID1", None)  # rec is None: recording already trashed
    row = edu.get_video(v["id"])
    assert row["media_started_at"] == "2026-06-24T13:30:00Z"
    assert row["media_started_at_source"] == "recovered_job_metadata"


def test_capture_media_provenance_unknown_when_nothing_available(edu_db, monkeypatch, tmp_path):
    from api.services import desk_session_jobs as jobs
    monkeypatch.setattr(jobs, "_DB_PATH", str(tmp_path / "jobs.db"))
    jobs._init_db()  # empty — no job row for this uuid at all

    v = _seed_session_video()
    si._capture_media_provenance(v["id"], "UUID1", None)
    row = edu.get_video(v["id"])
    assert row["media_started_at"] is None
    assert row["media_started_at_source"] is None


def test_capture_media_provenance_never_raises_on_a_malformed_rec(edu_db):
    v = _seed_session_video()
    si._capture_media_provenance(v["id"], "UUID1", {"recording_files": "not-a-list"})  # must not raise
    row = edu.get_video(v["id"])
    assert row["media_started_at"] is None


def test_capture_media_provenance_wired_into_run_one_pending(edu_db, chapters_enabled, monkeypatch):
    """The real orchestration entry point (process_pending_session_insights,
    which re-fetches rows from the DB — unlike calling _run_one_pending
    directly with a stale pre-set_meeting_uuid dict) captures provenance even
    on the recording_gone early-return branch — not just the happy path."""
    from api.services import desk_session_jobs as jobs
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(jobs, "_DB_PATH", os.path.join(d, "jobs.db"))
        jobs._init_db()
        jobs.enqueue("UUID1", "Live Trading", "2026-06-24T13:30:00Z", "http://dl", "tok")

        v = _seed_session_video()
        zoom = _FakeZoom(None, {})  # recording already gone
        out = si.process_pending_session_insights(zoom=zoom)
        assert any(r.get("action") == "recording_gone" for r in out)
        row = edu.get_video(v["id"])
        assert row["media_started_at"] == "2026-06-24T13:30:00Z"
        assert row["media_started_at_source"] == "recovered_job_metadata"
        assert row["zoom_cleaned"] == 1  # unaffected — provenance capture never blocks this


# ═════════════════════════════════════════════════════════════════════════════
# 2026-09-13 — Wisdom Loop W1 §2.2: the 356 truncation.
# docs/wisdom/methodology/zoom-356-root-cause.md
#
# WHAT THESE TESTS HAVE TO BE ABLE TO SAY RED FOR
#   1. a transcript chosen by LIST ORDER instead of by pairing to the published MP4;
#   2. a Zoom recording trashed while the stored transcript covers < 98% of it;
#   3. a trash that happens before every raw VTT + the metadata JSON is in R2;
#   4. a kill switch that does not actually switch (each has a control).
# ═════════════════════════════════════════════════════════════════════════════

from api.services.wisdom.core import ids as wisdom_ids  # noqa: E402


def _vtt_of(*cues):
    lines = ["WEBVTT", ""]
    for i, (s, text) in enumerate(cues, 1):
        e = s + 3
        lines += [str(i),
                  f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}.000 --> "
                  f"{e // 3600:02d}:{(e % 3600) // 60:02d}:{e % 60:02d}.000",
                  text, ""]
    return "\n".join(lines)


def _rfile(ftype, fid, start, end, url, size=None, rtype=None):
    f = {"file_type": ftype, "id": fid, "recording_start": start, "recording_end": end,
         "download_url": url, "status": "completed"}
    if size is not None:
        f["file_size"] = size
    if rtype:
        f["recording_type"] = rtype
    return f


# The 356 shape: a stop/restart inside ONE meeting. A 345 s first segment is listed
# FIRST; the published (largest) MP4 is the second, 6,830 s segment.
_SHORT = ("2026-09-11T13:00:00Z", "2026-09-11T13:05:45Z")   # 345 s
_LONG = ("2026-09-11T13:07:00Z", "2026-09-11T15:00:50Z")    # 6,830 s
_VTT_SHORT = _vtt_of((5, "short segment opening"), (345, "short segment last words"))
_VTT_LONG = _vtt_of((2, "long segment opening"), (3400, "middle of the workshop"), (6800, "closing words"))


def _rec_356(extra=None):
    files = [
        {"file_type": "SUMMARY", "recording_type": "summary", "download_url": "http://x/summary"},
        _rfile("MP4", "mp4-short", *_SHORT, "http://x/mp4-short", size=10),
        _rfile("TRANSCRIPT", "vtt-short", *_SHORT, "http://x/vtt-short", rtype="audio_transcript"),
        _rfile("MP4", "mp4-long", *_LONG, "http://x/mp4-long", size=999),
        _rfile("TRANSCRIPT", "vtt-long", *_LONG, "http://x/vtt-long", rtype="audio_transcript"),
    ]
    return {"uuid": "K02BCIBPQTKxm51v+d7inQ==", "password": "hunter2", "recording_files": files + (extra or [])}


_DL_356 = {"http://x/summary": _SUMMARY_JSON, "http://x/vtt-short": _VTT_SHORT, "http://x/vtt-long": _VTT_LONG}


@pytest.fixture
def pages(monkeypatch):
    from api.services import chart_health_alerts

    sent = []
    monkeypatch.setattr(chart_health_alerts, "emit",
                        lambda key, severity, message, metadata=None: sent.append((key, severity)) or True)
    return sent


@pytest.fixture
def no_llm(monkeypatch):
    monkeypatch.setattr(si, "generate_ticker_moments", lambda title, cues: [])
    monkeypatch.setattr(si, "generate_setups", lambda title, cues: [])


def _stored_max_t(vid):
    cues = edu.get_transcript_cues(vid)
    return max(c["t"] for c in cues) if cues else None


def test_the_356_bug_first_in_list_transcript_is_the_short_segment():
    """Documents the defect: the old selector returns the FIRST transcript — the
    345 s segment — while the published MP4 is the 6,830 s one."""
    rec = _rec_356()
    assert si._find_transcript_file(rec)["id"] == "vtt-short"
    assert si.select_largest_mp4(rec["recording_files"])["id"] == "mp4-long"


def test_the_transcript_is_paired_to_the_published_mp4_by_recording_window():
    plan = si.plan_transcript_for_mp4(_rec_356())
    assert plan["mode"] == "paired"
    assert [e["file"]["id"] for e in plan["files"]] == ["vtt-long"]
    assert plan["files"][0]["offset_s"] == 0
    assert plan["mp4_duration_s"] == 6830


def test_multi_transcript_regression_stores_the_full_transcript_and_trashes_once(
        edu_db, chapters_enabled, no_llm, fake_r2, pages):
    """THE regression test: the 356 recording shape end to end."""
    v = _seed_session_video(title="Workshop with Stockbee — September 11, 2026", meeting_uuid="UUID356")
    zoom = _FakeZoom(_rec_356(), _DL_356)

    out = si.process_pending_session_insights(zoom=zoom)

    assert any(r.get("id") == v["id"] and r.get("action") == "generated" for r in out)
    assert _stored_max_t(v["id"]) == 6800  # NOT 345
    assert si.transcript_coverage(edu.get_transcript_cues(v["id"]), 6830) >= si.COVERAGE_THRESHOLD
    assert zoom.deleted == ["UUID356"]
    assert pages == []
    prefix = f"wisdom/sources/zoom_vtt/{wisdom_ids.sha24('UUID356')}/"
    keys = sorted(fake_r2.objects)
    assert f"{prefix}vtt-short.vtt" in keys and f"{prefix}vtt-long.vtt" in keys
    assert any(k.startswith(f"{prefix}recording-") and k.endswith(".json") for k in keys)


def test_several_overlapping_transcripts_are_stitched_with_offsets_to_the_mp4_start():
    rec = {"recording_files": [
        _rfile("MP4", "mp4", "2026-09-11T13:00:00Z", "2026-09-11T15:00:00Z", "http://x/mp4", size=5),
        # listed out of time order on purpose
        _rfile("TRANSCRIPT", "part-b", "2026-09-11T14:00:00Z", "2026-09-11T15:00:00Z", "http://x/b"),
        _rfile("TRANSCRIPT", "part-a", "2026-09-11T13:00:00Z", "2026-09-11T14:00:00Z", "http://x/a"),
    ]}
    plan = si.plan_transcript_for_mp4(rec)
    assert plan["mode"] == "stitched"
    assert [(e["file"]["id"], e["offset_s"]) for e in plan["files"]] == [("part-a", 0), ("part-b", 3600)]
    texts = {"http://x/a": _vtt_of((10, "a1"), (3590, "a2")), "http://x/b": _vtt_of((5, "b1"), (3500, "b2"))}
    cues = si.build_paired_cues(plan, texts.__getitem__)
    assert [(c["t"], c["text"]) for c in cues] == [(10, "a1"), (3590, "a2"), (3605, "b1"), (7100, "b2")]
    assert si.transcript_coverage(cues, plan["mp4_duration_s"]) >= si.COVERAGE_THRESHOLD


def test_a_transcript_from_another_segment_is_never_used():
    rec = {"recording_files": [
        _rfile("MP4", "mp4-long", *_LONG, "http://x/mp4-long", size=999),
        _rfile("TRANSCRIPT", "vtt-short", *_SHORT, "http://x/vtt-short"),
    ]}
    plan = si.plan_transcript_for_mp4(rec)
    assert plan["mode"] == "no_overlap" and plan["files"] == []
    # control: with no timestamps anywhere the single file is still used
    untimed = {"recording_files": [{"file_type": "TRANSCRIPT", "download_url": "http://x/v", "status": "completed"}]}
    assert si.plan_transcript_for_mp4(untimed)["mode"] == "single_untimed"


def _seed_truncated_356(title="Workshop with Stockbee — September 11, 2026", uuid="UUIDTRAP"):
    v = _seed_session_video(title=title, meeting_uuid=uuid)
    edu.set_video_insights(v["id"],
                           transcript=si._timestamped_block([{"t": 5, "text": "a"}, {"t": 345, "text": "b"}]),
                           chapters=[{"t": 0, "title": "Open"}])
    return v


def test_the_guard_keeps_the_recording_while_coverage_is_below_98_percent(
        edu_db, chapters_enabled, no_llm, fake_r2, pages):
    v = _seed_truncated_356()
    rec = {"recording_files": [  # the published MP4, and NO transcript that overlaps it
        _rfile("MP4", "mp4-long", *_LONG, "http://x/mp4-long", size=999),
        _rfile("TRANSCRIPT", "vtt-short", *_SHORT, "http://x/vtt-short"),
    ]}
    zoom = _FakeZoom(rec, {"http://x/vtt-short": _VTT_SHORT})

    out = si.process_pending_session_insights(zoom=zoom)

    refused = [r for r in out if r.get("id") == v["id"] and r.get("action") == "trash_refused"]
    assert refused and refused[0]["reason"].startswith("coverage ")
    assert zoom.deleted == []
    row = edu.get_video(v["id"])
    assert not row["zoom_cleaned"] and row["insights_at"] is not None
    assert pages == [(f"desk_transcript_coverage:{v['id']}", "critical")]
    assert fake_r2.objects == {}  # nothing archived for a trash that did not happen
    # a second pass does not page again
    si.process_pending_session_insights(zoom=zoom)
    assert len(pages) == 1 and zoom.deleted == []


def test_control_the_coverage_kill_switch_is_what_refused(edu_db, chapters_enabled, no_llm, fake_r2, pages,
                                                          monkeypatch):
    monkeypatch.setenv("DESK_TRANSCRIPT_COVERAGE_GUARD_DISABLED", "1")
    v = _seed_truncated_356(uuid="UUIDOFF")
    rec = {"recording_files": [_rfile("MP4", "mp4-long", *_LONG, "http://x/mp4-long", size=999)]}
    zoom = _FakeZoom(rec, {})
    si.process_pending_session_insights(zoom=zoom)
    assert zoom.deleted == ["UUIDOFF"] and pages == []
    assert edu.get_video(v["id"])["zoom_cleaned"] == 1


def test_the_recovery_trap_repairs_from_the_paired_transcript_before_any_trash(
        edu_db, chapters_enabled, no_llm, fake_r2, pages):
    """A recovered recording whose row already has chapters and a 345 s transcript
    used to be trashed on the next pass without fetching anything."""
    v = _seed_truncated_356(uuid="UUIDREC")
    zoom = _FakeZoom(_rec_356(), _DL_356)

    out = si.process_pending_session_insights(zoom=zoom)

    repaired = [r for r in out if r.get("action") == "transcript_repaired"]
    assert repaired and repaired[0]["coverage_after"] >= si.COVERAGE_THRESHOLD
    assert _stored_max_t(v["id"]) == 6800
    assert zoom.deleted == ["UUIDREC"] and pages == []


def test_expired_wait_with_no_transcript_keeps_a_measurable_recording(edu_db, chapters_enabled, no_llm,
                                                                      fake_r2, pages, monkeypatch):
    """The owner rule over the old give-up path: no copy is deleted until the stored
    transcript covers >= 98% — a max_wait expiry does not change that."""
    monkeypatch.setenv("DESK_SESSION_TRANSCRIPT_MAX_WAIT_HRS", "0")
    v = _seed_session_video(meeting_uuid="UUIDEXP")
    rec = {"recording_files": [_rfile("MP4", "mp4-long", *_LONG, "http://x/mp4-long", size=999)]}
    zoom = _FakeZoom(rec, {})
    out = si.process_pending_session_insights(zoom=zoom)
    assert any(r.get("action") == "trash_refused" for r in out)
    assert zoom.deleted == [] and not edu.get_video(v["id"])["zoom_cleaned"]


class _RaisingR2:
    def head_object(self, Bucket, Key):
        from botocore.exceptions import ClientError

        raise ClientError({"Error": {"Code": "404"}}, "HeadObject")

    def put_object(self, **_kw):
        raise RuntimeError("R2 is down")


def test_an_archive_failure_keeps_the_recording(edu_db, chapters_enabled, no_llm, pages, monkeypatch):
    from api.services.wisdom.core import r2

    monkeypatch.setattr(r2, "_client_and_bucket", lambda: (_RaisingR2(), "b"))
    v = _seed_session_video(meeting_uuid="UUIDARC")
    zoom = _FakeZoom(_rec_356(), _DL_356)
    out = si.process_pending_session_insights(zoom=zoom)
    refused = [r for r in out if r.get("action") == "trash_refused"]
    assert refused and refused[0]["reason"].startswith("vtt_archive_failed")
    assert zoom.deleted == [] and not edu.get_video(v["id"])["zoom_cleaned"]


def test_control_the_archive_kill_switch_is_what_refused(edu_db, chapters_enabled, no_llm, pages, monkeypatch):
    from api.services.wisdom.core import r2

    monkeypatch.setattr(r2, "_client_and_bucket", lambda: (_RaisingR2(), "b"))
    monkeypatch.setenv("DESK_VTT_ARCHIVE_DISABLED", "true")
    _seed_session_video(meeting_uuid="UUIDARCOFF")
    zoom = _FakeZoom(_rec_356(), _DL_356)
    si.process_pending_session_insights(zoom=zoom)
    assert zoom.deleted == ["UUIDARCOFF"]


def test_the_archive_is_immutable_keyed_and_redacts_secrets(fake_r2):
    rec = _rec_356(extra=[_rfile("CC", "cc-1", *_LONG, "http://x/cc")])
    texts = dict(_DL_356, **{"http://x/cc": _VTT_LONG})
    out = si.archive_recording_to_r2("MEET/1", rec, texts.__getitem__)
    prefix = f"wisdom/sources/zoom_vtt/{wisdom_ids.sha24('MEET/1')}/"
    assert {v["key"] for v in out["vtt"]} == {f"{prefix}vtt-short.vtt", f"{prefix}vtt-long.vtt", f"{prefix}cc-1.vtt"}
    meta = json.loads(fake_r2.objects[out["metadata"]["key"]][0])
    assert "password" not in meta and meta["uuid"] == "K02BCIBPQTKxm51v+d7inQ=="
    # same bytes again: no new object, no error
    again = si.archive_recording_to_r2("MEET/1", rec, texts.__getitem__)
    assert all(v["created"] is False for v in again["vtt"])
    # Zoom regenerated a VTT: kept BESIDE the first, never overwritten
    changed = dict(texts, **{"http://x/vtt-long": _VTT_LONG + "\n\n9\n02:00:00.000 --> 02:00:03.000\nextra\n"})
    third = si.archive_recording_to_r2("MEET/1", rec, changed.__getitem__)
    long_keys = [v["key"] for v in third["vtt"] if "vtt-long" in v["key"]]
    assert long_keys and long_keys[0] != f"{prefix}vtt-long.vtt"


def test_the_kill_switches_are_read_by_literal_name_and_default_on(monkeypatch):
    import inspect

    assert 'os.environ.get("DESK_TRANSCRIPT_COVERAGE_GUARD_DISABLED", "")' in inspect.getsource(
        si._coverage_guard_disabled)
    assert 'os.environ.get("DESK_VTT_ARCHIVE_DISABLED", "")' in inspect.getsource(si._vtt_archive_disabled)
    monkeypatch.delenv("DESK_TRANSCRIPT_COVERAGE_GUARD_DISABLED", raising=False)
    monkeypatch.delenv("DESK_VTT_ARCHIVE_DISABLED", raising=False)
    assert si._coverage_guard_disabled() is False and si._vtt_archive_disabled() is False
    monkeypatch.setenv("DESK_VTT_ARCHIVE_DISABLED", "0")
    assert si._vtt_archive_disabled() is False


def test_transcript_coverage_edges():
    assert si.transcript_coverage([], 6830) == 0.0
    assert si.transcript_coverage([{"t": 345, "text": "x"}], None) is None
    assert si.transcript_coverage([{"t": 345, "text": "x"}], 6830) == pytest.approx(345 / 6830)
    assert si.transcript_coverage([{"t": 9999, "text": "x"}], 6830) == 1.0


# ═════════════════════════════════════════════════════════════════════════════
# 2026-09-13 — ADVERSARIAL REVIEW (S-C). Two ways the trash gate let an
# unrecoverable delete through, each with a mutant that reds.
# ═════════════════════════════════════════════════════════════════════════════

_CHAT_FILE = {"file_type": "CHAT", "id": "chat-1", "file_extension": "TXT",
              "recording_type": "chat_file", "status": "completed", "download_url": "http://x/chat"}


def test_the_chat_log_is_archived_and_a_missing_one_refuses_the_trash(
        edu_db, chapters_enabled, no_llm, fake_r2, pages):
    """⛔ R1. §8a.6a.1 names FOUR artifacts; the gate stored three.

    `_is_vtt_file` answers False for a CHAT file, so the chat log was never fetched,
    never stored, and the recording was deleted anyway — with no Zoom trash recovery,
    that chat log was gone. MUTANT: drop 'chat' from `archivable_text_files`, or delete
    the stored-vs-expected count in `archive_recording_to_r2`, and this reds."""
    rec = _rec_356(extra=[_CHAT_FILE])
    v = _seed_session_video(title="Workshop", meeting_uuid="UUIDCHAT")
    texts = dict(_DL_356, **{"http://x/chat": "12:01:02 From A Member : hi"})
    zoom = _FakeZoom(rec, texts)

    si.process_pending_session_insights(zoom=zoom)

    prefix = f"wisdom/sources/zoom_vtt/{wisdom_ids.sha24('UUIDCHAT')}/"
    assert f"{prefix}chat-1.chat.txt" in fake_r2.objects, sorted(fake_r2.objects)
    assert zoom.deleted == ["UUIDCHAT"]  # control: a COMPLETE store still trashes


def test_a_chat_log_that_cannot_be_downloaded_keeps_the_recording(
        edu_db, chapters_enabled, no_llm, fake_r2, pages):
    """The other half: an artifact the recording LISTS but we could not store is a
    reason to keep the copy. 'we did not archive it' and 'there was none' are
    different facts and only one of them may delete anything."""
    rec = _rec_356(extra=[_CHAT_FILE])
    v = _seed_session_video(title="Workshop", meeting_uuid="UUIDCHATBAD")
    zoom = _FakeZoom(rec, dict(_DL_356, **{"http://x/chat": ""}))  # empty download

    out = si.process_pending_session_insights(zoom=zoom)

    refused = [r for r in out if r.get("id") == v["id"] and r.get("action") == "trash_refused"]
    assert refused and refused[0]["reason"].startswith("vtt_archive_failed")
    assert zoom.deleted == []


def test_an_unmeasurable_coverage_refuses_the_trash(edu_db, chapters_enabled, no_llm, fake_r2, pages):
    """⛔ R2. `coverage is None` means WE COULD NOT MEASURE IT — no MP4 window, no Zoom
    duration, no edu_videos duration. The old gate read that as a pass and deleted the
    only copy; §8a.6a blocks deletion until store-and-verify SUCCEEDS, and an
    unverifiable recording has not verified. MUTANT: restore
    `if coverage is not None and coverage < THRESHOLD` and this reds."""
    v = _seed_session_video(meeting_uuid="UUIDNODUR")
    rec = {"recording_files": [
        {"file_type": "SUMMARY", "recording_type": "summary", "download_url": "http://x/summary"},
        {"file_type": "TRANSCRIPT", "recording_type": "audio_transcript", "status": "completed",
         "download_url": "http://x/vtt"},
    ]}
    zoom = _FakeZoom(rec, {"http://x/summary": _SUMMARY_JSON, "http://x/vtt": _VTT})

    out = si.process_pending_session_insights(zoom=zoom)

    assert si._media_duration_seconds(v["id"], rec) is None  # control: genuinely unmeasurable
    refused = [r for r in out if r.get("id") == v["id"] and r.get("action") == "trash_refused"]
    assert refused and "not measurable" in refused[0]["reason"]
    assert zoom.deleted == []
    assert pages == [(f"desk_transcript_coverage:{v['id']}", "critical")]


def test_control_zooms_own_duration_makes_it_measurable_again(edu_db, chapters_enabled, no_llm,
                                                              fake_r2, pages):
    """The fallback that keeps R2's refusal from stalling the real pipeline: Zoom's
    top-level `duration` is MINUTES, and a recording carrying it is measurable."""
    v = _seed_session_video(meeting_uuid="UUIDMIN")
    rec = {"duration": 1, "recording_files": [
        {"file_type": "SUMMARY", "recording_type": "summary", "download_url": "http://x/summary"},
        {"file_type": "TRANSCRIPT", "recording_type": "audio_transcript", "status": "completed",
         "download_url": "http://x/vtt"},
    ]}
    assert si._media_duration_seconds(v["id"], rec) == 60
    zoom = _FakeZoom(rec, {"http://x/summary": _SUMMARY_JSON,
                           "http://x/vtt": _vtt_of((2, "open"), (59, "close"))})
    si.process_pending_session_insights(zoom=zoom)
    assert zoom.deleted == ["UUIDMIN"] and pages == []


def test_an_unclassified_text_artifact_refuses_the_trash(edu_db, chapters_enabled, no_llm,
                                                         fake_r2, pages):
    """⛔ The residual check (replaces a tautological count that survived its own mutant).

    Zoom's poll/Q&A export is a CSV of member answers. This build does not archive it —
    so the honest answer is to keep the cloud copy and say why, never to delete content
    we chose not to store. MUTANT: delete the `_TEXT_EXTENSIONS` residual loop in
    `archive_recording_to_r2` and this reds."""
    poll = {"file_type": "POLL", "id": "poll-1", "file_extension": "CSV", "status": "completed",
            "download_url": "http://x/poll"}
    v = _seed_session_video(title="Workshop", meeting_uuid="UUIDPOLL")
    zoom = _FakeZoom(_rec_356(extra=[poll]), dict(_DL_356, **{"http://x/poll": "q,a\n1,yes\n"}))

    out = si.process_pending_session_insights(zoom=zoom)

    refused = [r for r in out if r.get("id") == v["id"] and r.get("action") == "trash_refused"]
    assert refused and refused[0]["reason"].startswith("vtt_archive_failed")
    assert "POLL" in refused[0]["reason"]  # it names WHICH artifact, not just "failed"
    assert zoom.deleted == []
    # control: the SAME recording minus the poll file is a completed store
    # (test_multi_transcript_regression_… proves the end-to-end trash on this fixture)
    ok = si.archive_recording_to_r2("MEET/NOPOLL", _rec_356(), _DL_356.__getitem__)
    assert len(ok["vtt"]) == 2 and ok["metadata"]


def test_an_mp4_can_never_trip_the_residual_check(fake_r2):
    """Narrowness control: media extensions are not text extensions, so an ordinary
    recording with video and audio files archives cleanly."""
    rec = _rec_356(extra=[{"file_type": "M4A", "id": "aud", "file_extension": "M4A",
                           "status": "completed", "download_url": "http://x/m4a"}])
    out = si.archive_recording_to_r2("MEET/MEDIA", rec, _DL_356.__getitem__)
    assert len(out["vtt"]) == 2 and out["chat"] == [] and out["metadata"]


# ═════════════════════════════════════════════════════════════════════════════
# 2026-09-14 — the owner's coverage ruling reached the AUDIT, not this gate.
# ═════════════════════════════════════════════════════════════════════════════

def test_the_new_gap_rule_does_not_loosen_the_zoom_delete_gate(
        edu_db, chapters_enabled, no_llm, fake_r2, pages):
    """⛔⛔ THE ONE THING THIS CHANGE MUST NOT DO.

    Owner ruling 2026-09-14 makes "internal gaps only" the coverage rule, and under it a
    transcript that runs 0 s .. 2,790 s of a 6,830 s recording with no hole in it is
    COMPLETE — that is exactly video 254's shape and it was genuinely fine. But the gap
    rule cannot tell that from a transcript truncated at the 41 % mark, and a Zoom delete
    has no trash and no recovery ("Workshop with Stockbee" is gone). So this gate keeps
    the 0.98 SPAN rule and the recording stays.

    MUTANT: make `_trash_gate` authorise on the gap verdict — `zoom.deleted == ["UUIDGAP"]`
    and this reds. Loosening it is an owner decision, never a side effect."""
    v = _seed_session_video(title="Live Trading Session — September 12, 2026", meeting_uuid="UUIDGAP")
    dense = [{"t": t, "text": f"line {t}"} for t in range(0, 2791, 10)]
    edu.set_video_insights(v["id"], transcript=si._timestamped_block(dense),
                           chapters=[{"t": 0, "title": "Open"}])

    # control: the NEW rule really does call this transcript complete...
    facts = si.coverage_rule.transcript_coverage(edu.get_transcript_cues(v["id"]), 6830)
    assert facts["verdict"] == "complete" and facts["internal_gap_count"] == 0
    # ...and the span the gate reads is nowhere near the threshold
    assert facts["span_ratio"] == pytest.approx(2790 / 6830)
    assert si.transcript_coverage(edu.get_transcript_cues(v["id"]), 6830) < si.COVERAGE_THRESHOLD

    rec = {"recording_files": [_rfile("MP4", "mp4-long", *_LONG, "http://x/mp4-long", size=999)]}
    zoom = _FakeZoom(rec, {})
    out = si.process_pending_session_insights(zoom=zoom)

    refused = [r for r in out if r.get("id") == v["id"] and r.get("action") == "trash_refused"]
    assert refused and refused[0]["reason"].startswith("coverage ")
    assert zoom.deleted == []
    assert not edu.get_video(v["id"])["zoom_cleaned"]
    assert pages == [(f"desk_transcript_coverage:{v['id']}", "critical")]


def test_the_page_carries_the_gap_verdict_so_a_correct_alert_is_not_muted(edu_db, monkeypatch):
    """⭐ A page that says only "covers 61.6%" is what sends an operator to re-transcribe a
    healthy session — and then to mute the alert. It must carry the other rule's answer."""
    from api.services import chart_health_alerts

    sent = []
    monkeypatch.setattr(chart_health_alerts, "emit",
                        lambda key, sev, message, metadata=None: sent.append((message, metadata)) or True)
    si._COVERAGE_ALERTED.discard(4242)
    facts = si.coverage_rule.transcript_coverage([{"t": t} for t in range(0, 2791, 10)], 4532)
    si._emit_coverage_alert(4242, "Live Trading Session", facts["span_ratio"], 4532, facts)

    assert len(sent) == 1
    message, meta = sent[0]
    assert "covers 61.6%" in message                      # the span number, as before
    assert "Internal-gap rule says COMPLETE" in message   # and the verdict that explains it
    assert "NOT loosened" in message
    assert meta["gap_verdict"] == "complete" and meta["largest_internal_gap_s"] == 10
    assert meta["trailing_silence_s"] == pytest.approx(1742)
