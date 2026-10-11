"""The LATEST COMPLETED SESSION's close, volume and dollar volume for a set of tickers.

UCT's Screener holds a 30-day AVERAGE dollar volume (`dollar_vol_30d`) and no single-session
one. "Trades over $10 million a day" means the latest completed session's traded dollars,
so UCT Agent reads it here: one whole-market grouped-daily frame (the same
`massive.get_grouped_daily_ohlcv` breadth reads every day, durable on disk once settled),
RAW (unadjusted) so close × volume is what actually traded that day.

⛔ ONE CLOCK. Close, volume and dollar volume all come from the same bar of the same session,
and the session is named in the answer. "Completed" = the newest NYSE session whose 16:00 ET
close has passed (`flow_card_ops.last_closed_session`); if the provider has not published that
day's frame yet, the previous session is used and the answer says which day it is.

READ-ONLY: nothing is written; no model call.
"""
from __future__ import annotations

import datetime as dt
import re
from typing import Callable

MAX_SYMBOLS = 10000
STEP_BACK = 3
_TICKER = re.compile(r"^[A-Z0-9.\-^$:_/]{1,24}$")


def _default_frame(day_iso: str) -> dict:
    from api.services import massive
    return massive.get_grouped_daily_ohlcv(day_iso, adjusted=False)


def _default_session() -> dt.date:
    from api.services.flow_card_ops import last_closed_session
    return last_closed_session()


def _previous_session(day: dt.date) -> dt.date:
    from api.services.flow_card_ops import _is_session
    day -= dt.timedelta(days=1)
    while not _is_session(day):
        day -= dt.timedelta(days=1)
    return day


def latest_session(symbols: list, *, frame: Callable[[str], dict] | None = None,
                   session: Callable[[], dt.date] | None = None,
                   previous: Callable[[dt.date], dt.date] | None = None) -> dict:
    """{session, rows: {TICKER: {close, volume, dollar_volume}}, missing: [...]} or {session: None, error}."""
    want = []
    for s in symbols or []:
        t = str(s or "").strip().upper()
        if _TICKER.match(t) and t not in want:
            want.append(t)
    want = want[:MAX_SYMBOLS]
    frame = frame or _default_frame
    previous = previous or _previous_session
    day = (session or _default_session)()
    rows = {}
    for _ in range(STEP_BACK):
        rows = frame(day.isoformat()) or {}
        if rows:
            break
        day = previous(day)
    if not rows:
        return {"session": None, "rows": {}, "missing": want,
                "error": "the latest session's market data isn't available right now"}
    out, missing = {}, []
    for t in want:
        r = rows.get(t)
        c, v = (r or {}).get("c"), (r or {}).get("v")
        if not isinstance(c, (int, float)) or not isinstance(v, (int, float)) or c <= 0:
            missing.append(t)
            continue
        out[t] = {"close": round(float(c), 4), "volume": float(v), "dollar_volume": round(float(c) * float(v), 2)}
    return {"session": day.isoformat(), "rows": out, "missing": missing}
