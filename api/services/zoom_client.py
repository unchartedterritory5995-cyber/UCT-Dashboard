"""Zoom Server-to-Server OAuth client (raw httpx). Streams a cloud recording
to disk and trashes it after upload. Never holds the file in RAM."""
from __future__ import annotations
import base64, os, time, httpx

_TOKEN_URL = "https://zoom.us/oauth/token"
_API = "https://api.zoom.us/v2"

class ZoomAuthError(Exception): ...
class ZoomApiError(Exception): ...

class ZoomClient:
    def __init__(self, account_id=None, client_id=None, client_secret=None):
        self.account_id = account_id if account_id is not None else os.environ.get("ZOOM_S2S_ACCOUNT_ID")
        self.client_id = client_id if client_id is not None else os.environ.get("ZOOM_S2S_CLIENT_ID")
        self.client_secret = client_secret if client_secret is not None else os.environ.get("ZOOM_S2S_CLIENT_SECRET")
        self._token = None; self._exp = 0.0

    def _ensure_token(self) -> str:
        if self._token and time.time() < self._exp - 60:
            return self._token
        if not (self.account_id and self.client_id and self.client_secret):
            raise ZoomAuthError("Zoom S2S OAuth env not configured")
        basic = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()
        resp = httpx.post(_TOKEN_URL,
            params={"grant_type": "account_credentials", "account_id": self.account_id},
            headers={"Authorization": f"Basic {basic}"}, timeout=15)
        if resp.status_code != 200:
            raise ZoomAuthError(f"zoom token {resp.status_code}: {resp.text[:200]}")
        data = resp.json()
        self._token = data["access_token"]; self._exp = time.time() + int(data.get("expires_in", 3600))
        return self._token

    def stream_download(self, download_url: str, token: str, dest_path: str) -> str:
        # download_token (from the webhook) authorizes the file URL directly, sent
        # as a Bearer header (Zoom deprecated the ?access_token= query param in 2023).
        url = download_url
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        with httpx.stream("GET", url, headers=headers, follow_redirects=True, timeout=None) as r:
            ct = (r.headers.get("content-type") or "").lower()
            if r.status_code != 200:
                body = r.read()[:300]
                raise ZoomApiError(f"download status {r.status_code} ct={ct} body={body!r}")
            # An auth/redirect failure returns a 200 HTML/JSON error page (e.g. a Zoom
            # sign-in page), not the MP4 -> YouTube can't process it. Reject it loudly
            # so the job errors instead of publishing a broken video.
            if ct.startswith(("text/html", "application/json", "application/xml", "text/plain")):
                body = r.read()[:300]
                raise ZoomApiError(f"download not a video (ct={ct}) body={body!r}")
            total = 0
            with open(dest_path, "wb") as f:
                for chunk in r.iter_bytes(chunk_size=1024 * 1024):
                    f.write(chunk); total += len(chunk)
        print(f"[desk-sessions] downloaded {total} bytes ct={ct!r} url_host={url.split('/')[2] if '://' in url else url[:40]}")
        if total < 1024:
            raise ZoomApiError(f"download too small ({total} bytes) ct={ct}")
        return dest_path

    @staticmethod
    def _encode_uuid(meeting_uuid: str) -> str:
        # Zoom rule: double-URL-encode a meeting UUID if it contains / or starts with /.
        import urllib.parse as _u
        uid = meeting_uuid
        if "/" in uid or uid.startswith("/"):
            uid = _u.quote(_u.quote(uid, safe=""), safe="")
        return uid

    def get_recording_files(self, meeting_uuid: str):
        """Fetch the recording's metadata (incl. recording_files[]). Returns the
        JSON dict, or None if Zoom no longer has it (404 — already trashed). The
        transcript is a recording_file with file_type 'TRANSCRIPT' (recording_type
        'audio_transcript'), generated ASYNC — it may be absent on early calls."""
        token = self._ensure_token()
        uid = self._encode_uuid(meeting_uuid)
        resp = httpx.get(f"{_API}/meetings/{uid}/recordings",
            headers={"Authorization": f"Bearer {token}"}, timeout=20)
        if resp.status_code == 404:
            return None
        if resp.status_code != 200:
            raise ZoomApiError(f"get recordings {resp.status_code}: {resp.text[:200]}")
        return resp.json()

    def download_text(self, download_url: str, max_bytes: int = 6_000_000) -> str:
        """Fetch a small text recording file (e.g. the VTT transcript) using the
        OAuth access token as Bearer. Bounded so a surprise large/binary file can't
        blow up memory. Returns the decoded text ('' on any non-200/empty)."""
        token = self._ensure_token()
        resp = httpx.get(download_url, headers={"Authorization": f"Bearer {token}"},
                         follow_redirects=True, timeout=60)
        if resp.status_code != 200:
            raise ZoomApiError(f"transcript download {resp.status_code}: {resp.text[:200]}")
        data = resp.content[:max_bytes]
        try:
            return data.decode("utf-8", errors="replace")
        except Exception:
            return ""

    def delete_recording(self, meeting_uuid: str) -> None:
        token = self._ensure_token()
        uid = self._encode_uuid(meeting_uuid)
        resp = httpx.delete(f"{_API}/meetings/{uid}/recordings",
            headers={"Authorization": f"Bearer {token}"},
            params={"action": "trash"}, timeout=20)
        if resp.status_code not in (200, 204):
            raise ZoomApiError(f"delete {resp.status_code}: {resp.text[:200]}")


def select_largest_mp4(recording_files: list[dict] | None) -> dict | None:
    """The ONE MP4-selection rule, shared by the webhook (desk_zoom_webhook.py,
    working off the webhook's own inline recording_files array) and the
    session-insights pass (desk_session_insights.py, working off a fresh
    GET /meetings/{uuid}/recordings fetch) — a second hand-written copy of
    this selection is how the two could silently pick DIFFERENT files.
    Largest MP4 wins: a stop/restart mid-webinar yields multiple MP4
    segments, and the tiny first clip must not shadow the real recording.
    Files without a file_size rank lowest, so an all-sizeless payload keeps
    first-MP4 order. Returns the whole file dict (download_url, id,
    recording_start, recording_end, ...) — never just one field, so a caller
    needing more than the URL doesn't re-implement the selection."""
    mp4s = [f for f in (recording_files or [])
            if (f.get("file_type") or "").upper() == "MP4" and f.get("download_url")]
    if not mp4s:
        return None
    return max(mp4s, key=lambda f: f.get("file_size") or 0)
