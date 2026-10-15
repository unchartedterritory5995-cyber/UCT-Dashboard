"""Task 1 (Tier 2 part B) probe for V2 / V3 / V4. Run it in a CHILD process, never in a server.

    python t2b_v2_probe.py <repo> <sandbox_data_dir> <part>        part = v2 | v3 | v4 | all

* `import hub_sandbox_boot` + `apply_sandbox_env` come BEFORE any `api.*` import: the census pins send
  every `/data/...` path to <sandbox_data_dir> and arm the shared-root tripwire (nothing reaches C:\\data).
* It reads provider keys from the ENVIRONMENT only, and prints which names are present (true/false),
  never a value. It does not read any .env file. A run with a key missing says MEASUREMENT_VALID=false and
  its numbers must not be quoted as a measurement.
* Output: one line per section, "<TAG> <json>", so a redirect to a file is the raw artifact.
"""
import json
import os
import sys
import time
import random
from collections import Counter
from datetime import date, datetime
from zoneinfo import ZoneInfo

repo, data_dir, part = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else "all")
sys.path.insert(0, repo)
sys.path.insert(0, repo + "/scripts")
import hub_sandbox_boot as b  # noqa: E402

b.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)

from api.services import calendar_alerts, earnings_intel, session_calendar  # noqa: E402
from api.services.journal_two import earnings_prep  # noqa: E402
from api.services.cache import cache  # noqa: E402

ET = ZoneInfo("America/New_York")
NEED = ("FINNHUB_API_KEY", "FMP_API_KEY", "MASSIVE_API_KEY")
keys = {k: bool(os.environ.get(k)) for k in NEED}
now = datetime.now(ET)
today = now.date()
prev = today
while True:
    prev = date.fromordinal(prev.toordinal() - 1)
    if session_calendar.is_trading_day(prev):
        break
valid = all(keys.values())
head = {"at": now.isoformat(), "today": today.isoformat(), "prev": prev.isoformat(), "part": part,
        "keys_present": keys, "MEASUREMENT_VALID": valid,
        "data_dir_outside_C_data": not os.path.abspath(data_dir).lower().replace("/", "\\").startswith("c:\\data"),
        "auth_db_path": os.environ.get("AUTH_DB_PATH")}
print("HEAD " + json.dumps(head), flush=True)


def spread(syms, k):
    """A SEEDED spread over the day's reporters, not the alphabetical head (sorted()[:k] is biased to A-names)."""
    syms = sorted(syms)
    return sorted(random.Random(20261015).sample(syms, min(k, len(syms))))


def reporters(day):
    t0 = time.monotonic()
    syms, ok = calendar_alerts._get_reporters_for_date_with_status(day.isoformat())
    return sorted(syms), ok, round(time.monotonic() - t0, 2)


picked = []  # (day, sym) pairs V2 looked at, reused by V3
if part in ("v2", "all"):
    rows = []
    for day in (today, prev):
        syms, ok, secs = reporters(day)
        for sym in spread(syms, 6):
            t0 = time.monotonic()
            p = earnings_intel._build(sym)
            q = next((q for q in p.get("quarters") or [] if q.get("reported")), {})
            ev = {e.get("report_date"): e.get("reaction_pct") for e in ((p.get("reaction") or {}).get("events") or [])}
            rows.append({"day": day.isoformat(), "sym": sym, "secs": round(time.monotonic() - t0, 1),
                         "newest_reported": q.get("report_date"), "eps_actual": q.get("eps_actual"),
                         "revenue_actual": q.get("revenue_actual"), "reaction_none": p.get("reaction") is None,
                         "reaction_for_day": ev.get(day.isoformat()),
                         "n_quarters": len(p.get("quarters") or [])})
            picked.append((day, sym))
        rows.append({"day": day.isoformat(), "reporters_count": len(syms), "ok": ok, "lookup_secs": secs,
                     "sample_only": spread(syms, 6)})
    print("V2 " + json.dumps(rows), flush=True)

if part in ("v3", "all"):
    from api.services import bars_fetch
    out = []
    for day, sym in (picked[:2] or [(today, s) for s in spread(reporters(today)[0], 2)]):
        t0 = time.monotonic()
        r = bars_fetch._get_bars_inner(sym, "D", 5)
        bars = r.get("bars") if isinstance(r, dict) else r
        last = (bars or [None])[-1] if bars else None
        out.append({"sym": sym, "secs": round(time.monotonic() - t0, 1), "n_bars": len(bars or []),
                    "last_bar": last, "today": today.isoformat(), "type": type(r).__name__})
    print("V3_BARS " + json.dumps(out, default=str), flush=True)

if part in ("v4", "all"):
    syms, ok, secs = reporters(prev)
    cal = cache.get("calendar_weekly") or {}
    leg_cache = bool(((cal.get("days") or {}).get(prev.isoformat()) or {}))
    timing = {s: earnings_prep._timing_from_calendar_cache(s, prev.isoformat()) for s in spread(syms, 12)}
    from api.services.finnhub_client import fh_get
    t0 = time.monotonic()
    fh = fh_get("/calendar/earnings", {"from": prev.isoformat(), "to": prev.isoformat()}, timeout=10)
    rows = (fh or {}).get("earningsCalendar") if isinstance(fh, dict) else None
    hours = Counter((r or {}).get("hour") for r in (rows or []))
    first = rows[0] if rows else None
    print("V4 " + json.dumps({
        "prev": prev.isoformat(), "reporters_count": len(syms), "ok": ok, "lookup_secs": secs,
        "answered_by_cache_leg": leg_cache, "timing_from_calendar_cache": timing,
        "finnhub_returned_dict": isinstance(fh, dict), "finnhub_rows": None if rows is None else len(rows),
        "finnhub_hour_values": dict(hours), "finnhub_row_keys": sorted(first) if isinstance(first, dict) else None,
        "finnhub_secs": round(time.monotonic() - t0, 2)}, default=str), flush=True)
print("DONE", flush=True)
