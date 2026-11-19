"""The flag ledger's line-ending invariant, stated ONCE for the rails that guard it.

`docs/feature_flags.json` is edited textually, row by row, by many sessions. Three ledger rails
(`test_rs_discord_post`, `test_registry_string_inputs`, `test_rs_split_rows`) asserted
"the file is CRLF; a bare LF means it was re-dumped", which was true of ONE checkout: this box
has `core.autocrlf=true`, so the working copy is CRLF. The COMMITTED blob is LF (git normalises
on add), so a Linux checkout, the remote lane and CI included, is LF on disk and all three rails
were red there on a file nobody had touched.

What the rails were protecting, said so it holds on every checkout:

1. THE WORKING COPY HAS ONE LINE ENDING. All CRLF (a Windows autocrlf checkout) or all LF (every
   other one), never mixed and never a lone CR. A file written partly by a different writer (a
   re-dump of some rows, a byte-level splice) is what mixed endings mean, on either OS.
2. THE INDEX BLOB IS LF. `git ls-files --eol` reports the index as `i/lf`: what a commit stores.
   `tests/test_no_cr_in_tracked_text_blobs.py` holds this repo-wide; it is restated here for the
   one file so a ledger rail names the ledger when it fails.

Never the working copy's ending ITSELF: that is a fact about the checkout, not about the file.
"""
from __future__ import annotations

import pathlib
import subprocess

REPO = pathlib.Path(__file__).resolve().parents[2]
LEDGER = REPO / "docs" / "feature_flags.json"


def line_ending_problems(raw: bytes, index_eol: str) -> list[str]:
    """Every way ``raw`` (the working-copy bytes) and ``index_eol`` (`git ls-files --eol`'s
    `i/...` column for the file) break the invariant. Empty means it holds."""
    out = []
    lf, crlf, cr = raw.count(b"\n"), raw.count(b"\r\n"), raw.count(b"\r")
    if cr != crlf:
        out.append(f"{cr - crlf} lone CR(s): a CR that does not end a CRLF")
    if crlf not in (0, lf):
        out.append(f"mixed line endings: {crlf} CRLF and {lf - crlf} bare LF; part of the file was "
                   "rewritten by a different writer (a re-dump or a byte-level splice)")
    if index_eol != "i/lf":
        out.append(f"the index blob is {index_eol!r}, not 'i/lf': a commit would store CR line endings")
    return out


def index_eol(path: pathlib.Path = LEDGER) -> str:
    """The `i/...` column `git ls-files --eol` prints for ``path`` (the bytes a commit stores)."""
    rel = path.resolve().relative_to(REPO).as_posix()
    out = subprocess.run(["git", "-C", str(REPO), "ls-files", "--eol", "--", rel],
                         capture_output=True, text=True, encoding="utf-8", errors="replace", check=True).stdout
    fields = out.split("\t", 1)[0].split()
    assert fields, f"git does not track {rel}"
    return fields[0]


def assert_ledger_line_endings(path: pathlib.Path = LEDGER) -> bytes:
    """Assert the invariant on the real ledger and hand back its bytes for the caller's own checks."""
    raw = path.read_bytes()
    problems = line_ending_problems(raw, index_eol(path))
    assert not problems, "docs/feature_flags.json line endings: " + "; ".join(problems)
    return raw
