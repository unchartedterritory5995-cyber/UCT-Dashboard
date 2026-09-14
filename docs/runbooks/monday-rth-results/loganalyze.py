"""Analyse the captured flow-worker log stream.

Two questions:
  item 5 -- does "[flow-prepare] remainder warmed" appear on every roll?
  item 7 -- are MEMBER sessions requesting parts, or whole-D + data?days=1?

⛔ The access lines carry a client IP and a path, not a session identity. The
rig's own traffic is indistinguishable from a member's at this layer EXCEPT by
the windows in which the rig ran, so rig windows are reported separately and
never silently folded into the member ratio.
"""
from __future__ import annotations

import datetime
import json
import os
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
LOGS = os.path.join(HERE, "flowworker-log-stream.jsonl")
ET = datetime.timezone(datetime.timedelta(hours=-4))

ACCESS = re.compile(r'"(GET|POST) ([^"]+?) HTTP/1\.\d" (\d{3})')
PREPARE = re.compile(r"flow-prepare", re.I)
WARMED = re.compile(r"remainder warmed", re.I)


def to_et(ts):
    try:
        s = ts.replace("Z", "+00:00")
        if "." in s:
            head, rest = s.split(".", 1)
            frac = rest.split("+")[0][:6]
            s = head + "." + frac + "+00:00"
        return datetime.datetime.fromisoformat(s).astimezone(ET)
    except Exception:                                          # noqa: BLE001
        return None


def load():
    out = []
    if not os.path.exists(LOGS):
        return out
    for line in open(LOGS, encoding="utf-8", errors="replace"):
        try:
            o = json.loads(line)
        except Exception:                                      # noqa: BLE001
            continue
        o["_et"] = to_et(o.get("timestamp", ""))
        out.append(o)
    out.sort(key=lambda o: o.get("timestamp") or "")
    return out


def classify(path):
    # ⛔ `/api/flow/aggregate-health` starts with `/api/flow/aggregate`, so the
    # first version of this function counted THIS SESSION'S OWN 10 s poller as
    # 15 whole-D member requests. Exclude the health endpoint explicitly before
    # any other test -- an instrument that measures itself reports a property of
    # the instrument as a property of the product.
    if "/api/flow/aggregate-health" in path:
        return None
    if "/api/flow/aggregate" not in path and "/api/flow/data" not in path:
        return None
    if "part=" in path:
        m = re.search(r"part=([A-Za-z_]+)", path)
        return ("part", m.group(1) if m else "?")
    if "/api/flow/data" in path:
        return ("whole_data", "data?days=1")
    return ("whole_aggregate", "aggregate(no part=)")


def main():
    since = sys.argv[1] if len(sys.argv) > 1 else None   # "HH:MM" ET
    until = sys.argv[2] if len(sys.argv) > 2 else None
    rows = load()
    if not rows:
        print("no log lines captured yet")
        return
    print("lines=%d  span_et=%s .. %s"
          % (len(rows),
             rows[0]["_et"].isoformat() if rows[0]["_et"] else "?",
             rows[-1]["_et"].isoformat() if rows[-1]["_et"] else "?"))

    def in_window(o):
        if not o["_et"]:
            return False
        hm = o["_et"].strftime("%H:%M")
        if since and hm < since:
            return False
        if until and hm > until:
            return False
        return True

    sel = [o for o in rows if in_window(o)]
    print("in window (%s..%s): %d lines" % (since, until, len(sel)))

    kinds, parts, statuses = Counter(), Counter(), Counter()
    by_ip = defaultdict(Counter)
    whole_examples = []
    for o in sel:
        m = ACCESS.search(o.get("message", ""))
        if not m:
            continue
        path, status = m.group(2), m.group(3)
        c = classify(path)
        if not c:
            continue
        kinds[c[0]] += 1
        parts[c[1]] += 1
        statuses[status] += 1
        ipm = re.search(r"(\d+\.\d+\.\d+\.\d+):\d+", o.get("message", ""))
        by_ip[ipm.group(1) if ipm else "?"][c[0]] += 1
        if c[0] != "part" and len(whole_examples) < 25:
            whole_examples.append((o["_et"].strftime("%H:%M:%S"), path, status))

    tot = sum(kinds.values())
    print("\n--- item 7: transport mix on /api/flow/* (n=%d) ---" % tot)
    for k, v in kinds.most_common():
        print("  %-18s %5d  (%.1f%%)" % (k, v, 100.0 * v / tot if tot else 0))
    print("  part breakdown: %s" % dict(parts.most_common()))
    print("  statuses: %s" % dict(statuses.most_common()))
    print("  by source IP: %s" % {k: dict(v) for k, v in by_ip.items()})
    if whole_examples:
        print("  WHOLE-D / data?days=1 occurrences (first 25):")
        for t, p, s in whole_examples:
            print("    %s %s -> %s" % (t, p[:110], s))
    else:
        print("  no whole-D or data?days=1 requests in window")

    print("\n--- item 5: flow-prepare lines ---")
    pl = [o for o in sel if PREPARE.search(o.get("message", ""))]
    print("  flow-prepare lines: %d  (of which 'remainder warmed': %d)"
          % (len(pl), sum(1 for o in pl if WARMED.search(o["message"]))))
    for o in pl[:80]:
        print("    %s %s" % (o["_et"].strftime("%H:%M:%S"),
                             o["message"].strip()[:190]))

    print("\n--- errors in window ---")
    ep = re.compile(r"Traceback|ERROR|CRITICAL|Exception", re.I)
    ee = [o for o in sel if ep.search(o.get("message", ""))]
    print("  %d" % len(ee))
    for o in ee[:30]:
        print("    %s %s" % (o["_et"].strftime("%H:%M:%S"),
                             o["message"].strip()[:190]))


if __name__ == "__main__":
    main()
