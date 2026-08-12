"""Is the note-connector scheduler ACTUALLY wired in, and does it honor the
double-gate?

Mirrors `tests/test_desk_session_audit.py`'s two rails (an AST scan over
`api/main.py` for the registered job ids + a route-presence check off
`router.routes`), each with a non-vacuity control — a probe that finds
nothing when scanning for a KNOWN sibling is a broken probe, not a passing
test (`lesson_probe_names_must_be_derived_not_typed`). Plus direct unit
tests of `note_connectors/scheduler.py`'s double-gate (registration is
covered by the AST scan; the job BODY's own re-check is covered here).
"""

from __future__ import annotations

import ast
import pathlib

import pytest

REPO = pathlib.Path(__file__).resolve().parent.parent
MAIN = REPO / "api" / "main.py"

JOB_ID_DUE = "note_sync_due"
JOB_ID_FULL_NIGHTLY = "note_sync_full_nightly"


def _add_job_ids(tree: ast.AST) -> list[str]:
    """Every literal `id=` on an `add_job(...)` call. An AST, never a grep —
    a grep would also match this docstring and the job-id comments above
    each `add_job` call (`lesson_probe_names_must_be_derived_not_typed`)."""
    out: list[str] = []
    for n in ast.walk(tree):
        if not (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and n.func.attr == "add_job"):
            continue
        for kw in n.keywords:
            if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                out.append(kw.value.value)
    return out


def test_both_note_sync_jobs_are_registered_in_main():
    ids = _add_job_ids(ast.parse(MAIN.read_text(encoding="utf-8")))
    # NON-VACUITY: the probe must see a sibling it isn't looking for, or an
    # AST walk that silently matched nothing would "pass" for everything.
    assert "broker_sync_nightly_reconcile" in ids, (
        "the add_job AST scan found no sibling broker job — the probe itself "
        "is broken, so its verdict on the note-sync jobs means nothing")
    assert JOB_ID_DUE in ids, (
        f"note_connectors.scheduler.run_due_sync_blocking is defined but never "
        f"scheduled. Registered ids: {ids}")
    assert JOB_ID_FULL_NIGHTLY in ids, (
        f"note_connectors.scheduler.run_full_nightly_sync_blocking is defined "
        f"but never scheduled — delete detection is unreachable without it. "
        f"Registered ids: {ids}")


def test_the_note_sync_router_defines_the_expected_routes():
    """Proves the ROUTER's own route table is complete — a companion to
    `test_the_note_sync_router_is_included_in_main` below, which proves
    `api/main.py` actually mounts this object (a correct, unmounted router
    would pass THIS test and still be unreachable — the exact
    built-tested-green-unreachable shape this repo's memory names)."""
    from api.routers import note_sync as ns
    paths = [getattr(r, "path", "") for r in ns.router.routes]
    # NON-VACUITY control: this probe should see BOTH a known route and be
    # able to fail on a route that genuinely isn't there.
    assert any(p.endswith("/status") for p in paths), (
        "the route probe found no /status sibling; it is broken")
    assert not any(p.endswith("/this-route-does-not-exist") for p in paths)
    assert any(p.endswith("/sources/{source_id}/sync") for p in paths), (
        f"POST /sources/{{id}}/sync is not mounted. Router paths: {paths}")
    assert any("/{provider}/connect" in p for p in paths)
    assert any("/{provider}/callback" in p for p in paths)


def test_the_note_sync_router_is_included_in_main():
    """AST scan over `api/main.py` for `app.include_router(note_sync_router
    .router)` — proves the router object from `test_the_note_sync_router_
    defines_the_expected_routes` above is actually WIRED, not merely
    correct. Mirrors the job-id AST scan's non-vacuity discipline: the probe
    must find a KNOWN sibling `include_router` call, or a walk that matches
    nothing would "pass" here too."""
    tree = ast.parse(MAIN.read_text(encoding="utf-8"))
    included_names: list[str] = []
    for n in ast.walk(tree):
        if not (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and n.func.attr == "include_router"):
            continue
        for arg in n.args:
            if isinstance(arg, ast.Attribute) and isinstance(arg.value, ast.Name):
                included_names.append(f"{arg.value.id}.{arg.attr}")
            elif isinstance(arg, ast.Name):
                included_names.append(arg.id)
    assert "broker_sync_router.router" in included_names, (
        "the include_router AST scan found no sibling broker_sync mount — "
        "the probe itself is broken")
    assert "note_sync_router.router" in included_names, (
        f"note_sync_router.router is defined but never app.include_router()'d "
        f"in main.py. Found: {included_names}")


def test_note_sync_scheduler_ids_match_the_registered_ids():
    """Names, not a re-typed copy — read the constants FROM the scheduler
    module rather than hand-retyping the literal strings a second time in
    this test (the `lesson_a_derived_value_must_not_depend_on_the_request`
    family of "second authority over one value" defect this repo keeps
    naming)."""
    from api.services.journal_two.note_connectors import scheduler as ns_sched
    src = pathlib.Path(ns_sched.__file__).read_text(encoding="utf-8")
    assert "run_due_sync_blocking" in src and "run_full_nightly_sync_blocking" in src


def test_registration_gate_env_var_name_matches_the_scheduler_module():
    """The literal env var name gating registration in main.py must be the
    SAME one `scheduler.enabled()` checks — a mismatch here would silently
    double-gate on two DIFFERENT flags, so flipping the documented one would
    never actually start anything."""
    main_src = MAIN.read_text(encoding="utf-8")
    assert "NOTE_SYNC_ENABLED" in main_src
    from api.services.journal_two.note_connectors import scheduler as ns_sched
    sched_src = pathlib.Path(ns_sched.__file__).read_text(encoding="utf-8")
    assert "NOTE_SYNC_ENABLED" in sched_src


# ── scheduler.py's own double-gate (job BODY re-check) ───────────────────────

def test_run_due_sync_blocking_noop_when_flag_off(monkeypatch):
    from api.services.journal_two.note_connectors import scheduler as ns_sched, engine
    monkeypatch.delenv("NOTE_SYNC_ENABLED", raising=False)
    calls = []
    monkeypatch.setattr(engine, "sync_due_sources", lambda: calls.append(1))
    ns_sched.run_due_sync_blocking()
    assert calls == []


def test_run_due_sync_blocking_runs_when_flag_on(monkeypatch):
    from api.services.journal_two.note_connectors import scheduler as ns_sched, engine

    async def fake_sync_due_sources():
        return None

    monkeypatch.setenv("NOTE_SYNC_ENABLED", "1")
    calls = []
    monkeypatch.setattr(engine, "sync_due_sources", lambda: (calls.append(1), fake_sync_due_sources())[1])
    ns_sched.run_due_sync_blocking()
    assert calls == [1]


def test_run_full_nightly_sync_blocking_noop_when_flag_off(monkeypatch):
    from api.services.journal_two.note_connectors import scheduler as ns_sched, engine
    monkeypatch.delenv("NOTE_SYNC_ENABLED", raising=False)
    calls = []
    monkeypatch.setattr(engine, "sync_all_active_sources_full", lambda: calls.append(1))
    ns_sched.run_full_nightly_sync_blocking()
    assert calls == []


def test_run_full_nightly_sync_blocking_runs_when_flag_on(monkeypatch):
    from api.services.journal_two.note_connectors import scheduler as ns_sched, engine

    async def fake_full():
        return None

    monkeypatch.setenv("NOTE_SYNC_ENABLED", "1")
    calls = []
    monkeypatch.setattr(
        engine, "sync_all_active_sources_full",
        lambda: (calls.append(1), fake_full())[1],
    )
    ns_sched.run_full_nightly_sync_blocking()
    assert calls == [1]


def test_job_body_never_raises_on_an_engine_exception(monkeypatch):
    from api.services.journal_two.note_connectors import scheduler as ns_sched, engine
    monkeypatch.setenv("NOTE_SYNC_ENABLED", "1")

    async def boom():
        raise RuntimeError("db is on fire")

    monkeypatch.setattr(engine, "sync_due_sources", lambda: boom())
    ns_sched.run_due_sync_blocking()  # must not raise into the scheduler
