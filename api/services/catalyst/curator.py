"""LLM curation layer — a swing-trader/news-desk that makes the SELECTION call.

Replaces the mechanical 10/5/3/2 quota (`selection.select_top_12`) with a
judgment pass when `CATALYST_CURATOR_ENABLED` is set. It reads the scored
candidate pool WITH each name's real signals attached (headlines, tweets,
earnings + its move, analyst action, Hunter catalyst, sector/cap) and, like a
discerning swing trader doing morning triage, decides which names are genuinely
worth a trader's attention and in what order — cutting the nothing-burgers,
keeping a quality floor, never padding to a number.

SAFE BY DESIGN: `curate()` NEVER raises and never returns an empty/blank list
when the pool is non-empty. On the flag being off, the daily cost cap, a bad LLM
response, or ANY exception it falls back to `selection.select_top_12`, so the
catalyst tile can never break. The mechanical path stays byte-for-byte the
current behavior when the flag is off.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Optional

from api.services.catalyst import cost_guard, selection, store, synthesize

logger = logging.getLogger(__name__)

# Sonnet 5 does the ranking/curation (fast, strong judgment, ~5x cheaper than
# Opus); Opus stays on the written theses in synthesize.py. Env-overridable.
CURATOR_MODEL = os.environ.get("CATALYST_CURATOR_MODEL", "claude-sonnet-5")

# Per-date curation verdicts, keyed by ticker, for the /explain endpoint:
#   {market_date: {"TICKER": {"keep": bool, "rank": int|None, "why": str,
#                             "catalyst_type": str}}}
_CURATION_BY_DATE: dict[str, dict[str, dict]] = {}
# Skip-if-stable: pool fingerprint per date so an unchanged pool doesn't re-bill.
_POOL_HASH_BY_DATE: dict[str, str] = {}
_ORDER_BY_DATE: dict[str, list[str]] = {}   # kept ticker order for a stable pool


def _enabled() -> bool:
    return os.environ.get("CATALYST_CURATOR_ENABLED", "0").lower() in ("1", "true", "yes")


def _intenv(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


def get_curation(market_date: str) -> dict[str, dict]:
    """Curator verdicts for a date, keyed by ticker (for the explainer)."""
    return _CURATION_BY_DATE.get(market_date, {})


# ── Compact per-candidate signal formatting for the pool prompt ──────────────
def _clip(s: str, n: int = 140) -> str:
    s = " ".join((s or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


def _tweets_line(tweets: list[dict]) -> str:
    if not tweets:
        return ""
    snips = []
    for t in tweets[:2]:
        txt = t.get("text") or t.get("content") or ""
        if txt:
            snips.append(_clip(txt))
    return ("   tweets(%d): %s" % (len(tweets), " | ".join(snips))) if snips else ""


def _news_line(rss: list[dict]) -> str:
    if not rss:
        return ""
    snips = []
    for r in rss[:2]:
        title = r.get("title") or r.get("headline") or ""
        if title:
            snips.append(_clip(title))
    return ("   news(%d): %s" % (len(rss), " | ".join(snips))) if snips else ""


def _candidate_block(idx: int, c: dict) -> str:
    ticker = (c.get("ticker") or "?").upper()
    company = c.get("company") or ticker
    price = c.get("price")
    price_s = f"${price:.2f}" if isinstance(price, (int, float)) else "$?"
    gap = c.get("gap_pct") or 0.0
    volx = c.get("vol_x") or 0.0
    cap = synthesize._format_market_cap(c.get("market_cap") or 0)
    sector = c.get("sector") or "?"
    industry = c.get("industry") or "?"
    tag = c.get("tag") or "?"
    head = (f"[{idx}] {ticker} ({company}) — {price_s}, gap {gap:+.1f}%, "
            f"vol {volx:.1f}x ADV, cap ${cap}, sector={sector}, "
            f"industry={industry}, tag={tag}")
    lines = [head]
    em = c.get("earnings_meta")
    if em:
        lines.append("   earnings: " + synthesize._format_earnings_block(em))
    if c.get("analyst_meta"):
        lines.append("   analyst: " + synthesize._format_analyst_block(c.get("analyst_meta")))
    hunter = synthesize._format_hunter_block(c)
    if hunter:
        lines.append("   " + hunter)
    if c.get("scanner_setup"):
        lines.append("   scanner: " + synthesize._format_scanner_block(c.get("scanner_setup")))
    tw = _tweets_line(c.get("tweets") or [])
    if tw:
        lines.append(tw)
    nw = _news_line(c.get("rss") or [])
    if nw:
        lines.append(nw)
    return "\n".join(lines)


def _pool_hash(pool: list[dict]) -> str:
    """Fingerprint the pool so an unchanged pool skips a re-bill. Keys on the
    fields that would change the curator's judgment (ticker, move, signal
    counts, tag) — NOT volatile timestamps."""
    parts = []
    for c in pool:
        parts.append("|".join([
            (c.get("ticker") or "").upper(),
            f"{round(float(c.get('gap_pct') or 0.0), 1)}",
            f"{round(float(c.get('vol_x') or 0.0), 1)}",
            str(len(c.get("tweets") or [])),
            str(len(c.get("rss") or [])),
            "1" if c.get("earnings_meta") else "0",
            "1" if c.get("analyst_meta") else "0",
            "1" if c.get("hunter_confirmed") else "0",
            c.get("tag") or "",
        ]))
    return hashlib.sha1("\n".join(parts).encode("utf-8")).hexdigest()


SYSTEM_PROMPT = """You are the head trader at a swing-trading desk doing your morning triage. In front of you is a raw pool of stocks a scanner flagged as "moving" or "in the news." With a professional trader's eye, decide which are genuinely worth the desk's attention TODAY, rank them the way you'd actually watch them, and throw out the noise. This is JUDGMENT, not a formula — see it through the eyes of a swing trader and news specialist.

KEEP (worth attention), in this spirit:
- Hard company catalysts: M&A, FDA/approvals, guidance raise/cut, major contract or customer win, big product news, index inclusion, a halt/resumption.
- Earnings that actually MOVED the stock (the market's reaction, not the mere fact of a print — a bank that reported and barely moved is NOT a catalyst).
- Street-moving analyst actions: a real upgrade/downgrade, a big price-target change, a notable initiation — when it's actually driving the stock.
- Clean momentum/technical: a real breakout to new highs, a gap-and-go, a high-participation thrust — even with no fresh headline (continuation of a story).

CUT hard:
- Micro-cap / sub-$5 / low-float PENNY PUMPS: a $1.80 name up 60% on a squeeze or a paid press release is untradeable for this desk no matter the %.

Otherwise use judgment: a name drifting a few percent on nothing identifiable just ranks low — you do NOT need a rule for every kind of noise. A genuinely huge move with no headline is still momentum worth watching; a small move with no story is not.

RANK by how much a swing trader would actually care today: conviction of the catalyst x how tradeable/liquid the name is x how cleanly it's moving. Best, most actionable ideas at the top.

You do NOT fill a quota. Keep as many as are genuinely worth it — typically ~12-20 on a normal day, fewer on a quiet day, more on a wild one. NEVER pad with weak names to hit a number; if a name is a nothing-burger, cut it (keep:false).

Output JSON only:
{"picks": [{"ticker": "AVGO", "keep": true, "rank": 1, "catalyst_type": "Earnings", "why": "short trader phrase"}, ...]}
- Include EVERY ticker from the pool (keep:true or keep:false) so nothing is silently lost.
- rank is 1-based among KEPT names only, in your watch order (best first).
- catalyst_type: Earnings, M&A, FDA, Analyst, Contract, Guidance, Product, Legal, Index, Offering, Momentum, Sector-wide, News, None.
- why: <= 12 words, plain trader language.
Output ONLY the JSON object — no fences, no commentary."""


def _build_prompt(pool: list[dict]) -> str:
    blocks = "\n\n".join(_candidate_block(i + 1, c) for i, c in enumerate(pool))
    return (f"POOL ({len(pool)} candidates):\n\n{blocks}\n\n"
            "Curate and rank. Output the JSON now.")


def _call(model: str, prompt: str) -> tuple:
    """One Anthropic call. Returns (text, input_tokens, output_tokens). Raises on
    API error so curate() can fall back. Retries once without temperature for
    models that reject it (e.g. Opus 4.8)."""
    from api.services.engine import _get_anthropic_client
    client = _get_anthropic_client()
    max_tokens = _intenv("CATALYST_CURATOR_MAX_TOKENS", 2000)
    kwargs = dict(model=model, max_tokens=max_tokens, temperature=0.2,
                  system=SYSTEM_PROMPT, messages=[{"role": "user", "content": prompt}])
    try:
        msg = client.messages.create(**kwargs)
    except Exception as e:
        if "temperature" in str(e).lower():
            kwargs.pop("temperature", None)
            msg = client.messages.create(**kwargs)
        else:
            raise
    text = "".join(getattr(b, "text", "") or "" for b in msg.content).strip()
    return text, msg.usage.input_tokens, msg.usage.output_tokens


def _apply_verdicts(pool: list[dict], picks: list[dict], market_date: str) -> list[dict]:
    """Map the LLM verdicts back onto the pool candidates. Returns the kept
    candidates in rank order. Records verdicts for the explainer + stamps each
    candidate with curator_* fields. Returns [] if nothing was kept (caller
    treats that as a fallback trigger)."""
    by_ticker = {(c.get("ticker") or "").upper(): c for c in pool}
    verdicts: dict[str, dict] = {}
    kept: list[tuple[int, dict]] = []
    seen: set[str] = set()

    for i, p in enumerate(picks):
        tk = (p.get("ticker") or "").upper()
        if not tk or tk not in by_ticker or tk in seen:
            continue
        seen.add(tk)
        keep = bool(p.get("keep", True))
        why = _clip(str(p.get("why") or ""), 120)
        ctype = (p.get("catalyst_type") or "").strip() or None
        try:
            rank = int(p.get("rank")) if p.get("rank") is not None else None
        except (TypeError, ValueError):
            rank = None
        verdicts[tk] = {"keep": keep, "rank": rank, "why": why, "catalyst_type": ctype}
        c = by_ticker[tk]
        c["curator_kept"] = keep
        c["curator_why"] = why
        if ctype:
            c["curator_catalyst_type"] = ctype
        if keep:
            # Fall back to the LLM's list order when a rank is missing/duplicate.
            order = rank if rank is not None else (10_000 + i)
            c["curator_rank"] = rank
            kept.append((order, c))

    # Any pool name the model failed to mention: keep it as a safety net (never
    # silently drop), ranked after everything the model explicitly ranked.
    for i, c in enumerate(pool):
        tk = (c.get("ticker") or "").upper()
        if tk and tk not in seen:
            verdicts.setdefault(tk, {"keep": True, "rank": None,
                                     "why": "(not judged — kept as safety net)",
                                     "catalyst_type": None})
            c.setdefault("curator_kept", True)
            kept.append((20_000 + i, c))

    _CURATION_BY_DATE[market_date] = verdicts
    kept.sort(key=lambda t: t[0])
    ordered = [c for _, c in kept]

    target = _intenv("CATALYST_CURATOR_TARGET", 20)
    if target > 0 and len(ordered) > target:
        ordered = ordered[:target]
    return ordered


def curate(scored: list[dict], *, market_date: str) -> list[dict]:
    """Curate + rank the scored pool with the swing-trader judgment layer.

    NEVER raises. Falls back to selection.select_top_12(scored) when the flag is
    off, the cost cap is hit, the pool is empty, or anything goes wrong — so the
    returned list is always a valid, non-empty (when scored is non-empty)
    selection.
    """
    fallback = lambda: selection.select_top_12(scored)

    if not _enabled() or not scored:
        return fallback()

    # Respect the daily hard cost cap — over it, use the free mechanical path.
    try:
        if not cost_guard.may_synthesize(market_date):
            logger.info("[catalyst-curator] cost cap reached — mechanical selection")
            return fallback()
    except Exception:
        pass

    # Bound the pool handed to the LLM by existing score (cheap pre-sort).
    pool_cap = _intenv("CATALYST_CURATOR_POOL", 40)
    pool = sorted(scored, key=lambda c: c.get("score", 0.0), reverse=True)[:pool_cap]

    # Skip-if-stable: unchanged pool → reuse the prior curated order, no re-bill.
    try:
        h = _pool_hash(pool)
        if _POOL_HASH_BY_DATE.get(market_date) == h and market_date in _ORDER_BY_DATE:
            by_ticker = {(c.get("ticker") or "").upper(): c for c in pool}
            reused = [by_ticker[t] for t in _ORDER_BY_DATE[market_date] if t in by_ticker]
            if reused:
                for c in reused:
                    c["curator_kept"] = True
                logger.info("[catalyst-curator] stable pool — reused %d picks (no re-bill)",
                            len(reused))
                return reused
    except Exception:
        h = None

    try:
        prompt = _build_prompt(pool)
        text, in_tok, out_tok = _call(CURATOR_MODEL, prompt)
        try:
            cost_guard.record(market_date, "_CURATOR", CURATOR_MODEL, in_tok, out_tok)
        except Exception:
            logger.debug("[catalyst-curator] cost record failed")

        parsed = synthesize._parse_json_response(text)
        picks = (parsed or {}).get("picks") if isinstance(parsed, dict) else None
        if not isinstance(picks, list) or not picks:
            logger.warning("[catalyst-curator] unusable LLM response — mechanical fallback")
            return fallback()

        ordered = _apply_verdicts(pool, picks, market_date)
        if not ordered:
            logger.warning("[catalyst-curator] curator kept nothing — mechanical fallback")
            return fallback()

        if h:
            _POOL_HASH_BY_DATE[market_date] = h
            _ORDER_BY_DATE[market_date] = [(c.get("ticker") or "").upper() for c in ordered]

        logger.info("[catalyst-curator] curated %d/%d names (Sonnet judgment)",
                    len(ordered), len(pool))
        return ordered
    except Exception:
        logger.exception("[catalyst-curator] failed — mechanical fallback")
        return fallback()
