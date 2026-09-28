"""TERM-071 (FB-A11-01) — ONE regime authority, railed.

The authority is `api/services/voice_regime_classifier.py`, named by DEC-13
(LOCKED 2026-09-02, `docs/terminal-research/12-decisions/
ARCHITECTURAL_DECISION_REGISTER.md`). This file does not re-decide that; it makes
the decision ENFORCEABLE, which is what FB-A11-01's "Known it worked" asks for:

  * "a rail fails if a second classifier is reachable from a consumer"
      -> `test_no_regime_label_is_restated_outside_the_authority`, which derives
         the label vocabulary FROM the authority's AST and fails BY FILE NAME on
         any module outside it that spells a label (or a collection of them)
         in code.
  * "moving the canonical value changes every consumer in the same tick"
      -> `test_moving_the_LABEL_moves_every_consumer` and
         `test_moving_the_BAND_moves_every_consumer`, which move the source and
         watch each consumer follow — never a comment claiming they agree.

⛔ What is NOT a second regime authority, and why, is declared in `_DECLARED`
below with a reason each — a declared exception is a record, not a blind spot:
  * `journal_two/regime.py` is the Exposure BACKDROP (Packet W, CP1 shipped):
    a pure bucket of the wire's UCT Exposure score — the exposure authority the
    owner ruled "owns exposure everywhere" — not a market-regime classifier.
  * `alert_taxonomy/regime_change.py` and `voice_proactive_service.py` carry
    copies that S7's own rails pin against this authority's AST, in order
    (`tests/test_alert_taxonomy_regime_change_schema.py`); they are counted
    here EXACTLY so a new literal in either still goes red.

Pure AST over source text for the scan: nothing under `api/` is imported by the
scan itself, so it cannot agree with whatever a module happens to hold at runtime.
"""
from __future__ import annotations

import ast
import pathlib
from collections import Counter

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]
_API = _REPO / "api"
_AUTHORITY_REL = "api/services/voice_regime_classifier.py"
_AUTHORITY = _REPO / _AUTHORITY_REL


# ── the vocabulary, DERIVED from the authority (never typed here) ────────────

def _module_literal(path: pathlib.Path, name: str):
    for node in ast.parse(path.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.Assign):
            for tgt in node.targets:
                if isinstance(tgt, ast.Name) and tgt.id == name:
                    return ast.literal_eval(node.value)
    raise AssertionError(f"{name} is not a module-level literal in {path.name}")


_LABELS = tuple(_module_literal(_AUTHORITY, "REGIMES"))
#: A lone English word ("chop", "distribution") also means other things in this
#: codebase (Wyckoff distribution, A/D). Alone, only the COMPOUND labels are
#: evidence of a regime computation; any COLLECTION holding two or more labels
#: is evidence regardless of which two.
_DISTINCTIVE = tuple(lab for lab in _LABELS if "_" in lab)


# ── the scanner (code only: comments are gone at parse, docstrings skipped) ──

def _docstring_nodes(tree: ast.AST) -> set[int]:
    ids: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = node.body
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                ids.add(id(body[0].value))
    return ids


def _label_hits(source: str) -> int:
    """How many times this source spells the regime vocabulary IN CODE."""
    tree = ast.parse(source)
    skip = _docstring_nodes(tree)
    hits = 0
    for node in ast.walk(tree):
        if (isinstance(node, ast.Constant) and isinstance(node.value, str)
                and id(node) not in skip and node.value in _DISTINCTIVE):
            hits += 1
        elements = None
        if isinstance(node, ast.Dict):
            elements = node.keys
        elif isinstance(node, (ast.Tuple, ast.List, ast.Set)):
            elements = node.elts
        if elements is not None:
            found = {e.value for e in elements
                     if isinstance(e, ast.Constant) and isinstance(e.value, str)
                     and e.value in _LABELS}
            # a collection of >=2 labels that is NOT already fully counted above
            if len(found) >= 2 and not found <= set(_DISTINCTIVE):
                hits += 1
    return hits


def _scan() -> Counter:
    out: Counter = Counter()
    for path in sorted(_API.rglob("*.py")):
        if path.name.startswith("test_") or "tests" in path.parts:
            continue
        rel = path.relative_to(_REPO).as_posix()
        if rel == _AUTHORITY_REL:
            continue
        n = _label_hits(path.read_text(encoding="utf-8"))
        if n:
            out[rel] = n
    return out


#: Every module outside the authority that may spell the vocabulary, with the
#: EXACT count and why. A new literal anywhere — including in one of these —
#: changes a count and goes red by name.
_DECLARED = {
    "api/services/alert_taxonomy/regime_change.py": (
        4, "S7 REGIME_LABELS: a declared copy railed against the authority's AST "
           "by tests/test_alert_taxonomy_regime_change_schema.py"),
    "api/services/voice_proactive_service.py": (
        6, "path B's inline scan tuple (railed IN ORDER by the S7 schema test) "
           "plus two reads of the authority's label; no computation"),
    "api/services/voice_causal_model.py": (
        4, "_REGIME_TO_STAGE: maps the authority's label to a rotation STAGE, a "
           "different quantity; keys railed == REGIMES below"),
}


# ── controls: the scanner can say yes, and says no to prose ──────────────────

def test_the_vocabulary_was_read_from_the_authority():
    assert len(_LABELS) == 5, _LABELS
    assert len(_DISTINCTIVE) >= 2, "the scanner would have nothing distinctive to find"


def test_the_scanner_sees_code_and_not_prose():
    a, b = _DISTINCTIVE[0], _LABELS[-1]
    code = "def f(x):\n    return " + repr(a) + " if x else " + repr(b) + "\n"
    assert _label_hits(code) >= 1
    mapping = "M = {" + repr(_LABELS[0]) + ": 1, " + repr(_LABELS[-1]) + ": 2}\n"
    assert _label_hits(mapping) >= 1
    prose = '"""Mentions ' + a + ' and ' + b + ' in a docstring."""\n# ' + a + "\n"
    assert _label_hits(prose) == 0


def test_the_scan_is_not_vacuous():
    """The authority itself must be seen by the same scanner, or the scan below
    passes by reading nothing."""
    assert _label_hits(_AUTHORITY.read_text(encoding="utf-8")) >= len(_DISTINCTIVE)
    assert sum(1 for _ in _API.rglob("*.py")) > 100


# ── the rail ─────────────────────────────────────────────────────────────────

def test_no_regime_label_is_restated_outside_the_authority():
    found = _scan()
    expected = {path: n for path, (n, _why) in _DECLARED.items()}
    undeclared = {p: n for p, n in found.items() if p not in expected}
    drifted = {p: (found.get(p, 0), n) for p, n in expected.items() if found.get(p, 0) != n}
    assert not undeclared, (
        "a regime label is spelled outside the authority — a second regime "
        "computation or a restated derivation. Read it from "
        f"{_AUTHORITY_REL} (get_current_regime / band_of) instead: {undeclared}")
    assert not drifted, f"a declared site changed its label count (found, declared): {drifted}"


def test_the_band_derivation_lives_ONLY_in_the_authority():
    band = _module_literal(_AUTHORITY, "REGIME_BAND")
    assert set(band) == set(_LABELS), "every regime label needs exactly one band"
    assert set(band.values()) <= {"GREEN", "YELLOW", "ORANGE", "RED"}


def test_the_stage_map_is_keyed_on_the_authoritys_vocabulary():
    stage = _module_literal(_REPO / "api/services/voice_causal_model.py", "_REGIME_TO_STAGE")
    assert set(stage) == set(_LABELS)


# ── moving the source moves every consumer ───────────────────────────────────

def _fake_regime(label):
    return lambda *a, **k: {"regime": label, "label": label, "confidence": 0.9,
                            "reasons": [], "signals": {"uct_exposure_rating": 100},
                            "narration": f"Regime: {label}."}


@pytest.mark.parametrize("label", [_LABELS[0], _LABELS[-1]])
def test_moving_the_LABEL_moves_every_consumer(monkeypatch, label):
    from api.services import voice_regime_classifier as vrc
    monkeypatch.setattr(vrc, "get_current_regime", _fake_regime(label))

    from api.services import grade_ticker, brain_service, portfolio_heat, grade_watchlist
    from api.services import voice_causal_model, voice_tool_impls

    assert grade_ticker._default_regime_fn()["regime"] == label
    assert portfolio_heat._default_regime_fn()["regime"] == label
    assert grade_watchlist._default_regime()["regime"] == label
    assert voice_tool_impls._get_regime()["regime"] == label
    assert voice_causal_model.get_sector_rotation_state()["regime"] == label
    assert brain_service._current_regime() == vrc.band_of(label)


def test_moving_the_BAND_moves_every_consumer(monkeypatch):
    """Re-map one label in the authority's REGIME_BAND and every band reader
    follows — grade_ticker's verdict gate, brain_service's sizing band, and
    grade_watchlist's watch-only synthesis — with no edit to any of them."""
    from api.services import voice_regime_classifier as vrc
    from api.services import grade_ticker, brain_service, grade_watchlist

    mild = next(lab for lab in _LABELS if vrc.REGIME_BAND[lab] == "YELLOW")
    monkeypatch.setattr(vrc, "get_current_regime", _fake_regime(mild))

    def _go(sym, account_size=None):
        return {"ok": True, "verdict": "GO", "grade": "A", "setup": "x"}

    def _list(regime_fn):
        return grade_watchlist.grade_watchlist(
            "u", symbols=["AAA"], source="explicit",
            resolve_fn=lambda *a: (["AAA"], "explicit"), grade_fn=_go,
            regime_fn=regime_fn, edge_fn=lambda *a: {}, sector_fn=lambda s: set())

    regime_fn = lambda: {"regime": mild, "exposure_rating": 100}  # noqa: E731

    assert grade_ticker._regime_band(mild) == "YELLOW"
    assert brain_service._current_regime() == "YELLOW"
    assert _list(regime_fn)["graded"][0]["verdict"] == "GO"

    monkeypatch.setitem(vrc.REGIME_BAND, mild, "RED")

    assert grade_ticker._regime_band(mild) == "RED"
    assert brain_service._current_regime() == "RED"
    assert _list(regime_fn)["graded"][0]["verdict"] == "HOLD"


def test_an_unknown_label_bands_to_the_authoritys_default(monkeypatch):
    from api.services import voice_regime_classifier as vrc
    from api.services import grade_ticker
    assert vrc.band_of(None) == vrc.BAND_DEFAULT
    assert vrc.band_of("Bull Trend (pretty label)") == vrc.BAND_DEFAULT
    monkeypatch.setattr(vrc, "BAND_DEFAULT", "ORANGE")
    assert grade_ticker._regime_band("") == "ORANGE"
