"""Two small pieces the Terminal's FMP-backed research reads share (SEG revenue by segment, MNA mergers and
acquisitions, IDXC index changes):

  KeyedHeld  one `held_build.HeldBuild` per key (a stock, a period, a company), each built by ONE
             background thread, at most `max_keys` held at once (the least recently asked is let go).
             The house rule (builder rule 5, `api/services/scan_period.py`): a member's request never
             builds; it gets what is held, else waits a few seconds on the one build it started, else
             is told `computing`. The shared 1,000-entry cache is never the hand-off.

  fmp_leg    one typed `fmp_client` call, classed into the words a panel can say: `ok` (the vendor
             answered with rows), `none` (it answered with nothing for this request), `not_in_plan`
             (it refused: 401, 402, 403 or 404, or the endpoint is in the adapter's 24-hour refused
             window), `not_configured`, `rate_limited` or `failed` (a 5xx, a timeout, a network error,
             a body that is not JSON). Nothing of the vendor's own error text is kept.

  site_universe, held_name   the site's own ticker list (a symbol in it opens a board) and the company
             name the server already holds for a stock: both reads of what is on this server, never a
             provider call. DVD MARKET reads them too.
"""
from __future__ import annotations

import json
import os
import re
import threading
from collections import OrderedDict
from functools import lru_cache
from typing import Any, Callable, Optional

from api.services import held_build

_STATUS = re.compile(r"\bstatus (\d{3})\b")
_REFUSED = (401, 402, 403, 404)
_UNIVERSE_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "cap_universe.json")


@lru_cache(maxsize=1)
def site_universe() -> frozenset:
    """The site's stock universe (`api/data/cap_universe.json`), read once per process: a symbol in it
    opens a board. Empty when the file cannot be read."""
    try:
        with open(_UNIVERSE_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return frozenset()
    return frozenset(str(s).strip().upper() for s in data if isinstance(s, str) and s.strip())


def held_name(sym: str) -> Optional[str]:
    """The company name the server already holds for `sym` (`ticker_meta`'s memory and disk cache), or
    None. A cache read, never a provider call."""
    try:
        from api.services import ticker_meta
        base = ticker_meta._peek_base(sym)
    except Exception:  # noqa: BLE001 -- a name is a nicety; the row stands without it
        return None
    name = base.get("name") if isinstance(base, dict) else None
    return name.strip() if isinstance(name, str) and name.strip() else None


class KeyedHeld:
    def __init__(self, name: str, build_for: Callable[[Any], Callable[[Optional[dict]], tuple[dict, str]]],
                 due: Callable[[dict, float], bool], *, max_keys: int = 64, wait_s: float = held_build.WAIT_S,
                 valid: Optional[Callable[[dict], bool]] = None):
        self.name = name
        self._build_for = build_for
        self._due = due
        self._max = max(1, int(max_keys))
        self._wait_s = wait_s
        self._valid = valid
        self._lock = threading.Lock()
        self._held: "OrderedDict[Any, held_build.HeldBuild]" = OrderedDict()

    def _one(self, key) -> held_build.HeldBuild:
        with self._lock:
            hb = self._held.get(key)
            if hb is None:
                hb = held_build.HeldBuild(f"{self.name}-{key}", self._build_for(key), self._due,
                                          wait_s=self._wait_s, valid=self._valid)
                self._held[key] = hb
                while len(self._held) > self._max:
                    self._held.popitem(last=False)
            else:
                self._held.move_to_end(key)
            return hb

    def get(self, key, *, wait_s: Optional[float] = None) -> dict:
        return self._one(key).get(wait_s=wait_s)

    def peek(self, key) -> Optional[dict]:
        with self._lock:
            hb = self._held.get(key)
        return hb.peek() if hb is not None else None

    def keys(self) -> list:
        with self._lock:
            return list(self._held)

    def reset(self) -> None:
        with self._lock:
            self._held.clear()

    def drain(self, timeout: float = 5.0) -> None:
        with self._lock:
            held = list(self._held.values())
        for hb in held:
            hb.drain(timeout)


def fmp_leg(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> tuple[str, Any, Optional[int]]:
    """`(state, value, http_status)` for one typed `fmp_client` call (see the module docstring)."""
    from api.services import fmp_client as fc

    try:
        result = fn(*args, **kwargs)
    except fc.FMPNotFound:
        return "none", None, None
    except fc.FMPNotConfigured:
        return "not_configured", None, None
    except fc.FMPAuthError as exc:
        return "not_in_plan", None, getattr(exc, "status", None)
    except fc.FMPRateLimited as exc:
        return "rate_limited", None, getattr(exc, "status", None) or 429
    except fc.FMPTransient as exc:
        status = getattr(exc, "status", None)
        if status is None:
            m = _STATUS.search(str(exc))
            status = int(m.group(1)) if m else None
        return ("not_in_plan" if status in _REFUSED else "failed"), None, status
    except Exception:  # noqa: BLE001 -- only the class of failure is kept, never its text
        return "failed", None, None
    if getattr(result, "degraded", None) is not None:
        return "not_in_plan", None, None
    value = getattr(result, "value", None)
    if value is None or (isinstance(value, (list, dict)) and not value):
        return "none", None, None
    return "ok", value, None
