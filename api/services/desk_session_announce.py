"""Community announcement for a freshly-published Desk session video.

Posts ONE rich Discord embed to the TSDR community channel the moment a video
publishes (branded thumbnail + YouTube link + the UCT Intelligence tease), then
EDITS that same message later to fold in the brief recap once the session's
insights pass has produced a headline + takeaways from the Zoom transcript.

Why post-then-edit instead of one post after the recap: the transcript lands
15-40 min after the recording ends and sometimes never lands at all. Announcing
immediately means the drop is never held hostage to Zoom, and the pre-recap copy
reads complete on its own (it promises nothing it might not deliver).

⚠️ SHOW ALLOWLIST — the load-bearing safety rail. The Desk publish pipeline has
NO allowlist by design: every cloud recording on the Zoom account auto-publishes
(`desk_daily_session._route`). This channel is PUBLIC, and most shows (Live
Trading Sessions above all) are paywalled — so announcing is opt-IN per show via
DESK_TSDR_ANNOUNCE_SHOWS. An unset/blank list announces NOTHING.

Gated by DESK_TSDR_ANNOUNCE_ENABLED. `POST /api/desk/announce/{id}` (PUSH_SECRET)
runs the same path manually and works with the flag off, so the whole thing can
be proven end-to-end before it's armed. Fully additive; never raises into the
publish pipeline.
"""
from __future__ import annotations

import contextlib
import json
import os
import sqlite3
import threading
import time

import requests

from api.services import education_service

_DB_PATH = os.environ.get("DESK_ANNOUNCE_DB_PATH", "/data/desk_announce.db")
_WRITE_LOCK = threading.Lock()

_UCT_URL = "https://uctintelligence.com"
_YT_WATCH = "https://www.youtube.com/watch?v={vid}"
_BRAND_GOLD = 0xC9A84C
_TAGLINE = "Uncharted Territory · Navigate the market, effectively."

# Discord embed description hard-caps at 4096; stay well under with headroom.
_DESC_LIMIT = 3600
_TIMEOUT = 20

_SCHEMA = """
CREATE TABLE IF NOT EXISTS desk_announcements (
  video_id      INTEGER PRIMARY KEY,
  message_id    TEXT NOT NULL,
  attachment_id TEXT,
  posted_at     INTEGER NOT NULL,
  recap_at      INTEGER
);
"""


# ── config ───────────────────────────────────────────────────────────────────

def is_enabled() -> bool:
    return os.environ.get("DESK_TSDR_ANNOUNCE_ENABLED", "") == "1"


def _webhook_url() -> str:
    return os.environ.get("DISCORD_TSDR_WEBHOOK_URL", "").strip()


def allowed_shows() -> list[str]:
    """Lowercased substrings; a show announces only if one of them appears in
    its title/section. Deliberately defaults to the evening show ALONE — see the
    module docstring. A blank env value yields [] (announce nothing), so the
    failure direction is silence, never leaking a paywalled session."""
    raw = os.environ.get("DESK_TSDR_ANNOUNCE_SHOWS", "evening update")
    return [s.strip().lower() for s in raw.split(",") if s.strip()]


def show_allowed(*labels: str) -> bool:
    hay = " ".join(l or "" for l in labels).lower()
    return any(s in hay for s in allowed_shows())


# ── store ────────────────────────────────────────────────────────────────────

def _connect():
    c = sqlite3.connect(_DB_PATH, timeout=10.0)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def _init_db() -> None:
    parent = os.path.dirname(_DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with contextlib.closing(_connect()) as c:
        c.executescript(_SCHEMA)
        c.commit()


def get_announcement(video_id: int) -> dict | None:
    _init_db()
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT * FROM desk_announcements WHERE video_id = ?",
                        (int(video_id),)).fetchone()
        return dict(row) if row else None


def _record(video_id: int, message_id: str, attachment_id: str | None) -> None:
    _init_db()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            "INSERT INTO desk_announcements (video_id, message_id, attachment_id, posted_at) "
            "VALUES (?,?,?,?) ON CONFLICT(video_id) DO UPDATE SET "
            "message_id=excluded.message_id, attachment_id=excluded.attachment_id, "
            "posted_at=excluded.posted_at, recap_at=NULL",
            (int(video_id), str(message_id), attachment_id, int(time.time())))
        c.commit()


def _mark_recap(video_id: int) -> None:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("UPDATE desk_announcements SET recap_at=? WHERE video_id=?",
                  (int(time.time()), int(video_id)))
        c.commit()


# ── copy ─────────────────────────────────────────────────────────────────────

def split_title(title: str) -> tuple[str, str]:
    """'Evening Update from TSDR — July 27, 2026' -> (show, date_text).
    The publish pipeline always builds titles as `{prefix} — {date_text}`
    (`desk_daily_session.process_pending_jobs`); anything else yields an empty
    date, which the thumbnail renderer tolerates."""
    t = (title or "").strip()
    if " — " in t:
        show, date_text = t.rsplit(" — ", 1)
        return show.strip(), date_text.strip()
    return t, ""


def _ticker_symbols(ins: dict, limit: int = 8) -> list[str]:
    """Symbols out of stored ticker_moments, deduped in order. Shape-tolerant:
    the store has carried both dicts and bare strings."""
    out: list[str] = []
    for m in (ins.get("ticker_moments") or []):
        sym = (m.get("ticker") or m.get("symbol") or "") if isinstance(m, dict) else str(m)
        sym = sym.strip().upper().lstrip("$")
        if sym and sym not in out:
            out.append(sym)
    return out[:limit]


def _links_block(youtube_id: str) -> str:
    lines = []
    if youtube_id:
        lines.append(f"[**▶  Watch the replay on YouTube**]({_YT_WATCH.format(vid=youtube_id)})")
    lines.append(f"[**🧭  UCT Intelligence — something big is coming**]({_UCT_URL})")
    return "\n".join(lines)


def build_description(youtube_id: str, ins: dict | None = None) -> str:
    """The embed body. Pre-recap it is a complete, self-contained post — no
    'recap coming soon' promise, because the transcript may never arrive."""
    ins = ins or {}
    headline = (ins.get("headline") or "").strip()
    summary = [s.strip() for s in (ins.get("summary") or []) if (s or "").strip()]
    parts: list[str] = []

    if headline:
        parts.append(f"**{headline}**")
    if summary:
        parts.append("\n".join(f"▸  {s}" for s in summary[:5]))
    if not headline and not summary:
        parts.append("Tonight's market wrap is up.")

    syms = _ticker_symbols(ins)
    if syms:
        parts.append("**Covered:** " + " · ".join(f"`{s}`" for s in syms))

    parts.append(_links_block(youtube_id))
    desc = "\n\n".join(parts)
    return desc if len(desc) <= _DESC_LIMIT else desc[:_DESC_LIMIT - 1].rstrip() + "…"


def build_embed(title: str, youtube_id: str, ins: dict | None = None,
                *, image_ref: str = "attachment://thumb.jpg") -> dict:
    embed = {
        "title": title,
        "description": build_description(youtube_id, ins),
        "color": _BRAND_GOLD,
        "footer": {"text": _TAGLINE},
    }
    if youtube_id:
        embed["url"] = _YT_WATCH.format(vid=youtube_id)
    if image_ref:
        embed["image"] = {"url": image_ref}
    return embed


# ── thumbnail ────────────────────────────────────────────────────────────────

def _thumbnail_bytes(date_text: str, eyebrow: str) -> bytes | None:
    """The SAME branded card that went on YouTube. Best-effort: a render failure
    costs the image, never the announcement."""
    try:
        from api.services.desk_thumbnail import render_session_thumbnail
        return render_session_thumbnail(date_text, eyebrow_label=eyebrow)
    except Exception as e:
        print(f"[desk-announce] thumbnail render failed (non-fatal): {e}")
        return None


# ── Discord ──────────────────────────────────────────────────────────────────

def _post(url: str, embed: dict, thumb: bytes | None) -> dict:
    """POST the announcement with ?wait=true so Discord returns the created
    message — we need its id (and the attachment's id) to edit it later."""
    payload = {
        "username": "Uncharted Territory",
        "embeds": [embed],
        "allowed_mentions": {"parse": []},
    }
    if thumb:
        r = requests.post(
            url, params={"wait": "true"},
            data={"payload_json": json.dumps(payload)},
            files={"files[0]": ("thumb.jpg", thumb, "image/jpeg")},
            timeout=_TIMEOUT)
    else:
        payload["embeds"][0].pop("image", None)
        r = requests.post(url, params={"wait": "true"}, json=payload, timeout=_TIMEOUT)
    r.raise_for_status()
    return r.json()


def _edit(url: str, message_id: str, embed: dict, attachment_id: str | None) -> None:
    """PATCH the existing message. `attachments` must name the attachment we
    want KEPT — omitting the field drops the uploaded thumbnail, which would
    silently gut the post the moment the recap lands."""
    body: dict = {"embeds": [embed], "allowed_mentions": {"parse": []}}
    if attachment_id:
        body["attachments"] = [{"id": str(attachment_id)}]
    else:
        embed.pop("image", None)
    r = requests.patch(f"{url}/messages/{message_id}", json=body, timeout=_TIMEOUT)
    r.raise_for_status()


# ── public API ───────────────────────────────────────────────────────────────

def announce_video(video_id: int, *, force: bool = False) -> dict:
    """Post the community announcement for a published video. Idempotent: a
    video already announced is a no-op unless `force`. Raises on hard failure so
    the admin endpoint can surface it; `maybe_announce` is the quiet wrapper."""
    v = education_service.get_video(int(video_id))
    if not v:
        raise RuntimeError(f"video {video_id} not found")
    url = _webhook_url()
    if not url:
        raise RuntimeError("DISCORD_TSDR_WEBHOOK_URL is not set")

    title = (v.get("title") or "").strip()
    section = (v.get("category") or "").strip()
    if not force and not show_allowed(title, section):
        return {"ok": False, "skipped": "show not in DESK_TSDR_ANNOUNCE_SHOWS",
                "title": title, "section": section}

    existing = get_announcement(video_id)
    if existing and not force:
        return {"ok": True, "already": True, "message_id": existing["message_id"]}

    show, date_text = split_title(title)
    youtube_id = (v.get("youtube_id") or "").strip()
    thumb = _thumbnail_bytes(date_text, show.upper())
    embed = build_embed(title, youtube_id,
                        image_ref="attachment://thumb.jpg" if thumb else "")

    msg = _post(url, embed, thumb)
    atts = msg.get("attachments") or []
    _record(video_id, msg.get("id"), (atts[0].get("id") if atts else None))
    print(f"[desk-announce] posted video {video_id} ({title!r}) msg={msg.get('id')}")
    return {"ok": True, "id": int(video_id), "message_id": msg.get("id"),
            "title": title, "thumbnail": bool(thumb)}


def attach_recap(video_id: int) -> dict:
    """Fold the brief recap into the already-posted announcement.

    Uses the insights the pipeline ALREADY produced (headline + takeaway bullets
    + ticker moments) — no second LLM call, no second failure mode, and the copy
    is the same editor-polished text the Desk player shows. Falls back to a
    follow-up message if the edit is rejected."""
    rec = get_announcement(video_id)
    if not rec:
        raise RuntimeError(f"video {video_id} was never announced")
    url = _webhook_url()
    if not url:
        raise RuntimeError("DISCORD_TSDR_WEBHOOK_URL is not set")

    v = education_service.get_video(int(video_id)) or {}
    ins = education_service.get_insights(int(video_id))
    if not (ins.get("headline") or ins.get("summary")):
        return {"ok": False, "skipped": "no recap available yet"}

    title = (v.get("title") or "").strip()
    youtube_id = (v.get("youtube_id") or "").strip()
    embed = build_embed(title, youtube_id, ins)
    try:
        _edit(url, rec["message_id"], embed, rec.get("attachment_id"))
        mode = "edited"
    except Exception as e:
        print(f"[desk-announce] edit failed, posting follow-up instead: {e}")
        _post(url, build_embed(title, youtube_id, ins, image_ref=""), None)
        mode = "followup"
    _mark_recap(video_id)
    print(f"[desk-announce] recap {mode} for video {video_id}")
    return {"ok": True, "id": int(video_id), "mode": mode}


def maybe_announce(video_id: int) -> None:
    """Pipeline hook (publish path): gated + best-effort. Never raises — a
    Discord hiccup must not affect publishing."""
    if not is_enabled():
        return
    try:
        announce_video(int(video_id))
    except Exception as e:
        print(f"[desk-announce] announce {video_id} failed (non-fatal): {e}")


def maybe_attach_recap(video_id: int) -> None:
    """Pipeline hook (insights 'generated' path): gated + best-effort. No-ops
    when this video was never announced (i.e. any non-allowlisted show)."""
    if not is_enabled():
        return
    try:
        if get_announcement(int(video_id)):
            attach_recap(int(video_id))
    except Exception as e:
        print(f"[desk-announce] recap attach {video_id} failed (non-fatal): {e}")
