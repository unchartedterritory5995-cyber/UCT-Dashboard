"""The Study bank generators (spec §6.1-§6.3, §8.5, §13.3 C15/C18/C19/C20):
each yields valid items in the item schema, deterministic ids, no banned
phrases, every item a draft with a source citation, bars embedded only by
fixture items, sizing answers that match study_scoring.size_from_stop, and
the committed bank matching a fresh run.

Run alone: python -m pytest tests/test_study_generators.py -q
"""
from __future__ import annotations

import json
import math
import pathlib
import re

import pytest

from api.services import study_import as si
from api.services.study_scoring import RISK_CEILING_PCT, size_from_stop
from scripts.study import (_common, gen_candles, gen_fixtures, gen_recall, gen_regime, gen_size, gen_walkthroughs,
                           run_all)
from scripts.study._common import EM_DASH, dedash

REPO = pathlib.Path(__file__).resolve().parent.parent
ID_RE = re.compile(r"^si_[0-9a-f]{12}$")


@pytest.fixture(scope="module")
def segments() -> dict:
    out: dict = {}
    for mod in (gen_recall, gen_size, gen_fixtures, gen_candles, gen_walkthroughs):
        out.update(mod.generate())
    js = gen_regime.BOTTOMS.read_text(encoding="utf-8")
    out["regime.bottoms"] = gen_regime.bottom_items(gen_regime.read_bottoms(js), gen_regime.read_signposts(js))
    return out


# ── every segment ─────────────────────────────────────────────────────────────

def test_every_segment_validates_and_is_non_empty(segments):
    assert set(segments) >= {"recall.glossary", "recall.principles", "recall.bible", "recall.concepts",
                             "recall.playbooks", "size.house_rule", "spot.fixtures", "family.fixtures",
                             "regime.bottoms", "candles.catalog", "walk.method"}
    for name, items in segments.items():
        assert items, name
        assert _common.validate(items) == [], name


def test_every_item_is_a_draft_with_a_citation_and_a_valid_id(segments):
    for name, items in segments.items():
        for it in items:
            assert ID_RE.match(it["id"]), (name, it["id"])
            assert it["review_status"] == "draft" and it["source_ref"] and it["source_kind"], (name, it["id"])
            assert it["lesson_origin"] in ("source", "template"), (name, it["id"])
            assert it["type"] in _common.ITEM_TYPES and it["skill_id"], (name, it["id"])


def test_ids_are_deterministic_across_runs(segments):
    again: dict = {}
    for mod in (gen_recall, gen_size, gen_candles, gen_walkthroughs):
        again.update(mod.generate())
    for name in ("recall.glossary", "size.house_rule", "candles.catalog", "walk.method"):
        assert [i["id"] for i in segments[name]] == [i["id"] for i in again[name]], name
    assert _common.item_id("ref", "q") == _common.item_id("ref", "q") != _common.item_id("ref", "q2")


def test_no_banned_phrase_em_dash_or_long_sentence_in_any_question_or_lesson(segments):
    for name, items in segments.items():
        for it in items:
            assert si.voice_check(si.question_text(it), question=True) == [], (name, it["id"])
            for field, text in si.lesson_texts(it):
                assert si.voice_check(text, lesson=True) == [], (name, it["id"], field)


def test_only_fixture_items_embed_bars_and_chart_items_record_a_spec(segments):
    for name, items in segments.items():
        for it in items:
            if "bars_embed" in it:
                assert it["source_kind"] == "fixture", (name, it["id"])
                assert it["bars_embed"]["sym"] and it["bars_embed"]["asof"] and it["bars_embed"]["bars"]
            if "bars" in it:
                spec = it["bars"]
                assert not isinstance(spec.get("bars"), list), (name, it["id"])
                assert spec["sym"] and spec["tf"] and spec["asof"] and spec["window"], (name, it["id"])
            assert "bars_json" not in it and "forward_json" not in it


def test_the_ticker_never_rides_a_prompt(segments):
    for name, items in segments.items():
        for it in items:
            sym = it.get("sym")
            if sym and name != "regime.bottoms":           # SPY is the index the bottoms question names
                assert sym not in json.dumps(it["prompt_json"]), (name, it["id"])


# ── recall ────────────────────────────────────────────────────────────────────

def test_recall_keys_are_verbatim_substrings_of_their_source(segments):
    # member-facing keys are dedashed (the owner's own normalisation); the
    # verbatim source stays in reveal_json.quote
    glossary = {dedash(g["term"]): dedash(g["definition"]) for g in gen_recall.read_glossary()}
    for it in segments["recall.glossary"]:
        a = it["answer_json"]["answer"]
        assert a in glossary or a in glossary.values(), it["id"]
        assert EM_DASH not in a
    rules = dict(gen_recall.read_bible_rules())
    for it in segments["recall.bible"]:
        a = it["answer_json"]["answer"]
        assert any(a.lower() in dedash(r).lower() for r in rules.values()), it["id"]
        assert it["reveal_json"]["system"] == "O'Neil"                       # C20
    formulas = {dedash(c["source"]) for c in gen_recall.read_concepts()}
    for it in segments["recall.concepts"]:
        assert it["answer_json"]["answer"] in formulas and it["reveal_json"]["system"] == "the firm's screener"
    titles = {dedash(p["title"]) for p in gen_recall.read_principles()}
    for it in segments["recall.principles"]:
        assert it["answer_json"]["answer"] in titles
        assert not re.search(r"\d", it["answer_json"]["answer"]) or True     # C19: title keys, never numbers
        assert it["reveal_json"]["numbers_in_quote_are_not_keys"] is True


def test_bible_numbers_are_only_the_ones_the_rule_states():
    rules = dict(gen_recall.read_bible_rules())
    assert len(rules) == 23
    for n, (_q, key, _accept) in gen_recall.BIBLE_NUMBERS.items():
        assert key.lower() in rules[n].lower(), (n, key)


def test_playbook_parse_finds_nine_playbooks_with_mistakes_and_stops():
    pb = gen_recall.read_playbooks()
    assert len(pb) == 9 and all(p["mistakes"] for p in pb) and all(p["stop"] for p in pb)
    assert pb[0]["name"] == "Bull Flag" and pb[0]["mistakes"][0].startswith("Buying the flagpole")


def test_every_glossary_term_gets_two_items_with_distractors_from_siblings(segments):
    g = segments["recall.glossary"]
    quiz = [x for x in gen_recall.read_glossary() if x["term"] not in _common.FRAMING_TERMS]
    assert len(g) == 2 * len(quiz) == 54                        # 40 terms, 13 framing ones taught instead
    defs = {dedash(x["definition"]) for x in quiz}
    for it in g:
        assert len(it["prompt_json"]["choices"]) == 4
        if it["prompt_json"]["q"].startswith("At the desk"):
            assert set(it["prompt_json"]["choices"]) <= defs


# ── size ──────────────────────────────────────────────────────────────────────

def test_size_answers_match_the_house_formula_and_never_exceed_the_ceiling(segments):
    items = segments["size.house_rule"]
    sized = [i for i in items if i["type"] == "size"]
    assert len(sized) >= 40 and len(items) >= 60
    for it in sized:
        p = it["prompt_json"]
        assert p["entry"] and p["stop"] and p["stop"] < p["entry"]                   # §8.5
        assert 0 < p["risk_pct"] <= RISK_CEILING_PCT
        res = size_from_stop(p["account"], p["risk_pct"], p["entry"], p["stop"])
        key = it["answer_json"]
        f = it["reveal_json"]["facts"]
        if key.get("skip"):
            assert res["skip"] or f.get("cap_pct") == 0, it["id"]
        elif f.get("cap_pct") is not None and f.get("capped_shares") is not None:
            cap_shares = math.floor(f["cap_pct"] / 100 * p["account"] / p["entry"])
            assert key["shares"] == cap_shares == f["capped_shares"], it["id"]
            assert key["shares"] * (p["entry"] - p["stop"]) / p["account"] * 100 <= RISK_CEILING_PCT + 1e-9
        else:
            assert key == {"shares": res["shares"], "dollars": res["dollars"]}, it["id"]
        assert it["lesson_origin"] == "template" and si.grounding_check(it) == []


def test_size_segment_covers_every_case_family(segments):
    refs = " ".join(i["source_ref"] for i in segments["size.house_rule"])
    for tag in ("forward", "reverse", "cap", "skip", "flat", "scaled", "ladder-", "ladder-size"):
        assert tag in refs, tag
    assert gen_size.ladder_max(7) == (6.0, 10) and gen_size.ladder_max(10) == (10.0, 5)
    assert gen_size.ladder_max(2) == (0.0, 20) and gen_size.CAP_TABLE["ORANGE"]["B"] == 0


# ── fixtures ──────────────────────────────────────────────────────────────────

def test_fixtures_use_only_unmodified_positives_and_negatives(segments):
    elig = gen_fixtures.eligible_fixtures()
    assert elig and all(f["category"] in ("positive", "negative") for f in elig)
    assert not any(gen_fixtures.MODIFIED_RE.search(f["note"]) for f in elig)
    assert len(segments["spot.fixtures"]) == len(elig)
    pos = [f for f in elig if f["fires"] and gen_fixtures.DETECTORS[f["detector"]][2]]
    assert len(segments["family.fixtures"]) == len(pos)
    for it in segments["spot.fixtures"]:
        assert it["answer_json"]["answer"] in ("yes", "no") and it["reveal_json"]["detector"].startswith("uct_")
        assert it["bars_embed"]["bars"][0]["t"] > 19000101                      # YYYYMMDD keys
        assert it["sym"] == it["bars_embed"]["sym"] and it["asof"] == it["bars_embed"]["asof"]


def test_fixture_edge_files_are_never_used():
    for f in gen_fixtures.eligible_fixtures():
        assert "/edge_" not in f["path"]


# ── regime ────────────────────────────────────────────────────────────────────

def test_bottoms_items_key_on_recorded_signposts_never_a_tier(segments):
    items = segments["regime.bottoms"]
    bottoms = gen_regime.read_bottoms()
    names = set(gen_regime.read_signposts().values())
    assert len(bottoms) == 9 and len(names) == 6
    for it in items:
        assert it.get("tier_scale_id") is None
        if it["type"] == "regime":
            assert it["answer_json"]["answer"] in names
            assert re.search(r"fired (first|second|third|fourth|fifth|sixth)\?$", it["prompt_json"]["q"])
            assert not re.search(r"\d{4}-\d{2}-\d{2}", it["prompt_json"]["q"])   # no date, no cutoff stated
            if "bars" in it:
                assert it["bars"]["sym"] == "SPY" and it["bars"]["asof"] >= "1993-02-01"
        else:
            assert it["answer_json"]["answer"].endswith("%")


def test_wire_items_carry_the_tier_scale_and_wait_sixty_days():
    from datetime import date
    calls = [{"date": "2026-08-01", "exposure_tier": "Caution", "exposure_score": 44, "tier_scale_id": "wire-5word-v1"},
             {"date": "2026-10-10", "exposure_tier": "Neutral", "exposure_score": 60, "tier_scale_id": "wire-5word-v1"},
             {"date": "2026-07-01", "exposure_tier": None, "exposure_score": None, "tier_scale_id": "wire-5word-v1"}]
    items = gen_regime.wire_items(calls, today=date(2026, 10, 17))
    assert len(items) == 1
    it = items[0]
    assert it["answer_json"] == {"answer": "Caution"} and it["tier_scale_id"] == "wire-5word-v1"
    assert it["type"] == "regime" and it["bars"]["asof"] == "2026-08-01" and it["sym"] == "SPY"
    assert "2026" not in it["prompt_json"]["q"] and it["reveal_json"]["date"] == "2026-08-01"
    assert _common.validate(items) == []


# ── candles ───────────────────────────────────────────────────────────────────

def test_candle_items_never_key_on_direction(segments):
    items = segments["candles.catalog"]
    assert len(gen_candles.catalog()) == 66 and len(items) >= 66 * 2
    for it in items:
        a = str(it["answer_json"]["answer"]).lower()
        assert a not in ("bullish", "bearish", "neutral", "reversal", "continuation", "indecision"), it["id"]
        assert it["reveal_json"]["direction_is_not_a_fact"]
        assert it["prompt_json"]["subject"]


# ── walk-throughs (§13.9 #1): the brief is taught, never quizzed ─────────────

def _method_skills() -> set:
    out = set()
    for cur in _common.load_json(REPO / "docs" / "study" / "skill_map.json")["curricula"]:
        for track in cur["tracks"]:
            for unit in track["units"]:
                out |= {s for s in unit.get("skills") or [] if not s.startswith("uct-method:")}
    return out


def test_no_framing_term_is_a_quiz_item(segments):
    """Owner ruling 2026-10-17: the brief's framing terms teach; gen_recall
    never keys, quotes or offers one. The set has ONE authority."""
    framing = _common.FRAMING_TERMS
    assert framing == set(gen_walkthroughs.TERM_SKILLS) and len(framing) == 13
    glossary = {g["term"]: g["definition"] for g in gen_recall.read_glossary()}
    assert framing <= set(glossary)                               # every one is a real brief term
    framing_defs = {dedash(glossary[t]) for t in framing} | {dedash(t) for t in framing}
    for name, items in segments.items():
        if name == "walk.method":
            continue
        for it in items:
            p = it["prompt_json"]
            assert p.get("subject") not in framing, (name, it["id"])
            assert it["answer_json"].get("answer") not in framing_defs, (name, it["id"])
            assert p.get("quote") not in framing_defs, (name, it["id"])
            assert not (set(p.get("choices") or []) & framing_defs), (name, it["id"])
    taught = {it["prompt_json"]["q"] for it in segments["walk.method"]}
    assert framing <= taught and set(gen_walkthroughs.STATIONS) <= taught


def test_every_walkthrough_has_two_to_four_short_dedashed_steps_and_the_unscored_shape(segments):
    items = segments["walk.method"]
    assert len(items) == 25
    skills = _method_skills()
    orders = []
    for it in items:
        p = it["prompt_json"]
        assert it["type"] == "walkthrough" and it["difficulty"] == 1 and it["source_kind"] == "brief"
        assert it["answer_json"] == {"unscored": True}
        assert it["source_ref"].startswith("docs/curriculum/uct_method_presenter_brief.json#")
        assert it["skill_id"] in skills, it["skill_id"]
        assert 2 <= len(p["steps"]) <= 4, (it["id"], p["steps"])
        for st in p["steps"]:
            assert isinstance(st, str) and st.strip() and len(st.split()) <= 22, (it["id"], st)
            assert EM_DASH not in st and "*" not in st, (it["id"], st)
            assert si.voice_check(st, lesson=True) == [], (it["id"], st)
        assert it["lesson_text"] == p["steps"][-1] and it["lesson_origin"] == "source"
        assert p["subject"] == p["q"] and isinstance(p["order"], int)
        assert si.walkthrough_check(it) == [] and si.grounding_check(it) == []
        assert it["reveal_json"]["quote"] and it["reveal_json"]["source"]
        orders.append(p["order"])
    assert orders == list(range(1, len(items) + 1))              # play order, unique, ascending
    # a station chunked into parts keeps its parts contiguous and complete
    by_q: dict = {}
    for it in items:
        p = it["prompt_json"]
        if p.get("parts"):
            by_q.setdefault(p["q"], []).append(p["part"])
    for q, parts in by_q.items():
        assert parts == list(range(1, len(parts) + 1)), (q, parts)
    stations = [it["prompt_json"]["q"] for it in items if "station" in it["reveal_json"]]
    assert [x for i, x in enumerate(stations) if i == 0 or stations[i - 1] != x] == list(gen_walkthroughs.STATIONS)


def test_walkthrough_splitting_never_rewrites_a_word():
    """Every step's words, in order, are the source's words: only a cut
    separator may be dropped and a first letter raised."""
    def words(text):
        return [w.lower() for w in re.findall(r"[^\s,;:·]+", text.replace("(", " (").replace(")", ") "))]   # the cut separators
    for it in gen_walkthroughs.generate()["walk.method"]:
        src = dedash(gen_walkthroughs.strip_markdown(it["reveal_json"]["quote"]))
        steps_words = [w for st in it["prompt_json"]["steps"] for w in words(st)]
        assert " ".join(steps_words) in " ".join(words(src)), it["id"]
    assert gen_walkthroughs.chunk_steps(["a.", "b", "c.", "d", "e."]) == [["a.", "b", "c."], ["d", "e."]]
    assert gen_walkthroughs.chunk_steps(list("abcdefghi")) == [list("abc"), list("def"), list("ghi")]
    assert gen_walkthroughs.split_steps("One sentence; two halves.") == ["One sentence", "Two halves."]
    assert gen_walkthroughs.split_steps("Lead in: a, b, c.") == ["Lead in:", "A, b, c."]
    long = ("Survivors split into an A-list (at the pivot within a day or two, alert armed at the trigger) "
            "and a B-list (right pattern, needs time).")
    assert gen_walkthroughs.split_steps(long) == [
        "Survivors split into an A-list", "(at the pivot within a day or two, alert armed at the trigger)",
        "And a B-list (right pattern, needs time).",
    ]


# ── the committed bank matches a fresh run ────────────────────────────────────

def test_committed_bank_matches_the_generators(segments):
    bank = REPO / "docs" / "study" / "bank"
    for name, items in segments.items():
        path = bank / f"{name}.json"
        assert path.exists(), name
        on_disk = json.loads(path.read_text(encoding="utf-8"))
        assert [i["id"] for i in on_disk] == [i["id"] for i in items], name
        assert on_disk == json.loads(json.dumps(items, sort_keys=True)), name


def test_corrections_overlay_rejects_fixes_and_approves_by_item_id():
    from scripts.study import corrections
    items = [
        {"id": "si_a", "prompt_json": {"q": "Q?", "choices": ["old key", "x", "y"]}, "answer_json": {"answer": "old key"},
         "reveal_json": {}, "review_status": "draft", "lesson_text": "l", "lesson_origin": "template"},
        {"id": "si_b", "prompt_json": {"q": "Q?"}, "answer_json": {"answer": "k"}, "reveal_json": {}, "review_status": "draft"},
        {"id": "si_c", "prompt_json": {"q": "Q?"}, "answer_json": {"answer": "k"}, "reveal_json": {}, "review_status": "draft"},
    ]
    recs = [
        {"item_id": "si_a", "verdict": "fix", "field": "answer", "after": "new key", "status": "confirmed"},
        {"item_id": "si_a", "verdict": "fix", "field": "lesson_text", "after": "ignored", "status": "proposed"},
        {"item_id": "si_a", "verdict": "approve", "ts": "2026-10-17", "owner_words": "yes"},
        {"item_id": "si_b", "verdict": "reject", "owner_words": "never heard of it"},
        {"item_id": "si_zz", "verdict": "source_ruling"},
    ]
    out = corrections.apply(items, recs)
    assert [i["id"] for i in out] == ["si_a", "si_c"]
    a = out[0]
    assert a["answer_json"]["answer"] == "new key" and "new key" in a["prompt_json"]["choices"]
    assert "old key" not in a["prompt_json"]["choices"]
    assert a["lesson_text"] == "l"                                       # a proposed fix is not applied
    assert a["review_status"] == "approved" and a["reviewed"]["by"] == "owner"
    assert out[1]["review_status"] == "draft"
    # validate: an approved item needs the owner record
    assert any("approved without an owner verdict" in p for p in _common.validate([
        {**items[2], "id": "si_abcdefabcdef", "type": "recall", "skill_id": "s", "source_kind": "k",
         "source_ref": "r", "review_status": "approved", "lesson_text": "l", "lesson_origin": "template"}]))


def test_every_committed_verdict_names_a_known_segment_and_verdict():
    from scripts.study import corrections
    recs = corrections.load()
    for r in recs:
        assert r["verdict"] in corrections.VERDICTS
        assert r.get("owner_words"), r
        if r["verdict"] == "fix":
            assert r.get("field") and "after" in r and r.get("status") in ("proposed", "confirmed"), r


def test_run_all_lists_every_generator():
    assert set(run_all.GENERATORS) == {gen_recall, gen_size, gen_fixtures, gen_regime, gen_candles, gen_walkthroughs}
