"""Did a provider fetch come back EMPTY, or did it FAIL and get reported as empty?

⛔ THE BARS PROVIDERS SWALLOW THEIR ERRORS. `massive.get_agg_bars`,
`bars_fetch._fetch_intraday_massive` / `_fmp` / `_yfinance` and `_fetch_daily_yf`
all answer `[]` for "this symbol has no bars" AND for "the request timed out / 5xx'd /
the breaker skipped the source". That is right for their callers -- a chart must
never crash on a provider -- but it means "every provider returned nothing" cannot be
read off the return value alone.

This module is the side channel. A caller that needs the distinction opens a
`scope()` around the fetch; every swallow site calls `note(exc)`; afterwards the
scope says whether ANY provider faulted. Outside a scope `note()` is a no-op, so
the swallow sites cost nothing on every other path.

⭐ A 404 IS AN ANSWER, NOT A FAULT. Massive answers a bare HTTP 404 for a symbol it
does not have (see `massive._typed_get`'s 2026-09-02 checkpoint note), so a 404
says "nothing here" exactly as a 200 with no results does.

Thread-local by design: the cold fetch runs on one `bars-cold-bg` worker thread and
the providers it calls run on that same thread (yfinance's pool raises its timeout
back onto the caller, where `_fetch_*_yf` catches and notes it).
"""
from __future__ import annotations

import threading
from contextlib import contextmanager

_tls = threading.local()


class _Scope:
    __slots__ = ("faults",)

    def __init__(self) -> None:
        self.faults = 0

    @property
    def clean(self) -> bool:
        return self.faults == 0


def _is_not_found(exc) -> bool:
    resp = getattr(exc, "response", None)
    return getattr(resp, "status_code", None) == 404


def note(exc: BaseException | None = None) -> None:
    """Record that a provider did NOT give a definitive answer (error, timeout,
    breaker skip, payload rejected). A 404 is a definitive answer and is ignored."""
    scope = getattr(_tls, "scope", None)
    if scope is None:
        return
    if exc is not None and _is_not_found(exc):
        return
    scope.faults += 1


@contextmanager
def scope():
    """Collect provider faults raised on THIS thread for the duration of the block.
    Nested scopes each see the faults noted while they are innermost-or-outer: the
    inner scope's count is added to the outer one on exit."""
    outer = getattr(_tls, "scope", None)
    s = _Scope()
    _tls.scope = s
    try:
        yield s
    finally:
        _tls.scope = outer
        if outer is not None:
            outer.faults += s.faults
