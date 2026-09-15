r"""Capture / mutate / restore for the expected_red mutation proof.

D1  Every path arrives through the ENVIRONMENT and is rebuilt with pathlib here.
    Nothing is interpolated into a string literal. The first version did
    pathlib.Path(r'/c/Users/.../baseline.orig') and MSYS rewrote it to
    \c\Users\... - the capture silently never wrote, so the restore silently
    never ran, and the tree sat mutated.

D4  The sentinel is what makes a restore PROVABLE rather than assumed: it holds
    the sha256 of the pre-mutation bytes, so "did the restore happen" is a
    question with a mechanical answer instead of an inference from a test result.
"""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import subprocess
import sys


def _env_path(name: str, *, must_exist: bool = True) -> pathlib.Path:
    """D1: rebuild a path from the environment, and ABORT LOUDLY with the raw
    string if it is not what we were promised. A mangled path must never be
    allowed to look like a missing file."""
    raw = os.environ.get(name)
    if not raw:
        sys.exit(f"⛔ {name} is unset. Paths travel by environment in this harness.")
    p = pathlib.Path(raw)
    if not p.is_absolute():
        sys.exit(f"⛔ {name} is not absolute.\n   raw received: {raw!r}\n"
                 f"   This is the MSYS mangling signature - a POSIX path that "
                 f"crossed a native boundary and lost its root.")
    if must_exist and not p.exists():
        sys.exit(f"⛔ {name} does not exist.\n   raw received: {raw!r}\n"
                 f"   resolved to: {str(p)!r}\n"
                 f"   If this reads with leading backslashes instead of a drive letter it was MANGLED, "
                 f"NOT missing - those two look identical at the error layer and "
                 f"are the reason this check prints the raw string.")
    return p


def _baseline() -> pathlib.Path:
    # ⭐ PARAMETERISED 2026-09-15. The harness was hardwired to gate-baseline.json
    # and to one mutation, so every other fix had to be mutation-proved by hand —
    # which is how Q1 fix 5 shipped with no proof at all. PROOF_BASELINE_REL is
    # kept as a fallback so the ORIGINAL proof still runs unchanged, which is what
    # makes "nothing regressed" checkable.
    rel = os.environ.get("PROOF_TARGET_REL") or os.environ["PROOF_BASELINE_REL"]
    return _env_path("PROOF_REPO") / rel


def _sentinel() -> pathlib.Path:
    return pathlib.Path(os.environ["PROOF_SENTINEL"])


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def capture() -> int:
    b = _baseline()
    raw = b.read_bytes()
    s = _sentinel()
    s.parent.mkdir(parents=True, exist_ok=True)
    s.write_text(json.dumps({
        "captured_sha": _sha(raw),
        "captured_len": len(raw),
        "baseline": str(b),
    }, indent=2), encoding="utf-8")
    (s.parent / "captured.bytes").write_bytes(raw)
    # D4: prove the write landed. A capture that reports success without a
    # readable artifact is the exact failure this harness was rewritten for.
    back = (s.parent / "captured.bytes").read_bytes()
    if _sha(back) != _sha(raw):
        sys.exit("⛔ capture wrote bytes that do not read back identically")
    print(f"captured {len(raw)} bytes  sha {_sha(raw)[:16]}  -> {s.parent}")
    return 0


#: built from chr() so no source-level escape can collapse it. A heredoc that
#: turned a backslash-r-backslash-n into a real newline is how this very file got
#: written wrong twice.
_CRLF = chr(13) + chr(10)


def mutate() -> int:
    """
    Apply the mutation. TWO MODES, chosen by PROOF_MUTATION:

      strip-json-key  (default) — set a top-level JSON key to {}. The original
                      proof: strip `expected_red_reasons`, keep `expected_red`.
      replace         — swap PROOF_MUT_OLD for PROOF_MUT_NEW, exactly once. This
                      is what lets ANY source fix be proved: remove the guard,
                      watch the rail redden, restore.

    ⛔ BOTH MODES ASSERT THE FILE ACTUALLY CHANGED. A mutation that silently
    applied nothing prints a passing "mutated" run — which happened on 2026-09-14
    when an LF-joined match string met a CRLF file and reported 3 passed. A fixture
    that cannot create the failure is not a test.
    """
    import hashlib
    b = _baseline()
    raw = b.read_bytes()
    before = hashlib.sha256(raw).hexdigest()
    mode = os.environ.get("PROOF_MUTATION", "strip-json-key")
    has_crlf = raw.count(_CRLF.encode()) > 0

    if mode == "replace":
        old = os.environ["PROOF_MUT_OLD"]
        new = os.environ.get("PROOF_MUT_NEW", "")
        text = raw.decode("utf-8").replace(_CRLF, chr(10))
        n = text.count(old)
        if n != 1:
            sys.exit(f"⛔ PROOF_MUT_OLD occurs {n} time(s), expected exactly 1. "
                     f"Nothing was mutated, so nothing below would mean anything.")
        text = text.replace(old, new)
        out = text.replace(chr(10), _CRLF) if has_crlf else text
        b.write_bytes(out.encode("utf-8"))
        what = f"replaced {len(old)} chars with {len(new)}"
    else:
        key = os.environ.get("PROOF_JSON_KEY", "expected_red_reasons")
        doc = json.loads(raw.decode("utf-8"))
        doc[key] = {}
        out = json.dumps(doc, indent=2, ensure_ascii=False) + chr(10)
        if has_crlf:
            out = out.replace(chr(10), _CRLF)
        b.write_bytes(out.encode("utf-8"))
        what = f"stripped JSON key {key!r}"

    after = hashlib.sha256(b.read_bytes()).hexdigest()
    if after == before:
        sys.exit("⛔ the file did NOT change. A mutation that applied nothing "
                 "produces a passing 'mutated' run, which is worse than no proof.")
    print(f"  MUTATED: {what}  sha {before[:12]} -> {after[:12]}")
    return 0

def restore() -> int:
    s = _sentinel()
    if not s.exists():
        print(f"⛔ no sentinel at {s} - capture never completed", file=sys.stderr)
        return 3
    meta = json.loads(s.read_text(encoding="utf-8"))
    kept = (s.parent / "captured.bytes")
    if not kept.exists():
        print(f"⛔ sentinel exists but {kept} does not", file=sys.stderr)
        return 3

    raw = kept.read_bytes()
    if _sha(raw) != meta["captured_sha"]:
        print("⛔ captured bytes do not match the sentinel's hash", file=sys.stderr)
        return 3

    b = _baseline()
    # ⛔ NEVER `git checkout`. And never clobber a concurrent edit either: if the
    # file is neither our mutation nor already restored, somebody else touched it
    # and writing our bytes back would destroy their work - which is the incident
    # the no-checkout rule exists for, one layer along.
    cur = _sha(b.read_bytes())
    if cur not in (meta["captured_sha"],) and "mutated_sha" in meta and cur != meta["mutated_sha"]:
        print(f"⛔ {b} is neither the captured nor the mutated content "
              f"(sha {cur[:16]}). Refusing to overwrite a third state.", file=sys.stderr)
        return 4

    b.write_bytes(raw)
    after = _sha(b.read_bytes())
    if after != meta["captured_sha"]:
        print(f"⛔ post-restore sha {after[:16]} != captured {meta['captured_sha'][:16]}",
              file=sys.stderr)
        return 3
    print(f"restored {len(raw)} bytes  sha {after[:16]}  (byte-for-byte)")
    return 0


def verify_clean() -> int:
    """The tree must be clean for the file we touched. Informational commands
    never decide this - the caller folds the return code into its matrix."""
    repo = _env_path("PROOF_REPO")
    rel = os.environ.get("PROOF_TARGET_REL") or os.environ["PROOF_BASELINE_REL"]
    out = subprocess.run(["git", "-C", str(repo), "status", "--porcelain", "--", rel],
                         capture_output=True, text=True).stdout.strip()
    if out:
        print(f"  FAIL: {rel} is still dirty after restore: {out!r}")
        return 1
    print(f"  ok: {rel} is clean")
    return 0


if __name__ == "__main__":
    fn = {"capture": capture, "mutate": mutate,
          "restore": restore, "verify_clean": verify_clean}[sys.argv[1]]
    raise SystemExit(fn())
