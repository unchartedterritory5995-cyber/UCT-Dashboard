"""FT-064 -- EVTS: a ticker's events staged by time relative to the print.
The Research > Depth "Events around the print" panel.

Every event is placed against its NEAREST earnings print (reported, or the next
scheduled one) and labelled T-n / T / T+n in weekdays. Events come from stores
this pod already holds; nothing here calls a vendor:

  earnings          the earnings payload's reported quarters and its next
                    scheduled date (earnings_intel, read from CACHE only)
  uct_catalyst      every day UCT's catalyst engine recorded this ticker
                    (catalysts.db, catalyst.store.history_for_ticker)
  filing            10-K / 10-Q filing dates the filing-search index holds
                    (filing_search.fs_doc; empty unless that surface has run)
  room_spike        days the #main-chat mention count for this ticker was at
                    least SPIKE_MULT x its trailing median and SPIKE_MIN
                    mentions (buzz.db; no message text exists to show)

Honesty rules, railed in tests/test_events_timeline.py:
  * every event names its source store and the date it carries;
  * the offset is in WEEKDAYS and the payload says exchange holidays are not
    removed, so "T-3" is never read as three trading sessions when a holiday
    falls inside;
  * a source that could not be read is listed in `sources` with its error, and
    an empty source is listed as empty, so "no events" is never confused with
    "could not look";
  * with no print on file the events are still returned, unstaged, and the
    payload says why.

DARK behind EVENTS_TIMELINE_ENABLED.
"""
from __future__ import annotations

import logging
import os
import sqlite3
from datetime import date, datetime, timedelta, timezone
from statistics import median
from typing import Any, Callable, Optional
from zoneinfo import ZoneInfo

_logger = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

ENABLED_ENV = "EVENTS_TIMELINE_ENABLED"
MAX_PRINTS = 9               # 8 reported quarters + the next scheduled
CATALYST_LIMIT = 200
SPIKE_LOOKBACK_DAYS = 365
SPIKE_BASELINE_DAYS = 20
SPIKE_MULT = 3.0
SPIKE_MIN = 5
OFFSET_UNIT = "weekdays (Mon-Fri; exchange holidays are not removed)"


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def weekday_offset(a: date, b: date) -> int:
    """Signed weekdays from print `b` to event `a`: the weekdays strictly after
    the earlier date up to and including the later one. A weekend event shares
    the preceding Friday's slot."""
    if a == b:
        return 0
    sign = 1 if a > b else -1
    lo, hi = (b, a) if a > b else (a, b)
    n, d = 0, lo
    while d < hi:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return sign * n


def _iso(v) -> Optional[str]:
    s = str(v or "")[:10]
    try:
        date.fromisoformat(s)
        return s
    except ValueError:
        return None


# ── sources (each returns a list of events; raising is recorded, not fatal) ──

def _earnings_events(sym: str) -> tuple[list[dict], list[dict], Optional[str]]:
    """(events, prints, why_unstaged). Cache only."""
    from api.services import earnings_reaction_panel as erp
    payload = erp._cached_earnings(sym)
    if payload is None:
        return [], [], "the earnings history is being read; events are staged against the prints when it lands, and this panel fills in by itself"
    events, prints = [], []
    reported = [q for q in (payload.get("quarters") or []) if q and q.get("reported") and _iso(q.get("report_date"))]
    for q in reported[:MAX_PRINTS - 1]:
        d = _iso(q["report_date"])
        label = q.get("label") or d
        est, act = q.get("eps_estimate"), q.get("eps_actual")
        # R21: an estimate FMP never published is omitted, never printed as
        # "vs None estimate".
        if act is None:
            detail = None
        elif est is None:
            detail = f"EPS {act}"
        else:
            detail = f"EPS {act} vs {est} estimate"
        prints.append({"date": d, "label": label, "state": "reported"})
        events.append({"date": d, "kind": "earnings", "title": f"Reported {label}", "detail": detail,
                       "source": "earnings payload (earnings_intel)"})
    nxt = _iso((payload.get("summary") or {}).get("next_report_date") or payload.get("next_report_date"))
    if nxt and all(p["date"] != nxt for p in prints):
        label = (payload.get("summary") or {}).get("next_report_label") or "next report"
        prints.append({"date": nxt, "label": label, "state": "scheduled"})
        events.append({"date": nxt, "kind": "earnings", "title": f"Scheduled {label}", "detail": None,
                       "source": "earnings payload (earnings_intel)"})
    why = None if prints else "no reported or scheduled print on file"
    return events, prints, why


def _clip(text: str, limit: int) -> str:
    """Live sweep 2026-10-05: a hard slice cut mid-word ("broad social chatter ab...").
    Trim at the last word boundary inside `limit`, drop trailing punctuation, end in an ellipsis."""
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    if " " in cut:
        cut = cut[:cut.rfind(" ")]
    return cut.rstrip(" ,;:.-") + "…"


def _catalyst_events(sym: str) -> list[dict]:
    from api.services.catalyst import store
    out = []
    for r in store.history_for_ticker(sym, CATALYST_LIMIT):
        d = _iso(r.get("market_date"))
        if not d:
            continue
        thesis = (r.get("thesis_text") or "").strip()
        out.append({"date": d, "kind": "uct_catalyst",
                    "title": f"UCT catalyst engine: {r.get('tag') or 'flagged'}"
                             + (f" (rank {r['rank']})" if r.get("rank") else ""),
                    "detail": _clip(thesis, 220) or None,
                    "source": "UCT catalyst engine (catalysts.db)"})
    return out


def _filing_events(sym: str) -> list[dict]:
    from api.services import filing_search
    path = filing_search.db_path()
    if not os.path.exists(path):
        return []
    c = sqlite3.connect(path, timeout=2.0)
    try:
        try:
            rows = c.execute("SELECT form, accession, filed, url FROM fs_doc WHERE sym=?", (sym,)).fetchall()
        except sqlite3.OperationalError:
            return []
    finally:
        c.close()
    return [{"date": _iso(f), "kind": "filing", "title": f"Filed {form}", "detail": acc, "url": url,
             "source": "SEC EDGAR, via the filing-search index"} for form, acc, f, url in rows if _iso(f)]


def _room_spike_events(sym: str, now: Optional[datetime] = None) -> list[dict]:
    from api.services import buzz_store
    if not os.path.exists(buzz_store.db_path()):
        return []
    now = now or datetime.now(timezone.utc)
    start = int((now - timedelta(days=SPIKE_LOOKBACK_DAYS + SPIKE_BASELINE_DAYS * 2)).timestamp())
    # R21: bucketed by the ET calendar day, as ATTN buckets the room. SQLite's
    # `date(ts, 'unixepoch')` is the UTC day, which moved every evening-ET
    # mention onto the next day.
    rows = buzz_store.connect().execute(
        "SELECT ts FROM mentions WHERE ticker=? AND ts >= ?", (sym, start)).fetchall()
    counts: dict[str, int] = {}
    for r in rows:
        d_et = datetime.fromtimestamp(int(r["ts"]), tz=_ET).date().isoformat()
        counts[d_et] = counts.get(d_et, 0) + 1
    if not counts:
        return []
    out = []
    d0 = date.fromisoformat(min(counts))
    d1 = date.fromisoformat(max(counts))
    series, d = [], d0
    while d <= d1:
        if d.weekday() < 5:
            series.append((d.isoformat(), counts.get(d.isoformat(), 0)))
        d += timedelta(days=1)
    for i, (day, n) in enumerate(series):
        base = [x for _, x in series[max(0, i - SPIKE_BASELINE_DAYS):i]]
        if len(base) < SPIKE_BASELINE_DAYS // 2:
            continue
        med = median(base)
        if n >= SPIKE_MIN and n >= SPIKE_MULT * max(med, 1):
            out.append({"date": day, "kind": "room_spike",
                        "title": f"Room mentions spiked: {n} (trailing {SPIKE_BASELINE_DAYS}-weekday median {med:g})",
                        "detail": None, "source": "#main-chat mention store (buzz.db)"})
    return out


SOURCES: dict[str, Callable[[str], list[dict]]] = {
    "uct_catalyst": _catalyst_events,
    "filing": _filing_events,
    "room_spike": _room_spike_events,
}


def timeline(sym: str) -> dict:
    sym = (sym or "").upper().strip()
    sources: dict[str, Any] = {}
    try:
        events, prints, why = _earnings_events(sym)
        sources["earnings"] = {"state": "ok" if prints else ("pending" if why and "being read" in why else "empty"),
                               "events": len(events)}
    except Exception as exc:  # noqa: BLE001 -- recorded per source, never fatal
        events, prints, why = [], [], "the earnings history could not be read"
        sources["earnings"] = {"state": "error", "error": type(exc).__name__}
    for name, fn in SOURCES.items():
        try:
            got = fn(sym)
            sources[name] = {"state": "ok" if got else "empty", "events": len(got)}
            events.extend(got)
        except Exception as exc:  # noqa: BLE001
            _logger.warning("events timeline source %s failed for %s: %s", name, sym, exc)
            sources[name] = {"state": "error", "error": type(exc).__name__}

    pdates = sorted({date.fromisoformat(p["date"]) for p in prints})
    plabel = {p["date"]: p for p in prints}
    staged = []
    for e in events:
        d = date.fromisoformat(e["date"])
        if pdates:
            near = min(pdates, key=lambda p: (abs((d - p).days), p))
            off = weekday_offset(d, near)
            p = plabel[near.isoformat()]
            e = {**e, "print_date": near.isoformat(), "print_label": p["label"], "print_state": p["state"],
                 "offset": off, "stage": "T" if off == 0 else f"T{off:+d}"}
        staged.append(e)
    staged.sort(key=lambda e: (e["date"], e["kind"]))
    return {"ticker": sym, "state": "ok" if pdates else "unstaged", "reason": why,
            "offset_unit": OFFSET_UNIT, "prints": sorted(prints, key=lambda p: p["date"]),
            "events": staged, "sources": sources}
