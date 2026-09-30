"""FRED is retired: no env var, key or flag can re-arm it (owner ruling #10).

Phase 0: https://fred.stlouisfed.org/legal/ prohibits "storing, caching, or
archiving" FRED content -- incompatible with a product that stores and serves
history. These rails fail if FRED ingestion becomes reachable again.
"""
from __future__ import annotations

import ast
import importlib
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]


@pytest.fixture
def armed_env(monkeypatch):
    """Every switch the OLD code (or a plausible future one) would read."""
    monkeypatch.setenv("FRED_API_KEY", "test-fred-key-abcdef0123456789")
    monkeypatch.setenv("FRED_RESEARCH_MODE", "1")
    monkeypatch.setenv("FRED_ENABLED", "1")
    monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)
    import api.services.fred_economic as fe
    return importlib.reload(fe)


def test_get_series_refuses_with_key_set(armed_env, monkeypatch):
    """(a) FRED_API_KEY set (plus every plausible arming flag) -> still refused,
    and no socket is ever opened."""
    import socket

    def _no_network(*a, **k):
        raise AssertionError("fred_economic opened a network connection")
    monkeypatch.setattr(socket.socket, "connect", _no_network)
    monkeypatch.setattr(socket, "create_connection", _no_network)
    out = armed_env.get_series("cpi", periods=3)
    out2 = armed_env.get_series("CPIAUCSL")
    assert out["error"].startswith("FRED retired") and out.get("retired") is True
    assert "latest" not in out and "points" not in out
    assert out2["series_id"] == "CPIAUCSL"


def test_list_series_catalog_is_empty(armed_env):
    assert armed_env.list_series_catalog() == []


def _tree(rel):
    return ast.parse((REPO / rel).read_text(encoding="utf-8"))


def test_stub_has_no_network_client_cache_or_env_read():
    tree = _tree("api/services/fred_economic.py")
    imported = {a.name.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
    imported |= {(n.module or "").split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
    for banned in ("requests", "httpx", "urllib", "aiohttp", "socket", "os", "api"):
        assert banned not in imported, f"fred_economic imports {banned}"
    names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    attrs = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    for banned in ("TTLCache", "environ", "getenv", "_CACHE"):
        assert banned not in names | attrs, banned


def _func(tree, name):
    return next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == name)


def test_no_module_imports_the_fred_stub_except_the_voice_tools():
    """The yfinance/Black-Scholes options_chain leg (the stub's other historical
    caller, via _risk_free_rate) was deleted on master (term-069, c3f28cad8).
    The only remaining importer of the stub is the voice tools lane."""
    assert not (REPO / "api" / "services" / "options_chain.py").exists()
    importers = []
    for p in (REPO / "api").rglob("*.py"):
        if "__pycache__" in p.parts or p.name == "fred_economic.py":
            continue
        tree = ast.parse(p.read_text(encoding="utf-8"))
        for n in ast.walk(tree):
            mods = []
            if isinstance(n, ast.ImportFrom):
                mods = [n.module or ""] + [f"{n.module}.{a.name}" for a in n.names]
            elif isinstance(n, ast.Import):
                mods = [a.name for a in n.names]
            if any(m.endswith("fred_economic") for m in mods):
                importers.append(p.relative_to(REPO).as_posix())
    assert sorted(set(importers)) == ["api/services/voice_tool_impls.py"], importers


def test_voice_tools_force_the_unavailable_error_statically():
    tree = _tree("api/services/voice_tool_impls.py")
    fn = _func(tree, "_get_economic_series")
    src = ast.unparse(fn)
    assert "out['error'] = _ECON_UNAVAILABLE" in src and "out['retired'] = True" in src
    lst = _func(tree, "_list_economic_series")
    body_src = " ".join(ast.unparse(n) for n in lst.body[1:])     # skip the docstring
    assert "fred_economic" not in body_src and "_ECON_UNAVAILABLE" in body_src


def test_callers_degrade_gracefully_at_runtime(armed_env):
    """Runtime twin of the static checks; needs the app's dependencies."""
    voice_tool_impls = pytest.importorskip("api.services.voice_tool_impls")
    out = voice_tool_impls._get_economic_series("cpi", periods=2)
    assert out["retired"] is True and "not available" in out["error"]
    assert voice_tool_impls._list_economic_series()["count"] == 0
    assert voice_tool_impls._get_economic_series("")["error"] == "no series name provided"


def test_voice_global_agent_no_longer_offered_fred_tools():
    src = (REPO / "api" / "services" / "voice_agents.py").read_text(encoding="utf-8")
    assert 'out.add("get_economic_series")' not in src
    assert 'out.add("list_economic_series")' not in src


def test_no_production_code_calls_the_fred_api():
    """Only the stub and docs may mention the FRED API host."""
    hits = []
    for base in ("api", "tools", "scripts", "services"):
        root = REPO / base
        if not root.exists():
            continue
        for p in root.rglob("*.py"):
            if "__pycache__" in p.parts:
                continue
            txt = p.read_text(encoding="utf-8", errors="ignore")
            if "api.stlouisfed.org/fred" in txt or "fred/series/observations" in txt:
                hits.append(str(p.relative_to(REPO)))
    assert hits == [], hits


def test_admin_health_no_longer_lists_fred_key():
    tree = _tree("api/routers/admin_api_health.py")
    node = next(n for n in tree.body if isinstance(n, ast.Assign) and any(
        isinstance(t, ast.Name) and t.id == "_KEYS" for t in n.targets))
    keys = ast.literal_eval(node.value)
    names = {k for group in keys.values() for k in group}
    assert "FRED_API_KEY" not in names
    assert {"BLS_API_KEY", "BEA_API_KEY", "CENSUS_API_KEY", "EIA_API_KEY"} <= names


def test_licensing_register_classifies_fred_red():
    reg = (REPO / "docs" / "terminal-research" / "09-security-licensing-cost" / "licensing-register.md").read_text(encoding="utf-8")
    section = reg[reg.index("#### FRED (Federal Reserve Bank of St. Louis)"):]
    section = section[: section.index("\n####", 10)]
    assert "RED" in section.splitlines()[0]
    assert "https://fred.stlouisfed.org/legal/" in section
    assert "storing, caching, or archiving" in section
    for row in ("| T-60 |", "| T-61 |"):
        line = next(l for l in section.splitlines() if l.startswith(row))
        assert "**RED**" in line, row
        assert "R if armed" not in line and "**LA†** (citation" not in line
