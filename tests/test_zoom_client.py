import os, tempfile, pytest
from api.services import zoom_client as zc

class _Resp:
    def __init__(self, status, payload=None, text="", chunks=None, headers=None):
        self.status_code = status; self._p = payload or {}; self.text = text
        self._chunks = chunks or []; self.headers = headers or {}
    def json(self): return self._p
    def raise_for_status(self): pass
    def read(self): return b"".join(self._chunks)
    def iter_bytes(self, chunk_size=1024):
        for ch in self._chunks: yield ch
    def __enter__(self): return self
    def __exit__(self, *a): return False

def test_ensure_token_raises_when_unconfigured():
    c = zc.ZoomClient(account_id=None, client_id=None, client_secret=None)
    with pytest.raises(zc.ZoomAuthError):
        c._ensure_token()

def test_stream_download_writes_file(monkeypatch):
    body = b"MP4DATA" + b"x" * 4000  # > 1KB, video-ish content-type
    monkeypatch.setattr(zc.httpx, "stream",
        lambda *a, **k: _Resp(200, chunks=[body], headers={"content-type": "video/mp4"}))
    c = zc.ZoomClient(account_id="a", client_id="i", client_secret="s")
    with tempfile.TemporaryDirectory() as d:
        dest = os.path.join(d, "v.mp4")
        c.stream_download("https://x.zoom.us/rec/download/abc", "tok", dest)
        assert open(dest, "rb").read() == body

def test_stream_download_rejects_html_error_page(monkeypatch):
    # An auth/redirect failure returns a 200 HTML page, not the MP4.
    monkeypatch.setattr(zc.httpx, "stream",
        lambda *a, **k: _Resp(200, chunks=[b"<!DOCTYPE html><html>sign in</html>"],
                              headers={"content-type": "text/html; charset=utf-8"}))
    c = zc.ZoomClient(account_id="a", client_id="i", client_secret="s")
    with tempfile.TemporaryDirectory() as d:
        with pytest.raises(zc.ZoomApiError):
            c.stream_download("https://x.zoom.us/rec/download/abc", "tok", os.path.join(d, "v.mp4"))

def test_stream_download_rejects_tiny_file(monkeypatch):
    monkeypatch.setattr(zc.httpx, "stream",
        lambda *a, **k: _Resp(200, chunks=[b"tiny"], headers={"content-type": "video/mp4"}))
    c = zc.ZoomClient(account_id="a", client_id="i", client_secret="s")
    with tempfile.TemporaryDirectory() as d:
        with pytest.raises(zc.ZoomApiError):
            c.stream_download("https://x.zoom.us/rec/download/abc", "tok", os.path.join(d, "v.mp4"))

def test_delete_recording_calls_api(monkeypatch):
    seen = {}
    monkeypatch.setattr(zc.httpx, "post", lambda *a, **k: _Resp(200, {"access_token": "AT", "expires_in": 3600}))
    def fake_delete(url, headers=None, params=None, timeout=None):
        seen["url"] = url; return _Resp(204)
    monkeypatch.setattr(zc.httpx, "delete", fake_delete)
    c = zc.ZoomClient(account_id="a", client_id="i", client_secret="s")
    c.delete_recording("U1")
    assert "U1" in seen["url"]
