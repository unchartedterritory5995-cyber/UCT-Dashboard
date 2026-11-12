"""Daily closing prices for Market Intelligence analytics — read-only, from UCT's own store.

⭐ REUSE: the exact rows `/api/bars-history` serves (`routers/bars.serve_bars_history`): a PURE
`bars_sqlite` read (`get_bars_table_order`, never a provider fetch or write) formatted by `bars_fetch._fmt_sqlite_bars`,
which applies the serve-time `bars_sanitize` heal (splits, recycled tickers, bad prints) — run
inside `bars_sanitize.suppress_meta_warm()` so a cold corporate-action cache never schedules a
provider call. Zero network, zero model.

What a close is here: the stored DAILY close, split-adjusted, NOT dividend-adjusted (price return,
not total return). Depth is whatever THIS process's bars.db holds — the worker's store is deep,
the web pod's may be a shallow tail — so every result states the coverage it actually had.

⛔ LOCAL ONLY — prices are licensed vendor data; never sent to a model.
"""
from __future__ import annotations

import contextlib
import re
import sqlite3
import threading
import time
from typing import Optional

MAX_BARS = 60000
#: A one-session move larger than this is flagged as a POSSIBLE unadjusted corporate action (a split the
#: serve-time heal missed on a cold metadata cache, a ticker reuse). Flagged and disclosed, never "fixed".
SUSPECT_JUMP = 0.40
_SYMBOL = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


class ReadBudgetExceeded(Exception):
    """A scoped read ran out of its budget (see `read_scope`). Nothing failed; the store was slow."""


_scope = threading.local()


@contextlib.contextmanager
def read_scope(budget_s: float):
    """One study's reads, on one thread: a symbol's bars are read ONCE (a study's condition and its outcome are
    usually the same symbol, and both reads would otherwise walk the same pages and re-run the same sanitize), and
    every store read stops at `budget_s` from now. Yields a dict that collects `read_s` and `rows` (counts only)."""
    stats = {"read_s": 0.0, "rows": 0}
    _scope.memo, _scope.stop_at, _scope.stats = {}, time.monotonic() + budget_s, stats
    try:
        yield stats
    finally:
        _scope.memo = _scope.stop_at = _scope.stats = None


def _load_bars(symbol: str) -> list[dict]:
    """The canonical sealed-history read (see module docstring). Indirected for tests."""
    from api.services import bars_fetch, bars_sanitize, bars_sqlite
    stop_at = getattr(_scope, "stop_at", None)
    with bars_sanitize.suppress_meta_warm():
        try:
            rows = bars_sqlite.get_bars_table_order(symbol, "D", MAX_BARS, stop_at=stop_at)
        except sqlite3.OperationalError:
            if stop_at is not None and time.monotonic() >= stop_at:
                raise ReadBudgetExceeded(symbol) from None
            raise
        return bars_fetch._fmt_sqlite_bars(rows, "D", symbol) if rows else []


def _bars(symbol: str) -> list[dict]:
    """`_load_bars`, once per symbol inside a `read_scope`."""
    memo = getattr(_scope, "memo", None)
    if memo is None:
        return _load_bars(symbol)
    if symbol not in memo:
        t0 = time.monotonic()
        memo[symbol] = _load_bars(symbol)
        _scope.stats["read_s"] += time.monotonic() - t0
        _scope.stats["rows"] += len(memo[symbol] or [])
    return memo[symbol]


def _still_loading(sym: str) -> dict:
    return {"status": "unavailable", "reason": "warming", "symbol": sym,
            "detail": "The history is still loading. Run the study again in a moment."}


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
        bars = _bars(sym)
    except ReadBudgetExceeded:
        return _still_loading(sym)
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
        bars = _bars(sym)
    except ReadBudgetExceeded:
        return _still_loading(sym)
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
    jumps = [closes[i][0] for i in range(1, len(closes))
             if abs(closes[i][1] / closes[i - 1][1] - 1.0) > SUSPECT_JUMP]
    return {"status": "ok", "symbol": sym, "closes": closes, "first": closes[0][0], "last": closes[-1][0],
            "basis": "daily close, split-adjusted, not dividend-adjusted (price return)",
            "suspect_jumps": jumps}
