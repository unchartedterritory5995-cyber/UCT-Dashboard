# api/routers/community.py
"""The Floor — community forum API.

Spec: docs/superpowers/specs/2026-07-09-community-space-design.md
"""
import json
import os
from contextlib import closing as _closing

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import (
    get_current_user,
    get_current_user_with_plan,
    is_paid_user,
    require_admin,
)
from api.services import community_store as store

router = APIRouter(prefix="/api/community", tags=["community"])

MAX_BODY_BYTES = 50_000
THREADS_PER_HOUR = int(os.environ.get("COMMUNITY_THREADS_PER_HOUR", "5"))
POSTS_PER_HOUR = int(os.environ.get("COMMUNITY_POSTS_PER_HOUR", "30"))


def _enabled() -> bool:
    return os.environ.get("COMMUNITY_ENABLED", "0") == "1"


def require_community(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not _enabled():
        raise HTTPException(status_code=503, detail="Community is not enabled")
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The Floor requires a paid plan")
    return user


def _is_mentor(user: dict) -> bool:
    return user.get("role") == "admin"


_MENTOR_AUTHOR = {"name": "UCT Mentor", "is_mentor": True}


def _author_map(ids):
    ids = sorted({i for i in ids if i})
    if not ids:
        return {}
    try:
        from api.services.auth_db import get_connection as _auth_conn
        q = ",".join("?" * len(ids))
        with _closing(_auth_conn()) as conn:
            rows = conn.execute(
                f"SELECT id, display_name, email, role FROM users WHERE id IN ({q})",
                ids).fetchall()
        return {r["id"]: {"name": r["display_name"]
                                  or (r["email"] or "member").split("@")[0],
                          "is_mentor": r["role"] == "admin"}
                for r in rows}
    except Exception:
        return {}


def _attach_authors(items):
    amap = _author_map([i.get("author_id") for i in items])
    for i in items:
        aid = i.get("author_id")
        i["author"] = dict(_MENTOR_AUTHOR) if aid is None else \
            amap.get(aid, {"name": "member", "is_mentor": False})
    return items


@router.get("/status")
def status(user: dict = Depends(get_current_user)):
    enabled = _enabled()
    return {
        "enabled": enabled,
        "acked": store.has_ack(user["id"]) if enabled else False,
        "is_mentor": _is_mentor(user),
        "muted": store.is_muted(user["id"]) if enabled else False,
    }


@router.get("/spaces")
def spaces(user: dict = Depends(require_community)):
    unread = store.unread_summary(user["id"])["by_space"]
    return [
        {"key": k, "label": v["label"], "mentor_only": v["mentor_only"],
         "unread": unread.get(k, 0)}
        for k, v in store.SPACES.items()
    ]


@router.get("/unread")
def unread(user: dict = Depends(require_community)):
    return store.unread_summary(user["id"])


@router.get("/threads")
def threads(space: str = Query(...), limit: int = Query(50, ge=1, le=100),
            offset: int = Query(0, ge=0),
            user: dict = Depends(require_community)):
    if space not in store.SPACES:
        raise HTTPException(status_code=400, detail="Unknown space")
    return {"threads": _attach_authors(store.list_threads(space, limit=limit, offset=offset))}


@router.get("/desk-threads")
def desk_threads(ids: str = Query(""), user: dict = Depends(require_community)):
    out = {}
    for raw in ids.split(",")[:100]:
        raw = raw.strip()
        if not raw.isdigit():
            continue
        t = store.get_thread_by_desk_id(int(raw))
        if not t or t.get("deleted"):
            continue
        detail = store.list_threads(t["space"], limit=1000)
        match = next((x for x in detail if x["id"] == t["id"]), None)
        out[raw] = {"thread_id": t["id"],
                    "reply_count": match["reply_count"] if match else 0}
    return out


@router.get("/threads/{thread_id}")
def thread_detail(thread_id: int, user: dict = Depends(require_community)):
    t = store.get_thread(thread_id)
    if not t:
        raise HTTPException(status_code=404, detail="Thread not found")
    _attach_authors([t])
    _attach_authors(t["posts"])
    return t


from pydantic import BaseModel


class ThreadIn(BaseModel):
    space: str
    title: str
    body: str = ""
    ticker_tags: list[str] | None = None


class PostIn(BaseModel):
    body: str
    parent_post_id: int | None = None


class ReactionIn(BaseModel):
    kind: str


class ReadIn(BaseModel):
    last_seen_post_id: int


class ReportIn(BaseModel):
    thread_id: int | None = None
    post_id: int | None = None
    reason: str = ""


class ModIn(BaseModel):
    pinned: bool | None = None
    locked: bool | None = None
    answered: bool | None = None


class HighlightIn(BaseModel):
    value: bool


class ReportActionIn(BaseModel):
    action: str  # hide | dismiss


class MuteIn(BaseModel):
    muted: bool


def _validate_body(body: str) -> str:
    body = body or ""
    if len(body.encode("utf-8", "ignore")) > MAX_BODY_BYTES:
        raise HTTPException(status_code=400, detail="Body too large")
    if body:
        try:
            doc = json.loads(body)
            if not isinstance(doc, dict):
                raise ValueError
        except ValueError:
            raise HTTPException(status_code=400, detail="Body must be TipTap JSON")
    return body


def _writer(user: dict) -> dict:
    """Gates shared by every write: disclaimer ack + not muted."""
    if not store.has_ack(user["id"]):
        raise HTTPException(status_code=403, detail="acknowledgment_required")
    if store.is_muted(user["id"]):
        raise HTTPException(status_code=403, detail="You are muted")
    return user


@router.post("/ack")
def ack(user: dict = Depends(require_community)):
    store.set_ack(user["id"])
    return {"ok": True}


@router.post("/threads")
def create_thread(body: ThreadIn, user: dict = Depends(require_community)):
    _writer(user)
    if body.space not in store.SPACES:
        raise HTTPException(status_code=400, detail="Unknown space")
    if store.SPACES[body.space]["mentor_only"] and not _is_mentor(user):
        raise HTTPException(status_code=403, detail="Mentor Desk threads are mentor-only")
    title = (body.title or "").strip()
    if not title or len(title) > 200:
        raise HTTPException(status_code=400, detail="Title required (max 200 chars)")
    if not _is_mentor(user) and store.count_recent_threads(user["id"]) >= THREADS_PER_HOUR:
        raise HTTPException(status_code=429, detail="Thread rate limit — try again later")
    tid = store.create_thread(
        body.space, user["id"], title, body=_validate_body(body.body),
        ticker_tags=[t.upper()[:8] for t in (body.ticker_tags or [])][:10])
    return {"id": tid}


@router.post("/threads/{thread_id}/posts")
def create_post(thread_id: int, body: PostIn, user: dict = Depends(require_community)):
    _writer(user)
    if not _is_mentor(user) and store.count_recent_posts(user["id"]) >= POSTS_PER_HOUR:
        raise HTTPException(status_code=429, detail="Post rate limit — try again later")
    try:
        pid = store.create_post(thread_id, user["id"], _validate_body(body.body),
                                parent_post_id=body.parent_post_id)
    except ValueError as e:
        code = {"no-thread": 404, "locked": 409, "bad-parent": 400}.get(str(e), 400)
        raise HTTPException(status_code=code, detail=str(e))
    return {"id": pid}


@router.post("/posts/{post_id}/reactions")
def react(post_id: int, body: ReactionIn, user: dict = Depends(require_community)):
    if not store.get_post(post_id):
        raise HTTPException(status_code=404, detail="Post not found")
    try:
        on = store.toggle_reaction(post_id, user["id"], body.kind)
    except ValueError:
        raise HTTPException(status_code=400, detail="Unknown reaction")
    return {"on": on}


@router.post("/threads/{thread_id}/read")
def mark_read(thread_id: int, body: ReadIn, user: dict = Depends(require_community)):
    store.mark_read(user["id"], thread_id, body.last_seen_post_id)
    return {"ok": True}


@router.post("/reports")
def report(body: ReportIn, user: dict = Depends(require_community)):
    try:
        rid = store.create_report(user["id"], body.reason,
                                  thread_id=body.thread_id, post_id=body.post_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Report needs exactly one target")
    return {"id": rid}


@router.delete("/threads/{thread_id}")
def delete_thread(thread_id: int, user: dict = Depends(require_community)):
    t = store.get_thread(thread_id)
    if not t:
        raise HTTPException(status_code=404, detail="Thread not found")
    if t["author_id"] != user["id"] and not _is_mentor(user):
        raise HTTPException(status_code=403, detail="Not your thread")
    store.soft_delete_thread(thread_id)
    return {"ok": True}


@router.delete("/posts/{post_id}")
def delete_post(post_id: int, user: dict = Depends(require_community)):
    p = store.get_post(post_id)
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")
    if p["author_id"] != user["id"] and not _is_mentor(user):
        raise HTTPException(status_code=403, detail="Not your post")
    store.soft_delete_post(post_id)
    return {"ok": True}


# ── Mentor / moderator ───────────────────────────────────────────────────────

@router.patch("/threads/{thread_id}/mod")
def mod_thread(thread_id: int, body: ModIn, admin: dict = Depends(require_admin)):
    if not store.get_thread(thread_id):
        raise HTTPException(status_code=404, detail="Thread not found")
    for field in ("pinned", "locked", "answered"):
        value = getattr(body, field)
        if value is not None:
            store.set_thread_flag(thread_id, field, value)
    return {"ok": True}


@router.patch("/posts/{post_id}/highlight")
def highlight(post_id: int, body: HighlightIn, admin: dict = Depends(require_admin)):
    if not store.get_post(post_id):
        raise HTTPException(status_code=404, detail="Post not found")
    store.set_highlight(post_id, body.value)
    return {"ok": True}


@router.get("/admin/reports")
def admin_reports(status: str = Query("open"), admin: dict = Depends(require_admin)):
    return {"reports": store.list_reports(status)}


@router.patch("/admin/reports/{report_id}")
def admin_report_action(report_id: int, body: ReportActionIn,
                        admin: dict = Depends(require_admin)):
    reports = {r["id"]: r for r in store.list_reports("open")}
    r = reports.get(report_id)
    if not r:
        raise HTTPException(status_code=404, detail="Open report not found")
    if body.action == "hide":
        if r["thread_id"]:
            store.soft_delete_thread(r["thread_id"])
        elif r["post_id"]:
            store.soft_delete_post(r["post_id"])
        store.set_report_status(report_id, "hidden")
    elif body.action == "dismiss":
        store.set_report_status(report_id, "dismissed")
    else:
        raise HTTPException(status_code=400, detail="action must be hide|dismiss")
    return {"ok": True}


@router.post("/admin/mute/{user_id}")
def admin_mute(user_id: str, body: MuteIn, admin: dict = Depends(require_admin)):
    store.set_muted(user_id, body.muted)
    return {"ok": True}


# ── Image upload (chart screenshots) ─────────────────────────────────────────

import io
import re
import uuid as _uuid

from fastapi import File, UploadFile
from fastapi.responses import FileResponse

_ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
_MAX_IMAGE_BYTES = 5 * 1024 * 1024
_MAX_DIM = 1920
_SAFE_NAME = re.compile(r"^[a-f0-9]{32}\.webp$")


def _upload_dir() -> str:
    d = os.environ.get("COMMUNITY_UPLOAD_DIR")
    if d:
        return d
    if os.path.isdir("/data"):
        return "/data/community_uploads"
    return os.path.join(os.path.dirname(__file__), "..", "..", "data", "community_uploads")


@router.post("/images")
async def upload_image(file: UploadFile = File(...),
                       user: dict = Depends(require_community)):
    _writer(user)
    if file.content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Images only (png/jpg/webp/gif)")
    raw = await file.read()
    if not raw or len(raw) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Image must be 1 byte – 5 MB")
    from PIL import Image
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read image")
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    img.thumbnail((_MAX_DIM, _MAX_DIM), Image.LANCZOS)
    name = f"{_uuid.uuid4().hex}.webp"
    user_dir = os.path.join(_upload_dir(), user["id"])
    os.makedirs(user_dir, exist_ok=True)
    img.save(os.path.join(user_dir, name), format="WEBP", quality=85)
    return {"url": f"/api/community/images/{user['id']}/{name}",
            "width": img.width, "height": img.height}


@router.get("/images/{owner_id}/{name}")
def serve_image(owner_id: str, name: str, user: dict = Depends(require_community)):
    if not _SAFE_NAME.match(name) or "/" in owner_id or ".." in owner_id:
        raise HTTPException(status_code=404, detail="Not found")
    path = os.path.join(_upload_dir(), owner_id, name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, media_type="image/webp",
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})
