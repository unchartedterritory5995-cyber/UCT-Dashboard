"""CALL-REPLAY rails (W1 §6.1, replay-v1; stream S-E).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. the two leadership lanes read as one source (double-counted top-N).
2. a rank past the desk display count read as a top-N hit.
3. a setup match decided without the vocabulary map.
4. a date a source never recorded read as a MISS (the flattering denominator).
5. a detection outside the 120-day prune, or a scan hit without its coverage receipt, read as proven.
6. a pre-open call judged against the session it was made in instead of the prior one.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime

import pytest

from api.services.wisdom.core import store
from api.services.wisdom.core.timeutil import ET
from api.services.wisdom.evals import replay

SESSION = "2026-09-10"


def _db(path, ddl, rows=()):
    conn = sqlite3.connect(path)
    conn.executescript(ddl)
    for sql, params in rows:
        conn.execute(sql, params)
    conn.commit()
    conn.close()
    return str(path)


@pytest.fixture
def engine(tmp_path):
    return _db(tmp_path / "engine.db", """
        CREATE TABLE leadership_snapshots (snapshot_date TEXT, rank INTEGER, symbol TEXT, setup_type TEXT, source TEXT);
        CREATE TABLE setup_triggers (symbol TEXT, trigger_date TEXT, setup_name TEXT, source TEXT);
        CREATE TABLE ep_candidates (symbol TEXT, date_flagged TEXT, setup_type TEXT);
        CREATE TABLE wire_universe (issue_id TEXT, ticker TEXT, dropped_at_stage INTEGER);
    """, [
        ("INSERT INTO leadership_snapshots VALUES (?,?,?,?,?)", (SESSION, 3, "NVDA", "Bull-Flag", "morning_wire")),
        ("INSERT INTO leadership_snapshots VALUES (?,?,?,?,?)", (SESSION, 5, "NVDA", "VCP", "autonomous_brain")),
        ("INSERT INTO leadership_snapshots VALUES (?,?,?,?,?)", (SESSION, 21, "AMD", "Stage2", "morning_wire")),
        ("INSERT INTO setup_triggers VALUES (?,?,?,?)", (SESSION, SESSION, "Tight Flag", "leadership")),
        ("INSERT INTO ep_candidates VALUES (?,?,?)", ("ZZZ", SESSION, "EP")),
        ("INSERT INTO wire_universe VALUES (?,?,?)", (SESSION, "NVDA", None)),
        ("INSERT INTO wire_universe VALUES (?,?,?)", (SESSION, "AMD", 2)),
    ])


@pytest.fixture
def vocab(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    with store.write() as conn:
        conn.execute("INSERT INTO wisdom_vocab (vocab_id, name, kind, status, aliases_json, version) "
                     "VALUES ('v:flag', 'Flag', 'setup', 'approved', '[\"flag out\"]', 'v0')")
        conn.execute("INSERT INTO wisdom_vocab_maps (list_name, external_name, vocab_id) "
                     "VALUES ('engine_leadership_setup_type', 'Bull-Flag', 'v:flag')")
    conn = store.connect()
    yield replay.VocabLookup(conn)
    conn.close()


def _call(**over):
    rec = {"record_id": "c1", "ticker": "NVDA", "stated_at_et": f"{SESSION}T10:00:00-04:00",
           "stated_at_precision": "minute", "vocab_id": None, "setup_name_raw": None}
    rec.update(over)
    return rec


def _by_source(result):
    return {c["source"]: c for c in result["checks"]}


def test_the_two_leadership_lanes_are_two_sources_never_one(engine, vocab):
    adapters = [replay.LeadershipSnapshots(engine, "morning_wire"), replay.LeadershipSnapshots(engine, "autonomous_brain")]
    result = replay.replay_record(_call(), adapters, vocab)
    checks = _by_source(result)
    assert checks["leadership_snapshots:morning_wire"]["rank"] == 3
    assert checks["leadership_snapshots:autonomous_brain"]["rank"] == 5
    assert result["levels"]["any"]["sources"] == ["leadership_snapshots:autonomous_brain",
                                                   "leadership_snapshots:morning_wire"]
    # control: a lane with no rows for the date is unproven for that lane only
    missing = replay.LeadershipSnapshots(engine, "no_such_lane").check("NVDA", datetime(2026, 9, 10).date())
    assert (missing.verdict, missing.reason) == ("unproven", "no_snapshot_for_date")


def test_a_rank_past_the_desk_display_count_is_any_but_not_top_n(engine, vocab):
    result = replay.replay_record(_call(ticker="AMD"), [replay.LeadershipSnapshots(engine, "morning_wire")], vocab)
    assert result["levels"]["any"]["verdict"] == "hit"
    assert result["levels"]["topn"]["verdict"] == "miss"


def test_the_setup_level_matches_only_through_the_vocabulary_map(engine, vocab):
    adapters = [replay.LeadershipSnapshots(engine, "morning_wire"), replay.LeadershipSnapshots(engine, "autonomous_brain")]
    hit = replay.replay_record(_call(vocab_id="v:flag"), adapters, vocab)
    assert hit["levels"]["setup"] == {"verdict": "hit", "sources": ["leadership_snapshots:morning_wire"]}
    # the call's own raw name resolves through wisdom_vocab aliases
    alias = replay.replay_record(_call(setup_name_raw="flag out"), adapters, vocab)
    assert alias["record_vocab"] == "v:flag" and alias["levels"]["setup"]["verdict"] == "hit"
    # a different setup: the ticker WAS flagged, but not with this setup -> miss, not hit
    other = replay.replay_record(_call(vocab_id="v:vcp"), adapters, vocab)
    assert other["levels"]["setup"]["verdict"] == "miss"
    # no vocabulary on the call: excluded from the setup level, never guessed
    none = replay.replay_record(_call(), adapters, vocab)
    assert none["levels"]["setup"]["verdict"] == "excluded"


def test_a_date_the_source_never_recorded_is_unproven_not_a_miss(engine, vocab):
    result = replay.replay_record(_call(stated_at_et="2026-09-09T10:00:00-04:00"),
                                  [replay.LeadershipSnapshots(engine, "morning_wire"), replay.SetupTriggers(engine),
                                   replay.EpCandidates(engine), replay.WireUniverse(engine)], vocab)
    assert {c["verdict"] for c in result["checks"]} == {"unproven"}
    assert result["levels"]["any"] == {"verdict": "unproven", "sources": [], "reason": "every_source_unproven"}
    # control: the same sources on a date they DID record give a proven miss for an absent ticker
    miss = replay.replay_record(_call(ticker="QQQ"), [replay.SetupTriggers(engine)], vocab)
    assert miss["levels"]["any"]["verdict"] == "miss"
    # and an absent file is unproven with its reason
    gone = replay.SetupTriggers(str(engine) + ".absent").check("NVDA", datetime(2026, 9, 10).date())
    assert (gone.verdict, gone.reason) == ("unproven", "source_file_missing")


def test_the_wire_universe_counts_only_passed_names(engine, vocab):
    adapter = replay.WireUniverse(engine)
    assert adapter.check("NVDA", datetime(2026, 9, 10).date()).verdict == "hit"
    dropped = adapter.check("AMD", datetime(2026, 9, 10).date())
    assert (dropped.verdict, dropped.reason) == ("miss", "dropped_at_stage_2")


def test_a_pre_open_call_is_judged_against_the_prior_session():
    assert replay.replay_session(_call(stated_at_et="2026-09-11T08:30:00-04:00")).isoformat() == "2026-09-10"
    assert replay.replay_session(_call(stated_at_et="2026-09-11T10:00:00-04:00")).isoformat() == "2026-09-11"
    assert replay.replay_session(_call(stated_at_et="2026-09-13T00:00:00-04:00",
                                       stated_at_precision="day")).isoformat() == "2026-09-11"


@pytest.fixture
def patterns(tmp_path):
    start = int(datetime(2026, 9, 9, 1, 0, tzinfo=ET).timestamp())
    seen = int(datetime(2026, 9, 10, 2, 0, tzinfo=ET).timestamp())
    late = int(datetime(2026, 9, 11, 1, 0, tzinfo=ET).timestamp())
    return _db(tmp_path / "patterns.db", """
        CREATE TABLE pattern_detections (sym TEXT, tf TEXT, pattern_id TEXT, end_t INTEGER, confidence REAL,
                                         detected_at INTEGER, last_seen_at INTEGER);
    """, [
        ("INSERT INTO pattern_detections VALUES (?,?,?,?,?,?,?)", ("NVDA", "D", "bull_flag", 20260909, 80, start, seen)),
        ("INSERT INTO pattern_detections VALUES (?,?,?,?,?,?,?)", ("AMD", "D", "vcp", 20260910, 70, late, late)),
    ])


def test_detections_inside_retention_are_judged_by_end_t_and_last_seen(patterns, vocab):
    adapter = replay.PatternDetections(patterns, now=datetime(2026, 9, 12, 12, tzinfo=ET))
    day = datetime(2026, 9, 10).date()
    hit = adapter.check("NVDA", day)
    assert (hit.verdict, hit.setups) == ("hit", ["bull_flag"])
    assert adapter.check("AMD", day).verdict == "miss"          # first detected after the session ended


def test_a_session_outside_the_120_day_prune_or_before_the_store_floor_is_unproven(patterns):
    old = replay.PatternDetections(patterns, now=datetime(2027, 3, 1, 12, tzinfo=ET)).check(
        "NVDA", datetime(2026, 9, 10).date())
    assert (old.verdict, old.reason) == ("unproven", "outside_120d_retention")
    early = replay.PatternDetections(patterns, now=datetime(2026, 9, 12, 12, tzinfo=ET)).check(
        "NVDA", datetime(2026, 9, 1).date())
    assert (early.verdict, early.reason) == ("unproven", "before_store_floor")


def test_a_scan_hit_counts_only_beside_its_coverage_receipt(tmp_path):
    path = _db(tmp_path / "screener.db", """
        CREATE TABLE scan_hits (def_hash TEXT, tf TEXT, as_of INTEGER, ticker TEXT, value REAL);
        CREATE TABLE scan_coverage (def_hash TEXT, tf TEXT, as_of INTEGER);
    """, [
        ("INSERT INTO scan_hits VALUES (?,?,?,?,?)", ("h1", "D", 20260910, "NVDA", None)),
        ("INSERT INTO scan_hits VALUES (?,?,?,?,?)", ("h2", "D", 20260910, "AMD", None)),   # no receipt for h2
        ("INSERT INTO scan_coverage VALUES (?,?,?)", ("h1", "D", 20260910)),
        ("INSERT INTO scan_hits VALUES (?,?,?,?,?)", ("h1", "D", 20260909, "NVDA", None)),  # no receipt that day
    ])
    adapter = replay.ScanHits(path)
    assert adapter.check("NVDA", datetime(2026, 9, 10).date()).verdict == "hit"
    assert adapter.check("AMD", datetime(2026, 9, 10).date()).verdict == "miss"
    unproven = adapter.check("NVDA", datetime(2026, 9, 9).date())
    assert (unproven.verdict, unproven.reason) == ("unproven", "no_scan_coverage_receipt")


def test_uct20_compositions_rank_by_list_order_and_unproven_without_an_entry(tmp_path):
    path = tmp_path / "uct20.json"
    path.write_text(json.dumps([{"date": SESSION, "holdings": ["MSFT", "NVDA"]}]), encoding="utf-8")
    adapter = replay.Uct20Compositions(str(path))
    hit = adapter.check("NVDA", datetime(2026, 9, 10).date())
    assert (hit.verdict, hit.rank, hit.top_n) == ("hit", 2, 20)
    assert adapter.check("AMD", datetime(2026, 9, 10).date()).verdict == "miss"
    assert adapter.check("NVDA", datetime(2026, 9, 9).date()).reason == "no_composition_for_date"


def test_captured_candidates_before_the_archive_exists_are_unproven():
    assert replay.CapturedCandidates(lambda f, d: None).check("NVDA", datetime(2026, 9, 10).date()).reason \
        == "capture_archive_missing"

    def boom(family, day):
        raise RuntimeError("R2 unconfigured")

    assert replay.CapturedCandidates(boom).check("NVDA", datetime(2026, 9, 10).date()).reason \
        == "capture_archive_unreachable:RuntimeError"
    payload = {"payload": {"candidates": {"pullback_ma": [{"ticker": "NVDA", "setup_type": "PULLBACK_MA"}]}}}
    hit = replay.CapturedCandidates(lambda f, d: payload).check("NVDA", datetime(2026, 9, 10).date())
    assert (hit.verdict, hit.setups) == ("hit", ["PULLBACK_MA"])


def test_catalysts_and_verdicts_read_their_published_rows(tmp_path):
    cat = _db(tmp_path / "catalysts.db", "CREATE TABLE catalysts (market_date TEXT, ticker TEXT, rank INTEGER, tag TEXT);", [
        ("INSERT INTO catalysts VALUES (?,?,?,?)", (SESSION, "NVDA", 4, "Catalyst")),
        ("INSERT INTO catalysts VALUES (?,?,?,?)", (SESSION, "AMD", None, "News")),
    ])
    pv = _db(tmp_path / "pv.db", "CREATE TABLE pattern_verdicts (ticker TEXT, tf TEXT, setup TEXT, asof_date TEXT, confirmed INTEGER);", [
        ("INSERT INTO pattern_verdicts VALUES (?,?,?,?,?)", ("NVDA", "D", "bull_flag", SESSION, 1)),
        ("INSERT INTO pattern_verdicts VALUES (?,?,?,?,?)", ("AMD", "D", "vcp", SESSION, 0)),
    ])
    day = datetime(2026, 9, 10).date()
    assert replay.Catalysts(cat).check("NVDA", day).rank == 4
    assert replay.Catalysts(cat).check("AMD", day).verdict == "miss"      # dropped from the ranked list
    assert replay.PatternVerdicts(pv).check("NVDA", day).setups == ["bull_flag"]
    assert replay.PatternVerdicts(pv).check("AMD", day).verdict == "miss"  # judged, not confirmed


def test_level_verdicts_is_the_single_authority_and_reads_only_what_it_is_given():
    assert replay.level_verdicts([], "v:x")["any"]["reason"] == "not_replayed"
    checks = [{"source": "a", "verdict": "hit", "rank": None, "top_n": None, "vocab_id": None},
              {"source": "b", "verdict": "unproven", "rank": None, "top_n": 20, "vocab_id": None}]
    levels = replay.level_verdicts(checks, "v:x")
    assert levels["any"]["verdict"] == "hit"
    assert levels["topn"]["verdict"] == "unproven"          # the ranked source proved nothing
    assert levels["setup"]["verdict"] == "unproven"         # the only hit has no mapped setup
