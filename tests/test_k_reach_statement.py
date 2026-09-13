"""⛔⛔ K-R8 — THE REACH STATEMENT IS ONE SENTENCE, IN FIVE PLACES, UNALTERED.

Owner ruling 2026-09-12: the sentence below appears **verbatim** in K's flip
packet and in every place the rollback text lives. Not paraphrased, not
shortened, not softened.

⚰️ WHY A RAIL AND NOT A CONVENTION. The Wave Q1 canary stamped the OPPOSITE
rollback instruction on **eleven** evidence rows before anyone noticed, because
the sentence lived in five artifacts and nothing compared them. A rollback
sentence is read exactly once — at the moment somebody is deciding whether to
pull a lever — and by then nobody re-derives it.

⭐ THE SPEC IS THE SOURCE. §2b of `docs/notebook/kill-switch-spec.md` owns the
wording; this rail DERIVES it from there rather than restating it, so editing the
spec's sentence reds every copy that did not follow. Restating it here would be a
sixth copy and a second authority over one value.
"""
from __future__ import annotations

import ast
import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = ROOT / "docs" / "notebook" / "kill-switch-spec.md"

# The five places, and what each one is for. A sixth copy is fine — it just has
# to be right; this list is the set that MUST carry it.
PLACES = {
    "the canary's rollback text": ROOT / "tools" / "window_check.py",
    "the flip packet": ROOT / "docs" / "notebook" / "kill-switch-flip-packet.md",
    "the Q1 resume doc": ROOT / "docs" / "notebook" / "wave-q1-RESUME-HERE.md",
    "CLAUDE.md": ROOT / "CLAUDE.md",
    "the Sunday gate": ROOT / "docs" / "notebook" / "wave-q1-sunday-gate.md",
}


def _norm(text: str) -> str:
    """Compare MEANING-PRESERVING shapes, not line wrapping.

    ⛔ A markdown block quote wraps at 80 columns and a Python literal is split
    across implicit concatenations; neither is a change to the sentence. Line
    breaks, `> ` prefixes and runs of whitespace collapse. NOTHING ELSE does — a
    dropped clause, a softened verb or a changed em dash still reds.
    """
    text = re.sub(r"(?m)^\s*>\s?", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _canonical() -> str:
    """The sentence, read out of the spec's §2b block quote."""
    src = SPEC.read_text(encoding="utf-8")
    head = src.index("## 2b.")
    tail = src.index("\n## ", head)
    quote = [ln for ln in src[head:tail].split("\n") if ln.lstrip().startswith(">")]
    assert quote, "§2b carries no block quote — the spec no longer states the sentence"
    return _norm("\n".join(quote))


def test_the_spec_states_a_sentence_worth_checking():
    """⭐ NON-VACUITY. Every assertion below is `sentence in haystack`, and an
    empty or truncated needle is in everything. This is the control that makes
    the five checks mean something."""
    s = _canonical()
    assert len(s) > 180, f"the parsed sentence is suspiciously short: {s!r}"
    assert s.endswith("until K-1."), s
    for clause in ("next authenticated request or reload",
                   "does not reach a tab mid-session",
                   "the wave stays ON",
                   "kills a decision, not an outage"):
        assert clause in s, f"the spec's sentence lost the clause {clause!r}"


@pytest.mark.parametrize("label", sorted(PLACES))
def test_the_reach_statement_is_verbatim_in_every_place_it_must_appear(label):
    path = PLACES[label]
    assert path.exists(), f"{label}: {path} is missing"
    body = path.read_text(encoding="utf-8")

    if path.suffix == ".py":
        # ⛔ READ THE VALUE, NOT THE TEXT. `REACH_LINE` is an implicit
        # concatenation of four string literals; a text search would have to
        # guess where the author put the line breaks, and would go green on a
        # sentence that no longer matched simply because the quoting changed.
        tree = ast.parse(body)
        value = None
        for node in tree.body:
            if (isinstance(node, ast.Assign) and len(node.targets) == 1
                    and isinstance(node.targets[0], ast.Name)
                    and node.targets[0].id == "REACH_LINE"):
                value = ast.literal_eval(node.value)
        assert value is not None, "tools/window_check.py no longer defines REACH_LINE"
        haystack = _norm(value)
        # …and the rollback text must actually USE it, not merely define it.
        assert "REACH_LINE" in body.split("REACH_LINE = (", 1)[1], (
            "REACH_LINE is defined and never used — the rollback row would print nothing")
    else:
        haystack = _norm(body)

    assert _canonical() in haystack, (
        f"⛔ {label} ({path.relative_to(ROOT)}) does not carry the reach statement "
        "verbatim. Do not soften it there — change §2b of the spec if the wording "
        "is wrong, and every copy follows.")


def test_the_matcher_can_actually_fail():
    """⭐ CONTROL. A sentence that is NOT in these files must not be found —
    otherwise the five checks above pass for the wrong reason."""
    absent = _norm("a flip reaches a member instantly in every open tab, and an "
                   "unreachable payload turns the wave off.")
    for path in PLACES.values():
        assert absent not in _norm(path.read_text(encoding="utf-8"))


def test_the_struck_sentence_is_marked_rather_than_deleted():
    """⚰️ The old instruction — *"a deploy, not a variable"* — was TRUE before K
    and is now half of the answer. This repo has twice had a rescinded rule
    re-derived from its surviving rationale, so the old wording stays visible and
    struck wherever it was load-bearing, instead of vanishing."""
    for label in ("the canary's rollback text", "CLAUDE.md", "the Q1 resume doc"):
        body = PLACES[label].read_text(encoding="utf-8")
        assert "~~" in body and "superseded" in body.lower(), (
            f"{label}: the superseded rollback wording must be struck IN PLACE, not deleted")
