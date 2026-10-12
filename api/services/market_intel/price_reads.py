"""Daily closing prices for Market Intelligence analytics — read-only, from UCT's own store.

⭐ REUSE: the exact read `/api/bars-history` serves (`routers/bars.serve_bars_history`): a PURE
`bars_sqlite.get_bars` read (never a provider fetch or write) formatted by `bars_fetch._fmt_sqlite_bars`,
which applies the serve-time `bars_sanitize` heal (splits, recycled tickers, bad prints) — run
inside `bars_sanitize.suppress_meta_warm()` so a cold corporate-action cache never schedules a
provider call. Zero network, zero model.

What a close is here: the stored DAILY close, split-adjusted, NOT dividend-adjusted (price return,
not total return). Depth is whatever THIS process's bars.db holds — the worker's store is deep,
the web pod's may be a shallow tail — so every result states the coverage it actually had.

⛔ LOCAL ONLY — prices are licensed vendor data; never sent to a model.
"""
from __future__ import annotations

import re
from typing import Optional

MAX_BARS = 60000
_SYMBOL = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


def _load_bars(symbol: str) -> list[dict]:
    """The canonical sealed-history read (see module docstring). Indirected for tests."""
    from api.services import bars_fetch, bars_sanitize, bars_sqlite
    with bars_sanitize.suppress_meta_warm():
        rows = bars_sqlite.get_bars(symbol, "D", MAX_BARS)
        return bars_fetch._fmt_sqlite_bars(rows, "D", symbol) if rows else []


def _iso(t) -> Optional[str]:
    s = str(t or "")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return s
    if re.fullmatch(r"\d{8}", s):
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    return None


def normalize_symbol(symbol) -> Optional[str]:
    s = str(symbol or "").strip().upper()
    return s if _SYMBOL.match(s) else None


def daily_closes(symbol) -> dict:
    """`{"status":"ok", "symbol", "closes":[(YYYY-MM-DD, close)…] ascending, "first", "last"}`
    or a refusal / unavailable dict. Never raises."""
    sym = normalize_symbol(symbol)
    if not sym:
        return {"status": "refused", "reason": "bad_symbol", "detail": "That isn't a valid ticker symbol."}
    try:
        bars = _load_bars(sym)
    except Exception:
        return {"status": "unavailable", "reason": "read_failed", "symbol": sym,
                "detail": f"{sym} price history could not be read."}
    seen: dict[str, float] = {}
    for b in bars or []:
        d = _iso(b.get("t"))
        try:
            c = float(b.get("c"))
        except (TypeError, ValueError):
            continue
        if d and c > 0 and c == c:                    # positive, finite
            seen[d] = c                                # a duplicate date keeps the last (served) bar
    closes = sorted(seen.items())
    if not closes:
        return {"status": "unavailable", "reason": "no_price_history", "symbol": sym,
                "detail": f"UCT has no stored daily history for {sym}."}
    return {"status": "ok", "symbol": sym, "closes": closes, "first": closes[0][0], "last": closes[-1][0],
            "basis": "daily close, split-adjusted, not dividend-adjusted (price return)"}
