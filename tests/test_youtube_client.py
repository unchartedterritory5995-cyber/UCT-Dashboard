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
    def __init__(self, status, payload=None, text=""):
        self.status_code = status
        self._payload = payload or {}
        self.text = text
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
