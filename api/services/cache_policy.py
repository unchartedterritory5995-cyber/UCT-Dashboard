"""Shared cache-write policy: never cache a failed/partial fetch as complete.

This generalizes the pattern already proven correct at
``api/services/earnings_table.py:443-466`` (the canonical implementation named
in the 2026-08-05 data-dependability plan). Its three properties are the rule
for every cache write built on top of this helper:

  1. A partial result is still SERVED -- dropping it discards whatever leg DID
     resolve.
  2. A partial gets the SHORT (failure) TTL, not the success TTL, so the
     missing leg self-heals in minutes instead of hours (or days).
  3. A partial NEVER reaches a persistent store (disk file / snapshot DB)
     where a stale blank would outlive the provider outage that caused it.

Callers must derive ``complete`` from an explicit predicate over the value's
individual legs -- never a truthiness check on the merged dict. A
legitimately-empty COMPLETE value (a ticker with no dividends, no 13F filing,
no recent analyst action) is not the same thing as a FAILED fetch; conflating
the two in the other direction (treating real emptiness as failure) causes
constant, pointless refetching. See the module docstring of each call site
for how it draws that line.
"""
from __future__ import annotations

from typing import Any, Callable, Optional

from api.services.cache import cache


def set_by_completeness(
    key: str,
    value: Any,
    *,
    complete: bool,
    ttl_ok: int,
    ttl_partial: int,
    persist: Optional[Callable[[Any], None]] = None,
) -> None:
    """Cache ``value`` either way -- a partial is still SERVED -- but a
    partial gets ``ttl_partial`` and NEVER reaches ``persist``.

    ``persist`` (e.g. a snapshot-store ``put`` or an on-disk write) is only
    invoked when ``complete`` is True. It is called synchronously and must
    not raise on the caller's behalf -- callers whose persist function can
    fail should wrap it themselves (mirroring the existing disk-write
    helpers, which already swallow ``OSError`` internally).
    """
    if complete:
        cache.set(key, value, ttl_ok)
        if persist is not None:
            persist(value)
    else:
        cache.set(key, value, ttl_partial)
