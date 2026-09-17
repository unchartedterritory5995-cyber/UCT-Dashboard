r"""R31 — is the loop materially worse in the boot window? An EXPOSURE-NORMALISED profile.

⛔⛔ **A RAW EVENT COUNT PER UPTIME BUCKET IS NOT AN ANSWER, IT IS A CENSUS OF POD LIFETIMES.**
`web` pods live ~45 min, so every pod passes through minute 0-5 and only some reach minute 40.
Counting events per bucket therefore reports how long pods live, dressed up as a statement about
the loop — and it reports it in the direction that makes the boot window look WORSE, which is
exactly the conclusion under test. Every row below is divided by the POD-HOURS actually observed
in that bucket.

⛔ **EXPOSURE IS OBSERVED, NOT ASSUMED.** A pod contributes to a bucket only over the overlap of
its OWN first-to-last reading span with that bucket. A pod that was first polled at uptime 200 s
contributes nothing to 0-3 min, and pretending otherwise would deflate the boot rate with
minutes nobody watched.

⭐ **This reuses `d14_stall_census`'s clustering and event derivation rather than restating
them** — the (sha, boot) identity with its 120 s tolerance, the first-reading clause, and the
rise-against-the-preceding-reading detector are all load-bearing and were each a measured bug.
A second copy of that logic here would be a second authority over one number.

Usage:
    python docs/discord-render/instruments/r31_boot_window.py
    python docs/discord-render/instruments/r31_boot_window.py --self-check
"""
from __future__ import annotations

import argparse
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import d14_stall_census as census  # noqa: E402

ROOT = HERE.parents[2]
DEFAULT = ROOT / "docs" / "discord-render" / "evidence" / "d14-monitor" / "loop-boot-windows.jsonl"

# Minute edges. The last is open-ended; R31 asks about boot-to-25 and the tail is the control.
EDGES_MIN = (0, 3, 5, 8, 11, 15, 20, 25)


def _buckets():
    out = [(EDGES_MIN[i] * 60.0, EDGES_MIN[i + 1] * 60.0) for i in range(len(EDGES_MIN) - 1)]
    out.append((EDGES_MIN[-1] * 60.0, float("inf")))
    return out


def exposure_seconds(pods: dict) -> list[float]:
    """Pod-seconds actually OBSERVED in each bucket — the denominator."""
    buckets = _buckets()
    acc = [0.0] * len(buckets)
    for rs in pods.values():
        if len(rs) < 2:
            continue                      # a single reading spans no time; counting it as a
        lo = float(rs[0]["uptime_s"])     # bucket's worth of exposure would invent coverage
        hi = float(rs[-1]["uptime_s"])
        for i, (a, b) in enumerate(buckets):
            acc[i] += max(0.0, min(hi, b) - max(lo, a))
    return acc


def profile(path: pathlib.Path) -> dict:
    d = census.load(path)
    pods = d["pods"]
    evs = census.events(pods)
    buckets = _buckets()
    expo = exposure_seconds(pods)
    rows = []
    for i, (a, b) in enumerate(buckets):
        in_b = [e for e in evs if a <= e["hi"] < b]
        hours = expo[i] / 3600.0
        rows.append({
            "lo_min": a / 60.0,
            "hi_min": None if b == float("inf") else b / 60.0,
            "pod_hours": hours,
            "n": len(in_b),
            "n_5s": len([e for e in in_b if e["ms"] >= 5000.0]),
            "per_hour": (len(in_b) / hours) if hours > 0 else None,
            "per_hour_5s": (len([e for e in in_b if e["ms"] >= 5000.0]) / hours) if hours > 0 else None,
            "max_ms": max((e["ms"] for e in in_b), default=0.0),
        })
    return {"rows": rows, "pods": len(pods), "events": len(evs), "gaps": d["gaps"],
            "incoherent_pods": d["incoherent_pods"], "span_h": census.span_hours(pods)}


def report(path: pathlib.Path) -> int:
    if not path.exists():
        print(f"no readings at {path}", file=sys.stderr)
        return 2
    p = profile(path)
    print(f"R31 boot-window profile: {p['pods']} pods, {p['events']} stall events "
          f">= {census.ALERT_MS:.0f} ms, {p['span_h']:.1f} h of wall clock, {p['gaps']} gaps")
    if p["incoherent_pods"]:
        # ⛔ NOT A FOOTNOTE: incoherent pods mean the (sha, boot) grouping is still merging
        # pods, and every rate below is fiction.
        print(f"  !! {p['incoherent_pods']} pod(s) FAIL the identity-coherence check "
              f"- every rate below is unsound")
    print()
    print(f"  {'uptime (min)':>14}  {'pod-hours':>9}  {'n>=1s':>6}  {'per pod-h':>9}  "
          f"{'n>=5s':>6}  {'per pod-h':>9}  {'max ms':>9}")
    for r in p["rows"]:
        lab = f"{r['lo_min']:.0f}-{r['hi_min']:.0f}" if r["hi_min"] is not None else f"{r['lo_min']:.0f}+"
        ph = f"{r['per_hour']:.2f}" if r["per_hour"] is not None else "n/a"
        ph5 = f"{r['per_hour_5s']:.2f}" if r["per_hour_5s"] is not None else "n/a"
        print(f"  {lab:>14}  {r['pod_hours']:9.2f}  {r['n']:6d}  {ph:>9}  "
              f"{r['n_5s']:6d}  {ph5:>9}  {r['max_ms']:9.0f}")
    print()
    boot = [r for r in p["rows"] if r["hi_min"] is not None and r["hi_min"] <= 15]
    tail = [r for r in p["rows"] if r["lo_min"] >= 15]
    bh, th = sum(r["pod_hours"] for r in boot), sum(r["pod_hours"] for r in tail)
    bn, tn = sum(r["n"] for r in boot), sum(r["n"] for r in tail)
    if bh > 0 and th > 0:
        br, tr = bn / bh, tn / th
        print(f"  boot (0-15 min): {bn} events over {bh:.2f} pod-h = {br:.2f}/pod-h")
        print(f"  tail (15+ min):  {tn} events over {th:.2f} pod-h = {tr:.2f}/pod-h")
        print(f"  ratio boot/tail: {br / tr:.2f}x" if tr > 0 else "  tail rate is zero")
        print("  !! A RATIO IS NOT A CAUSE. This says WHERE the stalls fall, never WHY.")
        print("  !! AND THE BOOT BUCKETS ARE THIN. Each holds ~1.1-1.4 pod-hours against the")
        print("     tail's 25+, so ONE extra event moves a boot rate by ~0.8/pod-h. Read n")
        print("     beside every rate; two points do not establish a rate.")
    return 0


def self_check() -> int:
    """⛔ The control that matters: exposure must be OBSERVED, so a pod polled late must
    contribute ZERO to the buckets before its first reading. Without that the boot rate is
    diluted by minutes nobody watched, and the dilution always flatters the boot window."""
    pods = {
        # first polled at 600 s, last at 1200 s -> nothing before minute 10
        "late#0": [{"uptime_s": 600.0, "t": "2026-09-17T00:00:00Z", "loop": {"max_ms": 0.0}},
                   {"uptime_s": 1200.0, "t": "2026-09-17T00:10:00Z", "loop": {"max_ms": 0.0}}],
    }
    expo = exposure_seconds(pods)
    buckets = _buckets()
    early = sum(e for e, (a, b) in zip(expo, buckets) if b <= 600.0)
    ok_early = early == 0.0
    total = sum(expo)
    ok_total = abs(total - 600.0) < 1e-6
    # and a single-reading pod contributes no exposure at all
    ok_single = sum(exposure_seconds({"one#0": [pods["late#0"][0]]})) == 0.0
    print(f"self-check late_pod_no_early_exposure={ok_early} total_exposure_is_span={ok_total} "
          f"single_reading_is_zero={ok_single}")
    bad = sum(1 for v in (ok_early, ok_total, ok_single) if not v)
    print(f"TOTALS r31_boot_window --self-check {'PASS' if not bad else 'FAIL'} declared=3 failed={bad}")
    return 0 if not bad else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--path", default=str(DEFAULT))
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()
    return self_check() if a.self_check else report(pathlib.Path(a.path))


if __name__ == "__main__":
    sys.exit(main())
