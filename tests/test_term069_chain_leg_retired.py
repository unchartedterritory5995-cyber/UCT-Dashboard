"""TERM-069 (FB-A10-02) -- the yfinance/Black-Scholes options-chain leg is RETIRED.

WHAT WAS RETIRED. `api/services/options_chain.py`: a second implementation of the
options-chain data class (yfinance for chain/IV/OI, a local Black-Scholes for the
greeks, FRED-or-4.5% risk-free rate). Its only readers were the three voice
(Compass) option tools in `voice_tool_impls.py`, as a FALLBACK behind the Massive
chain (`polygon_options.py`, native exchange greeks/IV). The licensing register
classes that source X (T-74), so the fallback published an X-class number exactly
when Massive was down -- a failure that read as an answer.

WHAT SURVIVES. ONE chain implementation, on Massive: `polygon_options.py`'s
`list_expirations` / `get_chain` / `get_contract`. That is the machinery BRK-01
(pre-trade options analysis) builds on -- which is why this retirement is the
precondition of that row, not its contradiction (roadmap §8 item 3).

⛔ NOT RETIRED HERE, BY NAME: the calendar's legacy expected-move straddle
(`earnings_enrichment.py`, the default-OFF `IMPLIED_ENRICHMENT_CUTOVER` path). It
is member-visible and its cutover is an owner decision (TD-57); the chain-read rail
below allows exactly that one module and names it.

The rails:
  * the module is gone, and nothing under `api/` imports it (named by file:line);
  * nothing under `api/` reads a yfinance option chain except the one named module;
  * the voice tools answer from Massive or return Massive's error -- they never
    reach the retired module again (a planted stand-in proves the negative);
  * the voice tool's description no longer promises a yfinance fallback;
  * the discord cold-path preload manifest no longer registers the module;
  * the parity instrument (tools/term069_chain_parity.py) diffs purely and imports
    `api` without PYTHONPATH.
"""
from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
import types
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parents[1]
RETIRED_REL = "api/services/options_chain.py"
RETIRED_MOD = "api.services.options_chain"

#: The ONE module still allowed to read a yfinance option chain, and why.
YF_CHAIN_READERS_ALLOWED = {
    "api/services/earnings_enrichment.py":
        "calendar expected-move legacy leg -- IMPLIED_ENRICHMENT_CUTOVER is an owner decision (TD-57)",
}


def _api_py_files():
    for dirpath, dirnames, filenames in os.walk(_REPO / "api"):
        dirnames[:] = sorted(d for d in dirnames if d not in {"__pycache__", "node_modules", "external"})
        for fn in sorted(filenames):
            if fn.endswith(".py"):
                p = Path(dirpath) / fn
                yield p.relative_to(_REPO).as_posix(), p


def _parse(p: Path):
    try:
        return ast.parse(p.read_text(encoding="utf-8"), filename=str(p))
    except (SyntaxError, ValueError):
        return None


# ═════════════════════════════════════════════════════════════════════════
# the legacy leg is gone, and unreachable
# ═════════════════════════════════════════════════════════════════════════

def test_the_legacy_chain_module_is_deleted():
    assert not (_REPO / RETIRED_REL).exists(), (
        f"{RETIRED_REL} still exists -- TERM-069 retires it (delete, never deprecate): "
        "a documented-as-dead module with zero importers is REACH-1")


def test_nothing_under_api_imports_the_retired_chain_module():
    found: list[str] = []
    for rel, p in _api_py_files():
        tree = _parse(p)
        if tree is None:
            continue
        for n in ast.walk(tree):
            if isinstance(n, ast.Import):
                if any(a.name == RETIRED_MOD or a.name.startswith(RETIRED_MOD + ".") for a in n.names):
                    found.append(f"{rel}:{n.lineno} import {RETIRED_MOD}")
            elif isinstance(n, ast.ImportFrom) and n.level == 0 and n.module:
                if n.module == RETIRED_MOD:
                    found.append(f"{rel}:{n.lineno} from {RETIRED_MOD} import ...")
                elif n.module == "api.services" and any(a.name == "options_chain" for a in n.names):
                    found.append(f"{rel}:{n.lineno} from api.services import options_chain")
            elif isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) \
                    and n.func.attr == "import_module" and n.args \
                    and isinstance(n.args[0], ast.Constant) and n.args[0].value == RETIRED_MOD:
                found.append(f"{rel}:{n.lineno} importlib.import_module({RETIRED_MOD!r})")
    assert not found, "the retired yfinance/Black-Scholes chain leg is still imported:\n    " \
        + "\n    ".join(found)


def test_nothing_under_api_reads_a_yfinance_option_chain_except_the_named_module():
    """`<yf Ticker>.option_chain(...)` anywhere under api/ -- in a module that reaches
    yfinance at all -- is a second chain implementation. One module is allowed, by name."""
    found: list[str] = []
    for rel, p in _api_py_files():
        tree = _parse(p)
        if tree is None:
            continue
        reaches_yf = any(
            (isinstance(n, ast.Import) and any(a.name.split(".")[0] == "yfinance" for a in n.names))
            or (isinstance(n, ast.ImportFrom) and (n.module or "").split(".")[0] == "yfinance")
            for n in ast.walk(tree))
        if not reaches_yf:
            continue
        for n in ast.walk(tree):
            if isinstance(n, ast.Attribute) and n.attr == "option_chain" and rel not in YF_CHAIN_READERS_ALLOWED:
                found.append(f"{rel}:{n.lineno} .option_chain")
    assert not found, ("a yfinance option chain is read outside the one allowed module -- the "
                       "chain has ONE implementation, on Massive (polygon_options):\n    "
                       + "\n    ".join(found))


def test_the_allowed_yfinance_chain_reader_is_not_stale():
    for rel in YF_CHAIN_READERS_ALLOWED:
        src = (_REPO / rel).read_text(encoding="utf-8")
        assert "option_chain" in src, f"{rel} no longer reads a yfinance chain -- delete its exemption"


# ═════════════════════════════════════════════════════════════════════════
# the voice consumers: Massive, or Massive's error -- never the retired leg
# ═════════════════════════════════════════════════════════════════════════

@pytest.fixture
def planted_legacy(monkeypatch):
    """A stand-in for the retired module in `sys.modules`. If any consumer still
    does `from api.services.options_chain import ...`, it binds THESE functions and
    the call is recorded -- the negative ("never reached") is observable."""
    calls: list[str] = []
    fake = types.ModuleType(RETIRED_MOD)

    def _rec(name):
        def f(*a, **k):
            calls.append(name)
            return {"ticker": "AAPL", "source": "yfinance-legacy", "calls": [], "puts": [],
                    "expirations": ["2099-01-01"], "count": 1}
        return f

    fake.list_expirations = _rec("list_expirations")
    fake.get_chain = _rec("get_chain")
    fake.get_contract = _rec("get_contract")
    monkeypatch.setitem(sys.modules, RETIRED_MOD, fake)
    return calls


def _massive_fails(monkeypatch):
    from api.services import polygon_options as po
    err = {"error": "polygon request failed: 503", "ticker": "AAPL"}
    monkeypatch.setattr(po, "list_expirations", lambda *a, **k: dict(err))
    monkeypatch.setattr(po, "get_chain", lambda *a, **k: dict(err))
    monkeypatch.setattr(po, "get_contract", lambda *a, **k: dict(err))
    return err


CASES = [
    ("_list_option_expirations", {"ticker": "AAPL"}),
    ("_get_option_chain", {"ticker": "AAPL", "expiration": "2026-10-16", "strikes_around_spot": 4}),
    ("_get_option_contract", {"ticker": "AAPL", "strike": 200.0, "expiration": "2026-10-16",
                              "call_or_put": "put"}),
]


@pytest.mark.parametrize("fn_name,kwargs", CASES, ids=[c[0] for c in CASES])
def test_a_massive_failure_is_returned_as_massives_error_never_a_legacy_answer(
        monkeypatch, planted_legacy, fn_name, kwargs):
    from api.services import voice_tool_impls as vti
    err = _massive_fails(monkeypatch)
    out = getattr(vti, fn_name)(**kwargs)
    assert planted_legacy == [], f"{fn_name} reached the retired yfinance leg: {planted_legacy}"
    assert out.get("error") == err["error"], out
    assert out.get("source") != "yfinance-legacy"


@pytest.mark.parametrize("fn_name,kwargs", CASES, ids=[c[0] for c in CASES])
def test_a_massive_answer_is_returned_unchanged(monkeypatch, planted_legacy, fn_name, kwargs):
    from api.services import polygon_options as po
    from api.services import voice_tool_impls as vti
    ok = {"ticker": "AAPL", "source": "polygon (Massive Advanced)", "expiration": "2026-10-16",
          "spot": 201.5, "calls": [{"strike": 200.0, "delta": 0.55}], "puts": [],
          "expirations": ["2026-10-16"], "count": 1}
    seen: list[tuple] = []

    def _ok(name):
        def f(*a, **k):
            seen.append((name, a, k))
            return dict(ok)
        return f

    monkeypatch.setattr(po, "list_expirations", _ok("list_expirations"))
    monkeypatch.setattr(po, "get_chain", _ok("get_chain"))
    monkeypatch.setattr(po, "get_contract", _ok("get_contract"))
    out = getattr(vti, fn_name)(**kwargs)
    assert out == ok
    assert len(seen) == 1
    assert planted_legacy == []


def test_the_empty_ticker_guards_are_unchanged():
    from api.services import voice_tool_impls as vti
    assert vti._list_option_expirations("") == {"error": "ticker required"}
    assert vti._get_option_chain("  ") == {"error": "ticker required"}
    assert vti._get_option_contract("AAPL", 0, "") == {"error": "ticker, strike, expiration required"}


def test_the_voice_tool_descriptions_no_longer_promise_a_yfinance_fallback():
    from api.services import voice_tool_impls  # noqa: F401  (registers on import)
    from api.services import voice_tools
    for name in ("list_option_expirations", "get_option_chain", "get_option_contract"):
        entry = voice_tools._REGISTRY.get(name)
        assert entry is not None, f"voice tool {name} is no longer registered"
        desc = entry["description"].lower()
        assert "yfinance" not in desc and "black-scholes" not in desc, (
            f"{name}'s description (sent to the model) still names the retired leg: {entry['description']!r}")


# ═════════════════════════════════════════════════════════════════════════
# the boot preload no longer registers a module that no longer exists
# ═════════════════════════════════════════════════════════════════════════

def test_the_cold_path_preload_manifest_does_not_name_the_retired_module():
    p = _REPO / "docs" / "discord-render" / "evidence" / "cold-paths" / "preload-manifest.json"
    m = json.loads(p.read_text(encoding="utf-8"))
    assert RETIRED_MOD not in (m.get("modules") or [])
    assert RETIRED_MOD not in [r.get("module") for r in (m.get("measured") or [])], (
        "the boot preload would `importlib.import_module` a deleted module and log a failure "
        "on every boot")


# ═════════════════════════════════════════════════════════════════════════
# the parity instrument
# ═════════════════════════════════════════════════════════════════════════

def _par():
    if str(_REPO) not in sys.path:
        sys.path.insert(0, str(_REPO))
    from tools import term069_chain_parity as par
    return par


def test_parity_diff_reports_disagreements_and_one_sided_contracts_only():
    par = _par()
    a = {("C", 200.0): {"iv": 0.30, "delta": 0.50, "open_interest": 100, "bid": 1.0, "ask": 1.2}}
    assert par.diff("AAPL", "2026-10-16", a, {k: dict(v) for k, v in a.items()}) == []

    b = {("C", 200.0): {"iv": 0.36, "delta": 0.50, "open_interest": 100, "bid": 1.0, "ask": 1.2},
         ("P", 195.0): {"iv": 0.33, "delta": -0.4, "open_interest": 5, "bid": 0.5, "ask": 0.6}}
    got = par.diff("AAPL", "2026-10-16", a, b)
    assert ("AAPL", "2026-10-16", "C", 200.0, "iv", 0.30, 0.36) in got
    assert ("AAPL", "2026-10-16", "P", 195.0, "contract", None, "massive-only") in got
    # a field missing on one side is a disagreement, never agreement
    c = {("C", 200.0): {"iv": None, "delta": 0.50, "open_interest": 100, "bid": 1.0, "ask": 1.2}}
    assert ("AAPL", "2026-10-16", "C", 200.0, "iv", 0.30, None) in par.diff("AAPL", "2026-10-16", a, c)


def test_parity_tolerances_are_per_field_and_relative():
    par = _par()
    a = {("C", 100.0): {"iv": 0.300, "delta": 0.500, "open_interest": 1000, "bid": 2.00, "ask": 2.10}}
    near = {("C", 100.0): {"iv": 0.301, "delta": 0.501, "open_interest": 1000, "bid": 2.00, "ask": 2.10}}
    assert par.diff("X", "E", a, near) == []


def test_parity_tool_imports_api_without_pythonpath(tmp_path):
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    env.pop("MASSIVE_API_KEY", None)
    proc = subprocess.run([sys.executable, str(_REPO / "tools" / "term069_chain_parity.py"), "--help"],
                          cwd=str(tmp_path), env=env, capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr[-2000:]
    assert "parity" in proc.stdout.lower()


def test_parity_tool_refuses_to_report_agreement_without_a_key(tmp_path):
    env = {k: v for k, v in os.environ.items() if k not in ("PYTHONPATH", "MASSIVE_API_KEY",
                                                              "MASSIVE_SECRET_KEY")}
    proc = subprocess.run([sys.executable, str(_REPO / "tools" / "term069_chain_parity.py"), "AAPL"],
                          cwd=str(tmp_path), env=env, capture_output=True, text=True, timeout=120)
    assert proc.returncode == 2, (proc.returncode, proc.stdout[-800:], proc.stderr[-800:])
    assert "nothing was compared" in proc.stderr.lower()
