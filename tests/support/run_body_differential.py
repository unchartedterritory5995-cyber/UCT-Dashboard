"""Old versus new, for every route converted to `request_body_cap.capped_json`.

    python tests/support/run_body_differential.py --work <an empty scratch dir> [--old 72715e8001]

1. NEW tree (this checkout): describe the routes and build the requests.
2. OLD tree: `git archive <old>` extracted into the work dir. Never a checkout.
3. Replay the same requests against each tree, each in its own process, with
   every handler replaced by one that answers the parsed body.
4. Compare. Write the table and the raw answers to
   docs/notebook/evidence/fin-voice/differential/.

Exit 1 when any difference is not one of the two intended kinds.

This script imports nothing from `api`: both sides run under pytest, where each
tree's own conftest pins every data path to a sandbox.
"""
from __future__ import annotations

import argparse
import collections
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PROBE = Path(__file__).with_name("body_differential_probe.py")
OUT = REPO / "docs" / "notebook" / "evidence" / "fin-voice" / "differential"
# What the old backend needs to import: its own code, the conftests, and the
# data files `api` reads at import (some live under app/src, docs/api, scripts, tools).
OLD_PATHS = ["api", "conftest.py", "pytest.ini", "tests/conftest.py", "tests/__init__.py",
             "themes_taxonomy.json", "app/src", "docs/api", "docs/feature_flags.json", "scripts", "tools"]


def _pytest(cwd: Path, probe: Path, env_extra: dict, log: Path) -> None:
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", **env_extra)
    with open(log, "w", encoding="utf-8") as fh:
        rc = subprocess.run([sys.executable, "-m", "pytest", str(probe), "-q", "-p", "no:cacheprovider"],
                            cwd=cwd, env=env, stdout=fh, stderr=subprocess.STDOUT).returncode
    text = log.read_text(encoding="utf-8", errors="replace")
    totals = [l for l in text.splitlines() if " passed" in l or " failed" in l or " error" in l]
    if rc != 0 or not totals or "1 passed" not in totals[-1]:
        raise SystemExit(f"the probe did not run cleanly in {cwd} (rc={rc}): {totals[-1:] or 'NO TOTALS LINE'}; see {log}")


def _extract_old(sha: str, dest: Path) -> None:
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    blob = subprocess.run(["git", "-C", str(REPO), "archive", sha, *OLD_PATHS], capture_output=True, check=True).stdout
    assert len(blob) > 1_000_000, "git archive returned almost nothing"
    with tarfile.open(fileobj=io.BytesIO(blob)) as tar:
        tar.extractall(dest)


def classify(case: dict, old: dict, new: dict) -> str:
    """'same', 'intended: ...', or 'REGRESSION'."""
    if old == new:
        return "same"
    if case.get("anonymous") and new.get("status") == 401:
        return "intended: answered before the body is read (no session)"
    if case.get("declare_over_cap") and new.get("status") == 413:
        return "intended: over the cap, 413"
    return "REGRESSION"


def _short(answer: dict) -> str:
    if "errors" in answer:
        return f"{answer['status']} " + "; ".join(f"{e['type']}@{'.'.join(map(str, e['loc']))}" for e in answer["errors"])
    if "json" in answer:
        text = json.dumps(answer["json"], sort_keys=True)
        return f"{answer['status']} {text[:110]}{'...' if len(text) > 110 else ''}"
    return f"{answer.get('status')} {answer.get('raw', '')[:110]}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--old", default="72715e8001")
    args = ap.parse_args()
    work = Path(args.work).resolve()
    work.mkdir(parents=True, exist_ok=True)
    assert REPO not in work.parents and work != REPO, "the work dir must be outside the repository"
    new_sha = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short=10", "HEAD"],
                             capture_output=True, text=True, check=True).stdout.strip()
    dirty = subprocess.run(["git", "-C", str(REPO), "status", "--short", "--", "api"],
                           capture_output=True, text=True, check=True).stdout.strip()

    cases_path = work / "cases.json"
    _pytest(REPO, PROBE, {"FV_DIFF_MODE": "describe", "FV_DIFF_OUT": str(cases_path)}, work / "describe.log")
    spec = json.loads(cases_path.read_text(encoding="utf-8"))

    old_tree = work / "old_tree"
    _extract_old(args.old, old_tree)
    old_probe = old_tree / "tests" / "fv_body_differential_probe.py"
    shutil.copyfile(PROBE, old_probe)

    replay = {"FV_DIFF_MODE": "replay", "FV_DIFF_CASES": str(cases_path)}
    _pytest(old_tree, old_probe, {**replay, "FV_DIFF_OUT": str(work / "old.json")}, work / "old.log")
    _pytest(REPO, PROBE, {**replay, "FV_DIFF_OUT": str(work / "new.json")}, work / "new.log")
    old = json.loads((work / "old.json").read_text(encoding="utf-8"))
    new = json.loads((work / "new.json").read_text(encoding="utf-8"))

    rows, by_kind, by_group = [], collections.Counter(), collections.defaultdict(collections.Counter)
    per_route = []
    for r in spec["routes"]:
        key = f"{r['method']} {r['path']}"
        o_side, n_side = old.get(key, {}), new.get(key, {})
        counts = collections.Counter()
        for case in r["cases"]:
            o, n = o_side.get(case["id"], {"status": "MISSING"}), n_side.get(case["id"], {"status": "MISSING"})
            verdict = classify(case, o, n)
            counts[verdict.split(":")[0]] += 1
            by_kind[verdict] += 1
            by_group[case["group"]][verdict.split(":")[0]] += 1
            if verdict != "same":
                rows.append((verdict, key, r["kind"], case["id"], _short(o), _short(n)))
        per_route.append((key, r["kind"], r["cap"], len(r["cases"]), counts))

    regressions = [x for x in rows if x[0] == "REGRESSION"]
    total = sum(len(r["cases"]) for r in spec["routes"])
    OUT.mkdir(parents=True, exist_ok=True)
    for name in ("cases.json", "old.json", "new.json"):
        shutil.copyfile(work / name, OUT / name)

    md = [f"# Body differential: `{args.old}` (old) against `{new_sha}` (new)", "",
          "Generated by `python tests/support/run_body_differential.py`. Do not edit by hand.", "",
          f"{len(spec['routes'])} routes, {total} requests each side. "
          f"The working tree's `api/` was {'CLEAN' if not dirty else 'DIRTY (uncommitted changes)'} when this ran.", "",
          "Every request is sent to both trees with the same signed-in paid session (or none, for the",
          "anonymous cases), on a temporary database each tree's own conftest pins. Each handler is replaced",
          "by one that answers the parsed body, so what is compared is how the request body becomes the",
          "handler's argument: the status, the 422 error list (`type`, `loc`, `msg`, `ctx`), and for an",
          "accepted body the parsed value itself (for a model: its fields after defaults, and which were set).", "",
          "## Verdict", "",
          f"- identical: **{by_kind['same']}**"]
    for k in sorted(by_kind):
        if k.startswith("intended"):
            md.append(f"- {k}: **{by_kind[k]}**")
    md += [f"- **regressions: {len(regressions)}**", "", "## By kind of request", "",
           "| group | same | intended | regression |", "|---|---|---|---|"]
    for group in sorted(by_group):
        c = by_group[group]
        md.append(f"| {group} | {c['same']} | {c['intended']} | {c['REGRESSION']} |")
    md += ["", "## Regressions", ""]
    if regressions:
        md += ["| route | body | case | old | new |", "|---|---|---|---|---|"]
        md += [f"| `{k}` | {kind} | {cid} | `{o}` | `{n}` |" for _v, k, kind, cid, o, n in regressions]
    else:
        md.append("None.")
    md += ["", "## Intended differences", "",
           "Two kinds, and only these. Both are the purpose of the change.", "",
           "| kind | route | case | old | new |", "|---|---|---|---|---|"]
    md += [f"| {v.split(': ', 1)[1]} | `{k}` | {cid} | `{o}` | `{n}` |" for v, k, _kind, cid, o, n in rows
           if v.startswith("intended")]
    md += ["", "## Every route", "", "| route | body | cap (bytes) | requests | same | intended | regression |",
           "|---|---|---|---|---|---|---|"]
    md += [f"| `{k}` | {kind} | {cap} | {n} | {c['same']} | {c['intended']} | {c['REGRESSION']} |"
           for k, kind, cap, n, c in per_route]
    (OUT / "README.md").write_text("\n".join(md) + "\n", encoding="utf-8", newline="\n")
    print(f"{len(spec['routes'])} routes, {total} requests: {by_kind['same']} same, "
          f"{sum(v for k, v in by_kind.items() if k.startswith('intended'))} intended, {len(regressions)} REGRESSIONS")
    print(f"written to {OUT}")
    return 1 if regressions else 0


if __name__ == "__main__":
    raise SystemExit(main())
