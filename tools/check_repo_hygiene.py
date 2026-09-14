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

⛔⛔ THIRD CHECK — LINE ENDINGS MUST MATCH WHAT GIT ALREADY STORES (owner ruling R-2, 2026-09-13).
A two-line edit that comes back as an 87-added / 87-deleted diff is not an edit, it is a line-ending
flip, and it has cost this programme two sessions. It happens because `core.autocrlf` is `true` on
this box while a handful of blobs were committed CRLF, so a Python `newline=""` round trip that
faithfully preserves what is ON DISK writes the opposite of what git stores. Measured 2026-09-13:
9,135 tracked files, **7** of them CRLF in the index — that is `CRLF_IN_INDEX` below. A new file
must be LF.

⭐ THE PREDICATE IS "DIFFERENT FROM THE STORED BLOB", NOT "CONTAINS CRLF". A bare CRLF ban would go
red on `docs/plans/joystick/deferred.md` the moment somebody edited it CORRECTLY, and a check that
fires on the right answer gets muted within a week. And a style comparison is not enough either:
that same file is MIXED — 87 CRLF lines among LF ones — so `eol_style` answers "crlf" for both sides
of a real flip. The test is whether the two sides are identical once every CR is removed.

⚠️ THE TRAP IS ONE-DIRECTIONAL ON THIS BOX, AND THAT IS A MEASUREMENT. With `core.autocrlf=true`,
writing CRLF over an LF-stored file is CLEANED on the way in: `git diff` reports nothing at all and
nothing wrong can reach a commit (measured on `docs/feature_flags.json`, 2026-09-13 — numstat
empty). The direction that actually damages a diff is a CRLF-stored or MIXED blob being flattened to
LF, which is what bit twice. So "never write CRLF" is the wrong lesson to carry away; "write what git
already stores" is the right one, and it is the only one this gate enforces.
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

# A NEW file may arrive CRLF only if it is listed here. Measured 2026-09-13 by reading every tracked
# blob out of the index, never guessed: 7 of 9,135 already carry CRLF, and they must KEEP it — an
# existing file is judged against its own stored blob, so this set only governs files git has never
# seen. The seven are recorded so nobody "fixes" one and produces a 9,000-line diff.
CRLF_ALLOWED = {
    "app/public/Darkpool-data.csv", "app/public/Indexes-data.csv", "app/public/OptionsFlow.csv",
    "app/public/flow-data.csv", "app/src/hub/sections/homeSection.js",
    "docs/plans/joystick/deferred.md", "tools/wave_p_cert_corpus/manifest.json",
}


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


def eol_style(blob: bytes) -> str:
    """`crlf` · `lf` · `none` — `none` being a single line or no newline at all, nothing to compare."""
    if b"\r\n" in blob:
        return "crlf"
    if b"\n" in blob:
        return "lf"
    return "none"


def is_binary(blob: bytes) -> bool:
    return b"\x00" in blob[:8000]


def eol_violation(rel: str, stored: bytes | None, incoming: bytes) -> str | None:
    """The pure predicate, kept separate so `--self-check` can exercise it without a repository.

    `stored` is None for a path git has never seen — which must arrive LF. Otherwise: if the two
    sides are IDENTICAL once every CR is removed, then the only thing that changed is the line
    endings, and that is the whole-file rewrite this exists to refuse.

    ⭐ COMPARING CR-STRIPPED CONTENT, NOT STYLES. `docs/plans/joystick/deferred.md` is MIXED — 87 of
    its lines are CRLF and the rest are LF — so `eol_style` answers "crlf" for both sides of a real
    flip and a style comparison reads it as fine. Stripping CR is also filter-independent, which
    matters because the bytes on disk are not the bytes in the commit; comparing THOSE two is the
    original mistake, one level down."""
    if is_binary(incoming) or (stored is not None and is_binary(stored)):
        return None
    if stored is None:
        if b"\r\n" in incoming and rel not in CRLF_ALLOWED:
            return (f"{rel} — a NEW file with CRLF endings; this repo stores LF. Write it with LF: "
                    "a Python round trip opened with newline='' preserves whatever was on disk, and "
                    "on this box that is the wrong answer. A file that genuinely must be CRLF goes "
                    "in CRLF_ALLOWED with a reason.")
        return None
    if incoming == stored:
        return None
    if incoming.replace(b"\r", b"") != stored.replace(b"\r", b""):
        return None                        # a real edit — endings are not the only difference
    return (f"{rel} — the ONLY difference from the blob git stores is line endings "
            f"({eol_style(stored).upper()} -> {eol_style(incoming).upper()}). That is not an edit, "
            "it is a whole-file rewrite: every line shows as changed and the real change becomes "
            "unreviewable. Rewrite it with the endings git already holds.")


def _blob(root: str, spec: str) -> bytes | None:
    """The bytes git holds at `spec` (`HEAD:path` or `:path`). None when it holds nothing there."""
    p = subprocess.run(["git", "cat-file", "blob", spec], cwd=root, capture_output=True, timeout=120)
    return p.stdout if p.returncode == 0 else None


def eol_violations(root: str, staged: bool) -> list[str]:
    """Compare what is about to be committed against what git stores — for CHANGED paths only.

    Staged mode reads the index blob (exactly what a commit would record). Worktree mode reads the
    file, which is the earlier alarm: it fires the moment the rewrite happens, before `git add`."""
    args = ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"] if staged else [
        "git", "diff", "HEAD", "--name-only", "--diff-filter=ACMR", "-z"]
    changed = [f for f in _run(args, root).split("\x00") if f]
    bad = []
    for rel in changed:
        if staged:
            incoming = _blob(root, f":{rel}")
        else:
            try:
                with open(os.path.join(root, rel), "rb") as fh:
                    incoming = fh.read()
            except OSError:
                incoming = None            # a deleted/unreadable path publishes nothing
        if incoming is None:
            continue
        v = eol_violation(rel, _blob(root, f"HEAD:{rel}"), incoming)
        if v:
            bad.append(v)
    return bad


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
    try:
        bad += eol_violations(root, staged)
    except Exception as e:  # noqa: BLE001 — same contract: a check that could not run is not "clean"
        return 2, f"REFUSING TO PASS: the line-ending check could not run under {root}: {e}"
    scope = "staged" if staged else "tracked"
    if bad:
        return 1, f"{len(bad)} repo-hygiene violation(s) among {len(files)} {scope} file(s):\n  " + "\n  ".join(bad)
    return 0, (f"clean: {len(files)} {scope} file(s), no oversized file, no .env* outside the "
               "allowlist, and no line-ending flip against the stored blobs")


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

    # The line-ending predicate, both directions plus every way it must stay quiet. A check that
    # only ever reports is as useless as one that never does — the "no" cases are half the proof.
    lf, crlf = b"a\nb\nc\n", b"a\r\nb\r\nc\r\n"
    mixed = b"a\r\nb\nc\r\n"              # the shape of docs/plans/joystick/deferred.md
    eol_cases = [
        ("LF blob rewritten CRLF   -> reported", eol_violation("x.md", lf, crlf) is not None),
        ("CRLF blob rewritten LF   -> reported", eol_violation("x.md", crlf, lf) is not None),
        ("MIXED blob flattened LF  -> reported", eol_violation("x.md", mixed, lf) is not None),
        ("new file arriving CRLF   -> reported", eol_violation("x.md", None, crlf) is not None),
        ("LF kept LF               -> quiet   ", eol_violation("x.md", lf, lf) is None),
        ("CRLF kept CRLF           -> quiet   ", eol_violation("x.md", crlf, crlf) is None),
        ("new file arriving LF     -> quiet   ", eol_violation("x.md", None, lf) is None),
        ("allowlisted new CRLF     -> quiet   ",
         eol_violation("app/public/flow-data.csv", None, crlf) is None),
        ("a real edit, LF both     -> quiet   ", eol_violation("x.md", lf, b"a\nB\nc\nd\n") is None),
        ("a real edit on a CRLF f. -> quiet   ",
         eol_violation("x.md", crlf, b"a\r\nB\r\nc\r\nd\r\n") is None),
        ("binary (a NUL) ignored   -> quiet   ", eol_violation("x.png", lf, b"\x89PNG\x00\r\n") is None),
        ("single line, no EOL      -> quiet   ", eol_violation("x.md", lf, b"one line") is None),
    ]
    lines += [f"{label} {ok}" for label, ok in eol_cases]
    if not all(ok for _, ok in eol_cases):
        return 1, "SELF-CHECK FAILED (line-ending predicate)\n  " + "\n  ".join(lines)
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
