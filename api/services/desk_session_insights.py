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

# Recap polish (headline + key-takeaway bullets) is the most user-visible text
# in the product — Zoom's own summary prose is generic ("Patrick and Uncharted
# discussed…") and was shipped verbatim. The polish input is TINY (Zoom summary
# + chapter titles + a sampled transcript excerpt, never the full transcript),
# so the per-session cost stays cents even on Opus.
_RECAP_MODEL = os.environ.get("DESK_RECAP_MODEL", "claude-opus-4-8")


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

_SENT_END = re.compile(r"[.!?][\"')\]]?\s")


def _sentence_trim(text: str, max_chars: int) -> str:
    """Bound `text` to max_chars WITHOUT cutting mid-sentence (the old hard
    [:N] slice shipped bullets ending "…The conversa" to the UI + poster).
    Prefer the last complete sentence inside the window; if the window holds
    no sentence end, cut at a word boundary and mark the cut with an ellipsis."""
    t = (text or "").strip()
    if len(t) <= max_chars:
        return t
    window = t[:max_chars]
    ends = [m.end() for m in _SENT_END.finditer(window + " ")]
    # A sentence end too early in the window would throw away most of the
    # budget — only take it when it keeps at least ~40% of the window.
    if ends and ends[-1] >= max_chars * 0.4:
        return window[:ends[-1]].strip()
    cut = window.rsplit(" ", 1)[0].rstrip(" ,;:—-")
    return (cut + "…") if cut else window


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
            # Sentence-safe bound (generous — the polish pass compresses; this
            # is a runaway-input guard, not the display length).
            summary.append(_sentence_trim(s, 600))
    summary = summary[:6]

    headline = _sentence_trim(str(data.get("overall_summary") or ""), 400)
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


def _loads_json(raw: str):
    """Parse LLM JSON, repairing the common malformations (trailing commas,
    unescaped quotes inside strings) that otherwise crash json.loads on long
    marathon-session outputs — a recurring, non-random failure on big transcripts."""
    s = _strip_json(raw)
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        from json_repair import repair_json
        return json.loads(repair_json(s))


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


def _clean_summary(items, max_len: int = 200):
    out = []
    for s in items or []:
        t = str(s or "").strip()
        if t:
            out.append(_sentence_trim(t, max_len))
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
    data = _loads_json(raw)

    return {
        "headline": str(data.get("headline") or "").strip()[:200],
        "summary": _clean_summary(data.get("summary")),
        "chapters": _clean_chapters(data.get("chapters")),
        "ticker_moments": _clean_tickers(data.get("tickers")),
    }


# The firm's fixed setup playbook — MUST match the names in
# app/src/pages/modelbook/setupCatalog.js so the Setup-Library deep-link resolves.
_SETUP_TAXONOMY = [
    "Flat Base Breakout", "Bull Flag", "IPO Base", "Launchpad", "Cup & Handle",
    "20 EMA Pullback", "EMA Crossback", "Wedge Pop", "Wedge Drop", "Episodic Pivot",
    "Power Earnings Gap", "News/Earnings Gapper", "High Volume Edge", "Gap Support",
    "Kicker Candle", "2B Reversal", "U&R (Undercut & Rally)", "Slingshot",
    "Oops Reversal", "Remount", "Failed H&S / Rounded Top", "Parabolic Long",
    "Parabolic Short", "ORB (Opening Range Break)", "30-Minute Pivot", "Go Signal",
]
_SETUP_CANON = {s.lower(): s for s in _SETUP_TAXONOMY}

_SETUPS_SYS = (
    "You are analyzing a timestamped transcript of a stock-trading session/lesson from a "
    "firm with a FIXED setup playbook. Identify which of the firm's setups are genuinely "
    "TAUGHT or applied in this video. Map ONLY to these exact names (verbatim):\n"
    + "; ".join(_SETUP_TAXONOMY) + "\n"
    "Output STRICT JSON only (no prose, no code fences):\n"
    '{ "setups": [ {"setup": "<exact name from the list>", "note": "<=60 chars how it was '
    'used", "t": <int seconds first discussed>} ] }\n'
    "Rules: 0-6 setups, only ones genuinely covered (not passing name-drops); the setup MUST "
    "be one of the exact names above — drop anything else. Output ONLY the JSON object."
)


def _clean_setups(items):
    """Keep only setups that map to a canonical taxonomy name; de-duped."""
    out, seen = [], set()
    for it in items or []:
        try:
            canon = _SETUP_CANON.get(str(it.get("setup") or "").strip().lower())
        except (AttributeError, TypeError, ValueError):
            continue
        if not canon or canon in seen:
            continue
        seen.add(canon)
        try:
            t = int(it["t"])
            if t < 0:
                t = None
        except (KeyError, TypeError, ValueError):
            t = None
        out.append({"setup": canon, "note": str(it.get("note") or "").strip()[:80], "t": t})
    return out[:6]


def generate_setups(title: str, cues: list[dict]) -> list[dict]:
    """Focused LLM call: which of the firm's playbook setups this video teaches,
    mapped precisely to the canonical taxonomy (validated, so no mislabeling)."""
    from api.services.engine import _get_anthropic_client
    block = _timestamped_block(cues)
    if not block:
        return []
    client = _get_anthropic_client().with_options(timeout=_llm_timeout_secs())
    msg = client.messages.create(
        model=os.environ.get("DESK_SETUPS_MODEL", _MODEL),
        max_tokens=1000,
        system=_SETUPS_SYS,
        messages=[{"role": "user", "content": f"VIDEO TITLE: {title}\n\nTRANSCRIPT:\n{block}"}],
    )
    raw = "".join(getattr(b, "text", "") for b in msg.content)
    return _clean_setups(_loads_json(raw).get("setups"))


# ── Recap polish — small LLM rewrite of Zoom's generic summary prose ────────────

def _recap_polish_enabled() -> bool:
    return os.environ.get("DESK_RECAP_POLISH", "1") != "0"


_RECAP_SYS = (
    "You are the head editor for a stock-trading firm's video library. You are "
    "given machine-generated summary notes for a recorded live trading session, "
    "plus chapter titles and a sampled transcript excerpt for grounding. Rewrite "
    "them into a session recap traders actually want to read. Return STRICT JSON "
    "only (no prose, no code fences):\n"
    '{ "headline": "<=110 chars", "summary": ["<=170 chars", ...] }\n'
    "Rules:\n"
    "- headline: ONE complete punchy sentence — the day's thesis / what mattered "
    "most. No date, no 'In this session', no 'The group discussed'.\n"
    "- summary: 4-6 key-takeaway bullets. Each is a COMPLETE sentence, specific "
    "and concrete: name the tickers, levels, setups, and decisions (e.g. 'MBIS "
    "and ARMS held as focus longs around key support' beats 'they discussed "
    "specific stocks'). Pull specifics from the transcript excerpt when the "
    "notes are vague.\n"
    "- NEVER write meta-narration: no 'Patrick and X discussed', 'The "
    "conversation covered', 'They analyzed'. State the market content itself.\n"
    "- Only include facts supported by the notes/excerpt — do not invent "
    "prices, levels, or outcomes.\n"
    "- Output ONLY the JSON object."
)


def _sampled_excerpt(cues: list[dict], max_chars: int = 12_000) -> str:
    """Evenly-sampled timestamped lines spanning the WHOLE session (a head-only
    slice would bias the polish toward the open). Tiny by design — grounding
    for specifics, not a re-summarization of the full transcript."""
    if not cues:
        return ""
    lines = [f"[{_hhmmss(c['t'])}] {c['text']}" for c in cues]
    total = sum(len(ln) + 1 for ln in lines)
    if total <= max_chars:
        return "\n".join(lines)
    # Walk evenly across the cue list, keeping every k-th line until budget.
    step = max(1, int(total / max_chars))
    out, used = [], 0
    for ln in lines[::step]:
        if used + len(ln) + 1 > max_chars:
            break
        out.append(ln)
        used += len(ln) + 1
    return "\n".join(out)


def polish_recap(title: str, headline: str, summary: list[str],
                 chapters: list[dict], cues: list[dict]) -> dict:
    """One small LLM call that turns Zoom's generic truncated summary prose into
    a punchy trader-grade headline + takeaways. Input is bounded (~a few K
    tokens) regardless of session length. Raises on failure — callers MUST
    treat this as best-effort and keep the sentence-trimmed Zoom text."""
    from api.services.engine import _get_anthropic_client
    notes = "\n".join(f"- {s}" for s in summary if (s or "").strip())
    chap = "\n".join(f"[{_hhmmss(c['t'])}] {c['title']}" for c in (chapters or []))
    user = (
        f"VIDEO TITLE: {title}\n\n"
        f"MACHINE HEADLINE:\n{headline or '(none)'}\n\n"
        f"MACHINE SUMMARY NOTES:\n{notes or '(none)'}\n\n"
        f"CHAPTERS:\n{chap or '(none)'}\n\n"
        f"TRANSCRIPT EXCERPT (sampled):\n{_sampled_excerpt(cues) or '(none)'}"
    )
    client = _get_anthropic_client().with_options(timeout=_llm_timeout_secs())
    msg = client.messages.create(
        model=_RECAP_MODEL,
        max_tokens=1200,
        # Mechanical budget discipline (same trap as the ticker call): thinking
        # shares max_tokens, and this rewrite doesn't need it.
        thinking={"type": "disabled"},
        system=_RECAP_SYS,
        messages=[{"role": "user", "content": user}],
    )
    raw = "".join(getattr(b, "text", "") for b in msg.content)
    data = _loads_json(raw)
    out = {
        "headline": _sentence_trim(str(data.get("headline") or ""), 160),
        "summary": _clean_summary(data.get("summary"), max_len=240),
    }
    if not out["headline"] or len(out["summary"]) < 3:
        raise ValueError(f"polish returned thin recap "
                         f"(headline={bool(out['headline'])}, bullets={len(out['summary'])})")
    return out


def _apply_recap_polish(ins: dict, title: str, cues: list[dict]) -> bool:
    """Best-effort in-place polish of ins[headline/summary]; True on success.
    A polish failure must NEVER block storing/publishing the free Zoom recap."""
    if not _recap_polish_enabled():
        return False
    try:
        polished = polish_recap(title, ins.get("headline", ""),
                                ins.get("summary", []), ins.get("chapters", []), cues)
    except Exception as pe:
        print(f"[session-insights] recap polish failed (non-fatal): {pe}")
        return False
    ins["headline"], ins["summary"] = polished["headline"], polished["summary"]
    return True


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
        data = _loads_json(raw)
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
            # De-dup revisits (MU can appear 3× in ticker_moments) so the
            # poster's pill slots aren't wasted on repeats.
            tickers=list(dict.fromkeys(t["ticker"] for t in ins["ticker_moments"])),
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
            if _apply_recap_polish(ins, v.get("title") or "", cues):
                source = "zoom+polish"
        elif cues:
            # 2) LLM fallback — only when no usable summary file exists.
            ins = generate_insights(v.get("title") or "", cues)
            source = "llm"

        if ins and ins.get("chapters"):
            poster_ok = _generate_poster(vid, v, ins)
            try:  # firm-playbook setup tags (best-effort, never blocks the store)
                setups = generate_setups(v.get("title") or "", cues) if cues else []
            except Exception as se:
                print(f"[session-insights] setup tagging failed (non-fatal): {se}")
                setups = []
            education_service.set_video_insights(
                vid,
                # Timestamped (not flattened) so the ticker-backfill loop
                # can recover cues from disk with zero Zoom dependency.
                transcript=_timestamped_block(cues) if cues else None,
                chapters=ins["chapters"],
                ticker_moments=ins["ticker_moments"],
                headline=ins.get("headline", ""),
                summary=ins.get("summary", []),
                setups=setups,
                poster=poster_ok,
            )
            try:  # refresh the community thread body with the polished recap (non-fatal)
                from api.services import community_seed
                community_seed.upsert_desk_thread(vid)
            except Exception as ce:
                print(f"[desk-insights] community seed refresh failed (non-fatal): {ce}")
            # Team Discord recap — this 'generated' path runs once per video
            # (has_chapters flips), so the recap can't double-post.
            from api.services import desk_session_recap
            desk_session_recap.maybe_post_recap(vid)
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


def repolish_video(video_id: int) -> dict:
    """One-shot recap re-polish for an ALREADY-published video, entirely from
    stored data (the Zoom recording is long gone): stored headline/summary/
    chapters + an excerpt of the stored transcript → polish_recap → store +
    re-render the poster. Backfills videos published before the polish pass
    existed (their stored text is Zoom's generic prose, hard-truncated
    mid-sentence). Raises on failure — the admin endpoint surfaces the error."""
    v = education_service.get_video(int(video_id))
    if not v:
        raise ValueError(f"video {video_id} not found")
    stored = education_service.get_insights(int(video_id))
    ins = {
        "headline": stored.get("headline", ""),
        "summary": stored.get("summary", []),
        "chapters": stored.get("chapters", []),
        "ticker_moments": stored.get("ticker_moments", []),
    }
    if not ins["summary"] and not ins["headline"]:
        raise ValueError(f"video {video_id} has no stored recap to polish")
    cues = _parse_timestamped_block(v.get("transcript") or "")
    polished = polish_recap(v.get("title") or "", ins["headline"], ins["summary"],
                            ins["chapters"], cues)
    ins["headline"], ins["summary"] = polished["headline"], polished["summary"]
    poster_ok = _generate_poster(int(video_id), v, ins)
    education_service.set_video_insights(
        int(video_id),
        headline=ins["headline"],
        summary=ins["summary"],
        poster=poster_ok or None,  # never clear an existing poster flag on a render hiccup
    )
    try:  # refresh the community thread body with the polished recap (non-fatal)
        from api.services import community_seed
        community_seed.upsert_desk_thread(video_id)
    except Exception as ce:
        print(f"[desk-insights] community seed refresh failed (non-fatal): {ce}")
    return {"id": int(video_id), "headline": ins["headline"],
            "summary": ins["summary"], "poster": poster_ok}


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
