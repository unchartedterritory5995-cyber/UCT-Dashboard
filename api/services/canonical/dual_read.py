"""D2 CP2 — the DARK dual-compute recorder.

⛔ APPROVED SCOPE, verbatim: *"it computes both the legacy path and the book
path, a rail asserts equality on every call in test and on a sampled fraction in
production (log-only, never raise), and it serves the legacy value."*

Three properties, and each one is a rail rather than a promise:

  **It serves the legacy value.** `observe()` returns `legacy`, always, on every
  branch including the failure branches. A migration that quietly starts serving
  the new path is the migration this shape exists to avoid.

  **It never raises.** Not on a mismatch, not on an unreadable book, not on a
  bug in this file. D2 ADVISES; it must not be able to take a member page down
  over a manifest.

  **A disagreement and an unavailable book are DIFFERENT OUTCOMES.** Folding
  `book_unavailable` into `disagreed` would make a deleted file look like a
  wrong answer; folding it into `agreed` would make five silent sessions look
  like five clean ones. Same discipline as `CoverageLine`'s four counts and
  F-S7-3's four comparison outcomes — ⛔ never collapse them to shorten a line.

⚠️ **THE SAMPLE FRACTION IS READ FROM THE ENVIRONMENT AT CALL TIME, NOT BOUND AT
IMPORT.** F-S7-5 cost this programme a wrong finding for exactly that reason: a
mirror answered from a module constant while production ran a different value,
and the harness manufactured the disagreement it was built to detect.
"""
from __future__ import annotations

import logging
import os
import random
import threading

_logger = logging.getLogger(__name__)

#: Percentage of calls that compute the book path as well as the legacy one.
SAMPLE_ENV = "D2_DUAL_COMPUTE_SAMPLE_PCT"

#: ⭐ 100, and that is a widening of the approved scope rather than a narrowing.
#: The scope allows "a sampled fraction in production" because a second compute
#: can be expensive; this one is a dict lookup against a file cached by
#: (mtime, size), so sampling would buy nothing and cost coverage. The knob
#: exists so the fraction can be dropped without a deploy if that ever changes.
DEFAULT_SAMPLE_PCT = 100

#: The sentinel for "the book could not answer". ⛔ NOT `None`: a metric whose
#: legitimate value is `None` and a book that could not resolve the address are
#: different facts, and one object cannot mean both.
class _Unavailable:
    __slots__ = ()

    def __repr__(self) -> str:          # pragma: no cover - debugging aid
        return "<d2:book-unavailable>"


UNAVAILABLE = _Unavailable()

AGREED = "agreed"
DISAGREED = "disagreed"
BOOK_UNAVAILABLE = "book_unavailable"
OUTCOMES = (AGREED, DISAGREED, BOOK_UNAVAILABLE)

_LEDGER_MAX = 256
_lock = threading.Lock()
_counts: dict = {k: 0 for k in OUTCOMES}
_recent: list = []


def sample_pct() -> int:
    """The configured fraction, read fresh. Out-of-range or unparseable values
    fall back to the default rather than disabling the comparison silently — an
    off-by-typo must not be indistinguishable from a deliberate 0."""
    raw = os.environ.get(SAMPLE_ENV)
    if raw is None or raw.strip() == "":
        return DEFAULT_SAMPLE_PCT
    try:
        pct = int(raw)
    except (TypeError, ValueError):
        _logger.warning("[d2-dual] %s=%r is not an integer; using %d",
                        SAMPLE_ENV, raw, DEFAULT_SAMPLE_PCT)
        return DEFAULT_SAMPLE_PCT
    if not 0 <= pct <= 100:
        _logger.warning("[d2-dual] %s=%d is outside 0-100; using %d",
                        SAMPLE_ENV, pct, DEFAULT_SAMPLE_PCT)
        return DEFAULT_SAMPLE_PCT
    return pct


def should_compare() -> bool:
    """Whether THIS call computes the book path too."""
    pct = sample_pct()
    if pct >= 100:
        return True
    if pct <= 0:
        return False
    return random.random() * 100.0 < pct


def observe(metric: str, legacy, book):
    """Record the comparison and return `legacy`. Never raises.

    ⛔ THE RETURN IS `legacy` ON EVERY PATH, INCLUDING THE ONE WHERE THIS
    FUNCTION ITSELF FAILS. That is the whole contract; the recording is
    secondary and is allowed to be lossy, the served value is not.
    """
    try:
        if isinstance(book, _Unavailable):
            outcome = BOOK_UNAVAILABLE
        elif book == legacy:
            outcome = AGREED
        else:
            outcome = DISAGREED
        _record(metric, outcome, legacy, book)
        if outcome == DISAGREED:
            # log-only, by scope. A raise here would make D2 able to break a
            # member page over a manifest it only advises on.
            _logger.error("[d2-dual] DISAGREEMENT on %s: legacy=%r book=%r "
                          "(serving legacy)", metric, legacy, book)
        elif outcome == BOOK_UNAVAILABLE:
            _logger.warning("[d2-dual] book could not resolve %s (serving legacy)",
                            metric)
    except Exception:                                  # noqa: BLE001 — see above
        _logger.exception("[d2-dual] recorder failed for %s (serving legacy)", metric)
    return legacy


def _record(metric: str, outcome: str, legacy, book) -> None:
    with _lock:
        _counts[outcome] = _counts.get(outcome, 0) + 1
        _recent.append((metric, outcome, legacy, book))
        if len(_recent) > _LEDGER_MAX:
            del _recent[:len(_recent) - _LEDGER_MAX]


def counts() -> dict:
    """A snapshot of the outcome tally. ⛔ Named outcomes, never a pass rate: a
    single number cannot distinguish a quiet path from a broken one."""
    with _lock:
        return dict(_counts)


def recent() -> list:
    """The last comparisons, newest last. Bounded — this is a diagnostic, not a
    store, and an unbounded list on a request path is a leak."""
    with _lock:
        return list(_recent)


def reset() -> None:
    """Clear the ledger. For tests; production never calls it."""
    with _lock:
        for k in OUTCOMES:
            _counts[k] = 0
        _recent.clear()
