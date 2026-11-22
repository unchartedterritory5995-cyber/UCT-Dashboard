"""LOCAL_LIGHT_MODE: one opt-in switch that makes the API usable on a developer PC.

⛔ PRODUCTION NEVER SETS IT. With ``LOCAL_LIGHT_MODE`` unset (or anything but
1/true/yes/on), :func:`enabled` is False, :func:`skip` returns False without recording
anything, and :func:`apply_import_time_defaults` / :func:`log_summary` do nothing, so
every guarded start site in ``api/main.py`` runs exactly as it did before this module.

With ``LOCAL_LIGHT_MODE=1`` the web process starts none of the background work that
exists to pre-compute or maintain PRODUCTION caches and data: boot warms, seeds,
integrity scans, preloads, self-heal and re-warm loops, and every APScheduler job (the
scheduler is started paused, so the jobs stay registered but never fire). Everything a
request asks for is still served on demand: auth, preferences and layouts, chart bars,
quotes, watchlists, user definitions, journal, the indicator library. Measured on the
owner's PC (2026-11-16): the full boot held ~15 of 24 cores for minutes and
``/api/health`` took 10-22 s; with it on, 0 cores idle and 2-4 ms (docs/local-dev.md).

Usage at a start site (``api/main.py``)::

    if not _light_skip("index-bars-warm"):
        _idx.start_index_warm()

The flag is read from the environment on EVERY call (no import-time caching), so tests
can flip it with ``monkeypatch.setenv``.
"""
from __future__ import annotations

import os
import threading

ENV = "LOCAL_LIGHT_MODE"
_ON = frozenset({"1", "true", "yes", "on"})

# Kill switches that some modules read AT IMPORT to start a warm loop, before the
# lifespan (and its `skip` guards) ever runs. In light mode each is defaulted to its OFF
# value when unset; an explicit value in the environment always wins.
#   (env var, off value, name in the summary line)
IMPORT_TIME_SWITCHES: tuple[tuple[str, str, str], ...] = (
    # api/flow_summary.py starts `flow-conviction-warmer` (a 45 s loop) on import.
    ("FLOW_CONVICTION_WARMER", "0", "flow-conviction-warmer"),
)

_lock = threading.Lock()
_skipped: list[str] = []


def enabled() -> bool:
    """True only when LOCAL_LIGHT_MODE is 1/true/yes/on. Read on every call."""
    return os.environ.get(ENV, "").strip().lower() in _ON


def skip(name: str) -> bool:
    """Should the caller NOT start the background job ``name``?

    Off: False, nothing recorded (the caller proceeds exactly as before).
    On: True, and ``name`` is recorded for the one-line startup summary."""
    if not enabled():
        return False
    with _lock:
        if name not in _skipped:
            _skipped.append(name)
    return True


def apply_import_time_defaults() -> list[str]:
    """Default the import-time kill switches off (light mode only). Returns the names applied."""
    if not enabled():
        return []
    applied = []
    for env, off, name in IMPORT_TIME_SWITCHES:
        if env not in os.environ:
            os.environ[env] = off
        if os.environ.get(env) == off and skip(name):
            applied.append(name)
    return applied


def skipped() -> list[str]:
    """The names skipped so far, in the order they were skipped."""
    with _lock:
        return list(_skipped)


def summary_line() -> str:
    names = skipped()
    return (f"[local-light] ON — skipping {len(names)} background jobs: "
            f"{', '.join(names) if names else '(none)'}")


def log_summary() -> str | None:
    """Print the one startup line when light mode is on; return it (None when off)."""
    if not enabled():
        return None
    line = summary_line()
    print(line, flush=True)
    return line


def _reset_for_tests() -> None:
    with _lock:
        _skipped.clear()
