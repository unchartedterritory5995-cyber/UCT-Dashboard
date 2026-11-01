"""UCT Agent program, agent-qa: fake-provider DataEnvelopes for every MD-1 v1 kind and every SC-1 kind.

This file is BOTH the fixture source and its rail. Consumers (agent-md, agent-sc, agent-rs, QA's own suites)
code against these envelopes instead of an unmerged producer branch (MD-1 §8).

  Server tests:
      from tests.test_uct_agent_qa_fixtures import load_fixture, cases_for, fake_registry, KINDS, CASES
      env = load_fixture("quote", "market-closed")
      gw._reset_for_test(fake_registry())                 # every kind registered, each answering its fixture
      gw._reset_for_test(fake_registry({"quotes": "partial"}))

  Browser tests:
      import { loadFixture, KINDS, CASES } from '../__fixtures__/program'

  Regenerate the JSON (it is DERIVED from this file; a rail fails if the two disagree):
      C:\\UCT\\agent\\.venv\\Scripts\\python.exe -m tests.test_uct_agent_qa_fixtures --write

THE CASES (not every case applies to every kind; `cases_for(kind)` says which):
  live           a live-declared kind, in session, within its freshness budget
  delayed        a live-declared kind on a known feed delay (`delay_s` set)
  periodic       a periodic kind, recomputed on its schedule, within budget
  historical     a completed past period (bars.daily's own class)
  stale          older than the kind's freshness budget: `stale: true`, with a note
  market-closed  read outside the session; a live kind answers `historical`, never `live` (MD-1 §3)
  unavailable    the source could not answer; no data, a note says why
  refused        the gateway would not read (here: the turn's read budget); no data
  partial        some symbols/rows missing, and `notes` (or `coverage`) say which
  no-source-time `as_of: null` with the note MD-1 requires (news.company with an empty window)

⚠ PER-KIND `data` SHAPES ARE PROVISIONAL. MD-1 §4 does not yet document each kind's `data` fields; the shapes
here are the smallest plausible ones and will be re-cut to agent-md's documented fields when they land. The
SC-1 `data` shapes (screen.run / screen.count / screen.saved) follow SC-1 §2 exactly. Everything else, the
envelope itself, follows MD-1 §3 exactly and passes `envelope.validate_envelope`.

Fixed clock (deterministic): the session read is Fri 2026-10-30 15:59 ET (EDT, UTC-4); the closed read is
Sat 2026-10-31. No fixture contains a secret, a URL, or a raw provider payload.
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path
from typing import Callable, Iterator, Optional, Union

import pytest

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw
# the producer's own note strings (#569) — imported, never retyped, so a wording change regenerates here
from api.services.uct_agent.marketdata import quotes as _quotes
from api.services.uct_agent.marketdata.quotes import FRESHNESS_BUDGET_S, NOTE_CLOSED, NOTE_EXTENDED, NOTE_SET_AS_OF
#: MD-1 v1.1 (#579): a regular-session read with no current trade, and the live read's set-as_of wording
from api.services.uct_agent.marketdata.quotes import EXTENDED_LIVE_S as _EXTENDED_LIVE_S, NOTE_NO_TRADES, NOTE_SET_AS_OF_LIVE

REPO = Path(__file__).resolve().parents[1]
FIXTURE_DIR = REPO / "app" / "src" / "agent" / "__fixtures__" / "program"
ENVELOPE_DIR = FIXTURE_DIR / "envelopes"
FIXTURE_VERSION = 1

CASES = ("live", "delayed", "periodic", "historical", "stale", "market-closed", "unavailable", "refused", "partial",
         "no-source-time", "extended-live", "extended-closed", "holiday", "no-current-trade", "no-matches")

# ── quote semantics, MD-1 v1.1 as agreed by agent-lead + agent-md for PR 1b (2026-11-01) ───────────
#: the quote kinds' extended-hours window: live only while the OLDEST vendor stamp is at most this old
EXTENDED_LIVE_S = _EXTENDED_LIVE_S
assert EXTENDED_LIVE_S == 15 * 60, "MD-1 v1.1 §4.1 says 15 minutes"
LAST_SOURCES = ("trade", "minute", "day_close", "prev_close")
_CURRENT_SOURCES = ("trade", "minute")
#: pinned by MD-1 v1.1 §4.1 (#579); the adapter builds it as an f-string, so it is restated here and the
#: real-adapter conformance check (PR 2) is what keeps the two identical
NOTE_NO_TRADE = "no current trade for {sym} — showing {source}"

# ── the fixed clock ──────────────────────────────────────────────────────────────────────────────
FETCH_SESSION = "2026-10-30T19:59:45Z"     # Fri 15:59:45 ET
FETCH_CLOSED = "2026-10-31T14:00:00Z"      # Sat 10:00 ET
AS_OF_LIVE = "2026-10-30T19:59:40Z"
AS_OF_DELAYED = "2026-10-30T19:44:40Z"     # 15 minutes behind
DELAY_S = 900
AS_OF_PERIODIC = "2026-10-30T19:45:00Z"    # the last scheduled recompute
AS_OF_LAST_CLOSE = "2026-10-30T20:00:00Z"  # Fri close
AS_OF_PRIOR_CLOSE = "2026-10-29T20:00:00Z" # Thu close: the last COMPLETED session while Fri is open
AS_OF_STALE = "2026-10-28T20:00:00Z"       # well past every budget

#: kind -> (declared freshness, category, owner, source, provider calls on a cache miss)
KINDS: dict[str, dict] = {
    "quote":           {"freshness": "live",       "category": "market", "owner": "agent-md", "source": "massive",        "calls": 1},
    "quotes":          {"freshness": "live",       "category": "market", "owner": "agent-md", "source": "massive",        "calls": 1},
    "bars.daily":      {"freshness": "historical", "category": "market", "owner": "agent-md", "source": "uct-bars",       "calls": 0},
    "bars.intraday":   {"freshness": "live",       "category": "market", "owner": "agent-md", "source": "massive",        "calls": 1},
    "fundamentals":    {"freshness": "periodic",   "category": "market", "owner": "agent-md", "source": "fmp",            "calls": 1},
    "earnings":        {"freshness": "periodic",   "category": "market", "owner": "agent-md", "source": "fmp",            "calls": 1},
    "news.company":    {"freshness": "periodic",   "category": "market", "owner": "agent-md", "source": "uct-news",       "calls": 0},
    "breadth.current": {"freshness": "periodic",   "category": "market", "owner": "agent-md", "source": "uct-breadth-v2", "calls": 0},
    "nhnl":            {"freshness": "periodic",   "category": "market", "owner": "agent-md", "source": "uct-nhnl",       "calls": 0},
    "themes":          {"freshness": "periodic",   "category": "market", "owner": "agent-md", "source": "uct-themes",     "calls": 0},
    "volume.surge":    {"freshness": "periodic",   "category": "market", "owner": "agent-md", "source": "uct-volume",     "calls": 0},
    "ratings":         {"freshness": "periodic",   "category": "market", "owner": "agent-md", "source": "uct-ratings",    "calls": 0},
    "screen.run":      {"freshness": "periodic",   "category": "scan",   "owner": "agent-sc", "source": "uct-screener",   "calls": 0},
    "screen.count":    {"freshness": "periodic",   "category": "scan",   "owner": "agent-sc", "source": "uct-screener",   "calls": 0},
    "screen.saved":    {"freshness": "periodic",   "category": "scan",   "owner": "agent-sc", "source": "uct-screener",   "calls": 0},
}

#: kinds that read many symbols or rows, and so can be honestly `partial`
_BULK = ("quotes", "news.company", "ratings", "screen.run", "screen.count")

_SPEC = {"filters": [{"key": "rs_rank", "op": ">=", "value": 90}, {"key": "adr_pct", "op": ">=", "value": 4}],
         "sort": "rs_rank", "limit": 50}


def _params(kind: str) -> dict:
    if kind in ("quotes", "ratings"):
        return {"symbols": ["NVDA", "AMD", "AVGO"]}
    if kind.startswith("screen.") and kind != "screen.saved":
        return {"spec": copy.deepcopy(_SPEC)}
    if kind == "screen.saved":
        return {}
    if kind in ("breadth.current", "nhnl", "themes", "volume.surge"):
        return {}
    return {"symbol": "NVDA"}


def _coverage(evaluated: int, answered: int, dropped: int = 0, not_computable: int = 0) -> dict:
    assert evaluated == answered + dropped + not_computable, "a fixture's coverage must close"
    return {"evaluated": evaluated, "answered": answered, "dropped": dropped, "not_computable": not_computable}


def _data(kind: str, case: str) -> Optional[dict]:
    """The kind's `data` for a readable case. Provisional for MD-1 kinds; SC-1 §2 for scan kinds."""
    partial = case == "partial"
    if kind == "bars.intraday":
        end = {"delayed": "2026-10-30T19:40:00Z", "market-closed": "2026-10-30T19:55:00Z"}.get(case, "2026-10-30T19:55:00Z")
        return {"symbol": "NVDA", "tf": "5", "bars": [{"t": end, "o": 206.6, "h": 207.2, "l": 206.4, "c": 207.0, "v": 1_840_000}]}
    if kind == "fundamentals":
        return {"symbol": "NVDA", "market_cap": 5_040_000_000_000, "pe_forward": 38.2, "revenue_ttm": 165_200_000_000, "eps_ttm": 3.51}
    if kind == "earnings":
        return {"symbol": "NVDA", "next": {"date": "2026-11-18", "session": "AMC"},
                "last": {"period": "2026 Q2", "eps_actual": 1.05, "eps_estimate": 1.01, "surprise_pct": 4.0}}
    if kind == "news.company":
        if case == "no-source-time":
            return {"symbol": "NVDA", "items": []}
        items = [{"headline": "Fixture headline one", "source_name": "fixture-wire", "as_of": "2026-10-30T19:30:00Z"},
                 {"headline": "Fixture headline two", "source_name": "fixture-wire", "as_of": "2026-10-30T17:05:00Z"}]
        return {"symbol": "NVDA", "items": items[:1] if partial else items}
    if kind == "breadth.current":
        return {"pct_above_50sma": 54.2, "pct_above_200sma": 61.7, "advancing": 1840, "declining": 1210}
    if kind == "nhnl":
        return {"new_highs": 212, "new_lows": 47, "net": 165}
    if kind == "themes":
        return {"period": "1d", "leaders": [{"theme": "Semiconductors", "pct": 2.1}],
                "laggards": [{"theme": "Homebuilders", "pct": -1.4}]}
    if kind == "volume.surge":
        return {"rows": [{"symbol": "NVDA", "vol_x": 2.4}, {"symbol": "AMD", "vol_x": 1.9}]}
    if kind == "ratings":
        rows = [{"symbol": "NVDA", "rating": 92, "percentile": 97},
                {"symbol": "AMD", "rating": 81, "percentile": 88},
                {"symbol": "AVGO", "rating": 87, "percentile": 93}]
        return {"ratings": rows[:2] if partial else rows, "missing": ["AVGO"] if partial else []}
    if kind == "screen.run":
        rows = [{"symbol": "NVDA", "rs_rank": 97, "adr_pct": 4.6}, {"symbol": "AVGO", "rs_rank": 93, "adr_pct": 4.1}]
        return {"spec": copy.deepcopy(_SPEC), "rows": rows, "total_matches": len(rows)}
    if kind == "screen.count":
        return {"spec": copy.deepcopy(_SPEC), "count": 2}
    if kind == "screen.saved":
        return {"screens": [{"id": "fx_saved_1", "name": "Fixture leaders", "spec": copy.deepcopy(_SPEC)}]}
    raise KeyError(kind)


def _scan_coverage(kind: str, case: str) -> Optional[dict]:
    if KINDS[kind]["category"] != "scan":
        return None
    if kind == "screen.saved":
        return _coverage(1, 1)
    if case == "partial":
        return _coverage(3700, 3540, dropped=40, not_computable=120)
    return _coverage(3700, 3700)


#: kinds whose fixtures mirror a merged producer on agent/int (field names, notes, coverage), not a guess
DOCUMENTED = ("quote", "quotes", "bars.daily", "screen.run", "screen.count", "screen.saved")


def cases_for(kind: str) -> tuple[str, ...]:
    declared = KINDS[kind]["freshness"]
    if kind in ("quote", "quotes"):
        out = ["live", "stale", "extended-live", "extended-closed", "market-closed", "holiday", "unavailable",
               "refused"] + (["partial", "no-current-trade"] if kind == "quotes" else [])
        return tuple(c for c in CASES if c in out)
    if kind == "bars.daily":
        return ("historical", "stale", "market-closed", "unavailable", "refused", "partial")
    if kind in ("screen.run", "screen.count"):
        return ("periodic", "stale", "market-closed", "unavailable", "refused", "partial", "no-matches")
    if kind == "screen.saved":
        return ("periodic", "market-closed", "unavailable", "refused", "partial")
    out = ["stale", "market-closed", "unavailable", "refused"]
    if declared == "live":
        out[:0] = ["live", "delayed"]
    elif declared == "periodic":
        out[:0] = ["periodic"]
    elif declared == "historical":
        out[:0] = ["historical"]
    if kind in _BULK:
        out.append("partial")
    if kind == "news.company":
        out.append("no-source-time")
    return tuple(c for c in CASES if c in out)


def default_case(kind: str) -> str:
    """The case a kind answers in the ordinary in-session read: its declared class."""
    return KINDS[kind]["freshness"]


#: (fetched_at, massive session label, base vendor stamp) per quote case
_QUOTE_CLOCK = {
    "live":            (FETCH_SESSION,          "regular",     "2026-10-30T19:59:38Z"),
    "stale":           (FETCH_SESSION,          "regular",     "2026-10-30T19:57:10Z"),   # oldest 155 s old
    "partial":         (FETCH_SESSION,          "regular",     "2026-10-30T19:59:38Z"),
    "no-current-trade": (FETCH_SESSION,         "regular",     "2026-10-30T19:59:38Z"),
    "extended-live":   ("2026-10-30T12:30:00Z", "extended",    "2026-10-30T12:26:05Z"),   # 08:30 ET, ≤15 min
    "extended-closed": ("2026-10-30T22:30:00Z", "extended",    "2026-10-30T21:50:00Z"),   # 18:30 ET, 40 min old
    "market-closed":   (FETCH_CLOSED,           "closed",      "2026-10-30T23:59:50Z"),   # Saturday
    "holiday":         ("2026-11-26T16:00:00Z", "closed",      "2026-11-25T23:59:50Z"),   # Thanksgiving 11:00 ET
}
_QUOTE_ROWS = (("NVDA", 207.04, 2.61, 1.28, 162_480_115, 204.43, 2),
               ("AMD", 256.12, -2.17, -0.84, 48_210_330, 258.29, 0),
               ("AVGO", 361.50, 1.51, 0.42, 21_905_442, 359.99, 4))


def _shift(iso: str, seconds: int) -> str:
    from datetime import datetime, timedelta
    return env.utc_iso(datetime.fromisoformat(iso.replace("Z", "+00:00")) + timedelta(seconds=seconds))


def _quote_row(spec: tuple, stamp: str, source: str = "trade") -> dict:
    sym, last, chg, pct, vol, prev, _ = spec
    return {"symbol": sym, "last": last if source != "prev_close" else prev, "change": chg, "change_pct": pct,
            "open": round(prev + 0.6, 2), "high": round(last + 1.1, 2), "low": round(prev - 0.9, 2),
            "day_close": last, "volume": vol, "prev_close": prev, "as_of": stamp, "last_source": source}


def _build_quote(kind: str, case: str) -> dict:
    """quote / quotes, mirroring #569's adapter and the MD-1 v1.1 quote rules (a)–(e)."""
    params = _params(kind) if kind == "quotes" else {"symbol": "NVDA"}
    fetched, label, base = _QUOTE_CLOCK[case]
    specs = _QUOTE_ROWS if kind == "quotes" else _QUOTE_ROWS[:1]
    rows = [_quote_row(s, _shift(base, s[6])) for s in specs]
    notes: list[str] = []
    status, missing = "ok", []
    if case == "partial":
        rows, missing, status = rows[:2], ["AVGO"], "partial"
    if case == "no-current-trade":
        # AVGO has no current print: the row shows the previous close and its stamp leaves the as_of min
        rows[2] = _quote_row(_QUOTE_ROWS[2], "2026-10-29T20:00:00Z", "prev_close")
        status = "partial"
    current = [r["as_of"] for r in rows if r["last_source"] in _CURRENT_SOURCES]
    freshness = "live" if case in ("live", "stale", "partial", "no-current-trade", "extended-live") else "historical"
    as_of = min(current) if (freshness == "live" and current) else min(r["as_of"] for r in rows)
    if freshness == "historical":
        notes.append(NOTE_CLOSED)
    if case == "extended-live":
        notes.append(NOTE_EXTENDED)
    for r in rows:                                     # the adapter's order: per-row notes, then the set note
        if freshness == "live" and r["last_source"] not in _CURRENT_SOURCES:
            notes.append(NOTE_NO_TRADE.format(sym=r["symbol"], source=r["last_source"]))
    if kind == "quotes" and len(rows) > 1:
        notes.append(NOTE_SET_AS_OF_LIVE if freshness == "live" else NOTE_SET_AS_OF)
    if missing:
        notes.append("no quote for: " + ", ".join(missing))
    n = len(specs)
    coverage = {"evaluated": n, "answered": len(rows), "dropped": len(missing), "not_computable": 0}
    data = ({"quote": rows[0]} if kind == "quote" else {"quotes": rows})
    data["session"] = label
    e = env.make_envelope(kind, params, status=status, freshness=freshness, as_of=as_of, source="massive", data=data,
                          stale=(case == "stale"), coverage=coverage, notes=notes, provider_calls=1)
    e["fetched_at"] = fetched
    return e


def _build_bars_daily(case: str) -> dict:
    """bars.daily, mirroring #576's adapter: completed sessions only, provider_calls 0, as_of = the newest bar's close."""
    from api.services.uct_agent.marketdata.bars_daily import NOTE_COMPLETED
    asked = 3
    params = {"symbol": "NVDA", "bars": asked}
    fetched, latest = {"market-closed": (FETCH_CLOSED, "2026-10-30")}.get(case, (FETCH_SESSION, "2026-10-29"))
    days = {"historical": ["2026-10-27", "2026-10-28", "2026-10-29"],
            "market-closed": ["2026-10-28", "2026-10-29", "2026-10-30"],
            "stale": ["2026-10-23", "2026-10-26", "2026-10-27"],
            "partial": ["2026-10-28", "2026-10-29"]}[case]
    bars = [{"date": d, "open": 200.0 + i, "high": 204.0 + i, "low": 198.5 + i, "close": 202.5 + i,
             "volume": 150_000_000 + i * 1_000_000} for i, d in enumerate(days)]
    notes = [NOTE_COMPLETED]
    stale = days[-1] < latest
    if stale:
        notes.append(f"the newest bar held is {days[-1]}; the newest completed session is {latest}")
    if len(bars) < asked:
        notes.append(f"{len(bars)} of {asked} requested bars are held")
    e = env.make_envelope("bars.daily", params, status="ok" if len(bars) >= asked else "partial",
                          freshness="historical", as_of=f"{days[-1]}T20:00:00Z", source="uct-bars",
                          data={"symbol": "NVDA", "bars": bars, "through": days[-1], "latest_completed_session": latest},
                          stale=stale, notes=notes, provider_calls=0)
    e["fetched_at"] = fetched
    return e


def _build_scan(kind: str, case: str) -> dict:
    """screen.run / screen.count / screen.saved, mirroring the merged #570/#578 adapters (SC-1 §2a/§2b)."""
    fetched = FETCH_CLOSED if case == "market-closed" else FETCH_SESSION
    if kind == "screen.saved":
        spec = copy.deepcopy(_SPEC)
        screens = [{"id": 101, "name": "Fixture leaders", "spec": spec, "runnable": True}]
        notes = []
        if case == "partial":
            screens.append({"id": 102, "name": "Fixture indicator screen", "spec": {"filters": []}, "runnable": False,
                            "reason": "this screen uses an indicator condition the Agent cannot run yet"})
            notes.append("1 of your screens can't be run by the Agent yet; each says why.")
        n, ok = len(screens), sum(1 for x in screens if x["runnable"])
        e = env.make_envelope(kind, {}, status="ok" if n == ok else "partial", freshness="periodic",
                              as_of="2026-10-28T14:12:09Z", source="uct-screener", data={"screens": screens},
                              coverage=_coverage(n, ok, not_computable=n - ok), notes=notes, provider_calls=0)
        e["fetched_at"] = fetched
        return e
    params = {"spec": copy.deepcopy(_SPEC)}
    day = {"stale": "2026-10-27", "market-closed": "2026-10-30"}.get(case, "2026-10-29")
    stale = case == "stale"
    notes = [("No names matched. Screener snapshot as of the " if case == "no-matches" else
              "Screener snapshot — values as of the ") + f"{day} close (nightly), not live."]
    if stale:
        notes.append("This snapshot is 2 sessions behind the last close.")
    rows = [{"symbol": "NVDA", "rs_rank": 97, "adr_pct": 4.6}, {"symbol": "AVGO", "rs_rank": 93, "adr_pct": 4.1}]
    excluded, cov = [], _coverage(3700, 3700)
    if case == "no-matches":
        rows = []
    if case == "partial":
        cov = _coverage(3700, 3540, dropped=40, not_computable=120)
        excluded = [{"symbol": "ZZZQ", "reason": "stopped_bars", "detail": "price history ends 2026-09-01"}]
        notes += ["40 names were excluded because their own price history stopped.",
                  "120 names could not be decided: a value this screen needs is missing."]
    origin = {"source": "spec"}
    if kind == "screen.run":
        data = {"spec": params["spec"], "rows": rows, "total_matches": len(rows), "fields": ["rs_rank", "adr_pct"],
                "excluded": excluded, "origin": origin}
    else:
        data = {"spec": params["spec"], "count": len(rows), "excluded": excluded, "origin": origin}
    e = env.make_envelope(kind, params, status="partial" if case == "partial" else "ok", freshness="periodic",
                          as_of=f"{day}T20:00:00Z", source="uct-screener", data=data, stale=stale, coverage=cov,
                          notes=notes, provider_calls=0)
    e["fetched_at"] = fetched
    return e


def _build(kind: str, case: str) -> dict:
    meta = KINDS[kind]
    if KINDS[kind]["category"] == "scan" and case not in ("refused", "unavailable"):
        return _build_scan(kind, case)
    params = _params(kind)
    if kind in ("quote", "quotes") and case not in ("refused", "unavailable"):
        return _build_quote(kind, case)
    if kind == "bars.daily" and case not in ("refused", "unavailable"):
        return _build_bars_daily(case)
    if kind == "bars.daily":
        params = {"symbol": "NVDA", "bars": 3}
    source, calls, declared = meta["source"], meta["calls"], meta["freshness"]
    if case == "refused":
        e = env.refused(kind, params, f"this turn already made {gw.MAX_READS_PER_TURN} data reads")
        e["fetched_at"] = FETCH_SESSION
        return e
    if case == "unavailable":
        why = {"quote": "the quote provider could not answer", "quotes": "the quote provider could not answer",
               "bars.daily": "no completed daily bars are held for NVDA"}.get(kind, "the data source could not answer")
        e = env.unavailable(kind, params, source, why, provider_calls=calls)
        e["fetched_at"] = FETCH_SESSION
        return e
    kw: dict = {"status": "ok", "source": source, "data": _data(kind, case), "coverage": _scan_coverage(kind, case),
                "provider_calls": calls}
    fetched = FETCH_SESSION
    if case == "live":
        kw.update(freshness="live", as_of=AS_OF_LIVE)
    elif case == "delayed":
        kw.update(freshness="delayed", as_of=AS_OF_DELAYED, delay_s=DELAY_S,
                  notes=["delayed about 15 minutes; not live"])
    elif case == "periodic":
        kw.update(freshness="periodic", as_of=AS_OF_PERIODIC)
    elif case == "historical":
        kw.update(freshness="historical", as_of=AS_OF_PRIOR_CLOSE,
                  notes=["last completed session; today's partial bar is not included"])
    elif case == "stale":
        kw.update(freshness=declared, as_of=AS_OF_STALE, stale=True, provider_calls=0,
                  notes=["older than this kind's freshness budget; say how old"])
        if declared == "delayed":
            kw["delay_s"] = DELAY_S
    elif case == "market-closed":
        fetched = FETCH_CLOSED
        closed_class = "historical" if declared in ("live", "delayed", "historical") else declared
        kw.update(freshness=closed_class, as_of=AS_OF_LAST_CLOSE, notes=["market closed — last session's close"])
    elif case == "partial":
        kw.update(status="partial", freshness=declared, as_of=AS_OF_LIVE if declared == "live" else AS_OF_PERIODIC)
        if KINDS[kind]["category"] == "scan":
            kw["notes"] = ["40 symbols dropped and 120 not computable; see coverage"]
        elif kind == "news.company":
            kw["notes"] = ["one news feed did not answer; items may be incomplete"]
        else:
            kw["notes"] = ["no data for AVGO"]
    elif case == "no-source-time":
        kw.update(freshness=declared, as_of=None, notes=["no items in the window, so there is no source time"])
    else:
        raise ValueError(f"case {case!r} does not apply to {kind!r}")
    if kind == "news.company" and kw["data"]["items"]:
        # each item carries its own time; the envelope as_of is the newest item (MD-1 §4)
        if case == "stale":
            for i in kw["data"]["items"]:
                i["as_of"] = AS_OF_STALE
        kw["as_of"] = max(i["as_of"] for i in kw["data"]["items"])
    e = env.make_envelope(kind, params, **kw)
    e["fetched_at"] = fetched
    return e


def build_fixtures() -> dict[str, str]:
    """relative path -> file text. The single authority for every file under FIXTURE_DIR it names."""
    files: dict[str, str] = {}
    index = {"version": FIXTURE_VERSION, "contracts": {"md": env.CONTRACT, "sc": "SC-1.0"}, "cases": list(CASES),
             "kinds": {}}
    for kind in KINDS:
        cases = cases_for(kind)
        meta = KINDS[kind]
        index["kinds"][kind] = {"declared_freshness": meta["freshness"], "category": meta["category"],
                                "owner": meta["owner"], "default_case": default_case(kind), "cases": list(cases),
                                "file": f"envelopes/{kind}.json"}
        body = {"kind": kind, "declared_freshness": meta["freshness"], "category": meta["category"],
                "cases": {c: _build(kind, c) for c in cases}}
        files[f"envelopes/{kind}.json"] = json.dumps(body, indent=2, ensure_ascii=False) + "\n"
    files["index.json"] = json.dumps(index, indent=2, ensure_ascii=False) + "\n"
    return files


def write_fixtures() -> list[str]:
    written = []
    for rel, text in build_fixtures().items():
        p = FIXTURE_DIR / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        written.append(rel)
    return written


# ── the loader ───────────────────────────────────────────────────────────────────────────────────
_CACHE: dict[str, dict] = {}


def _file(kind: str) -> dict:
    if kind not in KINDS:
        raise KeyError(f"no fixtures for kind {kind!r}")
    if kind not in _CACHE:
        with open(ENVELOPE_DIR / f"{kind}.json", encoding="utf-8") as fh:
            _CACHE[kind] = json.load(fh)
    return _CACHE[kind]


def load_fixture(kind: str, case: Optional[str] = None) -> dict:
    """A deep copy of one fixture envelope (mutate freely). `case` defaults to the kind's declared class."""
    case = case or default_case(kind)
    cases = _file(kind)["cases"]
    if case not in cases:
        raise KeyError(f"kind {kind!r} has no {case!r} fixture; it has {sorted(cases)}")
    return copy.deepcopy(cases[case])


def all_fixtures() -> Iterator[tuple[str, str, dict]]:
    for kind in KINDS:
        for case in cases_for(kind):
            yield kind, case, load_fixture(kind, case)


Answer = Union[str, Callable[[dict, dict], dict]]


def fake_kind(kind: str, answer: Optional[Answer] = None) -> gw.Kind:
    """A gateway Kind with the contract's declared freshness/category, answering a fixture case (or a callable)."""
    meta = KINDS[kind]
    if callable(answer):
        fn = answer
    else:
        case = answer or default_case(kind)
        load_fixture(kind, case)  # fail now on a typo, not inside a read

        def fn(params, ctx, _k=kind, _c=case):  # noqa: ARG001
            return load_fixture(_k, _c)
    return gw.Kind(name=kind, fn=fn, freshness=meta["freshness"], category=meta["category"], owner=meta["owner"],
                   description=f"agent-qa fixture ({kind})")


def fake_registry(answers: Optional[dict[str, Answer]] = None, kinds: Optional[list[str]] = None) -> gw.Registry:
    """Every fixture kind (or `kinds`) registered; `answers` overrides a kind's case or gives a callable."""
    answers = answers or {}
    r = gw.Registry()
    for k in kinds or KINDS:
        r.register(fake_kind(k, answers.get(k)))
    return r


# ── the rail ─────────────────────────────────────────────────────────────────────────────────────
_ALL = [(k, c) for k in KINDS for c in cases_for(k)]


def test_the_files_on_disk_are_exactly_what_this_module_generates():
    want = build_fixtures()
    assert want, "the generator produced nothing"           # non-vacuity
    on_disk = sorted(p.relative_to(FIXTURE_DIR).as_posix() for p in FIXTURE_DIR.rglob("*.json"))
    assert on_disk == sorted(want), "a fixture JSON exists that this module does not generate, or one is missing"
    # line endings are normalised: git stores LF, and autocrlf checks these out as CRLF on Windows
    stale = [rel for rel, text in want.items()
             if (FIXTURE_DIR / rel).read_bytes().replace(b"\r\n", b"\n") != text.encode("utf-8")]
    assert not stale, f"regenerate with `python -m tests.test_uct_agent_qa_fixtures --write`: {stale}"


def test_every_contract_kind_has_fixtures_and_the_cases_the_brief_requires():
    md_v1 = {"quote", "quotes", "bars.daily", "bars.intraday", "fundamentals", "earnings", "news.company",
             "breadth.current", "nhnl", "themes", "volume.surge", "ratings"}
    sc_1 = {"screen.run", "screen.count", "screen.saved"}
    assert set(KINDS) == md_v1 | sc_1
    covered = {c for _, c in _ALL}
    assert covered == set(CASES), f"no kind exercises {set(CASES) - covered}"
    for k in KINDS:
        # screen.saved lists the member's own definitions: it has no freshness budget, so no stale case
        need = {"market-closed", "unavailable", "refused"} | (set() if k == "screen.saved" else {"stale"})
        assert need <= set(cases_for(k)), k


@pytest.mark.parametrize("kind,case", _ALL)
def test_every_fixture_passes_validate_envelope(kind, case):
    e = load_fixture(kind, case)
    assert env.validate_envelope(e) == []
    assert e["kind"] == kind


@pytest.mark.parametrize("kind,case", _ALL)
def test_no_fixture_claims_a_fresher_class_than_its_kind_declares(kind, case):
    e = load_fixture(kind, case)
    if e["status"] in ("ok", "partial"):
        assert env.FRESHNESS.index(e["freshness"]) >= env.FRESHNESS.index(KINDS[kind]["freshness"])


def test_case_semantics():
    for kind, case in _ALL:
        e = load_fixture(kind, case)
        if case == "delayed":
            assert e["freshness"] == "delayed" and e["delay_s"] == DELAY_S
        if case == "stale":
            assert e["stale"] is True
        if case in ("market-closed", "holiday"):
            assert e["freshness"] != "live", (kind, case)
            assert e["notes"] or kind == "screen.saved", (kind, case)   # a definition list needs no session note
        if case in ("unavailable", "refused"):
            assert e["status"] == case and e["data"] is None and e["freshness"] == "unavailable"
        if case == "partial":
            assert e["status"] == "partial" and (e["notes"] or e["coverage"])
        if case == "no-source-time":
            assert e["as_of"] is None and e["notes"]
        if e["status"] in ("ok", "partial") and case != "stale":
            assert e["stale"] is False


def test_scan_fixtures_carry_closing_coverage_and_sc1_data():
    for kind in ("screen.run", "screen.count", "screen.saved"):
        for case in cases_for(kind):
            e = load_fixture(kind, case)
            if e["status"] not in ("ok", "partial"):
                continue
            c = e["coverage"]
            assert set(c) == {"evaluated", "answered", "dropped", "not_computable"}, (kind, case)
            assert c["evaluated"] == c["answered"] + c["dropped"] + c["not_computable"], (kind, case)
    run = load_fixture("screen.run")["data"]
    assert set(run) == {"spec", "rows", "total_matches", "fields", "excluded", "origin"} and len(run["rows"]) <= 50
    assert set(load_fixture("screen.count")["data"]) == {"spec", "count", "excluded", "origin"}
    assert set(load_fixture("screen.saved")["data"]["screens"][0]) == {"id", "name", "spec", "runnable"}
    for kind in ("screen.run", "screen.count"):                 # F-4 regression: zero matches stay dated, not stale
        z = load_fixture(kind, "no-matches")
        assert z["status"] == "ok" and z["as_of"] and z["stale"] is False and z["notes"][0].startswith("No names matched")


def test_a_fixture_never_carries_a_secret_a_url_or_a_raw_payload():
    text = "".join(build_fixtures().values()).lower()
    for needle in ("apikey", "api_key", "secret", "token", "bearer", "password", "http://", "https://", "raw"):
        assert needle not in text, needle


def test_load_fixture_returns_a_copy():
    a = load_fixture("quote")
    a["data"]["quote"]["last"] = -1
    assert load_fixture("quote")["data"]["quote"]["last"] == 207.04


# ── quote semantics, MD-1 v1.1 (a)–(e): a predicate QA's conformance suite also runs against the real adapter ──
def _t(iso: str) -> float:
    from datetime import datetime
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def quote_semantics_errors(e: dict) -> list[str]:
    """Violations of the agreed quote rules (empty = conforms). Reads only the envelope: the vendor stamps,
    massive's session label and `fetched_at` — never the producer's code."""
    if e.get("kind") not in ("quote", "quotes") or e.get("status") not in ("ok", "partial"):
        return []
    errs: list[str] = []
    d = e["data"] or {}
    rows = [d["quote"]] if "quote" in d else list(d.get("quotes") or [])
    label = {"pre_market": "extended", "post_market": "extended"}.get(d.get("session"), d.get("session"))
    notes = e["notes"]
    closed, extended = NOTE_CLOSED in notes, NOTE_EXTENDED in notes
    no_trades = NOTE_NO_TRADES is not None and NOTE_NO_TRADES in notes
    if closed and extended:
        errs.append("both the closed and the extended-hours notes (rule b)")
    for r in rows:                                                       # (d)
        if r.get("last_source") not in LAST_SOURCES:
            errs.append(f"{r.get('symbol')}: last_source {r.get('last_source')!r}")
    current = [r for r in rows if r.get("last_source") in _CURRENT_SOURCES]
    if e["freshness"] == "live":
        if closed:
            errs.append("a live read carries the closed note")
        for r in rows:
            if r.get("last_source") in ("day_close", "prev_close"):
                if e["status"] != "partial":
                    errs.append(f"{r['symbol']} shows {r['last_source']} in a live read that is not partial (rule d)")
                if not any(n.startswith(f"no current trade for {r['symbol']}") for n in notes):
                    errs.append(f"no 'no current trade for {r['symbol']}' note (rule d)")
        stamps = [r["as_of"] for r in current if r.get("as_of")]
        if stamps and e["as_of"] != min(stamps):                         # (e), current rows only
            errs.append(f"as_of {e['as_of']} is not the oldest current stamp {min(stamps)} (rule e)")
        if stamps:
            age = _t(e["fetched_at"]) - _t(min(stamps))
            if label == "regular":                                       # (a)
                if extended:
                    errs.append("a regular-session read carries the extended-hours note")
                if e["stale"] != (age > FRESHNESS_BUDGET_S):
                    errs.append(f"stale={e['stale']} but the oldest vendor stamp is {age:.0f}s old (rule a)")
            elif label == "extended":                                    # (b)
                if age > EXTENDED_LIVE_S:
                    errs.append(f"live in extended hours with a {age:.0f}s-old stamp (rule b: at most {EXTENDED_LIVE_S}s)")
                if not extended:
                    errs.append("a live extended-hours read without the extended-hours note (rule b)")
    elif e["freshness"] == "historical":                                 # (b) late extended, (c) closed
        if not (closed or (no_trades and label == "regular")):
            errs.append("a historical quote read without the closed note (rule c)")
        if closed and no_trades:
            errs.append("both the closed and the no-trades notes")
        if extended:
            errs.append("a historical quote read carries the extended-hours note")
        if e["as_of"] is None:
            errs.append("a closed read gives no real as_of (rule c)")
        stamps = [r["as_of"] for r in rows if r.get("as_of")]
        if stamps and e["as_of"] != min(stamps):
            errs.append(f"as_of {e['as_of']} is not the oldest stamp {min(stamps)} (rule e)")
    else:
        errs.append(f"a quote read classed {e['freshness']!r}")
    return errs


@pytest.mark.parametrize("kind,case", [(k, c) for k, c in _ALL if k in ("quote", "quotes")])
def test_quote_fixtures_obey_the_v1_1_quote_rules(kind, case):
    e = load_fixture(kind, case)
    assert quote_semantics_errors(e) == []
    if case in ("extended-live", "extended-closed", "market-closed", "holiday"):
        assert (NOTE_CLOSED in e["notes"]) != (NOTE_EXTENDED in e["notes"]), "exactly one session note"
    if case == "extended-live":
        assert e["freshness"] == "live" and e["data"]["session"] == "extended"
    if case in ("extended-closed", "market-closed", "holiday"):
        assert e["freshness"] == "historical"


def test_the_quote_predicate_can_fail():
    """Controls: each rule's violation is SEEN (a predicate that answers [] to everything is not a rail)."""
    live = load_fixture("quotes", "live")
    stale_but_claims_fresh = load_fixture("quotes", "stale"); stale_but_claims_fresh["stale"] = False
    both_notes = load_fixture("quote", "market-closed"); both_notes["notes"].append(NOTE_EXTENDED)
    old_ext = load_fixture("quote", "extended-live"); old_ext["fetched_at"] = _shift(old_ext["fetched_at"], 3600)
    no_trade_ok = load_fixture("quotes", "no-current-trade"); no_trade_ok["status"] = "ok"
    bad_min = load_fixture("quotes", "no-current-trade"); bad_min["as_of"] = "2026-10-29T20:00:00Z"
    bad_src = copy.deepcopy(live); bad_src["data"]["quotes"][0]["last_source"] = "guess"
    for name, e in [("a", stale_but_claims_fresh), ("b-both", both_notes), ("b-age", old_ext), ("d", no_trade_ok),
                    ("e", bad_min), ("d-src", bad_src)]:
        assert quote_semantics_errors(e), name
    assert quote_semantics_errors(live) == []


def test_bars_daily_fixtures_mirror_the_merged_adapter():
    from api.services.uct_agent.marketdata.bars_daily import NOTE_COMPLETED
    for case in cases_for("bars.daily"):
        e = load_fixture("bars.daily", case)
        if e["status"] not in ("ok", "partial"):
            continue
        d = e["data"]
        assert set(d) == {"symbol", "bars", "through", "latest_completed_session"}
        assert set(d["bars"][0]) == {"date", "open", "high", "low", "close", "volume"}
        assert e["freshness"] == "historical" and e["provider_calls"] == 0 and NOTE_COMPLETED in e["notes"]
        assert e["as_of"] == f"{d['through']}T20:00:00Z" and d["through"] == d["bars"][-1]["date"]
        assert e["stale"] == (d["through"] < d["latest_completed_session"])


def test_the_fake_registry_round_trips_through_the_real_gateway(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.SCAN_ENV, "1")
    try:
        gw._reset_for_test(fake_registry())
        assert gw.registry().names() == sorted(KINDS)
        for kind in KINDS:
            out = gw.read(kind, _params(kind), user_id=1, turn_id=f"qa-{kind}")
            want = load_fixture(kind)
            assert out == want, kind   # the gateway passed it through unchanged: it conforms
        gw._reset_for_test(fake_registry({"quote": "market-closed"}, kinds=["quote"]))
        out = gw.read("quote", {"symbol": "NVDA"}, user_id=1, turn_id="qa-closed")
        assert out["freshness"] == "historical" and out["status"] == "ok"
    finally:
        gw._reset_for_test(None)


def test_fake_kind_rejects_an_unknown_case():
    with pytest.raises(KeyError):
        fake_kind("quote", "periodic")     # a live kind has no periodic fixture


if __name__ == "__main__":
    if "--write" in sys.argv:
        for rel in write_fixtures():
            print(rel)
    else:
        print("usage: python -m tests.test_uct_agent_qa_fixtures --write")
