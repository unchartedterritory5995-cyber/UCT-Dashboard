"""TERM-001 (FB-S1-02) -- the board-size bound, enforced at save time.

The number and both sentences live in ``app/src/pages/charts/boardBound.json``. This module and
``app/src/pages/charts/boardBound.js`` read THOSE BYTES (the ``market_calendar.json`` idiom,
TERM-035: Vite imports a file under ``app/src``; the runtime image copies the whole tree), so the
add-widget menu and this refusal cannot hold two different numbers. Decision, evidence and
reversal: ``docs/terminal-research/12-decisions/2026-10-02-term-001-006-board-bound-and-freshness.md``.

THE RULE (``check``): a ``charts_workspace_layout`` write is refused only when it would leave the
board holding MORE than ``MAX_BOARD_WIDGETS`` widgets AND more widgets than the board the member
has stored now. So:

* a board within the bound saves exactly as before;
* a board ALREADY over the bound is never rejected for being over it: moving, resizing and
  closing widgets all save (same count or fewer). It cannot GROW;
* a value that carries no widget list is not this module's business (the key stays opaque, as it
  always was; ``parseLayout`` owns reading it);
* the STORED board is read only when the new value is over the bound. If the stored board is
  unreadable (STATE-2) its size is unknown, so an over-bound write is refused rather than
  allowed to replace it on a guess.

Nothing here ever truncates, rewrites or deletes a stored board: it answers ``None`` (allowed) or
a sentence (refused), and the caller turns the sentence into a 400.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Callable, Optional

BOARD_KEY = "charts_workspace_layout"

DATASET_PATH = (
    Path(__file__).resolve().parents[2] / "app" / "src" / "pages" / "charts" / "boardBound.json"
)


def _load() -> dict:
    data = json.loads(DATASET_PATH.read_text(encoding="utf-8"))
    n = data.get("maxWidgets")
    if isinstance(n, bool) or not isinstance(n, int) or n < 1:
        raise ValueError(f"boardBound.json maxWidgets must be a positive integer, got {n!r}")
    for k in ("refusal", "overBound"):
        if not isinstance(data.get(k), str) or "{max}" not in data[k]:
            raise ValueError(f"boardBound.json {k} must be a sentence naming {{max}}")
    return data


_DATA = _load()
MAX_BOARD_WIDGETS: int = _DATA["maxWidgets"]


def refusal_sentence(count: int) -> str:
    """The same words the add-widget menu shows; ``count`` is what the board WOULD hold."""
    return _DATA["refusal"].replace("{max}", str(MAX_BOARD_WIDGETS)).replace("{count}", str(count))


def widget_count(raw) -> Optional[int]:
    """Widgets in a stored layout value, or ``None`` when it is absent or carries no widget list."""
    if raw is None or raw == "":
        return None
    try:
        blob = json.loads(raw) if isinstance(raw, str) else raw
    except (ValueError, TypeError):
        return None
    if isinstance(blob, dict) and isinstance(blob.get("widgets"), list):
        return len(blob["widgets"])
    return None


def check(key: str, value, stored_reader: Callable[[], Optional[str]]) -> Optional[str]:
    """``None`` if the write may land, else the refusal sentence.

    ``stored_reader`` returns the member's stored value for ``BOARD_KEY`` (or ``None``); it is
    called only when the new value is over the bound, so an ordinary save costs no extra read.
    """
    if key != BOARD_KEY:
        return None
    n = widget_count(value)
    if n is None or n <= MAX_BOARD_WIDGETS:
        return None
    stored_n = widget_count(stored_reader())
    if stored_n is not None and n <= stored_n:
        return None   # an over-bound board staying the same size or shrinking: editable down
    # Growth past the bound -- or a stored board whose size is unknown (absent, or unreadable
    # under STATE-2), which an over-bound write must not replace on a guess.
    return refusal_sentence(n)
