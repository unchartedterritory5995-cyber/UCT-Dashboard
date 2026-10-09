"""The `not_found` marker a per-ticker read adds when the symbol is not a ticker we know.

Wave-2 audit 2026-10-08: an unknown symbol (`ZZQXV`) answered 200 on four reads --
`/api/snapshot/{t}` `{}`, `/api/fundamentals/{t}` all-null, `/api/ticker-meta/{t}`
all-null, `/api/research/snapshot/{sym}` nulls -- so a panel drew an empty card that
reads like a real company with nothing on file. Those answers stay exactly as they are
(every consumer keeps working); when the answer is EMPTY and the symbol is a DEFINITE
miss, the response also carries:

    {"not_found": true, "message": "No data for ZZQXV — check the ticker",
     "suggestions": ["..."]}            # suggestions only when there are any

⛔ ONE AUTHORITY. "Is this a ticker?" is answered by
`discord_render.symbols.resolve`, which already asks every authority the app has
(breadth pseudo-tickers, indexes, the universe and ETF list, the search index, the
delisted registry, Entity Master, the bars store, then /api/bars' own verdict) and
refuses ONLY on a definite miss -- an authority that errors, or a search index not
loaded yet, is UNANSWERABLE and adds nothing. A false marker would tell a member a
real ticker does not exist; a missing one costs only today's empty card.

⛔ ASKED ONLY OF AN EMPTY ANSWER. A read that carries data never pays for the lookup,
so a healthy ticker costs nothing. The verdict is memoised per symbol for
`_MEMO_TTL_S` (never an unanswerable one), so a panel re-polling a mistyped symbol
does not re-ask /api/bars every time.
"""
from __future__ import annotations

import threading
import time

_MEMO_TTL_S = 600.0
_MEMO_MAX = 4000
_memo: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()


def _resolve(sym: str):
    from api.services.discord_render import symbols
    return symbols, symbols.resolve(sym)


def unknown_marker(sym: str, *, resolve=None, now=time.monotonic) -> dict:
    """`{"not_found": True, "message": ..., ["suggestions": [...]]}` for a definite miss,
    else `{}`. Never raises."""
    s = (sym or "").strip().upper()
    if not s:
        return {}
    t = now()
    with _lock:
        hit = _memo.get(s)
        if hit is not None and t - hit[0] < _MEMO_TTL_S:
            return dict(hit[1])
    try:
        if resolve is not None:
            status, symbol, suggestions, unknown = resolve(s)
        else:
            mod, res = _resolve(s)
            status, symbol, suggestions, unknown = res.status, res.symbol, res.suggestions, mod.UNKNOWN
    except Exception:  # noqa: BLE001 -- a lookup that cannot answer is not a "no"
        return {}
    if status == unknown:
        out = {"not_found": True, "message": f"No data for {symbol} — check the ticker"}
        if suggestions:
            out["suggestions"] = list(suggestions)
    elif status == "known":
        out = {}
    else:
        return {}                      # unanswerable: say nothing, remember nothing
    with _lock:
        _memo[s] = (t, out)
        if len(_memo) > _MEMO_MAX:
            for k, _ in sorted(_memo.items(), key=lambda kv: kv[1][0])[: len(_memo) - _MEMO_MAX]:
                _memo.pop(k, None)
    return dict(out)


def mark_if_empty(payload, sym: str, is_empty: bool):
    """`payload` with the marker merged in when `is_empty` and the symbol is a definite
    miss; otherwise `payload` unchanged. Never mutates the caller's (possibly cached)
    dict."""
    if not is_empty or not isinstance(payload, dict):
        return payload
    marker = unknown_marker(sym)
    return {**payload, **marker} if marker else payload


def _reset_for_tests() -> None:
    with _lock:
        _memo.clear()
