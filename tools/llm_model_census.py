"""AST census: model IDs named by hand, and sampling params that 400 on Claude 5.

WHY THIS EXISTS. Two defect classes that a 2026-08-28 fleet audit found live,
both of which a count or a grep would miss.

**1. A hand-typed model ID is a second authority.** 51 call sites across 36
modules each named their own model, over six different IDs. Two of them read the
same env var and disagreed about its default, so which model ran depended on
which file you happened to read. `api/services/llm_models.py` is the one place
that decides; a literal anywhere else is the defect
(`lesson_a_second_authority_over_one_value`).

**2. A sampling parameter is a 400 waiting for a deploy.** `temperature`,
`top_p` and `top_k` are rejected outright by every Claude 5 model. The audit
found 13 sites passing `temperature` with NO retry guard — all four Model Book
sites and the entire Compass surface among them. Every one of those was one
model-string edit away from taking down a member-facing path, and five other
modules in the same tree already carried in-code postmortems of precisely that
outage. A rail is the only thing that stops the fourteenth.

WHY AN AST AND NOT A GREP. A grep for `claude-` hits comments, docstrings and
postmortems — this repo's files are full of prose naming the models they used to
run, and a rail that cries wolf is worse than no rail
(`lesson_a_sweep_that_flags_thirteen_when_two_are_defects`). Only the syntax
tree can tell a live string constant from the same characters inside the
docstring that explains why it was removed.

WHAT COUNTS AS A VIOLATION
    model_literal    a `str` constant matching `claude-*`, in code, outside
                     `llm_models.py` — excluding docstrings, which are prose.
    sampling_param   `temperature=` / `top_p=` / `top_k=` on a `.create(...)`
                     or `.stream(...)` call.

The census reports FILE:LINE:KIND and the offending text. A count would pass on
a swap: fix one, add another, the number never moves.
"""
from __future__ import annotations

import ast
import os
import re
import sys
from dataclasses import dataclass
from typing import Iterable

# The one module allowed to name a model. It IS the authority.
REGISTRY = "api/services/llm_models.py"

MODEL_RE = re.compile(r"^claude-[a-z0-9][a-z0-9.\-]*$", re.IGNORECASE)

# Rejected with a 400 by every model `llm_models` names.
SAMPLING_KWARGS = frozenset({"temperature", "top_p", "top_k"})

# The SDK methods that take them.
GENERATION_METHODS = frozenset({"create", "stream"})

# ⛔ ANTHROPIC ONLY. The owner attribute immediately left of the method is what
# separates the two SDKs by construction:
#     Anthropic  client.messages.create(...)      / client.beta.messages.stream
#     OpenAI     client.chat.completions.create(...)
# OpenAI models ACCEPT `temperature`, and this repo has four live gpt-4o calls
# that legitimately pass one (`voice_openai`, `voice_summarizer`,
# `voice_chart_vision`). Flagging those would make the rail wrong on its first
# run, and a rail that cries wolf gets an ignore-list bolted on and then dies
# (`lesson_a_sweep_that_flags_thirteen_when_two_are_defects`).
ANTHROPIC_OWNER = "messages"

DEFAULT_ROOTS = ("api",)
_SKIP_DIR_PARTS = frozenset({"__pycache__", "node_modules", ".git", "external"})


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    kind: str      # "model_literal" | "sampling_param"
    detail: str
    scope: str

    def __str__(self) -> str:  # pragma: no cover - formatting only
        return f"{self.path}:{self.line} [{self.kind}] {self.detail} (in {self.scope})"


def _iter_py_files(root: str, base: str) -> Iterable[str]:
    for dirpath, dirnames, filenames in os.walk(os.path.join(base, root)):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIR_PARTS]
        for fn in sorted(filenames):
            if fn.endswith(".py"):
                yield os.path.join(dirpath, fn)


def _rel(path: str, base: str) -> str:
    return os.path.relpath(path, base).replace("\\", "/")


def _lookup_key_nodes(tree: ast.AST) -> set[int]:
    """`id()` of every Constant used as a dict KEY or a subscript index.

    ⛔ A PRICE TABLE MUST NAME MODEL IDS. `{"claude-opus-5": {...}}` in
    `cost_guard.py` and `_PRICES["claude-opus-4-8"]` as a fallback lookup are
    not second authorities over which model runs — they are maps KEYED by the
    model, and a rail that flags them is wrong about 15 lines on its first run.
    The structural tell is position: a model ID in key position is being looked
    up; a model ID in value position is being chosen.
    """
    out: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Dict):
            for key in node.keys:
                if isinstance(key, ast.Constant):
                    out.add(id(key))
        elif isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant):
            out.add(id(node.slice))
    return out


def _is_test_file(path: str) -> bool:
    base = os.path.basename(path)
    return base.startswith("test_") or base.endswith("_test.py")


def _docstring_nodes(tree: ast.AST) -> set[int]:
    """`id()` of every Constant that is a docstring — prose, not configuration."""
    out: set[int] = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef,
                                 ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        body = getattr(node, "body", None) or []
        if (body and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)):
            out.add(id(body[0].value))
    return out


def _scope_of(tree: ast.AST, target: ast.AST) -> str:
    """Enclosing def chain, or '<module>'."""
    parents: dict[int, ast.AST] = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[id(child)] = node
    names: list[str] = []
    cur = parents.get(id(target))
    while cur is not None:
        if isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.append(cur.name)
        cur = parents.get(id(cur))
    return ".".join(reversed(names)) or "<module>"


def census_module(source: str, relpath: str) -> list[Finding]:
    tree = ast.parse(source)
    docstrings = _docstring_nodes(tree)
    lookup_keys = _lookup_key_nodes(tree)
    findings: list[Finding] = []
    # The registry names the models; a test constructs fakes and asserts on
    # literals on purpose (the compass_eval judge test pins its model by name).
    exempt = relpath == REGISTRY or _is_test_file(relpath)

    for node in ast.walk(tree):
        # 1. a model ID named by hand
        if (not exempt and isinstance(node, ast.Constant)
                and isinstance(node.value, str)
                and id(node) not in docstrings
                and id(node) not in lookup_keys
                and MODEL_RE.match(node.value.strip())):
            findings.append(Finding(
                path=relpath, line=node.lineno, kind="model_literal",
                detail=f'"{node.value}" - import the tier from llm_models instead',
                scope=_scope_of(tree, node)))

        # 2. a sampling parameter on an ANTHROPIC generation call
        if isinstance(node, ast.Call):
            func = node.func
            method = func.attr if isinstance(func, ast.Attribute) else None
            owner = (func.value.attr
                     if isinstance(func, ast.Attribute)
                     and isinstance(func.value, ast.Attribute) else None)
            if method in GENERATION_METHODS and owner == ANTHROPIC_OWNER:
                for kw in node.keywords:
                    if kw.arg in SAMPLING_KWARGS:
                        findings.append(Finding(
                            path=relpath, line=kw.value.lineno,
                            kind="sampling_param",
                            detail=f"{kw.arg}= - Claude 5 models reject it with a 400",
                            scope=_scope_of(tree, node)))

            # 3. the same defect built into a kwargs dict and splatted, which
            # the direct check above cannot see through. `dict(model=...,
            # temperature=...)` is unambiguously an LLM request payload, so
            # keying on the CO-OCCURRENCE of `model=` and a sampling kwarg
            # stays precise without flagging every dict in the tree. Three
            # catalyst modules were written this way and 400-then-retry on
            # every single call — the defect paying a round-trip forever
            # instead of failing once and being fixed.
            if isinstance(func, ast.Name) and func.id == "dict":
                args = {kw.arg for kw in node.keywords if kw.arg}
                if "model" in args:
                    for kw in node.keywords:
                        if kw.arg in SAMPLING_KWARGS:
                            findings.append(Finding(
                                path=relpath, line=kw.value.lineno,
                                kind="sampling_param",
                                detail=(f"{kw.arg}= in a splatted request dict - "
                                        "Claude 5 models reject it with a 400"),
                                scope=_scope_of(tree, node)))
    return findings


def run_census(base: str, roots: Iterable[str] = DEFAULT_ROOTS) -> list[Finding]:
    out: list[Finding] = []
    for root in roots:
        for path in _iter_py_files(root, base):
            rel = _rel(path, base)
            try:
                source = open(path, encoding="utf-8").read()
            except (OSError, UnicodeDecodeError):
                continue
            try:
                out.extend(census_module(source, rel))
            except SyntaxError:
                # An unparseable module is not this rail's problem to report;
                # the test suite will not import it either.
                continue
    return out


def main() -> int:  # pragma: no cover - operator entry point
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    findings = run_census(base)
    if not findings:
        print("llm_model_census: clean")
        return 0
    for f in sorted(findings, key=lambda f: (f.kind, f.path, f.line)):
        print(f)
    print(f"\n{len(findings)} finding(s)")
    return 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
