"""One-off probe (not a deliverable): confirm the real, live, currently
registered detector count in THIS worktree, today. Not committed as part of
the benchmark deliverable set -- kept only long enough to print the answer.
"""
from __future__ import annotations

import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

import conftest  # noqa: E402  (sandboxes /data pins before any product import)

from api.services.voice_tool_impls import _ensure_pattern_detectors_loaded  # noqa: E402
from api.services.pattern_engine.detectors.registry import list_pattern_ids  # noqa: E402

_ensure_pattern_detectors_loaded()
ids = list_pattern_ids()
print("REGISTERED_COUNT", len(ids))
for pid in ids:
    print(" -", pid)
