"""Census of how each route reads its request body, and in what order.

Read from two places, never from a text search:

  * the ROUTE OBJECTS of the real app (which dependencies a route has, and the
    order FastAPI solves them in; whether FastAPI itself reads the body for a
    declared body parameter), and
  * the PARSE TREE of every function on that chain (which of them read the
    request: `request.body()`, `.json()`, `.stream()`, `.form()`, or the
    `request_body_cap` helpers), following the request object into any helper
    it is handed to.

A comment or a docstring is not a call, so prose can neither satisfy nor fail
anything here.

WHY ORDER IS PART OF IT. FastAPI reads the body for a declared body parameter
(`body: Model`, `payload: dict`, `File(...)`, `Form(...)`) BEFORE it solves any
dependency: before a dark-flag gate, before the session check, and with no size
limit. So such a route buffers an anonymous body of any size, and a dark route
answers 422 to malformed JSON where an unknown route answers 404.
"""
from __future__ import annotations

import ast
import inspect
import textwrap
from dataclasses import dataclass, field
from typing import Any, Callable

from fastapi.routing import APIRoute
from starlette.requests import Request

RAW_READS = ("body", "json", "stream", "form")
CAPPED_HELPERS = ("read_capped_body", "read_capped_form")
CAPPED_FACTORY_QUALNAME = "capped_multipart.<locals>.dependency"
CAPPED_JSON_QUALNAME = "capped_json.<locals>.dependency"
GATE_QUALNAME = "_require_enabled"
BODY_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# The dependency functions that establish WHO is calling. A route's own
# `require_paid` wrapper depends on one of these, so it is found through the chain.
SESSION_FUNCTIONS = {
    "get_current_user", "get_current_user_with_plan", "get_optional_user",
    "require_admin", "requires_voice_access",
}


@dataclass
class Read:
    how: str            # fastapi-param | capped | stream-loop | raw
    call: str           # e.g. request.body(), read_capped_body, File(...)
    where: str          # the function it happens in
    position: int       # index in the solve order; -1 = before every dependency
    limit: str = ""     # the limit as written, when there is one
    limit_bytes: int | None = None
    line: int = 0


@dataclass
class Row:
    method: str
    path: str
    module: str
    endpoint: str
    gate_position: int | None
    session_position: int | None
    session_by: str
    reads: list[Read] = field(default_factory=list)
    unresolved: list[str] = field(default_factory=list)

    @property
    def reads_body(self) -> bool:
        return bool(self.reads)

    @property
    def uncapped(self) -> list[Read]:
        return [r for r in self.reads if r.how in ("raw", "fastapi-param")]

    @property
    def first_read_position(self) -> int | None:
        return min((r.position for r in self.reads), default=None)

    def order_problems(self) -> list[str]:
        """Gate, then session, then the body. Each violated step, in words."""
        out = []
        first = self.first_read_position
        if first is None:
            return out
        if self.gate_position is not None and first <= self.gate_position:
            out.append("the body is read before the dark-flag gate")
        if self.session_position is not None and first <= self.session_position:
            out.append("the body is read before the session check")
        if (self.gate_position is not None and self.session_position is not None
                and self.session_position < self.gate_position):
            out.append("the session is checked before the dark-flag gate")
        return out


# ── the solve order of a route ───────────────────────────────────────────────

def solve_order(route: APIRoute) -> list[Callable]:
    """Every dependency function in the order FastAPI calls them, then the endpoint."""
    out: list[Callable] = []
    seen: set[int] = set()

    def visit(dependant) -> None:
        for sub in dependant.dependencies:
            visit(sub)
            if sub.call is not None and id(sub.call) not in seen:
                seen.add(id(sub.call))
                out.append(sub.call)

    visit(route.dependant)
    out.append(route.endpoint)
    return out


def _name(fn: Callable) -> str:
    return getattr(fn, "__qualname__", None) or getattr(fn, "__name__", repr(fn))


# ── reading one function's parse tree ────────────────────────────────────────

def _function_ast(fn: Callable) -> tuple[ast.AST | None, int]:
    try:
        src = inspect.getsource(fn)
        first = inspect.getsourcelines(fn)[1]
    except (OSError, TypeError):
        return None, 0
    try:
        tree = ast.parse(textwrap.dedent(src))
    except SyntaxError:
        return None, 0
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            return node, first
    return None, 0


def _request_params(fn: Callable, node: ast.AST) -> set[str]:
    """Names in this function that hold the request."""
    names: set[str] = set()
    try:
        sig = inspect.signature(fn)
    except (TypeError, ValueError):
        sig = None
    if sig is not None:
        for pname, p in sig.parameters.items():
            ann = p.annotation
            if ann is Request or (inspect.isclass(ann) and issubclass(ann, Request)):
                names.add(pname)
            elif isinstance(ann, str) and ann.split(".")[-1] == "Request":
                names.add(pname)
            elif ann is inspect.Parameter.empty and pname in ("request", "req"):
                names.add(pname)
    return names


def _resolve(fn: Callable, func_node: ast.AST) -> Callable | None:
    """The function a call expression names, looked up in the caller's own globals
    and closure. None when it is not something this reader can follow."""
    scope: dict[str, Any] = dict(getattr(fn, "__globals__", {}))
    code = getattr(fn, "__code__", None)
    closure = getattr(fn, "__closure__", None)
    if code is not None and closure:
        for cell_name, cell in zip(code.co_freevars, closure):
            try:
                scope[cell_name] = cell.cell_contents
            except ValueError:
                pass
    try:
        if isinstance(func_node, ast.Name):
            target = scope.get(func_node.id)
        elif isinstance(func_node, ast.Attribute):
            parts = []
            cur: ast.AST = func_node
            while isinstance(cur, ast.Attribute):
                parts.append(cur.attr)
                cur = cur.value
            if not isinstance(cur, ast.Name) or cur.id not in scope:
                return None
            target = scope[cur.id]
            for attr in reversed(parts):
                target = getattr(target, attr)
        else:
            return None
    except AttributeError:
        return None
    return target if inspect.isfunction(target) else None


def _limit_value(fn: Callable, expr: ast.AST) -> int | None:
    try:
        value = eval(compile(ast.Expression(expr), "<limit>", "eval"), dict(fn.__globals__))  # noqa: S307
    except Exception:
        return None
    if callable(value):
        try:
            value = value()
        except Exception:
            return None
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _stream_loop_limit(node: ast.AST, call: ast.Call) -> ast.AST | None:
    """For `async for chunk in request.stream()`: the bound the loop itself
    enforces -- a comparison inside the loop body that leads to a raise or a
    return. None when the loop has no such bound."""
    for loop in ast.walk(node):
        if isinstance(loop, ast.AsyncFor) and any(n is call for n in ast.walk(loop.iter)):
            for inner in ast.walk(loop):
                if isinstance(inner, ast.If) and isinstance(inner.test, ast.Compare):
                    if any(isinstance(n, (ast.Raise, ast.Return)) for n in ast.walk(inner)):
                        return inner.test.comparators[0]
            return None
    return None


def reads_in(fn: Callable, position: int, row: Row, _seen: set[int] | None = None,
             _request_names: set[str] | None = None, _depth: int = 0) -> None:
    """Append to `row.reads` every body read `fn` makes, following the request
    into helpers it is passed to."""
    _seen = _seen if _seen is not None else set()
    if id(fn) in _seen or _depth > 6:
        return
    _seen.add(id(fn))

    if _name(fn) == CAPPED_FACTORY_QUALNAME:
        cells = dict(zip(fn.__code__.co_freevars, (c.cell_contents for c in fn.__closure__)))
        try:
            limit = cells["max_bytes"]()
        except Exception:
            limit = None
        row.reads.append(Read("capped", f"capped_multipart({cells['field']!r})", _name(fn), position,
                              limit="max_bytes() + framing", limit_bytes=limit))
        return

    if _name(fn) == CAPPED_JSON_QUALNAME:
        try:
            limit = fn.max_bytes()
        except Exception:
            limit = None
        row.reads.append(Read("capped", "capped_json", _name(fn), position,
                              limit="max_bytes()", limit_bytes=limit))
        return

    node, first_line = _function_ast(fn)
    if node is None:
        return
    request_names = set(_request_names or ()) | _request_params(fn, node)

    for call in [n for n in ast.walk(node) if isinstance(n, ast.Call)]:
        func = call.func
        line = first_line + getattr(call, "lineno", 1) - 1
        # request.body() / .json() / .stream() / .form()
        if (isinstance(func, ast.Attribute) and func.attr in RAW_READS
                and isinstance(func.value, ast.Name) and func.value.id in request_names):
            if func.attr == "stream":
                bound = _stream_loop_limit(node, call)
                if bound is not None:
                    row.reads.append(Read("stream-loop", "request.stream()", _name(fn), position,
                                          limit=ast.unparse(bound), limit_bytes=_limit_value(fn, bound), line=line))
                    continue
            row.reads.append(Read("raw", f"request.{func.attr}()", _name(fn), position, line=line))
            continue
        # body_cap.read_capped_body(request, LIMIT, sentence) / read_capped_form
        helper = func.attr if isinstance(func, ast.Attribute) else func.id if isinstance(func, ast.Name) else ""
        if helper in CAPPED_HELPERS:
            limit_expr = call.args[1] if len(call.args) > 1 else None
            row.reads.append(Read(
                "capped", helper, _name(fn), position,
                limit=ast.unparse(limit_expr) if limit_expr is not None else "",
                limit_bytes=_limit_value(fn, limit_expr) if limit_expr is not None else None, line=line))
            continue
        # the request handed to another function: follow it
        passed = [a for a in list(call.args) + [k.value for k in call.keywords]
                  if isinstance(a, ast.Name) and a.id in request_names]
        if passed:
            target = _resolve(fn, func)
            if target is None:
                row.unresolved.append(f"{_name(fn)} passes the request to {ast.unparse(func)}")
                continue
            try:
                params = list(inspect.signature(target).parameters)
            except (TypeError, ValueError):
                params = []
            handed: set[str] = set()
            for i, a in enumerate(call.args):
                if isinstance(a, ast.Name) and a.id in request_names and i < len(params):
                    handed.add(params[i])
            for k in call.keywords:
                if isinstance(k.value, ast.Name) and k.value.id in request_names and k.arg:
                    handed.add(k.arg)
            reads_in(target, position, row, _seen, handed, _depth + 1)


# ── one route ────────────────────────────────────────────────────────────────

def _fastapi_body_param(route: APIRoute) -> str | None:
    """What FastAPI itself reads for this route before any dependency, or None."""
    if route.body_field is None:
        return None
    flat = [p for p in getattr(route.dependant, "body_params", [])]
    names = []

    def collect(dependant) -> None:
        for p in dependant.body_params:
            kind = type(p.field_info).__name__      # Body / Form / File
            names.append(f"{p.name}: {kind}")
        for sub in dependant.dependencies:
            collect(sub)

    collect(route.dependant)
    return ", ".join(names) or ", ".join(p.name for p in flat) or "body"


def census_route(route: APIRoute, method: str) -> Row:
    order = solve_order(route)
    gate_position = None
    session_position = None
    session_by = ""
    for i, fn in enumerate(order):
        if _name(fn) == GATE_QUALNAME and gate_position is None:
            gate_position = i
        if getattr(fn, "__name__", "") in SESSION_FUNCTIONS and session_position is None:
            session_position = i
            session_by = fn.__name__
    row = Row(method=method, path=route.path, module=route.endpoint.__module__,
              endpoint=_name(route.endpoint), gate_position=gate_position,
              session_position=session_position, session_by=session_by)
    declared = _fastapi_body_param(route)
    if declared:
        row.reads.append(Read("fastapi-param", declared, "FastAPI, before any dependency", -1))
    for i, fn in enumerate(order):
        reads_in(fn, i, row)
    return row


def census(app, in_family: Callable[[APIRoute], bool]) -> list[Row]:
    rows = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or not in_family(route):
            continue
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            rows.append(census_route(route, method))
    rows.sort(key=lambda r: (r.module, r.path, r.method))
    return rows


def fmt_bytes(n: int | None) -> str:
    if n is None:
        return "?"
    for unit, size in (("MiB", 1024 * 1024), ("KiB", 1024)):
        if n >= size and n % size == 0:
            return f"{n // size} {unit}"
    if n >= 1024 * 1024:
        return f"{n / (1024 * 1024):.1f} MiB"
    return f"{n} B"


# ── which routes are the Notebook / Journal family ──────────────────────────

FAMILY_EXACT = {
    "api.routers.journal_two",     # the Journal and the Notebook's own doors
    "api.routers.note_sync",       # note connectors
    "api.routers.capture_auth",    # the capture extension's sign-in
    "api.routers.broker_sync",     # /api/j2/broker
    "api.routers.voice",           # the voice assistant
}
FAMILY_PREFIX = "api.routers.notebook_"


def in_family(route: APIRoute) -> bool:
    module = route.endpoint.__module__
    return module in FAMILY_EXACT or module.startswith(FAMILY_PREFIX)
