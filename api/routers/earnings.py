import os
from fastapi import APIRouter, HTTPException
from api.services.engine import get_earnings
from api.services.cache import cache

router = APIRouter()


@router.get("/api/earnings")
def earnings():
    try:
        return get_earnings()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/earnings-analysis/{sym}")
def earnings_analysis(sym: str):
    sym = sym.upper()
    cache_key = f"earnings_analysis_{sym}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    # Find earnings row for this sym
    try:
        data = get_earnings()
    except Exception:
        data = {}

    row = None
    for bucket in ("bmo", "amc"):
        for entry in data.get(bucket, []):
            if entry.get("sym") == sym:
                row = entry
                break
        if row:
            break

    # Related news from existing news cache (no extra API calls)
    news_items = cache.get("news") or []
    related_raw = next(
        (n for n in news_items if sym in (n.get("tickers") or [])),
        None
    )
    related_news = {
        "headline": related_raw["headline"],
        "url":      related_raw["url"],
        "source":   related_raw.get("source", ""),
    } if related_raw else None

    # AI analysis — skip for Pending (no numbers yet)
    analysis = None
    if row and row.get("verdict", "").lower() not in ("pending", ""):
        try:
            import anthropic

            def _fmt_eps(v):
                if v is None: return "N/A"
                sign = "-" if v < 0 else ""
                return f"{sign}${abs(v):.2f}"

            def _fmt_rev(m):
                if m is None: return "N/A"
                return f"${m / 1000:.2f}B" if m >= 1000 else f"${round(m)}M"

            change_pct = row.get("change_pct")
            gap_str = (
                f"{'+' if change_pct >= 0 else ''}{change_pct:.2f}%"
                if change_pct is not None else "N/A"
            )

            prompt = (
                f"Analyze this earnings report for {sym} in 3 concise sentences. "
                f"Be direct, specific, and professional — no filler.\n\n"
                f"Verdict: {row.get('verdict')}\n"
                f"EPS: Expected {_fmt_eps(row.get('eps_estimate'))} → "
                f"Reported {_fmt_eps(row.get('reported_eps'))} "
                f"({row.get('surprise_pct', 'N/A')} surprise)\n"
                f"Revenue: Expected {_fmt_rev(row.get('rev_estimate'))} → "
                f"Reported {_fmt_rev(row.get('rev_actual'))} "
                f"({row.get('rev_surprise_pct', 'N/A')} surprise)\n"
                f"Stock reaction: {gap_str}\n\n"
                f"Cover: magnitude of beat/miss, what it signals about the business, "
                f"and what the market reaction implies about expectations."
            )

            client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
            msg = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=180,
                messages=[{"role": "user", "content": prompt}],
            )
            analysis = msg.content[0].text.strip()
        except Exception:
            analysis = None

    result = {"sym": sym, "analysis": analysis, "news": related_news}
    cache.set(cache_key, result, ttl=43200)  # 12 h
    return result
