"""Thin YouTube Data API v3 client (raw httpx, no Google SDK).

Refreshes an OAuth access token from a stored refresh token, then lists the
channel's COMPLETED live broadcasts (works for unlisted, which the public RSS
feed hides). Used by desk_daily_session to find the day's archived webinar.
"""
from __future__ import annotations

import os
import time
import httpx

_TOKEN_URL = "https://oauth2.googleapis.com/token"
_BROADCASTS_URL = "https://www.googleapis.com/youtube/v3/liveBroadcasts"
_THUMBNAIL_URL = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set"
_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos"

# The privacyStatus values the Data API accepts. Used to reject a typo at the
# call site instead of letting YouTube silently apply its own default.
_PRIVACY_STATUSES = frozenset({"private", "unlisted", "public"})


class YouTubeAuthError(Exception):
    """OAuth not configured or token refresh failed."""


class YouTubeApiError(Exception):
    """liveBroadcasts.list returned a non-200."""


def _parse_broadcasts(payload: dict) -> list[dict]:
    """Pure: normalize a liveBroadcasts.list response into our item shape.

    The liveBroadcast `id` IS the archived video id. Date prefers the real
    start, then the scheduled start, then publishedAt."""
    out: list[dict] = []
    for item in (payload or {}).get("items", []):
        vid = (item.get("id") or "").strip()
        if not vid:
            continue
        snip = item.get("snippet", {}) or {}
        out.append({
            "video_id": vid,
            "title": snip.get("title", "") or "",
            "started_at": (snip.get("actualStartTime")
                           or snip.get("scheduledStartTime")
                           or snip.get("publishedAt")),
            "privacy": (item.get("status", {}) or {}).get("privacyStatus"),
        })
    return out


class YouTubeClient:
    def __init__(self, client_id: str | None = None,
                 client_secret: str | None = None,
                 refresh_token: str | None = None):
        self.client_id = client_id if client_id is not None else os.environ.get("YT_OAUTH_CLIENT_ID")
        self.client_secret = client_secret if client_secret is not None else os.environ.get("YT_OAUTH_CLIENT_SECRET")
        self.refresh_token = refresh_token if refresh_token is not None else os.environ.get("YT_OAUTH_REFRESH_TOKEN")
        self._access_token: str | None = None
        self._token_exp: float = 0.0

    def _ensure_token(self) -> str:
        if self._access_token and time.time() < self._token_exp - 60:
            return self._access_token
        if not (self.client_id and self.client_secret and self.refresh_token):
            raise YouTubeAuthError("YouTube OAuth env not configured")
        resp = httpx.post(_TOKEN_URL, data={
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "refresh_token": self.refresh_token,
            "grant_type": "refresh_token",
        }, timeout=15)
        if resp.status_code != 200:
            raise YouTubeAuthError(f"token refresh {resp.status_code}: {resp.text[:200]}")
        data = resp.json()
        self._access_token = data["access_token"]
        self._token_exp = time.time() + int(data.get("expires_in", 3600))
        return self._access_token

    def upload(self, file_path: str, title: str, description: str = "",
               privacy: str = "unlisted") -> str:
        """Resumable upload of a local file. Streams the bytes from disk (no
        full-file RAM load). Returns the new videoId.

        `privacy` defaults to **unlisted** because most shows on this account are
        paywalled — a caller that forgets to pass it can only ever under-share.
        An unrecognised value raises rather than reaching YouTube, which would
        otherwise coerce a typo like "pubic" to its own default and leave the
        caller believing it had set something.
        """
        if privacy not in _PRIVACY_STATUSES:
            raise ValueError(
                f"privacy must be one of {sorted(_PRIVACY_STATUSES)}, got {privacy!r}")
        token = self._ensure_token()
        size = os.path.getsize(file_path)
        meta = {"snippet": {"title": title, "description": description},
                "status": {"privacyStatus": privacy, "selfDeclaredMadeForKids": False}}
        init = httpx.post(_UPLOAD_URL,
            params={"uploadType": "resumable", "part": "snippet,status"},
            headers={"Authorization": f"Bearer {token}",
                     "X-Upload-Content-Type": "video/*",
                     "X-Upload-Content-Length": str(size)},
            json=meta, timeout=30)
        if init.status_code not in (200, 201):
            raise YouTubeApiError(f"upload init {init.status_code}: {init.text[:200]}")
        session_url = init.headers.get("location") or init.headers.get("Location")
        if not session_url:
            raise YouTubeApiError("upload init: no resumable session URL")
        with open(file_path, "rb") as fh:
            put = httpx.put(session_url, content=fh,
                headers={"Content-Type": "video/*", "Content-Length": str(size)},
                timeout=None)
        if put.status_code not in (200, 201):
            raise YouTubeApiError(f"upload put {put.status_code}: {put.text[:200]}")
        return put.json()["id"]

    def set_thumbnail(self, video_id: str, image_bytes: bytes) -> None:
        """Set a custom thumbnail (JPEG bytes) on a video. The youtube.upload
        scope covers thumbnails.set; the channel must be eligible for custom
        thumbnails (it is, via phone verification)."""
        token = self._ensure_token()
        resp = httpx.post(_THUMBNAIL_URL,
            params={"videoId": video_id, "uploadType": "media"},
            headers={"Authorization": f"Bearer {token}", "Content-Type": "image/jpeg"},
            content=image_bytes, timeout=30)
        if resp.status_code not in (200, 201):
            raise YouTubeApiError(f"thumbnail set {resp.status_code}: {resp.text[:200]}")

    def list_completed_broadcasts(self, max_results: int = 10) -> list[dict]:
        token = self._ensure_token()
        resp = httpx.get(_BROADCASTS_URL, params={
            "part": "snippet,status",
            "broadcastStatus": "completed",
            "broadcastType": "all",
            "maxResults": max_results,
            "mine": "true",
        }, headers={"Authorization": f"Bearer {token}"}, timeout=20)
        if resp.status_code != 200:
            raise YouTubeApiError(f"liveBroadcasts.list {resp.status_code}: {resp.text[:200]}")
        return _parse_broadcasts(resp.json())
