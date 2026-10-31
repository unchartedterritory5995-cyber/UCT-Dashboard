# -*- coding: utf-8 -*-
"""remeasure.py - re-run the member-door census and record the coverage number, dated.

    python C:/Users/Patrick/uct-clips/tools/heavy_lock.py run --label pine-remeasure -- \
        python tools/support_loop/remeasure.py --cache <sample cache> --ref <pine_v6_reference.json> \
        [--history <dir>] [--sync-master]

Spec: docs/pine/support-loop/PHASE-B.md ("Re-measure"). What it does:

1. ``--sync-master`` (optional): moves THIS checkout to origin/master, only when it is a
   clean, detached-HEAD worktree kept for measuring (it refuses otherwise).
2. Runs ``tools/pine_coverage/run_census.py`` over the cached sample into a FRESH run
   directory (the census appends, so a re-measure never reuses an old answer).
3. Scores every sample script with ``coverage_map.transfers_fully`` (the headline
   predicate, imported) and appends one dated row to ``<history>/coverage-history.jsonl``.
4. Writes ``<history>/coverage-latest.md``: the number, the change since the previous
   row, and the scripts that started or STOPPED transferring.

Writes nothing in the repo. The census is heavy (about 10 minutes, 6 GB node heap):
always through heavy_lock. Exit 0 = measured; 1 = the census did not answer every
script; 3 = measured, and at least one script stopped transferring (a regression).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

REPO = Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from tools.pine_coverage import coverage_map as cm  # noqa: E402

DEFAULT_HISTORY = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "uct-support-loop" / "coverage-history"


def git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, timeout=300)


def sync_master(repo: Path) -> str:
    if git(repo, "status", "--porcelain").stdout.strip():
        raise SystemExit("--sync-master refuses: the measuring checkout has local changes")
    if git(repo, "symbolic-ref", "-q", "HEAD").returncode == 0:
        raise SystemExit("--sync-master refuses: the measuring checkout is on a branch; use a detached "
                         "worktree kept for measuring (git worktree add --detach <dir> origin/master)")
    if git(repo, "fetch", "origin", "master").returncode != 0:
        raise SystemExit("--sync-master: git fetch failed")
    r = git(repo, "switch", "--detach", "origin/master")
    if r.returncode != 0:
        raise SystemExit("--sync-master: could not move to origin/master")
    return git(repo, "rev-parse", "--short=10", "HEAD").stdout.strip()


def prepare_run(cache: Path, run_dir: Path) -> None:
    """A fresh run directory whose manifest points at the cached SOURCES by absolute path."""
    run_dir.mkdir(parents=True, exist_ok=True)
    man = json.loads((cache / "sample_manifest.json").read_text(encoding="utf-8"))
    for r in man["rows"]:
        r["path"] = r["path"].replace("<cache>", str(cache))
    (run_dir / "sample_manifest.json").write_text(json.dumps(man, indent=1), encoding="utf-8")


def summarize(run_dir: Path, ref: Path, repo: Path = REPO) -> dict:
    inv = cm.Inventory(json.loads(Path(ref).read_text(encoding="utf-8")))
    census = {}
    for line in (run_dir / "census.jsonl").read_text(encoding="utf-8").splitlines():
        if line.strip():
            d = json.loads(line)
            census[d["key"]] = d
    inputs = json.loads((run_dir / "census_input.json").read_text(encoding="utf-8"))
    scripts, by_pop, ex_total, ex_clean = {}, {}, 0, 0
    for it in inputs:
        k = it["key"]
        if k.startswith("example:"):
            ex_total += 1
            ex_clean += 1 if (census.get(k) or {}).get("clean") else 0
            continue
        p = Path(it["path"])
        if not p.exists():
            # ⛔ Never score a script whose source is missing: an empty source has no
            # strategy declaration, so a missing file would silently count as transferring.
            raise SystemExit(f"census input {k}: source missing at {p}")
        src = p.read_text(encoding="utf-8")
        ok = cm.transfers_fully(census.get(k), cm.usage_of(src, inv))
        scripts[k] = ok
        pop = k.split(":")[0]
        b = by_pop.setdefault(pop, {"scripts": 0, "transfer": 0})
        b["scripts"] += 1
        b["transfer"] += int(ok)
    n, t = len(scripts), sum(scripts.values())
    return {"sample": n, "transfer": t, "transferPct": round(100.0 * t / n, 1) if n else 0.0,
            "byPopulation": dict(sorted(by_pop.items())),
            "examples": {"total": ex_total, "transfer": ex_clean}, "scripts": scripts}


def diff(prev: Optional[dict], cur: dict) -> dict:
    if not prev:
        return {"first": True, "gained": [], "lost": [], "delta": None}
    ps, cs = prev.get("scripts") or {}, cur["scripts"]
    return {"first": False,
            "gained": sorted(k for k, v in cs.items() if v and not ps.get(k)),
            "lost": sorted(k for k, v in cs.items() if not v and ps.get(k)),
            "delta": cur["transfer"] - prev.get("transfer", 0),
            "sample_changed": cur["sample"] != prev.get("sample")}


def render(row: dict, d: dict, prev: Optional[dict]) -> str:
    L = [f"# Pine coverage, {row['date']} (build `{row['sha']}`)", "",
         f"**{row['transfer']} of {row['sample']} sampled scripts ({row['transferPct']}%) transfer fully** "
         "through the member door (`coverage_map.transfers_fully`).", ""]
    if d["first"]:
        L.append("First row of the history: nothing to compare against.")
    else:
        L.append(f"Change since {prev['date']} (`{prev['sha']}`): **{d['delta']:+d}** "
                 f"({prev['transfer']} -> {row['transfer']}).")
        if d.get("sample_changed"):
            L.append(f"⚠️ The sample changed size ({prev['sample']} -> {row['sample']}): compare percentages.")
    L += ["", "| population | scripts | transfer |", "|---|---:|---:|"]
    for pop, b in row["byPopulation"].items():
        L.append(f"| {pop} | {b['scripts']} | {b['transfer']} |")
    L.append(f"| TradingView reference examples | {row['examples']['total']} | {row['examples']['transfer']} |")
    if d["gained"]:
        L += ["", f"## Started transferring ({len(d['gained'])})", ""] + [f"- `{k}`" for k in d["gained"]]
    if d["lost"]:
        L += ["", f"## ⛔ STOPPED transferring ({len(d['lost'])}): regressions", ""] + [f"- `{k}`" for k in d["lost"]]
    return "\n".join(L) + "\n"


def record(history: Path, cur: dict, *, sha: str, date: str) -> tuple[dict, dict, str]:
    history.mkdir(parents=True, exist_ok=True)
    hist = history / "coverage-history.jsonl"
    prev = None
    if hist.exists():
        lines = [x for x in hist.read_text(encoding="utf-8").splitlines() if x.strip()]
        if lines:
            prev = json.loads(lines[-1])
            snap = history / "scripts" / f"{prev['date']}_{prev['sha']}.json"
            prev["scripts"] = json.loads(snap.read_text(encoding="utf-8")) if snap.exists() else {}
    d = diff(prev, cur)
    row = {"date": date, "sha": sha, "sample": cur["sample"], "transfer": cur["transfer"],
           "transferPct": cur["transferPct"], "byPopulation": cur["byPopulation"],
           "examples": cur["examples"], "delta": d["delta"], "gained": len(d["gained"]), "lost": len(d["lost"])}
    (history / "scripts").mkdir(exist_ok=True)
    (history / "scripts" / f"{date}_{sha}.json").write_text(json.dumps(cur["scripts"], indent=0, sort_keys=True),
                                                         encoding="utf-8")
    with open(hist, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, separators=(",", ":")) + "\n")
    md = render(row, d, prev)
    tmp = history / "coverage-latest.md.tmp"
    tmp.write_text(md, encoding="utf-8")
    os.replace(tmp, history / "coverage-latest.md")
    return row, d, md


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", type=Path, required=True)
    ap.add_argument("--ref", type=Path, required=True)
    ap.add_argument("--history", type=Path, default=DEFAULT_HISTORY)
    ap.add_argument("--repo", type=Path, default=REPO)
    ap.add_argument("--sync-master", action="store_true")
    a = ap.parse_args(argv)
    repo = a.repo.resolve()
    sha = sync_master(repo) if a.sync_master else git(repo, "rev-parse", "--short=10", "HEAD").stdout.strip()
    date = dt.date.today().isoformat()
    run_dir = a.history / "runs" / f"{date}_{sha}"
    if run_dir.exists():
        import shutil
        shutil.rmtree(run_dir)
    prepare_run(a.cache.resolve(), run_dir)
    rc = subprocess.call([sys.executable, str(repo / "tools/pine_coverage/run_census.py"),
                          "--cache", str(run_dir), "--ref", str(a.ref.resolve())], cwd=str(repo))
    if rc != 0:
        print(f"census incomplete (rc={rc}); nothing recorded. Run dir: {run_dir}")
        return 1
    cur = summarize(run_dir, a.ref)
    row, d, _ = record(a.history, cur, sha=sha, date=date)
    print(f"{row['transfer']}/{row['sample']} ({row['transferPct']}%) transfer fully on {sha}; "
          f"delta {d['delta']}; gained {len(d['gained'])}, lost {len(d['lost'])}. "
          f"See {a.history / 'coverage-latest.md'}")
    return 3 if d["lost"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
