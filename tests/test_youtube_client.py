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


def test_upload_unlisted_returns_video_id(monkeypatch, tmp_path):
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
    vid = c.upload_unlisted(str(f), "Daily Session — June 24, 2026")
    assert vid == "VIDUP"
    assert captured["put_url"] == "https://up.example/session"
    assert captured["meta"]["status"]["privacyStatus"] == "unlisted"


def test_upload_unlisted_raises_on_init_failure(monkeypatch, tmp_path):
    f = tmp_path / "v.mp4"; f.write_bytes(b"x" * 10)
    monkeypatch.setattr(yc.httpx, "post", lambda *a, **k: _Resp(403, text="no"))
    c = yc.YouTubeClient(client_id="i", client_secret="s", refresh_token="r")
    monkeypatch.setattr(c, "_ensure_token", lambda: "AT")
    with pytest.raises(yc.YouTubeApiError):
        c.upload_unlisted(str(f), "t")
