"""UCT Agent program, agent-qa: the deterministic scorer for agent-sc's SC-1 discovery corpus.

Corpus: api/services/uct_agent/scan/eval/discovery.json (owner agent-sc). Each question gives the screener
criteria the Agent should end up with, in the screener's OWN criteria language, or says it must be refused.
Scored with no model and no network: an INTERPRETER turns the English question into a candidate, and the
candidate is compared with the expected criteria compiled through `screener.grammar.compile_text`.

INTERPRETERS
  oracle          the expected criteria themselves (refusal questions → refused). The CONTROL: must score 100%.
  grammar-direct  the English question handed straight to the screener's deterministic grammar (a GrammarError,
                  or no criteria, counts as a refusal). The BASELINE for "does the Agent need a paid compiler":
                  every question it already answers correctly needs none.

A QUESTION PASSES when all hold:
  * refusal correctness — expect_refusal ⇔ the candidate refused;
  * every expected criterion is matched one-to-one by a candidate criterion on the same field, and there are no
    extra candidate criteria (over-constraining is wrong, not harmless):
      - bounds: the same direction (gt/gte are one lower bound, lt/lte one upper; `between` is both), with the
        threshold within the question's tolerance for that field (`abs` or `pct`), else exact;
      - eq: the same value; in: the same set of values;
  * required_fields ⊆ the candidate's fields, forbidden_fields ∩ them = ∅.
Grouping other than a flat `all` (any / not) is compared structurally and must match exactly.

THE BASELINE IS A MEASUREMENT, NOT PERMISSION (owner, Sprint 1). It is pinned exactly, per question, in
app/src/agent/__fixtures__/program/scores/discovery-baseline.json: a regression fails, AND an improvement fails
until the file is regenerated — so the number never moves without someone looking at why:
    C:\\UCT\\agent\\.venv\\Scripts\\python.exe -m tests.test_uct_agent_qa_scan_corpus --write-baseline
"""
from __future__ import annotations

import copy
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable, Optional

import pytest

REPO = Path(__file__).resolve().parents[1]
CORPUS = REPO / "api" / "services" / "uct_agent" / "scan" / "eval" / "discovery.json"
BASELINE = REPO / "app" / "src" / "agent" / "__fixtures__" / "program" / "scores" / "discovery-baseline.json"
#: questions the owner asked to see called out (numeric units and slang)
SPOTLIGHT = ("d08", "d19", "d22", "d26")
_LOWER, _UPPER = {"gt", "gte"}, {"lt", "lte"}


# ── candidates ──────────────────────────────────────────────────────────────────────────────────────
def compile_criteria(text: str) -> Optional[dict]:
    """The screener's own grammar: text -> logic tree (None when the text has no criteria). Raises on bad text."""
    from api.services.screener import grammar
    out = grammar.compile_text(text)
    return out["logic"]


def oracle(q: dict) -> dict:
    if q.get("expect_refusal"):
        return {"refused": True, "why": "oracle"}
    return {"refused": False, "logic": compile_criteria(q["expect"]["criteria_text"])}


def grammar_direct(q: dict) -> dict:
    try:
        node = compile_criteria(q["question"])
    except ValueError as e:                     # GrammarError is a ValueError, with the screener's sentence
        return {"refused": True, "why": str(e)}
    if node is None:
        return {"refused": True, "why": "no criteria in the text"}
    return {"refused": False, "logic": node}


INTERPRETERS: dict[str, Callable[[dict], dict]] = {"oracle": oracle, "grammar-direct": grammar_direct}
# NOT here, deliberately: `screener.nl_compile.compile_english` is the PAID compiler this corpus exists to judge. Its
# `caller=` seam takes recorded model output, so an owner-approved run can be scored by this same file later,
# offline, without any paid call from a test.


# ── scoring ─────────────────────────────────────────────────────────────────────────────────────────
def _leaves(node: Optional[dict]) -> tuple[list[dict], Optional[str]]:
    """(criteria, structure) — a flat `all` (or one leaf) flattens; anything else is returned as a canonical
    structure string that must match exactly."""
    if node is None:
        return [], None
    if "key" in node:
        return [node], None
    if set(node) == {"all"} and all("key" in c for c in node["all"]):
        return list(node["all"]), None
    return [], json.dumps(node, sort_keys=True)


def _bounds(leaves: list[dict]) -> list[tuple]:
    """Normalised criteria: ('lo'|'hi', key, n) · ('eq', key, v) · ('in', key, frozenset) · ('other', json)."""
    out = []
    for lf in leaves:
        k, op = lf.get("key"), lf.get("op")
        if op in _LOWER:
            out.append(("lo", k, float(lf["min"])))
        elif op in _UPPER:
            out.append(("hi", k, float(lf["max"])))
        elif op == "between":
            out += [("lo", k, float(lf["min"])), ("hi", k, float(lf["max"]))]
        elif op == "eq":
            out.append(("eq", k, lf.get("value")))
        elif op == "in":
            out.append(("in", k, frozenset(map(str, lf.get("values") or []))))
        else:
            out.append(("other", k, json.dumps(lf, sort_keys=True)))
    return out


def _within(tol: Optional[dict], want: float, got: float) -> bool:
    if not tol:
        return want == got
    if "abs" in tol:
        return abs(got - want) <= float(tol["abs"])
    if "pct" in tol:
        return abs(got - want) <= abs(want) * float(tol["pct"]) / 100.0
    return want == got


def score_question(q: dict, cand: dict) -> list[str]:
    """Reasons the candidate fails (empty = the question passes)."""
    if q.get("expect_refusal"):
        return [] if cand.get("refused") else ["answered a question that must be refused"]
    if cand.get("refused"):
        return [f"refused ({cand.get('why', '')[:80]})"]
    want_leaves, want_struct = _leaves(compile_criteria(q["expect"]["criteria_text"]))
    got_leaves, got_struct = _leaves(cand.get("logic"))
    if want_struct or got_struct:
        return [] if want_struct == got_struct else ["criteria grouping differs"]
    errs: list[str] = []
    want, got = _bounds(want_leaves), _bounds(got_leaves)
    tol = q.get("tolerance") or {}
    free = list(got)
    for w in want:
        hit = None
        for g in free:
            if g[0] != w[0] or g[1] != w[1]:
                continue
            if w[0] in ("lo", "hi") and _within(tol.get(w[1]), w[2], g[2]):
                hit = g
            elif w[0] not in ("lo", "hi") and w[2] == g[2]:
                hit = g
            if hit:
                break
        if hit is None:
            errs.append(f"missing or wrong: {w[0]} {w[1]} {sorted(w[2]) if isinstance(w[2], frozenset) else w[2]}")
        else:
            free.remove(hit)
    errs += [f"extra criterion: {g[0]} {g[1]}" for g in free]
    fields = {lf.get("key") for lf in got_leaves}
    errs += [f"required field missing: {f}" for f in q.get("required_fields") or [] if f not in fields]
    errs += [f"forbidden field used: {f}" for f in q.get("forbidden_fields") or [] if f in fields]
    return errs


def load_corpus() -> dict:
    with open(CORPUS, encoding="utf-8") as fh:
        return json.load(fh)


def run(interpreter: str) -> dict:
    """{version, interpreter, total, passed, by_category, nl, questions: {id: {pass, reasons}}}"""
    corpus = load_corpus()
    fn = INTERPRETERS[interpreter]
    qs, cats, nl = {}, defaultdict(lambda: [0, 0]), {"nl": [0, 0], "plain": [0, 0]}
    for q in corpus["questions"]:
        reasons = score_question(q, fn(q))
        ok = not reasons
        qs[q["id"]] = {"pass": ok, "category": q["category"], "nl": bool(q.get("nl")), "reasons": reasons}
        cats[q["category"]][0] += ok
        cats[q["category"]][1] += 1
        bucket = nl["nl" if q.get("nl") else "plain"]
        bucket[0] += ok
        bucket[1] += 1
    return {"corpus_version": corpus.get("version"), "interpreter": interpreter, "total": len(qs),
            "passed": sum(v["pass"] for v in qs.values()),
            "by_category": {c: {"passed": p, "of": n} for c, (p, n) in sorted(cats.items())},
            "nl": {k: {"passed": p, "of": n} for k, (p, n) in nl.items()},
            # refusals are reported apart: an interpreter that refuses everything gets every refusal "right"
            "answerable": {"passed": sum(v["pass"] for v in qs.values() if v["category"] != "refusal"),
                           "of": sum(1 for v in qs.values() if v["category"] != "refusal")},
            "refusals": {"passed": sum(v["pass"] for v in qs.values() if v["category"] == "refusal"),
                         "of": sum(1 for v in qs.values() if v["category"] == "refusal")},
            "questions": qs}


def baseline_text() -> str:
    r = run("grammar-direct")
    pinned = {"corpus_version": r["corpus_version"], "interpreter": r["interpreter"], "total": r["total"],
              "passed": r["passed"], "answerable": r["answerable"], "refusals": r["refusals"],
              "by_category": r["by_category"], "nl": r["nl"],
              "passing": sorted(i for i, v in r["questions"].items() if v["pass"])}
    return json.dumps(pinned, indent=2) + "\n"


def report(r: dict) -> str:
    lines = [f"{r['interpreter']}: {r['passed']}/{r['total']}  (answerable {r['answerable']['passed']}/"
             f"{r['answerable']['of']}, refusals {r['refusals']['passed']}/{r['refusals']['of']})"]
    lines += [f"  {c:<12} {v['passed']}/{v['of']}" for c, v in r["by_category"].items()]
    lines += [f"  nl {r['nl']['nl']['passed']}/{r['nl']['nl']['of']} · plain {r['nl']['plain']['passed']}/{r['nl']['plain']['of']}"]
    return "\n".join(lines)


# ── the rail ────────────────────────────────────────────────────────────────────────────────────────
def test_the_corpus_is_the_shape_the_scorer_reads():
    c = load_corpus()
    qs = c["questions"]
    assert len(qs) >= 25 and len({q["id"] for q in qs}) == len(qs)
    for q in qs:
        assert {"id", "category", "question", "expect", "required_fields", "forbidden_fields", "expect_refusal",
                "tolerance"} <= set(q), q["id"]
        if not q["expect_refusal"]:
            compile_criteria(q["expect"]["criteria_text"])          # every expectation parses in the grammar
    assert set(SPOTLIGHT) <= {q["id"] for q in qs}


def test_the_ORACLE_control_scores_100_percent():
    r = run("oracle")
    failing = {i: v["reasons"] for i, v in r["questions"].items() if not v["pass"]}
    assert not failing, failing
    assert r["passed"] == r["total"]


def _perturbations(q: dict) -> list[tuple[str, dict]]:
    """Wrong answers derived from the right one. Each MUST fail, or a scoring rule cannot see what it guards."""
    out: list[tuple[str, dict]] = []
    if q["expect_refusal"]:
        return [("answered a refusal", {"refused": False, "logic": {"key": "price", "op": "gt", "min": 1}})]
    out.append(("refused an answerable question", {"refused": True, "why": "perturbed"}))
    good = oracle(q)["logic"]
    leaves, struct = _leaves(good)
    if struct:
        return out
    tol = q.get("tolerance") or {}
    for i, lf in enumerate(leaves):
        def with_leaf(new, i=i):
            ls = copy.deepcopy(leaves)
            ls[i] = new
            return {"refused": False, "logic": {"all": ls} if len(ls) > 1 else ls[0]}
        k, op = lf["key"], lf["op"]
        if op in _LOWER | _UPPER:
            side = "min" if op in _LOWER else "max"
            t = tol.get(k) or {}
            off = (float(t.get("abs", 0)) or abs(lf[side]) * float(t.get("pct", 0)) / 100.0) + max(1.0, abs(lf[side]) * 0.5)
            out.append((f"{k} threshold beyond tolerance", with_leaf({**lf, side: lf[side] + off})))
            flipped = {"key": k, "op": "lt" if op in _LOWER else "gt", ("max" if op in _LOWER else "min"): lf[side]}
            out.append((f"{k} direction flipped", with_leaf(flipped)))
        elif op == "eq":
            out.append((f"{k} wrong value", with_leaf({**lf, "value": 0 if lf["value"] else 1})))
        elif op == "in":
            out.append((f"{k} wrong values", with_leaf({**lf, "values": ["Utilities"]})))
        if len(leaves) > 1:
            ls = [x for j, x in enumerate(leaves) if j != i]
            out.append((f"{k} dropped", {"refused": False, "logic": {"all": ls} if len(ls) > 1 else ls[0]}))
    out.append(("extra criterion", {"refused": False, "logic": {"all": leaves + [{"key": "zz_extra", "op": "gt", "min": 1}]}}))
    for f in q.get("forbidden_fields") or []:
        out.append((f"forbidden {f}", {"refused": False, "logic": {"all": leaves + [{"key": f, "op": "gt", "min": 0}]}}))
    return out


def test_every_scoring_rule_FAILS_a_wrong_answer():
    """Mutation checks: for every question, each derived wrong answer is scored as failing."""
    seen = 0
    for q in load_corpus()["questions"]:
        for name, cand in _perturbations(q):
            assert score_question(q, cand), f"{q['id']}: '{name}' was scored as a pass"
            seen += 1
    assert seen > 100, seen                                                   # non-vacuity


def test_within_tolerance_still_PASSES():
    """The other direction: a near-miss inside the declared tolerance is right, so the scorer must not be stricter
    than the corpus says."""
    hit = 0
    for q in load_corpus()["questions"]:
        if q["expect_refusal"]:
            continue
        leaves, struct = _leaves(oracle(q)["logic"])
        for i, lf in enumerate(leaves):
            t = (q.get("tolerance") or {}).get(lf["key"]) or {}
            if lf["op"] in _LOWER | _UPPER and t.get("abs"):
                side = "min" if lf["op"] in _LOWER else "max"
                ls = copy.deepcopy(leaves)
                ls[i] = {**lf, side: lf[side] + float(t["abs"]) / 2, "op": "gte" if lf["op"] in _LOWER else "lte"}
                cand = {"refused": False, "logic": {"all": ls} if len(ls) > 1 else ls[0]}
                assert score_question(q, cand) == [], (q["id"], lf)
                hit += 1
    assert hit > 5


def test_the_GRAMMAR_DIRECT_baseline_matches_the_recorded_one_exactly():
    want = baseline_text()
    assert BASELINE.exists(), "record it: python -m tests.test_uct_agent_qa_scan_corpus --write-baseline"
    have = BASELINE.read_text(encoding="utf-8").replace("\r\n", "\n")
    assert have == want, ("the deterministic baseline moved (a regression OR an improvement). Look at which "
                          "questions changed, then regenerate with --write-baseline:\n" + report(run("grammar-direct")))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if "--write-baseline" in sys.argv:
        BASELINE.parent.mkdir(parents=True, exist_ok=True)
        with open(BASELINE, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(baseline_text())
        print(BASELINE)
    for name in INTERPRETERS:
        r = run(name)
        print(report(r))
        if name == "grammar-direct":
            for i in SPOTLIGHT:
                v = r["questions"][i]
                print(f"  {i}: {'PASS' if v['pass'] else 'FAIL'} {'; '.join(v['reasons'])[:150]}")
