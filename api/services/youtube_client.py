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
