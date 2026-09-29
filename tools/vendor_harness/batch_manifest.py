"""The vendor batch's target list — DERIVED from what the member door can build.

    python tools/vendor_harness/batch_manifest.py                 # census + manifest
    python tools/vendor_harness/batch_manifest.py --census-json F # reuse a census run
    python tools/vendor_harness/batch_manifest.py --check         # rebuild, compare, write nothing

⛔ NOTHING HERE IS TYPED. The list is:

    every `corpus/committed/*.pine`
      that `enterMemberDoor` (ourSide.js — the grader's own door) ATTACHES,
      under the door-flag state the GRADE step will run with,
    minus every script whose source sha256 is already the `source.sha256` of a
      capture under `tests/fixtures/vendor/harness/` (and any `--captured-dir`).

The census is `memberDoorCensus.measure.test.js`, run by name under vitest
because the door imports the engine, which only runs under vite's transform.

⭐ THE FLAG STATE IS READ, NOT ASSUMED. `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED`
changes what attaches (33 vs 55 of 266, measured 2026-09-28). Production armed it
2026-09-27, and vitest's `import.meta.env` has it unset unless the process env
sets it — so the grade step and this census must agree, and the manifest records
which state it selected on. Default: the state `docs/frontend_feature_flags.json`
records for production (`armed` = on), so the batch captures what a member can
actually build today.

Exit codes: 0 manifest written (or --check agrees) · 1 a measured problem
(corpus bytes disagree with the census, --check differs) · 2 INCONCLUSIVE (the
census could not run, or produced no totals line).
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import io
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

REPO = pathlib.Path(__file__).resolve().parents[2]
APP = REPO / "app"
CORPUS = REPO / "corpus" / "committed"
HARNESS_FIXTURES = REPO / "tests" / "fixtures" / "vendor" / "harness"
CENSUS_TEST = "src/components/chart/engine/__tests__/vendorHarness/memberDoorCensus.measure.test.js"
FLAG_LEDGER = REPO / "docs" / "frontend_feature_flags.json"
DEFAULT_OUT = REPO / "docs" / "pine" / "vendor-harness" / "batch-manifest.json"


def sha256_file(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def captured_shas(dirs) -> dict:
    """{source sha256 -> capture file} for every v1 capture in `dirs` (recursive)."""
    out = {}
    for d in dirs:
        d = pathlib.Path(d)
        if not d.exists():
            continue
        for f in sorted(d.rglob("*.json")):
            try:
                c = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            src = c.get("source") if isinstance(c, dict) else None
            if isinstance(c, dict) and c.get("schema") == "uct.vendor-capture/v1" and isinstance(src, dict):
                sha = src.get("sha256")
                if isinstance(sha, str) and len(sha) == 64:
                    out.setdefault(sha, str(f.relative_to(REPO)) if REPO in f.parents else str(f))
    return out


def ledger_flag_state(flag: str, ledger: pathlib.Path = FLAG_LEDGER) -> bool | None:
    """True/False from the frontend flag ledger's production status, or None if
    the ledger does not speak for this flag."""
    try:
        d = json.loads(ledger.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    entry = (d.get("flags") or d).get(flag) if isinstance(d, dict) else None
    if not isinstance(entry, dict) or "status" not in entry:
        return None
    return entry["status"] == "armed"


def run_census(out_file: pathlib.Path, flag_name_hint: str, flag_on: bool) -> dict:
    """Run the opt-in vitest census by name. The totals line and the exit code
    are both read; an absent totals line is a runner that never ran."""
    node = shutil.which("node")
    if not node:
        raise SystemExit("INCONCLUSIVE: node is not on PATH")
    env = dict(os.environ)
    env["VENDOR_BATCH_CENSUS"] = "1"
    env["VENDOR_BATCH_CENSUS_OUT"] = str(out_file)
    # the AMBIENT state is what the grade step will run with; set it the same way
    env[flag_name_hint] = "1" if flag_on else ""
    proc = subprocess.run(
        [node, "node_modules/vitest/vitest.mjs", "run", CENSUS_TEST],
        cwd=str(APP), env=env, capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=1800,
    )
    log = (proc.stdout or "") + (proc.stderr or "")
    totals = [ln for ln in log.splitlines() if "Tests" in ln and ("passed" in ln or "failed" in ln)]
    if proc.returncode != 0 or not totals or not out_file.exists():
        tail = "\n".join(log.splitlines()[-25:])
        raise SystemExit(f"INCONCLUSIVE: the census did not complete (exit {proc.returncode}, "
                         f"totals line {'present' if totals else 'ABSENT'}):\n{tail}")
    return json.loads(out_file.read_text(encoding="utf-8"))


def build_manifest(census: dict, flag_on: bool, captured: dict, flag_source: str) -> dict:
    state = "on" if flag_on else "off"
    rows = census["states"][state]
    corpus_files = sorted(p.name for p in CORPUS.glob("*.pine"))
    if len(rows) != len(corpus_files):
        raise ValueError(f"the census covers {len(rows)} scripts, the corpus holds {len(corpus_files)}")
    targets, already, refused = [], [], []
    for r in rows:
        on_disk = sha256_file(REPO / r["file"])
        if on_disk != r["sha256"]:
            raise ValueError(f"{r['file']}: the census read sha {r['sha256'][:12]} but the file on disk "
                             f"is {on_disk[:12]} — the corpus moved under the census; re-run it")
        if not r["attached"]:
            refused.append(r)
            continue
        if r["sha256"] in captured:
            already.append({"file": r["file"], "sha256": r["sha256"], "capture": captured[r["sha256"]]})
            continue
        targets.append({
            "slug": r["slug"],
            "path": r["file"],
            "sha256": r["sha256"],
            "bytes": r["bytes"],
            "plots": r.get("plots"),
            "drawsObjects": r.get("drawsObjects"),
            "largestWindow": r.get("largestWindow"),
        })
    slugs = [t["slug"] for t in targets]
    dup = {s for s in slugs if slugs.count(s) > 1}
    for t in targets:        # two corpus files can share a slug (different authors)
        if t["slug"] in dup:
            t["slug"] = f"{t['slug']}-{t['sha256'][:8]}"
    targets.sort(key=lambda t: t["slug"])
    return {
        "schema": "uct.vendor-batch-manifest/v1",
        "generatedBy": "tools/vendor_harness/batch_manifest.py",
        "derivation": {
            "census": census.get("generatedBy"),
            "door": census.get("door"),
            "corpus": census.get("corpus"),
            "doorFlag": {"name": census.get("flag"), "state": state, "source": flag_source,
                         "ambientInCensusRun": census.get("ambientFlagOn")},
            "excludedAlreadyCaptured": "source.sha256 of every uct.vendor-capture/v1 under the captured dirs",
        },
        "counts": {
            "corpus": len(rows),
            "doorAttached": len(rows) - len(refused),
            "doorRefused": len(refused),
            "alreadyCaptured": len(already),
            "targets": len(targets),
        },
        "alreadyCaptured": sorted(already, key=lambda a: a["file"]),
        "scripts": targets,
    }


def dump(obj) -> str:
    return json.dumps(obj, indent=1, ensure_ascii=False) + "\n"


def write_atomic(path: pathlib.Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=path.suffix)
    with io.open(fd, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    os.replace(tmp, path)


def main(argv=None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--census-json", default=None, help="reuse a census output instead of running it")
    ap.add_argument("--objects-only-pane", choices=["ledger", "on", "off"], default="ledger",
                    help="the door-flag state to select on (default: production's, from the ledger)")
    ap.add_argument("--captured-dir", action="append", default=[],
                    help="more directories of captures to subtract (repeatable)")
    ap.add_argument("--check", action="store_true", help="rebuild and compare with --out; write nothing")
    args = ap.parse_args(argv)

    flag_name = "VITE_PINE_OBJECTS_ONLY_PANE_ENABLED"   # confirmed against the census's own read below
    if args.objects_only_pane == "ledger":
        state = ledger_flag_state(flag_name)
        if state is None:
            print(f"INCONCLUSIVE: {FLAG_LEDGER.name} does not record {flag_name}; pass --objects-only-pane")
            return 2
        flag_on, flag_source = state, f"{FLAG_LEDGER.relative_to(REPO).as_posix()} (production status)"
    else:
        flag_on, flag_source = args.objects_only_pane == "on", "--objects-only-pane"

    if args.census_json:
        census = json.loads(pathlib.Path(args.census_json).read_text(encoding="utf-8"))
    else:
        with tempfile.TemporaryDirectory(prefix="vhbatch-census-") as td:
            try:
                census = run_census(pathlib.Path(td) / "census.json", flag_name, flag_on)
            except SystemExit as exc:
                print(exc)
                return 2
    if census.get("flag") != flag_name:
        print(f"MEASURED: the census gates on {census.get('flag')!r}, this tool selects on {flag_name!r} — "
              "the door flag was renamed; update the name here")
        return 1
    if not args.census_json and census.get("ambientFlagOn") is not flag_on:
        print(f"MEASURED: the census process read the flag as {census.get('ambientFlagOn')} while this "
              f"manifest selects on {flag_on} — the grade step would disagree with the manifest")
        return 1

    captured = captured_shas([HARNESS_FIXTURES, *args.captured_dir])
    try:
        manifest = build_manifest(census, flag_on, captured, flag_source)
    except ValueError as exc:
        print(f"MEASURED: {exc}")
        return 1
    manifest["generatedAt"] = _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")
    out = pathlib.Path(args.out)
    c = manifest["counts"]
    print(f"[manifest] corpus {c['corpus']} · door attaches {c['doorAttached']} (flag "
          f"{manifest['derivation']['doorFlag']['state']}) · already captured {c['alreadyCaptured']} · "
          f"TARGETS {c['targets']}")
    if args.check:
        if not out.exists():
            print(f"CHECK: {out} does not exist")
            return 1
        old = json.loads(out.read_text(encoding="utf-8"))
        same = [s["sha256"] for s in old.get("scripts", [])] == [s["sha256"] for s in manifest["scripts"]]
        print(f"CHECK: {'AGREES' if same else 'DIFFERS'} with {out}")
        return 0 if same else 1
    write_atomic(out, dump(manifest))
    print(f"[manifest] wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
