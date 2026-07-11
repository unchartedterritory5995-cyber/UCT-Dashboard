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
from api import chat_stream as chat_hub

router = APIRouter(prefix="/api/community", tags=["community"])


def _broadcast_board(space, kind, thread_id=None):
    """Push a lightweight 'something changed' ping to a Board's live room so open
    clients revalidate instantly (the forum keeps its 20-30s SWR poll as fallback).
    Best-effort — a broadcast failure never breaks a forum write."""
    if not space:
        return
    try:
        chat_hub.get_hub().broadcast(
            f"board:{space}", "board_activity",
            {"space": space, "kind": kind, "thread_id": thread_id})
    except Exception:
        pass

MAX_BODY_BYTES = 50_000
THREADS_PER_HOUR = int(os.environ.get("COMMUNITY_THREADS_PER_HOUR", "5"))
POSTS_PER_HOUR = int(os.environ.get("COMMUNITY_POSTS_PER_HOUR", "30"))


def _enabled() -> bool:
    return os.environ.get("COMMUNITY_ENABLED", "0") == "1"


def _enabled_for(user: dict) -> bool:
    """The feature is live when the flag is on OR the viewer is an admin. Admins get
    a full PRODUCTION PREVIEW while The Floor is dark for everyone else — so the owner
    can look at and judge the real thing before the public flag flip."""
    return _enabled() or user.get("role") == "admin"


def require_community(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not _enabled_for(user):
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
    enabled = _enabled_for(user)   # admins preview while dark
    return {
        "enabled": enabled,
        "acked": store.has_ack(user["id"]) if enabled else False,
        "is_mentor": _is_mentor(user),
        "muted": store.is_muted(user["id"]) if enabled else False,
        "public": _enabled(),      # false while dark — the nav can badge it "Preview"
        # live chat ships dark independently; admins preview it
        "chat_enabled": enabled and (_chat_enabled() or _is_mentor(user)),
        "chat_public": _chat_enabled(),
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
    wanted = [raw.strip() for raw in ids.split(",")[:100] if raw.strip().isdigit()]
    return store.get_desk_thread_summaries(wanted)


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


def _doc_has_text(doc) -> bool:
    """True if a TipTap doc contains any non-whitespace text or an image node."""
    if not isinstance(doc, dict):
        return False
    if doc.get("type") == "image":
        return True
    if isinstance(doc.get("text"), str) and doc["text"].strip():
        return True
    for child in doc.get("content") or []:
        if _doc_has_text(child):
            return True
    return False


def _validate_body(body: str, *, require_content: bool = False) -> str:
    body = body or ""
    if len(body.encode("utf-8", "ignore")) > MAX_BODY_BYTES:
        raise HTTPException(status_code=400, detail="Body too large")
    doc = None
    if body:
        try:
            doc = json.loads(body)
            if not isinstance(doc, dict):
                raise ValueError
        except ValueError:
            raise HTTPException(status_code=400, detail="Body must be TipTap JSON")
    if require_content and not (doc is not None and _doc_has_text(doc)):
        raise HTTPException(status_code=400, detail="Empty post")
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
    _broadcast_board(body.space, "thread_created", tid)
    return {"id": tid}


@router.post("/threads/{thread_id}/posts")
def create_post(thread_id: int, body: PostIn, user: dict = Depends(require_community)):
    _writer(user)
    if not _is_mentor(user) and store.count_recent_posts(user["id"]) >= POSTS_PER_HOUR:
        raise HTTPException(status_code=429, detail="Post rate limit — try again later")
    try:
        pid = store.create_post(thread_id, user["id"],
                                _validate_body(body.body, require_content=True),
                                parent_post_id=body.parent_post_id)
    except ValueError as e:
        code = {"no-thread": 404, "locked": 409, "bad-parent": 400}.get(str(e), 400)
        raise HTTPException(status_code=code, detail=str(e))
    _broadcast_board(store.thread_space(thread_id), "post_created", thread_id)
    return {"id": pid}


@router.post("/posts/{post_id}/reactions")
def react(post_id: int, body: ReactionIn, user: dict = Depends(require_community)):
    _writer(user)   # reactions are participation — enforce ack + not-muted
    if not store.get_post(post_id):
        raise HTTPException(status_code=404, detail="Post not found")
    try:
        on = store.toggle_reaction(post_id, user["id"], body.kind)
    except ValueError:
        raise HTTPException(status_code=400, detail="Unknown reaction")
    _broadcast_board(store.post_space(post_id), "post_reaction")
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
    _broadcast_board(t.get("space"), "thread_deleted", thread_id)
    return {"ok": True}


@router.delete("/posts/{post_id}")
def delete_post(post_id: int, user: dict = Depends(require_community)):
    p = store.get_post(post_id)
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")
    if p["author_id"] != user["id"] and not _is_mentor(user):
        raise HTTPException(status_code=403, detail="Not your post")
    space = store.post_space(post_id)
    store.soft_delete_post(post_id)
    _broadcast_board(space, "post_deleted", p.get("thread_id"))
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
    _broadcast_board(store.thread_space(thread_id), "thread_mod", thread_id)
    return {"ok": True}


@router.patch("/posts/{post_id}/highlight")
def highlight(post_id: int, body: HighlightIn, admin: dict = Depends(require_admin)):
    if not store.get_post(post_id):
        raise HTTPException(status_code=404, detail="Post not found")
    space = store.post_space(post_id)
    store.set_highlight(post_id, body.value)
    _broadcast_board(space, "post_highlight")
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

from fastapi import File, Request, UploadFile
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
async def upload_image(request: Request, file: UploadFile = File(...),
                       user: dict = Depends(require_community)):
    _writer(user)
    if file.content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Images only (png/jpg/webp/gif)")
    # Reject oversize up front by declared length, so we never buffer a huge body.
    try:
        declared = int(request.headers.get("content-length") or 0)
    except (TypeError, ValueError):
        declared = 0
    if declared > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Image must be 1 byte – 5 MB")
    # Bounded read: cap RAM at ~5 MB regardless of the on-disk spool size. Reading
    # one extra byte lets us detect an over-cap file that lied about Content-Length.
    raw = await file.read(_MAX_IMAGE_BYTES + 1)
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


# ═══════════════════════════════════════════════════════════════════════════
#  Live chat — Pulse channels (v2). Ships dark behind COMMUNITY_CHAT_ENABLED;
#  admins preview while dark. SSE (server→client) + POST (client→send), hub in
#  api/chat_stream.py. Rich cards are SERVER-built (api/services/community_cards).
# ═══════════════════════════════════════════════════════════════════════════

import asyncio as _asyncio
import time as _time

from fastapi.responses import JSONResponse, StreamingResponse

from api import chat_stream as chat_hub
from api.services import community_cards

_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _chat_enabled() -> bool:
    return os.environ.get("COMMUNITY_CHAT_ENABLED", "0") == "1"


def require_chat(user: dict = Depends(require_community)) -> dict:
    # require_community already enforced paid + (community flag OR admin preview).
    if not (_chat_enabled() or user.get("role") == "admin"):
        raise HTTPException(status_code=503, detail="Live chat is not enabled")
    return user


class ChatMessageIn(BaseModel):
    body: str = ""
    ticker_tags: list[str] | None = None
    reply_to_message_id: int | None = None
    client_msg_id: str | None = None
    card: dict | None = None            # reference only ({kind, tradeId} | {kind, ...})


class ChatEditIn(BaseModel):
    body: str
    ticker_tags: list[str] | None = None


class ChatReactionIn(BaseModel):
    kind: str


class ChatReadIn(BaseModel):
    last_seen_message_id: int


class ChatReportIn(BaseModel):
    message_id: int
    reason: str = ""


class ChatPinIn(BaseModel):
    pinned: bool


class GraduateIn(BaseModel):
    space: str
    title: str


def _serialize_message(m: dict) -> dict:
    """Attach author + decode card_json for the wire."""
    _attach_authors([m])
    if m.get("card_json"):
        try:
            m["card"] = json.loads(m["card_json"])
        except (TypeError, ValueError):
            m["card"] = None
    else:
        m["card"] = None
    m.pop("card_json", None)
    return m


@router.get("/chat/channels")
def chat_channels(user: dict = Depends(require_chat)):
    unread = store.unread_by_channel(user["id"])
    hub = chat_hub.get_hub()
    return {
        "channels": [
            {**c, "unread": unread.get(c["slug"], 0),
             "presence": hub.presence_count(c["slug"])}
            for c in store.list_channels()
        ],
        "mentions_unseen": store.count_unseen_mentions(user["id"]),
    }


@router.get("/chat/channels/{slug}/messages")
def chat_messages(slug: str, before_id: int | None = Query(None),
                  after_id: int | None = Query(None), limit: int = Query(50, ge=1, le=200),
                  user: dict = Depends(require_chat)):
    if not store.is_valid_channel(slug):
        raise HTTPException(status_code=404, detail="Unknown channel")
    msgs = store.list_messages(slug, before_id=before_id, after_id=after_id,
                               limit=limit, viewer_id=user["id"])
    for m in msgs:
        _serialize_message(m)
    return {"messages": msgs}


@router.post("/chat/channels/{slug}/messages")
def chat_send(slug: str, payload: ChatMessageIn, user: dict = Depends(require_chat)):
    _writer(user)
    if not store.is_valid_channel(slug):
        raise HTTPException(status_code=404, detail="Unknown channel")

    # Server-built card (client never supplies card body — redaction P0).
    card_json = None
    card_ticker = None
    if payload.card:
        from api.services.journal_two.trades import get_trade_detail
        try:
            card = community_cards.build_card(
                str(payload.card.get("kind")), payload.card,
                user_id=user["id"], load_trade=get_trade_detail)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"card: {e}")
        card_json = json.dumps(card)
        card_ticker = card.get("ticker") or card.get("symbol")

    body = _validate_body(payload.body, require_content=(card_json is None))

    # Mentions parsed FROM the body (never a client array), validated against auth.db.
    parsed = store.parse_mentions_from_doc(body)
    valid_mentions = list(_author_map(parsed).keys()) if parsed else []

    # A shared card's ticker should count toward The Tape's hot tickers too.
    tags = [t.upper()[:8] for t in (payload.ticker_tags or [])]
    if card_ticker and card_ticker.upper() not in tags:
        tags.append(card_ticker.upper())

    try:
        mid = store.create_message(
            slug, user["id"], body,
            ticker_tags=tags[:10],
            card_json=card_json, reply_to_message_id=payload.reply_to_message_id,
            mention_user_ids=valid_mentions,
            bypass_rate_limit=_is_mentor(user))
    except store.ChatRateLimited:
        raise HTTPException(status_code=429, detail="Slow down — message rate limit")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    msg = _serialize_message(store.get_message(mid))
    if payload.client_msg_id:
        msg["client_msg_id"] = payload.client_msg_id
    chat_hub.get_hub().broadcast(slug, "message", msg)
    return msg


@router.post("/chat/channels/{slug}/typing")
def chat_typing(slug: str, user: dict = Depends(require_chat)):
    if not store.is_valid_channel(slug):
        raise HTTPException(status_code=404, detail="Unknown channel")
    name = _author_map([user["id"]]).get(user["id"], {}).get("name", "member")
    chat_hub.get_hub().broadcast(
        slug, "typing", {"user_id": user["id"], "name": name}, ephemeral=True)
    return {"ok": True}


@router.post("/chat/messages/{message_id}/reactions")
def chat_react(message_id: int, body: ChatReactionIn, user: dict = Depends(require_chat)):
    _writer(user)
    m = store.get_message(message_id)
    if not m or m.get("deleted"):
        raise HTTPException(status_code=404, detail="Message not found")
    try:
        on = store.toggle_message_reaction(message_id, user["id"], body.kind)
    except ValueError:
        raise HTTPException(status_code=400, detail="Unknown reaction")
    chat_hub.get_hub().broadcast(m["channel_slug"], "reaction", {
        "message_id": message_id, "kind": body.kind, "on": on, "user_id": user["id"]})
    return {"on": on}


@router.patch("/chat/messages/{message_id}")
def chat_edit(message_id: int, body: ChatEditIn, user: dict = Depends(require_chat)):
    _writer(user)
    new_body = _validate_body(body.body, require_content=True)
    try:
        store.edit_message(message_id, user["id"], new_body,
                           ticker_tags=[t.upper()[:8] for t in (body.ticker_tags or [])][:10]
                           if body.ticker_tags is not None else None)
    except ValueError as e:
        code = {"no-message": 404, "not-author": 403}.get(str(e), 400)
        raise HTTPException(status_code=code, detail=str(e))
    msg = _serialize_message(store.get_message(message_id))
    chat_hub.get_hub().broadcast(msg["channel_slug"], "message_edited", msg)
    return msg


@router.delete("/chat/messages/{message_id}")
def chat_delete(message_id: int, user: dict = Depends(require_chat)):
    m = store.get_message(message_id)
    if not m:
        raise HTTPException(status_code=404, detail="Message not found")
    if m["author_id"] != user["id"] and not _is_mentor(user):
        raise HTTPException(status_code=403, detail="Not your message")
    store.soft_delete_message(message_id)
    chat_hub.get_hub().broadcast(
        m["channel_slug"], "message_deleted", {"message_id": message_id})
    return {"ok": True}


@router.post("/chat/channels/{slug}/read")
def chat_mark_read(slug: str, body: ChatReadIn, user: dict = Depends(require_chat)):
    if not store.is_valid_channel(slug):
        raise HTTPException(status_code=404, detail="Unknown channel")
    store.mark_channel_read(user["id"], slug, body.last_seen_message_id)
    return {"ok": True}


@router.get("/chat/tape")
def chat_tape(user: dict = Depends(require_chat)):
    """The Tape — a global 'what's alive right now' snapshot: who's on the floor +
    the hottest tickers being discussed across the live channels."""
    hub = chat_hub.get_hub()
    online = set()
    for slug in store.CHANNELS:
        online.update(hub.presence_users(slug))
    return {"online": len(online), "hot_tickers": store.hot_tickers()}


@router.get("/chat/members")
def chat_members(q: str = Query("", max_length=40), user: dict = Depends(require_chat)):
    """Search community members by display name for @-mention autocomplete."""
    q = (q or "").strip()
    if len(q) < 1:
        return {"members": []}
    try:
        from api.services.auth_db import get_connection as _auth_conn
        like = f"%{q}%"
        with _closing(_auth_conn()) as conn:
            rows = conn.execute(
                """SELECT id, display_name, email, role FROM users
                    WHERE (display_name LIKE ? OR email LIKE ?) AND id != ?
                    ORDER BY (role='admin') DESC, display_name
                    LIMIT 8""",
                (like, like, user["id"])).fetchall()
        return {"members": [
            {"id": r["id"],
             "name": r["display_name"] or (r["email"] or "member").split("@")[0],
             "is_mentor": r["role"] == "admin"}
            for r in rows]}
    except Exception:
        return {"members": []}


@router.get("/chat/mentions")
def chat_mentions(user: dict = Depends(require_chat)):
    items = store.list_mentions(user["id"])
    _attach_authors(items)   # author of the mentioning message
    return {"mentions": items, "unseen": store.count_unseen_mentions(user["id"])}


@router.post("/chat/mentions/read")
def chat_mentions_read(user: dict = Depends(require_chat)):
    store.mark_mentions_seen(user["id"])
    return {"ok": True}


@router.post("/chat/reports")
def chat_report(body: ChatReportIn, user: dict = Depends(require_chat)):
    try:
        rid = store.create_chat_report(user["id"], body.message_id, body.reason)
    except ValueError:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"id": rid}


@router.post("/chat/messages/{message_id}/graduate")
def chat_graduate(message_id: int, body: GraduateIn, user: dict = Depends(require_chat)):
    """Promote a hot chat message into a permanent titled Board thread ('the floor
    that remembers'). Author or mentor can graduate. Idempotent-ish: re-graduating
    returns the existing thread."""
    _writer(user)
    m = store.get_message(message_id)
    if not m or m.get("deleted"):
        raise HTTPException(status_code=404, detail="Message not found")
    if m["author_id"] not in (None, user["id"]) and not _is_mentor(user):
        raise HTTPException(status_code=403, detail="Only the author or a mentor can graduate")
    if m.get("graduated_thread_id"):
        return {"thread_id": m["graduated_thread_id"], "already": True}
    if body.space not in store.SPACES:
        raise HTTPException(status_code=400, detail="Unknown space")
    if store.SPACES[body.space]["mentor_only"] and not _is_mentor(user):
        raise HTTPException(status_code=403, detail="Mentor Desk threads are mentor-only")
    title = (body.title or "").strip()
    if not title or len(title) > 200:
        raise HTTPException(status_code=400, detail="Title required (max 200 chars)")
    # Thread keeps the original author's attribution; body = the message body.
    tid = store.create_thread(
        body.space, m["author_id"], title,
        body=_validate_body(m["body"]),
        ticker_tags=[t.upper()[:8] for t in (m.get("ticker_tags") or [])][:10])
    store.set_message_graduated(message_id, tid)
    grad = _serialize_message(store.get_message(message_id))
    chat_hub.get_hub().broadcast(m["channel_slug"], "message_edited", grad)
    return {"thread_id": tid, "space": body.space}


@router.patch("/chat/messages/{message_id}/pin")
def chat_pin(message_id: int, body: ChatPinIn, admin: dict = Depends(require_admin)):
    m = store.get_message(message_id)
    if not m or m.get("deleted"):
        raise HTTPException(status_code=404, detail="Message not found")
    store.set_message_pinned(message_id, body.pinned)
    chat_hub.get_hub().broadcast(m["channel_slug"], "message_pinned",
                                 {"message_id": message_id, "pinned": bool(body.pinned)})
    return {"ok": True}


@router.get("/chat/admin/reports")
def chat_admin_reports(status: str = Query("open"), admin: dict = Depends(require_admin)):
    return {"reports": store.list_chat_reports(status)}


@router.patch("/chat/admin/reports/{report_id}")
def chat_admin_report_action(report_id: int, body: ReportActionIn,
                             admin: dict = Depends(require_admin)):
    r = next((x for x in store.list_chat_reports("open") if x["id"] == report_id), None)
    if not r:
        raise HTTPException(status_code=404, detail="Open report not found")
    if body.action == "hide":
        store.soft_delete_message(r["message_id"])
        store.set_chat_report_status(report_id, "hidden")
        if r.get("channel_slug"):
            chat_hub.get_hub().broadcast(
                r["channel_slug"], "message_deleted", {"message_id": r["message_id"]})
    elif body.action == "dismiss":
        store.set_chat_report_status(report_id, "dismissed")
    else:
        raise HTTPException(status_code=400, detail="action must be hide|dismiss")
    return {"ok": True}


@router.get("/chat/admin/stats")
def chat_admin_stats(admin: dict = Depends(require_admin)):
    return chat_hub.get_hub().stats()


@router.post("/chat/admin/heartbeat")
def chat_admin_heartbeat(admin: dict = Depends(require_admin)):
    """Fire the UCT Mentor morning heartbeat on demand (bypasses the daily dedup)."""
    from api.services import community_heartbeat
    return community_heartbeat.post_daily_heartbeat(force=True)


@router.get("/chat/stream")
async def chat_stream_sse(request: Request, channels: str = Query(""),
                          user: dict = Depends(require_chat)):
    slugs = [s for s in (channels.split(",") if channels else []) if store.is_valid_channel(s)]
    if not slugs:
        slugs = list(store.CHANNELS.keys())
    hub = chat_hub.get_hub()
    conn = hub.subscribe(user["id"], slugs)
    if conn is None:
        # At capacity — client falls back to polling list_messages(after_id).
        return JSONResponse({"reason": "at_capacity"}, status_code=503)
    # Seed "joined = caught up" so the rail doesn't show all-history as unread.
    # OFF the event loop — each seed takes the write lock + touches SQLite, and this
    # is an async endpoint; doing it inline would stall the single shared loop.
    from starlette.concurrency import run_in_threadpool
    try:
        await run_in_threadpool(store.ensure_caught_up_many, user["id"], slugs)
    except Exception:
        pass

    async def gen():
        try:
            yield "event: connected\ndata: {}\n\n"
            last_hb = _time.time()
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await _asyncio.wait_for(conn.queue.get(), timeout=5.0)
                    yield f"event: {msg['event']}\ndata: {json.dumps(msg, default=str)}\n\n"
                except _asyncio.TimeoutError:
                    pass
                if _time.time() - last_hb > 10:
                    yield "event: heartbeat\ndata: {}\n\n"
                    last_hb = _time.time()
        finally:
            hub.unsubscribe(conn)

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)
