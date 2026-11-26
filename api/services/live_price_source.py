"""The live last-price source, by REGISTRATION: a reader asks here, never the stream module itself.

`bar_broadcaster` registers its own `get_broadcaster` when it is imported (the bottom of that module). A
reader that only wants the last price (`journal_two.setups_board.read_prices`) asks `broadcaster()` and so
never names the stream module, which keeps the stream out of the static import closure of a process that
does not carry it (flow-worker; `tests/test_alert_taxonomy_price_level_projection.py::
test_flow_worker_does_not_reach_d3_price_level_wiring`).

Behaviour is the reader's old one exactly: a process that never imported `bar_broadcaster` cannot have
initialised it, and `broadcaster()` raises there just as `get_broadcaster()` raised for an uninitialised
singleton; once it is imported the call IS `get_broadcaster()` (looked up at call time, so a stub of it
still reaches the reader). This module imports nothing.
"""
from __future__ import annotations

from typing import Any, Callable, Optional

_provider: Optional[Callable[[], Any]] = None


def register(provider: Callable[[], Any]) -> None:
    """The stream module's `get_broadcaster` (or a callable with its contract)."""
    global _provider
    _provider = provider


def broadcaster() -> Any:
    """The live broadcaster, or raises (no stream in this process, or not initialised)."""
    if _provider is None:
        raise RuntimeError("no live price source in this process (bar_broadcaster not loaded)")
    return _provider()
