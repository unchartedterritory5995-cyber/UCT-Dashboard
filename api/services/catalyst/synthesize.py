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

# Primary model PINNED to Haiku 4.5 (emergency cost pass 2026-05-27 evening).
# Reason: Anthropic console showed Opus 4.7 was silently failing for this API key
# and falling through to Haiku — meaning the engine was running on Haiku the whole
# time. Switching primary to Sonnet earlier today made it ~4× more expensive
# (Sonnet succeeds where Opus failed). Pinning explicitly to Haiku ensures the
# engine runs at the original (verified-working) cost profile.
# Revert: set CATALYST_OPUS_MODEL=claude-sonnet-4-6 or claude-opus-4-7 in env.
OPUS_MODEL = os.environ.get("CATALYST_OPUS_MODEL", "claude-haiku-4-5")
HAIKU_FALLBACK = os.environ.get("CATALYST_HAIKU_FALLBACK_MODEL", "claude-haiku-4-5")

SYSTEM_PROMPT = """You are a SKEPTICAL sell-side analyst writing catalyst summaries for a professional trader's morning dashboard. Your default stance is doubt: most "catalysts" surfaced by news feeds are noise. Your job is to tell the trader, honestly, how real the catalyst is.

Output JSON only:
  {"thesis": "...", "tag": "...", "grade": "A|B|C", "catalyst_type": "...", "source_urls": [...]}

THESIS (2-3 sentences, plain factual English, NO buy/sell recommendations):
  - Bold $AMOUNTS, percentages, and company names with **markdown**
  - Cite source category in parentheses: (Earnings - Tweet - News - Scanner)
  - Never invent facts. Only synthesize what's in the SIGNALS block.
  - Do NOT inflate. If the only "news" is a sector-wide rule, a single
    politician's disclosure, a vague "growth strategy" article, or generic
    social chatter, SAY SO plainly — do not dress it up as company-specific news.
  - If there is genuinely no company-specific catalyst but the stock is moving,
    describe it as momentum/continuation and say "no fresh catalyst" rather than
    manufacturing one.

GRADE — how strong/actionable is the catalyst:
  - A = concrete, company-specific, market-moving (earnings beat/miss with
        guidance, M&A/takeover, FDA approval/rejection/CRL, major analyst PT
        change, big contract win, index inclusion). The kind of thing that
        independently explains a real move.
  - B = real but secondary (single analyst note, minor partnership, sympathy
        move, OR a strong momentum/continuation move with no fresh news).
  - C = weak/noise: sector-wide rules not specific to this company, single
        congressional/insider disclosures, vague strategy pieces, promotional
        social chatter, contradictory or unverifiable signals, or a flat tape.
  Be strict. When in doubt between B and C, choose C.

CATALYST_TYPE — pick the single best label:
  Earnings, M&A, FDA, Analyst, Contract, Guidance, Product, Legal, Insider,
  Index, Offering, Momentum, Sector-wide, None

TAG: pick from Catalyst, Earnings, Gapper, News (matches engine classification).
source_urls: include the URLs from SIGNALS you actually used.

Output ONLY the JSON object — no markdown fences, no commentary, no
"Rationale" section before or after it."""


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


def _extract_first_json_object(text: str) -> Optional[str]:
    """Return the first balanced {...} object substring, respecting quoted
    strings + escapes. Lets us recover the JSON even when the model wraps it
    in ``` fences or appends prose after it (the skeptical prompt makes the
    model prone to tacking on a 'Rationale:' section after the JSON)."""
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    return None


def _parse_json_response(text: str) -> Optional[dict]:
    if not text:
        return None
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
    # Fast path: clean JSON (optionally after stripping a closing fence).
    candidate = text
    if candidate.rstrip().endswith("```"):
        candidate = candidate.rsplit("```", 1)[0]
    try:
        return json.loads(candidate.strip())
    except (json.JSONDecodeError, ValueError):
        pass
    # Robust path: pull the first balanced object out of fences/prose.
    obj = _extract_first_json_object(text)
    if obj is None:
        return None
    try:
        return json.loads(obj)
    except (json.JSONDecodeError, ValueError):
        return None


def _validate_no_sources_phrasing(parsed: dict, has_sources: bool) -> bool:
    """If candidate has no sources, the thesis MUST contain 'no clear catalyst'."""
    if has_sources:
        return True
    return "no clear catalyst" in (parsed.get("thesis") or "").lower()


_VALID_GRADES = {"A", "B", "C"}


def _normalize_grade(raw) -> Optional[str]:
    """Coerce the model's grade to A/B/C, or None when unparseable (None means
    'keep, unknown' downstream — we never hide on a missing grade)."""
    if not raw:
        return None
    g = str(raw).strip().upper()[:1]
    return g if g in _VALID_GRADES else None


def _negative_examples_block() -> str:
    """Build a few-shot block of rows the user has flagged 👎 as 'not a real
    catalyst', so the grader learns the user's taste. Bounded + best-effort:
    returns '' on any error or when there's no feedback yet.

    Gated on CATALYST_FEEDBACK_FEWSHOT (default ON)."""
    if os.environ.get("CATALYST_FEEDBACK_FEWSHOT", "1").lower() not in ("1", "true", "yes"):
        return ""
    try:
        examples = store.get_recent_bad_examples(limit=6)
    except Exception:
        return ""
    if not examples:
        return ""
    lines = []
    for ex in examples:
        t = ex.get("ticker")
        thesis = (ex.get("thesis_text") or "")[:160]
        gap = ex.get("gap_pct")
        vol = ex.get("vol_x")
        bits = []
        if isinstance(gap, (int, float)):
            bits.append(f"gap {gap:+.1f}%")
        if isinstance(vol, (int, float)) and vol:
            bits.append(f"vol {vol:.1f}×")
        meta = f" ({', '.join(bits)})" if bits else ""
        lines.append(f'  - ${t}{meta}: "{thesis}"')
    return (
        "\n\nThe trader has flagged rows like these as LOW-QUALITY / not real "
        "catalysts. Grade rows with similar characteristics as C:\n"
        + "\n".join(lines)
    )


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
            "grade": prior.get("grade"),
            "catalyst_type": prior.get("catalyst_type"),
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

    # Steer the grader with rows the user has flagged 👎 as low-quality.
    system_prompt = SYSTEM_PROMPT + _negative_examples_block()

    # Primary call: OPUS_MODEL env (defaults to Sonnet 4.6; can be set to Opus 4.7)
    msg = None
    used_model = OPUS_MODEL
    in_tokens = out_tokens = 0

    try:
        msg, in_tokens, out_tokens = _call_anthropic(OPUS_MODEL, prompt, system_prompt)
    except Exception as e:
        logger.warning("[catalyst-synth] primary model %s failed for %s: %s. Falling back to Haiku.",
                       OPUS_MODEL, candidate["ticker"], e)
        try:
            msg, in_tokens, out_tokens = _call_anthropic(HAIKU_FALLBACK, prompt, system_prompt)
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
                system_prompt,
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
                    "grade": "C",
                    "catalyst_type": "None",
                    "source_urls": [],
                }
        except Exception:
            parsed = {
                "thesis": "No clear catalyst identified. Source pool was thin.",
                "tag": candidate.get("tag", "Gapper"),
                "grade": "C",
                "catalyst_type": "None",
                "source_urls": [],
            }

    cost_guard.record(market_date, candidate["ticker"], used_model,
                      in_tokens, out_tokens, was_cached=False)

    return {
        "thesis_text": parsed["thesis"],
        "thesis_model": used_model,
        "thesis_at": int(time.time()),
        "thesis_sources": json.dumps(parsed.get("source_urls", [])),
        "grade": _normalize_grade(parsed.get("grade")),
        "catalyst_type": (parsed.get("catalyst_type") or None),
        "signals_hash": h,
        "was_cached": False,
        "input_tokens": in_tokens,
        "output_tokens": out_tokens,
    }
