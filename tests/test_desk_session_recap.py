"""Tests for desk_session_recap: chunk splitting, gating, webhook posting
(stubbed urllib), and the non-fatal pipeline hook."""
import json

import pytest

from api.services import desk_session_recap as dr


# ── split_chunks ────────────────────────────────────────────────────────────────

def test_split_chunks_short_text_single_chunk():
    assert dr.split_chunks("hello") == ["hello"]


def test_split_chunks_empty():
    assert dr.split_chunks("") == []
    assert dr.split_chunks(None) == []


def test_split_chunks_prefers_section_boundaries():
    sections = [f"## Section {i}\n" + ("line\n" * 40) for i in range(6)]
    text = "intro\n" + "".join(sections)
    chunks = dr.split_chunks(text, limit=400)
    assert all(len(c) <= 400 for c in chunks)
    # every section header starts a line in exactly one chunk (nothing lost)
    joined = "\n".join(chunks)
    for i in range(6):
        assert f"## Section {i}" in joined
    # chunks after the first start at a section boundary when possible
    assert chunks[1].startswith("## ")


def test_split_chunks_oversized_single_section_hard_splits():
    text = "## Big\n" + ("word " * 2000)
    chunks = dr.split_chunks(text, limit=500)
    assert len(chunks) > 1
    assert all(len(c) <= 500 for c in chunks)


# ── gating ──────────────────────────────────────────────────────────────────────

def test_is_enabled_flag(monkeypatch):
    monkeypatch.delenv("DESK_SESSION_DISCORD_RECAP_ENABLED", raising=False)
    assert not dr.is_enabled()
    monkeypatch.setenv("DESK_SESSION_DISCORD_RECAP_ENABLED", "1")
    assert dr.is_enabled()


def test_webhook_url_prefers_dedicated_var(monkeypatch):
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://x/general")
    monkeypatch.setenv("DISCORD_RECAP_WEBHOOK_URL", "https://x/recaps")
    assert dr._webhook_url() == "https://x/recaps"
    monkeypatch.setenv("DISCORD_RECAP_WEBHOOK_URL", "")
    assert dr._webhook_url() == "https://x/general"


def test_maybe_post_recap_disabled_does_nothing(monkeypatch):
    monkeypatch.delenv("DESK_SESSION_DISCORD_RECAP_ENABLED", raising=False)
    called = []
    monkeypatch.setattr(dr, "post_recap_for_video", lambda vid: called.append(vid))
    dr.maybe_post_recap(1)
    assert called == []


def test_maybe_post_recap_never_raises(monkeypatch):
    monkeypatch.setenv("DESK_SESSION_DISCORD_RECAP_ENABLED", "1")

    def boom(vid):
        raise RuntimeError("llm down")
    monkeypatch.setattr(dr, "post_recap_for_video", boom)
    dr.maybe_post_recap(1)  # must not raise


# ── post_recap_for_video ────────────────────────────────────────────────────────

def _stub_video(monkeypatch, transcript="[0:01] hello market"):
    from api.services import education_service as edu
    monkeypatch.setattr(edu, "get_video", lambda vid: {
        "id": vid, "title": "Live Trading Session — July 13, 2026",
        "transcript": transcript,
    })
    monkeypatch.setattr(edu, "get_insights", lambda vid: {
        "headline": "h", "summary": ["s"], "chapters": [{"t": 0, "title": "c"}],
        "setups": [],
    })


def test_post_recap_posts_chunks(monkeypatch):
    monkeypatch.setenv("DISCORD_RECAP_WEBHOOK_URL", "https://discord.test/hook")
    _stub_video(monkeypatch)
    monkeypatch.setattr(dr, "generate_recap_markdown",
                        lambda title, block, ins: "**TL;DR:** good day\n## Takeaways\n- x")
    posted = []
    monkeypatch.setattr(dr, "_post_chunk", lambda url, c: posted.append((url, c)))
    monkeypatch.setattr(dr.time, "sleep", lambda s: None)

    out = dr.post_recap_for_video(42)
    assert out["ok"] is True and out["chunks"] == len(posted) == 1
    url, content = posted[0]
    assert url == "https://discord.test/hook"
    assert content.startswith("# 📋 Live Trading Session — July 13, 2026")
    assert "## Takeaways" in content


def test_post_recap_requires_transcript(monkeypatch):
    monkeypatch.setenv("DISCORD_RECAP_WEBHOOK_URL", "https://discord.test/hook")
    _stub_video(monkeypatch, transcript="")
    with pytest.raises(RuntimeError, match="no stored transcript"):
        dr.post_recap_for_video(42)


def test_post_recap_requires_webhook(monkeypatch):
    monkeypatch.delenv("DISCORD_RECAP_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)
    with pytest.raises(RuntimeError, match="webhook"):
        dr.post_recap_for_video(42)


def test_post_chunk_payload_shape(monkeypatch):
    captured = {}

    class _Resp:
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout=None):
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return _Resp()
    monkeypatch.setattr(dr.urllib.request, "urlopen", fake_urlopen)

    dr._post_chunk("https://discord.test/hook", "hello")
    assert captured["body"]["username"] == "UCT Session Recap"
    assert captured["body"]["content"] == "hello"
    assert captured["body"]["allowed_mentions"] == {"parse": []}
