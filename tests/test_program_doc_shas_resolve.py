"""Every SHA cited in a program doc must resolve against git — unless it is a
CONTENT FINGERPRINT, which is a different kind of thing.

⚰️⚰️ THIS FILE'S ORIGINAL DOCSTRING WAS WRONG AND IS RETIRED VERBATIM:

    "On 2026-09-12 a scan of the whole doc tree found **thirteen**
    unresolvable SHA citations. Twelve were fabrications and they had exactly
    one shape: **every MERGE sha was real and every GATE sha was invented.**"

Twelve of the thirteen were `git hash-object` fingerprints of their own gate
packets, written by the owner's approval format:

    APPROVED AT SHA:  4b4c3549b   (git hash-object of this packet as it stood
                      at approval, with this field blank)

A fingerprint pins an approval to exact bytes. It is not a commit, is never
written to the object store, and `git cat-file -e` will never resolve it. The
scan met a second kind of hex string, had only one notion of what a hex string
means, and reported the difference as dishonesty — then "corrected" eight
legitimate fingerprints into commit SHAs, destroying the value that pinned each
approval.

⭐ THE INSTRUMENT AUDITED A CONVENTION IT HAD NOT READ, and its output read as
measurement rather than as opinion, which is what made it persuasive. The four
"confirmations" were one mistake repeated four times.

⛔ ONE genuine unresolvable survives: `650865d5`, cited as a 2026-07-26 deploy,
matching no object including unreachable ones — possibly a Railway deploy id.
Allowlisted with that reason rather than erased.

The rail now DERIVES fingerprints from the packets, so a gate signed tomorrow is
covered the day it lands. Mutation: break the derivation and exactly twelve come
back.
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


def test_approval_fingerprints_are_DERIVED_from_the_packets_not_listed(tool):
    """⭐ The correction, railed. A gate signed tomorrow must be covered the day
    it lands — a hand-maintained list would put us back where we started."""
    fps = tool.approval_fingerprints(_ROOT)
    assert len(fps) >= 8, (
        f"only {len(fps)} approval fingerprints found across the gate packets — "
        "the AT SHA regex is broken. It has been broken once already, by a "
        "heredoc turning a word-boundary escape into a 0x08 byte, and a regex "
        "that matches nothing reports every fingerprint as a fabrication.")
    for sha, why in fps.items():
        assert "hash-object" in why, why


def test_a_known_fingerprint_is_exempt_and_a_random_hex_string_is_NOT(tool):
    """CONTROL in both directions — an exemption that exempts everything is not
    an exemption."""
    fps = tool.approval_fingerprints(_ROOT)
    assert "4b4c3549b" in fps, (
        "the regime-change packet's approval fingerprint is not being recognised")
    assert "0123456789abc" not in fps


def test_the_fingerprint_regex_is_built_from_named_atoms_never_a_literal(tool):
    """⛔ Written literally, the word-boundary escape in this repo has twice
    become a 0x08 BACKSPACE on the way through a heredoc."""
    src = _TOOL.read_text(encoding="utf-8")
    assert "_RXB" in src and 'chr(92) + "b"' in src, (
        "the AT SHA regex is back to a literal escape")
    assert "\x08" not in src, "a literal 0x08 byte is in the scanner source"
