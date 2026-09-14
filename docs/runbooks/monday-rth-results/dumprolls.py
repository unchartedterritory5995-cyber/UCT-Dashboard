"""Dump every distinct steady roll, all fields, plus the surrounding pod state."""
from __future__ import annotations

import json
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from analyze import collect_rolls, load_samples, deploys      # noqa: E402

samples = load_samples()
rolls = collect_rolls(samples, "rolls_steady")
startup = collect_rolls(samples, "rolls_startup")
limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0

out = {
    "sampler": {
        "file": "scratchpad/monday-rth/health-samples.jsonl",
        "samples": len(samples),
        "first_sample_et": samples[0]["at_et"] if samples else None,
        "last_sample_et": samples[-1]["at_et"] if samples else None,
        "cadence_s_nominal": 10,
    },
    "restarts_detected": deploys(samples),
    "rolls_startup": startup,
    "rolls_steady_count": len(rolls),
    "rolls_steady": rolls[:limit] if limit else rolls,
}
pm = [r["prepare_ms"] for r in rolls if isinstance(r.get("prepare_ms"), (int, float))]
hm = [r["handoff_ms"] for r in rolls if isinstance(r.get("handoff_ms"), (int, float))]


def stats(v):
    if not v:
        return None
    s = sorted(v)

    def pct(p):
        return s[min(len(s) - 1, int(round((len(s) - 1) * p)))]
    return {"n": len(s), "min": s[0], "p50": pct(0.50), "p90": pct(0.90),
            "p95": pct(0.95), "max": s[-1], "mean": round(statistics.mean(s), 1)}


out["prepare_ms_stats_all_steady"] = stats(pm)
out["handoff_ms_stats_all_steady"] = stats(hm)
out["prepare_ms_samples"] = pm
out["handoff_ms_samples"] = hm
print(json.dumps(out, indent=1, default=str))
