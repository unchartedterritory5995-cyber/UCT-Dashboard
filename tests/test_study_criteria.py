"""Setup criteria cards (docs/study/setups/CRITERIA_PROGRAMME.md, deliverable 1): the mechanical rail.

Two halves, the same shape as tests/test_study_courses.py:
  1. every card under docs/study/setups/criteria passes `criteria_lib.validate_card` (the pilot, 01-flat-base, by
     name, and every file on disk);
  2. the validator catches what it claims to catch: each rule fails a planted defect in a copy of the pilot, and the
     glossary and decisions checks run only when their registers exist (a checker that answers "no" to everything
     would pass half 1 trivially).
"""
from __future__ import annotations

import copy
import json
import re
import pathlib
import shutil

import pytest

from scripts.study import criteria_lib as crit

PILOT = crit.CRITERIA_DIR / "01-flat-base.json"
REAL = crit.card_files()


def _pilot() -> dict:
    return crit.load_card(PILOT)


def _crit(card: dict, cid: str) -> dict:
    return next(c for c in card["criteria"] if c["id"] == cid)


# ── half 1: the real files ───────────────────────────────────────────────────────────────────────────────────────

def test_pilot_card_validates_with_zero_errors():
    assert PILOT.is_file()
    assert crit.validate_file(PILOT) == []


@pytest.mark.parametrize("path", REAL, ids=[p.stem for p in REAL] or None)
def test_every_card_file_validates(path):
    assert crit.validate_file(path) == []


def test_pilot_is_utf8_lf_indent_1():
    raw = PILOT.read_bytes()
    assert b"\r\n" not in raw
    text = raw.decode("utf-8")
    assert text.startswith("{\n \"setup\"")
    assert json.loads(text)["setup"] == "01-flat-base"


def test_pilot_covers_the_brief():
    card = _pilot()
    by_field = {}
    for c in card["criteria"]:
        by_field[c["field"]] = by_field.get(c["field"], 0) + 1
    assert set(by_field) == set(crit.FIELDS)
    assert {la["setup"] for la in card["lookalikes"]} >= {"06-vcp", "04-cup-handle", "03-high-tight-flag"}
    assert {s["kind"] for s in card["question_seeds"]} == set(crit.SEED_KINDS)
    assert len(card["question_seeds"]) >= 12
    pending = [c for c in card["criteria"] if c["status"] == "pending-owner"]
    assert pending and all(re.fullmatch(r"D-\d{3}", c["owner_question"]) for c in pending)
    # the scan's three measured lines are on the card as evidence
    assert "39.2%" in _crit(card, "fb.breakout_volume")["evidence"]
    assert "NOT better" in _crit(card, "fb.depth")["evidence"]
    assert "no difference" in _crit(card, "fb.ceiling_touches")["evidence"]
    assert "no difference" in _crit(card, "fb.base_volume_dry")["evidence"]


# ── half 2: the validator catches what it claims ─────────────────────────────────────────────────────────────────

def test_registers_are_read():
    rules = crit.house_rule_ids()
    assert {"A3", "A13", "B19", "B26", "C31", "D42", "E52", "F63"} <= rules
    assert "G70" not in rules
    srcs = crit.dossier_source_ids(crit.REPO / "docs/study/setups/research/01-flat-base.md")
    assert {"S1", "S4", "S12", "S18", "S24", "S30"} <= srcs
    assert "S31" not in srcs


def _drop_measure(d):
    _crit(d, "fb.depth").pop("measure")


def _bad_source(d):
    _crit(d, "fb.depth")["sources"] = ["S999"]


def _em_dash(d):
    d["card"]["pattern"] = "Five weeks or more sideways — near the highs."


def _one_lookalike(d):
    d["lookalikes"] = d["lookalikes"][:1]


def _long_field(d):
    d["card"]["context"] = " ".join(["word"] * 61)


def _bad_house_rule(d):
    _crit(d, "fb.no_chase")["house_rule"] = "C99"


def _house_rule_without_id(d):
    _crit(d, "fb.no_chase").pop("house_rule")


def _originator_without_sources(d):
    _crit(d, "fb.depth")["sources"] = []


def _bad_basis(d):
    _crit(d, "fb.depth")["basis"] = "vibes"


def _bad_status(d):
    _crit(d, "fb.depth")["status"] = "maybe"


def _pending_without_question(d):
    _crit(d, "fb.depth").pop("owner_question")


def _bad_question_format(d):
    _crit(d, "fb.depth")["owner_question"] = "question 4"


def _question_not_listed(d):
    d["owner_decisions"].remove("D-043")



def _too_few_near_misses(d):
    d["examples"]["near_misses"] = d["examples"]["near_misses"][:2]


def _failure_missing_why(d):
    d["examples"]["failures"][0].pop("why")


def _failure_bad_date(d):
    d["examples"]["failures"][0]["date"] = "March 2024"


def _near_miss_unknown_criterion(d):
    d["examples"]["near_misses"][0]["criterion"] = "fb.no_such_rule"


def _no_sheets(d):
    d["examples"].pop("sheets")


def _bad_id(d):
    _crit(d, "fb.depth")["id"] = "Depth"


def _second_prefix(d):
    _crit(d, "fb.depth")["id"] = "vcp.depth"


def _duplicate_id(d):
    _crit(d, "fb.depth")["id"] = "fb.flat"


def _bad_field(d):
    _crit(d, "fb.depth")["field"] = "shape"


def _recommended_not_an_option(d):
    _crit(d, "fb.depth")["recommended"] = 13


def _option_without_basis(d):
    _crit(d, "fb.depth")["options"][0].pop("basis")


def _lookalike_is_self(d):
    d["lookalikes"][0]["setup"] = "01-flat-base"


def _lookalike_without_dossier(d):
    d["lookalikes"][0]["setup"] = "99-no-such-setup"


def _lookalike_bad_criterion(d):
    d["lookalikes"][0]["criterion"] = "fb.nope"


def _two_seed_kinds(d):
    for s in d["question_seeds"]:
        s["kind"] = "recall" if s["kind"] != "spot" else "spot"


def _seed_bad_criterion(d):
    d["question_seeds"][0]["criterion"] = "fb.nope"


def _empty_grading(d):
    d["grading"]["no_trade"] = []


def _the_firm(d):
    d["mistakes"].append("The firm's rule is the day's low.")


def _bad_trigger(d):
    d["entry_trigger"] = "BREAKOUT"


def _missing_top_key(d):
    d.pop("conflicts")


def _bad_setup_id(d):
    d["setup"] = "flat_base"


def _missing_management(d):
    d["management"].pop("trail")


def _gate_not_bool(d):
    _crit(d, "fb.depth")["gate"] = "yes"


@pytest.mark.parametrize("mutate,expect", [
    (_drop_measure, "carries a number but has no measure"),
    (_bad_source, "source 'S999' is not in the dossier's section 11"),
    (_em_dash, "em-dash"),
    (_one_lookalike, "need at least 2 lookalikes"),
    (_long_field, "card.context is 61 words (max 60)"),
    (_bad_house_rule, "house_rule 'C99' is not in sizing_rule.md section 9"),
    (_house_rule_without_id, "basis is house rule but no house_rule id"),
    (_originator_without_sources, "basis 'originator' needs at least one source"),
    (_bad_basis, "basis must be one of"),
    (_bad_status, "status must be one of"),
    (_pending_without_question, "pending-owner needs an owner_question"),
    (_bad_question_format, "must be D-NNN or a Q-NN-n placeholder"),
    (_question_not_listed, "owner_question D-043 is not listed in owner_decisions"),
    (_too_few_near_misses, "examples.near_misses needs at least 4 entries"),
    (_failure_missing_why, "missing why"),
    (_failure_bad_date, "date must be YYYY-MM-DD"),
    (_near_miss_unknown_criterion, "criterion 'fb.no_such_rule' is not on this card"),
    (_no_sheets, "examples.sheets must name the failures and near_misses sheets"),
    (_bad_id, "id must be <prefix>.<snake>"),
    (_second_prefix, "more than one id prefix"),
    (_duplicate_id, "duplicate id"),
    (_bad_field, "field must be one of"),
    (_recommended_not_an_option, "recommended 13 is not one of the options"),
    (_option_without_basis, "every option needs a value and a basis"),
    (_lookalike_is_self, "must name another setup"),
    (_lookalike_without_dossier, "has no dossier in research/"),
    (_lookalike_bad_criterion, "criterion 'fb.nope' is not in this card"),
    (_two_seed_kinds, "question seeds cover 2 kinds (need 3)"),
    (_seed_bad_criterion, "seed 0: criterion 'fb.nope' is not in this card"),
    (_empty_grading, "grading.no_trade must be a non-empty list"),
    (_the_firm, "never 'the firm'"),
    (_bad_trigger, "entry_trigger must be one of"),
    (_missing_top_key, "missing conflicts"),
    (_bad_setup_id, "must look like 01-flat-base"),
    (_missing_management, "management.trail missing"),
    (_gate_not_bool, "gate must be true or false"),
])
def test_validator_catches(mutate, expect):
    d = copy.deepcopy(_pilot())
    mutate(d)
    probs = crit.validate_card(d, path=PILOT)
    assert any(expect in p for p in probs), probs


def test_file_name_must_match_setup(tmp_path):
    p = tmp_path / "02-wrong.json"
    p.write_text(json.dumps(_pilot()), encoding="utf-8")
    assert any("file must be named 01-flat-base.json" in m for m in crit.validate_file(p))
    bad = tmp_path / "01-flat-base.json"
    bad.write_text("{not json", encoding="utf-8")
    assert any("cannot read" in m for m in crit.validate_file(bad))


def _mini_repo(tmp_path: pathlib.Path) -> pathlib.Path:
    """A repo root holding only what the validator reads: the dossier, the rulebook and the lookalikes' dossiers."""
    root = tmp_path / "repo"
    research = root / crit.RESEARCH_REL
    research.mkdir(parents=True)
    shutil.copy(crit.REPO / "docs/study/setups/research/01-flat-base.md", research / "01-flat-base.md")
    for other in ("06-vcp", "04-cup-handle", "03-high-tight-flag", "29-undercut-rally"):
        (research / f"{other}.md").write_text("# stub\n", encoding="utf-8")
    (root / crit.SIZING_RULE_REL).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(crit.REPO / crit.SIZING_RULE_REL, root / crit.SIZING_RULE_REL)
    return root


def test_glossary_and_decisions_checks_run_only_when_the_registers_exist(tmp_path):
    root = _mini_repo(tmp_path)
    d = copy.deepcopy(_pilot())
    _crit(d, "fb.depth")["glossary"] = "no_such_term"
    _crit(d, "fb.depth")["owner_question"] = "D-004"
    d["owner_decisions"].append("D-004")
    # absent registers: both checks are skipped, nothing else complains
    assert crit.validate_card(d, root) == []
    # the glossary lands with every term the card uses except the planted one (headings and inline markers both count)
    used = sorted({c["glossary"] for c in d["criteria"] if c.get("glossary")} - {"no_such_term"})
    body = "# Glossary\n\n" + "".join(f"### {g}\n\nA term.\n\n" for g in used[:-1])
    body += f"**id:** `{used[-1]}`\n"
    (root / crit.GLOSSARY_REL).write_text(body, encoding="utf-8")
    probs = crit.validate_card(d, root)
    assert probs == ["fb.depth: glossary id 'no_such_term' is not in GLOSSARY.md"]
    assert crit.glossary_ids(root / crit.GLOSSARY_REL) == set(used)
    _crit(d, "fb.depth")["glossary"] = "base_depth"
    assert crit.validate_card(d, root) == []
    # the decisions register lands without D-004
    real = sorted({c["owner_question"] for c in d["criteria"] if c.get("owner_question")} - {"D-004"})
    body = "# Decisions\n\n## D-001 The 21 EMA\n\nSee D-002.\n" + "".join(f"## {x} A decision\n\n" for x in real)
    (root / crit.DECISIONS_REL).write_text(body, encoding="utf-8")
    probs = crit.validate_card(d, root)
    assert any("owner_question 'D-004' is not in DECISIONS.md" in p for p in probs)
    assert crit.decision_ids(root / crit.DECISIONS_REL) == {"D-001", "D-002", *real}
    _crit(d, "fb.depth")["owner_question"] = "D-001"
    d["owner_decisions"].append("D-001")
    assert crit.validate_card(d, root) == []
    # a placeholder is never checked against the register
    _crit(d, "fb.depth")["owner_question"] = "Q-01-4"
    d["owner_decisions"].append("Q-01-4")
    assert crit.validate_card(d, root) == []


def test_missing_dossier_is_one_error_not_a_crash(tmp_path):
    root = _mini_repo(tmp_path)
    d = copy.deepcopy(_pilot())
    d["dossier"] = "docs/study/setups/research/00-nope.md"
    probs = crit.validate_card(d, root)
    assert any("dossier not found" in p for p in probs)


def test_main_reports_every_card(capsys):
    assert crit.main([str(PILOT)]) == 0
    assert "01-flat-base.json: ok" in capsys.readouterr().out
