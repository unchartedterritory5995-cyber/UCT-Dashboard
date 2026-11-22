"""LOCAL_LIGHT_MODE (api/services/local_light_mode.py): the dev-PC switch.

⛔ The property that matters most is the OFF direction: production never sets the flag,
so every guarded start site must run exactly as before when it is unset. Each guard in
api/main.py is therefore executed BOTH ways below, in isolation, with every name it
touches replaced by a mock: ON must not reach the job, OFF must.
"""
from __future__ import annotations

import ast
import os
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import pytest

from api.services import local_light_mode as llm

MAIN = Path(__file__).resolve().parents[1] / "api" / "main.py"
SRC = MAIN.read_text(encoding="utf-8")
TREE = ast.parse(SRC)

# Every site the light mode must skip. A guard deleted by a later edit fails here BY NAME.
EXPECTED = {
    "thread-burst-watch", "boot-probe", "substack-initial-poll", "modelbook-stats-warm",
    "chart-health-bootstrap", "indicator-alert-evaluator", "price-alert-evaluator",
    "startup-priority-audit", "hot-tier-warmer", "breadth-numeric-backfill", "cold-preload",
    "dashboard-warmer", "breadth-series-warmer", "research-panel-warmer",
    "chart-renderer-warmer", "calendar-enrichment-warmer", "calendar-weekly-rewarm",
    "theme-index-prewarm", "screener-deal-gate-warm", "rs-rankings-warmer",
    "industry-map-warmer", "darkpool-prewarm-warmer", "scanner-warmer",
    "ticker-meta-name-heal", "deploy-smoke", "bars-continuous-audit", "bars-reconciliation",
    "fundamentals-monitor", "nhnl-live", "volume-live", "provider-coverage-monitor",
    "disk-watchdog", "sqlite-integrity", "reuse-map-warm", "bars-bydate-index-builder",
    "weekly-key-purge", "intraday-offgrid-sweep", "memory-prewarm", "web-memwatch",
    "bars-seeder", "bars-prewarm", "ticker-names-prewarm", "period-preset-warm", "short-data-warm", "ticker-logos-prewarm",
    "index-bars-warm", "breadth-bars-warm", "logo-hires-startup", "breadth-sentiment-seed",
    "naaim-series-seed", "market-indicator-jobs", "pine-seed-jobs", "breadth-self-heal",
    "dashboard-cache-warm", "voice-kb-seed", "daily-tracker-snapshot", "flow-db-seed",
    "darkpool-db-seed", "prebuilt-watchlists-seed", "cot-seed", "cot-catchup",
    "study-weekly-close-catchup", "study-hard-pool-warm", "apscheduler-jobs",
    "massive-ws-consumer", "gap-fill-startup-check", "flow-integrity-probe",
}


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv(llm.ENV, raising=False)
    llm._reset_for_tests()
    yield
    llm._reset_for_tests()


# ── the helper ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("value", ["1", "true", "TRUE", " yes ", "on"])
def test_enabled_values(monkeypatch, value):
    monkeypatch.setenv(llm.ENV, value)
    assert llm.enabled() is True


@pytest.mark.parametrize("value", [None, "", "0", "false", "off", "no", "2"])
def test_disabled_values(monkeypatch, value):
    if value is not None:
        monkeypatch.setenv(llm.ENV, value)
    assert llm.enabled() is False


def test_enabled_is_read_on_every_call(monkeypatch):
    assert llm.enabled() is False
    monkeypatch.setenv(llm.ENV, "1")
    assert llm.enabled() is True
    monkeypatch.delenv(llm.ENV)
    assert llm.enabled() is False


def test_skip_off_returns_false_and_records_nothing():
    assert llm.skip("x") is False
    assert llm.skipped() == []
    assert llm.log_summary() is None


def test_skip_on_records_once_in_order(monkeypatch, capsys):
    monkeypatch.setenv(llm.ENV, "1")
    assert llm.skip("b") is True
    assert llm.skip("a") is True
    assert llm.skip("b") is True
    assert llm.skipped() == ["b", "a"]
    line = llm.log_summary()
    assert line == "[local-light] ON — skipping 2 background jobs: b, a"
    assert line in capsys.readouterr().out


def test_import_time_defaults_off_touch_nothing(monkeypatch):
    monkeypatch.delenv("FLOW_CONVICTION_WARMER", raising=False)
    assert llm.apply_import_time_defaults() == []
    assert "FLOW_CONVICTION_WARMER" not in os.environ


def test_import_time_defaults_on(monkeypatch):
    monkeypatch.setenv(llm.ENV, "1")
    monkeypatch.delenv("FLOW_CONVICTION_WARMER", raising=False)
    assert llm.apply_import_time_defaults() == ["flow-conviction-warmer"]
    assert os.environ["FLOW_CONVICTION_WARMER"] == "0"
    assert "flow-conviction-warmer" in llm.skipped()


def test_import_time_defaults_never_override_an_explicit_value(monkeypatch):
    monkeypatch.setenv(llm.ENV, "1")
    monkeypatch.setenv("FLOW_CONVICTION_WARMER", "1")
    assert llm.apply_import_time_defaults() == []
    assert os.environ["FLOW_CONVICTION_WARMER"] == "1"


# ── the wiring in api/main.py ───────────────────────────────────────────────

def _skip_name(test: ast.AST) -> str | None:
    for node in ast.walk(test):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id == "_light_skip"):
            return node.args[0].value
    return None


def _guards() -> list[tuple[str, ast.If]]:
    out = []
    for node in ast.walk(TREE):
        if isinstance(node, ast.If):
            name = _skip_name(node.test)
            if name:
                out.append((name, node))
    return out


GUARDS = _guards()


def test_every_expected_site_is_guarded_exactly_once():
    names = [n for n, _ in GUARDS]
    assert sorted(set(names)) == sorted(names), "a name is used by two guards"
    assert set(names) == EXPECTED


def test_the_helper_is_bound_at_the_top_of_the_lifespan():
    life = next(n for n in TREE.body
                if isinstance(n, ast.AsyncFunctionDef) and n.name == "lifespan")
    first_imports = [s for s in life.body[:3] if isinstance(s, ast.ImportFrom)]
    assert any(s.module == "api.services.local_light_mode"
               and s.names[0].name == "skip" and s.names[0].asname == "_light_skip"
               for s in first_imports)


def test_import_time_defaults_run_before_any_router_import():
    call_line = SRC.index("_local_light_mode.apply_import_time_defaults()")
    assert call_line < SRC.index("from api.routers import")
    assert call_line < SRC.index("from api.flow_summary import")


class _Ran(Exception):
    """Raised by the sentinel placed first in the guarded job branch."""


class _Names(dict):
    """exec() locals: every unknown name is a fresh MagicMock, except `os`, whose
    environment is EMPTY so every `os.environ.get(NAME, default)` gate reads its default
    (the production value of a switch nobody set)."""

    def __init__(self, **kw):
        super().__init__(os=SimpleNamespace(environ={}), **kw)

    def __missing__(self, key):
        self[key] = mock.MagicMock(name=key)
        return self[key]


def _run_guard(node: ast.If) -> bool:
    """Execute one guard in isolation; True when its JOB branch was entered."""
    node = ast.parse(ast.unparse(node)).body[0]           # a private copy
    # `if _light_skip(...): <skip branch> else: <job>`  vs  `if not _light_skip(...): <job>`
    job_is_else = isinstance(node.test, ast.Call)
    sentinel = ast.parse("__job_branch_entered__()").body[0]
    if job_is_else:
        node.orelse.insert(0, sentinel)
    else:
        node.body.insert(0, sentinel)
    code = compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])),
                   str(MAIN), "exec")

    def _entered():
        raise _Ran

    names = _Names(_light_skip=llm.skip, __job_branch_entered__=_entered)
    try:
        exec(code, {"__builtins__": __builtins__}, names)   # noqa: S102 - our own source
    except _Ran:
        return True
    return False


@pytest.mark.parametrize("name,node", GUARDS, ids=[n for n, _ in GUARDS])
def test_guard_runs_the_job_when_off(name, node):
    assert _run_guard(node) is True, f"{name}: the job did not run with the flag unset"
    assert llm.skipped() == []


@pytest.mark.parametrize("name,node", GUARDS, ids=[n for n, _ in GUARDS])
def test_guard_skips_the_job_when_on(monkeypatch, name, node):
    monkeypatch.setenv(llm.ENV, "1")
    assert _run_guard(node) is False, f"{name}: the job ran in light mode"
    assert name in llm.skipped()


def test_scheduler_starts_paused_only_in_light_mode(monkeypatch):
    (_, node), = [(n, g) for n, g in GUARDS if n == "apscheduler-jobs"]
    code = compile(ast.Module(body=[node], type_ignores=[]), str(MAIN), "exec")

    def run():
        names = _Names(_light_skip=llm.skip)
        exec(code, {"__builtins__": __builtins__}, names)   # noqa: S102
        return names["_scheduler"].start

    start = run()
    start.assert_called_once_with()                         # off: byte-for-byte the old call
    monkeypatch.setenv(llm.ENV, "1")
    start = run()
    start.assert_called_once_with(paused=True)


def test_readiness_gates_are_released_when_their_warmer_is_skipped(monkeypatch):
    monkeypatch.setenv(llm.ENV, "1")
    for gate, name in (("hot_tier", "hot-tier-warmer"), ("dashboard", "dashboard-warmer"),
                       ("rs_rankings", "rs-rankings-warmer"), ("scanner", "scanner-warmer")):
        (node,) = [g for n, g in GUARDS if n == name]
        code = compile(ast.Module(body=[node], type_ignores=[]), str(MAIN), "exec")
        names = _Names(_light_skip=llm.skip)
        exec(code, {"__builtins__": __builtins__}, names)   # noqa: S102
        names["readiness"].mark_done.assert_called_once_with(gate)


# ── the one guard outside the lifespan ──────────────────────────────────────

def test_screener_snapshot_warm_is_skipped_in_light_mode(monkeypatch):
    import threading
    from api import main
    monkeypatch.delenv("SCREENER_SNAPSHOT_WARM_ENABLED", raising=False)
    started = []

    class _FakeThread:
        def __init__(self, *a, **k):
            started.append(k.get("name"))

        def start(self):
            pass

    monkeypatch.setattr(threading, "Thread", _FakeThread)
    monkeypatch.setenv(llm.ENV, "1")
    assert main.start_screener_snapshot_warm() is None
    assert started == [] and "screener-snapshot-warm" in llm.skipped()

    monkeypatch.delenv(llm.ENV)
    assert main.start_screener_snapshot_warm() is not None
    assert started == ["screener-warm"]
