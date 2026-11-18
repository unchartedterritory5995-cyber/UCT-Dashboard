"""W9-T14 -- server-side strategy backtests: ``POST /api/pine/strategy-backtest``.

W9 design 3.4 ("W9.4 composed with W5") and ruling D5 (coordinator, 2026-11-07,
``docs/pine/W9-DECISIONS-2026-11-07.md``: the W5 server lane's plan gate, and SINGLE-SYMBOL only for
now; multi-symbol is deferred until the broker's cost on the service is measured). A member's OWN stored strategy document runs on
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
(``screener_backtest._runtime_admission`` / ``_refuse_runtime``) and its bar-time rule
(``_service_bars``). THE PLAN GATE is the W5 server lanes' own predicate, ``is_paid_user`` over
``get_current_user_with_plan`` (the screener backtest, scan results, user definitions and
definition record doors all gate on it), behind this route's dark gate.

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
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

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
    #: EXACTLY ONE symbol (D5). A list, so a request naming none or several is refused BY NAME
    #: (``_symbols``) rather than by a schema error or a silent truncation.
    symbols: list[str]
    #: The script's input values (``ctx.runtimeInputs``), as the chart sends them.
    inputs: Optional[dict[str, Any]] = None


#: D5: one symbol per request for now (its cost is bounded at ``HISTORY_WINDOW_BARS`` bars per call).
MAX_SYMBOLS = 1
NO_SYMBOL_GUARD = "runtime:strategy-no-symbol"
MULTI_SYMBOL_GUARD = "runtime:strategy-multi-symbol"


def _symbols(raw: list[str]) -> list[str]:
    """The one symbol asked, or a 400 naming why not. Never truncated: two entries (even the same
    ticker twice) are refused, so the member is never answered about fewer symbols than they sent."""
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail=(
            f"{NO_SYMBOL_GUARD}: a strategy backtest needs one symbol, and this request names none"))
    if len(raw) > MAX_SYMBOLS:
        raise HTTPException(status_code=400, detail=(
            f"{MULTI_SYMBOL_GUARD}: a strategy backtest takes one symbol at a time for now, and this "
            f"request names {len(raw)}; nothing was run. Send one request per symbol."))
    out: list[str] = []
    for s in raw:
        t = s.strip().upper() if isinstance(s, str) else ""
        if not _TICKER.match(t):
            raise HTTPException(status_code=400, detail=f"{s!r} is not a ticker")
        out.append(t)
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


#: ``strategyRecord.js::START_TIMEZONE``: no record carries the symbol's exchange timezone, so the
#: start date is the UTC date of ``window.startTime`` and the sentence says so.
START_TIMEZONE = "UTC"


def start_date_of(start_time: Any) -> Optional[str]:
    """``strategyRecord.js::startDateOf``. Used ONLY on an answer with no record (a refusal); an
    answer with a record serves the record's own date and sentence (ruling D2, one authority).
    ``tests/test_pine_strategy_backtest.py`` holds it to the JS function through a fixture the JS
    rail writes (``w9t13a_start_sentence.json``)."""
    if isinstance(start_time, bool) or not isinstance(start_time, (int, float)):
        return None
    return datetime.fromtimestamp(start_time, timezone.utc).strftime("%Y-%m-%d")


def start_sentence_of(start_time: Any) -> str:
    """``strategyRecord.js::startSentenceOf``: the D2 sentence, in the same words and timezone. Stated
    on EVERY record, from the listing too (W9-T13b r1), so it takes no listing argument."""
    date = start_date_of(start_time)
    if date is None:
        return "this backtest ran over no bars"
    return f"this backtest starts on {date} ({START_TIMEZONE}); TradingView may start elsewhere"


def _window_of(sent: list, rec: Optional[dict] = None) -> dict:
    """The window this route RAN, stated on every answer (D2). The start is ``window.startTime``,
    the run's truth (the bar time the route SENT, never a bars.db date string). With a record, its
    own ``startDate`` / ``startSentence`` are served verbatim (one authority with the report);
    without one (a refusal) the same rule is applied to the time sent."""
    start_time = sent[0]["t"]
    if rec is not None:
        w = rec["window"]
        date, note = w.get("startDate"), w.get("startSentence")
    else:
        date, note = start_date_of(start_time), start_sentence_of(start_time)
    return {"startTime": start_time, "startDate": date, "bars": len(sent),
            "historyWindowBars": HISTORY_WINDOW_BARS, "fromListing": False, "note": note}


def _exchange_of(sym: str) -> str:
    """W9-T4-F1 -- the symbol's exchange in OUR store's spelling, from the same store the chart reads
    (``ticker_meta``, served to the chart by ``/api/ticker-meta``), so a server run and a chart run settle
    ``syminfo.*`` -- ``syminfo.mincontract`` and the broker's minimum contract with it -- from one
    ``{ticker, exchange}``. The SERVICE derives the minimum contract from this (``runtimeColumns.js``,
    ``symbolScope.json::min_contract``); this route never states one. An unreadable or unknown exchange
    is ``""``: nothing settles, and a cash / percent-of-equity size refuses by name (Q-S1a).
    r1 (review N2): CACHE-ONLY (``ticker_meta.peek_exchange``), so the request path never makes a
    provider call. A cold cache is ``""`` and refuses by name, which is honest; the chart's own
    ``/api/ticker-meta`` read (or the names prewarmer) fills the cache for the next run."""
    try:
        from api.services import ticker_meta
        exch = ticker_meta.peek_exchange(sym)
    except Exception:  # noqa: BLE001 -- unknown stays unknown, refused by name downstream
        return ""
    if not isinstance(exch, str) or not runtime_client._EXCHANGE.match(exch.strip()):
        return ""
    return exch.strip()


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
            job=sym, ticker=sym, exchange=_exchange_of(sym), tf=TF, bars=sent, want=(codec.STRATEGY_WANT,),
            runtime_inputs=dict(body.inputs or {}), history_from_listing=False,
            history_window_bars=HISTORY_WINDOW_BARS))

    if jobs:
        results = _runtime_client().run(
            def_id=row.get("def_id"), version=row.get("version"), doc=row.get("definition"),
            owner_id=row.get("user_id", user.get("id")), profile="backtest", jobs=jobs)
        for job, res in zip(jobs, results):
            _bars, sent = sent_of[job.job]
            why = res.refusal_for(codec.STRATEGY_WANT)
            if why is not None:
                if _transport(why):
                    raise sbt._refuse_runtime(why.guard, why.sentence)
                answers[job.job] = {"symbol": job.job, "status": "refused", "window": _window_of(sent),
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
            # D2, one authority: the record must state its start by the one rule (the report reads it)
            if w.get("startDate") != start_date_of(sent[0]["t"]) or not isinstance(w.get("startSentence"), str) \
                    or not w.get("startSentence"):
                raise sbt._refuse_runtime(
                    runtime_client.INTEGRITY,
                    f"the strategy record for {job.job} does not state its start (D2)")
            answers[job.job] = {"symbol": job.job, "status": "ok", "window": _window_of(sent, rec), "strategy": rec}

    return {"def_id": body.def_id, "tf": TF, "historyWindowBars": HISTORY_WINDOW_BARS,
            "results": [answers[s] for s in symbols]}
