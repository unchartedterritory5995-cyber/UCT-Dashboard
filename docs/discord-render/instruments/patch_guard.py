"""D-02b Part 3 — the rail that makes the heredoc corruption the LAST one.

⚰️ FOUR OCCURRENCES, AND THE FOURTH HAPPENED WITH THE RULE ALREADY WRITTEN DOWN THREE TIMES.

| # | date | what collapsed | how it showed up |
|---|---|---|---|
| 1 | 2026-08-24 | `\\b` in a fund-detector regex → a literal **BACKSPACE** (0x08) | the pattern matched nothing; `sed` printed it as though the `\\b`s were merely missing |
| 2 | 2026-08-29 | `\\n` in two prompt strings → a REAL newline | the string literal split across two lines; the file stopped parsing |
| 3 | 2026-08-31 | four in one session, incl. `"\\n".join(...)` | an unterminated JS string literal |
| 4 | 2026-09-14 | `\\b` in the smoke-title regex → two **BACKSPACE** bytes | `^#\\s.*<BS>3\\.5<BS>.*smoke` matched nothing — a gate row would have read NOT MEASURABLE beside a completed test run |

⛔⛔ **WHY THE EXISTING HABIT DID NOT CATCH THE FOURTH, AND THIS IS THE WHOLE POINT OF THIS MODULE.**
The habit those incidents produced was:

    assert text.count(old) == 1        # BEFORE open(p, "w")

**That assert protects the SEARCH string. It says nothing whatever about the REPLACEMENT.** On
2026-09-14 the anchor matched, the assert passed, and a corrupted `new` went to disk perfectly. The
*second* attempt to repair it aborted only because that assert happened to be about the
already-corrupted text — luck, not a rail.

⭐ **So this module checks THREE things the old habit checked none of:**

1. **Both strings are scanned for the collapse signature** — the control bytes that a swallowed
   `\\b` / `\\f` / `\\a` / `\\v` becomes. Refused BEFORE any write.
2. **The replacement is round-tripped.** After the write, the file is re-read and the exact slice
   where `new` was spliced is sha256'd against `sha256(new)`. Bytes intended == bytes written, or
   the original is restored and the call raises. A writer that mangles cannot succeed quietly.
3. **The original bytes are restored on ANY failure** — verified by sha256, never by `git checkout`
   (`feedback_mutation_check_never_git_checkout`, which has two incidents behind it).

⛔ **AND THE REAL FIX IS STRUCTURAL: there is no shell on this path.** `safe_replace` takes Python
strings from a Python process and writes bytes with `os.replace`. Nothing is interpolated into a
shell, so nothing can be collapsed by one. `heredoc_safe()` exists only to judge text that is ABOUT
to be sent through a shell anyway, and it refuses the three characters that have actually cost this
programme time: a backslash, an apostrophe, and a `$`.
"""
from __future__ import annotations

import hashlib
import os
import pathlib
import tempfile

#: The signature of a swallowed escape. Each is what the named escape becomes when a shell layer
#: eats one level of backslash and a non-raw string literal then interprets what is left.
COLLAPSE_BYTES = {
    "\x08": r"backspace — a collapsed \b",
    "\x0c": r"form feed — a collapsed \f",
    "\x07": r"bell — a collapsed \a",
    "\x0b": r"vertical tab — a collapsed \v",
    "\x1b": r"escape — a collapsed \e",
}

#: Characters that have actually broken a heredoc in this repository. ⛔ The apostrophe is on this
#: list because English PROSE has apostrophes and this is a docstring-heavy codebase — the 2026-09-07
#: and 2026-09-14 failures were both ordinary sentences, not code.
HEREDOC_HAZARDS = {"\\": "a backslash (escape collapse)",
                   "'": "an apostrophe (kills even a quoted delimiter in this harness)",
                   "$": "a dollar sign (parameter expansion)",
                   "`": "a backtick (command substitution)"}


class PatchRefused(RuntimeError):
    """Raised BEFORE a write when the text carries a corruption signature."""


class RoundTripFailed(RuntimeError):
    """Raised AFTER a write when the bytes on disk are not the bytes intended. Original restored."""


def scan_collapse(text: str, *, label: str) -> list[str]:
    """Every collapse signature in `text`, named and located. Empty list = clean."""
    found = []
    for i, ch in enumerate(text):
        if ch in COLLAPSE_BYTES:
            line = text.count("\n", 0, i) + 1
            found.append(f"{label}: {COLLAPSE_BYTES[ch]} at line {line}, offset {i}")
    return found


def heredoc_safe(text: str) -> tuple[bool, str]:
    """Would this text survive a shell heredoc? ⛔ Judged by CONTENT, never by the delimiter.

    A quoted delimiter (`<<'EOF'`) is supposed to make this unnecessary and twice did not."""
    hits = [why for ch, why in HEREDOC_HAZARDS.items() if ch in text]
    if hits:
        return False, ("do not send this through a heredoc — it contains " + ", ".join(sorted(hits))
                       + ". Write it with the editing tool and splice by bytes instead.")
    return True, ""


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _write_bytes(path: pathlib.Path, data: bytes) -> None:
    """Temp file then `os.replace`. ⛔ Never `open(path, "w")`: that truncates before your write can
    fail, and a failure halfway through leaves the file destroyed rather than unchanged."""
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".patchtmp")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
    except BaseException:
        pathlib.Path(tmp).unlink(missing_ok=True)
        raise


def safe_replace(path, old: str, new: str, *, expect: int = 1, whole_line: bool = False,
                 _writer=None) -> dict:
    """Replace `old` with `new` in `path`, refusing corruption before the write and proving the
    replacement survived it.

    `whole_line=True` matches lines that ARE `old` rather than lines that CONTAIN it.
    ⛔ Substring counting cannot see indentation: `"    if x:"` occurs inside `"        if x:"`, which
    reported three matches for a line appearing once — loud in that direction, and in the other it
    silently patches the wrong branch.

    `_writer` is the injection point the self-check uses to prove the round-trip check can FAIL. A
    guard nobody has seen fire is not a guard.
    """
    p = pathlib.Path(path)
    problems = scan_collapse(old, label="SEARCH string") + scan_collapse(new, label="REPLACEMENT")
    if problems:
        raise PatchRefused(
            "refusing to write: " + "; ".join(problems)
            + ". This is the escape-collapse signature — the text was almost certainly built in a "
              "shell heredoc. Build it with chr(92) or write it with the editing tool.")

    before = p.read_bytes()
    text = before.decode("utf-8")

    if whole_line:
        lines = text.split("\n")
        hits = [i for i, l in enumerate(lines) if l.rstrip() == old]
        n = len(hits)
    else:
        n = text.count(old)
    if n != expect:
        raise PatchRefused(f"{p.name}: anchor matched {n} time(s), expected {expect}")

    if whole_line:
        lines[hits[0]] = new
        out_text = "\n".join(lines)
        offset = len("\n".join(lines[:hits[0]])) + (1 if hits[0] else 0)
    else:
        offset = text.index(old)
        out_text = text[:offset] + new + text[offset + len(old):]

    data = out_text.encode("utf-8")
    (_writer or _write_bytes)(p, data)

    # ── THE HALF THE OLD HABIT DID NOT HAVE ────────────────────────────────
    # Read the file back and sha256 the EXACT slice the replacement occupies. `new` may be shorter
    # or longer than `old`, so the slice is located by byte offset, not by searching for `new` —
    # searching for it would find a corrupted copy nowhere and report "missing" rather than
    # "mangled", which are different faults.
    written = p.read_bytes()
    head = out_text[:offset].encode("utf-8")
    slice_bytes = written[len(head):len(head) + len(new.encode("utf-8"))]
    want, got = _sha(new.encode("utf-8")), _sha(slice_bytes)
    if want != got:
        _write_bytes(p, before)
        assert _sha(p.read_bytes()) == _sha(before), "RESTORE FAILED — the original is not back"
        raise RoundTripFailed(
            f"{p.name}: the replacement did not survive the write. intended sha256 {want[:16]}, "
            f"on disk {got[:16]}. Original restored ({_sha(before)[:16]}).")
    return {"path": str(p), "sha256_before": _sha(before), "sha256_after": _sha(written),
            "replacement_sha256": want, "offset": offset, "matched": n}


def self_check(out=print) -> int:
    """⛔ Every historical corruption, replayed, and the rail must REFUSE each one."""
    import sys
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    from selfcheck import Cases
    cases = Cases("patch_guard")

    tmpdir = pathlib.Path(tempfile.mkdtemp(prefix="patchguard-"))
    BS = chr(92)

    def fresh(body="alpha\nbeta\ngamma\n"):
        f = tmpdir / f"t{len(list(tmpdir.iterdir()))}.txt"
        f.write_bytes(body.encode("utf-8"))
        return f

    # ── occurrence 1 & 4 replayed: a collapsed \b in the REPLACEMENT ───────
    f = fresh()
    try:
        safe_replace(f, "beta", "re.compile(r'^#" + BS + "s.*\x083" + BS + ".5\x08.*smoke')")
        cases.add("a collapsed \\b in the REPLACEMENT is REFUSED", False)
    except PatchRefused as e:
        cases.add("a collapsed \\b in the REPLACEMENT is REFUSED", "backspace" in str(e))
    cases.add("...and nothing was written (the file is untouched)",
              f.read_bytes() == b"alpha\nbeta\ngamma\n")

    # ── the same byte in the SEARCH string — the half that aborts by luck ──
    f2 = fresh()
    try:
        safe_replace(f2, "be\x08ta", "x")
        cases.add("a collapsed \\b in the SEARCH string is REFUSED too", False)
    except PatchRefused as e:
        cases.add("a collapsed \\b in the SEARCH string is REFUSED too", "SEARCH" in str(e))

    # ── occurrence 3 replayed: a collapsed \f ──────────────────────────────
    f3 = fresh()
    try:
        safe_replace(f3, "beta", "print('a\x0cb')")
        cases.add("a collapsed \\f is REFUSED", False)
    except PatchRefused:
        cases.add("a collapsed \\f is REFUSED", True)

    # ⛔ NON-VACUITY — the guard must still be able to WRITE, or "it refuses" is a function that
    # always raises and no patch would ever land.
    f4 = fresh()
    res = safe_replace(f4, "beta", "BETA")
    cases.add("a clean replacement is accepted (non-vacuity)",
              f4.read_text(encoding="utf-8") == "alpha\nBETA\ngamma\n")
    cases.add("the receipt carries sha256 before, after and of the replacement",
              len(res["sha256_before"]) == 64 and len(res["replacement_sha256"]) == 64
              and res["sha256_before"] != res["sha256_after"])

    # ⛔⛔ THE ROUND-TRIP CHECK ITSELF MUST BE ABLE TO FIRE. A corrupting writer is injected; the
    # call must raise AND put the original back.
    f5 = fresh()
    original = f5.read_bytes()

    def _mangling_writer(path, data):
        _write_bytes(path, data.replace(b"BETA", b"BE_A"))

    try:
        safe_replace(f5, "beta", "BETA", _writer=_mangling_writer)
        cases.add("a writer that MANGLES the replacement is caught by the round trip", False)
    except RoundTripFailed as e:
        cases.add("a writer that MANGLES the replacement is caught by the round trip",
                  "did not survive" in str(e))
    cases.add("...and the original bytes are restored, sha256-verified",
              f5.read_bytes() == original)

    # ── whole-line anchoring, the indentation trap ─────────────────────────
    f6 = fresh("    if x:\n        if x:\n")
    try:
        safe_replace(f6, "    if x:", "    if y:")
        cases.add("substring anchoring sees the indentation trap", False)
    except PatchRefused as e:
        cases.add("substring anchoring sees the indentation trap", "matched 2" in str(e))
    res6 = safe_replace(f6, "    if x:", "    if y:", whole_line=True)
    cases.add("whole-line anchoring patches only the line that IS the anchor",
              f6.read_text(encoding="utf-8") == "    if y:\n        if x:\n" and res6["matched"] == 1)

    # ── heredoc_safe: judged by content, and it must say yes to something ──
    cases.add("a backslash is refused for a heredoc", heredoc_safe("a " + BS + "n b")[0] is False)
    cases.add("an apostrophe is refused for a heredoc", heredoc_safe("SQLite's rows")[0] is False)
    cases.add("a $ is refused for a heredoc", heredoc_safe("cost $5")[0] is False)
    cases.add("a backtick is refused for a heredoc", heredoc_safe("run `ls`")[0] is False)
    cases.add("plain prose is allowed (non-vacuity)", heredoc_safe("a plain sentence.")[0] is True)

    for q in tmpdir.iterdir():
        q.unlink()
    tmpdir.rmdir()
    return 0 if cases.report(out) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(self_check())
