"""Read the sampler files and summarise. Pure analysis over captured evidence."""
from __future__ import annotations

import json
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLES = os.path.join(HERE, "health-samples.jsonl")
LOGS = os.path.join(HERE, "flowworker-log-stream.jsonl")


def load_samples():
    out = []
    if not os.path.exists(SAMPLES):
        return out
    for line in open(SAMPLES, encoding="utf-8", errors="replace"):
        try:
            out.append(json.loads(line))
        except Exception:                                      # noqa: BLE001
            pass
    return out


def roll_key(r):
    """Identity for a steady roll, so repeated sampling does not double-count."""
    return (r.get("version"), r.get("prepare_ms"), r.get("handoff_ms"),
            r.get("observed_s"), r.get("kind"))


def collect_rolls(samples, which="rolls_steady"):
    """Union every roll ever seen in the ring, in first-sighting order."""
    seen, out = set(), []
    for s in samples:
        agg = s.get("agg") or {}
        for r in (agg.get(which) or []):
            k = roll_key(r)
            if k in seen:
                continue
            seen.add(k)
            rr = dict(r)
            rr["_first_seen_et"] = s["at_et"]
            rr["_sample_n"] = s["n"]
            out.append(rr)
    return out


def deploys(samples):
    """Every point where uptime went DOWN -> a restart happened between samples."""
    ev, prev = [], None
    for s in samples:
        u = (s.get("health") or {}).get("uptime_seconds")
        if u is None:
            continue
        if prev is not None and u < prev:
            ev.append({"at_et": s["at_et"], "uptime_before": prev,
                       "uptime_after": u, "sample_n": s["n"]})
        prev = u
    return ev


def main():
    s = load_samples()
    if not s:
        print("no samples yet")
        return
    print("samples=%d  first=%s  last=%s" % (len(s), s[0]["at_et"], s[-1]["at_et"]))
    ok = [x for x in s if x.get("agg_status") == 200]
    print("agg 200=%d  non-200/err=%d" % (len(ok), len(s) - len(ok)))
    d = deploys(s)
    print("restarts detected: %d %s" % (len(d), d if d else ""))
    last = ok[-1]["agg"] if ok else {}
    print("current_version=%s parts=%s build_failures=%s rejected=%s stale=%s busy=%s"
          % (last.get("current_version"),
             len((last.get("parts") or {}).get("entries") or []),
             ((last.get("stats_process_local") or {}).get("build_failures")),
             ((last.get("stats_process_local") or {}).get("parts_rejected_missing")),
             ((last.get("stats_process_local") or {}).get("stale_served")),
             ((last.get("stats_process_local") or {}).get("declined_busy"))))
    steady = collect_rolls(s, "rolls_steady")
    startup = collect_rolls(s, "rolls_startup")
    print("\nDISTINCT rolls_startup=%d  rolls_steady=%d" % (len(startup), len(steady)))
    for r in steady:
        print("  v=%s prep=%sms handoff=%sms blocked_by=%s pass=%s held=%sms obs=%ss "
              "bucket=%ss pass2skip=%s first_seen=%s"
              % (r.get("version"), r.get("prepare_ms"), r.get("handoff_ms"),
                 r.get("blocked_by"), r.get("blocked_pass"),
                 r.get("blocked_held_ms"), r.get("observed_s"),
                 r.get("bucket_bound_s"), r.get("pass2_skipped"),
                 r["_first_seen_et"][11:19]))
    pm = [r["prepare_ms"] for r in steady if isinstance(r.get("prepare_ms"), (int, float))]
    if pm:
        pm_s = sorted(pm)
        def pct(p):
            return pm_s[min(len(pm_s) - 1, int(round((len(pm_s) - 1) * p)))]
        print("\nprepare_ms n=%d min=%d p50=%d p95=%d max=%d mean=%.0f"
              % (len(pm), pm_s[0], pct(0.50), pct(0.95), pm_s[-1],
                 statistics.mean(pm)))
    parts_counts = sorted({len((x["agg"].get("parts") or {}).get("entries") or [])
                           for x in ok})
    print("distinct parts-cache sizes seen across session: %s" % parts_counts)
    bf = sorted({(x["agg"].get("stats_process_local") or {}).get("build_failures")
                 for x in ok})
    pr = sorted({(x["agg"].get("stats_process_local") or {}).get("parts_rejected_missing")
                 for x in ok}, key=lambda v: (v is None, v))
    print("distinct build_failures: %s   parts_rejected_missing: %s" % (bf, pr))


if __name__ == "__main__":
    main()
