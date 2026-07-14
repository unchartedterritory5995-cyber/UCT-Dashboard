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
    "pre-computed chapters/summary) and must produce a DETAILED, readable recap the "
    "team can act on without watching the video.\n"
    "Output PLAIN Discord markdown only (no code fences, no JSON), structured exactly:\n"
    "A single opening line: **TL;DR:** <2-3 sentences — the session's thrust and verdict>\n"
    "## Market Context & Game Plan\n"
    "## Key Discussion Points  (chronological bullets, each starting with its [h:mm:ss] timestamp)\n"
    "## Tickers & Levels  (every name genuinely discussed: ticker, what was said, any prices/levels)\n"
    "## Setups & Lessons  (setups taught/applied and any process/psychology lessons)\n"
    "## Takeaways\n"
    "## Action Items  (ONLY if concrete follow-ups/tasks were actually said; otherwise omit the section)\n"
    "Rules:\n"
    "- Ground every claim in the transcript; never invent tickers, prices, or tasks.\n"
    "- Copy timestamps from the [h:mm:ss] markers, don't estimate.\n"
    "- Specific beats generic: prices, levels, names, reasons — no filler like "
    "'they discussed the market'.\n"
    "- Complete sentences; write for a teammate who missed the session.\n"
    "- Total length 3000-6500 characters. Use '## ' headers exactly as listed."
)


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
    user = (
        f"SESSION TITLE: {title}\n\n"
        f"PRE-COMPUTED INSIGHTS (steer, don't just restate):\n"
        f"{json.dumps(context, ensure_ascii=False)}\n\n"
        f"TRANSCRIPT:\n{transcript_block[:_TRANSCRIPT_MAX_CHARS]}"
    )
    client = _get_anthropic_client().with_options(timeout=_llm_timeout_secs())
    msg = client.messages.create(
        model=_MODEL,
        max_tokens=4000,
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
    header = f"# 📋 {v.get('title') or 'Session Recap'}\n"
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
