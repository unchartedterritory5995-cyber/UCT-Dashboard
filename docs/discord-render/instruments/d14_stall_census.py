"""D-14 / OI-44 — the stall census over the monitor's durable JSONL.

⛔⛔ WHAT THIS EXISTS TO CORRECT. Q6 (D-12) concluded STARTUP-CLASS from SEVEN trailing
windows on ONE pod over 30 minutes. This reads 30+ pods over 34+ hours and reaches the
opposite verdict. A verdict from one pod is a verdict about one pod.

⛔ THE DETECTOR MUST COMPARE AGAINST THE PRECEDING READING, NEVER A RUNNING MAXIMUM.
`max_ms` is the maximum over a TRAILING 600-sample (~5 min) window, so it DECAYS as
samples age out. A running maximum never decays, so after one 80 s stall it goes blind
to every later stall on that pod. Measured on the real file: the running-max detector
found 24 events; the correct one finds 43. The blind version undercounts by 44%.

⛔ EVERY COUNT HERE IS A LOWER BOUND regardless. Two stalls inside one 90 s poll gap are
one observation, and a stall smaller than the window's current max is invisible.

⭐ CLASSIFICATION IS CONSERVATIVE. An event is called SETTLED only when the whole trailing
window lies past the uptime floor (`uptime - WINDOW_S >= FLOOR_S`). Anything straddling the
floor is SPANS, never counted as settled. The settled count is therefore a floor too.
"""
from __future__ import annotations

import argparse
import collections
import datetime
import json
import pathlib
import sys
import zoneinfo

ET = zoneinfo.ZoneInfo("America/New_York")
WINDOW_S = 310.0     # 600 samples x 0.5 s, plus slack
FLOOR_S = 900.0      # R34 tier-2 uptime floor
ALERT_MS = 1000.0    # observe.LOOP_STALL_ALERT_MS
PAGE_ALWAYS_MS = 5000.0  # R34 tier 1

DEFAULT = (pathlib.Path(__file__).resolve().parents[1]
           / "evidence" / "d14-monitor" / "loop-boot-windows.jsonl")


def pod_id(r: dict) -> str:
    """⛔⛔ A COMMIT SHA IS NOT A POD IDENTITY, AND USING IT AS ONE CORRUPTS EVERYTHING.

    `RAILWAY_GIT_COMMIT_SHA` names the COMMIT. Several pods run the same commit (a redeploy,
    a restart, a retry), so grouping by sha merges 2-3 independent uptime clocks into one
    series. Sorted by uptime they interleave, max_ms appears to rise and fall repeatedly, and
    ONE stall is counted as three events. Measured on the real file: sha 465b12e3601f held
    three pods and its single 18,741 ms stall was counted three times.

    The identity is (sha, boot wall-clock) where boot = observation_time - uptime.

    ⛔ BUCKETING THE BOOT TIME IS NOT ENOUGH — it splits a pod at a bucket boundary. The two
    reads are a second or two apart, so a pod whose boot estimate jitters across the boundary
    becomes two pods and its stall is counted twice (measured: 792722de7386 and 465b12e3601f
    both split this way under 60 s buckets). `cluster_pods` groups by TOLERANCE instead.
    (`lesson_an_identity_join_is_not_a_correctness_check`.)"""
    t = datetime.datetime.strptime(r["t"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
    return t.timestamp() - float(r["uptime_s"])


BOOT_TOLERANCE_S = 120.0  # > the 90 s poll interval, << a pod lifetime. At 150 s it merged two
                          # pods of one commit that booted 133 s apart (identity coherence went to 1).


def cluster_pods(readings: list) -> dict:
    """Group readings into real pods: same commit AND a boot estimate within tolerance."""
    by_sha: dict[str, list] = collections.defaultdict(list)
    for r in readings:
        by_sha[r["sha"]].append(r)
    out: dict[str, list] = {}
    for sha, rs in by_sha.items():
        rs.sort(key=pod_id)
        cur: list = []
        anchor = None
        n = 0
        for r in rs:
            b = pod_id(r)
            if anchor is None or abs(b - anchor) <= BOOT_TOLERANCE_S:
                if anchor is None:
                    anchor = b
                cur.append(r)
            else:
                out[f"{sha}#{n}"] = cur
                n += 1
                cur, anchor = [r], b
        if cur:
            out[f"{sha}#{n}"] = cur
    return out


def load(path: pathlib.Path) -> dict:
    raw: list = []
    gaps = 0
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if r.get("gap"):
            gaps += 1
            continue
        if r.get("loop") and r.get("uptime_s") is not None and r.get("sha"):
            raw.append(r)
    pods = cluster_pods(raw)
    for k in pods:
        pods[k].sort(key=lambda r: r["uptime_s"])
    # ⛔ NON-VACUITY ON THE IDENTITY ITSELF: within one pod, uptime and wall-clock must both
    # increase together. If they disagree the grouping is still merging pods, and every count
    # downstream is fiction. Reported, never silently tolerated.
    bad = 0
    for k, rs in pods.items():
        ts = [datetime.datetime.strptime(r["t"], "%Y-%m-%dT%H:%M:%SZ") for r in rs]
        if any(b < a for a, b in zip(ts, ts[1:])):
            bad += 1
    return {"pods": pods, "gaps": gaps, "incoherent_pods": bad}


def events(pods: dict) -> list[dict]:
    """A stall entered the window when max_ms rises against the PRECEDING reading."""
    out = []
    for sha, rs in pods.items():
        # ⛔ A STALL ALREADY PRESENT IN A POD'S FIRST READING IS STILL AN EVENT. Without this
        # the census silently drops every stall that landed before the first poll — which is
        # precisely the boot-window class OI-44 is about. Caught by --self-check, which found
        # only 1 of 2 planted stalls before this clause existed.
        if rs:
            m0 = rs[0]["loop"].get("max_ms") or 0.0
            if m0 >= ALERT_MS:
                hi = float(rs[0]["uptime_s"])
                out.append({"sha": sha, "ms": m0, "lo": max(0.0, hi - WINDOW_S), "hi": hi,
                            "t": rs[0]["t"], "first_reading": True,
                            "klass": ("SETTLED" if hi - WINDOW_S >= FLOOR_S
                                      else "BOOT" if hi < FLOOR_S else "SPANS")})
        for a, b in zip(rs, rs[1:]):
            ma = a["loop"].get("max_ms") or 0.0
            mb = b["loop"].get("max_ms") or 0.0
            if mb > ma + 1.0 and mb >= ALERT_MS:
                lo = max(0.0, min(a["uptime_s"], b["uptime_s"] - WINDOW_S))
                hi = float(b["uptime_s"])
                out.append({
                    "sha": sha, "ms": mb, "lo": lo, "hi": hi, "t": b["t"],
                    "klass": ("SETTLED" if hi - WINDOW_S >= FLOOR_S
                              else "BOOT" if hi < FLOOR_S else "SPANS"),
                })
    out.sort(key=lambda e: -e["ms"])
    return out


def span_hours(pods: dict) -> float:
    ts = []
    for rs in pods.values():
        for r in rs:
            ts.append(datetime.datetime.strptime(r["t"], "%Y-%m-%dT%H:%M:%SZ"))
    return ((max(ts) - min(ts)).total_seconds() / 3600.0) if len(ts) > 1 else 0.0


def report(path: pathlib.Path) -> int:
    d = load(path)
    pods = d["pods"]
    if not pods:
        print("TOTALS d14_stall_census INVALID declared=0 evaluated=0 failed=0 — no readings")
        return 2
    ev = events(pods)
    hrs = span_hours(pods) or 1.0
    g1 = [e for e in ev if e["ms"] >= ALERT_MS]
    g5 = [e for e in ev if e["ms"] >= PAGE_ALWAYS_MS]
    s1 = [e for e in g1 if e["klass"] == "SETTLED"]
    s5 = [e for e in g5 if e["klass"] == "SETTLED"]
    print(f"pods {len(pods)} | readings {sum(len(v) for v in pods.values())} | gaps {d['gaps']} | span {hrs:.1f} h")
    print(f"identity coherence: {d['incoherent_pods']} pod(s) with non-monotonic wall-clock (MUST be 0)")
    print(f">={int(ALERT_MS)} ms : {len(g1):>4} events  {len(g1)*24/hrs:>6.1f}/day   SETTLED {len(s1)}")
    print(f">={int(PAGE_ALWAYS_MS)} ms : {len(g5):>4} events  {len(g5)*24/hrs:>6.1f}/day   SETTLED {len(s5)}   <- R34 tier-1 page rate")
    print(f"pods affected: {len(set(e['sha'] for e in g1))} of {len(pods)}")
    print()
    print(f"{'ms':>10}  {'uptime range':<20}{'class':<9}{'ET observed':<22}sha")
    for e in ev[:20]:
        t = datetime.datetime.strptime(e["t"], "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=datetime.timezone.utc).astimezone(ET)
        print(f"{e['ms']:>10.1f}  {f'{e['lo']:.0f}-{e['hi']:.0f}s':<20}{e['klass']:<9}"
              f"{t.strftime('%a %m-%d %H:%M:%S'):<22}{e['sha']}")
    print()
    verdict = "PER-POD AND RECURRING" if len(s1) >= 2 else "NOT ESTABLISHED"
    print(f"OI-44 verdict: {verdict} — {len(s1)} stall(s) >= {int(ALERT_MS)} ms provably past uptime {int(FLOOR_S)} s")
    print(f"TOTALS d14_stall_census PASS declared={len(ev)} evaluated={len(ev)} failed=0")
    return 0


def self_check() -> int:
    """⛔ The control that matters: a RUNNING-MAXIMUM detector must undercount a
    decaying-window series, and the real detector must not."""
    pods = {"x": [
        {"uptime_s": 100, "t": "2026-01-01T00:00:00Z", "loop": {"max_ms": 9000.0}},   # big stall
        {"uptime_s": 200, "t": "2026-01-01T00:01:00Z", "loop": {"max_ms": 9000.0}},   # still in window
        {"uptime_s": 1400, "t": "2026-01-01T00:20:00Z", "loop": {"max_ms": 10.0}},    # aged out
        {"uptime_s": 1500, "t": "2026-01-01T00:22:00Z", "loop": {"max_ms": 2500.0}},  # NEW settled stall
    ]}
    ev = events(pods)
    got = len(ev)
    settled = [e for e in ev if e["klass"] == "SETTLED"]
    # the blind version, for contrast
    blind = 0
    prev = 0.0
    for r in pods["x"]:
        m = r["loop"]["max_ms"]
        if m > prev + 1.0 and m >= ALERT_MS:
            blind += 1
        prev = max(prev, m)
    quiet = len(events({"y": [
        {"uptime_s": 100, "t": "2026-01-01T00:00:00Z", "loop": {"max_ms": 200.0}},
        {"uptime_s": 200, "t": "2026-01-01T00:01:00Z", "loop": {"max_ms": 300.0}},
    ]}))
    checks = [
        ("detector finds both stalls", got == 2),
        ("the later stall is classified SETTLED", len(settled) == 1 and settled[0]["ms"] == 2500.0),
        ("a running-maximum detector goes blind to the second", blind == 1),
        ("a quiet series produces zero events (non-vacuity)", quiet == 0),
    ]
    for name, ok in checks:
        print(f"  {'ok ' if ok else 'FAIL'} {name}")
    failed = sum(1 for _, ok in checks if not ok)
    print(f"TOTALS d14_stall_census --self-check {'PASS' if not failed else 'FAIL'} "
          f"declared={len(checks)} evaluated={len(checks)} failed={failed}")
    return 0 if not failed else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--path", type=pathlib.Path, default=DEFAULT)
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()
    sys.exit(self_check() if a.self_check else report(a.path))
