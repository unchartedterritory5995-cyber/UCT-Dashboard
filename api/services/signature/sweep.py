"""Nightly closed-bar FCB sweep -> signal ledger.

Runs POST-close (20:05 ET weekdays) and walks a fixed symbol list whether or not
a user ever opened a chart. This is what makes the ledger accrue from launch
day: the request path only records a signal for a symbol somebody happened to
look at, and only for bars already closed-and-superseded.

Five shapes here are deliberate:

1. **`include_last` is EARNED, not assumed.** `bars.db` stores today's
   *evolving* partial daily bar and refreshes it from user fetches, not from a
   clock (`bars_fetch._needs_fresh`: "today's bar keeps evolving"). So "the last
   row in the store" is not the same thing as "the closed session". The sweep
   trusts the last bar only when it matches the session the bars store's own
   NYSE-aware calendar says should exist; otherwise it evaluates exactly what
   the request path would. The ledger is append-only with no rewrite path, so a
   signal recorded off a 15:52 snapshot that the real close took back is
   permanent — the conservative direction is the only safe one.
2. **One symbol cannot end the pass, and neither can one signal.** A dead
   provider and a ledger refusal are both routine. `record_signal` RAISES by
   design on any field it cannot key, so recording is wrapped PER SIGNAL — a
   per-symbol guard alone would abandon every later signal for that symbol on
   the first refusal.
3. **The receipt distinguishes the ways a pass can be empty.** `recorded: 0`
   means "quiet night" OR "every store was behind" OR "everything was refused";
   `symbols`/`scanned`/`errors`/`stale` make those different numbers.
3b. **And the COVERAGE RECEIPT distinguishes the ways a SYMBOL can be empty.**
   Counting a pass is not the same as certifying a symbol. `signals: []` for
   AAPL and `signals: []` for a name this sweep has never walked are the same
   bytes, so a reader cannot serve either as an answer. Each symbol that
   completes therefore also writes `ledger.record_coverage(...)` — "evaluated
   `sym` on `1D` from bar X through bar Y at time T under fcb-v2" — and that
   receipt is what lets a reader say "evaluated, nothing found" out loud.
   Three things it is NOT allowed to be:
     * it is NOT the fetched window. `detect_breakouts` never looks at the
       first `FCB_LOOKBACK` bars, so certifying `bars[0]` would claim 20 bars
       of coverage that does not exist. The window comes from
       `flow_breakout.evaluated_window`, which is pinned to the detector.
     * it is NOT written when a signal was REFUSED. A refused row is a signal
       this pass found and the store dropped; certifying that window would tell
       a reader the absence of that row means "nothing there".
     * it is NOT version-free. The ledger's uniqueness key includes the rule
       version, so a receipt that ignored it would certify fcb-v3 coverage on
       the strength of an fcb-v2 night.
4. **A failed flow READ is an error, never an empty tape.** Handing `{}` to the
   compute would score an outage as "scanned, no signals"
   (`lesson_market_cap_cache_poison`: never remember a failed fetch as a value).
5. **The flow read never materializes what it will not use.** SPY/QQQ carry a
   90-day uncapped history over 22 columns; this streams the gzipped CSV and
   keeps three fields, inside the bar window it is about to join against.

There is no market-holiday guard and none is needed: on a holiday the calendar
rolls BACK to the last real session, the store's newest bar is that same
session, the sweep re-evaluates it, and the ledger's UNIQUE key refuses it —
`recorded` is 0 and nothing is written twice.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

from api.services.signature import ledger, rules
from api.services.signature.flow_breakout import (
    FLOW_COLS, _bar_date_iso, evaluated_window, fcb_signals, flow_by_date,
)

log = logging.getLogger("signature.sweep")

_ET = ZoneInfo("America/New_York")

_DEFAULT_SYMBOLS = "SPY,QQQ,NVDA,TSLA,AAPL,MSFT,AMD,META,AMZN,GOOGL"

# The ledger vocabulary this sweep writes under. ONE definition, used by BOTH
# the signal rows and the coverage receipt — a receipt keyed to a different
# indicator or timeframe than the signals it certifies certifies nothing, and
# NOTHING WOULD FAIL: the reader's containment query would simply never match,
# and the coverage feature would be silently dead. Two literals in two calls is
# how that happens.
_LEDGER_INDICATOR = "fcb"
_LEDGER_TF = "1D"

# Generous because this streams a whole symbol history on a scheduler thread,
# not a chart read on an anyio worker. The request path's 15s stays 15s.
_FLOW_TIMEOUT_S = 60.0


def _sweep_date_iso(now: datetime | None = None) -> str:
    """The ET session date this pass belongs to.

    The clock is a parameter so this is testable at an instant rather than only
    after 8 PM: the pod runs UTC, and a 20:05 ET job is already past midnight
    UTC in winter — a bare `date.today()` would stamp TOMORROW onto tonight's
    receipts.
    """
    return (now.astimezone(_ET) if now is not None else datetime.now(_ET)).date().isoformat()


def _expected_session() -> int:
    """The most recent session (YYYYMMDD) the bars store should have data for.

    Delegates to the bars store's OWN calendar rather than re-deriving one:
    `bars_fetch._expected_latest_session_yyyymmdd` already handles weekends, the
    pre-open roll and the NYSE holiday walk-back, and it is the same function
    the store's staleness logic uses. Two calendars that disagreed would make
    this gate fire on days the store itself considers current.

    Imported lazily — `bars_fetch` is heavy and this is a scheduler path, not an
    import-time dependency of the compute.
    """
    from api.services.bars_fetch import _expected_latest_session_yyyymmdd
    return _expected_latest_session_yyyymmdd()


def _read_flow_source(sym: str, source: str, cutoff_iso: str) -> dict[str, list[dict]]:
    """One streamed read of ONE flow source.

    The surface serves **gzipped CSV** (`flow_router.get_flow_ticker` →
    `_build_gzipped_symbol_csv`); httpx decodes the Content-Encoding, so
    `iter_lines()` yields decoded CSV text without the body ever being
    materialized as one string.

    **No credential is forwarded** — `/api/flow/ticker/{symbol}` declares no auth
    on either service, so sending one to an env-configurable base URL would buy
    nothing and hand a live credential to whatever `_flow_base_url()` resolves
    to. `_flow_base_url` is imported from the router so URL resolution
    (`SIGNATURE_FLOW_BASE` → proxy → `$PORT`) keeps exactly one definition.

    Raises on a failed read. The caller counts that as an error; degrading to
    `{}` would score an outage as a quiet tape.
    """
    from api.routers.signature import _flow_base_url

    url = f"{_flow_base_url()}/api/flow/ticker/{sym}"
    with httpx.stream("GET", url, params={"source": source},
                      timeout=_FLOW_TIMEOUT_S) as resp:
        if resp.status_code != 200:
            raise RuntimeError(
                f"flow read for {sym} ({source}) returned HTTP {resp.status_code}")
        return flow_by_date(resp.iter_lines(), cutoff_iso=cutoff_iso)


def _fetch_flow_by_date(sym: str, cutoff_iso: str = "") -> dict[str, list[dict]]:
    """Read one symbol's flow, trying BOTH sources the flow DB files under.

    `/api/flow/ticker` defaults to `source=stocks`, but index/ETF symbols — SPY,
    QQQ, IWM, every XL*, ~200 names — are filed under `source=indexes`. Asking
    the wrong one returns a header with no rows: a 200, no error, an empty join.
    The sweep's DEFAULT symbol list LEADS with SPY and QQQ, so stocks-only meant
    the ledger's two headline names could never accrue a single row.

    Ask `stocks`; only if the parse yields ZERO rows, ask `indexes` once. Not a
    hardcoded symbol list — membership is upstream's to change, and a list would
    drift out of date without ever failing. A real stock costs one request.

    A failed read RAISES out of here before any retry: a 500 is not an empty
    tape, and the caller counts it as an error rather than a quiet night.
    """
    by_date = _read_flow_source(sym, "stocks", cutoff_iso)
    if by_date:
        return by_date
    return _read_flow_source(sym, "indexes", cutoff_iso)


def run_sweep(symbols, *, fetch_bars, fetch_flow, now_iso: str) -> dict:
    """Pure orchestration: fetch, gate, detect, record. Returns the pass receipt.

    `fetch_flow(sym, cutoff_iso)` takes the window because only this function
    knows which bars were actually fetched — see `_fetch_flow_by_date`.

    Receipt keys:
      symbols  — how many were asked for
      scanned  — how many reached the compute (a symbol whose fetch raised did not)
      recorded — NEW ledger rows only (`record_signal` returns False for one
                 already recorded, which is the normal steady state on a re-run)
      errors   — everything that did not land: a symbol whose fetch raised, any
                 signal the ledger refused, and any coverage receipt it refused
      stale    — symbols whose newest bar was not the expected session, i.e.
                 whose last bar was deliberately NOT evaluated
      covered  — symbols that reached the compute AND were certified: a
                 coverage receipt was written (or was already there from an
                 earlier run of the same window)
      uncovered— symbols that reached the compute and were NOT certified,
                 because they evaluated no bar or because a signal of theirs
                 was refused. `scanned - covered` is not the same question:
                 a symbol can be scanned and still certify nothing.
    """
    expected_iso = _bar_date_iso(_expected_session())
    symbols = list(symbols)
    scanned = recorded = errors = stale = covered = uncovered = 0
    want_version = rules.VERSIONS[_LEDGER_INDICATOR]

    for sym in symbols:
        fresh_last = False
        try:
            bars = fetch_bars(sym)
            # Compared as ISO so every bar-time encoding (YYYYMMDD int, ISO
            # string, epoch) goes through the one decoder the flow join uses —
            # and garbage decodes to "", which is never equal, i.e. it fails
            # toward NOT trusting the last bar.
            fresh_last = bool(bars) and _bar_date_iso(bars[-1]["t"]) == expected_iso
            cutoff_iso = _bar_date_iso(bars[0]["t"]) if bars else ""
            # `by_date`, not `flow_by_date`: the latter is the module-level
            # parser imported at the top of this file, and binding a local over
            # it here would leave the import shadowed for the rest of the body.
            by_date = fetch_flow(sym, cutoff_iso)
            signals = fcb_signals(bars, by_date, include_last=fresh_last)
        except Exception:                              # noqa: BLE001 — see docstring
            log.exception("signature sweep failed for %s", sym)
            errors += 1
            continue

        scanned += 1
        if not fresh_last:
            stale += 1
            log.warning("signature sweep: %s bars store is behind the expected session "
                        "%s — its last bar was NOT evaluated", sym, expected_iso)

        incomplete = 0
        for s in signals:
            try:
                if ledger.record_signal(_LEDGER_INDICATOR, s["version"], sym, _LEDGER_TF,
                                        s["direction"], s["barTime"], s["close"],
                                        meta={"callPrem": s["callPrem"],
                                              "putPrem": s["putPrem"], "sweep": now_iso}):
                    recorded += 1
            except Exception:                          # noqa: BLE001
                log.exception("signature sweep: ledger refused %s bar=%r — signal LOST",
                              sym, s.get("barTime"))
                errors += 1
                incomplete += 1
            else:
                # A signal written under a version the receipt will not name is
                # invisible to every reader that trusts the receipt. It cannot
                # happen through `fcb_signals` (which stamps VERSIONS["fcb"]),
                # and that is exactly why it must be CHECKED rather than assumed
                # — an assumption that can only be broken by a future edit is
                # the kind that breaks silently.
                if s.get("version") != want_version:
                    log.error("signature sweep: %s bar=%r recorded under version %r "
                              "but this pass certifies %r — WITHHOLDING the coverage "
                              "receipt rather than certifying a window whose signals "
                              "a reader cannot see", sym, s.get("barTime"),
                              s.get("version"), want_version)
                    incomplete += 1

        # ── the coverage receipt ────────────────────────────────────────────
        # Written for a QUIET symbol too — that is the entire point. A symbol
        # with no signals and a receipt says "evaluated, nothing found"; a
        # symbol with no signals and no receipt says "never looked", and the
        # two must never be the same answer.
        window = evaluated_window(bars, include_last=fresh_last)
        if window is None:
            uncovered += 1
            log.warning("signature sweep: %s evaluated NO bar (%d bars, include_last=%s) "
                        "— no coverage receipt, because there is nothing to certify",
                        sym, len(bars), fresh_last)
        elif incomplete:
            uncovered += 1
            log.warning("signature sweep: %s had %d signal(s) the ledger did not accept "
                        "— WITHHOLDING its coverage receipt. Certifying this window "
                        "would tell a reader that the missing rows mean 'nothing "
                        "there'", sym, incomplete)
        else:
            try:
                ledger.record_coverage(_LEDGER_INDICATOR, want_version, sym, _LEDGER_TF,
                                       window[0], window[1], at=None)
                covered += 1
            except Exception:                          # noqa: BLE001
                log.exception("signature sweep: coverage receipt refused for %s "
                              "window=%r — this symbol stays UNCERTIFIED", sym, window)
                errors += 1
                uncovered += 1

    return {"symbols": len(symbols), "scanned": scanned, "recorded": recorded,
            "errors": errors, "stale": stale,
            "covered": covered, "uncovered": uncovered}


def sweep_job() -> None:
    """The scheduled entry (weekdays 20:05 ET). Never raises into the scheduler."""
    try:
        from api.routers.signature import _fetch_bars

        symbols = [s.strip().upper() for s in
                   os.environ.get("SIGNATURE_SWEEP_SYMBOLS", _DEFAULT_SYMBOLS).split(",")
                   if s.strip()]

        def fetch_flow(sym, cutoff_iso=""):
            return _fetch_flow_by_date(sym, cutoff_iso)

        res = run_sweep(symbols, fetch_bars=_fetch_bars, fetch_flow=fetch_flow,
                        now_iso=_sweep_date_iso())
        log.info("signature sweep done: %s", res)
    except Exception:                                  # noqa: BLE001
        log.exception("signature sweep job failed")
