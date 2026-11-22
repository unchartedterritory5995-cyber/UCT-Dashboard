"""Test-only detector targets for `tests/test_pine_capability_detector_worker.py`.

They run INSIDE the spawned detector process (`pine_capability_worker._child_main` imports this
module by name), so a crash or a hang here is a real crash or hang of that child. Each delegates to
the real detector for an ordinary source, so the answer the parent gets is the real one.
"""
from __future__ import annotations

import os
import time

from api.services import pine_capabilities


def crash_or_hang(source):
    if "@@CRASH@@" in source:
        os._exit(3)
    if "@@HANG@@" in source:
        time.sleep(120)
    if "@@RAISE@@" in source:
        raise RuntimeError("detector blew up")
    if "@@JUNK@@" in source:
        return [1, 2, 3]
    if "@@SLOW@@" in source:
        time.sleep(0.6)
    return pine_capabilities.capabilities_of(source)


def slow_warm(source):
    """A detector whose WARM-UP (the child's first call, before READY) takes a second."""
    if 'indicator("warm")' in source:
        time.sleep(1.0)
    return pine_capabilities.capabilities_of(source)


def never_ready(source):  # pragma: no cover - the import below never succeeds
    return frozenset()


def __getattr__(name):
    if name == "broken_import":
        raise ImportError("this target cannot load")
    raise AttributeError(name)
