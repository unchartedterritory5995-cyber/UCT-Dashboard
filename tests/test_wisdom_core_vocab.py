"""The vocabulary in wisdom.db: seeding, lookup, prompt list, candidates (W1 §3; CONTRACTS §6.2).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. wisdom.db not holding exactly what setup-vocabulary-v1.json says (entries, statuses, the
   359 map rows, the W1 §3.3 mismatches), or re-seeding writing when nothing changed;
2. re-seeding overwriting an OWNER decision (a retired or owner-approved entry);
3. lookup resolving an ambiguous alias, a retired entry or an unknown name, or failing
   when wisdom.db is unreadable;
4. a candidate use double-counted on a re-run, two records from one source counted as
   independent, or a guest's uses counting toward promotion;
5. a promotion while WISDOM_VOCAB_AUTOPROMOTE_ENABLED is off, a promotion that is not
   provisional or not in the owner's review queue, or a vetoed candidate promoted.
"""
from __future__ import annotations

import json

import pytest

from api.services.wisdom.core import store, vocab


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.delenv("WISDOM_VOCAB_AUTOPROMOTE_ENABLED", raising=False)
    store.init_db()
    vocab.clear_cache()
    yield tmp_path
    vocab.clear_cache()


def _scalar(sql, params=()):
    with store.read() as conn:
        return conn.execute(sql, params).fetchone()[0]


# ── 1-2. seeding ─────────────────────────────────────────────────────────────

def test_seeding_copies_the_file_once_and_matches_it(wisdom_db):
    data = vocab.load_vocabulary()
    rows = sum(len(spec["rows"]) for spec in data["maps"].values())
    counts = vocab.seed()
    assert counts["seeded"] and counts["inserted"] == 32 and counts["map_rows"] == rows and not counts["conflicts"]
    with store.read() as conn:
        db = {r["vocab_id"]: dict(r) for r in conn.execute("SELECT * FROM wisdom_vocab")}
        maps = conn.execute("SELECT COUNT(*) FROM wisdom_vocab_maps").fetchone()[0]
    assert maps == rows
    for entry in data["entries"]:
        row = db[entry["vocab_id"]]
        assert (row["name"], row["kind"], row["status"], row["coined_by"]) == \
               (entry["name"], entry["kind"], entry["status"], entry.get("coined_by"))
        assert json.loads(row["aliases_json"]) == entry["aliases"]
        assert (row["approved_by"] is not None) == (entry["status"] == "approved")
        assert row["provisional"] == 0
    again = vocab.seed()
    assert again["seeded"] is False and "already" in again["reason"]


def test_the_w1_mismatches_land_in_wisdom_vocab_maps(wisdom_db):
    vocab.seed()
    for list_name, external, vocab_id in (("pattern_engine", "pullback_to_21ema", "20ema_tap"),
                                          ("setupCatalog.js", "High Volume Edge", "high_volume_close"),
                                          ("desk_SETUP_TAXONOMY", "Flat Base Breakout", "range_breakout"),
                                          ("setupGroups.js", "Power Earnings Gap", "earnings_gap_up")):
        row = vocab.map_lookup(list_name, external)
        assert (row["vocab_id"], row["mismatch"]) == (vocab_id, 1), row
    assert vocab.map_lookup("pattern_engine", "hammer")["vocab_id"] is None
    assert vocab.map_lookup("pattern_engine", "no_such_detector") is None


def test_an_owner_decision_survives_reseeding_and_a_seed_owned_row_is_restored(wisdom_db):
    vocab.seed()
    with store.write() as conn:
        conn.execute("UPDATE wisdom_vocab SET status = 'retired', approved_by = 'owner' WHERE vocab_id = 'vcp'")
        conn.execute("UPDATE wisdom_vocab SET status = 'retired' WHERE vocab_id = 'flag'")  # seed-owned
    counts = vocab.seed(force=True)
    assert counts["owner_kept"] == 1
    assert _scalar("SELECT status FROM wisdom_vocab WHERE vocab_id = 'vcp'") == "retired"
    assert _scalar("SELECT status FROM wisdom_vocab WHERE vocab_id = 'flag'") == "approved"


# ── 3. lookup and the prompt list ────────────────────────────────────────────

@pytest.mark.parametrize("name,vocab_id", [
    ("Oops Reversal", "oops_reversal"), ("  oops   REVERSAL ", "oops_reversal"),
    ("gap support", "open_bull_gap"), ("HVC", "high_volume_close"), ("Brian Chanan special", "brian_shannon_special"),
    ("IPO AVWAP", None),                  # shared by IPO Base and AVWAP: resolves to nothing
    ("Holy Grail Special", None), ("", None), (None, None),
])
def test_lookup_resolves_names_and_unambiguous_aliases_only(wisdom_db, name, vocab_id):
    assert vocab.lookup(name) == vocab_id


def test_a_retired_entry_no_longer_resolves(wisdom_db):
    assert vocab.lookup("VCP") == "vcp"
    with store.write() as conn:
        conn.execute("UPDATE wisdom_vocab SET status = 'retired', approved_by = 'owner' WHERE vocab_id = 'vcp'")
    vocab.clear_cache()
    assert vocab.lookup("VCP") is None


def test_lookup_reads_the_committed_file_when_wisdom_db_is_unreadable(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "never_initialised.db"))
    vocab.clear_cache()
    assert vocab.lookup("Oops Reversal") == "oops_reversal"
    assert len(vocab.list_for_prompt()) == 32
    vocab.clear_cache()


def test_the_prompt_list_is_every_live_name_setups_first(wisdom_db):
    names = vocab.list_for_prompt()
    data = vocab.load_vocabulary()
    kinds = {e["name"]: e["kind"] for e in data["entries"]}
    assert len(names) == 32 and set(names) == set(kinds)
    order = [kinds[n] for n in names]
    assert order == sorted(order, key=vocab.KIND_ORDER.index)
    assert len(vocab.list_for_prompt(kinds=("level",))) == 5
    assert len(vocab.list_for_prompt(include_candidates=False)) == 27


# ── 4-5. candidates ──────────────────────────────────────────────────────────

def test_a_known_name_is_not_a_candidate(wisdom_db):
    assert vocab.record_candidate("oops reversal", "rec-1", "tsdr", "edu_videos:355@00:39:33")["status"] == "known"
    assert _scalar("SELECT COUNT(*) FROM wisdom_vocab_candidates") == 0


def test_a_new_name_is_queued_with_its_locator_and_reaches_the_review_queue(wisdom_db):
    result = vocab.record_candidate("Coil Pop", "rec-1", "bracco", "edu_videos:355@01:02:03")
    assert result["status"] == "queued" and result["independent_uses"] == 1 and result["team_author_uses"] == 1
    with store.read() as conn:
        item = conn.execute("SELECT tab, summary, evidence_json, status FROM wisdom_review_queue").fetchone()
    assert item["tab"] == "vocabulary" and "Coil Pop" in item["summary"] and item["status"] == "open"
    assert json.loads(item["evidence_json"])["defining_locator"] == "edu_videos:355@01:02:03"


def test_uses_are_counted_once_per_record_and_once_per_source(wisdom_db):
    vocab.record_candidate("Coil Pop", "rec-1", "tsdr", "edu_videos:355@00:10:00")
    vocab.record_candidate("Coil Pop", "rec-1", "tsdr", "edu_videos:355@00:10:00")   # a re-run
    same_session = vocab.record_candidate("coil pop", "rec-2", "tsdr", "edu_videos:355@00:40:00")
    assert same_session["independent_uses"] == 1 and same_session["raw_name"] == "Coil Pop"
    other = vocab.record_candidate("Coil Pop", "rec-3", "tsdr", "substack:/p/sunday-scans-d40#TWLO")
    assert other["independent_uses"] == 2
    explicit = vocab.record_candidate("Coil Pop", "rec-4", "tsdr", "anything", source_id="src-discord-1")
    assert explicit["independent_uses"] == 3


def _three_team_uses(name="Coil Pop"):
    vocab.record_candidate(name, "rec-a", "tsdr", "edu_videos:1@00:01:00")
    vocab.record_candidate(name, "rec-b", "bracco", "edu_videos:2@00:01:00")
    return vocab.record_candidate(name, "rec-c", "manrav", "substack:/p/x#Y")


def test_the_threshold_alone_never_promotes_while_the_flag_is_off(wisdom_db):
    result = _three_team_uses()
    assert result["status"] == "queued" and result["team_author_uses"] == 3 and "off" in result["autopromote"]
    assert vocab.lookup("Coil Pop") is None
    assert _scalar("SELECT COUNT(*) FROM wisdom_vocab WHERE name = 'Coil Pop'") == 0


def test_with_the_flag_on_a_promotion_is_provisional_and_queued_for_the_owner(wisdom_db, monkeypatch):
    _three_team_uses()
    monkeypatch.setenv("WISDOM_VOCAB_AUTOPROMOTE_ENABLED", "1")
    result = vocab.record_candidate("Coil Pop", "rec-c", "manrav", "substack:/p/x#Y")
    assert result["status"] == "promoted" and result["provisional"] is True
    with store.read() as conn:
        row = conn.execute("SELECT status, provisional, approved_by, kind FROM wisdom_vocab WHERE vocab_id = ?",
                           (result["vocab_id"],)).fetchone()
        tabs = [r["subject_ref"] for r in conn.execute("SELECT subject_ref FROM wisdom_review_queue ORDER BY subject_ref")]
    assert (row["status"], row["provisional"], row["approved_by"], row["kind"]) == ("approved", 1, vocab.AUTO_APPROVER, "setup")
    assert tabs == ["vocab_candidate:Coil Pop", "vocab_promotion:Coil Pop"]
    assert vocab.lookup("coil pop") == result["vocab_id"]
    assert _scalar("SELECT status FROM wisdom_vocab_candidates WHERE raw_name = 'Coil Pop'") == "promoted"


def test_guest_uses_never_count_toward_promotion(wisdom_db, monkeypatch):
    monkeypatch.setenv("WISDOM_VOCAB_AUTOPROMOTE_ENABLED", "1")
    for n in range(4):
        result = vocab.record_candidate("Bee Pivot", f"rec-g{n}", "guest:stockbee", f"edu_videos:{n}@00:00:01")
    assert result["independent_uses"] == 4 and result["team_author_uses"] == 0 and result["status"] == "queued"


def test_a_vetoed_candidate_is_never_promoted(wisdom_db, monkeypatch):
    vocab.record_candidate("Coil Pop", "rec-a", "tsdr", "edu_videos:1@00:01:00")
    with store.write() as conn:
        conn.execute("UPDATE wisdom_vocab_candidates SET status = 'vetoed' WHERE raw_name = 'Coil Pop'")
    monkeypatch.setenv("WISDOM_VOCAB_AUTOPROMOTE_ENABLED", "1")
    result = _three_team_uses()
    assert result["status"] == "vetoed" and result["vocab_id"] is None
    assert _scalar("SELECT COUNT(*) FROM wisdom_vocab WHERE name = 'Coil Pop'") == 0


def test_blank_and_recordless_candidates(wisdom_db):
    assert vocab.record_candidate("   ", "rec-1", "tsdr", "x")["status"] == "ignored"
    with pytest.raises(ValueError):
        vocab.record_candidate("Coil Pop", "", "tsdr", "x")
