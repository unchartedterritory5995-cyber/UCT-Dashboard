"""Track D — ADVANCED TRADING WORKFLOWS for UCT Agent (dark): which workflows THIS server switches on.

`UCT_AGENT_WORKFLOWS` (default OFF). Unset / empty / 0 / off -> no workflow. `1` / `true` / `on` / `yes` / `all` -> every
workflow below. Otherwise a comma list of workflow names (staged activation, one at a time):

    UCT_AGENT_WORKFLOWS=relativeStrength,watchlistChanges

The browser reads the answer from GET /api/agent/config (`workflows`: the sorted enabled names) and registers a
workflow's capability ONLY when its name is listed AND the data kinds it reads are served (`data_kinds`, fail-closed).
Every workflow is a deterministic computation over EXISTING MD-1 kinds (bars.daily, quotes, news.company,
instrument.resolve) through the existing gateway and its per-turn read budget: no new kind, no model call, no new
provider, no spend change, no permission change. docs/agent/TRADING-WORKFLOWS.md.
"""
from __future__ import annotations

import os

ENV = "UCT_AGENT_WORKFLOWS"
#: the workflow names (the browser's capability modules check exactly these strings)
NAMES = ("relativeStrength", "watchlistChanges", "setupSnapshot", "themeRotation")
_ALL = frozenset({"1", "true", "on", "yes", "all"})
_OFF = frozenset({"", "0", "false", "off", "no", "none"})


def enabled() -> list[str]:
    """The workflow names this server switches on, sorted; [] while the flag is off (the default)."""
    raw = str(os.environ.get(ENV) or "").strip().lower()
    if raw in _OFF:
        return []
    if raw in _ALL:
        return sorted(NAMES)
    by_lower = {n.lower(): n for n in NAMES}
    return sorted({by_lower[w.strip()] for w in raw.split(",") if w.strip() in by_lower})
