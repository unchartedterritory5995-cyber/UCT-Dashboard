#!/usr/bin/env python
"""R64 AMENDED — the daily deploy-frequency cost line.

    python tools/deploy_frequency_cost_report.py [--days N]

R68 closed the mechanical fix (a readiness-gated healthcheck) as a platform floor:
`web` has a Railway volume mounted, and Railway does not overlap deploys for a
volume-attached service regardless of healthcheck config — confirmed from Railway's
own docs, quoted in `docs/runbooks/deploy-windows.md`. The measured cost of ONE
ordinary web-only swap is **82-119 s of `/api/*` 502s** (n=1, against a named deploy,
`2026-09-17-web-swap-blip-measured.md`) — a number the config cannot lower.

⭐ SO THE ONLY LEVER LEFT IS FREQUENCY, AND FREQUENCY IS NOT THIS PROGRAMME'S TO PULL.
This repo is shared by many concurrent workstreams pushing independently; each push is
individually legitimate under the 2026-08-24 "push whenever" ruling. What this report
does is make the AGGREGATE cost of that cadence visible — specifically the deploys
landing inside the window where a member is actually looking at the screen
(08:30-16:20 ET, matching the flow-worker forbidden window's bounds, since the
physics — a member using the site — is the same physics on both services) — so that
"batch independent Tier-1 pushes into fewer merges" can be offered as a cross-
workstream recommendation with a real number behind it, never imposed.

⛔ THIS REPORT NEVER GATES A PUSH. It is read-only, observational, and has no exit
code that means "refuse" — `tools/pre_push_guard.py` is the only gate, and R64 is not
a second one wearing a report's clothes.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import subprocess
import sys
import zoneinfo

# ⛔ Same reason as pre_push_guard.py's identical block: this box's console decodes
# stdout with cp1252, and an em-dash in a plain print() kills the run with a
# UnicodeEncodeError that reads like the report crashed rather than like a font issue.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ET = zoneinfo.ZoneInfo("America/New_York")
SERVICE = "web"

#: Matches R60's flow-worker forbidden window bounds — the physics (a member is
#: looking at the screen) is identical for both services; only the CONSEQUENCE
#: differs (web: a 502 blip; flow-worker: a permanent tape gap).
MARKET_WINDOW_START = dt.time(8, 30)
MARKET_WINDOW_END = dt.time(16, 20)

#: The measured range from a single named deploy. n=1 — this is NOT a confidence
#: interval, it is the one honest data point this programme has. Re-measure at
#: every named deploy until n >= 5, per the evidence file's own instruction, and
#: widen/replace this range then — never quietly narrow it to look more precise
#: than the evidence supports.
BLIP_LOW_S = 82.0
BLIP_HIGH_S = 119.0


def _railway() -> "str | None":
    return shutil.which("railway")


def read_deploys(service: str = SERVICE) -> "list[dict] | None":
    """Raw Railway deploy rows, or None if unreadable. Never raises — a caller
    that cannot read the list gets None and reports that honestly, the same
    UNREADABLE-never-a-pass discipline as `pre_push_guard.py`."""
    exe = _railway()
    if not exe:
        return None
    try:
        r = subprocess.run([exe, "deployment", "list", "--service", service, "--json"],
                           capture_output=True, text=True, timeout=120,
                           encoding="utf-8", errors="replace")
    except Exception:                                        # noqa: BLE001
        return None
    if r.returncode != 0:
        return None
    try:
        rows = json.loads(r.stdout)
    except Exception:                                        # noqa: BLE001
        return None
    return rows if isinstance(rows, list) else rows.get("deployments")


def _et_time(created_at: str) -> "dt.datetime | None":
    try:
        t = dt.datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        return t.astimezone(ET)
    except Exception:                                        # noqa: BLE001
        return None


def in_market_window(et_dt: dt.datetime) -> bool:
    return MARKET_WINDOW_START <= et_dt.time() <= MARKET_WINDOW_END


def compute_report(rows: "list[dict]", *, now: "dt.datetime | None" = None,
                   days: int = 1) -> dict:
    """PURE — the tests drive this directly, no CLI, no clock, no network.

    Counts every deploy in the trailing `days` calendar days (ET), splits into
    market-window vs outside, and reports low/high estimated total downtime for
    the market-window subset ONLY — a deploy at 2 AM ET costs the same 82-119 s,
    but nobody is looking, so it does not belong in a MEMBER-FACING cost line."""
    now = now or dt.datetime.now(ET)
    cutoff = now - dt.timedelta(days=days)
    in_window, out_window, unreadable_dates = [], [], 0
    for d in rows:
        et_dt = _et_time(d.get("createdAt") or "")
        if et_dt is None:
            unreadable_dates += 1
            continue
        if et_dt < cutoff:
            continue
        (in_window if in_market_window(et_dt) else out_window).append(d)
    n = len(in_window)
    return {
        "window_days": days,
        "as_of": now.isoformat(timespec="seconds"),
        "market_window": "%s-%s ET" % (MARKET_WINDOW_START.strftime("%H:%M"),
                                       MARKET_WINDOW_END.strftime("%H:%M")),
        "deploys_in_window": n,
        "deploys_outside_window": len(out_window),
        "deploys_unreadable_date": unreadable_dates,
        "blip_seconds_range": [BLIP_LOW_S, BLIP_HIGH_S],
        "blip_sample_size": 1,
        "estimated_member_facing_seconds_low": round(n * BLIP_LOW_S, 1),
        "estimated_member_facing_seconds_high": round(n * BLIP_HIGH_S, 1),
        "lever": "deploy frequency during the market window — not deploy mechanics "
                 "(R68: a volume-mounted service cannot overlap deploys, any config)",
        "recommendation": (
            "recommended, not imposed: batching independent Tier-1 pushes into fewer "
            "merges reduces this line linearly; this programme does not control other "
            "workstreams' push cadence") if n > 0 else "no market-window web deploys in this range",
    }


def _fmt(report: dict) -> str:
    return (
        "[deploy-cost] %s  window=%s  last %dd\n"
        "[deploy-cost]   web deploys in market window : %d\n"
        "[deploy-cost]   web deploys outside it        : %d\n"
        "[deploy-cost]   unreadable createdAt           : %d\n"
        "[deploy-cost]   estimated member-facing 502s   : %.0f-%.0f s "
        "(%.1f-%.1f min)  [n=%d sample behind the per-deploy figure]\n"
        "[deploy-cost]   lever: %s\n"
        "[deploy-cost]   %s"
        % (report["as_of"], report["market_window"], report["window_days"],
           report["deploys_in_window"], report["deploys_outside_window"],
           report["deploys_unreadable_date"],
           report["estimated_member_facing_seconds_low"],
           report["estimated_member_facing_seconds_high"],
           report["estimated_member_facing_seconds_low"] / 60,
           report["estimated_member_facing_seconds_high"] / 60,
           report["blip_sample_size"], report["lever"], report["recommendation"]))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--days", type=int, default=1, help="trailing calendar days to cover")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args([] if (argv is None and "pytest" in sys.modules) else argv)

    rows = read_deploys()
    if rows is None:
        print("[deploy-cost] UNREADABLE — the railway CLI is not on PATH, not linked, "
              "or returned no JSON. Reporting nothing rather than guessing.")
        return 1
    report = compute_report(rows, days=a.days)
    print(json.dumps(report, indent=1) if a.json else _fmt(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
