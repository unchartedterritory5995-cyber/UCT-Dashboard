"""The edge shares one /api/bars answer between members for a few seconds (edge/bars-edge-router/tail.js).

That is only safe while the answer cannot depend on WHO asked. The edge's copy is filled from bars-api's
`/api/bars/{ticker}` route (`api/bars_api_main.py`, `bars_route`) with no cookie and no credential, and handed
to every entitled member. So these rails pin, by reading the source (no app import, no network):

1. `bars_route` takes exactly the chart parameters and NOTHING that can carry identity: no `Request`, no
   `Cookie(...)`, no `Header(...)`, no `Depends(...)`, and no dependencies on its decorator.
2. It answers through `serve_bars_http` (or the pair hand-off) with exactly those parameters.
3. Every query parameter the edge lets into its cache key is one the route actually reads, so the edge can
   never keep two different answers under one key, or one answer for a parameter the tier ignores.

The day the tier's route grows an identity input, rail 1 goes red BEFORE a shared copy can hand one member's
answer to another: that is the moment to exclude the variant at the edge (tail.js `tailCachePlan`).
"""
from __future__ import annotations

import ast
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
TIER = ROOT / "api" / "bars_api_main.py"
TAIL_JS = ROOT / "edge" / "bars-edge-router" / "tail.js"

CHART_PARAMS = ["ticker", "tf", "bars", "since", "to", "warm", "session"]
IDENTITY_CALLS = {"Cookie", "Header", "Depends", "Security"}
IDENTITY_TYPES = {"Request", "HTTPConnection", "WebSocket"}


def _bars_route(tree: ast.AST) -> ast.FunctionDef:
    found = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for dec in node.decorator_list:
                if (isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute) and dec.func.attr == "get"
                        and dec.args and isinstance(dec.args[0], ast.Constant)
                        and dec.args[0].value == "/api/bars/{ticker}"):
                    found.append((node, dec))
    assert len(found) == 1, f"exactly one tier route answers /api/bars/{{ticker}}, found {len(found)}"
    return found[0]


def _identity_problems(fn: ast.FunctionDef, dec: ast.Call) -> list[str]:
    problems = []
    for kw in dec.keywords:
        if kw.arg in ("dependencies",):
            problems.append(f"decorator dependencies= on {fn.name}")
    args = fn.args.posonlyargs + fn.args.args + fn.args.kwonlyargs
    defaults = [None] * (len(fn.args.posonlyargs + fn.args.args) - len(fn.args.defaults)) + list(fn.args.defaults)
    defaults += list(fn.args.kw_defaults)
    if fn.args.vararg or fn.args.kwarg:
        problems.append("*args/**kwargs")
    for a, d in zip(args, defaults):
        ann = ast.unparse(a.annotation) if a.annotation is not None else ""
        if any(re.search(rf"\b{t}\b", ann) for t in IDENTITY_TYPES):
            problems.append(f"{a.arg}: {ann}")
        for node in ast.walk(d) if d is not None else []:
            if isinstance(node, ast.Call):
                name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", "")
                if name in IDENTITY_CALLS:
                    problems.append(f"{a.arg} = {name}(...)")
        if a.annotation is not None:
            for node in ast.walk(a.annotation):
                if isinstance(node, ast.Call):
                    name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", "")
                    if name in IDENTITY_CALLS:
                        problems.append(f"{a.arg}: Annotated[{name}(...)]")
    return problems


def test_the_tier_bars_route_takes_no_identity_input():
    fn, dec = _bars_route(ast.parse(TIER.read_text(encoding="utf-8")))
    names = [a.arg for a in fn.args.posonlyargs + fn.args.args + fn.args.kwonlyargs]
    assert names == CHART_PARAMS, f"bars_route parameters changed: {names}; re-judge the edge's shared tail"
    assert _identity_problems(fn, dec) == []


def test_the_tier_bars_route_answers_with_only_those_parameters():
    fn, _dec = _bars_route(ast.parse(TIER.read_text(encoding="utf-8")))
    calls = [n for n in ast.walk(fn) if isinstance(n, ast.Call) and getattr(n.func, "id", "") == "serve_bars_http"]
    assert len(calls) == 1
    used = {n.id for n in ast.walk(calls[0]) if isinstance(n, ast.Name)} - {"serve_bars_http"}
    assert used == set(CHART_PARAMS), used


def test_every_parameter_the_edge_keys_on_is_one_the_tier_reads():
    src = TAIL_JS.read_text(encoding="utf-8")
    m = re.search(r"const ALLOWED_PARAMS = new Set\(\[([^\]]*)\]\)", src)
    assert m, "tail.js ALLOWED_PARAMS not found"
    edge = set(re.findall(r'"([a-z_]+)"', m.group(1)))
    assert edge, "empty ALLOWED_PARAMS"
    assert edge <= set(CHART_PARAMS) - {"ticker"}, edge
    assert "warm" not in edge, "a warm=1 read is best-effort and must not share a copy with a paint"


def test_the_identity_check_can_fail():
    """Control: the checker really sees each identity shape (a rail that cannot fail proves nothing)."""
    for snippet in [
        "@app.get('/api/bars/{ticker}')\ndef bars_route(ticker: str, request: Request): ...",
        "@app.get('/api/bars/{ticker}')\ndef bars_route(ticker: str, s: str = Cookie(None)): ...",
        "@app.get('/api/bars/{ticker}')\ndef bars_route(ticker: str, a: str = Header('')): ...",
        "@app.get('/api/bars/{ticker}')\ndef bars_route(ticker: str, u: dict = Depends(f)): ...",
        "@app.get('/api/bars/{ticker}', dependencies=[Depends(f)])\ndef bars_route(ticker: str): ...",
        "@app.get('/api/bars/{ticker}')\ndef bars_route(ticker: str, u: Annotated[str, Cookie()] = None): ...",
    ]:
        fn, dec = _bars_route(ast.parse(snippet))
        assert _identity_problems(fn, dec), snippet
    fn, dec = _bars_route(ast.parse("@app.get('/api/bars/{ticker}')\ndef bars_route(ticker: str, tf: str = 'D'): ..."))
    assert _identity_problems(fn, dec) == []
