"""The 2026-11-03 Brain-template expansion of the setup vocabulary is ADDITIVE ONLY.

PROPOSAL (needs Wisdom maintainer review; DO NOT MERGE without it): 17 candidate entries for Trading
Brain setup templates with no vocabulary entry, and the engine_setup_templates rows that name them.
Classification of all 48 templates: docs/wisdom/vocabulary/BRAIN-MAPPING-2026-11-03.md.

STANDARD LIBRARY ONLY (like tests/test_wisdom_vocab_authority.py): reads files as text, imports nothing
from api/, so it runs with --noconftest.

THE BEFORE STATE is a fixture copy of setup-vocabulary-v1.json as it stood on origin/master 52f76f9b4f
(tests/fixtures/wisdom_vocab/setup-vocabulary-v1.pre-brain-2026-11-03.json), pinned by a canonical
hash so the fixture itself cannot drift.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. any pre-existing entry, id, name, alias, field or entry position changing;
2. any pre-existing map row changing, other than an engine_setup_templates row that was null and now
   names one of the new entries; any list other than engine_setup_templates changing at all;
3. any name or alias that resolved through vocab.lookup resolving differently (or becoming ambiguous);
   any external name that resolved through the eval replay's cross-list rule resolving differently;
4. the approved-only prompt list changing (new entries are candidates only);
5. a new entry that breaks the existing entry schema or the W1 §0.4f public-repo rules;
6. a HOLD or AMBIGUOUS template (owner decisions) being mapped or added by this change.
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import re

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
VOCAB_FILE = REPO / "docs" / "wisdom" / "vocabulary" / "setup-vocabulary-v1.json"
BEFORE_FILE = REPO / "tests" / "fixtures" / "wisdom_vocab" / "setup-vocabulary-v1.pre-brain-2026-11-03.json"
BEFORE_CANONICAL_SHA256 = "8fcaf287bfea862781fc74317c73ddcda3a3c104e9b382515509d30ef05e7c76"

NEW_IDS = (
    "ascending_triangle", "base_on_base", "cup_with_handle", "descending_triangle", "double_bottom",
    "ema_crossover", "head_and_shoulders", "late_stage_climax", "mean_reversion", "parabolic_short",
    "pocket_pivot", "stage_2_breakout", "stage_2_momentum", "stage_4_breakdown", "symmetrical_triangle",
    "wyckoff_accumulation", "wyckoff_lpsy",
)
#: Owner decisions (BRAIN-MAPPING-2026-11-03.md): never added or re-mapped by this change.
HOLD = ("7-Week Short Rule", "BGU", "EP", "Gap-and-Go", "Measured Move", "Power Play", "Short Squeeze")
AMBIGUOUS = ("EMA Crossback", "HTF", "Low-Cheat", "PEG", "Wyckoff Distribution")
#: Overlaps with an existing entry: recommended to the maintainer, deliberately not applied.
OVERLAP_NOT_APPLIED = ("Box Theory", "Green Line Breakout", "Wyckoff SOS")
TEMPLATES = "engine_setup_templates"


def canonical_sha(doc: dict) -> str:
    return hashlib.sha256(json.dumps(doc, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


@pytest.fixture(scope="module")
def before():
    return json.loads(BEFORE_FILE.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def after():
    return json.loads(VOCAB_FILE.read_text(encoding="utf-8"))


# the same normalisation and index vocab.py builds (api/services/wisdom/core/vocab.py), restated here
def normalize_name(name) -> str:
    return re.sub(r"\s+", " ", str(name or "")).strip().casefold()


def lookup_index(doc: dict) -> dict:
    names, alias_owners = {}, {}
    for e in doc["entries"]:
        if e["status"] == "retired":
            continue
        names[normalize_name(e["name"])] = e["vocab_id"]
        for alias in e.get("aliases", []):
            alias_owners.setdefault(normalize_name(alias), set()).add(e["vocab_id"])
    index = dict(names)
    for key, owners in alias_owners.items():
        if key and key not in index:
            index[key] = next(iter(owners)) if len(owners) == 1 else None
    return index


def cross_list_resolution(doc: dict) -> dict:
    """The eval replay's rule (3): a case-insensitive external name that maps to exactly one vocab_id
    across every list (api/services/wisdom/evals/replay.py VocabLookup.for_source)."""
    ids: dict = {}
    for spec in doc["maps"].values():
        for row in spec["rows"]:
            if row["vocab_id"] is not None:
                ids.setdefault(row["external_name"].lower(), set()).add(row["vocab_id"])
    return {k: (next(iter(v)) if len(v) == 1 else None) for k, v in ids.items()}


# ── the before state is the real one ─────────────────────────────────────────

def test_the_before_fixture_is_the_pinned_master_copy(before):
    assert canonical_sha(before) == BEFORE_CANONICAL_SHA256
    assert len(before["entries"]) == 32
    assert sum(1 for r in before["maps"][TEMPLATES]["rows"] if r["vocab_id"]) == 17


# ── 1. every pre-existing entry is byte-for-byte the same, in place ──────────

def test_top_level_fields_other_than_entries_and_maps_are_unchanged(before, after):
    assert list(after) == list(before)
    for key in before:
        if key not in ("entries", "maps"):
            assert after[key] == before[key], key


def test_every_pre_existing_entry_is_identical_and_in_place(before, after):
    n = len(before["entries"])
    assert after["entries"][:n] == before["entries"]
    for old, new in zip(before["entries"], after["entries"][:n]):
        assert list(new) == list(old), old["vocab_id"]  # same field order too
        assert json.dumps(new, ensure_ascii=False) == json.dumps(old, ensure_ascii=False)


def test_the_change_adds_exactly_the_proposed_entries(before, after):
    added = [e["vocab_id"] for e in after["entries"][len(before["entries"]):]]
    assert tuple(added) == NEW_IDS
    assert not set(added) & {e["vocab_id"] for e in before["entries"]}


# ── 2. maps: additive in engine_setup_templates only ─────────────────────────

def test_every_list_except_the_templates_map_is_unchanged(before, after):
    assert list(after["maps"]) == list(before["maps"])
    for list_name in before["maps"]:
        if list_name != TEMPLATES:
            assert after["maps"][list_name] == before["maps"][list_name], list_name


def test_every_previously_mapped_template_resolves_exactly_as_before(before, after):
    old_spec, new_spec = before["maps"][TEMPLATES], after["maps"][TEMPLATES]
    assert {k: v for k, v in new_spec.items() if k != "rows"} == {k: v for k, v in old_spec.items() if k != "rows"}
    assert [r["external_name"] for r in new_spec["rows"]] == [r["external_name"] for r in old_spec["rows"]]
    changed = []
    for old, new in zip(old_spec["rows"], new_spec["rows"]):
        if old["vocab_id"] is not None:
            assert new == old, old["external_name"]
        elif new != old:
            assert new["vocab_id"] in NEW_IDS and new["mismatch"] == 0 and set(new) == set(old), new
            changed.append(new["external_name"])
    names = {e["vocab_id"]: e["name"] for e in after["entries"]}
    assert sorted(changed) == sorted(names[v] for v in NEW_IDS)
    for row in new_spec["rows"]:
        if row["vocab_id"] in NEW_IDS:
            assert names[row["vocab_id"]] == row["external_name"], row


def test_owner_decisions_are_not_mapped_or_added(before, after):
    old_rows = {r["external_name"]: r for r in before["maps"][TEMPLATES]["rows"]}
    new_rows = {r["external_name"]: r for r in after["maps"][TEMPLATES]["rows"]}
    after_names = {normalize_name(e["name"]) for e in after["entries"]}
    for name in HOLD + AMBIGUOUS + OVERLAP_NOT_APPLIED:
        assert new_rows[name] == old_rows[name], name
        if name != "PEG":  # PEG keeps its W1 §3.3 row (earnings_gap_up, owner to rule)
            assert new_rows[name]["vocab_id"] is None, name
            assert normalize_name(name) not in after_names, name
    assert new_rows["PEG"]["vocab_id"] == "earnings_gap_up" and new_rows["PEG"]["mismatch"] == 1
    # the known ambiguity: neither flag form is re-pointed
    assert new_rows["Tight Flag"]["vocab_id"] == "flag" and new_rows["HTF"]["vocab_id"] is None


# ── 3. lookup and replay resolution unchanged for everything that resolved ───

def test_every_name_and_alias_resolves_exactly_as_before(before, after):
    old, new = lookup_index(before), lookup_index(after)
    for key, value in old.items():
        assert key in new and new[key] == value, (key, value, new.get(key))
    for key in set(new) - set(old):
        assert new[key] in NEW_IDS, key
    assert after["ambiguous_aliases"] == before["ambiguous_aliases"]


def test_no_new_name_or_alias_collides_with_an_existing_one(before, after):
    old_keys = set(lookup_index(before))
    seen: dict = {}
    for e in after["entries"][len(before["entries"]):]:
        for key in [normalize_name(e["name"])] + [normalize_name(a) for a in e["aliases"]]:
            assert key not in old_keys, (e["vocab_id"], key)
            assert seen.setdefault(key, e["vocab_id"]) == e["vocab_id"], (e["vocab_id"], key)


def test_the_replay_cross_list_resolution_is_unchanged_where_it_resolved(before, after):
    old, new = cross_list_resolution(before), cross_list_resolution(after)
    for key, value in old.items():
        assert new.get(key) == value, (key, value, new.get(key))
    for key in set(new) - set(old):
        assert new[key] in NEW_IDS, key


# ── 4. prompt list: approved names unchanged ─────────────────────────────────

def test_the_approved_only_prompt_list_is_unchanged(before, after):
    approved = lambda doc: sorted(e["name"] for e in doc["entries"] if e["status"] == "approved")  # noqa: E731
    assert approved(after) == approved(before)
    assert len(approved(after)) == 27


# ── 5. the new entries follow the existing schema and the public-repo rules ──

def test_new_entries_follow_the_existing_entry_schema(before, after):
    template_keys = list(before["entries"][0])
    assert all(list(e) == template_keys for e in before["entries"])
    for e in after["entries"][len(before["entries"]):]:
        vid = e["vocab_id"]
        assert list(e) == template_keys, vid
        assert re.fullmatch(r"[a-z0-9]+(_[a-z0-9]+)*", vid), vid
        assert e["kind"] == "setup" and e["status"] == "candidate", vid
        assert e["evidence_strength"] == "none" and e["evidence_count"] == 0 and e["evidence"] == [], vid
        assert e["coined_by"] is None and e["definition"] is None, vid  # W1 §0.4f: no source text
        assert "W1 §3.1" in e["status_reason"] and "W1 §0.4f" in e["definition_locator"], vid
        assert e["maps_to_v0"] == {"desk": None, "engine": None}, vid
        assert e["note"] and "maintainer review" in e["note"], vid
        assert len(e["aliases"]) == len({normalize_name(a) for a in e["aliases"]}), vid
        for alias in e["aliases"]:
            assert 1 <= len(alias.split()) <= 3, (vid, alias)  # name-like, at most three words
            assert not re.search(r"\$|\d+\.\d", alias), (vid, alias)  # no price level
            assert normalize_name(alias) != normalize_name(e["name"]), (vid, alias)


def test_every_new_entry_is_reachable_from_exactly_its_template_row(after):
    rows = [r for spec in after["maps"].values() for r in spec["rows"] if r["vocab_id"] in NEW_IDS]
    assert sorted(r["vocab_id"] for r in rows) == sorted(NEW_IDS)
    template_rows = {r["external_name"] for r in after["maps"][TEMPLATES]["rows"]}
    assert len(template_rows) == after["maps"][TEMPLATES]["measured"]["rows"] == 48


def test_the_mapping_document_covers_all_48_templates():
    doc = (REPO / "docs" / "wisdom" / "vocabulary" / "BRAIN-MAPPING-2026-11-03.md").read_text(encoding="utf-8")
    after_doc = json.loads(VOCAB_FILE.read_text(encoding="utf-8"))
    for row in after_doc["maps"][TEMPLATES]["rows"]:
        assert f"\n| {row['external_name']} |" in doc, row["external_name"]
