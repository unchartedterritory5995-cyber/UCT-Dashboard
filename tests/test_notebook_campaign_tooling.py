"""Rails for the Task 11.21 Step 4 campaign tooling (tools/notebook_campaign/): the two refusals, the
persona file against the plan's own table, the sentences against their sources, and the pure helpers the
verdicts and the defect ledger are built from. No browser, no sandbox, no api import."""
import json
import re
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools" / "notebook_campaign"))
import run_campaign as rc  # noqa: E402
import seed_members as sm  # noqa: E402

PLAN = REPO / "docs" / "superpowers" / "plans" / "2026-10-24-notebook-widgets-p2-w11.md"
SPEC = json.loads((REPO / "tools" / "notebook_campaign" / "personas.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("path", [r"C:\data", r"C:\DATA\auth.db", r"c:\data\sub", "/data", "/data/x"])
def test_the_shared_data_root_is_refused(path):
    assert sm.refuse_shared_root(path)


@pytest.mark.parametrize("path", [r"C:\data-nbw-campaign", r"C:\Users\x\data", r"C:\database"])
def test_a_sandbox_dir_is_not_refused(path):
    assert sm.refuse_shared_root(path) is None


@pytest.mark.parametrize("base", ["https://uctintelligence.com", "http://uctintelligence.com:8131",
                                  "http://10.0.0.5:8131", "http://localhost.evil.example", "ftp://127.0.0.1"])
def test_a_non_local_base_is_refused(base):
    assert rc.refuse_non_local(base)


@pytest.mark.parametrize("base", ["http://127.0.0.1:8131", "http://localhost:8131/", "http://[::1]:8131"])
def test_a_local_base_is_allowed(base):
    assert rc.refuse_non_local(base) is None


def plan_rows() -> dict:
    """Pnn -> (persona, exercises), parsed from the plan's 50-persona table (the authority)."""
    rows = {}
    for line in PLAN.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\| (P\d\d) \| (.+?) \| (.+?) \|$", line)
        if m:
            rows[m[1]] = (m[2], m[3])
    return rows


def test_fifty_personas_in_the_plans_order_each_exercising_its_plan_row():
    rows = plan_rows()
    assert len(rows) == 50
    ids = [p["id"] for p in SPEC["personas"]]
    assert ids == [f"P{n:02d}" for n in range(1, 51)]
    for p in SPEC["personas"]:
        assert p["exercises"] == rows[p["id"]][1], p["id"]


def test_every_persona_has_a_unique_email_and_at_least_one_script_step():
    emails = [p["email"] for p in SPEC["personas"]]
    assert len(set(emails)) == 50
    for p in SPEC["personas"]:
        assert p["scripts"] and all(s["steps"] for s in p["scripts"]), p["id"]


def test_every_step_names_an_action_the_runner_has():
    for p in SPEC["personas"]:
        for s in p["scripts"]:
            for st in s["steps"]:
                assert st["do"] in rc.ACTIONS, (p["id"], st["do"])


def test_every_sentence_a_step_names_is_in_the_catalogue():
    keys = set(SPEC["sentences"])
    for p in SPEC["personas"]:
        for s in p["scripts"]:
            for st in s["steps"]:
                for k in (st.get("expect") or []) + (st.get("expect_absent") or []) + (st.get("expect_public") or []):
                    assert k in keys, (p["id"], k)
                for f in ("live_startswith", "live_not_startswith"):
                    if f in st:
                        assert st[f] in keys


def test_every_in_tree_sentence_is_still_in_its_source():
    """A sentence is quoted from its source, never typed as a second authority: its fragment must be in the
    file it names. Sources on another branch are read with git by the runner and, if absent, reported."""
    got = rc.verify_sentences(SPEC, REPO)
    local = [k for k, s in SPEC["sentences"].items() if not s["source"].startswith("origin/")]
    assert local
    bad = {k: got[k]["why"] for k in local if not got[k]["ok"]}
    assert not bad, bad


def test_a_drifted_sentence_is_refused(tmp_path):
    spec = {"sentences": {"x": {"text": "Not in the file.", "source": "README.md:1"}}}
    (tmp_path / "README.md").write_text("Something else.\n", encoding="utf-8")
    assert rc.verify_sentences(spec, tmp_path)["x"]["ok"] is False


@pytest.mark.parametrize("text,bad", [("$0 today", ["$0"]), ("0% of trades", ["0%"]), ("Used by 0 traders", ["Used by 0"]),
                                      ("(0)", ["(0)"]), ("NaN", ["NaN"]), ("[object Object]", ["[object Object]"]),
                                      ("0 trades", ["0 trades"])])
def test_zeros_are_found(text, bad):
    assert rc.zeros_in(text) == bad


@pytest.mark.parametrize("text", ["$0.50 fee", "10% of trades", "$1,000", "100 trades", "20:00", "R known on 3 of 10"])
def test_real_numbers_are_not_zeros(text):
    assert rc.zeros_in(text) == []


def test_the_run_verdict_is_never_a_pass_with_a_finding_or_an_inconclusive_step():
    ok = {"verdict": "PASS"}
    assert rc.run_verdict([ok, ok]) == "PASS"
    assert rc.run_verdict([ok, {"verdict": "INCONCLUSIVE"}]) == "INCONCLUSIVE"
    assert rc.run_verdict([ok, {"verdict": "PASS", "findings": [{"kind": "console"}]}]) == "FAIL"
    assert rc.run_verdict([{"verdict": "FAIL"}, {"verdict": "INCONCLUSIVE"}]) == "FAIL"
    assert rc.run_verdict([]) == "INCONCLUSIVE"


def test_defect_ids_continue_the_ledger():
    assert rc.next_defect_ids([], 2) == ["D-W11-001", "D-W11-002"]
    assert rc.next_defect_ids([{"id": "D-W11-007"}, {"id": "x"}], 1) == ["D-W11-008"]


def test_one_defect_seen_twice_is_one_key_and_two_defects_are_two():
    a = rc.defect_key("no serious axe finding", "target-size (79.4px by 22px) aria-controls=\"_r_i_ _r_h_\"")
    b = rc.defect_key("no serious axe finding", "target-size (56.7px by 22px) aria-controls=\"_r_g_ _r_f_\"")
    c = rc.defect_key("no serious axe finding", "color-contrast (2.1:1)")
    assert a == b and a != c


def test_the_js_regex_bridge_keeps_a_case_flag():
    assert rc.js_regex_test("(?i)split by") == 't => new RegExp("split by", "i").test(t)'
    assert rc.js_regex_test("x") == 't => new RegExp("x", "").test(t)'


def test_the_fuzz_corpus_is_read_from_its_rail_not_retyped():
    corpus = sm.fuzz_corpus(REPO)
    assert "a; DROP TABLE j2_trades" in corpus and "q" * 200 in corpus
    assert set(sm.MARKUP) <= set(corpus)
