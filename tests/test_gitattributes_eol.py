"""SD-1 S1 — the `-text` entries that stop a stored-CRLF blob being flattened.

⛔ THE LIST IN `.gitattributes` IS DERIVED, AND THIS FILE IS WHAT KEEPS IT DERIVED.
A hand-maintained list of paths beside the thing it describes is the drift this repo
has paid for repeatedly. `test_the_declared_list_is_still_the_derived_list` re-runs the
derivation and fails by name when a new qualifying path appears, so the comment in
`.gitattributes` can never quietly become fiction.

The hazard is NOT corruption. A blob stored with CRLF checks out as CRLF either way.
It is that any tool rewriting such a file as LF flattens the stored endings, and a
two-line edit then returns as a whole-file diff and stops being reviewable — measured
twice under rule R-2.
"""
from __future__ import annotations

import pathlib
import subprocess

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]


def git(*args, binary=False):
    p = subprocess.run(["git", "-C", str(REPO), *args], capture_output=True)
    if p.returncode != 0:
        return None
    return p.stdout if binary else p.stdout.decode("utf-8", "replace")


def check_attr(paths: list[str], attr: str = "text") -> dict:
    """One batched `check-attr`, not one process per path."""
    if not paths:
        return {}
    p = subprocess.run(["git", "-C", str(REPO), "check-attr", "--stdin", "-z", attr],
                       input="\0".join(paths).encode(), capture_output=True)
    f = p.stdout.decode("utf-8", "replace").split("\0")
    return {f[i]: f[i + 2] for i in range(0, len(f) - 2, 3)}


def derive() -> list[str]:
    """Every tracked path whose INDEX blob carries a CR, has no NUL, and is text.

    ⛔ `--cached`. The working tree is not evidence: `core.autocrlf=true` has already
    put CRLF on everything there, so a working-tree scan reports the whole repo.
    """
    # one path per LINE (a path may hold a space; whitespace splitting cut it into fragments)
    cr = (git("grep", "--cached", "-l", "-P", r"\r") or "").splitlines()
    nul = set((git("grep", "--cached", "-l", "-P", r"\x00") or "").splitlines())
    return sorted(c for c in cr if c not in nul)


def declared() -> list[str]:
    """The paths `.gitattributes` marks `-text`, read off the file itself."""
    out = []
    for line in (REPO / ".gitattributes").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) >= 2 and "-text" in parts[1:]:
            out.append(parts[0])
    return sorted(out)


# ─────────────────────────────────────────────────────────────────────────────
# The non-vacuity control comes FIRST: every assertion below is over a set the
# derivation produced, and an empty set satisfies almost anything.
# ─────────────────────────────────────────────────────────────────────────────

def test_the_derivation_actually_finds_files():
    found = derive()
    assert found, ("the derivation returned NOTHING — that is a broken query, not a "
                   "clean repo. This box has core.autocrlf=true and blobs stored with CR.")
    assert len(found) < 200, (f"{len(found)} paths is the whole repo — the scan is "
                              "reading the working tree instead of the index.")


def test_git_grep_cached_and_working_tree_disagree_which_is_the_whole_point():
    """⛔ The control for `--cached`. If these two ever returned the same set, the
    scan would be reading the wrong thing and nobody would notice."""
    # ⚰️ 2026-11-20 -- this compared EVERY file with a CR byte, and `git grep -l` lists binary files too (an image
    # carries 0x0D anywhere). By November thousands of committed binaries did, in the index and the working tree
    # alike, so the ratio stopped meaning anything (this box: index 10,506, worktree 18,486, not > 2x), and on a
    # Linux runner, where nothing converts, it could never hold (10,506 vs 10,507). The question is about TEXT,
    # so both sides drop the files with a NUL, which is how `derive` already reads the index. Lines, not
    # whitespace: a path with a space was being split into fragments.
    def text_with_cr(*where):
        cr = set((git("grep", *where, "-l", "-P", r"\r") or "").splitlines())
        nul = set((git("grep", *where, "-l", "-P", r"\x00") or "").splitlines())
        return cr - nul

    cached, worktree = text_with_cr("--cached"), text_with_cr()
    assert cached, "CONTROL: no text blob in the index carries a CR -- the query is broken, not the repo"
    if (git("config", "--get", "core.autocrlf") or "").strip().lower() == "true":
        assert len(worktree) > len(cached) * 2, (
            "with core.autocrlf=true the working tree should carry CRLF on far more text files than the index "
            f"does (index {len(cached)}, worktree {len(worktree)})")
    else:
        # nothing converts on this box, so the working tree cannot tell the two readings apart; what MUST still
        # hold is that every CR-bearing text blob checks out with its CR (the `-text` entries keep it)
        assert cached <= worktree, (
            f"index text blobs with CR that the working tree lost: {sorted(cached - worktree)[:10]}")


def test_every_derived_path_is_declared_text_unset():
    missing = {p: a for p, a in check_attr(derive()).items() if a != "unset"}
    assert not missing, (
        "these blobs are stored with CR and nothing protects them:\n  "
        + "\n  ".join(f"{p} (text={a})" for p, a in sorted(missing.items())))


def test_the_declared_list_is_still_the_derived_list():
    """⛔ Both directions. A path that qualifies and is missing is the hole this
    exists to close; a declared path that no longer qualifies is a stale entry
    claiming protection nothing needs."""
    d, dec = set(derive()), set(declared())
    # Entries for paths that are binary-by-extension live elsewhere in the file and
    # are not part of this list, so compare only against what the derivation covers.
    unprotected = d - dec
    assert not unprotected, f"newly qualifying, undeclared: {sorted(unprotected)}"
    stale = {p for p in dec - d if (REPO / p).exists()}
    assert not stale, (f"declared -text but no longer carries a CR in the index: "
                       f"{sorted(stale)} — remove the entry or explain why it stays")


def test_the_stored_bytes_and_the_working_bytes_agree_for_every_declared_path():
    """The round trip S1 asks for: with `-text`, what is on disk IS the blob."""
    mismatched = []
    for p in derive():
        blob = git("show", f":{p}", binary=True)
        disk = (REPO / p).read_bytes() if (REPO / p).exists() else None
        if blob is None or disk is None or blob != disk:
            mismatched.append(p)
    assert not mismatched, (
        "with `-text` the checked-out bytes must equal the stored blob exactly; "
        f"these differ: {mismatched}")


def test_a_path_outside_the_list_is_not_silently_protected():
    """⛔ Non-vacuity in the other direction: if everything came back `unset`, the
    rails above would pass no matter what `.gitattributes` said.

    ⚠️ It uses a file this repo is guaranteed to have. The first version reached for
    `README.md`, which does not exist here — so it SKIPPED, and a skipped control is
    not a control (`lesson_a_rails_important_half_can_be_opt_in`).
    """
    ordinary = "CLAUDE.md"
    assert (REPO / ordinary).exists(), f"{ordinary} must exist for this control to run"
    assert check_attr([ordinary]).get(ordinary) == "unspecified", (
        f"{ordinary} should carry no text attribute — if it does, the entries have "
        "over-matched and this rail can no longer tell protected from unprotected")


def test_control_bytes_are_a_different_hazard_and_are_deliberately_not_listed():
    """⛔ THE TWO HAZARDS ARE NOT THE SAME ONE, AND CONFLATING THEM IS WHY THIS EXISTS.

    Two tracked files carry deliberate C0 control bytes (0x01-0x03 and 0x1B) with no
    attribute. They are NOT in the `-text` list, on purpose: eol conversion rewrites
    CR and LF and nothing else, so it cannot touch 0x01 or 0x1B. Marking them would be
    protection against a mechanism that does not reach them.

    This rail asserts the distinction holds — if one of those files ever ALSO gets a
    CR in its blob, the derivation above picks it up and the list grows for the right
    reason rather than by association.
    """
    cr = set((git("grep", "--cached", "-l", "-P", r"\r") or "").split())
    ctl = set((git("grep", "--cached", "-l", "-P", r"[\x01-\x08\x0B\x0E-\x1F]") or "").split())
    nul = set((git("grep", "--cached", "-l", "-P", r"\x00") or "").split())
    ctl_text_only = ctl - nul - cr
    assert ctl_text_only, ("no text file carries a bare control byte — the premise of "
                           "this rail has changed; re-read it before deleting it")
    for p in ctl_text_only:
        assert check_attr([p]).get(p) == "unspecified", (
            f"{p} carries control bytes but no CR, so it needs no eol protection; "
            "if it has been given an attribute, say why in .gitattributes")


def test_the_entries_use_minus_text_and_never_binary():
    """`binary` also suppresses diffs. `docs/plans/joystick/deferred.md` is a document
    people review, and making it undiffable would be a worse cure than the disease."""
    text = (REPO / ".gitattributes").read_text(encoding="utf-8")
    block = text.split("BLOBS ALREADY STORED WITH CR", 1)
    assert len(block) == 2, "the S1 block is missing from .gitattributes"
    # ⚰️ 2026-11-20: this read to the END OF THE FILE, so `tests/fixtures/minute_frames/*.bin binary` (#2157, a
    # later section that must stay BELOW `tests/fixtures/** text eol=lf`) failed it. The S1 block ends at its first
    # blank line; the sections after it have their own reasons and are not this rail's.
    s1 = block[1].split("\n\n", 1)[0]
    assert sum(1 for l in s1.splitlines() if l.strip().endswith(" -text")) >= 10, (
        "CONTROL: the S1 block read here lost its entries -- the blank-line boundary moved")
    for line in s1.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        assert "binary" not in line.split(), (
            f"the S1 block must use -text, never binary: {line!r}")
