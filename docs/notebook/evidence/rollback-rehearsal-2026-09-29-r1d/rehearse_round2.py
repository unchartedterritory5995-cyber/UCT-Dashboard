"""Rollback rehearsal driver, lane R1d ROUND 2 (2026-09-29): L8 #255 landed on master while this
lane was working (controller note); this covers just that one new step, on its OWN data dir/port
so it never collides with round 1's `C:\\data-w10r1d` :8239 boot. Same method as round 1's
`rehearse.py`, reusing `probe.py` unchanged (L8 ships no product file, so there is no new door --
the same shared checks round 1 ran for L6 apply here: the never-revert set and every earlier
landing's door must answer identically).

    python rehearse_round2.py labels
    python rehearse_round2.py extract <label>
    python rehearse_round2.py prepare <label>
    python rehearse_round2.py boot <label>

Targets: `s01-tip2` (the new tip, `6f563c158` = MEASURED_AT, includes L8 + the dark Fundamentals
V5 work cd9ecc833 landed alongside it; control, seeds its own fixtures) and `s-L8` (`--through L8`
from that tip, 0 conflicts -- its tree is L8's own parent, `eb7da690f`).
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
TREES = SCRATCH / "t2"
DATA = r"C:\data-w10r1d-2"
PORT = 8240
BASE = f"http://127.0.0.1:{PORT}"
TIP = "6f563c158"
GATES = {
    "J2_SHARE_LINKS_ENABLED": "1", "NOTEBOOK_PUBLISH_ENABLED": "1",
    "NOTEBOOK_ONBOARDING_ENABLED": "1", "NOTEBOOK_WRITING_HELP_ENABLED": "1",
    "NOTEBOOK_PERSONAL_API_ENABLED": "1", "NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED": "1",
    "NOTEBOOK_ASK_INSERT_ON": "1",
}


def git(*a) -> str:
    return subprocess.run(["git", "-C", str(REPO), *a], capture_output=True, text=True,
                          check=True).stdout.strip()


def targets() -> list[tuple[str, str, str]]:
    out = [("s01-tip2", git("rev-parse", f"{TIP}^{{tree}}"), f"tip {TIP} (control, L8+cd9ecc833 live)")]
    for line in (EVID / "chain" / "chain-through-L8.jsonl").read_text(encoding="utf-8").splitlines():
        d = json.loads(line)
        if d.get("key") == "L8":
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
    while p.stdout.read(1 << 16):
        pass
    if p.wait() != 0:
        raise SystemExit("git archive failed")
    return verify(label)


def verify(label: str) -> int:
    label, tree, what = find(label)
    dest = TREES / label
    gitdir = git("rev-parse", "--git-common-dir")
    gitdir = str((REPO / gitdir).resolve()) if not os.path.isabs(gitdir) else gitdir
    idx = SCRATCH / f"verify2-{label}.idx"
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
    with open(EVID / "sandbox" / "extract-verify-round2.log", "a", encoding="utf-8") as fh:
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
    spec = importlib.util.spec_from_file_location("perf_tip2", REPO / "tools" / "notebook_perf_harness.py")
    perf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(perf)
    perf.REPO = dest
    perf.BOOT_SCRIPT = dest / "scripts" / "hub_sandbox_boot.py"
    assert perf.refuse_shared_root(DATA) is None, DATA
    assert not perf.port_busy(PORT), f"port {PORT} is busy"
    assert (dest / "app" / "dist" / "index.html").is_file(), "prepare this tree first"
    os.environ.update(GATES)
    mode = "seed" if label == "s01-tip2" else "check"
    fixtures = EVID / "sandbox" / "fixtures-round2.json"
    if mode == "check" and not fixtures.is_file():
        raise SystemExit("boot s01-tip2 first: it seeds the fixtures")
    console = SCRATCH / f"console2-{label}.log"
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
    fn = {"extract": extract, "verify": verify, "prepare": prepare, "boot": boot}.get(cmd)
    if fn is None:
        raise SystemExit(__doc__)
    return fn(sys.argv[2])


if __name__ == "__main__":
    sys.exit(main())
