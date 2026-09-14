"""The §8c.3 provenance rail: no adapter write reaches a consumer without a marker.

TWO HALVES, and they fail for different reasons — keep both.

STRUCTURAL (`provenance_check`): an AST walk over the Wisdom publish package and the
Wisdom publish tools finds every statement that CAN write outside Wisdom's own tables
and fails on any that cannot be shown to carry the marker. It catches a write path added
next month by somebody who never read this file. It cannot see what a value holds at run
time.

BEHAVIOURAL: the adapters are driven against a seeded store and every row they hand a
consumer is asserted to carry `MARKER_RE`. It catches a marking call that is present and
useless — stamped onto a dict the consumer drops, or onto a copy. It cannot see a write
path nobody exercises.

⛔ NON-VACUITY, in both halves. An empty result satisfies every assertion here, so each
half first proves it found something: the structural half asserts the live write sites it
must see BY NAME (the Model Book insert and the ENGINE KB statements), the behavioural
half asserts the adapters produced rows at all before asserting they are marked.
"""
from __future__ import annotations

import ast
import json
import pathlib
from datetime import datetime
from types import SimpleNamespace

import pytest

from api.services.wisdom.core import store, timeutil
from api.services.wisdom.publish import provenance_check
from api.services.wisdom.publish.adapters import (askai, badges, brainkb, common, desk_markers, dossier,
                                                  provenance, pv_examples, voicefmt)
from tests.test_wisdom_publish_adapters_store import add_record, adapters_db, seeded  # noqa: F401

REPO = provenance_check.REPO


def _ctx(dry_run=False):
    return SimpleNamespace(dry_run=dry_run, now_et=datetime(2026, 9, 11, 18, 47, tzinfo=timeutil.ET),
                           log=lambda m: None)


# ── the marker itself ────────────────────────────────────────────────────────

def test_the_marker_round_trips_and_survives_being_embedded_in_anything():
    text = provenance.marker_text(consumer="modelbook", subject_ref="wisdom_records:r1",
                                  locator="wisdom:src1#seg1@12s", flag_env="WISDOM_MODELBOOK_DRAFTS_ENABLED")
    parsed = provenance.parse(text)
    assert parsed == {"consumer": "modelbook", "ref": "wisdom_records:r1",
                      "cite": "wisdom:src1#seg1@12s", "flag": "WISDOM_MODELBOOK_DRAFTS_ENABLED"}
    assert provenance.is_marked(f"notes about the trade {text} and more prose")
    assert provenance.is_marked({"notes": text}) and provenance.is_marked([{"a": [text]}])
    assert not provenance.is_marked("notes about the trade") and not provenance.is_marked(None)
    # a field that would break the grammar is neutralised, never allowed to smuggle a bracket
    smuggled = provenance.marker_text(consumer="x] flag=evil", subject_ref="a b", locator=None, flag_env="F")
    assert len(provenance.find_all(smuggled)) == 1 and provenance.parse(smuggled)["flag"] == "F"


def test_stamp_reaches_a_text_field_because_a_consumer_drops_unknown_keys():
    """modelbook_service filters an insert through _EXAMPLE_FIELDS; `notes` is what survives."""
    out = provenance.stamp({"setup_name": "VCP", "notes": "tight base"}, consumer="modelbook",
                           subject_ref="wisdom_records:r1", locator=None,
                           flag_env="WISDOM_MODELBOOK_DRAFTS_ENABLED", text_field="notes")
    assert provenance.is_marked(out["notes"]) and out["notes"].startswith("tight base ")
    assert out["source"] == provenance.SOURCE
    again = provenance.stamp(out, consumer="modelbook", subject_ref="wisdom_records:r1",
                             locator=None, flag_env="F", text_field="notes")
    assert len(provenance.find_all(again["notes"])) == 1, "stamping twice must not stack markers"


def test_assert_marked_refuses_an_unmarked_write():
    with pytest.raises(provenance.UnmarkedWrite):
        provenance.assert_marked({"setup_name": "VCP", "notes": "tight base"})
    assert provenance.assert_marked({"n": provenance.marker_text(
        consumer="c", subject_ref="r", locator=None, flag_env="F")}) is not None


# ── structural half ──────────────────────────────────────────────────────────

def test_no_adapter_code_path_can_write_a_consumer_table_without_the_marker():
    report = provenance_check.audit()
    assert report["unmarked"] == [], json.dumps(report["unmarked"], indent=2)
    assert report["ok"]


def test_the_check_actually_found_the_live_write_paths():
    """NON-VACUITY. An empty site list passes the assertion above; name what must be there."""
    report = provenance_check.audit()
    assert report["files_scanned"] >= 10
    assert report["wisdom_owned_tables"] >= 20, "the owned-table derivation collapsed"
    # every consumer table Wisdom writes today, by name, from the derivation
    assert "knowledge_base" in report["consumer_tables"]
    assert "api.services.modelbook_service.create_setup_example" in report["consumer_calls"]
    files = {s["file"] for s in report["sites"]}
    assert "api/services/wisdom/publish/adapters/drafts.py" in files
    assert "tools/wisdom/publish_kb_sync.py" in files


def test_wisdom_owned_tables_are_derived_from_the_migrations_not_typed():
    owned = provenance_check.wisdom_owned_tables()
    # a sample from three different schema modules; all of them come from MIGRATIONS DDL
    for table in ("wisdom_records", "wisdom_publish_log", "wisdom_drafts", "wisdom_kb_rows",
                  "wisdom_capture_datasets"):
        assert table in owned, table
    assert "knowledge_base" not in owned and "modelbook_setup_examples" not in owned
    assert not any(m.startswith("provenance") for m in provenance_check.schema_modules())


def test_the_check_can_fail_self_check(tmp_path):
    """A guard nobody has seen fire is not a guard."""
    out = provenance_check.self_check(tmp_path)
    assert out["found"] == 1
    finding = out["report"]["unmarked"][0]
    assert finding["kind"] == "sql" and finding["target"] == "knowledge_base" and not finding["marked"]


def test_a_planted_write_path_of_each_shape_is_caught_and_a_marked_one_is_not(tmp_path):
    """MUTATION, both shapes and both directions — the SQL write and the service call."""
    def scan(body: str) -> list:
        path = tmp_path / "planted.py"
        path.write_text(body, encoding="utf-8")
        return provenance_check.audit([path])["unmarked"]

    sql = "INSERT INTO " + "knowledge_base(title) VALUES (?)"
    unmarked_sql = ("from api.services.wisdom.publish.adapters import provenance\n"
                    "def publish(conn, rows):\n"
                    "    for row in rows:\n"
                    f"        conn.execute({sql!r}, (row['t'],))\n")
    marked_sql = ("from api.services.wisdom.publish.adapters import provenance\n"
                  "def publish(conn, rows):\n"
                  "    for row in rows:\n"
                  "        provenance.assert_marked(row['t'])\n"
                  f"        conn.execute({sql!r}, (row['t'],))\n")
    unmarked_call = ("from api.services import modelbook_service\n"
                     "def publish(payload):\n"
                     "    return modelbook_service.create_setup_example(payload)\n")
    marked_call = ("from api.services import modelbook_service\n"
                   "from api.services.wisdom.publish.adapters import provenance\n"
                   "def publish(payload):\n"
                   "    payload = provenance.stamp(payload, consumer='c', subject_ref='r', flag_env='F')\n"
                   "    return modelbook_service.create_setup_example(payload)\n")

    assert len(scan(unmarked_sql)) == 1
    assert scan(marked_sql) == []
    assert len(scan(unmarked_call)) == 1
    assert scan(marked_call) == []
    # CONTROL: the marking call must DOMINATE the write, not merely share the function
    after = ("from api.services.wisdom.publish.adapters import provenance\n"
             "def publish(conn, rows):\n"
             "    for row in rows:\n"
             f"        conn.execute({sql!r}, (row['t'],))\n"
             "        provenance.assert_marked(row['t'])\n")
    assert len(scan(after)) == 1, "a marking call AFTER the write must not count"
    # CONTROL: a Wisdom-owned table is not a consumer, marker or no marker
    own = ("def publish(conn):\n"
           f"    conn.execute({'INSERT INTO ' + 'wisdom_publish_log(consumer) VALUES (?)'!r}, ('x',))\n")
    assert scan(own) == []
    # CONTROL: prose naming a write is prose — this is the pv_examples docstring defect
    prose = ('"""This module would insert into knowledge_base if the Lab reopened."""\n'
             "def publish(conn):\n    return None\n")
    assert scan(prose) == []


def test_the_checker_sees_a_statement_split_across_implicit_concatenation(tmp_path):
    """The kb_sync UPDATE is `"UPDATE knowledge_base SET … " f"…{x} " "WHERE … source = 'wisdom'"`.
    Read part by part, the verb and the WHERE clause never meet and the rail misreads both ways."""
    path = tmp_path / "split.py"
    path.write_text(
        "def publish(conn, kb_id, stamp):\n"
        "    conn.execute(\n"
        "        \"UPDATE knowledge_base SET active = 1\"\n"
        "        f\"{stamp} \"\n"
        "        \"WHERE id = ? AND source = 'wisdom'\", (kb_id,))\n", encoding="utf-8")
    report = provenance_check.audit([path])
    assert report["unmarked"] == []
    assert [s["target"] for s in report["sites"]] == ["knowledge_base"]
    assert "marker source" in report["sites"][0]["why"]


def test_the_marked_source_predicate_does_not_accept_its_own_negation(tmp_path):
    """`source <> 'wisdom'` is the legacy-row write. It must NOT read as already-marked."""
    path = tmp_path / "legacy.py"
    path.write_text(
        "def retire(conn, kb_id):\n"
        "    conn.execute(\"UPDATE knowledge_base SET active = 0 WHERE id = ? AND source <> 'wisdom'\", (kb_id,))\n",
        encoding="utf-8")
    assert len(provenance_check.audit([path])["unmarked"]) == 1


# ── behavioural half ─────────────────────────────────────────────────────────

def test_every_row_an_adapter_hands_a_consumer_carries_the_marker(seeded, monkeypatch):
    from api.services import rollout
    from api.services.wisdom.publish import retrieval

    for env in ("WISDOM_RETRIEVAL_INDEX_ENABLED", "ASKAI_WISDOM_RETRIEVAL_ENABLED",
                "WISDOM_DESK_MARKERS_ENABLED", "WISDOM_BADGES_ENABLED", "WISDOM_DOSSIER_ENABLED",
                "WISDOM_BRAINKB_PUBLISH_ENABLED", "WISDOM_PV_EXAMPLES_ENABLED",
                "WISDOM_VOICE_PROFILE_ENABLED"):
        monkeypatch.setenv(env, "1")
    monkeypatch.setattr(rollout, "includes", lambda *a, **k: True)
    retrieval.refresh(force=True)
    with store.write() as conn:
        brainkb.stage(conn, brainkb.build_rows(conn))

    now = datetime(2026, 9, 12, 12, 0, tzinfo=timeutil.ET)
    marker_rows = desk_markers.wisdom_rows("NVDA")
    badge_rows = badges.badges_for(["NVDA"], now=now)
    _block, cites = askai.wisdom_block("what about NVDA", user_id="u", question_type="other",
                                       query_tickers=["NVDA"])
    lines = dossier.wisdom_lines("NVDA")
    kb = brainkb.export_payload()
    with store.read() as conn:
        pv = pv_examples.build_drafts(conn)
        corpus = voicefmt.format_archive(voicefmt.corpus_documents(conn, include_spoken=True))

    # NON-VACUITY first: every lane produced something, so "all marked" means something
    assert marker_rows and badge_rows and cites and lines and kb["rows"] and corpus

    for row in marker_rows:
        assert provenance.is_marked(row), row
        assert provenance.parse(row[provenance.MARKER_KEY])["consumer"] == desk_markers.CONSUMER
    for ticker, badge in badge_rows.items():
        assert provenance.is_marked(badge), ticker
    for cite in cites:
        assert provenance.is_marked(cite), cite
    for line in lines:
        assert provenance.is_marked(line), line
    for row in kb["rows"]:
        assert provenance.is_marked(row["content"]), row["source_ref"]
    for draft in pv:
        assert provenance.is_marked(draft["payload"]), draft["subject_ref"]
    assert provenance.is_marked(corpus)
    assert kb["unmarked_dropped"] == []


def test_the_kb_export_drops_a_staged_row_that_lost_its_marker(seeded, monkeypatch):
    """MUTATION on the runtime guard: strip the marker from a staged row; it must not export."""
    monkeypatch.setenv("WISDOM_BRAINKB_PUBLISH_ENABLED", "1")
    with store.write() as conn:
        brainkb.stage(conn, brainkb.build_rows(conn))
    before = brainkb.export_payload()
    assert before["rows"], "nothing staged; the control proves nothing"
    victim = before["rows"][0]["source_ref"]
    with store.write() as conn:
        conn.execute("UPDATE wisdom_kb_rows SET content = 'bare content' WHERE source_ref = ?", (victim,))
    after = brainkb.export_payload()
    assert after["unmarked_dropped"] == [victim]
    assert victim not in {r["source_ref"] for r in after["rows"]}
    assert len(after["rows"]) == len(before["rows"]) - 1


def test_the_voice_corpus_marker_sits_above_the_first_block_the_wire_parser_reads(seeded):
    with store.read() as conn:
        docs = voicefmt.corpus_documents(conn, include_spoken=True)
    text = voicefmt.format_archive(docs)
    assert docs and text.startswith("[")
    first_header = text.index("=== [")
    assert provenance.is_marked(text[:first_header])
    # no document BODY carries it: a marker inside the corpus would train the voice profile
    assert not provenance.is_marked(text[first_header:])


def test_the_provenance_module_imports_nothing_from_the_api_package():
    """The PC-side tools load it BY PATH so they can never capture a /data path."""
    path = pathlib.Path(provenance.__file__)
    tree = ast.parse(path.read_text(encoding="utf-8"))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    assert "api" not in imported, imported
    assert imported <= {"__future__", "json", "re", "typing"}, imported
