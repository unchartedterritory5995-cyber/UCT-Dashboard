"""The nightly breadth health check — every published breadth chart, read the way a member
sees it, summarised into #breadth-alerts.

⭐ WHY (2026-10-11, owner). The breadth audit found that every regression since August was
discovered by a person looking at a chart: a series ending a day early, a hole in the
history, a sentiment reading stuck for two weeks. This reads every published series and says
so first.

⛔ IT NEVER BUILDS A SERIES. A health check that rebuilt cold charts would cost the single
web pod seconds of CPU per symbol and race the warm loop into "stale" false alarms. It reads
only what is already cached or persisted (`breadth_symbols` memory/disk tiers) and SKIPS a
symbol with neither — counted, never guessed.

CHECKS (per published symbol, over the newest `WINDOW` calendar sessions):
  stale     the last bar is older than the session it should show
  gaps      calendar sessions missing inside the window (known gaps allow-listed)
  values    non-finite closes, or a percent outside 0-100
Plus sentiment freshness (AAII and NAAIM weekly, put/call for the prior session).

ONE message per run per problem class, naming the symbols — never one per symbol.
"""
from __future__ import annotations

import logging
import math
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

_log = logging.getLogger("breadth_health")
_ET = ZoneInfo("America/New_York")

WINDOW = 30
#: Known, explained holes — never re-alerted. (symbol -> dates)
KNOWN_GAPS = {
    "UCTATH": {"2026-08-31", "2026-09-01", "2026-09-23", "2026-09-24"},
}
AAII_MAX_DAYS = 9          # weekly, released Thursday
NAAIM_MAX_DAYS = 10        # weekly survey Wednesday, readable ~Friday


def _sessions_back(end: date, n: int) -> list:
    from api.services import session_calendar as sc
    out, d = [], end
    while len(out) < n:
        if sc.is_trading_day(d):
            out.append(d.isoformat())
        d -= timedelta(days=1)
    return sorted(out)


def expected_last(now: datetime, morning: bool) -> Optional[str]:
    """The session the newest bar should be: today in the evening run (sealed or live
    provisional), the previous session in the morning run."""
    from api.services import session_calendar as sc
    d = now.date()
    if morning or not sc.is_trading_day(d):
        d -= timedelta(days=1)
        for _ in range(10):
            if sc.is_trading_day(d):
                break
            d -= timedelta(days=1)
    return d.isoformat()


def _served(sym: str) -> Optional[list]:
    """The bars a member gets — ONLY when the series is already cached or persisted."""
    from api.services import breadth_symbols as bs
    key = bs._daily_key(bs.resolve(sym)["symbol"].upper()) if bs.resolve(sym) else None
    if key is None:
        return None
    if bs._breadth_cache.get(key) is None and not bs._disk_load(bs.resolve(sym)["symbol"].upper()):
        return None
    return (bs.build_breadth_bars(sym, "D", WINDOW + 10) or {}).get("bars") or []


def check_series(rows: list, now: datetime, morning: bool, served=_served) -> dict:
    expect = expected_last(now, morning)
    window = _sessions_back(date.fromisoformat(expect), WINDOW)
    out = {"stale": [], "gaps": [], "values": [], "checked": 0, "skipped": 0}
    for r in rows:
        sym, domain = r.get("symbol"), r.get("domain")
        bars = served(sym)
        if bars is None:
            out["skipped"] += 1
            continue
        out["checked"] += 1
        if not bars:
            out["stale"].append(f"{sym}: no bars")
            continue
        days = {str(b.get("t"))[:10] for b in bars}
        last = max(days)
        if last < expect:
            out["stale"].append(f"{sym}: last bar {last}")
        first = min(days)
        missing = [d for d in window if d >= first and d <= last and d not in days
                   and d not in KNOWN_GAPS.get(sym, ())]
        if missing:
            out["gaps"].append(f"{sym}: {len(missing)} missing ({', '.join(missing[:3])})")
        bad = []
        for b in bars:
            c = b.get("c")
            if c is None or not isinstance(c, (int, float)) or not math.isfinite(c):
                bad.append(f"{str(b.get('t'))[:10]} non-finite")
            elif domain == "pct_0_100" and not (0 <= c <= 100):
                bad.append(f"{str(b.get('t'))[:10]}={c}")
        if bad:
            out["values"].append(f"{sym}: {', '.join(bad[:3])}")
    return out


def check_sentiment(now: datetime) -> list:
    """AAII / NAAIM weekly freshness and the prior session's put/call, from the newest
    stored breadth rows."""
    from api.services import breadth_monitor as bm
    issues = []
    try:
        rows = bm.get_history(10) or []          # newest first
    except Exception as e:                       # noqa: BLE001
        return [f"breadth history unreadable: {type(e).__name__}"]
    if not rows:
        return ["no stored breadth rows"]
    newest = rows[0]
    today = now.date()

    def age(v):
        try:
            return (today - date.fromisoformat(str(v)[:10])).days
        except Exception:
            return None
    a = age(newest.get("aaii_survey_date"))
    if a is None or a > AAII_MAX_DAYS:
        issues.append(f"AAII: newest survey {newest.get('aaii_survey_date') or 'missing'} "
                      f"({a if a is not None else '?'} days old)")
    n = age(newest.get("naaim_date"))
    if n is None or n > NAAIM_MAX_DAYS:
        issues.append(f"NAAIM: newest survey {newest.get('naaim_date') or 'missing'} "
                      f"({n if n is not None else '?'} days old)")
    prior = next((r for r in rows if r.get("date") and r["date"] < today.isoformat()), None)
    if prior and prior.get("cboe_putcall") is None and now.hour >= 9:
        issues.append(f"Put/Call: missing for {prior['date']}")
    return issues


def run(now: Optional[datetime] = None, morning: bool = False, post=None,
        rows: Optional[list] = None) -> dict:
    """One health pass: check, then ONE alert per problem class."""
    from api.services import breadth_alerts
    from api.services import breadth_symbols as bs
    from api.services import session_calendar as sc
    now = now or datetime.now(_ET)
    if not morning and not sc.is_trading_day(now.date()):
        return {"ran": False, "reason": "not a trading day"}
    if rows is None:
        try:
            rows = list((bs.library_catalog() or {}).get("rows") or [])
        except Exception as e:                   # noqa: BLE001
            return {"ran": False, "reason": f"catalogue unreadable: {e}"}
    res = check_series(rows, now, morning)
    res["sentiment"] = check_sentiment(now)
    stamp = now.date().isoformat() + (":am" if morning else ":pm")
    sent = {}
    for cls, title in (("stale", "Breadth charts are behind"), ("gaps", "Breadth charts have missing days"),
                       ("values", "Breadth charts have impossible values"),
                       ("sentiment", "Breadth sentiment inputs are stale")):
        items = res.get(cls) or []
        if not items:
            breadth_alerts.clear(f"health:{cls}")
            continue
        lines = [f"{len(items)} affected" + (f" of {res['checked']} checked" if cls != "sentiment" else ""),
                 *items[:12]]
        sent[cls] = breadth_alerts.send(f"health:{cls}", f"{title} ({stamp})", lines, post=post)
    res["sent"] = sent
    _log.info("[breadth-health] %s", {k: (len(v) if isinstance(v, list) else v)
                                      for k, v in res.items() if k != "sent"})
    return res
