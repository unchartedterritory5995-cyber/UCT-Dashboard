"""The speed rig's CANDIDATE BUILDS (2026-11-28, the #3010 audit): build a ref's front end without running its code on
the runner, and hand it to the pass jobs as an archive they verify before they open it.

    python scripts/proofs/speed-rig/build_candidate.py build --out <dir> [--build-ref R] [--base-ref R] [--build-env K=V,..]
        Without the flags the refs and build_env are read from the workflow_dispatch payload ($GITHUB_EVENT_PATH),
        never from an `env:` block (the public log prints those). For each side (A = base_ref, or PRODUCTION'S OWN web
        commit when base_ref is empty, so both sides are always built and served alike; B = build_ref):
          1. resolve the ref: a branch of this repository (exact refname) or a commit on master (GIT_NO_LAZY_FETCH,
             master's commit captured at its fetch: a fork's commit, fetchable by sha, never passes);
          2. fetch only app/ and Dockerfile.web at that commit;
          3. npm ci + vite build INSIDE a container (node:20.18.0-bookworm-slim, pinned by digest: Dockerfile.web's
             frontend stage), as the runner's uid with every capability dropped, mounting ONLY the checkout's app/ and
             an empty output directory: no docker socket, no runner directory, no token. The candidate's install
             scripts and vite.config run there, never as the runner user, so they cannot reach the job's later steps,
             the actions' code or the cache/artifact token;
          4. on the HOST: the output holds only directories and regular files with one link each (no symlink, no
             hardlink, no device), the hidden .map files are dropped, build-meta.json is written (vite_env.meta: the
             parity check against production's entry script);
          5. pack it ourselves (regular files only, relative names, fixed owner/mode/mtime) into <out>/dist-<side>.tar
             and print its sha256 as the step outputs sha_A / sha_B, which the pass jobs check BEFORE opening it.
    python scripts/proofs/speed-rig/build_candidate.py unpack --tar <dist-X.tar> --sha <hex> --out <new dir>
        The pass job's side: the sha256 first (a mismatch never opens the archive), then a member at a time: regular
        files only, no absolute name, no '..', no backslash, bounded sizes, each written O_EXCL|O_NOFOLLOW inside <out>.
    python scripts/proofs/speed-rig/build_candidate.py --self-check
Standard library only (and git and docker for `build`).
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import stat
import subprocess
import sys
import tarfile
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import vite_env as V  # noqa: E402

#: Dockerfile.web's frontend stage, pinned by the digest Docker Hub served for the tag on 2026-11-28
IMAGE = "node:20.18.0-bookworm-slim@sha256:28fbbb764069c698ead61d6a739a7615e8f0e07a4b8fe1473ceca70c1c3d6aaa"
SHA_RE = re.compile(r"[0-9a-f]{7,40}")
BRANCH_RE = re.compile(r"[A-Za-z0-9._/-]{1,200}")
MAX_FILE = 64 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
MAX_FILES = 20000


def repo_url() -> str:
    return f"https://github.com/{os.environ.get('GITHUB_REPOSITORY', 'northstar-quarry/UCT-Dashboard')}.git"


def git(args: list[str], cwd: str, lazy: bool = False) -> str:
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    if not lazy:
        env["GIT_NO_LAZY_FETCH"] = "1"   # a partial clone never fetches a missing object on demand
    p = subprocess.run(["git", *args], cwd=cwd, env=env, capture_output=True, text=True, timeout=600)
    if p.returncode != 0:
        raise SystemExit(f"git {args[0]} failed ({p.returncode}): {p.stderr.strip()[:300]}")
    return p.stdout


def resolve(ref: str, work: str) -> str:
    """The commit a ref names: a branch of this repository (exact refname), or a commit on master."""
    os.makedirs(work, exist_ok=True)
    if not os.path.isdir(os.path.join(work, ".git")):
        git(["init", "-q"], work)
        git(["remote", "add", "origin", repo_url()], work)
    if SHA_RE.fullmatch(ref):
        git(["fetch", "-q", "--filter=tree:0", "origin", "refs/heads/master"], work)
        master = git(["rev-parse", "--verify", "FETCH_HEAD"], work).strip()   # captured at once: any fetch rewrites it
        p = subprocess.run(["git", "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"], cwd=work, capture_output=True, text=True,
                           env=dict(os.environ, GIT_NO_LAZY_FETCH="1"))
        sha = p.stdout.strip()
        if p.returncode != 0 or not sha:
            raise SystemExit(f"refused: a commit of {len(ref)} hex digits that is not on master: name a branch of this repository")
        if subprocess.run(["git", "merge-base", "--is-ancestor", sha, master], cwd=work, env=dict(os.environ, GIT_NO_LAZY_FETCH="1")).returncode != 0:
            raise SystemExit(f"refused: {sha[:12]} is not on master: name a branch of this repository")
        return sha
    if BRANCH_RE.fullmatch(ref) and ".." not in ref and not ref.startswith("-"):
        want = f"refs/heads/{ref}"
        for line in git(["ls-remote", "--heads", "origin", want], work).splitlines():
            parts = line.split("\t")
            if len(parts) == 2 and parts[1] == want:   # ls-remote matches a pattern as a SUFFIX: the exact name only
                return parts[0]
        raise SystemExit("refused: no branch of that name in this repository")
    raise SystemExit(f"refused: a ref of {len(ref)} characters that is neither a branch name nor a master commit")


def production_commit() -> str:
    req = urllib.request.Request(V.base() + "/build.json", headers={"User-Agent": V.UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        c = str(json.loads(r.read().decode()).get("commit") or "")
    if not re.fullmatch(r"[0-9a-f]{40}", c):
        raise SystemExit("production's /build.json names no commit: give base_ref")
    return c


def checkout(sha: str, dest: str) -> None:
    os.makedirs(dest, exist_ok=False)
    git(["init", "-q"], dest)
    git(["remote", "add", "origin", repo_url()], dest)
    git(["fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", sha], dest)
    git(["sparse-checkout", "set", "--no-cone", "/app/", "/Dockerfile.web"], dest, lazy=True)
    git(["checkout", "-q", "--detach", sha], dest, lazy=True)   # the sparse files' blobs, of THIS verified commit only


def check_tree(out: str) -> list[str]:
    """Every file of a build, relative; refuses anything but directories and single-link regular files, and a file or a
    build larger than a build can be (MAX_FILE, MAX_TOTAL, MAX_FILES: the same bounds unpack holds)."""
    files, total = [], 0
    for root, dirs, names in os.walk(out, followlinks=False):
        for d in dirs:
            st = os.lstat(os.path.join(root, d))
            if not stat.S_ISDIR(st.st_mode):
                raise SystemExit("refused: the build holds a link or special file where a directory should be")
        for n in names:
            p = os.path.join(root, n)
            st = os.lstat(p)
            if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
                raise SystemExit(f"refused: the build holds a symlink, hardlink or special file ({len(files)} files in)")
            total += st.st_size
            if st.st_size > MAX_FILE or total > MAX_TOTAL or len(files) >= MAX_FILES:
                raise SystemExit(f"refused: the build is larger than a build can be ({len(files)} files, {total} bytes in)")
            files.append(os.path.relpath(p, out).replace(os.sep, "/"))
    return sorted(files)


def pack(out: str, tar_path: str) -> str:
    files = check_tree(out)
    with tarfile.open(tar_path, "w", format=tarfile.PAX_FORMAT) as t:
        for rel in files:
            ti = tarfile.TarInfo(rel)
            ti.size, ti.mode, ti.mtime, ti.uid, ti.gid, ti.uname, ti.gname = os.path.getsize(os.path.join(out, rel)), 0o644, 0, 0, 0, "", ""
            with open(os.path.join(out, rel), "rb") as f:
                t.addfile(ti, f)
    return sha256_file(tar_path)


def sha256_file(p: str) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_name(name: str) -> str | None:
    if not name or name.startswith("/") or "\\" in name or "\x00" in name or re.match(r"^[A-Za-z]:", name):
        return None
    parts = name.split("/")
    if any(p in ("", ".", "..") for p in parts):
        return None
    return "/".join(parts)


def unpack(tar_path: str, want_sha: str, out: str) -> int:
    if not re.fullmatch(r"[0-9a-f]{64}", want_sha or ""):
        raise SystemExit("refused: no sha256 from the build job")
    got = sha256_file(tar_path)
    if got != want_sha:
        raise SystemExit("refused: the archive's sha256 is not the build job's: it is never opened")
    os.makedirs(out, exist_ok=False)
    root = os.path.realpath(out)
    total = n = 0
    with tarfile.open(tar_path, "r:") as t:
        for m in t:
            n += 1
            name = safe_name(m.name)
            if not m.isreg() or name is None or m.size > MAX_FILE or n > MAX_FILES:
                raise SystemExit(f"refused: archive member {n} is not a plain relative regular file within the limits")
            total += m.size
            if total > MAX_TOTAL:
                raise SystemExit("refused: the archive is larger than a build")
            dest = os.path.join(root, *name.split("/"))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            if not (os.path.realpath(os.path.dirname(dest)) + os.sep).startswith(root + os.sep):
                raise SystemExit(f"refused: archive member {n} lands outside the build")
            src = t.extractfile(m)
            fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0), 0o644)
            with os.fdopen(fd, "wb") as f:
                left = m.size
                while left:
                    b = src.read(min(left, 1 << 20))
                    if not b:
                        raise SystemExit(f"refused: archive member {n} is truncated")
                    f.write(b)
                    left -= len(b)
    print(f"unpacked {n} files ({total} bytes) into {out}")
    return n


def build_side(side: str, ref: str, sha: str, extra: str, out_root: str, tmp: str) -> dict:
    src = os.path.join(tmp, f"src-{side}")
    checkout(sha, src)
    shipped = json.load(open(os.path.join(HERE, "vite-env.json"), encoding="utf-8"))["env"]
    try:
        env = V.build_env(shipped, extra, open(os.path.join(src, "Dockerfile.web"), encoding="utf-8").read())
    except ValueError as e:
        raise SystemExit(f"refused: {e}")
    env_file = os.path.join(tmp, f"vite-{side}.env")
    with open(env_file, "w", encoding="utf-8") as f:
        f.write("".join(f"{k}={v}\n" for k, v in sorted(env.items())))
    print(f"side {side}: {ref} at {sha}; VITE_* set: {','.join(sorted(env))}", flush=True)
    dist = os.path.join(tmp, f"dist-{side}")
    os.makedirs(dist)
    uid, gid = os.getuid(), os.getgid()
    cmd = ["docker", "run", "--rm", "--user", f"{uid}:{gid}", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
           "--pids-limit", "4096", "-e", "HOME=/tmp", "-e", "npm_config_cache=/tmp/.npm", "-e", "NODE_OPTIONS=--max-old-space-size=4096",
           "--env-file", env_file, "-v", f"{os.path.join(src, 'app')}:/app", "-v", f"{dist}:/out", "-w", "/app", IMAGE,
           "sh", "-c", "npm ci --no-audit --no-fund && npx vite build --outDir /out --emptyOutDir --logLevel warn"]
    import secrets
    import time
    t0 = time.time()
    # the container's output is the CANDIDATE's: a line it prints like `::set-output::` / `::add-mask::` would be read
    # as a workflow command. GitHub ignores every command between ::stop-commands::<token> and ::<token>::, and the
    # token is random, so the candidate cannot end the window early.
    token = secrets.token_hex(16)
    print(f"::stop-commands::{token}", flush=True)
    try:
        p = subprocess.run(cmd, timeout=1800)
    finally:
        print(f"::{token}::", flush=True)
    if p.returncode != 0:
        raise SystemExit(f"the side {side} build failed in its container (exit {p.returncode})")
    print(f"side {side}: built in its container in {round(time.time() - t0)} s", flush=True)
    for root, _d, names in os.walk(dist, followlinks=False):
        for nm in names:
            fp = os.path.join(root, nm)
            if nm.endswith(".map") and stat.S_ISREG(os.lstat(fp).st_mode):
                os.remove(fp)   # vite.config's hidden maps: no page asks for one
    check_tree(dist)
    _rec, code = V.meta(dist, side, ref, sha, sorted(env))
    if code:
        raise SystemExit(code)
    tar_path = os.path.join(out_root, f"dist-{side}.tar")
    digest = pack(dist, tar_path)
    print(f"side {side}: {os.path.getsize(tar_path)} bytes, sha256 {digest}", flush=True)
    return {"sha": digest, "tar": tar_path, "commit": sha, "env": env}


def cmd_build(a: list[str]) -> int:
    opt = lambda k: a[a.index(k) + 1] if k in a else None  # noqa: E731
    out = opt("--out")
    if not out:
        raise SystemExit("--out is required")
    inputs = {}
    if os.environ.get("GITHUB_EVENT_PATH") and not opt("--build-ref"):
        inputs = (json.load(open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8")) or {}).get("inputs") or {}
    build_ref = opt("--build-ref") or str(inputs.get("build_ref") or "")
    base_ref = opt("--base-ref") or str(inputs.get("base_ref") or "")
    extra = opt("--build-env") or str(inputs.get("build_env") or "")
    if not build_ref:
        raise SystemExit("no build_ref: nothing to build")
    tmp = os.environ.get("RUNNER_TEMP") or os.path.join(out, "..")
    tmp = os.path.join(tmp, "speed-rig-build")
    os.makedirs(tmp, exist_ok=False)
    os.makedirs(out, exist_ok=False)
    res = os.path.join(tmp, "resolve")
    sha_b = resolve(build_ref, res)
    if base_ref:
        sha_a, ref_a = resolve(base_ref, res), base_ref
    else:
        sha_a = resolve(production_commit(), res)   # production's own web commit (on master), built like B
        ref_a = "production"
    sides = {"A": build_side("A", ref_a, sha_a, "", out, tmp)}
    if sha_b == sha_a and not extra:
        # the same commit and constants (an A/A calibration): B is the same build, packed again (identical bytes)
        import shutil
        shutil.copyfile(sides["A"]["tar"], os.path.join(out, "dist-B.tar"))
        sides["B"] = {**sides["A"], "tar": os.path.join(out, "dist-B.tar")}
        print("side B: the same commit and constants as A: the same build", flush=True)
    else:
        sides["B"] = build_side("B", build_ref, sha_b, extra, out, tmp)
    gh = os.environ.get("GITHUB_OUTPUT")
    if gh:
        with open(gh, "a", encoding="utf-8") as f:
            f.write(f"sha_A={sides['A']['sha']}\nsha_B={sides['B']['sha']}\n")
    return 0


def self_check() -> int:
    import tempfile
    ok = True
    with tempfile.TemporaryDirectory() as d:
        b = os.path.join(d, "b")
        os.makedirs(os.path.join(b, "assets"))
        open(os.path.join(b, "index.html"), "w").write("<html>")
        open(os.path.join(b, "assets", "index-X.js"), "w").write("x")
        tp = os.path.join(d, "dist.tar")
        sha = pack(b, tp)
        ok &= unpack(tp, sha, os.path.join(d, "u1")) == 2 and open(os.path.join(d, "u1", "assets", "index-X.js")).read() == "x"
        # a sha mismatch never opens it; and every bad member is refused
        def refused(fn):
            try:
                fn()
                return False
            except SystemExit as e:
                return str(e).startswith("refused")
        ok &= refused(lambda: unpack(tp, "0" * 64, os.path.join(d, "u2")))

        def crafted(name, kind=tarfile.REGTYPE, link=""):
            p = os.path.join(d, f"bad{abs(hash((name, kind)))}.tar")
            with tarfile.open(p, "w") as t:
                ti = tarfile.TarInfo(name)
                ti.type, ti.linkname = kind, link
                data = b"" if kind != tarfile.REGTYPE else b"evil"
                ti.size = len(data)
                t.addfile(ti, io.BytesIO(data))
            return p
        for name, kind, link in (("/etc/x", tarfile.REGTYPE, ""), ("../x", tarfile.REGTYPE, ""), ("a/../../x", tarfile.REGTYPE, ""),
                                 ("a\\..\\x", tarfile.REGTYPE, ""), ("C:/x", tarfile.REGTYPE, ""), ("l", tarfile.SYMTYPE, "/proc/self/environ"),
                                 ("h", tarfile.LNKTYPE, "index.html"), ("dir", tarfile.DIRTYPE, ""), ("./x", tarfile.REGTYPE, "")):
            p = crafted(name, kind, link)
            if not refused(lambda: unpack(p, sha256_file(p), os.path.join(d, f"u-{abs(hash(name))}"))):
                ok = False
                print(f"self-check FAILED: a crafted member ({kind!r}) was not refused")
        # the host check refuses a hardlink in the build (and a symlink where one can be made)
        os.link(os.path.join(b, "index.html"), os.path.join(b, "assets", "hl"))
        ok &= refused(lambda: check_tree(b))
        os.remove(os.path.join(b, "assets", "hl"))
        # and a file larger than a build's bound
        global MAX_FILE
        keep, MAX_FILE = MAX_FILE, 3
        try:
            ok &= refused(lambda: check_tree(b))
        finally:
            MAX_FILE = keep
        try:
            os.symlink("/proc/self/environ", os.path.join(b, "assets", "sl.js"))
            ok &= refused(lambda: check_tree(b))
        except (OSError, NotImplementedError):
            pass   # no symlink privilege here (Windows); the tar rails above refuse a symlink member anyway
    for r, good in (("master", True), ("infra/x-y.z", True), ("a..b", False), ("-x", False), ("a b", False)):
        ok &= bool(BRANCH_RE.fullmatch(r) and ".." not in r and not r.startswith("-")) == good
    print(f"build_candidate self-check: {'ok' if ok else 'FAILED'} (pack/unpack round trip; sha mismatch, absolute, '..', backslash, drive, symlink, "
          "hardlink, directory and dot members refused; hardlink in a build refused)")
    return 0 if ok else 1


def main() -> int:
    a = sys.argv[1:]
    if "--self-check" in a:
        return self_check()
    if a[:1] == ["build"]:
        return cmd_build(a[1:])
    if a[:1] == ["unpack"]:
        opt = lambda k: a[a.index(k) + 1] if k in a else None  # noqa: E731
        unpack(opt("--tar"), opt("--sha"), opt("--out"))
        return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main())
