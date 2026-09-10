"""Apply and revert a mutation proof, so a mutation that does not apply cannot read as a pass.

⛔⛔ THE DEFECT THIS EXISTS FOR — it happened THREE TIMES IN ONE DAY, 2026-09-10.

Every rail in this repo is supposed to be mutation-proved: break the product code, watch the NAMED
assertion fail, revert BY EDITING BACK. The failure mode nobody watches for is the mutation that
never lands:

    old = "  const hint = open && ringName\\n    ? ringName"     # LF in the search string
    s.replace(old, new, 1)                                       # the file is CRLF
    # -> zero replacements, file unchanged, suite runs GREEN

and a green suite after a "mutation" is indistinguishable from a rail that correctly survived
nothing at all. It is worse than a missing proof, because it is recorded as a passing one.

⭐ THE RULE THIS ENCODES: **a mutation asserts its own match count before it changes anything.**
Not afterwards, not by eyeballing a diff. If the search text does not appear exactly as many times
as the caller expects, nothing is written and the tool exits non-zero.

Two more traps it closes, both seen in this repo:

  · LINE ENDINGS. The search text is normalised to whatever the FILE uses, so a snippet copied
    from an editor (LF) matches a CRLF file. Files are read and written with newline='' so nothing
    is silently rewritten in passing — a bulk CRLF/LF flip would show up as a whole-file diff and
    look like the mutation.
  · THE REVERT. `--revert` is the inverse operation with the same match-count discipline, and
    `--verify-clean` proves the file hashes byte-identical to git HEAD afterwards. Reverting with
    `git checkout` is forbidden (feedback_mutation_check_never_git_checkout): it would also discard
    any real work in the file, and it hides whether the revert was exact.

Usage:
    python scripts/mutate.py apply  <file> --old-file OLD.txt --new-file NEW.txt [--count 1]
    python scripts/mutate.py revert <file> --old-file OLD.txt --new-file NEW.txt [--verify-clean]

`--old-file`/`--new-file` rather than inline arguments on purpose: the snippets are code, and
passing code through a shell argument is how quoting eats a backslash or a backtick.
"""
from __future__ import annotations

import argparse
import hashlib
import pathlib
import subprocess
import sys


def _read(path: pathlib.Path) -> str:
    # newline='' preserves the file's own endings; anything else rewrites the whole file.
    return path.open(encoding="utf-8", newline="").read()


def _write(path: pathlib.Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".mutate-tmp")
    tmp.open("w", encoding="utf-8", newline="").write(text)
    tmp.replace(path)


def _match_file_endings(needle: str, haystack: str) -> str:
    """Normalise `needle`'s line endings to whatever `haystack` uses."""
    nl = "\r\n" if "\r\n" in haystack else "\n"
    return needle.replace("\r\n", "\n").replace("\n", nl)


def _git_blob_of_head(path: pathlib.Path) -> str | None:
    try:
        root = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True,
                              text=True, encoding="utf-8", check=True).stdout.strip()
        rel = path.resolve().relative_to(pathlib.Path(root).resolve()).as_posix()
        out = subprocess.run(["git", "-C", root, "rev-parse", f"HEAD:{rel}"],
                             capture_output=True, text=True, encoding="utf-8")
        return out.stdout.strip() if out.returncode == 0 else None
    except Exception:
        return None


def _git_hash_object(path: pathlib.Path) -> str | None:
    try:
        out = subprocess.run(["git", "hash-object", str(path)], capture_output=True,
                             text=True, encoding="utf-8")
        return out.stdout.strip() if out.returncode == 0 else None
    except Exception:
        return None


def swap(path: pathlib.Path, frm: str, to: str, expect: int) -> int:
    src = _read(path)
    needle = _match_file_endings(frm, src)
    found = src.count(needle)
    if found != expect:
        nl = "CRLF" if "\r\n" in src else "LF"
        print(f"⛔ REFUSED: expected {expect} occurrence(s), found {found}. Nothing was written.\n"
              f"   file line endings: {nl} (the search text was normalised to match, so this is a\n"
              f"   REAL mismatch, not an escaping artefact). A mutation that does not apply is not\n"
              f"   a passing proof — it is an absent one, and it looks exactly like success.",
              file=sys.stderr)
        return 1
    _write(path, src.replace(needle, _match_file_endings(to, src), expect))
    print(f"  applied {expect} replacement(s) in {path.name} "
          f"(sha now {hashlib.sha1(_read(path).encode()).hexdigest()[:12]})")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("action", choices=["apply", "revert"])
    ap.add_argument("file")
    ap.add_argument("--old-file", required=True, help="path to a file holding the ORIGINAL snippet")
    ap.add_argument("--new-file", required=True, help="path to a file holding the MUTATED snippet")
    ap.add_argument("--count", type=int, default=1)
    ap.add_argument("--verify-clean", action="store_true",
                    help="after a revert, prove the file hashes byte-identical to git HEAD")
    a = ap.parse_args(argv)

    target = pathlib.Path(a.file)
    if not target.exists():
        print(f"⛔ no such file: {target}", file=sys.stderr)
        return 2
    original = _read(pathlib.Path(a.old_file))
    mutated = _read(pathlib.Path(a.new_file))
    if original == mutated:
        print("⛔ REFUSED: the original and mutated snippets are identical, so this mutation could "
              "never fail a rail.", file=sys.stderr)
        return 2

    frm, to = (original, mutated) if a.action == "apply" else (mutated, original)
    rc = swap(target, frm, to, a.count)
    if rc:
        return rc

    if a.action == "revert" and a.verify_clean:
        head, now = _git_blob_of_head(target), _git_hash_object(target)
        if head is None or now is None:
            print("  ⚠️ could not reach git to verify the revert — check by hand", file=sys.stderr)
            return 0
        if head != now:
            print(f"⛔ THE REVERT WAS NOT EXACT: HEAD {head[:12]} vs worktree {now[:12]}. The file "
                  f"still differs from the committed version.", file=sys.stderr)
            return 1
        print(f"  ✓ reverted exactly — hashes byte-identical to HEAD ({now[:12]})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
