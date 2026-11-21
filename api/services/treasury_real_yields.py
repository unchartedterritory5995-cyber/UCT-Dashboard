"""Real yields for the RATES screen: the US Treasury's daily par REAL yield curve (TIPS), and the
breakeven at each maturity both curves carry.

    get_real() -> the `real` block of GET /api/research/treasury-yields
      status   'ok' | 'computing' | 'unavailable' | 'failed'  (the same words as the nominal read)
      ok:      as_of (the DATE of the newest real figure), ref_dates {d1, w1},
               maturities [{key ('5y' ... '30y'), label, months, yield (PERCENT, a TIPS real yield),
                            was {d1, w1}, change_bp {d1, w1} (BASIS POINTS)}],
               breakevens {as_of (the newest day BOTH curves hold, or None),
                           rows [{key, label, months, date, nominal, real, value}]},
               rows (days held), read_at, basis 'end_of_day', source, check

THE SOURCE is the same publisher and the same feed as the nominal curve
(`api/services/treasury_yields.py`): the Treasury's daily interest rate XML feed, asked for
`data=daily_treasury_real_yield_curve` one month at a time (`field_tdr_date_value_month=YYYYMM`).
This module reads it through `treasury_yields.fetch_period`, so the address, the refusal,
rate-limit, timeout and shape rules and the XML reader are the nominal read's own, word for word.

  Established 2026-11-21 from the Treasury's page "Treasury Daily Interest Rate XML Feed"
  (home.treasury.gov/treasury-daily-interest-rate-xml-feed), section "4) Daily Treasury Real Par
  Yield Curve Rates", whose sample entry (shown there as a picture) reads: an Atom <feed> titled
  DailyTreasuryRealYieldCurveRateData; each <entry> holds one day in <content><m:properties>:
      d:NEW_DATE                              the day, `2022-03-01T00:00:00`
      d:TC_5YEAR  d:TC_7YEAR  d:TC_10YEAR  d:TC_20YEAR  d:TC_30YEAR   the real yield, in PERCENT
      d:DailyTreasuryRealYieldCurveRateDataId                          not read
  THIS SERVER HAS NEVER ASKED THE TREASURY FOR IT. If an answer carries days with none of the five
  elements, `fetch_period` reports a shape mismatch: the block then says "not available", never zeros.

IT NEVER ASKS THE TREASURY MORE THAN THE NOMINAL READ DOES. Never on a member's request: one
background build (`api/services/held_build.py`, the nominal read's own hold-and-build way),
started only by a request that already has a nominal answer. A first build makes two requests (last
month, this month); a refresh makes one, and is due by the nominal read's own rule
(`treasury_yields.refresh_due`: after the weekday 18:15 New York slot, then at most every three
hours while the newest figure is behind). A refusal is remembered for six hours, a 429 for fifteen
minutes, a failure for a minute.

THE BREAKEVEN is the nominal yield minus the real yield at the same maturity on the newest day
BOTH curves hold, in percentage points, computed here. It is None when either side is missing,
never 0, and it carries its own date, which can be older than either curve's newest day.

The agent's `rates.treasury` read (`treasury_yields.held_answer`) is not touched by this module.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from api.services import held_build
from api.services import treasury_yields as ty

SOURCE = "US Treasury daily par real yield curve"
FEED = "daily_treasury_real_yield_curve"
#: the maturities read, shortest first: (key, the Treasury's element, plain name, months). The keys
#: are the nominal curve's own, so a breakeven pairs by key.
MATURITIES: tuple[tuple[str, str, str, int], ...] = (
    ("5y", "TC_5YEAR", "5-year", 60),
    ("7y", "TC_7YEAR", "7-year", 84),
    ("10y", "TC_10YEAR", "10-year", 120),
    ("20y", "TC_20YEAR", "20-year", 240),
    ("30y", "TC_30YEAR", "30-year", 360),
)
HORIZONS = ("d1", "w1")
KEEP_DAYS = 70          # calendar days of real figures kept (two requests' worth); the builder's default
DISK_VERSION = 1


def _month(day: date) -> str:
    return f"{day.year:04d}{day.month:02d}"


def plan(today: date, held_days: list[str]) -> list[tuple[str, bool]]:
    """The months one build asks for, oldest first, as (yyyymm, may be empty). With a day of this
    month already held: this month only. Otherwise last month too (a first build, or a held answer
    that stops before this month)."""
    this = _month(today)
    if any(d.startswith(f"{this[:4]}-{this[4:]}-") for d in held_days):
        return [(this, True)]
    return [(_month(today.replace(day=1) - timedelta(days=1)), False), (this, True)]


def build(previous: Optional[dict]) -> tuple[dict, str]:
    """ONE build, on the background thread: at most two requests, `PAUSE_S` between them. Returns
    the answer and its log line's words; raises `held_build.Stop` for a read that did not work."""
    days: dict[str, dict] = {}
    if isinstance(previous, dict) and isinstance(previous.get("days"), dict):
        days = {d: dict(ys) for d, ys in previous["days"].items()}
    before = max(days) if days else None
    today = ty.now_et().date()
    asked = dropped = 0
    for value, may_be_empty in plan(today, sorted(days)):
        if asked:
            ty._pause(ty.PAUSE_S)
        asked += 1
        try:
            rows, lost = ty.fetch_period("month", value, may_be_empty=may_be_empty, feed=FEED, fields=MATURITIES)
        except ty._Stop as stop:
            raise held_build.Stop(stop.state, stop.reason, stop.http_status, hold=stop.hold,
                                  note=f"treasury-real status={stop.http_status or 'none'} {stop.note}; request {asked}") from None
        dropped += lost
        for r in rows:
            days[r["date"]] = {key: r["y"].get(key) for key, *_ in MATURITIES}
    if not days:
        raise held_build.Stop("unavailable", "shape", 200, hold=ty.SHAPE_HOLD_S,
                              note=f"treasury-real status=200 rows=0 no rows (the feed answered {asked} requests with no day)")
    newest = max(days)
    floor = (date.fromisoformat(newest) - timedelta(days=KEEP_DAYS)).isoformat()
    days = {d: ys for d, ys in days.items() if d >= floor}
    same = " (no newer figure than the one held)" if before and newest <= before else ""
    tail = f" dropped={dropped}" if dropped else ""
    note = f"treasury-real status=200 rows={len(days)} requests={asked} latest={newest}{tail}{same}"
    return {"status": "ok", "v": DISK_VERSION, "as_of": newest, "days": days, "read_at": held_build.now_iso()}, note


def _valid(held: dict) -> bool:
    days = held.get("days")
    return (held.get("status") == "ok" and isinstance(days, dict) and bool(days)
            and held.get("as_of") in days and all(isinstance(v, dict) for v in days.values()))


def _due(held: dict, checked: float) -> bool:
    return ty.refresh_due(held.get("as_of"), checked)


_held = held_build.HeldBuild("rates-real-data", build, _due, disk=("treasury_yields", f"real_yields_v{DISK_VERSION}.json"),
                             version=DISK_VERSION, valid=_valid)


def _bp(now: Optional[float], was: Optional[float]) -> Optional[float]:
    return round((now - was) * 100, 1) if now is not None and was is not None else None


def _reference(ordered: list[str], gap_days: int) -> Optional[str]:
    """The newest held day on or before `gap_days` before the newest one, when it is near enough
    (the nominal read's `MAX_REF_GAP_DAYS`): no change is better than a change against another day."""
    newest = date.fromisoformat(ordered[-1])
    target = newest - timedelta(days=gap_days)
    earlier = [d for d in ordered[:-1] if d <= target.isoformat()]
    if not earlier or (target - date.fromisoformat(earlier[-1])).days > ty.MAX_REF_GAP_DAYS:
        return None
    return earlier[-1]


def assemble(held: dict, nominal_days: dict) -> dict:
    """Pure: the member's block from the days held and the nominal curve's own days."""
    days = held["days"]
    ordered = sorted(days)
    as_of = ordered[-1]
    refs = {"d1": _reference(ordered, 1), "w1": _reference(ordered, 7)}
    num = ty._num
    maturities = []
    for key, _field, label, months in MATURITIES:
        now = num(days[as_of].get(key))
        was = {h: (num(days[refs[h]].get(key)) if refs[h] else None) for h in HORIZONS}
        maturities.append({"key": key, "label": label, "months": months, "yield": now, "was": was,
                           "change_bp": {h: _bp(now, was[h]) for h in HORIZONS}})
    common = [d for d in ordered if isinstance(nominal_days.get(d), dict)]
    day = common[-1] if common else None
    rows = []
    for key, _field, label, months in MATURITIES:
        nominal = num(nominal_days[day].get(key)) if day else None
        real = num(days[day].get(key)) if day else None
        # None when either side is missing, never 0
        value = round(nominal - real, 2) if nominal is not None and real is not None else None
        rows.append({"key": key, "label": label, "months": months, "date": day, "nominal": nominal, "real": real,
                     "value": value})
    return {"status": "ok", "as_of": as_of, "ref_dates": refs, "maturities": maturities,
            "breakevens": {"as_of": day, "rows": rows}, "rows": len(ordered), "read_at": held.get("read_at"),
            "basis": "end_of_day", "source": SOURCE, "check": held.get("check")}


def get_real(*, wait_s: Optional[float] = None) -> dict:
    """The `real` block. Never builds on the caller's thread and never raises."""
    try:
        got = _held.get(wait_s=wait_s)
        if got.get("status") != "ok":
            return got
        return assemble(got, ty.held_rows(got["days"]))
    except Exception:  # noqa: BLE001 -- the nominal answer must never be lost to this block
        return {"status": "failed", "reason": "error", "http_status": None}


def reset_for_tests() -> None:
    _held.reset()
