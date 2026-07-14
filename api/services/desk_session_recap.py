"""Discord session recaps — after the insights pass stores a session's
transcript/chapters/summary, Opus writes a detailed markdown recap (TL;DR,
key discussion points, tickers & levels, setups, takeaways, action items) and
posts it to the team's UCT Intelligence Discord via webhook.

Gated by DESK_SESSION_DISCORD_RECAP_ENABLED. The scheduled hook fires exactly
once per video — it's called only on the insights pass's 'generated' path,
which flips has_chapters and never re-enters. `POST /api/desk/recap/{id}`
(PUSH_SECRET) generates/re-posts manually and works with the flag off, so the
feature can be verified end-to-end before enabling. Fully additive/non-fatal.

Destination: DISCORD_RECAP_WEBHOOK_URL, falling back to DISCORD_WEBHOOK_URL
(#system-alerts) — point the dedicated var at a #session-recaps channel later
without touching code.
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.request

from api.services import education_service


def is_enabled() -> bool:
    return os.environ.get("DESK_SESSION_DISCORD_RECAP_ENABLED", "") == "1"


def _webhook_url() -> str:
    return (os.environ.get("DISCORD_RECAP_WEBHOOK_URL", "").strip()
            or os.environ.get("DISCORD_WEBHOOK_URL", "").strip())


# Recap quality is the whole point of the feature (it replaces a human writing
# meeting minutes), and the input is one transcript — cents per session on Opus.
_MODEL = os.environ.get("DESK_DISCORD_RECAP_MODEL", "claude-opus-4-8")

# Discord hard-caps content at 2000 chars/message; stay under with headroom.
_CHUNK_LIMIT = 1900
# Transcript cap for the LLM input — same rationale as the insights pass's
# _timestamped_block bound, but recaps don't need marathon-session tails.
_TRANSCRIPT_MAX_CHARS = 250_000


def _llm_timeout_secs() -> float:
    try:
        return float(os.environ.get("DESK_CHAPTERS_LLM_TIMEOUT_SECS", "300"))
    except ValueError:
        return 300.0


_SYS = (
    "You write the daily session recap for a stock-trading team's private Discord. "
    "You are given the timestamped transcript of a live trading session (plus any "
    "pre-computed chapters/summary) and must produce a COMPREHENSIVE, readable recap "
    "the team can act on without watching the video. Nothing that mattered may be "
    "missing: a teammate who reads only your recap must know every trade, every "
    "ticker call, every level, and every lesson from the session.\n"
    "Output PLAIN Discord markdown only (no code fences, no JSON), structured exactly:\n"
    "A single opening line: **TL;DR:** <2-3 sentences — the session's thrust and verdict>\n"
    "## Market Context & Game Plan  (regime, indices, the plan going in)\n"
    "## Session Timeline  (a chronological walkthrough of the ENTIRE session — one "
    "**bold [h:mm:ss] segment heading** per chapter/phase with detailed bullets under "
    "each; cover every chapter provided, no gaps, from open to close)\n"
    "## Trades & Executions  (EVERY trade taken or managed live: ticker, direction, "
    "entry/exit prices, stop, size context, result, and the stated reasoning; if no "
    "live trades, say so in one line)\n"
    "## Tickers & Levels  (every name genuinely discussed: ticker, what was said, "
    "any prices/levels — complete, not a sampling)\n"
    "## Setups & Lessons  (setups taught/applied and any process/psychology lessons)\n"
    "## Takeaways\n"
    "## Action Items  (ONLY if concrete follow-ups/tasks were actually said; otherwise omit the section)\n"
    "Rules:\n"
    "- Ground every claim in the transcript; never invent tickers, prices, or tasks.\n"
    "- Copy timestamps from the [h:mm:ss] markers, don't estimate.\n"
    "- Specific beats generic: prices, levels, names, reasons — no filler like "
    "'they discussed the market'.\n"
    "- Complete sentences; write for a teammate who missed the session.\n"
    "- Depth scales with length: a 3-hour session deserves a long recap. Meet the "
    "length target given in the user message. Use '## ' headers exactly as listed."
)

_TS_RE = re.compile(r"\[(?:(\d+):)?(\d{1,2}):(\d{2})\]")


def _session_minutes(transcript_block: str) -> int:
    """Session length from the last [h:mm:ss] marker in the stored transcript."""
    last = 0
    for m in _TS_RE.finditer(transcript_block):
        h, mm, ss = int(m.group(1) or 0), int(m.group(2)), int(m.group(3))
        last = max(last, h * 3600 + mm * 60 + ss)
    return last // 60


def _length_target(minutes: int) -> tuple[int, int]:
    """(lo, hi) recap character target scaled to session length — ~5k for a short
    session up to ~16k for a multi-hour one (Discord posts it in ~3-9 chunks)."""
    hi = max(5_000, min(16_000, minutes * 80))
    return int(hi * 0.7), hi


def generate_recap_markdown(title: str, transcript_block: str, ins: dict) -> str:
    """Opus turns the stored transcript (+ stored insights as a steer) into the
    Discord recap markdown. Raises on hard LLM failure so callers can surface
    or retry — mirrors generate_insights."""
    from api.services.engine import _get_anthropic_client

    context = {
        "headline": ins.get("headline") or "",
        "summary": ins.get("summary") or [],
        "chapters": ins.get("chapters") or [],
        "setups": ins.get("setups") or [],
    }
    minutes = _session_minutes(transcript_block)
    lo, hi = _length_target(minutes)
    user = (
        f"SESSION TITLE: {title}\n"
        f"SESSION LENGTH: ~{minutes} minutes\n"
        f"LENGTH TARGET: {lo}-{hi} characters — this is the floor for thoroughness, "
        f"not a nice-to-have. Your Session Timeline must cover every chapter listed "
        f"in the insights below.\n\n"
        f"PRE-COMPUTED INSIGHTS (steer, don't just restate):\n"
        f"{json.dumps(context, ensure_ascii=False)}\n\n"
        f"TRANSCRIPT:\n{transcript_block[:_TRANSCRIPT_MAX_CHARS]}"
    )
    client = _get_anthropic_client().with_options(timeout=_llm_timeout_secs())
    msg = client.messages.create(
        model=_MODEL,
        # generous headroom over the 16k-char ceiling (~4.5k tokens of text)
        max_tokens=10_000,
        system=_SYS,
        messages=[{"role": "user", "content": user}],
    )
    text = "".join(getattr(b, "text", "") for b in msg.content).strip()
    if not text:
        raise RuntimeError("recap LLM returned empty text")
    return text


def split_chunks(text: str, limit: int = _CHUNK_LIMIT) -> list[str]:
    """Split recap markdown into Discord-sized chunks, preferring '## ' section
    boundaries, then blank lines, then a hard cut. Never returns an empty list
    for non-empty input; chunks are stripped and non-empty."""
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    cur = ""
    for section in re.split(r"(?m)^(?=## )", text):
        if len(cur) + len(section) <= limit:
            cur += section
            continue
        if cur.strip():
            chunks.append(cur.rstrip())
        while len(section) > limit:  # single oversized section
            cut = section.rfind("\n\n", 0, limit)
            if cut <= 0:
                cut = limit
            chunks.append(section[:cut].rstrip())
            section = section[cut:].lstrip("\n")
        cur = section
    if cur.strip():
        chunks.append(cur.rstrip())
    return chunks


def _post_chunk(url: str, content: str) -> None:
    """One webhook message; a single 429 retry after the advised wait."""
    body = json.dumps({
        "username": "UCT Session Recap",
        "content": content,
        "allowed_mentions": {"parse": []},
    }).encode("utf-8")
    for attempt in (0, 1):
        req = urllib.request.Request(
            url, data=body,
            headers={"Content-Type": "application/json",
                     "User-Agent": "UCTSessionRecap/1.0"},
        )
        try:
            with urllib.request.urlopen(req, timeout=15):
                return
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt == 0:
                try:
                    wait = float(json.loads(e.read()).get("retry_after", 2))
                except Exception:
                    wait = 2.0
                time.sleep(min(wait, 10.0))
                continue
            raise


def post_recap_for_video(video_id: int) -> dict:
    """Generate + post the Discord recap for a published session video from its
    STORED transcript/insights (the Zoom recording is typically gone by now).
    Raises on hard failure — the admin endpoint surfaces the error."""
    url = _webhook_url()
    if not url:
        raise RuntimeError("no Discord webhook configured "
                           "(DISCORD_RECAP_WEBHOOK_URL / DISCORD_WEBHOOK_URL)")
    v = education_service.get_video(int(video_id))
    if not v:
        raise RuntimeError(f"video {video_id} not found")
    transcript = (v.get("transcript") or "").strip()
    if not transcript:
        raise RuntimeError(f"video {video_id} has no stored transcript yet")
    ins = education_service.get_insights(int(video_id))

    md = generate_recap_markdown(v.get("title") or "", transcript, ins)
    ytid = (v.get("youtube_id") or "").strip()
    links = ""
    if ytid:
        # <> suppresses Discord's giant embed cards; the copy-paste share text
        # stays clean for teasing members pre-launch.
        links = (
            f"🖥️ **Watch on UCT Intelligence:** "
            f"<https://uctintelligence.com/desk?section=videos&v={ytid}>\n"
            f"▶️ **YouTube:** <https://www.youtube.com/watch?v={ytid}>\n"
        )
    header = f"# 📋 {v.get('title') or 'Session Recap'}\n{links}\n"
    chunks = split_chunks(header + md)
    for chunk in chunks:
        _post_chunk(url, chunk)
        time.sleep(1)
    print(f"[session-recap] posted video {video_id} in {len(chunks)} message(s)")
    return {"ok": True, "id": int(video_id), "chunks": len(chunks),
            "chars": len(md)}


def maybe_post_recap(video_id: int) -> None:
    """Pipeline hook (insights pass, 'generated' path): gated + best-effort.
    Never raises — a Discord hiccup must not affect the insights store."""
    if not is_enabled():
        return
    try:
        post_recap_for_video(video_id)
    except Exception as e:
        print(f"[session-recap] video {video_id} failed (non-fatal): {e}")
