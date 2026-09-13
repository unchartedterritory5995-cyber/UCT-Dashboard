"""Search a Railway environment's logs across EVERY deployment and service, in a few calls.

    python tools/railway_env_logs.py --filter '"fetch failed"' \
        --since 2026-08-30T00:00:00Z --until 2026-09-13T23:59:59Z --out flow_failed.jsonl \
        --control-filter '"fetch failed AMD"' --control-at 2026-09-11T14:46:00Z

⭐ WHY THIS AND NOT A PER-DEPLOYMENT LOOP. Railway's API budget is
`ratelimit-policy: "default";q=1000;w=3600` — 1,000 requests an hour (read off a response
header, 2026-09-13). `web` had 1,077 deployments in the 14-day window, so asking each
deployment for its logs costs an hour's quota PER FILTER; the first such run lost 755
deployments to HTTP 429, and where it did succeed it still found one `[flow] fetch failed`
line in a fortnight that holds at least seven.

⛔⛔ THE PAGING FORM IS MEASURED, NOT ASSUMED. `environmentLogs(beforeDate:…, beforeLimit:…)`
returns ZERO rows for any date — including for "hot warm hit", which has thousands of
matches (probed 2026-09-13, four forms side by side). Only `anchorDate` + `beforeLimit`
+ `afterLimit: 0` returns rows, and the page INCLUDES the anchor row (limit 5 -> 6 rows).
The first version of this tool used `beforeDate`, reported "wrote 0 line(s)" and exited 0
for eight filters, and its unit test passed because the fake implemented the same wrong
assumption. So:
  * pages use `anchorDate`, stepping back to the oldest row seen (the overlap is deduped);
  * `--control-filter/--control-at` runs a KNOWN POSITIVE through the same query form
    first — if it comes back empty the run exits 2 (INCONCLUSIVE) and writes nothing,
    because a search that cannot find a line it knows exists cannot report a zero.

Filter syntax is Railway's: phrases in double quotes, OR/AND/-, and NO brackets (a
bracketed phrase matches nothing — refused). Read-only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import discord_render_forensics as forensics  # noqa: E402  (429-aware gql, project/env ids)

QUERY = """query($env:String!,$f:String,$anchor:String,$limit:Int){
  environmentLogs(environmentId:$env, filter:$f, anchorDate:$anchor, beforeLimit:$limit, afterLimit:0){
    timestamp message severity tags{deploymentId serviceId}}}"""

EXIT_OK, EXIT_INCONCLUSIVE = 0, 2


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def service_names(gql=None) -> dict[str, str]:
    gql = gql or forensics.gql
    data = gql("query($id:String!){project(id:$id){services{edges{node{id name}}}}}", {"id": forensics.PROJECT_ID})
    return {e["node"]["id"]: e["node"]["name"] for e in data["project"]["services"]["edges"]}


def control(filter_: str, at: str, gql=None) -> int:
    """Rows a known-positive search returns through the SAME query form as the real search."""
    gql = gql or forensics.gql
    rows = gql(QUERY, {"env": forensics.ENVIRONMENT_ID, "f": filter_, "anchor": at, "limit": 5})["environmentLogs"]
    return len(rows or [])


def fetch(filter_: str, since: str, until: str, page: int = 1000, sleep_ms: int = 250,
          gql=None, log=print) -> list[dict]:
    """All matching lines with since <= timestamp <= until, oldest first."""
    gql = gql or forensics.gql
    # No clamp on a future --until: measured 2026-09-13, `anchorDate` 2099-01-01 returns the
    # newest rows exactly like "now" does. (Only the abandoned `beforeDate` form returned
    # nothing.) A clamp here would be a guard with nothing to guard, and its test could not fail.
    cursor = until
    seen: set = set()
    out: list[dict] = []
    calls = 0
    last_oldest = None
    while True:
        rows = gql(QUERY, {"env": forensics.ENVIRONMENT_ID, "f": filter_, "anchor": cursor, "limit": page})["environmentLogs"]
        calls += 1
        if not rows:
            if calls == 1:
                log("  first page EMPTY for this filter (legitimate only if the control passed)")
            break
        fresh = 0
        for r in rows:
            ts = r.get("timestamp") or ""
            if ts < since or ts > until:
                continue
            tags = r.get("tags") or {}
            key = (ts, tags.get("deploymentId"), r.get("message"))
            if key in seen:
                continue
            seen.add(key)
            out.append({"timestamp": ts, "deploymentId": tags.get("deploymentId"),
                        "serviceId": tags.get("serviceId"), "severity": r.get("severity"),
                        "message": r.get("message")})
            fresh += 1
        oldest = min(r.get("timestamp") or "" for r in rows)
        log(f"  page {calls}: {len(rows)} row(s), {fresh} new, oldest {oldest[:19]}")
        if oldest < since:
            break
        if oldest == last_oldest and fresh == 0:
            # ⛔ No progress: a page made entirely of lines at one timestamp we have already
            # seen. Stop and SAY so, rather than loop or silently truncate.
            log(f"  STOPPED: no progress past {oldest}; results before it may be missing")
            break
        last_oldest = oldest
        cursor = oldest
        if sleep_ms:
            time.sleep(sleep_ms / 1000.0)
    out.sort(key=lambda r: r["timestamp"])
    log(f"  {len(out)} line(s) in {calls} call(s)")
    return out


def main(argv=None, gql=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--filter", required=True)
    ap.add_argument("--since", required=True, help="ISO timestamp, e.g. 2026-08-30T00:00:00Z")
    ap.add_argument("--until", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--page", type=int, default=1000)
    ap.add_argument("--sleep-ms", type=int, default=250)
    ap.add_argument("--control-filter", default=None, help="a phrase KNOWN to exist, searched first")
    ap.add_argument("--control-at", default=None, help="an ISO timestamp just after the known line")
    args = ap.parse_args(argv)
    if any(ch in args.filter for ch in "[]") or any(ch in (args.control_filter or "") for ch in "[]"):
        raise SystemExit("refusing a filter containing [ or ]: Railway search matches nothing for it")
    if args.control_filter:
        n = control(args.control_filter, args.control_at or _now_iso(), gql=gql)
        print(f"control {args.control_filter!r} @ {args.control_at}: {n} row(s)", file=sys.stderr)
        if n == 0:
            print("INCONCLUSIVE: the known positive was not found through this query form; nothing written",
                  file=sys.stderr)
            return EXIT_INCONCLUSIVE
    names = service_names(gql=gql)
    rows = fetch(args.filter, args.since, args.until, page=args.page, sleep_ms=args.sleep_ms, gql=gql,
                 log=lambda m: print(m, file=sys.stderr))
    with open(args.out, "w", encoding="utf-8") as fh:
        for r in rows:
            r["service"] = names.get(r.get("serviceId"), r.get("serviceId"))
            fh.write(json.dumps(r) + "\n")
    print(f"wrote {len(rows)} line(s) -> {args.out}", file=sys.stderr)
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
