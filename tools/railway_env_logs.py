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
    """All matching lines with since <= timestamp <= until, oldest first.

    The returned list carries `.exact` on the way out via `fetch.last_exact`: True when the
    pager reached the end of the data, False when it stalled on a full page and the result is
    therefore a FLOOR. ⛔ A caller that reports a count without reading it is reporting a
    number it cannot stand behind."""
    gql = gql or forensics.gql
    # No clamp on a future --until: measured 2026-09-13, `anchorDate` 2099-01-01 returns the
    # newest rows exactly like "now" does. (Only the abandoned `beforeDate` form returned
    # nothing.) A clamp here would be a guard with nothing to guard, and its test could not fail.
    cursor = until
    exact = True
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
            # ⛔⛔ TWO DIFFERENT THINGS LOOK IDENTICAL HERE, AND CALLING BOTH "STOPPED" MADE EVERY
            # COUNT A FLOOR. A page with nothing new is either (a) the end of the data — the API
            # had nothing more to give at this anchor — or (b) a cluster of lines sharing one
            # timestamp that is wider than `page`, where paging really cannot advance.
            #
            # ⭐ THE DISCRIMINATOR IS WHETHER THE PAGE CAME BACK FULL. An UNDER-FULL page means the
            # API returned everything it had, so there is nothing beyond it and the pull is EXACT.
            # Only a FULL page that failed to advance is a genuine stall.
            #
            # ⚰️ Before this, a complete 8-row pull printed "results before it may be missing", the
            # Monday shadow line had to report `>= 8` instead of `8`, and "nobody ran /chart" could
            # not be separated from "the pager stopped early". An instrument that cannot say
            # whether it saw everything turns every absence into an open question.
            if len(rows) < page:
                log(f"  EXHAUSTED at {oldest}: the API returned {len(rows)} of a requested {page}, "
                    f"so there is nothing older to fetch — this pull is EXACT")
            else:
                exact = False
                log(f"  STOPPED: no progress past {oldest} on a FULL page of {len(rows)}; "
                    f"results before it may be missing — this pull is a FLOOR")
            break
        last_oldest = oldest
        cursor = oldest
        if sleep_ms:
            time.sleep(sleep_ms / 1000.0)
    out.sort(key=lambda r: r["timestamp"])
    fetch.last_exact = exact
    log(f"  {len(out)} line(s) in {calls} call(s) — {'EXACT' if exact else 'A FLOOR'}")
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
    exact = bool(getattr(fetch, "last_exact", True))
    with open(args.out, "w", encoding="utf-8") as fh:
        # ⛔⛔ THE FIRST LINE SAYS WHETHER THE COUNT BELOW IT IS A COUNT OR A FLOOR, so a reader
        # cannot quote a number the pull could not stand behind. It travels IN the file rather
        # than on stderr because stderr is not what gets read a week later — and a consumer that
        # does not know about it simply fails to parse one line, which every consumer already
        # tolerates (they scan for their own shape).
        fh.write(json.dumps({"_meta": {"exact": exact, "count": len(rows), "filter": args.filter,
                                       "since": args.since, "until": args.until}}) + "\n")
        for r in rows:
            r["service"] = names.get(r.get("serviceId"), r.get("serviceId"))
            fh.write(json.dumps(r) + "\n")
    print(f"wrote {len(rows)} line(s) -> {args.out} "
          f"({'EXACT' if exact else 'A FLOOR — do not quote this as a count'})", file=sys.stderr)
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
