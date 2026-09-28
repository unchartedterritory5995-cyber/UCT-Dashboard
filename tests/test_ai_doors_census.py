"""TERM-078 (FB-I1-04) -- the AI-door census: every module that calls a model
API is DESCRIBED, and the description is checked against the code.

WHAT THIS FILE MAKES IMPOSSIBLE
-------------------------------
A new model call landing on a member request with nobody having written down
what bounds it. F-01 PROD-C1 records the exposure ("per-user AI caps summing to
~$610-650/member/month", Compass chat with no population cap) and the reason it
survived: no single place said which AI doors exist. A hand list of doors is
the artifact that goes stale first, so the list is DERIVED
(`tools/ai_door_census.py`, AST) and `api/services/ai_doors.py` only CLASSIFIES
what the derivation finds.

THE HALVES
  1. EVERY FOUND MODULE IS IN THE TABLE, and every table row is still found --
     both directions, BY NAME.
  2. THE TABLE'S CLAIMS ARE CHECKED: a meter key must exist in ai_meters; a
     population-cap claim must name a module whose AST really calls
     `ai_population_cap.admit`; an unmetered/uncapped member door must say why.
  3. POSITIVE CONTROLS: planted model calls in a temp tree are reported by
     name -- an SDK invoke, a renamed import, a raw model-host URL, a call
     through a shared client -- and a comment mentioning one is NOT. Without
     these, "0 unlisted" could mean the census stopped parsing.
"""
from __future__ import annotations

import ast
import os
import textwrap

import pytest

from api.services import ai_doors, ai_meters
from tools import ai_door_census as cen

BASE = cen.repo_root()


def _found() -> dict:
    return cen.modules(BASE, shared_clients=ai_doors.shared_client_paths())


# ── 1. the census and the table agree, by name ───────────────────────────────

def test_every_module_that_calls_a_model_is_described_in_the_door_table():
    found = _found()
    unlisted = sorted(set(found) - set(ai_doors.DOORS))
    assert not unlisted, (
        "these modules call a model API and api/services/ai_doors.py does not say "
        "what reaches them or what bounds their spend:\n"
        + "\n".join(f"  {p}  <- {', '.join(str(s) for s in found[p][:3])}" for p in unlisted)
        + "\n\nAdd a Door: kind, surface, budget, and for a member door the meter it "
        "reads through and the module wiring the population cap (or `gap=` saying why not)."
    )


def test_no_door_row_describes_a_module_that_no_longer_calls_a_model():
    stale = sorted(set(ai_doors.DOORS) - set(_found()))
    assert not stale, (
        "api/services/ai_doors.py describes modules the census no longer finds a "
        f"model call in -- delete or correct the rows: {stale}"
    )


def test_the_census_is_not_vacuous():
    """A census that stopped resolving would report nothing, and both rails above
    would pass over an empty set. Name members it CANNOT legitimately miss."""
    found = _found()
    assert len(found) >= 40, f"the census found only {len(found)} model-calling modules"
    shapes = {s.shape.split(':')[0] for ss in found.values() for s in ss}
    assert {"construct", "invoke", "host", "via"} <= shapes, shapes
    assert "api/services/note_ask.py" in found              # an AsyncAnthropic construction
    assert "api/services/perplexity_search.py" in found     # a model-host literal only
    assert "api/routers/voice.py" in found                  # reached only by the shared-client hop


# ── 2. the table's claims are checked, not trusted ───────────────────────────

@pytest.mark.parametrize("path", sorted(ai_doors.DOORS))
def test_each_door_states_a_real_classification(path):
    d = ai_doors.DOORS[path]
    assert d.kind in ai_doors.KINDS, (path, d.kind)
    assert d.surface.strip() and d.budget.strip(), path
    if d.meter is not None:
        assert d.meter in ai_meters.METERS, (
            f"{path} names meter {d.meter!r}, which ai_meters.METERS does not define")
    if d.kind == "member":
        if d.meter is None or not d.pop_cap:
            assert len(d.gap.strip()) >= 15, (
                f"{path} is a member door with no meter or no population cap and no "
                "`gap` saying why -- an unmetered door must be a decision on the page")


def _calls_population_admit(path: str) -> bool:
    with open(os.path.join(BASE, path), encoding="utf-8") as fh:
        tree = ast.parse(fh.read())
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "admit" and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "ai_population_cap"):
            return True
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id == "run_in_threadpool" and node.args
                and isinstance(node.args[0], ast.Attribute) and node.args[0].attr == "admit"
                and isinstance(node.args[0].value, ast.Name)
                and node.args[0].value.id == "ai_population_cap"):
            return True
    return False


def test_every_population_cap_claim_is_true_in_the_named_module():
    claims = sorted({d.pop_cap for d in ai_doors.DOORS.values() if d.pop_cap})
    assert len(claims) >= 4, claims                     # non-vacuity: the wiring exists
    false = [p for p in claims if not _calls_population_admit(p)]
    assert not false, f"these modules are named as wiring the population cap and do not: {false}"


def test_the_admit_detector_can_answer_no():
    """Control: a module that never calls admit reads False, so the rail above
    cannot pass by answering yes to everything."""
    assert _calls_population_admit("api/services/daily_counters.py") is False


# ── 3. positive controls on the census itself ────────────────────────────────

def _tree(tmp_path, files: dict) -> str:
    for rel, src in files.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(textwrap.dedent(src), encoding="utf-8")
    return str(tmp_path)


def test_a_planted_unlisted_model_call_is_reported_by_name(tmp_path):
    base = _tree(tmp_path, {
        "api/__init__.py": "",
        "api/services/__init__.py": "",
        "api/services/new_ai_door.py": """
            from api.services.engine import _get_anthropic_client
            def answer(q):
                return _get_anthropic_client().messages.create(model="m", messages=[])
        """,
    })
    found = cen.modules(base)
    assert "api/services/new_ai_door.py" in found
    assert found["api/services/new_ai_door.py"][0].shape == "invoke"


def test_a_renamed_sdk_construction_and_a_raw_host_are_found(tmp_path):
    base = _tree(tmp_path, {
        "api/a.py": """
            from anthropic import Anthropic as Claude
            def f():
                return Claude(timeout=5)
        """,
        "api/b.py": """
            import requests
            URL = "https://api.openai.com/v1/images/generations"
            def g():
                return requests.post(URL)
        """,
    })
    found = cen.modules(base)
    assert found["api/a.py"][0].shape == "construct"
    assert found["api/b.py"][0].shape == "host"


def test_a_call_through_a_shared_client_is_followed_one_hop(tmp_path):
    base = _tree(tmp_path, {
        "api/__init__.py": "",
        "api/wrap.py": """
            _BASE = "https://api.perplexity.ai/chat/completions"
            import requests
            def _post(q):
                return requests.post(_BASE, json={"q": q})
            def web_search(q):
                return _post(q)
            def unrelated():
                return 1
        """,
        "api/caller.py": """
            from api import wrap
            def handler(q):
                return wrap.web_search(q)
        """,
        "api/bystander.py": """
            from api import wrap
            def h():
                return wrap.unrelated()
        """,
    })
    found = cen.modules(base, shared_clients=["api/wrap.py"])
    assert "api/caller.py" in found and found["api/caller.py"][0].shape == "via:api/wrap.py"
    assert "api/bystander.py" not in found     # calling a non-model function is not a door
    assert "api/caller.py" not in cen.modules(base)   # ...and only the hop found it


def test_a_comment_or_docstring_naming_a_call_is_not_a_call(tmp_path):
    base = _tree(tmp_path, {
        "api/prose.py": '''
            """We used to call client.messages.create(...) here."""
            # client.chat.completions.create(model="x")
            def f():
                return None
        ''',
    })
    assert cen.modules(base) == {}
