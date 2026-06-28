"""Live Trading Session insights — AI chapters + ticker-moments from the Zoom
transcript.

Zoom transcribes each cloud recording (VTT) asynchronously, a bit AFTER the
`recording.completed` webhook fires. So this runs as a SEPARATE scheduled pass
(NOT in the publish path): for each published session video that still has its
Zoom recording, fetch the VTT when ready → Opus turns it into chapters +
ticker-moments → store on the edu_videos row → then trash the Zoom recording.
If the transcript never shows up within DESK_SESSION_TRANSCRIPT_MAX_WAIT_HRS we
trash the recording anyway (storage stays bounded) and give up on chapters.

Gated by DESK_SESSION_CHAPTERS_ENABLED. When off, the publish path keeps its
original inline immediate-delete behaviour and none of this runs — fully
reversible, additive.
"""
from __future__ import annotations

import json
import os
import re
import time

from api.services import education_service

# Opus for synthesis (feedback_opus_for_synthesis). 4.8 rejects `temperature`.
_MODEL = os.environ.get("DESK_CHAPTERS_MODEL", "claude-opus-4-8")


def is_enabled() -> bool:
    return os.environ.get("DESK_SESSION_CHAPTERS_ENABLED", "") == "1"


def _max_wait_secs() -> int:
    try:
        hrs = float(os.environ.get("DESK_SESSION_TRANSCRIPT_MAX_WAIT_HRS", "24"))
    except ValueError:
        hrs = 24.0
    return int(hrs * 3600)


def _window_secs() -> int:
    try:
        days = float(os.environ.get("DESK_SESSION_INSIGHTS_WINDOW_DAYS", "7"))
    except ValueError:
        days = 7.0
    return int(days * 86400)


# ── VTT parsing (pure, testable) ────────────────────────────────────────────────

_TS = re.compile(
    r"(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?\s*-->\s*"
)


def _ts_to_seconds(h, m, s, ms) -> int:
    total = int(h or 0) * 3600 + int(m) * 60 + int(s)
    return total  # millis dropped — chapter/seek granularity is whole seconds


def parse_vtt(text: str) -> list[dict]:
    """Parse a WebVTT (or SRT-ish) transcript into [{t: start_seconds, text}].
    Tolerant: ignores the WEBVTT header, cue numbers, and inline tags; collapses
    each cue's wrapped lines into one. Returns [] on junk."""
    if not text:
        return []
    cues: list[dict] = []
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    i, n = 0, len(lines)
    while i < n:
        m = _TS.search(lines[i])
        if not m:
            i += 1
            continue
        start = _ts_to_seconds(m.group(1), m.group(2), m.group(3), m.group(4))
        i += 1
        buf: list[str] = []
        while i < n and lines[i].strip() and "-->" not in lines[i]:
            # strip simple VTT inline tags like <00:00:01.000> or <c>
            buf.append(re.sub(r"<[^>]+>", "", lines[i]).strip())
            i += 1
        txt = " ".join(p for p in buf if p).strip()
        if txt:
            cues.append({"t": start, "text": txt})
    return cues


def transcript_plain(cues: list[dict]) -> str:
    """Flatten cues to a plain transcript (no timestamps) for storage/search."""
    return "\n".join(c["text"] for c in cues)


def _hhmmss(sec: int) -> str:
    sec = max(0, int(sec))
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def _timestamped_block(cues: list[dict], max_chars: int = 600_000) -> str:
    """Compact "[h:mm:ss] text" lines for the LLM, capped so a marathon session
    can't blow the context (Opus handles ~hours of speech well under this cap)."""
    out, total = [], 0
    for c in cues:
        line = f"[{_hhmmss(c['t'])}] {c['text']}"
        if total + len(line) > max_chars:
            break
        out.append(line)
        total += len(line) + 1
    return "\n".join(out)


# ── LLM generation ──────────────────────────────────────────────────────────────

_SYS = (
    "You are an editor for a stock-trading firm's video library. You are given a "
    "timestamped transcript of a live trading session / educational webinar. "
    "Produce navigation aids as STRICT JSON only (no prose, no code fences):\n"
    '{ "chapters": [ {"t": <int seconds>, "title": "<=60 chars} ], '
    '"tickers": [ {"ticker": "AAPL", "t": <int seconds>, "note": "<=80 chars} ] }\n'
    "Rules:\n"
    "- chapters: 6-15 segments spanning the whole session in time order; t is the "
    "START second of each segment (the first should be 0 or near it). Titles are "
    "specific (\"SPY game plan & key levels\", not \"Intro\").\n"
    "- tickers: every stock/ETF actually discussed, at the second its discussion "
    "STARTS; map spoken company names to the correct US ticker (Nvidia->NVDA). "
    "note = a few words on what was said. Skip vague index talk. De-dup obvious "
    "repeats but keep distinct revisits.\n"
    "- Use integer seconds from the [h:mm:ss] markers. Output ONLY the JSON object."
)


def _strip_json(s: str) -> str:
    s = (s or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\n?", "", s)
        s = re.sub(r"\n?```$", "", s).strip()
    # tolerate leading/trailing chatter — grab the outermost {...}
    a, b = s.find("{"), s.rfind("}")
    return s[a:b + 1] if a != -1 and b != -1 and b > a else s


def generate_insights(title: str, cues: list[dict]) -> dict:
    """Call Opus to turn cues into {chapters, ticker_moments}. Returns
    {"chapters": [...], "ticker_moments": [...]}; raises on hard LLM failure so
    the caller can decide to retry (don't store / don't give up yet)."""
    from api.services.engine import _get_anthropic_client
    block = _timestamped_block(cues)
    if not block:
        return {"chapters": [], "ticker_moments": []}
    user = f"VIDEO TITLE: {title}\n\nTRANSCRIPT:\n{block}"
    client = _get_anthropic_client()
    msg = client.messages.create(
        model=_MODEL,
        max_tokens=2400,
        system=_SYS,
        messages=[{"role": "user", "content": user}],
    )
    raw = "".join(getattr(b, "text", "") for b in msg.content)
    data = json.loads(_strip_json(raw))

    def _clean_chapters(items):
        out = []
        for it in items or []:
            try:
                t = int(it["t"])
                ttl = str(it.get("title") or "").strip()[:80]
            except (KeyError, TypeError, ValueError):
                continue
            if ttl and t >= 0:
                out.append({"t": t, "title": ttl})
        out.sort(key=lambda x: x["t"])
        return out

    def _clean_tickers(items):
        out, seen = [], set()
        for it in items or []:
            try:
                tk = str(it.get("ticker") or "").strip().upper().lstrip("$")
                t = int(it["t"])
            except (KeyError, TypeError, ValueError):
                continue
            if not tk or not re.fullmatch(r"[A-Z][A-Z.\-]{0,6}", tk) or t < 0:
                continue
            key = (tk, t // 30)  # collapse near-duplicate mentions (~30s buckets)
            if key in seen:
                continue
            seen.add(key)
            out.append({"ticker": tk, "t": t, "note": str(it.get("note") or "").strip()[:100]})
        out.sort(key=lambda x: x["t"])
        return out

    return {
        "chapters": _clean_chapters(data.get("chapters")),
        "ticker_moments": _clean_tickers(data.get("tickers")),
    }


# ── Transcript file selection ────────────────────────────────────────────────────

def _find_transcript_file(recording_json: dict):
    """Return the completed TRANSCRIPT recording_file (download_url present), or None."""
    for f in (recording_json or {}).get("recording_files") or []:
        ft = (f.get("file_type") or "").upper()
        rt = (f.get("recording_type") or "").lower()
        if (ft == "TRANSCRIPT" or rt == "audio_transcript") and f.get("download_url"):
            status = (f.get("status") or "completed").lower()
            if status in ("completed", ""):
                return f
    return None


# ── Orchestration ────────────────────────────────────────────────────────────────

def process_pending_session_insights(*, zoom=None) -> list[dict]:
    """Backfill chapters/ticker-moments for published session videos, then trash
    the Zoom recording. One pass; safe to call on a schedule. Never raises."""
    if not is_enabled():
        return []
    results: list[dict] = []
    try:
        pending = education_service.videos_pending_insights(_window_secs())
    except Exception as e:
        print(f"[session-insights] list pending failed: {e}")
        return []
    if not pending:
        return []

    from api.services.zoom_client import ZoomClient
    zoom = zoom or ZoomClient()
    max_wait = _max_wait_secs()
    now = int(time.time())

    for v in pending:
        vid = v["id"]
        uuid = v.get("meeting_uuid") or ""
        has_chapters = bool((v.get("chapters") or "").strip() not in ("", "[]"))
        try:
            rec = zoom.get_recording_files(uuid)
            if rec is None:  # recording already gone — nothing to fetch
                education_service.mark_zoom_cleaned(vid)
                if not has_chapters:
                    education_service.mark_insights_attempt(vid)
                results.append({"id": vid, "action": "recording_gone"})
                continue

            tfile = _find_transcript_file(rec)
            if tfile and not has_chapters:
                vtt = zoom.download_text(tfile["download_url"])
                cues = parse_vtt(vtt)
                if cues:
                    ins = generate_insights(v.get("title") or "", cues)
                    education_service.set_video_insights(
                        vid,
                        transcript=transcript_plain(cues),
                        chapters=ins["chapters"],
                        ticker_moments=ins["ticker_moments"],
                    )
                    has_chapters = True
                    results.append({"id": vid, "action": "generated",
                                    "chapters": len(ins["chapters"]),
                                    "tickers": len(ins["ticker_moments"])})

            # Clean up the Zoom recording once we've captured insights — or once
            # we've waited long enough that the transcript clearly isn't coming.
            age = now - int(v.get("created_at") or now)
            if has_chapters or age >= max_wait:
                try:
                    zoom.delete_recording(uuid)
                except Exception as de:
                    print(f"[session-insights] delete {uuid} failed (non-fatal): {de}")
                education_service.mark_zoom_cleaned(vid)
                if not has_chapters:
                    education_service.mark_insights_attempt(vid)
                    results.append({"id": vid, "action": "gave_up_transcript", "age_s": age})
            else:
                results.append({"id": vid, "action": "waiting_transcript", "age_s": age})
        except Exception as e:
            print(f"[session-insights] video {vid} failed (non-fatal): {e}")
    return results
