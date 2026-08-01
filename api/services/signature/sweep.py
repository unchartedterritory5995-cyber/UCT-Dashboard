"""Nightly closed-bar FCB sweep -> signal ledger.

Runs POST-close (16:45 ET weekdays), so `include_last=True` is honest: the
session's final daily bar is confirmed. This is what makes the ledger accrue
from launch day independent of user chart views — the request path only ever
records a signal for a symbol somebody happened to open, and only for bars that
are already closed-and-superseded.

Three shapes here are deliberate:

1. **One symbol cannot end the pass, and neither can one signal.** A dead
   provider and a ledger refusal are both routine. `record_signal` RAISES by
   design on any field it cannot key (see `ledger.record_signal`), so recording
   is wrapped PER SIGNAL — a per-symbol guard alone would abandon every later
   signal for that symbol on the first refusal.
2. **`errors` counts everything that did not land** — a symbol whose fetch blew
   up AND a signal the ledger refused. The return value is the receipt for the
   pass; a refusal that showed up only in the log would let a broken sweep read
   as a clean one.
3. **A failed flow READ is an error, never an empty tape.** `_fetch_flow_rows`
   returns None on failure; handing `{}` to the compute would score an outage as
   "scanned, no signals" (`lesson_market_cap_cache_poison`: never remember a
   failed fetch as a value).

There is no market-holiday guard and none is needed: on a holiday the bars store
still ends at the last session's bar, the sweep re-evaluates it, and the
ledger's UNIQUE key refuses it — `recorded` is 0 and nothing is written twice.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo

from api.services.signature import ledger
from api.services.signature.flow_breakout import fcb_signals

log = logging.getLogger("signature.sweep")

_ET = ZoneInfo("America/New_York")

_DEFAULT_SYMBOLS = "SPY,QQQ,NVDA,TSLA,AAPL,MSFT,AMD,META,AMZN,GOOGL"


def _sweep_date_iso(now: datetime | None = None) -> str:
    """The ET session date this pass belongs to.

    The clock is a parameter so this is testable at an instant rather than only
    after 8 PM: the pod runs UTC, and any run past 20:00 ET (a retry, a manual
    backfill) would stamp TOMORROW onto tonight's receipts with a bare
    `date.today()`.
    """
    return (now.astimezone(_ET) if now is not None else datetime.now(_ET)).date().isoformat()


def _flow_by_date(rows) -> dict[str, list[dict]]:
    """Group flow rows by ISO session date.

    The flow table's `CreatedDate` is M/D/YYYY; `flow_breakout._bar_date_iso`
    normalizes a bar timestamp to ISO. Both sides of the join have to agree or
    it matches nothing and the indicator ships silently dead — there is no error
    anywhere, just zero signals forever.

    NOTE: `api/routers/signature.py::_fcb_build` does this same normalization
    INLINE (it is not a helper there, so there is nothing to import). The two
    are duplicated on purpose rather than one file reaching into the other's
    private internals; they must be changed together, and
    `test_flow_dates_are_keyed_the_same_way_bar_dates_are` pins this side
    against `_bar_date_iso` so a drift is caught here regardless.
    """
    by_date: dict[str, list[dict]] = {}
    for r in rows:
        d = r.get("CreatedDate") or ""
        try:
            m, day, y = d.split("/")
            iso = f"{int(y):04d}-{int(m):02d}-{int(day):02d}"
        except (ValueError, AttributeError):
            continue
        by_date.setdefault(iso, []).append(r)
    return by_date


def run_sweep(symbols, *, fetch_bars, fetch_flow, now_iso: str) -> dict:
    """Pure orchestration: fetch, detect, record. Returns the pass receipt.

    `scanned` counts symbols that made it through the compute — a symbol whose
    fetch raised is an error, not a scan. `recorded` counts NEW ledger rows only
    (`record_signal` returns False for one already recorded, which is the normal
    steady state on a re-run).
    """
    scanned = recorded = errors = 0
    for sym in symbols:
        try:
            bars = fetch_bars(sym)
            flow_by_date = fetch_flow(sym)
            # include_last=True: post-close, the final daily bar is confirmed.
            # This is the ONE thing the request path cannot do.
            signals = fcb_signals(bars, flow_by_date, include_last=True)
        except Exception:                              # noqa: BLE001 — see docstring
            log.exception("signature sweep failed for %s", sym)
            errors += 1
            continue
        scanned += 1
        for s in signals:
            try:
                if ledger.record_signal("fcb", s["version"], sym, "1D", s["direction"],
                                        s["barTime"], s["close"],
                                        meta={"callPrem": s["callPrem"],
                                              "putPrem": s["putPrem"], "sweep": now_iso}):
                    recorded += 1
            except Exception:                          # noqa: BLE001
                log.exception("signature sweep: ledger refused %s bar=%r — signal LOST",
                              sym, s.get("barTime"))
                errors += 1
    return {"scanned": scanned, "recorded": recorded, "errors": errors}


def sweep_job() -> None:
    """The scheduled entry (weekdays 16:45 ET). Never raises into the scheduler."""
    try:
        from api.routers.signature import _fetch_bars, _fetch_flow_rows

        symbols = [s.strip().upper() for s in
                   os.environ.get("SIGNATURE_SWEEP_SYMBOLS", _DEFAULT_SYMBOLS).split(",")
                   if s.strip()]

        def fetch_flow(sym):
            # None means the READ failed — raise so the symbol lands in
            # `errors` instead of being scored as a quiet tape.
            rows = _fetch_flow_rows(sym)
            if rows is None:
                raise RuntimeError(f"flow read failed for {sym}")
            return _flow_by_date(rows)

        res = run_sweep(symbols, fetch_bars=_fetch_bars, fetch_flow=fetch_flow,
                        now_iso=_sweep_date_iso())
        log.info("signature sweep done: %s", res)
    except Exception:                                  # noqa: BLE001
        log.exception("signature sweep job failed")
