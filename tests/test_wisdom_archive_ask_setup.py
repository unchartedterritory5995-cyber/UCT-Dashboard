"""Ask AI's SETUP CONTEXT block over the TSDR archive (api/services/wisdom/archive/ask_setup.py).

SYNTHETIC data only — the repo is public: invented tickers (ZZT*), invented notes, the six team
author ids from docs/wisdom/authors.json and nothing a member wrote.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. resolution: a setup named by id, name, stored alias, vocabulary alias or team slang not
   resolving; a plural or hyphenated form missing; "EP" matching inside a word or in lower case;
   a bucket id or a vocabulary alias shared by two setups resolving;
2. the block saying "measured" below |z| >= 3 on 30+ scored calls, or not saying it above;
3. a price on a call 20 sessions old or newer, or no price on an older one;
4. the prompt changing, or wisdom.db being opened, while either gate is off;
5. an item without a citation, the budget exceeded, a record's verbatim quote leaking, or a
   teaching carrying a price or a date.
"""
from __future__ import annotations

from datetime import date

import pytest

from api.services.wisdom.archive import ask_setup, askai, service
from api.services.wisdom.core import store

TODAY = date(2026, 10, 16)
QUOTE_MARKER = "VERBATIMQUOTEMARKER"


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    ask_setup.clear_cache()


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    monkeypatch.setenv("WISDOM_ARCHIVE_ASK_ENABLED", "1")


def _stats(n, z, *, edge=0.3, win=0.56, med=0.012):
    return {"n": n, "n_scored": n, "win20": win, "med_r20": 0.01, "mean_r20": 0.02, "med_edge20": med,
            "mean_simR": 0.4, "mean_edgeR": edge, "edgeR_z": z, "thin": n < 30}


def _ex(call_id, ticker, author, posted, r20):
    return {"call_id": call_id, "record_id": call_id.split("#")[0], "ticker": ticker, "author_id": author,
            "posted": posted, "direction": "long", "action": "entry", "evidence": "synthetic", "r20": r20,
            "sim_R": 1.0, "regime": "uptrend"}


def _setup(sid, name, *, family=None, aliases=(), stats=None, context=None, teachings=(), winners=(),
           failures=()):
    return {"setup_id": sid, "name": name, "family": family, "aliases": list(aliases),
            "used_by": ["tsdr", "bracco"], "stats": stats or _stats(140, 1.4), "stats_trades": _stats(60, 1.0),
            "context": context or {}, "teachings": list(teachings), "winners": list(winners),
            "failures": list(failures)}


def _seed(*, long_teachings: bool = False):
    lp_teach = [
        {"record_id": "t9201", "author_id": "bracco", "date": "2025-03-04",
         "note": "synthetic lesson: buy the launch pad over $12.50 on 2025-03-04 after a tight coil"},
        {"record_id": "t9202", "author_id": "tsdr", "date": "2025-04-05", "note": "synthetic: let the pad set up"},
        {"record_id": "t9203", "author_id": "manrav", "date": "2025-05-06", "note": "synthetic: volume should dry up"},
        {"record_id": "t9204", "author_id": "tsdr", "date": "2025-06-07", "note": "synthetic: a fourth teaching"},
    ]
    if long_teachings:
        lp_teach = [{**t, "note": t["note"] + " padding" * 60} for t in lp_teach]
    setups = [
        _setup("launch_pad", "Launch Pad", family="breakout base", aliases=["pad base"],
               stats=_stats(140, 3.4, edge=0.4),
               context={"market": {"downtrend": _stats(40, 0.8), "uptrend": _stats(90, 3.1)}},
               teachings=lp_teach,
               winners=[_ex("t9210#0", "ZZTA", "tsdr", "2026-06-01", 0.12),
                        _ex("t9211#0", "ZZTB", "manrav", "2026-10-14", 0.05)],
               failures=[_ex("t9212#0", "ZZTC", "bracco", "2025-02-03", -0.05)]),
        _setup("oops", "Oops Reversal", family="reversal", stats=_stats(140, 1.4),
               context={"market": {"downtrend": _stats(35, 3.5, edge=0.6)}},
               teachings=[{"record_id": "t9205", "author_id": "bracco", "date": "2025-01-02",
                           "note": "synthetic: the oops needs a gap below the prior low"}]),
        _setup("flat_top_breakout", "Flat Top Breakout", family="breakout",
               winners=[_ex("t9220#0", "ZZTD", "tsdr", "2025-05-05", 0.2),
                        _ex("t9221#0", "ZZTE", "bracco", "2025-06-06", 0.1)]),
        _setup("go_signal", "Go Signal", stats=_stats(20, 4.0)),
        _setup("ep", "EP"),
        _setup("peg_flag", "Power earnings gap flag"),
        _setup("undercut_reclaim", "Undercut Reclaim"),
        _setup("other", "Other"),
    ]
    records = [
        {"record_id": "t9230", "author_id": "bracco", "stated_date": "2025-07-01", "record_type": "LESSON",
         "tickers": [], "note": "synthetic lesson on the launch pad: patience until the pad is tight",
         "quote": f"launch pad {QUOTE_MARKER}", "image_count": 0},
        {"record_id": "t9231", "author_id": "tsdr", "stated_date": "2025-08-01", "record_type": "CALL",
         "tickers": ["ZZTA"], "note": "synthetic launch pad call record", "quote": "", "image_count": 0},
        {"record_id": "t9232", "author_id": "manrav", "stated_date": "2025-09-01", "record_type": "LESSON",
         "tickers": [], "note": "synthetic lesson about risk on every concept trade", "quote": "",
         "image_count": 0},
    ]
    calls = [
        {"call_id": "t9210#0", "record_id": "t9210", "author_id": "tsdr", "ticker": "ZZTA", "direction": "long",
         "setup": "launch_pad", "posted": "2026-06-01T14:00:00", "entry": 12.34, "stop": 11.11,
         "outcome": {"r20": 0.12}},
        {"call_id": "t9211#0", "record_id": "t9211", "author_id": "manrav", "ticker": "ZZTB", "direction": "long",
         "setup": "launch_pad", "posted": "2026-10-14T14:00:00", "entry": 45.67, "stop": 44.44,
         "outcome": {"r20": 0.05}},
        {"call_id": "t9212#0", "record_id": "t9212", "author_id": "bracco", "ticker": "ZZTC", "direction": "long",
         "setup": "launch_pad", "posted": "2025-02-03T14:00:00", "entry": 7.89, "outcome": {"r20": -0.05}},
        {"call_id": "t9222#0", "record_id": "t9222", "author_id": "tsdr", "ticker": "ZZTF", "direction": "long",
         "setup": "flat_top_breakout", "posted": "2025-07-07T14:00:00", "outcome": {"r20": 0.3}},
    ]
    with store.write() as conn:
        for kind, items in (("setups", setups), ("records", records), ("calls", calls)):
            out = service.upsert_batch(conn, kind, items)
            assert out["rejected"] == 0, out


def _resolve(text):
    with store.read() as conn:
        return ask_setup.resolve_setups(conn, text, limit=3)


# ── 1. resolution ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text, want", [
    ("how does the team trade launch pads?", "launch_pad"),
    ("what is a launchpad", "launch_pad"),
    ("thoughts on the launch-pad base", "launch_pad"),
    ("what is a go signal?", "go_signal"),
    ("does the oops reversal work in a downtrend?", "oops"),
    ("is a baby oops worth taking", "oops"),                     # the vocabulary's alias
    ("show me examples of TSDR flat-top breakouts", "flat_top_breakout"),
    ("how do you trade a U&R", "undercut_reclaim"),               # team slang, short caps
    ("what's a high tight flag", None),                          # slang for a setup the store lacks
    ("does the EP still work", "ep"),
])
def test_setup_names_aliases_and_slang_resolve(wisdom_db, on, text, want):
    _seed()
    got = _resolve(text)
    assert got == ([want] if want else []), (text, got)


@pytest.mark.parametrize("text", [
    "step by step, how deep is this pullback",       # 'ep' inside words
    "ep 3 of the podcast",                           # lower-case 'ep' is prose, not the acronym
    "is PEG a buy here",                             # a real ticker, not the power-earnings-gap setup
    "any other ideas for the watchlist",             # bucket ids never resolve
    "what about an ER gap up",                       # a vocabulary alias two archive setups share
    "",
])
def test_no_false_hits(wisdom_db, on, text):
    _seed()
    assert _resolve(text) == [], text


def test_the_longest_overlapping_name_wins(wisdom_db, on):
    _seed()
    with store.read() as conn:
        assert ask_setup.resolve_setups(conn, "flat top breakout or launch pad", limit=3) == [
            "flat_top_breakout", "launch_pad"]


def test_the_definition_names_only_an_exactly_mapped_vocabulary_entry(wisdom_db, on):
    """flat_top_breakout maps to range_breakout with mismatch 1: calling it a Range Breakout would
    state a definition the vocabulary itself says is approximate. launch_pad maps exactly."""
    _seed()
    ft, _ = ask_setup.setup_block("what is a flat top breakout", today=TODAY)
    assert "Range Breakout" not in ft and "[SETUP · Flat Top Breakout · setup flat_top_breakout]" in ft
    lp, _ = ask_setup.setup_block("what is a launch pad", today=TODAY)
    assert "also called Launchpad" in lp


def test_regime_and_trader_detection():
    assert ask_setup.regime_named("does it work in a downtrend?") == "downtrend"
    assert ask_setup.regime_named("in a bear market") == "downtrend"
    assert ask_setup.regime_named("during an uptrend") == "uptrend"
    assert ask_setup.regime_named("in a choppy tape") == "mixed"
    assert ask_setup.regime_named("how do you trade it") is None
    assert ask_setup.trader_named("examples of TSDR flat-tops") == "tsdr"
    assert ask_setup.trader_named("what does Bracco think") == "bracco"
    assert ask_setup.trader_named("what does the team think") is None


# ── 2-3, 5. block contents ───────────────────────────────────────────────────

def test_a_strong_record_reads_measured_and_a_weak_one_not_proven(wisdom_db, on):
    _seed()
    strong, _ = ask_setup.setup_block("how does the team trade launch pads?", today=TODAY)
    assert "[RECORD · setup launch_pad]" in strong and "measured edge" in strong
    assert "n 140 scored calls" in strong and "20d win rate 56%" in strong and "median vs same stock +1.2%" in strong
    weak, _ = ask_setup.setup_block("how does the team trade an oops reversal?", today=TODAY)
    assert "not proven" in weak and "measured" not in weak, weak
    thin, _ = ask_setup.setup_block("what is a go signal?", today=TODAY)   # z 4.0 on only 20 calls
    assert "not proven" in thin and "measured" not in thin, thin


def test_the_regime_cut_appears_only_when_the_question_names_one(wisdom_db, on):
    _seed()
    text, cites = ask_setup.setup_block("does the oops reversal work in a downtrend?", today=TODAY)
    assert "[REGIME · QQQ downtrend · setup oops]" in text and "n 35 scored calls" in text
    assert "measured edge" in text                                  # the cut itself clears the bar
    assert any(c["kind"] == "trader_archive_setup_regime" and c["regime"] == "downtrend" for c in cites)
    plain, _ = ask_setup.setup_block("how does the team trade an oops reversal?", today=TODAY)
    assert "[REGIME" not in plain
    none_cut, _ = ask_setup.setup_block("does the oops reversal work in an uptrend?", today=TODAY)
    assert "no scored calls of this setup in a QQQ uptrend" in none_cut


def test_level_kinds_follow_the_family(wisdom_db, on):
    _seed()
    lp, _ = ask_setup.setup_block("how does the team trade launch pads?", today=TODAY)
    assert "prior-day low or the 20 EMA" in lp and "10-day range high" in lp
    oops, _ = ask_setup.setup_block("how does the team trade an oops reversal?", today=TODAY)
    assert "the 10 EMA or the prior-day low" in oops and "10-day range high" not in oops


def test_prices_appear_only_on_calls_older_than_twenty_sessions(wisdom_db, on):
    _seed()
    text, cites = ask_setup.setup_block("show me launch pad examples", today=TODAY)
    assert "[CALL · TSDR · 2026-06-01 · t9210] ZZTA long, r20 +12.0%" in text
    assert "entry 12.34" in text and "stop 11.11" in text                     # aged: 90+ sessions
    assert "ZZTB" in text and "45.67" not in text and "44.44" not in text     # 2 sessions old
    assert "7.89" in text                                                     # the aged failure
    examples = [c for c in cites if c["kind"] == "trader_archive_setup_example"]
    assert 2 <= len(examples) <= ask_setup.MAX_EXAMPLES
    for c in examples:
        assert c["record_id"] and c["trader"] and c["date"] and c["ticker"]


def test_a_named_trader_gets_their_own_examples(wisdom_db, on):
    _seed()
    text, cites = ask_setup.setup_block("show me examples of TSDR flat-top breakouts", today=TODAY)
    traders = {c["trader"] for c in cites if c["kind"] == "trader_archive_setup_example"}
    assert traders == {"TSDR"}, cites
    assert "ZZTD" in text and "ZZTF" in text and "ZZTE" not in text            # ZZTF via the fallback read


def test_teachings_are_capped_scrubbed_and_cited(wisdom_db, on):
    _seed()
    text, cites = ask_setup.setup_block("how does the team trade launch pads?", today=TODAY)
    teach = [c for c in cites if c["kind"] == "trader_archive_setup_teaching"]
    assert [c["record_id"] for c in teach] == ["t9201", "t9202", "t9203"]       # MAX_TEACHINGS = 3
    assert "t9204" not in text
    assert "$12.50" not in text and "12.50" not in text and "2025-03-04 after" not in text
    assert "[TEACHING · Bracco · 2025-03-04 · t9201] synthetic lesson: buy the launch pad over" in text


def test_lessons_come_from_LESSON_posts_and_never_the_quote(wisdom_db, on):
    _seed()
    text, cites = ask_setup.setup_block("how does the team trade launch pads?", today=TODAY)
    lessons = [c for c in cites if c["kind"] == "trader_archive_setup_lesson"]
    assert "t9230" in {c["record_id"] for c in lessons}
    assert "t9231" not in {c["record_id"] for c in lessons}                   # a CALL record is not a lesson
    assert QUOTE_MARKER not in text
    assert len(lessons) <= ask_setup.MAX_LESSONS


def test_every_item_is_cited_and_the_block_is_bounded(wisdom_db, on):
    _seed(long_teachings=True)
    text, cites = ask_setup.setup_block("does the launch pad work in a downtrend? show TSDR examples",
                                        today=TODAY)
    assert text.startswith(ask_setup.HEADER)
    assert len(text) <= askai.MAX_BLOCK_CHARS
    items = text[len(ask_setup.HEADER):].split(" | ")
    assert len(items) == len(cites), (len(items), len(cites))
    for item, cite in zip(items, cites):
        assert item.startswith("["), item
        assert cite.get("record_id") or cite.get("setup"), cite
        assert cite["flag_env"] == "WISDOM_ARCHIVE_ASK_ENABLED"


def test_nothing_resolved_is_absent_and_a_concept_question_gets_lessons_only(wisdom_db, on):
    _seed()
    assert ask_setup.setup_block("zzzunmatched words here", today=TODAY) == ("", [])
    assert ask_setup.setup_block("how do you think about risk", question_type="other") == ("", [])
    text, cites = ask_setup.setup_block("how do you think about risk", question_type="concept-education")
    assert "t9232" in text and {c["kind"] for c in cites} == {"trader_archive_setup_lesson"}


# ── 4. the gates, through Ask AI ─────────────────────────────────────────────

def _stub_router(monkeypatch, *, setup_gap: bool = False):
    import api.routers.ai_search as ai
    from api.services import ai_search_dossier, ai_search_log, ai_search_memory

    def uct(q):
        meta = ai._empty_meta()
        meta["query_tickers"] = []
        ctx = "CTX"
        if setup_gap:
            meta["grounding_gaps"] = [ai.SETUP_GAP]
            ctx += " " + ai._desk_gaps_sentence(meta["grounding_gaps"])
        return ctx, "salt0", meta

    monkeypatch.setattr(ai, "_uct_context", uct)
    monkeypatch.setattr(ai, "_brain_context", lambda q, t, v: "")
    monkeypatch.setattr(ai, "_wisdom_context", lambda q, m: ("", []))
    monkeypatch.setattr(ai_search_memory, "retrieve_context", lambda *a, **k: "")
    monkeypatch.setattr(ai_search_dossier, "maybe_run", lambda: None)
    monkeypatch.setattr(ai_search_log, "classify_question_type", lambda q: "other")
    return ai


Q = "how does the team trade a launch pad?"


def test_ask_flag_off_leaves_the_prompt_byte_identical(wisdom_db, on, monkeypatch):
    _seed()
    ai = _stub_router(monkeypatch)
    monkeypatch.delenv("WISDOM_ARCHIVE_ASK_ENABLED", raising=False)
    base = ai._grounded_system(Q)
    monkeypatch.setenv("WISDOM_ARCHIVE_ASK_ENABLED", "0")
    assert ai._grounded_system(Q) == base
    assert ask_setup.HEADER not in base[0] and "[PLAYBOOK · Launch Pad]" in base[0]   # the old block, intact


def test_archive_flag_off_opens_no_store_whatever_the_ask_flag(wisdom_db, monkeypatch):
    _seed()
    ai = _stub_router(monkeypatch)
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")
    monkeypatch.delenv("WISDOM_ARCHIVE_ASK_ENABLED", raising=False)
    base = ai._grounded_system(Q)
    opened: list = []

    def recorder(*_a, **_k):
        opened.append(1)
        raise AssertionError("wisdom.db opened with the archive gate off")

    monkeypatch.setattr(store, "read", recorder)
    monkeypatch.setenv("WISDOM_ARCHIVE_ASK_ENABLED", "1")
    assert ai._grounded_system(Q) == base
    assert opened == []
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")                # control: the recorder can see a read
    ai._grounded_system(Q)
    assert opened


def test_both_flags_on_add_the_block_once_cited_and_salted(wisdom_db, on, monkeypatch):
    _seed()
    ai = _stub_router(monkeypatch, setup_gap=True)
    system, salt, meta = ai._grounded_system(Q)
    assert system.count(ask_setup.HEADER) == 1
    assert "[PLAYBOOK ·" not in system                       # the record is said once, in the setup block
    assert salt.endswith(ask_setup.SALT_SUFFIX)
    assert "trader_archive" in meta["grounding_sources"]
    assert any(c["kind"].startswith("trader_archive_setup") for c in meta["archive_citations"])
    assert ai.SETUP_GAP not in meta["grounding_gaps"] and ai.SETUP_RECORD_NOTE in system
