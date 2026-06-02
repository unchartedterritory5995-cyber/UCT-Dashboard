"""Server-side rundown briefing extraction + read-aloud pre-warm."""

from unittest.mock import patch
from api.services.rundown_speech import extract_rundown_speech_text, split_sentences

RUNDOWN = """
  <div class="rd-regime-banner"><div class="rd-lbl">Market Phase</div><div class="rd-phase">CONFIRMED UPTREND</div></div>
  <div class="rd-stockbee"><div class="rd-metric-name">VIX</div><div class="rd-metric-val">15.83</div></div>
  <div class="rd-sections">
    <div class="rd-agenda"><span class="rd-agenda-label">TODAY'S FOCUS</span>
      <ul><li>NVDA leading pre-market</li></ul>
    </div>
    <p>Last week closed strong. The tape is healthy today.</p>
  </div>
"""


def test_extracts_briefing_skips_widgets():
    out = extract_rundown_speech_text(RUNDOWN)
    assert "TODAY'S FOCUS" in out
    assert "NVDA leading pre-market" in out
    assert "Last week closed strong" in out
    # data-widget content must be excluded
    assert "CONFIRMED UPTREND" not in out
    assert "15.83" not in out
    # block-aware: no mashing across element boundaries
    assert "FOCUSNVDA" not in out


def test_falls_back_to_whole_fragment_without_rd_sections():
    out = extract_rundown_speech_text("<div>Some <strong>briefing</strong> here.</div>")
    assert "Some briefing here." in out


def test_split_sentences():
    s = split_sentences("First sentence. Second one! Third?\nFourth line.")
    assert s == ["First sentence.", "Second one!", "Third?", "Fourth line."]


def test_extract_empty():
    assert extract_rundown_speech_text("") == ""
    assert split_sentences("") == []


def test_prewarm_idempotent_and_caches(tmp_path, monkeypatch):
    from api.services import voice_audio_cache as vac
    monkeypatch.setattr(vac, "_CACHE_DIR", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    from api.services import voice_prewarm

    with patch("api.services.voice_openai.synthesize_speech", return_value=b"AUDIO") as synth:
        ok1 = voice_prewarm.prewarm_rundown_audio(RUNDOWN, voice="verse", speed=1.0)
        ok2 = voice_prewarm.prewarm_rundown_audio(RUNDOWN, voice="verse", speed=1.0)

    assert ok1 is True and ok2 is True
    assert synth.call_count == 1  # second call hits the cache, no re-synth


def test_prewarm_skipped_without_api_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    from api.services import voice_prewarm
    assert voice_prewarm.prewarm_rundown_audio(RUNDOWN) is False
