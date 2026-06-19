"""api/routers/desk.py — "The Desk" content hub API (Articles + Team).

Articles = the firm's Substack posts (link-out cards) pulled from admin-configured
RSS feeds. Team = "Meet the Team" member cards with uploaded photos.

Reads are paid (pro/premium/lifetime) + admin. Writes are admin-only. (Videos
keep their own /api/education/* router; Posts reuse /api/tweets/feed?official=1.)

Routes:
    GET    /api/desk/articles                  → newest Substack posts          (paid)
    GET    /api/desk/publications              → configured feeds               (admin)
    POST   /api/desk/publications              → add a feed + poll it now        (admin)
    PATCH  /api/desk/publications/{id}         → edit (name/enabled/order)       (admin)
    DELETE /api/desk/publications/{id}         → remove feed + its posts         (admin)
    POST   /api/desk/publications/{id}/poll    → force re-poll                   (admin)
    GET    /api/desk/team                      → team members                    (paid)
    POST   /api/desk/team                      → add member                      (admin)
    PATCH  /api/desk/team/{id}                 → edit member                     (admin)
    DELETE /api/desk/team/{id}                 → remove member + photo           (admin)
    POST   /api/desk/team/{id}/photo           → upload member photo             (admin)
    GET    /api/desk/team/{id}/photo           → serve member photo              (public)
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from api.middleware.auth_middleware import (
    get_current_user_with_plan,
    is_paid_user,
    require_admin,
)
from api.services import desk_store

router = APIRouter(prefix="/api/desk", tags=["desk"])

TEAM_PHOTO_DIR = Path(os.environ.get("DESK_PHOTO_DIR", "/data/team_photos"))
MAX_PHOTO_SIZE = 4 * 1024 * 1024  # 4 MB
ALLOWED_PHOTO_TYPES = {"image/jpeg", "image/png", "image/webp"}
_TRANSPARENT_PIXEL = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
    b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
    b"\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The Desk requires a paid plan")
    return user


# ── Pydantic payloads ──────────────────────────────────────────────────────────

class PublicationIn(BaseModel):
    name: str
    feed_url: str
    sort_order: Optional[int] = 0


class PublicationPatch(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    sort_order: Optional[int] = None


class MemberIn(BaseModel):
    name: str
    role: Optional[str] = None
    bio: Optional[str] = None
    years_trading: Optional[str] = None
    trading_style: Optional[str] = None
    teaching_focus: Optional[str] = None
    twitter_url: Optional[str] = None
    substack_url: Optional[str] = None
    email: Optional[str] = None
    link_url: Optional[str] = None
    sort_order: Optional[int] = 0
    enabled: Optional[bool] = True


class MemberPatch(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    bio: Optional[str] = None
    years_trading: Optional[str] = None
    trading_style: Optional[str] = None
    teaching_focus: Optional[str] = None
    twitter_url: Optional[str] = None
    substack_url: Optional[str] = None
    email: Optional[str] = None
    link_url: Optional[str] = None
    sort_order: Optional[int] = None
    enabled: Optional[bool] = None


# ── Articles (Substack) ──────────────────────────────────────────────────────────

@router.get("/articles")
def get_articles(limit: int = 500, _user: dict = Depends(require_paid)):
    limit = max(1, min(int(limit), 1000))
    return {"articles": desk_store.list_posts(limit=limit)}


@router.get("/publications")
def get_publications(_admin: dict = Depends(require_admin)):
    return {"publications": desk_store.list_publications()}


@router.post("/publications")
def add_publication(body: PublicationIn, _admin: dict = Depends(require_admin)):
    name = (body.name or "").strip()
    feed_url = (body.feed_url or "").strip()
    if not name:
        raise HTTPException(400, "name required")
    if not feed_url.startswith(("http://", "https://")):
        raise HTTPException(400, "feed_url must be an http(s) URL")
    pub = desk_store.create_publication(name, feed_url, body.sort_order or 0)
    # Poll immediately so the section isn't empty after adding.
    try:
        from api.services import substack_poller
        substack_poller.poll_publication(pub)
    except Exception:
        pass
    return pub


@router.patch("/publications/{pub_id}")
def edit_publication(pub_id: int, body: PublicationPatch, _admin: dict = Depends(require_admin)):
    updated = desk_store.update_publication(pub_id, body.model_dump(exclude_unset=True))
    if not updated:
        raise HTTPException(404, "Publication not found")
    return updated


@router.delete("/publications/{pub_id}")
def remove_publication(pub_id: int, _admin: dict = Depends(require_admin)):
    desk_store.delete_posts_for_publication(pub_id)
    if not desk_store.delete_publication(pub_id):
        raise HTTPException(404, "Publication not found")
    return {"ok": True}


@router.post("/publications/{pub_id}/poll")
def poll_publication(pub_id: int, _admin: dict = Depends(require_admin)):
    pub = desk_store.get_publication(pub_id)
    if not pub:
        raise HTTPException(404, "Publication not found")
    from api.services import substack_poller
    return substack_poller.poll_publication(pub)


# ── Team ─────────────────────────────────────────────────────────────────────────

@router.get("/team")
def get_team(_user: dict = Depends(require_paid)):
    return {"team": desk_store.list_team(enabled_only=False)}


@router.post("/team")
def add_member(body: MemberIn, _admin: dict = Depends(require_admin)):
    if not (body.name or "").strip():
        raise HTTPException(400, "name required")
    return desk_store.create_member(body.model_dump())


@router.patch("/team/{member_id}")
def edit_member(member_id: int, body: MemberPatch, _admin: dict = Depends(require_admin)):
    updated = desk_store.update_member(member_id, body.model_dump(exclude_unset=True))
    if not updated:
        raise HTTPException(404, "Member not found")
    return updated


@router.delete("/team/{member_id}")
def remove_member(member_id: int, _admin: dict = Depends(require_admin)):
    if not desk_store.delete_member(member_id):
        raise HTTPException(404, "Member not found")
    photo = TEAM_PHOTO_DIR / f"{member_id}.webp"
    if photo.exists():
        try:
            os.remove(photo)
        except OSError:
            pass
    return {"ok": True}


@router.post("/team/{member_id}/photo")
async def upload_member_photo(member_id: int, file: UploadFile = File(...),
                              _admin: dict = Depends(require_admin)):
    if not desk_store.get_member(member_id):
        raise HTTPException(404, "Member not found")
    if file.content_type not in ALLOWED_PHOTO_TYPES:
        raise HTTPException(400, "Only JPEG, PNG, and WebP images are allowed")
    data = await file.read()
    if len(data) > MAX_PHOTO_SIZE:
        raise HTTPException(400, "Image must be under 4 MB")
    from PIL import Image
    import io
    img = Image.open(io.BytesIO(data)).convert("RGB")
    img.thumbnail((512, 512), Image.LANCZOS)
    TEAM_PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=85)
    (TEAM_PHOTO_DIR / f"{member_id}.webp").write_bytes(buf.getvalue())
    desk_store.set_member_photo(member_id, True)
    return {"ok": True, "url": f"/api/desk/team/{member_id}/photo"}


def _handle_from_url(url: str) -> str:
    """Extract the bare X handle from a profile URL (or a bare handle)."""
    url = (url or "").strip().rstrip("/")
    if not url:
        return ""
    return url.split("/")[-1].lstrip("@")


def _store_avatar_from_x(member_id: int, twitter_url: str) -> str:
    """Pull the member's X profile picture, convert to WebP, store as their photo.
    Returns "" on success or a short reason string on failure. Best-effort."""
    handle = _handle_from_url(twitter_url)
    if not handle:
        return "no handle"
    import io
    import requests as _requests
    from PIL import Image
    from api.services import twitterapi_io
    try:
        img_url = twitterapi_io.get_user_profile_image(handle)
    except twitterapi_io.TwitterApiConfigError:
        return "twitter api not configured"
    except twitterapi_io.TwitterApiError as e:
        return f"twitter api: {type(e).__name__}"
    if not img_url:
        return "no avatar found"
    try:
        resp = _requests.get(img_url, timeout=15)
        if resp.status_code != 200 or not resp.content:
            return f"download HTTP {resp.status_code}"
        img = Image.open(io.BytesIO(resp.content)).convert("RGB")
        img.thumbnail((512, 512), Image.LANCZOS)
        TEAM_PHOTO_DIR.mkdir(parents=True, exist_ok=True)
        buf = io.BytesIO()
        img.save(buf, format="WEBP", quality=85)
        (TEAM_PHOTO_DIR / f"{member_id}.webp").write_bytes(buf.getvalue())
        desk_store.set_member_photo(member_id, True)
        return ""
    except Exception as e:  # noqa: BLE001 — best-effort, report and move on
        return f"store error: {e}"


@router.post("/team/{member_id}/photo-from-x")
def member_photo_from_x(member_id: int, _admin: dict = Depends(require_admin)):
    """Pull a single member's avatar from their X handle (overwrites their photo)."""
    member = desk_store.get_member(member_id)
    if not member:
        raise HTTPException(404, "Member not found")
    reason = _store_avatar_from_x(member_id, member.get("twitter_url") or "")
    if reason:
        raise HTTPException(400, reason)
    return {"ok": True, "url": f"/api/desk/team/{member_id}/photo"}


@router.post("/team/refresh-photos-from-x")
def refresh_team_photos_from_x(only_missing: bool = True,
                               _admin: dict = Depends(require_admin)):
    """Bulk-pull X avatars for every member with a handle. By default only fills
    members who have no photo yet (only_missing=1); pass only_missing=0 to refresh
    all of them. Best-effort per member — one failure never aborts the batch."""
    updated, skipped, failures = 0, 0, []
    for m in desk_store.list_team():
        if only_missing and m.get("has_photo"):
            skipped += 1
            continue
        if not (m.get("twitter_url") or "").strip():
            skipped += 1
            continue
        reason = _store_avatar_from_x(m["id"], m["twitter_url"])
        if reason:
            failures.append({"name": m.get("name"), "reason": reason})
        else:
            updated += 1
    return {"updated": updated, "skipped": skipped,
            "failed": len(failures), "failures": failures}


@router.get("/team/{member_id}/photo")
def get_member_photo(member_id: int):
    path = TEAM_PHOTO_DIR / f"{member_id}.webp"
    if path.exists():
        return FileResponse(path, media_type="image/webp",
                            headers={"Cache-Control": "public, max-age=300"})
    return Response(content=_TRANSPARENT_PIXEL, media_type="image/png")
