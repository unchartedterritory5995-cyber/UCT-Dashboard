"""The ONE history window a server-side Pine run reads (W9 design 3.4, ruling R10).

Every broker/runtime/sweep/backtest lane that says "the last N daily bars" reads N
from here. A longer window (design D9) is a change to this one constant, and nothing
else. ``tests/test_history_window_one_authority.py`` parses the consumers by AST and
fails when one of them restates the integer.

⚠️ NOT this quantity: ``snapshot_builder.DEEP_BARS`` is the all-time-high lookback
behind ``dist_ath_pct`` / ``new_ath`` (ruling R13). It keeps its own named constant,
so a window change can never silently redefine "all-time high" on every member's
screen.

Importing this module has no side effects and reads no other module, so any layer
(a router, the sweep, the alert lane) may import it without widening an import rail.
"""
from __future__ import annotations

HISTORY_WINDOW_BARS = 5000

#: ⭐⭐ (coordinator ruling 2026-11-19, D9 strategy-only; the owner may veto) THE STRATEGY WINDOW: the most recent
#: daily bars a strategy run on a MEMBER'S CHART may take, so that a daily chart holding a stock's whole history
#: (the chart loads `barsBackfill.js::fullBarsFor('D')` bars: the two are pinned EQUAL by
#: `tests/test_history_window_one_authority.py`) runs from the listing. Read by ONE consumer, the chart lane's
#: window endpoint (`api/routers/pine_history_window.py`); the scan sweep, the screener backtest, the alert lanes and
#: the server strategy route keep HISTORY_WINDOW_BARS. A run covering more than HISTORY_WINDOW_BARS bars from the
#: listing is a DEEP start, served only once a TradingView capture witnesses where its backtest starts there (the
#: broker rule B-START-DEEP, capture rows Q-SU-7 / Q-SU-8); until then it refuses by name.
STRATEGY_HISTORY_WINDOW_BARS = 12500
