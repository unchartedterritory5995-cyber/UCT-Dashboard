"""Earnings beats, insider buys and fund adds for the Screener: five columns, each read ONCE per nightly build from a
store this server already holds. Never a vendor call, never the SEC, never a store's own build.

THREE READERS, ONE PER STORE (each a `snapshot_builder._read_market_source` peer, so a dead store costs only its own
columns, counted by name). Every value is as known at the build's session (the last completed session before the
build), and an absent key leaves the row's column NULL: never a guessed 0.

  eps_surprise_last, eps_beat_streak   `read_earnings_fields`: the held copy of each stock's earnings results (the
      Research Earnings tab's model, `earnings_intel`, FMP then Finnhub consensus), read by ERNSC's one-connection read
      (`sector_earnings.held_copies`: the copy in memory, else the one on disk at most the model's 45 days old). Only
      reported quarters with a report date on or before the session count (no look-ahead), newest fiscal quarter first.
        eps_surprise_last  the newest such quarter's EPS surprise in percent, the copy's own figure ((actual -
                           consensus) / |consensus|, on a consensus-comparable basis); None when the copy holds no
                           comparable consensus for it, or the consensus is under 5 cents (the copy then gives only the
                           difference in dollars).
        eps_beat_streak    how many reported quarters in a row, from the newest back, beat the EPS consensus, by
                           ERNSC's own rule (`sector_earnings_calc.reporter_row` / `classify`: a surprise above 0.5%,
                           or above half a cent when the consensus is under 5 cents; within that band is in line). The
                           count stops at the first quarter that did not beat, has no comparable consensus, or is not
                           the fiscal quarter right before the last one counted; at most the 12 quarters the copy
                           holds. None when the newest quarter has no comparable consensus.
      Both are None while the copy is behind: its own next report date has passed (on or before the session) with no
      result for it in the copy. The copy is refreshed by the panel prewarm and by a member's view.
  insider_buys_30d, insider_buy_value_30d   `read_insider_fields`: INS CLUSTER's store of SEC Form 4 open-market
      purchases (`insider_clusters_sec.held_purchases`: transaction code P, acquired; purchases only, no sales).
        insider_buys_30d       Form 4 filings with at least one open-market purchase, FILED in the 30 calendar days
                               ending on the session, matched by the trading symbol the filing names. 0 is a real
                               count: the store reads every Form 4 in EDGAR's daily index.
        insider_buy_value_30d  the dollars of those purchases that state a price; a purchase with no price is counted
                               in insider_buys_30d and never valued at $0. None when no purchase in the window states a
                               price (also when there was none).
      Both are None for every stock while the store is not held, while it does not yet reach back over the whole window
      (it keeps `insider_clusters_sec.KEEP_DAYS` calendar days counted from its own nightly read, so it is short for
      its first weeks, and can be for a build the morning after a market holiday), or while its newest read filing day
      is more than `fund_trends.MAX_LAG_SESSIONS` sessions behind the session.
  fund_net_adds   `read_fund_fields`: the Funds (N-PORT) index (`fund_holders_nport`), its per-stock summary over every
      matched fund, read through GRPS CROWDING's one read (`group_positioning.read_nport`) and its rule
      (`group_positioning.fund_figures`): funds that added or opened a position less funds that cut or sold out, between
      each fund's two most recent reports, the earlier report's shares put in post-split terms. None when the index is not
      built, the stock is not in it, no fund's change is known, or any fund's change is not comparable (a split between
      its reports that could not be checked).

COST (measured 2026-11-23 on invented stores, 11,000 targets, the dev PC shared with other work, under tracemalloc, not
production; `snapshot_builder`'s receipt `stats["beats_insiders_funds"]` carries each read's seconds on the pod):
earnings, 3,500 held copies of about 15 KB, 6.5 s of CPU (one small SELECT per symbol, one parse per copy; ERNSC
measured the same read at 2.0 s without tracemalloc), peak 2.0 MB, 1.4 MB held after; insider, 2,500 invented purchase
filings, 0.1 s, peak 4.4 MB, 3.2 MB held (a count for every target); funds, an index of 11,000 summaries, 1.8 s, peak
11.5 MB, 2.8 MB held. The reads run one after another, so the added peak stays well under 30 MB.
"""
from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Optional

#: snapshot columns, in the order the view shows them
EARNINGS_COLUMNS = ("eps_surprise_last", "eps_beat_streak")
INSIDER_COLUMNS = ("insider_buys_30d", "insider_buy_value_30d")
FUND_COLUMNS = ("fund_net_adds",)
COLUMNS = EARNINGS_COLUMNS + INSIDER_COLUMNS + FUND_COLUMNS
#: the whole-number columns (the other two are REAL)
INT_COLUMNS = ("eps_beat_streak", "insider_buys_30d", "fund_net_adds")
#: the insider window, calendar days ending on the session (the column's name)
INSIDER_DAYS = 30
#: the store day states that mean "its index was read"
_READ_STATES = ("complete", "partial")


def _finite(v) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    v = float(v)
    return v if math.isfinite(v) else None


def _iso(v) -> Optional[str]:
    s = str(v or "")[:10]
    try:
        return date.fromisoformat(s).isoformat() if len(s) == 10 else None
    except ValueError:
        return None


def _key(sym) -> str:
    """One spelling for matching: upper case, a share class after a hyphen (the universe's spelling)."""
    return str(sym or "").strip().upper().replace(".", "-")


def _note(failures, label: str, outcome: str, n: int = 1) -> None:
    if failures is None:
        return
    failures.setdefault(label, {})
    failures[label][outcome] = failures[label].get(outcome, 0) + n


def _done(receipt: Optional[dict], said: dict, state: str, out: dict) -> dict:
    said["state"] = state
    if receipt is not None:
        receipt.clear()
        receipt.update(said)
    return out


# ── earnings: one stock (pure) ───────────────────────────────────────────────────────────────

def _fiscal(q: dict) -> Optional[tuple]:
    fy, fq = q.get("fiscal_year"), q.get("fiscal_quarter")
    if type(fy) is not int or type(fq) is not int or not 1 <= fq <= 4:
        return None
    return fy, fq


def stock_earnings(payload: dict, session: str) -> tuple[dict, str]:
    """`({column: value}, state)` for one held copy as known at `session` (YYYY-MM-DD). state: 'ok' | 'no_report'
    (no dated reported quarter on or before the session) | 'awaiting' (the copy's next report date has passed with no
    result in it)."""
    from api.services import earnings_intel as EI                  # noqa: PLC0415 -- lazy, like held_copies
    from api.services import sector_earnings_calc as EC            # noqa: PLC0415
    dated = []
    for q in payload.get("quarters") or ():
        if not isinstance(q, dict) or q.get("reported") is not True:
            continue
        day, key = _iso(q.get("report_date")), _fiscal(q)
        if day and key and day <= session:
            dated.append((key, day, q))
    if not dated:
        return {}, "no_report"
    dated.sort(key=lambda x: x[0], reverse=True)                   # the newest fiscal quarter first
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    nxt = _iso(payload.get("next_report_date") or summary.get("next_report_date"))
    if nxt and dated[0][1] < nxt <= session:
        return {}, "awaiting"
    rows = [EC.reporter_row("", q, {}, None, lambda _d: False) for _k, _d, q in dated]
    out: dict = {}
    if rows[0][EC.EPS_PCT] is not None:
        out["eps_surprise_last"] = rows[0][EC.EPS_PCT]
    if rows[0][EC.EPS_STATE] != "none":
        streak, prev = 0, None
        for (key, _d, _q), r in zip(dated, rows):
            if r[EC.EPS_STATE] != "beat" or (prev is not None and key != EI._prev_fiscal(*prev)):
                break
            streak, prev = streak + 1, key
        out["eps_beat_streak"] = streak
    return out, "ok"


def read_earnings_fields(targets, failures=None, *, session: Optional[date] = None,
                         receipt: Optional[dict] = None) -> dict:
    """{TICKER: {eps_surprise_last?, eps_beat_streak?}}: ONE pass over the held copies (`held_copies`, one store
    connection). `receipt` (filled when a dict is passed): state ('served' | 'no_session'), session, how many
    copies were held, not held, behind ('awaiting'), with no dated report, and matched."""
    said = {"state": None, "session": session.isoformat() if session else None, "targets": len(targets or ()),
            "held": 0, "not_held": 0, "awaiting": 0, "no_report": 0, "matched": 0}
    if session is None:
        return _done(receipt, said, "no_session", {})
    from api.services import sector_earnings as SE                 # noqa: PLC0415 -- lazy: the build's one read
    iso = session.isoformat()
    out = {}
    for sym, payload in SE.held_copies([str(t).upper() for t in targets or ()]):
        if not isinstance(payload, dict):
            said["not_held"] += 1
            continue
        said["held"] += 1
        vals, state = stock_earnings(payload, iso)
        if state != "ok":
            said[state] += 1
        elif vals:
            out[str(sym).upper()] = vals
        del payload
    said["matched"] = len(out)
    if said["awaiting"]:
        _note(failures, "earnings_beats", "awaiting", said["awaiting"])
    return _done(receipt, said, "served", out)


# ── insider buys ─────────────────────────────────────────────────────────────────────────────

def _first_weekday(d: date) -> date:
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def insider_counts(purchases, targets, lo: str, hi: str) -> tuple[dict, int]:
    """Pure: `({TICKER: {insider_buys_30d, insider_buy_value_30d?}} for EVERY target, unmatched)` over the filings
    filed from `lo` to `hi` (YYYY-MM-DD, inclusive)."""
    want = {_key(t): str(t).upper() for t in targets or ()}
    tally: dict = {}
    unmatched = 0
    for p in purchases or ():
        if not isinstance(p, dict):
            continue
        filed = _iso(p.get("filed"))
        if not filed or not lo <= filed <= hi:
            continue
        t = want.get(_key(p.get("ticker")))
        if t is None:
            unmatched += 1
            continue
        n, value, priced = tally.get(t, (0, 0.0, 0))
        v = _finite(p.get("value"))
        tally[t] = (n + 1, value + (v if v is not None else 0.0), priced + (v is not None))
    out = {}
    for t in want.values():
        n, value, priced = tally.get(t, (0, 0.0, 0))
        out[t] = {"insider_buys_30d": n}
        if priced:
            out[t]["insider_buy_value_30d"] = round(value, 2)
    return out, unmatched


def read_insider_fields(targets, failures=None, *, session: Optional[date] = None,
                        receipt: Optional[dict] = None) -> dict:
    """{TICKER: {insider_buys_30d, insider_buy_value_30d?}} for every target while the store covers the window, else
    {}. ONE read of the held store (`held_purchases`, read only: never the SEC, never a run). `receipt`: state
    ('served' | 'no_session' | 'not_held' | 'window_not_held' | 'stale'), the window, the store's first held day and
    newest read day, its lag in sessions, whether every day of the window was read in full, filings counted and
    filings whose symbol matched no target."""
    from api.services.screener import fund_trends as FT            # noqa: PLC0415 -- the shared session-lag rule
    said = {"state": None, "window_from": None, "window_to": session.isoformat() if session else None,
            "store_from": None, "newest_read": None, "lag_sessions": None, "complete": None,
            "filings": 0, "unmatched": 0, "matched": 0}
    if session is None:
        return _done(receipt, said, "no_session", {})
    from api.services import insider_clusters_sec as ics           # noqa: PLC0415 -- lazy: the build's one read
    ans, how = ics.held_purchases()
    if how != "held" or not isinstance(ans, dict):
        return _done(receipt, said, "not_held", {})
    lo = session - timedelta(days=INSIDER_DAYS - 1)
    said["window_from"] = lo.isoformat()
    days = [r for r in ((ans.get("coverage") or {}).get("days") or ()) if isinstance(r, dict) and _iso(r.get("date"))]
    held = sorted(_iso(r["date"]) for r in days)
    said["store_from"] = held[0] if held else None
    read = sorted(_iso(r["date"]) for r in days if r.get("state") in _READ_STATES)
    said["newest_read"] = read[-1] if read else None
    if not held or held[0] > _first_weekday(lo).isoformat():
        _note(failures, "insider_buys", "window_not_held")
        return _done(receipt, said, "window_not_held", {})
    lag = FT.lag_sessions(said["newest_read"], session) if said["newest_read"] else None
    said["lag_sessions"] = lag
    if said["newest_read"] is None or (lag is not None and lag > FT.MAX_LAG_SESSIONS):
        _note(failures, "insider_buys", "stale")
        return _done(receipt, said, "stale", {})
    hi = session.isoformat()
    said["complete"] = all(r.get("state") in ("complete", "no_index")
                           for r in days if lo.isoformat() <= _iso(r["date"]) <= hi)
    out, said["unmatched"] = insider_counts(ans.get("purchases"), targets, lo.isoformat(), hi)
    said["filings"] = sum(v["insider_buys_30d"] for v in out.values())
    said["matched"] = sum(1 for v in out.values() if v["insider_buys_30d"])
    return _done(receipt, said, "served", out)


# ── fund adds ────────────────────────────────────────────────────────────────────────────────

def read_fund_fields(targets, failures=None, *, receipt: Optional[dict] = None) -> dict:
    """{TICKER: {fund_net_adds}}: ONE read-only pass of the N-PORT index (`group_positioning.read_nport`), GRPS
    CROWDING's rule per stock (`group_positioning.fund_figures`). `receipt`: state ('served' | 'not_built' |
    'unavailable'), the quarter and the one before it, the index's build time, stocks in it, known and matched."""
    from api.services import group_positioning as GP               # noqa: PLC0415 -- lazy: the build's one read
    said = {"state": None, "quarter": None, "prior_quarter": None, "built_at": None, "in_index": 0, "known": 0,
            "matched": 0}
    by_key = {_key(t): str(t).upper() for t in targets or ()}
    got = GP.read_nport(list(by_key) + [t for t in by_key.values() if t not in by_key])
    meta = got.get("meta") or {}
    said.update(quarter=meta.get("quarter"), prior_quarter=meta.get("prior_quarter"), built_at=meta.get("built_at"))
    if got.get("state") != "ok":
        _note(failures, "fund_adds", got.get("state") or "unavailable")
        return _done(receipt, said, got.get("state") or "unavailable", {})
    out = {}
    for sym, summary in (got.get("rows") or {}).items():
        t = by_key.get(_key(sym))
        if t is None:
            continue
        said["in_index"] += 1
        f = GP.fund_figures(summary)
        if f is None or f[1] is None or f[2] is None:
            continue
        said["known"] += 1
        out[t] = {"fund_net_adds": f[1] - f[2]}
    said["matched"] = len(out)
    return _done(receipt, said, "served", out)
