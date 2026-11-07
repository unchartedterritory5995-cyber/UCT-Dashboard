"""W9-T14 -- server-side strategy backtests: ``POST /api/pine/strategy-backtest``.

W9 design 3.4 ("W9.4 composed with W5") and ruling D5 (a separate route, the screener backtest's
plan gate, multi-symbol capped like ``max_cells``). A member's OWN stored strategy document runs on
the pine-runtime service, one job per symbol, under profile ``backtest`` with
``want: ["#strategy"]``, and each symbol answers either the run's ``strategy`` record (design 3.2)
or the refusal that stopped it, by name.

WHAT THIS ROUTE DECIDES, AND WHAT IT DOES NOT.
  * The window is ``bars_window.HISTORY_WINDOW_BARS`` (the ONE authority, rulings R10/R13): the
    most recent that many daily bars from ``bars.db``. It is imported, never restated
    (``tests/test_history_window_one_authority.py`` parses this file).
  * ``historyFromListing`` is ALWAYS false: nothing on the server proves a symbol's stored daily
    history reaches its listing (design section 9, item 5). So the window's START is stated on every
    answer (ruling D2: "long histories state their own start"), and the broker decides what a
    non-listing window may serve (``vm.js`` [B-START], capture Q-S1n): today it refuses it by name.
  * NO strategy semantics live here. Sizing, costs and fills (T4-T8) are the broker's
    (``RT/broker.js``) and are capture-gated: an unpinned rule stops the run
    (``runtime:strategy-unpinned``), an unsettled one ``runtime:strategy-unsettled``. This route
    carries the record verbatim and never recomputes, fills or drops a trade.

REUSED, BY IMPORT, NEVER COPIED: W5-T11's client and codec (``pine_runtime_client``,
``pine_runtime_codec``); W5-T12's admission and W5-T15's status mapping
(``screener_backtest._runtime_admission`` / ``_refuse_runtime``), its bar-time rule
(``_service_bars``) and its memory bound (``max_cells``, ``INLINE_MAX_SYMBOLS``).

DARK. ``_require_open`` answers 404 to every caller the SERVER stage does not admit
(``runtime_definitions.server_permitted``: ``PINE_RUNTIME_SERVER_STAGE`` unset = ``off`` = nobody),
before the plan gate and before any read. Past it, the owner's admission chain (kill list, graded
allowlist, both stages, the service being set up) refuses by name, and the service's broker gate is
off (a strategy document refuses ``pine:strategy-call`` there). This module sets and reads no flag of
its own.

E-3: this module imports ``api.services.bars_window`` for the window and names nothing of
``scan_evaluator`` (``tests/test_scan_evaluator_off_request_path.py`` walks it).
"""
from __future__ import annotations

import logging
import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.routers import screener_backtest as sbt
from api.services import bars_fetch, bars_sqlite
from api.services import pine_runtime_client as runtime_client
from api.services import pine_runtime_codec as codec
from api.services import runtime_definitions
from api.services import user_definitions as defs
from api.services.bars_window import HISTORY_WINDOW_BARS

log = logging.getLogger(__name__)

router = APIRouter()

#: v1 is daily only, as the screener backtest (bars.db's intraday retention is shorter than the window).
TF = "D"
_TICKER = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,11}$")


def _require_open(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """DARK: a caller the server stage does not admit is told the route is not there."""
    if not runtime_definitions.server_permitted(user.get("role"), user.get("id")):
        raise HTTPException(status_code=404, detail="Not Found")
    return user


def require_paid(user: dict = Depends(_require_open)) -> dict:
    """Defined here, with its own sentence (``tests/test_user_definitions_auth.py``): the screener
    backtest's plan gate (ruling D5), paid not admin."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Strategy backtesting requires a paid plan")
    return user


class StrategyBacktestRequest(BaseModel):
    #: The member's OWN stored strategy document (scoped at the store: another member's id is a 404).
    def_id: str
    #: One backtest per symbol, each over the same window rule.
    symbols: list[str] = Field(min_length=1)
    #: The script's input values (``ctx.runtimeInputs``), as the chart sends them.
    inputs: Optional[dict[str, Any]] = None


def max_symbols() -> int:
    """D5: ``symbols x HISTORY_WINDOW_BARS`` within the screener backtest's ``max_cells()``, and never
    more than its inline bound (this route has no background receipt in v1)."""
    return min(sbt.INLINE_MAX_SYMBOLS, sbt.max_cells() // HISTORY_WINDOW_BARS)


def _symbols(raw: list[str]) -> list[str]:
    out: list[str] = []
    for s in raw:
        t = s.strip().upper() if isinstance(s, str) else ""
        if not _TICKER.match(t):
            raise HTTPException(status_code=400, detail=f"{s!r} is not a ticker")
        if t not in out:
            out.append(t)
    cap = max_symbols()
    if len(out) > cap:
        raise HTTPException(
            status_code=413,
            detail=(f"{len(out)} symbols asked; a strategy backtest takes at most {cap} "
                    f"(the inline bound {sbt.INLINE_MAX_SYMBOLS}, and symbols x {HISTORY_WINDOW_BARS} "
                    f"bars within SCREEN_BACKTEST_MAX_CELLS = {sbt.max_cells()})"))
    return out


def _row(def_id: str, user_id: Any) -> dict:
    try:
        row = defs.get(user_id, def_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=404, detail=f"no definition {def_id!r} for this member")
    doc = row.get("definition")
    if not runtime_definitions.is_runtime(doc):
        raise HTTPException(status_code=409, detail=f"runtime:not-runtime: definition {def_id!r} is not a stored runtime document")
    meta = doc.get("meta") if isinstance(doc.get("meta"), dict) else {}
    if meta.get("runtimeHistory") != codec.STRATEGY_WINDOW_HISTORY:
        raise HTTPException(
            status_code=409,
            detail=(f"runtime:not-strategy: definition {def_id!r} is not a strategy run by the broker "
                    f"(its document is not stamped {codec.STRATEGY_WINDOW_HISTORY!r}), so it has no backtest"))
    return row


def _window_bars(sym: str) -> list:
    """The most recent ``HISTORY_WINDOW_BARS`` daily bars of ``sym``, served shape (the screener
    backtest's reader pairing: ``bars_sqlite`` then ``bars_fetch._fmt_sqlite_bars``, which sanitises).
    An unreadable store is "no bars", stated per symbol, never a dead request."""
    try:
        rows = bars_sqlite.get_bars(sym, TF, HISTORY_WINDOW_BARS) or []
    except Exception as exc:  # noqa: BLE001
        log.warning("[strategy-backtest] bars read failed for %s: %s", sym, exc)
        return []
    return bars_fetch._fmt_sqlite_bars(rows, TF, sym)


def _window_of(bars: list, sent: list) -> dict:
    """The window this route RAN, stated on every answer (D2), from the bars it sent."""
    start = str(bars[0].get("t"))[:10]
    return {"startTime": sent[0]["t"], "startDate": start, "bars": len(sent),
            "historyWindowBars": HISTORY_WINDOW_BARS, "fromListing": False,
            "note": f"this backtest starts on {start}; TradingView may start elsewhere"}


def _transport(why: runtime_client.Refusal) -> bool:
    """A run-wide refusal that says nothing about the script (the service, the wire, the clock)."""
    return why.key == "*" and (why.guard in runtime_client.CLIENT_GUARDS or why.guard == runtime_client.TIME_BUDGET
                               or why.guard.startswith("runtime:server-"))


def _runtime_client():
    """The one place this door asks for a client, so a test (and only a test) replaces it."""
    return runtime_client.client_from_env()


@router.post("/api/pine/strategy-backtest")
def run_strategy_backtest(body: StrategyBacktestRequest, user: dict = Depends(require_paid)):
    """Backtest the member's stored strategy on each symbol over the one history window."""
    row = _row(body.def_id, user.get("id"))
    symbols = _symbols(body.symbols)
    sbt._runtime_admission(row, codec.STRATEGY_WANT)

    answers: dict = {}
    jobs, sent_of = [], {}
    for sym in symbols:
        bars = _window_bars(sym)
        if not bars:
            answers[sym] = {"symbol": sym, "status": "refused", "window": None,
                            "refusal": {"guard": "runtime:strategy-no-bars", "bar": None,
                                        "sentence": f"bars.db holds no daily bars for {sym}, so it has no backtest"}}
            continue
        sent = sbt._service_bars(bars)
        sent_of[sym] = (bars, sent)
        jobs.append(runtime_client.Job(
            job=sym, ticker=sym, tf=TF, bars=sent, want=(codec.STRATEGY_WANT,),
            runtime_inputs=dict(body.inputs or {}), history_from_listing=False,
            history_window_bars=HISTORY_WINDOW_BARS))

    if jobs:
        results = _runtime_client().run(
            def_id=row.get("def_id"), version=row.get("version"), doc=row.get("definition"),
            owner_id=row.get("user_id", user.get("id")), profile="backtest", jobs=jobs)
        for job, res in zip(jobs, results):
            bars, sent = sent_of[job.job]
            window = _window_of(bars, sent)
            why = res.refusal_for(codec.STRATEGY_WANT)
            if why is not None:
                if _transport(why):
                    raise sbt._refuse_runtime(why.guard, why.sentence)
                answers[job.job] = {"symbol": job.job, "status": "refused", "window": window,
                                    "refusal": {"guard": why.guard, "sentence": why.sentence, "bar": why.bar}}
                continue
            rec = res.strategy
            w = rec.get("window") if isinstance(rec.get("window"), dict) else {}
            # one authority over the window: the record's own must be the window this route sent
            if w.get("bars") != len(sent) or w.get("startTime") != sent[0]["t"] \
                    or w.get("historyWindowBars") != HISTORY_WINDOW_BARS:
                raise sbt._refuse_runtime(
                    runtime_client.INTEGRITY,
                    f"the strategy record for {job.job} describes a window other than the one sent")
            answers[job.job] = {"symbol": job.job, "status": "ok", "window": window, "strategy": rec}

    return {"def_id": body.def_id, "tf": TF, "historyWindowBars": HISTORY_WINDOW_BARS,
            "results": [answers[s] for s in symbols]}
