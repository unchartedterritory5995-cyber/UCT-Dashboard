"""Opus 4.7 catalyst synthesis with skip-if-stable hash, Haiku fallback,
malformed-JSON recovery, no-sources enforcement, and cost guarding."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from typing import Optional

from api.services.catalyst import cost_guard, store

logger = logging.getLogger(__name__)

OPUS_MODEL = os.environ.get("CATALYST_OPUS_MODEL", "claude-opus-4-7")
HAIKU_FALLBACK = os.environ.get("CATALYST_HAIKU_FALLBACK_MODEL", "claude-haiku-4-5")

SYSTEM_PROMPT = """You write pre-market trading catalyst summaries for a professional trader's morning dashboard.

Rules:
  - Output JSON only: {"thesis": "...", "tag": "...", "source_urls": [...]}
  - thesis is 2-3 sentences, plain factual English, NO buy/sell recommendations
  - Bold $AMOUNTS, percentages, and company names with **markdown**
  - Cite source category in parentheses: (Earnings - Tweet - News - Scanner)
  - If signals are thin or contradictory, the thesis MUST contain the literal phrase "no clear catalyst"
  - Never invent facts. Only synthesize what's in the SIGNALS block.
  - Pick tag from: Catalyst, Earnings, Gapper, News (matches what the engine already classified)
  - source_urls: include the URLs from SIGNALS you actually used"""


def compute_signals_hash(candidate: dict) -> str:
    """SHA1 of a stable JSON serialization of the candidate's source signals.
    Used to skip re-synthesizing when nothing has changed."""
    signal_keys = ("tweets", "rss", "earnings_meta", "scanner_setup",
                   "gap_pct", "vol_x", "price")
    payload = {k: candidate.get(k) for k in signal_keys}
    blob = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()


def _format_tweet_block(tweets: list[dict]) -> str:
    if not tweets:
        return "(none)"
    lines = []
    for t in tweets[:5]:
        lines.append(f"  - @{t.get('author_handle', '?')}: \"{t.get('text', '')[:200]}\" - {t.get('url', '')}")
    return "\n".join(lines)


def _format_rss_block(rss: list[dict]) -> str:
    if not rss:
        return "(none)"
    lines = []
    for h in rss[:5]:
        lines.append(f"  - {h.get('source', '?')}: \"{h.get('title', '')[:200]}\" - {h.get('url', '')}")
    return "\n".join(lines)


def _format_earnings_block(em: Optional[dict]) -> str:
    if not em:
        return "(none)"
    return (f"Q{em.get('quarter', '?')} {em.get('year', '?')} EPS "
            f"${em.get('eps_actual', '?')} vs ${em.get('eps_estimate', '?')} est, "
            f"revenue ${em.get('revenue_actual_m', '?')}M, "
            f"timing={em.get('timing', '?')}")


def _format_scanner_block(setup: Optional[dict]) -> str:
    if not setup:
        return "(none)"
    return f"{setup.get('setup_type', '?')}, candle_score {setup.get('candle_score', '?')}/110"


def _format_market_cap(mc: float) -> str:
    if not mc:
        return "?"
    if mc >= 1e12:
        return f"{mc/1e12:.2f}T"
    if mc >= 1e9:
        return f"{mc/1e9:.2f}B"
    if mc >= 1e6:
        return f"{mc/1e6:.0f}M"
    return f"{mc:.0f}"


def format_prompt(c: dict) -> str:
    return f"""Synthesize a catalyst for {c['ticker']} ({c.get('company') or c['ticker']}).

SIGNALS:
- Price: ${c.get('price', '?')}, gap {c.get('gap_pct', 0):+.2f}%, vol {c.get('vol_x', 0):.1f}x ADV
- Market cap: ${_format_market_cap(c.get('market_cap', 0))}
- Sector: {c.get('sector', '?')}

Tweets (last 24h, {len(c.get('tweets', []))} total):
{_format_tweet_block(c.get('tweets', []))}

RSS headlines ({len(c.get('rss', []))} total):
{_format_rss_block(c.get('rss', []))}

Earnings: {_format_earnings_block(c.get('earnings_meta'))}

UCT scanner: {_format_scanner_block(c.get('scanner_setup'))}

Output the JSON now."""


def _call_anthropic(model: str, prompt: str, system: str) -> tuple:
    """Make one Anthropic API call. Returns (response_message, input_tokens, output_tokens).
    Raises on transport/API errors so caller can handle fallback."""
    from api.services.engine import _get_anthropic_client
    client = _get_anthropic_client()
    msg = client.messages.create(
        model=model,
        max_tokens=500,
        temperature=0.3,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg, msg.usage.input_tokens, msg.usage.output_tokens


def _extract_text(msg) -> str:
    parts = []
    for block in msg.content:
        text = getattr(block, "text", None)
        if text:
            parts.append(text)
    return "".join(parts).strip()


def _parse_json_response(text: str) -> Optional[dict]:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        if text.endswith("```"):
            text = text.rsplit("```", 1)[0]
        text = text.strip()
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None


def _validate_no_sources_phrasing(parsed: dict, has_sources: bool) -> bool:
    """If candidate has no sources, the thesis MUST contain 'no clear catalyst'."""
    if has_sources:
        return True
    return "no clear catalyst" in (parsed.get("thesis") or "").lower()


def synthesize_ticker(candidate: dict, market_date: str) -> dict:
    """Returns dict with thesis_text, thesis_model, thesis_at, thesis_sources,
    signals_hash, was_cached, input_tokens, output_tokens."""
    h = compute_signals_hash(candidate)
    prior = store.get_ticker_for_date(candidate["ticker"], market_date)

    # Skip-if-stable: reuse prior thesis when signals haven't changed
    if prior and prior.get("signals_hash") == h and prior.get("thesis_text"):
        cost_guard.record(market_date, candidate["ticker"],
                          prior.get("thesis_model") or OPUS_MODEL,
                          0, 0, was_cached=True)
        return {
            "thesis_text": prior["thesis_text"],
            "thesis_model": prior["thesis_model"],
            "thesis_at": prior["thesis_at"],
            "thesis_sources": prior["thesis_sources"],
            "signals_hash": h,
            "was_cached": True,
            "input_tokens": 0,
            "output_tokens": 0,
        }

    # Hard cap check
    if not cost_guard.may_synthesize(market_date):
        fallback_text = (prior["thesis_text"]
                         if prior and prior.get("thesis_text") else
                         "Synthesis paused — daily cost cap reached. Try again tomorrow.")
        return {
            "thesis_text": fallback_text + " (cost cap reached)",
            "thesis_model": prior.get("thesis_model") if prior else "none",
            "thesis_at": int(time.time()),
            "thesis_sources": prior.get("thesis_sources") if prior else "[]",
            "signals_hash": h,
            "was_cached": True,
            "input_tokens": 0,
            "output_tokens": 0,
        }

    prompt = format_prompt(candidate)
    has_sources = bool(candidate.get("tweets") or candidate.get("rss")
                       or candidate.get("earnings_meta")
                       or candidate.get("scanner_setup"))

    # Primary call: Opus 4.7
    msg = None
    used_model = OPUS_MODEL
    in_tokens = out_tokens = 0

    try:
        msg, in_tokens, out_tokens = _call_anthropic(OPUS_MODEL, prompt, SYSTEM_PROMPT)
    except Exception as e:
        logger.warning("[catalyst-synth] Opus failed for %s: %s. Falling back to Haiku.",
                       candidate["ticker"], e)
        try:
            msg, in_tokens, out_tokens = _call_anthropic(HAIKU_FALLBACK, prompt, SYSTEM_PROMPT)
            used_model = HAIKU_FALLBACK
        except Exception as e2:
            logger.error("[catalyst-synth] Haiku fallback also failed for %s: %s",
                         candidate["ticker"], e2)
            fallback_text = (prior["thesis_text"]
                             if prior and prior.get("thesis_text") else
                             "Synthesis temporarily unavailable. Sources will be checked again on next refresh.")
            return {
                "thesis_text": fallback_text,
                "thesis_model": prior.get("thesis_model") if prior else "none",
                "thesis_at": int(time.time()),
                "thesis_sources": prior.get("thesis_sources") if prior else "[]",
                "signals_hash": h,
                "was_cached": True,
                "input_tokens": 0,
                "output_tokens": 0,
            }

    raw_text = _extract_text(msg)
    parsed = _parse_json_response(raw_text)

    # Malformed JSON — keep prior if exists, log failure
    if parsed is None or not parsed.get("thesis"):
        logger.warning("[catalyst-synth] malformed JSON for %s: %s",
                       candidate["ticker"], raw_text[:300])
        cost_guard.record(market_date, candidate["ticker"], used_model,
                          in_tokens, out_tokens, was_cached=False)
        if prior and prior.get("thesis_text"):
            return {
                "thesis_text": prior["thesis_text"],
                "thesis_model": prior["thesis_model"],
                "thesis_at": prior["thesis_at"],
                "thesis_sources": prior["thesis_sources"],
                "signals_hash": h,
                "was_cached": True,
                "input_tokens": in_tokens,
                "output_tokens": out_tokens,
            }
        return {
            "thesis_text": "Synthesis returned malformed output. Will retry next refresh.",
            "thesis_model": used_model,
            "thesis_at": int(time.time()),
            "thesis_sources": "[]",
            "signals_hash": h,
            "was_cached": False,
            "input_tokens": in_tokens,
            "output_tokens": out_tokens,
        }

    # No-sources enforcement: re-prompt once if missing required phrase
    if not _validate_no_sources_phrasing(parsed, has_sources):
        try:
            msg2, in2, out2 = _call_anthropic(
                used_model,
                prompt + "\n\nIMPORTANT: This ticker has no real source signals. "
                        "Your thesis MUST contain the literal phrase 'no clear catalyst'. "
                        "Re-output the JSON.",
                SYSTEM_PROMPT,
            )
            in_tokens += in2
            out_tokens += out2
            raw_text2 = _extract_text(msg2)
            parsed2 = _parse_json_response(raw_text2)
            if parsed2 and _validate_no_sources_phrasing(parsed2, has_sources):
                parsed = parsed2
            else:
                parsed = {
                    "thesis": "No clear catalyst identified. Source pool was thin.",
                    "tag": candidate.get("tag", "Gapper"),
                    "source_urls": [],
                }
        except Exception:
            parsed = {
                "thesis": "No clear catalyst identified. Source pool was thin.",
                "tag": candidate.get("tag", "Gapper"),
                "source_urls": [],
            }

    cost_guard.record(market_date, candidate["ticker"], used_model,
                      in_tokens, out_tokens, was_cached=False)

    return {
        "thesis_text": parsed["thesis"],
        "thesis_model": used_model,
        "thesis_at": int(time.time()),
        "thesis_sources": json.dumps(parsed.get("source_urls", [])),
        "signals_hash": h,
        "was_cached": False,
        "input_tokens": in_tokens,
        "output_tokens": out_tokens,
    }
