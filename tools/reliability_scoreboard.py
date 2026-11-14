"""The reliability scoreboard: what members got from the site over a day, from Cloudflare's own counts.

One run reads a window (default: the 24 hours ending at the last full hour) and reports:

  * requests and how many succeeded (anything but a 5xx);
  * gateway errors (502/504/52x: the server was not there) and the GAPS they form: runs of
    consecutive minutes with at least 5 of them. A deploy of the main server shows up as one gap;
  * how slow the server was, hour by hour: the 95th-percentile time the origin took to answer a
    request Cloudflare did not cache, and which hours were over one second.

It prints the report and appends one line of numbers to a history file, so the trend is there
tomorrow. It changes nothing anywhere.

    python tools/reliability_scoreboard.py                       # last 24 full hours
    python tools/reliability_scoreboard.py --hours 6 --history C:/path/scoreboard.jsonl
    python tools/reliability_scoreboard.py --print-query         # the exact request, no token needed
    python tools/reliability_scoreboard.py --self-check

Needs two environment variables and nothing else:
  CLOUDFLARE_ANALYTICS_TOKEN   a READ-ONLY token (Zone Analytics Read is enough for this report)
  CLOUDFLARE_ZONE_ID           the zone's id (kept out of this public repo on purpose)
Exit codes: 0 a report was produced; 2 it could not measure (no token, Cloudflare refused, no data).
Never 1: this tool reports, it does not judge. A bad day is a number, not a failure of the tool.

Baseline before any of the 2026-11 reliability work (24 h to 2026-11-14 04:30 UTC): 714k requests,
99.31% succeeded, 37 gaps holding 98% of the gateway errors, origin p95 over 1 s in 46 and 51 of the
60 minutes at 15:00 and 16:00 UTC.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://api.cloudflare.com/client/v4/graphql"
GATEWAY = (502, 504, 520, 521, 522, 523, 524)
#: A minute counts toward a gap at this many gateway errors. Fewer is one member's bad request.
GAP_MINUTE_ERRORS = 5
SLOW_MS = 1000


def window(hours: int, now: dt.datetime | None = None) -> tuple[str, str]:
    """The `hours` full hours ending at the top of the current hour, as ISO strings."""
    now = (now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc)
    until = now.replace(minute=0, second=0, microsecond=0)
    since = until - dt.timedelta(hours=hours)
    stamp = "%Y-%m-%dT%H:%M:%SZ"
    return since.strftime(stamp), until.strftime(stamp)


def build_query(zone: str, since: str, until: str) -> str:
    """One request, five answers. Every dataset and field here was run against the live API on
    2026-11-13/14 through the dashboard; a per-minute alias is at most 1,440 rows for 24 hours."""
    span = f'datetime_geq:"{since}", datetime_lt:"{until}", requestSource:"eyeball"'
    gateway = ",".join(str(s) for s in GATEWAY)
    return (
        "{viewer{zones(filter:{zoneTag:\"" + zone + "\"}){"
        f" all: httpRequestsAdaptiveGroups(limit:5000, filter:{{{span}}}, orderBy:[datetimeMinute_ASC])"
        "{count dimensions{datetimeMinute}}"
        f" errors: httpRequestsAdaptiveGroups(limit:5000, filter:{{{span}, edgeResponseStatus_geq:500}}, orderBy:[datetimeMinute_ASC])"
        "{count dimensions{datetimeMinute}}"
        f" gateway: httpRequestsAdaptiveGroups(limit:5000, filter:{{{span}, edgeResponseStatus_in:[{gateway}]}}, orderBy:[datetimeMinute_ASC])"
        "{count dimensions{datetimeMinute}}"
        f" slow: httpRequestsAdaptiveGroups(limit:5000, filter:{{{span}, cacheStatus:\"dynamic\", edgeResponseStatus:200}}, orderBy:[datetimeMinute_ASC])"
        "{count dimensions{datetimeMinute} quantiles{originResponseDurationMsP95}}"
        f" hourly: httpRequestsAdaptiveGroups(limit:500, filter:{{{span}, cacheStatus:\"dynamic\", edgeResponseStatus:200}}, orderBy:[datetimeHour_ASC])"
        "{count dimensions{datetimeHour} quantiles{originResponseDurationMsP50 originResponseDurationMsP95}}"
        "}}}"
    )


# ── pure: turning Cloudflare's rows into the report ───────────────────────────

def _minute(stamp: str) -> int:
    return int(dt.datetime.strptime(stamp[:16], "%Y-%m-%dT%H:%M").replace(tzinfo=dt.timezone.utc).timestamp() // 60)


def gaps(gateway_rows: list[dict], threshold: int = GAP_MINUTE_ERRORS) -> list[dict]:
    """Runs of consecutive minutes with at least `threshold` gateway errors."""
    minutes = sorted((_minute(r["dimensions"]["datetimeMinute"]), r["count"]) for r in gateway_rows if r["count"] >= threshold)
    out: list[dict] = []
    for minute, count in minutes:
        if out and minute - out[-1]["_last"] <= 1:
            out[-1]["_last"], out[-1]["errors"] = minute, out[-1]["errors"] + count
        else:
            out.append({"_first": minute, "_last": minute, "errors": count})
    for g in out:
        g["start"] = dt.datetime.fromtimestamp(g["_first"] * 60, dt.timezone.utc).strftime("%Y-%m-%d %H:%M")
        g["minutes"] = g["_last"] - g["_first"] + 1
        del g["_first"], g["_last"]
    return out


def summarize(zone_data: dict, since: str, until: str) -> dict:
    """Everything the report says, as plain numbers."""
    total = sum(r["count"] for r in zone_data.get("all") or [])
    errors = sum(r["count"] for r in zone_data.get("errors") or [])
    gateway_rows = zone_data.get("gateway") or []
    gateway_total = sum(r["count"] for r in gateway_rows)
    found = gaps(gateway_rows)
    slow_minutes = [r for r in zone_data.get("slow") or []
                    if (r.get("quantiles") or {}).get("originResponseDurationMsP95", 0) > SLOW_MS]
    hours = []
    for r in zone_data.get("hourly") or []:
        hour = r["dimensions"]["datetimeHour"][:13]
        q = r.get("quantiles") or {}
        hours.append({"hour": hour.replace("T", " ") + ":00", "requests": r["count"],
                      "p50_ms": round(q.get("originResponseDurationMsP50") or 0),
                      "p95_ms": round(q.get("originResponseDurationMsP95") or 0),
                      "minutes_over_1s": sum(1 for m in slow_minutes if m["dimensions"]["datetimeMinute"][:13] == hour)})
    return {
        "since": since, "until": until,
        "requests": total,
        "server_errors": errors,
        "success_pct": round(100 * (1 - errors / total), 3) if total else None,
        "gateway_errors": gateway_total,
        "gaps": len(found),
        "gap_minutes": sum(g["minutes"] for g in found),
        "longest_gap_minutes": max((g["minutes"] for g in found), default=0),
        "gateway_errors_inside_gaps_pct": round(100 * sum(g["errors"] for g in found) / gateway_total, 1) if gateway_total else None,
        "minutes_over_1s": len(slow_minutes),
        "worst_hour": max(hours, key=lambda h: h["p95_ms"], default=None),
        "gap_list": found,
        "hours": hours,
    }


def render(s: dict) -> str:
    if not s["requests"]:
        return f"{s['since']} to {s['until']}: Cloudflare reports no requests in this window."
    lines = [
        f"Reliability, {s['since']} to {s['until']} (UTC)",
        f"  requests            {s['requests']:,}",
        f"  succeeded           {s['success_pct']}%   ({s['server_errors']:,} server errors)",
        f"  gateway errors      {s['gateway_errors']:,}   (the server was not there)",
        f"  gaps                {s['gaps']}   ({s['gap_minutes']} minutes in all, longest {s['longest_gap_minutes']})"
        + (f"; {s['gateway_errors_inside_gaps_pct']}% of gateway errors fall inside them" if s["gaps"] else ""),
        f"  minutes with server p95 over 1 s   {s['minutes_over_1s']}",
    ]
    if s["worst_hour"]:
        w = s["worst_hour"]
        lines.append(f"  slowest hour        {w['hour']}: p95 {w['p95_ms']:,} ms, {w['minutes_over_1s']} of 60 minutes over 1 s")
    if s["gap_list"]:
        lines.append("  gaps (start UTC, minutes, gateway errors):")
        lines += [f"    {g['start']}  {g['minutes']:>2}  {g['errors']:,}" for g in s["gap_list"][:40]]
    slow_hours = [h for h in s["hours"] if h["minutes_over_1s"] >= 10]
    if slow_hours:
        lines.append("  hours with 10 or more minutes over 1 s (hour UTC, minutes, p95 ms):")
        lines += [f"    {h['hour']}  {h['minutes_over_1s']:>2}  {h['p95_ms']:,}" for h in slow_hours]
    return "\n".join(lines)


# ── Cloudflare ────────────────────────────────────────────────────────────────

class CouldNotMeasure(RuntimeError):
    pass


def fetch(query: str, token: str) -> dict:
    req = urllib.request.Request(API, data=json.dumps({"query": query}).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json",
                                          "Accept": "application/json", "User-Agent": "uct-reliability-scoreboard/1"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            answer = json.loads(r.read())
    except urllib.error.HTTPError as exc:
        raise CouldNotMeasure(f"Cloudflare answered {exc.code}: check the token's permissions (Zone Analytics Read)") from exc
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise CouldNotMeasure(f"Cloudflare could not be reached ({type(exc).__name__})") from exc
    if answer.get("errors"):
        raise CouldNotMeasure("Cloudflare refused the query: " + json.dumps(answer["errors"])[:300])
    zones = ((answer.get("data") or {}).get("viewer") or {}).get("zones") or []
    if not zones:
        raise CouldNotMeasure("Cloudflare returned no zone: check CLOUDFLARE_ZONE_ID and that the token covers that zone")
    return zones[0]


def self_check(out=print) -> int:
    def row(minute: int, count: int, p95: float | None = None) -> dict:
        stamp = (dt.datetime(2026, 11, 13, 15, 0, tzinfo=dt.timezone.utc) + dt.timedelta(minutes=minute)).strftime("%Y-%m-%dT%H:%M:%SZ")
        r = {"count": count, "dimensions": {"datetimeMinute": stamp, "datetimeHour": stamp[:13] + ":00:00Z"}}
        if p95 is not None:
            r["quantiles"] = {"originResponseDurationMsP95": p95, "originResponseDurationMsP50": p95 / 4}
        return r
    data = {
        "all": [row(m, 500) for m in range(120)],
        "errors": [row(10, 60), row(11, 40), row(50, 3), row(70, 30)],
        "gateway": [row(10, 60), row(11, 40), row(50, 3), row(70, 30)],
        "slow": [row(m, 400, 1500 if m < 20 else 300) for m in range(120)],
        "hourly": [dict(row(0, 24000, 1400), dimensions={"datetimeHour": "2026-11-13T15:00:00Z"}),
                   dict(row(60, 24000, 310), dimensions={"datetimeHour": "2026-11-13T16:00:00Z"})],
    }
    s = summarize(data, "2026-11-13T15:00:00Z", "2026-11-13T17:00:00Z")
    cases = [
        ("two adjacent bad minutes are one gap, a lone bad minute is another", s["gaps"] == 2 and s["gap_minutes"] == 3),
        ("three errors in a minute is not a gap", all(g["errors"] != 3 for g in s["gap_list"])),
        ("success is counted from server errors", s["success_pct"] == round(100 * (1 - 133 / 60000), 3)),
        ("errors inside gaps: 130 of 133", s["gateway_errors_inside_gaps_pct"] == 97.7),
        ("minutes over one second are counted", s["minutes_over_1s"] == 20),
        ("the slow hour is named", s["worst_hour"]["hour"] == "2026-11-13 15:00" and s["worst_hour"]["minutes_over_1s"] == 20),
        ("a quiet window says so", "no requests" in render(summarize({}, "a", "b"))),
        ("the window is whole hours", window(24, dt.datetime(2026, 11, 14, 10, 37, tzinfo=dt.timezone.utc))
         == ("2026-11-13T10:00:00Z", "2026-11-14T10:00:00Z")),
    ]
    ok = all(passed for _, passed in cases)
    for label, passed in cases:
        out(f"  {'ok  ' if passed else 'FAIL'} {label}")
    out("self-check passed" if ok else "self-check FAILED")
    return 0 if ok else 1


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--hours", type=int, default=24)
    p.add_argument("--history", help="append one JSON line per run to this file")
    p.add_argument("--json", action="store_true", help="print the numbers as JSON instead of the report")
    p.add_argument("--print-query", action="store_true")
    p.add_argument("--self-check", action="store_true")
    args = p.parse_args(argv)
    if args.self_check:
        return self_check()
    since, until = window(args.hours)
    zone = (os.environ.get("CLOUDFLARE_ZONE_ID") or "").strip()
    if args.print_query:
        print(build_query(zone or "<CLOUDFLARE_ZONE_ID>", since, until))
        return 0
    token = (os.environ.get("CLOUDFLARE_ANALYTICS_TOKEN") or "").strip()
    if not token or not zone:
        print("COULD NOT MEASURE: set CLOUDFLARE_ANALYTICS_TOKEN (a read-only token) and CLOUDFLARE_ZONE_ID")
        return 2
    try:
        summary = summarize(fetch(build_query(zone, since, until), token), since, until)
    except CouldNotMeasure as exc:
        print(f"COULD NOT MEASURE: {exc}")
        return 2
    print(json.dumps(summary, indent=1) if args.json else render(summary))
    if args.history:
        line = {k: v for k, v in summary.items() if k not in ("gap_list", "hours")}
        line["measured_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(args.history, "a", encoding="utf-8") as f:
            f.write(json.dumps(line) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
