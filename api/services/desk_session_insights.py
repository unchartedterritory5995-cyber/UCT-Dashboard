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

import collections
import json
import os
import re
import time

from api.services import education_service

# ── Observability (2026-07-02) ───────────────────────────────────────────────────
# Per-video failures used to only print — logs are flooded, so a failing pass is
# indistinguishable from a never-ran one. `_RECENT_PASSES` gives an at-a-glance
# audit trail of the last dozen passes (results + errors); `_FAIL_STREAKS` counts
# CONSECUTIVE per-video failures so a stuck video fires exactly one Discord alert
# (at the 4th straight failure) instead of spamming or staying silent forever.
_RECENT_PASSES: "collections.deque[dict]" = collections.deque(maxlen=12)
_FAIL_STREAKS: dict[int, int] = {}
_FAIL_STREAK_ALERT_AT = 4

# Zoom's AI Companion SUMMARY file gives chapters/headline/summary for free on
# most sessions (see parse_zoom_summary below), so the LLM is now only needed
# for (a) the rare fallback when no usable summary file exists and (b) the
# small best-effort ticker-moments call. Haiku is plenty for both — cheaper
# default than the old Opus-only path (DESK_CHAPTERS_MODEL env still overrides).
_MODEL = os.environ.get("DESK_CHAPTERS_MODEL", "claude-haiku-4-5")

# Ticker-moments timestamp fidelity is a reasoning task (copy the EXACT
# preceding [h:mm:ss] marker, never estimate) — audit found real chips
# drifting onto neighboring topics' timestamps and even past the video's end.
# Sonnet is materially more careful here for ~5 cents/video; independent knob
# from _MODEL (the chapters-fallback path) so this can be tuned/rolled back
# on its own. Used ONLY by generate_ticker_moments.
_TICKER_MODEL = os.environ.get("DESK_TICKERS_MODEL", "claude-sonnet-5")


def is_enabled() -> bool:
    return os.environ.get("DESK_SESSION_CHAPTERS_ENABLED", "") == "1"


def _max_wait_secs() -> int:
    try:
        hrs = float(os.environ.get("DESK_SESSION_TRANSCRIPT_MAX_WAIT_HRS", "24"))
    except ValueError:
        hrs = 24.0
    return int(hrs * 3600)


def _llm_timeout_secs() -> float:
    try:
        return float(os.environ.get("DESK_CHAPTERS_LLM_TIMEOUT_SECS", "300"))
    except ValueError:
        return 300.0


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


_TB_LINE = re.compile(r"^\[(?:(\d+):)?(\d{1,2}):(\d{2})\] (.*)$")


def _parse_timestamped_block(text: str) -> list[dict]:
    """Inverse of `_timestamped_block` — recovers [{t, text}] cues from the
    STORED transcript (we persist the timestamped form, not the flat
    `transcript_plain` one, precisely so the ticker-backfill loop can retry
    later with zero Zoom dependency — the recording is long since trashed)."""
    cues: list[dict] = []
    for line in (text or "").split("\n"):
        m = _TB_LINE.match(line)
        if not m:
            continue
        h, mnt, s = int(m.group(1) or 0), int(m.group(2)), int(m.group(3))
        cues.append({"t": h * 3600 + mnt * 60 + s, "text": m.group(4)})
    return cues


# ── Zoom-native summary parsing (free chapters — no LLM) ────────────────────────

_HMS = re.compile(r"^(\d+):(\d{2}):(\d{2})(?:[.,]\d+)?$")


def _hms_to_secs(ts) -> "int | None":
    """Parse a Zoom summary `start_time`/`end_time` string ("HH:MM:SS.mmm")
    into whole seconds. None on anything that isn't that shape."""
    if not isinstance(ts, str):
        return None
    m = _HMS.match(ts.strip())
    if not m:
        return None
    h, mnt, s = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return h * 3600 + mnt * 60 + s


def parse_zoom_summary(raw: str) -> dict:
    """Parse Zoom AI Companion's SUMMARY file JSON into
    {headline, summary, chapters} — chapters straight from `items[]`, free
    (no LLM). Tolerant of malformed JSON / missing items / partial rows;
    always returns the full shape."""
    empty = {"headline": "", "summary": [], "chapters": []}
    try:
        data = json.loads(raw or "")
    except (json.JSONDecodeError, TypeError):
        return empty
    if not isinstance(data, dict):
        return empty

    items = data.get("items")
    if not isinstance(items, list):
        items = []

    chapters = []
    for it in items:
        if not isinstance(it, dict):
            continue
        title = str(it.get("label") or "").strip()[:80]
        t = _hms_to_secs(it.get("start_time"))
        if not title or t is None:
            continue
        chapters.append({"t": t, "title": title})
    chapters.sort(key=lambda c: c["t"])

    summary = []
    for it in items:
        if not isinstance(it, dict):
            continue
        s = str(it.get("summary") or "").strip()
        if s:
            summary.append(s[:300])
    summary = summary[:6]

    headline = str(data.get("overall_summary") or "").strip()[:200]
    return {"headline": headline, "summary": summary, "chapters": chapters}


def _recap_date(title: str) -> str:
    """Session titles are '{type} — {Month D, YYYY}'; pull the date tail for the
    poster, falling back to the whole title."""
    t = (title or "").strip()
    if "—" in t:
        return t.rsplit("—", 1)[-1].strip() or t
    return t


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
    "Produce navigation aids + a recap as STRICT JSON only (no prose, no code fences):\n"
    '{ "headline": "<=90 chars", "summary": ["<=140 chars", ...], '
    '"chapters": [ {"t": <int seconds>, "title": "<=60 chars} ], '
    '"tickers": [ {"ticker": "AAPL", "t": <int seconds>, "note": "<=80 chars} ] }\n'
    "Rules:\n"
    "- headline: one punchy sentence capturing the session's main thrust (the day's "
    "thesis / what mattered). No date, no 'In this session'.\n"
    "- summary: 3-5 key-takeaway bullets a trader would care about (the actionable "
    "ideas, levels, lessons) — concise, specific, no fluff.\n"
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


# Shared LLM-output cleaners (module-level so both generate_insights and the
# ticker-only generate_ticker_moments can reuse them).

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


def _clean_summary(items):
    out = []
    for s in items or []:
        t = str(s or "").strip()
        if t:
            out.append(t[:200])
    return out[:6]


def generate_insights(title: str, cues: list[dict]) -> dict:
    """LLM fallback (only used when no usable Zoom summary file exists): turn
    cues into {headline, summary, chapters, ticker_moments}. Raises on hard
    LLM failure so the caller can decide to retry (don't store / don't give
    up yet)."""
    from api.services.engine import _get_anthropic_client
    block = _timestamped_block(cues)
    if not block:
        return {"chapters": [], "ticker_moments": [], "headline": "", "summary": []}
    user = f"VIDEO TITLE: {title}\n\nTRANSCRIPT:\n{block}"
    # The shared client is hard-capped at 60s to protect the request path
    # (2026-07-01 thread-exhaustion hardening), but a marathon-session
    # transcript + 2400 output tokens from Opus cannot finish in 60s. This
    # runs on the background insights scheduler, never a user request, so a
    # long bound is safe here — without it every generation times out.
    client = _get_anthropic_client().with_options(timeout=_llm_timeout_secs())
    msg = client.messages.create(
        model=_MODEL,
        max_tokens=2400,
        system=_SYS,
        messages=[{"role": "user", "content": user}],
    )
    raw = "".join(getattr(b, "text", "") for b in msg.content)
    data = json.loads(_strip_json(raw))

    return {
        "headline": str(data.get("headline") or "").strip()[:200],
        "summary": _clean_summary(data.get("summary")),
        "chapters": _clean_chapters(data.get("chapters")),
        "ticker_moments": _clean_tickers(data.get("tickers")),
    }


# ── Ticker-moments — LLM-only, best-effort (never blocks the Zoom-first path) ───

_TICKER_SYS = (
    "You are scanning a timestamped transcript of a stock-trading firm's live "
    "session / educational webinar for stock/ETF mentions. Return STRICT JSON "
    "only (no prose, no code fences):\n"
    '{ "ticker_moments": [ {"t": <int seconds>, "ticker": "AAPL"} ] }\n'
    "List the stock/ETF mentions actually DISCUSSED — analyzed, traded, or given "
    "real commentary — AT MOST the 60 most significant. Do NOT include a ticker "
    "that is merely listed in passing (e.g. rattled off in a scanner/watchlist "
    "recitation with no comment on it) — only genuine discussion counts.\n"
    "TIMESTAMP RULE (critical — do not violate): for each mention, find the "
    "[h:mm:ss] marker line the mention appears on or the marker immediately "
    "PRECEDING it, and copy that marker's seconds value VERBATIM as `t`. Never "
    "estimate, interpolate, or invent a timestamp, and never attribute a "
    "mention to a neighboring topic's timestamp — if you are not sure which "
    "marker a mention belongs to, use the nearest one that precedes it, not a "
    "later one. `t` must never exceed the LAST [h:mm:ss] marker in the "
    "transcript — nothing in this video happens after the transcript ends.\n"
    "Map spoken company names to the correct US ticker (Nvidia->NVDA). "
    "De-dup obvious repeats but keep distinct revisits. Output ONLY the JSON "
    "object."
)


def _salvage_truncated_json(raw: str) -> str:
    """A max_tokens-truncated ticker response dies mid-array. Recover the
    complete leading objects: cut at the last complete '}' and close whatever
    brackets/braces remain open (string-aware). '' when nothing usable."""
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end <= start:
        return ""
    s = raw[start:end + 1]
    stack, in_str, esc = [], False, False
    for ch in s:
        if esc:
            esc = False
        elif ch == "\\":
            esc = True
        elif ch == '"':
            in_str = not in_str
        elif not in_str:
            if ch in "[{":
                stack.append(ch)
            elif ch == "]" and stack and stack[-1] == "[":
                stack.pop()
            elif ch == "}" and stack and stack[-1] == "{":
                stack.pop()
    return s + "".join("]" if c == "[" else "}" for c in reversed(stack))


def _max_cue_t(cues: list[dict]) -> int:
    """Last transcript timestamp — the deterministic ceiling for ticker chips.
    Cues are documented as time-ordered, but that's an assumption from an
    upstream parser, not a guarantee: verify the ordering and fall back to
    max() rather than blindly trusting cues[-1]."""
    if not cues:
        return 0
    last = cues[-1]["t"]
    if all(cues[i]["t"] <= cues[i + 1]["t"] for i in range(len(cues) - 1)):
        return last
    return max(c["t"] for c in cues)


def _filter_ticker_moments(moments: list[dict], cues: list[dict]) -> list[dict]:
    """Deterministic guard against LLM extrapolation: an audit found chips at
    timestamps BEYOND the video's end and tickers drifting onto neighboring
    topics' timestamps. Drop anything outside [0, max_t + 60] (a small grace
    window for a mention right at the tail, past the last marker's start) and
    de-dup exact (t, ticker) repeats."""
    max_t = _max_cue_t(cues)
    out, seen = [], set()
    for m in moments:
        t = m.get("t")
        if t is None or not (0 <= t <= max_t + 60):
            continue
        key = (m.get("ticker"), t)
        if key in seen:
            continue
        seen.add(key)
        out.append(m)
    return out


def generate_ticker_moments(title: str, cues: list[dict]) -> list[dict]:
    """Small best-effort LLM call for ticker_moments ONLY — the only LLM touch
    on the Zoom-first path (chapters/headline/summary there are free, straight
    from Zoom's own SUMMARY file). Raises on failure; callers MUST wrap this
    so a billing/LLM hiccup never blocks publishing the free Zoom chapters."""
    from api.services.engine import _get_anthropic_client
    block = _timestamped_block(cues)
    if not block:
        return []
    user = f"VIDEO TITLE: {title}\n\nTRANSCRIPT:\n{block}"
    client = _get_anthropic_client().with_options(timeout=_llm_timeout_secs())
    msg = client.messages.create(
        model=_TICKER_MODEL,
        max_tokens=4000,
        # Sonnet 5 runs ADAPTIVE THINKING by default when `thinking` is omitted,
        # and max_tokens caps thinking + answer COMBINED — on a marathon
        # transcript the model burned the whole budget reasoning and returned
        # zero text (stop_reason=max_tokens, content=[ThinkingBlock]). This is
        # mechanical extraction; spend the entire budget on the answer.
        thinking={"type": "disabled"},
        system=_TICKER_SYS,
        messages=[{"role": "user", "content": user}],
    )
    raw = "".join(getattr(b, "text", "") for b in msg.content)
    try:
        data = json.loads(_strip_json(raw))
    except json.JSONDecodeError:
        # max_tokens truncation cuts the array mid-object — salvage the
        # complete leading moments rather than losing the whole video's chips.
        data = json.loads(_salvage_truncated_json(raw))
    moments = _clean_tickers(data.get("ticker_moments"))
    return _filter_ticker_moments(moments, cues)


# ── Recording-file selection ─────────────────────────────────────────────────────

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


def _find_summary_file(recording_json: dict):
    """Return Zoom AI Companion's SUMMARY recording_file (download_url
    present), or None. MUST NOT match the sibling `summary_next_steps` file
    (action items — not what we want)."""
    for f in (recording_json or {}).get("recording_files") or []:
        ft = (f.get("file_type") or "").upper()
        rt = (f.get("recording_type") or "").lower()
        if ft == "SUMMARY" and rt == "summary" and f.get("download_url"):
            return f
    return None


# ── Orchestration ────────────────────────────────────────────────────────────────

_TICKER_BACKFILL_LIMIT = 3  # bounded — best-effort, one small LLM call per video


def _generate_poster(vid: int, v: dict, ins: dict) -> bool:
    """Branded recap poster from the summary (best-effort — never blocks
    storing the text insights if Pillow hiccups)."""
    try:
        from api.services import desk_recap_poster
        desk_recap_poster.save_recap_poster(
            vid,
            title=v.get("title") or "Session Recap",
            date_text=_recap_date(v.get("title")),
            headline=ins.get("headline", ""),
            summary=ins.get("summary", []),
            tickers=[t["ticker"] for t in ins["ticker_moments"]],
        )
        return True
    except Exception as pe:
        print(f"[session-insights] poster render failed (non-fatal): {pe}")
        return False


def _fire_fail_streak_alert(vid: int, title: str, last_error: str) -> None:
    """Best-effort Discord alert once a video hits _FAIL_STREAK_ALERT_AT
    consecutive failures. Never raises — a notification hiccup must never
    interrupt the insights pass."""
    try:
        from api.services import discord_notify
        discord_notify._send_webhook({
            "title": "⚠️ Session insights failing repeatedly",
            "description": (f"Video #{vid} ({title or 'untitled'}) has failed "
                            f"{_FAIL_STREAK_ALERT_AT} consecutive insights passes.\n"
                            f"Last error: {last_error}"),
            "color": 0xE0A800,
        })
    except Exception:
        pass


def _process_one_pending(v: dict, zoom, max_wait: int, now: int, results: list[dict],
                         errors: list[dict]) -> None:
    """Thin wrapper: runs `_run_one_pending` and turns any exception into a
    tracked error + fail-streak bump (alerting once at the threshold), or
    resets the streak on any non-raising completion (success or a legitimate
    skip/wait path — both mean this pass did NOT fail)."""
    vid = v.get("id")
    try:
        _run_one_pending(v, zoom, max_wait, now, results)
    except Exception as e:
        msg = str(e)
        print(f"[session-insights] video {vid} failed (non-fatal): {msg}")
        errors.append({"id": vid, "error": msg[:300]})
        streak = _FAIL_STREAKS.get(vid, 0) + 1
        _FAIL_STREAKS[vid] = streak
        if streak == _FAIL_STREAK_ALERT_AT:
            _fire_fail_streak_alert(vid, v.get("title") or "", msg[:300])
    else:
        _FAIL_STREAKS.pop(vid, None)


def _run_one_pending(v: dict, zoom, max_wait: int, now: int, results: list[dict]) -> None:
    vid = v["id"]
    uuid = v.get("meeting_uuid") or ""
    has_chapters = bool((v.get("chapters") or "").strip() not in ("", "[]"))
    age = now - int(v.get("created_at") or now)
    rec = zoom.get_recording_files(uuid)
    if rec is None:  # recording already gone — nothing to fetch
        education_service.mark_zoom_cleaned(vid)
        if not has_chapters:
            education_service.mark_insights_attempt(vid)
        results.append({"id": vid, "action": "recording_gone"})
        return

    if not has_chapters:
        # 1) Zoom-first (free): Zoom's AI Companion SUMMARY file already
        # has chapters/headline/summary — no LLM needed at all.
        zoom_ins = None
        sfile = _find_summary_file(rec)
        if sfile:
            try:
                raw = zoom.download_text(sfile["download_url"])
                parsed = parse_zoom_summary(raw)
            except Exception as se:
                print(f"[session-insights] summary parse failed (non-fatal): {se}")
                parsed = None
            if parsed and parsed.get("chapters"):
                zoom_ins = parsed

        # Transcript fetch/parse unchanged — feeds the plain transcript
        # storage AND the ticker-moments call regardless of which path
        # supplied the chapters.
        cues: list[dict] = []
        tfile = _find_transcript_file(rec)
        if tfile:
            try:
                vtt = zoom.download_text(tfile["download_url"])
                cues = parse_vtt(vtt)
            except Exception as te:
                print(f"[session-insights] transcript download failed (non-fatal): {te}")
                cues = []

        # Zoom generates the transcript VTT asynchronously and it can
        # trail the SUMMARY file (zoom_client.py: "may be absent on
        # early calls"). If the summary already gave us chapters but the
        # transcript isn't here yet, do NOT store/trash/stamp now —
        # trashing sets zoom_cleaned, which permanently forecloses both
        # a future transcript fetch AND the ticker-backfill loop (it
        # requires a stored transcript). Wait for the next scheduled
        # pass instead, unless we've already exhausted max_wait (then
        # fall through to the existing bounded give-up path below).
        if zoom_ins and not cues and age < max_wait:
            print(f"[session-insights] video {vid} has summary chapters but "
                  f"transcript isn't ready yet — waiting (age={age}s)")
            results.append({"id": vid, "action": "waiting_transcript_have_summary",
                            "age_s": age})
            return

        ins, source = None, None
        if zoom_ins:
            # 3) Ticker moments = LLM-only, best-effort, never blocking.
            ticker_moments: list[dict] = []
            if cues:
                try:
                    ticker_moments = generate_ticker_moments(v.get("title") or "", cues)
                except Exception as tke:
                    print(f"[session-insights] ticker moments failed (non-fatal): {tke}")
                    ticker_moments = []
            ins = {
                "headline": zoom_ins.get("headline", ""),
                "summary": zoom_ins.get("summary", []),
                "chapters": zoom_ins.get("chapters", []),
                "ticker_moments": ticker_moments,
            }
            source = "zoom"
        elif cues:
            # 2) LLM fallback — only when no usable summary file exists.
            ins = generate_insights(v.get("title") or "", cues)
            source = "llm"

        if ins and ins.get("chapters"):
            poster_ok = _generate_poster(vid, v, ins)
            education_service.set_video_insights(
                vid,
                # Timestamped (not flattened) so the ticker-backfill loop
                # can recover cues from disk with zero Zoom dependency.
                transcript=_timestamped_block(cues) if cues else None,
                chapters=ins["chapters"],
                ticker_moments=ins["ticker_moments"],
                headline=ins.get("headline", ""),
                summary=ins.get("summary", []),
                poster=poster_ok,
            )
            has_chapters = True
            results.append({"id": vid, "action": "generated", "source": source,
                            "chapters": len(ins["chapters"]),
                            "tickers": len(ins["ticker_moments"]),
                            "poster": poster_ok})

    # Clean up the Zoom recording once we've captured insights — or once
    # we've waited long enough that the transcript clearly isn't coming.
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


def _ticker_backfill_enabled() -> bool:
    return os.environ.get("DESK_CHAPTERS_TICKER_BACKFILL", "1") != "0"


def _run_ticker_backfill(results: list[dict], errors: list[dict]) -> None:
    """4) Ticker backfill: videos already carrying chapters + a stored
    transcript but EMPTY ticker_moments get a bounded, best-effort retry from
    the STORED transcript — no Zoom dependency (the recording is already
    trashed by this point). A failed attempt just waits for the next pass.
    Failures feed the same errors/fail-streak observability as the main pass —
    a silently-failing backfill looked identical to an idle one (2026-07-02)."""
    if not _ticker_backfill_enabled():
        return
    try:
        rows = education_service.videos_missing_ticker_moments(
            _window_secs(), _TICKER_BACKFILL_LIMIT
        )
    except Exception as e:
        print(f"[session-insights] ticker backfill list failed: {e}")
        return
    for v in rows:
        vid = v.get("id")
        cues = _parse_timestamped_block(v.get("transcript") or "")
        if not cues:
            continue
        try:
            tickers = generate_ticker_moments(v.get("title") or "", cues)
        except Exception as e:
            msg = str(e)
            print(f"[session-insights] ticker backfill {vid} failed (non-fatal): {msg}")
            errors.append({"id": vid, "error": f"ticker_backfill: {msg[:280]}"})
            streak = _FAIL_STREAKS.get(vid, 0) + 1
            _FAIL_STREAKS[vid] = streak
            if streak == _FAIL_STREAK_ALERT_AT:
                _fire_fail_streak_alert(vid, v.get("title") or "", msg[:300])
            continue  # don't stamp/poison anything — next pass retries
        _FAIL_STREAKS.pop(vid, None)
        education_service.set_video_insights(vid, ticker_moments=tickers)
        results.append({"id": vid, "action": "ticker_backfill", "tickers": len(tickers)})


def process_pending_session_insights(*, zoom=None) -> list[dict]:
    """Backfill chapters/ticker-moments for published session videos, then trash
    the Zoom recording. One pass; safe to call on a schedule. Never raises."""
    if not is_enabled():
        return []
    results: list[dict] = []
    errors: list[dict] = []
    try:
        pending = education_service.videos_pending_insights(_window_secs())
    except Exception as e:
        print(f"[session-insights] list pending failed: {e}")
        pending = []

    if pending:
        from api.services.zoom_client import ZoomClient
        zoom = zoom or ZoomClient()
        max_wait = _max_wait_secs()
        now = int(time.time())
        for v in pending:
            _process_one_pending(v, zoom, max_wait, now, results, errors)

    # Independent of the main pass above — runs even when `pending` is empty,
    # and never touches Zoom (stored transcript only).
    _run_ticker_backfill(results, errors)
    _RECENT_PASSES.append({"ts": int(time.time()), "results": list(results), "errors": errors})
    return results


def get_insights_status() -> dict:
    """Observability snapshot for GET /api/desk/insights-status: the current
    pending-work queue + the last dozen pass results/errors + per-video
    consecutive-failure counters. Never raises."""
    try:
        pending_rows = education_service.videos_pending_insights(_window_secs())
    except Exception as e:
        print(f"[session-insights] status: list pending failed: {e}")
        pending_rows = []
    return {
        "pending": [{"id": v.get("id"), "title": v.get("title")} for v in pending_rows],
        "recent_passes": list(_RECENT_PASSES),
        "fail_streaks": dict(_FAIL_STREAKS),
    }
