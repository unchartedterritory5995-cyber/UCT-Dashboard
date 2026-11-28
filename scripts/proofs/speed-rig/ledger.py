"""The speed rig's TICKER LEDGER: every ticker any speed run used, shared by the owner-PC rig and the cloud rig.

Owner rule (2026-11-27): "The 50 test tickers need to change each test and have to be different for every test", so
every pass measures COLD names (never opened by an earlier run, so no edge, origin or device copy is warm for it).
Parallel passes of one sweep must not share a ticker either.
THE REUSE WINDOW (the lead, 2026-11-28, when 199 runs had used 2,268 of the 2,269-ticker pool in ten hours and every
sweep was refused): plan.py hands out every never-used ticker first, then a ticker whose last run is older than
plan.REUSE_AFTER_DAYS (14). The browser side of a reused name is cold (every pass's profile is fresh); the server side
may be warm, so the run records its reused names (`reused`) and grade.py grades them apart.
THE POOL (`repool`, 2026-11-28): the app's whole listed universe (/api/ticker-universe = api/data/cap_universe.json,
~3.6k $300M+ symbols), most liquid first (its `pop` rank), WITHOUT the ETFs and indexes (production's classifier,
/api/ticker-types/etf-index-symbols, signed in as the bench member, plus api/data/prebuilt_etfs.json: a fund's chart
is not a stock's), the delisted names (api/data/delisted_tickers*.json) and the rig's own fixed tickers (RIG_FIXED:
the board's start symbol). It was the liquid subset of that universe ($5 and $5M a day: 2,269).

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
    python scripts/proofs/speed-rig/ledger.py repool [--dry] [--etf-file F]
        # a new pool (THE POOL above); the runs are kept as they are. Signs in as BENCH_EMAIL / BENCH_PASSWORD for the
        # ETF list (or --etf-file: a JSON list), never prints either.
    python scripts/proofs/speed-rig/ledger.py --self-check

Standard library only. Exit 0 ok, 1 refused, 2 could not reach git.
"""
from __future__ import annotations

import argparse
import glob
import http.cookiejar
import json
import os
import re
import subprocess
import urllib.request
import sys
import tempfile
from datetime import datetime, timezone

REF = "refs/speed-rig/ledger"
FILE = "ledger.json"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36"
#: tickers the rig itself opens on every pass (rig.mjs: the board's colour group A starts on SPY), never handed out
RIG_FIXED = {"SPY"}
SYMBOL = re.compile(r"[A-Z][A-Z0-9.\-]{0,9}")


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


def build_pool(universe: list[str], pop: list[int], etf_index: set[str], delisted: set[str], fixed: set[str]) -> tuple[list[str], dict]:
    """(the pool, most liquid first: pop rank 1 first, unranked (0) last, then A-Z; the count each rule excluded)."""
    rank = {str(s).upper(): (pop[i] if i < len(pop) and isinstance(pop[i], int) and pop[i] > 0 else 10 ** 9) for i, s in enumerate(universe)}
    out, dropped = [], {"etfOrIndex": 0, "delisted": 0, "rigFixed": 0, "notASymbol": 0}
    for sym in sorted(rank, key=lambda s: (rank[s], s)):
        if not SYMBOL.fullmatch(sym):
            dropped["notASymbol"] += 1
        elif sym in fixed:
            dropped["rigFixed"] += 1
        elif sym in etf_index:
            dropped["etfOrIndex"] += 1
        elif sym in delisted:
            dropped["delisted"] += 1
        else:
            out.append(sym)
    return out, dropped


def _http(opener, base: str, path: str, body: dict | None = None, timeout: float = 60):
    req = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(), method="GET" if body is None else "POST",
                                 headers={"User-Agent": UA, "Accept": "application/json", **({} if body is None else {"Content-Type": "application/json"})})
    with opener.open(req, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode("utf-8") or "null")


def repo_excluded() -> tuple[set[str], set[str], set[str]]:
    """(the repo's prebuilt ETFs, its delisted names, the symbols the bench boards name)."""
    def load(rel):
        try:
            return json.load(open(os.path.join(ROOT, rel), encoding="utf-8"))
        except (OSError, ValueError):
            raise SystemExit(f"repool needs {rel} (a sparse checkout must include api/data/)")
    etfs = {str(x).upper() for x in load("api/data/prebuilt_etfs.json")}
    dl = {str(r.get("ticker") or "").upper() for f in ("api/data/delisted_tickers.json", "api/data/delisted_tickers_bulk.json") for r in load(f)}
    boards = set()
    for f in glob.glob(os.path.join(HERE, "boards", "*.json")):
        boards |= set(re.findall(r'"(?:sym|symbol|ticker)"\s*:\s*"([A-Z][A-Z0-9.\-]{0,9})"', open(f, encoding="utf-8").read()))
    return etfs, dl - {""}, boards


def fetch_pool(base: str, etf_file: str | None) -> dict:
    """The new pool from production's own lists (THE POOL above); credentials from the environment, never printed."""
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    st, uni = _http(opener, base, "/api/ticker-universe")
    if st != 200 or not isinstance(uni, dict) or not uni.get("symbols"):
        raise SystemExit(f"/api/ticker-universe answered {st}")
    if etf_file:
        etf = {str(x).upper() for x in json.load(open(etf_file, encoding="utf-8"))}
        etf_src = f"file {os.path.basename(etf_file)}"
    else:
        email, pw = os.environ.get("BENCH_EMAIL"), os.environ.get("BENCH_PASSWORD")
        if not (email and pw):
            raise SystemExit("repool needs BENCH_EMAIL / BENCH_PASSWORD (the ETF list is signed-in) or --etf-file")
        st, _ = _http(opener, base, "/api/auth/login", {"email": email, "password": pw})
        if st != 200:
            raise SystemExit(f"sign-in refused ({st})")
        try:
            st, j = _http(opener, base, "/api/ticker-types/etf-index-symbols", timeout=240)   # a bulk read: slow on a cold pod
        finally:
            try:
                _http(opener, base, "/api/auth/logout", {})
            except Exception:  # noqa: BLE001 -- the session expires on its own
                pass
        if st != 200 or not isinstance(j, dict) or not j.get("symbols"):
            raise SystemExit(f"/api/ticker-types/etf-index-symbols answered {st}: refusing a pool that cannot leave the funds out")
        etf = {str(x).upper() for x in j["symbols"]}
        etf_src = f"/api/ticker-types/etf-index-symbols ({len(etf)})"
    prebuilt, delisted, boards = repo_excluded()
    tickers, dropped = build_pool(uni["symbols"], uni.get("pop") or [], etf | prebuilt, delisted, RIG_FIXED | boards)
    return {"built": now(), "tickers": tickers, "universe": {"v": uni.get("v"), "symbols": len(uni["symbols"])}, "excluded": dropped,
            "rule": f"/api/ticker-universe (cap_universe, $300M+) by liquidity rank, without ETFs and indexes ({etf_src} + "
                    f"prebuilt_etfs.json), delisted names (delisted_tickers*.json) and the rig's fixed tickers"}


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
    # the pool: liquid first, unranked last, and each exclusion counted (a rule that removes nothing is visible)
    pool, dropped = build_pool(["ZZ", "AA", "SPY", "QQQ", "DEAD", "BB", "bad sym"], [0, 2, 1, 3, 9, 1, 0], {"QQQ"}, {"DEAD"}, {"SPY"})
    assert pool == ["BB", "AA", "ZZ"], pool
    assert dropped == {"etfOrIndex": 1, "delisted": 1, "rigFixed": 1, "notASymbol": 1}, dropped
    print("ledger self-check: ok")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", nargs="?", choices=["show", "sync", "seed", "repool"])
    ap.add_argument("--dry", action="store_true", help="repool: print the new pool's counts, write nothing")
    ap.add_argument("--etf-file", default=None, help="repool: the ETF/index symbols as a JSON list (instead of signing in)")
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
        if a.cmd == "repool":
            pool = fetch_pool(os.environ.get("UCT_PROOF_BASE", "https://uctintelligence.com"), a.etf_file)
            sha, led = read(a.git_dir, a.remote)
            u = used(led)
            summary = {"pool": len(pool["tickers"]), "excluded": pool["excluded"], "neverUsed": len([t for t in pool["tickers"] if t not in u]),
                       "previousPool": len((led.get("pool") or {}).get("tickers", [])), "runs": len(led.get("runs", []))}
            print(json.dumps(summary))
            if a.dry:
                return 0

            def swap(led):
                new = json.loads(json.dumps(led))
                new["pool"] = pool
                return new, None
            commit, _, _ = update(swap, f"speed-rig ledger: repool ({len(pool['tickers'])} tickers, {summary['neverUsed']} never used)", a.git_dir, a.remote)
            print(f"repooled {REF} at {commit[:12]}")
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
