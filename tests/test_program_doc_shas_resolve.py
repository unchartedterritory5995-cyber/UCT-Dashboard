"""Every SHA cited in a program doc must resolve against git.

⚰️ THE INCIDENT. On 2026-09-12 a scan of the whole doc tree found **thirteen**
unresolvable SHA citations. Twelve were fabrications and they had exactly one
shape: **every MERGE sha was real and every GATE sha was invented.** Merges were
habitually re-checked against `origin/master`; the docs-branch gate commits were
written down from a session's working notes and never resolved. Four had already
been caught by hand; this scan found eight more, plus a 2026-07-26 deploy SHA in
the existing-system survey that matches no object in the repository at all —
including unreachable ones.

⭐ **The tell that made it systemic rather than sloppy:** D2 CP1 and S12's first
migration were signed in ONE commit (`84590f220`), and the ledger cited TWO
different invented SHAs for them. The same shape as the four S7 gate packets —
one signing commit, four invented SHAs. Nobody was mistyping; SHAs were being
*composed* to fill a column.

⛔ A plausible-looking SHA is the most convincing false citation there is. It has
the right shape, it sits in the right column, and only git can tell you it is
fiction.
"""
from __future__ import annotations

import importlib.util
import pathlib

import pytest

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_TOOL = _ROOT / "tools" / "verify_doc_shas.py"


def _load():
    spec = importlib.util.spec_from_file_location("verify_doc_shas", _TOOL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def tool():
    assert _TOOL.exists(), f"the scanner is missing: {_TOOL}"
    return _load()


def test_the_scanner_sees_a_real_population_of_docs_and_shas(tool):
    """NON-VACUITY. An empty scan satisfies every assertion below it."""
    files = tool.doc_files(_ROOT)
    assert len(files) > 100, f"only {len(files)} docs found — the glob is wrong, not the tree empty"
    found = tool.candidates(_ROOT)
    assert len(found) > 100, (
        f"only {len(found)} SHA candidates over {len(files)} docs — the regex is wrong. "
        "These docs cite SHAs constantly; a small number here means a broken instrument.")


def test_the_resolver_can_tell_a_real_sha_from_a_fake_one(tool):
    """CONTROL. If git is unreachable the scan calls everything a failure, and if
    the resolver is stubbed it calls everything a pass. Prove both directions."""
    assert tool.resolves("94209e962", _ROOT), "a known-real merge SHA did not resolve"
    assert not tool.resolves("0123456789abcdef0123456789abcdef01234567", _ROOT), \
        "an impossible SHA 'resolved' — the resolver is not resolving"


def test_every_sha_cited_in_every_program_doc_resolves_against_git(tool):
    _found, bad, _phantom = tool.scan(_ROOT)
    if bad:
        lines = []
        for sha, sites in bad:
            for rel, line in sites:
                lines.append(f"  {sha}  ->  {rel}:{line}")
        pytest.fail(
            "SHA(s) cited in program docs that git cannot resolve.\n"
            "Resolve each one before it is written, or add it to FOREIGN_REPO "
            "(another repo's SHA) or QUOTED_DEAD (a tombstoned fabrication) with a "
            "reason, in tools/verify_doc_shas.py:\n" + "\n".join(lines))


def test_neither_allowlist_has_rotted(tool):
    """An exemption for a string that no longer appears is an exemption nobody is
    reading — and the next real fabrication could reuse it."""
    _found, _bad, phantom = tool.scan(_ROOT)
    assert not phantom, (
        "allowlisted SHAs that appear nowhere in the docs (remove them): "
        + ", ".join(f"{s} ({tool._EXEMPT[s]})" for s in phantom))


def test_every_exemption_carries_a_reason(tool):
    """A bare allowlist becomes a place to hide a failure."""
    for sha, reason in tool._EXEMPT.items():
        assert isinstance(reason, str) and len(reason) > 20, \
            f"exemption {sha} has no real reason: {reason!r}"


def test_the_all_digit_blind_spot_is_declared_not_silent(tool):
    """⚠️ The scanner ignores all-digit tokens, so a genuine all-numeric SHA is
    invisible to it (~1.5% of 9-char SHAs). That trade-off must stay written down
    where the next reader meets it, not just in a commit message."""
    src = _TOOL.read_text(encoding="utf-8")
    assert "_is_sha_shaped" in src
    assert "10/16" in src, "the blind-spot probability is no longer stated in the tool"
