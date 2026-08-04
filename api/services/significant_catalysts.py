"""Shared 'significant catalyst' generator.

Extracted from api/routers/modelbook.py so both the Model Book (bullish-only,
per calendar year) AND the News & Catalysts widget (both directions, YTD window)
can reuse ONE implementation. The `direction="up"` path reproduces Model Book's
original behavior exactly — see tests/test_significant_catalysts.py.

Pipeline: rank the biggest single-day % moves of a bar series → ask Claude for the
real, company-specific catalysts behind them → snap each returned date to a real
trading day. Returns generic dicts; callers map to their own storage shape.
"""
from __future__ import annotations
import re

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# The model's knowledge cutoff can predate a recent period, so it sometimes emits an
# honest "I can't verify this" placeholder instead of a real catalyst. Drop those.
_UNCERTAIN_MARKERS = (
    "data unavailable", "cannot be verified", "can't be verified", "unable to verify",
    "cannot verify", "not verifiable", "beyond my knowledge", "knowledge cutoff",
    "no specific catalyst", "no verifiable", "unclear catalyst", "unknown catalyst",
    "could not identify", "no reliable", "fabricat", "would be misleading",
)


def _is_uncertain(title, description) -> bool:
    blob = f"{title or ''} {description or ''}".lower()
    return any(k in blob for k in _UNCERTAIN_MARKERS)

# Default model mirrors the Model Book generator (MODELBOOK_LLM_MODEL).
import os as _os
_DEFAULT_MODEL = _os.environ.get("MODELBOOK_LLM_MODEL", "claude-sonnet-4-6")


def rank_big_move_days(bars: list, top_n: int = 12, direction: str = "up") -> list:
    """Largest single-day % moves (vs prior close) of a daily bar series.

    direction="up"   → only up days, biggest gain first  (Model Book's original).
    direction="down" → only down days, biggest drop first.
    direction="both" → biggest ABSOLUTE moves, sign preserved (a mix of up + down).
    """
    out = []
    prev_c = None
    for b in bars:
        c, o, t = b.get("c"), b.get("o"), b.get("t")
        if c is None or not t:
            if c is not None:
                prev_c = c
            continue
        if prev_c:
            pct = (c - prev_c) / prev_c * 100
        elif o:
            pct = (c - o) / o * 100
        else:
            pct = 0.0
        keep = (pct > 0) if direction == "up" else (pct < 0) if direction == "down" else (pct != 0)
        if keep:
            out.append({"date": str(t)[:10], "pct": round(pct, 1)})
        prev_c = c
    if direction == "up":
        out.sort(key=lambda d: d["pct"], reverse=True)
    elif direction == "down":
        out.sort(key=lambda d: d["pct"])              # most negative first
    else:
        out.sort(key=lambda d: abs(d["pct"]), reverse=True)
    return out[:top_n]


def snap_trading_day(d: str, trading_days: list, day_set: set, *,
                     year: int | None = None, lo: str | None = None, hi: str | None = None) -> str | None:
    """Snap an LLM date to the nearest real trading day (≤5 days), so a marker
    always lands on an actual bar. Drops dates outside the year (Model Book) or
    outside an ISO lo/hi window (News widget's YTD range), or too far from any
    session."""
    from datetime import date
    if not _ISO_DATE.match(d or ""):
        return None
    if year is not None and not d.startswith(str(year)):
        return None
    if lo is not None and d < lo:
        return None
    if hi is not None and d > hi:
        return None
    if d in day_set:
        return d
    try:
        td = date.fromisoformat(d)
    except ValueError:
        return None
    best, best_diff = None, None
    for cand in trading_days:
        try:
            diff = abs((date.fromisoformat(cand) - td).days)
        except ValueError:
            continue
        if best_diff is None or diff < best_diff:
            best, best_diff = cand, diff
    return best if (best is not None and best_diff is not None and best_diff <= 5) else None


def _build_prompt(symbol, company, period_label, gain_pct, movers, direction, max_items):
    """(system, prompt) pair. The 'up' branch is byte-identical to Model Book's
    original so its bullish-only output never changes."""
    if direction == "up":
        gain_txt = f"about {round(gain_pct)}%" if gain_pct is not None else "a large amount"
        movers_txt = "\n".join(f"- {m['date']} -> +{m['pct']}%" for m in movers)
        system = ("You identify the real, STOCK-SPECIFIC bullish catalysts that ignited a "
                  "stock's biggest up-moves, for a trader's model book. Be factual and "
                  "specific to the given year. Output JSON only — no preamble, no fences.")
        prompt = (
            f"Stock: {symbol} ({company or symbol}). Calendar year: {period_label}. "
            f"Full-year move: {gain_txt}.\n\n"
            f"The stock's largest single-day GAINS that year (date -> that day's % up move):\n"
            f"{movers_txt}\n\n"
            f"Identify the 3-5 most impactful BULLISH, COMPANY-SPECIFIC catalysts that "
            f"ignited a sharp UP move in {symbol} during {period_label}.\n"
            'Return JSON exactly: {"catalysts": [{"date": "YYYY-MM-DD", "title": "...", '
            '"description": "...", "move_pct": 0.0}, ...]}, ordered most impactful first.\n'
            "- date: the trading day the catalyst hit. STRONGLY PREFER a date from the "
            "list above (those are the real up-move days).\n"
            "- title: a 2-5 word headline of the company-specific event (e.g. \"Q3 earnings "
            "beat\", \"AI supply deal\", \"Major customer win\", \"Product launch\", "
            "\"FDA approval\", \"Analyst upgrade\", \"Guidance raise\", \"Index inclusion\").\n"
            "- description: ONE factual sentence on the catalyst and why it drove the stock up.\n"
            "- move_pct: the approximate single-day % GAIN that day (positive number).\n\n"
            "STRICT RULES:\n"
            "- ONLY positive, bullish catalysts that pushed the stock UP. NEVER include "
            "negative, bearish, disappointing, or sell-off events.\n"
            "- ONLY stock-specific company events (earnings, products, partnerships, "
            "contracts/customer wins, approvals, analyst upgrades, M&A, guidance raises, "
            "index inclusion). Do NOT include market-wide or macro catalysts (Fed/interest "
            "rates, broad market or sector rallies, index-wide themes, 'risk-on' sentiment).\n"
            "- Factual and specific to that year. If unsure of the exact news for "
            "a given day, attribute it to the most likely company-specific driver given the "
            "year's dominant theme. No price targets, no buy/sell advice."
        )
        return system, prompt

    # direction == "both" (or "down"): factual up-OR-down high-impact events.
    movers_txt = "\n".join(
        f"- {m['date']} -> {'+' if m['pct'] >= 0 else ''}{m['pct']}%" for m in movers
    )
    system = ("You identify the real, STOCK-SPECIFIC news catalysts behind a stock's biggest "
              "single-day moves — both sharp UP moves and sharp DOWN moves — for a trader's "
              "news feed. Be factual and specific to the period. Output JSON only — no "
              "preamble, no fences.")
    prompt = (
        f"Stock: {symbol} ({company or symbol}). Period: {period_label}.\n\n"
        f"The stock's largest single-day MOVES in this period (date -> that day's % move; "
        f"negative = down):\n{movers_txt}\n\n"
        f"Identify up to {max_items} COMPANY-SPECIFIC catalysts that drove a notable move in "
        f"{symbol} during this period — INCLUDE BOTH bullish events that spiked it up AND "
        f"negative events that sank it. Aim for good COVERAGE of the period: include the major "
        f"catalysts AND the moderately significant company-specific news, not only the biggest "
        f"one or two. It's fine to return several.\n"
        'Return JSON exactly: {"catalysts": [{"date": "YYYY-MM-DD", "title": "...", '
        '"description": "...", "move_pct": 0.0, "direction": "up"}, ...]}, ordered most '
        "impactful first.\n"
        "- date: the trading day the catalyst hit. STRONGLY PREFER a date from the list above.\n"
        "- title: a 2-5 word headline of the event (e.g. \"Q3 earnings beat\", \"Earnings "
        "miss\", \"FDA rejection\", \"Guidance cut\", \"Major customer win\", \"Analyst "
        "downgrade\", \"Product recall\", \"M&A deal\").\n"
        "- description: ONE factual sentence on the catalyst and how it moved the stock.\n"
        "- move_pct: the approximate single-day % move that day (SIGNED: + for up, - for down).\n"
        "- direction: \"up\" or \"down\" — the actual direction of that day's move.\n\n"
        "STRICT RULES:\n"
        "- ONLY stock-specific company events (earnings, products, partnerships, contracts, "
        "approvals/rejections, analyst rating changes, M&A, guidance, recalls, litigation, "
        "index changes). Do NOT include market-wide or macro catalysts (Fed/rates, broad "
        "market or sector moves, index-wide themes, 'risk-on/off' sentiment).\n"
        "- Factual and specific to the period. If you cannot confidently identify the real "
        "company-specific catalyst for a day, OMIT that day — do NOT output a placeholder "
        "(e.g. \"data unavailable\", \"cannot be verified\") and do NOT fabricate. Return "
        "only the catalysts you are reasonably confident are real. No price targets, no "
        "buy/sell advice."
    )
    return system, prompt


def generate(symbol, company, bars, period_label, *, direction="up", gain_pct=None,
             model=None, max_items=5, top_n=12, enabled=True, client=None,
             trading_bounds=None):
    """Claude → list of the period's top catalysts, each anchored to a real
    big-move trading day. Returns None on any failure (caller writes no rows).

    Each item: {date, title, description, move_pct, direction, sort_order}.
    - period_label: "2026" (Model Book, year-snapped) or a free label like "2026 YTD".
    - trading_bounds: optional (lo_iso, hi_iso) to bound the snap window when
      period_label isn't a bare year.
    """
    if not enabled:
        return None
    import json as _json
    try:
        if not bars:
            return None
        trading_days = sorted({str(b["t"])[:10] for b in bars if b.get("t")})
        day_set = set(trading_days)
        movers = rank_big_move_days(bars, top_n=top_n, direction=direction)
        if not movers:
            return None
        if client is None:
            from api.services.engine import _get_anthropic_client
            client = _get_anthropic_client()
        if client is None:
            return None
        system, prompt = _build_prompt(symbol, company, period_label, gain_pct, movers, direction, max_items)
        msg = client.messages.create(
            model=model or _DEFAULT_MODEL, max_tokens=900, temperature=0.5,
            system=system, messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(getattr(b, "text", "") for b in msg.content).strip()
        s, e = text.find("{"), text.rfind("}")
        if s == -1 or e == -1:
            return None
        raw = (_json.loads(text[s:e + 1]).get("catalysts")) or []

        # Snap window: a bare-year label year-snaps (Model Book); otherwise an
        # optional lo/hi ISO window bounds it (News widget's YTD range).
        year = int(period_label) if re.match(r"^\d{4}$", str(period_label or "")) else None
        lo = hi = None
        if trading_bounds:
            lo, hi = trading_bounds

        out = []
        for i, it in enumerate(raw[:max_items]):
            title = (it.get("title") or "").strip()
            if not title:
                continue
            # Drop honest "I can't verify this" placeholders (post-cutoff periods).
            if _is_uncertain(title, it.get("description")):
                continue
            d = snap_trading_day((it.get("date") or "").strip(), trading_days, day_set, year=year, lo=lo, hi=hi)
            if not d:
                continue
            try:
                mp = round(float(it.get("move_pct")), 1) if it.get("move_pct") is not None else None
            except (TypeError, ValueError):
                mp = None
            dir_val = (it.get("direction") or "").strip().lower()
            if dir_val not in ("up", "down"):
                dir_val = "down" if (mp is not None and mp < 0) else "up"
            out.append({
                "date": d,
                "title": title[:80],
                "description": ((it.get("description") or "").strip()[:400]) or None,
                "move_pct": mp,
                "direction": dir_val,
                "sort_order": i,
            })
        return out or None
    except Exception:
        return None
