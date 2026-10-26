"""JSON nesting depth, pure: no I/O, no imports beyond typing.

Lives here (not in notes.py) so the widget plan module can use the one helper
without importing the notes service and its database modules. notes.py
re-exports it under the same name, so every existing caller is unchanged.
"""
from __future__ import annotations

from typing import Any


def _json_depth_exceeds(obj: Any, cap: int) -> bool:
    """True when `obj` nests dicts/lists more than `cap` deep (the outermost counts 1).
    Iterative, and stops at the first level past the cap."""
    stack = [(obj, 1)]
    while stack:
        x, d = stack.pop()
        if isinstance(x, (dict, list)):
            if d > cap:
                return True
            children = x.values() if isinstance(x, dict) else x
            stack.extend((v, d + 1) for v in children if isinstance(v, (dict, list)))
    return False
