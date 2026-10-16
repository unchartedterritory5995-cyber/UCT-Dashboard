"""PC-side tools: the TSDR voice corpus export and the Bonde attribution plan.

Both run against synthetic databases in tmp_path; the real ENGINE KB is never opened here.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. voice corpus: a write on a dry run, an output directory inside the public repository,
   non-TSDR text in the file, a database opened writable.
2. Bonde attribution: a row attributed without evidence, a UCT row that merely cites
   Stockbee credited to him, the plan carrying row text, the KB written.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import importlib.util
import pathlib
import sqlite3

import pytest

from api.services.wisdom.core import store
from tests.test_wisdom_publish_adapters_store import adapters_db, seeded  # noqa: F401

REPO = pathlib.Path(__file__).resolve().parents[1]


def _load(name):
    spec = importlib.util.spec_from_file_location(f"{name}_under_test", REPO / "tools" / "wisdom" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


voice_tool = _load("publish_voice_corpus")
bonde_tool = _load("publish_bonde_attribution")


def _sha(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


# ── voice corpus ─────────────────────────────────────────────────────────────

def test_the_voice_corpus_dry_run_writes_nothing_and_the_write_is_tsdr_only(seeded, tmp_path):
    db = str(store.db_path())
    before = _sha(db)
    out_dir = tmp_path / "localappdata" / "uct" / "wisdom"
    dry = voice_tool.export(db, out_dir, date="2026-09-13")
    assert dry["documents"] == 1 and dry["written"] is False and not out_dir.exists()
    done = voice_tool.export(db, out_dir, date="2026-09-13", write=True)
    target = out_dir / "voice_corpus_2026-09-13.txt"
    assert done["written"] is True and pathlib.Path(done["path"]) == target.resolve()
    text = target.read_text(encoding="utf-8")
    header, rest = text.split("\n", 1)
    # §8c.3: the exported FILE carries the provenance marker, above the first block
    assert voice_tool.voicefmt.provenance.parse(header)["consumer"] == "voice"
    assert rest.startswith("=== [SUNDAY SCAN] Sunday Scans 9/6 ===\nDate: 2026-09-06\n")
    assert "passing on AMD" not in text and "momentum bursts" not in text   # Bracco and the guest are not his
    assert done["sha256"] == hashlib.sha256(text.encode("utf-8")).hexdigest()
    assert _sha(db) == before  # opened read-only


def test_the_voice_corpus_refuses_the_repository_as_an_output(seeded):
    with pytest.raises(voice_tool.ExportRefused):
        voice_tool.export(str(store.db_path()), REPO / "data" / "wisdom", date="2026-09-13", write=True)
    assert voice_tool.check_out_dir(REPO.parent / "somewhere-else")  # control: outside the repo is fine


# ── Bonde attribution ────────────────────────────────────────────────────────

_KB_DDL = """
CREATE TABLE knowledge_base (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, title TEXT NOT NULL,
  content TEXT NOT NULL, tags TEXT DEFAULT '', trader TEXT DEFAULT '', source_ref TEXT DEFAULT '',
  regime_context TEXT DEFAULT '', priority INTEGER DEFAULT 3, active INTEGER DEFAULT 1, source TEXT DEFAULT 'manual',
  knowledge_epoch TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
"""
UCT = "intake:substack_unchartedterritory_sunday_scans_2026-02-21"


@pytest.fixture
def bonde_kb(tmp_path):
    path = tmp_path / "engine.db"
    conn = sqlite3.connect(path)
    conn.executescript(_KB_DDL)
    rows = [
        ("SETUP", "Bracco's Breakdown & Top Ideas", "Synthetic: three names he likes this week.", "Bonde", UCT, ""),
        ("MACRO", "Intro", "Synthetic intro paragraph.", "Bonde", UCT, ""),
        ("MACRO", "Breadth", "Synthetic: the Stockbee Market Monitor ratio improved.", "Bonde", UCT, ""),
        ("SCREENING", "Momentum burst scan", "Synthetic scan idea.", "Bonde", "intake:05_market_health",
         "stockbee.blogspot.com"),
        ("RULE", "Untraceable", "Synthetic rule with no source.", "Bonde", "intake:01_methodology_bible", ""),
        ("SETUP", "From discord", "Synthetic discord note.", "Bonde", "intake:discord_bracco", ""),
        ("SETUP", "Never add", "Synthetic section: never add to a losing position, cut it quickly and move on.",
         "Bonde", UCT, ""),
        ("RULE", "Not bonde", "Synthetic TSDR rule.", "TSDR", UCT, ""),
    ]
    conn.executemany("INSERT INTO knowledge_base(category, title, content, trader, source, source_ref) "
                     "VALUES (?, ?, ?, ?, ?, ?)", rows)
    conn.commit()
    conn.close()
    return path


def test_bonde_rows_are_attributed_by_evidence_only(bonde_kb, seeded):
    before = _sha(bonde_kb)
    plan = bonde_tool.attribute(str(bonde_kb), wisdom_db=str(store.db_path()))
    by_title_order = {p["kb_id"]: p for p in plan["proposals"]}
    assert plan["rows"] == 7  # the TSDR row is not in scope
    got = {kb_id: (p["proposed_author"], p["evidence"]) for kb_id, p in by_title_order.items()}
    assert got[1] == ("bracco", "substack_section_signature")
    assert by_title_order[1]["attribution_source"] == "signed section"
    assert got[2] == ("tsdr", "substack_section_signature") and by_title_order[2]["attribution_source"] == "D4 ruling"
    assert got[3] == ("unknown", "none") and by_title_order[3]["notes"]          # cites Stockbee inside a UCT issue
    assert got[4] == ("bonde_external", "source_names_stockbee")
    assert got[5] == ("unknown", "none")
    assert got[6] == ("bracco", "discord_channel_owner")
    assert got[7] == ("tsdr", "sample_text_authorship")
    assert plan["legacy_plan"]["deactivate_ids"] == [3, 5]
    assert plan["counts"]["unknown"] == 2
    blob = str(plan)
    assert "Synthetic" not in blob  # ids, proposals and hashes only
    assert _sha(bonde_kb) == before


def test_without_a_wisdom_copy_sample_text_evidence_is_not_invented(bonde_kb):
    plan = bonde_tool.attribute(str(bonde_kb))
    assert plan["sample_text_checked"] is False
    assert {p["kb_id"]: p["proposed_author"] for p in plan["proposals"]}[7] == "unknown"


# -- Bonde attribution: section text from the local intake file, and the reviewed relabel --

reattr_tool = _load("publish_bonde_reattribute")

_INTAKE = """SUBSTACK CONTENT
=== CONTENT ===

=== [SUNDAY SCAN] SUNDAY SCANS ===
Date: 2026-01-04
Synthetic opening words about patience while the tape chops sideways for weeks.
Bracco's Breakdown & Top Ideas
Synthetic copper miners rotation leadership broadening across smelters and royalty names.
TSDR's Weekly Outlook & Watchlist
Synthetic semiconductor equipment watchlist with lithography and memory names lining up.
"""


@pytest.fixture
def intake(tmp_path):
    path = tmp_path / "sunday_scans_intake.txt"
    path.write_text(_INTAKE, encoding="utf-8")
    return path


@pytest.fixture
def section_kb(tmp_path):
    path = tmp_path / "engine_sections.db"
    conn = sqlite3.connect(path)
    conn.executescript(_KB_DDL)
    rows = [
        ("SECTOR", "Copper miners rotation", "Synthetic: copper miners rotation leadership broadening "
         "across smelters and royalty names.", "Bonde", UCT, ""),
        ("SETUP", "Semi equipment watchlist", "Synthetic: semiconductor equipment watchlist with "
         "lithography and memory names lining up.", "Bonde", UCT, ""),
        ("RULE", "Unrelated", "Synthetic zebra quantum orchard text matching no section.", "Bonde", UCT, ""),
        ("RULE", "Not bonde", "Synthetic copper miners rotation leadership.", "TSDR", UCT, ""),
    ]
    conn.executemany("INSERT INTO knowledge_base(category, title, content, trader, source, source_ref) "
                     "VALUES (?, ?, ?, ?, ?, ?)", rows)
    conn.commit()
    conn.close()
    return path


def test_section_text_attributes_a_distilled_row_to_the_section_it_came_from(section_kb, intake):
    before = _sha(section_kb)
    plan = bonde_tool.attribute(str(section_kb), intake=[str(intake)])
    got = {p["kb_id"]: (p["proposed_author"], p["evidence"]) for p in plan["proposals"]}
    assert got[1] == ("bracco", "substack_section_text")
    assert got[2] == ("tsdr", "substack_section_text")
    assert got[3] == ("unknown", "none")                       # words match no section: never guessed
    assert plan["intake_sections_checked"] >= 3
    reattr = {r["kb_id"]: r for r in plan["legacy_plan"]["reattribute"]}
    assert set(reattr) == {1, 2} and all(len(r["content_sha256"]) == 64 for r in reattr.values())
    assert "Synthetic" not in str(plan)                         # ids, proposals and hashes only
    assert _sha(section_kb) == before                           # the KB is opened read-only


def test_without_an_intake_file_section_text_evidence_is_not_invented(section_kb):
    plan = bonde_tool.attribute(str(section_kb))
    assert plan["intake_sections_checked"] == 0
    assert {p["kb_id"]: p["proposed_author"] for p in plan["proposals"]}[1] == "unknown"


def test_a_row_shared_by_two_authors_sections_is_not_attributed(tmp_path):
    shared = "Synthetic identical sentence about breadth thrusts and leadership."
    text = ("=== CONTENT ===\n\n=== [SUNDAY SCAN] SUNDAY SCANS ===\nDate: 2026-01-11\n"
            f"Bracco's Breakdown & Top Ideas\n{shared}\nTSDR's Weekly Outlook & Watchlist\n{shared}\n")
    intake_path = tmp_path / "tie.txt"
    intake_path.write_text(text, encoding="utf-8")
    index = bonde_tool.load_intake_index([str(intake_path)], bonde_tool.section_headings())
    assert bonde_tool.section_text_author(bonde_tool._content_words(shared), index) is None


def _early():
    return dt.datetime(2026, 1, 5, 14, 0, tzinfo=reattr_tool.kb_sync.CT)


def test_reattribution_dry_run_writes_nothing_and_commit_relabels_only_reviewed_rows(section_kb, intake, tmp_path):
    plan = bonde_tool.attribute(str(section_kb), intake=[str(intake)])
    before = _sha(section_kb)
    dry = reattr_tool.run(str(section_kb), plan)
    assert dry["dry_run"] and dry["relabel"] == 2 and dry["by_label"] == {"Bracco": 1, "TSDR": 1}
    assert _sha(section_kb) == before
    done = reattr_tool.run(str(section_kb), plan, commit=True, clock=_early, backup_dir=str(tmp_path / "bk"))
    assert done["relabel"] == 2 and pathlib.Path(done["backup"]).exists()
    conn = sqlite3.connect(section_kb)
    rows = {r[0]: (r[1], r[2]) for r in conn.execute("SELECT id, trader, content FROM knowledge_base")}
    conn.close()
    assert rows[1][0] == "Bracco" and rows[2][0] == "TSDR" and rows[3][0] == "Bonde"
    assert reattr_tool.provenance.is_marked(rows[1][1])        # every row it wrote carries the marker
    assert len(rows) == 4                                       # nothing deleted
    again = reattr_tool.run(str(section_kb), plan)             # re-run: nothing left to relabel
    assert again["relabel"] == 0 and again["skip_reasons"] == {"no longer credited to Bonde": 2}


def test_reattribution_skips_a_row_whose_content_changed_after_review(section_kb, intake):
    plan = bonde_tool.attribute(str(section_kb), intake=[str(intake)])
    conn = sqlite3.connect(section_kb)
    conn.execute("UPDATE knowledge_base SET content = content || ' edited' WHERE id = 1")
    conn.commit()
    conn.close()
    out = reattr_tool.run(str(section_kb), plan)
    assert out["relabel"] == 1 and out["skip_reasons"] == {"content changed since the plan was reviewed": 1}


def test_reattribution_refuses_past_the_deadline_and_rolls_back_if_it_crosses_it(section_kb, intake, tmp_path):
    plan = bonde_tool.attribute(str(section_kb), intake=[str(intake)])
    late = lambda: dt.datetime(2026, 1, 5, 20, 56, tzinfo=reattr_tool.kb_sync.CT)  # noqa: E731
    with pytest.raises(reattr_tool.SyncAborted):
        reattr_tool.run(str(section_kb), plan, commit=True, clock=late, backup_dir=str(tmp_path / "bk"))
    ticks = iter([_early(), dt.datetime(2026, 1, 5, 20, 56, tzinfo=reattr_tool.kb_sync.CT)])
    with pytest.raises(reattr_tool.SyncAborted):
        reattr_tool.run(str(section_kb), plan, commit=True, clock=lambda: next(ticks),
                        backup_dir=str(tmp_path / "bk"))
    conn = sqlite3.connect(section_kb)
    assert conn.execute("SELECT COUNT(*) FROM knowledge_base WHERE trader = 'Bonde'").fetchone()[0] == 3
    conn.close()


def test_the_kb_label_is_derived_from_authors_json():
    assert reattr_tool.kb_label("tsdr") == "TSDR"
    assert reattr_tool.kb_label("bracco") == "Bracco"
    assert reattr_tool.kb_label("not-an-author") is None
