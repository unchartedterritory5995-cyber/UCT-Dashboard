"""R50 — the CALL / MENTION / LEVEL / NEGATIVE_CALL gating audit, as a standing rail.

⚰️ R89 (owner ruling, 2026-09-17) SUPERSEDED THE SENTENCE THIS FILE OPENED WITH. It read: *"The
publication floor governs PRINCIPLE and MARKET_SIGNAL only — `floor.passes()` returns True for
every other type by construction — so the moment EXTRACT runs, the other four types are unfloored
and reach whatever consumer reads them."* CALL, MENTION and NEGATIVE_CALL are floored now; **LEVEL
alone** is unfloored, and on evidence (no consumer performs a typed read of it) rather than by
omission. The censuses below are unchanged and still load-bearing — the floor filters ROWS and is
never a substitute for classifying a READER — and `test_the_floor_now_governs_three_of_the_four_
types_and_only_LEVEL_is_unfloored` carries the restated premise.

⛔⛔ WHAT R50 SETTLES AND WHY A DOCUMENT COULD NOT SETTLE IT. The session-13 audit found list (i),
*member-visible AND ungated*, to be
EMPTY: every wisdom-owned route is admin / owner / push-secret, and each of the five doors a
member surface uses to reach wisdom data consults a `member_visible=True` gate that defaults OFF.

⭐ That is a fact about the repo TODAY, and a one-time audit nobody re-runs reads as coverage —
this repo's own `desk_session_insights` was "written, documented as scheduled, wired into no
scheduler" for weeks. The two rails here are what keep the finding true:

1. **The door census.** Nothing anywhere failed when a module OUTSIDE the wisdom package started
   importing it. A new member surface reading wisdom data is exactly how list (i) stops being
   empty, and it would arrive silently. It now fails by name and has to be classified.
2. **The consumer census.** A new reader of `wisdom_records` must declare its verdict
   (visibility x switch) before it can land.

⛔ Deliberately NOT duplicated here — one guard, one place
(`lesson_a_guard_repeated_is_a_guard_unproved`):
  * gate polarity   -> test_wisdom_skeleton.py::test_every_gate_defaults_off_is_read_by_name_...
  * route guards    -> test_wisdom_publish_admin_routes.py (on the REAL app, incl. a member probe)
  * per-consumer behaviour -> test_wisdom_publish_adapters_consumers.py
"""
from __future__ import annotations

import ast
import pathlib

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
API = REPO / "api"
WISDOM_PKG = API / "services" / "wisdom"

FOUR_TYPES = ("CALL", "MENTION", "LEVEL", "NEGATIVE_CALL")


def _is_wisdom_owned(path: pathlib.Path) -> bool:
    return WISDOM_PKG in path.parents or path.name.startswith("wisdom_")


def _python_files(root: pathlib.Path):
    return sorted(p for p in root.rglob("*.py") if "__pycache__" not in p.parts)


# ══ 1. THE DOORS: every import of the wisdom package from outside it ═════════
#
# ⛔ module -> (what it imports, how the four types are gated on that path). A door whose reason
# is MEMBER must name a gate that flags.GATES marks member_visible; that pairing is asserted
# below, not just written down here.
DECLARED_DOORS = {
    "api/main.py": ("registry", "MOUNT", ""),
    "api/routers/ai_search.py": ("publish.adapters.askai", "MEMBER", "ASKAI_WISDOM_RETRIEVAL_ENABLED"),
    "api/services/ai_search_dossier.py": ("publish.adapters.dossier", "MEMBER", "WISDOM_DOSSIER_ENABLED"),
    "api/services/ticker_mentions.py": ("core.flags + publish.adapters.desk_markers", "MEMBER",
                                        "WISDOM_DESK_MARKERS_ENABLED"),
    "api/services/desk_session_insights.py": ("core.ids + core.r2", "NO_RECORD_READ", ""),
}


def _doors() -> dict:
    """Every non-wisdom module under api/ that imports api.services.wisdom.**, by AST."""
    found: dict = {}
    for path in _python_files(API):
        if _is_wisdom_owned(path):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        hits = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and (node.module or "").startswith("api.services.wisdom"):
                # ⭐ the NAMES too: `from ...publish.adapters import desk_markers` says which
                # adapter a door actually reaches, which the module path alone does not.
                hits |= {f"{node.module}.{a.name}" for a in node.names}
            elif isinstance(node, ast.Import):
                hits |= {a.name for a in node.names if a.name.startswith("api.services.wisdom")}
        if hits:
            found[path.relative_to(REPO).as_posix()] = sorted(hits)
    return found


def test_every_door_into_the_wisdom_package_from_outside_it_is_declared():
    """⛔⛔ THE LOAD-BEARING ONE. A new member surface reading wisdom data lands here first."""
    found = _doors()
    undeclared = sorted(set(found) - set(DECLARED_DOORS))
    assert not undeclared, (
        "a module outside the wisdom package now reads it and R50 has not classified it: "
        f"{undeclared}. Add it to DECLARED_DOORS with its visibility and its gate — and if it is "
        "MEMBER-visible and ungated, list (i) is no longer empty and EXTRACT is not ruled.")
    gone = sorted(set(DECLARED_DOORS) - set(found))
    assert not gone, f"a declared door no longer exists; the table is stale: {gone}"


def test_the_door_census_can_actually_see_a_door():
    """⭐ NON-VACUITY: an empty AST sweep would satisfy the assertion above for the wrong reason."""
    found = _doors()
    assert "api/services/ticker_mentions.py" in found
    assert any("desk_markers" in m for m in found["api/services/ticker_mentions.py"])


def test_every_member_door_names_a_gate_the_registry_marks_member_visible():
    from api.services.wisdom.core import flags

    member_visible = {row[0] for row in flags.GATES if row[2]}
    member_doors = {m: env for m, (_, kind, env) in DECLARED_DOORS.items() if kind == "MEMBER"}
    assert member_doors, "the table declares no member door — the assertion below is vacuous"
    for module, env in member_doors.items():
        assert env, f"{module} is a member door with no gate named"
        assert env in member_visible, (
            f"{module} reaches a member through {env}, which flags.GATES does NOT mark "
            "member_visible — the owner's flip checklist would under-state it")


def test_a_member_doors_gate_is_read_before_the_records_are(monkeypatch):
    """⛔ Flag-off must return before any wisdom.db read, on every member door."""
    from api.services.wisdom.core import flags
    from api.services.wisdom.publish.adapters import askai, dossier

    monkeypatch.delenv("WISDOM_DOSSIER_ENABLED", raising=False)
    monkeypatch.delenv("ASKAI_WISDOM_RETRIEVAL_ENABLED", raising=False)
    assert not flags.dossier_enabled() and not flags.askai_retrieval_enabled()
    # a store that would explode if it were opened at all
    monkeypatch.setattr("api.services.wisdom.core.store.read", _never_called)
    assert dossier.wisdom_lines("NVDA") == []
    assert askai.wisdom_block("what did UCT say", user_id="u1") == ("", [])


def _never_called(*_a, **_k):  # pragma: no cover - the point is that it is not
    raise AssertionError("a member door opened the wisdom store with its gate off")


# ══ 2. THE CONSUMERS: every reader of wisdom_records, with its verdict ═══════
#
# ⛔ module -> visibility. The audit's own table, in the form a change can break.
#   MEMBER   reaches a member through a non-wisdom route, behind a member_visible gate
#   OWNER    an owner/admin surface, or a machine credential
#   INTERNAL writes only inside wisdom.db; no route serves its rows
#   SCHEMA   names the table because it DEFINES it; reads no row
DECLARED_CONSUMERS = {
    "core/schema.py": "SCHEMA",
    # --- reach a member, each behind a member_visible=True gate (list (ii)) -------------
    "publish/adapters/desk_markers.py": "MEMBER",
    "publish/adapters/dossier.py": "MEMBER",
    "publish/adapters/brainkb.py": "MEMBER",
    "publish/adapters/modelbook.py": "MEMBER",
    "publish/retrieval.py": "MEMBER",
    # --- owner / admin / machine-credential surfaces --------------------------------------
    "publish/adapters/badges.py": "OWNER",
    "publish/adapters/clips.py": "OWNER",
    "publish/adapters/pv_examples.py": "OWNER",
    "publish/report.py": "OWNER",
    "publish/review.py": "OWNER",
    "extract/audit.py": "OWNER",
    # --- wisdom.db only ------------------------------------------------------------------
    "publish/adapters/common.py": "INTERNAL",
    "publish/floor.py": "INTERNAL",
    "publish/level_alerts.py": "INTERNAL",
    "publish/lookalike.py": "INTERNAL",
    "evals/metrics.py": "INTERNAL",
    "evals/pipeline.py": "INTERNAL",
    "extract/writer.py": "INTERNAL",
    "extract/reconcile.py": "INTERNAL",
    "core/vocab.py": "INTERNAL",
}


def _record_readers() -> set:
    """Every module in the wisdom package whose SOURCE names wisdom_records or select_records.

    ⛔ Comments and docstrings stripped first — a module that merely DISCUSSES the table is not
    a consumer, and the repo has paid six times for a literal scan that matched its own prose.
    """
    out = set()
    for path in _python_files(WISDOM_PKG):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                if _is_docstring(tree, node):
                    continue
                if "wisdom_records" in node.value:
                    out.add(path.relative_to(WISDOM_PKG).as_posix())
            elif isinstance(node, (ast.Attribute, ast.Name)):
                name = node.attr if isinstance(node, ast.Attribute) else node.id
                if name == "select_records":
                    out.add(path.relative_to(WISDOM_PKG).as_posix())
    return out


_DOCSTRING_IDS: dict = {}


def _is_docstring(tree, node) -> bool:
    key = id(tree)
    if key not in _DOCSTRING_IDS:
        ids = set()
        for n in ast.walk(tree):
            if isinstance(n, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                if ast.get_docstring(n, clean=False) is not None:
                    ids.add(id(n.body[0].value))
        _DOCSTRING_IDS[key] = ids
    return id(node) in _DOCSTRING_IDS[key]


def test_every_reader_of_wisdom_records_carries_an_r50_verdict():
    found = _record_readers()
    unclassified = sorted(found - set(DECLARED_CONSUMERS))
    assert not unclassified, (
        "a new reader of wisdom_records has no R50 verdict: "
        f"{unclassified}. Classify it MEMBER / OWNER / INTERNAL. A MEMBER reader without a "
        "member_visible gate puts a name on list (i), and EXTRACT is not ruled while list (i) "
        "is non-empty.")
    gone = sorted(set(DECLARED_CONSUMERS) - found)
    assert not gone, f"a declared consumer no longer reads wisdom_records; the table is stale: {gone}"


def test_the_consumer_census_can_see_a_reader_and_ignores_prose():
    """⭐ CONTROL, both directions."""
    found = _record_readers()
    assert "publish/adapters/clips.py" in found, "the scan cannot see a literal SQL reader"
    assert "publish/adapters/common.py" in found, "the scan cannot see the shared select_records"
    # `voice.py` names wisdom_sources, never wisdom_records, and floor.py:21-22 says so
    assert "publish/adapters/voice.py" not in found


def test_the_floor_now_governs_three_of_the_four_types_and_only_LEVEL_is_unfloored():
    """⭐⭐ THIS TEST CHANGED SIDES, AND THAT IS THE POINT OF HAVING WRITTEN IT.

    It used to be `test_the_floor_is_a_no_op_for_all_four_types_by_construction`, and it said so
    in its own docstring: *"THE PREMISE OF THE WHOLE AUDIT. If this stops being true, R50's
    question changes."* **R89 (owner ruling, 2026-09-17) stopped it being true**, so the premise
    is restated here rather than deleted — the same handling as
    `test_a_forced_chain_run_no_longer_bypasses_the_extract_spend_gate` below.

    ⛔ **What R89 changes about R50, precisely.** R50 asked *"which consumers can surface the four
    unfloored types, and is list (i) — member-visible AND ungated — empty?"* Three of those four
    are no longer unfloored, so for CALL, MENTION and NEGATIVE_CALL a member-visible consumer now
    has **two** things in its way: the member_visible gate R50 catalogued, and the floor. The door
    and consumer censuses above are unaffected and still load-bearing: the floor is a filter on
    ROWS, never a substitute for classifying a reader.

    ⚠️ LEVEL is the one that stays unfloored, and it is unfloored on EVIDENCE (no consumer
    performs a typed read of it), not by omission — the reasoning and its re-derivation are
    beside `floor.FLOORED_TYPES`.
    """
    from api.services.wisdom.publish import floor

    assert set(floor.FLOORED_TYPES) == {"PRINCIPLE", "MARKET_SIGNAL", "CALL", "NEGATIVE_CALL", "MENTION"}
    for rtype in ("CALL", "MENTION", "NEGATIVE_CALL"):
        assert rtype in floor.FLOORED_TYPES
        assert not floor.passes(rtype, 0.0, 99), f"R89: the floor must block a below-floor {rtype}"
        # non-vacuity: the same type at the floor, over MIN_RUNS, still publishes
        assert floor.passes(rtype, 1.0, floor.MIN_RUNS), f"the floor blocks {rtype} unconditionally"
    assert "LEVEL" not in floor.FLOORED_TYPES
    assert floor.passes("LEVEL", 0.0, 99), "LEVEL is the unfloored control and must stay unfloored"
    # control: it still blocks the two it governed before R89
    assert not floor.passes("PRINCIPLE", 0.0, 99)


def test_the_unfloored_set_is_exactly_what_the_writer_can_emit_minus_the_floored_set():
    """⛔ `UNFLOORED_TYPES` must be DERIVABLE, or it becomes a second authority that drifts.

    A new record type added to `writer.RECORD_TYPES` lands here and has to be ruled on — floored
    or named unfloored — rather than defaulting to unfloored in silence, which is how an
    unclassified type reaches a member.
    """
    from api.services.wisdom.extract import writer
    from api.services.wisdom.publish import floor

    assert set(floor.UNFLOORED_TYPES) == set(writer.RECORD_TYPES) - set(floor.FLOORED_TYPES)
    # non-vacuity, both halves: neither set may be empty, or the difference proves nothing
    assert floor.UNFLOORED_TYPES and floor.FLOORED_TYPES
    assert set(floor.FLOORED_TYPES) <= set(writer.RECORD_TYPES), "a floored type the writer cannot emit"


# ══ 3. the rehearsal instrument itself ══════════════════════════════════════

def test_a_forced_chain_run_no_longer_bypasses_the_extract_spend_gate():
    """⭐⭐ THIS TEST CHANGED SIDES, AND THAT IS THE POINT OF HAVING WRITTEN IT.

    Session 13 wrote it to PIN A DEFECT: `batch.run_daily` read
    `if not ctx.force and not flags.extract_enabled()`, so a forced chain run skipped the one
    switch that spends — and `force` is a query parameter on an admin route. The test asserted the
    defective expression was still present, precisely so the behaviour could not change or be
    rediscovered unnoticed, and its failure message said what to do when it moved: re-state the
    finding, never delete the test.

    ⛔ R52 (owner ruling, 2026-09-15) fixed it, so this went RED — exactly as designed. It now
    pins the OPPOSITE: that the bypass is gone. ⚠️ It deliberately does NOT re-implement the
    behavioural checks; `tests/test_wisdom_forced_run_spend.py` owns those, and a guard repeated is
    a guard unproved. This one owns the HISTORY: it fails if the old expression ever returns.
    """
    import ast

    src = (WISDOM_PKG / "extract" / "batch.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.And):
            rendered = ast.unparse(node)
            if "ctx.force" in rendered and "extract_enabled" in rendered:
                pytest.fail(f"batch.py:{node.lineno} ANDs ctx.force with extract_enabled again — "
                            "R52 is undone and a forced admin run can spend with the switch off")
    # ⭐ and the replacement really is there, so this does not pass by the file being empty
    # ⚰️ This used to assert ACCEPT_SPEND_VALUE appeared in the file, which R64 made
    # meaningless: the constant is still DEFINED (the paid action will use it) but it no
    # longer gates anything, so its presence proved nothing. Check the R64 guard instead.
    assert "def spend_allowed(" in src, "spend_allowed is gone"
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "spend_allowed")
    body = ast.unparse(fn)
    assert "force" in body and "return False" in body, (
        "R64 is missing from spend_allowed — a forced run must never spend; see "
        "tests/test_wisdom_forced_run_spend.py, which owns its behaviour")


def test_the_rehearsal_never_forces_the_chain():
    src = (REPO / "tools" / "wisdom" / "gating_rehearsal.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    forces = [kw.value for n in ast.walk(tree) if isinstance(n, ast.Call)
              for kw in n.keywords if kw.arg == "force"]
    assert forces, "the rehearsal no longer sets force at all — it used to have to"
    assert all(isinstance(v, ast.Constant) and v.value is False for v in forces), \
        "the R50 rehearsal forces the chain, which bypasses WISDOM_EXTRACT_ENABLED"


def test_the_rehearsal_reports_shut_and_could_not_be_asked_as_different_facts():
    """⛔ A door that raised is INCONCLUSIVE, never `shut`. Collapsing them publishes a missing
    table as a gate that held."""
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "_r50_rehearsal", REPO / "tools" / "wisdom" / "gating_rehearsal.py")
    tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tool)
    assert tool._label(0).startswith("shut")
    assert tool._label(3).startswith("OPEN")
    assert tool._label((None, "OperationalError: no such table")).startswith("?")
    # and a door that raises comes back as the inconclusive shape, not as 0
    got = tool._door(lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    assert not isinstance(got, int) and got[0] is tool.INCONCLUSIVE


@pytest.mark.parametrize("module", sorted(m for m, v in DECLARED_CONSUMERS.items() if v == "MEMBER"))
def test_every_member_consumer_module_reads_a_flag(module):
    """A MEMBER-classified consumer that consults no flag at all is list (i) by definition."""
    src = (WISDOM_PKG / module).read_text(encoding="utf-8")
    tree = ast.parse(src)
    calls = {n.func.attr for n in ast.walk(tree)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    assert any(c.endswith("_enabled") for c in calls), \
        f"{module} reaches a member and consults no gate — list (i) is no longer empty"
