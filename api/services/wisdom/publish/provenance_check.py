"""The CI check behind §8c.3: no publish-adapter code path writes a consumer without a marker.

THE RULING (owner, checkpoint 3, CONTRACTS §8c.3)
    every Wisdom publish adapter writes a provenance marker on every write, and a CI
    check fails if any adapter code path can write to a consumer table without it.

WHY IT IS STRUCTURAL AND NOT A SEARCH
The audit it replaces looked for a marker nobody was required to write, so a row
published without one was invisible to it. A check that grepped the adapters for
"looks like a publish" would inherit exactly that shape. This one instead derives, from
the source, the set of statements that CAN write outside Wisdom's own tables, and fails
on any of them that cannot be shown to carry the marker.

⛔ EVERY SUBJECT LIST HERE IS DERIVED, NEVER TYPED (§8c.3).
  * the WISDOM-OWNED tables come from the migrations themselves — every `MIGRATIONS`
    list under `api/services/wisdom/**/schema.py`, including the base DDL file
    `docs/wisdom/contracts/wisdom-db-v0.sql` that core_001 reads. A table Wisdom does
    not create is a CONSUMER table by definition, so a consumer nobody has thought of
    yet is in scope the day it is written. A typed roster would have been the artifact
    that goes stale first, and a rail with a stale subject list reads as coverage.
  * the FILES come from a glob over the Wisdom publish package and the Wisdom publish
    tools, not from a list of adapter names.
  * the WRITE SITES come from an `ast` walk, not a regex over the file. A regex finds
    prose: `pv_examples.py`'s own docstring contains the words "insert into
    pattern_exemplars" while the module opens no such database.

WHAT COUNTS AS A CONSUMER WRITE SITE
  1. a SQL string literal whose statement is INSERT / REPLACE / UPDATE / DELETE against
     a table Wisdom's migrations do not create. Docstrings and bare string expressions
     are excluded (they are prose); a literal that is only RETURNED rather than executed
     is still a site — `archive_plan_sql` hands SQL to an operator to run, which is a
     code path that writes.
  2. a call into a module OUTSIDE `api.services.wisdom` whose function name begins with
     a write verb — `modelbook_service.create_setup_example(...)` is the live example.
     The standard library is excluded; so is anything inside the Wisdom package, whose
     tables are Wisdom's own.

WHAT COUNTS AS MARKED
A site is marked when EITHER
  * its guard scope — the innermost enclosing loop, else the enclosing function, else
    the module — contains a call to one of `provenance`'s marking functions at or before
    the site's line; or
  * the SQL statement itself constrains to rows that already carry the marker
    (`source = 'wisdom'`, `provenance.SQL_MARKED_PREDICATE`). Such a statement cannot
    reach an unmarked row, so flipping `active` on one needs no new marker.

Run it: `python -m api.services.wisdom.publish.provenance_check` (exit 1 on a finding),
`--json` for the full report, `--self-check` to prove the check can fail.
"""
from __future__ import annotations

import argparse
import ast
import importlib
import json
import pathlib
import re
import sys
from typing import Iterable, Optional

REPO = pathlib.Path(__file__).resolve().parents[4]
WISDOM_PKG_DIR = REPO / "api" / "services" / "wisdom"
PUBLISH_PKG_DIR = WISDOM_PKG_DIR / "publish"
TOOLS_DIR = REPO / "tools" / "wisdom"
WISDOM_IMPORT_PREFIX = "api.services.wisdom"

#: The module that owns the marker. A file that loads it BY PATH (the PC-side tools do,
#: so they never import `api`) binds it to this same name — one name, one marker API.
MARKER_MODULE = "provenance"
MARKING_FUNCTIONS = frozenset({"stamp", "stamp_text", "marker", "marker_text", "assert_marked"})

#: A function name beginning with one of these is a write. Derived-adjacent: it is a
#: property of English, not a roster of consumers, and it is deliberately generous —
#: a false positive costs one marking call, a false negative costs the whole rail.
WRITE_VERBS = ("create", "insert", "update", "upsert", "delete", "remove", "write", "put",
               "save", "set", "add", "replace", "store", "publish", "sync", "enqueue",
               "record", "apply", "commit", "push", "emit", "send", "post")
_WRITE_VERB_RE = re.compile(r"^_?(" + "|".join(WRITE_VERBS) + r")(_|[A-Z]|$)")

_WRITE_SQL_RE = re.compile(
    r"\b(?P<verb>INSERT\s+(?:OR\s+[A-Z]+\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)"
    r"\s+(?P<table>[A-Za-z_][A-Za-z0-9_]*)", re.I)
#: `... ON CONFLICT DO UPDATE SET ...` is the same statement as its INSERT, and `SET` is
#: not a table. Anything else here would be a real table name.
_NOT_A_TABLE = frozenset({"set", "or", "from", "into"})

_CREATE_TABLE_RE = re.compile(
    r"CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\"'`\[]?(?P<table>[A-Za-z_][A-Za-z0-9_]*)",
    re.I)
_ALTER_TABLE_RE = re.compile(
    r"ALTER\s+TABLE\s+[\"'`\[]?(?P<table>[A-Za-z_][A-Za-z0-9_]*)", re.I)

# ── the derived subject lists ────────────────────────────────────────────────

def schema_modules() -> list[str]:
    """Every `schema.py` under the Wisdom package — the packages the registry loads, plus
    `publish/adapters/schema.py`, which the registry reaches only once S-F1 appends it."""
    names = []
    for path in sorted(WISDOM_PKG_DIR.rglob("schema.py")):
        rel = path.relative_to(REPO).with_suffix("")
        names.append(".".join(rel.parts))
    return names


def wisdom_owned_tables() -> set:
    """Every table Wisdom's own migrations create or alter. Anything else is a consumer."""
    tables: set = set()
    for name in schema_modules():
        try:
            module = importlib.import_module(name)
        except Exception:  # a schema module that cannot import owns no tables we can see
            continue
        for _migration, sql in getattr(module, "MIGRATIONS", []):
            text = str(sql)
            tables.update(m.group("table").lower() for m in _CREATE_TABLE_RE.finditer(text))
            tables.update(m.group("table").lower() for m in _ALTER_TABLE_RE.finditer(text))
    return tables


def scanned_files() -> list:
    """The Wisdom publish package and the Wisdom publish tools. A glob, not a roster."""
    files = [p for p in sorted(PUBLISH_PKG_DIR.rglob("*.py")) if "__pycache__" not in p.parts]
    files += [p for p in sorted(TOOLS_DIR.glob("publish_*.py")) if "__pycache__" not in p.parts]
    return files


# ── the AST walk ─────────────────────────────────────────────────────────────

def _module_name_of(path: pathlib.Path) -> str:
    try:
        rel = path.relative_to(REPO).with_suffix("")
    except ValueError:
        return path.stem
    return ".".join(rel.parts)


def _import_map(tree: ast.AST, module_name: str) -> dict:
    """local name -> dotted module (or module.attr) it was imported from."""
    package = module_name.rsplit(".", 1)[0] if "." in module_name else ""
    out: dict = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                out[alias.asname or alias.name.split(".")[0]] = alias.name
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            if node.level:
                parts = package.split(".") if package else []
                base = ".".join(parts[: len(parts) - node.level + 1] + ([node.module] if node.module else []))
            for alias in node.names:
                out[alias.asname or alias.name] = f"{base}.{alias.name}" if base else alias.name
    return out


def _docstring_nodes(tree: ast.AST) -> set:
    """id() of every string Constant that is a bare expression — a docstring or prose."""
    out = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) \
                and isinstance(node.value.value, str):
            out.add(id(node.value))
    return out


def _sql_fragments(node: ast.AST, docstrings: set) -> Iterable:
    """(text, lineno) for one string literal — an f-string's literal parts REJOINED.

    Rejoining matters: `"UPDATE knowledge_base SET … " f"…{stamp} " "WHERE … source =
    'wisdom'"` is ONE statement that Python folds into one JoinedStr. Reading its parts
    separately splits the verb away from the WHERE clause, and the check then cannot see
    that the statement constrains itself to rows that already carry the marker."""
    if isinstance(node, ast.Constant):
        if isinstance(node.value, str) and id(node) not in docstrings:
            yield node.value, node.lineno
        return
    if isinstance(node, ast.JoinedStr):
        parts = []
        for part in node.values:
            parts.append(part.value if isinstance(part, ast.Constant) and isinstance(part.value, str) else " ? ")
        yield "".join(parts), node.lineno


def _parents(tree: ast.AST) -> dict:
    out = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            out[id(child)] = node
    return out


def _guard_scope(node: ast.AST, parents: dict, tree: ast.AST):
    """Innermost enclosing loop, else the enclosing function, else the module."""
    cur, function = parents.get(id(node)), None
    while cur is not None:
        if isinstance(cur, (ast.For, ast.AsyncFor, ast.While)):
            return cur
        if isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef)) and function is None:
            function = cur
        cur = parents.get(id(cur))
    return function or tree


def _marking_calls(tree: ast.AST, imports: dict) -> list:
    """Line numbers of every call into the marker module, with the node that holds them."""
    prov_aliases = {name for name, dotted in imports.items()
                    if dotted.split(".")[-1] == MARKER_MODULE} | {MARKER_MODULE}
    bare = {name for name, dotted in imports.items()
            if dotted.rsplit(".", 2)[:-1] and dotted.split(".")[-2:-1] == [MARKER_MODULE]
            and dotted.split(".")[-1] in MARKING_FUNCTIONS}
    out = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name) \
                and func.value.id in prov_aliases and func.attr in MARKING_FUNCTIONS:
            out.append(node)
        elif isinstance(func, ast.Name) and func.id in bare:
            out.append(node)
    return out


def _external_write_calls(tree: ast.AST, imports: dict) -> list:
    """Calls into a module outside the Wisdom package whose name reads as a write."""
    stdlib = getattr(sys, "stdlib_module_names", frozenset())
    out = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
            dotted, attr = imports.get(func.value.id), func.attr
        elif isinstance(func, ast.Name) and func.id in imports and "." in imports[func.id]:
            dotted, attr = imports[func.id].rsplit(".", 1)[0], imports[func.id].rsplit(".", 1)[1]
        else:
            continue
        if not dotted or not _WRITE_VERB_RE.match(attr):
            continue
        if dotted.startswith(WISDOM_IMPORT_PREFIX) or dotted.split(".")[0] in stdlib:
            continue
        out.append((node, f"{dotted}.{attr}"))
    return out


def _site(path: pathlib.Path, node: ast.AST, kind: str, target: str, marked: bool,
          why: str, snippet: str = "") -> dict:
    try:  # a self-check plants its file outside the repo on purpose
        shown = str(path.relative_to(REPO))
    except ValueError:
        shown = str(path)
    return {"file": shown.replace("\\", "/"), "line": getattr(node, "lineno", 0),
            "kind": kind, "target": target, "marked": marked, "why": why, "snippet": snippet[:160]}


def scan_file(path: pathlib.Path, owned: set) -> list:
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(path))
    imports = _import_map(tree, _module_name_of(path))
    parents = _parents(tree)
    docstrings = _docstring_nodes(tree)
    marks = _marking_calls(tree, imports)
    sites: list = []

    def marked_by_scope(node: ast.AST) -> bool:
        scope = _guard_scope(node, parents, tree)
        line = getattr(node, "lineno", 0)
        scope_ids = {id(n) for n in ast.walk(scope)}
        return any(id(m) in scope_ids and m.lineno <= line for m in marks)

    seen: set = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Constant, ast.JoinedStr)):
            continue
        if isinstance(node, ast.Constant):
            # an f-string's literal parts are reported through their JoinedStr, once
            if not isinstance(node.value, str) or id(node) in docstrings \
                    or isinstance(parents.get(id(node)), ast.JoinedStr):
                continue
        for text, _lineno in _sql_fragments(node, docstrings):
            for match in _WRITE_SQL_RE.finditer(text):
                table = match.group("table").lower()
                key = (getattr(node, "lineno", 0), table, text[:120])
                if table in _NOT_A_TABLE or table in owned or key in seen:
                    continue
                seen.add(key)
                if _sql_predicate_marked(text):
                    sites.append(_site(path, node, "sql", table, True,
                                       "constrained to rows carrying the marker source", text))
                    continue
                ok = marked_by_scope(node)
                sites.append(_site(path, node, "sql", table, ok,
                                   "marking call in guard scope" if ok else "NO marking call in guard scope",
                                   text))

    for node, target in _external_write_calls(tree, imports):
        ok = marked_by_scope(node)
        sites.append(_site(path, node, "call", target, ok,
                           "marking call in guard scope" if ok else "NO marking call in guard scope"))
    return sites


def _sql_predicate_marked(sql: str) -> bool:
    from api.services.wisdom.publish.adapters import provenance

    return bool(provenance.SQL_MARKED_PREDICATE.search(sql))


# ── the report ───────────────────────────────────────────────────────────────

def audit(files: Optional[Iterable] = None) -> dict:
    owned = wisdom_owned_tables()
    paths = list(files) if files is not None else scanned_files()
    sites: list = []
    for path in paths:
        sites.extend(scan_file(pathlib.Path(path), owned))
    unmarked = [s for s in sites if not s["marked"]]
    return {
        "ok": not unmarked,
        "files_scanned": len(paths),
        "wisdom_owned_tables": len(owned),
        "consumer_tables": sorted({s["target"] for s in sites if s["kind"] == "sql"}),
        "consumer_calls": sorted({s["target"] for s in sites if s["kind"] == "call"}),
        "sites": sites,
        "unmarked": unmarked,
    }


def self_check(tmp_dir: pathlib.Path) -> dict:
    """Prove the check can fail: a planted adapter that writes a consumer with no marker."""
    planted = tmp_dir / "planted_adapter.py"
    # the SQL is assembled here so this FILE never contains a contiguous consumer write
    # statement of its own — the checker scans its own package, and a checker that flags
    # itself teaches everyone to read a finding as noise.
    statement = "INSERT INTO " + "knowledge_base(title, content) VALUES (?, ?)"
    planted.write_text(
        '"""A planted adapter (self-check). It writes a consumer table with no marker."""\n'
        "def publish(conn):\n"
        f"    conn.execute({statement!r}, ('t', 'c'))\n",
        encoding="utf-8")
    report = audit([planted])
    return {"planted_file": str(planted), "found": len(report["unmarked"]), "report": report}


def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--json", action="store_true", help="print the whole report")
    ap.add_argument("--self-check", action="store_true", help="plant a violation and prove the check fails")
    args = ap.parse_args(argv)
    if args.self_check:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            out = self_check(pathlib.Path(tmp))
        print(json.dumps({k: v for k, v in out.items() if k != "report"}, indent=2))
        if out["found"] != 1:
            print("SELF-CHECK FAILED: the planted unmarked write was not reported", file=sys.stderr)
            return 1
        print("self-check ok: the planted unmarked write was reported")
        return 0
    report = audit()
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"scanned {report['files_scanned']} file(s); {len(report['sites'])} consumer write site(s); "
              f"{report['wisdom_owned_tables']} Wisdom-owned table(s)")
        for site in report["sites"]:
            flag = "OK " if site["marked"] else "UNMARKED"
            print(f"  {flag} {site['file']}:{site['line']} {site['kind']} {site['target']} — {site['why']}")
    if report["unmarked"]:
        print(f"\nFAIL: {len(report['unmarked'])} consumer write(s) with no provenance marker", file=sys.stderr)
        return 1
    print("\nOK: every consumer write site carries a provenance marker")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
