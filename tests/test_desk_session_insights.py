"""Tests for the pure (no-network) bits of desk_session_insights: VTT parsing
and the LLM-output cleaners. Generation/orchestration (network) are not tested
here — they're exercised via the scheduled pass against real Zoom data."""
from api.services import desk_session_insights as si


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
