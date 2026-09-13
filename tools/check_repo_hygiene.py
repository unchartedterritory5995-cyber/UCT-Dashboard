"""Refuse to publish what this PUBLIC repo should never carry: an oversized file, or a `.env*`.

  python tools/check_repo_hygiene.py              # what is TRACKED today (the gate)
  python tools/check_repo_hygiene.py --staged     # what is about to be committed (pre-commit hook)
  python tools/check_repo_hygiene.py --self-check # prove the check can fail

Exit 0 clean · 1 a violation · 2 the check could not run (never silently "clean").

⛔ WHY AN ALLOWLIST AND NOT A BARE LIMIT. Fifteen files over 5 MB are already tracked (measured
2026-09-13: `api/patches-6-25.json` is 23.7 MB). A bare limit is red on arrival, gets muted within a
week, and then protects nothing. The allowlist is the record of what is already here; anything NEW
has to be added deliberately, which is the same contract `docs/feature_flags.json` uses for gates.

⛔ AND IT REFUSES RATHER THAN PASSING ON AN EMPTY LIST. `git ls-files` returning nothing — a wrong
cwd, a missing git — would satisfy every assertion below over zero files. `MIN_TRACKED` is the
non-vacuity control (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys

MAX_BYTES = 5 * 1024 * 1024
MIN_TRACKED = 1000          # non-vacuity: this repo tracked 9,046 files on 2026-09-13

# Tracked before the gate existed. Measured, not guessed — `--self-check` proves the gate still bites.
BIG_ALLOWLIST = {
    "api/patches-6-24.json", "api/patches-6-25.json", "api/patches-6-26.json", "api/patches-6-29.json",
    "api/patches-6-30.json", "api/patches-7-1.json", "api/patches-7-2.json",
    "api/fill-6-26-stocks.csv", "api/fill-6-29-stocks.csv", "api/fill-6-30-stocks.csv",
    "api/fill-7-1-stocks.csv", "api/fill-7-2-stocks.csv", "api/fill-7-8-stocks.csv",
    "app/public/UCT Logo.png", "app/public/UCT_logo_512.png",
}
# A `.env*` may be tracked only when it carries no value — a template.
ENV_ALLOWLIST = {".env.example"}


def _run(args: list[str], cwd: str) -> str:
    p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    if p.returncode != 0:
        raise RuntimeError(f"{' '.join(args)} failed: {p.stderr.strip()[:200]}")
    return p.stdout


def repo_root(start: str | None = None) -> str:
    return _run(["git", "rev-parse", "--show-toplevel"], start or os.getcwd()).strip()


def tracked_files(root: str, staged: bool = False) -> list[str]:
    """Paths git would publish: everything tracked, or (for a hook) everything staged."""
    if staged:
        out = _run(["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], root)
    else:
        out = _run(["git", "ls-files", "-z"], root)
    return [f for f in out.split("\0") if f]


def violations(root: str, files: list[str]) -> list[str]:
    bad = []
    for rel in files:
        base = rel.rsplit("/", 1)[-1]
        if base.startswith(".env") and rel not in ENV_ALLOWLIST:
            bad.append(f"{rel} — a .env* file must never be tracked in a public repo "
                       f"(allowed: {', '.join(sorted(ENV_ALLOWLIST))})")
            continue
        try:
            size = os.path.getsize(os.path.join(root, rel))
        except OSError:
            continue                      # a staged delete/rename: nothing to publish
        if size > MAX_BYTES and rel not in BIG_ALLOWLIST:
            bad.append(f"{rel} — {size / 1024 / 1024:.1f} MB exceeds the {MAX_BYTES // 1024 // 1024} MB limit; "
                       f"keep it out of git, or add it to BIG_ALLOWLIST with a reason")
    return bad


def check(root: str, staged: bool = False) -> tuple[int, str]:
    try:
        files = tracked_files(root, staged)
    except Exception as e:  # noqa: BLE001 — a git that cannot answer is "could not run", never "clean"
        return 2, f"REFUSING TO PASS: could not list files under {root}: {e}"
    if not staged and len(files) < MIN_TRACKED:
        return 2, (f"REFUSING TO PASS: only {len(files)} tracked file(s) found, expected >= {MIN_TRACKED}. "
                   "The scan did not run against this repo; a clean result here would be meaningless.")
    bad = violations(root, files)
    scope = "staged" if staged else "tracked"
    if bad:
        return 1, f"{len(bad)} repo-hygiene violation(s) among {len(files)} {scope} file(s):\n  " + "\n  ".join(bad)
    return 0, f"clean: {len(files)} {scope} file(s), no oversized file and no .env* outside the allowlist"


def self_check(root: str) -> tuple[int, str]:
    """Prove the gate bites: a planted oversized file and a planted .env must both be reported, and a
    scan that finds nothing must refuse rather than pass."""
    import tempfile
    lines = []
    with tempfile.TemporaryDirectory() as tmp:
        big = os.path.join(tmp, "planted-big.bin")
        with open(big, "wb") as fh:
            fh.write(b"\0" * (MAX_BYTES + 1))
        open(os.path.join(tmp, ".env.planted"), "w").close()
        found = violations(tmp, ["planted-big.bin", ".env.planted"])
        lines.append(f"planted oversized file reported: {any('planted-big.bin' in v for v in found)}")
        lines.append(f"planted .env file reported:      {any('.env.planted' in v for v in found)}")
        lines.append(f"allowlisted name exempt:         {violations(tmp, ['.env.example']) == []}")
        if len(found) != 2:
            return 1, "SELF-CHECK FAILED\n  " + "\n  ".join(lines)
    rc, msg = check(root)
    lines.append(f"real scan: rc={rc} {msg.splitlines()[0]}")
    ok = rc == 0
    return (0 if ok else 1), ("SELF-CHECK PASSED (the gate reports a violation and clears a clean tree)\n  "
                              if ok else "SELF-CHECK: the gate bites, but this repo is not clean\n  ") + "\n  ".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--staged", action="store_true", help="check what is staged (pre-commit hook mode)")
    ap.add_argument("--self-check", action="store_true", help="prove the check can fail")
    args = ap.parse_args(argv)
    try:
        root = repo_root()
    except Exception as e:  # noqa: BLE001
        print(f"could not locate the repository: {e}", file=sys.stderr)
        return 2
    rc, msg = self_check(root) if args.self_check else check(root, args.staged)
    print(msg, file=sys.stderr if rc else sys.stdout)
    return rc


if __name__ == "__main__":
    sys.exit(main())
