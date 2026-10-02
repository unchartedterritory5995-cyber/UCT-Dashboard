"""Rollback rehearsal driver, lane R1h (2026-10-01): the chain with L15 #262 on top, on a
SANDBOX. Same method as R1's, R1b's, ..., R1f's and R1g's
(`../rollback-rehearsal-2026-10-01-r1g/rehearse.py`), re-pointed at the new tip and the one new
product step L15. L15 reverts with 0 product conflicts, verified from objects only via
`--record-pins --through wave5` (all eight pins recorded at c75bf6ea0 came back byte-identical).

    python rehearse.py labels              # the targets, in order
    python rehearse.py extract <label>     # git archive -> extract, then re-hash: must equal the tree
    python rehearse.py prepare <label>     # build that tree's app/dist
    python rehearse.py boot <label>        # boot THAT tree's launcher on <scratchpad>/r1h-sandbox/
                                           # data :8500, run probe.py, stop, write the
                                           # integrity line FIRST

Targets: the tip `b529c8a78` (the control; it SEEDS the fixtures -- this is L15's own commit, the
MEASURED_AT this lane recorded, since nothing trails it in the measured window), then `s-L15`
(`--through L15`, 0 conflicts -- the state as if L15 had never landed, i.e. L14's own tip) and
`s-L14` (`--through L14`, also 0 conflicts -- L15 AND L14 both reverted, i.e. L13's own tip).
Neither target needed a rule of its own.

Each tree is extracted to <scratch>/t/<label>; ONE junction at <scratch>/t/node_modules reaches an
installed `app/node_modules` (node's resolution walks up from <label>/app) -- pointed at
`notebook-k/app/node_modules`, the install this lane's own worktree junctions to (CLAUDE.md: never
`npm ci`, never delete a junction recursively). Every step tree carries the tip's `scripts/` and
`tools/` (the chain keeps them), so the launcher, its identity nonce and its integrity snapshots
are the tip's in every boot; `api/`, `app/` and `conftest.py` are the step's. The Notebook gates
are set to production's armed values for EVERY boot, so a door that is absent on a step is gone,
never switched off.

⛔ Sandbox data dir is under THIS session's scratchpad, never C:\\data or C:\\ root -- never a
root-level directory, per the lane brief. `refuse_shared_root` is asserted before every boot
regardless. Port 8500 (never 8077), inside the 8500-8520 band this lane was given. DISK: the
extracted tree is deleted as soon as each step's results are recorded (checked for reparse points
first); the shared sandbox data dir persists across all three boots (it carries the fixtures
seeded at s00-tip) and is deleted only after the last step.
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
SCRATCH = Path(os.environ.get("R1H_SCRATCH", r"C:\Users\Patrick\AppData\Local\Temp\claude"
                              r"\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\r1h-sandbox"))
TREES = SCRATCH / "t"
DATA = str(SCRATCH / "data")
PORT = 8500
BASE = f"http://127.0.0.1:{PORT}"
TIP = "b529c8a78"
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
    out = [("s00-tip", git("rev-parse", f"{TIP}^{{tree}}"), f"tip {TIP} (control, L15 live)")]
    rows = {json.loads(l)["key"]: json.loads(l)
            for l in (EVID / "chain" / "chain-through-wave5.jsonl").read_text(encoding="utf-8").splitlines()
            if "key" in json.loads(l)}
    for key in ("L15", "L14"):
        d = rows[key]
        out.append((f"s-{key}", d["tree"], f"through {key}: {d['op']} {d['squash'][:9]} ({d['what']})"))
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


PNG_GUARD_NEEDLE = "too long for one PNG image"


def png_guard(label: str) -> int:
    """The PNG export size guard's own refusal text, searched in the BUILT `app/dist/assets/*.js`
    output for this tree -- never over a live canvas-allocation click (see probe.py's module
    docstring for why: reverting L15 removes the guard entirely, and the pre-L15 code attempts a
    real, unguarded, multi-hundred-megapixel canvas allocation on a note tall enough to need it,
    which this rehearsal does not reproduce three times against this box's own memory budget).
    Present at the tip and through neither `L15` nor `L14` once reverted (the WHOLE guard --
    `pickSafeScale`/`HARD_MAX_CANVAS_DIM_PX` -- is L15's own addition, so a text match or its
    absence is unambiguous: there is no earlier, narrower version of this message to confuse it
    with)."""
    label, tree, what = find(label)
    dest = TREES / label / "app" / "dist" / "assets"
    out = EVID / "sandbox" / label
    out.mkdir(parents=True, exist_ok=True)
    found_in = []
    if dest.is_dir():
        for p in dest.glob("*.js"):
            try:
                text = p.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if PNG_GUARD_NEEDLE in text:
                found_in.append(p.name)
    result = {"label": label, "what": what, "assets_scanned": len(list(dest.glob("*.js"))) if dest.is_dir() else 0,
              "needle": PNG_GUARD_NEEDLE, "present": bool(found_in), "found_in": found_in}
    (out / "png-guard-dist-check.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))
    return 0


def boot(label: str) -> int:
    label, tree, what = find(label)
    dest = TREES / label
    out = EVID / "sandbox" / label
    out.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location("perf_r1h", REPO / "tools" / "notebook_perf_harness.py")
    perf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(perf)
    perf.REPO = dest
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


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "labels"
    if cmd == "labels":
        for t in targets():
            print(*t, sep="\t")
        return 0
    fn = {"extract": extract, "verify": verify, "prepare": prepare, "boot": boot, "png-guard": png_guard}.get(cmd)
    if fn is None:
        raise SystemExit(__doc__)
    return fn(sys.argv[2])


if __name__ == "__main__":
    sys.exit(main())
