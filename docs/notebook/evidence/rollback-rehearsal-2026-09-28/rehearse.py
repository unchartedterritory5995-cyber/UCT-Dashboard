"""Rollback rehearsal driver (lane R1): each step of the primary chain, on a SANDBOX, from a
`git archive` of that step's tree.

    python rehearse.py extract <label>     # git archive -> extract, then re-hash it: must equal the tree
    python rehearse.py prepare <label>     # build that tree's app/dist
    python rehearse.py boot <label>        # boot THAT tree's launcher on C:\\data-w10rb :8229,
                                           # run probe.py, stop, write the integrity line FIRST
    python rehearse.py labels              # the targets, in order

Targets: the tip (the control, which also SEEDS the fixtures) and every applied step of
`chain/chain-primary.jsonl` that ends a landing's revert (13 and 13a are intermediate states of
the wave-5 step; 13b is its end). Each tree is extracted to <scratch>/t/<label>; the tip's
installed `app/node_modules` is reached through ONE junction at <scratch>/t/node_modules (node's
resolution walks up from <label>/app). Every step tree carries the tip's `scripts/` and `tools/`
(the chain keeps them), so the launcher, its identity nonce and its integrity snapshots are the
tip's in every boot; `api/`, `app/` and `conftest.py` are the step's.

The Notebook gates are set to production's armed values for EVERY boot (the environment the
launcher inherits), so a door that answers 404 on a step is absent, never switched off.
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
SCRATCH = Path(os.environ.get("R1RB_SCRATCH", r"C:\Users\Patrick\AppData\Local\Temp\claude"
                              r"\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\r1rb"))
TREES = SCRATCH / "t"
DATA = r"C:\data-w10rb"
PORT = 8229
BASE = f"http://127.0.0.1:{PORT}"
TIP = "38bb9a421"
# production's armed values (docs/feature_flags.json at 38bb9a421; the switch rehearsal's
# "production-values" boot). NOTEBOOK_OFFLINE_DEFAULT_ON is a kill switch: unset = ON.
GATES = {
    "J2_SHARE_LINKS_ENABLED": "1", "NOTEBOOK_PUBLISH_ENABLED": "1",
    "NOTEBOOK_ONBOARDING_ENABLED": "1", "NOTEBOOK_WRITING_HELP_ENABLED": "1",
    "NOTEBOOK_PERSONAL_API_ENABLED": "1", "NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED": "1",
    "NOTEBOOK_ASK_INSERT_ON": "1",
}
KEEP_STEPS = ("1", "2", "3", "4", "7", "8", "9", "10", "11", "12", "13b")


def git(*a) -> str:
    return subprocess.run(["git", "-C", str(REPO), *a], capture_output=True, text=True,
                          check=True).stdout.strip()


def targets() -> list[tuple[str, str, str]]:
    """(label, tree, what) in order."""
    out = [("p00-tip", git("rev-parse", f"{TIP}^{{tree}}"), f"tip {TIP} (control)")]
    for line in (EVID / "chain" / "chain-primary.jsonl").read_text(encoding="utf-8").splitlines():
        d = json.loads(line)
        if d.get("n") in KEEP_STEPS and not d.get("measure_only"):
            n = d["n"]
            out.append((f"p{int(n.rstrip('b')):02d}{'b' if n.endswith('b') else ''}-{d['squash']}",
                        d["tree"], f"step {n}: {d['op']} {d['squash']} ({d['label']})"))
    # Round 2 (chain-primary-r2.jsonl, tools/notebook_rollback_chain.py): the schema tables' two
    # rails kept at the tip too. Only the wave6 and wave5 trees changed, in those two test files.
    r2 = EVID / "chain" / "chain-primary-r2.jsonl"
    if r2.is_file():
        for line in r2.read_text(encoding="utf-8").splitlines():
            d = json.loads(line)
            if d.get("key") in ("wave6", "guard-fd87271fd"):
                lab = "r2-p12-271a078b6" if d["key"] == "wave6" else "r2-p13b-fd87271fd"
                out.append((lab, d["tree"], f"round 2 {d['key']}: {d['op']} {d['squash']} ({d['what']})"))
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
    p = subprocess.Popen(["git", "-C", str(REPO), "-c", "core.autocrlf=false", "archive", "--format=tar", tree], stdout=subprocess.PIPE)
    with tarfile.open(fileobj=p.stdout, mode="r|") as tf:
        tf.extractall(dest, filter="tar")
    # tarfile stops at the end-of-archive marker; git still has the record's zero padding to
    # write. Drain it, or git blocks on a full pipe and wait() never returns (measured: p08).
    while p.stdout.read(1 << 16):
        pass
    if p.wait() != 0:
        raise SystemExit("git archive failed")
    return verify(label)


def verify(label: str) -> int:
    """The extracted directory must BE the step's tree: every file re-hashed through a throwaway
    index (autocrlf OFF, so the bytes are hashed as they are) and compared, as (mode, blob, path),
    with the tree's own listing. Submodule gitlinks are not in an archive and are left out of both."""
    label, tree, what = find(label)
    dest = TREES / label
    gitdir = git("rev-parse", "--absolute-git-dir")
    idx = SCRATCH / f"verify-{label}.idx"
    idx.unlink(missing_ok=True)
    env = dict(os.environ, GIT_INDEX_FILE=str(idx))
    base = ["git", "-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "-c", "core.longpaths=true",
            f"--git-dir={gitdir}", f"--work-tree={dest}"]
    subprocess.run(base + ["add", "-A", "--force", "."], cwd=str(dest), env=env, check=True,
                   capture_output=True)
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
    print(f"{label}: tree {tree[:10]} -- {len(want)} files expected, {len(got)} re-hashed, "
          f"{'IDENTICAL' if ok else f'DIFFER ({len(want - got)} missing/changed, {len(got - want)} extra)'}")
    return 0 if ok else 1


def prepare(label: str) -> int:
    label, tree, what = find(label)
    dest = TREES / label
    out = EVID / "sandbox" / label
    out.mkdir(parents=True, exist_ok=True)
    if not (TREES / "node_modules").exists():
        raise SystemExit(f"{TREES / 'node_modules'} is missing: create the junction first")
    if not dest.exists():
        raise SystemExit(f"{dest} is missing: run `extract {label}` first")
    pkg = json.loads((dest / "app" / "package.json").read_text(encoding="utf-8"))
    build = pkg["scripts"]["build"]
    env = dict(os.environ)
    env["PATH"] = str(TREES / "node_modules" / ".bin") + os.pathsep + env["PATH"]
    t0 = time.time()
    with open(out / "build.log", "w", encoding="utf-8") as fh:
        fh.write(f"# {what}\n# tree {tree}\n# build: {build}\n")
        fh.flush()
        rc = subprocess.call(build, shell=True, cwd=str(dest / "app"), env=env, stdout=fh,
                             stderr=subprocess.STDOUT)
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
    # The TREE's launcher and api/app, the tip's harness class driving it.
    perf.REPO = dest
    perf.BOOT_SCRIPT = dest / "scripts" / "hub_sandbox_boot.py"
    assert perf.refuse_shared_root(DATA) is None, DATA
    assert not perf.port_busy(PORT), f"port {PORT} is busy"
    assert (dest / "app" / "dist" / "index.html").is_file(), "prepare this tree first"
    os.environ.update(GATES)
    mode = os.environ.get("R1RB_MODE") or ("seed" if label == "p00-tip" else "check")
    fixtures = EVID / "sandbox" / "fixtures.json"
    if mode == "check" and not fixtures.is_file():
        raise SystemExit("boot p00-tip first: it seeds the fixtures")
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


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "labels"
    if cmd == "labels":
        for t in targets():
            print(*t, sep="\t")
        return 0
    if cmd == "extract":
        return extract(sys.argv[2])
    if cmd == "verify":
        return verify(sys.argv[2])
    if cmd == "prepare":
        return prepare(sys.argv[2])
    if cmd == "boot":
        return boot(sys.argv[2])
    raise SystemExit(__doc__)


if __name__ == "__main__":
    sys.exit(main())
