"""Rails over the user-study kit (wave 9, lane 9C, items C1 and C8).

Every fact here is READ from the file that owns it — the plan's §1 table, the kit's own
tables, the flag derivation in `api/routers/auth.py`, the scorer's CORE tuple, the study
notebook on disk — never retyped into this test. A list typed here would be a third
authority over a fact two files already disagree about the moment one of them moves.
"""
from __future__ import annotations

import ast
import importlib.util
import pathlib
import re
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
KIT = ROOT / "docs" / "notebook" / "user-study-kit.md"
PLAN = ROOT / "docs" / "notebook" / "NOTEBOOK-10-OF-10-PLAN.md"
STUDY = ROOT / "docs" / "notebook" / "user-study"
NOTEBOOK = STUDY / "study-notebook"
AUTH = ROOT / "api" / "routers" / "auth.py"


def _section(text: str, heading_prefix: str) -> str:
    """The body of the `## <prefix>…` section, up to the next `## `."""
    lines = text.splitlines()
    start = next(i for i, ln in enumerate(lines) if ln.startswith("## " + heading_prefix))
    end = next((j for j in range(start + 1, len(lines)) if lines[j].startswith("## ")), len(lines))
    return "\n".join(lines[start:end])


def _cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def plan_standards() -> set[int]:
    """The standard numbers in the plan's §1 scorecard table, parsed."""
    body = _section(PLAN.read_text(encoding="utf-8"), "1. The scorecard")
    return {int(m.group(1)) for m in re.finditer(r"^\| (\d+) \| \*\*", body, re.M)}


def kit_tasks() -> dict[str, dict]:
    """`{"T1": {core, prompt, success, standard}}` from the kit's task table."""
    body = _section(KIT.read_text(encoding="utf-8"), "4. Tasks")
    out = {}
    for ln in body.splitlines():
        if re.match(r"^\| \d+ \|", ln):
            c = _cells(ln)
            out[f"T{c[0]}"] = {"core": c[1] == "core", "prompt": c[2], "success": c[3],
                               "standard": c[4]}
    return out


def eligibility_rows() -> dict[str, list[str]]:
    body = _section(KIT.read_text(encoding="utf-8"), "5. Task eligibility")
    return {_cells(ln)[0]: _cells(ln) for ln in body.splitlines() if re.match(r"^\| T\d+ \|", ln)}


# ── C1: the kit ─────────────────────────────────────────────────────────────

def test_the_reads_are_not_empty():
    """⭐ NON-VACUITY: every parse below returns what the files really hold."""
    assert plan_standards() == set(range(1, 17))
    assert list(kit_tasks()) == [f"T{i}" for i in range(1, 11)]
    assert len(eligibility_rows()) == 10


def test_every_task_names_a_standard_the_plan_has():
    standards = plan_standards()
    for t, row in kit_tasks().items():
        named = {int(n) for n in re.findall(r"#(\d+)", row["standard"])}
        assert named, f"{t} names no standard"
        assert named <= standards, f"{t} names {sorted(named - standards)}, not in the plan's §1"


def test_every_task_has_an_eligibility_row():
    assert set(eligibility_rows()) == set(kit_tasks())
    for t, cells in eligibility_rows().items():
        assert len(cells) == 4 and all(cells), f"{t}'s eligibility row has an empty column: {cells}"


def test_the_results_section_has_exactly_eight_participant_rows():
    body = _section(KIT.read_text(encoding="utf-8"), "7. Results")
    rows = [_cells(ln)[0] for ln in body.splitlines() if re.match(r"^\| P\d+ \|", ln)]
    assert rows == [f"P{i}" for i in range(1, 9)]


def test_the_core_tasks_are_the_ruled_ones_and_the_scorer_agrees():
    kit_core = tuple(t for t, row in kit_tasks().items() if row["core"])
    assert kit_core == ("T1", "T2", "T4", "T6", "T8")          # ruling D-9C6
    spec = importlib.util.spec_from_file_location("nss", ROOT / "tools" / "notebook_study_score.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["nss"] = mod
    spec.loader.exec_module(mod)
    assert mod.CORE == kit_core, "the scorer and the kit disagree about which tasks are core"


def test_the_decision_rule_names_every_core_task():
    rule = _section(KIT.read_text(encoding="utf-8"), "8. Decision rule")
    for t, row in kit_tasks().items():
        if row["core"]:
            assert re.search(rf"\b{t}\b", rule), f"the decision rule does not name core task {t}"
    assert "80% sentence" not in rule and "every** task is U for at least 80%" not in rule


def _auth_payload_keys() -> set[str]:
    """Every `notebook_*` key the auth payload carries at this HEAD — the Railway
    variable names read by AST from `NOTEBOOK_FLAGS` / `NOTEBOOK_MODE_FLAGS`, lowered
    exactly as `_notebook_flag_key` does."""
    tree = ast.parse(AUTH.read_text(encoding="utf-8"))
    keys = set()
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in
                                                ("NOTEBOOK_FLAGS", "NOTEBOOK_MODE_FLAGS")
                                                for t in node.targets):
            keys |= {k.value.lower() for k in node.value.keys if isinstance(k, ast.Constant)}
    return keys


def test_every_flag_key_the_preflight_reads_exists_or_is_marked_PLANNED():
    live = _auth_payload_keys()
    assert "notebook_ask_insert_on" in live and "notebook_offline_default_on" in live
    # ⚰️ The first version matched only `notebook_x` standing ALONE in backticks, so a
    # pre-flight written as `notebook_x: true` — the form the check column uses — was
    # never read, and a guessed key there passed. Found by this rail's own mutation
    # proof (a typo'd `notebook_ask_insert: true` stayed green). A key is now read
    # whether or not a value follows it.
    seen = 0
    for t, cells in eligibility_rows().items():
        for key in set(re.findall(r"`(notebook_[a-z_]+)(?::[^`]*)?`", " ".join(cells))):
            seen += 1
            assert key in live or "PLANNED" in " ".join(cells), (
                f"{t}'s pre-flight reads `{key}`, which the auth payload does not carry at this "
                "HEAD and the row does not mark PLANNED")
    assert seen >= 3, "the read found fewer flag keys than T1, T7 and T8 name"
    # ⭐ and the CHECK column itself is read, not only the needs column
    t7_check = eligibility_rows()["T7"][2]
    assert re.findall(r"`(notebook_[a-z_]+)(?::[^`]*)?`", t7_check) == ["notebook_ask_insert_on"]


def test_the_recruit_post_lives_in_ONE_file_and_asks_for_6_to_8():
    post = "Looking for 6–8 traders"
    assert post in (STUDY / "screener.md").read_text(encoding="utf-8")
    assert post not in KIT.read_text(encoding="utf-8")
    assert "**6–8 traders**" in _section(KIT.read_text(encoding="utf-8"), "1. Recruitment")


def test_the_consent_form_is_marked_as_a_draft_needing_the_owner():
    text = " ".join((STUDY / "consent.md").read_text(encoding="utf-8").split())
    assert "DRAFT — owner approval required" in text
    for needle in ("30 days", "P1 to P8", "keep the thank-you", "never records what you write"):
        assert needle in text, needle


def test_every_task_has_an_observable_silent_failure_check():
    guide = (STUDY / "facilitator-guide.md").read_text(encoding="utf-8")
    rows = {_cells(ln)[0]: _cells(ln)[1] for ln in guide.splitlines()
            if re.match(r"^\| T\d+ \| [A-Z*]", ln) and "U / H" not in ln}
    assert set(rows) == set(kit_tasks()), sorted(rows)
    for t, check in rows.items():
        assert "?" not in check, f"{t}'s check is a question to the participant, not an action"
        assert re.search(r"\*\*[A-Za-z]", check), f"{t}'s check names no action: {check}"


# ── C8: the study notebook ──────────────────────────────────────────────────

FRONT = re.compile(r"\A---\n(.*?)\n---\n(.+)\Z", re.S)
ALLOWED_KEYS = {"title", "tags"}
MONTHS = ("January|February|March|April|May|June|July|August|September|October|November|"
          "December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec")
WEEKDAYS = "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday"
FORBIDDEN = {
    "a cashtag or a dollar sign": re.compile(r"\$"),
    "an ISO date": re.compile(r"\b\d{4}-\d{2}-\d{2}\b"),
    "a slash date": re.compile(r"\b\d{1,2}/\d{1,2}(/\d{2,4})?\b"),
    "a year": re.compile(r"\b(19|20)\d{2}\b"),
    "a month name": re.compile(rf"\b({MONTHS})\b"),
    "a weekday": re.compile(rf"\b({WEEKDAYS})\b"),
    "a relative day": re.compile(r"\b(today|tomorrow|yesterday|tonight)\b", re.I),
    "an @-mention": re.compile(r"(^|\s)@\w"),
}
ALL_CAPS = re.compile(r"\b[A-Z]{2,}\b")


def _notes() -> dict[pathlib.Path, dict]:
    out = {}
    for p in sorted(NOTEBOOK.rglob("*")):
        if p.is_file():
            text = p.read_text(encoding="utf-8").replace("\r\n", "\n")
            m = FRONT.match(text)
            fields = {}
            if m:
                for ln in m.group(1).splitlines():
                    k, _, v = ln.partition(":")
                    fields[k.strip()] = v.strip()
            out[p] = {"text": text, "match": m, "fields": fields,
                      "title": fields.get("title", "").strip('"'),
                      "body": m.group(2) if m else ""}
    return out


def test_the_set_is_about_twelve_markdown_notes_with_unique_titles():
    notes = _notes()
    assert 10 <= len(notes) <= 14, len(notes)
    assert all(p.suffix == ".md" for p in notes), [p.name for p in notes if p.suffix != ".md"]
    titles = [n["title"] for n in notes.values()]
    assert len(set(titles)) == len(titles)


def test_each_file_parses_as_front_matter_plus_markdown():
    for p, n in _notes().items():
        assert n["match"], f"{p.name}: no `---` front matter block at byte 0"
        assert set(n["fields"]) <= ALLOWED_KEYS, f"{p.name}: front matter keys {sorted(n['fields'])}"
        assert n["title"], f"{p.name}: no title"
        assert n["fields"].get("tags", "").startswith("["), f"{p.name}: tags are not a list"
        assert n["body"].strip(), f"{p.name}: empty body"


def test_every_title_the_task_table_names_exists_in_the_set():
    named = set()
    for row in kit_tasks().values():
        named |= set(re.findall(r"‘([^’]+)’", row["prompt"]))
    assert len(named) >= 4, named                       # T4's one + T5's three, at least
    titles = {n["title"] for n in _notes().values()}
    assert named <= titles, f"the kit names titles the set does not carry: {sorted(named - titles)}"


def test_T7s_ticker_is_in_exactly_one_note_and_no_other_note_has_an_uppercase_word():
    [ticker] = [w for w in ALL_CAPS.findall(kit_tasks()["T7"]["prompt"]) if w != "I"]
    notes = _notes()
    carrying = [p for p, n in notes.items() if ticker in ALL_CAPS.findall(n["text"])]
    assert len(carrying) == 1, carrying
    for p, n in notes.items():
        if p in carrying:
            assert set(ALL_CAPS.findall(n["text"])) == {ticker}, ALL_CAPS.findall(n["text"])
        else:
            assert not ALL_CAPS.findall(n["text"]), (p.name, ALL_CAPS.findall(n["text"]))


@pytest.mark.parametrize("what", sorted(FORBIDDEN))
def test_the_set_arms_nothing(what):
    """No cashtag, no ticker field, no date: nothing an import could turn into an
    alert or a 07:00 reminder (wave 8's own rule for its sample, D-C6)."""
    hits = [(p.name, m.group(0)) for p, n in _notes().items()
            for m in FORBIDDEN[what].finditer(n["text"])]
    assert not hits, f"{what}: {hits}"


def test_no_note_carries_the_tag_T5_asks_for():
    """T5's success is that the participant tagged three notes 'earnings'; a note that
    already carried it would make the outcome unattributable."""
    for p, n in _notes().items():
        assert "earnings" not in n["fields"].get("tags", ""), p.name


def test_the_forbidden_scan_would_see_what_it_forbids():
    """⭐ CONTROL: every pattern fires on a line written to break it."""
    samples = {"a cashtag or a dollar sign": "buy $NVDA", "an ISO date": "on 2026-10-01",
               "a slash date": "by 10/14", "a year": "back in 2021", "a month name": "in March",
               "a weekday": "every Monday", "a relative day": "Tomorrow I will",
               "an @-mention": "ask @someone"}
    assert set(samples) == set(FORBIDDEN)
    for what, line in samples.items():
        assert FORBIDDEN[what].search(line), what
