"""Report a breadth reader sampling pool: p50, p95 with an EXACT CI, and why n >= 59.

    python tools/breadth_pool_report.py                 # the default pool
    python tools/breadth_pool_report.py --self-check

⛔ A POOL IS A POPULATION, NOT A FILE. Rows are only comparable when they came from the
same deployed code on the same reader configuration, so this groups by
(reader fingerprint, observed flag) and refuses to pool across groups silently.

⚰️ This paragraph used to say it grouped by `(sha, flag_observed)`, and BOTH halves were
wrong in the same way: the SHA is a proxy for the code (see `reader_fingerprint`), and the
stored `flag_observed` is a proxy for which reader ran (see `observed_flag`). Both are now
DERIVED from what the row actually carries — the hot-path blobs, and the published phase
keys. A docstring describing a rule the code does not implement is this repository's
most-repeated defect, and it was committed here, in the module that exists to catch it.

⛔ Rows that never ran the reader are dropped entirely — see `reader_ran`.

⭐ WHY 59. The largest value in a sample of n exceeds the true 95th percentile with
probability 1 - 0.95^n. At n = 20 that is only 64% — a p95 "estimate" there is mostly the
sampler's luck. At n = 59, 1 - 0.95^59 = 95.3%, which is the first n at which the sample
maximum bounds the p95 at 95% confidence. Below 59 this prints NOT ESTIMABLE and says how
many more rows are needed, rather than printing a number that reads like a measurement.
"""
from __future__ import annotations

import argparse
import collections
import functools
import hashlib
import json
import math
import pathlib
import statistics
import subprocess
import sys

DEFAULT_POOL = pathlib.Path("C:/Users/Patrick/uct-breadth-pool/breadth-samples.jsonl")
#: The measured set of files that EXECUTE during a deep cold read. This file is the
#: programme's definition of reader identity; see its own header for how it was traced.
HOTPATH_LIST = pathlib.Path(__file__).resolve().parents[1] / "docs/breadth/reader-hotpath.txt"
REPO = str(pathlib.Path(__file__).resolve().parents[1])
P95_N_FOR_95PC_CONFIDENCE = 59
ANALYSIS_UPTIME_FLOOR = 600

#: Timing keys that are COUNTS or BYTES, not milliseconds. Ranking these beside real
#: phases reports a counter as a duration. Listed explicitly: a pattern guess ("anything
#: starting io_") missed rf_bytes, rf_rows and rf_stmts on the first attempt.
NON_DURATION_KEYS = frozenset({
    "io_rchar", "io_read_bytes", "io_syscr", "merged_dates",
    "rf_bytes", "rf_busy_retries", "rf_conn_reused", "rf_pagecache",
    "rf_rows", "rf_stmts",
})
COLLECTION_UPTIME_FLOOR = 300


def load(path: pathlib.Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return out


def hotpath_files() -> list[str]:
    """Read the hot-path list. Entries must be usable verbatim as git pathspecs.

    ⚠️ THIS FILE IS CRLF ON DISK (26/26 lines) AND LF IN THE STORED BLOB. Python is
    safe here and the rail below proves the entries resolve, not that .strip() saved
    us: str.splitlines() treats \\r\\n as one boundary and discards both bytes, so the
    strip() guards trailing spaces, not the line ending.

    ⚰️ A SHELL LOOP OVER THIS FILE IS NOT SAFE, and that is worth recording because it
    cost a wrong answer on 2026-09-16. `while read -r f` keeps the \\r, so the pathspec
    became 'api/main.py\\r'; with plain `git rev-parse` (no --verify) an unresolvable
    argument is ECHOED BACK rather than failing, so the comparison diffed two literal
    strings and reported ALL EIGHT hot-path files as different between two commits
    whose hot path is byte-identical. Always --verify, and never parse this list in sh."""
    if not HOTPATH_LIST.exists():
        return []
    return [ln.strip() for ln in HOTPATH_LIST.read_text(encoding="utf-8").splitlines()
            if ln.strip() and not ln.strip().startswith("#")]


@functools.lru_cache(maxsize=None)
def reader_fingerprint(sha: str) -> str | None:
    """The POOL'S IDENTITY: a digest of the hot-path blobs at `sha`, or None.

    ⭐ THE SHA IS NOT THE IDENTITY. This module's own contract is that rows are
    comparable when they came from "the same deployed code on the same reader
    configuration" — and a commit that changes a README does not change the reader.
    Grouping by SHA is a PROXY for that rule, and a stricter one: it shatters a pool
    every time any commit lands, which on a repo taking ~31 commits a day means a
    pool can never reach the n that p95 needs. Measured 2026-09-16: four of the five
    sampled SHAs were byte-identical across all eight hot-path files, so 73 rows that
    were being reported as four separate populations of 8/12/19/34 are one.

    ⛔ None IS NOT 'DIFFERENT'. If any blob cannot be resolved — a pruned object, a
    shallow clone, a renamed file — this returns None and the caller falls back to
    grouping by SHA and SAYS SO. An unreadable identity must never silently pool two
    populations together; the failure direction is the stricter grouping."""
    files = hotpath_files()
    if not files:
        return None
    blobs = []
    for f in files:
        r = subprocess.run(["git", "-C", REPO, "rev-parse", "--verify", "-q", f"{sha}:{f}"],
                           capture_output=True, encoding="utf-8")
        if r.returncode != 0 or not r.stdout.strip():
            return None
        blobs.append(r.stdout.strip())
    return hashlib.sha1("|".join(blobs).encode()).hexdigest()[:12]


#: The phases only the SQLite reader emits. See breadth_sampler.flag_evidence.
FETCH_PHASES = ("rf_open", "rf_pragma", "rf_execute", "rf_fetch", "rf_conn_reused")


def observed_flag(r) -> str:
    """Which reader served this row, DERIVED from its phase keys.

    ⛔ THE STORED `flag_observed` IS ADVISORY AND MAY BE VACUOUS. Until 2026-09-17 the
    sampler derived it from `rf_resident`, which `server_timing()` never publishes, so
    every row written before that fix says "off" whatever the flag actually was — including
    rows taken while the resident reader was demonstrably serving. Deriving here means a
    pool collected across the fix is still correctly grouped, instead of splitting on when
    the label happened to be written.

    ⭐ Same rule as everywhere else in this programme: derive from the evidence the row
    carries, never restate a field somebody else computed."""
    keys = set(r.get("phase_keys") or (r.get("timing") or {}).keys())
    if not keys:
        return "unknown"
    if "rf_resident" in keys:
        return "on"
    if any(p in keys for p in FETCH_PHASES):
        return "off"
    if "rf_materialise" in keys:
        return "on"
    return "unknown"


def reader_ran(r) -> bool:
    """Did the READER actually execute, or did this request hit a cache?

    ⚰️ 2026-09-17: five rows in the pool are `kind=deep_cold, ok=True` and were CACHE
    HITS — `reader` phase 0.0, totals of 69-168 ms against a ~300 ms population. Cause:
    the sampler forces a miss by varying the span, and each `--once` invocation is a
    fresh process that computes the SAME span, so repeated one-shots re-read a span the
    previous one had just warmed. The long-running loop varies it correctly; four
    consecutive one-shots do not.

    ⛔ TWO OF THE FIVE ARE IN READER `b8873db0f2ab` AND WERE PUBLISHED. They are why that
    pool's reported minimum was 70.2 ms, and they bias its median FAST — a cache hit
    banked as a deep cold read is not a slightly-optimistic sample, it is a measurement
    of a different thing wearing the same label.

    ⭐ `kind` records what the sampler INTENDED; `reader` records what the pod DID. When
    they disagree the pod wins, which is the same rule as flag_declared vs flag_observed
    one layer down."""
    v = (r.get("timing") or {}).get("reader")
    return isinstance(v, (int, float)) and v > 0


def deep_ok(rows):
    return [r for r in rows if r.get("ok") and r.get("kind") == "deep_cold"
            and isinstance(r.get("timing"), dict)
            and isinstance(r["timing"].get("total"), (int, float))
            and reader_ran(r)]


def spearman(xs, ys) -> float | None:
    """Rank correlation without scipy. None when it cannot be computed."""
    n = len(xs)
    if n < 3:
        return None

    def ranks(v):
        order = sorted(range(n), key=lambda i: v[i])
        r = [0.0] * n
        i = 0
        while i < n:
            j = i
            while j + 1 < n and v[order[j + 1]] == v[order[i]]:
                j += 1
            avg = (i + j) / 2.0 + 1.0
            for k in range(i, j + 1):
                r[order[k]] = avg
            i = j + 1
        return r

    rx, ry = ranks(xs), ranks(ys)
    mx, my = statistics.fmean(rx), statistics.fmean(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
    return None if den == 0 else num / den


def p95_with_confidence(values: list[float]) -> dict:
    """The sample max bounds the p95 at 1 - 0.95^n confidence. Honest below n=59."""
    n = len(values)
    s = sorted(values)
    conf = 1.0 - 0.95 ** n if n else 0.0
    out = {"n": n, "max": s[-1] if s else None, "confidence": conf,
           "estimable": n >= P95_N_FOR_95PC_CONFIDENCE,
           "need_more": max(0, P95_N_FOR_95PC_CONFIDENCE - n)}
    if s:
        idx = min(n - 1, max(0, math.ceil(0.95 * n) - 1))
        out["p95_point"] = s[idx]
    return out


def uptime_effect(rows) -> dict:
    """SD-1.7 H0.2: is a >=300 s row comparable to a >=600 s row, or not?"""
    xs = [r.get("uptime_s") or 0 for r in rows]
    ys = [r["timing"]["total"] for r in rows]
    rho = spearman(xs, ys)
    lo = [r["timing"]["total"] for r in rows
          if COLLECTION_UPTIME_FLOOR <= (r.get("uptime_s") or 0) < ANALYSIS_UPTIME_FLOOR]
    hi = [r["timing"]["total"] for r in rows
          if (r.get("uptime_s") or 0) >= ANALYSIS_UPTIME_FLOOR]
    res = {"rho": rho, "n_300_600": len(lo), "n_ge600": len(hi),
           "median_300_600": statistics.median(lo) if lo else None,
           "median_ge600": statistics.median(hi) if hi else None}
    if res["median_300_600"] is not None and res["median_ge600"]:
        res["pct_diff"] = abs(res["median_300_600"] - res["median_ge600"]) / res["median_ge600"] * 100
    else:
        res["pct_diff"] = None
    # The rule is a CONJUNCTION and needs both buckets populated; anything short of that
    # is "cannot tell", which must not read as "no effect".
    res["no_effect_provable"] = bool(
        rho is not None and abs(rho) < 0.3
        and res["pct_diff"] is not None and res["pct_diff"] < 20
        and len(lo) >= 8 and len(hi) >= 8)
    return res


def describe(group_rows, label) -> dict:
    vals = [r["timing"]["total"] for r in group_rows]
    s = sorted(vals)
    p95 = p95_with_confidence(vals)
    phases = collections.Counter()
    for r in group_rows:
        for k in (r.get("phase_keys") or list(r.get("timing") or {})):
            phases[k] += 1
    # Mean time per phase, for the floor question.
    # ⛔ NOT EVERY TIMING KEY IS A DURATION. `rf_bytes` is a byte count, `rf_rows` a row
    # count, `io_syscr` a syscall count. The first version of this ranked them beside real
    # phases and duly reported "rf_bytes=4523328.0 ms" as the heaviest phase — a counter
    # presented as a measurement, which is the false-instrument class this programme keeps
    # finding. The exclusion list is explicit and named rather than pattern-guessed.
    means = {}
    for k in phases:
        if k in NON_DURATION_KEYS:
            continue
        xs = [r["timing"][k] for r in group_rows
              if isinstance(r.get("timing", {}).get(k), (int, float))]
        if xs:
            means[k] = statistics.fmean(xs)
    return {"label": label, "n": len(vals),
            "p50": statistics.median(s) if s else None,
            "min": s[0] if s else None, "max": s[-1] if s else None,
            "p95": p95, "phase_means": means,
            "uptime": uptime_effect(group_rows)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool", default=str(DEFAULT_POOL))
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()

    rows = deep_ok(load(pathlib.Path(a.pool)))
    if not rows:
        print("no usable rows -- an empty pool is a failed read until proven otherwise")
        return 2

    # Group by READER IDENTITY, never by SHA. Unresolvable -> fall back to the SHA,
    # which is the stricter grouping, and label it so nobody reads it as a reader.
    groups = collections.defaultdict(list)
    unresolved = set()
    for r in rows:
        sha = r.get("sha")
        fp = reader_fingerprint(sha) if sha else None
        if fp is None and sha:
            unresolved.add(sha)
        groups[(fp or f"sha:{sha}", observed_flag(r))].append(r)

    print(f"pool: {a.pool}")
    print(f"usable deep_cold rows: {len(rows)}   readers: {len(groups)}")
    print(f"identity: hot-path byte-identity over {len(hotpath_files())} files "
          f"({HOTPATH_LIST.name})")
    if unresolved:
        # ASCII only: this box's stdout is cp1252 and a non-ASCII byte raises
        # UnicodeEncodeError mid-report, killing the run after it has printed half its
        # findings. Same trap as tools/flag_ledger_audit.py, which reported "could not
        # enumerate the project's services" -- an encoding bug wearing an auth error's
        # clothes. Emoji stay in comments and docstrings, which are never encoded.
        print(f"WARNING: {len(unresolved)} sha(s) could not be fingerprinted and are "
              f"grouped ALONE by sha (never pooled): {', '.join(sorted(unresolved))}")
    print()
    for key, g in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        shas = sorted({r.get("sha") for r in g if r.get("sha")})
        d = describe(g, f"reader={key[0]} flag={key[1]}")
        # ⛔ SHOW THE CONSTITUENTS. Pooling is only safe if the sub-populations agree,
        # and the reader can only judge that if the per-sha medians are on the page.
        if len(shas) > 1:
            meds = []
            print(f"  pooled from {len(shas)} deploys:")
            for s in shas:
                sub = sorted(r["timing"]["total"] for r in g if r.get("sha") == s)
                meds.append(statistics.median(sub))
                print(f"      {s}  n={len(sub):>3}  p50={statistics.median(sub):>7.1f} ms")
            spread = (max(meds) - min(meds)) / min(meds) * 100
            flag = "   <-- SUB-POPULATIONS DISAGREE: inspect before quoting a pooled p95" \
                   if spread >= 30 else ""
            print(f"      median spread across deploys: {spread:.1f}%{flag}")
        print(f"=== {d['label']}  n={d['n']} ===")
        print(f"  p50 {d['p50']:.1f} ms   min {d['min']:.1f}   max {d['max']:.1f}")
        p = d["p95"]
        if p["estimable"]:
            print(f"  p95 <= {p['max']:.1f} ms at {p['confidence']*100:.1f}% confidence (n={p['n']})")
        else:
            print(f"  p95 NOT ESTIMABLE at n={p['n']} "
                  f"(sample max bounds p95 at only {p['confidence']*100:.0f}% confidence; "
                  f"need {p['need_more']} more rows for 95%)")
            if p.get("p95_point"):
                print(f"      point estimate {p['p95_point']:.1f} ms -- descriptive only, not a bound")
        # SD-1.7 H0.2: COLLECT at 300 s (more rows), ANALYSE at 600 s. The 300-600 s
        # bucket is measurably slower (n=73, rho=-0.303, medians ~23% apart), so a
        # headline p95 computed over it is reporting settle-state, not the reader.
        # Reported as a SECOND line rather than replacing the first: dropping rows
        # silently is how a number gets better without anyone deciding it should.
        settled = [r for r in g if (r.get("uptime_s") or 0) >= ANALYSIS_UPTIME_FLOOR]
        if settled and len(settled) != len(g):
            sv = sorted(r["timing"]["total"] for r in settled)
            sp = p95_with_confidence(sv)
            line = (f"  at the >={ANALYSIS_UPTIME_FLOOR}s analysis floor: n={len(sv)}  "
                    f"p50 {statistics.median(sv):.1f} ms  ")
            if sp["estimable"]:
                line += f"p95 <= {sp['max']:.1f} ms at {sp['confidence']*100:.1f}% confidence"
            else:
                line += (f"p95 NOT ESTIMABLE (need {sp['need_more']} more)")
            print(line)
            print(f"      dropped {len(g)-len(sv)} unsettled row(s) from this line only")

        u = d["uptime"]
        rho_s = "n/a" if u["rho"] is None else f"{u['rho']:+.2f}"
        print(f"  uptime: rho={rho_s}  n(300-600)={u['n_300_600']}  n(>=600)={u['n_ge600']}"
              + (f"  medians {u['median_300_600']:.1f}/{u['median_ge600']:.1f} "
                 f"({u['pct_diff']:.1f}% apart)" if u["pct_diff"] is not None else ""))
        print(f"  no uptime effect provable: {u['no_effect_provable']}")
        top = sorted(d["phase_means"].items(), key=lambda kv: -kv[1])[:6]
        print("  heaviest phases (mean ms): "
              + ", ".join(f"{k}={v:.1f}" for k, v in top if not k.startswith("io_")))
        print()
    return 0


def self_check() -> int:
    ok = True
    # n=59 is the first n at which the sample max bounds p95 at >=95%.
    if not (p95_with_confidence([1.0] * 58)["estimable"] is False
            and p95_with_confidence([1.0] * 59)["estimable"] is True):
        print("FAIL: the n>=59 boundary is wrong"); ok = False
    c58 = 1 - 0.95 ** 58
    c59 = 1 - 0.95 ** 59
    if not (c58 < 0.95 <= c59):
        print(f"FAIL: confidence maths ({c58:.4f}, {c59:.4f})"); ok = False
    # Spearman recovers a known monotone relationship and a known null.
    if not (spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]) > 0.99):
        print("FAIL: spearman on a monotone pair"); ok = False
    if abs(spearman([1, 2, 3, 4], [3, 1, 4, 2])) > 0.9:
        print("FAIL: spearman on a scrambled pair"); ok = False
    # A one-sided bucket must NOT read as "no effect".
    u = uptime_effect([{"uptime_s": 900, "timing": {"total": 100.0}} for _ in range(20)])
    if u["no_effect_provable"]:
        print("FAIL: an absent 300-600 bucket must not prove absence of an effect"); ok = False

    # ⛔ THE REAL PROPERTY IS "EVERY ENTRY RESOLVES AT HEAD", not "no CR". A CR check
    # passes vacuously (splitlines already removed it) and would read as coverage while
    # proving nothing. This asks git, which is the only thing that can answer, and so it
    # also catches the list drifting away from the repo after a rename or a deletion.
    files = hotpath_files()
    if not files:
        print("FAIL: no hot-path files read -- identity cannot be computed"); ok = False
    elif any(f.startswith("#") for f in files):
        print("FAIL: comment lines leaked into the hot-path file list"); ok = False
    else:
        bad = []
        for f in files:
            r = subprocess.run(["git", "-C", REPO, "rev-parse", "--verify", "-q", f"HEAD:{f}"],
                               capture_output=True, encoding="utf-8")
            if r.returncode != 0:
                bad.append(f)
        if bad:
            print(f"FAIL: {len(bad)} hot-path entr(ies) do not resolve at HEAD: {bad}")
            ok = False
        # Non-vacuity: the same probe MUST fail on a path that does not exist, or it is
        # answering 'fine' to everything and the check above is decoration.
        probe = subprocess.run(
            ["git", "-C", REPO, "rev-parse", "--verify", "-q", "HEAD:api/__no_such_file__.py"],
            capture_output=True, encoding="utf-8")
        if probe.returncode == 0:
            print("FAIL: the resolve probe accepts a nonexistent path -- it cannot fail")
            ok = False

    # A real commit must fingerprint, and a nonexistent one must return None rather
    # than a value that would let two populations pool on a failed read.
    head = subprocess.run(["git", "-C", REPO, "rev-parse", "--verify", "-q", "HEAD"],
                          capture_output=True, encoding="utf-8")
    if head.returncode == 0:
        if reader_fingerprint(head.stdout.strip()) is None:
            print("FAIL: HEAD could not be fingerprinted -- the control cannot see a hit")
            ok = False
    if reader_fingerprint("0" * 40) is not None:
        print("FAIL: an unresolvable sha must fingerprint to None, never to a value")
        ok = False

    # A cache hit is not a reader measurement, and the control proves the filter can
    # still SEE a real read -- a filter that rejects everything reports an empty pool,
    # which reads as "no data" rather than as a broken screen.
    hit = {"ok": True, "kind": "deep_cold", "timing": {"total": 69.0, "reader": 0.0}}
    real = {"ok": True, "kind": "deep_cold", "timing": {"total": 300.0, "reader": 180.0}}
    kept = deep_ok([hit, real])
    if len(kept) != 1 or kept[0] is not real:
        print(f"FAIL: deep_ok must drop the cache hit and keep the real read (kept {len(kept)})")
        ok = False
    if reader_ran(hit) or not reader_ran(real):
        print("FAIL: reader_ran cannot distinguish a cache hit from a real read"); ok = False
    print("self-check:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
