"""The four CALL authors and the Discord sources (docs/wisdom/CONTRACTS.md §2.4).

Authority: docs/wisdom/authors.json and docs/wisdom/discord-sources.json (IDs
only). Authorship is fixed by those files and matched exactly
(case-insensitive), never inferred from voice or style. The web image copies
the whole repo, so the files are present on Railway.
"""
from __future__ import annotations

import functools
import json
import re
import pathlib
from typing import Optional

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
AUTHORS_FILE = REPO_ROOT / "docs" / "wisdom" / "authors.json"
DISCORD_SOURCES_FILE = REPO_ROOT / "docs" / "wisdom" / "discord-sources.json"
SESSION_RESOLUTIONS_FILE = REPO_ROOT / "docs" / "wisdom" / "speakers" / "session-resolutions-v1.json"


@functools.lru_cache(maxsize=1)
def load_authors() -> dict:
    return json.loads(AUTHORS_FILE.read_text(encoding="utf-8"))


@functools.lru_cache(maxsize=1)
def load_discord_sources() -> dict:
    return json.loads(DISCORD_SOURCES_FILE.read_text(encoding="utf-8"))


def authors() -> list[dict]:
    return list(load_authors()["authors"])


def call_authors() -> frozenset:
    return frozenset(a["author_id"] for a in authors() if a.get("can_author_calls") is True)


#: CONTRACTS §8a.2. A label that cannot name ONE person, resolved per session only with
#: cited evidence; with insufficient evidence the speaker is this, and it may author
#: MENTION only — never CALL, never a PRINCIPLE attribution.
TEAM_UNRESOLVED = "team-unresolved"


def ambiguous_labels() -> list[str]:
    """Labels that are NOT an alias of anybody (CONTRACTS §8a.2)."""
    return [str(entry["label"]) for entry in (load_authors().get("ambiguous_speaker_labels") or [])
            if entry.get("label")]


def is_ambiguous_label(label: Optional[str]) -> bool:
    if not label or not str(label).strip():
        return False
    key = str(label).strip().casefold()
    return any(key == name.strip().casefold() for name in ambiguous_labels())


#: A single token of Unicode letters — "Patrick", "Blake", "Manav", "Bracco".
_SINGLE_TOKEN_ALPHA = re.compile(r"[^\W\d_]+", re.UNICODE)


def declared_single_token_aliases() -> frozenset:
    """The one-word alphabetic aliases that have been argued for, by casefolded name."""
    declared = (load_authors().get("single_token_aliases_reviewed") or {}).get("aliases") or {}
    return frozenset(str(name).strip().casefold() for name in declared)


def author_for_alias(label: Optional[str]) -> Optional[str]:
    if not label or not label.strip():
        return None
    key = label.strip().casefold()
    # ⛔ Ambiguous beats alias, deliberately. If a label is ever declared ambiguous AND
    # left in some author's alias list, the safe answer is "nobody", not that author —
    # a mistake in the data must not become an attribution. The rail in
    # tests/test_wisdom_authors_aliases.py stops the two lists overlapping at all.
    if is_ambiguous_label(key):
        return None
    # ⛔⛔ THE CAPABILITY IS REMOVED HERE, not merely unused (owner ruling, drift #4,
    # 2026-09-13: "deleted, not just disabled"). Taking 'Patrick', 'Blake' and 'Manav' out of
    # the alias lists fixed the INSTANCE; this closes the DOOR. A one-word alphabetic label
    # can only ever be matched if it has been argued for in
    # authors.json `single_token_aliases_reviewed`, so re-adding a bare given name to an
    # alias list — the exact mistake that produced the defect — now resolves to NOBODY at
    # runtime rather than to a CALL author. Fail closed, and prove the guard can fire
    # (`lesson_a_flag_closes_one_door_a_capability_closes_all`).
    if _SINGLE_TOKEN_ALPHA.fullmatch(key) and key not in declared_single_token_aliases():
        return None
    for author in authors():
        names = [author["author_id"], author.get("display_name") or ""] + list(author.get("aliases") or [])
        if any(name and key == name.strip().casefold() for name in names):
            return author["author_id"]
    return None


#: The only evidence kinds §8a.2 accepts for resolving an ambiguous label. A resolution
#: citing anything else — "sounds like him", "he usually hosts" — is not a resolution.
SESSION_EVIDENCE_KINDS = frozenset(
    ("session_title", "self_introduction", "sunday_scans_position", "discord_same_minute"))


@functools.lru_cache(maxsize=1)
def load_session_resolutions() -> dict:
    if not SESSION_RESOLUTIONS_FILE.exists():
        return {"resolutions": []}
    return json.loads(SESSION_RESOLUTIONS_FILE.read_text(encoding="utf-8"))


def session_resolution(external_ref: Optional[str], label: Optional[str]) -> Optional[dict]:
    """The §8a.2 per-session resolution for one ambiguous label, or None.

    ⛔ Returns None unless the entry names an author AND cites at least one piece of
    evidence of a declared kind. A resolution with an empty or invented evidence list is
    NOT a resolution — it is the alias defect wearing a new field name, so it fails closed
    and the caller gets `team-unresolved` (`lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run`).
    """
    if not external_ref or not label:
        return None
    key = str(label).strip().casefold()
    for entry in load_session_resolutions().get("resolutions") or []:
        if str(entry.get("external_ref") or "") != str(external_ref):
            continue
        if str(entry.get("label") or "").strip().casefold() != key:
            continue
        author_id = entry.get("author_id")
        if not author_id or author_id == TEAM_UNRESOLVED:
            return None
        cited = [ev for ev in (entry.get("evidence") or [])
                 if (ev or {}).get("kind") in SESSION_EVIDENCE_KINDS]
        if not cited:
            return None
        # The resolution may only name somebody the authors file already knows.
        if author_id not in {a["author_id"] for a in authors()}:
            return None
        return {"author_id": author_id, "evidence": cited, "external_ref": external_ref, "label": label}
    return None


def author_for_discord_user(user_id: object) -> Optional[str]:
    uid = str(user_id or "").strip()
    if not uid:
        return None
    for author in authors():
        if str(author.get("discord_user_id") or "") == uid:
            return author["author_id"]
    return None


def in_scope_channels() -> list[dict]:
    return [c for c in load_discord_sources()["channels"] if c.get("in_scope") is True]
