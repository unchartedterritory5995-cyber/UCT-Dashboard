"""Rails for the golden-v1 freeze (P4): §8a.2 session resolution, §8b.7 team-unresolved, leak check.

Every test here plants the failure first and asserts the guard stops it, so a guard that is
weakened later fails a test rather than passing quietly (CONTRACTS §8b.4).
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))

from api.services.wisdom.core import authors, speakers  # noqa: E402

RESOLUTIONS = REPO / "docs" / "wisdom" / "speakers" / "session-resolutions-v1.json"


@pytest.fixture()
def resolutions() -> dict:
    return json.loads(RESOLUTIONS.read_text(encoding="utf-8"))


# ── §8a.2: the shared host label is an alias of nobody ────────────────────────────

def test_the_shared_host_label_resolves_to_nobody_without_a_session():
    """⚰️ The defect: 'Uncharted Territory' was a tsdr alias, so another person's trade was
    attributed to the owner. Without a session there is nothing to resolve against."""
    assert authors.is_ambiguous_label("Uncharted Territory") is True
    assert authors.author_for_alias("Uncharted Territory") is None
    speaker, resolution = speakers.resolve_session_speaker("Uncharted Territory")
    assert speaker == authors.TEAM_UNRESOLVED
    assert resolution is None


def test_an_unknown_session_does_not_invent_an_author():
    speaker, resolution = speakers.resolve_session_speaker("Uncharted Territory", "edu_videos:999999")
    assert speaker == authors.TEAM_UNRESOLVED
    assert resolution is None


def test_the_label_is_never_promoted_to_a_guest_by_the_session_title():
    """⚰️ Taking the label out of the alias list on its own turned it into
    'guest:uncharted_territory' — the shared account promoted to a fabricated person."""
    speaker, _ = speakers.resolve_session_speaker(
        "Uncharted Territory", "edu_videos:999999",
        title="Uncharted Territory — Live Trading Session",
        description="Uncharted Territory hosts the session.")
    assert speaker == authors.TEAM_UNRESOLVED
    assert not str(speaker).startswith(speakers.GUEST_PREFIX)


def test_a_resolved_session_returns_the_author_and_its_cited_evidence(resolutions):
    entry = next(e for e in resolutions["resolutions"] if e["author_id"] == "bracco")
    speaker, resolution = speakers.resolve_session_speaker(entry["label"], entry["external_ref"])
    assert speaker == "bracco"
    assert resolution is not None and resolution["evidence"], "a resolution must carry its evidence"
    assert all(ev["kind"] in authors.SESSION_EVIDENCE_KINDS for ev in resolution["evidence"])


def test_a_resolution_with_no_cited_evidence_resolves_to_nobody(monkeypatch, resolutions):
    """A resolution is the EVIDENCE, not the author field. An entry that names a person and
    cites nothing is the alias defect wearing a new field name."""
    hollow = dict(resolutions)
    hollow["resolutions"] = [{"external_ref": "edu_videos:283", "label": "Uncharted Territory",
                              "author_id": "tsdr", "evidence": []}]
    monkeypatch.setattr(authors, "load_session_resolutions", lambda: hollow)
    assert speakers.resolve_session_speaker("Uncharted Territory", "edu_videos:283")[0] == authors.TEAM_UNRESOLVED


def test_a_resolution_citing_an_undeclared_evidence_kind_resolves_to_nobody(monkeypatch):
    """'He usually hosts' and 'sounds like him' are not evidence. §8a.2 names four kinds."""
    monkeypatch.setattr(authors, "load_session_resolutions", lambda: {"resolutions": [
        {"external_ref": "edu_videos:283", "label": "Uncharted Territory", "author_id": "tsdr",
         "evidence": [{"kind": "voice_similarity", "basis": "sounds like him"}]}]})
    assert speakers.resolve_session_speaker("Uncharted Territory", "edu_videos:283")[0] == authors.TEAM_UNRESOLVED


def test_a_resolution_naming_somebody_the_authors_file_does_not_know_resolves_to_nobody(monkeypatch):
    monkeypatch.setattr(authors, "load_session_resolutions", lambda: {"resolutions": [
        {"external_ref": "edu_videos:283", "label": "Uncharted Territory", "author_id": "somebody_new",
         "evidence": [{"kind": "discord_same_minute", "basis": "x"}]}]})
    assert speakers.resolve_session_speaker("Uncharted Territory", "edu_videos:283")[0] == authors.TEAM_UNRESOLVED


def test_a_resolution_for_a_different_session_does_not_leak_across(resolutions):
    """Sessions 283 and 348 resolve to different people. A resolution is per session, so one
    must never answer for the other."""
    a = speakers.resolve_session_speaker("Uncharted Territory", "edu_videos:283")[0]
    b = speakers.resolve_session_speaker("Uncharted Territory", "edu_videos:348")[0]
    assert a != b, "the same shared label resolves to two different people in two sessions"


def test_the_owner_ruled_session_stays_unresolved(resolutions):
    """edu_videos:343 — the owner answered 'unknown' (item 008). It must have no resolution."""
    assert not any(e["external_ref"] == "edu_videos:343" for e in resolutions["resolutions"])
    assert speakers.resolve_session_speaker("Uncharted Territory", "edu_videos:343")[0] == authors.TEAM_UNRESOLVED


def test_an_ordinary_alias_is_untouched_by_the_session_path():
    assert speakers.resolve_session_speaker("Patrick (TSDR)", "edu_videos:348") == ("tsdr", None)


# ── the resolutions file itself is quote-free and internally honest ───────────────

def test_the_resolutions_file_carries_no_source_text(resolutions):
    """W1 §0.4f / D1 — this repo is public. Citations by identifier only."""
    text = json.dumps(resolutions, ensure_ascii=False)
    for banned in ("transcript", "cue_text", "content", "message_text"):
        assert f'"{banned}"' not in text, f"{banned} would carry source text"
    for entry in resolutions["resolutions"]:
        for ev in entry["evidence"]:
            assert set(ev) <= {"kind", "cue_t_s", "ticker", "discord_ref", "substack_ref",
                               "section_path", "delta_minutes", "basis"}


def test_every_resolution_names_a_known_author_and_an_ambiguous_label(resolutions):
    known = {a["author_id"] for a in authors.authors()}
    for entry in resolutions["resolutions"]:
        assert entry["author_id"] in known
        assert authors.is_ambiguous_label(entry["label"]), \
            "resolving a label that is NOT ambiguous would be a second authority over authors.json"
        assert entry["evidence"], "a resolution with no evidence is not a resolution"


# ── the leaked-quote rail can actually fire ──────────────────────────────────────

def test_the_leak_check_catches_a_planted_quote(tmp_path):
    """⛔ An empty leak report is a failed invocation until the scanner is shown firing."""
    import wisdom.golden_leak_check as leak  # noqa: E402

    records = [{"gid": "G-TEST", "quote": "A planted sentence that is comfortably longer than "
                                          "one twenty-four character window, for the control."}]
    planted = tmp_path / "planted.md"
    planted.write_text(records[0]["quote"], encoding="utf-8")
    clean = tmp_path / "clean.md"
    clean.write_text("Nothing from any transcript lives in this file.", encoding="utf-8")

    hits = leak.scan(records, [planted], min_windows=2)
    assert hits and hits[0][1] == "G-TEST", "the scanner must see a reproduction it is looking at"
    assert leak.scan(records, [clean], min_windows=2) == [], "and must not fire on an unrelated file"


def test_the_committed_tree_has_no_golden_quote_in_it():
    """The repo-wide check, run for real. INCONCLUSIVE (2) when the gitignored set is absent —
    never a silent pass (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`)."""
    proc = subprocess.run([sys.executable, str(REPO / "tools" / "wisdom" / "golden_leak_check.py")],
                          capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900)
    if proc.returncode == 2:
        pytest.skip("golden set not on this box (gitignored)")
    assert proc.returncode == 0, f"leaked quote in a committed file:\n{proc.stdout}\n{proc.stderr}"
    assert "LEAK-CHECK PASS" in proc.stdout


def test_the_superseded_vocabulary_draft_carries_no_verbatim_source_text():
    """⚰️ It carried 26 `definition_quote` fields of paid Sunday Scans and Zoom prose while the
    approved v1 file beside it already used locators only."""
    draft = json.loads((REPO / "docs" / "wisdom" / "vocabulary"
                        / "setup-vocabulary-v0.draft.json").read_text(encoding="utf-8"))
    offenders = [e["name"] for e in draft["entries"] if e.get("definition_quote")]
    assert offenders == [], f"verbatim source text back in a committed file: {offenders}"
