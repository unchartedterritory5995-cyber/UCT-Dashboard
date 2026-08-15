"""Company 'About' tab data: FMP profile facts + peers + a cached AI trader brief.

Facts (identity, classification, trader snapshot) come from FMP /stable/profile
(cached 12h). Peers reuse the groups service. The brief (what-they-do +
what-moves-it) is ONE grounded Haiku call, cached 30d and regenerated on demand —
so it's one cheap call per name, not per tab-open. Everything is fail-soft: a
failure degrades to "facts only", never an error.
"""
from __future__ import annotations

import json
import logging
import os

log = logging.getLogger("company_about")

_BRIEF_MODEL = os.environ.get("ABOUT_BRIEF_MODEL", "claude-haiku-4-5")
_BRIEF_ENABLED = os.environ.get("ABOUT_BRIEF_ENABLED", "1") == "1"
_BRIEF_TTL = 30 * 86400          # a business narrative changes slowly
_PROFILE_TTL = 12 * 3600
_PEERS_TTL = 6 * 3600


def _cache():
    from api.services.cache import cache
    return cache


def _num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def get_profile(sym: str) -> dict:
    """FMP /stable/profile → identity + classification + trader-snapshot facts."""
    c = _cache()
    key = f"about_profile::{sym}"
    hit = c.get(key)
    if hit is not None:
        return hit
    out: dict = {}
    try:
        from api.services import earnings_estimates as ee
        data = ee._fmp_get("/stable/profile", {"symbol": sym}, timeout=8)
        row = data[0] if isinstance(data, list) and data else (data if isinstance(data, dict) else None)
        if row:
            lo = hi = None
            rng = str(row.get("range") or "")
            if "-" in rng:
                parts = rng.split("-")
                if len(parts) == 2:
                    lo, hi = _num(parts[0]), _num(parts[1])
            out = {
                "name": row.get("companyName"),
                "description": row.get("description"),
                "sector": row.get("sector"),
                "industry": row.get("industry"),
                "ceo": row.get("ceo"),
                "employees": row.get("fullTimeEmployees"),
                "city": row.get("city"),
                "state": row.get("state"),
                "country": row.get("country"),
                "ipoDate": row.get("ipoDate"),
                "exchange": row.get("exchangeShortName") or row.get("exchange"),
                "currency": row.get("currency"),
                "website": row.get("website"),
                "mktCap": _num(row.get("mktCap") or row.get("marketCap")),
                "beta": _num(row.get("beta")),
                "week52Low": lo,
                "week52High": hi,
                "avgVolume": _num(row.get("volAvg") or row.get("averageVolume")),
                "lastDiv": _num(row.get("lastDiv")),
                "price": _num(row.get("price")),
                "isEtf": bool(row.get("isEtf") or row.get("isFund")),
            }
    except Exception as e:  # noqa: BLE001
        log.warning("[about] profile fetch failed for %s: %s", sym, e)
    c.set(key, out, _PROFILE_TTL)
    return out


def get_peers(sym: str) -> list:
    """Peers via the groups service (taxonomy → industry → grounded-AI fallback)."""
    c = _cache()
    key = f"about_peers::{sym}"
    hit = c.get(key)
    if hit is not None:
        return hit
    out = []
    try:
        from api.services import groups as gsvc
        res = gsvc.resolve_peers(sym, 8) or {}
        for p in (res.get("peers") or []):
            if isinstance(p, dict):
                tk = (p.get("ticker") or p.get("sym") or "").upper()
                if tk and tk != sym.upper():
                    out.append({"ticker": tk, "name": p.get("name") or p.get("company")})
            elif isinstance(p, str) and p.upper() != sym.upper():
                out.append({"ticker": p.upper(), "name": None})
    except Exception as e:  # noqa: BLE001
        log.warning("[about] peers fetch failed for %s: %s", sym, e)
    out = out[:8]
    c.set(key, out, _PEERS_TTL)
    return out


def get_brief(sym: str, profile: dict) -> dict:
    """One grounded Haiku call → {whatTheyDo, whatMovesIt}, cached 30d."""
    if not _BRIEF_ENABLED:
        return {}
    c = _cache()
    key = f"about_brief::{sym}"
    hit = c.get(key)
    if hit is not None:
        return hit
    brief: dict = {}
    try:
        p = profile or {}
        grounding = (
            f"{sym} — {p.get('name') or ''}. "
            f"{'ETF/fund. ' if p.get('isEtf') else ''}"
            f"Sector: {p.get('sector') or '—'}; Industry: {p.get('industry') or '—'}. "
            f"Description: {(p.get('description') or '')[:900]}"
        )
        sys_prompt = (
            "You brief active swing/momentum traders on a stock. Be concrete and current, "
            "no hype, no financial advice, no price predictions. Return STRICT JSON and nothing "
            'else: {"whatTheyDo": "...", "whatMovesIt": "..."}. '
            "whatTheyDo: 2 sentences on the business and where its revenue/growth comes from. "
            "whatMovesIt: 2-3 sentences on the DRIVERS a trader watches — key catalysts, the "
            "competitive dynamic, and what the stock is sensitive to (a sector/name it trades with, "
            "event risk like earnings or product cycles). If it's an ETF, describe what it tracks "
            "and the macro it keys off instead."
        )
        from api.services.engine import _get_anthropic_client
        client = _get_anthropic_client()
        msg = client.messages.create(
            model=_BRIEF_MODEL, max_tokens=380, temperature=0.5,
            system=sys_prompt,
            messages=[{"role": "user", "content": grounding}],
        )
        txt = (msg.content[0].text if msg and msg.content else "").strip()
        if txt.startswith("```"):
            txt = txt.strip("`")
            if txt[:4].lower() == "json":
                txt = txt[4:]
        parsed = json.loads(txt)
        brief = {
            "whatTheyDo": str(parsed.get("whatTheyDo") or "").strip(),
            "whatMovesIt": str(parsed.get("whatMovesIt") or "").strip(),
            "model": _BRIEF_MODEL,
        }
    except Exception as e:  # noqa: BLE001
        log.warning("[about] brief generation failed for %s: %s", sym, e)
        brief = {}
    if brief.get("whatTheyDo"):
        c.set(key, brief, _BRIEF_TTL)
    return brief


def get_extras(sym: str) -> dict:
    """Float / short-interest / next-earnings — from the (cached) yfinance-backed
    fundamentals service, which the Fundamentals tab already warms. FMP's profile
    doesn't carry these, so they're merged into the snapshot separately."""
    c = _cache()
    key = f"about_extras::{sym}"
    hit = c.get(key)
    if hit is not None:
        return hit
    out: dict = {}
    try:
        from api.services.fundamentals import get_fundamentals
        f = get_fundamentals(sym) or {}
        out = {
            "floatShares": _num(f.get("float_shares")),
            "sharesOutstanding": _num(f.get("shares_outstanding")),
            "shortPctFloat": _num(f.get("short_pct_float")),
            "nextEarnings": f.get("next_earnings"),
        }
    except Exception as e:  # noqa: BLE001
        log.warning("[about] extras fetch failed for %s: %s", sym, e)
    c.set(key, out, _PROFILE_TTL)
    return out


def get_about(sym: str) -> dict:
    sym = (sym or "").upper().strip()
    profile = dict(get_profile(sym))   # copy — don't mutate the cached FMP dict
    profile.update({k: v for k, v in get_extras(sym).items() if v is not None})
    return {
        "ticker": sym,
        "profile": profile,
        "peers": get_peers(sym),
        "brief": get_brief(sym, profile),
    }
