"""UCT Agent — latency TELEMETRY report (read-only, aggregate-only). For the owner to run where the
Agent's database lives (production: the web service's /data/uct_agent.db):

  railway ssh --service web "python tools/agent_latency_telemetry.py"            # last 14 days
  python tools/agent_latency_telemetry.py --db path/to/uct_agent.db --days 30

Opens the database READ-ONLY and prints only counts, percentiles and costs per path / disposition /
action — never a conversation, a member id, a reply or a value. `agent_telemetry` carries no text by
design (store.py).

What the numbers mean:
  * path routed | model | reroute (server rows): latency_ms = the server's model time for that turn
    (all model calls + research). A `reroute` row is the SECOND full turn of a routing miss.
  * path fast | local | model | approved | followup (browser rows, from 2026-10-12): latency_ms = the
    browser's time from Enter (or the click) to the first useful output — receipt, answer, question,
    proposal or refusal. Rows recorded before that build have no latency.
  * The server's per-stage timings (pre / build / model[] / research / post) are in the web service's
    log lines "[uct-agent] turn timing {...}" — numbers only.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import time
from collections import defaultdict


def pct(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * p
    f = int(k)
    c = min(f + 1, len(xs) - 1)
    return round(xs[f] + (xs[c] - xs[f]) * (k - f))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="/data/uct_agent.db")
    ap.add_argument("--days", type=float, default=14)
    a = ap.parse_args()
    c = sqlite3.connect(f"file:{a.db}?mode=ro", uri=True)
    since = int(time.time() - a.days * 86400)
    rows = c.execute("SELECT path, disposition, actions, refused, clarified, undo, latency_ms, model, cost_usd, "
                     "research_calls FROM agent_telemetry WHERE created_at >= ?", (since,)).fetchall()
    print(f"rows={len(rows)} days={a.days}")
    groups = defaultdict(list)
    for r in rows:
        groups[(r[0] or "?", r[1] or "?")].append(r)
    print("path|disposition|n|with_latency|p50_ms|p90_ms|p95_ms|max_ms|research_turns|cost_mean_usd|cost_sum_usd")
    for (path, disp), rs in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        lat = [r[6] for r in rs if isinstance(r[6], int)]
        cost = [r[8] for r in rs if isinstance(r[8], (int, float))]
        print(f"{path}|{disp}|{len(rs)}|{len(lat)}|{pct(lat, .5)}|{pct(lat, .9)}|{pct(lat, .95)}|{max(lat) if lat else None}|"
              f"{sum(1 for r in rs if r[9])}|{round(sum(cost) / len(cost), 5) if cost else None}|{round(sum(cost), 4) if cost else None}")
    server = [r for r in rows if r[0] in ("routed", "model", "reroute") and isinstance(r[6], int)]
    for label, sub in (("server_model_all", server), ("server_no_research", [r for r in server if not r[9]]),
                       ("server_research", [r for r in server if r[9]])):
        lat = [r[6] for r in sub]
        print(f"{label}: n={len(lat)} p50={pct(lat, .5)} p90={pct(lat, .9)} p95={pct(lat, .95)}")
    reroutes = sum(1 for r in rows if r[0] == "reroute")
    routed = sum(1 for r in rows if r[0] in ("routed", "model"))
    print(f"reroute_rate={round(reroutes / routed, 3) if routed else None} (second full turns per first turn)")
    by_action = defaultdict(list)
    for r in rows:
        if isinstance(r[6], int):
            for act in json.loads(r[2] or "[]")[:1]:
                by_action[(r[0], act)].append(r[6])
    print("path|first_action|n|p50_ms|p95_ms")
    for (path, act), lat in sorted(by_action.items(), key=lambda kv: -len(kv[1]))[:40]:
        print(f"{path}|{act}|{len(lat)}|{pct(lat, .5)}|{pct(lat, .95)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
