"""Read the sampler's pool and say whether p95 is estimable yet. Session 11, B.2/B.3.

    python tools/breadth_sampler_report.py [logs/breadth-samples.jsonl]

⛔ POOLABILITY IS ENFORCED HERE, NOT ASSUMED BY THE SAMPLER. The sampler records what it
saw (SHA, every flag the instrument reports, the phases). This script decides what may be
POOLED, and it decides it by asking git whether the reader's hot path is byte-identical
between two SHAs — not by trusting that a commit "looked harmless".

⛔ THE HOT PATH IS THE MEASURED-BY-EXECUTION SET, NOT THE IMPORT CLOSURE. Walking imports
from the route reaches 169 files, because the router imports the engine which imports auth
which imports half the app; on 2026-09-15 THIRTY-ONE commits landed on master in a day, and
a pool keyed on that set would shatter continuously and never reach the n=59 that p95 needs.
Tracing an actual deep read shows EIGHT files execute. `docs/breadth/reader-hotpath.txt`
holds that list and `tools/breadth_hotpath.py` regenerates it.

⛔ A SAMPLE WITH NO SHA IS NOT POOLED. It is counted and shown, because an unattributable
sample is a fact about the sampler, but it cannot join a pool whose defining property is
"the reader code was identical".
"""
from __future__ import annotations

import collections
import json
import math
import pathlib
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_LOG = REPO / "logs" / "breadth-samples.jsonl"
HOTPATH_FILE = REPO / "docs" / "breadth" / "reader-hotpath.txt"

#: Session 10, D.3: the sample MAX only becomes a 95% upper bound on p95 at this n.
N_FOR_P95 = 59
#: The flags whose state must match for two samples to pool. Read off the instrument.
POOL_FLAGS = ("rf_pagecache",)


def hot_path() -> list[str]:
    lines = [l.strip() for l in HOTPATH_FILE.read_text(encoding="utf-8").splitlines()]
    files = [l for l in lines if l and not l.startswith("#")]
    assert files, "reader-hotpath.txt lists no files — refusing to pool everything together"
    return files


def hot_path_identical(sha_a: str, sha_b: str, files: list[str]) -> tuple[bool, list[str]]:
    """⛔ Compares the BLOB of each hot file at each SHA. A file missing at one SHA counts
    as a difference, not as a match."""
    if sha_a == sha_b:
        return True, []
    diff = []
    for f in files:
        blobs = []
        for sha in (sha_a, sha_b):
            p = subprocess.run(["git", "rev-parse", f"{sha}:{f}"], cwd=str(REPO),
                               capture_output=True, encoding="utf-8", errors="replace")
            blobs.append(p.stdout.strip() if p.returncode == 0 else None)
        if blobs[0] is None or blobs[1] is None or blobs[0] != blobs[1]:
            diff.append(f)
    return (not diff), diff


def pct(v: list[float], q: float):
    if not v:
        return None
    s = sorted(v)
    if len(s) == 1:
        return s[0]
    i = (len(s) - 1) * q
    lo, hi = math.floor(i), math.ceil(i)
    return s[lo] if lo == hi else s[lo] + (s[hi] - s[lo]) * (i - lo)


def sd(v: list[float]):
    if len(v) < 2:
        return None
    m = sum(v) / len(v)
    return math.sqrt(sum((x - m) ** 2 for x in v) / (len(v) - 1))


def stats(v: list[float]) -> str:
    """⛔ C.4: THE p95 CELL IS SUPPRESSED BELOW n = N_FOR_P95, here rather than annotated
    somewhere else. A printed p95 is read as an estimate whatever caveat sits beside it,
    and Session 10 measured P(true p95 above the worst read) at 0.358 for n=20 — at that
    size the number is not an estimate of anything. `not est` is the honest cell, and a
    rail feeds this exactly n=20 and asserts it."""
    if not v:
        return "—"
    s = sd(v)
    p95 = f"{pct(v, .95):>8.1f}" if len(v) >= N_FOR_P95 else " not est"
    return (f"n={len(v):<3} min={min(v):>8.1f} p50={pct(v,.5):>8.1f} mean={sum(v)/len(v):>8.1f} "
            f"p95={p95} max={max(v):>9.1f} sd={('%.1f'%s) if s else '—':>8}")


def load(path: pathlib.Path):
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                rows.append(json.loads(line))
            except Exception:
                pass
    return rows


def main() -> int:
    path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_LOG
    if not path.exists():
        print(f"no sample file at {path}")
        return 0
    rows = load(path)
    ok = [r for r in rows if r.get("ok") and r.get("kind") == "deep_cold"]
    warm = [r for r in rows if r.get("ok") and r.get("kind") == "warm_365"]
    refused = [r for r in rows if r.get("refused")]
    failed = [r for r in rows if r.get("ok") is False and not r.get("refused")]

    print("=" * 66)
    print(f"BREADTH SAMPLER  ·  {path.name}")
    print(f"  rows {len(rows)}   deep OK {len(ok)}   warm OK {len(warm)}   "
          f"failures {len(failed)}   refusals {len(refused)}")
    if refused:
        c = collections.Counter(r["refused"].split("_ET")[0] for r in refused)
        print("  refusals by reason: " + ", ".join(f"{k}×{v}" for k, v in c.most_common()))
    if failed:
        print(f"  ⛔ FAILURES (never counted as zeros): "
              + "; ".join(str(r.get('error'))[:60] for r in failed[:3]))

    unattributed = [r for r in ok if not r.get("sha")]
    if unattributed:
        print(f"  ⚠️ {len(unattributed)} sample(s) carry NO SHA — shown, never pooled")

    # ── group by (sha, flag-state) then merge groups whose hot path is identical ──
    files = hot_path()
    groups: dict[tuple, list] = collections.defaultdict(list)
    for r in ok:
        if not r.get("sha"):
            continue
        key = (r["sha"],) + tuple(r.get("timing", {}).get(f) for f in POOL_FLAGS)
        groups[key].append(r)

    pools: list[dict] = []
    for key, rs in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        sha, flags = key[0], key[1:]
        placed = False
        for p in pools:
            if p["flags"] != flags:
                continue
            same, diff = hot_path_identical(p["ref_sha"], sha, files)
            if same:
                p["rows"] += rs
                p["shas"].add(sha)
                placed = True
                break
        if not placed:
            pools.append({"ref_sha": sha, "shas": {sha}, "flags": flags, "rows": list(rs)})

    print(f"\n  hot path: {len(files)} files (measured by execution)   "
          f"pools: {len(pools)}   pool flags: {POOL_FLAGS}")

    for i, p in enumerate(pools, 1):
        v = [r["timing"]["total"] for r in p["rows"] if "total" in r.get("timing", {})]
        n = len(v)
        print("\n" + "-" * 66)
        print(f"POOL {i}   n={n}   flags {dict(zip(POOL_FLAGS, p['flags']))}")
        print(f"  SHAs pooled ({len(p['shas'])}, hot path byte-identical): "
              + " ".join(sorted(p["shas"])))
        for label, field in (("total_ms", "total"), ("reader_ms", "reader"),
                             ("reconstructed_fetch", "reconstructed_fetch"),
                             ("rf_materialise", "rf_materialise"),
                             ("post_reader_ms", "post"), ("encode_render", "encode_render")):
            vals = [r["timing"][field] for r in p["rows"] if field in r.get("timing", {})]
            print(f"  {label:>20}  {stats(vals)}")
        if n:
            above = 0.95 ** n
            print(f"\n  P(true p95 lies ABOVE the worst read seen) = 0.95^{n} = {above:.3f}")
            if n >= N_FOR_P95:
                print(f"  ✅ p95 ESTIMABLE: the max ({max(v):.1f} ms) is a 95% upper bound "
                      f"(n={n} ≥ {N_FOR_P95})")
            else:
                print(f"  ⛔ p95 NOT estimable: n={n}, need {N_FOR_P95} "
                      f"({N_FOR_P95 - n} more on this pool)")
            under = sum(1 for x in v if x <= 1000)
            print(f"  samples ≤ 1000 ms: {under}/{n}"
                  + (f"   worst: {max(v):.1f} ms" if v else ""))

    if warm:
        print("\n" + "-" * 66)
        print("WARM days=365 (the P-B4 control), by flag state:")
        wg = collections.defaultdict(list)
        for r in warm:
            wg[tuple(r.get("timing", {}).get(f) for f in POOL_FLAGS)].append(
                r["timing"].get("total"))
        for k, vals in wg.items():
            vals = [x for x in vals if x is not None]
            print(f"  {dict(zip(POOL_FLAGS, k))}  {stats(vals)}")
    print("=" * 66)
    return 0


SUMMARY = REPO / "docs" / "breadth-history-reader" / "sampler-summary.md"

SUMMARY_HEADER = (
    "<!-- GENERATED FILE - do not edit by hand.\n"
    "     Written by tools/breadth_sampler_report.py on every run.\n"
    "     NOT A SOURCE: no rail may treat this as an authority for any number in it.\n"
    "     The authority is logs/breadth-samples.jsonl and the git history it points at.\n"
    "     NO MEMBER DATA: the pool holds request TIMINGS, flag states and a commit SHA\n"
    "     only - no user ids, no emails, no request bodies, no response content. It is\n"
    "     safe to publish, and that is a property of what the sampler records, not a\n"
    "     promise about redaction.\n"
    "-->\n")


def _run_and_capture() -> int:
    """⛔ C.1: the same text goes to stdout AND to the summary file. Two renderings of
    one run could disagree; one rendering written twice cannot."""
    import contextlib
    import io as _io
    buf = _io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = main()
    text = buf.getvalue()
    sys.stdout.write(text)
    try:
        SUMMARY.parent.mkdir(parents=True, exist_ok=True)
        with SUMMARY.open("w", encoding="utf-8", newline="\n") as fh:
            fh.write(SUMMARY_HEADER)
            fh.write("\n# Breadth sampler - pool summary\n\n```\n")
            fh.write(text.rstrip("\n"))
            fh.write("\n```\n")
        print(f"[wrote {SUMMARY.relative_to(REPO)}]")
    except Exception as e:
        print(f"[summary NOT written: {type(e).__name__}: {e}]")
    return rc


if __name__ == "__main__":
    sys.exit(_run_and_capture())
