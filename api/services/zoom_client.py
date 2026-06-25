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
        # download_token (from the webhook) authorizes the file URL directly.
        url = download_url
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        with httpx.stream("GET", url, headers=headers, follow_redirects=True, timeout=None) as r:
            if r.status_code != 200:
                raise ZoomApiError(f"download {r.status_code}")
            with open(dest_path, "wb") as f:
                for chunk in r.iter_bytes(chunk_size=1024 * 1024):
                    f.write(chunk)
        return dest_path

    def delete_recording(self, meeting_uuid: str) -> None:
        token = self._ensure_token()
        # Double-encode the UUID per Zoom's rule if it contains / or //.
        import urllib.parse as _u
        uid = meeting_uuid
        if "/" in uid or uid.startswith("/"):
            uid = _u.quote(_u.quote(uid, safe=""), safe="")
        resp = httpx.delete(f"{_API}/meetings/{uid}/recordings",
            headers={"Authorization": f"Bearer {token}"},
            params={"action": "trash"}, timeout=20)
        if resp.status_code not in (200, 204):
            raise ZoomApiError(f"delete {resp.status_code}: {resp.text[:200]}")
