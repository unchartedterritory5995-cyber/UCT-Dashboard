"""Auto chart: the reference lines the UCT team actually uses for an archive setup.

THE ONE AUTHORITY for the formulas below. The routes (api/routers/wisdom_archive.py) only call
`for_ticker` / `for_calls`; the client only draws what comes back. Nothing here is restated in
JavaScript.

WHERE THE RULES COME FROM: the 2026-10-16 ledger level study (2,827 stated levels from the
archive, each rule held in both date halves against random-level controls). Per setup family:

  breakout family (breakout_other, flat_top_breakout, flag_htf, inside_day, peg_flag)
      TRIGGER  prior-day high                    = high of the last completed session
      TRIGGER  10-day high                       = highest high of the last 10 completed sessions
  pullback family (pullback_ma)
      ENTRY    10 EMA                            = EMA(10) of closes through the last completed session
      ENTRY    prior-day low                     = low of the last completed session
  both families, long calls only
      STOP     prior-day low
      STOP     20 EMA                            = EMA(20) of closes through the last completed session

EMA = api.services.indicator_compute.compute_ema_raw (k = 2/(n+1), seeded with the SMA of the
first n closes), the same math the chart's EMA overlay draws.

NO LOOKAHEAD: only bars dated STRICTLY BEFORE `as_of` (the date the chart is shown for) are
used. `compute` drops later bars itself, so a caller passing too many bars cannot leak one.

STATED PRICES: when an archive call is the thing on the chart and it stated an entry or stop,
that price replaces the generic lines of its role, but ONLY for an aged call. The age gate is
the provider's (`provider.levels`, PRICE_AGE_SESSIONS = 20 sessions), never restated here.

DISPLAY ONLY: nothing here feeds what fires, its score, confidence, HIST_SCORE or confirmed_only.
Setups outside the two families (support_level, undercut_reclaim, launch_pad, intraday setups,
...) get no automatic lines. Gated by WISDOM_ARCHIVE_LINES_ENABLED and WISDOM_ARCHIVE_ENABLED
(`enabled()`).

Labels describe where the team usually places a line; they never attribute a line to a person.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Iterable, Mapping, Optional, Sequence

from api.services.wisdom.core import flags

log = logging.getLogger(__name__)

BREAKOUT_SETUPS = frozenset({"breakout_other", "flat_top_breakout", "flag_htf", "inside_day", "peg_flag"})
PULLBACK_SETUPS = frozenset({"pullback_ma"})
RANGE_SESSIONS = 10
ENTRY_EMA = 10
STOP_EMA = 20
#: Bars read per chart: enough for the 20 EMA to converge on the chart's own overlay.
BARS_NEEDED = 250

NOTE = ("Reference lines: where the UCT team usually places its trigger, entry and stop on this "
        "setup, measured on 2,827 stated levels in the trader archive. Display only.")

ROLE_WORD = {"trigger": "trigger", "entry": "entry", "stop": "stop"}
#: Which stated call field stands in for which role.
STATED_ROLE = {"entry": ("trigger", "entry"), "stop": ("stop",)}


def enabled() -> bool:
    return flags.archive_lines_enabled() and flags.archive_enabled()


def family(setup: Optional[str]) -> Optional[str]:
    s = str(setup or "").strip().lower()
    if s in BREAKOUT_SETUPS:
        return "breakout"
    if s in PULLBACK_SETUPS:
        return "pullback"
    return None


def _day(value) -> Optional[str]:
    """YYYY-MM-DD from an ISO string, a date, or a YYYYMMDD int (bars_sqlite's daily ts)."""
    if value is None:
        return None
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, int) or (isinstance(value, str) and value.isdigit() and len(value) == 8):
        s = str(value)
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    s = str(value)[:10]
    try:
        return date.fromisoformat(s).isoformat()
    except ValueError:
        return None


def _num(v) -> Optional[float]:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x and x > 0 else None


def _price(x: float) -> float:
    return round(x, 2) if x >= 1 else round(x, 4)


def _line(role: str, kind: str, price: Optional[float], name: str) -> Optional[dict]:
    if price is None:
        return None
    return {"role": role, "kind": kind, "price": _price(price),
            "label": f"{name} · team {ROLE_WORD[role]} line"}


def compute(bars: Sequence[Mapping], setup: Optional[str], as_of, *, direction: str = "long",
            stated: Optional[Iterable] = None, posted=None) -> list[dict]:
    """[{role, kind, price, label}] for one chart. Pure: no store, no clock.

    bars: oldest-first dicts with `date` (ISO, date or YYYYMMDD), `high`, `low`, `close`.
    as_of: the date the chart is shown for; only bars dated before it are read.
    stated: [(kind, price)] from `provider.levels` (aged calls only), or None.
    """
    fam = family(setup)
    cutoff = _day(as_of)
    if fam is None or cutoff is None or str(direction or "long").strip().lower() != "long":
        return []
    rows = []
    for b in bars or []:
        d = _day(b.get("date"))
        if d is None or d >= cutoff:
            continue
        h, lo, c = _num(b.get("high")), _num(b.get("low")), _num(b.get("close"))
        if h is None or lo is None or c is None:
            continue
        rows.append((d, h, lo, c))
    rows.sort(key=lambda r: r[0])
    if not rows:
        return []

    from api.services.indicator_compute import compute_ema_raw

    closes = [r[3] for r in rows]
    prior_high, prior_low = rows[-1][1], rows[-1][2]
    range_high = max(r[1] for r in rows[-RANGE_SESSIONS:]) if len(rows) >= RANGE_SESSIONS else None
    ema_entry = compute_ema_raw(closes, ENTRY_EMA)[-1]
    ema_stop = compute_ema_raw(closes, STOP_EMA)[-1]

    generic: list = []
    if fam == "breakout":
        generic += [_line("trigger", "prior_day_high", prior_high, "Prior-day high"),
                    _line("trigger", "range_high_10", range_high, "10-day high")]
    else:
        generic += [_line("entry", "ema_10", ema_entry, "10 EMA"),
                    _line("entry", "prior_day_low", prior_low, "Prior-day low")]
    generic += [_line("stop", "prior_day_low", prior_low, "Prior-day low"),
                _line("stop", "ema_20", ema_stop, "20 EMA")]
    generic = [g for g in generic if g is not None]

    when = _day(posted)
    replaced: dict = {}
    for kind, raw in stated or []:
        price = _num(raw)
        if price is None or kind not in STATED_ROLE:
            continue
        role = STATED_ROLE[kind][0] if fam == "breakout" else STATED_ROLE[kind][-1]
        if role in replaced:
            continue
        replaced[role] = {"role": role, "kind": f"stated_{kind}", "price": _price(price),
                          "label": f"Stated {kind} in this call{f' ({when})' if when else ''}"}
    out = [g for g in generic if g["role"] not in replaced]
    return list(replaced.values()) + out


# ── store-facing (the routes call these) ─────────────────────────────────────

def _bars_before(sym: str, as_of: str) -> list[dict]:
    """Daily bars dated before `as_of`, oldest first, from the local bars store. [] on any failure."""
    try:
        from api.services import bars_sqlite

        key = int(as_of.replace("-", "")) - 1
        rows = bars_sqlite.get_bars_before(sym, "D", BARS_NEEDED, key)
    except Exception:  # noqa: BLE001 — no bars means no lines, never an error on the page
        log.exception("[wisdom] archive lines: bars unavailable for %s", sym)
        return []
    return [{"date": r[0], "high": r[2], "low": r[3], "close": r[4]} for r in rows]


def for_ticker(sym: str, setup: Optional[str], as_of=None, *, direction: str = "long") -> list[dict]:
    """Generic lines for a live chart of `sym` (no call shown), as of `as_of` (default: today ET)."""
    if family(setup) is None or not sym:
        return []
    if as_of is None:
        from api.services.wisdom.core import timeutil

        as_of = timeutil.now_et().date()
    day = _day(as_of)
    if day is None:
        return []
    return compute(_bars_before(sym, day), setup, day, direction=direction)


def for_calls(conn, calls: Sequence[Mapping], setup: Optional[str], *, today: Optional[date] = None) -> dict:
    """{call_id: lines} for archive calls shown on their own posted-date charts.

    A call's stated entry/stop come ONLY from `provider.levels`, which returns aged calls alone."""
    if family(setup) is None:
        return {}
    from api.services.wisdom.archive import provider

    shown = [c for c in calls or [] if c.get("call_id") and c.get("ticker") and _day(c.get("posted"))]
    stated = provider.levels(conn, [c["call_id"] for c in shown], today=today) if shown else {}
    out: dict = {}
    for c in shown:
        day = _day(c["posted"])
        lines = compute(_bars_before(str(c["ticker"]).upper(), day), setup, day,
                        direction=c.get("direction") or "long", stated=stated.get(c["call_id"]),
                        posted=day)
        if lines:
            out[c["call_id"]] = lines
    return out
