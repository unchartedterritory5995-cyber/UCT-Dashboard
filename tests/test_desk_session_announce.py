"""Tests for desk_session_announce: the show allowlist (the paywall guard),
embed copy, post→record→edit round trip (stubbed requests), and the non-fatal
pipeline hooks."""
import json

import pytest

from api.services import desk_session_announce as da


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(da, "_DB_PATH", str(tmp_path / "announce.db"))
    monkeypatch.setenv("DISCORD_TSDR_WEBHOOK_URL", "https://discord.test/hook/abc")
    monkeypatch.delenv("DESK_TSDR_ANNOUNCE_SHOWS", raising=False)


class _Resp:
    def __init__(self, payload=None, status=200):
        self._payload = payload or {}
        self.status_code = status

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def _video(**over):
    v = {"id": 42, "title": "Evening Update from TSDR — July 27, 2026",
         "category": "Evening Update", "youtube_id": "abc123"}
    v.update(over)
    return v


def _stub_video(monkeypatch, video=None, insights=None):
    monkeypatch.setattr(da.education_service, "get_video",
                        lambda vid: (video if video is not None else _video()))
    monkeypatch.setattr(da.education_service, "get_insights",
                        lambda vid: (insights or {}))


def _stub_thumb(monkeypatch, data=b"JPEGBYTES"):
    monkeypatch.setattr(da, "_thumbnail_bytes", lambda date_text, eyebrow: data)


# ── the show allowlist — the paywall guard ───────────────────────────────────

def test_show_allowed_matches_evening_only_by_default():
    assert da.show_allowed("Evening Update from TSDR — July 27, 2026", "Evening Update")
    assert not da.show_allowed("Live Trading Session — July 27, 2026", "Live Trading Sessions")
    assert not da.show_allowed("Sunday Scans — July 26, 2026", "Sunday Scans")
    assert not da.show_allowed("Workshop with Zen — July 9, 2026", "Workshops & Fireside Chats")


def test_show_allowed_env_override_is_a_comma_list(monkeypatch):
    monkeypatch.setenv("DESK_TSDR_ANNOUNCE_SHOWS", "evening update, sunday scans")
    assert da.show_allowed("Sunday Scans — July 26, 2026", "Sunday Scans")
    assert not da.show_allowed("Live Trading Session", "Live Trading Sessions")


def test_blank_show_list_announces_nothing(monkeypatch):
    """Failure direction must be SILENCE. A blank env value means no show
    matches — never 'match everything', which would leak paywalled sessions
    into a public channel."""
    monkeypatch.setenv("DESK_TSDR_ANNOUNCE_SHOWS", "")
    assert da.allowed_shows() == []
    assert not da.show_allowed("Evening Update from TSDR", "Evening Update")


def test_announce_refuses_a_paywalled_show_and_posts_nothing(monkeypatch):
    """The regression rail for the guard: a Live Trading Session must never
    reach the public webhook. Fails loudly if the allowlist check is removed."""
    _stub_video(monkeypatch, _video(title="Live Trading Session — July 27, 2026",
                                    category="Live Trading Sessions"))
    _stub_thumb(monkeypatch)
    posted = []
    monkeypatch.setattr(da.requests, "post", lambda *a, **k: posted.append(k) or _Resp())

    out = da.announce_video(42)
    assert out["ok"] is False and "not in DESK_TSDR_ANNOUNCE_SHOWS" in out["skipped"]
    assert posted == []
    assert da.get_announcement(42) is None


def test_force_overrides_the_allowlist(monkeypatch):
    _stub_video(monkeypatch, _video(title="Live Trading Session — July 27, 2026",
                                    category="Live Trading Sessions"))
    _stub_thumb(monkeypatch)
    monkeypatch.setattr(da.requests, "post",
                        lambda *a, **k: _Resp({"id": "999", "attachments": []}))
    assert da.announce_video(42, force=True)["ok"] is True


# ── copy ─────────────────────────────────────────────────────────────────────

def test_split_title():
    assert da.split_title("Evening Update from TSDR — July 27, 2026") == (
        "Evening Update from TSDR", "July 27, 2026")
    assert da.split_title("No Date Here") == ("No Date Here", "")


def test_description_pre_recap_promises_nothing_and_carries_both_links():
    d = da.build_description("abc123")
    assert "youtube.com/watch?v=abc123" in d
    assert "https://uctintelligence.com" in d
    # No "recap coming" promise — the transcript may never arrive.
    for weasel in ("shortly", "coming soon", "recap will", "stay tuned"):
        assert weasel not in d.lower()


def test_description_with_recap_carries_headline_bullets_and_tickers():
    ins = {"headline": "Buyers defended the 20-day into the close.",
           "summary": ["SPY reclaimed 640 on volume.", "Semis led the bounce."],
           "ticker_moments": [{"ticker": "NVDA"}, {"ticker": "spy"}, {"ticker": "NVDA"}]}
    d = da.build_description("abc123", ins)
    assert "Buyers defended the 20-day" in d
    assert "SPY reclaimed 640" in d and "Semis led the bounce" in d
    assert "`NVDA`" in d and "`SPY`" in d
    assert d.count("`NVDA`") == 1                      # deduped
    assert "youtube.com/watch?v=abc123" in d


def test_ticker_symbols_tolerates_bare_strings_and_cashtags():
    assert da._ticker_symbols({"ticker_moments": ["$tsla", {"symbol": "amd"}]}) == ["TSLA", "AMD"]


def test_description_is_clamped_to_discord_limit():
    ins = {"headline": "x" * 300, "summary": ["y" * 900 for _ in range(5)]}
    assert len(da.build_description("abc123", ins)) <= da._DESC_LIMIT


def test_embed_references_the_attachment_when_a_thumbnail_exists():
    e = da.build_embed("T", "abc123")
    assert e["image"] == {"url": "attachment://thumb.jpg"}
    assert e["url"] == "https://www.youtube.com/watch?v=abc123"
    assert da.build_embed("T", "abc123", image_ref="").get("image") is None


# ── post → record → edit ─────────────────────────────────────────────────────

def test_announce_posts_multipart_with_wait_and_records_ids(monkeypatch):
    _stub_video(monkeypatch)
    _stub_thumb(monkeypatch)
    seen = {}

    def fake_post(url, **kw):
        seen.update(kw, url=url)
        return _Resp({"id": "msg1", "attachments": [{"id": "att1"}]})
    monkeypatch.setattr(da.requests, "post", fake_post)

    out = da.announce_video(42)
    assert out["ok"] and out["message_id"] == "msg1"
    # ?wait=true is what makes the later edit possible at all
    assert seen["params"] == {"wait": "true"}
    assert "files" in seen and seen["files"]["files[0]"][1] == b"JPEGBYTES"
    body = json.loads(seen["data"]["payload_json"])
    assert body["allowed_mentions"] == {"parse": []}
    rec = da.get_announcement(42)
    assert rec["message_id"] == "msg1" and rec["attachment_id"] == "att1"


def test_announce_is_idempotent(monkeypatch):
    _stub_video(monkeypatch)
    _stub_thumb(monkeypatch)
    calls = []
    monkeypatch.setattr(da.requests, "post", lambda *a, **k: calls.append(1) or _Resp(
        {"id": "msg1", "attachments": []}))
    da.announce_video(42)
    out = da.announce_video(42)
    assert out["already"] is True and len(calls) == 1


def test_announce_without_a_thumbnail_still_posts_json(monkeypatch):
    _stub_video(monkeypatch)
    monkeypatch.setattr(da, "_thumbnail_bytes", lambda d, e: None)
    seen = {}
    monkeypatch.setattr(da.requests, "post", lambda url, **kw: seen.update(kw) or _Resp(
        {"id": "m", "attachments": []}))
    assert da.announce_video(42)["thumbnail"] is False
    assert "files" not in seen and seen["json"]["embeds"][0].get("image") is None


def test_attach_recap_edits_the_message_and_keeps_the_attachment(monkeypatch):
    """`attachments` MUST name the kept attachment — omitting it makes Discord
    drop the uploaded thumbnail, silently gutting the post on recap arrival."""
    ins = {"headline": "Sellers faded the open.", "summary": ["QQQ lost 580."]}
    _stub_video(monkeypatch, _video(), ins)
    _stub_thumb(monkeypatch)
    monkeypatch.setattr(da.requests, "post",
                        lambda *a, **k: _Resp({"id": "msg1", "attachments": [{"id": "att1"}]}))
    da.announce_video(42)

    seen = {}
    monkeypatch.setattr(da.requests, "patch",
                        lambda url, **kw: seen.update(kw, url=url) or _Resp())
    out = da.attach_recap(42)

    assert out["mode"] == "edited"
    assert seen["url"] == "https://discord.test/hook/abc/messages/msg1"
    assert seen["json"]["attachments"] == [{"id": "att1"}]
    assert "Sellers faded the open." in seen["json"]["embeds"][0]["description"]
    assert seen["json"]["embeds"][0]["image"] == {"url": "attachment://thumb.jpg"}
    assert da.get_announcement(42)["recap_at"] is not None


def test_attach_recap_falls_back_to_a_followup_when_the_edit_fails(monkeypatch):
    ins = {"headline": "Chop.", "summary": ["Range day."]}
    _stub_video(monkeypatch, _video(), ins)
    _stub_thumb(monkeypatch)
    posts = []
    monkeypatch.setattr(da.requests, "post", lambda *a, **k: posts.append(k) or _Resp(
        {"id": "msg1", "attachments": [{"id": "att1"}]}))
    da.announce_video(42)
    monkeypatch.setattr(da.requests, "patch", lambda *a, **k: _Resp(status=400))

    out = da.attach_recap(42)
    assert out["mode"] == "followup"
    assert len(posts) == 2
    assert "Chop." in posts[1]["json"]["embeds"][0]["description"]


def test_attach_recap_skips_when_no_insights_yet(monkeypatch):
    _stub_video(monkeypatch, _video(), {})
    _stub_thumb(monkeypatch)
    monkeypatch.setattr(da.requests, "post",
                        lambda *a, **k: _Resp({"id": "msg1", "attachments": []}))
    da.announce_video(42)
    monkeypatch.setattr(da.requests, "patch", _boom)
    assert da.attach_recap(42)["skipped"] == "no recap available yet"


def _boom(*a, **k):
    raise AssertionError("must not be called")


# ── pipeline hooks: gated + never fatal ──────────────────────────────────────

def test_hooks_are_noops_when_disabled(monkeypatch):
    monkeypatch.delenv("DESK_TSDR_ANNOUNCE_ENABLED", raising=False)
    monkeypatch.setattr(da, "announce_video", _boom)
    monkeypatch.setattr(da, "attach_recap", _boom)
    da.maybe_announce(42)
    da.maybe_attach_recap(42)


def test_maybe_announce_never_raises(monkeypatch):
    monkeypatch.setenv("DESK_TSDR_ANNOUNCE_ENABLED", "1")
    monkeypatch.setattr(da, "announce_video", _boom)
    da.maybe_announce(42)          # must not raise into the publish pipeline


def test_maybe_attach_recap_skips_unannounced_video(monkeypatch):
    monkeypatch.setenv("DESK_TSDR_ANNOUNCE_ENABLED", "1")
    monkeypatch.setattr(da, "attach_recap", _boom)
    da.maybe_attach_recap(999)     # never announced → no edit attempted


def test_announce_raises_without_a_webhook(monkeypatch):
    monkeypatch.setenv("DISCORD_TSDR_WEBHOOK_URL", "")
    _stub_video(monkeypatch)
    with pytest.raises(RuntimeError, match="DISCORD_TSDR_WEBHOOK_URL"):
        da.announce_video(42)
