"""Drafts: Pattern Vision exemplars, Model Book examples + missing playbooks, voice (D13, D18, D19).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a draft written while its flag is off, or an approval that publishes while it is off.
2. anything touching pattern_vision (import, DB) while the Pattern Intelligence Lab is paused.
3. a Model Book example from an OPEN call, from a non-owner, or with a setup name outside
   the Setup Library's own list.
4. a typed list of "missing playbooks" instead of one derived from the two JS files.
5. a decided draft overwritten by a later build, or re-decided.
6. non-TSDR text in the voice corpus, or a corpus the MW parser cannot read.
7. the Desk's own creative hook titles used to teach the "owner's style".
"""
from __future__ import annotations

import ast
import pathlib
from types import SimpleNamespace

import pytest

from api.services import modelbook_service
from api.services.wisdom.core import store
from api.services.wisdom.publish.adapters import drafts, modelbook, pv_examples, voice, voicefmt
from tests.test_wisdom_publish_adapters_store import add_record, add_source, adapters_db, seeded  # noqa: F401

REPO = pathlib.Path(__file__).resolve().parents[1]


def _ctx(dry_run=False):
    return SimpleNamespace(dry_run=dry_run, log=lambda m: None)


def _drafts(kind):
    with store.read() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM wisdom_drafts WHERE kind = ?", (kind,))]


def _imports(rel):
    tree = ast.parse((REPO / rel).read_text(encoding="utf-8"))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.update({node.module, *(f"{node.module}.{a.name}" for a in node.names)})
    return names


# ── Pattern Vision ───────────────────────────────────────────────────────────

def test_pv_exemplar_drafts_need_the_flag_and_never_touch_pattern_vision(seeded, monkeypatch):
    monkeypatch.delenv("WISDOM_PV_EXAMPLES_ENABLED", raising=False)
    off = pv_examples.daily(_ctx())
    assert off["flag_on"] is False and off["drafts"] == 1 and _drafts("pv_exemplar") == []
    with store.read() as conn:
        assert conn.execute("SELECT action FROM wisdom_publish_log WHERE consumer = 'pv_examples'").fetchone()[0] \
            == "would_publish"
    monkeypatch.setenv("WISDOM_PV_EXAMPLES_ENABLED", "1")
    pv_examples.daily(_ctx())
    [draft] = _drafts("pv_exemplar")
    assert '"setup": "episodic_pivot"' in draft["payload_json"] and '"record_id": "recCALL_DONE"' in draft["payload_json"]
    names = _imports("api/services/wisdom/publish/adapters/pv_examples.py")
    assert not [n for n in names if "pattern_vision" in n], names
    assert any(n.startswith("api.services.wisdom") for n in names)  # non-vacuity


# ── Model Book ───────────────────────────────────────────────────────────────

def test_model_book_examples_come_from_closed_owner_calls_with_library_names(seeded, monkeypatch):
    monkeypatch.setenv("WISDOM_MODELBOOK_DRAFTS_ENABLED", "1")
    with store.read() as conn:
        examples = modelbook.build_example_drafts(conn)
    assert [e["subject_ref"] for e in examples] == ["wisdom_records:recCALL_DONE"]  # the open call is not one
    payload = examples[0]["payload"]
    assert payload["setup_name"] == "Episodic Pivot" and payload["setup_name"] in modelbook.catalog_names()
    assert (payload["entry_price"], payload["stop_price"], payload["target_price"]) == (100.0, 95.0, 120.0)
    assert (payload["year"], payload["label_date"], payload["timeframe"]) == (2026, "2026-09-06", "D")
    assert "wisdom:srcSCAN#segSCAN1@" in payload["notes"]
    # a closed call with a private-store row publishes no prices at all
    with store.write() as conn:
        conn.execute("UPDATE wisdom_records SET has_private = 1 WHERE record_id = 'recCALL_DONE'")
    with store.read() as conn:
        again = modelbook.build_example_drafts(conn)[0]["payload"]
    assert again["entry_price"] is None and again["stop_price"] is None and again["target_price"] is None


def test_the_missing_playbooks_are_derived_from_the_two_setup_files(seeded, monkeypatch):
    catalog, authored = modelbook.catalog_names(), modelbook.authored_playbooks()
    assert len(catalog) >= 20 and "Bull Flag" in authored and "Cup & Handle" in catalog  # non-vacuity
    missing = modelbook.missing_playbooks()
    assert missing == [n for n in catalog if n not in set(authored)]
    assert len(missing) == 17  # the owner's "17 missing setup playbooks", measured 2026-09-13
    with store.write() as conn:
        conn.execute("INSERT INTO wisdom_vocab(vocab_id, name, kind, status, version) VALUES "
                     "('v_cup', 'Cup & Handle', 'setup', 'approved', 'v0')")
        conn.execute("INSERT INTO wisdom_vocab_maps(list_name, external_name, vocab_id) VALUES "
                     "('setupCatalog.js', 'Cup & Handle', 'v_cup')")
        conn.execute("INSERT INTO wisdom_principles(principle_key, statement, category, author_id, status) VALUES "
                     "('cup_right_side', 'Buy the handle, not the cup.', 'setup', 'tsdr', 'provisional')")
        add_record(conn, "recCUP", "PRINCIPLE", "segSCAN1", "srcSCAN", author_id="tsdr", vocab_id="v_cup",
                   principle_key="cup_right_side")
    monkeypatch.setenv("WISDOM_MODELBOOK_DRAFTS_ENABLED", "1")
    modelbook.daily(_ctx())
    playbooks = {d["subject_ref"]: d for d in _drafts("modelbook_playbook")}
    assert len(playbooks) == 17 and "setup_playbook:Bull Flag" not in playbooks
    cup = playbooks["setup_playbook:Cup & Handle"]
    assert '"state": "draft"' in cup["payload_json"] and "Buy the handle, not the cup." in cup["payload_json"]
    assert '"state": "awaiting_source_material"' in playbooks["setup_playbook:Go Signal"]["payload_json"]


def test_nothing_is_drafted_while_the_flag_is_off(seeded, monkeypatch):
    monkeypatch.delenv("WISDOM_MODELBOOK_DRAFTS_ENABLED", raising=False)
    out = modelbook.daily(_ctx())
    assert out["example_drafts"] == 1 and out["playbook_drafts"] == 17
    assert _drafts("modelbook_example") == [] and _drafts("modelbook_playbook") == []


def test_approval_publishes_only_with_the_flag_and_only_once(seeded, monkeypatch):
    created: list = []
    monkeypatch.setattr(modelbook_service, "create_setup_example", lambda p: created.append(p) or {"id": 7, **p})
    monkeypatch.setenv("WISDOM_MODELBOOK_DRAFTS_ENABLED", "1")
    modelbook.daily(_ctx())
    [example] = _drafts("modelbook_example")
    monkeypatch.delenv("WISDOM_MODELBOOK_DRAFTS_ENABLED")
    with pytest.raises(drafts.DraftRefused):
        drafts.decide(example["draft_id"], decision="approve", actor="owner@example.test")
    assert created == [] and _drafts("modelbook_example")[0]["status"] == "draft"
    monkeypatch.setenv("WISDOM_MODELBOOK_DRAFTS_ENABLED", "1")
    out = drafts.decide(example["draft_id"], decision="approve", actor="owner@example.test")
    assert out["status"] == "published" and out["published_ref"] == "modelbook_setup_examples:7"
    assert len(created) == 1 and created[0]["setup_name"] == "Episodic Pivot"
    assert drafts.decide(example["draft_id"], decision="approve", actor="owner@example.test")["changed"] is False
    assert len(created) == 1
    # a later build never overwrites the decision
    modelbook.daily(_ctx())
    assert _drafts("modelbook_example")[0]["status"] == "published"
    # a playbook approval records the decision and publishes nothing
    playbook = _drafts("modelbook_playbook")[0]
    assert drafts.decide(playbook["draft_id"], decision="approve", actor="owner@example.test")["status"] == "approved"
    assert len(created) == 1
    with pytest.raises(LookupError):
        drafts.decide("nope", decision="reject", actor="owner@example.test")


# ── voice ────────────────────────────────────────────────────────────────────

def test_the_voice_corpus_is_tsdr_only_and_in_the_archive_format(seeded):
    with store.read() as conn:
        written = voicefmt.corpus_documents(conn)
        spoken = voicefmt.corpus_documents(conn, include_spoken=True)
    assert [d["source_id"] for d in written] == ["srcSCAN"]      # Bracco's Discord message is not his
    assert {d["source_id"] for d in spoken} == {"srcSCAN", "srcLIVE"}
    live = next(d for d in spoken if d["source_id"] == "srcLIVE")
    assert all("attendee" not in line for line in live["lines"])  # the attendee cue is dropped
    text = voicefmt.format_archive(written)
    assert text.startswith("=== [SUNDAY SCAN] Sunday Scans 9/6 ===\nDate: 2026-09-06\n")
    assert voicefmt.format_archive([]) == ""


def test_the_title_style_guide_learns_only_from_his_own_titles(seeded, monkeypatch):
    with store.write() as conn:
        add_source(conn, "srcHOOK", "zoom_live", "edu_videos:43", title="Semis ripping BUT breadth lags! | Live "
                   "Trading Sessions — Sep 9, 2026", host_author_id="tsdr", media_pointer="ytHOOK")
    monkeypatch.delenv("WISDOM_VOICE_PROFILE_ENABLED", raising=False)
    assert voice.daily(_ctx())["style_draft"] is None and _drafts("desk_title_style") == []
    monkeypatch.setenv("WISDOM_VOICE_PROFILE_ENABLED", "1")
    out = voice.daily(_ctx())
    assert out["style_draft"] == "inserted"
    with store.read() as conn:
        guide = voice.title_style_guide(conn)
    assert guide["n_titles"] == 2 and guide["excluded_creative_titles"] == 1
    assert all(" | " not in e["title"] for e in guide["examples"])
    assert all("n=" in r or "/2" in r for r in guide["rules"])
