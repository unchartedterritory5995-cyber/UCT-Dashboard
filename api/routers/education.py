"""api/routers/education.py — Educational Videos API.

The firm's curated library of teaching videos, organized into categories. The
videos themselves live unlisted on YouTube; we store only the YouTube id +
metadata and the frontend embeds via youtube-nocookie.com.

Reads are gated to PAID (pro/premium/lifetime) + admin — this is premium
content. Writes (adding / editing / removing videos, building categories) are
admin-only. Mirrors the auth pattern in api/routers/modelbook.py.

Routes:
    GET    /api/education/videos              → {categories: [{name, videos[]}]}  (paid)
    GET    /api/education/categories          → ["Getting Started", ...]          (paid)
    POST   /api/education/videos              → add a video                       (admin)
    PATCH  /api/education/videos/{video_id}   → edit a video                      (admin)
    DELETE /api/education/videos/{video_id}   → remove a video                    (admin)
    POST   /api/education/reorder             → reorder a category                (admin)
"""
from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import (
    get_current_user_with_plan,
    is_paid_user,
    require_admin,
)
from api.services import education_service as svc

router = APIRouter(prefix="/api/education", tags=["education"])


# ── Access: paid (pro/premium/lifetime) + admin ────────────────────────────────

def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Dependency: gates reads to paid plans + admins (premium content)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Educational Videos require a paid plan")
    return user


# ── YouTube id extraction ──────────────────────────────────────────────────────

# Accepts a raw 11-char id OR any common YouTube URL form:
#   https://www.youtube.com/watch?v=ID   youtu.be/ID   /embed/ID   /shorts/ID
_YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_YT_URL_PATTERNS = (
    re.compile(r"(?:youtube\.com/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtu\.be/)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtube\.com/embed/)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtube\.com/shorts/)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtube\.com/live/)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtube\.com/watch/)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtube-nocookie\.com/embed/)([A-Za-z0-9_-]{11})"),
)


def extract_youtube_id(raw: str) -> Optional[str]:
    """Pull the 11-char YouTube id from a raw id or any common URL form. None if
    nothing valid is found."""
    s = (raw or "").strip()
    if not s:
        return None
    if _YT_ID.match(s):
        return s
    for pat in _YT_URL_PATTERNS:
        m = pat.search(s)
        if m:
            return m.group(1)
    return None


# ── Pydantic payloads ──────────────────────────────────────────────────────────

class VideoIn(BaseModel):
    youtube_url: str               # raw id OR any YouTube URL form
    title: str
    description: Optional[str] = None
    category: Optional[str] = "General"
    duration: Optional[str] = None
    sort_order: Optional[int] = 0


class VideoPatch(BaseModel):
    youtube_url: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    duration: Optional[str] = None
    sort_order: Optional[int] = None


class ReorderIn(BaseModel):
    category: str
    ordered_ids: list[int]


# ── Reads (paid) ───────────────────────────────────────────────────────────────

@router.get("/videos")
def get_videos(_user: dict = Depends(require_paid)):
    """All videos grouped by category, ready for the library view."""
    videos = svc.list_videos()
    by_cat: dict[str, list] = {}
    order: list[str] = []
    for v in videos:
        cat = v.get("category") or "General"
        if cat not in by_cat:
            by_cat[cat] = []
            order.append(cat)
        by_cat[cat].append(v)
    return {"categories": [{"name": c, "videos": by_cat[c]} for c in order],
            "total": len(videos)}


@router.get("/categories")
def get_categories(_user: dict = Depends(require_paid)):
    return {"categories": svc.list_categories()}


@router.get("/videos/{video_id}/insights")
def get_video_insights(video_id: int, _user: dict = Depends(require_paid)):
    """AI chapters + ticker-moments for a video's player chrome (chapter rail,
    scrubber markers, clickable ticker chips). Empty arrays when not generated
    yet (or for non-session videos) — the client renders-or-skips cleanly."""
    return svc.get_insights(video_id)


# ── Writes (admin) ─────────────────────────────────────────────────────────────

@router.post("/videos")
def add_video(body: VideoIn, _admin: dict = Depends(require_admin)):
    yt = extract_youtube_id(body.youtube_url)
    if not yt:
        raise HTTPException(400, "Could not find a YouTube video id in that link")
    if not (body.title or "").strip():
        raise HTTPException(400, "title required")
    payload = body.model_dump()
    payload["youtube_id"] = yt
    return svc.create_video(payload)


@router.patch("/videos/{video_id}")
def edit_video(video_id: int, body: VideoPatch, _admin: dict = Depends(require_admin)):
    payload = body.model_dump(exclude_unset=True)
    if "youtube_url" in payload:
        yt = extract_youtube_id(payload.pop("youtube_url"))
        if not yt:
            raise HTTPException(400, "Could not find a YouTube video id in that link")
        payload["youtube_id"] = yt
    updated = svc.update_video(video_id, payload)
    if not updated:
        raise HTTPException(404, "Video not found")
    return updated


@router.delete("/videos/{video_id}")
def remove_video(video_id: int, _admin: dict = Depends(require_admin)):
    if not svc.delete_video(video_id):
        raise HTTPException(404, "Video not found")
    return {"ok": True}


@router.post("/reorder")
def reorder(body: ReorderIn, _admin: dict = Depends(require_admin)):
    svc.reorder_category(body.category, body.ordered_ids)
    return {"ok": True}


# ── Watch progress (cross-device; any paid user) ────────────────────────────────

class ProgressIn(BaseModel):
    youtube_id: str
    position: int            # seconds watched
    duration: Optional[int] = 0
    done: Optional[bool] = False


@router.get("/progress")
def get_progress(user: dict = Depends(require_paid)):
    """The current user's watch progress across all videos (for resume / Continue
    Watching / ✓ checkmarks). Shape mirrors the client store."""
    rows = svc.get_user_progress(user["id"])
    return {
        "progress": [
            {
                "youtube_id": r["youtube_id"],
                "t": r["position"],
                "d": r["duration"],
                "done": bool(r["done"]),
                "at": r["updated_at"] * 1000,  # ms, to match client timestamps
            }
            for r in rows
        ]
    }


@router.post("/progress")
def post_progress(body: ProgressIn, user: dict = Depends(require_paid)):
    svc.upsert_progress(
        user["id"], body.youtube_id, body.position,
        duration=body.duration or 0, done=bool(body.done),
    )
    return {"ok": True}
