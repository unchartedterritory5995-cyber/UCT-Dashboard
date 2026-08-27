import pytest
from api.services import youtube_client as yc


def test_parse_broadcasts_extracts_fields():
    payload = {"items": [
        {"id": "VID123", "snippet": {"title": "Webinar",
            "actualStartTime": "2026-06-24T13:30:00Z"},
         "status": {"privacyStatus": "unlisted"}},
    ]}
    out = yc._parse_broadcasts(payload)
    assert out == [{"video_id": "VID123", "title": "Webinar",
                    "started_at": "2026-06-24T13:30:00Z", "privacy": "unlisted"}]


def test_parse_broadcasts_skips_items_without_id():
    payload = {"items": [{"snippet": {"title": "no id"}}, {"id": ""}]}
    assert yc._parse_broadcasts(payload) == []


def test_parse_broadcasts_falls_back_to_scheduled_then_published():
    payload = {"items": [{"id": "V", "snippet": {
        "title": "t", "scheduledStartTime": "2026-06-24T13:00:00Z"}}]}
    assert yc._parse_broadcasts(payload)[0]["started_at"] == "2026-06-24T13:00:00Z"


def test_ensure_token_raises_when_unconfigured():
    c = yc.YouTubeClient(client_id=None, client_secret=None, refresh_token=None)
    with pytest.raises(yc.YouTubeAuthError):
        c._ensure_token()


class _Resp:
    def __init__(self, status, payload=None, text="", headers=None):
        self.status_code = status
        self._payload = payload or {}
        self.text = text
        self.headers = headers or {}
    def json(self):
        return self._payload


def test_list_completed_broadcasts_refreshes_token_and_lists(monkeypatch):
    calls = {}
    def fake_post(url, data=None, timeout=None):
        calls["token"] = data
        return _Resp(200, {"access_token": "AT", "expires_in": 3600})
    def fake_get(url, params=None, headers=None, timeout=None):
        calls["auth"] = headers["Authorization"]
        return _Resp(200, {"items": [{"id": "V1",
            "snippet": {"title": "x", "actualStartTime": "2026-06-24T13:30:00Z"}}]})
    monkeypatch.setattr(yc.httpx, "post", fake_post)
    monkeypatch.setattr(yc.httpx, "get", fake_get)
    c = yc.YouTubeClient(client_id="id", client_secret="sec", refresh_token="rt")
    rows = c.list_completed_broadcasts()
    assert rows[0]["video_id"] == "V1"
    assert calls["auth"] == "Bearer AT"
    assert calls["token"]["grant_type"] == "refresh_token"


def test_list_raises_on_api_error(monkeypatch):
    monkeypatch.setattr(yc.httpx, "post", lambda *a, **k: _Resp(200, {"access_token": "AT"}))
    monkeypatch.setattr(yc.httpx, "get", lambda *a, **k: _Resp(403, text="forbidden"))
    c = yc.YouTubeClient(client_id="id", client_secret="sec", refresh_token="rt")
    with pytest.raises(yc.YouTubeApiError):
        c.list_completed_broadcasts()


def test_list_passes_mine_true(monkeypatch):
    captured = {}
    def fake_post(url, data=None, timeout=None):
        return _Resp(200, {"access_token": "AT", "expires_in": 3600})
    def fake_get(url, params=None, headers=None, timeout=None):
        captured["params"] = dict(params) if params else {}
        return _Resp(200, {"items": []})
    monkeypatch.setattr(yc.httpx, "post", fake_post)
    monkeypatch.setattr(yc.httpx, "get", fake_get)
    c = yc.YouTubeClient(client_id="id", client_secret="sec", refresh_token="rt")
    c.list_completed_broadcasts()
    assert captured["params"]["mine"] == "true"


def _capture_upload(monkeypatch, tmp_path):
    f = tmp_path / "v.mp4"
    f.write_bytes(b"x" * 10)
    captured = {}
    def fake_post(url, params=None, headers=None, json=None, timeout=None):
        captured["meta"] = json
        captured["init_url"] = url
        return _Resp(200, headers={"location": "https://up.example/session"})
    def fake_put(url, content=None, headers=None, timeout=None):
        captured["put_url"] = url
        return _Resp(200, {"id": "VIDUP"})
    monkeypatch.setattr(yc.httpx, "post", fake_post)
    monkeypatch.setattr(yc.httpx, "put", fake_put)
    c = yc.YouTubeClient(client_id="i", client_secret="s", refresh_token="r")
    monkeypatch.setattr(c, "_ensure_token", lambda: "AT")
    return c, str(f), captured


def test_upload_defaults_to_unlisted(monkeypatch, tmp_path):
    c, path, captured = _capture_upload(monkeypatch, tmp_path)
    vid = c.upload(path, "Live Trading Session — June 24, 2026")
    assert vid == "VIDUP"
    assert captured["put_url"] == "https://up.example/session"
    assert captured["meta"]["status"]["privacyStatus"] == "unlisted"


def test_upload_sends_the_requested_privacy_to_youtube(monkeypatch, tmp_path):
    # Without this the caller's routing is DECORATIVE — it could compute "public"
    # and the client would still ship an unlisted video, reporting success either way.
    c, path, captured = _capture_upload(monkeypatch, tmp_path)
    c.upload(path, "Sunday Scans — August 9, 2026", privacy="public")
    assert captured["meta"]["status"]["privacyStatus"] == "public"


def test_upload_rejects_an_unknown_privacy_value(monkeypatch, tmp_path):
    # A typo must fail loudly rather than reach YouTube and get coerced.
    c, path, _ = _capture_upload(monkeypatch, tmp_path)
    with pytest.raises(ValueError):
        c.upload(path, "t", privacy="pubic")


def test_upload_raises_on_init_failure(monkeypatch, tmp_path):
    f = tmp_path / "v.mp4"; f.write_bytes(b"x" * 10)
    monkeypatch.setattr(yc.httpx, "post", lambda *a, **k: _Resp(403, text="no"))
    c = yc.YouTubeClient(client_id="i", client_secret="s", refresh_token="r")
    monkeypatch.setattr(c, "_ensure_token", lambda: "AT")
    with pytest.raises(yc.YouTubeApiError):
        c.upload(str(f), "t")


def test_set_thumbnail_posts_image(monkeypatch):
    seen = {}
    def fake_post(url, params=None, headers=None, content=None, timeout=None):
        seen.update(url=url, params=params, ct=headers.get("Content-Type"), body=content)
        return _Resp(200, {})
    monkeypatch.setattr(yc.httpx, "post", fake_post)
    c = yc.YouTubeClient(client_id="i", client_secret="s", refresh_token="r")
    monkeypatch.setattr(c, "_ensure_token", lambda: "AT")
    c.set_thumbnail("VID9", b"\xff\xd8jpegbytes")
    assert "thumbnails/set" in seen["url"]
    assert seen["params"]["videoId"] == "VID9"
    assert seen["ct"] == "image/jpeg"
    assert seen["body"] == b"\xff\xd8jpegbytes"


def test_set_thumbnail_raises_on_error(monkeypatch):
    monkeypatch.setattr(yc.httpx, "post", lambda *a, **k: _Resp(403, text="no"))
    c = yc.YouTubeClient(client_id="i", client_secret="s", refresh_token="r")
    monkeypatch.setattr(c, "_ensure_token", lambda: "AT")
    with pytest.raises(yc.YouTubeApiError):
        c.set_thumbnail("VID9", b"x")


# ---------------------------------------------------------------------------
# 2026-08-26 — get_video_snippet / update_description (Phase 2: real per-
# session chapters). Requires a scope beyond youtube.upload — see
# desk_session_insights.refresh_description for the caller.
# ---------------------------------------------------------------------------

def test_get_video_snippet_returns_the_snippet(monkeypatch):
    seen = {}
    def fake_get(url, params=None, headers=None, timeout=None):
        seen.update(url=url, params=params, auth=headers.get("Authorization"))
        return _Resp(200, {"items": [{"id": "VID9", "snippet": {
            "title": "T", "description": "old", "categoryId": "22"}}]})
    monkeypatch.setattr(yc.httpx, "get", fake_get)
    c = yc.YouTubeClient(client_id="i", client_secret="s", refresh_token="r")
    monkeypatch.setattr(c, "_ensure_token", lambda: "AT")
    snippet = c.get_video_snippet("VID9")
    assert snippet == {"title": "T", "description": "old", "categoryId": "22"}
    assert "videos" in seen["url"]
    assert seen["params"] == {"part": "snippet", "id": "VID9"}
    assert seen["auth"] == "Bearer AT"


def test_get_video_snippet_raises_on_http_error(monkeypatch):
    monkeypatch.setattr(yc.httpx, "get", lambda *a, **k: _Resp(403, text="scope insufficient"))
    c = yc.YouTubeClient(client_id="i", client_secret="s", refresh_token="r")
    monkeypatch.setattr(c, "_ensure_token", lambda: "AT")
    with pytest.raises(yc.YouTubeApiError):
        c.get_video_snippet("VID9")


def test_get_video_snippet_raises_when_video_not_found(monkeypatch):
    monkeypatch.setattr(yc.httpx, "get", lambda *a, **k: _Resp(200, {"items": []}))
    c = yc.YouTubeClient(client_id="i", client_secret="s", refresh_token="r")
    monkeypatch.setattr(c, "_ensure_token", lambda: "AT")
    with pytest.raises(yc.YouTubeApiError):
        c.get_video_snippet("MISSING")


def test_update_description_preserves_every_other_snippet_field(monkeypatch):
    def fake_get(url, params=None, headers=None, timeout=None):
        return _Resp(200, {"items": [{"id": "VID9", "snippet": {
            "title": "Live Trading Session — June 24, 2026",
            "description": "old", "categoryId": "22", "tags": ["trading"]}}]})
    put_seen = {}
    def fake_put(url, params=None, headers=None, json=None, timeout=None):
        put_seen.update(url=url, params=params, body=json, ct=headers.get("Content-Type"))
        return _Resp(200, {})
    monkeypatch.setattr(yc.httpx, "get", fake_get)
    monkeypatch.setattr(yc.httpx, "put", fake_put)
    c = yc.YouTubeClient(client_id="i", client_secret="s", refresh_token="r")
    monkeypatch.setattr(c, "_ensure_token", lambda: "AT")
    c.update_description("VID9", "new description with links")
    assert "videos" in put_seen["url"]
    assert put_seen["params"] == {"part": "snippet"}
    assert put_seen["body"]["id"] == "VID9"
    snippet = put_seen["body"]["snippet"]
    assert snippet["description"] == "new description with links"
    # Title is FINAL at insert — never touched by a description patch.
    assert snippet["title"] == "Live Trading Session — June 24, 2026"
    assert snippet["categoryId"] == "22"
    assert snippet["tags"] == ["trading"]


def test_update_description_raises_on_put_failure(monkeypatch):
    monkeypatch.setattr(yc.httpx, "get", lambda *a, **k: _Resp(200, {"items": [
        {"id": "VID9", "snippet": {"title": "T", "description": "old"}}]}))
    monkeypatch.setattr(yc.httpx, "put", lambda *a, **k: _Resp(500, text="server error"))
    c = yc.YouTubeClient(client_id="i", client_secret="s", refresh_token="r")
    monkeypatch.setattr(c, "_ensure_token", lambda: "AT")
    with pytest.raises(yc.YouTubeApiError):
        c.update_description("VID9", "new")
