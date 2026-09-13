"""Discord render forensics — reconstruct what the chart/flow commands did, from
Railway's own logs, across EVERY deployment in a window.

    python tools/discord_render_forensics.py fetch-logs --service web \
        --since 2026-08-30 --filter '"discord-chart"' --out web_chart.jsonl
    python tools/discord_render_forensics.py fetch-http --service web \
        --since 2026-08-30 --path /api/discord/interactions --out web_http.jsonl
    python tools/discord_render_forensics.py summarize-web web_chart.jsonl web_flow.jsonl
    python tools/discord_render_forensics.py summarize-renderer renderer.jsonl
    python tools/discord_render_forensics.py summarize-http web_http.jsonl

⛔ WHY THIS EXISTS: `railway logs --since 14d` answers from ONE deployment — the
latest successful one — and says nothing about the rest. `web` redeploys on every
master push (20 times on 2026-09-13 before 10:00 ET), so on a normal afternoon that
command returns a few lines and reads exactly like "nothing happened". The CLI's
`deployment list` is capped at the newest 20. The only complete read is the GraphQL
API: enumerate the deployments, then ask each one for its logs. Measured while
building Phase 0 of docs/discord-render/.

Auth is the Railway CLI's own session (see tools/railway_watch_patterns.py for the
precedence and the x-source/user-agent requirement). Read-only: every call here is
a query.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import railway_watch_patterns as rw  # noqa: E402

PROJECT_ID = rw.PROJECT_ID
ENVIRONMENT_ID = os.environ.get("RAILWAY_ENVIRONMENT_ID", "4c2149a7-d7bd-4bf9-9a4c-a879a5800067")
PAGE_LIMIT = 5000                      # deploymentLogs refuses larger ("Error in limit")


def gql(query: str, variables: dict | None = None) -> dict:
    """One GraphQL call. Raises RuntimeError with the reason when every credential fails."""
    last = ""
    heads = rw._auth_headers()
    if not heads:
        raise RuntimeError("no Railway credential (log the CLI in)")
    for attempt, h in enumerate(list(heads) + list(heads)):
        try:
            req = urllib.request.Request(
                rw.API, data=json.dumps({"query": query, "variables": variables or {}}).encode(),
                headers={"Content-Type": "application/json", "x-source": rw._UA, "User-Agent": rw._UA, **h})
            body = json.loads(urllib.request.urlopen(req, timeout=90).read().decode())
            if body.get("errors"):
                last = "GraphQL errors: %s" % json.dumps(body["errors"][:1])[:300]
                time.sleep(1.0 + attempt)
                continue
            return body["data"]
        except urllib.error.HTTPError as e:
            last = "HTTP %s" % e.code
            time.sleep(1.0 + attempt)
        except Exception as e:  # noqa: BLE001
            last = type(e).__name__
            time.sleep(1.0 + attempt)
    raise RuntimeError(last or "unknown GraphQL failure")


def service_id(name: str) -> str:
    data = gql("query($id:String!){project(id:$id){services{edges{node{id name}}}}}", {"id": PROJECT_ID})
    for e in data["project"]["services"]["edges"]:
        if e["node"]["name"] == name:
            return e["node"]["id"]
    raise SystemExit(f"no service named {name!r}")


def deployments(svc_name: str, since: str) -> list[dict]:
    """Every deployment of the service created at/after `since` (ISO date), newest first."""
    sid = service_id(svc_name)
    out, after = [], None
    q = """query($input:DeploymentListInput!,$after:String){
      deployments(first:100, after:$after, input:$input){
        pageInfo{hasNextPage endCursor}
        edges{node{id status createdAt statusUpdatedAt meta}}}}"""
    while True:
        data = gql(q, {"input": {"projectId": PROJECT_ID, "environmentId": ENVIRONMENT_ID,
                                 "serviceId": sid, "includeDeleted": True}, "after": after})
        conn = data["deployments"]
        stop = False
        for e in conn["edges"]:
            n = e["node"]
            if n["createdAt"] < since:
                stop = True
                break
            out.append(n)
        if stop or not conn["pageInfo"]["hasNextPage"]:
            return out
        after = conn["pageInfo"]["endCursor"]


def _commit(meta) -> str:
    if isinstance(meta, dict):
        return str(meta.get("commitHash") or "")[:10]
    return ""


def fetch_logs(args) -> int:
    # ⛔ Railway's log search silently matches NOTHING for a phrase containing
    # brackets: `"[flow]"` returned 0 rows on a deployment whose log held
    # `[flow] …` lines, while `flow` matched (measured 2026-09-13). An empty file
    # from a filter that could never match reads exactly like "no failures", so
    # refuse the filter instead of writing that file.
    if args.filter and any(ch in args.filter for ch in "[]"):
        raise SystemExit("refusing a filter containing [ or ]: Railway search matches nothing for it. "
                         "Filter on a word from the message and post-filter the prefix.")
    deps = deployments(args.service, args.since)
    live = [d for d in deps if d["status"] not in ("SKIPPED",)]
    print(f"{args.service}: {len(deps)} deployments since {args.since} ({len(live)} not SKIPPED)", file=sys.stderr)
    q = """query($d:String!,$f:String,$l:Int,$end:DateTime){
      deploymentLogs(deploymentId:$d, filter:$f, limit:$l, endDate:$end){timestamp message severity}}"""
    total = 0
    with open(args.out, "w", encoding="utf-8") as fh:
        for d in live:
            end = None
            seen = set()
            for _page in range(40):
                try:
                    rows = gql(q, {"d": d["id"], "f": args.filter, "l": PAGE_LIMIT, "end": end})["deploymentLogs"]
                except RuntimeError as e:
                    print(f"  {d['id']} {d['createdAt']}: FAILED {e}", file=sys.stderr)
                    fh.write(json.dumps({"deployment": d["id"], "created": d["createdAt"],
                                         "fetch_error": str(e)}) + "\n")
                    break
                fresh = [r for r in rows if (r["timestamp"], r["message"]) not in seen]
                for r in fresh:
                    seen.add((r["timestamp"], r["message"]))
                    fh.write(json.dumps({"deployment": d["id"], "created": d["createdAt"],
                                         "commit": _commit(d.get("meta")), **r}) + "\n")
                total += len(fresh)
                if len(rows) < PAGE_LIMIT or not fresh:
                    break
                end = min(r["timestamp"] for r in rows)
            print(f"  {d['createdAt'][:19]} {d['status']:8} {_commit(d.get('meta'))} rows={len(seen)}", file=sys.stderr)
    print(f"wrote {total} rows -> {args.out}", file=sys.stderr)
    return 0


def fetch_http(args) -> int:
    deps = [d for d in deployments(args.service, args.since) if d["status"] != "SKIPPED"]
    q = """query($d:String!,$f:String,$l:Int,$before:String){
      httpLogs(deploymentId:$d, filter:$f, limit:$l, beforeDate:$before){
        timestamp method path httpStatus totalDuration upstreamRqDuration upstreamErrors requestId responseDetails txBytes}}"""
    total = 0
    with open(args.out, "w", encoding="utf-8") as fh:
        for d in deps:
            before, seen = None, set()
            for _page in range(40):
                try:
                    rows = gql(q, {"d": d["id"], "f": f"@path:{args.path}", "l": PAGE_LIMIT, "before": before})["httpLogs"]
                except RuntimeError as e:
                    fh.write(json.dumps({"deployment": d["id"], "created": d["createdAt"], "fetch_error": str(e)}) + "\n")
                    print(f"  {d['id']}: FAILED {e}", file=sys.stderr)
                    break
                fresh = [r for r in rows if r["requestId"] not in seen]
                for r in fresh:
                    seen.add(r["requestId"])
                    fh.write(json.dumps({"deployment": d["id"], "created": d["createdAt"], **r}) + "\n")
                total += len(fresh)
                if len(rows) < PAGE_LIMIT or not fresh:
                    break
                before = min(r["timestamp"] for r in rows)
            print(f"  {d['createdAt'][:19]} rows={len(seen)}", file=sys.stderr)
    print(f"wrote {total} rows -> {args.out}", file=sys.stderr)
    return 0


# ── classification ──────────────────────────────────────────────────────────
# Each pattern is matched against the log MESSAGE. The class names are the ones
# docs/discord-render/01-failure-forensics.md uses; keep them in step.
WEB_CLASSES = [
    ("edit_refused_components", r"edit_original HTTP \d+ with components"),
    ("attachment_refused", r"attachment refused"),
    ("edit_failed_http", r"edit_original HTTP \d+:"),
    ("edit_failed_exception", r"edit_original failed"),
    ("house_blank_body", r"house render body BLANK"),
    ("house_too_few_bars", r"house render drew \d+ bar"),
    ("house_http_error", r"house render HTTP \d+"),
    ("house_non_png", r"house render returned non-PNG"),
    ("house_exception", r"house render (failed|raised)"),
    ("standin_delivered", r"stand-in delivered"),
    ("standin_heal", r"stand-in heal (\w+)"),
    ("kept_fast_chart", r"keeping the fast chart"),
    ("fast_preview_failed", r"fast preview failed"),
    ("bars_failed", r"bars failed"),
    ("bars_gate_timeout", r"warm gate timed out"),
    ("render_failed_fallback", r"\[discord-chart\] render failed"),
    ("job_crashed", r"job crashed|multi job failed"),
    ("heal_crashed", r"heal crashed"),
    ("context_failed", r"context (line|edit) failed"),
    ("ext_quote_failed", r"ext quote (lookup )?failed"),
    ("autocomplete_failed", r"autocomplete failed"),
    ("read_back_failed", r"read-back (HTTP|failed)"),
    ("followup_failed", r"followup (HTTP|failed)"),
    ("prefs_failed", r"prefs read failed|settings failed|save-defaults failed"),
    ("hot_warm_deferred", r"hot warm hit its"),
    ("hot_warm_failed", r"hot warm (failed|cycle failed)"),
    ("darkpool_zones_failed", r"dark-pool zones failed"),
    ("flow_fetch_failed", r"\[flow\] fetch failed"),
    ("flow_render_failed", r"\[flow\] render failed"),
    ("buzz_render_failed", r"\[buzz\] image render failed"),
    ("guild_refused", r"discord interaction refused"),
]
_NOISE = re.compile(r"warmed \d+ hot chart|roster seeded|hot-warm scheduled|chart-renderer-warm\] SPY")


def _load(paths):
    for p in paths:
        with open(p, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    try:
                        yield json.loads(line)
                    except ValueError:
                        continue


def _line_ts(row) -> str:
    """The log line's OWN timestamp when it carries one. Railway's ingest
    `timestamp` is batched (measured 2026-08-29: parsing it made a 0.01 s job look
    like 146 s), so the stamp python's logging wrote wins."""
    m = re.match(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})", row.get("message", ""))
    return m.group(1).replace(" ", "T") if m else str(row.get("timestamp", ""))[:19]


def _to_et(ts_utc: str) -> str:
    try:
        from zoneinfo import ZoneInfo
        t = dt.datetime.fromisoformat(ts_utc[:19]).replace(tzinfo=dt.timezone.utc)
        return t.astimezone(ZoneInfo("America/New_York")).strftime("%Y-%m-%d %H:%M:%S ET")
    except Exception:  # noqa: BLE001
        return ts_utc


def summarize_web(args) -> int:
    counts = collections.Counter()
    by_day = collections.defaultdict(collections.Counter)
    samples = collections.defaultdict(list)
    fetch_errors = 0
    for row in _load(args.paths):
        if "fetch_error" in row:
            fetch_errors += 1
            continue
        msg = row.get("message", "")
        if _NOISE.search(msg):
            continue
        cls = next((name for name, pat in WEB_CLASSES if re.search(pat, msg)), "unclassified")
        counts[cls] += 1
        ts = _line_ts(row)
        by_day[ts[:10]][cls] += 1
        if len(samples[cls]) < args.samples:
            samples[cls].append((_to_et(ts), row.get("commit", ""), msg[:300]))
    print(f"fetch errors: {fetch_errors}")
    for cls, n in counts.most_common():
        print(f"{n:6}  {cls}")
    print("\nby day (UTC):")
    for day in sorted(by_day):
        print(" ", day, dict(by_day[day].most_common()))
    print("\nsamples:")
    for cls, rows in samples.items():
        print(f"-- {cls}")
        for ts, commit, msg in rows:
            print(f"   {ts} [{commit}] {msg}")
    return 0


def summarize_renderer(args) -> int:
    status = collections.Counter()
    by_day = collections.defaultdict(collections.Counter)
    launches = 0
    for row in _load(args.paths):
        msg = row.get("message", "")
        day = str(row.get("timestamp", ""))[:10]
        m = re.search(r'"POST /render HTTP/1\.1" (\d{3})', msg)
        if m:
            status[m.group(1)] += 1
            by_day[day]["http_" + m.group(1)] += 1
        elif "ready predicate timed out" in msg:
            by_day[day]["ready_timeout"] += 1
            status["ready_timeout"] += 1
        elif "Page.goto: Timeout" in msg:
            by_day[day]["goto_timeout"] += 1
            status["goto_timeout"] += 1
        elif "chromium launched" in msg:
            launches += 1
    print("totals:", dict(status), "chromium launches:", launches)
    for day in sorted(by_day):
        print(" ", day, dict(by_day[day]))
    return 0


def summarize_http(args) -> int:
    rows = [r for r in _load(args.paths) if "fetch_error" not in r]
    durs = sorted(float(r.get("totalDuration") or 0) for r in rows)
    status = collections.Counter(r.get("httpStatus") for r in rows)

    def pct(p):
        return durs[min(len(durs) - 1, int(p * (len(durs) - 1)))] if durs else None
    print(f"requests={len(rows)} status={dict(status)}")
    print(f"totalDuration ms: p50={pct(.5)} p95={pct(.95)} p99={pct(.99)} max={durs[-1] if durs else None}")
    slow = [r for r in rows if float(r.get("totalDuration") or 0) >= args.slow_ms]
    print(f">= {args.slow_ms} ms: {len(slow)}")
    for r in sorted(slow, key=lambda r: r["timestamp"])[: args.samples]:
        print("  ", _to_et(r["timestamp"]), r.get("httpStatus"), r.get("totalDuration"), r.get("upstreamRqDuration"),
              r.get("upstreamErrors"), r.get("responseDetails"))
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch-logs")
    f.add_argument("--service", required=True)
    f.add_argument("--since", required=True, help="ISO date, e.g. 2026-08-30")
    f.add_argument("--filter", default=None, help='Railway filter syntax, e.g. \'"discord-chart"\'')
    f.add_argument("--out", required=True)
    h = sub.add_parser("fetch-http")
    h.add_argument("--service", required=True)
    h.add_argument("--since", required=True)
    h.add_argument("--path", required=True)
    h.add_argument("--out", required=True)
    for name in ("summarize-web", "summarize-renderer", "summarize-http"):
        s = sub.add_parser(name)
        s.add_argument("paths", nargs="+")
        s.add_argument("--samples", type=int, default=6)
        s.add_argument("--slow-ms", type=float, default=2500.0)
    args = ap.parse_args(argv)
    return {"fetch-logs": fetch_logs, "fetch-http": fetch_http, "summarize-web": summarize_web,
            "summarize-renderer": summarize_renderer, "summarize-http": summarize_http}[args.cmd](args)


if __name__ == "__main__":
    raise SystemExit(main())
