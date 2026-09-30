"""Rollback rehearsal driver, lane R1d (2026-09-29): the chain with L6 #253 and L7 #254 on top,
on a SANDBOX. Same method as R1's, R1b's and R1c's
(`../rollback-rehearsal-2026-09-29-r1c/rehearse.py`), re-pointed at the new tip and the two new
steps:

    python rehearse.py labels              # the targets, in order
    python rehearse.py extract <label>     # git archive -> extract, then re-hash: must equal the tree
    python rehearse.py prepare <label>     # build that tree's app/dist
    python rehearse.py boot <label>        # boot THAT tree's launcher on C:\\data-w10r1d :8239,
                                           # run probe.py, stop, write the integrity line FIRST
    python rehearse.py verify-list <label> # the runbook's step-2 check list inside that tree

Targets: the tip `8d08da86f` (the control; it SEEDS the fixtures), then `s-L7` (0 conflicts) and
`s-L6` (0 conflicts). Neither new landing needed a rule of its own; the one new rule
(RULES["2c3ed3093"]["app/src/components/CommandPalette.jsx"]) fires two steps further down, at
wave 5's revert, verified from objects only (`objects.py`), not booted -- same split R1c made for
its own wave-8 Support.jsx rule.

Each tree is extracted to <scratch>/t/<label>; ONE junction at <scratch>/t/node_modules reaches an
installed `app/node_modules` (node's resolution walks up from <label>/app). Every step tree carries
the tip's `scripts/` and `tools/` (the chain keeps them), so the launcher, its identity nonce and its
integrity snapshots are the tip's in every boot; `api/`, `app/` and `conftest.py` are the step's.
The Notebook gates are set to production's armed values for EVERY boot, so a door that is absent
on a step is gone, never switched off.
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
from pathlib import Path

HERE = Path(__file__).resolve()
EVID = HERE.parent
REPO = HERE.parents[4]
SCRATCH = Path(os.environ.get("R1D_SCRATCH", r"C:\Users\Patrick\AppData\Local\Temp\claude"
                              r"\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\r1d"))
TREES = SCRATCH / "t"
DATA = r"C:\data-w10r1d"
PORT = 8239
BASE = f"http://127.0.0.1:{PORT}"
TIP = "8d08da86f"
# production's armed values (docs/feature_flags.json at 8d08da86f). NOTEBOOK_OFFLINE_DEFAULT_ON is
# a kill switch: unset = ON.
GATES = {
    "J2_SHARE_LINKS_ENABLED": "1", "NOTEBOOK_PUBLISH_ENABLED": "1",
    "NOTEBOOK_ONBOARDING_ENABLED": "1", "NOTEBOOK_WRITING_HELP_ENABLED": "1",
    "NOTEBOOK_PERSONAL_API_ENABLED": "1", "NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED": "1",
    "NOTEBOOK_ASK_INSERT_ON": "1",
}
STEPS = ("L7", "L6")


def git(*a) -> str:
    return subprocess.run(["git", "-C", str(REPO), *a], capture_output=True, text=True,
                          check=True).stdout.strip()


def targets() -> list[tuple[str, str, str]]:
    """(label, tree, what) in order."""
    out = [("s00-tip", git("rev-parse", f"{TIP}^{{tree}}"), f"tip {TIP} (control)")]
    for line in (EVID / "chain" / "chain-through-L6.jsonl").read_text(encoding="utf-8").splitlines():
        d = json.loads(line)
        if d.get("key") in STEPS:
            out.append((f"s-{d['key']}", d["tree"], f"through {d['key']}: {d['op']} {d['squash'][:9]} ({d['what']})"))
    return out


def find(label):
    for t in targets():
        if t[0] == label:
            return t
    raise SystemExit(f"no target {label!r}; see `labels`")


def extract(label: str) -> int:
    label, tree, what = find(label)
    dest = TREES / label
    if dest.exists():
        raise SystemExit(f"{dest} exists; this tool never deletes a tree (remove it by hand)")
    dest.mkdir(parents=True)
    p = subprocess.Popen(["git", "-C", str(REPO), "-c", "core.autocrlf=false", "archive", "--format=tar", tree],
                         stdout=subprocess.PIPE)
    with tarfile.open(fileobj=p.stdout, mode="r|") as tf:
        tf.extractall(dest, filter="tar")
    while p.stdout.read(1 << 16):     # drain git's trailing padding, or wait() blocks (R1, p08)
        pass
    if p.wait() != 0:
        raise SystemExit("git archive failed")
    return verify(label)


def verify(label: str) -> int:
    """The extracted directory must BE the step's tree: every file re-hashed through a throwaway
    index (autocrlf OFF) and compared, as (mode, blob, path), with the tree's own listing."""
    label, tree, what = find(label)
    dest = TREES / label
    gitdir = git("rev-parse", "--git-common-dir")
    gitdir = str((REPO / gitdir).resolve()) if not os.path.isabs(gitdir) else gitdir
    idx = SCRATCH / f"verify-{label}.idx"
    idx.unlink(missing_ok=True)
    env = dict(os.environ, GIT_INDEX_FILE=str(idx))
    base = ["git", "-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "-c", "core.longpaths=true",
            f"--git-dir={gitdir}", f"--work-tree={dest}"]
    subprocess.run(base + ["add", "-A", "--force", "."], cwd=str(dest), env=env, check=True, capture_output=True)
    got = set()
    for ln in subprocess.run(base + ["ls-files", "-s"], cwd=str(dest), env=env, check=True,
                             capture_output=True, text=True, encoding="utf-8").stdout.splitlines():
        meta, path = ln.split("\t", 1)
        mode, sha, _ = meta.split()
        got.add((mode, sha, path))
    idx.unlink(missing_ok=True)
    want = set()
    for ln in git("ls-tree", "-r", tree).splitlines():
        meta, path = ln.split("\t", 1)
        mode, kind, sha = meta.split()
        if kind != "commit":
            want.add((mode, sha, path))
    ok = got == want
    line = (f"{label}: tree {tree[:10]} -- {len(want)} files expected, {len(got)} re-hashed, "
            f"{'IDENTICAL' if ok else f'DIFFER ({len(want - got)} missing/changed, {len(got - want)} extra)'}")
    print(line)
    (EVID / "sandbox").mkdir(exist_ok=True)
    with open(EVID / "sandbox" / "extract-verify.log", "a", encoding="utf-8") as fh:
        fh.write(line + "\n")
    return 0 if ok else 1


def prepare(label: str) -> int:
    label, tree, what = find(label)
    dest = TREES / label
    out = EVID / "sandbox" / label
    out.mkdir(parents=True, exist_ok=True)
    if not (TREES / "node_modules").exists():
        raise SystemExit(f"{TREES / 'node_modules'} is missing: create the junction first")
    pkg = json.loads((dest / "app" / "package.json").read_text(encoding="utf-8"))
    build = pkg["scripts"]["build"]
    env = dict(os.environ)
    env["PATH"] = str(TREES / "node_modules" / ".bin") + os.pathsep + env["PATH"]
    t0 = time.time()
    with open(out / "build.log", "w", encoding="utf-8") as fh:
        fh.write(f"# {what}\n# tree {tree}\n# build: {build}\n")
        fh.flush()
        rc = subprocess.call(build, shell=True, cwd=str(dest / "app"), env=env, stdout=fh, stderr=subprocess.STDOUT)
        fh.write(f"\n# build rc {rc} in {time.time() - t0:.0f} s\n")
    ok = (dest / "app" / "dist" / "index.html").is_file()
    print(f"{label}: build rc {rc}, dist/index.html {'present' if ok else 'MISSING'}")
    return 0 if rc == 0 and ok else 1


def boot(label: str) -> int:
    label, tree, what = find(label)
    dest = TREES / label
    out = EVID / "sandbox" / label
    out.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location("perf_tip", REPO / "tools" / "notebook_perf_harness.py")
    perf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(perf)
    perf.REPO = dest                                   # the TREE's launcher and api/app
    perf.BOOT_SCRIPT = dest / "scripts" / "hub_sandbox_boot.py"
    assert perf.refuse_shared_root(DATA) is None, DATA
    assert not perf.port_busy(PORT), f"port {PORT} is busy"
    assert (dest / "app" / "dist" / "index.html").is_file(), "prepare this tree first"
    os.environ.update(GATES)
    mode = "seed" if label == "s00-tip" else "check"
    fixtures = EVID / "sandbox" / "fixtures.json"
    if mode == "check" and not fixtures.is_file():
        raise SystemExit("boot s00-tip first: it seeds the fixtures")
    console = SCRATCH / f"console-{label}.log"
    sb = perf.Sandbox(DATA, PORT, console)
    sb.start()
    rc = None
    try:
        if sb.wait_healthy(BASE, 300):
            log = sb.integrity_path() or ""
            cmd = [sys.executable, str(EVID / "probe.py"), "--base", BASE, "--integrity-log", log,
                   "--out", str(out), "--mode", mode, "--fixtures", str(fixtures), "--label", label]
            with open(out / "probe-stdout.log", "w", encoding="utf-8") as fh:
                rc = subprocess.call(cmd, stdout=fh, stderr=subprocess.STDOUT, timeout=1800)
            sb.wait_checkpoint(perf.PREWARM, perf.PREWARM_WAIT_S)
        else:
            (out / "probe-stdout.log").write_text("sandbox never became healthy\n", encoding="utf-8")
    finally:
        how = sb.stop()
        log = sb.integrity_path()
        integ = perf.read_integrity(log, [perf.PRE_BOOT, perf.POST_BOOT, perf.PREWARM, perf.SHUTDOWN])
        if log and Path(log).is_file():
            dst = out / "sandbox-integrity.md"
            shutil.copyfile(log, dst)
            integ["path"] = str(dst.relative_to(REPO)).replace("\\", "/")
        line = perf.integrity_line(integ, note=f"stop: {how}; {what}; tree {tree}")
        (out / "sandbox-integrity.txt").write_text(line + "\n", encoding="utf-8")
        tail = console.read_text(encoding="utf-8", errors="replace").splitlines()[-150:] if console.is_file() else []
        (out / "console-tail.log").write_text("\n".join(tail) + "\n", encoding="utf-8")
        print(line)
    print(f"probe rc {rc}")
    return 0


VITEST_LIST = [
    "src/pages/journal-2-0/lib/notebookSchema.rail.test.js",
    "src/hub/writePathsTransitive.test.js",
    "src/hub/writePaths.test.js",
    "src/pages/journal-2-0/lib/importer",
    "src/pages/journal-2-0/lib/offline/writtenSchemaDrain.test.js",
    "src/pages/journal-2-0/lib/offline/writtenSchemaCapture.test.js",
    "src/pages/journal-2-0/components/notebook/NoteEditorPage.writtenSchema.test.jsx",
    "src/pages/journal-2-0/a11y/targetFloors.test.js",
]


def verify_list(label: str) -> int:
    """The runbook's step-2 check list inside one tree: the schema diff against the tip (must be
    empty), pytest tests/test_notebook_schema_guard.py, and the vitest list (--maxWorkers=2)."""
    label, tree, what = find(label)
    dest = TREES / label
    out = EVID / "sandbox" / label
    out.mkdir(parents=True, exist_ok=True)
    diff = git("diff", "--stat", f"{TIP}^{{tree}}", tree, "--",
               "app/src/pages/journal-2-0/lib/notebookSchema.js", "api/services/journal_two/notebook_schema.py",
               "app/src/pages/journal-2-0/lib/notebookSchema.rail.test.js", "tests/test_notebook_schema_guard.py")
    (out / "verify-schema-diff.log").write_text(f"# git diff --stat {TIP} {tree} -- <tables and rails>\n"
                                               f"{diff or '(empty)'}\n", encoding="utf-8")
    t0 = time.time()
    with open(out / "verify-pytest.log", "w", encoding="utf-8") as fh:
        fh.write(f"# {what}; tree {tree}\n# python -m pytest tests/test_notebook_schema_guard.py -q\n")
        fh.flush()
        rc_py = subprocess.call([sys.executable, "-m", "pytest", "tests/test_notebook_schema_guard.py", "-q",
                                 "-p", "no:cacheprovider"], cwd=str(dest), stdout=fh, stderr=subprocess.STDOUT)
        fh.write(f"\n# rc {rc_py} in {time.time() - t0:.0f} s\n")
    present = [p for p in VITEST_LIST if (dest / "app" / p).exists()]
    absent = [p for p in VITEST_LIST if p not in present]
    vitest = TREES / "node_modules" / "vitest" / "vitest.mjs"
    t0 = time.time()
    with open(out / "verify-vitest.log", "w", encoding="utf-8") as fh:
        fh.write(f"# {what}; tree {tree}\n# vitest run --maxWorkers=2 {' '.join(present)}\n"
                 f"# absent in this tree: {absent or 'none'}\n")
        fh.flush()
        rc_vi = subprocess.call(["node", str(vitest), "run", "--maxWorkers=2", *present], cwd=str(dest / "app"),
                                stdout=fh, stderr=subprocess.STDOUT)
        fh.write(f"\n# rc {rc_vi} in {time.time() - t0:.0f} s\n")
    print(f"{label}: schema diff {'EMPTY' if not diff else 'NOT EMPTY'}")
    for name in ("verify-pytest.log", "verify-vitest.log"):
        lines = (out / name).read_text(encoding="utf-8", errors="replace").splitlines()
        tot = [l for l in lines if (" passed" in l or " failed" in l) and ("Tests" in l or "=" in l or "in " in l)]
        print(f"{label} {name}: {tot[-2:] if tot else 'NO TOTALS LINE'}")
    print(f"{label}: pytest rc {rc_py}, vitest rc {rc_vi}; vitest files absent here: {absent}")
    return 0 if (rc_py == 0 and rc_vi == 0 and not diff) else 1


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "labels"
    if cmd == "labels":
        for t in targets():
            print(*t, sep="\t")
        return 0
    fn = {"extract": extract, "verify": verify, "prepare": prepare, "boot": boot,
          "verify-list": verify_list}.get(cmd)
    if fn is None:
        raise SystemExit(__doc__)
    return fn(sys.argv[2])


if __name__ == "__main__":
    sys.exit(main())
