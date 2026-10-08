"""A result surface states its own coverage (TERM-047, spec §6.3) -- the
backend half for the surfaces that had none: the period-change sort, the six
preset scans, the live volume scan and plain `/api/screener/scan`.

The shape is the one `CoverageLine` already renders and `scan_store.
record_coverage` already writes:

    {evaluated, answered, dropped, not_computable,
     dropped_symbols: [{ticker, reason, detail?}]}

⛔ IT CLOSES: evaluated == answered + dropped + not_computable, checked here
before it leaves (a receipt that does not add up is a ValueError, never a
response). `dropped_symbols` may be SHORTER than dropped + not_computable (a
cap), never longer.

The FOUR counts are different facts (CoverageLine's header): `answered` means
the scan had what it needed to decide -- matched OR not; `not_computable`
means a value it needed was missing; `dropped` means the name was excluded
for an integrity reason (a recycled ticker, a bogus start close).

DARK: `COVERAGE_RECEIPTS_SCANS_ENABLED` (default off, read per call). Off, no
surface attaches a `coverage` key, so every response and every widget is
byte-identical (CoverageLine renders nothing for a null receipt).
"""
from __future__ import annotations

import os
from typing import Optional

FLAG = "COVERAGE_RECEIPTS_SCANS_ENABLED"
#: The enumeration cap -- the counts stay true, the LIST is bounded.
DEFAULT_CAP = 40

NOT_COMPUTABLE = "not-computable"
DROPPED = "dropped"


def is_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip() == "1"


class Tally:
    """Count each evaluated name into exactly one of three buckets."""

    def __init__(self, cap: int = DEFAULT_CAP):
        self.cap = int(cap)
        self.answered = 0
        self.dropped = 0
        self.not_computable = 0
        self.dropped_symbols: list[dict] = []

    def _list(self, ticker, reason: str, detail: Optional[str]):
        if len(self.dropped_symbols) < self.cap:
            e = {"ticker": str(ticker).upper(), "reason": reason}
            if detail:
                e["detail"] = detail
            self.dropped_symbols.append(e)

    def answer(self, n: int = 1) -> None:
        self.answered += int(n)

    def drop(self, ticker, detail: Optional[str] = None) -> None:
        self.dropped += 1
        self._list(ticker, DROPPED, detail)

    def cannot(self, ticker, detail: Optional[str] = None) -> None:
        self.not_computable += 1
        self._list(ticker, NOT_COMPUTABLE, detail)

    @property
    def evaluated(self) -> int:
        return self.answered + self.dropped + self.not_computable

    def receipt(self) -> dict:
        return close({"evaluated": self.evaluated, "answered": self.answered,
                      "dropped": self.dropped, "not_computable": self.not_computable,
                      "dropped_symbols": list(self.dropped_symbols)})


def close(r: dict) -> dict:
    """Validate the identity and the list bound. Returns `r`, or raises."""
    ev, an, dr, nc = (int(r.get(k) or 0) for k in
                      ("evaluated", "answered", "dropped", "not_computable"))
    if min(ev, an, dr, nc) < 0 or ev != an + dr + nc:
        raise ValueError(f"coverage does not close: {ev} != {an} + {dr} + {nc}")
    listed = r.get("dropped_symbols") or []
    if len(listed) > dr + nc:
        raise ValueError("dropped_symbols is longer than dropped + not_computable")
    for e in listed:
        if not e.get("ticker") or not e.get("reason"):
            raise ValueError("every dropped symbol carries a ticker and a reason")
    return r


def publish(out):
    """The ROUTE's gate. Services always compute `coverage` (cheap, and it rides
    the services' own caches); the response carries it only when armed, so a
    flag flip takes effect on the next request whatever is cached. Dark: the
    key is removed and the response is byte-identical to before."""
    if not isinstance(out, dict) or "coverage" not in out:
        return out
    if is_enabled():
        return out
    return {k: v for k, v in out.items() if k != "coverage"}
