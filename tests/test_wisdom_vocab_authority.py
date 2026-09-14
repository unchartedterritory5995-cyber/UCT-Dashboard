"""The vocabulary is the one setup-name authority (W1 §3.2; D9; CONTRACTS §6.2).

STANDARD LIBRARY ONLY. .github/workflows/wisdom-rails.yml runs this file with nothing but
pytest installed (--noconftest), so it reads source files as text and never imports them.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a setup-name constant in setupGroups.js, setupCatalog.js, desk _SETUP_TAXONOMY,
   pattern_vision FOCUSED_SETUPS, the voice_chart_vision prompt list, the curriculum
   glossary, or a pattern-engine detector id, with no row in setup-vocabulary-v1.json —
   failing BY NAME ("never a seventh list": a new name must be mapped or declared unmapped);
2. a row for a name its list no longer has (a stale row reads as coverage);
3. a row naming a vocab_id the vocabulary does not have, or a mismatch with no reason;
4. the four W1 §3.3 mismatches not recorded as mismatch 1;
5. the vocabulary drifting from the owner's rulings (32 working entries; thin evidence is a
   candidate, everything else approved; owner coinages coined_by tsdr).
CONTROLS: a name that exists only in a comment is not derived, a planted name is named, and
every derivation clears a floor so "nothing missing" cannot come from a blind parser.
"""
from __future__ import annotations

import ast
import json
import os
import pathlib
import re
import sqlite3
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
VOCAB_FILE = REPO / "docs" / "wisdom" / "vocabulary" / "setup-vocabulary-v1.json"


# ── derivations (text only) ──────────────────────────────────────────────────

def strip_js_comments(text: str) -> str:
    out, i, n, quote = [], 0, len(text), None
    while i < n:
        ch = text[i]
        if quote:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in ("'", '"', "`"):
            quote = ch
            out.append(ch)
            i += 1
            continue
        if text.startswith("//", i):
            end = text.find("\n", i)
            i = n if end == -1 else end
            continue
        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


_JS_STRING = re.compile(r"(['\"])((?:\\.|(?!\1).)*)\1")


def setup_groups(path: pathlib.Path) -> list[str]:
    text = strip_js_comments(path.read_text(encoding="utf-8"))
    names: list[str] = []
    for block in re.findall(r"setups:\s*\[(.*?)\]", text, re.S):
        names += [m.group(2) for m in _JS_STRING.finditer(block)]
    return names


def setup_catalog(path: pathlib.Path) -> list[str]:
    text = strip_js_comments(path.read_text(encoding="utf-8"))
    body = text[text.index("SETUP_CATALOG"):]
    return [m.group(2) for m in re.finditer(r"\bname:\s*(['\"])((?:\\.|(?!\1).)*)\1", body)]


def python_list(path: pathlib.Path, name: str) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return [e.value for e in node.value.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)]
    return []


def voice_prompt_list(path: pathlib.Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "_PROMPT_TEMPLATE" for t in node.targets):
            match = re.search(r'from this list, or "none":\s*(.*?)\.\s*\n', node.value.value, re.S)
            if match:
                return [x.strip() for x in match.group(1).replace("\n", " ").split(",")
                        if x.strip() and x.strip() != "none"]
    return []


def glossary_terms(path: pathlib.Path) -> list[str]:
    return [g["term"] for g in json.loads(path.read_text(encoding="utf-8")).get("glossary", [])]


def detector_ids(directory: pathlib.Path) -> list[str]:
    ids = []
    for path in sorted(directory.rglob("*.py")):
        for node in ast.parse(path.read_text(encoding="utf-8")).body:
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "_PATTERN_ID" for t in node.targets) \
                    and isinstance(node.value, ast.Constant):
                ids.append(node.value.value)
    return ids


#: list_name -> (derive(repo_root), floor)
DERIVABLE = {
    "setupGroups.js": (lambda root: setup_groups(root / "app/src/constants/setupGroups.js"), 30),
    "setupCatalog.js": (lambda root: setup_catalog(root / "app/src/pages/modelbook/setupCatalog.js"), 20),
    "desk_SETUP_TAXONOMY": (lambda root: python_list(root / "api/services/desk_session_insights.py", "_SETUP_TAXONOMY"), 20),
    "pv_FOCUSED_SETUPS": (lambda root: python_list(root / "api/services/pattern_vision/rubrics.py", "FOCUSED_SETUPS"), 10),
    "voice_chart_vision": (lambda root: voice_prompt_list(root / "api/services/voice_chart_vision.py"), 15),
    "curriculum_glossary": (lambda root: glossary_terms(root / "docs/curriculum/uct_method_presenter_brief.json"), 30),
    "pattern_engine": (lambda root: detector_ids(root / "api/services/pattern_engine/detectors"), 80),
}
ENGINE_LISTS = ("engine_setup_triggers", "engine_leadership_setup_type", "engine_setup_templates")
W1_MISMATCHES = (  # (list, external name, vocab_id) — W1 §3.3
    ("pattern_engine", "pullback_to_21ema", "20ema_tap"),
    ("setupCatalog.js", "High Volume Edge", "high_volume_close"),
    ("setupCatalog.js", "Flat Base Breakout", "range_breakout"),
    ("setupCatalog.js", "Power Earnings Gap", "earnings_gap_up"),
)


@pytest.fixture(scope="module")
def vocabulary():
    return json.loads(VOCAB_FILE.read_text(encoding="utf-8"))


def missing_rows(vocabulary: dict, list_name: str, names) -> list[str]:
    rows = {r["external_name"] for r in vocabulary["maps"].get(list_name, {}).get("rows", [])}
    return sorted({n for n in names if n not in rows})


# ── 1-3. every name mapped, no stale rows, no unknown ids ────────────────────

@pytest.mark.parametrize("list_name", sorted(DERIVABLE))
def test_every_derivation_clears_its_floor(list_name):
    derive, floor = DERIVABLE[list_name]
    names = derive(REPO)
    assert len(names) >= floor, f"{list_name}: derived {len(names)} names, floor {floor} — the parser went blind"


@pytest.mark.parametrize("list_name", sorted(DERIVABLE))
def test_every_setup_name_constant_has_a_map_row(vocabulary, list_name):
    missing = missing_rows(vocabulary, list_name, DERIVABLE[list_name][0](REPO))
    assert not missing, (
        f"{list_name} names setups the vocabulary has no row for: {missing}. Add a row to "
        "docs/wisdom/vocabulary/setup-vocabulary-v1.json (vocab_id null if it has no entry). "
        "The vocabulary is the one authority (W1 §3.2); a list may not grow around it.")


@pytest.mark.parametrize("list_name", sorted(DERIVABLE))
def test_no_map_row_describes_a_name_its_list_no_longer_has(vocabulary, list_name):
    names = set(DERIVABLE[list_name][0](REPO))
    stale = sorted(r["external_name"] for r in vocabulary["maps"][list_name]["rows"] if r["external_name"] not in names)
    assert not stale, f"{list_name}: rows for names the list no longer has: {stale}"


def test_every_row_names_a_known_vocab_id_and_every_mismatch_says_why(vocabulary):
    known = {e["vocab_id"] for e in vocabulary["entries"]}
    assert set(vocabulary["maps"]) == set(DERIVABLE) | set(ENGINE_LISTS)
    for list_name, spec in vocabulary["maps"].items():
        names = [r["external_name"] for r in spec["rows"]]
        assert len(names) == len(set(names)), f"{list_name}: a duplicated row"
        for row in spec["rows"]:
            assert row["vocab_id"] is None or row["vocab_id"] in known, (list_name, row)
            assert row["mismatch"] in (0, 1), (list_name, row)
            if row["mismatch"]:
                assert row["vocab_id"] and (row.get("note") or "").strip(), (list_name, row)


def test_the_w1_mismatches_are_recorded(vocabulary):
    for list_name, external, vocab_id in W1_MISMATCHES:
        row = next(r for r in vocabulary["maps"][list_name]["rows"] if r["external_name"] == external)
        assert (row["vocab_id"], row["mismatch"]) == (vocab_id, 1), row
        assert "W1 §3.3" in row["note"]


def test_the_engine_lists_are_declared_measured_and_mapped(vocabulary):
    for list_name in ENGINE_LISTS:
        spec = vocabulary["maps"][list_name]
        assert spec["derivable_in_ci"] is False and spec["measured"]["at"] and spec["rows"], list_name


def test_the_engine_strings_still_have_rows_when_the_engine_db_is_reachable(vocabulary):
    engine_db = os.environ.get("WISDOM_ENGINE_DB", "")
    if not engine_db or not pathlib.Path(engine_db).is_file():
        pytest.skip("set WISDOM_ENGINE_DB to uct_intelligence.db to re-measure (tools/wisdom/core_vocab_engine_check.py)")
    conn = sqlite3.connect(pathlib.Path(engine_db).resolve().as_uri() + "?mode=ro", uri=True)
    try:
        queries = {"engine_setup_triggers": "SELECT DISTINCT setup_name FROM setup_triggers",
                   "engine_leadership_setup_type": "SELECT DISTINCT setup_type FROM leadership_snapshots",
                   "engine_setup_templates": "SELECT DISTINCT name FROM setup_templates"}
        for list_name, sql in queries.items():
            strings = {(r[0] or "").strip() for r in conn.execute(sql)} - {""}
            assert strings, list_name
            assert not missing_rows(vocabulary, list_name, strings), list_name
    finally:
        conn.close()


# ── 5. the vocabulary follows the owner's rulings ────────────────────────────

def test_the_vocabulary_follows_the_w1_rulings(vocabulary):
    entries = vocabulary["entries"]
    assert len(entries) == 32
    assert len({e["vocab_id"] for e in entries}) == 32 and len({e["name"].casefold() for e in entries}) == 32
    kinds = [e["kind"] for e in entries]
    assert (kinds.count("setup"), kinds.count("level"), kinds.count("market_signal")) == (23, 5, 4)
    for entry in entries:
        expected = "candidate" if entry["evidence_strength"] == "thin" else "approved"
        assert entry["status"] == expected, entry["name"]
        assert entry["status_reason"].strip(), entry["name"]
    coined = {e["name"] for e in entries if e.get("coined_by") == "tsdr"}
    assert coined == {"Theme Hot Potato", "Mid-Range Pivot", "Brian Shannon Special", "Kill Bar"}


def test_ambiguous_aliases_are_exactly_the_shared_spellings(vocabulary):
    owners: dict = {}
    for entry in vocabulary["entries"]:
        for alias in entry.get("aliases", []):
            owners.setdefault(alias.casefold(), set()).add(entry["vocab_id"])
    assert sorted(a for a, o in owners.items() if len(o) > 1) == vocabulary["ambiguous_aliases"]


# ── controls ─────────────────────────────────────────────────────────────────

def test_a_name_only_in_a_comment_is_not_derived_and_a_planted_name_is_named(vocabulary, tmp_path):
    source = (REPO / "app/src/constants/setupGroups.js").read_text(encoding="utf-8")
    planted = source.replace("'VCP',", "'VCP',\n      // 'Commented Setup',\n      /* 'Block Comment Setup', */\n      'Brand New Setup',", 1)
    assert planted != source, "the control's anchor moved; re-derive it"
    path = tmp_path / "setupGroups.js"
    path.write_text(planted, encoding="utf-8")
    names = setup_groups(path)
    assert "Commented Setup" not in names and "Block Comment Setup" not in names
    assert missing_rows(vocabulary, "setupGroups.js", names) == ["Brand New Setup"]


def test_a_planted_constant_is_named_in_every_source_shape(vocabulary, tmp_path):
    desk = tmp_path / "desk.py"
    desk.write_text('_SETUP_TAXONOMY = ["Bull Flag", "Planted Desk Setup"]\n', encoding="utf-8")
    assert missing_rows(vocabulary, "desk_SETUP_TAXONOMY", python_list(desk, "_SETUP_TAXONOMY")) == ["Planted Desk Setup"]
    detectors = tmp_path / "detectors" / "uct"
    detectors.mkdir(parents=True)
    (detectors / "planted.py").write_text('"""_PATTERN_ID = "docstring_only"."""\n_PATTERN_ID = "planted_detector"\n',
                                          encoding="utf-8")
    assert missing_rows(vocabulary, "pattern_engine", detector_ids(tmp_path / "detectors")) == ["planted_detector"]
    brief = tmp_path / "brief.json"
    brief.write_text(json.dumps({"glossary": [{"term": "Remount"}, {"term": "Planted Term"}]}), encoding="utf-8")
    assert missing_rows(vocabulary, "curriculum_glossary", glossary_terms(brief)) == ["Planted Term"]


def test_this_file_imports_only_the_standard_library():
    tree = ast.parse(pathlib.Path(__file__).read_text(encoding="utf-8"))
    tops = {a.name.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
    tops |= {n.module.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.level == 0 and n.module}
    assert tops and not tops - set(sys.stdlib_module_names) - {"pytest"}
