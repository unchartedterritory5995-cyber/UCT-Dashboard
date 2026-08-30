"""The static $300M+ symbol list, loaded once and shared.

`api/data/cap_universe.json` was already being opened by hand in two places
(`routers/ticker_search`, `routers/calendar`), each with its own path
resolution. This is the one loader; `ticker_search` now defers to it.

`routers/calendar._load_cap_universe` deliberately does NOT: it prefers the
fresher `wire_data["cap_universe"]` and only falls back to this file, so despite
the name it is a different question and is left alone.

Never raises. A missing or malformed file yields an empty set, and every caller
is expected to treat "empty" as "cannot answer" rather than "nothing qualifies".
"""
from __future__ import annotations

import json
import logging
import os
from functools import lru_cache

_logger = logging.getLogger(__name__)

_FILENAME = "cap_universe.json"


def path() -> str:
    """Resolve the data file relative to this package, then to the CWD."""
    here = os.path.join(os.path.dirname(__file__), "..", "data", _FILENAME)
    if os.path.exists(here):
        return here
    return os.path.join("api", "data", _FILENAME)


@lru_cache(maxsize=1)
def symbols() -> frozenset[str]:
    """Every symbol in the universe, upper-cased. Empty set on any failure."""
    try:
        with open(path(), "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as exc:                          # noqa: BLE001
        _logger.warning("[cap-universe] load failed: %s", exc)
        return frozenset()
    if not isinstance(data, list):
        _logger.warning("[cap-universe] expected a list, got %s", type(data).__name__)
        return frozenset()
    out = frozenset(str(t).upper() for t in data if t)
    _logger.info("[cap-universe] loaded %d symbols", len(out))
    return out
