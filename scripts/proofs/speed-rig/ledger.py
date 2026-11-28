"""The speed rig's TICKER LEDGER: every ticker any speed run used, shared by the owner-PC rig and the cloud rig.

Owner rule (2026-11-27): "The 50 test tickers need to change each test and have to be different for every test", so
every pass measures COLD names (never opened by an earlier run, so no edge, origin or device copy is warm for it).
Parallel passes of one sweep must not share a ticker either.

WHERE IT LIVES: one commit on the ref `refs/speed-rig/ledger` of this repository (NOT a branch: no workflow runs on
it, nothing deploys, branch rules do not apply), holding `ledger.json`:
    {"version": 1,
     "pool": {"built": <iso>, "rule": <text>, "tickers": [symbols, most liquid first]},
     "runs": [{"id": <unique>, "at": <iso>, "source": "cloud" | "pc", "tickers": [...]}, ...]}
Tickers only: no prices, no volumes, no account data. The repo is public, so the ledger is readable by anyone.

WRITES ARE COMPARE-AND-SWAP. A new ledger is a commit whose parent is the commit it was read from, pushed WITHOUT
force: git refuses a push that is not a fast-forward, so a writer that lost a race re-reads and tries again, and two
sweeps can never hand out the same ticker. A ticker is recorded BEFORE it is used.

    python scripts/proofs/speed-rig/ledger.py show                    # pool size, used, free
    python scripts/proofs/speed-rig/ledger.py sync --local C:/uct-runs/rig/used_tickers.json
        # union of the PC ledger and the shared one, written to BOTH (run it before and after a PC run)
    python scripts/proofs/speed-rig/ledger.py seed --local <used_tickers.json> --pool <liquid_pool.json>
        # first creation of the ref (refuses when it exists)
    python scripts/proofs/speed-rig/ledger.py --self-check

Standard library only. Exit 0 ok, 1 refused, 2 could not reach git.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

REF = "refs/speed-rig/ledger"
FILE = "ledger.json"


class Conflict(Exception):
    """The ref moved between the read and the write: re-read and try again."""


class GitError(Exception):
    pass


def _git(args: list[str], *, git_dir: str | None, stdin: bytes | None = None, env: dict | None = None) -> bytes:
    cmd = ["git"] + (["--git-dir", git_dir] if git_dir else []) + args
    e = dict(os.environ)
    e.update({"GIT_AUTHOR_NAME": e.get("GIT_AUTHOR_NAME", "speed-rig"), "GIT_AUTHOR_EMAIL": e.get("GIT_AUTHOR_EMAIL", "speed-rig@users.noreply.github.com"),
              "GIT_COMMITTER_NAME": e.get("GIT_COMMITTER_NAME", "speed-rig"), "GIT_COMMITTER_EMAIL": e.get("GIT_COMMITTER_EMAIL", "speed-rig@users.noreply.github.com"),
              "GIT_TERMINAL_PROMPT": "0"})
    if env:
        e.update(env)
    p = subprocess.run(cmd, input=stdin, capture_output=True, env=e, timeout=180)
    if p.returncode != 0:
        err = (p.stderr or b"").decode("utf-8", "replace").strip()
        raise GitError(f"git {args[0]} failed ({p.returncode}): {err[:400]}")
    return p.stdout


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def empty() -> dict:
    return {"version": 1, "pool": {"built": None, "rule": None, "tickers": []}, "runs": []}


def used(ledger: dict, reuse_after_days: float | None = None, at: datetime | None = None) -> set[str]:
    """Every ticker the ledger says was used. With reuse_after_days (an OWNER decision; default never), a run older
    than that many days no longer reserves its tickers."""
    at = at or datetime.now(timezone.utc)
    out = set()
    for r in ledger.get("runs", []):
        if reuse_after_days is not None:
            try:
                t = datetime.fromisoformat(str(r.get("at")).replace("Z", "+00:00"))
                if t.tzinfo is None:
                    t = t.replace(tzinfo=timezone.utc)
                if (at - t).total_seconds() > reuse_after_days * 86400:
                    continue
            except ValueError:
                pass
        out.update(str(x).upper() for x in r.get("tickers", []))
    return out


def merge(a: dict, b: dict) -> dict:
    """The union of two ledgers: every run of either (by id), the pool of the one built later."""
    out = empty()
    pa, pb = a.get("pool") or {}, b.get("pool") or {}
    out["pool"] = pa if str(pa.get("built") or "") >= str(pb.get("built") or "") else pb
    seen = {}
    for r in list(a.get("runs", [])) + list(b.get("runs", [])):
        rid = str(r.get("id"))
        if rid not in seen:
            seen[rid] = {"id": rid, "at": r.get("at"), "source": r.get("source", "pc"), "tickers": [str(x).upper() for x in r.get("tickers", [])]}
    out["runs"] = sorted(seen.values(), key=lambda r: (str(r.get("at") or ""), r["id"]))
    return out


def read(git_dir: str | None = None, remote: str = "origin") -> tuple[str | None, dict]:
    """(commit sha, ledger) of the shared ledger as the remote holds it now; (None, empty) when the ref does not exist."""
    line = _git(["ls-remote", remote, REF], git_dir=git_dir).decode().strip()
    if not line:
        return None, empty()
    # into a local cache ref (never FETCH_HEAD: a shared object store may have other sessions using that)
    local = "refs/speed-rig-cache/ledger"
    _git(["fetch", "--quiet", "--no-tags", "--no-write-fetch-head", remote, f"+{REF}:{local}"], git_dir=git_dir)
    sha = _git(["rev-parse", local], git_dir=git_dir).decode().strip()
    body = _git(["cat-file", "blob", f"{sha}:{FILE}"], git_dir=git_dir)
    return sha, json.loads(body.decode("utf-8"))


def write(ledger: dict, parent: str | None, message: str, git_dir: str | None = None, remote: str = "origin") -> str:
    """Push `ledger` as a commit on `parent`. Raises Conflict when the ref moved (or exists, for parent=None)."""
    blob = _git(["hash-object", "-w", "--stdin"], git_dir=git_dir, stdin=(json.dumps(ledger, indent=1) + "\n").encode("utf-8")).decode().strip()
    tree = _git(["mktree"], git_dir=git_dir, stdin=f"100644 blob {blob}\t{FILE}\n".encode()).decode().strip()
    args = ["commit-tree", tree, "-m", message] + (["-p", parent] if parent else [])
    commit = _git(args, git_dir=git_dir).decode().strip()
    try:
        _git(["push", "--quiet", "--porcelain", remote, f"{commit}:{REF}"], git_dir=git_dir)
    except GitError as e:
        s = str(e)
        if "rejected" in s or "non-fast-forward" in s or "fetch first" in s or "stale info" in s or "already exists" in s:
            raise Conflict(s) from e
        raise
    return commit


def update(fn, message: str, git_dir: str | None = None, remote: str = "origin", tries: int = 6):
    """Read, apply fn(ledger) -> (new ledger, result), write; on a lost race re-read and apply again."""
    last = None
    for _ in range(tries):
        sha, led = read(git_dir, remote)
        new, result = fn(json.loads(json.dumps(led)))
        try:
            commit = write(new, sha, message, git_dir, remote)
            return commit, new, result
        except Conflict as e:
            last = e
            continue
    raise Conflict(f"the ledger kept moving ({tries} tries): {last}")


def _local_to_shared(local: dict) -> dict:
    """The PC rig's used_tickers.json ({"runs": [{"id", "at", "tickers", ...}]}) as a shared ledger."""
    out = empty()
    out["runs"] = [{"id": str(r.get("id")), "at": r.get("at"), "source": "pc", "tickers": [str(x).upper() for x in r.get("tickers", [])]}
                   for r in local.get("runs", [])]
    return out


def _write_local(path: str, shared: dict, local: dict) -> None:
    """Add the shared ledger's runs to the PC ledger (its own runs kept verbatim, fields and all); temp file + replace."""
    have = {str(r.get("id")) for r in local.get("runs", [])}
    add = [{"id": r["id"], "at": r.get("at"), "source": r.get("source"), "tickers": r.get("tickers", [])}
           for r in shared.get("runs", []) if r["id"] not in have]
    local = dict(local)
    local["runs"] = list(local.get("runs", [])) + add
    fd, tmp = tempfile.mkstemp(prefix=".used_tickers.", dir=os.path.dirname(os.path.abspath(path)))
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(local, f, indent=1)
    os.replace(tmp, path)


def _pool_from_file(path: str) -> dict:
    p = json.load(open(path, encoding="utf-8"))
    rows = p.get("tickers", [])
    syms = [r["s"] for r in sorted(rows, key=lambda r: -(r.get("dv") or 0))] if rows and isinstance(rows[0], dict) else [str(x) for x in rows]
    return {"built": p.get("built") or now(), "rule": p.get("rule"), "tickers": syms}


def self_check() -> None:
    a = {"runs": [{"id": "x", "at": "2026-11-01T00:00:00+00:00", "tickers": ["aa", "BB"]}]}
    b = {"pool": {"built": "2026-11-02", "tickers": ["AA", "BB", "CC"]}, "runs": [{"id": "y", "at": "2026-11-20T00:00:00+00:00", "tickers": ["CC"]}, {"id": "x", "tickers": ["ZZ"]}]}
    m = merge(_local_to_shared(a), b)
    assert [r["id"] for r in m["runs"]] == ["x", "y"], m
    assert used(m) == {"AA", "BB", "CC"}, used(m)   # run x kept from the FIRST ledger (its ZZ copy ignored)
    assert m["pool"]["tickers"] == ["AA", "BB", "CC"]
    # the owner's never-reuse default, and the optional retirement window can tell the cases apart
    at = datetime(2026, 11, 28, tzinfo=timezone.utc)
    assert used(m, None, at) == {"AA", "BB", "CC"}
    assert used(m, 10, at) == {"CC"}, used(m, 10, at)
    print("ledger self-check: ok")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", nargs="?", choices=["show", "sync", "seed"])
    ap.add_argument("--git-dir", default=None)
    ap.add_argument("--remote", default="origin")
    ap.add_argument("--local", default=None, help="the PC rig's used_tickers.json")
    ap.add_argument("--pool", default=None, help="a liquid_pool.json (seed, or a newer pool for sync)")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()
    if a.self_check:
        self_check()
        return 0
    try:
        if a.cmd == "show":
            sha, led = read(a.git_dir, a.remote)
            u = used(led)
            pool = led.get("pool", {}).get("tickers", [])
            print(json.dumps({"ref": REF, "commit": sha, "runs": len(led.get("runs", [])), "used": len(u), "pool": len(pool),
                              "free": len([t for t in pool if t.upper() not in u]), "poolBuilt": led.get("pool", {}).get("built")}))
            return 0
        if a.cmd == "seed":
            if not (a.local and a.pool):
                print("seed needs --local and --pool", file=sys.stderr)
                return 1
            sha, _ = read(a.git_dir, a.remote)
            if sha:
                print(f"{REF} exists ({sha[:12]}): use sync", file=sys.stderr)
                return 1
            led = _local_to_shared(json.load(open(a.local, encoding="utf-8")))
            led["pool"] = _pool_from_file(a.pool)
            commit = write(led, None, f"speed-rig ledger: seeded from the PC ledger ({len(led['runs'])} runs)", a.git_dir, a.remote)
            print(f"seeded {REF} at {commit[:12]}: {len(used(led))} used of a {len(led['pool']['tickers'])}-ticker pool")
            return 0
        if a.cmd == "sync":
            if not a.local:
                print("sync needs --local", file=sys.stderr)
                return 1
            local = json.load(open(a.local, encoding="utf-8"))

            def add_local(led):
                new = merge(led, _local_to_shared(local))
                if a.pool:
                    p = _pool_from_file(a.pool)
                    if str(p.get("built") or "") > str(new["pool"].get("built") or ""):
                        new["pool"] = p
                return new, None
            commit, shared, _ = update(add_local, "speed-rig ledger: sync with the PC ledger", a.git_dir, a.remote)
            _write_local(a.local, shared, local)
            print(f"synced: shared {commit[:12]} holds {len(shared['runs'])} runs, {len(used(shared))} used tickers; {a.local} updated")
            return 0
    except GitError as e:
        print(str(e), file=sys.stderr)
        return 2
    except Conflict as e:
        print(str(e), file=sys.stderr)
        return 1
    ap.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
