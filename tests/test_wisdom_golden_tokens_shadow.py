"""The two tokenizers in `wisdom/extract/golden.py` must stay distinct.

⚰️ They were both called `_tokens`. Python keeps the LAST top-level binding, so the
similarity scorer at `match_segment` had been running the fuzzy-agreement lens's
tokenizer since c9d6af653 — the same defect class as the `_parse_mdy` incident in
`api/live_massive_router.py`, and caught the same way: by a sweep, not by review.
"""
from __future__ import annotations

import ast
import pathlib

from api.services.wisdom.extract import golden as G

SRC = pathlib.Path("api/services/wisdom/extract/golden.py")

SENTENCE = "Buy $NVDA above 30% on a 1.5R stop"


def test_the_similarity_tokenizer_keeps_the_tokens_that_carry_the_trade():
    """⛔ THE REASON THIS MATTERS IN A TRADING GATE. The shadowing tokenizer strips
    `$`, `%` and `.` and drops words of three characters or fewer, so the cashtag
    loses its sigil and the percentage and the R-multiple vanish outright."""
    toks = G._tokens(SENTENCE)
    assert "$nvda" in toks, toks
    assert "30%" in toks, toks
    assert "1.5r" in toks, toks
    assert "a" in toks, "short words are kept by the similarity tokenizer"


def test_the_fuzzy_agreement_tokenizer_still_strips_them_on_purpose():
    """It is not a worse version of the other one — it is a different lens, and the
    stripping is deliberate so wording differences dominate."""
    toks = G._key_tokens(SENTENCE)
    assert toks == {"above", "buy", "nvda", "stop"}, toks


def test_the_two_are_not_the_same_function():
    """The control: if the rename were undone, both names would resolve to one
    object and every assertion above would be describing the same behaviour."""
    assert G._tokens is not G._key_tokens
    assert G._tokens(SENTENCE) != G._key_tokens(SENTENCE)


def test_both_accept_None():
    """⚠️ Correcting a claim made in a report: this pair never crashed on None —
    both guard with `str(text or "")`. The defect was silent semantic drift, which
    in a scoring gate is harder to notice than a traceback, not easier."""
    assert G._tokens(None) == set()
    assert G._key_tokens(None) == set()


def test_no_top_level_name_in_this_module_is_bound_twice():
    """Scoped to the file that had the defect, so it fails here first and by name
    rather than only in the repo-wide sweep."""
    tree = ast.parse(SRC.read_text(encoding="utf-8"))
    seen: dict[str, list[int]] = {}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            seen.setdefault(node.name, []).append(node.lineno)
    dupes = {n: ls for n, ls in seen.items() if len(ls) > 1}
    assert not dupes, f"bound more than once at module level: {dupes}"
    assert len(seen) > 20, "non-vacuity: the parse must actually have found definitions"
