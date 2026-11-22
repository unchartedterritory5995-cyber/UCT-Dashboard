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
#: A one-session move larger than this is flagged as a POSSIBLE unadjusted corporate action (a split the
#: serve-time heal missed on a cold metadata cache, a ticker reuse). Flagged and disclosed, never "fixed".
SUSPECT_JUMP = 0.40
_SYMBOL = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


def _load_bars(symbol: str, max_bars: int = MAX_BARS) -> list[dict]:
    """The canonical sealed-history read (see module docstring): the newest `max_bars` stored daily
    rows (all of them by default). Indirected for tests."""
    from api.services import bars_fetch, bars_sanitize, bars_sqlite
    with bars_sanitize.suppress_meta_warm():
        rows = bars_sqlite.get_bars(symbol, "D", max_bars)
        return bars_fetch._fmt_sqlite_bars(rows, "D", symbol) if rows else []


def _iso(t) -> Optional[str]:
    s = str(t or "")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return s
    if re.fullmatch(r"\d{8}", s):
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    return None


def daily_open_close(symbol) -> dict:
    """`{"status":"ok", "symbol", "rows":[(YYYY-MM-DD, open, close)…]}` from the SAME read-only loader as
    `daily_closes` (W2-B2: the opening-gap series). A bar without a positive open and close is skipped. Never raises."""
    sym = normalize_symbol(symbol)
    if not sym:
        return {"status": "refused", "reason": "bad_symbol", "detail": "That isn't a valid ticker symbol."}
    try:
        bars = _load_bars(sym)
    except Exception:
        return {"status": "unavailable", "reason": "read_failed", "symbol": sym,
                "detail": f"{sym} price history could not be read."}
    seen: dict[str, tuple[float, float]] = {}
    for b in bars or []:
        d = _iso(b.get("t"))
        try:
            o, c = float(b.get("o")), float(b.get("c"))
        except (TypeError, ValueError):
            continue
        if d and o > 0 and c > 0 and o == o and c == c:
            seen[d] = (o, c)
    rows = [(d, o, c) for d, (o, c) in sorted(seen.items())]
    if not rows:
        return {"status": "unavailable", "reason": "no_price_history", "symbol": sym,
                "detail": f"UCT has no stored daily history for {sym}."}
    return {"status": "ok", "symbol": sym, "rows": rows, "first": rows[0][0], "last": rows[-1][0]}


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
    return _closes_answer(sym, bars)


def daily_bars(symbol, max_bars: Optional[int] = None) -> dict:
    """`daily_closes`' answer for the SAME single read, plus `"bars": [(YYYY-MM-DD, open, high, low,
    close, volume)…]` ascending (STAT: the ATR, the ranges and the volumes need the whole bar).
    `closes`, `first`, `last` and `suspect_jumps` are exactly what `daily_closes` answers. A bar
    without a positive, finite open, high, low and close is left out of `bars` (never out of
    `closes`); a volume that is not a finite number of 0 or more is None, never 0. Never raises.
    `max_bars` reads only the newest that many stored rows (SETH's weekly study, which needs a
    window, not the whole history); None reads them all."""
    sym = normalize_symbol(symbol)
    if not sym:
        return {"status": "refused", "reason": "bad_symbol", "detail": "That isn't a valid ticker symbol."}
    try:
        bars = _load_bars(sym) if max_bars is None else _load_bars(sym, max(1, min(int(max_bars), MAX_BARS)))
    except Exception:
        return {"status": "unavailable", "reason": "read_failed", "symbol": sym,
                "detail": f"{sym} price history could not be read."}
    out = _closes_answer(sym, bars)
    if out.get("status") != "ok":
        return out
    seen: dict[str, tuple] = {}
    for b in bars or []:
        d = _iso(b.get("t"))
        try:
            o, h, lo, c = float(b.get("o")), float(b.get("h")), float(b.get("l")), float(b.get("c"))
        except (TypeError, ValueError):
            continue
        if not d or not all(x > 0 and x != float("inf") for x in (o, h, lo, c)):   # NaN fails `x > 0`
            continue
        v = b.get("v")
        ok_v = isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and 0 <= v != float("inf")
        seen[d] = (d, o, h, lo, c, float(v) if ok_v else None)   # a duplicate date keeps the last (served) bar
    return {**out, "bars": [seen[k] for k in sorted(seen)]}


def _closes_answer(sym: str, bars) -> dict:
    """The closes answer for one read of `sym`'s bars (`daily_closes`, `daily_bars`)."""
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
    jumps = [closes[i][0] for i in range(1, len(closes))
             if abs(closes[i][1] / closes[i - 1][1] - 1.0) > SUSPECT_JUMP]
    return {"status": "ok", "symbol": sym, "closes": closes, "first": closes[0][0], "last": closes[-1][0],
            "basis": "daily close, split-adjusted, not dividend-adjusted (price return)",
            "suspect_jumps": jumps}
