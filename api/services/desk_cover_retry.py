"""desk_cover_retry — the creative cover's second chance.

2026-08-20: the Live Trading Session shipped the generic themed card because
OpenAI's image endpoint answered ONE 429 at publish time (and again on the
transcript-aware refresh eight minutes later). The publish contract is right —
a cover must never break a publish — but "fall back and forget" turned a
throttled minute into a permanent thumbnail. This queue is the memory:

  enqueue()  — the publish path records a session whose creative cover did
               not render (the themed card went up as a PLACEHOLDER).
  drain()    — a scheduler job re-renders due entries (fed the session's own
               stored story when the insights pass has landed it), sets the
               YouTube thumbnail, and drops the entry. Failures back off
               exponentially (15m → 3h cap), give up after MAX_ATTEMPTS or
               MAX_AGE_SECS, and never raise.
  resolve()  — the insights refresh calls this when IT sets a creative cover,
               so a queued retry doesn't paint a second one over it.

Admin: POST /api/desk/creative-cover-retry {"youtube_id": ..., "drain": true}
(PUSH_SECRET) queues any published session from the library and can kick a
background drain now — how 8/20's video gets its cover back.

The ledger lives on the volume (atomic tmp + os.replace) so a redeploy
mid-backoff loses nothing. DESK_CREATIVE_THUMBS off = drain is a no-op
(entries wait; the flag is the in-band stop button, same as the backfill).
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from pathlib import Path

MAX_ATTEMPTS = 8
MAX_AGE_SECS = 48 * 3600
BASE_BACKOFF_SECS = 15 * 60
MAX_BACKOFF_SECS = 3 * 3600
MAX_PER_PASS = 2            # each render = LLM + image; the pass stays short

_write_lock = threading.Lock()
_drain_lock = threading.Lock()
_bg_lock = threading.Lock()
_bg_running = False


def _path(override=None) -> str:
    from api.services import desk_creative
    return override or os.path.join(desk_creative._data_dir(), "desk_cover_retry.json")


def _read(path) -> dict:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(path, data: dict) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(p.parent), prefix=p.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, str(p))
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def backoff_secs(attempts: int) -> int:
    return int(min(BASE_BACKOFF_SECS * (2 ** max(0, attempts - 1)), MAX_BACKOFF_SECS))


def enqueue(youtube_id: str, *, section: str, eyebrow: str, date_text: str,
            now=None, path=None, force_now: bool = False) -> bool:
    """Queue a session for a later creative-cover attempt. Idempotent per
    video (a re-enqueue keeps the attempt count; force_now makes it due
    immediately). Never raises. False when nothing was recorded."""
    yid = (youtube_id or "").strip()
    if not yid or not date_text:
        return False
    try:
        now = int(time.time()) if now is None else int(now)
        with _write_lock:
            q = _read(_path(path))
            cur = q.get(yid) or {}
            q[yid] = {
                "youtube_id": yid,
                "section": str(section or ""),
                "eyebrow": str(eyebrow or ""),
                "date_text": str(date_text),
                "created": now if cur.get("created") is None else int(cur["created"]),
                "attempts": int(cur.get("attempts") or 0),
                "next_after": now if (force_now or not cur or cur.get("next_after") is None)
                else int(cur["next_after"]),
                "last": str(cur.get("last") or ""),
            }
            _write(_path(path), q)
        return True
    except Exception as e:  # noqa: BLE001 — a queue write must never break a publish
        print(f"[cover-retry] enqueue failed for {yid} ({type(e).__name__}: {e})")
        return False


def resolve(youtube_id: str, *, path=None) -> bool:
    """Drop a video from the queue (a creative cover got set by another
    path). Never raises. True iff an entry was removed."""
    yid = (youtube_id or "").strip()
    if not yid:
        return False
    try:
        with _write_lock:
            q = _read(_path(path))
            if yid not in q:
                return False
            del q[yid]
            _write(_path(path), q)
        return True
    except Exception as e:  # noqa: BLE001
        print(f"[cover-retry] resolve failed for {yid} ({type(e).__name__}: {e})")
        return False


def pending(*, path=None) -> list[dict]:
    q = _read(_path(path))
    return sorted(q.values(), key=lambda e: (int(e.get("next_after") or 0), e.get("youtube_id", "")))


def _stored_facts(youtube_id: str) -> dict | None:
    """The session's OWN story as the insights pass stored it (headline +
    ticker moments) — the same facts the transcript-aware refresh renders
    from. None when nothing is stored yet (the day brief carries the cover)."""
    try:
        from api.services import education_service
        from api.services.desk_session_announce import _ticker_symbols
        v = education_service.get_video_by_youtube_id(youtube_id) or {}
        try:
            moments = json.loads(v.get("ticker_moments") or "[]")
        except ValueError:
            moments = []
        syms = _ticker_symbols({"ticker_moments": moments}, limit=6)
        headline = str(v.get("headline") or "").strip()
        facts = {}
        if headline:
            facts["this_sessions_headline"] = headline
        if syms:
            facts["tickers_discussed_in_session"] = syms
        return facts or None
    except Exception:  # noqa: BLE001
        return None


def drain(*, youtube=None, now=None, path=None, render=None,
          max_per_pass: int = MAX_PER_PASS) -> list[dict]:
    """One pass over the due entries. Returns [{youtube_id, outcome}] for what
    it touched ('done' / 'no_render' / 'error: …' / 'expired' / 'gave_up').
    Never raises; a no-op when DESK_CREATIVE_THUMBS is off."""
    from api.services import desk_creative
    if not desk_creative.thumbs_enabled():
        return []
    now = int(time.time()) if now is None else int(now)
    results: list[dict] = []
    if not _drain_lock.acquire(blocking=False):
        return results            # a previous pass is still rendering
    try:
        q = _read(_path(path))
        due = sorted((e for e in q.values() if int(e.get("next_after") or 0) <= now),
                     key=lambda e: int(e.get("created") or 0))
        for e in due[:max(0, int(max_per_pass))]:
            yid = str(e.get("youtube_id") or "")
            if not yid:
                continue
            created = e.get("created")
            if now - (now if created is None else int(created)) > MAX_AGE_SECS:
                outcome = "expired"
            else:
                outcome = _attempt(e, youtube=youtube, render=render)
            with _write_lock:
                q = _read(_path(path))
                if outcome in ("done", "expired"):
                    q.pop(yid, None)
                elif yid in q:
                    entry = q[yid]
                    entry["attempts"] = int(entry.get("attempts") or 0) + 1
                    entry["last"] = outcome[:160]
                    if entry["attempts"] >= MAX_ATTEMPTS:
                        q.pop(yid, None)
                        outcome = f"gave_up ({outcome})"
                    else:
                        entry["next_after"] = now + backoff_secs(entry["attempts"])
                _write(_path(path), q)
            print(f"[cover-retry] {yid}: {outcome}")
            results.append({"youtube_id": yid, "outcome": outcome})
    except Exception as e:  # noqa: BLE001 — a scheduler job never raises
        print(f"[cover-retry] drain error ({type(e).__name__}: {e})")
    finally:
        _drain_lock.release()
    return results


def _attempt(e: dict, *, youtube=None, render=None) -> str:
    from api.services import desk_creative
    yid = str(e.get("youtube_id") or "")
    try:
        facts = _stored_facts(yid)
        kwargs = dict(section=str(e.get("section") or ""), eyebrow=str(e.get("eyebrow") or ""),
                      date_text=str(e.get("date_text") or ""), facts=facts)
        if desk_creative.day_context() is None and facts:
            # No wire brief on this volume: the session's own story is the
            # whole context (the backfill's stance) rather than no cover at all.
            kwargs["ctx"] = {"date": kwargs["date_text"], "show": kwargs["eyebrow"], **facts}
        jpeg = (render or desk_creative.render_cover)(**kwargs)
        if not jpeg:
            return "no_render"
        if youtube is None:
            from api.services.youtube_client import YouTubeClient
            youtube = YouTubeClient()
        youtube.set_thumbnail(yid, jpeg)
        return "done"
    except Exception as ex:  # noqa: BLE001
        return f"error: {type(ex).__name__}: {ex}"[:160]


def enqueue_from_library(youtube_id: str, *, now=None, path=None) -> dict:
    """Admin path: queue a PUBLISHED session by youtube_id, deriving show /
    date from its library title (parse_session_title is the one owner) and
    the section from its category. Due immediately."""
    from api.services import desk_creative, education_service
    yid = (youtube_id or "").strip()
    if not yid:
        return {"error": "youtube_id required"}
    v = education_service.get_video_by_youtube_id(yid)
    if not v:
        return {"error": "no video with that youtube_id"}
    parsed = desk_creative.parse_session_title(v.get("title") or "")
    if not parsed:
        return {"error": "title is not a session title"}
    show, date_text = parsed
    ok = enqueue(yid, section=str(v.get("category") or show), eyebrow=show.upper(),
                 date_text=date_text, now=now, path=path, force_now=True)
    return {"queued": yid if ok else None, "show": show, "date_text": date_text,
            "facts": _stored_facts(yid)}


def start_background_drain(**kw) -> bool:
    """Kick ONE daemon drain now (the admin endpoint's 'don't wait 15 min').
    False when one is already running."""
    global _bg_running
    with _bg_lock:
        if _bg_running:
            return False
        _bg_running = True

    def _run():
        global _bg_running
        try:
            out = drain(**kw)
            print(f"[cover-retry] background drain: {out}")
        finally:
            with _bg_lock:
                _bg_running = False

    threading.Thread(target=_run, name="desk-cover-retry", daemon=True).start()
    return True


def status(*, path=None) -> dict:
    from api.services import desk_creative
    return {"thumbs_enabled": desk_creative.thumbs_enabled(),
            "draining": _bg_running,
            "pending": [{k: e.get(k) for k in ("youtube_id", "attempts", "next_after", "last", "date_text")}
                        for e in pending(path=path)]}
