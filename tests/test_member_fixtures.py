"""⭐⭐⭐ THE MEMBER'S OWN SCRIPTS, AND THE RAIL THAT KEEPS THEM HONEST.

`tests/fixtures/member/` holds two scripts their author (AtTheAsk) wrote and sent
us. They were attached to a conversation twice and lost twice — an attachment
lives in a transcript and a transcript gets compacted — so they are on disk now,
and every "line N" reference in this project resolves against these files.

⛔ THE MANIFEST IS THE POINT, NOT THE FILES. A fixture nobody hashes can be
silently edited, or silently REPLACED by a later revision of the same script, and
both look identical in a diff review that nobody runs. `manifest.json` records
two hashes per script and this file recomputes them.

⭐⭐ TWO HASHES, BECAUSE THEY ANSWER DIFFERENT QUESTIONS.
  * `body_sha256` covers the script AS ITS AUTHOR WROTE IT — the file minus the
    MPL-2.0 block this project appends. It answers *"is this the same revision
    the owner sent?"* and does not move when we edit our own footer.
  * `file_sha256` covers the whole file. It answers *"has anything on disk
    changed at all?"*.
One hash could not tell a re-attached revision from a footer tweak, and those are
very different events — the first invalidates every line number in the linemaps,
the second invalidates nothing.
"""

import hashlib
import io
import json
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MEMBER = ROOT / "tests" / "fixtures" / "member"
MANIFEST = MEMBER / "manifest.json"


def _text(path, row):
    """The fixture's content, with line endings normalised unless they ARE the subject.

    ⭐⭐ LINE ENDINGS ARE NORMALISED BEFORE HASHING, AND THAT IS A CORRECTNESS FIX
    RATHER THAN A CONVENIENCE. On 2026-09-11 this rail fired on a checkout whose
    working copy was CRLF against LF blobs: 34,950 bytes on disk vs 34,342 stored,
    exactly its 608 CRLFs. Nothing had changed. The alarm said the author's script
    had, and its remedy said to re-record — which would have baked one machine's
    line endings into a manifest every other checkout then fails.

    ⛔ A HASH OVER RAW BYTES MEASURES THE CHECKOUT FILTER AS WELL AS THE CONTENT,
    and only one of those is the subject. `.gitattributes` now pins these paths to
    LF, which fixes it for THIS repo on THIS machine; normalising here fixes it for
    any checkout, which is what a rail should do.

    ⚠️ A FIXTURE WHOSE SUBJECT *IS* LINE ENDINGS OPTS OUT with
    `"crlf_subject": true` in its manifest row — for those, the raw bytes are the
    content and normalising would erase the thing under test.
    """
    raw = io.open(path, "rb").read().decode("utf-8")
    return raw if row.get("crlf_subject") else raw.replace("\r\n", "\n")


def _manifest():
    return json.loads(io.open(MANIFEST, encoding="utf-8").read())


def _rows():
    return _manifest()["scripts"]


def test_the_manifest_describes_every_script_that_is_actually_there():
    """⛔ BOTH DIRECTIONS. A script with no manifest row is unhashed and therefore
    unprotected; a row with no script is a reference that resolves to nothing."""
    on_disk = sorted(p.name for p in MEMBER.glob("*.pine"))
    described = sorted(pathlib.Path(r["path"]).name for r in _rows())
    assert on_disk, "no member scripts on disk — the fixture directory is empty"
    assert on_disk == described, (
        f"on disk {on_disk} but the manifest describes {described}")


@pytest.mark.parametrize("row", _rows(), ids=lambda r: pathlib.Path(r["path"]).name)
def test_the_file_on_disk_matches_BOTH_recorded_hashes(row):
    """⛔⛔ THE WHOLE POINT OF THE DIRECTORY.

    A drift in `file_sha256` alone means somebody edited our footer — annoying,
    harmless, fix the manifest. A drift in `body_sha256` means THE SCRIPT
    CHANGED, and every line number in `docs/pine/linemap-*.md`, every "line 259"
    in an instruction and every capability claim derived from it is now about a
    different file. The two failures read differently on purpose.
    """
    path = ROOT / row["path"]
    whole = _text(path, row)
    assert hashlib.sha256(whole.encode("utf-8")).hexdigest() == row["file_sha256"], (
        f"{row['path']}: the FILE changed — and line endings are NOT the cause, "
        "they are normalised to LF before this hash unless the row says "
        "`crlf_subject`. If only the appended licence block was edited, re-record "
        "`file_sha256`. If the script body moved, the body hash below will fail too "
        "and that is the serious one.")

    body = "".join(whole.splitlines(keepends=True)[: row["body_lines"]])
    assert hashlib.sha256(body.encode("utf-8")).hexdigest() == row["body_sha256"], (
        f"🔴 {row['path']}: THE AUTHOR'S SCRIPT CHANGED. Either a different "
        "revision was dropped in, or the body was edited. Every 'line N' "
        "reference in this project now points at a different statement — rebuild "
        "the linemaps and re-verify the request.security line before trusting "
        "anything derived from this file.")


@pytest.mark.parametrize("row", _rows(), ids=lambda r: pathlib.Path(r["path"]).name)
def test_the_version_directive_is_STILL_the_first_line(row):
    """⛔ PINE'S `//@version=` IS POSITIONAL, which is the entire reason the licence
    block is appended rather than prepended. If somebody 'tidies' it to the top,
    TradingView reads the script as an older dialect and the fixture stops
    round-tripping — silently, because it still parses.
    """
    first = io.open(ROOT / row["path"], encoding="utf-8").readline().strip()
    assert first == f"//@version={row['pine_version']}", (
        f"{row['path']}: line 1 is {first!r}. The version directive must stay "
        "first; put anything of ours AFTER the body.")


@pytest.mark.parametrize("row", _rows(), ids=lambda r: pathlib.Path(r["path"]).name)
def test_the_licence_is_present_and_lives_BELOW_the_authors_last_line(row):
    """⭐ Attribution is a requirement, and so is not moving the line numbers."""
    lines = io.open(ROOT / row["path"], encoding="utf-8").read().splitlines()
    tail = "\n".join(lines[row["body_lines"]:])
    assert "SPDX-License-Identifier: MPL-2.0" in tail, (
        f"{row['path']}: no MPL-2.0 identifier after the body")
    assert row["author"].split(" (")[0] in tail, (
        f"{row['path']}: the licence block does not name the author")
    head = "\n".join(lines[: row["body_lines"]])
    assert "SPDX-License-Identifier" not in head, (
        f"{row['path']}: the licence moved INTO the body — every line number "
        "below it has shifted and the linemaps are now wrong")


def test_the_tuple_request_security_IS_where_the_project_says_it_is():
    """⛔⛔ THE ONE LINE NUMBER THIS PROJECT HARD-CODES, PINNED.

    The owner's instruction, the tuple-`request.security` work and the Volume
    linemap all refer to *line 259*. That is a reference into a file, and a
    reference into a file that nobody checks is how a whole piece of work ends up
    describing the wrong statement. ⚠️ It is deliberately not derived by
    searching for `request.security` — a search would silently follow the call if
    it moved, which is exactly the drift this asserts against.
    """
    path = ROOT / "tests/fixtures/member/uncharted-volume.pine"
    line = io.open(path, encoding="utf-8").read().splitlines()[258]  # 1-based 259
    assert "request.security(" in line, (
        f"line 259 is no longer the request.security call — it reads: {line.strip()!r}")
    assert line.count(",") >= 3 and line.strip().startswith("["), (
        "line 259 is a request.security call but no longer the TUPLE form the "
        f"tuple work is scoped to: {line.strip()!r}")
    assert "lookahead = barmerge.lookahead_off" in line, (
        "the call's lookahead argument changed — the repaint analysis in the "
        "tuple work was done against `lookahead_off` and must be redone")
