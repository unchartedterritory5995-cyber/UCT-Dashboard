"""One-off post-hoc analysis of tools/ui_stress_out/findings.jsonl.

Identifies the backend-dead outage window (a contiguous stretch where
connection/5xx/timeout-flavored findings spike across many workers at once)
and separates findings into:
  - "outage" bucket: anything whose signature is connection/5xx/timeout-shaped
    AND whose timestamp falls inside the detected outage window.
  - "steady-state" bucket: everything else — this is what candidate-bug
    triage should actually look at.

Run after the main harness finishes (or at any checkpoint) — read-only.
"""
import json
import re
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

FINDINGS_PATH = Path(__file__).parent / "ui_stress_out" / "findings.jsonl"

OUTAGE_SIG_RE = re.compile(
    r"^(network_fail:(HTTP 5\d\d|.*ERR_CONNECTION|.*ERR_EMPTY_RESPONSE|.*ERR_FAILED)"
    r"|console_error:.*(ERR_CONNECTION|Service Unavailable|Failed to fetch|status of 5)"
    r"|action_error:.*:(TimeoutError|Error)$"
    r"|root_empty"
    r"|match_count_(missing|invalid))"
)

# The asyncio.wait_for() wall-clock cancellation (hardcoded literal "timeout",
# distinct from Playwright's own TimeoutError class) fires when an ENTIRE
# action — clicks, waits, evaluates, all of it — doesn't finish inside the
# per-action budget. Seen across EVERY action type, from very early
# iterations, on every worker: that shape (uniform across unrelated action
# types, not concentrated in one control) is the signature of the shared
# backend being slow under 10-way concurrency, not 12 independent UI bugs.
# Tracked separately from the discrete outage windows because it is CHRONIC
# (spread across the whole run) rather than confined to a short dense spike.
CHRONIC_TIMEOUT_RE = re.compile(r"^action_error:[a-z_]+:timeout$")


def main():
    rows = []
    with open(FINDINGS_PATH, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    if not rows:
        print("no findings")
        return

    rows.sort(key=lambda r: r["ts"])
    t0, t1 = rows[0]["ts"], rows[-1]["ts"]
    print(f"findings span: {time.ctime(t0)} .. {time.ctime(t1)}  ({len(rows)} lines)")

    # Bucket findings into 10s windows and count outage-shaped signatures per window
    # across DISTINCT workers, to find contiguous high-density stretches.
    bucket_w = 10
    per_bucket = defaultdict(lambda: {"count": 0, "workers": set()})
    for r in rows:
        if OUTAGE_SIG_RE.match(r["signature"]):
            b = int(r["ts"] // bucket_w)
            per_bucket[b]["count"] += 1
            per_bucket[b]["workers"].add(r["worker"])

    # A bucket counts as "outage-dense" if >=4 distinct workers hit an
    # outage-shaped finding in the same 10s window (isolated single-worker
    # timeouts are normal noise; a simultaneous multi-worker spike is the
    # signature of the backend actually being down).
    dense_buckets = sorted(b for b, v in per_bucket.items() if len(v["workers"]) >= 4)

    outage_windows = []
    if dense_buckets:
        start = prev = dense_buckets[0]
        for b in dense_buckets[1:]:
            if b - prev <= 3:  # allow small gaps (30s) within one contiguous outage
                prev = b
                continue
            outage_windows.append((start, prev))
            start = prev = b
        outage_windows.append((start, prev))

    print(f"\nDetected {len(outage_windows)} outage window(s):")
    windows_s = []
    for start, end in outage_windows:
        t_start = start * bucket_w
        t_end = end * bucket_w + bucket_w
        windows_s.append((t_start, t_end))
        print(f"  {time.strftime('%H:%M:%S', time.localtime(t_start))} - "
              f"{time.strftime('%H:%M:%S', time.localtime(t_end))} "
              f"({t_end - t_start:.0f}s)")

    def in_outage(ts):
        return any(s <= ts <= e for s, e in windows_s)

    quarantined = [r for r in rows if in_outage(r["ts"]) and OUTAGE_SIG_RE.match(r["signature"])]
    quarantined_ids = {id(r) for r in quarantined}
    chronic = [r for r in rows if id(r) not in quarantined_ids and CHRONIC_TIMEOUT_RE.match(r["signature"])]
    chronic_ids = {id(r) for r in chronic}
    steady = [r for r in rows if id(r) not in quarantined_ids and id(r) not in chronic_ids]

    q_sigs = Counter(r["signature"] for r in quarantined)
    q_workers = sorted({r["worker"] for r in quarantined})
    print(f"\nQuarantined (discrete outage-window, outage-shaped): {len(quarantined)} findings, "
          f"{len(q_sigs)} distinct signatures, workers affected: {q_workers}")

    c_sigs = Counter(r["signature"] for r in chronic)
    c_workers = sorted({r["worker"] for r in chronic})
    print(f"\nChronic timeout-under-load (asyncio wall-clock, outside discrete windows): "
          f"{len(chronic)} findings (capped-at-50-per-sig in this file — true totals are higher, "
          f"see report.md), {len(c_sigs)} distinct action types, workers affected: {c_workers}")
    for sig, count in c_sigs.most_common():
        print(f"  {count:5d}  {sig}")

    steady_sigs = Counter(r["signature"] for r in steady)
    print(f"\nSteady-state (candidate-bug pool): {len(steady)} findings, "
          f"{len(steady_sigs)} distinct signatures")
    print("\nTop 25 steady-state signatures by occurrence:")
    for sig, count in steady_sigs.most_common(25):
        first = next(r for r in steady if r["signature"] == sig)
        print(f"  {count:5d}  {sig}  (first: w{first['worker']} i{first['iter']} {first['action']})")

    # progress per worker (max iter seen)
    max_iter = defaultdict(int)
    for r in rows:
        max_iter[r["worker"]] = max(max_iter[r["worker"]], r.get("iter", 0))
    print("\nMax iteration seen per worker (lower bound on progress, from findings only):")
    for w in sorted(max_iter):
        print(f"  worker {w}: iter {max_iter[w]}")

    out = {
        "outage_windows": [
            {"start": time.strftime('%H:%M:%S', time.localtime(s)),
             "end": time.strftime('%H:%M:%S', time.localtime(e)),
             "start_ts": s, "end_ts": e}
            for s, e in windows_s
        ],
        "quarantined_count": len(quarantined),
        "quarantined_signatures": sorted(q_sigs.keys()),
        "quarantined_workers": q_workers,
        "chronic_timeout_count": len(chronic),
        "chronic_timeout_signature_counts": dict(c_sigs.most_common()),
        "chronic_timeout_workers": c_workers,
        "steady_state_count": len(steady),
        "steady_state_signature_counts": dict(steady_sigs.most_common()),
    }
    out_path = Path(__file__).parent / "ui_stress_out" / "outage_analysis.json"
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    main()
