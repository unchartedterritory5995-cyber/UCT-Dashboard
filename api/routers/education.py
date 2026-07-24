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

import os
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel

from api.middleware.auth_middleware import (
    get_current_user_with_plan,
    is_paid_user,
    require_admin,
)
from api.services import data_sync
from api.services import education_service as svc

router = APIRouter(prefix="/api/education", tags=["education"])


# ── Library-wide insights backfill (PUSH_SECRET; used by the local caption
#    fetcher — YouTube blocks caption scraping from cloud IPs, so cues are
#    fetched + generated off-box and pushed here for storage). ────────────────────

def require_push_secret(authorization: str = Header(default="")) -> None:
    secret = os.environ.get("PUSH_SECRET", "")
    token = authorization[7:] if authorization.lower().startswith("bearer ") else ""
    if not secret or token != secret:
        raise HTTPException(status_code=401, detail="Unauthorized")


class InsightsStoreIn(BaseModel):
    transcript: Optional[str] = None
    chapters: Optional[list] = None
    ticker_moments: Optional[list] = None
    headline: Optional[str] = None
    summary: Optional[list] = None
    setups: Optional[list] = None


@router.get("/insights-backfill/pending")
def insights_backfill_pending(limit: int = 1000, _: None = Depends(require_push_secret)):
    """Videos still lacking AI insights (chapters) — the backfill work list."""
    return {"videos": svc.videos_without_chapters(limit)}


@router.get("/videos/{video_id}/transcript-cues")
def get_video_transcript_cues(video_id: int, _: None = Depends(require_push_secret)):
    """Stored transcript cues for a video (PUSH_SECRET — feeds the local key-levels
    pass off the already-captured transcript, no caption re-fetch)."""
    return {"cues": svc.get_transcript_cues(video_id)}


@router.get("/insights-backfill/needs-posters")
def insights_backfill_needs_posters(limit: int = 1000, _: None = Depends(require_push_secret)):
    """Enriched videos lacking a recap poster — the poster-pass work list."""
    return {"videos": svc.videos_needing_posters(limit)}


@router.get("/insights-backfill/needs-setups")
def insights_backfill_needs_setups(limit: int = 1000, _: None = Depends(require_push_secret)):
    """Enriched videos with no setup tags yet — the setup-pass work list."""
    return {"videos": svc.videos_needing_setups(limit)}


@router.post("/videos/{video_id}/generate-poster")
def generate_video_poster(video_id: int, _: None = Depends(require_push_secret)):
    """Render the branded recap poster from a video's stored insights (same as the
    Zoom pipeline) so backfilled videos match the session standard. Server-side."""
    from api.services import desk_recap_poster, desk_session_insights
    v = svc.get_video(int(video_id))
    if not v:
        raise HTTPException(status_code=404, detail="Video not found")
    ins = svc.get_insights(int(video_id))
    tickers = list(dict.fromkeys(
        t["ticker"] for t in ins.get("ticker_moments", []) if t.get("ticker")))
    try:
        desk_recap_poster.save_recap_poster(
            int(video_id),
            title=v.get("title") or "Session Recap",
            date_text=desk_session_insights._recap_date(v.get("title") or ""),
            headline=ins.get("headline", ""),
            summary=ins.get("summary", []),
            tickers=tickers,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"poster render failed: {e}")
    svc.set_video_insights(int(video_id), poster=True)
    return {"poster": True}


@router.post("/videos/{video_id}/insights-store")
def insights_store(video_id: int, body: InsightsStoreIn, _: None = Depends(require_push_secret)):
    """Store insights generated off-box for a library video. poster stays as-is
    (educational videos have no session-recap poster)."""
    svc.set_video_insights(
        int(video_id),
        transcript=body.transcript,
        chapters=body.chapters,
        ticker_moments=body.ticker_moments,
        headline=body.headline,
        summary=body.summary,
        setups=body.setups,
    )
    return {"ok": True,
            "chapters": len(body.chapters or []),
            "tickers": len(body.ticker_moments or [])}


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


@router.get("/by-youtube/{youtube_id}")
def get_video_by_youtube(youtube_id: str, _user: dict = Depends(require_paid)):
    """Resolve a library video from its 11-char YouTube id — lets surfaces that
    only hold a YouTube URL (e.g. a Notebook video-note's hero) find the Desk
    video and reuse its insights/transcript endpoints. `video` is null when the
    id isn't in the library (a plain external video)."""
    v = svc.get_video_by_youtube_id(youtube_id)
    if not v:
        return {"video": None}
    return {"video": {"id": v["id"], "title": v.get("title"),
                      "youtube_id": v.get("youtube_id")}}


@router.get("/videos/{video_id}/insights")
def get_video_insights(video_id: int, _user: dict = Depends(require_paid)):
    """AI chapters + ticker-moments + recap (headline/summary/poster) for a
    video's player chrome. Empty when not generated yet (or for non-session
    videos) — the client renders-or-skips cleanly."""
    out = svc.get_insights(video_id)
    out["poster_url"] = (
        f"/api/education/videos/{video_id}/poster" if out.get("has_poster") else None
    )
    return out


@router.get("/videos/{video_id}/related")
def get_related_videos(video_id: int, _user: dict = Depends(require_paid)):
    """Other library videos that covered any of this video's tickers."""
    return {"videos": svc.related_videos_by_ticker(video_id)}


def _community_enabled() -> bool:
    return os.environ.get("COMMUNITY_ENABLED", "0") == "1"


@router.get("/videos/{video_id}/community-thread")
def get_video_thread(video_id: int, _user: dict = Depends(require_paid)):
    """Whether Community is on + the existing discussion thread id (no create)."""
    tid = None
    if _community_enabled():
        try:
            from api.services import community_store
            t = community_store.get_thread_by_desk_id(int(video_id))
            tid = t["id"] if t else None
        except Exception:
            tid = None
    return {"enabled": _community_enabled(), "thread_id": tid}


@router.post("/videos/{video_id}/community-thread")
def create_video_thread(video_id: int, _user: dict = Depends(require_paid)):
    """Create-if-missing the discussion thread for a video (on 'Discuss' click)."""
    if not _community_enabled():
        raise HTTPException(status_code=403, detail="Community is not enabled")
    from api.services import community_seed
    tid = community_seed.upsert_desk_thread(int(video_id))
    if not tid:
        raise HTTPException(status_code=500, detail="Could not open a thread for this video")
    return {"thread_id": tid}


@router.get("/videos/{video_id}/transcript")
def get_video_transcript(video_id: int, _user: dict = Depends(require_paid)):
    """Timed transcript cues [{t, text}] for search-and-seek. Empty list when a
    video has no captured transcript (non-session or not yet processed)."""
    return {"cues": svc.get_transcript_cues(video_id)}


@router.get("/videos/{video_id}/poster")
def get_video_poster(video_id: int, _user: dict = Depends(require_paid)):
    """Serve the branded session-recap poster PNG (rendered from the transcript
    summary). 404 until generated."""
    from api.services import desk_recap_poster
    path = desk_recap_poster.poster_path(video_id)
    if not os.path.exists(path):
        raise HTTPException(404, "No recap poster for this video")
    return FileResponse(path, media_type="image/png")


@router.get("/videos/{video_id}/audio")
def get_video_audio(video_id: int, _user: dict = Depends(require_paid)):
    """Redirect to the presigned R2 URL for a session's background audio track
    (desk background-audio feature). The R2 key is deterministic
    (`desk_audio/<youtube_id>.m4a`), so this serves by that key + an R2
    existence check rather than gating on the stamped `audio_url` column —
    a one-time local backfill can upload audio to the shared bucket without
    ever stamping production's `education.db` row. 404 when the video is
    missing, no object exists at the key, or R2 is unconfigured/unreachable."""
    row = svc.get_video(video_id)
    if not row:
        raise HTTPException(404, "No background audio for this video")
    key = row.get("audio_url") or f"desk_audio/{row['youtube_id']}.m4a"
    if not data_sync.object_exists(key):
        raise HTTPException(404, "No background audio for this video")
    url = data_sync.presigned_get(key, expires=8 * 3600)
    if not url:
        raise HTTPException(404, "Audio storage unavailable")
    return RedirectResponse(url, status_code=302)


# ── Per-user timestamped video notes (jot at MM:SS, jump back) ───────────────────

class VideoNoteIn(BaseModel):
    youtube_id: str
    t: int = 0          # playhead seconds
    text: str


@router.get("/video-notes")
def list_video_notes(youtube_id: str, user: dict = Depends(require_paid)):
    return {"notes": svc.list_video_notes(user["id"], youtube_id)}


@router.post("/video-notes")
def add_video_note(body: VideoNoteIn, user: dict = Depends(require_paid)):
    yt = extract_youtube_id(body.youtube_id) or (body.youtube_id or "").strip()
    if not (body.text or "").strip():
        raise HTTPException(400, "text required")
    note = svc.create_video_note(user["id"], yt, body.t, body.text)
    if not note:
        raise HTTPException(400, "Could not save note")
    return note


@router.delete("/video-notes/{note_id}")
def remove_video_note(note_id: int, user: dict = Depends(require_paid)):
    if not svc.delete_video_note(user["id"], note_id):
        raise HTTPException(404, "Note not found")
    return {"ok": True}


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
    created = svc.create_video(payload)
    try:  # seed a community discussion thread for the new video (non-fatal)
        from api.services import community_seed
        community_seed.upsert_desk_thread(created["id"])
    except Exception as ce:
        print(f"[education] community seed failed (non-fatal): {ce}")
    return created


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
