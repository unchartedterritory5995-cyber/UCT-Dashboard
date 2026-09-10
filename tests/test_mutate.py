"""The rail for `scripts/mutate.py` — and the case that matters is the CRLF one.

⛔ This tool exists because a mutation proof that does not apply is indistinguishable from one that
applied and was correctly survived. So the load-bearing test here is not "it can replace text"; it
is **"it refuses, loudly, when the text is not there"** and **"a CRLF file does not silently defeat
an LF search string"** — the exact failure that produced three false-green runs on 2026-09-10.

Rule 14 applies: this tool shells out to git for `--verify-clean`, so the tests that depend on that
path assert it actually ran rather than trusting silence.
"""
from __future__ import annotations

import pathlib
import subprocess
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "scripts"))

import mutate  # noqa: E402


ORIGINAL = "const hint = open && ringName\n  ? ringName\n  : tapHint\n"
MUTATED = "const hint = open && ringName\n  ? tapHint\n  : tapHint\n"


def _snippets(tmp_path, original=ORIGINAL, mutated=MUTATED):
    o = tmp_path / "old.txt"
    n = tmp_path / "new.txt"
    o.open("w", encoding="utf-8", newline="").write(original)
    n.open("w", encoding="utf-8", newline="").write(mutated)
    return str(o), str(n)


def _target(tmp_path, text, newline):
    p = tmp_path / "HubChip.jsx"
    p.open("w", encoding="utf-8", newline="").write(text.replace("\n", newline))
    return p


def test_it_applies_to_an_LF_file(tmp_path):
    p = _target(tmp_path, f"before\n{ORIGINAL}after\n", "\n")
    o, n = _snippets(tmp_path)
    assert mutate.main(["apply", str(p), "--old-file", o, "--new-file", n]) == 0
    assert "? tapHint" in p.open(encoding="utf-8", newline="").read()


def test_THE_CRLF_CASE_an_LF_search_string_still_matches_a_CRLF_file(tmp_path):
    """⛔⛔ THE WHOLE REASON THIS TOOL EXISTS.

    The snippet is written with LF; the target uses CRLF. A plain `str.replace` finds nothing,
    changes nothing, and the caller's suite then runs GREEN over an unmutated file.
    """
    p = _target(tmp_path, f"before\n{ORIGINAL}after\n", "\r\n")
    o, n = _snippets(tmp_path)

    raw = p.open(encoding="utf-8", newline="").read()
    assert "\r\n" in raw, "fixture is not CRLF, so this test proves nothing"
    assert ORIGINAL not in raw, "the LF snippet must NOT match the CRLF file directly — that is the trap"

    assert mutate.main(["apply", str(p), "--old-file", o, "--new-file", n]) == 0
    after = p.open(encoding="utf-8", newline="").read()
    assert "? tapHint" in after
    # The file must still be CRLF throughout — a tool that "worked" by rewriting every line ending
    # would produce a whole-file diff and the mutation proof would be measuring the wrong change.
    assert "\r\n" in after, "the file's own line endings must survive the mutation"
    assert after.count("\n") == after.count("\r\n"), (
        "a bare LF appeared — the mutation rewrote line endings instead of matching them, which "
        "would make the diff look like the whole file changed")


def test_it_REFUSES_when_the_text_is_absent_and_changes_nothing(tmp_path):
    p = _target(tmp_path, "a file that does not contain the snippet at all\n", "\n")
    before = p.open(encoding="utf-8", newline="").read()
    o, n = _snippets(tmp_path)
    assert mutate.main(["apply", str(p), "--old-file", o, "--new-file", n]) == 1
    assert p.open(encoding="utf-8", newline="").read() == before, "a refused mutation wrote to the file"


def test_it_REFUSES_on_the_wrong_number_of_matches(tmp_path):
    # Two occurrences when the caller expects one: replacing "the" one is a coin toss, and the
    # rail's mutation would be ambiguous. Refuse rather than guess.
    p = _target(tmp_path, f"{ORIGINAL}\nmiddle\n{ORIGINAL}", "\n")
    o, n = _snippets(tmp_path)
    assert mutate.main(["apply", str(p), "--old-file", o, "--new-file", n, "--count", "1"]) == 1
    assert mutate.main(["apply", str(p), "--old-file", o, "--new-file", n, "--count", "2"]) == 0


def test_it_REFUSES_a_mutation_that_changes_nothing(tmp_path):
    """A no-op mutation could never fail a rail, so it is not a proof — it is a green light."""
    p = _target(tmp_path, f"{ORIGINAL}", "\n")
    o, n = _snippets(tmp_path, ORIGINAL, ORIGINAL)
    assert mutate.main(["apply", str(p), "--old-file", o, "--new-file", n]) == 2


def test_revert_restores_the_file_byte_for_byte(tmp_path):
    p = _target(tmp_path, f"before\n{ORIGINAL}after\n", "\r\n")
    before = p.open(encoding="utf-8", newline="").read()
    o, n = _snippets(tmp_path)
    assert mutate.main(["apply", str(p), "--old-file", o, "--new-file", n]) == 0
    assert p.open(encoding="utf-8", newline="").read() != before
    assert mutate.main(["revert", str(p), "--old-file", o, "--new-file", n]) == 0
    assert p.open(encoding="utf-8", newline="").read() == before, "revert was not byte-exact"


def test_verify_clean_actually_consults_git(tmp_path, monkeypatch):
    """⛔ RULE 14 — the tool shells out here, so prove the call HAPPENED.

    Without this, `--verify-clean` could silently take the 'could not reach git' branch forever and
    every revert would report success without checking anything.
    """
    calls = []

    def fake_head(path):
        calls.append("head")
        return "a" * 40

    def fake_now(path):
        calls.append("now")
        return "a" * 40

    monkeypatch.setattr(mutate, "_git_blob_of_head", fake_head)
    monkeypatch.setattr(mutate, "_git_hash_object", fake_now)

    p = _target(tmp_path, f"{ORIGINAL}", "\n")
    o, n = _snippets(tmp_path)
    mutate.main(["apply", str(p), "--old-file", o, "--new-file", n])
    rc = mutate.main(["revert", str(p), "--old-file", o, "--new-file", n, "--verify-clean"])
    assert rc == 0
    assert calls == ["head", "now"], f"git was not consulted: {calls}"


def test_verify_clean_FAILS_when_the_revert_was_not_exact(tmp_path, monkeypatch):
    monkeypatch.setattr(mutate, "_git_blob_of_head", lambda p: "a" * 40)
    monkeypatch.setattr(mutate, "_git_hash_object", lambda p: "b" * 40)
    p = _target(tmp_path, f"{ORIGINAL}", "\n")
    o, n = _snippets(tmp_path)
    mutate.main(["apply", str(p), "--old-file", o, "--new-file", n])
    assert mutate.main(["revert", str(p), "--old-file", o, "--new-file", n, "--verify-clean"]) == 1


def test_the_refusal_message_says_what_to_do(tmp_path, capsys):
    p = _target(tmp_path, "nothing matching here\n", "\n")
    o, n = _snippets(tmp_path)
    mutate.main(["apply", str(p), "--old-file", o, "--new-file", n])
    err = capsys.readouterr().err
    assert "REFUSED" in err
    assert "absent one" in err, "the message must say WHY a silent no-op is dangerous"
    assert "line endings" in err, "the message must name the most common cause"
